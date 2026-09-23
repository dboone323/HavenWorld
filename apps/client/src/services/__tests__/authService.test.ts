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

  it('(e) logout() → token cleared from memory, refresh endpoint called WITH X-CSRF-Token', async () => {
    const token = makeJwt(3600);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: token }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response); // logout endpoint

    // Double-submit CSRF: server requires cookie + X-CSRF-Token header to match.
    document.cookie = 'csrf_token=csrf-e2e-token-123';

    await service.login('user@havenworld.com', 'pass');
    await service.logout();

    expect(service.token).toBeNull();
    expect(service.isAuthenticated()).toBe(false);

    // Confirm logout API was called to clear httpOnly refresh cookie
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'X-CSRF-Token': 'csrf-e2e-token-123' },
      })
    );

    // Clean up the cookie for other tests
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it("(e2) logout() without a csrf cookie → request still attempted, no header sent", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);

    await service.logout();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({ method: 'POST', headers: undefined })
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

  it('(i) concurrent getToken() with an expired token → exactly ONE refresh request (single-flight)', async () => {
    const expiredToken = makeJwt(-10);
    const freshToken = makeJwt(3600);

    global.fetch = vi
      .fn()
      // login → soon-to-expire token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: expiredToken }),
      } as Response)
      // refresh → slow response so both callers overlap in-flight
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ accessToken: freshToken }),
                } as Response),
              20
            );
          })
      );

    await service.login('user@havenworld.com', 'pass');

    const [a, b] = await Promise.all([service.getToken(), service.getToken()]);

    expect(a).toBe(freshToken);
    expect(b).toBe(freshToken);
    // login(1) + refresh(1) — a second concurrent refresh would rotate the
    // one-time-use refresh token twice and trip server reuse detection
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('(j) resendVerification() posts the email and resolves on 200', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    await service.resendVerification('user@havenworld.com');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/resend-verification'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('(j2) resendVerification() non-OK → throws AuthError', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid email address.' }),
    } as Response);

    await expect(service.resendVerification('nope')).rejects.toThrow(AuthError);
  });

  it('(k) changePassword() sends Bearer auth and logs the device out locally on success', async () => {
    const token = makeJwt(3600);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: token }),
      } as Response) // login
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, devicesLoggedOut: 1 }),
      } as Response) // change-password
      .mockResolvedValueOnce({ ok: true } as Response); // logout

    await service.login('user@havenworld.com', 'SecurePass1!');
    await service.changePassword('SecurePass1!', 'NewPass123!');

    // change-password must carry the Bearer access token
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/auth/change-password'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Bearer '),
        }),
      })
    );
    // Server revoked all sessions → local session ends too
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/auth/logout'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(service.token).toBeNull();
  });
});
