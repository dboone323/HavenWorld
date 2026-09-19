import { prisma } from '../../src/prisma';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { User, Room, Item, InviteCode, ItemCategory, RoomPrivacy } from '@prisma/client';
import type { AvatarData } from '@havenworld/shared';

export const defaultTestAvatar: AvatarData = {
  bodyType: 'default',
  skinTone: '#ffd1b3',
  hairStyle: 'hair-short-01',
  hairColor: '#4a2c11',
  eyeStyle: 'eyes-default',
  eyeColor: '#1a5276',
  outfitHead: null,
  outfitFace: null,
  outfitBody: null,
  outfitLegs: null,
  outfitFeet: null,
  outfitBack: null,
  outfitHand: null,
};

/**
 * Creates a real test user in the database with verified email and hashed password
 */
export async function createTestUser(
  overrides: Partial<{
    email: string;
    username: string;
    password: string;
    emailVerified: boolean;
    isBanned: boolean;
    isAdmin: boolean;
    havenCoins: number;
    havenGems: number;
    emailVerifyToken: string | null;
  }> = {}
): Promise<User> {
  const uniqueSuffix = randomUUID().slice(0, 8);
  const passwordHash = await bcrypt.hash(overrides.password || 'SecurePass1!', 10);

  const user = await prisma.user.create({
    data: {
      email: overrides.email || `testuser_${uniqueSuffix}@test.com`,
      username: overrides.username || `user_${uniqueSuffix}`,
      passwordHash,
      emailVerified: overrides.emailVerified ?? true,
      role: overrides.isAdmin ? 'ADMIN' : 'PLAYER',
      status: overrides.isBanned ? 'BANNED' : 'ACTIVE',
      havenCoins: overrides.havenCoins ?? 1000,
      havenGems: overrides.havenGems ?? 50,
      emailVerifyToken: overrides.emailVerifyToken !== undefined ? overrides.emailVerifyToken : null,
      avatar: {
        create: {
          skinTone: '#ffd1b3',
          hairStyle: 'short',
          hairColor: '#4a2c11',
          eyeColor: '#1a5276',
          bodyTypeVal: 0.5,
          heightVal: 1.0,
          buildVal: 0.5,
        },
      },
    },
    include: {
      avatar: true,
    },
  });

  return user;
}

/**
 * Creates a real test room in the database
 */
export async function createTestRoom(
  ownerId: string,
  overrides: Partial<{
    name: string;
    privacy: RoomPrivacy;
    passwordHash: string | null;
    password?: string;
    maxOccupants: number;
    isPublic: boolean;
    theme: string;
  }> = {}
): Promise<Room> {
  const uniqueSuffix = randomUUID().slice(0, 8);
  let passwordHash = overrides.passwordHash ?? null;
  if (overrides.password && !passwordHash) {
    passwordHash = await bcrypt.hash(overrides.password, 10);
  }

  return prisma.room.create({
    data: {
      name: overrides.name || `Test Room ${uniqueSuffix}`,
      ownerId,
      privacy: overrides.privacy || 'PUBLIC',
      passwordHash,
      maxOccupants: overrides.maxOccupants ?? 20,
      isPublic: overrides.isPublic ?? true,
      theme: overrides.theme || 'default',
    },
  });
}

/**
 * Creates a real item in the database catalog
 */
export async function createTestItem(
  overrides: Partial<{
    name: string;
    price: number;
    category: ItemCategory;
    spriteKey: string;
  }> = {}
): Promise<Item> {
  const uniqueSuffix = randomUUID().slice(0, 8);
  return prisma.item.create({
    data: {
      name: overrides.name || `Test Item ${uniqueSuffix}`,
      price: overrides.price ?? 100,
      category: overrides.category || 'FURNITURE',
      spriteKey: overrides.spriteKey || `item_${uniqueSuffix}`,
    },
  });
}

/**
 * Creates a real invite code in the database
 */
export async function createTestInviteCode(
  overrides: Partial<{
    code: string;
    used: boolean;
    usedById: string | null;
    creatorId?: string;
  }> = {}
): Promise<InviteCode> {
  let creatorId = overrides.creatorId;
  if (!creatorId) {
    const creator = await createTestUser({ isAdmin: true });
    creatorId = creator.id;
  }

  const code = overrides.code || `TEST_${randomUUID().slice(0, 6).toUpperCase()}`;
  return prisma.inviteCode.create({
    data: {
      code,
      createdBy: creatorId,
      isActive: !overrides.used,
      usedById: overrides.usedById || null,
      usedAt: overrides.used ? new Date() : null,
      expiresAt: new Date(Date.now() + 86400000 * 7),
    },
  });
}
