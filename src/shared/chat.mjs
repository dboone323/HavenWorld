/** HavenWorld — Chat text utilities (shared, isomorphic). */

const DEFAULT_MAX_LEN = 140;

/** Escape HTML-special characters to prevent XSS in DOM rendering. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trim + length-cap chat input (first-pass server & client normalization). */
export function sanitizeChat(text, maxLen = DEFAULT_MAX_LEN) {
  let s = String(text == null ? '' : text).trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/** True if text is a `/command arg` chat message. */
export function isCommand(text) {
  return String(text == null ? '' : text).trim().startsWith('/');
}

/** Parse `/command args` into `{ command, args }`; null for non-command text. */
export function parseCommand(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw.startsWith('/')) return null;
  const [command, ...rest] = raw.slice(1).split(' ');
  return { command: command.toLowerCase(), args: rest.join(' ').trim() };
}

export { DEFAULT_MAX_LEN };

