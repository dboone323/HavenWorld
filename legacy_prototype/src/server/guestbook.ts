/**
 * HavenWorld — Loft Guestbook & Tip Jar System.
 * Unit-testable module.
 */

export interface GuestbookEntry {
  id: string;
  senderId: string;
  senderName: string;
  message: string;
  createdAt: number;
}

export interface TipRecord {
  id: string;
  tipperId: string;
  tipperName: string;
  ownerId: string;
  amount: number;
  createdAt: number;
}

export function createGuestbookEntry(senderId: string, senderName: string, message: string): GuestbookEntry | null {
  const trimmed = (message || '').trim().slice(0, 140);
  if (!trimmed) return null;
  return {
    id: 'gb_' + Math.random().toString(36).substring(2, 9),
    senderId,
    senderName: senderName || 'Visitor',
    message: trimmed,
    createdAt: Date.now()
  };
}

export function addGuestbookEntry(existing: GuestbookEntry[], newEntry: GuestbookEntry, maxEntries = 50): GuestbookEntry[] {
  const updated = [newEntry, ...existing];
  return updated.slice(0, maxEntries);
}

export function validateTip(tipperCoins: number, amount: number): { valid: boolean; amount: number; message?: string } {
  const rounded = Math.floor(amount || 0);
  if (rounded < 10) {
    return { valid: false, amount: 0, message: 'Minimum tip is 10 HavenCoins.' };
  }
  if (rounded > 500) {
    return { valid: false, amount: 0, message: 'Maximum single tip is 500 HavenCoins.' };
  }
  if (tipperCoins < rounded) {
    return { valid: false, amount: 0, message: 'Not enough HavenCoins for this tip.' };
  }
  return { valid: true, amount: rounded };
}
