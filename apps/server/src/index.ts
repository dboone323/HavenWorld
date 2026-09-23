import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { connectRedis, redis } from './redis';
import { prisma } from './prisma';
import { initSentry, captureException } from './monitoring/sentry';
import {
  applySecurityMiddleware,
  verifyStartupSecurityAssertions,
  ALLOWED_ORIGINS,
} from './middleware/security';
import { csrfProtection } from './middleware/csrf';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import roomRoutes from './routes/rooms';
import friendRoutes from './routes/friends';
import reportRoutes from './routes/reports';
import adminRoutes from './routes/admin';
import shopRoutes from './routes/shop';
import passportRoutes from './routes/passport';
import galleryRoutes from './routes/gallery';
import questRoutes from './routes/quests';
import clubRoutes from './routes/clubs';
import workshopRoutes from './routes/workshop';
import marketplaceRoutes from './routes/marketplace';
import testRoutes from './routes/testRoutes';
import { PetManager } from './services/PetManager';
import { FishingService } from './services/FishingService';
import { ShopService } from './services/ShopService';
import { WorkshopService } from './services/WorkshopService';
import { SeasonalEventService } from './services/SeasonalEventService';
import { registerSocketHandlers } from './sockets';
import cron from 'node-cron';

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  version: '0.1.0',
};

// ── Verify critical security assertions at startup ───────────────────────────
verifyStartupSecurityAssertions();

// ── Express app & HTTP server ────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// ── Sentry (error monitoring) ────────────────────────────────────────────────
initSentry();

// ── Security & Core Middleware ───────────────────────────────────────────────
applySecurityMiddleware(app);
app.use(cookieParser());
app.use(csrfProtection);

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS_ORIGIN_BLOCKED'));
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 64 * 1024,
  perMessageDeflate: false,
  pingTimeout: 20000,
  pingInterval: 10000,
});

// ── Health check ──────────────────────────────────────────────────────────────
// UptimeRobot and GitHub Actions health checks hit this endpoint
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`; // verify DB is reachable
    const memory = process.memoryUsage();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor(process.uptime()),
      // Part 9B §3 live monitoring: surfaced to the beta gate and the status page.
      socketCount: io.engine.clientsCount,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      rss: memory.rss,
      redis: redis.isReady ? 'connected' : 'disconnected',
    });
  } catch {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/passport', passportRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/workshop', workshopRoutes);
app.use('/api/marketplace', marketplaceRoutes);

if (process.env.NODE_ENV === 'test') {
  app.use('/api/test', testRoutes);
}

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler ─────────────────────────────────────────────────────
app.use(globalErrorHandler);

// ── Socket.io handlers ────────────────────────────────────────────────────────
registerSocketHandlers(io);

// ── Startup ──────────────────────────────────────────────────────────────────
const PORT = SERVER_CONFIG.port;

async function start() {
  try {
    await connectRedis();
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');

    // Initialize autonomous systems
    PetManager.init();

    // ── Scheduled Cron Jobs ───────────────────────────────────────────────────
    // Weekly fishing leaderboard reset: Monday 00:00 UTC (Part 6 §1)
    cron.schedule('0 0 * * 1', () => {
      FishingService.resetWeeklyLeaderboard().catch((err) =>
        console.error('[Cron] Weekly leaderboard reset failed:', err)
      );
    });

    // Hourly pet happiness & hunger decay
    cron.schedule('0 * * * *', () => {
      PetManager.decayAllPets().catch((err) =>
        console.error('[Cron] Pet decay sweep failed:', err)
      );
    });

    // Flash sale check: every 30 minutes
    cron.schedule('*/30 * * * *', () => {
      ShopService.processFlashSales().catch((err) =>
        console.error('[Cron] Flash sale sweep failed:', err)
      );
    });

    // Workshop crafting queue completion announcements: every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      WorkshopService.processCompletedCrafts().catch((err) =>
        console.error('[Cron] Crafting completion sweep failed:', err)
      );
    });

    // Seasonal event finalization + 1:1 currency conversion: daily at 00:05 UTC,
    // which closes events the moment their end date has passed (Part 6 §12).
    cron.schedule('5 0 * * *', () => {
      SeasonalEventService.convertExpiredEvents().catch((err) =>
        console.error('[Cron] Seasonal finalization failed:', err)
      );
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] HavenWorld listening on port ${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV}`);
      console.log(`[Server] Client origin: ${process.env.CLIENT_URL}`);
    });
  } catch (err) {
    console.error('[Startup] Failed to start server:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.log(`[Server] ${signal} received — shutting down gracefully`);

  // Never let a deploy/kill hang forever waiting on stuck sockets.
  const forceExit = setTimeout(() => {
    console.error('[Server] Shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000);

  // io.close() disconnects all sockets and closes the underlying HTTP server.
  io.close(async () => {
    try {
      await redis.quit();
    } catch (err) {
      console.error('[Shutdown] Redis quit failed:', err);
    }
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error('[Shutdown] Prisma disconnect failed:', err);
    }
    clearTimeout(forceExit);
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Jest imports this module and builds its own HTTP server around `app`, so it must not bind
// a port in test mode. Playwright's webServer (and .github/workflows/e2e.yml) still need a real
// listener while running under NODE_ENV=test, so they set SERVER_AUTOSTART=true explicitly.
const shouldAutoStart =
  process.env.NODE_ENV !== 'test' || process.env.SERVER_AUTOSTART === 'true';

if (shouldAutoStart) {
  // Crash containment for real server processes only (Jest owns its own
  // process lifecycle and must not have these hijacked). uncaughtException is
  // fatal: in-memory state (socket rooms, trade timers, fishing sessions) can
  // no longer be trusted — report, then exit for a supervisor to restart.
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled promise rejection:', reason);
    captureException(reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception — exiting:', err);
    captureException(err);
    setTimeout(() => process.exit(1), 1000);
  });
  start();
}

export { app, httpServer, io };
