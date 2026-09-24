import type { AvatarData } from '@havenworld/shared';
import { API_URL } from '../config';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role?: string;
  avatar?: AvatarData;
  personalRoom?: { id: string; name: string };
}

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export class AuthService {
  private _accessToken: string | null = null;
  private _user: AuthUser | null = null;
  private _apiUrl: string;
  private _refreshPromise: Promise<boolean> | null = null;

  constructor(apiUrl?: string) {
    this._apiUrl = apiUrl || API_URL;
    if (typeof localStorage !== 'undefined') {
      this._accessToken = localStorage.getItem('haven_token');
    }
  }

  get token(): string | null {
    if (!this._accessToken && typeof localStorage !== 'undefined') {
      this._accessToken = localStorage.getItem('haven_token');
    }
    return this._accessToken;
  }

  get user(): AuthUser | null {
    return this._user;
  }

  get isLoggedIn(): boolean {
    return this.isAuthenticated();
  }

  getUser(): AuthUser | null {
    return this._user;
  }

  async me(): Promise<AuthUser | null> {
    if (!this._accessToken && typeof localStorage !== 'undefined') {
      this._accessToken = localStorage.getItem('haven_token');
    }

    // If not authenticated, try silent refresh once
    if (!this._accessToken) {
      const refreshed = await this.refresh();
      if (!refreshed) return null;
    }

    const token = await this.getToken();
    if (!token) return null;

    try {
      const res = await fetch(`${this._apiUrl}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      this._user = data;
      return this._user;
    } catch {
      return null;
    }
  }

  isAuthenticated(): boolean {
    if (!this._accessToken && typeof localStorage !== 'undefined') {
      this._accessToken = localStorage.getItem('haven_token');
    }
    if (!this._accessToken) return false;
    const exp = parseJwtExp(this._accessToken);
    if (!exp) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Expiry safety window: treat token as expired if within 60s of expiry
    return exp - nowSeconds > 60;
  }

  getCsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async getToken(): Promise<string | null> {
    if (!this._accessToken && typeof localStorage !== 'undefined') {
      this._accessToken = localStorage.getItem('haven_token');
    }
    if (!this._accessToken) return null;

    const exp = parseJwtExp(this._accessToken);
    const nowSeconds = Math.floor(Date.now() / 1000);

    // If expired or within 60s, silently refresh
    if (!exp || exp - nowSeconds <= 60) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('haven_token');
        }
        this._accessToken = null;
        return null;
      }
    }

    return this._accessToken;
  }

  async register(
    username: string,
    email: string,
    password: string,
    inviteCode?: string
  ): Promise<any> {
    const res = await fetch(`${this._apiUrl}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, inviteCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Registration failed' }));
      throw new AuthError(err.error || err.message || 'Registration failed');
    }
    const data = await res.json();
    if (data.accessToken) {
      this._accessToken = data.accessToken;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('haven_token', data.accessToken);
      }
      this._user = data.user ?? null;
      // Session established via register (auto-verified accounts get an
      // access token) — UI that depends on auth should reload its user data.
      this.emitLoginEvent();
    }
    return data;
  }

  async login(identifier: string, password: string): Promise<AuthUser> {
    const isEmail = identifier.includes('@');
    const payload = isEmail
      ? { email: identifier.trim().toLowerCase(), password }
      : { username: identifier.trim(), password };

    const res = await fetch(`${this._apiUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      this._accessToken = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('haven_token');
      }
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new AuthError(err.error || err.message || 'Login failed');
    }

    const data = await res.json();
    if (data.accessToken) {
      this._accessToken = data.accessToken;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('haven_token', data.accessToken);
      }
      this._user = data.user ?? null;
      // Session established via login — UI that depends on auth (QuestHUD,
      // etc.) should reload its user data now.
      this.emitLoginEvent();
    }
    return this._user!;
  }

  /** Single-flight refresh: concurrent callers (parallel getToken / me /
   *  socket boot) share ONE in-flight /auth/refresh request. Refresh tokens
   *  are one-time-use — racing requests would rotate twice and trip the
   *  server's token-reuse detection, killing the session's token family. */
  async refresh(): Promise<boolean> {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._performRefresh().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  /**
   * Notify the app that an authenticated session is now established — after
   * login, after register, or after a silent session restore (refresh).
   * The event detail carries only non-sensitive identity info (never tokens
   * or credentials), so listeners like QuestHUD know to (re)load user data.
   */
  private emitLoginEvent(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auth:login', {
          detail: { userId: this._user?.id ?? null, username: this._user?.username ?? null },
        })
      );
    }
  }

  private async _performRefresh(): Promise<boolean> {
    try {
      const res = await fetch(`${this._apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) {
        this._accessToken = data.accessToken;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('haven_token', data.accessToken);
        }
        if (data.user) this._user = data.user;
        // Let services/socket.ts re-attach the new token to the handshake.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('auth:token-refreshed'));
          // A successful refresh (re-)establishes the session — this is the
          // silent session-restore path on page load. UI that depends on
          // auth (QuestHUD, etc.) should (re)load its user data now.
          this.emitLoginEvent();
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      // Logout clears an httpOnly cookie, so the server requires the
      // double-submit CSRF header (cookie + X-CSRF-Token must match).
      const csrf = this.getCsrfToken();
      await fetch(`${this._apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
      });
    } catch {
      // Ignore network errors on logout
    }
    this._accessToken = null;
    this._user = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('haven_token');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
  }

  async resendVerification(email: string): Promise<void> {
    const res = await fetch(`${this._apiUrl}/auth/resend-verification`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ message: 'Could not resend verification email' }));
      throw new AuthError(err.error || err.message || 'Could not resend verification email');
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${this._apiUrl}/auth/change-password`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Password change failed' }));
      throw new AuthError(err.error || err.message || 'Password change failed');
    }
    // The server revoked every refresh session — mirror that locally so this
    // device doesn't sit on a dead session until the access token expires.
    await this.logout();
  }

  updateAvatar(avatar: AvatarData): void {
    if (this._user) {
      this._user = { ...this._user, avatar };
    }
  }
}

export const authService = new AuthService();
