import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

export const ALLOWED_ORIGINS = [
  'https://havenworld.pages.dev',
  'https://havenworld-game.pages.dev',
];

if (process.env.CLIENT_URL && !ALLOWED_ORIGINS.includes(process.env.CLIENT_URL)) {
  ALLOWED_ORIGINS.push(process.env.CLIENT_URL);
}

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:5173');
  ALLOWED_ORIGINS.push('http://127.0.0.1:5173');
}

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, tests) in non-production
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS_ORIGIN_BLOCKED: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 86400,
};

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', retryAfter: 900 },
  skip: (req) => req.path === '/health' || req.path === '/api/health' || req.path.startsWith('/api/test'),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 500 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AUTH_RATE_LIMIT_EXCEEDED', retryAfter: 900 },
});

export function verifyStartupSecurityAssertions(): void {
  if (!process.env.JWT_SECRET && !process.env.JWT_ACCESS_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL environment variable is not set. Refusing to start.');
  }
  if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: REDIS_URL environment variable is not set. Refusing to start.');
  }
  const secret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || '';
  if (process.env.NODE_ENV === 'production' && secret.length < 64) {
    throw new Error('FATAL: JWT_SECRET must be at least 64 hex characters (32 bytes) in production.');
  }
}

export function applySecurityMiddleware(app: Application): void {
  // 1. Trust Nginx as the single trusted proxy for correct IP extraction
  app.set('trust proxy', 1);

  // 2. Helmet security headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP managed at Nginx layer
      hsts: false, // HSTS managed at Nginx layer with preload
      crossOriginEmbedderPolicy: false, // Permissive for game assets
    })
  );

  // 3. CORS
  app.use(cors(corsOptions));

  // 4. Body parser with strict size limit (50kb)
  app.use(express.json({ limit: '50kb' }));
  app.use(express.urlencoded({ extended: true, limit: '50kb' }));

  // 5. Rate limiters
  app.use('/api/', apiRateLimiter);
  app.use('/api/auth/', authRateLimiter);
}
