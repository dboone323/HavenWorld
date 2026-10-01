import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { AuthService, AuthError } from '../authService';

// Helper: build a JWT with a given exp claim (iat is now, exp is now + offsetSeconds)
function makeJwt(offsetSeconds: number): string {
  const payload = {
    sub: 'user_123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + offsetSeconds,
  };
  const encoded = btoa(JSON.stringify(payload));
  return `header.${encoded}.signature`;
}

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

describe('AuthService (Real HTTP Server Validation)', () => {
  let server: Server;
  let apiUrl: string;
  let service: AuthService;
  let recordedRequests: RecordedRequest[] = [];
  let responderQueue: Array<(req: RecordedRequest, res: ServerResponse) => void> = [];

  function enqueueJson(status: number, body: unknown, delayMs = 0): void {
    responderQueue.push((_req, res) => {
      const send = () => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(body));
      };
      if (delayMs > 0) setTimeout(send, delayMs);
      else send();
    });
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        const rec: RecordedRequest = {
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body: rawBody,
        };
        recordedRequests.push(rec);
        const next = responderQueue.shift();
        if (next) {
          next(rec, res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    apiUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    recordedRequests = [];
    responderQueue = [];
    service = new AuthService(apiUrl);
  });

  it('(a) login() success → token stored in memory, NOT in localStorage under accessToken', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token });

    await service.login('user@havenworld.com', 'password123');

    expect(service.token).toBe(token);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('accessToken')).toBeNull();
  });

  it('(b) login() failure → throws AuthError, no token stored', async () => {
    enqueueJson(401, { message: 'Invalid credentials' });

    await expect(service.login('bad@email.com', 'wrong')).rejects.toThrow(AuthError);
    expect(service.token).toBeNull();
  });

  it('(c) getToken() when logged in → returns current token', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token });

    await service.login('user@havenworld.com', 'pass');
    const res = await service.getToken();
    expect(res).toBe(token);
  });

  it('(d) getToken() when expired → triggers silent refresh, returns new token', async () => {
    const expiredToken = makeJwt(-10);
    const freshToken = makeJwt(3600);

    enqueueJson(200, { accessToken: expiredToken });
    enqueueJson(200, { accessToken: freshToken });

    await service.login('user@havenworld.com', 'pass');

    const result = await service.getToken();
    expect(result).toBe(freshToken);
    expect(recordedRequests).toHaveLength(2);
    expect(recordedRequests[1].url).toBe('/api/auth/refresh');
  });

  it('(e) logout() → token cleared from memory, logout endpoint called WITH X-CSRF-Token', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token });
    enqueueJson(200, { ok: true });

    document.cookie = 'csrf_token=csrf-e2e-token-123';

    await service.login('user@havenworld.com', 'pass');
    await service.logout();

    expect(service.token).toBeNull();
    expect(service.isAuthenticated()).toBe(false);

    const logoutReq = recordedRequests[recordedRequests.length - 1];
    expect(logoutReq.url).toBe('/api/auth/logout');
    expect(logoutReq.method).toBe('POST');
    expect(logoutReq.headers['x-csrf-token']).toBe('csrf-e2e-token-123');

    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('(e2) logout() without a csrf cookie → request still attempted, no csrf header sent', async () => {
    enqueueJson(200, { ok: true });

    await service.logout();

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0].url).toBe('/api/auth/logout');
    expect(recordedRequests[0].method).toBe('POST');
    expect(recordedRequests[0].headers['x-csrf-token']).toBeUndefined();
  });

  it('(f) isAuthenticated() → true when token present and not expired', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token });

    await service.login('user@havenworld.com', 'pass');
    expect(service.isAuthenticated()).toBe(true);
  });

  it('(g) Token expiry: isAuthenticated() false if within 60s of expiry', async () => {
    const almostExpiredToken = makeJwt(30);
    enqueueJson(200, { accessToken: almostExpiredToken });

    await service.login('user@havenworld.com', 'pass');
    expect(service.isAuthenticated()).toBe(false);
  });

  it('(i) concurrent getToken() with an expired token → exactly ONE refresh request (single-flight)', async () => {
    const expiredToken = makeJwt(-10);
    const freshToken = makeJwt(3600);

    enqueueJson(200, { accessToken: expiredToken });
    enqueueJson(200, { accessToken: freshToken }, 25);

    await service.login('user@havenworld.com', 'pass');

    const [a, b] = await Promise.all([service.getToken(), service.getToken()]);

    expect(a).toBe(freshToken);
    expect(b).toBe(freshToken);
    expect(recordedRequests).toHaveLength(2);
  });

  it('(j) resendVerification() posts the email and resolves on 200', async () => {
    enqueueJson(200, { success: true });

    await service.resendVerification('user@havenworld.com');

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0].url).toBe('/api/auth/resend-verification');
    expect(recordedRequests[0].method).toBe('POST');
  });

  it('(j2) resendVerification() non-OK → throws AuthError', async () => {
    enqueueJson(400, { error: 'Invalid email address.' });

    await expect(service.resendVerification('nope')).rejects.toThrow(AuthError);
  });

  it('(k) changePassword() sends Bearer auth and logs the device out locally on success', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token });
    enqueueJson(200, { success: true, devicesLoggedOut: 1 });
    enqueueJson(200, { ok: true });

    await service.login('user@havenworld.com', 'SecurePass1!');
    await service.changePassword('SecurePass1!', 'NewPass123!');

    expect(recordedRequests).toHaveLength(3);
    expect(recordedRequests[1].url).toBe('/api/auth/change-password');
    expect(recordedRequests[1].method).toBe('POST');
    expect(recordedRequests[1].headers['authorization']).toContain('Bearer ');
    expect(recordedRequests[2].url).toBe('/api/auth/logout');
    expect(service.token).toBeNull();
  });
});
