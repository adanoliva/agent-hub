/**
 * main.js — Electron main process
 */

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

const { startServer, PORT }                                      = require('./server');
const { createTray, destroyTray }                                = require('./tray');
const { readConfig, bootstrapDirectories, APP_DIR }              = require('./config');
const { migrateAgentFiles, seedDefaultAgents, syncGlobalAgentsToClaudeDir } = require('./agents');

const isDev = !app.isPackaged;

let mainWindow = null;
let server     = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    title:           'Claude Dev Manager',
    backgroundColor: '#0d0d0f',
    show:            false,
    frame:           true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration:     false,
      contextIsolation:    true,
      preload:             path.join(__dirname, 'preload.js'),
      devTools:            isDev,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('app:version',        () => app.getVersion());
ipcMain.handle('app:appDir',         () => APP_DIR);
ipcMain.handle('app:isDev',          () => isDev);
ipcMain.handle('window:minimize',    () => mainWindow?.minimize());
ipcMain.handle('window:hide',        () => mainWindow?.hide());
ipcMain.handle('shell:openPath',     (_, p)   => shell.openPath(p));
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

ipcMain.handle('shell:openVSCode', async (_, projectPath) => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(`code "${projectPath}"`, (err) => {
      if (err) resolve({ ok: false, error: 'VS Code no encontrado en PATH. Abre VS Code → Command Palette → "Shell Command: Install code command in PATH".' });
      else     resolve({ ok: true });
    });
  });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log(`[main] Starting Claude Dev Manager v${app.getVersion()}`);
  console.log(`[main] App dir: ${APP_DIR}`);
  console.log(`[main] Dev mode: ${isDev}`);

  // Bootstrap directories
  const cfg = readConfig();
  bootstrapDirectories(cfg);

  // Migrate existing agent files to current format, reseed defaults,
  // and mirror global agents to ~/.claude/agents/
  const migrated = migrateAgentFiles();
  const seeded   = seedDefaultAgents();
  const synced   = syncGlobalAgentsToClaudeDir();
  console.log(`[main] Agents: ${migrated} migrated, ${seeded} reseeded, ${synced} synced to ~/.claude/agents/`);

  // Start Express server
  try {
    server = await startServer();
    console.log('[main] Server started');
  } catch (err) {
    console.error('[main] Failed to start server:', err);
    app.quit();
    return;
  }

  createWindow();
  createTray(mainWindow);
  console.log('[main] Ready');
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  destroyTray();
  if (server) server.close();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}