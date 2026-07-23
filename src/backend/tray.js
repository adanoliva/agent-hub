/**
 * tray.js — System tray icon and context menu
 *
 * The tray icon is generated programmatically at runtime (no external file needed).
 * Replace assets/icon.ico for production builds.
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs   = require('fs');
const { createTrayIconBuffer } = require('./icon');
const { getAssetsDir } = require('./config');

let tray = null;

/**
 * Creates the system tray icon and context menu.
 * @param {BrowserWindow} win — the main app window
 */
function createTray(win) {
  // Try loading icon from assets first (for production builds with custom icon)
  let icon;
  const assetsDir = getAssetsDir();
  const iconPath  = path.join(assetsDir, 'icon.ico');
  const pngPath   = path.join(assetsDir, 'icon.png');

  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else if (fs.existsSync(pngPath)) {
    icon = nativeImage.createFromPath(pngPath);
  } else {
    // Generate programmatically — no file needed
    const buf = createTrayIconBuffer();
    icon = nativeImage.createFromBuffer(buf, { scaleFactor: 1.0 });
  }

  // Resize to standard tray size on Windows
  icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Agent Hub');

  updateContextMenu(win);

  // Left click → show/focus window
  tray.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) {
      win.focus();
    } else {
      win.show();
      win.focus();
    }
  });

  return tray;
}

/**
 * Rebuilds the right-click context menu.
 * Call this again whenever state changes (e.g. window visibility).
 */
function updateContextMenu(win) {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'Abrir Agent Hub',
      click: () => {
        if (!win || win.isDestroyed()) return;
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Reiniciar',
      click: () => {
        app.relaunch();
        app.exit(0);
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, updateContextMenu, destroyTray };
