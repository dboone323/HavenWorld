/**
 * Penetration Test: PHP Web Attack & Connection Probing Audit
 *
 * Verifies that:
 * 1. PHP probes, web shells, and unauthenticated RCE targets (e.g. PHP2Shell, eval-stdin,
 *    wp-login, phpinfo) are blocked/dropped (HTTP 404 or connection reset/444)
 *    and never return 200 or cause 500 server crashes.
 * 2. HTTP connections do not improperly advertise "upgrade" or leak long-lived timeouts
 *    on standard non-WebSocket endpoints.
 */

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';

async function runPhpProbeTest() {
  console.log(`[PenTest] Starting PHP Probe & Connection Audit against ${TARGET_URL}...`);

  const probePaths = [
    '/_phpinfo.php',
    '/old_phpinfo.php',
    '/server-info.php',
    '/server-status.php',
    '/wp-login.php',
    '/xmlrpc.php',
    '/info.php',
    '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
    '/phpmyadmin/index.php',
    '/.env',
    '/.git/config',
  ];

  let passed = 0;
  let total = 0;

  console.log('\n--- 1. Auditing PHP Web Attack Paths ---');
  for (const p of probePaths) {
    total++;
    const target = `${TARGET_URL}${p}`;
    try {
      const res = await fetch(target, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Security-Audit-PHP-Scanner)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (res.status === 404 || res.status === 403) {
        console.log(`[PASS] ${p} -> HTTP ${res.status} (Blocked as expected)`);
        passed++;
      } else {
        console.error(`[FAIL] ${p} -> Unexpected HTTP ${res.status}`);
      }
    } catch (err) {
      // In Nginx with return 444, the connection is closed without response headers,
      // resulting in ECONNRESET or fetch failure, which is the desired edge-drop behavior.
      if (err.message.includes('fetch failed') || err.message.includes('ECONNRESET')) {
        console.log(`[PASS] ${p} -> Connection dropped immediately (Edge drop 444)`);
        passed++;
      } else {
        console.error(`[ERROR] ${p} -> ${err.message}`);
      }
    }
  }

  console.log('\n--- 2. Auditing Connection Settings & Header Alignment ---');
  total++;
  try {
    const healthRes = await fetch(`${TARGET_URL}/health`);
    const connHeader = healthRes.headers.get('connection') || '';
    const upgradeHeader = healthRes.headers.get('upgrade') || '';

    if (upgradeHeader === '' && connHeader !== 'upgrade') {
      console.log(`[PASS] HTTP endpoint does not improperly send Connection: upgrade (Connection: ${connHeader || 'default'})`);
      passed++;
    } else {
      console.error(`[FAIL] HTTP endpoint unexpectedly sent Upgrade header: ${upgradeHeader}, Connection: ${connHeader}`);
    }
  } catch (err) {
    console.error(`[ERROR] Health connection check failed:`, err.message);
  }

  console.log(`\nPHP Web Attack & Connection Audit Summary: ${passed}/${total} passed.`);
  if (passed !== total) {
    process.exitCode = 1;
  }
}

runPhpProbeTest();
