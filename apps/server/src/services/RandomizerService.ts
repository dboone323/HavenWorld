import crypto from 'crypto';
import { prisma } from '../prisma';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export interface DiceRollResult {
  id: string;
  userId: string;
  username: string;
  roomId: string;
  sides: number;
  result: number;
  timestamp: number;
  formattedMessage: string;
}

export class RandomizerService {
  /**
   * Performs a cryptographically verified dice roll and broadcasts result to room
   */
  static async rollDice(userId: string, roomId: string, sides: number = 20): Promise<DiceRollResult> {
    if (!Number.isInteger(sides) || sides < 2 || sides > 100) {
      throw new Error('Dice sides must be an integer between 2 and 100');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    const username = user?.username || 'Player';
    // Cryptographically secure integer in range [1, sides]
    const result = crypto.randomInt(1, sides + 1);
    const id = `roll_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const formattedMessage = `🎲 ${username} rolled a ${result} (1-${sides})`;

    const rollData: DiceRollResult = {
      id,
      userId,
      username,
      roomId,
      sides,
      result,
      timestamp: Date.now(),
      formattedMessage,
    };

    const io = getIO();
    if (io) {
      io.to(`room:${roomId}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        id,
        roomId,
        senderId: 'SYSTEM',
        senderName: 'System',
        content: formattedMessage,
        type: 'SYSTEM',
        createdAt: new Date().toISOString(),
      });
    }

    return rollData;
  }
}
