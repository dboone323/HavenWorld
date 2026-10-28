import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { generateAccessToken } from '../auth/tokens';

async function main() {
  const users = [
    { email: 'loadtest01@havenworld.local', username: 'loadtest01' },
    { email: 'loadtest02@havenworld.local', username: 'loadtest02' },
    { email: 'loadtest03@havenworld.local', username: 'loadtest03' },
  ];

  const passwordHash = await bcrypt.hash('LoadTest123!', 10);

  let firstToken = '';

  for (const u of users) {
    let user = await prisma.user.findUnique({ where: { email: u.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: u.email,
          username: u.username,
          passwordHash: passwordHash,
          role: 'PLAYER',
          havenCoins: 5000,
          havenGems: 100,
          emailVerified: true,
          status: 'ACTIVE',
        },
      });

      await prisma.avatar.create({
        data: {
          userId: user.id,
          skinTone: 'fair',
          hairStyle: 'messy',
          hairColor: 'brown',
          gender: 'neutral',
        },
      });

      await prisma.room.create({
        data: {
          name: `${u.username}'s Loft`,
          ownerId: user.id,
          isPublic: true,
          theme: 'loft',
        },
      });
    }

    if (!firstToken) {
      firstToken = generateAccessToken(user.id, user.username, user.role);
    }
  }

  console.log(`TEST_JWT=${firstToken}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
