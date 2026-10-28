# HavenWorld — Phase 4: Load Gate Certification, Recovery Flow & Closed Alpha Release

You are an autonomous principal game systems engineer and release coordinator working on HavenWorld at `/Users/danielstevens/Developer/HavenWorld`.

All architectural hardening phases from `HAVENWORLD_REVIEW_REPORT.md` are complete and committed:
- **Phase 1 (`65425c5`)**: Distributed Redis room state synchronization, cluster presence tracking, primary worker cron guards.
- **Phase 2 (`6af4acc`)**: Client netcode transform smoothing, VRAM texture disposal, DPR scaling clamps, and raycast picking optimization.
- **Phase 3 (`f2f6115`)**: Server movement velocity gates, PostgreSQL connection pool limits, typed interfaces, and zero-error linter baseline.

Your objective is to execute **Phase 4: Closed Alpha Release Gate & Performance Certification** based on `docs/10_TEST_PLAN.md` §8 and §9.

---

## 1. Scope of Work

### Task 1: k6 Concurrency & Cluster Load Gate (§6.5 & §9.8)
1. Ensure the local multi-worker cluster environment is running:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
2. Execute the automated k6 performance and load benchmarks:
   ```bash
   k6 run load-tests/api-auth.js
   k6 run load-tests/ws-concurrent.js
   k6 run load-tests/fishing-concurrent.js
   ```
3. Verify performance thresholds:
   - API p95 response latency stays below 200ms under 50 RPS.
   - Concurrent WebSocket connections sustain message broadcasts across workers without frame drops or memory leaks.
   - Atomic Redis rate limiter caps spamming sockets without degrading event loop lag.

---

### Task 2: Account Recovery & Password Reset Lifecycle (§9.1)
1. In `apps/server/src/routes/auth.ts`:
   - Verify `POST /api/auth/change-password` (authenticated) properly invalidates existing refresh tokens and revokes current sessions.
   - Verify `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` handle token generation, email payload dispatch, and single-use token consumption.
2. In `apps/client/src/services/authService.ts`:
   - Confirm `forgotPassword()` and `changePassword()` cleanly clear in-memory tokens and mirror the session termination locally.

---

### Task 3: Production Beta Gate Check & Invite System Re-Arming (§8)
1. Execute the production gate verification script:
   ```bash
   ./scripts/beta-gate-check.sh
   ```
2. Confirm all 18 readiness checks pass cleanly (security headers, CORS origin pinning, TLS validity, database migrations in sync).
3. Re-arm the closed alpha invite gate in production configurations:
   - Ensure `ALPHA_INVITE_ONLY=true` is set.
   - Test minting single-use invite codes through the admin CLI or seed script:
     ```bash
     cd apps/server && npx ts-node scripts/mint-invite-codes.ts
     ```
   - Verify that consuming an invite code marks it used and prevents duplicate registrations.

---

### Task 4: Documentation & Final Verification Gate
1. Update `docs/10_TEST_PLAN.md` and `docs/11_CLIENT_FEATURE_TRACEABILITY.md` to record the verified test baseline and load benchmarks.
2. Run full monorepo test and build suite:
   ```bash
   export PATH="/opt/homebrew/bin:$PATH"
   npm run lint
   npm test
   npm run test:e2e
   npm run build
   ```
3. Commit all additions cleanly:
   ```bash
   git add .
   git commit -m "chore(release): k6 load gate certification, password recovery lifecycle, and closed alpha invite gating"
   ```
