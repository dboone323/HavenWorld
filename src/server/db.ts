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
        username TEXT UNIQUE NOT NULL,
        coins INTEGER DEFAULT 1000,
        gems INTEGER DEFAULT 50
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
        rotation INTEGER DEFAULT 0
      );
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
    const stmt = sqliteDb!.prepare(`
      INSERT INTO profiles (id, username, coins, gems)
      VALUES (?, ?, 1000, 50)
      ON CONFLICT(id) DO NOTHING
    `);
    stmt.run(userId, username || userId);
  }
}

// Persist (or merge) a player's avatar styling
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
      const { data: profile, error } = await supabase!
        .from('profiles').select('coins').eq('id', userId).maybeSingle();
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
      const { data, error } = await supabase!
        .from('placed_furniture').select('*').eq('room_id', roomId);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return data.map((f: Record<string, unknown>) => ({
        id: f.id as string, type: f.item_type as string, x: f.grid_x as number, y: f.grid_y as number, rotation: f.rotation as number
      }));
    } catch (err) {
      console.warn('Supabase getRoomFurniture warning:', (err as Error).message);
      return null;
    }
  }
  if (mode === 'sqlite') {
    const stmt = sqliteDb!.prepare(
      'SELECT id, item_type, grid_x, grid_y, rotation FROM placed_furniture WHERE room_id = ?'
    );
    const rows = stmt.all(roomId) as Array<{ id: string; item_type: string; grid_x: number; grid_y: number; rotation: number }>;
    if (rows && rows.length > 0) {
      return rows.map((r) => ({
        id: r.id, type: r.item_type, x: r.grid_x, y: r.grid_y, rotation: r.rotation
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
        grid_x: item.x, grid_y: item.y, rotation: item.rotation || 0
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
        (id, room_id, item_type, grid_x, grid_y, rotation)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(item.id, roomId, item.type, item.x, item.y, item.rotation || 0);
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

export default {
  getMode, isConfigured, initPlayerProfile, saveAvatar, addCoins,
  getRoomFurniture, addFurniture, removeFurniture
};
