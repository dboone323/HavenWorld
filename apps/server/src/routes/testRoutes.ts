import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';

const router = Router();

/**
 * Guard check: test routes are strictly enabled only when NODE_ENV === 'test'
 * AND the database is a *_test database. Without the second check a server booted with
 * NODE_ENV=test but a production DATABASE_URL would expose /api/test/reset, which deletes
 * users — the same guard Jest applies in tests/jest.globalSetup.ts.
 */
router.use((_req: Request, res: Response, next) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'Test routes only available in test environment' });
  }
  if (!(process.env.DATABASE_URL ?? '').includes('_test')) {
    return res.status(403).json({
      error: 'Test routes require a *_test database; refusing to run against this target',
    });
  }
  next();
});

/**
 * POST /api/test/verify-email
 * Marks the user's email as verified immediately
 */
router.post('/verify-email', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = await prisma.user.update({
      where: { email },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
      },
    });

    return res.json({ success: true, user: { id: user.id, email: user.email, emailVerified: user.emailVerified } });
  } catch (err: any) {
    return res.status(404).json({ error: 'User not found or update failed', details: err.message });
  }
});

/**
 * POST /api/test/reset
 * Resets test users and test entities
 */
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: '@havenworld.test' } },
          { email: { startsWith: 'test-' } },
          { username: { startsWith: 'testuser' } },
          { username: { startsWith: 'e2e_' } },
        ],
      },
    });

    return res.json({ success: true, message: 'Test database reset complete' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to reset test database', details: err.message });
  }
});

/**
 * POST /api/test/cleanup
 * Cleans up specific users or all test users
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  const { emails, usernames } = req.body;

  try {
    if (Array.isArray(emails) && emails.length > 0) {
      await prisma.user.deleteMany({
        where: { email: { in: emails } },
      });
    } else if (Array.isArray(usernames) && usernames.length > 0) {
      await prisma.user.deleteMany({
        where: { username: { in: usernames } },
      });
    } else {
      await prisma.user.deleteMany({
        where: {
          OR: [
            { email: { endsWith: '@havenworld.test' } },
            { username: { startsWith: 'test_' } },
            { username: { startsWith: 'e2e_' } },
          ],
        },
      });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: 'Cleanup failed', details: err.message });
  }
});

/**
 * GET /api/test/inventory/:username
 * Returns user inventory and coin balance for assertion in E2E tests
 */
router.get('/inventory/:username', async (req: Request, res: Response) => {
  const username = String(req.params.username);

  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const items = await prisma.inventory.findMany({
      where: { userId: user.id },
      include: { item: true },
    });

    return res.json({
      username: user.username,
      coins: user.havenCoins,
      gems: user.havenGems,
      inventory: items,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch user inventory', details: err.message });
  }
});

export default router;
