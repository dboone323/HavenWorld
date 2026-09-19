import { PrivacyManager } from '../../src/services/PrivacyManager';
import { prisma } from '../../src/prisma';
import { createTestUser, createTestRoom } from '../helpers/factories';
import { truncateAllTables } from '../helpers/dbHelpers';

describe('Loft Privacy & Doorbell Integration', () => {
  beforeAll(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should allow any user to enter a public loft', async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'PUBLIC' });

    const access = await PrivacyManager.checkAccess(stranger.id, room.id);
    expect(access.allowed).toBe(true);
    expect(access.mode).toBe('PUBLIC');
  });

  it('should deny non-friends from entering a friends-only loft', async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'FRIENDS_ONLY' });

    const access = await PrivacyManager.checkAccess(stranger.id, room.id);
    expect(access.allowed).toBe(false);
    expect(access.reason).toBe('FRIENDS_ONLY');
  });

  it('should allow an accepted friend to enter a friends-only loft', async () => {
    const owner = await createTestUser();
    const friendUser = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'FRIENDS_ONLY' });

    // Create accepted friendship
    await prisma.friend.create({
      data: {
        requesterId: owner.id,
        addresseeId: friendUser.id,
        status: 'ACCEPTED',
      },
    });

    const access = await PrivacyManager.checkAccess(friendUser.id, room.id);
    expect(access.allowed).toBe(true);
    expect(access.mode).toBe('FRIENDS_ONLY');
  });

  it('should require and validate password for password-protected lofts', async () => {
    const owner = await createTestUser();
    const visitor = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'PUBLIC' });

    // Set password
    await PrivacyManager.setRoomPrivacy(owner.id, room.id, 'PASSWORD_PROTECTED', 'secret123');

    // No password
    const noPass = await PrivacyManager.checkAccess(visitor.id, room.id);
    expect(noPass.allowed).toBe(false);
    expect(noPass.reason).toBe('PASSWORD_REQUIRED');

    // Wrong password
    const wrongPass = await PrivacyManager.checkAccess(visitor.id, room.id, 'wrongpassword');
    expect(wrongPass.allowed).toBe(false);
    expect(wrongPass.reason).toBe('PASSWORD_INCORRECT');

    // Correct password
    const rightPass = await PrivacyManager.checkAccess(visitor.id, room.id, 'secret123');
    expect(rightPass.allowed).toBe(true);
    expect(rightPass.mode).toBe('PASSWORD_PROTECTED');
  });

  it('should queue a doorbell knock in Redis for locked lofts', async () => {
    const owner = await createTestUser();
    const visitor = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'LOCKED' });

    const knockResult = await PrivacyManager.ringDoorbell(visitor.id, room.id);
    expect(knockResult.sent).toBe(true);
  });

  it('should process owner doorbell decision admitting or denying visitors', async () => {
    const owner = await createTestUser();
    const visitor = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'LOCKED' });

    await PrivacyManager.ringDoorbell(visitor.id, room.id);

    // Owner admits visitor
    const admitResult = await PrivacyManager.decideDoorbell(owner.id, visitor.id, room.id, true);
    expect(admitResult.success).toBe(true);
    expect(admitResult.admitted).toBe(true);
  });

  it('should manage co-decorator permissions for placing furniture', async () => {
    const owner = await createTestUser();
    const decorator = await createTestUser();
    const room = await createTestRoom(owner.id, { privacy: 'PUBLIC' });

    // Grant decorator
    const granted = await PrivacyManager.grantDecorator(owner.id, room.id, decorator.id);
    expect(granted).toBeDefined();
    expect(granted.userId).toBe(decorator.id);

    const isDeco = await prisma.roomDecorator.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: decorator.id } },
    });
    expect(isDeco).not.toBeNull();

    // Owner revokes decorator
    await PrivacyManager.revokeDecorator(owner.id, room.id, decorator.id);
    const revoked = await prisma.roomDecorator.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: decorator.id } },
    });
    expect(revoked).toBeNull();
  });
});
