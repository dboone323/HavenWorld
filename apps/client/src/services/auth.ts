import type { AvatarData } from '@shared/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:       string;
  username: string;
  email:    string;
  avatar:   AvatarData;
}

interface TokenPayload {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number; // seconds
}

// ─── Module-scoped state (memory only — never touches localStorage) ──────────

let _accessToken:  string | null = null;
let _refreshToken: string | null = null;
let _user:         AuthUser | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVER = import.meta.env.VITE_SERVER_URL ?? '';
const API = `${SERVER}/api`;

function scheduleRefresh(expiresIn: number): void {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  // Refresh 13 minutes before access token expires (or at 13 min if shorter)
  const delayMs = Math.max((expiresIn - 13 * 60) * 1000, 60_000);
  _refreshTimer = setTimeout(() => {
    authService.refresh().catch(() => {
      // Refresh failed — clear state; caller will redirect to login
      authService.logout();
    });
  }, delayMs);
}

// ─── Auth Service ─────────────────────────────────────────────────────────────

export const authService = {
  get token():        string | null  { return _accessToken; },
  get user():         AuthUser | null { return _user; },
  get isLoggedIn():   boolean         { return _accessToken !== null; },

  async register(
    username: string,
    email: string,
    password: string,
    inviteCode?: string
  ): Promise<AuthUser> {
    const res = await fetch(`${API}/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password, inviteCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error(err.message || err.error || 'Registration failed');
    }
    const data: { user: AuthUser } & TokenPayload = await res.json();
    _applyTokens(data);
    return data.user;
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const res = await fetch(`${API}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(err.message ?? 'Login failed');
    }
    const data: { user: AuthUser } & TokenPayload = await res.json();
    _applyTokens(data);
    return data.user;
  },

  async refresh(): Promise<void> {
    if (!_refreshToken) throw new Error('No refresh token');
    const res = await fetch(`${API}/auth/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken: _refreshToken }),
    });
    if (!res.ok) throw new Error('Token refresh failed');
    const data: TokenPayload & { user?: AuthUser } = await res.json();
    _applyTokens(data);
  },

  logout(): void {
    _accessToken  = null;
    _refreshToken = null;
    _user         = null;
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    // Notify the app
    window.dispatchEvent(new CustomEvent('auth:logout'));
  },

  updateAvatar(avatar: AvatarData): void {
    if (_user) _user = { ..._user, avatar };
  },
};

function _applyTokens(
  data: TokenPayload & { user?: AuthUser },
): void {
  _accessToken  = data.accessToken;
  _refreshToken = data.refreshToken;
  if (data.user) _user = data.user;
  scheduleRefresh(data.expiresIn);
}
