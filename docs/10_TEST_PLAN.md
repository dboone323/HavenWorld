# HavenWorld Test Plan & Verification Status

Date: 2026-09-23
Scope: `apps/server` (Express 5 / Socket.io / Prisma / Redis), `apps/client` (Vite / Babylon.js),
`e2e` (Playwright), live deployment (Oracle A1 + Supabase + Cloudflare Pages).
Companion to `09_DEPLOY_AND_DATABASE_RUNBOOK.md` — that doc covers *deploying*, this one covers
*proving it works*. Read §3 before running anything.

---

## 1. Status summary (verified 2026-09-23)

| Layer | What it is | Safe command | Result |
| --- | --- | --- | --- |
| L0 Typecheck | `tsc --noEmit` for both apps | `pnpm lint` | **PASS** (exit 0) |
| L1 Server unit | Jest `unit` project, mocks only | see §6.1 | **PASS** 6 suites / 43 tests (28.8 s) |
| L2 Server integration | Jest `integration`, real local Postgres + Redis | see §6.1 | **PASS** 6 suites / 51 tests (32.9 s) |
| L3 Client unit | Vitest + jsdom + Babylon `NullEngine` | `pnpm --filter client test` | **PASS** 11 files / 92 tests (29.5 s) |
| L4 E2E | Playwright Chromium, 22 specs | see §6.2 | **PARTIAL** — harness repaired; 3 defects found & 2 fixed, 1 open (§5.5) |
| L5 Live gate | `scripts/beta-gate-check.sh` | `./scripts/beta-gate-check.sh` | **GO** 16 PASS / 0 FAIL / 2 SKIP |
| L6 Live API smoke | register → verify → login → cleanup on prod | see §6.6 | **PASS** (register 201, login 200) |
| L7 Load | k6 (`load-tests/*.js`), k6 installed | see §6.5 | **NOT YET RUN** |

**186 automated tests green** at L0–L3 today, plus a green beta gate and a live login smoke.

## 2. Verified production state

| Fact | Value |
| --- | --- |
| Accounts in `public.users` | 1 — `dboone323`, role **ADMIN**, `emailVerified=true` |
| Account footprint | 1 avatar, 17 inventory rows, 1 room owned |
| Invite codes minted | 0 |
| Alpha gate | `ALPHA_INVITE_ONLY=false` (**open** — see §8 step 2) |
| Process | `havenworld-server` online, pm2 id 0, pid 29390, port 3000 |
| `GET /health` | `status=ok`, `version=0.1.0`, `redis=connected`, `socketCount=1` |
| Security headers | HSTS (2 y, preload), CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` |
| TLS cert (nip.io) | valid, 89 days remaining |
| Legacy credential recovery | impossible — see runbook §6.1 |

---

## 3. ⚠️ Two landmines — read before running any test target

Both were discovered on 2026-09-23 and neither is theoretical. Both make a *test* command mutate
**production**.

### L1 — `make push-schema` pushes to production with `--accept-data-loss`

```make
push-schema: dev-up
	pnpm --filter server exec prisma db push --accept-data-loss        # ← apps/server/.env = PRODUCTION
	@set -a && . apps/server/.env.test && set +a \
	  && DATABASE_URL="$$DATABASE_URL" pnpm --filter server exec prisma db push --accept-data-loss
```

The first push resolves `.env` from the Prisma cwd (`apps/server`), and **`apps/server/.env` points at
the Supabase pooler (`aws-0-us-west-2.pooler.supabase.com`)**. So the first command of every
`make push-schema` runs `prisma db push --accept-data-loss` **against production**. It is inherited by
`make test-server`, `make test-server-coverage`, `make test-e2e`, `make test-e2e-all`, and
`make deploy-server` (which depends on `test-server`).

The comment says "BOTH dev and test databases" — the *intent* is the two local databases
(`havenworld_dev`, `havenworld_test`), so this is a bug, not a policy. Today it is harmless only
because the local schema matches `schema.prisma` (`db push` reported "already in sync"), but on any
branch that edits `schema.prisma` it would reshape the **live** schema without a migration.

**Safe form** — push to the two local databases explicitly (env vars beat `dotenv`, which never
overrides an already-set variable):

```bash
export LOCAL_DEV="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_dev"
export LOCAL_TEST="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
DATABASE_URL="$LOCAL_TEST" pnpm --filter server exec prisma db push --accept-data-loss --skip-generate
DATABASE_URL="$LOCAL_DEV"  pnpm --filter server exec prisma db push --accept-data-loss --skip-generate
```

Production schema changes go through `prisma migrate deploy` only (runbook §5).

### L2 — Playwright boots a *production-pointing* server, then calls `/api/test/reset`

- `apps/server/src/index.ts:1` is `import 'dotenv/config'` → loads `apps/server/.env` (production).
  There is **no** `NODE_ENV=test → .env.test` switch anywhere in the server.
- `playwright.config.ts` `webServer` runs `NODE_ENV=test PORT=3000 pnpm --filter server dev`.
- `e2e/globalSetup.ts` then `POST`s `$VITE_SERVER_URL/api/test/reset`.
- `src/routes/testRoutes.ts` is gated **only** on `process.env.NODE_ENV !== 'test'` — no database check.

Net effect: `make test-e2e` starts a server whose `NODE_ENV` is `test` but whose `DATABASE_URL` is
production, and the very first thing the suite does is run
`prisma.user.deleteMany({ email endsWith '@havenworld.test' | startsWith 'test-' | username startsWith
'testuser' | 'e2e_' })` **against production**, after which the specs register and delete real accounts
there.

**Safe form** — export an explicit local `DATABASE_URL` (Playwright passes its own env to `webServer`
children, and `dotenv` will not override it):

```bash
export DATABASE_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
export REDIS_URL="redis://127.0.0.1:6379/1" NODE_ENV=test
npx playwright test e2e/fullFlow.spec.ts --project=chromium
```

To run **only** the live specs against the deployed site, note the config already disables
`webServer` **and** `globalSetup` when `BASE_URL` contains `pages.dev`:

```bash
BASE_URL=https://havenworld-game.pages.dev npx playwright test e2e/live-prod-login.spec.ts --project=chromium
```

**Recommended permanent fixes** (not yet applied): (a) make `push-schema` depend on the local URLs
only; (b) load `.env.test` in `index.ts` when `NODE_ENV === 'test'`; (c) add an
`if (process.env.NODE_ENV === 'test' && !DATABASE_URL.includes('_test')) throw` assertion inside
`testRoutes.ts`, mirroring the guard Jest already has in `tests/jest.globalSetup.ts:8`.

## 4. Prerequisites (all verified present on this machine)

| Requirement | Version / state |
| --- | --- |
| Node | v22.23.1 |
| pnpm | 9.15.9 |
| Docker Desktop | running; provides `postgres:16-alpine` + `redis:7-alpine` |
| Local databases | `havenworld_dev`, `havenworld_test` (created by `deploy/postgres/init-dev-databases.sql`) |
| Playwright | installed; Chromium 1228 + 1243 cached |
| k6 | `/opt/homebrew/bin/k6` |
| `psql` / `pg_dump` | **not installed locally** — use `docker compose exec postgres psql`, or the VM |

Start the stack: `docker compose -f docker-compose.dev.yml up -d`
Stop it: `docker compose -f docker-compose.dev.yml down`

> Note: `apps/server/.env.test` is the file Jest uses (`127.0.0.1:5432/havenworld_test`,
> `redis://127.0.0.1:6379/1`). The **root** `.env.test` is **empty**, yet `playwright.config.ts:5`
> loads it — that is why Playwright silently falls back to `http://localhost:5173` and starts its own
> web servers.

---

## 5. Test inventory — what is actually covered

### 5.1 Server unit (`apps/server/src/**/__tests__`, Jest project `unit`, no DB)

| File | Suites cover |
| --- | --- |
| `middleware/__tests__/auth.test.ts` | JWT verify, 401 paths (missing/garbage/wrong-secret), `requireRole` |
| `services/__tests__/inventoryService.test.ts` | add/remove items, coin transfer atomicity, insufficient funds, negative & self-transfer rejection, 500-coin weekly cap, daily-streak double claim |
| `services/__tests__/moderation.test.ts` | profanity pass/block + sanitized text, 200-char limit, 5-per-3 s rate limit, mute enforcement, admin bypass, empty message |
| `services/__tests__/roomManager.test.ts` | join/leave tracking, movement, empty-room eviction, `room-park` retention, 50-message ring buffer, furniture state, `getPlayer` |
| `services/__tests__/tradeManager.test.ts` | same-room + proximity gates, OFFER→LOCKED transitions, offer-after-lock revert, atomic swap + audit log, cancel, self-trade rejection |
| `services/__tests__/workshopService.test.ts` | craft start/deduct, insufficient materials, premature claim, claim-on-complete, parallel queues |

### 5.2 Server integration (`apps/server/__tests__`, Jest project `integration`, real PG + Redis)

| File | Suites cover |
| --- | --- |
| `database/prisma.integration.test.ts` | unique email, Avatar cascade delete, Inventory FKs, RoomFurniture cascade, FishCatch FK, 25+ tables present, seeded default rooms |
| `integration/auth.integration.test.ts` | register 201 with invite, used code rejected, duplicate email 409, verify-email 200, login + httpOnly refresh cookie, wrong password 401, unverified 403, refresh rotation, invalid refresh 401, logout clears cookie |
| `integration/socketio.integration.test.ts` | `connect_error AUTH_REQUIRED`, JWT connect, `room:state`, `player:move` broadcast, `chat:message` broadcast, profanity handling, `room:player_left`, bidirectional position sync |
| `integration/fishing.integration.test.ts` | `FISH_BITE`, `TENSION_UPDATE` stream, coin award + catch persistence, `FISH_ESCAPED`, cancel, weekly leaderboard |
| `integration/loft.integration.test.ts` | public entry, friends-only deny/allow, password lofts, doorbell queue in Redis, owner admit/deny, co-decorator rights |
| `security/security.integration.test.ts` | CSRF double-submit (missing + mismatched), JWT alg pinning (`alg:none` rejected), XSS sanitization (chat + username), DB-role-beats-JWT-claim for admin, economy exploits (negative/zero/self/over-balance), atomic transfer + audit log, 500-coin weekly cap |

### 5.3 Client unit (`apps/client`, Vitest + jsdom + Babylon `NullEngine`)

| File | Suites cover |
| --- | --- |
| `__tests__/scene/roomScene.test.ts` | NullEngine render with no WebGL, camera iso offset, light setup + mood presets, EXP2 fog, ground physics, NavMesh, pet NPC state machine, clean dispose |
| `src/audio/__tests__/audioEngine.test.ts` | AudioContext/masterGain init, volume clamp, mute restore, footstep/coin/chat synths, mute silences synths, procedural SFX set |
| `src/game/__tests__/avatarController.test.ts` | spawn mesh, moveTo rotation/ticks/arrival, social anim, customization colors, morph targets, dispose, outfit layer tinting + gender proportions |
| `src/game/__tests__/furnitureManager.test.ts` | placement coords, instancing reuse, ownership tagging, removal, clear, rotation/scale, raycast picking |
| `src/game/__tests__/roomLoader.test.ts` | GLB parse, NavMesh/Collision invisibility + tagging, Walkable/Floor tagging, unpickable geometry, unload disposal |
| `src/services/__tests__/authService.test.ts` | token in memory not localStorage, failure path, silent refresh, logout, 60 s expiry skew |
| `src/services/__tests__/socketService.test.ts` | auth on connect, no-token throws, backoff reconnect, pre-connect emit queue, on/off, 5 s WELCOME timeout |
| `src/ui/__tests__/chatOverlay.test.ts` | render, send/Enter, empty-message guard, incoming render, cooldown UI, 50-message FIFO, XSS escaping |
| `src/ui/__tests__/wardrobe.test.ts` | `normalizeGender`, `applyGenderPreset`, `getItemAccentColor`, `groupWardrobeItems` |
| `src/game/__tests__/audioEngine.test.ts`, `src/game/__tests__/roomScene.test.ts` | older duplicate copies of the audio/scene specs above |

### 5.4 E2E (`e2e`, Playwright, Chromium; 22 tests across 10 specs)

| Spec | Tests | Needs | Status |
| --- | --- | --- | --- |
| `fullFlow.spec.ts` | 1 | local server+client, `NODE_ENV=test` (uses `/api/test/verify-email`) | ready, not yet run |
| `multiplayer.spec.ts` | 1 | two browser contexts | ready, not yet run |
| `avatarCustomizer.spec.ts` | 1 | local stack | ready, not yet run |
| `accessibility/a11y.spec.ts` | 5 | axe, local stack | ready, not yet run |
| `mobile/mobile.spec.ts` | 4 | touch emulation | ready, not yet run |
| `performance/perf.spec.ts` | 3 | local stack, timing thresholds | ready, not yet run |
| `visual/rooms.spec.ts` | 3 | committed snapshots | ready, not yet run |
| `live-prod-login.spec.ts` | 2 | prod site + **real credentials** | ⚠️ see below |
| `live-comprehensive-audit.spec.ts` | 1 | prod site + `testalpha@havenworld.dev` | ⚠️ see below |
| `live-deep-workflow.spec.ts` | 1 | prod site + same account | ⚠️ see below |

> ⚠️ **The three `live-*` specs hardcode a demo account** (`testalpha@havenworld.dev` /
> `HavenAlpha2026!` — a plaintext password committed in `e2e/live-comprehensive-audit.spec.ts:32`).
> That account does not exist in `public.users`, so these tests cannot pass today, and any run of them
> points at the **live** site. Treat the password as burned — never reuse it for a real account, and
> replace the literals with `process.env.E2E_EMAIL` / `E2E_PASSWORD`.

### 5.5 L4 findings — 2026-09-23 (three defects found, two fixed)

Before today `npx playwright test` / `make test-e2e` could not run **at all**. Three independent
defects, all now understood:

1. **FIXED — the API never listened under `NODE_ENV=test`.** `src/index.ts` called `start()` only when
   `NODE_ENV !== 'test'` (Jest imports `app` and wraps it in its own server), while
   `playwright.config.ts` started the API *with* `NODE_ENV=test`. Symptom:
   `Error: Timed out waiting 60000ms from config.webServer`, with the child logging just the
   `dotenv` banner before exiting. `.github/workflows/e2e.yml` carried the identical flaw. Fix: an
   explicit `SERVER_AUTOSTART=true` opt-in — Jest behaviour is byte-for-byte unchanged.
2. **FIXED — empty item catalogue in fresh environments.** `items` = **0** locally (22 on
   production). `POST /api/auth/register` calls `inventoryService.grantDefaultItems()` *after* the
   user/avatar/room transaction commits, and that insert has an FK to `items`, so with no catalogue
   the client receives **500 INTERNAL_SERVER_ERROR while the account already exists** — a ghost
   account that then 409s on retry (probed and confirmed). Fix: the idempotent `prisma/seed.ts` now
   runs in `make push-schema` and in `e2e.yml`; after seeding, `register` → **201 in 0.34 s**. This also
   exposed a latent fixture bug: `__tests__/helpers/dbHelpers.ts` upserted items **by `name`** while
   hard-coding `id`s, so once the catalogue existed it tried to INSERT duplicates and Jest's
   globalSetup died on `Unique constraint failed on the fields: (id)`. Those lookups now use the
   primary key, so seeding and the Jest fixtures coexist.
3. **FIXED — `/api/test/*` was reachable whenever `NODE_ENV=test`, whatever the database.** The only
   barrier between Playwright's `globalSetup` and a production `deleteMany` was one env var. Fix:
   `testRoutes.ts` additionally requires `DATABASE_URL` to contain `_test`. Verified: `/api/test/reset`
   → **200** on `havenworld_test`, → **403** on `havenworld_dev`.

Also confirmed: `apps/server/.env` sets `ALPHA_INVITE_ONLY=true` (the VM has `false`), so `register`
answers **403 `INVITE_REQUIRED`** on a local run unless `ALPHA_INVITE_ONLY=false` is exported or a
seeded invite code is supplied.

**STILL OPEN** — with the harness repaired, `fullFlow.spec.ts` reaches `POST /api/auth/register` and
then hangs: the Playwright trace records the request with `"time": -1` (never completed), the button
sits on "Please wait…" and no account is created, while the *same* request via `curl` against a
manually started server returns **201 in 0.34 s** (verified for both `tsx src/index.ts` and
`pnpm --filter server dev`). The handler's first log line
(`[Auth] RESEND_API_KEY/EMAIL_FROM not set…`) does appear in Playwright's `[WebServer]` output, so the
route is entered and the stall happens after it. Next diagnostic steps: enable Prisma query logging,
watch `pg_stat_activity` for lock waits during a run, and try `NO_SERVER=1` with manually started
API+Vite to determine whether this is specific to Playwright-managed `webServer` stdio.

---

## 6. Execution recipes

All recipes assume `cd /Users/danielstevens/Developer/HavenWorld` and a running Docker stack
(`docker compose -f docker-compose.dev.yml up -d`).

### 6.1 L1 + L2 — server suites (safe form)

Do **not** use `make test-server` (§3 L1). Run:

```bash
export LOCAL_TEST="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"

# one-time / after schema.prisma edits — local only
DATABASE_URL="$LOCAL_TEST" pnpm --filter server exec prisma db push --accept-data-loss --skip-generate

# unit project (no DB)
cd apps/server && DATABASE_URL="$LOCAL_TEST" pnpm exec jest --config jest.config.ts --selectProjects unit --runInBand

# integration project (local PG + Redis)
cd apps/server && DATABASE_URL="$LOCAL_TEST" pnpm exec jest --config jest.config.ts --selectProjects integration --runInBand

# both projects
cd apps/server && DATABASE_URL="$LOCAL_TEST" pnpm test
```

The suite self-guards: `tests/jest.globalSetup.ts:8` throws unless `DATABASE_URL` contains `_test`.
`globalTeardown` cleans the test database afterwards.

### 6.2 L4 — E2E against the local stack (safe form)

```bash
export DATABASE_URL="postgresql://postgres:devpassword123@127.0.0.1:5432/havenworld_test"
export REDIS_URL="redis://127.0.0.1:6379/1"
export NODE_ENV=test

# Playwright starts the API on :3000 and the client on :5173 itself, and globalSetup
# POSTs /api/test/reset — which now hits the LOCAL database because DATABASE_URL is exported.
npx playwright test e2e/fullFlow.spec.ts e2e/multiplayer.spec.ts e2e/avatarCustomizer.spec.ts --project=chromium

# the rest of the local specs
npx playwright test e2e/accessibility e2e/mobile e2e/performance e2e/visual --project=chromium
```

Reports: `playwright-report/index.html`; traces/screenshots/video are retained on failure.

### 6.3 L4 — live specs against production

```bash
# BASE_URL containing "pages.dev" disables webServer + globalSetup in playwright.config.ts:21-22
BASE_URL=https://havenworld-game.pages.dev npx playwright test e2e/live-prod-login.spec.ts --project=chromium
```

Requires real credentials in the spec (currently hardcoded placeholders, §5.4) — expected to fail
until an alpha test account is seeded. **Never** let these run with `globalSetup` enabled: the reset
route would target whatever `DATABASE_URL` the spawned server resolves to.

### 6.4 Coverage

```bash
cd apps/server && DATABASE_URL="$LOCAL_TEST" pnpm test:coverage
pnpm --filter client test:coverage
```

Thresholds enforced by `apps/server/jest.config.ts`:

| Scope | Branches | Functions | Lines | Statements |
| --- | --- | --- | --- | --- |
| global | 20 % | 25 % | 45 % | 45 % |
| `InventoryService.ts` | — | — | 80 % | 80 % |
| `ModerationService.ts` | — | — | 80 % | 80 % |
| `RoomManager.ts` | — | — | 85 % | 85 % |
| `FishingService.ts` | — | — | 85 % | 85 % |

### 6.5 L7 — load (k6, installed locally)

```bash
k6 run load-tests/api-auth.js        # HTTP auth + room API throughput
k6 run load-tests/ws-concurrent.js   # concurrent Socket.io sessions
k6 run load-tests/fishing-concurrent.js
# or on the VM:  scripts/run-load-tests.sh  (make load-test)
```

⚠️ These hit whatever `BASE_URL`/host they are pointed at — confirm it is not production, or run them
against the VM during a maintenance window, before executing.

### 6.6 L6 — live smoke (read-only + one throwaway account)

```bash
curl -s https://147-224-184-148.nip.io/health | python3 -m json.tool
curl -sI https://147-224-184-148.nip.io/health | grep -iE 'strict-transport|x-frame|content-security'
./scripts/beta-gate-check.sh          # 18 checks, exits non-zero on any FAIL
```

Register/login smoke (creates and then deletes one account — clean up after!):

```bash
U="smoke_$RANDOM"; A="https://147-224-184-148.nip.io"
curl -sk -X POST "$A/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"email\":\"$U@example.com\",\"password\":\"Check1234\"}"
curl -sk -X POST "$A/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U\",\"password\":\"Check1234\"}"
# then: DELETE the row from public.users (rooms/refresh_tokens first) — see runbook §6
```

---

## 7. Manual alpha QA checklist

Automated suites do not cover feel, layout, or economy progression. Run this pass on
`https://havenworld-game.pages.dev` against the live API after each deploy, logged in as the admin
account (or a fresh invite-code account).

**A. Onboarding & auth**
- [ ] Register with an invite code → lands in game without email verification
- [ ] Register with a used/absent code → clear error, no partial account created
- [ ] Duplicate email and duplicate username → 409 with an understandable message
- [ ] Log out → refresh cookie cleared; reload → login screen, no cached avatar
- [ ] Wrong password → 401, no session; browser refresh keeps you logged in (silent refresh)
- [ ] Password rules enforced client-side: 8+ chars, one uppercase, one digit

**B. Avatar & wardrobe**
- [ ] Customizer applies skin/hair/body changes and rebuilds the avatar without reload
- [ ] Outfit changes colour and layer correctly; unequipped layers hidden
- [ ] Gender switch reshapes proportions without losing chosen hair
- [ ] Changes persist across logout/login

**C. Rooms & navigation**
- [ ] Personal loft spawns you in front of your door; lobby/park/other rooms reachable
- [ ] Room-nav shows correct occupancy; leaving a room frees the slot
- [ ] Fog/mood lighting changes per room preset
- [ ] `W`/click-to-move pathing avoids walls and furniture; no clipping
- [ ] Two browsers: both players see each other move, with name tags, no rubber-banding

**D. Furniture & loft privacy**
- [ ] Place, rotate, move, remove furniture; changes visible to a second client
- [ ] Furniture cannot be placed outside bounds or inside walls
- [ ] Friends-only loft blocks a non-friend; password loft validates the password
- [ ] Locked loft doorbell queues a knock and the owner's admit/deny works
- [ ] Co-decorator can place furniture; a stranger cannot

**E. Economy, shop, inventory, crafting**
- [ ] Buy from the shop → coins debit, item appears in inventory, balance persists on reload
- [ ] Insufficient funds → blocked with a message, no negative balance
- [ ] Craft with sufficient materials → queue entry, timer, claim adds the item
- [ ] Craft with insufficient materials → refused, materials untouched
- [ ] Cannot claim a craft before the timer completes

**F. Fishing**
- [ ] Cast → bite → tension meter; reeling keeps tension in the green
- [ ] Successful catch awards coins and updates the weekly leaderboard
- [ ] Tension drained → fish escapes, no reward; cancel mid-session works

**G. Social, trade, clubs, quests**
- [ ] Friend request / accept / remove; friends list matches on both clients
- [ ] Trade: too-far and self-trade refused; both lock → swap executes; cancel transfers nothing
- [ ] Chat: 200-char limit, profanity blocked, rate limit after 5 messages in 3 s, mute works
- [ ] Club create/join/leave; quest and daily-streak rewards pay once per period

**H. Client polish**
- [ ] Audio: footsteps, coin, chat blips; volume slider clamps; mute silences everything
- [ ] Mobile viewport (≤ 428 px): controls reachable, no overflow, rotation safe
- [ ] Keyboard accessibility: focus visible, chat reachable by keyboard, axe reports no critical issues
- [ ] No uncaught console errors during a 10-minute session; frame rate smooth in the busiest room

**I. Ops & admin**
- [ ] `/health` reports `status ok`, `redis connected`, sane heap and socket count
- [ ] Invite codes can be minted and consumed exactly once
- [ ] Admin endpoints reject a non-admin token even if the JWT claims `ADMIN`
- [ ] `pm2 logs` shows no repeated errors during the whole pass

## 8. Alpha → Beta exit criteria

| # | Criterion | Current |
| --- | --- | --- |
| 1 | L0–L3 green (typecheck + 186 tests) | ✅ met today |
| 2 | `beta-gate-check.sh` reports GO | ✅ met today (16/0/2) |
| 3 | Local E2E `fullFlow` + `multiplayer` pass | ⛔ not yet run |
| 4 | Manual checklist §7 A–I passes with no blockers | ⛔ not yet run |
| 5 | No P1/P2 defects open from the manual pass | ⛔ |
| 6 | Invite codes minted and the wall re-armed (`ALPHA_INVITE_ONLY=true`) | ⛔ gate still open |
| 7 | Password reset path exists (email provider or admin reset) | ⛔ gap §9.1 |

Recommended order: seed a couple of alpha accounts → run §6.2 local E2E → run §7 → fix what it
finds → mint invites → flip the gate.

## 9. Known gaps & risks (priority order)

1. **No password reset or change route exists**, and no email provider is configured. With
   `RESEND_API_KEY` unset there is no recovery path at all — if the single admin account's password is
   lost, access is lost. Add `POST /api/auth/change-password` (authenticated) plus a token reset once
   Resend is live (already listed in runbook §8).
2. **§3 L1 / L2 landmines** — both make test commands mutate production. Fix the `push-schema` target,
   teach `index.ts` to load `.env.test` when `NODE_ENV=test`, and add the `_test` guard to
   `testRoutes.ts`.
3. **Demo credentials committed** in `e2e/live-comprehensive-audit.spec.ts:32` and
   `live-deep-workflow.spec.ts`. The referenced account does not exist; treat the password as burned
   and move both to env vars.
4. **Root `.env.test` is empty** while `playwright.config.ts` loads it — silent misconfiguration that
   decides whether Playwright manages servers itself or ignores an existing deployment.
5. **Visual / perf / a11y E2E specs have never been baselined** here; expect first-run noise
   (snapshot creation, timing thresholds on a laptop).
6. **Coverage floor is low** (20 % branches / 45 % lines globally). Services with real money and state
   logic (`ShopService`, `ClubService`, `QuestService`, `PetManager`, `SeasonalEventService`) have no
   dedicated suites yet.
7. **Sentry is inert** without `SENTRY_DSN`, and **GitHub Actions is disabled** at the account level,
   so nothing runs these suites automatically — this plan is manual by nature until CI returns.
8. **k6 load gate has not been executed** against either environment.
9. **The E2E `register()` helper never asserts success** — `LoginPage.register()` only clicks submit
   (`e2e/pages/LoginPage.ts:66`), so the spec races ahead to `verify-email` and reports a confusing
   404 instead of "registration failed". `fullFlow.spec.ts` also never supplies an invite code, so it
   cannot pass while the local gate is closed.
10. **Token storage is inconsistent** — `authService.register()` writes `haven_token` to
    `localStorage` (`apps/client/src/services/authService.ts:152`) although `authService.test.ts`
    asserts tokens live in memory only. Align before beta (localStorage is readable by any XSS).
11. **Local `apps/server/.env` is production-shaped** (Supabase pooler + `ALPHA_INVITE_ONLY=true`)
    while `.env.test` holds the local URLs. This split is what makes the crash-only cleanup of §3
    landmines so tempting — the durable fix is a single `.env.development` for local work.

## 10. Cadence

| When | Run |
| --- | --- |
| Every commit touching `apps/server` | §6.1 (unit + integration) |
| Every commit touching `apps/client` | `pnpm --filter client test` |
| Every commit touching shared game logic | §6.1 + §6.4 coverage |
| Before any `make deploy-server` | L0–L3 + §6.2 local E2E |
| After every deploy | §6.6 live smoke + §7 spot-check of the changed system |
| Weekly during alpha | Full §7 pass + §6.4 coverage |
| Before flipping the invite wall | §8 exit criteria |
| Before a marketing push | §6.5 load tests |





