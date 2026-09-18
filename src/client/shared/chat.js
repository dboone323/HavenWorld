// HavenWorld — Chat text utilities (browser-compatible ES module)
// Source: src/shared/chat.ts — TypeScript type annotations stripped for browser execution.

export const DEFAULT_MAX_LEN = 140;

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeChat(text, maxLen = DEFAULT_MAX_LEN) {
  let s = String(text == null ? '' : text).trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

export function isCommand(text) {
  return String(text == null ? '' : text).trim().startsWith('/');
}

export function parseCommand(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw.startsWith('/')) return null;
  const [command, ...rest] = raw.slice(1).split(' ');
  return { command: command.toLowerCase(), args: rest.join(' ').trim() };
}

export const EMOJI_SHORTCODES = {
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

export function replaceEmojiShortcodes(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/:[a-zA-Z0-9_+-]+:/g, (match) => {
    return EMOJI_SHORTCODES[match] || match;
  });
}

export function formatMeAction(sender, action) {
  const safeSender = String(sender || 'Traveler').trim();
  const safeAction = String(action || '').trim();
  return `*${safeSender} ${safeAction}*`;
}

