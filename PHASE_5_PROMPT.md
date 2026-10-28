# HavenWorld — Phase 5: Production Deployment, Live Smoke Testing & Alpha QA Pass

You are an autonomous principal DevOps engineer and QA lead working on HavenWorld at `/Users/danielstevens/Developer/HavenWorld`.

All architectural hardening and local verification phases are complete:
- **Phase 1 (`65425c5`)**: Distributed Redis room state synchronization, cluster presence tracking, primary worker cron guards.
- **Phase 2 (`6af4acc`)**: Client netcode transform smoothing, VRAM texture disposal, DPR scaling clamps, and raycast picking optimization.
- **Phase 3 (`f2f6115`)**: Server movement velocity gates, PostgreSQL connection pool limits, typed interfaces, and zero-error linter baseline.
- **Phase 4 (`51d306f`)**: k6 concurrency load gate certification (p95 0s latency, 100% fishing idempotency), password recovery routes, and invite code minting script.

Your objective is to execute **Phase 5: Production Deployment, Live Smoke Verification & Alpha QA Sign-Off** based on `docs/09_DEPLOY_AND_DATABASE_RUNBOOK.md` and `docs/10_TEST_PLAN.md` §7 and §8.

---

## 1. Scope of Work

### Task 1: Staging & Production Deployment Execution
1. Verify pre-deploy checks locally:
   ```bash
   export PATH="/opt/homebrew/bin:$PATH"
   npm run lint
   npm test
   npm run test:e2e
   npm run build
   ```
2. Deploy the server to the Oracle A1 production host (`https://147-224-184-148.nip.io`):
   ```bash
   make deploy-server
   ```
   - Confirm remote steps run cleanly: `git pull` → `pnpm install --frozen-lockfile` → `prisma migrate deploy` → `pnpm build` → `pm2 reload havenworld-server`.
   - Ensure `prisma migrate diff` reports zero drift against the live Supabase PostgreSQL database.
3. Deploy the client bundle to Cloudflare Pages (`https://havenworld-game.pages.dev`):
   ```bash
   make deploy-client
   ```
   - Verify cache-stamped service worker (`sw.js`) matches the latest Git commit hash.

---

### Task 2: Live Production Health & Security Smoke Test
1. Execute live health checks against the production server:
   ```bash
   curl -s https://147-224-184-148.nip.io/health | python3 -m json.tool
   ```
   - Verify `status: "ok"`, `redis: "connected"`, and active socket count.
2. Verify production HTTP security headers:
   ```bash
   curl -sI https://147-224-184-148.nip.io/health | grep -iE 'strict-transport|x-frame|content-security|x-content-type'
   ```
3. Run the automated beta gate verification script:
   ```bash
   ./scripts/beta-gate-check.sh
   ```
   - Ensure all checks report **PASS** (19+ checks passing with 0 failures).

---

### Task 3: Closed Alpha Gate Re-Arming & Invite Code Minting
1. On the production server VM, ensure `ALPHA_INVITE_ONLY=true` is armed in `.env`.
2. Mint the initial batch of tester invite codes:
   ```bash
   cd apps/server && npx ts-node scripts/mint-invite-codes.ts 25
   ```
   - Verify that 25 cryptographically random 8-character codes are generated in `public.invite_codes` with `usesRemaining: 1` and `isRevoked: false`.
   - Save the minted codes manifest for alpha tester distribution.

---

### Task 4: Systematic Manual QA Pass (`docs/10_TEST_PLAN.md` §7)
Execute the manual QA checklist across `https://havenworld-game.pages.dev` logged in as the admin account (`dboone323`) and a fresh tester account:

1. **A. Onboarding & Auth**:
   - Register with an invite code → successful entry without verification requirement.
   - Register with a used/invalid code → clear rejection error.
   - Logout clears httpOnly cookie; page reload requires re-authentication.
2. **B. Avatar & Wardrobe**:
   - Open Customizer → apply hair/apparel/eyes → real-time avatar rebuild without page reload.
   - Toggle gender presets → proportional shoulder/hip adjustment without resetting styles.
3. **C. Rooms & Navigation**:
   - Spawn in personal loft → travel to Haven Park.
   - Two concurrent browser sessions: verify both avatars see each other move with name tags and zero rubber-banding.
4. **D. Furniture & Loft Privacy**:
   - Place, rotate, and remove furniture; verify changes appear instantly on second client.
   - Doorbell queue and owner admit/deny logic operates cleanly.
5. **E. Economy, Shop, Crafting & Fishing**:
   - Buy item from shop → balance debited, item added to inventory.
   - Start workshop craft → timer decrements, claim awards item.
   - Fishing dock in Haven Park → bite, tension meter mini-game, coin award, weekly leaderboard update.
6. **F. Social & Chat**:
   - Send friend request / accept.
   - In-world chat: verify profanity filtering and rate limiting after 5 messages in 3 seconds.

---

### Task 5: Final Sign-Off & Release Commit
1. Document the manual QA pass results in `docs/10_TEST_PLAN.md`:
   - Mark Criteria 4 & 5 in Section 8 as **MET**.
2. Commit final release status:
   ```bash
   git add docs/10_TEST_PLAN.md docs/11_CLIENT_FEATURE_TRACEABILITY.md
   git commit -m "docs(release): certify Alpha QA pass, live deployment verification, and invite distribution"
   ```
