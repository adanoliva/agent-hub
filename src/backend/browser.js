/**
 * browser.js — Browser automation via CDP (Chrome DevTools Protocol)
 *
 * Manages connection to a running Chromium/Firefox browser with remote debugging
 * enabled. Provides page operations (get, action, screenshot) used by the
 * Subsystem CLI browser tools.
 *
 * Supported browsers (Chromium-based, all use CDP):
 *   - Google Chrome
 *   - Microsoft Edge  (pre-installed on Windows 11)
 *   - Brave Browser
 *   - Firefox         (partial — own protocol, less reliable)
 *
 * Connection flow:
 *   1. Detect which browser is running with --remote-debugging-port
 *   2. If none found, offer to relaunch the preferred browser with the flag
 *   3. Connect via Playwright connectOverCDP()
 *   4. Keep connection alive; reconnect on drop
 *
 * Browser tool protocol (used by subsystem-cli.js):
 *
 *   TOOL: browser_get
 *   URL: https://jira.empresa.com/browse/PROJ-123
 *   [SELECTOR: #summary]        ← optional: wait for element
 *   [FORMAT: text|html|both]    ← default: text
 *
 *   ---
 *
 *   TOOL: browser_action
 *   ACTION: click|fill|select|hover|screenshot|wait|evaluate
 *   SELECTOR: #summary-field
 *   [VALUE: "nuevo texto"]       ← required for fill/select
 *   [SCRIPT: window.location...] ← required for evaluate
 *
 *   ---
 *
 *   TOOL: browser_screenshot
 *   [SELECTOR: #main-content]   ← optional: screenshot of element only
 */

const { execFile, exec } = require('child_process');
const path = require('path');
const http = require('http');
const os   = require('os');

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CDP_PORT = 9222;

/** Detection order: prefer Chromium-based browsers (full CDP), then Firefox. */
const BROWSER_DEFINITIONS = {
  chrome: {
    name:    'Google Chrome',
    win32:   [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ],
    darwin:  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux:   ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    engine:  'chromium',
  },
  edge: {
    name:    'Microsoft Edge',
    win32:   [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
    darwin:  ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    linux:   ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    engine:  'chromium',
  },
  brave: {
    name:    'Brave Browser',
    win32:   [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ],
    darwin:  ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux:   ['/usr/bin/brave-browser'],
    engine:  'chromium',
  },
  firefox: {
    name:    'Mozilla Firefox',
    win32:   [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ],
    darwin:  ['/Applications/Firefox.app/Contents/MacOS/firefox'],
    linux:   ['/usr/bin/firefox'],
    engine:  'firefox',
  },
};

const BROWSER_PRIORITY = ['chrome', 'edge', 'brave', 'firefox'];

// ── State ─────────────────────────────────────────────────────────────────────

let _playwright   = null;  // playwright module (lazy-loaded)
let _browser      = null;  // playwright Browser instance
let _page         = null;  // active page
let _cdpPort      = DEFAULT_CDP_PORT;
let _connected    = false;
let _browserKey   = null;  // 'chrome' | 'edge' | 'brave' | 'firefox'
let _launchedPid  = null;  // PID of browser we launched ourselves

// ── Playwright lazy loader ────────────────────────────────────────────────────

async function getPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright no está instalado. Ejecuta: npm install playwright'
    );
  }
  return _playwright;
}

// ── Browser path detection ────────────────────────────────────────────────────

const fs = require('fs');

function findBrowserExecutable(browserKey) {
  const def = BROWSER_DEFINITIONS[browserKey];
  if (!def) return null;
  const platform = process.platform; // 'win32' | 'darwin' | 'linux'
  const paths = def[platform] || [];
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Returns the first installed browser from BROWSER_PRIORITY.
 * @returns {{ key: string, name: string, exe: string, engine: string } | null}
 */
function detectInstalledBrowser() {
  for (const key of BROWSER_PRIORITY) {
    const exe = findBrowserExecutable(key);
    if (exe) {
      const def = BROWSER_DEFINITIONS[key];
      return { key, name: def.name, exe, engine: def.engine };
    }
  }
  return null;
}

/**
 * Returns all installed browsers.
 * @returns {Array<{ key, name, exe, engine }>}
 */
function listInstalledBrowsers() {
  return BROWSER_PRIORITY
    .map(key => {
      const exe = findBrowserExecutable(key);
      if (!exe) return null;
      const def = BROWSER_DEFINITIONS[key];
      return { key, name: def.name, exe, engine: def.engine };
    })
    .filter(Boolean);
}

// ── CDP port probe ────────────────────────────────────────────────────────────

/**
 * Checks whether a Chromium/Firefox remote-debugging port is responding.
 * @param {number} port
 * @returns {Promise<{ active: boolean, wsUrl?: string, pages?: any[] }>}
 */
function probeCdpPort(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ active: true, wsUrl: data.webSocketDebuggerUrl, data });
        } catch {
          resolve({ active: true });
        }
      });
    });
    req.on('error', () => resolve({ active: false }));
    req.setTimeout(1500, () => { req.destroy(); resolve({ active: false }); });
  });
}

/**
 * Lists open pages/tabs from a running CDP-enabled browser.
 * @param {number} port
 * @returns {Promise<Array<{ id, title, url, type }>>}
 */
function listCdpTabs(port) {
  return new Promise(resolve => {
    const r = http.get(`http://127.0.0.1:${port}/json/list`, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          const pages = JSON.parse(body);
          resolve(
            pages
              .filter(p => p.type === 'page')
              .map(p => ({ id: p.id, title: p.title, url: p.url }))
          );
        } catch {
          resolve([]);
        }
      });
    });
    r.on('error', () => resolve([]));
    r.setTimeout(1500, () => { r.destroy(); resolve([]); });
  });
}

// ── Browser launcher ──────────────────────────────────────────────────────────

/**
 * Relaunches the preferred browser with the CDP flag.
 * Preserves user profile (session/cookies).
 *
 * @param {string} browserKey  — 'chrome' | 'edge' | 'brave' | 'firefox'
 * @param {number} port
 * @returns {Promise<{ launched: boolean, exe: string, pid?: number }>}
 */
async function launchBrowserWithCdp(browserKey, port = DEFAULT_CDP_PORT) {
  const exe = findBrowserExecutable(browserKey);
  if (!exe) throw new Error(`Navegador '${browserKey}' no encontrado en el sistema`);

  const def = BROWSER_DEFINITIONS[browserKey];
  const args = def.engine === 'firefox'
    ? [`--remote-debugging-port=${port}`, '--no-remote']
    : [
        `--remote-debugging-port=${port}`,
        '--restore-last-session',
        '--no-first-run',
        '--no-default-browser-check',
      ];

  return new Promise((resolve, reject) => {
    const proc = execFile(exe, args, { detached: true, stdio: 'ignore' });
    proc.unref();
    _launchedPid = proc.pid;
    // Give the browser 2 s to start the debug port
    setTimeout(async () => {
      const probe = await probeCdpPort(port);
      if (probe.active) {
        resolve({ launched: true, exe, pid: proc.pid });
      } else {
        resolve({ launched: true, exe, pid: proc.pid, warning: 'Puerto CDP aún no responde — puede necesitar unos segundos más' });
      }
    }, 2000);
    proc.on('error', reject);
  });
}

// ── Playwright connection ─────────────────────────────────────────────────────

/**
 * Connects Playwright to a running browser via CDP.
 * @param {number} port
 * @param {'chromium'|'firefox'} engine
 * @returns {Promise<void>}
 */
async function connectBrowser(port = DEFAULT_CDP_PORT, engine = 'chromium') {
  const pw = await getPlaywright();

  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser   = null;
    _page      = null;
    _connected = false;
  }

  const cdpUrl = `http://127.0.0.1:${port}`;

  if (engine === 'firefox') {
    // Firefox uses its own protocol via Playwright's firefox.connect
    _browser = await pw.firefox.connect({ wsEndpoint: cdpUrl.replace('http', 'ws') });
  } else {
    _browser = await pw.chromium.connectOverCDP(cdpUrl);
  }

  // Get or create a usable page
  const contexts = _browser.contexts();
  if (contexts.length > 0 && contexts[0].pages().length > 0) {
    _page = contexts[0].pages()[0];
  } else {
    const ctx = contexts.length > 0 ? contexts[0] : await _browser.newContext();
    _page = await ctx.newPage();
  }

  _connected = true;
  _cdpPort   = port;
  console.log(`[browser] Connected to ${engine} on port ${port}`);

  _browser.on('disconnected', () => {
    _connected = false;
    _browser   = null;
    _page      = null;
    console.log('[browser] Disconnected from browser');
  });
}

/**
 * Disconnects from the browser (does NOT close the browser window).
 */
async function disconnectBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
  }
  _browser   = null;
  _page      = null;
  _connected = false;
}

// ── Ensure page ───────────────────────────────────────────────────────────────

async function getActivePage() {
  if (!_connected || !_browser) {
    throw new Error('Sin conexión al navegador. Usa el panel de Ajustes > Navegador para conectar primero.');
  }
  // Refresh page reference if needed
  const contexts = _browser.contexts();
  if (contexts.length > 0) {
    const pages = contexts[0].pages();
    if (pages.length > 0) _page = pages[pages.length - 1];
  }
  if (!_page) throw new Error('No hay pestañas abiertas en el navegador conectado.');
  return _page;
}

// ── Browser operations (used by subsystem-cli) ────────────────────────────────

/**
 * Navigates to a URL and returns the page content.
 *
 * @param {string} url
 * @param {{ selector?: string, format?: 'text'|'html'|'both', timeout?: number }} opts
 * @returns {Promise<{ url: string, title: string, text?: string, html?: string, found: boolean }>}
 */
async function browserGet(url, opts = {}) {
  const { selector, format = 'text', timeout = 30000 } = opts;
  const page = await getActivePage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

  if (selector) {
    await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
  }

  const title   = await page.title();
  const current = page.url();

  const result = { url: current, title, found: true };

  if (format === 'text' || format === 'both') {
    result.text = await page.evaluate(() => document.body.innerText);
  }
  if (format === 'html' || format === 'both') {
    result.html = await page.content();
  }

  // Cap at 50k chars to avoid flooding the AI context
  if (result.text  && result.text.length  > 50_000) result.text  = result.text.slice(0, 50_000) + '\n[...truncado a 50000 chars]';
  if (result.html  && result.html.length  > 50_000) result.html  = result.html.slice(0, 50_000) + '\n[...truncado a 50000 chars]';

  return result;
}

/**
 * Performs an action on the current page.
 *
 * @param {'click'|'fill'|'select'|'hover'|'screenshot'|'wait'|'evaluate'|'tab'} action
 * @param {{ selector?: string, value?: string, script?: string, tabIndex?: number, timeout?: number }} opts
 * @returns {Promise<{ action, ok, result?, screenshotBase64?, error? }>}
 */
async function browserAction(action, opts = {}) {
  const { selector, value, script, tabIndex, timeout = 10000 } = opts;
  const page = await getActivePage();

  try {
    switch (action) {
      case 'click': {
        if (!selector) throw new Error('SELECTOR requerido para click');
        await page.click(selector, { timeout });
        return { action, ok: true, result: `Clic en '${selector}'` };
      }

      case 'fill': {
        if (!selector) throw new Error('SELECTOR requerido para fill');
        if (value === undefined) throw new Error('VALUE requerido para fill');
        await page.fill(selector, value, { timeout });
        return { action, ok: true, result: `Campo '${selector}' rellenado` };
      }

      case 'select': {
        if (!selector) throw new Error('SELECTOR requerido para select');
        if (value === undefined) throw new Error('VALUE requerido para select');
        await page.selectOption(selector, value, { timeout });
        return { action, ok: true, result: `Seleccionado '${value}' en '${selector}'` };
      }

      case 'hover': {
        if (!selector) throw new Error('SELECTOR requerido para hover');
        await page.hover(selector, { timeout });
        return { action, ok: true, result: `Hover sobre '${selector}'` };
      }

      case 'screenshot': {
        const screenshotOpts = { type: 'png' };
        if (selector) {
          const el = await page.$(selector);
          if (!el) throw new Error(`Elemento no encontrado: ${selector}`);
          const buf = await el.screenshot(screenshotOpts);
          return { action, ok: true, screenshotBase64: buf.toString('base64'), selector };
        }
        const buf = await page.screenshot({ ...screenshotOpts, fullPage: false });
        return { action, ok: true, screenshotBase64: buf.toString('base64') };
      }

      case 'wait': {
        if (selector) {
          await page.waitForSelector(selector, { timeout });
          return { action, ok: true, result: `Elemento '${selector}' visible` };
        }
        if (value && !isNaN(Number(value))) {
          await page.waitForTimeout(Number(value));
          return { action, ok: true, result: `Esperado ${value}ms` };
        }
        throw new Error('SELECTOR o VALUE (ms) requerido para wait');
      }

      case 'evaluate': {
        if (!script) throw new Error('SCRIPT requerido para evaluate');
        // Safety: only allow read-only evaluations unless explicitly trusted
        const evalResult = await page.evaluate(script);
        return { action, ok: true, result: JSON.stringify(evalResult) };
      }

      case 'tab': {
        // Switch to a specific tab by index or URL substring
        const contexts = _browser.contexts();
        if (!contexts.length) throw new Error('Sin contextos de navegador');
        const pages = contexts[0].pages();
        if (tabIndex !== undefined) {
          if (tabIndex < 0 || tabIndex >= pages.length) throw new Error(`Índice de pestaña fuera de rango (0-${pages.length - 1})`);
          _page = pages[tabIndex];
          await _page.bringToFront();
          return { action, ok: true, result: `Pestaña ${tabIndex} activa: ${_page.url()}` };
        }
        if (value) {
          const target = pages.find(p => p.url().includes(value));
          if (!target) throw new Error(`No se encontró pestaña con URL que contenga: ${value}`);
          _page = target;
          await _page.bringToFront();
          return { action, ok: true, result: `Pestaña activa: ${_page.url()}` };
        }
        throw new Error('VALUE (URL substring) o tabIndex requerido para tab');
      }

      default:
        throw new Error(`Acción no reconocida: ${action}`);
    }
  } catch (err) {
    return { action, ok: false, error: err.message };
  }
}

/**
 * Returns the current status of the browser connection.
 */
async function getStatus() {
  const installed = listInstalledBrowsers();
  const probe     = await probeCdpPort(_cdpPort);
  let tabs        = [];
  if (probe.active) {
    tabs = await listCdpTabs(_cdpPort);
  }

  return {
    connected:  _connected,
    cdpActive:  probe.active,
    cdpPort:    _cdpPort,
    browserKey: _browserKey,
    tabs,
    installed:  installed.map(b => ({ key: b.key, name: b.name, engine: b.engine })),
  };
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  // Detection
  detectInstalledBrowser,
  listInstalledBrowsers,
  findBrowserExecutable,

  // CDP probe
  probeCdpPort,
  listCdpTabs,

  // Connection
  connectBrowser,
  disconnectBrowser,
  launchBrowserWithCdp,

  // Operations
  browserGet,
  browserAction,

  // State
  getStatus,
  isConnected: () => _connected,
  setPreferredBrowser: (key) => { _browserKey = key; },
  getPreferredBrowser: () => _browserKey,
  setCdpPort: (port) => { _cdpPort = port; },
  getCdpPort: () => _cdpPort,

  // Constants
  BROWSER_DEFINITIONS,
  BROWSER_PRIORITY,
  DEFAULT_CDP_PORT,
};
