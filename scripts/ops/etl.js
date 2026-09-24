const {Client} = require('pg');

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
c.connect().then(() => console.log('connected')).catch(err => { console.error('connect error:', err.message); process.exit(1); });

const run = async () => {
  try {
    await c.query('BEGIN');
    console.log('renaming legacy tables...');
    await c.query('ALTER TABLE IF EXISTS "profiles" RENAME TO "profiles_backup"');
    await c.query('ALTER TABLE IF EXISTS "rooms" RENAME TO "rooms_backup"');
    await c.query('ALTER TABLE IF EXISTS "messages" RENAME TO "messages_backup"');
    await c.query('ALTER TABLE IF EXISTS "user_friends" RENAME TO "user_friends_backup"');
    await c.query('ALTER TABLE IF EXISTS "user_inventory" RENAME TO "user_inventory_backup"');
    await c.query('ALTER TABLE IF EXISTS "placed_furniture" RENAME TO "placed_furniture_backup"');
    await c.query('ALTER TABLE IF EXISTS "avatar_profiles" RENAME TO "avatar_profiles_backup"');
    console.log('cleared forged ledger...');
    await c.query("DELETE FROM _prisma_migrations");
    console.log('creating new tables...');
    // Use inline CHECK constraints, not explicit named CONSTRAINTs
    await c.query(`CREATE TABLE IF NOT EXISTS "users" (
      "id" BIGSERIAL PRIMARY KEY,
      "email" TEXT UNIQUE,
      "passwordHash" TEXT,
      "hashedRt" TEXT,
      "role" TEXT NOT NULL DEFAULT 'user' CHECK ("role" IN ('user','admin')),
      "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','unverified','active','disabled','banned')),
      "havenCoins" BIGINT NOT NULL DEFAULT 100,
      "havenGems" BIGINT NOT NULL DEFAULT 0,
      "avatarId" BIGINT,
      "lastLoginAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "authUserId" TEXT UNIQUE
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "avatars" (
      "id" BIGSERIAL PRIMARY KEY,
      "roomId" BIGINT NOT NULL,
      "name" TEXT NOT NULL CHECK (length("name") <= 14),
      "color" TEXT NOT NULL,
      "gender" TEXT,
      "skin" TEXT DEFAULT 'default',
      "eyeColor" TEXT DEFAULT 'default',
      "bodyPos" JSONB DEFAULT '{}',
      "itemGrid" JSONB DEFAULT '{}',
      "posX" DOUBLE PRECISION DEFAULT 0,
      "posY" DOUBLE PRECISION DEFAULT 10,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "items" (
      "id" BIGSERIAL PRIMARY KEY,
      "category" TEXT[],
      "name" TEXT NOT NULL,
      "rarity" TEXT NOT NULL DEFAULT 'common' CHECK ("rarity" IN ('common','uncommon','epic','legendary')),
      "itemType" TEXT NOT NULL,
      "parameters" JSONB DEFAULT '{}',
      "stackable" BOOLEAN NOT NULL DEFAULT false,
      "maxStack" INTEGER NOT NULL DEFAULT 1,
      "data" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "inventories" (
      "id" BIGSERIAL PRIMARY KEY,
      "userId" BIGINT NOT NULL,
      "itemId" BIGINT,
      "count" INTEGER NOT NULL DEFAULT 1,
      "addedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "rooms" (
      "id" BIGSERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "creatorId" BIGINT,
      "isPrivate" BOOLEAN NOT NULL DEFAULT false,
      "inviteCode" TEXT UNIQUE,
      "privacy" TEXT NOT NULL DEFAULT 'public' CHECK ("privacy" IN ('public','unlisted','private')),
      "passwordHash" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "room_furniture" (
      "id" BIGSERIAL PRIMARY KEY,
      "roomId" BIGINT NOT NULL,
      "furnitureId" BIGINT,
      "playerId" BIGINT,
      "x" INTEGER NOT NULL DEFAULT 0,
      "y" INTEGER NOT NULL DEFAULT 0,
      "rotation" INTEGER DEFAULT 0,
      "placedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id" BIGSERIAL PRIMARY KEY,
      "roomId" BIGINT NOT NULL,
      "senderId" BIGINT,
      "text" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "friends" (
      "id" BIGSERIAL PRIMARY KEY,
      "requesterId" BIGINT NOT NULL,
      "addresseeId" BIGINT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','accepted','declined')),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "reports" (
      "id" BIGSERIAL PRIMARY KEY,
      "reporterId" BIGINT NOT NULL,
      "reportedId" BIGINT NOT NULL,
      "reason" TEXT NOT NULL,
      "status" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "invite_codes" (
      "code" UUID PRIMARY KEY,
      "maxUses" BIGINT NOT NULL DEFAULT 1,
      "used" BIGINT NOT NULL DEFAULT 0,
      "expiresAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await c.query(`CREATE TABLE IF NOT EXISTS "game_events" (
      "id" BIGSERIAL PRIMARY KEY,
      "type" TEXT NOT NULL,
      "data" JSONB DEFAULT '{}',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    console.log('migrating users...');
    await c.query(`
      INSERT INTO "users" ("email","status","havenCoins","havenGems","createdAt","updatedAt","authUserId")
      SELECT COALESCE(NULLIF("authEmail", ''), "authEmail"),
             CASE WHEN "authSubject" IS NOT NULL THEN 'active' ELSE 'pending' END,
             COALESCE("coins", 0),
             COALESCE("gems", 0),
             "createdAt",
             "createdAt",
             "authSubject"
      FROM "profiles_backup"
      ON CONFLICT DO NOTHING
    `);
    await c.query(`UPDATE "profiles_backup" p
      SET "authUserId" = u."authUserId"
      FROM "users" u
      WHERE u."id" = p."userId"`);
    console.log('migrating avatars...');
    await c.query(`
      INSERT INTO "avatars" ("id","roomId","name","color","gender","skin","eyeColor","createdAt")
      SELECT "avatarId","roomId","name","color","gender","skin","eyeColor","createdAt"
      FROM "avatar_profiles_backup"
      ON CONFLICT ("id") DO NOTHING
    `);
    console.log('migrating rooms...');
    await c.query(`
      INSERT INTO "rooms" ("id","name","creatorId","isPrivate","inviteCode","createdAt")
      SELECT "roomId","name","userId", "isPrivate", NULL, "createdAt"
      FROM "rooms_backup"
      ON CONFLICT DO NOTHING
    `);
    await c.query(`UPDATE "rooms" SET "privacy" = 'public' WHERE "privacy" IS NULL`);
    console.log('migrating furniture...');
    await c.query(`
      INSERT INTO "room_furniture" ("id","roomId","furnitureId","playerId","x","y","rotation","placedAt")
      SELECT "id","roomId","furnitureId","playerId", floor("x"), floor("y"), "rotation", "createdAt"
      FROM "placed_furniture_backup"
      ON CONFLICT ("id") DO NOTHING
    `);
    console.log('migrating messages...');
    await c.query(`
      INSERT INTO "chat_messages" ("id","roomId","senderId","text","createdAt")
      SELECT "id","roomId","userId","text","createdAt"
      FROM "messages_backup"
      ON CONFLICT ("id") DO NOTHING
    `);
    console.log('migrating friends...');
    await c.query(`
      INSERT INTO "friends" ("id","requesterId","addresseeId","status","createdAt")
      SELECT "id","userId","user2Id","status","createdAt"
      FROM "user_friends_backup"
      ON CONFLICT DO NOTHING
    `);
    console.log('migrating inventories...');
    await c.query(`
      INSERT INTO "inventories" ("id","userId","itemId","count","addedAt","updatedAt")
      SELECT "id","userId","itemId","count","createdAt","updatedAt"
      FROM "user_inventory_backup"
      ON CONFLICT ("id") DO NOTHING
    `);
    console.log('migrating reports...');
    await c.query(`
      INSERT INTO "reports" ("id","reporterId","reportedId","reason","status","createdAt","updatedAt")
      SELECT "id","userId","reportedUserId","reason","status","createdAt","updatedAt"
      FROM "user_reports_backup"
      ON CONFLICT DO NOTHING
    `);
    console.log('migrating invite_codes...');
    await c.query(`
      INSERT INTO "invite_codes" ("code","maxUses","used","expiresAt","createdAt")
      SELECT "inviteCode","maxInvites",0,NULL,"createdAt"
      FROM "invite_codes_backup"
      ON CONFLICT DO NOTHING
    `);
    await c.query('COMMIT');
    console.log('✓ migration complete');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('migration failed:', e.message || e);
    process.exit(1);
  }
  await c.end();
};

run();
