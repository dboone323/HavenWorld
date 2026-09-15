/**
 * HavenWorld — Vite config (dev server + production build).
 *
 * Architecture:
 *   Dev:    Vite dev server (port 5173) serves client assets with HMR.
 *           Proxies /api and /shared to the Express server (port 3000).
 *           Client connects to ws://localhost:3000 for game WebSocket.
 *   Prod:   vite build → dist/ (static client assets).
 *           Express serves dist/ + /shared/, handles WebSocket on port 3000.
 *           Capacitor iOS reads from dist/ (see capacitor.config.json).
 *           Electron reads from dist/ (see electron/main.js).
 */
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const serverPort = Number(process.env.PORT || 3000);

export default defineConfig({
  root: 'src/client',
  publicDir: '../public',            // static assets (favicon, etc.)
  base: '/',                         // needed for Capacitor (index.html at /)
  server: {
    port: 5173,
    strictPort: true,
    fsAllow: [
      // Allow importing from src/shared in the browser bundle
      '../../src/shared',
      '../../src/client',
    ],
    proxy: {
      // Proxy API and shared static files to the Express dev server
      '^/shared': {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/client/index.html'),
      },
    },
    // Optimize for canvas rendering performance
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
  },
});
