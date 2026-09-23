# Server & Database Runbook

Date: 2026-09-23
Scope: `apps/server` (Express 5 / Socket.io / Prisma / Redis on Oracle A1), Supabase Postgres, Cloudflare Pages client.
Audience: whoever deploys HavenWorld next (including future me).

---

## 1. Why login was broken (two independent root causes)

Both were real, both are fixed, and neither was a "schema design" problem — the schema on
`main` was already valid and correct.

### 1.1 The database never had the schema the code uses

`prisma/schema.prisma` had 38 models, but the live Supabase database contained only the 8
tables of an older prototype (`profiles`, `avatar_profiles`, `rooms`, `messages`,
`user_friends`, `user_inventory`, `placed_furniture`, `_prisma_migrations`). Every DB query
the app made therefore failed with Prisma `P2021`, e.g. from the production log:

```
[Cron] Crafting completion sweep failed: PrismaClientKnownRequestError:
Invalid `prisma.craftingQueue.findMany()` invocation:
The table `public.crafting_queues` does not exist in the current database.
```

`_prisma_migrations` *claimed* all migrations had been applied, but every row had
`applied_steps_count = 0` — the ledger had been written by hand, so
`prisma migrate deploy` believed there was nothing left to do.

### 1.2 Migration `20260919000000` could never apply

The migration itself was broken: it added a column to `crafting_queues`, a table that no
migration created:

```
Error: P3018 ... 42P01 ERROR: relation "crafting_queues" does not exist
```

`scripts/remote-deploy.sh` runs under `set -euo pipefail` and calls `prisma migrate deploy`
before building. So every deploy from that commit onward **aborted before `pnpm build` and
before `pm2 reload`** — the server kept serving a stale `dist/` forever, and nobody saw the
error unless they read the deploy output.

### 1.3 A third, silent gate locked out every account

`POST /api/auth/register` guarded the *sending* of the verification email with
`if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM)`, but `POST /api/auth/login`
unconditionally required `emailVerified`. This server has neither variable set, so the
verification link could never be delivered and every login answered:

```
403 {"error":"Please verify your email address before logging in.","code":"EMAIL_NOT_VERIFIED"}
```

Accounts are now auto-verified **only while no email provider is configured**; setting
`RESEND_API_KEY` + `EMAIL_FROM` restores verify-before-login automatically.

---

## 2. Verified current state (2026-09-23)

| Check | Result |
| --- | --- |
| `prisma migrate status` | "Database schema is up to date!" (4 migrations, real `applied_steps_count`) |
| `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel` | `-- This is an empty migration` (zero drift) |
| Tables in `public` | 39 = 38 models + `_prisma_migrations` |
| `CREATE TABLE` across all migrations | 38 = number of `model` blocks |
| `POST /api/auth/register` (public HTTPS) | 201, no verification gate |
| `POST /api/auth/login` (public HTTPS) | 200 + access token |
| `GET /api/users/me` (public HTTPS) | 200 |
| `POST /api/auth/refresh` (cookie) | 200, rotated token |
| Data created per registration | 1 avatar, 1 personal loft, 17 inventory items, 1 refresh token, LOGIN analytics event |

---

## 3. The database: exactly one, and it is already in the cloud

- **One Postgres**, hosted by Supabase (`aws-0-us-west-2.pooler.supabase.com:5432`).
- **One Redis**, local to the VM, used for refresh-token cache / socket state.
- **Prisma is the ORM, not a provider** — it needs no service of its own.
- Resend (email) and Sentry (errors) are wired in code but unconfigured and optional;
  the app runs without them (see §1.3).
- The client is a static SPA on Cloudflare Pages; Cloudflare R2 for assets is optional.

There is no need to "move" the database between machines: the Linux server and the Mac
both talk to the same Supabase Postgres over the network. What must travel between
environments is the **schema** (via migrations in git) and **backups** (via `pg_dump`).

### Backups taken before the 2026-09-23 migration

- `oracle-cloud:/tmp/legacy_backup.sql.gz` — full pre-migration dump (pg_dump 17.11).
- Local copy: `~/havenworld-legacy-backup-20260923.sql.gz`.
- The original 8 tables were **not dropped**. They were moved into a `legacy` schema:
  `select * from legacy.profiles;` still returns the original 282 rows.

### Restoring

```bash
# schema + data of the old prototype, into a scratch database
psql "$DATABASE_URL" -c 'CREATE DATABASE restore_check'
pg_restore --dbname=restore_check --no-owner --no-privileges legacy_backup.sql
```

---

## 4. Deploying the server

**Always deploy with the script. Never hand-run `git pull` + `pm2 restart`.**

```bash
make deploy-server        # lint + tests + build locally, then push to the VM
make deploy-server-quick  # skip local tests, SSH deploy only
```

`scripts/remote-deploy.sh` (run as user `havenworld`) does, in order:
`git pull` → `pnpm install --frozen-lockfile` → build shared → **`prisma generate`** →
**`prisma migrate deploy`** → build server → `pm2 reload havenworld-server`.

The step that used to fail is now the step that keeps the DB honest: if a migration cannot
apply, the deploy stops instead of silently leaving stale code running.

---

## 5. Changing the schema (the only supported workflow)

1. Edit `apps/server/prisma/schema.prisma`.
2. Generate the migration from the schema, never hand-write it:
   ```bash
   cd apps/server
   pnpm exec prisma migrate diff \
     --from-url "$DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/migrations/$(date -u +%Y%m%d%H%M%S)_your_change/migration.sql
   ```
3. Commit the schema **and** the migration together, push.
4. Deploy — `prisma migrate deploy` applies it, and `migrate diff` should print
   `-- This is an empty migration` afterwards.

Rules learned the hard way:

- A migration may only reference objects that earlier migrations created. `migrate deploy`
  applies files in filename order, so referencing a "later" table fails on a fresh DB.
- Never insert rows into `_prisma_migrations` by hand. A forged row makes
  `migrate status` lie and hides the failure that actually needs fixing.
- If a migration fails during deploy: fix the SQL, then
  `prisma migrate resolve --rolled-back <name>` before deploying again (otherwise `P3009`
  blocks everything).

---

## 6. Alpha bootstrap (first real account + invite codes)

The invite gate and admin tooling both need an existing account first, so the very first
account is created with the gate open:

```bash
# 1. on the VM, open registration for the bootstrap window
cd /opt/havenworld/apps/server
sudo sed -i 's/^ALPHA_INVITE_ONLY=true/ALPHA_INVITE_ONLY=false/' .env
sudo -u havenworld -H pm2 reload havenworld-server --update-env

# 2. register your own account at https://havenworld-game.pages.dev

# 3. promote it to ADMIN (from the VM, in the repo)
pnpm --filter server exec tsx src/scripts/promote-admin.ts you@example.com
#    or, once installed:  pnpm --filter server promote:admin you@example.com

# 4. close the gate again and mint invites for testers
sudo sed -i 's/^ALPHA_INVITE_ONLY=false/ALPHA_INVITE_ONLY=true/' .env
sudo -u havenworld -H pm2 reload havenworld-server --update-env
pnpm --filter server exec tsx src/scripts/generate-invites.ts 25 30 you@example.com
```

As of 2026-09-23 the gate is left **open** (`ALPHA_INVITE_ONLY=false`) precisely so the
owner can create the first account; run steps 3–4 immediately afterwards.

---

## 7. Troubleshooting index

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P2021 The table public.X does not exist` | migration never applied | `prisma migrate deploy` (§4) |
| `P3018` / `42P01 relation ... does not exist` | migration references a not-yet-created table | fix the SQL, `migrate resolve --rolled-back <name>` |
| `P3009 migrate found failed migrations` | an earlier attempt failed and is still recorded | `prisma migrate resolve --rolled-back <name>` |
| `P3005 The database schema is not empty` | tables exist without migration history | move them to another schema (see §3) or baseline deliberately |
| `403 EMAIL_NOT_VERIFIED` on login | no email provider configured | set `RESEND_API_KEY` + `EMAIL_FROM`, or rely on auto-verify (§1.3) |
| `EACCES ... query_engine_bg.js` on `prisma generate` | pnpm store owned by another user | `sudo chown -R havenworld:ubuntu /opt/havenworld`, then generate as `havenworld` |
| `pg_dump: aborting because of server version mismatch` | client older than PG 17 | `apt-get install postgresql-client-17` (PGDG repo) |
| `migrate status` says "up to date" but tables are missing | ledger written by hand | compare with `migrate diff`; distrust the ledger, trust the diff |

---

## 8. Known gaps / backlog

- **Jest suites cannot run locally** without the dev databases: `apps/server/tests/jest.globalSetup.ts`
  connects to `127.0.0.1:5432`. Start them with `make dev-up` (Docker) before `pnpm test:server`.
- **No password reset or password change route exists.** With email unconfigured, a
  forgotten password is unrecoverable. Recommended: add `POST /api/auth/change-password`
  (authenticated) plus a token-based reset once Resend is configured.
- Resend and Sentry are unconfigured; `@sentry/node` is inert without `SENTRY_DSN`.
- GitHub Actions is disabled at the account level (HTTP 422 on dispatch); deploys are manual
  via `make deploy-server`. `CF_API_TOKEN` is still missing from repo secrets.
- Client-side build/deploy is separate: `make deploy-client` (Cloudflare Pages).
- `legacy` schema can be dropped once the old prototype data is confirmed unwanted:
  `DROP SCHEMA legacy CASCADE;`
