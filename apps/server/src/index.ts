import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import * as Sentry from '@sentry/node';
import { connectRedis } from './redis';
import { prisma } from './prisma';
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
import { PetManager } from './services/PetManager';
import { registerSocketHandlers } from './sockets';

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  version: '0.1.0',
};

// ── Sentry (error monitoring) ────────────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// ── Socket.io ────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://havenworld-game.pages.dev',
  'https://havenworld.pages.dev',
  'http://localhost:5173',
].filter((url): url is string => Boolean(url));

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl) or matching origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in alpha for custom nip.io subdomains
      }
    },
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // Phaser handles its own CSP needs
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ── Health check ──────────────────────────────────────────────────────────────
// UptimeRobot and GitHub Actions health checks hit this endpoint
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`; // verify DB is reachable
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor(process.uptime()),
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

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[Error]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
);

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
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received — shutting down gracefully');
  httpServer.close(async () => {
    await prisma.$disconnect();
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
});

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app, httpServer, io };
