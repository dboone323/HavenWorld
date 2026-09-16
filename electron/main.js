import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `file://${join(__dirname, '../dist/index.html')}`;

// IPC handlers for preload bridge
ipcMain.handle('haven:open-external', (_event, url) => {
  shell.openExternal(url);
});
ipcMain.handle('haven:app-version', () => app.getVersion());
ipcMain.handle('haven:is-dev', () => isDev);
ipcMain.handle('haven:server-url', () => {
  // In production, the server URL is embedded; in dev, point to localhost
  return isDev ? 'ws://localhost:3000' : 'wss://havenworld.com/ws';
});

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

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
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

app.whenReady().then(async () => {
  if (!isDev) {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.checkForUpdatesAndNotify();
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
