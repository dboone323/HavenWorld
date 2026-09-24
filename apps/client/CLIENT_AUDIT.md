# Client-Side Audit: Babylon.js scene, WebSocket resilience, PWA manifest

> **Historical audit baseline.** Findings below describe the client before the resilience work in
> commit `e5859e4` and the PWA update fix in `6a4210b`. Treat “NO fallback” and similar statements
> as superseded unless the section explicitly says “still current.” Current verification lives in
> `docs/10_TEST_PLAN.md` and `docs/11_CLIENT_FEATURE_TRACEABILITY.md`.

Scope: `apps/client/src/` (Vite + TypeScript + Babylon.js + Alpine.js SPA), plus `apps/client/public/`, `apps/client/index.html`, and `e2e/` + `playwright.config.ts`.

Legend: paths are relative to the repo root unless prefixed `apps/client/`.

---

## 0. Two socket implementations exist (important context)

There are **two** socket wrappers in the codebase:

- `apps/client/src/services/socket.ts` — **ACTIVE**. Imported by 15 files (`main.ts:14`,
  `scenes/RoomScene.ts:28`, `ui/EmoteWheel.ts:1`, `world/AvatarController.ts:5`, etc.).
- `apps/client/src/services/socketService.ts` — **DEAD CODE**. The `SocketService` class is
  not imported anywhere in the app. It contains the *better* resilience design
  (exponential backoff + event queue + connect timeout) but is never wired up.

This matters for every finding below: the resilience logic actually running in production
lives in `socket.ts`; `socketService.ts` is a usable but unused reference implementation.

---

## 1. Babylon.js engine initialization — WebGL unavailability fallback

**Result: NO fallback. An unavailable WebGL context throws at engine construction
and the app hard-crashes.**

`engine/HavenEngine.ts:13-19` — the private constructor builds the engine unguarded:

```ts
this._engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  disableWebGL2Support: false,   // ← forces WebGL2, no degraded path
});
```

- There is **no `Engine.IsSupported()` / `isWebGLSupported()` guard** before construction.
  If WebGL is unavailable (software-only host, blocked policy, or the user disabled it),
  `new Engine(...)` throws synchronously and the page breaks.
- `main.ts:29-43` calls `HavenEngine.getInstance(canvas)` (which internally runs the
  constructor and `_initPhysics()`) with **no try/catch**. `main.ts:43` has a single
  `.catch`? No — it is an un-awaited top-level `await` inside the `DOMContentLoaded`
  callback with no error boundary; a rejection is unhandled.
- There is **no `webglcontextlost` / `webglcontextrestored` handler** registered on the
  canvas, so a mid-session GPU reset kills rendering with no recovery.

One resilience gap is mitigated: **Havok physics is guarded**. `HavenEngine.ts:68-77`
wraps `HavokPhysics()` in try/catch and logs `Haven physics failed to load. Physics disabled.`
on failure. So missing WASM = degraded-but-running; missing WebGL = hard crash.

`@babylonjs/core`'s `Engine.IsSupported()` is available and would let the startup path
degrade gracefully; it is not used.

---

## 2. WebSocket / Socket.io connection resilience

**Result: The active path has bounded reconnect but no backoff ramp, no max-retries
recovery UX, and no token-expiry re-auth wiring. A dead-code alternative with proper
exponential backoff + event queuing exists but is unused.**

The **active** wrapper `services/socket.ts:21-54`:

- `socket.ts:30-40` — connects with `transports: ['websocket','polling']`,
  `reconnection: true`, `reconstructionAttempts: 10`,
  `reconnectionDelay: 1000`, `reconstructionDelayMax: 15_000`.
  - 10 attempts is a hard cap. After exhaustion, socket.io **stops reconnecting**.
- `socket.ts:42-52` — `connect`, `disconnect`, `connect_error` all **only `console.*.log`**.
  There is **no state exposed to the UI** (e.g. `isReconnecting`, attempt count) and
  **no user-facing reconnect banner / retry button**.
- socket.io's built-in backoff ramps incrementally between `reconnectionDelay` and
  `reconnectionDelayMax`, but the client sets neither a custom exponential factor nor
  jitter, so under load it falls back to socket.io's defaults — acceptable but not tuned.
- The auth token is sent **once** at handshake: `socket.ts:38`
  `auth: { token: authService.token ?? '' }`.
- `socket.ts:427` (RoomScene) calls `socketService.connect()` but the token is captured at
  connection time. `socket.ts:84-89` defines `updateAuth()` to refresh the token, but a
  **`grep` shows `updateAuth` is never called** from anywhere in `src/` — so a token
  refresh mid-session is not re-acknowledged to the server (socket.io supports
  `auth` re-issuance on `reconnect`, but no listener re-runs `updateAuth`).

The **dead-code** class `services/socketService.ts` is the stronger design:

- `socketService.ts:60-74` — manual **exponential backoff** (`1000 * 2^(attempts-1)`),
  `reconnectAttempts` counter, clears stale timers.
- `socketService.ts:17,109-117` — **event queue** (`queuedEvents`) flushed on `connect`.
- `socketService.ts:93-96` — 5 s connect timeout that rejects with `Connection timeout`.
- `socketService.ts:86` — `auth.token` set before `connect()`, re-issuable.

…but it is **not imported** by `main.ts`, `RoomScene.ts`, or any scene. The app uses the
`socket.ts` object instead.

Bottom line: resilience is "present but capped and silent". After 10 failed attempts the
user is stranded with no UI affordance to recover except a hard reload. There is no
visibility into reconnect state and no token-refresh re-auth.

---

## 3. PWA manifest

**Result: Present and correct — but under the `.webmanifest` extension the task guessed.**

- File: `apps/client/public/manifest.webmanifest` (the task speculated
  `apps/client/public/manifest.json` — no `manifest.json` exists in `public/`).
- Referenced in `index.html:8`:
  `<link rel="manifest" href="/manifest.webmanifest" />`.
- Manifest contents (`public/manifest.webmanifest`): full — `name`, `short_name`,
  `description`, `start_url: /?source=pwa`, `scope: /`, `display: standalone` with
  `display_override` (`window-controls-overlay`, `standalone`, `browser`),
  `orientation: any`, `background_color`/`theme_color`, `lang`, and four icons
  (192, 512, maskable-512, svg) plus two shortcuts (My Loft / Haven Park).
- The SW explicitly caches it: `sw.js:19` lists `/manifest.webmanifest` in `SHELL_ASSETS`.
- iOS meta tags are present in `index.html:10-13` (`apple-mobile-web-app-*`,
  `/icons/apple-touch-icon.png`).
- Vite config has **no `vite-plugin-pwa`** / Workbox plugin — the manifest is a static
  asset in `public/` and is correct.

---

## 4. Service Worker

**Result: Hand-written, correctly scoped, sound caching strategy. Minor rough edges.**

- File: `apps/client/public/sw.js`. Served at `/sw.js` because it lives in `public/`.
- Registered in `ui/InstallPrompt.ts:57-72`:
  `navigator.serviceWorker.register('/sw.js', { scope: '/' })` — controls the entire origin.
  `navigator.serviceWorker` feature-gated (`if (!('serviceWorker' in navigator)) return;`).
- Install (`sw.js:21-28`): pre-caches `SHELL_ASSETS = ['/', '/index.html',
  '/manifest.webmanifest', '/icons/icon.svg']` into `havenworld-v1-shell`, then
  `skipWaiting()`.
- Activate (`sw.js:30-43`): deletes all caches not prefixed `havenworld-v1`, then
  `clients.claim()`.
- Fetch (`sw.js:50-87`):
  - `request.method !== 'GET'` → ignored (POST/PUT never cached).
  - `/api/` and `/socket.io/` → **bypass** (never cached, correct for live game state).
  - cross-origin → bypass.
  - `navigate` requests → **network-first** with offline fallback to cached `/index.html`
    (`sw.js:60-71`). Good: a lost-connection reload still opens the shell.
  - `/assets/*` + `/icons/*` + js/css/woff2/png/jpg/svg/webp/glb/gltf/wasm/json →
    **cache-first** (`sw.js:45-48`, `75-86`), with a stale-while-revalidate-on-network
    pattern (serves cached, then fetches to refresh).
- `message` listener (`sw.js:89-92`): honors `SKIP_WAITING`, posted by
  `InstallPrompt.ts:65` on `updatefound` when a new worker is waiting. Immediate
  activation on deploy — correct.

Issues / gaps:
- `cache.addAll(SHELL_ASSETS)` is all-or-nothing: if `/icons/icon.svg` 404s (it exists,
  so currently fine), the SW install fails. There is no per-asset fallback in the install
  handler.
- The asset cache **grows unbounded** — there is no LRU/size cap or `cacheName` rotation
  version bump beyond `havenworld-v1`. Production cache will accumulate stale assets until
  the cache-name prefix changes.
- No background sync / push subscription (not required by the task, but worth noting the
  SW has no periodic update mechanism besides `updatefound`).
- `self.location.origin` check at `sw.js:58` means a misconfigured dev proxy that rewrites
  origin could silently bypass caching — acceptable, by design.

Overall the SW is solid for the stated strategy (shell offline + immutable assets cached,
live traffic never cached).

---

## 5. Asset loading — GLB / Wasm failure from R2

**Result: Room + avatar GLB loads have graceful fallbacks; furniture loads degrade
silently (missing item, no user feedback); Wasm headers are correct.**

Asset path resolution: `config.ts:19-30` — `ASSET_BASE_URL` reads
`VITE_ASSET_BASE_URL` (R2 CDN in prod) and `assetUrl()` prefixes it while passing
absolute URLs / data URIs through unchanged. Empty in local dev (assets served from own
`/assets`).

GLB load sites (all go through `assetUrl()` then
`BABYLON.SceneLoader.ImportMeshAsync('', folder, fileName, scene)`):

- **Room GLB** — `world/RoomLoader.ts:60-76` (`assetUrl(/assets/rooms/${roomId}.glb)`).
  The caller `scenes/RoomScene.ts:143-152` wraps the await in `try/catch`:
  on failure it logs a warning and falls back to `buildRoomPrefab(scene, roomId)`
  (`world/RoomPrefabs.ts:362`) or `createPlaceholderRoom(scene)`
  (`world/PlaceholderRoom.ts`). **Good fallback** — the player still lands in a
  playable room. One flaw: the `catch` is bare (`RoomScene.ts:149` `catch {`) with no
  error parameter, so the *reason* (404 vs network vs parse) is lost to logs.
- **Avatar GLB** — `world/AvatarController.ts:57-96` wraps `base_avatar.glb` import in
  try/catch and, on failure, calls `buildPlaceholder()` (`AvatarController.ts:98-121`)
  which synthesizes a procedural capsule + head. **Good fallback.**
- **Furniture GLB** — `world/FurnitureManager.ts:59-119` (`placeItem`) wraps the import in
  try/catch (`FurnitureManager.ts:115-118`) and `return null` on failure. The furniture
  item is **silently omitted** — it won't appear, no toast, no fallback geometry.
  RoomScene `await furnitureManager.loadRoomFurniture(roomId)` (`RoomScene.ts:216`)
  does not surface per-item failures. So missing furniture GLBs degrade gracefully
  (no crash) but invisibly.
- **RoomEditor ghost/preview** — `world/RoomEditor.ts:123-151` (`startPlacement`)
  try/catch (`RoomEditor.ts:148-150`) logs and aborts; no visual fallback for the
  placement preview.

Wasm: `public/_headers` sets `Content-Type: application/wasm` for both
`/HavokPhysics.wasm` and `/HavokPhysics.js.wasm`, and COOP/COPE/CORP + ACAO headers
for `/assets/*.glb`. vite.config.ts sets COOP/COEP in dev. `optimizeDeps.exclude:
['@babylonjs/havok']` ensures the wasm module is loaded at runtime (not pre-bundled).
No explicit wasm load error handler, but the SW + `_headers` config is correct for
R2 delivery.

---

## 6. Canvas 2D fallback

**Result: None. WebGL is the only rendering path; a missing canvas or lost context
aborts the app.**

- `index.html:20` — single `<canvas id="haven-canvas">`. No `<canvas>` 2D fallback,
  no `<noscript>` content, no message element shown when canvas is absent.
- `main.ts:37-41` — if `#haven-canvas` is missing, it `console.error`s and `return`s
  (the rest of the DOM — login panel, HUD — is still usable, but **the 3D world never
  renders and there is no alternate 2D view**).
- No `webglcontextlost` listener anywhere in `engine/` or `main.ts`, so a transient GPU
  reset (common on laptops) is unrecoverable without a reload.
- Babylon's `Engine` can be constructed with a 2D canvas path only via a different
  renderer; the app never touches `Engine.IsSupported()`
  (`engine/HavenEngine.ts`), so there is no branch that would swap to a 2D fallback.

---

## 7. Cross-reference with `playwright.config.ts` + `e2e/`

**Result: Rich E2E coverage of core gameplay, but zero coverage of the resilient/PWA
paths audited above.**

`playwright.config.ts`:
- `testDir: './e2e'` (`playwright.config.ts:8`).
- `baseURL: process.env.BASE_URL || 'http://localhost:5173'` (`playwright.config.ts:24`).
- `webServer` (`playwright.config.ts:51-64`) boots BOTH the server (`PORT=3000`)
  and the client (`vite`, port 5173) via `pnpm --filter server dev` / `pnpm --filter client dev`.
  Tests can run against the live Vite dev server or a `pages.dev` prod URL
  (`globalSetup` skipped when `BASE_URL` includes `pages.dev`).
- Projects: chromium, firefox, webkit, mobile-chrome, mobile-safari
  (`playwright.config.ts:29-50`) — so mobile is covered.

Specs in `e2e/` (grep for `test(`):
- `fullFlow.spec.ts` — register → email verify → login → loft → park → chat → logout.
- `live-prod-login.spec.ts` — valid login transitions into the game; invalid creds show
  a descriptive error without crashing.
- `live-deep-workflow.spec.ts` — 1080p resolution, click-to-move, furniture
  move/rotate/save, persistence.
- `multiplayer.spec.ts` — dual presence, position sync, chat broadcast, disconnect.
- `avatarCustomizer.spec.ts` — open wardrobe, adjust avatar attributes, save + persist.
- `live-comprehensive-audit.spec.ts` — interactive walkthrough incl. canvas click tests
  (`#haven-canvas`).
- `visual/rooms.spec.ts` — visual snapshot of rooms.
- `performance/perf.spec.ts`, `accessibility/a11y.spec.ts`, `mobile/mobile.spec.ts`.

Page objects under `e2e/pages/` (`LoginPage.ts`, `LobbyPage.ts`, `RoomPage.ts`).

**What is NOT covered by any e2e spec** (confirmed by grep for
`beforeinstallprompt|manifest|sw.js|service worker|install-banner|webgl|offline|reconnect`
across `e2e/*.ts` — zero matches):
- PWA install flow / `beforeinstallprompt` / install banner.
- Manifest correctness or icon presence.
- Service-worker install/activate/offline-shell behavior / cache-first asset serving.
- WebGL unavailability → graceful degradation (no headless-fake-WebGL path).
- Socket reconnect / backoff / max-retries exhaustion / `connect_error` UI.
- GLB/WASM asset load failures (404 / CDN down) and the prefab fallback paths.

Unit tests (`src/**/__tests__/`, vitest) DO cover the fallback logic directly:
- `src/world/__tests__/roomLoader.test.ts` and `src/game/__tests__/furnitureManager.test.ts`
  use `NullEngine` to exercise asset loading without a GPU.
- `src/services/__tests__/socketService.test.ts` tests the **dead-code** class, not the
  active `socket.ts`. (The active path has no unit tests.)
- `src/__tests__/setup.ts` stubs `ResizeObserver`, `localStorage`, `matchMedia` for jsdom.

So: gameplay behaviors are well E2E'd; the resilience/PWA surface has unit coverage of
the fallback *factories* but none of the *wiring* (engine construction, SW lifecycle,
socket reconnect), and those tests target `game/` (NullEngine) rather than the live
`engine/` + `scenes/` path.

---

## 8. Findings index (file:line)

| # | Topic | File:line | Verdict |
|---|-------|-----------|---------|
| 1 | Babylon engine built with no WebGL support check | `engine/HavenEngine.ts:15-19` | Missing guard (`Engine.IsSupported`) |
| 1 | `main.ts` awaits engine init with no error boundary | `main.ts:43` | Unhandled rejection risk |
| 1 | Physics already guarded on failure | `engine/HavenEngine.ts:68-77` | OK |
| 2 | Active reconnect config (10 attempts cap) | `services/socket.ts:30-40` | Capped, no recovery UX |
| 2 | Active socket only console-logs lifecycle | `services/socket.ts:42-52` | No UI state / banner |
| 2 | `updateAuth()` defined but never called | `services/socket.ts:84-89` | Token-refresh re-auth unwired |
| 2 | Dead-code class with proper backoff+queue | `services/socketService.ts:60-74,17,86` | Unused |
| 2 | Socket.connect() called without awaiting | `scenes/RoomScene.ts:427` | Fire-and-forget |
| 3 | Manifest file location | `public/manifest.webmanifest` | Present (not manifest.json) |
| 3 | Manifest linked in HTML | `index.html:8` | OK |
| 4 | SW file | `public/sw.js` | Exists |
| 4 | SW registration + scope | `ui/InstallPrompt.ts:57-72` | scope `/` — OK |
| 4 | SW install cache | `sw.js:21-28` | OK (all-or-nothing risk) |
| 4 | SW activate cleanup | `sw.js:30-43` | OK |
| 4 | SW fetch: navigate offline fallback | `sw.js:60-71` | OK |
| 4 | SW fetch: cache-first assets | `sw.js:75-86` | OK |
| 4 | SW: API/socket bypass | `sw.js:57` | OK |
| 5 | Room GLB load + fallback | `world/RoomLoader.ts:60-76`; `scenes/RoomScene.ts:143-152` | Good (bare catch loses reason: `RoomScene.ts:149`) |
| 5 | Avatar GLB fallback | `world/AvatarController.ts:57-96` | Good |
| 5 | Furniture GLB silent omit | `world/FurnitureManager.ts:59-119` | Degrades silently, no UX |
| 5 | RoomEditor ghost silent fail | `world/RoomEditor.ts:123-151` | No visual fallback |
| 5 | CDN asset URL resolution | `config.ts:19-30` | OK |
| 5 | Wasm headers (COOP/COPE/CORP) | `public/_headers:18-26`; `vite.config.ts` server headers | OK |
| 6 | No canvas-2D fallback | `index.html:20`, `main.ts:37-41` | Missing |
| 6 | No `webglcontextlost` handler | (none in `engine/`, `main.ts`) | Missing |
| 7 | E2E config + servers | `playwright.config.ts:8,24,51-64` | OK for gameplay |
| 7 | E2E does NOT cover PWA/SW/offline/socket/WebGL-fallback/asset-fail | `e2e/*.spec.ts` (grep: 0 matches) | Coverage gap |

---

## Recommendations (high-impact -> low)

1. **Guard engine construction** (`engine/HavenEngine.ts`): wrap `new Engine(...)` in
   `try/catch` and, if `!Engine.IsSupported()`, surface a "WebGL required" message and
   keep the HTML UI (login/HUD) functional instead of a blank page. (P0 — currently a
   hard crash.)
2. **Surface socket reconnect state to the UI** (`services/socket.ts`): expose
   `reconnection`/`reconnectAttempts`/`connect_error` into a small overlay or toast, and
   wire a manual-reconnect affordance so 10-attempt exhaustion is recoverable without
   reload. (P1.)
3. **Remove or delete the dead `services/socketService.ts`**, or migrate its exponential
   backoff + event-queue + connect-timeout into the active `socket.ts`. Keeping two
   socket stacks is a maintenance trap. (P2.)
4. **Re-auth on token refresh**: call `socketService.updateAuth()` from the auth refresh
   callback (currently never invoked) so a rotated token re-authenticates the socket.
   (P1 for security/long sessions.)
5. **Log the asset-load error reason** (`scenes/RoomScene.ts:149`): change the bare
   `catch {` to `catch (err) { console.warn(..., err); ... }` so CDN 404s are
   diagnosable.
6. **Surface furniture-load failures** (`world/FurnitureManager.ts:115`): emit a toast
   / placeholder on `placeItem` failure so missing GLBs are visible rather than silently
   dropped. (P2.)
7. **Add E2E for resilience**: a socket-disconnect/reconnect spec and a PWA/SW offline
   spec (e.g. assert the shell loads offline after SW install) are currently uncovered.
   (P2.)
8. **Bound the asset cache** (`sw.js`): add a max-entry count / `cache.put` eviction or
   bump `CACHE_VERSION` on deploys so the cache doesn't grow unbounded. Minor. (P3.)
