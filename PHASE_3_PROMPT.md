# HavenWorld — Phase 3: Exploit Defense, Database Index Verification & Zero-Warning Baseline

You are an autonomous principal backend and systems security engineer working on HavenWorld at `/Users/danielstevens/Developer/HavenWorld`.

Phase 1 (multi-worker Redis room state sync, cluster cron guard) and Phase 2 (client transform reconciliation smoothing, VRAM disposal, DPR clamping, and raycast optimization in commit `6af4acc`) have been completed and verified.

Your mission is to execute **Phase 3 (Sections 3, 4, and 5 of `HAVENWORLD_REVIEW_REPORT.md`)**: Exploit Defense, Database Index & Pool Verification, and Zero-Warning Linter Elimination.

---

## 1. Scope of Work

### Task 1: Server-Authoritative Movement Bounds & Velocity Gates (§3.1 & §3.2)
- **Target Files**:
  - `apps/server/src/game/movement.ts`
  - `apps/server/src/sockets/index.ts`
  - `apps/server/src/sockets/socketSchemas.ts`
- **Requirements**:
  1. **Canonical Room Spawn Fallback Enforcement**:
     - Verify that every room entry and movement check maps uninitialized sockets to the room's canonical spawn coordinate (`room-park` → `{ x: 0, y: 0, z: 3.5 }`, lofts → `{ x: 0, y: 0, z: 0 }`).
     - Reject movement packets (`valid: false`) and increment security violation counters whenever a client attempts to initialize at arbitrary coordinates.
  2. **Max Distance / Velocity Gate**:
     - Calculate Euclidean distance between consecutive position ticks. If distance exceeds the maximum theoretical speed limit (3.5 m/s + 20% latency tolerance), clamp the avatar to the maximum permitted position and emit a position correction.
  3. **Zod Socket Schema Bounds Verification**:
     - Confirm all inbound socket payloads enforce strict finite coordinate ranges (`-10000` to `10000`), string bounds (`safeString(200)`), and markup stripping.

---

### Task 2: PostgreSQL Performance Indexes & Connection Pool Tuning (§4.1 & §4.2)
- **Target Files**:
  - `apps/server/prisma/schema.prisma`
  - `apps/server/src/prisma.ts`
  - `.env.example`, `apps/server/.env.example`
- **Requirements**:
  1. **Prisma Index Validation**:
     - Confirm the following indexes are defined in `schema.prisma`:
       - `model RoomFurniture`: `@@index([roomId])`
       - `model Room`: `@@index([ownerId])`, `@@index([isPublic, isActive])`
       - `model Friend`: `@@index([addresseeId, status])`
       - `model User`: `@@index([status])`, `@@index([role])`
     - Run `npx prisma format` to verify formatting and syntax.
  2. **Connection Pool Bounds**:
     - Ensure `apps/server/src/prisma.ts` passes explicit connection limits or properly parses pool parameters from `DATABASE_URL` (`connection_limit=10&pool_timeout=15`) to prevent connection exhaustion under multi-worker PM2 execution.

---

### Task 3: Zero-Warning Linter Elimination & Logger Abstraction (§5)
- **Target Files**:
  - `apps/server/src/monitoring/logger.ts`
  - `apps/server/src/index.ts`, `apps/server/src/routes/*.ts`
  - `apps/client/src/engine/HavenEngine.ts`, `apps/client/src/engine/SceneManager.ts`
- **Requirements**:
  1. **Replace Raw Console Statements**:
     - Monorepo currently has 0 errors but ~186 `no-console` warnings.
     - In `apps/server`: Route startup, shutdown, and route logs through `logger` (`apps/server/src/monitoring/logger.ts`).
     - In `apps/client`: Wrap engine and scene diagnostics in a conditional debug helper (`debugLog(...)`) that mutes in production and test environments.
  2. **Eliminate Remaining `any` Casts**:
     - Replace legacy `any` assertions in admin and route endpoints (`admin.ts`, `clubs.ts`) with typed request/response interfaces.
     - Clean up unused variables and unused imports across test suites.

---

## 2. Verification Protocol

Execute the complete multi-tier verification gate:

```bash
export PATH="/opt/homebrew/bin:$PATH"

# 1. Monorepo lint & type-check (must be 0 errors, minimal/zero warnings)
npm run lint

# 2. Server unit & integration tests (all 438+ tests must pass)
cd apps/server && npm test

# 3. Client unit tests (all 204+ tests must pass)
cd ../client && npm test

# 4. Playwright E2E browser tests
cd ../..
npm run test:e2e

# 5. Production build
npm run build
```

---

## 3. Commit Staging

Once all gates pass cleanly:
```bash
git add .
git commit -m "feat(security): movement velocity gates, connection pool tuning, and zero-warning linter cleanup"
```
