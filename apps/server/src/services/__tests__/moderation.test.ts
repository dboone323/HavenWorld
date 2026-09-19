import { ModerationService, clearRateLimitEntry } from '../ModerationService';

describe('ModerationService', () => {
  let mod: ModerationService;

  beforeEach(() => {
    mod = new ModerationService();
    clearRateLimitEntry('u1');
    clearRateLimitEntry('admin1');
  });

  afterEach(() => {
    clearRateLimitEntry('u1');
    clearRateLimitEntry('admin1');
  });

  it('should allow a chat message with no profanity', async () => {
    const result = await mod.checkMessage({
      userId: 'u1',
      message: 'Hello everyone!',
      isMuted: false,
      isAdmin: false,
    });
    expect(result.allowed).toBe(true);
    expect(result.sanitized).toBe('Hello everyone!');
  });

  it('should block a message containing profanity and return sanitized version', async () => {
    const result = await mod.checkMessage({
      userId: 'u1',
      message: 'You are such a damn bad player!',
      isMuted: false,
      isAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.sanitized).toContain('*');
    expect(result.reason).toBe('PROFANITY');
  });

  it('should reject a message that exceeds the 200 character limit', async () => {
    const longMessage = 'a'.repeat(201);
    const result = await mod.checkMessage({
      userId: 'u1',
      message: longMessage,
      isMuted: false,
      isAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MESSAGE_TOO_LONG');
  });

  it('should block the 6th message when 5 have been sent within 3 seconds', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await mod.checkMessage({
        userId: 'u1',
        message: 'Hi',
        isMuted: false,
        isAdmin: false,
      });
      expect(r.allowed).toBe(true);
    }
    const blocked = await mod.checkMessage({
      userId: 'u1',
      message: 'Hi',
      isMuted: false,
      isAdmin: false,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('RATE_LIMITED');
  });

  it('should allow a message after the rate limit window expires or clears', async () => {
    // Fill the rate limiter
    for (let i = 0; i < 5; i++) {
      await mod.checkMessage({ userId: 'u1', message: 'Spam', isMuted: false, isAdmin: false });
    }
    const blocked = await mod.checkMessage({ userId: 'u1', message: 'Spam', isMuted: false, isAdmin: false });
    expect(blocked.allowed).toBe(false);

    // Clear rate limit entry (simulating cooldown window expiry)
    clearRateLimitEntry('u1');

    const result = await mod.checkMessage({
      userId: 'u1',
      message: 'Back again!',
      isMuted: false,
      isAdmin: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('should block all messages from a muted user', async () => {
    const result = await mod.checkMessage({
      userId: 'u1',
      message: 'Hello!',
      isMuted: true,
      isAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('USER_MUTED');
  });

  it('should allow admin users to send messages that would fail the profanity filter', async () => {
    const result = await mod.checkMessage({
      userId: 'admin1',
      message: 'Reviewing report: damn content flagged',
      isMuted: false,
      isAdmin: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.sanitized).toBe('Reviewing report: damn content flagged');
  });

  it('should reject an empty string message', async () => {
    const result = await mod.checkMessage({
      userId: 'u1',
      message: '   ',
      isMuted: false,
      isAdmin: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('EMPTY_MESSAGE');
  });
});
