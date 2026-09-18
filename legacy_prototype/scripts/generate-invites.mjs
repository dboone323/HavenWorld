#!/usr/bin/env node
/**
 * HavenWorld — Alpha Invite Code Generator CLI
 *
 * Usage:
 *   node scripts/generate-invites.mjs [count] [maxUses] [expiresDays]
 *
 * Examples:
 *   node scripts/generate-invites.mjs 10 1 30    # 10 single-use codes expiring in 30 days
 *   node scripts/generate-invites.mjs 5 5 90     # 5 codes, 5 uses each, 90 days
 */
import crypto from 'node:crypto';
import * as db from '../src/server/db.ts';

const args = process.argv.slice(2);
const count = parseInt(args[0], 10) || 5;
const maxUses = parseInt(args[1], 10) || 1;
const expiresDays = parseInt(args[2], 10) || 30;

const expiresAt = expiresDays > 0
  ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
  : null;

console.log(`\n🎟️  HavenWorld Alpha Invite Code Generator`);
console.log(`===========================================`);
console.log(`Count:        ${count}`);
console.log(`Max Uses:     ${maxUses} per code`);
console.log(`Expires In:   ${expiresDays} days (${expiresAt || 'Never'})\n`);

const generated = [];

for (let i = 0; i < count; i++) {
  const code = 'HAVEN-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const invite = await db.createInviteCode({
    code,
    createdBy: 'cli_admin',
    expiresAt,
    maxUses
  });
  generated.push(invite);
  console.log(`  [${(i + 1).toString().padStart(2, ' ')}]  ${invite.code}   (max uses: ${invite.max_uses})`);
}

console.log(`\n✅ Generated ${generated.length} alpha invite codes successfully in ${db.getMode()} mode.`);
console.log(`Share these with testers to join HavenWorld!\n`);

if (typeof db.close === 'function') {
  db.close();
}
process.exit(0);
