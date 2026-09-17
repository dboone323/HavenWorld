# 🤝 Contributing to HavenWorld

We are thrilled that you want to help build HavenWorld! Whether you are reporting a bug, suggesting a new mini-game, designing isometric furniture, or writing code, your contributions are warmly welcomed.

---

## 🧭 Guiding Principles

1. **Pure Web Standards**: HavenWorld runs directly in the browser with zero heavy engines (no Phaser, no Three.js, no Unity). We rely on vanilla HTML5 Canvas, modern ES Modules, and native WebSockets (`ws`).
2. **Authoritative Server**: The client never tells the server where an avatar is or what items they own. The server simulates world physics, validates movement with A* pathfinding, and manages inventory.
3. **100% Real Functional Tests**: **Never use mocks, placeholders, stubs, or fake tests.** Every test must exercise real functional code with genuine assertions against real state.
4. **100% Free-Tier Architecture**: The server runs on Oracle Cloud Free Tier ARM64 (4 OCPU, 24 GB RAM) backed by local SQLite WAL or free Supabase, exposed through Cloudflare Tunnels.

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js 22+** (supports native TypeScript stripping via `node --check` and `node src/server/server.ts`)
- **npm 10+**

### Quickstart
```bash
# 1. Clone the repository
git clone https://github.com/dboone323/HavenWorld.git
cd HavenWorld

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start development mode (concurrently runs Express server & Vite client)
npm run dev
```

Open your browser to `http://localhost:5173`. The Vite development server will proxy game WebSocket connections to port 3000.

---

## 🧪 Testing Guidelines

Before opening a pull request, all automated tests must pass:

```bash
# Run all automated tests with local SQLite storage
DB_FORCE_SQLITE=1 npm test

# Run syntax check across all server modules
npm run lint

# Build client production bundle
npm run build:web
```

### Writing New Tests
- Place new tests in `tests/*.test.mjs`.
- Use Node.js built-in test runner (`node:test` and `node:assert/strict`).
- Create real fixtures, real database rows, and real WebSocket messages.
- Clean up test databases or run in isolated temporary SQLite databases.

---

## 🌿 Branching & Pull Request Workflow

1. Fork the repo and create your branch from `main`:
   ```bash
   git checkout -b feature/awesome-feature
   ```
2. Commit your changes with clear, descriptive commit messages:
   ```bash
   git commit -m "feat(crafting): add recipe for neon jukebox"
   ```
3. Ensure all tests and lint checks pass:
   ```bash
   npm run lint && DB_FORCE_SQLITE=1 npm test
   ```
4. Push to your fork and submit a Pull Request against the `main` branch.
5. Fill out the PR template detailing what was changed and how you verified it.

---

## 💬 Community & Code of Conduct

HavenWorld is dedicated to providing a harassment-free, welcoming environment for everyone regardless of identity, background, or skill level. Be kind, respectful, and collaborative!
