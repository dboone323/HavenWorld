import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { AuthService, AuthError } from '../authService';

function makeJwt(offsetSeconds: number): string {
  const payload = {
    sub: 'user_delete_123',
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

describe('AuthService — Account Deletion Flow (A2)', () => {
  let server: Server;
  let apiUrl: string;
  let service: AuthService;
  let recordedRequests: RecordedRequest[] = [];
  let responderQueue: Array<(req: RecordedRequest, res: ServerResponse) => void> = [];

  function enqueueJson(status: number, body: unknown): void {
    responderQueue.push((_req, res) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(body));
    });
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        const record: RecordedRequest = {
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body: rawBody,
        };
        recordedRequests.push(record);

        if (req.method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          });
          res.end();
          return;
        }

        const responder = responderQueue.shift();
        if (responder) {
          responder(record, res);
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No response queued' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');
    apiUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    recordedRequests = [];
    responderQueue = [];
    service = new AuthService(apiUrl);
  });

  it('deleteAccount() sends DELETE /api/users/me with password in body and Bearer auth', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token }); // for login
    enqueueJson(200, { message: 'Account permanently deleted.' }); // for delete

    await service.login('deluser@havenworld.com', 'ValidPass123!');

    const logoutEventSpy = vi.fn();
    window.addEventListener('auth:logout', logoutEventSpy);

    await service.deleteAccount('ValidPass123!');

    expect(recordedRequests).toHaveLength(2);
    const deleteReq = recordedRequests[1];
    expect(deleteReq.method).toBe('DELETE');
    expect(deleteReq.url).toBe('/api/users/me');
    expect(deleteReq.headers['authorization']).toBe(`Bearer ${token}`);
    expect(JSON.parse(deleteReq.body)).toEqual({ password: 'ValidPass123!' });

    expect(service.token).toBeNull();
    expect(logoutEventSpy).toHaveBeenCalled();
  });

  it('deleteAccount() throws AuthError on incorrect password / non-OK response', async () => {
    const token = makeJwt(3600);
    enqueueJson(200, { accessToken: token }); // for login
    enqueueJson(401, { error: 'Incorrect password.' }); // for delete

    await service.login('deluser@havenworld.com', 'ValidPass123!');

    await expect(service.deleteAccount('WrongPass!')).rejects.toThrow(AuthError);
    expect(service.token).toBe(token); // Token retained on failure
  });
});
