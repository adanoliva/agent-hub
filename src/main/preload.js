/**
 * preload.js — Secure context bridge
 *
 * Exposes a safe API to the renderer via window.api.
 * No direct Node.js access from renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // App info
  getVersion:  () => ipcRenderer.invoke('app:version'),
  getAppDir:   () => ipcRenderer.invoke('app:appDir'),
  isDev:       () => ipcRenderer.invoke('app:isDev'),

  // Window
  minimize:    () => ipcRenderer.invoke('window:minimize'),
  hide:        () => ipcRenderer.invoke('window:hide'),

  // Shell
  openPath:    (p)   => ipcRenderer.invoke('shell:openPath', p),
  openExternal:(url) => ipcRenderer.invoke('shell:openExternal', url),
  openVSCode:  (p)   => ipcRenderer.invoke('shell:openVSCode', p),

  // Dialogs
  pickFolder:  ()    => ipcRenderer.invoke('dialog:pickFolder'),

  // Updates
  checkForUpdate:   () => ipcRenderer.invoke('update:check'),
  downloadUpdate:   () => ipcRenderer.invoke('update:download'),
  installUpdate:    () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable:(cb) => ipcRenderer.on('update-available',  (_, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress',   (_, pct)  => cb(pct)),
  onUpdateReady:    (cb) => ipcRenderer.on('update-ready',      ()        => cb()),
  onUpdateError:    (cb) => ipcRenderer.on('update-error',      (_, msg)  => cb(msg)),
});
