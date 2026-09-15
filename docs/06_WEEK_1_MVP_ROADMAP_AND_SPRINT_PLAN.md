# Week 1 MVP Roadmap & Long-Term Production Sprint Plan

## 1. Objective: "The Main App Ready by Next Week"
The goal of Week 1 is to take the project from architectural concept to a **fully functioning, playable, interactive multiplayer app** that can be loaded in a browser or desktop launcher, allowing players to customize an avatar, walk around an aesthetic room, chat in real-time with speech bubbles, place furniture, switch rooms, and play an interactive coin-earning mini-game.

---

## 2. Seven-Day Rapid MVP Execution Schedule

### Day 1: Project Spine & Multiplayer Networking Foundation
- [x] Establish project repo structure, configurations, and npm toolchain.
- [x] Build lightweight, high-performance Node.js WebSocket multiplayer server.
- [x] Implement room management (Central Plaza and Personal Sanctuary Loft).
- [x] Client connection, heartbeat ping/pong, and graceful disconnection handling.

### Day 2: 2.5D Isometric Rendering & Smooth Click-to-Walk
- [x] Build 2D HTML5 Canvas rendering loop at 60 FPS.
- [x] Implement isometric floor grid rendering and coordinate conversion (`screenToIso` and `isoToScreen`).
- [x] Click-to-move input handler with target indicator.
- [x] Linear interpolation (`lerp`) for silky-smooth avatar walking across network frames.

### Day 3: Real-Time Avatar Customization & Overhead Speech Bubbles
- [x] Character customizer UI (Skin tones, hair styles, clothing colors, and custom usernames).
- [x] Multi-player visual synchronization (see all active avatars move and face walking directions).
- [x] Overhead comic-style speech bubbles that follow moving avatars with automatic 6-second fade-out.
- [x] Persistent room chat log with timestamps and player names.

### Day 4: Room Decorating / Pad Builder Mode (MegaPlanet Inspired)
- [x] "Edit Room" mode toggle with grid preview overlay.
- [x] Furniture catalog: Cozy Sofa, Retro TV, Monstera Houseplant, Low Coffee Table, Neon Arcade Sign, and Arcade Cabinet.
- [x] Click-to-place, drag-to-reposition, and rotation controls.
- [x] Dynamic Z-ordering so avatars walk in front of or behind placed furniture based on vertical depth.

### Day 5: Economy & Mini-Game Prototype ("Pizza Chef" / "Coin Rush")
- [x] Coin balance system tracked in client and server memory.
- [x] Daily Login Reward claim button granting 250 HavenCoins.
- [x] In-game interactive arcade mini-game ("Sanctuary Pizza Chef"):
  - Time-attack recipe assembly (crust, sauce, cheese, toppings).
  - Score calculations and coin payouts awarded upon completion.

### Day 6: Multi-Room Navigation & Portals (YoWorld Inspired)
- [x] Navigation bar to toggle between public spaces (Central Plaza) and private spaces (Personal Loft).
- [x] Room permissions (owner controls, room title, like count).
- [x] Doorway teleport mechanics.

### Day 7: Testing, Polish & Cross-Platform Packaging
- [x] Polish aesthetic design: cozy pastel & dark-mode styling, subtle particle effects, audio chimes.
- [x] Verify multi-client synchronization (test 2+ browser tabs moving and chatting concurrently).
- [x] Create one-step startup scripts (`npm start`) and Capacitor/Electron packaging configurations.

---

## 3. Long-Term Production Roadmap (Months 1–6)

### Phase 2 (Month 2): Persistent Cloud Storage & Authentication
- Integrate Supabase or PostgreSQL + Prisma for permanent user accounts, saved room layouts, and persistent inventories.
- User authentication with email/password and Apple/Google social sign-in.
- Full inventory and shop catalog with 100+ furniture and clothing items.

### Phase 3 (Month 3): Advanced Social Systems & Safe Trading
- Secure Two-Step Escrow Trade Window for safe player-to-player item and coin exchange.
- Friends List, online status indicators, and private direct messaging (whispers).
- Public Events Board where players pay a small coin fee to broadcast parties, outfit contests, and trivia nights.

### Phase 4 (Month 4): Native Packaging & Cross-Platform Launch
- Configure **Capacitor** for native iOS App Store release (utilizing native Apple Pay, push notifications).
- Configure **Electron / Tauri** for one-click desktop app on macOS and Windows.
- Controller and touch-screen gesture optimization.

### Phase 5 (Months 5–6): Live-Ops & Community Flourishing
- Seasonal themed collections (Autumn Cozy, Winter Solstice, Cherry Blossom Spring).
- Additional mini-games: Mythical Lake Fishing and Multiplayer Trivia Lounge.
- Creator tools: allow players to design and submit custom clothing textures and furniture for revenue share.
