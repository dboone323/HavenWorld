'use strict';

/**
 * HavenWorld — Electron main process (macOS, arm64 native).
 *
 * Production: loads the Vite-built static files from dist/.
 * Development: loads from the Vite dev server (http://localhost:5173).
 *
 * Architecture:
 *   - main.js:  BrowserWindow lifecycle, menu, tray, auto-update
 *   - preload:  secure context bridge (window.haven API)
 *   - renderer: src/client/ (Vite-built, served from dist/ or dev server)
 *
 * See: electron-builder config in package.json
 *      (mac category: "public.app-category.games", target: dmg + zip)
 */

const { app, BrowserWindow, Menu, shell } = require('electron');
const { join } = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `file://${join(__dirname, '../dist/index.html')}`;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: isDev
        ? join(__dirname, 'preload.js')
        : join(__dirname, '../dist/preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
  });

  win.loadURL(isDev ? DEV_URL : PROD_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(isDev ? DEV_URL : PROD_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (!isDev) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// macOS app menu
const template = [
  {
    label: app.name,
    submenu: [
      { label: 'About HavenWorld', role: 'about' },
      { type: 'separator' },
      { label: 'Preferences…', role: 'preferences' },
      { type: 'separator' },
      { label: 'Services', role: 'services', submenu: [] },
      { type: 'separator' },
      { label: 'Hide', role: 'hide' },
      { label: 'Hide Others', role: 'hideOthers' },
      { label: 'Show All', role: 'unhide' },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { label: 'Undo', role: 'undo' },
      { label: 'Redo', role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { label: 'Select All', role: 'selectAll' },
    ],
  },
];

Menu.setApplicationMenu(Menu.buildFromTemplate(template));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
