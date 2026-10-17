/**
 * main.js — Electron main process
 */

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');

const { startServer, PORT }                                      = require('./server');
const { createTray, destroyTray }                                = require('./tray');
const { readConfig, bootstrapDirectories, APP_DIR }              = require('./config');
const { migrateAgentFiles, syncGlobalAgentsToClaudeDir }         = require('./agents');
const agentsSync                                                  = require('./agents-sync');
const { bootstrapDefaultMcpServers }                              = require('./mcp');

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || null;

// ── Auto-updater ──────────────────────────────────────────────────────────────

let autoUpdater = null;

function setupAutoUpdater() {
  if (isDev) return;
  try {
    ({ autoUpdater } = require('electron-updater'));

    // Token de solo lectura para el repo privado
    autoUpdater.token = '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';
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('download-progress', (p) => {
      mainWindow?.webContents.send('update-progress', Math.round(p.percent));
    });

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update-ready');
    });

    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('update-error', err.message);
    });

    // Comprobar al arrancar, con retraso para no bloquear la carga
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  } catch (e) {
    console.warn('[updater] electron-updater no disponible:', e.message);
  }
}

ipcMain.handle('update:check',    () => autoUpdater?.checkForUpdates().catch(e => ({ error: e.message })));
ipcMain.handle('update:download', () => autoUpdater?.downloadUpdate().catch(e => ({ error: e.message })));
ipcMain.handle('update:install',  () => { autoUpdater?.quitAndInstall(false, true); });

let mainWindow = null;
let server     = null;

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    title:           'Agent Hub',
    icon:            isDev
                       ? path.join(__dirname, '../../assets/icon.ico')
                       : path.join(process.resourcesPath, 'assets/icon.ico'),
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

  const url = (isDev && DEV_SERVER_URL) ? DEV_SERVER_URL : `http://localhost:${PORT}`;
  console.log(`[main] Loading URL: ${url}`);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // En dev, recarga el renderer cuando Vite recompila el bundle
  if (isDev && !DEV_SERVER_URL) {
    const fs = require('fs');
    const rendererDir = path.join(__dirname, '../../dist/renderer');
    let reloadTimer = null;
    fs.watch(rendererDir, { recursive: false }, (event, filename) => {
      if (filename !== 'index.html') return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        mainWindow?.webContents.reload();
      }, 300);
    });
  }

  mainWindow.on('close', (e) => {
    if (app.isQuiting) return;
    e.preventDefault();
    handleClose();
  });

  function handleClose() {
    const { readConfig, writeConfig } = require('./config');
    const cfg = readConfig();
    const action = cfg.closeAction || 'ask';

    if (action === 'tray') { mainWindow.hide(); return; }
    if (action === 'quit') { app.isQuiting = true; app.quit(); return; }

    // action === 'ask' — show custom in-app dialog via IPC
    mainWindow.webContents.send('app:close-requested');
    ipcMain.once('app:close-response', (_, { action: chosen, remember }) => {
      if (remember) {
        cfg.closeAction = chosen;
        writeConfig(cfg);
      }
      if (chosen === 'tray') {
        mainWindow.hide();
      } else {
        app.isQuiting = true;
        app.quit();
      }
    });
  }

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

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:pickFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('shell:openVSCode', async (_, projectPath) => {
  const fail = { ok: false, error: 'VS Code no encontrado en PATH. Abre VS Code → Command Palette → "Shell Command: Install code command in PATH".' };
  return new Promise((resolve) => {
    require('cross-spawn')('code', [projectPath], { stdio: 'ignore', windowsHide: true })
      .on('error', () => resolve(fail))
      .on('close', (code) => resolve(code === 0 ? { ok: true } : fail));
  });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log(`[main] Starting Agent Hub v${app.getVersion()}`);
  console.log(`[main] App dir: ${APP_DIR}`);
  console.log(`[main] Dev mode: ${isDev}`);

  // Bootstrap directories
  const cfg = readConfig();
  bootstrapDirectories(cfg);
  bootstrapDefaultMcpServers();

  // Migrate existing agent files to current serialization format
  const migrated = migrateAgentFiles();
  console.log(`[main] Agents: ${migrated} migrated`);

  // Start Express server (must be up before createWindow)
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
  setupAutoUpdater();

  // Sync agents from directory (async — renderer polls for progress)
  const syncEnabled  = cfg.agentsDirectoryEnabled !== false;
  const directoryUrl = cfg.agentsDirectoryUrl || 'https://github.com/adanoliva/agents-directory';
  const isFirstSync  = !agentsSync.metaExists();

  if (syncEnabled) {
    console.log(`[main] Starting agents sync (firstSync=${isFirstSync})`);
    agentsSync.triggerSync(directoryUrl, isFirstSync).catch((e) => {
      console.warn('[main] Agents sync error:', e.message);
    });
  } else {
    // Directory disabled: just mirror globals to ~/.claude/agents/
    syncGlobalAgentsToClaudeDir();
  }

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
