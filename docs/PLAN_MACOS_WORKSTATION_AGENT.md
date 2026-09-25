# Execution Plan for macOS Workstation Agent (VS Code Insiders on Apple Silicon)

> **Historical environment record.** The absolute path below records the original workstation layout. Current tooling must run from the repository root and must not hardcode a user home directory.

> **Target Environment**: macOS 27 (Apple Silicon arm64), Xcode 27.0 (27A5252f), Swift 6.4, Node v26.7.0  
> **Repository Directory**: `/Users/danielstevens/Developer/HavenWorld`  
> **Remote Origin**: `https://github.com/dboone323/HavenWorld.git` (`main` branch)  
> **CI / Quality Model**: Modeled after `FaceAlterApp` (`make ci` test & coverage gate)

---

## 1. Role & Operating Principles

You are operating as the **Lead Software Engineer & Build Master** on Daniel's Mac workstation.
- **Your Primary Mission**: Author all application code, implement game features, optimize HTML5 Canvas & audio rendering, maintain 100% green test passes, and compile native iOS and macOS binaries.
- **Architectural Boundary**:
  - **Mac is the Single Source of Truth**: All source code, Git commits, and native builds originate here.
  - The remote Linux server is an automated deployment target. You push to `origin/main` on GitHub, and the Linux server pulls.

---

## 2. Step-by-Step Implementation Workflows

### Workflow 1: Local Development & Live Iteration
When implementing game features, avatar mechanics, or room builder tools:

```bash
cd /Users/danielstevens/Developer/HavenWorld

# Start local concurrent development servers
npm run dev
```
- **`dev:server`**: Node.js WebSocket & Express server watching `src/server/server.ts` on port 3000.
- **`dev:web`**: Vite dev server with Hot Module Replacement (HMR) on port 5173.
- **Browser URL**: Open `http://localhost:5173` or `http://localhost:3000` in Safari. Instant <50ms refresh on code changes.

---

### Workflow 2: Quality Gates & Testing Discipline
Before committing any changes to Git, you must pass the three verification gates:

```bash
cd /Users/danielstevens/Developer/HavenWorld

# Gate 1: Strict TypeScript type-check (must return 0 errors)
npm run tsc

# Gate 2: Code syntax linting
npm run lint

# Gate 3: Full CI Gate (unit tests + integration tests + c8 coverage gate >= 70%)
make ci
```
*Never bypass `make ci`. If coverage drops below 70% or any test fails, write or update tests in `tests/` before proceeding.*

---

### Workflow 3: Native iOS Packaging & Xcode Testing (Mac Exclusive)
Because Apple development requires macOS, all iOS builds are generated and verified locally:

```bash
cd /Users/danielstevens/Developer/HavenWorld

# 1. Compile web bundle
npm run build:web

# 2. Sync web bundle into native iOS Capacitor container
npx cap sync ios

# 3. Open in Xcode 27 / launch simulator
npm run cap:dev
```
- Targets **iOS 15.0+** deployment target compatible with Xcode 27 / iOS 27 SDK.
- Full-screen `WKWebView` with native safe-area insets, touch gestures, and haptics.

---

### Workflow 4: Native macOS Desktop Build (Electron)
```bash
cd /Users/danielstevens/Developer/HavenWorld

# Test Electron desktop window locally
npm run dev:desktop

# Package production Apple Silicon arm64 .dmg and .app
npm run build:desktop
```
- Output binaries are stored in `/Users/danielstevens/Developer/HavenWorld/release/`.

---

### Workflow 5: Git Commit & Remote Production Deployment
Once changes pass all local quality checks, commit and push to GitHub, then trigger deployment to the Oracle Cloud server:

```bash
cd /Users/danielstevens/Developer/HavenWorld

# 1. Stage and commit with conventional commit format
git add .
git commit -m "feat(room): implement multi-layer surface parenting grid"

# 2. Push to GitHub
git push origin main

# 3. (Optional) Trigger instantaneous deployment on Oracle Cloud via SSH shortcut:
ssh oracle-cloud "cd ~/Developer/HavenWorld && ./deploy/deploy.sh"
```

---

## 3. Engineering Reference & File Locations

- **Server Logic**: `src/server/server.ts`, `src/server/rooms.ts`, `src/server/db.ts`
- **Client & Canvas Engine**: `src/client/` and `src/public/`
- **Shared Type Definitions**: `src/shared/types/`
- **Vite Configuration**: `vite.config.mjs`
- **Capacitor Configuration**: `capacitor.config.json`
- **Database Schema**: `supabase/schema.sql`
- **Task Tracking**: `TASK_MANIFEST.md`
