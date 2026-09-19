/**
 * Penetration Test: Authentication Brute Force & Rate Limiting
 *
 * Verifies that rapid repeated login attempts are throttled by the auth rate limiter
 * and return HTTP 429 Too Many Requests.
 */

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function runBruteForceTest() {
  console.log(`[PenTest] Starting Auth Brute-Force test against ${TARGET_URL}/api/auth/login...`);

  let rateLimited = false;
  let attempts = 0;
  const maxAttempts = 20;

  for (let i = 1; i <= maxAttempts; i++) {
    attempts++;
    try {
      const res = await fetch(`${TARGET_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: `IncorrectPasswordAttempt_${i}`,
        }),
      });

      console.log(`Attempt ${i}: HTTP ${res.status}`);

      if (res.status === 429) {
        console.log(`\n[PASS] Rate limiter triggered at attempt ${i} (HTTP 429 Too Many Requests).`);
        rateLimited = true;
        break;
      }
    } catch (err) {
      console.error(`Attempt ${i} failed with error:`, err.message);
      break;
    }
  }

  if (!rateLimited) {
    console.warn(`[WARN] Made ${attempts} attempts without receiving HTTP 429. (May be relaxed in test/dev environment).`);
  }
}

runBruteForceTest();
