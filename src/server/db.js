/**
 * Database adapter for HavenWorld / MiniWorld
 * Dual-Mode Engine:
 * 1. Cloud Supabase Mode: If SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are set in .env.
 * 2. Native Local SQLite Mode: Default zero-config persistent storage on your Mac (miniworld.db).
 */
require('dotenv').config();
const path = require('path');

let supabase = null;
let sqliteDb = null;
let mode = 'memory';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// 1. Try Supabase Cloud connection
if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    mode = 'supabase';
    console.log('✅ Connected to Cloud Supabase PostgreSQL.');
  } catch (err) {
    console.warn('⚠️ Could not connect to Supabase. Falling back to local database.', err.message);
  }
}

// 2. Local Persistent SQLite fallback (Node.js built-in, zero config)
if (mode !== 'supabase') {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(__dirname, '../../miniworld.db');
    sqliteDb = new DatabaseSync(dbPath);
    mode = 'sqlite';

    // Initialize local tables automatically on first run
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

    console.log(`🗄️ Native Local SQLite Database active: ${dbPath}`);
    console.log(`✨ All room furniture, avatars, and coins will automatically save to disk!`);
  } catch (e) {
    console.warn('⚠️ SQLite fallback unavailable, running in RAM memory mode.', e.message);
    mode = 'memory';
  }
}

module.exports = {
  getMode: () => mode,
  isConfigured: () => mode === 'supabase',

  // Ensure player profile exists in DB
  async initPlayerProfile(userId, username) {
    if (mode === 'supabase') {
      try {
        await supabase.from('profiles').upsert({
          id: userId,
          username: username || userId,
          coins: 1000,
          gems: 50
        }, { onConflict: 'id', ignoreDuplicates: true });
      } catch (err) {
        console.warn('Supabase initPlayerProfile warning:', err.message);
      }
    } else if (mode === 'sqlite') {
      const stmt = sqliteDb.prepare(`
        INSERT INTO profiles (id, username, coins, gems)
        VALUES (?, ?, 1000, 50)
        ON CONFLICT(id) DO NOTHING
      `);
      stmt.run(userId, username || userId);
    }
  },

  // Save updated avatar styling
  async saveAvatar(userId, avatar) {
    if (mode === 'supabase') {
      try {
        // Ensure profile row exists first to satisfy foreign key
        await supabase.from('profiles').upsert({
          id: userId,
          username: userId,
          coins: 1000,
          gems: 50
        }, { onConflict: 'id', ignoreDuplicates: true });

        await supabase.from('avatar_profiles').upsert({
          user_id: userId,
          skin: avatar.skin,
          hair_style: avatar.hairStyle || 'cozy_messy',
          hair_color: avatar.hairColor,
          shirt_color: avatar.shirtColor,
          pants_color: avatar.pantsColor,
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.warn('Supabase saveAvatar warning:', err.message);
      }
    } else if (mode === 'sqlite') {
      const stmt = sqliteDb.prepare(`
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
        userId,
        avatar.skin,
        avatar.hairStyle || 'cozy_messy',
        avatar.hairColor,
        avatar.shirtColor,
        avatar.pantsColor,
        new Date().toISOString()
      );
    }
  },

  // Update coin balance
  async addCoins(userId, amount) {
    if (mode === 'supabase') {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('coins')
          .eq('id', userId)
          .maybeSingle();

        const currentCoins = profile ? (profile.coins || 0) : 1000;
        const newCoins = Math.max(0, currentCoins + amount);

        await supabase.from('profiles').upsert({
          id: userId,
          username: userId,
          coins: newCoins
        }, { onConflict: 'id' });
      } catch (err) {
        console.warn('Supabase addCoins warning:', err.message);
      }
    } else if (mode === 'sqlite') {
      const selectStmt = sqliteDb.prepare('SELECT coins FROM profiles WHERE id = ?');
      const row = selectStmt.get(userId);
      const currentCoins = row ? row.coins : 1000;
      const newCoins = Math.max(0, currentCoins + amount);

      const updateStmt = sqliteDb.prepare(`
        INSERT INTO profiles (id, username, coins)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET coins = excluded.coins
      `);
      updateStmt.run(userId, userId, newCoins);
    }
  },

  // Load room furniture
  async getRoomFurniture(roomId) {
    if (mode === 'supabase') {
      try {
        const { data, error } = await supabase
          .from('placed_furniture')
          .select('*')
          .eq('room_id', roomId);
        if (error || !data || data.length === 0) return null;
        return data.map(f => ({
          id: f.id,
          type: f.item_type,
          x: f.grid_x,
          y: f.grid_y,
          rotation: f.rotation
        }));
      } catch (err) {
        console.warn('Supabase getRoomFurniture warning:', err.message);
        return null;
      }
    } else if (mode === 'sqlite') {
      const stmt = sqliteDb.prepare('SELECT id, item_type, grid_x, grid_y, rotation FROM placed_furniture WHERE room_id = ?');
      const rows = stmt.all(roomId);
      if (rows && rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          type: r.item_type,
          x: r.grid_x,
          y: r.grid_y,
          rotation: r.rotation
        }));
      }
      return null;
    }
    return null;
  },

  // Place furniture item in room
  async addFurniture(roomId, item) {
    if (mode === 'supabase') {
      try {
        await supabase.from('placed_furniture').upsert({
          id: item.id,
          room_id: roomId,
          item_type: item.type,
          grid_x: item.x,
          grid_y: item.y,
          rotation: item.rotation || 0
        });
      } catch (err) {
        console.warn('Supabase addFurniture warning:', err.message);
      }
    } else if (mode === 'sqlite') {
      const stmt = sqliteDb.prepare(`
        INSERT OR REPLACE INTO placed_furniture (id, room_id, item_type, grid_x, grid_y, rotation)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(item.id, roomId, item.type, item.x, item.y, item.rotation || 0);
    }
  },

  // Remove furniture item from room
  async removeFurniture(furnitureId) {
    if (mode === 'supabase') {
      try {
        await supabase.from('placed_furniture').delete().eq('id', furnitureId);
      } catch (err) {
        console.warn('Supabase removeFurniture warning:', err.message);
      }
    } else if (mode === 'sqlite') {
      const stmt = sqliteDb.prepare('DELETE FROM placed_furniture WHERE id = ?');
      stmt.run(furnitureId);
    }
  }
};
