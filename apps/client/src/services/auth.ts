import type { AvatarData } from '@shared/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:       string;
  username: string;
  email:    string;
  role?:    string;
  avatar:   AvatarData;
}

// ─── Module-scoped state (memory only — never touches localStorage) ──────────

let _accessToken: string | null = null;
let _user:        AuthUser | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVER = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://147-224-164-228.nip.io' : '');
const API = `${SERVER}/api`;

// ─── Auth Service ─────────────────────────────────────────────────────────────

export const authService = {
  get token():        string | null  { return _accessToken; },
  get user():         AuthUser | null { return _user; },
  get isLoggedIn():   boolean         { return _accessToken !== null; },

  getToken(): string | null {
    return _accessToken;
  },

  getUser(): AuthUser | null {
    return _user;
  },

  async register(
    username: string,
    email: string,
    password: string,
    inviteCode?: string
  ): Promise<any> {
    const res = await fetch(`${API}/auth/register`, {
      method:  'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password, inviteCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error(err.error || err.message || 'Registration failed');
    }
    return res.json();
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const res = await fetch(`${API}/auth/login`, {
      method:  'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(err.error || err.message || 'Login failed');
    }
    const data = await res.json();
    if (data.accessToken) {
      _accessToken = data.accessToken;
      _user = data.user;
    }
    return _user!;
  },

  async refresh(): Promise<boolean> {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method:      'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.accessToken) {
        _accessToken = data.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  async logout(): Promise<void> {
    try {
      await fetch(`${API}/auth/logout`, {
        method:      'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on logout
    }
    _accessToken = null;
    _user        = null;
    window.dispatchEvent(new CustomEvent('auth:logout'));
  },

  updateAvatar(avatar: AvatarData): void {
    if (_user) _user = { ..._user, avatar };
  },
};

// Silently refresh the access token every 13 minutes (token expires at 15 minutes)
setInterval(async () => {
  if (_accessToken) {
    await authService.refresh();
  }
}, 13 * 60 * 1000);
