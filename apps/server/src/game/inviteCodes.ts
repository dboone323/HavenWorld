import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export class InviteCodeManager {
  /**
   * Generates a cryptographically secure random invite code (e.g., HAVEN-A1B2C3D4)
   */
  public static async generateCode(
    createdByUserId: string,
    expiresInDays: number = 30
  ): Promise<string> {
    const rawHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `HAVEN-${rawHex}`;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    await prisma.inviteCode.create({
      data: {
        code,
        createdBy: createdByUserId,
        expiresAt,
        isActive: true,
      },
    });

    return code;
  }

  /**
   * Redeems an invite code atomically within a Prisma transaction
   */
  public static async redeemCodeInTransaction(
    tx: Prisma.TransactionClient,
    rawCode: string,
    newUserId: string
  ): Promise<boolean> {
    const code = rawCode.trim().toUpperCase();

    const invite = await tx.inviteCode.findUnique({
      where: { code },
    });

    if (!invite || !invite.isActive || invite.usedById || invite.expiresAt < new Date()) {
      throw new Error('INVALID_INVITE_CODE: Code is invalid, expired, or already used.');
    }

    await tx.inviteCode.update({
      where: { id: invite.id },
      data: {
        isActive: false,
        usedById: newUserId,
        usedAt: new Date(),
      },
    });

    return true;
  }
}
