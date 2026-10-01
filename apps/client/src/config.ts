/**
 * HavenWorld Client Configuration
 * Resolves API and WebSocket URLs across development, test, and production environments.
 */

export let SERVER_URL: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.PROD
    ? 'https://147-224-184-148.nip.io'
    : 'http://localhost:3000');

export let API_URL: string = `${SERVER_URL}/api`;

export function setServerUrl(url: string): void {
  SERVER_URL = url.replace(/\/$/, '');
  API_URL = `${SERVER_URL}/api`;
}

/**
 * Optional CDN origin for 3D assets (Cloudflare R2 in production — Part 9A §3).
 * Empty in local development, where assets are served from the app's own /assets path.
 */
export let ASSET_BASE_URL: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ASSET_BASE_URL) || '';

export function setAssetBaseUrl(url: string): void {
  ASSET_BASE_URL = url.replace(/\/$/, '');
}

/**
 * Prefixes a root-relative asset path with the CDN origin when one is configured.
 * Absolute URLs and data URIs are returned untouched, so callers can pass either.
 */
export function assetUrl(path: string): string {
  if (!path) return path;
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  if (!ASSET_BASE_URL) return path;
  return `${ASSET_BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
