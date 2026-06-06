/**
 * server-standalone.js — arranca Express sin Electron (modo web dev)
 * Uso: node src/backend/server-standalone.js
 */

// Shim de electron para que config.js y demás módulos no fallen
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, ...args) {
  if (request === 'electron') {
    return {
      app: {
        isPackaged: false,
        getVersion: () => '2.3.0',
        quit: () => process.exit(0),
      },
      BrowserWindow: class {},
      ipcMain: { on: () => {}, handle: () => {}, once: () => {} },
      shell: { openPath: () => {}, openExternal: () => {} },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      Tray: class { setToolTip(){} setContextMenu(){} on(){} },
      Menu: { buildFromTemplate: () => ({}) },
      nativeImage: { createFromPath: () => ({}) },
      contextBridge: { exposeInMainWorld: () => {} },
      ipcRenderer: { on: () => {}, send: () => {} },
    };
  }
  return originalLoad.call(this, request, ...args);
};

const { startServer } = require('./server');
const { readConfig, bootstrapDirectories } = require('./config');

const cfg = readConfig();
bootstrapDirectories(cfg);
startServer();

console.log('[standalone] Backend Express corriendo en http://localhost:3737');
