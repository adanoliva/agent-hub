/**
 * kill-dev-ports.js
 * Frees common dev ports used by Agent Hub when they are held by stale
 * Node/Electron processes from previous runs.
 */

const { execSync } = require('child_process');

const PORTS = [5173, 3737];

function safeExec(command) {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch {
    return '';
  }
}

function getWindowsPidsByPort(port) {
  // Avoid -p tcp: it can be unreliable across Windows versions/locales.
  // Use plain netstat -ano and filter manually; handles both IPv4 and IPv6.
  const out = safeExec(`netstat -ano`);
  const pids = new Set();
  out.split(/\r?\n/).forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) return;
    // columns: Proto  Local  Foreign  State  PID
    const proto = parts[0].toUpperCase();
    if (proto !== 'TCP') return;
    const local = parts[1] || '';
    const state = parts[3] || '';
    const pid   = parts[4];
    // match :PORT at end of local address (IPv4 and IPv6)
    if (!local.endsWith(`:${port}`)) return;
    if (state !== 'LISTENING') return;
    if (!/^\d+$/.test(pid)) return;
    pids.add(Number(pid));
  });
  return [...pids];
}

function getWindowsImageName(pid) {
  const out = safeExec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
  if (!out || out.includes('No tasks are running')) return null;
  const first = out.split(/\r?\n/).find(Boolean);
  if (!first) return null;
  const cols = first.split('","').map((c) => c.replace(/^"|"$/g, ''));
  return (cols[0] || '').toLowerCase();
}

function killWindowsPid(pid) {
  safeExec(`taskkill /PID ${pid} /F`);
}

function getUnixPidsByPort(port) {
  const out = safeExec(`lsof -ti tcp:${port}`);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

function getUnixCommand(pid) {
  const out = safeExec(`ps -p ${pid} -o comm=`).trim();
  return out.toLowerCase();
}

function killUnixPid(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore if process ended between listing and kill.
  }
}

function isSafeDevProcess(name) {
  return name.includes('node') || name.includes('electron');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function freePorts() {
  console.log('[predev] Checking stale dev ports...');

  let killed = false;

  for (const port of PORTS) {
    if (process.platform === 'win32') {
      const pids = getWindowsPidsByPort(port);
      if (pids.length === 0) {
        console.log(`[predev] Port ${port} is free.`);
        continue;
      }

      for (const pid of pids) {
        const image = getWindowsImageName(pid) || '';
        if (!isSafeDevProcess(image)) {
          console.log(`[predev] Port ${port} in use by non-dev process (${image || 'unknown'}, PID ${pid}). Skipping.`);
          continue;
        }
        console.log(`[predev] Releasing port ${port} (PID ${pid}, ${image})...`);
        killWindowsPid(pid);
        killed = true;
      }
      continue;
    }

    const pids = getUnixPidsByPort(port);
    if (pids.length === 0) {
      console.log(`[predev] Port ${port} is free.`);
      continue;
    }

    for (const pid of pids) {
      const cmd = getUnixCommand(pid);
      if (!isSafeDevProcess(cmd)) {
        console.log(`[predev] Port ${port} in use by non-dev process (${cmd || 'unknown'}, PID ${pid}). Skipping.`);
        continue;
      }
      console.log(`[predev] Releasing port ${port} (PID ${pid}, ${cmd})...`);
      killUnixPid(pid);
      killed = true;
    }
  }

  // Give the OS time to release TCP sockets before Vite tries to bind
  if (killed) {
    await sleep(600);
    console.log('[predev] Ports released.');
  }
}

freePorts();
