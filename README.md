# HavenWorld (HavenWorld) 🌸
> **A cozy social virtual world to escape from reality, express creativity, and connect with friends.**

*Inspired by the room-building craft and nostalgic mini-games of **MegaPlanet / MiniPlanet** and the rich social economy, housing estates, and player-driven events of **YoWorld**.*

---

## 📚 Project Documentation Suite (`docs/`)

Explore the complete architectural and design blueprints created for this project:

1. [**01_COMPREHENSIVE_GAME_DECONSTRUCTION.md**](docs/01_COMPREHENSIVE_GAME_DECONSTRUCTION.md)
   - Deep mechanical dive into MegaPlanet (`megaplanetgame.com`, by Raging Bull Games) and YoWorld (`yoworld.com`, by Big Viking Games).
   - Analysis of avatar systems, room builders, surface parenting, door-linking estates, dual-currency economies, and player-hosted events.

2. [**02_TRADEMARK_AND_NAMING_ANALYSIS.md**](docs/02_TRADEMARK_AND_NAMING_ANALYSIS.md)
   - Trademark risk breakdown for the name "MiniWorld" (prior international registration by Shenzhen Miniwan Technology Co., Ltd. with 400M+ players).
   - Vetted brand candidates: **HavenWorld** (recommended), **CosmoPlex**, **VibeWorld**, **OmniPlanet**.

3. [**03_BROWSER_VS_APP_DECISION_MATRIX.md**](docs/03_BROWSER_VS_APP_DECISION_MATRIX.md)
   - Complete technical comparison: Pure Web Browser vs. Native Mobile/Desktop App vs. Hybrid Wrapper.
   - Analysis of friction, social room link virality, 97% Stripe margins vs. 30% App Store cuts, and our recommended **Web-First with Capacitor/Electron Hybrid** architecture.

4. [**04_GAME_DESIGN_DOCUMENT.md**](docs/04_GAME_DESIGN_DOCUMENT.md)
   - The master GDD: Core loops, avatar customization, modular room/sanctuary building, safe two-step escrow trading, mini-games suite, and player-run event directory.

5. [**05_SYSTEM_ARCHITECTURE_AND_NETWORKING.md**](docs/05_SYSTEM_ARCHITECTURE_AND_NETWORKING.md)
   - Real-time client-server architecture, WebSocket protocol specification, spatial room instancing, database schema, and moderation safeguards.

6. [**06_WEEK_1_MVP_ROADMAP_AND_SPRINT_PLAN.md**](docs/06_WEEK_1_MVP_ROADMAP_AND_SPRINT_PLAN.md)
   - Seven-day day-by-day sprint plan to take the runnable MVP into a polished alpha, followed by a 6-month production roadmap.

---

## ⚡ Quickstart: Running the Week 1 MVP

The codebase in this repository is a **fully working, interactive multiplayer application**. You can start it up and test it with multiple players in under 60 seconds:

### 1. Install Dependencies
Open your terminal in this directory (`/Users/danielstevens/Developer/HavenWorld`):
```bash
npm install
```

### 2. Launch the Multiplayer Server
```bash
npm start
```
*You will see the console announce:*
```text
====================================================
🚀 HavenWorld Multiplayer Server Online
📡 Local Web Client: http://localhost:3000
🌐 Real-Time WebSockets active on port 3000
====================================================
```

### 3. Test Multiplayer in Real-Time
1. Open **two separate browser windows or tabs** to `http://localhost:3000`.
2. Notice how each player gets an independent avatar in the room.
3. Click on the floor in Tab 1 to walk—watch the avatar walk smoothly in Tab 2 in real time!
4. Type a message in the chat box or click quick emotes (👋, 💖, 💃)—watch the **overhead speech bubble** appear floating over the avatar's head in both tabs with automatic fade-out.
5. Click **"👤 Wardrobe"** to customize skin tone, hair color, and clothing.
6. Click **"🍕 Pizza Chef"** to launch the interactive time-attack cooking mini-game and earn HavenCoins.
7. Switch locations to **"🏡 My Personal Sanctuary Loft"** and click **"🛠️ Decorate"** to place and clear furniture on your personal isometric floor!

---

## 📱 Packaging for Mobile (iOS) & Desktop (macOS)

Because the client is built on clean modern web standards (HTML5 Canvas + WebSockets):

### For iOS App Store (via Capacitor)
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init HavenWorld com.havenworld.game --web-dir src/public
npx cap add ios
npx cap open ios
```
*This opens directly in Xcode as a native Swift/WKWebView app with native push notifications, full screen layout, and Apple Pay readiness.*

### For macOS / Windows Desktop App (via Electron)
```bash
npm install electron --save-dev
```
Add an `electron.js` wrapper pointing to `http://localhost:3000` or the production web host to produce a standalone native `.app` / `.dmg` installer.
