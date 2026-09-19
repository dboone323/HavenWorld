module.exports = {
  apps: [
    {
      name: 'havenworld-server',
      script: 'dist/index.js',
      cwd: '/opt/havenworld/apps/server',
      /**
       * Zero-downtime deploys (Part 9A §4.2).
       *
       * `PM2_INSTANCES` defaults to 1 because the Socket.io Rust/Redis *adapter*
       * is not wired yet: with more than one worker, players in the same room can
       * land on different workers and stop seeing each other's movement/chat.
       * Set PM2_INSTANCES=2 (and add the Redis adapter + the nginx ip_hash
       * upstream) on a VM with spare vCPUs — `pm2 reload` then rolls workers one
       * at a time and no connection is dropped.
       */
      instances: process.env.PM2_INSTANCES || 1,
      exec_mode: 'cluster',
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
