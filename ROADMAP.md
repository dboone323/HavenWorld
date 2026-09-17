# 🗺️ HavenWorld Roadmap

HavenWorld is an open-source, cozy isometric multiplayer virtual world inspired by the nostalgic magic of YoWorld and MegaPlanet, engineered with modern web standards, server authority, and a 100% free-tier deployment stack.

---

## 📍 Phase Progress & Status

| Phase | Milestone | Status | Key Deliverables |
| :--- | :--- | :---: | :--- |
| **Phase 0** | **Monolithic Core & Server Authority** | ✅ Complete | Native WebSocket engine (`ws`), 20Hz delta tick simulation, SQLite WAL + Supabase dual-storage, A* pathfinding, isometric rendering, CI test suite. |
| **Phase 1** | **Social Loop, Economy & Governance** | ✅ Complete | Dynamic room instancing, personal sanctuary lofts, dual-currency (Coins & Gems), live P2P trading, daily rewards, sound synthesis, legal terms/privacy, admin moderation dashboard, alpha invite gating. |
| **Phase 2** | **World Expansion & Immersion** | 🚀 In Progress | +125% enlarged playable viewport (96×48 tiles), 3D volumetric furniture rendering, 4-way object rotation, multi-room loft expansions, dynamic ambient moods (day/dusk/night), interactive whiteboard. |
| **Phase 3** | **Minigames, Crafting & Social Systems** | 🔄 Next Up | Pizza Chef mini-game loop, recycling & material crafting (scrap & timber), pet companion AI, guestbook & profile likes, VIP club tier. |
| **Phase 4** | **Cross-Platform & Community Scale** | 📋 Planned | iOS (Capacitor), macOS/Windows (Electron), named custom domain (`havenworld.me`), automated UptimeRobot monitoring, public alpha testing group. |

---

## 🎯 Phase 0: Monolithic Core & Server Authority (Done)
- [x] Authoritative 20Hz server tick loop (`src/server/tick.ts`) with client delta interpolation.
- [x] Complete 2:1 isometric projection engine (`src/shared/iso.ts`) with dynamic z-index depth sorting.
- [x] Grid collision matrix and A* pathfinding (`src/shared/pathfinding.ts`).
- [x] Zero-config local SQLite storage with WAL mode + Cloud Supabase PostgreSQL fallback.
- [x] Real functional test suite with 100% real validation (no mocks or stubs).

## 🎯 Phase 1: Social Loop, Economy & Governance (Done)
- [x] Proximity chat with audible radii and server-side moderation (`containsProfanity`, PII redaction).
- [x] Personal Sanctuary Loft rooms for every user with customizable flooring and wallpaper.
- [x] Dual-currency system: earned Coins & premium Gems with daily login bonus.
- [x] Secure 2-way live trading with mutual confirmation locking.
- [x] Web-based Admin Moderation Dashboard (`/admin`) with user mute/ban, reports, and occupancy tracking.
- [x] Alpha Invite Code gating (`ALPHA_INVITE_ONLY` flag + CLI script `scripts/generate-invites.mjs`).
- [x] Complete legal documents (`/terms` & `/privacy`) with alpha disclaimers, COPPA 13+ compliance, and CCPA/GDPR disclosures.

## 🎯 Phase 2: World Expansion & Immersion (Active)
- [x] Viewport expansion (+125% playable area, 96×48 tiles).
- [x] Volumetric 3D canvas styling for all furniture items with depth bevels and drop shadows.
- [x] 4-way furniture rotation (0°, 90°, 180°, 270°) with persisted orientations.
- [x] Multi-room loft expansions (10×10 up to 20×20 grids).
- [x] Ambient room moods (Day, Dusk, Night, Cyberpunk) with dynamic canvas tinting.
- [x] Interactive collaborative whiteboard in sanctuary lofts.

## 🎯 Phase 3: Minigames, Crafting & Social Systems
- [x] Functional Pizza Chef mini-game with topping orders, timers, and coin payouts.
- [x] Workshop & recycling system for converting items into scrap metal and timber for crafting.
- [x] Pet companions (cats & dogs) with autonomous wandering AI and owner following.
- [x] Guestbooks and loft like counters.
- [x] Plaza Fountain Fishing Activity with sweet-spot tension gauge, species weight distribution, and HavenCoins payouts.
- [x] Community marketplace auction house for player-to-player item listings and purchases.
- [ ] Expanded minigame catalog (Fashion runway dress-up contests).

## 🎯 Phase 4: Cross-Platform & Infrastructure
- [x] Oracle Cloud ARM64 Ampere VM (4 OCPU, 24 GB RAM) 100% free-tier deployment.
- [x] Cloudflare Tunnel secure TLS ingress.
- [x] Capacitor iOS app bundle & Electron desktop app wrapper.
- [x] Automated named Cloudflare tunnel deployment script (`deploy/setup-named-tunnel.sh`) for permanent `havenworld.me` binding.
- [x] Automated 24/7 uptime health monitor script with Discord webhook alerts (`scripts/health-check.mjs`).
- [ ] Community Discord integration for alpha bug triage and patch announcements.
