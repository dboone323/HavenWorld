/**
 * HavenWorld — Server-side chat moderation (ESM).
 * Re-uses the pure text helpers from shared/chat.mjs and adds server-only
 * concerns: profanity filtering, PII redaction, and rate limiting.
 *
 * The full bad-word dictionary (Phase 3) replaces DEFAULT_BAD_WORDS.
 */
import { sanitizeChat, parseCommand } from '../shared/chat.mjs';

// Starter list — Phase 3 replaces this with a full dictionary + regexes.
const DEFAULT_BAD_WORDS = ['spambot'];

const URL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /\b\d{3}-\d{3}-\d{4}\b/g;

/** True if `text` contains any word from the (case-insensitive) bad-words list. */
export function containsProfanity(text, words = DEFAULT_BAD_WORDS) {
  const lower = String(text == null ? '' : text).toLowerCase();
  return words.some(w => w.length > 0 && lower.includes(w.toLowerCase()));
}

/** Redact obvious emails and US-style phone numbers (PII protection). */
export function redactPII(text) {
  return String(text == null ? '' : text)
    .replace(URL_RE, '[redacted-email]')
    .replace(PHONE_RE, '[redacted-phone]');
}

/** Run the moderation pipeline: trim/cap, redact PII, flag profanity. */
export function moderateChat(text, maxLen = 140, words = DEFAULT_BAD_WORDS) {
  let s = sanitizeChat(text, maxLen);
  const flagged = containsProfanity(s, words);
  s = redactPII(s);
  return { text: s, flagged };
}

/** Token-bucket-ish rate limiter: `limit` messages per `windowMs` per key. */
export function createRateLimiter(limit = 10, windowMs = 10000) {
  const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const b = buckets.get(key) || { count: 0, start: now };
    if (now - b.start > windowMs) {
      b.count = 0;
      b.start = now;
    }
    b.count += 1;
    buckets.set(key, b);
    return { allowed: b.count <= limit, count: b.count };
  };
}

export { sanitizeChat, parseCommand, DEFAULT_BAD_WORDS };
