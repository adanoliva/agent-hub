const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, opts = {}) {
  const res = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const root = process.cwd();
  const distDir = path.join(root, 'dist');
  const tempOut = path.join(distDir, `build-${Date.now()}`);

  ensureDir(distDir);

  // 1) Build renderer + icon
  run('npm', ['run', 'prepare:build'], { cwd: root });

  // 2) Package to a unique output dir to avoid stale .7z locks in dist/
  run('npx', ['electron-builder', '--win', 'portable', `--config.directories.output=${tempOut}`], { cwd: root });

  // 3) Copy resulting exe back to dist/ for predictable location
  const exeFromTemp = path.join(tempOut, 'agent-hub.exe');
  if (!fs.existsSync(exeFromTemp)) {
    console.error(`No se encontro el ejecutable esperado: ${exeFromTemp}`);
    process.exit(1);
  }

  const exeFinal = path.join(distDir, 'agent-hub.exe');
  try {
    fs.copyFileSync(exeFromTemp, exeFinal);
    console.log(`Portable generado: ${exeFinal}`);
  } catch (err) {
    const fallback = path.join(distDir, `agent-hub-${Date.now()}.exe`);
    fs.copyFileSync(exeFromTemp, fallback);
    console.warn(`No se pudo sobrescribir dist/agent-hub.exe (posible lock). Copia disponible en: ${fallback}`);
  }
}

main();
