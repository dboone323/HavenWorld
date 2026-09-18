/**
 * HavenWorld — Server-side chat moderation (TypeScript).
 * Re-uses the pure text helpers from shared/chat.mjs and adds server-only
 * concerns: profanity filtering, PII redaction, and rate limiting.
 */
import { sanitizeChat, parseCommand } from '../shared/chat.ts';

// Starter list — Phase 3 replaces this with a full dictionary + regexes.
const DEFAULT_BAD_WORDS: string[] = ['spambot'];

const URL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /\b\d{3}-\d{3}-\d{4}\b/g;

/** True if text contains any word from the (case-insensitive) bad-words list. */
export function containsProfanity(text: unknown, words: string[] = DEFAULT_BAD_WORDS): boolean {
  const lower = String(text == null ? '' : text).toLowerCase();
  return words.some((w) => w.length > 0 && lower.includes(w.toLowerCase()));
}

/** Redact obvious emails and US-style phone numbers (PII protection). */
export function redactPII(text: unknown): string {
  return String(text == null ? '' : text)
    .replace(URL_RE, '[redacted-email]')
    .replace(PHONE_RE, '[redacted-phone]');
}

export interface ModResult {
  text: string;
  flagged: boolean;
}

/** Run the moderation pipeline: trim/cap, redact PII, flag profanity. */
export function moderateChat(text: unknown, maxLen: number = 140, words: string[] = DEFAULT_BAD_WORDS): ModResult {
  let s = sanitizeChat(text, maxLen);
  const flagged = containsProfanity(s, words);
  s = redactPII(s);
  return { text: s, flagged };
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
}

/** Token-bucket-ish rate limiter: limit messages per windowMs per key. */
export function createRateLimiter(limit: number = 10, windowMs: number = 10000) {
  const buckets = new Map<string, { count: number; start: number }>();
  return function allow(key: string): RateLimitResult {
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
