# Game Design Document (GDD): HavenWorld (Codename: MiniWorld)

## 1. Vision, Theme & Emotional Hook

### 1.1 The High Concept
**HavenWorld** is an interactive, browser-and-app social virtual world designed as a cozy, tranquil sanctuary for players seeking to escape daily stress, decompress, and express their creativity. Combining the responsive, charming room-decorating and mini-game craft of *MegaPlanet / MiniPlanet* with the rich social economy, housing networks, and player-driven events of *YoWorld*, HavenWorld provides a warm, nostalgic "third place" on the internet.

### 1.2 The Marketing Anchor: "Your Escape from Reality"
- **The Modern Problem**: Traditional social networks are high-friction, toxic, algorithmic, and anxiety-inducing. Most modern MMOs require relentless grinding or intense competitive focus.
- **The HavenWorld Solution**: A low-stakes, gentle digital realm where the player is in complete control of their personal space, their aesthetic, and their social interactions.
- **Core Pillars**:
  1. **Comfort & Sanctuary**: Warm visual tones, customizable lighting, chill lo-fi ambient audio, and peaceful personal pads.
  2. **Unbounded Creative Expression**: Deep avatar styling and modular room architecture with multi-layer surface parenting.
  3. **Genuine Social Connection**: Real-time room chat, animated emotes, safe player trading, and player-hosted community gatherings.
  4. **Bite-Sized Joy**: Engaging, lighthearted mini-games (Pizza Chef, Fishing, Arcade) that reward effort without punishing failure.

---

## 2. Core Gameplay Loops

### 2.1 The Micro-Loop (Minute-to-Minute)
1. **Arrive & Socialize**: Walk into a vibrant public lounge or friend's loft; see avatars moving in real-time; chat with speech bubbles.
2. **Play or Labor**: Play a 90-second round of *Pizza Chef* or cast a line into the lake to reel in a rare fish.
3. **Earn**: Collect HavenCoins, experience points, and rare item drops.
4. **Decorate & Polish**: Open personal inventory, place newly unlocked retro furniture, adjust room lighting, and fine-tune your outfit.

### 2.2 The Macro-Loop (Day-to-Day & Week-to-Week)
1. **Daily Ritual**: Log in for daily streak bonuses, check notifications, send free daily gifts to friends, and water cozy plants.
2. **Community Events**: Check the **Events Board** to attend an evening Outfit Contest, a themed auction, or a roleplay cafe hosted by another player.
3. **Commerce & Collecting**: Trade rare seasonal items in the Trade Plaza; buy limited-run collection drops before they retire.
4. **Expansion**: Link newly purchased rooms into a sprawling multi-room penthouse, private nightclub, or public museum.

---

## 3. Avatar & Customization Systems

### 3.1 Modular Layering Architecture
Avatars are constructed using a multi-layer 2D sprite composite system:
- **Base Layer**: Skin Tone (broad inclusive palette + fantasy shades like pastel lavender, mint, and starlight blue).
- **Face Layer**: Eyes, eyebrows, nose, mouth/expression (animated blinking and talking states).
- **Hair Layer**: Base hair, highlights, and hats/headpieces with dynamic tinting via color pickers and chat commands (`/colour hex`).
- **Clothing Layers**:
  - Inner Top (undershirts, tees)
  - Outer Top (jackets, hoodies, cardigans)
  - Bottoms (jeans, skirts, shorts, sweatpants)
  - Footwear (sneakers, boots, sandals, cozy slippers)
  - Handheld Accessories (coffee mug, sparkler, fishing rod, retro handheld console)
  - Back/Aura Accessories (fairy wings, backpacks, celestial dust)

### 3.2 Social Gestures & Emotes
- **Locomotion**: 8-directional click-to-walk with smooth pathfinding and idle stances.
- **Action Triggers**: Sit on furniture (chairs, sofas, cushions with snapped sit nodes), Dance, Wave, Cheer, Laugh, Cry, Sleep.
- **Overhead Expressions**: Pop-up emojis (hearts, smiles, sweat drops, lightbulb) above avatar heads.

---

## 4. Personal Sanctuary: The Room & Pad Builder

### 4.1 Room Geometry & Coordinate Grid
- **Perspective**: 2.5D Isometric projection (or 2D side-depth view with layered depth planes).
- **Coordinate Grid**: 16x16 or 24x24 tile grid with fine 0.5-tile sub-positioning.
- **Dynamic Z-Sorting**: Automated depth calculation based on `(Y_pos + Z_elevation)` ensures avatars and objects correctly occlude items behind them.

### 4.2 Multi-Layered Surface Parenting (MegaPlanet Style)
- Objects have metadata specifying whether they can act as a **surface** (e.g., tables, desks, shelves, rugs).
- Placing an item (e.g., coffee mug, lamp, laptop) on top of a table binds the item to the parent surface. Moving the table moves all placed items simultaneously.

### 4.3 Door & Portal Room-Linking (YoWorld Style)
- Players can place interactive "Doorway" objects in any room.
- Linking a door to another owned room creates seamless, instantaneous teleportation, enabling players to create sprawling multi-room estates, hotels, mazes, and themed community spaces.

### 4.4 Room Administration & Permissions
- **Access Modes**: Public, Friends-Only, Password-Protected, Locked.
- **Visitor Tools**: Guestbook where visitors can leave sweet messages; "Like Pad" button that increments the room's public popularity rank.
- **Safe Controls**: Kick, Ban, and Mute tools for room owners to guarantee a safe, welcoming atmosphere.

---

## 5. Multiplayer Communication & Social Engine

### 5.1 Real-Time Chat Infrastructure
- **Overhead Speech Bubbles**: Messages appear instantly above the avatar's head in comic-style rounded bubbles, fading out after 6 seconds.
- **Chat Dock**: A persistent semi-transparent scrollable chat log on the bottom-left with tabs:
  - `Room`: Messages from players in the current room.
  - `Whisper / Direct Message`: Private, end-to-end user communications.
  - `Club / Guild`: Shared channel for player social circles.
  - `System`: Notifications, mini-game score announcements, and trade alerts.

### 5.2 Safe-Space Moderation
- Real-time client & server-side regex and dictionary filtering for hate speech, harassment, personal information (PII), and phishing URLs.
- Automated shadow-muting and quick-report reporting pipeline with chat log snapshots for moderators.

---

## 6. The Economy & Commerce Engine

### 6.1 Dual-Currency Model
1. **HavenCoins (Soft Currency)**:
   - *Sources*: Daily login rewards, mini-games (*Pizza Chef*, *Fishing*), factory work shifts, room likes received.
   - *Sinks*: Standard furniture catalog, basic clothing, room creation fees, event board listings.
2. **HavenGems (Hard Currency)**:
   - *Sources*: In-app purchase (via Stripe / App Store), rare milestone achievements, special holiday giveaways.
   - *Sinks*: Limited-edition luxury designer collections, premium animated items, exclusive estate shells, pets.

### 6.2 The Secure Trade Window (Anti-Scam Architecture)
Player-to-player trading follows a strict, non-reversible **Two-Step Escrow Handshake**:
1. Both players place items and currency in their respective trade slots.
2. Step 1: Both click **"Ready to Trade"** (locking items in place; any change to items automatically cancels the lock).
3. Step 2: A 3-second review countdown triggers, followed by both clicking **"Confirm Trade"**.
4. Items and balances transfer atomically on the server in a single database transaction.

---

## 7. Mini-Games & Leisure Activities

### 7.1 "Sanctuary Pizza Chef" (Arcade Job)
- Inspired by MegaPlanet’s signature favorite.
- Fast-paced, cozy culinary time-management game.
- Customers arrive with pizza orders (e.g., Thin Crust + Pesto + Mozzarella + Mushrooms + Basil).
- Players click ingredients in sequence, bake, slice, and serve before the patience meter depletes.
- High combo streaks trigger upbeat musical flourishes and bonus coin multipliers.

### 7.2 "Mythical Fishing" (Chill Activity)
- Players cast a line into public lakes, rivers, and oceans.
- Visual bobber mechanic: wait for the splash, click at the rhythm prompt.
- Catches range from Common Sunfish to legendary Starlight Koi, with an in-game Angler's Encyclopedia to complete.

### 7.3 Casual Parlor Games
- Built-in two-player table games: Connect Four, Tic-Tac-Toe, Checkers, and Trivia, playable by clicking game tables placed in public lounges or private homes.

---

## 8. Player-Driven Events Engine (YoWorld Style)
- Any player can list an event on the **Server Event Directory** for a nominal 100 HavenCoins fee.
- Categories:
  - **Outfit & Fashion Contests**: Host awards coins to the best-dressed avatar based on themes (e.g., "Cozy Autumn", "Retro 90s Cyber", "Fantasy Royalty").
  - **Auctions & Swap Meets**: Selling rare collectibles.
  - **Chill Hangouts / Music Lounges**: Listening to shared music streams and roleplaying.
- Players can browse active events sorted by attendee count, click **"Join Event"**, and teleport instantly to the host's room.
