import { SERVER_URL } from '../config';
import { authService } from './auth';

export class BlockService {
  private static instance: BlockService | null = null;
  private _blockedUserIds: Set<string> = new Set();
  private _loaded = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('auth:login', () => {
        this.loadBlockedUsers().catch(console.error);
      });
      window.addEventListener('auth:logout', () => {
        this._blockedUserIds.clear();
        this._loaded = false;
      });
    }
  }

  static getInstance(): BlockService {
    if (!BlockService.instance) {
      BlockService.instance = new BlockService();
    }
    return BlockService.instance;
  }

  isBlocked(userId: string): boolean {
    if (!userId) return false;
    return this._blockedUserIds.has(userId);
  }

  getBlockedUserIds(): Set<string> {
    return new Set(this._blockedUserIds);
  }

  setBlockedLocally(userId: string, blocked: boolean): void {
    if (!userId) return;
    if (blocked) {
      this._blockedUserIds.add(userId);
    } else {
      this._blockedUserIds.delete(userId);
    }
  }

  clear(): void {
    this._blockedUserIds.clear();
    this._loaded = false;
  }

  async loadBlockedUsers(): Promise<Set<string>> {
    const token = authService.token || (await authService.getToken());
    if (!token) return this._blockedUserIds;

    try {
      const res = await fetch(`${SERVER_URL}/api/friends/blocked`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const users: Array<{ id: string; username: string }> = await res.json();
        this._blockedUserIds.clear();
        users.forEach((u) => {
          if (u?.id) this._blockedUserIds.add(u.id);
        });
        this._loaded = true;
      }
    } catch {
      // Best-effort network retrieval
    }
    return this._blockedUserIds;
  }

  async blockUser(targetUserId: string): Promise<boolean> {
    if (!targetUserId) return false;
    const token = authService.token || (await authService.getToken());
    if (!token) return false;

    try {
      const res = await fetch(`${SERVER_URL}/api/friends/block`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ targetUserId }),
      });

      if (res.ok) {
        this._blockedUserIds.add(targetUserId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('haven:user-blocked', { detail: { userId: targetUserId } })
          );
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async unblockUser(targetUserId: string): Promise<boolean> {
    if (!targetUserId) return false;
    const token = authService.token || (await authService.getToken());
    if (!token) return false;

    try {
      const res = await fetch(`${SERVER_URL}/api/friends/unblock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ targetUserId }),
      });

      if (res.ok) {
        this._blockedUserIds.delete(targetUserId);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('haven:user-unblocked', { detail: { userId: targetUserId } })
          );
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const blockService = BlockService.getInstance();
