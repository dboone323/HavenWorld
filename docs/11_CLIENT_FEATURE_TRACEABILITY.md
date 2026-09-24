# HavenWorld Client Feature Traceability

Last verified: 2026-09-24 against commit `6a4210b`.

This file separates **implemented code**, **reachable client UI**, and **automated browser proof**.
`PLAN.md` is a historical mixed-architecture plan and must not be read as proof that all 103 items
are production-visible.

## Current architecture

- Client: Babylon.js + Vite + TypeScript, deployed to Cloudflare Pages.
- API: Express + Socket.IO + Prisma.
- Database: Supabase PostgreSQL; local Redis is used for ephemeral/socket state.
- Production client: `https://havenworld-game.pages.dev`.
- Production API: `https://147-224-184-148.nip.io`.

## Recently repaired flows

| Flow | Client entry point | What changed | Visibility condition | Browser proof |
|---|---|---|---|---|
| Remote avatar color | `RoomScene.ts` → `RemoteAvatar.ts` | Reads canonical `avatarData.skinTone`, with `skinColor` fallback | Two users in the same room; effect is a color correction, not a new UI | `multiplayer.spec.ts` asserts `remote_body_*` meshes appear and are disposed |
| Room mood | Loft Settings → Ambient Mood | Emits `room:set_mood`; client applies lighting via `MoodSystem` and listens for `room:mood_changed` | Owner in personal loft; lighting transitions over two seconds | `loftEditing.spec.ts` asserts Babylon ambient light changes |
| Fishing | Haven Park → fishing dock / `#btn-fishing` | Correct timeout/error/session teardown; slider events throttled to 10 Hz | Button intentionally hidden in personal loft | `travelDirectory.spec.ts` opens HUD, observes status, cancels |
| Pizza Chef | Main HUD dock → Pizza Chef | Interactive ingredient tray, order validation, timer, clear/serve flow | Available from main dock | `hudInteractions.spec.ts` selects dough and clears crust |
| Daily quests | Top-right `📜 Daily Quests` HUD | Loads after login, explicit loading/ready/error/empty states, retry on failure | HUD is collapsed by default | `hudInteractions.spec.ts` expands it and requires real progress rows or a valid empty state |
| Gallery | Main HUD dock → Gallery | Snapshot downscales/compresses below API body limit; inline caption replaces `prompt()` | Canvas must be renderable | `hudInteractions.spec.ts` publishes a real snapshot and requires a rendered card |
| Crafting | Main HUD dock → Workshop | Loads recipes/materials, maps material keys, waits for server confirmation, handles insufficient materials | Available from main dock | `hudInteractions.spec.ts` requires loaded recipe controls; server suites verify transactions |
| Guestbook | Click the guestbook mesh in-world | Added client overlay with page/sign/delete states | No dock button; requires finding/clicking the in-world object | Guestbook unit suite covers socket-driven UI; no production E2E yet |
| PWA updates | `/sw.js` | Cache stamped per Git commit; installing worker receives `SKIP_WAITING` | Requires a new page load; installed PWA may need removal if browser retains old worker | `resilience.spec.ts` covers offline shell; deployment verification checks cache ID |
| Socket resilience | Active `services/socket.ts` | Fresh function-form auth on reconnect, queued emits, listener registry, connection banner | Visible after transport failure/exhausted retries | `resilience.spec.ts` covers failure, banner, and manual recovery |

## What the broad roadmap does and does not prove

A green server integration test proves the service and database rules. It does **not** prove:

- a Babylon control exists for the feature;
- the control is visible in the room type where the feature applies;
- the event name used by the client matches the server;
- the resulting state is visible in the browser.

Examples of partial/reachable differences:

- Many `PLAN.md` entries describe legacy `src/client`, Canvas 2D, SQLite, or Phaser paths.
- Server services for NPC dialogue, transit, bulletin boards, whiteboards, weather, and secret rooms
  may have automated tests without a current Babylon control that exposes them to players.
- “Live and verified” in the old dashboard should be read historically until a current client
  entry point and browser assertion are listed here.

## Current test baseline

- TypeScript: client and server clean.
- Server Jest: 22 suites / 171 tests.
- Client Vitest: 16 files / 118 tests.
- Local Chromium E2E: 26 passed / 1 skipped / 0 failed before the traceability assertions were
  added; rerun results are recorded in `docs/10_TEST_PLAN.md` after each change.
- Production gate: 16 passed / 0 failed / 2 Mac-only VM checks skipped.

## Manual visibility checklist

1. Register/login with an invite account.
2. Expand **Daily Quests** at top right.
3. In Haven Park, use the fishing dock; do not look for fishing in a personal loft.
4. Open Gallery and publish a snapshot; verify its card appears.
5. Open Workshop and verify recipes load; material balances may be zero for a new account.
6. Open Loft Settings and apply Midnight; the room lighting should transition within two seconds.
7. For remote avatars, use two accounts in the same room and verify each sees one remote body,
   name tag, and movement; after one disconnects, its meshes should disappear.
8. Guestbook requires clicking the physical guestbook object; it is not a dock button.

## Remaining documentation work

- Split the 103-item `PLAN.md` into implemented-server, implemented-client, partial, and backlog.
- Add production-browser checks for guestbook and a true two-user visual avatar inspection.
- Add direct coverage for economy, shop, friend, trade, and crafting claims before calling them
  production-verified.
- Keep `docs/10_TEST_PLAN.md` as the source of truth for test counts and live gaps.
