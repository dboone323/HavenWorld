import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    role: string;
  };
}

export const requireAuth = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN' });
    return;
  }
  const token = authHeader.slice(7);
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server auth configuration missing' });
    return;
  }
  try {
    const payload = jwt.verify(
      token,
      secret,
      { algorithms: ['HS256'] }
    ) as { userId: string; username: string; role: string };
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }
  }
};

export const requireRole = (roles: string[]) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const upperRoles = roles.map((r) => r.toUpperCase());
    if (!req.user) {
      res.status(403).json({ error: 'Forbidden', code: 'INSUFFICIENT_ROLE' });
      return;
    }
    // Phase 8 Security Hardening: verify role from the live database, not just
    // the JWT claims. A forged or stale JWT with role: ADMIN in the payload
    // must not grant access if the DB record still says PLAYER.
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true, isBanned: true },
    });
    if (!dbUser) {
      res.status(403).json({ error: 'Forbidden', code: 'USER_NOT_FOUND' });
      return;
    }
    if (dbUser.isBanned) {
      res.status(403).json({ error: 'Account banned', code: 'ACCOUNT_BANNED' });
      return;
    }
    if (!upperRoles.includes(dbUser.role.toUpperCase())) {
      res.status(403).json({ error: 'Forbidden', code: 'INSUFFICIENT_ROLE' });
      return;
    }
    next();
  };
