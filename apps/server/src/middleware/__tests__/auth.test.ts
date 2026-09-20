import { Response, NextFunction } from 'express';
import { requireAuth, requireRole, type AuthRequest } from '../auth';
import { generateTestToken, generateExpiredToken, generateTokenWithWrongSecret } from '../../../__tests__/helpers/jwtHelpers';
import { truncateAllTables, seedMinimalData } from '../../../__tests__/helpers/dbHelpers';
import { createTestUser } from '../../../__tests__/helpers/factories';

function createMockReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
    user: undefined,
  } as unknown as AuthRequest;

  let statusCode = 200;
  let responseBody: any = null;

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (body: any) => {
      responseBody = body;
      return res;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
  } as unknown as Response & { getStatusCode: () => number; getBody: () => any };

  let nextCalled = false;
  let nextError: any = null;
  const next: NextFunction = (err?: any) => {
    nextCalled = true;
    nextError = err;
  };

  return { req, res, next, getNextStatus: () => ({ called: nextCalled, error: nextError }) };
}

describe('AuthMiddleware', () => {
  beforeAll(async () => {
    await truncateAllTables();
    await seedMinimalData();
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  it('should set req.user when a valid JWT is provided', async () => {
    const userId = 'user_abc123';
    const token = generateTestToken(userId, '15m', { username: 'testuser', role: 'PLAYER' });
    const { req, res, next, getNextStatus } = createMockReqRes(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(getNextStatus().called).toBe(true);
    expect(getNextStatus().error).toBeFalsy();
    expect(req.user).toBeDefined();
    expect(req.user?.userId).toBe(userId);
    expect(req.user?.role).toBe('PLAYER');
  });

  it('should return 401 when Authorization header is absent', async () => {
    const { req, res, next, getNextStatus } = createMockReqRes(undefined);

    requireAuth(req, res, next);

    expect(getNextStatus().called).toBe(false);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody()).toEqual(expect.objectContaining({ error: 'Unauthorized', code: 'NO_TOKEN' }));
  });

  it('should return 401 when token is a garbage string', async () => {
    const { req, res, next, getNextStatus } = createMockReqRes('Bearer not.a.real.jwt.garbage');

    requireAuth(req, res, next);

    expect(getNextStatus().called).toBe(false);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody()).toEqual(expect.objectContaining({ error: 'Invalid token', code: 'TOKEN_INVALID' }));
  });

  it('should return 401 with "Token expired" message when JWT is expired', async () => {
    const token = generateExpiredToken('user_xyz');
    const { req, res, next, getNextStatus } = createMockReqRes(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(getNextStatus().called).toBe(false);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody()).toEqual(expect.objectContaining({ error: 'Token expired', code: 'TOKEN_EXPIRED' }));
  });

  it('should return 401 when token is signed with the wrong secret', async () => {
    const badToken = generateTokenWithWrongSecret('user_abc');
    const { req, res, next, getNextStatus } = createMockReqRes(`Bearer ${badToken}`);

    requireAuth(req, res, next);

    expect(getNextStatus().called).toBe(false);
    expect(res.getStatusCode()).toBe(401);
    expect(res.getBody()).toEqual(expect.objectContaining({ error: 'Invalid token', code: 'TOKEN_INVALID' }));
  });

  it('should enforce role-based access with requireRole middleware', async () => {
    // Create real users in the DB — requireRole now does a live DB read
    const adminUser = await createTestUser({ username: 'admin_user_role_test', isAdmin: true });
    const playerUser = await createTestUser({ username: 'player_user_role_test', isAdmin: false });

    const roleMiddleware = requireRole(['ADMIN']);

    // Admin user: should pass
    const adminReq = {
      headers: {},
      user: { userId: adminUser.id, username: adminUser.username, role: 'ADMIN' },
    } as unknown as AuthRequest;
    let adminNextCalled = false;
    let adminNextError: any = null;
    const adminNext: NextFunction = (err?: any) => {
      adminNextCalled = true;
      adminNextError = err;
    };
    let adminStatusCode = 200;
    let adminResponseBody: any = null;
    const adminRes = {
      status: (code: number) => { adminStatusCode = code; return adminRes; },
      json: (body: any) => { adminResponseBody = body; return adminRes; },
    } as unknown as Response;

    await roleMiddleware(adminReq, adminRes, adminNext);
    expect(adminNextCalled).toBe(true);
    expect(adminNextError).toBeFalsy();

    // Player user (JWT role PLAYER, DB role PLAYER): should be rejected
    const playerReq = {
      headers: {},
      user: { userId: playerUser.id, username: playerUser.username, role: 'PLAYER' },
    } as unknown as AuthRequest;
    let playerNextCalled = false;
    let playerNextError: any = null;
    const playerNext: NextFunction = (err?: any) => {
      playerNextCalled = true;
      playerNextError = err;
    };
    let playerStatusCode = 200;
    let playerResponseBody: any = null;
    const playerRes = {
      status: (code: number) => { playerStatusCode = code; return playerRes; },
      json: (body: any) => { playerResponseBody = body; return playerRes; },
    } as unknown as Response;

    await roleMiddleware(playerReq, playerRes, playerNext);
    expect(playerNextCalled).toBe(false);
    expect(playerStatusCode).toBe(403);
    expect(playerResponseBody).toEqual(expect.objectContaining({ error: 'Forbidden' }));
  });
});
