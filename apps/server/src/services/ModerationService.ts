import { Filter } from 'bad-words';

const filter = new Filter({ placeHolder: '*' });

export interface ModerationResult {
  filtered: string;
  wasFiltered: boolean;
  severity: 'none' | 'mild' | 'severe';
}

export function moderateMessage(content: string): ModerationResult {
  const trimmed = content.trim();
  try {
    const filtered = filter.clean(trimmed);
    const wasFiltered = filtered !== trimmed;
    return {
      filtered,
      wasFiltered,
      severity: wasFiltered ? 'mild' : 'none',
    };
  } catch {
    // bad-words throws when the entire string is considered profane
    return {
      filtered: '***',
      wasFiltered: true,
      severity: 'severe',
    };
  }
}

// Per-socket rate limiter (not per IP — sockets are already authenticated)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  socketId: string,
  maxMessages: number = 5,
  windowMs: number = 3000
): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(socketId) ?? { count: 0, resetAt: now + windowMs };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }

  record.count += 1;
  rateLimitStore.set(socketId, record);
  return record.count <= maxMessages;
}

export function clearRateLimitEntry(socketId: string): void {
  rateLimitStore.delete(socketId);
}
