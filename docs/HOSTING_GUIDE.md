# HavenWorld — Hosting & Operations (Oracle Cloud Linux server)

> **Runtime: PM2 on port 3000, fronted by a Cloudflare quick tunnel.**
> This supersedes the earlier tmux / port-3999 arrangement — see §8 Legacy.

## 1. What runs where

| Thing | Value |
| --- | --- |
| Repository | `/home/ubuntu/Developer/HavenWorld` |
| Process manager | PM2 (apps: `havenworld`, `havenworld-tunnel`) |
| App port | `3000` (not exposed publicly — tunnel is outbound-only) |
| Public edge | `cloudflared` quick tunnel, `--protocol http2` (Safari-safe) |
| Tunnel URL log | `/home/ubuntu/havenworld-tunnel.log` |
| App logs | `logs/pm2-out.log`, `logs/pm2-error.log` |
| Node runtime | `/home/ubuntu/.hermes/node/bin/node` (v24, native TypeScript) |
| Process definitions | `deploy/ecosystem.config.cjs` |

## 2. Everyday commands

```bash
pm2 status                                  # both apps should read "online"
pm2 logs havenworld --lines 30              # expect the 🚀 banner + Supabase line
curl -sI http://127.0.0.1:3000 | head -1    # expect HTTP/1.1 200 OK
pm2 restart havenworld                      # bounce just the game server

# Current public URL + WSS endpoint:
URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /home/ubuntu/havenworld-tunnel.log | tail -1)
echo "$URL"; echo "${URL/https:/wss:}"
```

A quick end-to-end health check (HTTP status + `INIT_STATE` over both
transports when given the tunnel URL):

```bash
node scripts/verify-server.mjs          # local HTTP + WS only
node scripts/verify-server.mjs "$URL"   # also checks wss:// through the tunnel
```

## 3. Deploying new code

The Linux host is a **deployment target** — application code is authored on the
macOS workstation and pushed to `origin/main`. To deploy:

```bash
cd /home/ubuntu/Developer/HavenWorld && ./deploy/deploy.sh
```

That script performs: `git fetch` + `git reset --hard origin/main` → `npm ci`
→ `npm run build:web` (Vite → `dist/`) → `pm2 startOrReload` → `pm2 save`.

> ⚠️ `deploy.sh` runs `git reset --hard`, so **never leave uncommitted changes**
> in this checkout — they will be discarded on the next deploy.

## 4. Surviving reboots

```bash
sudo env PATH=$PATH:/home/ubuntu/.hermes/node/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu  # one-time
pm2 save                                                                                          # after any change
```

`pm2-ubuntu.service` is enabled, so both the server and the tunnel come back
after a reboot.

## 5. Firewall

```bash
sudo ufw status verbose
```

Policy: `deny (incoming)`, `allow (outgoing)`, only `22/tcp` allowed in.
Port 3000 is intentionally **not** public — Cloudflare terminates the public
traffic and reaches the server over the tunnel's outbound connection.

## 6. Tunnel options

1. **Quick tunnel** (currently in use) — `cloudflared tunnel --url http://localhost:3000 --protocol http2`
   - Free, no account. URL changes on every restart (read it from the log).
   - No uptime guarantee under Cloudflare's terms of service.
2. **Named tunnel** (recommended for production) — needs a Cloudflare account/domain:
    ```bash
    cloudflared tunnel login
    cloudflared tunnel create havenworld-prod
    cloudflared tunnel route dns havenworld-prod play.havenworld.game
    sudo cloudflared service install <TUNNEL_TOKEN>
    ```
    Until then, treat the quick-tunnel URL as ephemeral: `deploy/ecosystem.config.cjs`
    logs it to `/home/ubuntu/havenworld-tunnel.log`, `scripts/verify-server.mjs`
    accepts it as an argument for public-edge checks, and the browser E2E tests
    auto-discover it (tunnel-gated assertions skip when no tunnel is configured).

## 7. Known issues / outstanding work

- **Client is broken upstream [FIXED on macOS 2026-09-16, pending deploy]:**
  `src/client/game.js` assigned `authToken` (lines ~109, 1012, 1045) without
  declaring it, so the ES module threw `ReferenceError: authToken is not
  defined` at load and the render loop never started (blank canvas). Fixed by
  declaring `let authToken = null;` alongside the other state variables
  (commit in this push). Takes effect on the server after `./deploy/deploy.sh`
  rebuilds `dist/`.
- **Supabase schema drift (BLOCKED — needs Dashboard action):** the live
  project is missing `profiles.password_hash`, `placed_furniture.elevation`,
  and the `user_friends` + `messages` tables, so account auth, loft furniture
  load, friends and private messaging fail in Supabase mode. Verified from
  this Mac on 2026-09-16 via the JS client (PostgREST schema-cache probes):
  all four objects still report missing. They **cannot be fixed from code or
  from the server host** — the anon/publishable + service_role keys authorize
  PostgREST data access only; there is no `exec_sql` RPC and no psql/
  direct-Postgres path available, so DDL is impossible without the database
  password. Apply `supabase/migrations/20260916_add_missing_schema.sql` via
  Supabase Dashboard → SQL Editor (query is idempotent/additive-only).
  **Do not re-run `supabase/schema.sql`** — it opens with `DROP TABLE …
  CASCADE` and would destroy player data. Until applied, the Mac workstation
  can reproduce Supabase-mode behavior only against the drifted schema, and
  the browser E2E `test:browser` specs pin the local-SQLite contract.
- **`SUPABASE_SERVICE_ROLE_KEY` is now present on the macOS workstation `.env`**
  (verified 2026-09-16: `scripts/migrate-supabase.mjs` reports
  `service_role (Secret Admin Key)` and connects). It is **not yet in the
  Linux `~/.env`** — `docs/PLAN_LINUX_SERVER_AGENT.md` Step 3 still only
  writes the anon/publishable keys. Add the same
  `SUPABASE_SERVICE_ROLE_KEY=…` line to `/home/ubuntu/.../.env`
  (`chmod 600`) and `pm2 restart havenworld`, then tighten the permissive
  `USING (true)` RLS policies. The key authorizes PostgREST data access only
  — it does **not** enable DDL, so it does not unblock the schema-drift item
  above.
- `pm2`/`cloudflared` are user-scoped (`ubuntu`); the systemd app-user matters if
  you switch to a service account.
- **Vulnerabilities — triaged 2026-09-16, no action taken (all require
  breaking `--force` upgrades):** `npm audit` on the Mac reports 4 vulns
  (3 high, 1 moderate) confined to **dev-only desktop/build tooling** —
  `electron` 32.3.3 (fix = 44.4.1 breaking), `esbuild` → `vite` 5.4.21
  (fix = vite 8.3.0 breaking), `extract-zip` via electron (same breaking
  bump). None touch the production server path (`express`, `ws`,
  `@supabase/supabase-js`, `dotenv`). The "38 vulnerabilities (10 high)"
  figure is the GitHub Dependabot count against the default branch (it
  scans lockfile + actions and counts transitives differently); do not
  `npm audit fix --force` blindly — schedule the electron 32→44 and vite
  5→8 major bumps as their own tested upgrades.

## 8. Legacy configuration (retired)

These are no longer used and were replaced by the PM2 setup above:

| Legacy | Status |
| --- | --- |
| `miniworld.service` + `miniworld-tunnel.service` (systemd, port 3000, `/home/ubuntu/miniworld`) | stopped **and disabled** |
| `~/.hermes/haven-reconnect.sh`, `~/.hermes/haven-tunnel-url.sh` (tmux + port **3999**) | superseded; `tmux` is not installed on this host |
| `start-havenworld.sh` (untracked, in repo root) | superseded by `deploy/ecosystem.config.cjs` |

The old MiniWorld checkout and unit files are still on disk, so the previous
setup can be restored with `sudo systemctl enable --now miniworld.service
miniworld-tunnel.service` (after stopping PM2's `havenworld` to free port 3000).

## 9. Preventing SSH disconnects

```sshconfig
Host havenworld-server
    HostName <server-ip>
    User ubuntu
    ServerAliveInterval 60
    ServerAliveCountMax 3
    LogLevel ERROR
```
