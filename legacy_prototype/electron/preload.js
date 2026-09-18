/**
 * HavenWorld — Electron preload script (context bridge).
 *
 * Exposes a minimal, secure API to the renderer. All sensitive
 * operations (API keys, file system) remain in the main process.
 *
 * window.haven:
 *   - openExternal(url)   — open URLs in system browser
 *   - getAppVersion()     — app version string
 *   - isDev()             — true in development
 *   - serverUrl()         — WebSocket URL for game server
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('haven', {
  openExternal: (url) => ipcRenderer.invoke('haven:open-external', url),
  getAppVersion: () => ipcRenderer.invoke('haven:app-version'),
  isDev: () => ipcRenderer.invoke('haven:is-dev'),
  serverUrl: () => ipcRenderer.invoke('haven:server-url'),
});
