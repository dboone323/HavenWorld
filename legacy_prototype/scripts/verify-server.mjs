/**
 * HavenWorld — Server health verification (Linux host).
 *
 * Checks, in order:
 *   1. HTTP 200 from the local app on port 3000
 *   2. WebSocket handshake + INIT_STATE over ws://127.0.0.1:3000
 *   3. (optional) HTTP + wss:// INIT_STATE through the public tunnel URL
 *
 * Usage:
 *   node scripts/verify-server.mjs
 *   node scripts/verify-server.mjs https://<name>.trycloudflare.com
 *
 * Exit code 0 = all checks passed.
 */
import { WebSocket } from 'ws';

const HTTP_URL = process.env.VERIFY_HTTP_URL || 'http://127.0.0.1:3000';
const LOCAL_WS = process.env.VERIFY_WS_URL || 'ws://127.0.0.1:3000';
const tunnelArg = process.argv[2] || process.env.VERIFY_TUNNEL_URL || null;

let failures = 0;
const pass = (m) => console.log(`  \u2714 ${m}`);
const fail = (m) => {
  console.log(`  \u2716 ${m}`);
  failures++;
};

// 1. HTTP
try {
  const res = await fetch(HTTP_URL, { signal: AbortSignal.timeout(10000) });
  res.ok ? pass(`HTTP ${res.status} from ${HTTP_URL}`) : fail(`HTTP ${res.status} from ${HTTP_URL}`);
  const html = await res.text();
  html.includes('HavenWorld') ? pass('served page contains "HavenWorld"') : fail('served page missing "HavenWorld"');
} catch (err) {
  fail(`HTTP request to ${HTTP_URL} failed: ${err.message}`);
}

// 2/3. WebSocket (local, then optional tunnel)
const wsTargets = [['ws (local)', LOCAL_WS]];
if (tunnelArg) {
  wsTargets.push(['wss (tunnel)', tunnelArg.replace(/^http/, 'ws')]);
}

for (const [label, url] of wsTargets) {
  await new Promise((resolve) => {
    let settled = false; // only the first event (pass or fail) counts
    const ws = new WebSocket(url);
    const done = (result, msg) => {
      if (settled) return; // ignore late close/error after success
      settled = true;
      clearTimeout(timer);
      (result === 'pass' ? pass : fail)(`${label}: ${msg}`);
      try { ws.terminate(); } catch { /* ignore */ }
      resolve();
    };
    const timer = setTimeout(() => done('fail', 'timed out waiting for INIT_STATE'), 30000);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'INIT_STATE') {
        const p = msg.payload;
        done('pass', `INIT_STATE (selfId=${p.selfId}, room=${p.room?.id}, loft=${p.playerLoftRoomId})`);
      }
    });
    ws.on('error', (err) => done('fail', err.message));
    ws.on('close', () => done('fail', 'closed before INIT_STATE'));
  });
}

console.log(failures === 0 ? '\nVerification: PASS' : `\nVerification: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);