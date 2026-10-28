import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Usage:
// npx ts-node scripts/mint-invite-codes.ts [count] [expiryDays]
const COUNT = parseInt(process.argv[2] ?? '5', 10);
const EXPIRY_DAYS = parseInt(process.argv[3] ?? '30', 10);

async function main() {
  // Find or create an admin user for invite code authorship
  let admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!admin) {
    admin = await prisma.user.findFirst();
  }

  if (!admin) {
    console.error('❌ No users found in database to author invite codes.');
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 86400000);
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

  console.log('✓ HavenWorld Alpha Invite Codes Minted');
  console.log('====================================');
  console.log(`  Count:   ${codes.length} codes`);
  console.log(`  Expires: ${expiresAt.toISOString()} (${EXPIRY_DAYS} days)`);
  console.log(`  Author:  ${admin.username} (${admin.id})`);
  console.log('\nMinted Codes:');
  codes.forEach((code, i) => {
    console.log(`  [${i + 1}] ${code}`);
  });
}

main()
  .catch((err) => {
    console.error('Error minting invite codes:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
