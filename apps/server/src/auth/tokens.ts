import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma';

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_secret_fallback_for_tests';
const ACCESS_TOKEN_EXPIRY = '15m';
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

export async function generateRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt,
      familyId: crypto.randomUUID(),
    },
  });

  return token;
}
