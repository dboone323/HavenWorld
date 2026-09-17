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
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN flooring TEXT DEFAULT 'parquet'"); } catch {}
    try { sqliteDb.exec("ALTER TABLE rooms ADD COLUMN wallpaper TEXT DEFAULT 'cozy_wood'"); } catch {}
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

/** Ensure a player profile row exists (no-op in memory mode) */
export async function initPlayerProfile(userId: string, username: string): Promise<void> {
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
        ON CONFLICT(id) DO NOTHING
      `);
      stmt.run(userId, username || userId);
    } catch (e) {
      // Username may already exist for a different player — that's OK,
      // the profile will be loaded from the DB on connect.
    }
  }
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
        coins: 1000, gems: 50, auth_user_id: null
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
        INSERT INTO profiles (id, username, password_hash, coins, gems, auth_user_id)
        VALUES (?, ?, ?, 1000, 50, NULL)
      `);
      stmt.run(userId, cleanName, passwordHash);
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
        // Insert starter furniture
        const furnitureRows = starterFurniture.map(f => ({
          id: f.id, room_id: roomId, item_type: f.itemType,
          grid_x: f.x, grid_y: f.y, rotation: 0, elevation: 0, parent_furniture_id: null
        }));
        await supabase!.from('placed_furniture').insert(furnitureRows).catch(() => {});
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
  if (mode === 'supabase') {
    try {
      const { data: profile, error: pErr } = await supabase!.from('profiles').select('username, coins, gems, last_daily_claim').eq('id', userId).maybeSingle();
      if (pErr || !profile) return null;
      const { data: avatar, error: aErr } = await supabase!.from('avatar_profiles').select('skin, hair_style, hair_color, shirt_color, pants_color').eq('user_id', userId).maybeSingle();
      return {
        id: userId,
        name: profile.username || userId,
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
      return null;
    }
  }
  if (mode === 'sqlite') {
    const profileStmt = sqliteDb!.prepare('SELECT username, coins, gems, last_daily_claim FROM profiles WHERE id = ?');
    const profileRow = profileStmt.get(userId) as { username: string; coins: number; gems: number; last_daily_claim: string } | undefined;
    if (!profileRow) return null;
    const avatarStmt = sqliteDb!.prepare('SELECT skin, hair_style, hair_color, shirt_color, pants_color FROM avatar_profiles WHERE user_id = ?');
    const avatarRow = avatarStmt.get(userId) as { skin: string; hair_style: string; hair_color: string; shirt_color: string; pants_color: string } | undefined;
    return {
      id: userId,
      name: profileRow.username || userId,
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
  if (mode === 'supabase') {
    try {
      await supabase!.from('profiles').update({ username: name }).eq('id', userId);
    } catch (err) {
      console.warn('Supabase savePlayerName warning:', (err as Error).message);
    }
    return;
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare('UPDATE profiles SET username = ? WHERE id = ?');
    stmt.run(name, userId);
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

// Export the cooldown constant for protocol.ts
export const DAILY_COOLDOWN = DAILY_COOLDOWN_MS;

export default {
  getMode, isConfigured, close,
  initPlayerProfile, saveAvatar, addCoins,
  getRoomFurniture, addFurniture, removeFurniture,
  loadPlayerProfile, savePlayerName, saveLastDailyClaim,
  getInventory, addItem, removeItem,
  getFriends, getPendingFriendRequests, sendFriendRequest, acceptFriendRequest, areFriends,
  saveMessage, getMessages,
  signupAccount, loginAccount,
  getUserSanctuaryRoom, getLoftFurniture, getLastDailyClaim,
  saveRoomStyle, getRoomStyle,
  DAILY_COOLDOWN,
};
