import jwt from 'jsonwebtoken';

// Test tokens must be minted EXACTLY like production ones: same secret
// precedence, same issuer/audience (requireAuth + socket auth pin them via
// verifyAccessToken) and HS256.
const TEST_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'test_jwt_secret_not_for_production_use_only';
const TEST_ISSUER = 'havenworld-api';
const TEST_AUDIENCE = 'havenworld-client';

/**
 * Generates a valid, cryptographically signed JWT for a given userId
 */
export function generateTestToken(
  userId: string,
  expiresIn: string | number = '15m',
  extraPayload: Record<string, any> = {}
): string {
  return jwt.sign(
    {
      userId,
      username: `user_${userId.slice(0, 8)}`,
      role: 'PLAYER',
      iat: Math.floor(Date.now() / 1000),
      ...extraPayload,
    },
    TEST_SECRET,
    {
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
    }
  );
}

/**
 * Generates a JWT that expired 1 second ago
 */
export function generateExpiredToken(userId: string): string {
  return jwt.sign(
    {
      userId,
      username: `user_${userId.slice(0, 8)}`,
      role: 'PLAYER',
    },
    TEST_SECRET,
    {
      expiresIn: -1,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
    }
  );
}

/**
 * Generates a structurally valid JWT signed with a different secret
 */
export function generateTokenWithWrongSecret(userId: string): string {
  return jwt.sign(
    {
      userId,
      username: `user_${userId.slice(0, 8)}`,
      role: 'PLAYER',
    },
    'this_is_definitely_the_wrong_secret',
    {
      expiresIn: '15m',
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
    }
  );
}

/**
 * Decodes a JWT payload without verification
 */
export function decodeTestToken(token: string): jwt.JwtPayload | null {
  return jwt.decode(token) as jwt.JwtPayload | null;
}
