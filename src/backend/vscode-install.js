/**
 * vscode-install.js — installs the VS Code extension bundled with the app (vscode/agent-hub.vsix, built
 * from extensions/vscode by scripts/build-vscode.js) through VS Code's own `code` command.
 */
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const spawn = require('cross-spawn');

const VSIX   = path.join(__dirname, 'vscode', 'agent-hub.vsix');
const EXT_ID = 'adanoliva.agent-hub-vscode';
const APP_VERSION = require('../../package.json').version;   // the extension is built with the same version

/** Runs `code …`; resolves null when VS Code's `code` command is not in the PATH */
function code(args) {
  return new Promise((resolve) => {
    const child = spawn('code', args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 90_000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      // The npm-less `code.cmd` shim reports a missing binary through cmd.exe, not ENOENT
      if (/is not recognized|no se reconoce|command not found/i.test(stderr)) return resolve(null);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function getStatus() {
  const bundled = fs.existsSync(VSIX);
  const r = await code(['--list-extensions', '--show-versions']);
  if (!r) return { supported: bundled, codeFound: false, installed: false, version: null, outdated: false };
  const line = r.stdout.split(/\r?\n/).find(l => l.toLowerCase().startsWith(EXT_ID + '@'));
  const version = line ? line.split('@')[1] : null;
  return { supported: bundled, codeFound: true, installed: !!line, version, outdated: !!version && version !== APP_VERSION };
}

async function install() {
  if (!fs.existsSync(VSIX)) throw new Error('Esta versión de Agent Hub no incluye la extensión (npm run build:vscode)');
  // Inside the packaged app the .vsix lives in app.asar, which only Electron can read: hand VS Code a real file
  const tmp = path.join(os.tmpdir(), `agent-hub-${APP_VERSION}.vsix`);
  fs.writeFileSync(tmp, fs.readFileSync(VSIX));
  try {
    const r = await code(['--install-extension', tmp, '--force']);
    if (!r) throw new Error('No se encuentra el comando "code". En VS Code: Ctrl+Shift+P → "Shell Command: Install \'code\' command in PATH"');
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim() || `code terminó con código ${r.exitCode}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return getStatus();
}

async function uninstall() {
  const r = await code(['--uninstall-extension', EXT_ID]);
  if (!r) throw new Error('No se encuentra el comando "code"');
  return getStatus();
}

module.exports = { getStatus, install, uninstall, EXT_ID };
