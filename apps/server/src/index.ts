import { SOCKET_EVENTS } from '@havenworld/shared';

export const SERVER_CONFIG = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  version: '0.1.0'
};

console.log(`[HavenWorld Server] Initializing Phase 0 Server (port: ${SERVER_CONFIG.port}, env: ${SERVER_CONFIG.nodeEnv})...`);
console.log(`[HavenWorld Server] Shared events registered: ${Object.keys(SOCKET_EVENTS).length}`);
