import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    service = new AuthService();
    vi.resetAllMocks();
  });

  it('(a) login() success → token stored in memory, NOT in localStorage', async () => {
    const token = makeJwt(3600);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token }),
    } as Response);

    await service.login('user@havenworld.com', 'password123');

    // Token MUST be in memory
    expect(service.token).toBe(token);
    // Token MUST NOT be in localStorage (XSS protection)
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('accessToken')).toBeNull();
  });

  it('(b) login() failure → throws AuthError, no token stored', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid credentials' }),
    } as Response);

    await expect(service.login('bad@email.com', 'wrong')).rejects.toThrow(AuthError);
    expect(service.token).toBeNull();
  });

  it('(c) getToken() when logged in → returns current token', async () => {
    const token = makeJwt(3600);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token }),
    } as Response);

    await service.login('user@havenworld.com', 'pass');
    const res = await service.getToken();
    expect(res).toBe(token);
  });

  it('(d) getToken() when expired → triggers silent refresh, returns new token', async () => {
    const expiredToken = makeJwt(-10); // already expired 10s ago
    const freshToken = makeJwt(3600);

    global.fetch = vi
      .fn()
      // First call: login with soon-to-expire token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: expiredToken }),
      } as Response)
      // Second call: silent refresh returns a fresh token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: freshToken }),
      } as Response);

    await service.login('user@havenworld.com', 'pass');

    // getToken should detect expiry, refresh silently, then return new token
    const result = await service.getToken();
    expect(result).toBe(freshToken);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('(e) logout() → token cleared from memory, refresh endpoint called', async () => {
    const token = makeJwt(3600);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: token }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response); // logout endpoint

    await service.login('user@havenworld.com', 'pass');
    await service.logout();

    expect(service.token).toBeNull();
    expect(service.isAuthenticated()).toBe(false);

    // Confirm logout API was called to clear httpOnly refresh cookie
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('(f) isAuthenticated() → true when token present and not expired', async () => {
    const token = makeJwt(3600);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: token }),
    } as Response);

    await service.login('user@havenworld.com', 'pass');
    expect(service.isAuthenticated()).toBe(true);
  });

  it('(g) Token expiry: isAuthenticated() false if within 60s of expiry', async () => {
    // Token expires in 30 seconds — within the 60s safety window
    const almostExpiredToken = makeJwt(30);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: almostExpiredToken }),
    } as Response);

    await service.login('user@havenworld.com', 'pass');
    // isAuthenticated should treat "within 60s of expiry" as expired
    expect(service.isAuthenticated()).toBe(false);
  });
});
