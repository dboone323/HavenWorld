module.exports = {
  apps: [
    {
      name: 'havenworld-server',
      script: 'dist/index.js',
      cwd: '/opt/havenworld/apps/server',
      /**
       * Zero-downtime deploys & Multi-Worker Scaling (Part 9A §4.2).
       *
       * With @socket.io/redis-adapter active and Redis running (e.g., via Docker or systemd),
       * cross-worker room broadcasts, player movement, and chat seamlessly replicate across nodes.
       *
       * Multi-worker clustering configuration:
       * - Set `instances: process.env.PM2_INSTANCES ? parseInt(process.env.PM2_INSTANCES, 10) : 1` (or 'max' / 2+)
       * - Set `exec_mode: process.env.PM2_INSTANCES && parseInt(process.env.PM2_INSTANCES, 10) > 1 ? 'cluster' : 'fork'`
       * - Nginx upstream must use `ip_hash;` or sticky sessions (`cookie srv_id;`) for HTTP long-polling handshake fallback.
       * - `pm2 reload havenworld-server` performs rolling zero-downtime reloads without dropping player connections.
       */
      instances: process.env.PM2_INSTANCES ? parseInt(process.env.PM2_INSTANCES, 10) : 1,
      exec_mode: process.env.PM2_INSTANCES && parseInt(process.env.PM2_INSTANCES, 10) > 1 ? 'cluster' : 'fork',
      instance_var: 'INSTANCE_ID',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      // Give in-flight socket frames and HTTP requests time to drain on reload.
      kill_timeout: 10000,
      listen_timeout: 10000,
      env_file: '/opt/havenworld/apps/server/.env',
      error_file: '/opt/havenworld/logs/err.log',
      out_file: '/opt/havenworld/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
