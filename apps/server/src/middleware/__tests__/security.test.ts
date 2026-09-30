import { verifyStartupSecurityAssertions, isAllowedOrigin } from '../security';

/**
 * Regression cover for the startup guards in middleware/security.ts.
 *
 * The NODE_ENV=test case exists because Playwright's webServer used to boot with
 * NODE_ENV=test while dotenv resolved apps/server/.env — the production Supabase
 * pooler. The suite then created accounts against production, and register appeared
 * to hang while its interactive $transaction stalled on the pooler.
 */
describe('verifyStartupSecurityAssertions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts NODE_ENV=test pointed at a *_test database', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://user:pw@127.0.0.1:5432/havenworld_test';
    process.env.JWT_SECRET = 'test_secret_long_enough_for_tests';

    expect(() => verifyStartupSecurityAssertions()).not.toThrow();
  });

  it('refuses to start in test mode against a non-test database', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://user:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres';
    process.env.JWT_SECRET = 'test_secret_long_enough_for_tests';

    expect(() => verifyStartupSecurityAssertions()).toThrow(/not a \*_test database/i);
  });

  it('refuses to start without any JWT secret', () => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ACCESS_SECRET;

    expect(() => verifyStartupSecurityAssertions()).toThrow(/JWT_SECRET/);
  });

  it('refuses to start without DATABASE_URL', () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_SECRET = 'test_secret_long_enough_for_tests';

    expect(() => verifyStartupSecurityAssertions()).toThrow(/DATABASE_URL/);
  });

  it('still refuses a short JWT secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pw@127.0.0.1:5432/havenworld';
    process.env.REDIS_URL = 'redis://localhost:6379/0';
    process.env.JWT_SECRET = 'too_short';

    expect(() => verifyStartupSecurityAssertions()).toThrow(/64 hex/);
  });
});

describe('isAllowedOrigin', () => {
  it('allows canonical Cloudflare Pages production origins', () => {
    expect(isAllowedOrigin('https://havenworld-game.pages.dev')).toBe(true);
    expect(isAllowedOrigin('https://havenworld.pages.dev')).toBe(true);
  });

  it('allows Cloudflare Pages deployment preview subdomains', () => {
    expect(isAllowedOrigin('https://216c2a4a.havenworld-game.pages.dev')).toBe(true);
    expect(isAllowedOrigin('https://eadab224.havenworld-game.pages.dev')).toBe(true);
    expect(isAllowedOrigin('https://pr-12.havenworld.pages.dev')).toBe(true);
  });

  it('allows requests without an origin header', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('rejects untrusted origins and lookalike domains', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('http://216c2a4a.havenworld-game.pages.dev')).toBe(false);
    expect(isAllowedOrigin('https://havenworld-game.pages.dev.evil.com')).toBe(false);
    expect(isAllowedOrigin('https://sub.sub.havenworld-game.pages.dev')).toBe(false);
  });
});

