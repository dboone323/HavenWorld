# System Architecture & Real-Time Networking Specification

## 1. High-Level Architecture Overview

```
+-------------------------------------------------------------------------+
|                              CLIENT TIER                                |
|  [ Modern Web Browsers ]   [ Desktop App (Electron) ]   [ iOS App (Capacitor) ]
|             |                         |                          |
|             +-------------------------+--------------------------+
|                                       |
|                  +--------------------+--------------------+
|                  | HTML5 Canvas / PixiJS Graphics Engine   |
|                  | Web Audio API Sound System               |
|                  | WebSocket Real-Time Client (JSON/Binary) |
|                  +--------------------+--------------------+
+---------------------------------------|---------------------------------+
                                        | (WSS / HTTPS)
+---------------------------------------v---------------------------------+
|                              SERVER TIER                                |
|  +-------------------------------------------------------------------+  |
|  | Reverse Proxy / Edge TLS Gateway (Nginx / Cloudflare)             |  |
|  +-------------------------------------------------------------------+  |
|                                       |                                 |
|  +------------------------------------+------------------------------+  |
|  | Node.js / TypeScript Real-Time Multiplayer Server                |  |
|  | - WebSocket Connection Manager                                    |  |
|  | - Authoritative Room State Manager (Instances & Portals)          |  |
|  | - Chat Filter & Moderation Guard                                  |  |
|  | - Mini-Game & Economy Transaction Engine (Atomic Locks)          |  |
|  +------------------------------------+------------------------------+  |
|                                       |                                 |
|  +-------------------+----------------+---------------+                 |
|  |                   |                                |                 |
|  v                   v                                v                 |
| [ Redis Cluster ]  [ PostgreSQL / SQLite ]         [ Cloud Storage S3 ] |
| (Pub/Sub & Rooms)  (Users, Items, Rooms, Trades)   (Static Sprite Assets)|
+-------------------------------------------------------------------------+
```

---

## 2. Real-Time WebSocket Protocol Specification

All communication between the client and server uses a strongly-typed JSON (or MessagePack for production efficiency) protocol over secure WebSockets (`wss://`).

### 2.1 Message Envelope
Every packet adheres to this standard schema:
```json
{
  "type": "MESSAGE_TYPE_STRING",
  "payload": {},
  "timestamp": 1788893000000
}
```

### 2.2 Core Inbound Packets (Client -> Server)
| Packet Type | Description | Payload Schema |
| :--- | :--- | :--- |
| `JOIN_ROOM` | Client requests to enter a specific room | `{ "roomId": "plaza" \| "user_room_id", "password": null }` |
| `MOVE_TO` | Player clicks destination tile on the canvas | `{ "targetX": 450, "targetY": 320 }` |
| `SEND_CHAT` | Player submits a message | `{ "text": "Welcome to my new loft!", "channel": "room" }` |
| `PLACE_ITEM`| Player places furniture in their owned room | `{ "itemId": "sofa_retro_01", "gridX": 4, "gridY": 6, "rotation": 0, "parentSurfaceId": null }` |
| `MOVE_ITEM` | Player relocates or rotates placed furniture | `{ "placedItemId": "inst_9918", "gridX": 5, "gridY": 6, "rotation": 90 }` |
| `REMOVE_ITEM`| Player returns placed furniture to inventory | `{ "placedItemId": "inst_9918" }` |
| `MINIGAME_SCORE` | Report mini-game completion | `{ "gameId": "pizza_chef", "score": 450, "accuracy": 0.98, "checksum": "hash" }` |

### 2.3 Core Outbound Packets (Server -> Client)
| Packet Type | Description | Payload Schema |
| :--- | :--- | :--- |
| `ROOM_STATE`| Initial snapshot sent upon joining a room | `{ "roomId": "...", "name": "...", "players": [...], "furniture": [...] }` |
| `PLAYER_JOINED`| Broadcast when another player enters | `{ "player": { "id": "...", "name": "...", "x": 100, "y": 200, "avatar": {...} } }` |
| `PLAYER_MOVED` | Broadcast when a player starts walking | `{ "playerId": "...", "startX": 100, "startY": 200, "targetX": 300, "targetY": 250, "speed": 180 }` |
| `PLAYER_LEFT` | Broadcast when a player leaves or disconnects| `{ "playerId": "..." }` |
| `CHAT_BROADCAST`| Broadcast speech bubble & chat log entry | `{ "playerId": "...", "senderName": "...", "text": "...", "channel": "room" }` |
| `ROOM_UPDATED` | Broadcast when furniture is placed or moved | `{ "action": "PLACE" \| "REMOVE", "item": {...} }` |

---

## 3. Authoritative Room Simulation & Movement Smoothing

### 3.1 Server-Authoritative Movement Validation
To prevent teleportation hacks and collision clipping:
1. When the client clicks to walk, it emits `MOVE_TO` with target coordinates.
2. The server calculates the valid path using standard grid traversal (A* or raycast line-of-sight against static room colliders).
3. The server broadcasts `PLAYER_MOVED` with origin, target, and speed.
4. Clients smoothly interpolate avatar position at 60 FPS using linear interpolation (`lerp`) with timestamp delta.

### 3.2 Spatial Partitioning & Room Instancing
- Each room operates as an independent channel / pub-sub topic.
- A player in "Personal Sanctuary A" receives zero network traffic from "Central Plaza B".
- High-density public rooms (like Central Plaza) automatically shard into numbered instances (e.g., `Plaza #1`, `Plaza #2`) capped at 40 concurrent avatars to prevent visual clutter and frame rate drops.

---

## 4. Database Schema Specification (Relational)

### 4.1 Users & Economy
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    haven_coins BIGINT DEFAULT 1000 NOT NULL,
    haven_gems INT DEFAULT 50 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE avatar_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    skin_tone VARCHAR(16) NOT NULL,
    hair_style VARCHAR(32) NOT NULL,
    hair_color VARCHAR(16) NOT NULL,
    top_clothing VARCHAR(32) NOT NULL,
    bottom_clothing VARCHAR(32) NOT NULL,
    shoes VARCHAR(32) NOT NULL,
    accessory VARCHAR(32),
    status_message VARCHAR(128)
);
```

### 4.2 Rooms & Multi-Layered Furniture
```sql
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(64) NOT NULL,
    description TEXT,
    wallpaper_id VARCHAR(32) DEFAULT 'cozy_brick',
    floor_id VARCHAR(32) DEFAULT 'hardwood_oak',
    is_public BOOLEAN DEFAULT TRUE,
    likes_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE placed_furniture (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    item_definition_id VARCHAR(64) NOT NULL,
    grid_x FLOAT NOT NULL,
    grid_y FLOAT NOT NULL,
    elevation INT DEFAULT 0,
    rotation INT DEFAULT 0, -- 0, 90, 180, 270
    parent_surface_id UUID REFERENCES placed_furniture(id) ON DELETE SET NULL
);
```

---

## 5. Security, Moderation & Anti-Griefing

1. **Trade Atomicity**: Transactions execute inside explicit `BEGIN TRANSACTION ... COMMIT` blocks with item locking. If either player disconnects or alters items, rollback is triggered instantly.
2. **Rate Limiting**: WebSocket messages are throttled per connection (max 10 chat messages per 10 seconds; max 8 move requests per second).
3. **Chat Sanitization**: All inbound text is filtered against a bad-words dictionary and HTML-escaped to prevent XSS.
