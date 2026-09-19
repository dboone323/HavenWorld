module.exports = {
  apps: [
    {
      name: 'havenworld-server',
      script: 'dist/index.js',
      cwd: '/opt/havenworld/apps/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
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
