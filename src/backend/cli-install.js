/**
 * cli-install.js — installs the `agent-hub` terminal command (Windows only).
 * Copies cli/agent-hub.{ps1,cmd} to %LOCALAPPDATA%\AgentHub\bin and adds that dir to the user PATH.
 * Linux/macOS: see docs/backend.md §19 (pending a POSIX shell port).
 */
const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC_DIR = path.join(__dirname, 'cli');
const BIN_DIR = path.join(process.env.LOCALAPPDATA || '', 'AgentHub', 'bin');

// Dir passed via env var to avoid quoting issues; SetEnvironmentVariable broadcasts WM_SETTINGCHANGE
// (unlike `setx`, which also truncates PATH to 1024 chars).
function userPath(op) {
  const script = op === 'get'
    ? `[Environment]::GetEnvironmentVariable('Path','User')`
    : `$d=$env:AH_BIN; $p=@([Environment]::GetEnvironmentVariable('Path','User') -split ';' | ? { $_ -and $_ -ne $d });` +
      (op === 'add' ? ` $p+=$d;` : '') +
      ` [Environment]::SetEnvironmentVariable('Path', ($p -join ';'), 'User')`;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, AH_BIN: BIN_DIR }, encoding: 'utf8', windowsHide: true,
  }).trim();
}

function copyFiles() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const ps1 = fs.readFileSync(path.join(SRC_DIR, 'agent-hub.ps1'), 'utf8');
  const cmd = fs.readFileSync(path.join(SRC_DIR, 'agent-hub.cmd'), 'utf8');
  fs.writeFileSync(path.join(BIN_DIR, 'agent-hub.ps1'), '﻿' + ps1.replace(/\r?\n/g, '\r\n'));
  fs.writeFileSync(path.join(BIN_DIR, 'agent-hub.cmd'), cmd.replace(/\r?\n/g, '\r\n'));
}

function getStatus() {
  if (process.platform !== 'win32') return { supported: false, installed: false, dir: null };
  const filesOk = fs.existsSync(path.join(BIN_DIR, 'agent-hub.cmd'));
  const inPath  = filesOk && userPath('get').toLowerCase().split(';').includes(BIN_DIR.toLowerCase());
  return { supported: true, installed: filesOk && inPath, dir: BIN_DIR };
}

function install() {
  if (process.platform !== 'win32') throw new Error('Solo disponible en Windows');
  copyFiles();
  userPath('add');
  return getStatus();
}

function uninstall() {
  if (process.platform !== 'win32') throw new Error('Solo disponible en Windows');
  userPath('remove');
  fs.rmSync(BIN_DIR, { recursive: true, force: true });
  return getStatus();
}

// Called at startup so an installed CLI follows app updates.
function refreshIfInstalled() {
  try { if (getStatus().installed) copyFiles(); } catch {}
}

module.exports = { getStatus, install, uninstall, refreshIfInstalled };
