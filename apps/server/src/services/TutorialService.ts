import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export interface TutorialStatus {
  step: number;
  completed: boolean;
  welcomeBadgeAt: string | null;
}

export class TutorialService {
  /**
   * Retrieves player's current tutorial onboarding state
   */
  static async getTutorialStatus(userId: string): Promise<TutorialStatus> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tutorialStep: true, tutorialCompleted: true, welcomeBadgeAt: true },
    });

    if (!user) throw new Error('User not found');

    return {
      step: user.tutorialStep,
      completed: user.tutorialCompleted,
      welcomeBadgeAt: user.welcomeBadgeAt ? user.welcomeBadgeAt.toISOString() : null,
    };
  }

  /**
   * Advances the player along the 3-step interactive onboarding tutorial:
   * Step 1: Walk to Fountain
   * Step 2: Open Wardrobe & Pick Hat
   * Step 3: Claim First Daily Gift (Grants 100 HavenCoins + Welcome Badge)
   */
  static async advanceStep(userId: string, stepNumber: number) {
    if (![1, 2, 3].includes(stepNumber)) {
      throw new Error('Invalid tutorial step (must be 1, 2, or 3)');
    }

    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, tutorialStep: true, tutorialCompleted: true, havenCoins: true },
      });

      if (!user) throw new Error('User not found');
      if (user.tutorialCompleted) {
        return { step: 3, completed: true, bonusAwarded: false };
      }

      // Ensure sequential step progression
      if (stepNumber > user.tutorialStep + 1) {
        throw new Error(`Cannot skip tutorial step. Current step: ${user.tutorialStep}`);
      }

      const isCompleted = stepNumber === 3;
      const now = new Date();

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          tutorialStep: stepNumber,
          tutorialCompleted: isCompleted,
          welcomeBadgeAt: isCompleted ? now : undefined,
          havenCoins: isCompleted ? { increment: 100 } : undefined,
        },
        select: { tutorialStep: true, tutorialCompleted: true, welcomeBadgeAt: true, havenCoins: true },
      });

      if (isCompleted) {
        await tx.transactionLog.create({
          data: {
            receiverId: userId,
            amount: 100,
            type: 'REWARD',
            source: 'TUTORIAL_COMPLETION_BONUS',
          },
        });
      }

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.TUTORIAL_STEP_COMPLETED, {
          step: stepNumber,
          completed: isCompleted,
        });
        if (isCompleted) {
          io.to(`user:${userId}`).emit(SOCKET_EVENTS.TUTORIAL_FINISHED, {
            bonusCoins: 100,
            welcomeBadge: true,
          });
        }
      }

      return {
        step: updated.tutorialStep,
        completed: updated.tutorialCompleted,
        welcomeBadgeAt: updated.welcomeBadgeAt?.toISOString() || null,
        bonusAwarded: isCompleted,
        newBalance: updated.havenCoins,
      };
    });
  }
}
