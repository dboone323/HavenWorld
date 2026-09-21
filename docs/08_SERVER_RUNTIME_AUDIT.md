# Server Runtime Audit: `apps/server/src`

Date: 2026-09-21
Scope: Full source tree under `apps/server/src/` (Node.js / Express 5 / Socket.io / Prisma / Redis)
Auditor: coding profile

Severity legend: CRITICAL > HIGH > MEDIUM > LOW

---

## Executive Summary

The server has strong foundational security: Express 5, Helmet, CORS, CSRF double-submit,
bcrypt, bcrypt dummy-hash timing normalization, Zod input validation on most endpoints,
server-authoritative movement validation, opaque DB-backed refresh tokens, and Prisma
atomic transactions for economy operations. However, the audit is dominated by a single
systemic flaw: **Express 5 does not automatically catch rejected promises from async route
handlers**. Roughly 75% of async Express route handlers and all socket handlers lack
try/catch, meaning any DB failure, validation throw, or downstream service error becomes
an unhandled promise rejection (request hangs, process logs `unhandledRejection`, and in
production with strict Node settings could crash). Additional CRITICAL issues include two
credential-exposure routes that return `passwordHash` in the response body, dead code
surfaces that shadow real implementations, and an inconsistent JWT secret fallback chain
that breaks authentication when both secrets are set to different values.

---

## 1. Missing Error Handlers on Express Routes (Express 5)

Express 5 still does **not** automatically forward rejected promises from async route
handlers to `next(err)`. The `globalErrorHandler` registered at `index.ts:129` only catches
errors explicitly passed to `next()`. Every async handler that throws or rejects without
a try/catch produces an unhandled promise rejection and the request hangs indefinitely.

**Affected files and routes (async, no try/catch):**

`routes/users.ts` — every route:
- `GET /me` (L13), `POST /daily-claim` (L50), `GET /me/avatar` (L125), `PUT /me/avatar` (L162),
  `GET /me/inventory` (L246), `GET /me/room` (L282), `GET /:username` (L292)

`routes/rooms.ts` — every route:
- `GET /` (L12), `GET /:id/furniture` (L42), `POST /:id/furniture/layout` (L86),
  `GET /:id` (L131), `POST /:id/furniture` (L149), `DELETE /:id/furniture/:furnitureId` (L209)

`routes/friends.ts` — every route:
- `GET /` (L9), `GET /requests` (L34), `POST /request` (L48), `POST /accept/:requesterId` (L78),
  `DELETE /:friendId` (L97)

`routes/clubs.ts` — `GET /me` (L10), `GET /` (L29)
(`POST /:id/join` L77 has try/catch ✓; `POST /` L59 has try/catch ✓)

`routes/reports.ts` — `POST /` (L22)

`routes/gallery.ts` — `GET /` (L9), `POST /` (L46)
(`POST /:id/like` L81 has try/catch ✓)

`routes/passport.ts` — `GET /:userId` (L8)

`routes/admin.ts` — every route:
- `POST /invites/generate` (L21), `GET /invites` (L54), `DELETE /invites/:id` (L67),
  `GET /users` (L78), `GET /users/:id` (L122), `POST /users/:id/mute` (L148),
  `POST /users/:id/ban` (L169), `POST /users/:id/unban` (L189), `POST /force-logout/:id` (L202),
  `POST /users/:id/promote` (L211), `GET /reports` (L223), `PATCH /reports/:id` (L252),
  `GET /chat-log` (L273), `GET /stats` (L292)

`routes/shop.ts` — `GET /` (L9, synchronous so OK in practice; the handler calls
`ShopService.getShopState()` which is synchronous)
(`POST /buy` L20, `POST /claim-daily` L33, `POST /gift` L49 all have try/catch ✓)

`routes/quests.ts` — `GET /` (L8) has try/catch ✓

`middleware/auth.ts` — `requireRole` (L46) is an **async middleware** that calls
`await prisma.user.findUnique()` without try/catch. If Prisma throws, the rejected promise
is never caught by Express, `next` is never called, and the request hangs.

`middleware/errorHandler.ts:1-28` — `globalErrorHandler` exists and is registered, but
it can only catch errors that reach `next(err)`. With no try/catch wrappers in most async
handlers, errors never reach it.

**Recommendation:** Wrap all async route handlers in try/catch that delegates to
`next(err)`, or use an `express-async-handler` wrapper. The `validateBody` middleware
(middleware/validateBody.ts:4) could be extended to wrap handlers, but it is currently
unused (see §6).

---

## 2. Unhandled Promise Rejections (Async Handlers Without try/catch)

This overlaps with §1 but includes non-HTTP async paths:

**Socket.io handlers (sockets/index.ts):**
- `chat:send` (L404) — `async (rawData) => { ... }` with no try/catch. Calls
  `prisma.user.findUnique` (L425), `prisma.chatMessage.create` (L454), and
  `roomManager.addChatMessage` (L477). Any DB failure is an unhandled rejection.
- `trade_confirm` (L781) — `async () => { await TradeManager.confirmTrade(userId); }`
  with no try/catch. While `confirmTrade` → `executeAtomicSwap` has internal try/catch,
  any error in `getSessionForUser` (synchronous, returns undefined) or the `LOCKED`
  state check path is unhandled.

Socket handlers that DO have try/catch: `auth:join` (L136), `avatar:update` (L488),
`furniture:place` (L571), `furniture:remove` (L615), all doorbell/privacy/guestbook
handlers (L654-744), `offer_item` through `trade_cancel` (L747-787), `adopt_pet`/`name_pet`/
`feed_pet` (L790-818), `pizza_order_submit` (L821), `recycle_item`/`start_craft`/`claim_craft`
(L833-861), `set_room_mood` (L864), `club_chat_send` (L901). These are fine.

**Cron jobs (index.ts:146-175):** Three of five scheduled jobs call async methods without
`.catch()`:
- `FishingService.resetWeeklyLeaderboard()` (L149) — no `.catch()`
- `PetManager.decayAllPets()` (L154) — no `.catch()`
- `ShopService.processFlashSales()` (L159) — no `.catch()`
- `WorkshopService.processCompletedCrafts().catch(...)` (L164) — has `.catch()` ✓
- `SeasonalEventService.convertExpiredEvents().catch(...)` (L172) — has `.catch()` ✓

**FishingService interval (FishingService.ts:80-83, 131-135):** The 100ms `setInterval`
callback calls `this.tickSession(userId)` (async, not awaited). Inside `tickSession`,
`this.endSessionSuccess(session)` and `this.endSessionFail(session)` are called without
`await`. Any rejection from these async methods (e.g., DB errors in `endSessionSuccess`
when recording catches at L148-155) becomes an unhandled promise rejection inside a
timer callback, which can crash the Node process.

**Redis operations:** In the disconnect handler (sockets/index.ts:925), `redis.sRem` has
`.catch(() => {})` ✓ but `prisma.user.update` also has `.catch(() => {})` ✓. These are
acceptable.

---

## 3. Socket.io Disconnect / Room Cleanup

**Status: GOOD.** The disconnect handler (sockets/index.ts:912-965) is comprehensive:
- `FishingService.cancelSession(userId)` (L915) — clears the fishing interval ✓
- `TradeManager.cancelTrade(userId, ...)` (L916) — cancels in-flight trade, clears countdown timer ✓
- `roomManager.leaveRoom(socket.id)` (L918) — removes player from in-memory RoomManager,
  cleans up empty personal rooms (keeps Haven Park alive) ✓
- `redis.sRem('online_users', userId)` (L925) with `.catch()` ✓
- `prisma.user.update` lastLoginAt (L927) with `.catch()` ✓
- Friend offline notifications via `io.fetchSockets()` + `FRIEND_OFFLINE` emit (L934-956) ✓
- `clearRateLimitEntry(socket.id)` (L961) — ModerationService rate limit store ✓
- `moveRateLimiter.delete(socket.id)` (L962) ✓
- `MovementValidator.removePlayer(userId)` (L963) ✓
- `SocketRateLimiter.cleanup(socket.id)` (L964) ✓

Socket.io automatically removes disconnected sockets from all rooms, so no explicit
`socket.leave()` is needed on disconnect. The `auth:join` handler does call
`socket.leave(prev.roomId)` on room-switch (L253) ✓.

Potential edge case: `socket.data.user` is destructured at L111 without a null check.
If the connection callback fires before auth middleware completes (shouldn't happen
since `io.use` middleware runs before `connection`), this would throw. This is a theoretical
risk only — socket.io guarantees middleware completes before `connection`.

---

## 4. JWT Secret Handling

**Status: HIGH / BUG.** Two parallel token systems exist with inconsistent fallback chains.

**System A (used): `auth/tokens.ts`**
- L5: `const JWT_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev_secret_fallback_for_tests';`
  — Note the fallback order: **JWT_ACCESS_SECRET first**, then JWT_SECRET.
- `generateAccessToken` uses `JWT_SECRET` for signing.
- `verifyAccessToken` uses `JWT_SECRET` for verification (consistent with signing).
- Refresh tokens are **opaque** — `crypto.randomBytes(48).toString('base64url')` (L32),
  stored in the `refreshToken` DB table. `JWT_REFRESH_SECRET` is NOT used here at all.

**System B (dead code): `routes/auth.ts:45-57`** — `generateTokens()`
- Exports a function that uses `process.env.JWT_ACCESS_SECRET!` and
  `process.env.JWT_REFRESH_SECRET!` (non-null assertions).
- **This function is NEVER called.** The login route (auth.ts:321-322) uses
  `generateAccessToken` / `generateRefreshToken` from `tokens.ts` instead.
- If it WERE called, the non-null assertions (`!`) would pass `undefined` to
  `jwt.sign()` if the env vars are unset, throwing at runtime.
- The `.env.example` defines `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` as separate
  secrets, but also defines a legacy `JWT_SECRET`. The runtime code conflates
  `JWT_SECRET` and `JWT_ACCESS_SECRET` into one value via fallback.

**Inconsistent fallback order (BUG):**
- `tokens.ts` L5: `JWT_ACCESS_SECRET || JWT_SECRET` (access secret preferred)
- `middleware/auth.ts` L24: `JWT_ACCESS_SECRET || JWT_SECRET` (matches tokens.ts ✓)
- `index.ts` L66 (verifyStartupSecurityAssertions): `JWT_SECRET || JWT_ACCESS_SECRET`
  (DIFFERENT order — prefers JWT_SECRET)
- `auth/tokens.ts` L5: `JWT_SECRET || JWT_ACCESS_SECRET` in the fallback AFTER
  JWT_ACCESS_SECRET

Wait — re-reading tokens.ts L5: `process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET`
No — the actual code is:
```
const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_secret_fallback_for_tests';
```

Hmm, let me re-read. The file output was:
```
5|const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_secret_fallback_for_tests';
```

So `tokens.ts` uses `JWT_SECRET || JWT_ACCESS_SECRET` (JWT_SECRET first).
And `middleware/auth.ts` L24 uses `JWT_ACCESS_SECRET || JWT_SECRET` (JWT_ACCESS_SECRET first).

**If both `JWT_SECRET` and `JWT_ACCESS_SECRET` are set to different values:**
- Tokens are SIGNED with `JWT_SECRET` (from tokens.ts signing priority)
- Tokens are VERIFIED using `JWT_ACCESS_SECRET` (from auth.ts verification priority)
- → All access tokens fail verification → all authenticated requests return 401

In the current `.env`, both are set to the same value, so this doesn't manifest. But it's a
time bomb. The `verifyStartupSecurityAssertions` L66 also uses
`JWT_SECRET || JWT_ACCESS_SECRET` (consistent with tokens.ts signing), but `requireAuth`
L24 uses the opposite order.

**Recommendation:** Standardize on `JWT_ACCESS_SECRET` only (or `JWT_SECRET` only), remove
the dead `generateTokens` function in auth.ts, and make `verifyStartupSecurityAssertions`
require the exact secret that `tokens.ts` uses.

---

## 5. Rate Limiting

**Status: MEDIUM.** Rate limiters exist but have gaps and the security test threshold
differs from the configured limit.

**Express-level (middleware/security.ts):**
- `apiRateLimiter` (L38): 100 req / 15 min for all `/api/*` routes. Skips `/health`,
  `/api/health`, and `/api/test*` (L44). Applied to all API routes (L93).
- `authRateLimiter` (L47): 30 req / 15 min for `/api/auth/*`. **Skips `/refresh`**
  (L52) — the refresh-token endpoint is UNRATELIMITED. An attacker with a stolen refresh
  token could spam it; since it's single-use (rotation), replay is detected, but there's
  no brute-force protection on the refresh flow itself.
- In test mode, both limiters are raised (1000 and 500 respectively), so pen tests
  won't trigger 429 in test.

**Socket-level (sockets/rateLimiter.ts + sockets/index.ts + ModerationService.ts):**
- `SocketRateLimiter` (sockets/rateLimiter.ts:24): per-event, DEFAULT_LIMIT = 50 per 5s.
  Disconnects after 3 violations (L61). Applied via `socket.onAny` (sockets/index.ts:123).
- `checkMoveRateLimit` (sockets/index.ts:88): 20 position updates / sec per socket.
- `checkRateLimit` (ModerationService.ts:34): 5 chat messages / 3 sec per socket.

**No nginx config found** in the repository. The code references "Nginx layer" in comments
(security.ts:73, 79, 80) for CSP, HSTS, and proxy trust, but no nginx configuration file
is present to cross-reference rate limits or security headers.

**Security test cross-reference (brute-force.js):** The test fires 20 login attempts and
expects HTTP 429. The production `authRateLimiter` allows 30/15min, so 429 only triggers on
the 31st attempt. The test itself acknowledges this: "May be relaxed in test/dev environment."

**Recommendation:** Lower `authRateLimiter` threshold or align the test expectation. Add
rate limiting to the `/refresh` endpoint. Provide nginx config in the repo for cross-reference.

---

## 6. Input Validation (Zod Consistency)

**Status: MEDIUM.** Zod is used on most endpoints, but coverage is inconsistent and the
`validateBody` middleware is dead code.

**`validateBody` middleware (middleware/validateBody.ts:4-22):** Defined and exported but
**never imported or used** anywhere in the codebase. All routes instead do inline
`schema.safeParse(req.body)` and call `res.status(400).json(...)` manually. This means
error response formats differ across routes (some return `{ error, fields }`, others
return `{ error }`, others return `{ error, message, code }`).

**Routes WITHOUT any Zod validation on body/params:**
- `routes/friends.ts:49` — `POST /request`: `const { targetUserId } = req.body;` —
  `targetUserId` is not validated as a UUID or even a non-empty string. A null, object,
  or missing value passes through to Prisma, which may throw a cryptic error.
- `routes/friends.ts:79` — `POST /accept/:requesterId`: `requesterId` param not validated.
- `routes/friends.ts:98` — `DELETE /:friendId`: `friendId` param not validated.
- `routes/rooms.ts:159` — `POST /:id/furniture`: destructures `{ itemId, x, y, z, rotation, layer }`
  from `req.body` with NO schema. Missing `itemId` → Prisma throws. Non-numeric `x`/`y` →
  stored as-is or Prisma error.
- `routes/admin.ts:254` — `PATCH /reports/:id`: destructures `{ status, moderatorNotes }`
  from `req.body`. `status` is checked against an array (not Zod), `moderatorNotes` is
  unvalidated (could be any type, passed to Prisma `moderatorNotes` column).

**Routes WITH Zod validation (good):**
- `routes/auth.ts`: `registerSchema` (L22), `loginSchema` (L37) ✓
- `routes/users.ts`: `avatarDataSchema` (L138) ✓
- `routes/shop.ts`: `buySchema` (L14), `giftSchema` (L42) ✓
- `routes/clubs.ts`: `createClubSchema` (L52) ✓
- `routes/reports.ts`: `reportSchema` (L8) ✓
- `routes/gallery.ts`: `uploadSchema` (L39) ✓
- `routes/admin.ts`: `generateInviteSchema` (L15), `muteSchema` (L142) ✓
- `sockets/socketSchemas.ts`: ALL socket events have Zod schemas ✓

**Recommendation:** Adopt the `validateBody` middleware or create a consistent async
wrapper. Add schemas for the unvalidated routes above.

---

## 7. Security Test Cross-Reference

Three penetration tests live in `security-tests/`:

**brute-force.js** — Tests `/api/auth/login` with 20 rapid bad-password attempts, expects
HTTP 429.
- Server defense: `authRateLimiter` (security.ts:47) with 30 req / 15 min in production.
- Status: **Defense exists but threshold mismatch.** 20 attempts won't trigger 429 in
  production (needs 31). In test mode (500 limit), never triggers. The test acknowledges
  this. Align the test's `maxAttempts` to 35, or lower the limiter to 20/15min.

**speed-hack.js** — Connects a socket, emits `player:move` with teleport coordinates
(9999, 0, 9999), expects `position_correction` and eventual disconnect after 3 violations.
- Server defense: `MovementValidator.validateMovement` (game/movement.ts:42) detects
  speed > 320px/sec * 2.5 tolerance, returns `valid: false` with corrected position.
  `checkMoveRateLimit` (sockets/index.ts:88) caps 20 moves/sec. `SocketRateLimiter`
  disconnects after 3 violations.
- Status: **Defense matches the test.** The test emits via event name `'player:move'`
  which matches `SOCKET_EVENTS.PLAYER_MOVE` = `'player:move'`. ✓

**economy-exploit.js** — POSTs to `/api/shop/buy` with `{ itemId: 'item-1', count: -10 }`,
`count: 1.5`, and `count: '100 OR 1=1'`, expects 400/401/403/422.
- Server defense: `buySchema` (routes/shop.ts:14) validates `itemId: z.string()` and
  `currency: z.enum(...).default('COIN')`. **The `count` field is NOT in the schema.**
  Zod silently strips unknown keys, so `{ count: -10 }` is parsed as `{ itemId: 'item-1' }`
  (count is dropped). The request proceeds to `ShopService.buyItem('item-1', ...)` which
  throws "Item not found in catalog" → caught by try/catch → HTTP 400.
- Status: **Test passes but for the wrong reason.** The negative/fractional/SQLi payloads
  are never validated — they're silently stripped. The 400 comes from "item not found,"
  not from input rejection. If the test used a real `itemId`, the `count` field would be
  ignored entirely. The economy exploit (negative amounts) is NOT defended by validation
  — it's defended by `buyItem` not accepting a count parameter at all.
- Recommendation: Add a `count: z.number().int().min(1)` to `buySchema` (if quantity
  support is intended) to make the test meaningful.

---

## 8. BullMQ / Redis Queue Handling

**Status: NOTE.** BullMQ is **not used** in this project. `package.json` has no `bullmq`
dependency. The `craftingQueue` table in Prisma is a plain DB table polled by a cron job
(WorkshopService.ts:212 `processCompletedCrafts`), not a BullMQ job queue. Redis is used
directly via the `redis` v4 package.

**Redis usage:**
- Refresh token cache: `redis.setEx('refresh:${userId}', ...)` (auth.ts:325, 417)
- Online users set: `redis.sAdd('online_users', ...)` (sockets/index.ts:264),
  `redis.sRem` on disconnect (L925), `redis.sIsMember` in friends route (friends.ts:25)
- Club chat: Redis list with 48h TTL (ClubService.ts:124-127), guarded by
  `redisClient.isOpen` check (L124)
- Doorbell knock: Redis SET with 120s TTL (PrivacyManager.ts:142-143)

**Redis error handling:** `redis.on('error', ...)` registered in redis.ts:8 ✓.
`redis.on('connect')` and `redis.on('reconnecting')` log but don't update state.

**Inconsistency:** `redis.isReady` (boolean property) used in `index.ts:100` health
endpoint; `redisClient.isOpen` (different boolean property) used in ClubService.ts:124
and PrivacyManager.ts:142/170. `isReady` means "client can accept commands"; `isOpen`
means "has at least one active connection." They may differ during reconnection. This is
LOW severity but could cause confusing health-check behavior.

**Cron job error handling (see also §2):** 3 of 5 cron jobs lack `.catch()`.

---

## 9. Additional Critical Findings (Beyond the 9-Point Checklist)

### CRITICAL: Password hash exposure in API responses

**`routes/admin.ts:122-140` — `GET /api/admin/users/:id`:**
```ts
const user = await prisma.user.findUnique({
  where: { id },
  include: { avatar: true, _count: { ... } },
});
return res.json(user);
```
No `select` clause → returns ALL User columns including `passwordHash` (schema.prisma:104)
and `emailVerifyToken` (schema.prisma:107). Any admin or moderator can retrieve password
hashes for offline bcrypt cracking.

**`routes/rooms.ts:131-146` — `GET /api/rooms/:id`:**
```ts
const room = await prisma.room.findUnique({
  where: { id: roomId },
  include: { furniture: { include: { item: true } } },
});
return res.json(room);
```
No `select` clause → returns ALL Room columns including `passwordHash` (schema.prisma:258).
Any authenticated user can retrieve the bcrypt hash of any room's password.

Compare with `GET /api/users/me` (users.ts:13) which also lacks `select` — it returns
`passwordHash` too. However, it requires auth and only returns the requesting user's own
data, so severity is LOWER (self-exposure, not cross-user).

**`GET /api/admin/users` (admin.ts:78-119)** correctly uses `select` to whitelist fields ✓.

### CRITICAL: Dead `generateTokens` function shadows correct implementation

`routes/auth.ts:45-57` exports `generateTokens` which uses `JWT_REFRESH_SECRET` for a
JWT-based refresh token. The ACTUAL login flow (auth.ts:321-322) uses `generateRefreshToken`
from `tokens.ts:31` which creates an opaque DB-backed token. This dual system is confusing:
a developer might call `generateTokens` expecting JWT refresh behavior, or assume
`JWT_REFRESH_SECRET` is in use when it isn't. The `.env.example` documents both secrets,
but only `JWT_ACCESS_SECRET` (or `JWT_SECRET`) is actually used at runtime.

### HIGH: `requireRole` async middleware without try/catch

`middleware/auth.ts:46-73` — `requireRole` is an `async` function that calls
`await prisma.user.findUnique()`. If Prisma throws (DB down, query error), the rejected
promise is never caught. Express 5 does not auto-catch async middleware rejections, so
`next()` is never called and the request hangs. This affects ALL admin routes that rely
on it (admin.ts:11-12 router-level), and any route using `requireRole`.

### HIGH: `requireAdmin` imported but never used

`routes/admin.ts:5` imports `requireAdmin` from `middleware/adminAuth.ts`. It is **never
referenced** in any route handler. The actual admin protection comes from
`router.use(requireAuth); router.use(requireRole(['ADMIN', 'MODERATOR']));`. The
`requireAdmin` function (adminAuth.ts:18) — which does its own DB role check with
`captureSecurityEvent` for unauthorized access (L47) — is dead code. If `requireRole`
were ever removed or bypassed, `requireAdmin` would provide no protection since it's
not applied.

### MEDIUM: Three dead-code classes in `game/` directory

- `game/fishing.ts` `SecureFishingSystem` (L9) — exports `recordCast`, `validateReel`,
  `cancelCast`. **Never imported.** Socket handlers (sockets/index.ts:637-651) call
  `FishingService.startSession` / `updateReelPosition` / `cancelSession` directly,
  bypassing session token validation. The `SecureFishingSystem` was presumably designed
  to prevent session-fixation in fishing but is unused.
- `game/trade.ts` `SecureTradeSystem` (L9) — exports `verifyInventoryOwnership`.
  **Never imported.** `TradeManager.executeAtomicSwap` (TradeManager.ts:261) does its own
  inventory verification inside the transaction.
- `game/inviteCodes.ts` `InviteCodeManager` (L5) — exports `generateCode` and
  `redeemCodeInTransaction`. **Never imported.** The register route (auth.ts:88-101)
  checks invite codes inline; the admin route generates codes with `crypto.randomBytes`
  directly (admin.ts:32-34).
- `game/economy.ts` `EconomySecurity` (L20) — exports `transferCoins` and `awardReward`.
  **Never imported.** Economy operations use `InventoryService.transferCoins` (L132) and
  `MinigameService` for rewards.
- `middleware/validateBody.ts:4` — `validateBody` function, never used (see §6).

### MEDIUM: `SIGINT` not handled; Redis not disconnected on shutdown

`index.ts:189-196` handles `SIGTERM` (graceful HTTP close + Prisma disconnect) but:
1. Does NOT handle `SIGINT` (Ctrl+C) — in development, this skips graceful shutdown.
2. Does NOT disconnect Redis on shutdown — the `redis` client is left open.
3. Does NOT clear the `PetManager` ticker interval (`setInterval`, PetManager.ts:32)
   or any other `setInterval` — the process exit handle should clear all timers.

### MEDIUM: `authRateLimiter` skips `/refresh` — refresh endpoint unprotected

`middleware/security.ts:52`:
```ts
skip: (req) => req.path === '/refresh' || req.path.endsWith('/refresh'),
```
The refresh endpoint (`/api/auth/refresh`) is exempt from the auth rate limiter. While
refresh tokens are single-use (rotation + reuse detection at auth.ts:382-389), there is
no rate limiting to prevent an attacker from brute-forcing refresh tokens or flooding
the endpoint with requests.

### LOW: Inconsistent error response formats

Validation failures across routes use different shapes:
- `routes/auth.ts:72`: `{ error: 'Validation failed', fields: parsed.error.flatten().fieldErrors }`
- `routes/admin.ts:24`: `{ error: 'Invalid input.', fields: parsed.error.flatten().fieldErrors }`
- `routes/shop.ts:22`: `{ error: 'Invalid purchase payload' }` (no fields)
- `routes/clubs.ts:61`: `{ error: 'Invalid club details' }` (no fields)
- `routes/gallery.ts:49`: `{ error: 'Invalid photo data' }` (no fields)
- Socket handlers: `{ code: 'INVALID_PAYLOAD', details: ... }` (different structure)

### LOW: `MoveSchema` in `validation/schemas.ts` vs `sockets/socketSchemas.ts`

Two different move schemas exist: `validation/schemas.ts:51` (`MoveSchema` with `direction`
as enum, `isMoving` as boolean) and `socketSchemas.ts:21` (`MoveSchema` with `direction`
as enum with default, `rotY` as number). The socket schema is used at runtime; the
validation schema is unused (confirm: `validateBody` that would use it is dead code).
This duplication is a maintenance hazard.

### LOW: Health check uses `redis.isReady` which may be stale

`index.ts:100`:
```ts
redis: redis.isReady ? 'connected' : 'disconnected',
```
`redis.isReady` is a property that reflects connection state at the time of access, but
Redis may be reconnecting. A more accurate check would use `redis.ping()` or listen for
connection events.

---

## Summary Table

| # | Category | Severity | File:Line(s) | Summary |
|---|----------|----------|-------------|---------|
| 1 | Express error handling | CRITICAL | users.ts:13-292, rooms.ts:12-227, friends.ts:9-107, clubs.ts:10-100, reports.ts:22, gallery.ts:9-78, passport.ts:8, admin.ts:21-292 | ~30 async routes lack try/catch; errors become unhandled rejections |
| 2 | Unhandled rejections | HIGH | sockets/index.ts:404,781; index.ts:149-159; FishingService.ts:80-135 | chat:send & trade_confirm socket handlers, 3 cron jobs, fishing interval lack error handling |
| 3 | Socket disconnect cleanup | GOOD | sockets/index.ts:912-965 | Comprehensive — all state cleaned up |
| 4 | JWT secret handling | HIGH | auth/tokens.ts:5; middleware/auth.ts:24; routes/auth.ts:45-57; security.ts:57-68 | Inconsistent fallback order (tokens.ts vs auth.ts) breaks auth if secrets differ; dead generateTokens uses non-null assertions; JWT_REFRESH_SECRET unused at runtime |
| 5 | Rate limiting | MEDIUM | security.ts:38-54; sockets/rateLimiter.ts | Auth limiter allows 30/15min (test expects 429 at 20); refresh endpoint UNRATELIMITED; no nginx config in repo |
| 6 | Input validation | MEDIUM | friends.ts:49,79,98; rooms.ts:159; admin.ts:254; validateBody.ts:4 | 5 routes have no Zod validation; validateBody middleware is dead code |
| 7 | Security test alignment | MEDIUM | security-tests/*.js | brute-force: threshold mismatch (20 vs 30); economy-exploit: passes for wrong reason (count field stripped) |
| 8 | Redis/BullMQ | NOTE | redis.ts; index.ts:149-175 | BullMQ not used; 3/5 cron jobs lack .catch(); redis.isReady vs isOpen inconsistency |
| 9a | Password hash exposure | CRITICAL | admin.ts:122-140; rooms.ts:131-146 | GET /admin/users/:id and GET /rooms/:id return passwordHash in response body |
| 9b | Dead code | HIGH | auth.ts:45; game/fishing.ts:9; game/trade.ts:9; game/inviteCodes.ts:5; game/economy.ts:20; middleware/validateBody.ts:4 | 5 unused classes/functions shadow real implementations |
| 9c | requireRole async middleware | HIGH | auth.ts:46-73 | No try/catch on DB lookup; Prisma error hangs request |
| 9d | requireAdmin unused | HIGH | admin.ts:5; adminAuth.ts:18 | Import dead; router uses requireRole instead |
| 9e | Shutdown | MEDIUM | index.ts:189-196 | SIGINT not handled; Redis not disconnected; PetManager interval not cleared |
| 9f | Refresh endpoint | MEDIUM | security.ts:52 | authRateLimiter skips /refresh |
| 9g | Error format inconsistency | LOW | Various | 6+ different response shapes for validation/errors |
| 9h | MoveSchema duplication | LOW | schemas.ts:51; socketSchemas.ts:21 | Two schemas for same concept; validation one unused |

---

## Priority Remediation List

1. **CRITICAL — Add try/catch (or async wrapper) to all async Express routes.** This is
   systemic and affects ~30 routes. Consider using `express-async-handler` or a custom
   `asyncHandler` wrapper.
2. **CRITICAL — Add `select` clauses to admin.ts:122 and rooms.ts:131** to exclude
   `passwordHash`, `emailVerifyToken`, and other sensitive columns.
3. **HIGH — Fix JWT secret fallback order.** Standardize on a single secret name
   (recommend: `JWT_ACCESS_SECRET`). Remove the dead `generateTokens` in auth.ts:45.
4. **HIGH — Wrap `requireRole` (auth.ts:46) in try/catch** or delegate to `next(err)`.
5. **HIGH — Remove dead code:** `SecureFishingSystem`, `SecureTradeSystem`,
   `InviteCodeManager`, `EconomySecurity`, `generateTokens`, `validateBody`,
   `requireAdmin` import.
6. **MEDIUM — Remove `skip` for `/refresh` in authRateLimiter** (security.ts:52) or add
   a separate limiter for it.
7. **MEDIUM — Add Zod validation** to `friends.ts:/request`, `rooms.ts:POST /:id/furniture`,
   `admin.ts:PATCH /reports/:id`, and param validation for IDs.
8. **MEDIUM — Add `.catch()` to 3 uncaught cron jobs** (index.ts:149-159) and await
   fishing interval async calls.
9. **MEDIUM — Handle `SIGINT`, disconnect Redis, clear intervals** on shutdown (index.ts).
10. **LOW — Standardize error response format** across all routes and socket handlers.