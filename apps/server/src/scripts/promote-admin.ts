import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Promotes an existing account to ADMIN and marks its email verified.
// Usage: pnpm --filter server exec tsx src/scripts/promote-admin.ts <email> [ROLE]
const EMAIL = (process.argv[2] ?? '').toLowerCase();
const ROLE = (process.argv[3] ?? 'ADMIN').toUpperCase();

if (!EMAIL) {
  console.error('\n❌ Usage: pnpm --filter server exec tsx src/scripts/promote-admin.ts <email> [ADMIN|MODERATOR|PLAYER]');
  process.exit(1);
}

if (!['ADMIN', 'MODERATOR', 'PLAYER'].includes(ROLE)) {
  console.error(`\n❌ Unknown role "${ROLE}". Use ADMIN, MODERATOR or PLAYER.`);
  process.exit(1);
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });

  if (!user) {
    console.error(`\n❌ No account found for "${EMAIL}".`);
    console.error('   Register first at https://havenworld-game.pages.dev, then run this script again.');
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: ROLE as 'ADMIN' | 'MODERATOR' | 'PLAYER', emailVerified: true, emailVerifyToken: null },
  });

  console.log('\n✓ HavenWorld account updated');
  console.log('══════════════════════════════════════════');
  console.log(`  Username: ${updated.username}`);
  console.log(`  Email:    ${updated.email}`);
  console.log(`  Role:     ${updated.role}`);
  console.log(`  Verified: ${updated.emailVerified}`);
  console.log('\nNext: mint alpha invite codes for your testers with');
  console.log('  pnpm --filter server exec tsx src/scripts/generate-invites.ts 25 30 ' + updated.email + '\n');
}

main()
  .catch((err) => {
    console.error('[Script] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
