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
    // bad-words' clean() splits on /\b|_/ (consuming underscores) and rejoins
    // with the first delimiter, so it silently mangles clean messages
    // ("e2e_123" → "e2e123"). Only run it when the message really is profane.
    const filtered = filter.isProfane(trimmed) ? filter.clean(trimmed) : trimmed;
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

export interface CheckMessageOptions {
  userId: string;
  message: string;
  isMuted?: boolean;
  isAdmin?: boolean;
  socketId?: string;
}

export interface CheckMessageResult {
  allowed: boolean;
  sanitized: string;
  reason?: 'USER_MUTED' | 'MESSAGE_TOO_LONG' | 'EMPTY_MESSAGE' | 'RATE_LIMITED' | 'PROFANITY';
}

export class ModerationService {
  async checkMessage(opts: CheckMessageOptions): Promise<CheckMessageResult> {
    if (opts.isMuted) {
      return { allowed: false, sanitized: '', reason: 'USER_MUTED' };
    }

    if (!opts.message || opts.message.trim().length === 0) {
      return { allowed: false, sanitized: '', reason: 'EMPTY_MESSAGE' };
    }

    if (opts.message.length > 200) {
      return { allowed: false, sanitized: '', reason: 'MESSAGE_TOO_LONG' };
    }

    // Rate limiter check
    const rateLimitKey = opts.socketId || opts.userId;
    const isRateAllowed = checkRateLimit(rateLimitKey, 5, 3000);
    if (!isRateAllowed) {
      return { allowed: false, sanitized: '', reason: 'RATE_LIMITED' };
    }

    // Admins bypass profanity filtering
    if (opts.isAdmin) {
      return { allowed: true, sanitized: opts.message };
    }

    const modResult = moderateMessage(opts.message);
    if (modResult.wasFiltered) {
      return {
        allowed: false,
        sanitized: modResult.filtered,
        reason: 'PROFANITY',
      };
    }

    return {
      allowed: true,
      sanitized: opts.message,
    };
  }
}

