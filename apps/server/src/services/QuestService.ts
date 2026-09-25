import { prisma } from '../prisma';
import { getDailyQuests, QuestTemplate, getUtcDayOfYear } from '@havenworld/shared';
import { getIO } from '../sockets';
import { SOCKET_EVENTS } from '@havenworld/shared';

export class QuestService {
  /**
   * Initializes or returns daily quests for the user for the current UTC day
   */
  static async getUserDailyQuests(userId: string) {
    const today = new Date();
    const startOfUtcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const dailyTemplates = getDailyQuests(today);

    // Fetch existing records for today
    const existing = await prisma.dailyQuestProgress.findMany({
      where: {
        userId,
        questDate: startOfUtcDay,
      },
    });

    const existingMap = new Map(existing.map((e) => [e.questId, e]));

    // Ensure all 3 templates have a record in the database
    const results = [];
    for (const tmpl of dailyTemplates) {
      let record = existingMap.get(tmpl.id);
      if (!record) {
        record = await prisma.dailyQuestProgress.create({
          data: {
            userId,
            questId: tmpl.id,
            progress: 0,
            goal: tmpl.goal,
            completed: false,
            rewardCoins: tmpl.rewardCoins,
            rewardGems: tmpl.rewardGems,
            questDate: startOfUtcDay,
          },
        });
      }
      results.push({
        id: record.id,
        questId: tmpl.id,
        title: tmpl.title,
        description: tmpl.description,
        difficulty: tmpl.difficulty,
        progress: record.progress,
        goal: record.goal,
        completed: record.completed,
        rewardCoins: record.rewardCoins,
        rewardGems: record.rewardGems,
      });
    }

    return results;
  }

  /**
   * Increments progress for any active quests matching the specified action type
   */
  static async incrementProgress(
    userId: string,
    actionType: QuestTemplate['actionType'],
    amount = 1
  ) {
    const today = new Date();
    const startOfUtcDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    const dailyTemplates = getDailyQuests(today);
    const matchingTemplates = dailyTemplates.filter((t) => t.actionType === actionType);

    if (matchingTemplates.length === 0) return;

    for (const tmpl of matchingTemplates) {
      const record = await prisma.dailyQuestProgress.findUnique({
        where: {
          userId_questId_questDate: {
            userId,
            questId: tmpl.id,
            questDate: startOfUtcDay,
          },
        },
      });

      if (!record || record.completed) continue;

      const newProgress = Math.min(record.goal, record.progress + amount);
      const isNowCompleted = newProgress >= record.goal;

      await prisma.dailyQuestProgress.update({
        where: { id: record.id },
        data: {
          progress: newProgress,
          completed: isNowCompleted,
        },
      });

      const io = getIO();
      if (io) {
        io.to(`user:${userId}`).emit(SOCKET_EVENTS.QUEST_PROGRESS_UPDATE, {
          questId: tmpl.id,
          progress: newProgress,
          goal: record.goal,
          completed: isNowCompleted,
        });
      }

      if (isNowCompleted) {
        const updateData: { havenGems?: { increment: number }; havenCoins?: { increment: number } } = {};
        if (record.rewardGems > 0) updateData.havenGems = { increment: record.rewardGems };
        if (record.rewardCoins > 0) updateData.havenCoins = { increment: record.rewardCoins };

        if (Object.keys(updateData).length > 0) {
          await prisma.user.update({
            where: { id: userId },
            data: updateData,
          });
        }

        if (io) {
          io.to(`user:${userId}`).emit(SOCKET_EVENTS.QUEST_COMPLETE, {
            questId: tmpl.id,
            title: tmpl.title,
            rewardCoins: record.rewardCoins,
            rewardGems: record.rewardGems,
          });
        }
      }
    }
  }
}
