'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-runner-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { contextForPrompt } = require('../../src/backend/project-runner');
const { readProjectContext, saveContextFile } = require('../../src/backend/projects');
const { executeToolCall } = require('../../src/backend/subsystem-cli');
const apiFs = require('../../src/backend/api-fs');

function project(name, files) {
  const dir = path.join(tmpRoot, name);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf8');
  }
  fs.mkdirSync(dir, { recursive: true });
  return { id: name, path: dir, aiProviders: ['claude'] };
}

test('contexto: un CLI que carga el fichero por sí mismo no lo recibe otra vez en el prompt', () => {
  const p = project('cli-own', { 'AGENTS.md': '# Agents' });
  assert.equal(contextForPrompt(p, 'cli'), '');
  assert.equal(contextForPrompt(p, 'copilot-cli'), '');
  assert.equal(contextForPrompt(p, 'antigravity-cli'), '');
});

test('contexto: un CLI sin su fichero recibe el contexto en el prompt', () => {
  const p = project('cli-missing', { '.github/copilot-instructions.md': '# Copilot' });
  assert.equal(contextForPrompt(p, 'cli'), '# Copilot');           // Claude no lee copilot-instructions.md
  assert.equal(contextForPrompt(p, 'copilot-cli'), '');            // Copilot sí
});

test('contexto: los proveedores API siempre lo reciben, prefiriendo AGENTS.md', () => {
  const p = project('api', { 'AGENTS.md': '# Agents', 'CONTEXTO.md': '# Central', 'CLAUDE.md': '# Claude' });
  assert.equal(contextForPrompt(p, 'openai'), '# Agents');
  assert.equal(readProjectContext(project('api-central', { 'CONTEXTO.md': '# Central' }).path).content, '# Central');
  assert.equal(contextForPrompt(project('api-none', {}), 'openai'), '');
});

test('contexto: ya no se recorta a 2.000 caracteres', () => {
  const big = 'x'.repeat(15_000);
  assert.equal(contextForPrompt(project('api-big', { 'AGENTS.md': big }), 'openai'), big);
});

test('saveContextFile escribe AGENTS.md además de CONTEXTO.md y los ficheros del proveedor', () => {
  const p = project('save', {});
  saveContextFile(p, 'central', '# Nuevo');
  for (const f of ['AGENTS.md', 'CONTEXTO.md', 'CLAUDE.md']) assert.equal(fs.readFileSync(path.join(p.path, f), 'utf8'), '# Nuevo');
});

test('subsistema en solo lectura: rechaza write y los comandos de desarrollo', async () => {
  const p = project('ro', { 'a.txt': 'a' });
  const write = await executeToolCall({ tool: 'write', args: { path: 'b.txt', content: 'b' } }, p.path, { readOnly: true });
  assert.equal(write.success, false);
  assert.equal(write.error.code, 'READ_ONLY');
  assert.ok(!fs.existsSync(path.join(p.path, 'b.txt')));
  const npm = await executeToolCall({ tool: 'bash', args: { command: 'node --version' } }, p.path, { readOnly: true });
  assert.equal(npm.success, false);
});

test('bashCommand en modo agente: permite toolchains, mantiene los bloqueos', async () => {
  const p = project('exec', {});
  const { exitCode, stdout } = await apiFs.bashCommand(p.path, 'node --version', { exec: true });
  assert.equal(exitCode, 0);
  assert.match(stdout, /^v\d+/);
  await assert.rejects(apiFs.bashCommand(p.path, 'node --version'), { code: 'FORBIDDEN_COMMAND' }); // solo lectura
  for (const cmd of ['npm test && rm -rf .', 'npm i -g x', 'git push', 'git reset --hard', 'pip install x', 'node ../fuera.js', 'npm test > out.txt']) {
    await assert.rejects(apiFs.bashCommand(p.path, cmd, { exec: true }), { code: 'FORBIDDEN_COMMAND' }, cmd);
  }
});
