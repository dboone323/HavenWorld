import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, requireRole, AuthRequest } from '../auth';
import { generateTestToken, generateExpiredToken, generateTokenWithWrongSecret } from '../../../__tests__/helpers/jwtHelpers';

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
    const { req: adminReq, res: adminRes, next: adminNext, getNextStatus: getAdminStatus } = createMockReqRes();
    adminReq.user = { userId: 'admin_1', username: 'admin', role: 'ADMIN' };

    const roleMiddleware = requireRole(['ADMIN']);
    roleMiddleware(adminReq, adminRes, adminNext);
    expect(getAdminStatus().called).toBe(true);

    const { req: playerReq, res: playerRes, next: playerNext, getNextStatus: getPlayerStatus } = createMockReqRes();
    playerReq.user = { userId: 'player_1', username: 'player', role: 'PLAYER' };

    roleMiddleware(playerReq, playerRes, playerNext);
    expect(getPlayerStatus().called).toBe(false);
    expect(playerRes.getStatusCode()).toBe(403);
    expect(playerRes.getBody()).toEqual(expect.objectContaining({ error: 'Forbidden' }));
  });
});
