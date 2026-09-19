import type { AvatarData } from '@havenworld/shared';

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

  constructor(apiUrl?: string) {
    const defaultServer =
      typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL
        ? import.meta.env.VITE_SERVER_URL
        : typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
        ? import.meta.env.VITE_API_URL
        : '';
    this._apiUrl = apiUrl || `${defaultServer}/api`;
  }

  get token(): string | null {
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

  isAuthenticated(): boolean {
    if (!this._accessToken) return false;
    const exp = parseJwtExp(this._accessToken);
    if (!exp) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Expiry safety window: treat token as expired if within 60s of expiry
    return exp - nowSeconds > 60;
  }

  async getToken(): Promise<string | null> {
    if (!this._accessToken) return null;

    const exp = parseJwtExp(this._accessToken);
    const nowSeconds = Math.floor(Date.now() / 1000);

    // If expired or within 60s, silently refresh
    if (!exp || exp - nowSeconds <= 60) {
      const refreshed = await this.refresh();
      if (!refreshed) {
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
    return res.json();
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const res = await fetch(`${this._apiUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new AuthError(err.error || err.message || 'Login failed');
    }

    const data = await res.json();
    if (data.accessToken) {
      this._accessToken = data.accessToken;
      this._user = data.user ?? null;
    }
    return this._user!;
  }

  async refresh(): Promise<boolean> {
    try {
      const res = await fetch(`${this._apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) {
        this._accessToken = data.accessToken;
        if (data.user) this._user = data.user;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this._apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on logout
    }
    this._accessToken = null;
    this._user = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
  }

  updateAvatar(avatar: AvatarData): void {
    if (this._user) {
      this._user = { ...this._user, avatar };
    }
  }
}

export const authService = new AuthService();
