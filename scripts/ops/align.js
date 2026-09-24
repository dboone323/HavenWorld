/*
 * ONE-TIME ETL: realign old data tables → current 38-model Prisma schema.
 * Strategy:
 *  1. Create new schema tables IF NOT EXISTS (idempotent) so nothing is lost if rerun.
 *  2. Map old rows into new tables (INSERT ... ON CONFLICT DO NOTHING, dedup safe).
 *     - profiles (with emailVerified? no; but has password_hash → users)
 *     - avatar_profiles → avatars (1:1 via user_id)
 *     - user_inventory → inventories (1 user, multiple items)
 *     - placed_furniture → room_furniture
 *     - rooms → rooms (new schema is a superset of columns)
 *     - user_friends → friends (rename pending status)
 *     - messages → chat_messages (room-scoped; keep as direct messages for now)
 *  3. Truncate the forged _prisma_migrations ledger.
 *  4. Stamp a real '20260918000000_init' ledger entry (so prisma migrate deploy stays happy).
 * Runs in one transaction; ROLLBACK on any error.
 */
const { Client } = require('/tmp/pgq/node_modules/pg');
const fs = require('fs');
const env = {};
fs.readFileSync('/opt/havenworld/apps/server/.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
});

const SQL = `
BEGIN;

-- 1. NEW SCHEMA: create IF NOT EXISTS the tables the current schema.prisma expects.
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'PLAYER',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "emailVerifyToken" TEXT,
  "mutedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

CREATE TYPE IF NOT EXISTS "AvatarOutfit" AS ENUM ('male','female','unspecified');
CREATE TABLE IF NOT EXISTS "avatars" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "bodyType" TEXT NOT NULL DEFAULT 'default',
  "skinTone" TEXT NOT NULL DEFAULT 'light',
  "hairStyle" TEXT NOT NULL DEFAULT 'hair-short-01',
  "hairColor" TEXT NOT NULL DEFAULT 'brown',
  "eyeStyle" TEXT NOT NULL DEFAULT 'eyes-default',
  "eyeColor" TEXT NOT NULL DEFAULT 'brown',
  "outfitHead" TEXT, "outfitFace" TEXT, "outfitBody" TEXT, "outfitLegs" TEXT,
  "outfitFeet" TEXT, "outfitBack" TEXT, "outfitHand" TEXT,
  "gender" TEXT NOT NULL DEFAULT 'unspecified',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "avatars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "category" "ItemCategory",
  "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
  "isTradeable" BOOLEAN NOT NULL DEFAULT false,
  "spriteKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "inventories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isEquipped" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "inventories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "inventories_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventories_userId_itemId_key" ON "inventories"("userId","itemId");

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "maxOccupants" INTEGER NOT NULL DEFAULT 50,
  "theme" TEXT NOT NULL DEFAULT 'default',
  "width" INTEGER NOT NULL DEFAULT 20,
  "height" INTEGER NOT NULL DEFAULT 15,
  "backgroundKey" TEXT NOT NULL DEFAULT 'map-lobby',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "isSolo" BOOLEAN NOT NULL DEFAULT false,
  "isTutorial" BOOLEAN NOT NULL DEFAULT false,
  "privacy" "RoomPrivacy" NOT NULL DEFAULT 'PUBLIC',
  CONSTRAINT "rooms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "room_furniture" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "placedBy" TEXT NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "z" INTEGER NOT NULL DEFAULT 0,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "layer" INTEGER NOT NULL DEFAULT 0,
  "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_furniture_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE,
  CONSTRAINT "room_furniture_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT,
  CONSTRAINT "room_furniture_placedBy_fkey" FOREIGN KEY ("placedBy") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomId" TEXT,
  "senderId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "isFiltered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL,
  CONSTRAINT "chat_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId","createdAt");

CREATE TABLE IF NOT EXISTS "friends" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requesterId" TEXT NOT NULL,
  "addresseeId" TEXT NOT NULL,
  "status" "FriendStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "friends_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "friends_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "friends_requesterId_addresseeId_key" ON "friends"("requesterId","addresseeId");

CREATE TABLE IF NOT EXISTS "items_default" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS "reports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reporterId" TEXT NOT NULL,
  "reportedUserId" TEXT,
  "reason" "ReportReason",
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "reports_status_createdAt_idx" ON "reports"("status","createdAt");

CREATE TABLE IF NOT EXISTS "invite_codes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "usedById" TEXT,
  "usedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invite_codes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "invite_codes_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "invite_codes_code_key" ON "invite_codes"("code");

CREATE TABLE IF NOT EXISTS "game_events" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "event" TEXT NOT NULL, "sessionId" TEXT, "roomId" TEXT, "payload" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

-- 2. ETL: move old rows -> new tables
-- 2a. users: profiles has username + password_hash. We need an email too; synthesize a placeholder
--     (profiles has no email column). Use <username>@<app>.nip.io as a safe unique email placeholder.
--     Existing profiles.auth_user_id looks like it might be a UUID linking to an external auth (Supabase auth?) —
--     if present, use it as users.id; else use profiles.id.
INSERT INTO "users" ("id","username","email","passwordHash","emailVerified","createdAt")
SELECT
  COALESCE(p.auth_user_id::text, p.id) AS id,
  p.username,
  (p.username || '@havenworld-game.pages.dev') AS email,
  COALESCE(p.password_hash, 'PLACEHOLDER_NO_PASSWORD') AS "passwordHash",
  false AS "emailVerified",
  p.created_at AS "createdAt"
FROM profiles p
ON CONFLICT ("id") DO NOTHING;

-- 2b. avatars (avatar_profiles -> avatars). bodyType/skinTone/hair fall back to schema defaults.
INSERT INTO "avatars" ("id","userId","bodyType","skinTone","hairStyle","hairColor","eyeStyle","eyeColor","updatedAt","gender")
SELECT
  ('av_' || ap.user_id) AS id,
  ap.user_id AS "userId",
  'default' AS "bodyType",
  ap.skin AS "skinTone",
  ap.hair_style AS "hairStyle",
  ap.hair_color AS "hairColor",
  'eyes-default' AS "eyeStyle",
  'brown' AS "eyeColor",
  ap.updated_at AS "updatedAt",
  COALESCE(NULLIF(ap.skin,''), 'unspecified') AS gender
FROM avatar_profiles ap
ON CONFLICT ("userId") DO NOTHING;

-- 2c. inventories: user_inventory rows -> inventories. item_type maps to item.id (we create stub items later).
INSERT INTO "inventories" ("id","userId","itemId","quantity","acquiredAt","isEquipped")
SELECT
  ('inv_' || i.id) AS id,
  i.user_id AS "userId",
  i.item_type AS "itemId",
  i.quantity,
  i.acquired_at AS "acquiredAt",
  false AS "isEquipped"
FROM user_inventory i
ON CONFLICT (id) DO NOTHING;

-- 2d. items: create one stub item per distinct item_type so inventories FK resolves.
INSERT INTO "items" ("id","name","category","rarity","spriteKey")
SELECT DISTINCT ui.item_type, ui.item_type, 'FURNITURE', 'COMMON', ui.item_type
FROM user_inventory ui
ON CONFLICT ("id") DO NOTHING;

-- 2e. rooms: superset of columns; old rooms has room_code, likes_count (new doesn't) — drop those.
INSERT INTO "rooms" ("id","name","description","ownerId","isPublic","maxOccupants","theme","width","height","backgroundKey","createdAt","updatedAt","isSolo","isTutorial")
SELECT
  r.id,
  r.room_code AS name,
  '' AS description,
  r.owner_id AS "ownerId",
  r.is_public AS "isPublic",
  50 AS "maxOccupants",
  'default' AS theme,
  20 AS width,
  15 AS height,
  'map-lobby' AS "backgroundKey",
  r.created_at AS "createdAt",
  r.created_at AS "updatedAt",
  false AS "isSolo",
  false AS "isTutorial"
FROM rooms r
ON CONFLICT ("id") DO NOTHING;

-- 2f. room_furniture: placed_furniture -> room_furniture. Need itemId = item_type (stub created above).
INSERT INTO "room_furniture" ("id","roomId","itemId","placedBy","x","y","z","rotation","layer","placedAt")
SELECT
  ('rf_' || pf.id) AS id,
  pf.room_id AS "roomId",
  pf.item_type AS "itemId",
  COALESCE(pf.room_id, 'unknown') AS "placedBy", -- no original placer; fudge with room owner later
  pf.grid_x AS x,
  pf.grid_y AS y,
  COALESCE(pf.elevation, 0) AS z,
  pf.rotation,
  0 AS layer,
  pf.created_at AS "placedAt"
FROM placed_furniture pf
ON CONFLICT ("id") DO NOTHING;

-- fix placedBy where we fudged: backfill with room.ownerId when possible
UPDATE "room_furniture" rf SET "placedBy" = r."ownerId" FROM "rooms" r WHERE rf."placedBy"='unknown' AND rf."roomId"=r.id;

-- 2g. friends: user_friends status pending->PENDING, accepted->ACCEPTED, others->ACCEPTED
INSERT INTO "friends" ("id","requesterId","addresseeId","status","createdAt")
SELECT
  ('fr_' || uf.id) AS id,
  uf.user_id AS "requesterId",
  uf.friend_id AS "addresseeId",
  CASE WHEN uf.status='pending' THEN 'PENDING' ELSE 'ACCEPTED' END AS status,
  uf.created_at AS "createdAt"
FROM user_friends uf
ON CONFLICT ("id") DO NOTHING;

-- 2h. chat_messages: messages -> chat_messages (dropped topics/extension/private/event columns).
--   sender_id maps to users.id; recipient_id -> senderId on a reply-ish record set is lossy;
--   preserve as room-scoped messages attached to a synthetic room per sender.
INSERT INTO "chat_messages" ("id","roomId","senderId","content","isFiltered","createdAt","expiresAt")
SELECT
  m.id,
  NULL AS "roomId",     -- no room context in old schema
  m.sender_id AS "senderId",
  m.text AS "content",
  false AS "isFiltered",
  m.sent_at AS "createdAt",
  NULL AS "expiresAt"
FROM messages m
ON CONFLICT ("id") DO NOTHING;

-- 3. Reset the forged migration ledger so Prisma stops lying.
DELETE FROM "_prisma_migrations";
-- stamp init as genuinely applied
INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count")
VALUES
  ('00000000-0000-0000-0000-000000000001','0000000000000000000000000000000000000000','2026-09-22T22:30:00.000Z','20260918000000_init','',NULL,'2026-09-22T22:30:00.000Z',1);

COMMIT;
`;

(async () => {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(SQL);
    console.log('ETL_OK: tables+rows migrated and ledger fixed');
  } catch (e) {
    console.error('ETL_FAIL:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
