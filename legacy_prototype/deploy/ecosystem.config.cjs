/**
 * HavenWorld — PM2 process definitions (Linux server runtime).
 *
 * Notes for the Oracle Cloud ARM64 host:
 *   - Node 24 executes TypeScript directly via native type stripping, so no
 *     `--loader tsx` / `tsx` dependency is required (and tsx is NOT installed).
 *   - `cwd` must be the repo root: src/server/db.ts loads `.env` relative to
 *     process.cwd() via `import 'dotenv/config'`, and log paths are relative.
 *   - The Cloudflare quick tunnel is supervised here too, so `pm2 startup` +
 *     `pm2 save` keeps both the game server and the public edge alive 24/7.
 */
const path = require('node:path');
try {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
} catch {}

const APP_DIR = '/home/ubuntu/Developer/HavenWorld';
const PORT = 3000;
const tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN;
const tunnelArgs = tunnelToken
  ? `tunnel run --token ${tunnelToken}`
  : `tunnel --url http://localhost:${PORT} --protocol http2 --logfile /home/ubuntu/havenworld-tunnel.log`;

module.exports = {
  apps: [
    {
      name: 'havenworld',
      cwd: APP_DIR,
      // Invoke the Node binary directly with interpreter 'none' so PM2 does NOT
      // wrap the script in its own Node container. The container hijacks
      // process.argv[1], which makes the `isMain` guard in server.ts false, so
      // server.listen() is never called and the process exits immediately.
      // This yields exactly: `/home/ubuntu/.hermes/node/bin/node src/server/server.ts`
      script: '/home/ubuntu/.hermes/node/bin/node', // Node v24 (native TS support)
      args: 'src/server/server.ts',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT,
      },
      exp_backoff_restart_delay: 100,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
    },
    {
      // Public edge: Cloudflare tunnel -> localhost:3000.
      // Uses CLOUDFLARE_TUNNEL_TOKEN if present in .env, otherwise quick tunnel.
      name: 'havenworld-tunnel',
      cwd: APP_DIR,
      script: '/usr/bin/cloudflared',
      args: tunnelArgs,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/tunnel-error.log',
      out_file: 'logs/tunnel-out.log',
      merge_logs: true,
    },
  ],
};
