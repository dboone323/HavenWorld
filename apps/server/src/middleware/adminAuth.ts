import { Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from './auth';
import { captureSecurityEvent } from '../monitoring/sentry';

export interface AdminAuthRequest extends AuthRequest {
  adminUser?: {
    id: string;
    username: string;
    role: string;
  };
}

/**
 * Validates admin role via a FRESH database read on every request.
 * NEVER trusts the role claim encoded in the client's JWT to prevent privilege escalation.
 */
export async function requireAdmin(
  req: AdminAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'UNAUTHORIZED: Authentication required.' });
    return;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        isBanned: true,
        status: true,
      },
    });

    if (
      !dbUser ||
      dbUser.isBanned ||
      dbUser.status === 'BANNED' ||
      dbUser.role.toUpperCase() !== 'ADMIN'
    ) {
      captureSecurityEvent('UNAUTHORIZED_ACCESS', {
        userId,
        ip: req.ip,
        details: { path: req.path, method: req.method, claimedRole: req.user?.role },
      });

      res.status(403).json({ error: 'FORBIDDEN: Administrative privileges required.' });
      return;
    }

    req.adminUser = {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
    };

    next();
  } catch (err: any) {
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  }
}

/**
 * Creates an immutable audit log entry for administrative actions
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
  ip?: string
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetId,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ip: ip || 'unknown',
      },
    });
  } catch (err) {
    console.error('[AdminAuditLog] Failed to record admin audit event:', err);
  }
}
