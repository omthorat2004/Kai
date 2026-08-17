'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const store = require('./store');
const { ProcessManager } = require('./process-manager');

const DEV_SERVER = process.env.KAI_DEV_SERVER || null;
const RENDERER_FILE = path.join(__dirname, '..', 'dist', 'index.html');

const pm = new ProcessManager();

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {Map<string, BrowserWindow>} */
const logWindows = new Map();

// ---------------------------------------------------------------- windows

function loadRenderer(win, hash = '') {
  if (DEV_SERVER) win.loadURL(DEV_SERVER + (hash ? '#' + hash : ''));
  else win.loadFile(RENDERER_FILE, hash ? { hash } : undefined);
}

function createMainWindow() {
  const bounds = store.getUi().windowBounds || { width: 1120, height: 720 };
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 780,
    minHeight: 480,
    title: 'Kai',
    backgroundColor: '#14161a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadRenderer(mainWindow);

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const { width, height } = mainWindow.getBounds();
    store.setUi({ windowBounds: { width, height } });
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
}

/** Detached log viewer, for parking on a second monitor. */
function openLogWindow(id) {
  const existing = logWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  const cfg = store.get(id);
  const win = new BrowserWindow({
    width: 860,
    height: 620,
    title: cfg ? `${cfg.name} logs` : 'Logs',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRenderer(win, `logs=${encodeURIComponent(id)}`);
  logWindows.set(id, win);
  win.on('closed', () => logWindows.delete(id));
  return true;
}

function allWindows() {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
}

function broadcast(channel, payload) {
  for (const w of allWindows()) w.webContents.send(channel, payload);
}

// --------------------------------------------------- process manager wiring

pm.on('lines', (batch) => broadcast('kai:lines', batch));
pm.on('status', (status) => broadcast('kai:status', status));
pm.on('cleared', (payload) => broadcast('kai:cleared', payload));

function startApp(id) {
  const cfg = store.get(id);
  if (!cfg) return { ok: false, error: 'No such app' };
  if (!cfg.cwd || !cfg.command) return { ok: false, error: 'App needs both a folder and a command' };
  pm.start(cfg);
  return { ok: true, status: pm.statusOf(id) };
}

// ------------------------------------------------------------------- IPC

ipcMain.handle('kai:apps:list', () => store.list());

ipcMain.handle('kai:apps:save', (_e, input) => {
  const record = store.save(input);
  broadcast('kai:apps', store.list());
  return record;
});

ipcMain.handle('kai:apps:remove', async (_e, id) => {
  if (pm.isRunning(id)) await pm.stop(id);
  pm.forget(id);
  store.remove(id);
  const win = logWindows.get(id);
  if (win && !win.isDestroyed()) win.close();
  broadcast('kai:apps', store.list());
  return true;
});

ipcMain.handle('kai:apps:reorder', (_e, ids) => {
  const next = store.reorder(ids);
  broadcast('kai:apps', next);
  return next;
});

ipcMain.handle('kai:pickDirectory', async (_e, current) => {
  const target = BrowserWindow.getFocusedWindow() || mainWindow;
  const opts = { properties: ['openDirectory', 'createDirectory'], title: 'Choose project folder' };
  if (current) opts.defaultPath = current;
  const res = target
    ? await dialog.showOpenDialog(target, opts)
    : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('kai:start', (_e, id) => startApp(id));

ipcMain.handle('kai:stop', async (_e, id) => {
  await pm.stop(id);
  return { ok: true, status: pm.statusOf(id) };
});

ipcMain.handle('kai:startAll', () => {
  const results = store.list().map((a) => ({ id: a.id, ...startApp(a.id) }));
  return results;
});

ipcMain.handle('kai:stopAll', async () => {
  await pm.stopAll();
  return { ok: true };
});

ipcMain.handle('kai:statuses', () => {
  // Include apps that have never run so the UI can render "stopped".
  const known = new Map(pm.statuses().map((s) => [s.id, s]));
  return store.list().map(
    (a) => known.get(a.id) || { id: a.id, status: 'stopped', exitCode: null, signal: null, pid: null }
  );
});

ipcMain.handle('kai:logs:get', (_e, id) => pm.getLog(id));
ipcMain.handle('kai:logs:clear', (_e, id) => { pm.clearLog(id); return true; });
ipcMain.handle('kai:clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
ipcMain.handle('kai:openLogWindow', (_e, id) => openLogWindow(id));
ipcMain.handle('kai:revealFolder', (_e, dir) => { if (dir) shell.openPath(dir); return true; });
ipcMain.handle('kai:ui:get', () => store.getUi());
ipcMain.handle('kai:ui:set', (_e, patch) => { store.setUi(patch); return true; });
ipcMain.handle('kai:meta', () => ({
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
  configPath: store.path,
  appVersion: app.getVersion(),
}));

// --------------------------------------------------------------- lifecycle

// Single instance: a second launch focuses the existing window instead of
// spawning a second copy of every dev server.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();

    for (const a of store.list()) {
      if (a.autostart) startApp(a.id);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Nothing may outlive the app: kill every child before we go.
let teardownStarted = false;
app.on('before-quit', (event) => {
  if (teardownStarted || pm.runningIds().length === 0) return;
  teardownStarted = true;
  event.preventDefault();

  const forceExit = setTimeout(() => {
    pm.killAllNow();
    app.exit(0);
  }, 6000);

  pm.stopAll().then(() => {
    clearTimeout(forceExit);
    pm.killAllNow(); // belt and braces for anything that ignored SIGTERM
    app.exit(0);
  });
});

// Last resort if the process is torn down without before quit completing.
process.on('exit', () => pm.killAllNow());
