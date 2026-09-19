import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/src/**/__tests__/**/*.test.ts',
  ],
  testTimeout: 20000,
  forceExit: true,
  detectOpenHandles: true,
  globalSetup: '<rootDir>/tests/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/tests/jest.globalTeardown.ts',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
    '!src/scripts/**',
    '!src/types/**',
    '!src/generated/**',
  ],
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 25,
      lines: 45,
      statements: 45,
    },
    './src/services/InventoryService.ts': {
      lines: 80,
      statements: 80,
    },
    './src/services/ModerationService.ts': {
      lines: 80,
      statements: 80,
    },
    './src/services/RoomManager.ts': {
      lines: 85,
      statements: 85,
    },
    './src/services/FishingService.ts': {
      lines: 85,
      statements: 85,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  setupFiles: ['<rootDir>/tests/loadEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.ts'],
  moduleNameMapper: {
    '^@server/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/__tests__/$1',
    '^@havenworld/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^badwords-list$': '<rootDir>/tests/badwordsListCjs.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
      preset: 'ts-jest',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/loadEnv.ts'],
      moduleNameMapper: {
        '^@server/(.*)$': '<rootDir>/src/$1',
        '^@tests/(.*)$': '<rootDir>/__tests__/$1',
        '^@havenworld/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^badwords-list$': '<rootDir>/tests/badwordsListCjs.js',
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.test.json',
          },
        ],
      },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      preset: 'ts-jest',
      testEnvironment: 'node',
      setupFiles: ['<rootDir>/tests/loadEnv.ts'],
      setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.ts'],
      moduleNameMapper: {
        '^@server/(.*)$': '<rootDir>/src/$1',
        '^@tests/(.*)$': '<rootDir>/__tests__/$1',
        '^@havenworld/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^badwords-list$': '<rootDir>/tests/badwordsListCjs.js',
        '^(\\.{1,2}/.*)\\.js$': '$1',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.test.json',
          },
        ],
      },
    },
  ],
};

export default config;
