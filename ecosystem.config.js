module.exports = {
  apps: [
    {
      name: 'havenworld-server',
      script: 'apps/server/dist/index.js',
      cwd: '/opt/havenworld',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
