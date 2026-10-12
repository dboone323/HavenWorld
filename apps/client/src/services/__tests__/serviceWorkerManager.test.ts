import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceWorkerManager } from '../serviceWorkerManager';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../../public');

describe('ServiceWorkerManager & Offline PWA Assets (Batch 29)', () => {
  let initialOnline: boolean;

  beforeEach(() => {
    initialOnline = navigator.onLine;
  });

  afterEach(async () => {
    await ServiceWorkerManager.unregister();
  });

  it('detects online connectivity status and notifies subscribers on connection events', () => {
    expect(typeof ServiceWorkerManager.isOnline()).toBe('boolean');

    const statusHistory: boolean[] = [];
    const unsubscribe = ServiceWorkerManager.onConnectionChange((isOnline) => {
      statusHistory.push(isOnline);
    });

    // Simulate network offline transition
    window.dispatchEvent(new Event('offline'));
    expect(statusHistory).toContain(false);
    expect(ServiceWorkerManager.isOnline()).toBe(false);

    // Simulate network online transition
    window.dispatchEvent(new Event('online'));
    expect(statusHistory).toContain(true);
    expect(ServiceWorkerManager.isOnline()).toBe(true);

    // Unsubscribe removes listener
    unsubscribe();
    window.dispatchEvent(new Event('offline'));
    expect(statusHistory.length).toBe(2);
  });

  it('handles postMessage invalidation commands safely', async () => {
    await expect(ServiceWorkerManager.skipWaiting()).resolves.toBeUndefined();
    await expect(ServiceWorkerManager.clearOutdatedCaches()).resolves.toBeUndefined();
    await expect(ServiceWorkerManager.invalidateAssetCache()).resolves.toBeUndefined();
    await expect(ServiceWorkerManager.checkForUpdates()).resolves.toBe(false);
  });

  it('validates public/sw.js contains offline shell caching, fallback assets, and invalidation triggers', () => {
    const swPath = path.join(publicDir, 'sw.js');
    expect(existsSync(swPath)).toBe(true);

    const swSource = readFileSync(swPath, 'utf8');

    // Asserts caching versioning and cache keys
    expect(swSource).toMatch(/const CACHE_VERSION = 'havenworld-v\d+';/);
    expect(swSource).toContain('SHELL_CACHE');
    expect(swSource).toContain('ASSET_CACHE');

    // Asserts offline.html in shell assets
    expect(swSource).toContain("'/offline.html'");
    expect(swSource).toContain("'/manifest.webmanifest'");

    // Asserts message handling for invalidation
    expect(swSource).toContain('SKIP_WAITING');
    expect(swSource).toContain('CLEAR_OUTDATED_CACHES');
    expect(swSource).toContain('INVALIDATE_ASSETS');
  });

  it('validates dedicated public/offline.html fallback page exists and contains reload control', () => {
    const offlineHtmlPath = path.join(publicDir, 'offline.html');
    expect(existsSync(offlineHtmlPath)).toBe(true);

    const htmlContent = readFileSync(offlineHtmlPath, 'utf8');
    expect(htmlContent).toContain('HavenWorld — Offline');
    expect(htmlContent).toContain('Connection Lost');
    expect(htmlContent).toContain('Retry Connection');
    expect(htmlContent).toContain('window.location.reload()');
  });
});
