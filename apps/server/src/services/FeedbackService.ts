import { prisma } from '../prisma';

export interface UserFeedbackPayload {
  type: 'BUG' | 'FEATURE' | 'GENERAL';
  title: string;
  message: string;
}

export class FeedbackService {
  /**
   * Submits player bug report or feature feedback into persistent telemetry
   */
  static async submitFeedback(userId: string, data: UserFeedbackPayload) {
    const cleanTitle = data.title.trim().slice(0, 100);
    const cleanMessage = data.message.trim().slice(0, 1000);

    if (cleanTitle.length < 3) {
      throw new Error('Feedback title must be at least 3 characters');
    }
    if (cleanMessage.length < 10) {
      throw new Error('Feedback message must be at least 10 characters');
    }
    if (!['BUG', 'FEATURE', 'GENERAL'].includes(data.type)) {
      throw new Error('Invalid feedback type (must be BUG, FEATURE, or GENERAL)');
    }

    const event = await prisma.gameEvent.create({
      data: {
        event: 'USER_FEEDBACK',
        userId,
        payload: {
          type: data.type,
          title: cleanTitle,
          message: cleanMessage,
        },
      },
      include: {
        user: { select: { username: true } },
      },
    });

    return {
      id: event.id,
      userId,
      username: event.user?.username || 'Unknown',
      type: data.type,
      title: cleanTitle,
      message: cleanMessage,
      createdAt: event.createdAt.toISOString(),
    };
  }

  /**
   * Retrieves feedback backlog for development / staff triage
   */
  static async listFeedback(limit: number = 50) {
    const events = await prisma.gameEvent.findMany({
      where: { event: 'USER_FEEDBACK' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    });

    return events.map((e) => {
      const payload = e.payload as any;
      return {
        id: e.id,
        userId: e.userId,
        username: e.user?.username || 'Unknown',
        type: payload?.type || 'GENERAL',
        title: payload?.title || '',
        message: payload?.message || '',
        createdAt: e.createdAt.toISOString(),
      };
    });
  }
}
