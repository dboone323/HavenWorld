import { type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Double-Submit Cookie Pattern for CSRF protection:
 * 1. On login/register: generate a CSRF token and set it as a NON-httpOnly cookie
 *    so client JavaScript can read it and include it in request headers ('X-CSRF-Token').
 * 2. On state-changing requests: Express reads the token from both the cookie AND the
 *    X-CSRF-Token header and compares them with timingSafeEqual.
 * A cross-site attacker cannot read the cookie due to SameSite=Strict, preventing header forgery.
 */

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie('csrf_token', token, {
    httpOnly: false, // Must be readable by client JS
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe methods skip CSRF checks
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Allow registration and login to bypass CSRF (they issue the initial CSRF token)
  if (
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/register' ||
    req.path === '/login' ||
    req.path === '/register'
  ) {
    return next();
  }

  // Allow test helper routes to bypass CSRF in test environments
  if (process.env.NODE_ENV === 'test' && req.path.startsWith('/api/test')) {
    return next();
  }

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'];

  // If client has csrf_token cookie or refresh_token cookie, enforce CSRF validation
  if (cookieToken || req.cookies?.refresh_token) {
    if (!cookieToken || !headerToken) {
      res.status(403).json({ error: 'CSRF_TOKEN_MISSING' });
      return;
    }

    const cookieBuf = Buffer.from(String(cookieToken), 'utf8');
    const headerBuf = Buffer.from(String(headerToken), 'utf8');

    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      res.status(403).json({ error: 'CSRF_TOKEN_INVALID' });
      return;
    }
  }

  next();
}
