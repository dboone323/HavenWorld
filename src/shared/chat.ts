/**
 * HavenWorld — Chat text utilities (shared, isomorphic).
 */

export const DEFAULT_MAX_LEN = 140;

/** Escape HTML-special characters to prevent XSS in DOM rendering. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trim + length-cap chat input (first-pass server & client normalization). */
export function sanitizeChat(text: unknown, maxLen: number = DEFAULT_MAX_LEN): string {
  let s = String(text == null ? '' : text).trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/** True if text is a /command arg chat message. */
export function isCommand(text: unknown): boolean {
  return String(text == null ? '' : text).trim().startsWith('/');
}

export interface ParsedCommand {
  command: string;
  args: string;
}

/** Parse /command args into { command, args }; null for non-command text. */
export function parseCommand(text: unknown): ParsedCommand | null {
  const raw = String(text == null ? '' : text).trim();
  if (!raw.startsWith('/')) return null;
  const [command, ...rest] = raw.slice(1).split(' ');
  return { command: command.toLowerCase(), args: rest.join(' ').trim() };
}

/** Standard emoji shortcodes dictionary (per Phase 1 build guide step 25). */
export const EMOJI_SHORTCODES: Record<string, string> = {
  ':wave:': '👋',
  ':heart:': '💖',
  ':love:': '❤️',
  ':laugh:': '😂',
  ':smile:': '😊',
  ':cool:': '😎',
  ':sad:': '😢',
  ':cry:': '😭',
  ':fire:': '🔥',
  ':pizza:': '🍕',
  ':coffee:': '☕',
  ':sparkles:': '✨',
  ':star:': '⭐',
  ':fish:': '🎣',
  ':cat:': '🐱',
  ':dog:': '🐶',
  ':100:': '💯',
  ':party:': '🎉',
  ':clap:': '👏',
  ':eyes:': '👀',
  ':check:': '✅',
};

/** Replace all recognized emoji shortcodes in text with Unicode emojis. */
export function replaceEmojiShortcodes(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/:[a-zA-Z0-9_+-]+:/g, (match) => {
    return EMOJI_SHORTCODES[match] || match;
  });
}

/** Format a /me action emote into third-person action text. */
export function formatMeAction(sender: string, action: string): string {
  const safeSender = String(sender || 'Traveler').trim();
  const safeAction = String(action || '').trim();
  return `*${safeSender} ${safeAction}*`;
}