#!/usr/bin/env node
// db_audit_v3.js — legacy-data profiling to drive the one-time reconciliation.
'use strict';
const fs = require('fs');
const ENV = '/opt/havenworld/apps/server/.env';
let url = process.env.DATABASE_URL;
if (!url) {
  const m = fs.readFileSync(ENV, 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  if (m) url = m[1].trim().replace(/^["']|["']$/g, '');
}
const { PrismaClient } = require('/opt/havenworld/apps/server/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: [], datasources: { db: { url } } });

const show = (label, rows) => {
  console.log('\n=== ' + label + ' ===');
  if (!rows.length) return console.log('(none)');
  for (const r of rows) console.log(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? Number(v) : v)));
};

async function main() {
  const q = (s) => prisma.$queryRawUnsafe(s);

  show('profiles: identity shape', await q(`
    SELECT count(*)::int AS total,
           count(auth_user_id)::int  AS with_auth_user_id,
           count(password_hash)::int AS with_password,
           count(*) FILTER (WHERE username ~* '^(load|test|k6|bot)')::int AS looks_like_test,
           min(created_at)::text AS first_created,
           max(created_at)::text AS last_created
    FROM profiles`));

  show('profiles: username samples (first 25 by created_at)', await q(`
    SELECT username, coins::int AS coins, gems, created_at::text AS created_at
    FROM profiles ORDER BY created_at LIMIT 25`));

  show('profiles: username length distribution', await q(`
    SELECT length(username) AS len, count(*)::int AS n FROM profiles GROUP BY 1 ORDER BY 1`));

  show('rooms: shape', await q(`
    SELECT count(*)::int AS total,
           count(owner_id)::int AS with_owner,
           count(*) FILTER (WHERE is_public)::int AS public_rooms,
           count(*) FILTER (WHERE room_code IS NULL)::int AS null_code
    FROM rooms`));

  show('rooms: samples', await q(`
    SELECT room_code, name, is_public, likes_count, created_at::text AS created_at
    FROM rooms ORDER BY created_at LIMIT 12`));

  show('rooms: do owners resolve to profiles?', await q(`
    SELECT count(*)::int AS rooms_with_resolvable_owner
    FROM rooms r WHERE r.owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.owner_id)`));

  show('avatar_profiles: user resolves?', await q(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = a.user_id))::int AS resolvable
    FROM avatar_profiles a`));

  show('avatar_profiles: samples', await q(`
    SELECT left(user_id,8) AS user8, skin, hair_style, hair_color, shirt_color, pants_color
    FROM avatar_profiles LIMIT 8`));

  show('placed_furniture: distinct item_type', await q(`
    SELECT item_type, count(*)::int AS n FROM placed_furniture
    GROUP BY 1 ORDER BY 2 DESC LIMIT 30`));

  show('placed_furniture: shape', await q(`
    SELECT count(*)::int AS total,
           count(parent_furniture_id)::int AS with_parent,
           min(grid_x)::text AS min_x, max(grid_x)::text AS max_x,
           min(grid_y)::text AS min_y, max(grid_y)::text AS max_y,
           count(DISTINCT room_id)::int AS distinct_rooms,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM rooms r WHERE r.id = f.room_id))::int AS resolvable_rooms
    FROM placed_furniture f`));

  show('user_inventory: distinct item_type', await q(`
    SELECT item_type, count(*)::int AS n,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM profiles p WHERE p.id = i.user_id))::int AS resolvable_user
    FROM user_inventory i GROUP BY 1 ORDER BY 2 DESC`));

  show('FK constraints on legacy tables', await q(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema='public' AND tc.table_name IN
      ('profiles','avatar_profiles','rooms','messages','user_friends','user_inventory','placed_furniture')
    ORDER BY 1,2`));

  show('indexes on legacy tables', await q(`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename IN
      ('profiles','rooms','placed_furniture','user_inventory') ORDER BY 1,2`));
}

main().catch((e) => { console.error('FAIL: ' + String(e.message).split('\n').slice(0, 2).join(' | ')); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
