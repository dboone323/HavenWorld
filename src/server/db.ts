import { createIdentity } from '../client/shared/identity-model.js';
import type { IdentityState } from '../shared/types.ts';

/**
 * HavenWorld — Database adapter (TypeScript).
 * Dual-mode storage:
 *   1. Cloud Supabase — when SUPABASE_URL + SUPABASE_*_KEY env vars are set.
 *   2. Native local SQLite — zero-config file store via Node's built-in node:sqlite.
 *   3. Memory mode — fallback when neither is available.
 *
 * Test mode: NODE_ENV=test or DB_FORCE_SQLITE=1 forces local SQLite.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { PlacedFurniture } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let supabase: any = null;
let sqliteDb: { prepare: (s: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => Record<string, unknown> | undefined; all: (...args: unknown[]) => Record<string, unknown>[] }; exec: (s: string) => void; close: () => void } | null = null;
let mode: 'memory' | 'sqlite' | 'supabase' = 'memory';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const forceSqlite = process.env.NODE_ENV === 'test' || process.env.DB_FORCE_SQLITE === '1';

// 1. Cloud Supabase (only when not forced to SQLite and creds are present)
if (!forceSqlite && supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    mode = 'supabase';
    console.log('✅ Connected to Cloud Supabase PostgreSQL.');
  } catch (err) {
    console.warn('⚠️  Could not connect to Supabase. Falling back to local database.', (err as Error).message);
  }
}

// 2. Local SQLite fallback / default (zero-config file store)
if (mode !== 'supabase') {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../havenworld.db');
    sqliteDb = new DatabaseSync(dbPath) as unknown as {
      prepare: (s: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => Record<string, unknown> | undefined; all: (...args: unknown[]) => Record<string, unknown>[] };
      exec: (s: string) => void;
      close: () => void;
    };
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
    sqliteDb.exec('PRAGMA busy_timeout = 10000;');
    mode = 'sqlite';
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password_hash TEXT,
        auth_user_id TEXT,
        coins INTEGER DEFAULT 1000,
        gems INTEGER DEFAULT 50,
        last_daily_claim TEXT DEFAULT '1970-01-01T00:00:00.000Z'
      );
      CREATE TABLE IF NOT EXISTS avatar_profiles (
        user_id TEXT PRIMARY KEY,
        skin TEXT DEFAULT '#f5cba7',
        hair_style TEXT DEFAULT 'cozy_messy',
        hair_color TEXT DEFAULT '#4a235a',
        shirt_color TEXT DEFAULT '#2e86c1',
        pants_color TEXT DEFAULT '#34495e',
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS placed_furniture (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        grid_x REAL NOT NULL,
        grid_y REAL NOT NULL,
        rotation INTEGER DEFAULT 0,
        elevation REAL DEFAULT 0,
        parent_furniture_id TEXT
      );
      CREATE TABLE IF NOT EXISTS user_inventory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        acquired_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_friends (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT,
        responded_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        text TEXT NOT NULL,
        sent_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        room_code TEXT UNIQUE,
        name TEXT NOT NULL,
        is_public INTEGER DEFAULT 1,
        likes_count INTEGER DEFAULT 0,
        flooring TEXT DEFAULT 'parquet',
        wallpaper TEXT DEFAULT 'cozy_wood',
        grid_width INTEGER DEFAULT 10,
        grid_height INTEGER DEFAULT 10,
        access_mode TEXT DEFAULT 'public',
        password_hash TEXT,
        ambient_mood TEXT DEFAULT 'day',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS room_decorators (
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS marketplace_listings (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        item_type TEXT NOT NULL,
        price_coins INTEGER DEFAULT 0,
        price_gems INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN flooring TEXT DEFAULT 'parquet'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN wallpaper TEXT DEFAULT 'cozy_wood'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN grid_width INTEGER DEFAULT 10"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN grid_height INTEGER DEFAULT 10"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN access_mode TEXT DEFAULT 'public'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN password_hash TEXT"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN ambient_mood TEXT DEFAULT 'day'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN last_daily_claim TEXT DEFAULT '1970-01-01T00:00:00.000Z'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN gems INTEGER DEFAULT 50"); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN identity_json TEXT DEFAULT '{}'"); } catch {}
    try { sqliteDb.exec('ALTER TABLE profiles ADD COLUMN registered_at TEXT'); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN materials_json TEXT DEFAULT '{\"scrap_metal\":0,\"timber\":0}'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN is_vip INTEGER DEFAULT 0"); } catch {}
    try { sqliteDb.exec("ALTER TABLE profiles ADD COLUMN vip_expires_at TEXT"); } catch {}
    sqliteDb.exec(`
      CREATE TRIGGER IF NOT EXISTS profiles_registered_at_immutable
      BEFORE UPDATE OF registered_at ON profiles
      WHEN OLD.registered_at IS NOT NULL AND NEW.registered_at IS NOT OLD.registered_at
      BEGIN SELECT RAISE(ABORT, 'registration date is immutable'); END;
    `);
    console.log(`🗄️  Native Local SQLite Database active: ${dbPath}`);
    console.log(`✨ All room furniture, avatars, and coins will automatically save to disk!`);
  } catch (e) {
    console.warn('⚠️  SQLite fallback unavailable, running in RAM memory mode.', (e as Error).message);
    mode = 'memory';
  }
}

// --- Public API (named ESM exports) ---

export const getMode = (): 'memory' | 'sqlite' | 'supabase' => mode;
export const isConfigured = (): boolean => mode === 'supabase';

// Release the SQLite connection so the process can exit (used by tests/teardown).
export function close(): void {
  if (sqliteDb) {
    try { sqliteDb.close(); } catch { /* ignore */ }
  }
}

// --- Types ---

export interface AvatarData {
  skin: string;
  hairStyle: string;
  hairColor: string;
  shirtColor: string;
  pantsColor: string;
}

export interface PlayerProfile {
  id: string;
  name: string;
  coins: number;
  gems: number;
  lastDailyClaim: number;
  avatar: AvatarData | null;
}

// --- Internal password hashing (PBKDF2 with salt) ---

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verifyHash));
}

/** In-memory cache for guest session profiles and name retention across reconnects */
export const guestProfileCache = new Map<string, { name?: string; coins?: number; gems?: number; avatar?: any }>();

/** Ensure a player profile row exists (no-op in memory mode) */
export async function initPlayerProfile(userId: string, username: string): Promise<void> {
  if (username) {
    const existing = guestProfileCache.get(userId) || {};
    guestProfileCache.set(userId, { ...existing, name: username });
  }

  if (mode === 'supabase') {
    try {
      const { error } = await supabase!.from('profiles').upsert(
        { id: userId, username: username || userId, coins: 1000, gems: 50 },
        { onConflict: 'id', ignoreDuplicates: true }
      );
      if (error) throw error;
    } catch (err) {
      console.warn('Supabase initPlayerProfile warning:', (err as Error).message);
    }
  } else if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO profiles (id, username, coins, gems)
        VALUES (?, ?, 1000, 50)
        ON CONFLICT(id) DO UPDATE SET username = COALESCE(profiles.username, excluded.username)
      `);
      stmt.run(userId, username || userId);
    } catch (e) {
      // Username may already exist for a different player — fallback to cache
    }
  }
}

const memoryIdentity = new Map<string, IdentityState>();

export async function loadIdentity(userId: string): Promise<IdentityState> {
  let stored: Partial<IdentityState> = {};
  if (mode === 'sqlite') {
    const row = sqliteDb!.prepare('SELECT identity_json FROM profiles WHERE id = ?').get(userId);
    stored = JSON.parse(String(row?.identity_json || '{}'));
  } else if (mode === 'supabase') {
    try {
      const { data, error } = await supabase.from('profiles').select('identity_json').eq('id', userId).maybeSingle();
      if (error) { console.warn('Supabase loadIdentity warning:', error.message); stored = {}; }
      else stored = data && data.identity_json ? (typeof data.identity_json === 'string' ? JSON.parse(data.identity_json) : data.identity_json) : {};
    } catch (err) { console.warn('Supabase loadIdentity warning:', (err as Error).message); stored = {}; }
  } else {
    stored = memoryIdentity.get(userId) || {};
  }
  return { ...createIdentity(userId), ...stored } as IdentityState;
}

export async function saveIdentity(userId: string, identity: IdentityState): Promise<void> {
  if (mode === 'sqlite') {
    sqliteDb!.prepare('UPDATE profiles SET identity_json = ? WHERE id = ?').run(JSON.stringify(identity), userId);
  } else if (mode === 'supabase') {
    try {
      const { error } = await supabase.from('profiles').update({ identity_json: JSON.stringify(identity) }).eq('id', userId);
      if (error) console.warn('Supabase saveIdentity warning:', error.message);
    } catch (err) { console.warn('Supabase saveIdentity warning:', (err as Error).message); }
  } else {
    memoryIdentity.set(userId, structuredClone(identity));
  }
}

/** Null for guests and legacy accounts whose registration date is unknown. */
export async function getRegistrationDate(userId: string): Promise<string | null> {
  if (mode === 'sqlite') {
    const row = sqliteDb!.prepare('SELECT registered_at FROM profiles WHERE id = ?').get(userId);
    return typeof row?.registered_at === 'string' ? row.registered_at : null;
  }
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase.from('profiles').select('registered_at').eq('id', userId).maybeSingle();
      if (error) { console.warn('Supabase getRegistrationDate warning:', error.message); return null; }
      return data?.registered_at || null;
    } catch (err) { console.warn('Supabase getRegistrationDate warning:', (err as Error).message); return null; }
  }
  return null;
}

// --- Account / Auth Persistence ---

/**
 * Signup a new account. Returns the player record on success.
 * Throws if the username is already taken.
 */
export async function signupAccount(username: string, password: string): Promise<{ id: string; name: string } | { error: string }> {
  const cleanName = username.trim().slice(0, 32);
  if (!cleanName || cleanName.length < 2) {
    return { error: 'Username must be at least 2 characters.' };
  }
  if (!password || password.length < 4) {
    return { error: 'Password must be at least 4 characters.' };
  }

  const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
  const passwordHash = hashPassword(password);

  if (mode === 'supabase') {
    try {
      // Check if username already exists
      const { data: existing } = await supabase!
        .from('profiles').select('id').eq('username', cleanName).maybeSingle();
      if (existing) return { error: 'Username already taken.' };

      const { error } = await supabase!.from('profiles').insert({
        id: userId, username: cleanName, password_hash: passwordHash,
        coins: 1000, gems: 50, auth_user_id: null, registered_at: new Date().toISOString()
      });
      if (error) {
        if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
          return { error: 'Username already taken.' };
        }
        throw error;
      }
      return { id: userId, name: cleanName };
    } catch (err) {
      console.warn('Supabase signupAccount warning:', (err as Error).message);
      return { error: 'Signup failed. Try again.' };
    }
  } else if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO profiles (id, username, password_hash, coins, gems, auth_user_id, registered_at)
        VALUES (?, ?, ?, 1000, 50, NULL, ?)
      `);
      stmt.run(userId, cleanName, passwordHash, new Date().toISOString());
      return { id: userId, name: cleanName };
    } catch (e: any) {
      if (e.code === 'SQLITE_CONSTRAINT' || e.code === 'SQLITE_CONSTRAINT_UNIQUE' || (e.message && (e.message.includes('UNIQUE') || e.message.includes('constraint')))) {
        return { error: 'Username already taken.' };
      }
      console.warn('SQLite signupAccount warning:', e.message);
      return { error: 'Signup failed. Try again.' };
    }
  }
  return { error: 'Database not configured.' };
}

/**
 * Login by username/password. Returns the player record on success.
 */
export async function loginAccount(username: string, password: string): Promise<{ id: string; name: string } | { error: string }> {
  const cleanName = username.trim().slice(0, 32);

  if (mode === 'supabase') {
    try {
      const { data: profile, error } = await supabase!
        .from('profiles').select('id, username, password_hash').eq('username', cleanName).maybeSingle();
      if (error) throw error;
      if (!profile) return { error: 'Account not found. Did you sign up?' };
      if (!profile.password_hash || !verifyPassword(password, profile.password_hash)) {
        return { error: 'Incorrect password.' };
      }
      return { id: profile.id, name: profile.username };
    } catch (err) {
      console.warn('Supabase loginAccount warning:', (err as Error).message);
      return { error: 'Login failed. Try again.' };
    }
  } else if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT id, username, password_hash FROM profiles WHERE username = ?');
      const row = stmt.get(cleanName) as { id: string; username: string; password_hash: string } | undefined;
      if (!row) return { error: 'Account not found. Did you sign up?' };
      if (!row.password_hash || !verifyPassword(password, row.password_hash)) {
        return { error: 'Incorrect password.' };
      }
      return { id: row.id, name: row.username };
    } catch (e: any) {
      console.warn('SQLite loginAccount warning:', e.message);
      return { error: 'Login failed. Try again.' };
    }
  }
  return { error: 'Database not configured.' };
}

// --- Per-User Sanctuary Loft Rooms ---

/**
 * Get or create a personal sanctuary loft room for a given player.
 * Each user gets their own private loft so they can decorate independently.
 */
export async function getUserSanctuaryRoom(userId: string, playerName: string): Promise<{ roomId: string; roomCode: string; name: string; flooring?: string; wallpaper?: string } | null> {
  // Derive room ID consistently with getUserLoftRoomId in rooms.ts
  const suffix = userId.replace(/^usr_/, '').substring(0, 12);
  const roomId = `loft_${suffix}`;
  const roomName = `${playerName}'s Personal Sanctuary Loft`;
  const starterFurniture = [
    { id: 'f_sofa_' + crypto.randomBytes(4).toString('hex'), itemType: 'sofa', x: 3, y: 4 },
    { id: 'f_table_' + crypto.randomBytes(4).toString('hex'), itemType: 'table', x: 5, y: 4 },
    { id: 'f_tv_' + crypto.randomBytes(4).toString('hex'), itemType: 'tv', x: 5, y: 2 },
    { id: 'f_plant_' + crypto.randomBytes(4).toString('hex'), itemType: 'plant', x: 2, y: 2 },
    { id: 'f_neon_' + crypto.randomBytes(4).toString('hex'), itemType: 'neon', x: 7, y: 1 },
  ];

  if (mode === 'supabase') {
    try {
      // Try to fetch existing room
      let room: any = null;
      try {
        const { data, error: roomErr } = await supabase!
          .from('rooms').select('id, room_code, name, flooring, wallpaper').eq('room_code', roomId).maybeSingle();
        if (!roomErr && data) room = data;
      } catch {}

      if (!room) {
        const { data, error: roomErr2 } = await supabase!
          .from('rooms').select('id, room_code, name').eq('room_code', roomId).maybeSingle();
        if (!roomErr2 && data) room = data;
      }

      if (room) {
        return {
          roomId: room.id,
          roomCode: room.room_code,
          name: room.name,
          flooring: room.flooring || 'parquet',
          wallpaper: room.wallpaper || 'cozy_wood'
        };
      }

      // Create the room
      let createSuccess = false;
      const { error: createErr } = await supabase!.from('rooms').insert({
        id: roomId, owner_id: userId, room_code: roomId, name: roomName, is_public: false,
        flooring: 'parquet', wallpaper: 'cozy_wood'
      });
      if (!createErr) {
        createSuccess = true;
      } else {
        // Retry insert without flooring/wallpaper if table has not migrated columns yet
        const { error: retryErr } = await supabase!.from('rooms').insert({
          id: roomId, owner_id: userId, room_code: roomId, name: roomName, is_public: false
        });
        if (!retryErr) createSuccess = true;
      }

      if (createSuccess) {
        // Insert starter furniture. Supabase v2 PostgrestBuilder is thenable
        // but has NO .catch() method — chaining .catch() throws a TypeError that
        // silently nullifies getUserSanctuaryRoom, cascading into FK violations
        // on later furniture placement (parent_furniture_id references dead rows).
        // Use await + try/catch instead.
        const furnitureRows = starterFurniture.map(f => ({
          id: f.id, room_id: roomId, item_type: f.itemType,
          grid_x: f.x, grid_y: f.y, rotation: 0, elevation: 0, parent_furniture_id: null
        }));
        try {
          await supabase!.from('placed_furniture').insert(furnitureRows);
        } catch { /* ignore duplicate-key / re-insert on reconnect */ }
        return { roomId, roomCode: roomId, name: roomName, flooring: 'parquet', wallpaper: 'cozy_wood' };
      }
      return null;
    } catch (err) {
      console.warn('Supabase getUserSanctuaryRoom warning:', (err as Error).message);
      return null;
    }
  } else if (mode === 'sqlite') {
    try {
      // Create room table if not exists (for memory mode compatibility)
      const checkStmt = sqliteDb!.prepare('SELECT id, name, flooring, wallpaper FROM rooms WHERE room_code = ?');
      const existing = checkStmt.get(roomId) as { id: string; name: string; flooring?: string; wallpaper?: string } | undefined;
      if (existing) return { roomId: existing.id, roomCode: roomId, name: existing.name, flooring: existing.flooring || 'parquet', wallpaper: existing.wallpaper || 'cozy_wood' };

      const insertRoomStmt = sqliteDb!.prepare(`
        INSERT INTO rooms (id, owner_id, room_code, name, is_public, flooring, wallpaper) VALUES (?, ?, ?, ?, 0, 'parquet', 'cozy_wood')
      `);
      insertRoomStmt.run(roomId, userId, roomId, roomName);

      // Insert starter furniture
      const insertFurnStmt = sqliteDb!.prepare(`
        INSERT INTO placed_furniture (id, room_id, item_type, grid_x, grid_y, rotation, elevation, parent_furniture_id)
        VALUES (?, ?, ?, ?, ?, 0, 0, NULL)
      `);
      for (const f of starterFurniture) {
        insertFurnStmt.run(f.id, roomId, f.itemType, f.x, f.y);
      }

      return { roomId, roomCode: roomId, name: roomName, flooring: 'parquet', wallpaper: 'cozy_wood' };
    } catch (e: any) {
      console.warn('SQLite getUserSanctuaryRoom warning:', e.message);
      return null;
    }
  }
  return null;
}

/**
 * Save room flooring and wallpaper styles.
 */
export async function saveRoomStyle(roomId: string, flooring?: string, wallpaper?: string): Promise<void> {
  if (!flooring && !wallpaper) return;
  if (mode === 'supabase') {
    try {
      const updates: Record<string, string> = {};
      if (flooring) updates.flooring = flooring;
      if (wallpaper) updates.wallpaper = wallpaper;
      await supabase!.from('rooms').update(updates).eq('id', roomId);
    } catch (err) {
      console.warn('Supabase saveRoomStyle warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    try {
      if (flooring && wallpaper) {
        const stmt = sqliteDb!.prepare('UPDATE rooms SET flooring = ?, wallpaper = ? WHERE id = ?');
        stmt.run(flooring, wallpaper, roomId);
      } else if (flooring) {
        const stmt = sqliteDb!.prepare('UPDATE rooms SET flooring = ? WHERE id = ?');
        stmt.run(flooring, roomId);
      } else if (wallpaper) {
        const stmt = sqliteDb!.prepare('UPDATE rooms SET wallpaper = ? WHERE id = ?');
        stmt.run(wallpaper, roomId);
      }
    } catch (e: any) {
      console.warn('SQLite saveRoomStyle warning:', e.message);
    }
  }
}

/**
 * Get room flooring and wallpaper styles.
 */
export async function getRoomStyle(roomId: string): Promise<{ flooring: string; wallpaper: string } | null> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!
        .from('rooms').select('flooring, wallpaper').eq('id', roomId).maybeSingle();
      if (error || !data) return null;
      return { flooring: data.flooring || 'parquet', wallpaper: data.wallpaper || 'cozy_wood' };
    } catch {
      return null;
    }
  }
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT flooring, wallpaper FROM rooms WHERE id = ?');
      const row = stmt.get(roomId) as { flooring?: string; wallpaper?: string } | undefined;
      if (!row) return null;
      return { flooring: row.flooring || 'parquet', wallpaper: row.wallpaper || 'cozy_wood' };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Get furniture for a per-user sanctuary loft from the DB.
 */
export async function getLoftFurniture(roomId: string): Promise<PlacedFurniture[] | null> {
  return getRoomFurniture(roomId);
}

/**
 * Get the last daily claim timestamp for a user (used by daily bonus logic).
 */
export async function getLastDailyClaim(userId: string): Promise<number> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!
        .from('profiles').select('last_daily_claim').eq('id', userId).maybeSingle();
      if (error || !data) return 0;
      return data.last_daily_claim ? new Date(data.last_daily_claim).getTime() : 0;
    } catch (err) {
      return 0;
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare('SELECT last_daily_claim FROM profiles WHERE id = ?');
    const row = stmt.get(userId) as { last_daily_claim: string } | undefined;
    if (!row) return 0;
    return row.last_daily_claim ? new Date(row.last_daily_claim).getTime() : 0;
  }
  return 0;
}

// --- Avatar persistence ---

/** Persist (or merge) a player's avatar styling */
export async function saveAvatar(userId: string, avatar: AvatarData): Promise<void> {
  if (mode === 'supabase') {
    try {
      await supabase!.from('profiles').upsert(
        { id: userId, username: userId, coins: 1000, gems: 50 },
        { onConflict: 'id', ignoreDuplicates: true }
      );
      await supabase!.from('avatar_profiles').upsert({
        user_id: userId,
        skin: avatar.skin,
        hair_style: avatar.hairStyle || 'cozy_messy',
        hair_color: avatar.hairColor,
        shirt_color: avatar.shirtColor,
        pants_color: avatar.pantsColor,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.warn('Supabase saveAvatar warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      INSERT INTO avatar_profiles (user_id, skin, hair_style, hair_color, shirt_color, pants_color, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        skin = excluded.skin,
        hair_style = excluded.hair_style,
        hair_color = excluded.hair_color,
        shirt_color = excluded.shirt_color,
        pants_color = excluded.pants_color,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      userId, avatar.skin, avatar.hairStyle || 'cozy_messy',
      avatar.hairColor, avatar.shirtColor, avatar.pantsColor,
      new Date().toISOString()
    );
  }
}

// Adjust a player's coin balance by amount
export async function addCoins(userId: string, amount: number): Promise<void> {
  if (mode === 'supabase') {
    try {
      const { data: profile, error } = await supabase!.from('profiles').select('coins').eq('id', userId).maybeSingle();
      if (error) throw error;
      const currentCoins = profile ? (profile.coins || 0) : 1000;
      const newCoins = Math.max(0, currentCoins + amount);
      await supabase!.from('profiles').upsert(
        { id: userId, username: userId, coins: newCoins },
        { onConflict: 'id' }
      );
    } catch (err) {
      console.warn('Supabase addCoins warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const selectStmt = sqliteDb!.prepare('SELECT coins FROM profiles WHERE id = ?');
    const row = selectStmt.get(userId);
    const currentCoins = row ? (row.coins as number) : 1000;
    const newCoins = Math.max(0, currentCoins + amount);
    const updateStmt = sqliteDb!.prepare(`
      INSERT INTO profiles (id, username, coins) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET coins = excluded.coins
    `);
    updateStmt.run(userId, userId, newCoins);
  }
}

// Load persisted furniture for a room (null when none stored)
export async function getRoomFurniture(roomId: string): Promise<PlacedFurniture[] | null> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!.from('placed_furniture').select('*').eq('room_id', roomId);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return data.map((f: Record<string, unknown>) => ({
        id: f.id as string, type: f.item_type as string, x: f.grid_x as number, y: f.grid_y as number,
        rotation: f.rotation as number,
        elevation: (f.elevation as number) || 0,
        parentSurfaceId: (f.parent_furniture_id as string) || null
      }));
    } catch (err) {
      console.warn('Supabase getRoomFurniture warning:', (err as Error).message);
      return null;
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(
      'SELECT id, item_type, grid_x, grid_y, rotation, elevation, parent_furniture_id FROM placed_furniture WHERE room_id = ?'
    );
    const rows = stmt.all(roomId) as Array<{ id: string; item_type: string; grid_x: number; grid_y: number; rotation: number; elevation: number; parent_furniture_id: string | null }>;
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id, type: r.item_type, x: r.grid_x, y: r.grid_y, rotation: r.rotation,
        elevation: r.elevation || 0,
        parentSurfaceId: r.parent_furniture_id || null
      }));
    }
    return null;
  }
  return null;
}

// Persist a placed furniture item
export async function addFurniture(roomId: string, item: PlacedFurniture): Promise<void> {
  if (mode === 'supabase') {
    try {
      const { error } = await supabase!.from('placed_furniture').upsert({
        id: item.id, room_id: roomId, item_type: item.type,
        grid_x: item.x, grid_y: item.y, rotation: item.rotation || 0,
        elevation: item.elevation || 0,
        parent_furniture_id: item.parentSurfaceId || null
      });
      if (error) throw error;
    } catch (err) {
      console.warn('Supabase addFurniture warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      INSERT OR REPLACE INTO placed_furniture
        (id, room_id, item_type, grid_x, grid_y, rotation, elevation, parent_furniture_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(item.id, roomId, item.type, item.x, item.y, item.rotation || 0, item.elevation || 0, item.parentSurfaceId || null);
  }
}

// Remove a furniture item by id
export async function removeFurniture(furnitureId: string): Promise<void> {
  if (mode === 'supabase') {
    try {
      const { error } = await supabase!.from('placed_furniture').delete().eq('id', furnitureId);
      if (error) throw error;
    } catch (err) {
      console.warn('Supabase removeFurniture warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare('DELETE FROM placed_furniture WHERE id = ?');
    stmt.run(furnitureId);
  }
}

// Load a player's saved profile, avatar, and coin balance on join
export async function loadPlayerProfile(userId: string): Promise<PlayerProfile | null> {
  const cached = guestProfileCache.get(userId);

  if (mode === 'supabase') {
    try {
      const { data: profile, error: pErr } = await supabase!.from('profiles').select('username, coins, gems, last_daily_claim').eq('id', userId).maybeSingle();
      if (pErr || !profile) {
        if (cached && cached.name) {
          return {
            id: userId,
            name: cached.name,
            coins: cached.coins || 1000,
            gems: cached.gems || 50,
            lastDailyClaim: 0,
            avatar: cached.avatar || null,
          };
        }
        return null;
      }
      const { data: avatar, error: aErr } = await supabase!.from('avatar_profiles').select('skin, hair_style, hair_color, shirt_color, pants_color').eq('user_id', userId).maybeSingle();
      const loadedName = profile.username || cached?.name || userId;
      guestProfileCache.set(userId, { ...(cached || {}), name: loadedName, coins: profile.coins, gems: profile.gems });
      return {
        id: userId,
        name: loadedName,
        coins: profile.coins || 1000,
        gems: profile.gems || 50,
        lastDailyClaim: profile.last_daily_claim ? new Date(profile.last_daily_claim).getTime() : 0,
        avatar: aErr || !avatar ? null : {
          skin: avatar.skin, hairStyle: avatar.hair_style, hairColor: avatar.hair_color,
          shirtColor: avatar.shirt_color, pantsColor: avatar.pants_color,
        },
      };
    } catch (err) {
      console.warn('Supabase loadPlayerProfile warning:', (err as Error).message);
      if (cached && cached.name) {
        return {
          id: userId,
          name: cached.name,
          coins: cached.coins || 1000,
          gems: cached.gems || 50,
          lastDailyClaim: 0,
          avatar: cached.avatar || null,
        };
      }
      return null;
    }
  }
  if (mode === 'sqlite') {
    const profileStmt = sqliteDb!.prepare('SELECT username, coins, gems, last_daily_claim FROM profiles WHERE id = ?');
    const profileRow = profileStmt.get(userId) as { username: string; coins: number; gems: number; last_daily_claim: string } | undefined;
    if (!profileRow) {
      if (cached && cached.name) {
        return {
          id: userId,
          name: cached.name,
          coins: cached.coins || 1000,
          gems: cached.gems || 50,
          lastDailyClaim: 0,
          avatar: cached.avatar || null,
        };
      }
      return null;
    }
    const avatarStmt = sqliteDb!.prepare('SELECT skin, hair_style, hair_color, shirt_color, pants_color FROM avatar_profiles WHERE user_id = ?');
    const avatarRow = avatarStmt.get(userId) as { skin: string; hair_style: string; hair_color: string; shirt_color: string; pants_color: string } | undefined;
    const loadedName = profileRow.username || cached?.name || userId;
    guestProfileCache.set(userId, { ...(cached || {}), name: loadedName, coins: profileRow.coins, gems: profileRow.gems });
    return {
      id: userId,
      name: loadedName,
      coins: profileRow.coins || 1000,
      gems: profileRow.gems || 50,
      lastDailyClaim: profileRow.last_daily_claim ? new Date(profileRow.last_daily_claim).getTime() : 0,
      avatar: avatarRow ? {
        skin: avatarRow.skin, hairStyle: avatarRow.hair_style, hairColor: avatarRow.hair_color,
        shirtColor: avatarRow.shirt_color, pantsColor: avatarRow.pants_color,
      } : null,
    };
  }
  return null;
}

// Update player name
export async function savePlayerName(userId: string, name: string): Promise<void> {
  const existing = guestProfileCache.get(userId) || {};
  guestProfileCache.set(userId, { ...existing, name });

  if (mode === 'supabase') {
    try {
      const { error } = await supabase!.from('profiles').update({ username: name }).eq('id', userId);
      if (error) {
        await supabase!.from('profiles').upsert({ id: userId, username: name, coins: 1000, gems: 50 });
      }
    } catch (err) {
      console.warn('Supabase savePlayerName warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO profiles (id, username, coins, gems)
        VALUES (?, ?, 1000, 50)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username
      `);
      stmt.run(userId, name);
    } catch (err) {
      const updateStmt = sqliteDb!.prepare('UPDATE profiles SET username = ? WHERE id = ?');
      updateStmt.run(name, userId);
    }
  }
}

// Update last daily claim timestamp
export async function saveLastDailyClaim(userId: string, timestamp: number): Promise<void> {
  const iso = new Date(timestamp).toISOString();
  if (mode === 'supabase') {
    try {
      await supabase!.from('profiles').update({ last_daily_claim: iso }).eq('id', userId);
    } catch (err) {
      console.warn('Supabase saveLastDailyClaim warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare('UPDATE profiles SET last_daily_claim = ? WHERE id = ?');
    stmt.run(iso, userId);
  }
}

// --- Inventory System ---

export interface InventoryItem {
  item_type: string;
  quantity: number;
}

export async function getInventory(userId: string): Promise<InventoryItem[]> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!.from('user_inventory').select('item_type, quantity').eq('user_id', userId);
      if (error || !data) return [];
      return data as unknown as InventoryItem[];
    } catch (err) {
      console.warn('Supabase getInventory warning:', (err as Error).message);
      return [];
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare('SELECT item_type, quantity FROM user_inventory WHERE user_id = ?');
    return stmt.all(userId) as unknown as InventoryItem[];
  }
  return [];
}

export async function addItem(userId: string, itemType: string, quantity: number = 1): Promise<void> {
  if (mode === 'supabase') {
    try {
      const { data: existing } = await supabase!.from('user_inventory').select('quantity').eq('user_id', userId).eq('item_type', itemType).maybeSingle();
      if (existing) {
        await supabase!.from('user_inventory').update({ quantity: existing.quantity + quantity }).eq('user_id', userId).eq('item_type', itemType);
      } else {
        await supabase!.from('user_inventory').insert({ id: 'inv_' + Math.random().toString(36).substring(2, 9), user_id: userId, item_type: itemType, quantity, acquired_at: new Date().toISOString() });
      }
    } catch (err) {
      console.warn('Supabase addItem warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const selectStmt = sqliteDb!.prepare('SELECT quantity FROM user_inventory WHERE user_id = ? AND item_type = ?');
    const existing = selectStmt.get(userId, itemType) as { quantity: number } | undefined;
    if (existing) {
      const updateStmt = sqliteDb!.prepare('UPDATE user_inventory SET quantity = quantity + ? WHERE user_id = ? AND item_type = ?');
      updateStmt.run(quantity, userId, itemType);
    } else {
      const insertStmt = sqliteDb!.prepare('INSERT INTO user_inventory (id, user_id, item_type, quantity, acquired_at) VALUES (?, ?, ?, ?, ?)');
      insertStmt.run('inv_' + Math.random().toString(36).substring(2, 9), userId, itemType, quantity, new Date().toISOString());
    }
  }
}

export async function removeItem(userId: string, itemType: string, quantity: number = 1): Promise<void> {
  if (mode === 'supabase') {
    try {
      const { data: existing } = await supabase!.from('user_inventory').select('quantity').eq('user_id', userId).eq('item_type', itemType).maybeSingle();
      if (!existing) return;
      const newQty = existing.quantity - quantity;
      if (newQty <= 0) {
        await supabase!.from('user_inventory').delete().eq('user_id', userId).eq('item_type', itemType);
      } else {
        await supabase!.from('user_inventory').update({ quantity: newQty }).eq('user_id', userId).eq('item_type', itemType);
      }
    } catch (err) {
      console.warn('Supabase removeItem warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const selectStmt = sqliteDb!.prepare('SELECT quantity FROM user_inventory WHERE user_id = ? AND item_type = ?');
    const existing = selectStmt.get(userId, itemType) as { quantity: number } | undefined;
    if (!existing) return;
    const newQty = existing.quantity - quantity;
    if (newQty <= 0) {
      const deleteStmt = sqliteDb!.prepare('DELETE FROM user_inventory WHERE user_id = ? AND item_type = ?');
      deleteStmt.run(userId, itemType);
    } else {
      const updateStmt = sqliteDb!.prepare('UPDATE user_inventory SET quantity = ? WHERE user_id = ? AND item_type = ?');
      updateStmt.run(newQty, userId, itemType);
    }
  }
}

// --- Friends System ---

export interface FriendEntry {
  friendId: string;
  status: string;
  createdAt: string;
}

export interface PendingRequest {
  requesterId: string;
  createdAt: string;
}

export async function getFriends(userId: string): Promise<FriendEntry[]> {
  if (mode === 'supabase') {
    try {
      const { data: sent, error: e1 } = await supabase!.from('user_friends').select('friend_id, status, created_at').eq('user_id', userId);
      const { data: received, error: e2 } = await supabase!.from('user_friends').select('user_id as friend_id, status, created_at').eq('friend_id', userId);
      const friends: FriendEntry[] = [];
      if (sent && sent.length) friends.push(...sent.filter((f: { status: string }) => f.status === 'accepted').map((f: { friend_id: string; status: string; created_at: string }) => ({ friendId: f.friend_id, status: f.status, createdAt: f.created_at })));
      if (received && received.length) friends.push(...received.filter((f: { status: string }) => f.status === 'accepted').map((f: { friend_id: string; status: string; created_at: string }) => ({ friendId: f.friend_id, status: f.status, createdAt: f.created_at })));
      return friends;
    } catch (err) {
      console.warn('Supabase getFriends warning:', (err as Error).message);
      return [];
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      SELECT friend_id as friendId, status, created_at as createdAt
      FROM user_friends
      WHERE user_id = ? AND status = 'accepted'
      UNION ALL
      SELECT user_id as friendId, status, created_at as createdAt
      FROM user_friends
      WHERE friend_id = ? AND status = 'accepted'
    `);
    return stmt.all(userId, userId) as unknown as FriendEntry[];
  }
  return [];
}

export async function getPendingFriendRequests(userId: string): Promise<PendingRequest[]> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!.from('user_friends').select('user_id, created_at').eq('friend_id', userId).eq('status', 'pending');
      if (error) console.warn('Supabase getPendingFriendRequests warning:', error.message);
      return (data || []).map((r: any) => ({ requesterId: r.user_id, createdAt: r.created_at })) as unknown as PendingRequest[];
    } catch (err) {
      return [];
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      SELECT user_id as requesterId, created_at as createdAt
      FROM user_friends
      WHERE friend_id = ? AND status = 'pending'
    `);
    return stmt.all(userId) as unknown as PendingRequest[];
  }
  return [];
}

export async function sendFriendRequest(userId: string, friendId: string): Promise<{ success: boolean; message: string }> {
  if (mode === 'supabase') {
    try {
      await supabase!.from('user_friends').insert({ id: 'fr_' + Math.random().toString(36).substring(2, 9), user_id: userId, friend_id: friendId, status: 'pending', created_at: new Date().toISOString() });
      return { success: true, message: 'Friend request sent!' };
    } catch (err) {
      console.warn('Supabase sendFriendRequest warning:', (err as Error).message);
      return { success: false, message: 'Failed to send friend request.' };
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      INSERT OR IGNORE INTO user_friends (id, user_id, friend_id, status, created_at)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    stmt.run('fr_' + Math.random().toString(36).substring(2, 9), userId, friendId, new Date().toISOString());
    return { success: true, message: 'Friend request sent!' };
  }
  return { success: false, message: 'Not configured.' };
}

export async function acceptFriendRequest(userId: string, requesterId: string): Promise<{ success: boolean; message: string }> {
  if (mode === 'supabase') {
    try {
      await supabase!.from('user_friends').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('user_id', requesterId).eq('friend_id', userId);
      return { success: true, message: 'Friend request accepted!' };
    } catch (err) {
      console.warn('Supabase acceptFriendRequest warning:', (err as Error).message);
      return { success: false, message: 'Failed to accept friend request.' };
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(`
      UPDATE user_friends SET status = 'accepted', responded_at = ?
      WHERE user_id = ? AND friend_id = ?
    `);
    stmt.run(new Date().toISOString(), requesterId, userId);
    return { success: true, message: 'Friend request accepted!' };
  }
  return { success: false, message: 'Not configured.' };
}

export async function areFriends(userId: string, friendId: string): Promise<boolean> {
  const friends = await getFriends(userId);
  return friends.some((f: FriendEntry) => f.friendId === friendId);
}

// --- Private Messaging ---

export interface MessageRecord {
  senderId: string;
  text: string;
  sentAt: string;
}

export async function saveMessage(senderId: string, recipientId: string, text: string): Promise<void> {
  if (mode === 'supabase') {
    try {
      await supabase!.from('messages').insert({ sender_id: senderId, recipient_id: recipientId, text, sent_at: new Date().toISOString() });
    } catch (err) {
      console.warn('Supabase saveMessage warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO messages (id, sender_id, recipient_id, text, sent_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run('msg_' + Math.random().toString(36).substring(2, 9), senderId, recipientId, text, new Date().toISOString());
    } catch (e) {
      console.warn('SQLite saveMessage warning:', (e as Error).message);
    }
  }
}

export async function getMessages(userId: string): Promise<MessageRecord[]> {
  if (mode === 'supabase') {
    try {
      const { data, error } = await supabase!.from('messages').select('sender_id as senderId, text, sent_at as sentAt').eq('recipient_id', userId).order('sent_at', { ascending: false }).limit(50);
      return (data || []) as unknown as MessageRecord[];
    } catch (err) {
      return [];
    }
  }
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        SELECT sender_id as senderId, text, sent_at as sentAt
        FROM messages
        WHERE recipient_id = ?
        ORDER BY sent_at DESC
        LIMIT 50
      `);
      return stmt.all(userId) as unknown as MessageRecord[];
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * Room grid expansion persistence
 */
export async function saveRoomExpansion(roomId: string, width: number, height: number): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO rooms (id, name, grid_width, grid_height)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET grid_width = excluded.grid_width, grid_height = excluded.grid_height
      `);
      stmt.run(roomId, roomId, width, height);
    } catch (e: any) {
      console.warn('SQLite saveRoomExpansion warning:', e.message);
    }
  }
}

export async function getRoomExpansion(roomId: string): Promise<{ width: number; height: number }> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT grid_width as width, grid_height as height FROM rooms WHERE id = ?');
      const row = stmt.get(roomId) as { width?: number; height?: number } | undefined;
      if (row && row.width && row.height) return { width: row.width, height: row.height };
    } catch (e: any) {}
  }
  return { width: roomId === 'plaza' ? 12 : 10, height: roomId === 'plaza' ? 12 : 10 };
}

/**
 * Room access permissions & password
 */
export async function saveRoomPermissions(roomId: string, accessMode: string, passwordHash?: string): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO rooms (id, name, access_mode, password_hash)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET access_mode = excluded.access_mode, password_hash = excluded.password_hash
      `);
      stmt.run(roomId, roomId, accessMode, passwordHash || null);
    } catch (e: any) {
      console.warn('SQLite saveRoomPermissions warning:', e.message);
    }
  }
}

export async function getRoomPermissions(roomId: string): Promise<{ accessMode: string; passwordHash: string | null }> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT access_mode, password_hash FROM rooms WHERE id = ?');
      const row = stmt.get(roomId) as { access_mode?: string; password_hash?: string } | undefined;
      if (row) return { accessMode: row.access_mode || 'public', passwordHash: row.password_hash || null };
    } catch (e: any) {}
  }
  return { accessMode: 'public', passwordHash: null };
}

/**
 * Room ambient mood
 */
export async function saveRoomMood(roomId: string, mood: string): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare(`
        INSERT INTO rooms (id, name, ambient_mood)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ambient_mood = excluded.ambient_mood
      `);
      stmt.run(roomId, roomId, mood);
    } catch (e: any) {
      console.warn('SQLite saveRoomMood warning:', e.message);
    }
  }
}

export async function getRoomMood(roomId: string): Promise<string> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT ambient_mood FROM rooms WHERE id = ?');
      const row = stmt.get(roomId) as { ambient_mood?: string } | undefined;
      if (row && row.ambient_mood) return row.ambient_mood;
    } catch (e: any) {}
  }
  return 'day';
}

/**
 * Co-Building Decorators
 */
export async function addRoomDecorator(roomId: string, userId: string): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('INSERT OR REPLACE INTO room_decorators (room_id, user_id, created_at) VALUES (?, ?, ?)');
      stmt.run(roomId, userId, new Date().toISOString());
    } catch (e: any) {
      console.warn('SQLite addRoomDecorator warning:', e.message);
    }
  }
}

export async function removeRoomDecorator(roomId: string, userId: string): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('DELETE FROM room_decorators WHERE room_id = ? AND user_id = ?');
      stmt.run(roomId, userId);
    } catch (e: any) {
      console.warn('SQLite removeRoomDecorator warning:', e.message);
    }
  }
}

export async function getRoomDecorators(roomId: string): Promise<string[]> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT user_id FROM room_decorators WHERE room_id = ?');
      const rows = stmt.all(roomId) as { user_id: string }[];
      return rows.map(r => r.user_id);
    } catch (e: any) {
      return [];
    }
  }
  return [];
}

/**
 * Dual Currency: HavenGems
 */
export async function addGems(userId: string, amount: number): Promise<number> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('UPDATE profiles SET gems = MAX(0, gems + ?) WHERE id = ?');
      stmt.run(amount, userId);
      const getStmt = sqliteDb!.prepare('SELECT gems FROM profiles WHERE id = ?');
      const row = getStmt.get(userId) as { gems?: number } | undefined;
      return row?.gems ?? 0;
    } catch (e: any) {
      console.warn('SQLite addGems warning:', e.message);
      return 0;
    }
  }
  return 0;
}

/**
 * Materials & Recycling Crafting
 */
export async function getPlayerMaterials(userId: string): Promise<{ scrap_metal: number; timber: number }> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT materials_json FROM profiles WHERE id = ?');
      const row = stmt.get(userId) as { materials_json?: string } | undefined;
      if (row?.materials_json) {
        const parsed = JSON.parse(row.materials_json);
        return { scrap_metal: parsed.scrap_metal || 0, timber: parsed.timber || 0 };
      }
    } catch (e: any) {}
  }
  return { scrap_metal: 0, timber: 0 };
}

export async function savePlayerMaterials(userId: string, mats: { scrap_metal: number; timber: number }): Promise<void> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('UPDATE profiles SET materials_json = ? WHERE id = ?');
      stmt.run(JSON.stringify(mats), userId);
    } catch (e: any) {
      console.warn('SQLite savePlayerMaterials warning:', e.message);
    }
  }
}

/**
 * VIP Subscription ("Club Haven")
 */
export async function setVipMembership(userId: string, durationDays: number): Promise<{ isVip: boolean; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('UPDATE profiles SET is_vip = 1, vip_expires_at = ? WHERE id = ?');
      stmt.run(expiresAt, userId);
    } catch (e: any) {
      console.warn('SQLite setVipMembership warning:', e.message);
    }
  }
  return { isVip: true, expiresAt };
}

export async function getVipStatus(userId: string): Promise<{ isVip: boolean; expiresAt: string | null }> {
  if (mode === 'sqlite') {
    try {
      const stmt = sqliteDb!.prepare('SELECT is_vip, vip_expires_at FROM profiles WHERE id = ?');
      const row = stmt.get(userId) as { is_vip?: number; vip_expires_at?: string } | undefined;
      if (row?.is_vip && row.vip_expires_at) {
        const active = new Date(row.vip_expires_at).getTime() > Date.now();
        return { isVip: active, expiresAt: active ? row.vip_expires_at : null };
      }
    } catch (e: any) {}
  }
  return { isVip: false, expiresAt: null };
}

/**
 * Player Marketplace / Auction House
 */
export async function createMarketplaceListing(
  sellerId: string,
  sellerName: string,
  itemType: string,
  priceCoins: number,
  priceGems: number = 0
): Promise<{ success: boolean; listingId?: string; message?: string }> {
  if (mode === 'sqlite') {
    try {
      const invStmt = sqliteDb!.prepare('SELECT quantity FROM user_inventory WHERE user_id = ? AND item_type = ?');
      const invRow = invStmt.get(sellerId, itemType) as { quantity?: number } | undefined;
      if (!invRow || (invRow.quantity || 0) < 1) {
        return { success: false, message: 'Item not in your inventory' };
      }
      await removeItem(sellerId, itemType);
      const listingId = 'mkt_' + crypto.randomUUID().substring(0, 8);
      const listStmt = sqliteDb!.prepare(`
        INSERT INTO marketplace_listings (id, seller_id, seller_name, item_type, price_coins, price_gems, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
      `);
      listStmt.run(listingId, sellerId, sellerName, itemType, priceCoins, priceGems, new Date().toISOString());
      return { success: true, listingId };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
  return { success: false, message: 'Database not available' };
}

export async function getMarketplaceListings(query?: string): Promise<any[]> {
  if (mode === 'sqlite') {
    try {
      if (query && query.trim()) {
        const stmt = sqliteDb!.prepare(`
          SELECT id, seller_id as sellerId, seller_name as sellerName, item_type as itemType,
                 price_coins as priceCoins, price_gems as priceGems, status, created_at as createdAt
          FROM marketplace_listings
          WHERE status = 'active' AND (item_type LIKE ? OR seller_name LIKE ?)
          ORDER BY created_at DESC
          LIMIT 50
        `);
        const search = `%${query.trim()}%`;
        return stmt.all(search, search);
      }
      const stmt = sqliteDb!.prepare(`
        SELECT id, seller_id as sellerId, seller_name as sellerName, item_type as itemType,
               price_coins as priceCoins, price_gems as priceGems, status, created_at as createdAt
        FROM marketplace_listings
        WHERE status = 'active'
        ORDER BY created_at DESC
        LIMIT 50
      `);
      return stmt.all();
    } catch (e: any) {
      return [];
    }
  }
  return [];
}

export async function buyMarketplaceListing(
  listingId: string,
  buyerId: string,
  buyerCoins: number
): Promise<{ success: boolean; itemType?: string; netPaid?: number; sellerId?: string; message?: string }> {
  if (mode === 'sqlite') {
    try {
      const getListingStmt = sqliteDb!.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND status = 'active'");
      const listing = getListingStmt.get(listingId) as any;
      if (!listing) return { success: false, message: 'Listing is no longer active' };
      if (listing.seller_id === buyerId) return { success: false, message: 'Cannot buy your own listing' };

      const price = listing.price_coins;
      if (buyerCoins < price) return { success: false, message: 'Insufficient coins' };

      const sellerVip = await getVipStatus(listing.seller_id);
      const taxRate = sellerVip.isVip ? 0.02 : 0.05;
      const taxSink = Math.round(price * taxRate);
      const sellerPayout = price - taxSink;

      await addCoins(buyerId, -price);
      await addItem(buyerId, listing.item_type);
      await addCoins(listing.seller_id, sellerPayout);
      const updateStmt = sqliteDb!.prepare("UPDATE marketplace_listings SET status = 'sold' WHERE id = ?");
      updateStmt.run(listingId);

      return { success: true, itemType: listing.item_type, netPaid: price, sellerId: listing.seller_id };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
  return { success: false, message: 'Database not available' };
}

export async function cancelMarketplaceListing(
  listingId: string,
  sellerId: string
): Promise<{ success: boolean; itemType?: string; message?: string }> {
  if (mode === 'sqlite') {
    try {
      const getStmt = sqliteDb!.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND status = 'active'");
      const listing = getStmt.get(listingId) as any;
      if (!listing) return { success: false, message: 'Listing not found or inactive' };
      if (listing.seller_id !== sellerId) return { success: false, message: 'You do not own this listing' };

      await addItem(sellerId, listing.item_type);
      const cancelStmt = sqliteDb!.prepare("UPDATE marketplace_listings SET status = 'cancelled' WHERE id = ?");
      cancelStmt.run(listingId);
      return { success: true, itemType: listing.item_type };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
  return { success: false, message: 'Database not available' };
}

// Export the cooldown constant for protocol.ts
export const DAILY_COOLDOWN = DAILY_COOLDOWN_MS;

export default {
  getMode, isConfigured, close,
  initPlayerProfile, saveAvatar, addCoins, addGems,
  getRoomFurniture, addFurniture, removeFurniture,
  loadPlayerProfile, savePlayerName, saveLastDailyClaim,
  getInventory, addItem, removeItem,
  getFriends, getPendingFriendRequests, sendFriendRequest, acceptFriendRequest, areFriends,
  saveMessage, getMessages,
  signupAccount, loginAccount,
  getUserSanctuaryRoom, getLoftFurniture, getLastDailyClaim,
  saveRoomStyle, getRoomStyle,
  saveRoomExpansion, getRoomExpansion,
  saveRoomPermissions, getRoomPermissions,
  saveRoomMood, getRoomMood,
  addRoomDecorator, removeRoomDecorator, getRoomDecorators,
  getPlayerMaterials, savePlayerMaterials,
  setVipMembership, getVipStatus,
  createMarketplaceListing, getMarketplaceListings, buyMarketplaceListing, cancelMarketplaceListing,
  DAILY_COOLDOWN,
};

