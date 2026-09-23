import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import path from 'path';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: [
        'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
        '__tests__/scene/**/*.{test,spec}.{ts,tsx}',
      ],
      setupFiles: ['./src/__tests__/setup.ts'],
      env: {
        VITE_API_URL: 'http://localhost:4000',
        VITE_SOCKET_URL: 'http://localhost:4000',
        VITE_ENV: 'test',
        TEST_INVITE_CODE: 'HAVEN-TEST-2026',
        TEST_API_URL: 'http://localhost:4000',
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage/client',
        include: [
          'src/services/**',
          'src/audio/**',
          'src/ui/ChatOverlay.ts',
          'src/utils/**',
          'src/gallery/**',
          'src/clubs/**',
          'src/world/AvatarController.ts',
          'src/world/FurnitureManager.ts',
          'src/world/RoomLoader.ts',
        ],
        exclude: [
          'src/**/__tests__/**',
          'src/**/*.d.ts',
          'src/main.ts',
        ],
        thresholds: {
          lines: 60,
          functions: 60,
          branches: 55,
          statements: 60,
        },
      },
    },
  })
);
