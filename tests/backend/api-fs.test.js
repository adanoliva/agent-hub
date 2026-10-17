'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const apiFs = require('../../src/backend/api-fs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-apifs-'));
for (const f of ['src/a.ts', 'src/deep/b.ts', 'src/c.tsx', 'README.md', '.github/ci.yml', '.env', '.agent-hub/backups/x.bak']) {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), 'x');
}

test('bashCommand: rechaza redirección, encadenado y rutas fuera del proyecto', async () => {
  for (const cmd of [
    'echo x > out.txt', 'type a < b', 'echo %USERPROFILE%', 'echo $(whoami)', 'echo a\nrm x',
    'cat ../secret', 'type C:\\Users\\x\\.ssh\\id_rsa', 'type \\Windows\\win.ini', 'cat /c/Users/x',
    'cat ~/.ssh/id_rsa', 'find . -exec calc {} +', 'find . -delete', 'powershell -c calc',
  ]) {
    await assert.rejects(apiFs.bashCommand(root, cmd), { code: 'FORBIDDEN_COMMAND' }, cmd);
  }
});

test('bashCommand: permite comandos de lectura dentro del proyecto', async () => {
  const { exitCode } = await apiFs.bashCommand(root, 'echo hola');
  assert.equal(exitCode, 0);
});

test('listFiles: patrones glob', () => {
  assert.deepEqual(apiFs.listFiles(root, '*.ts').sort(), ['src/a.ts', 'src/deep/b.ts']);
  assert.deepEqual(apiFs.listFiles(root, 'src/**/*.ts').sort(), ['src/a.ts', 'src/deep/b.ts']);
  assert.deepEqual(apiFs.listFiles(root, 'src').sort(), ['src/a.ts', 'src/c.tsx', 'src/deep/b.ts']);
  const all = apiFs.listFiles(root);
  assert.ok(all.includes('.github/ci.yml'));
  assert.ok(!all.includes('.env'));
  assert.ok(!all.some(f => f.startsWith('.agent-hub/')));
});

test('readFile: rechaza symlinks/junctions que salen del proyecto', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  assert.throws(() => apiFs.readFile(root, 'link/secret.txt'), { code: 'PATH_OUT_OF_BOUNDS' });
  assert.throws(() => apiFs.writeFile(root, 'link/new/file.txt', 'x'), { code: 'PATH_OUT_OF_BOUNDS' });
});
