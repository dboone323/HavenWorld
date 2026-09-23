import { prisma } from '../prisma';

export const SECRET_PASSWORDS = ['abracadabra', 'open sesame', 'haven secret', 'retro arcade 1984'];

export class SecretRoomService {
  /**
   * Evaluates if a spoken chat message triggers entry into a secret chamber
   */
  static async checkSecretTrigger(userId: string, currentRoomId: string, message: string): Promise<{
    triggered: boolean;
    secretRoomId?: string;
    easterEggName?: string;
  }> {
    const clean = message.trim().toLowerCase();
    const isSecret = SECRET_PASSWORDS.some((pw) => clean.includes(pw));

    if (!isSecret) {
      return { triggered: false };
    }

    // Record secret discovery in user telemetry / stamps
    await prisma.gameEvent.create({
      data: {
        event: 'EASTER_EGG_DISCOVERED',
        userId,
        roomId: currentRoomId,
        payload: { triggerPhrase: clean },
      },
    });

    return {
      triggered: true,
      secretRoomId: 'room_secret_observatory',
      easterEggName: 'The Forgotten Observatory',
    };
  }
}
