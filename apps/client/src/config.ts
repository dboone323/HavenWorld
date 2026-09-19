/**
 * HavenWorld Client Configuration
 * Resolves API and WebSocket URLs across development, test, and production environments.
 */

export const SERVER_URL: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.PROD
    ? 'https://147-224-164-228.nip.io'
    : 'http://localhost:3000');

export const API_URL: string = `${SERVER_URL}/api`;
