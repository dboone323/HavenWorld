import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma';

// Single source of truth for access-token signing AND verification.
// Precedence: JWT_ACCESS_SECRET first, then JWT_SECRET. (The signer previously
// used `JWT_SECRET || JWT_ACCESS_SECRET` while the verifiers used the opposite
// order — a latent auth bypass masked only by the two secrets currently being
// equal.) All verification goes through verifyAccessToken below so issuer /
// audience pinning can never be skipped again.
const JWT_SECRET =
  process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'dev_secret_fallback_for_tests';

// Aligned expiry naming: JWT_ACCESS_EXPIRES is canonical (apps/server/.env);
// JWT_EXPIRY kept as fallback for .env.test. Previously three different names
// were read across dead code paths with `as any` casts.
const ACCESS_TOKEN_EXPIRY = (process.env.JWT_ACCESS_EXPIRES ??
  process.env.JWT_EXPIRY ??
  '15m') as jwt.SignOptions['expiresIn'];
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateAccessToken(userId: string, username: string, role = 'PLAYER'): string {
  return jwt.sign(
    { userId, username, role },
    JWT_SECRET,
    {
      algorithm: 'HS256', // Explicit algorithm pinning
      expiresIn: ACCESS_TOKEN_EXPIRY,
      issuer: 'havenworld-api',
      audience: 'havenworld-client',
    }
  );
}

export function verifyAccessToken(token: string): { userId: string; username: string; role?: string } {
  // Algorithm pinning prevents algorithm confusion attacks (e.g., alg: "none" or RS256 with HS256 secret)
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'havenworld-api',
    audience: 'havenworld-client',
  }) as { userId: string; username: string; role?: string };
}

/**
 * Creates a DB-backed refresh token. Pass the CURRENT familyId when rotating
 * so every token in one login's lineage shares a family — reuse detection can
 * then revoke the whole family at once.
 */
export async function generateRefreshToken(userId: string, familyId?: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt,
      familyId: familyId ?? crypto.randomUUID(),
    },
  });

  return token;
}
