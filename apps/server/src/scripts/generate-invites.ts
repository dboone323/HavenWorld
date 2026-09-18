import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Command-line arguments:
// npx ts-node src/scripts/generate-invites.ts [count] [expiryDays] [adminEmail]
const COUNT = parseInt(process.argv[2] ?? '25', 10);
const EXPIRY_DAYS = parseInt(process.argv[3] ?? '30', 10);
const ADMIN_EMAIL = process.argv[4] ?? 'dboone9@msn.com';

async function main() {
  // Verify admin user exists in the database
  const admin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL.toLowerCase() },
  });

  if (!admin) {
    console.error(`\n❌ Admin user with email "${ADMIN_EMAIL}" not found.`);
    console.error('   Register your account first at havenworld.pages.dev, then run:');
    console.error(`   psql -U havenworld -d havenworld_prod -h 127.0.0.1`);
    console.error(`   UPDATE users SET role = 'ADMIN', "emailVerified" = true WHERE email = '${ADMIN_EMAIL}';`);
    process.exit(1);
  }

  if (admin.role !== 'ADMIN') {
    console.error(`\n❌ User "${admin.username}" is not an ADMIN (current role: ${admin.role}).`);
    console.error('   Promote yourself first with the SQL command shown above.');
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400000);

  // Generate unique codes — 8 hex chars = 16^8 = ~4 billion combinations
  const codes: string[] = [];
  while (codes.length < COUNT) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await prisma.inviteCode.findUnique({ where: { code } });
    if (!exists && !codes.includes(code)) {
      codes.push(code);
    }
  }

  await prisma.inviteCode.createMany({
    data: codes.map((code) => ({
      code,
      createdBy: admin.id,
      expiresAt,
      isActive: true,
    })),
  });

  console.log('\n✓ HavenWorld Alpha Invite Codes Generated');
  console.log('══════════════════════════════════════════');
  console.log(`  Count:   ${codes.length} codes`);
  console.log(`  Expires: ${expiresAt.toDateString()} (${EXPIRY_DAYS} days)`);
  console.log(`  Created: by ${admin.username} (${admin.email})`);
  console.log('\nCodes (share these with alpha testers):');
  console.log('─────────────────────────────────────────');
  codes.forEach((code, i) => {
    console.log(`  ${String(i + 1).padStart(2, '0')}. ${code}`);
  });
  console.log('\nRegistration URL: https://havenworld-game.pages.dev');
  console.log('Instructions: Go to the URL above and click Register.');
  console.log('Testers enter their invite code during registration.\n');
}

main()
  .catch((err) => {
    console.error('[Script] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
