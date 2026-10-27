import { InviteCodeManager } from '../inviteCodes';
import { prisma } from '../../prisma';
import { createTestUser } from '../../../__tests__/helpers/factories';
import { truncateAllTables } from '../../../__tests__/helpers/dbHelpers';

describe('InviteCodeManager', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('mints single-use invite codes with proper prefix, status, and expiration', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });

    const code = await InviteCodeManager.generateCode(admin.id, 14);

    expect(code).toMatch(/^HAVEN-[A-F0-9]{8}$/);

    const record = await prisma.inviteCode.findUnique({ where: { code } });
    expect(record).not.toBeNull();
    expect(record?.isActive).toBe(true);
    expect(record?.usedById).toBeNull();
    expect(record?.createdBy).toBe(admin.id);

    // Expiration date is ~14 days out
    const expectedExpiry = Date.now() + 14 * 24 * 3600 * 1000;
    expect(Math.abs(record!.expiresAt.getTime() - expectedExpiry)).toBeLessThan(10_000);
  });

  it('redeems single-use invite code atomically, marks used, and prevents reuse', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user1 = await createTestUser();
    const user2 = await createTestUser();

    const code = await InviteCodeManager.generateCode(admin.id, 7);

    // 1. Redeem once
    const redeemed = await prisma.$transaction(async (tx) => {
      return await InviteCodeManager.redeemCodeInTransaction(tx, code, user1.id);
    });
    expect(redeemed).toBe(true);

    // Verify DB state after redemption
    const record = await prisma.inviteCode.findUnique({ where: { code } });
    expect(record?.isActive).toBe(false);
    expect(record?.usedById).toBe(user1.id);
    expect(record?.usedAt).not.toBeNull();

    // 2. Attempt to redeem again -> must fail
    await expect(
      prisma.$transaction(async (tx) => {
        return await InviteCodeManager.redeemCodeInTransaction(tx, code, user2.id);
      })
    ).rejects.toThrow('INVALID_INVITE_CODE');
  });

  it('rejects expired or non-existent invite codes', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser();

    // Non-existent code
    await expect(
      prisma.$transaction(async (tx) => {
        return await InviteCodeManager.redeemCodeInTransaction(tx, 'HAVEN-00000000', user.id);
      })
    ).rejects.toThrow('INVALID_INVITE_CODE');

    // Expired code
    const expiredCode = 'HAVEN-DEADBEEF';
    await prisma.inviteCode.create({
      data: {
        code: expiredCode,
        createdBy: admin.id,
        expiresAt: new Date(Date.now() - 3600_000), // Expired 1 hour ago
        isActive: true,
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        return await InviteCodeManager.redeemCodeInTransaction(tx, expiredCode, user.id);
      })
    ).rejects.toThrow('INVALID_INVITE_CODE');
  });
});
