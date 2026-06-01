/**
 * tests/backend/orchestrator.test.js
 *
 * Unit tests for:
 *   - extractHandoff / stripHandoff  (protocolo HANDOFF entre agentes)
 *   - _getContextFile                (usa cfg.aiProvider, no project.aiProvider)
 *   - validate()                     (errores de configuración de orquestación)
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// CDM_DATA_DIR debe estar antes de cualquier require de backend
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-orch-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { readConfig, writeConfig, bootstrapDirectories, getAgentDir } = require('../../src/backend/config');
const { OrchestrationExecutor, extractHandoff, stripHandoff } = require('../../src/backend/orchestrator');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProjectDir(name, aiProvider = 'claude') {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, aiProvider };
}

function makeOrch(agents, nodes, extra = {}) {
  return {
    id: 'orch-test',
    name: 'Test Orch',
    projectId: 'p-test',
    agents,
    nodes,
    executionConfig: { timeout: 300_000, maxTurns: 10, stopOnError: true },
    ...extra,
  };
}

function makeNode(from, to, extra = {}) {
  return {
    id:          `node-${from}-${to}`,
    from,
    to,
    dataFlow:    { agentOutput: true, filesModified: false },
    contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
    ...extra,
  };
}

// ── extractHandoff ────────────────────────────────────────────────────────────

test('extractHandoff: parsea una línea HANDOFF válida', () => {
  const response = 'He revisado el código.\nHANDOFF: {"done":"Revisión completa","changed":["src/a.ts"],"issues":[],"next":"Escribe los tests"}';
  const h = extractHandoff(response);
  assert.ok(h);
  assert.equal(h.done, 'Revisión completa');
  assert.deepEqual(h.changed, ['src/a.ts']);
  assert.deepEqual(h.issues, []);
  assert.equal(h.next, 'Escribe los tests');
});

test('extractHandoff: devuelve null si no hay línea HANDOFF', () => {
  assert.equal(extractHandoff('Respuesta sin handoff.'), null);
});

test('extractHandoff: devuelve null si el JSON es inválido', () => {
  assert.equal(extractHandoff('HANDOFF: {roto json}'), null);
});

test('extractHandoff: tolera campos faltantes con valores por defecto', () => {
  const h = extractHandoff('HANDOFF: {"done":"ok"}');
  assert.ok(h);
  assert.equal(h.done, 'ok');
  assert.deepEqual(h.changed, []);
  assert.deepEqual(h.issues, []);
  assert.equal(h.next, '');
});

test('extractHandoff: ignora línea HANDOFF con prefijo de espacio (no es inicio de línea)', () => {
  // La regex usa ^HANDOFF: con flag m, así que necesita que HANDOFF esté al inicio de la línea
  const response = '  HANDOFF: {"done":"ok","changed":[],"issues":[],"next":""}';
  assert.equal(extractHandoff(response), null);
});

// ── stripHandoff ──────────────────────────────────────────────────────────────

test('stripHandoff: elimina la línea HANDOFF del texto', () => {
  const response = 'Trabajo realizado.\nHANDOFF: {"done":"ok","changed":[],"issues":[],"next":"siguiente"}\n';
  const cleaned  = stripHandoff(response);
  assert.ok(!cleaned.includes('HANDOFF:'));
  assert.ok(cleaned.includes('Trabajo realizado.'));
});

test('stripHandoff: devuelve el texto intacto si no hay HANDOFF', () => {
  const text = 'Sin handoff aquí.';
  assert.equal(stripHandoff(text), text);
});

test('stripHandoff: maneja cadena vacía/null sin lanzar', () => {
  assert.equal(stripHandoff(''), '');
  assert.equal(stripHandoff(null), '');
});

// ── _getContextFile: usa cfg.aiProvider, no project.aiProvider ────────────────

test('_getContextFile: lee CLAUDE.md cuando cfg.aiProvider es cli aunque project.aiProvider sea github', () => {
  const { dir } = makeProjectDir('proj-context-test');

  // Crear ambos archivos de contexto
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude context', 'utf8');
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), '# Copilot context', 'utf8');

  // Configurar el proveedor global como 'cli'
  const cfg = readConfig();
  cfg.aiProvider = 'cli';
  writeConfig(cfg);

  // El proyecto tiene aiProvider 'github' — antes del fix esto hubiera leído copilot-instructions.md
  const project = { id: 'p-ctx', name: 'Ctx Test', path: dir, aiProvider: 'github' };
  const orch = makeOrch(['agent-a', 'agent-b'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, project);

  const content = executor._getContextFile();
  // Con cfg.aiProvider='cli', debe leer CLAUDE.md
  assert.equal(content, '# Claude context');
});

test('_getContextFile: lee copilot-instructions.md cuando cfg.aiProvider es github', () => {
  const { dir } = makeProjectDir('proj-context-test-gh');

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude context', 'utf8');
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), '# Copilot context', 'utf8');

  const cfg = readConfig();
  cfg.aiProvider = 'github';
  writeConfig(cfg);

  const project = { id: 'p-ctx-gh', name: 'Ctx GH', path: dir, aiProvider: 'claude' };
  const orch = makeOrch(['agent-a', 'agent-b'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, project);

  const content = executor._getContextFile();
  assert.equal(content, '# Copilot context');

  // Restaurar para no afectar otros tests
  cfg.aiProvider = 'cli';
  writeConfig(cfg);
});

test('_getContextFile: devuelve string vacío si el archivo no existe', () => {
  const { dir } = makeProjectDir('proj-no-context');

  const cfg = readConfig();
  cfg.aiProvider = 'cli';
  writeConfig(cfg);

  const project = { id: 'p-nc', name: 'No Context', path: dir, aiProvider: 'claude' };
  const orch = makeOrch(['a', 'b'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, project);

  assert.equal(executor._getContextFile(), '');
});

// ── validate ──────────────────────────────────────────────────────────────────

test.before(() => {
  const cfg = readConfig();
  bootstrapDirectories(cfg);

  // Crear dos agentes globales para que validate los encuentre
  const globalDir = getAgentDir('global');
  for (const name of ['agent-uno', 'agent-dos']) {
    fs.writeFileSync(
      path.join(globalDir, `${name}.md`),
      `---\nname: ${name}\ndescription: Test\nmodel: sonnet\ntools:\n  - Read\n---\n\nSystem prompt.\n`,
      'utf8',
    );
  }
});

test('validate: orquestación válida con 2 agentes y 1 nodo pasa sin errores', async () => {
  const dir  = makeProjectDir('proj-valid').dir;
  const orch = makeOrch(['agent-uno', 'agent-dos'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, { id: 'p1', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, true, `Errores inesperados: ${errors.join(', ')}`);
  assert.equal(errors.length, 0);
});

test('validate: menos de 2 agentes produce error', async () => {
  const dir  = makeProjectDir('proj-one-agent').dir;
  const orch = makeOrch(['agent-uno'], []);
  const executor = new OrchestrationExecutor(orch, { id: 'p2', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('al menos 2 agentes')));
});

test('validate: número de nodos incorrecto produce error', async () => {
  const dir  = makeProjectDir('proj-wrong-nodes').dir;
  // 2 agentes necesitan 1 nodo, pero pasamos 0
  const orch = makeOrch(['agent-uno', 'agent-dos'], []);
  const executor = new OrchestrationExecutor(orch, { id: 'p3', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('conexiones')));
});

test('validate: agente inexistente produce error', async () => {
  const dir  = makeProjectDir('proj-missing-agent').dir;
  const orch = makeOrch(['agent-uno', 'agente-que-no-existe'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, { id: 'p4', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('agente-que-no-existe')));
});

test('validate: timeout inferior a 5000ms produce error', async () => {
  const dir  = makeProjectDir('proj-low-timeout').dir;
  const orch = makeOrch(['agent-uno', 'agent-dos'], [makeNode(0, 1)], {
    executionConfig: { timeout: 1000, maxTurns: 10, stopOnError: true },
  });
  const executor = new OrchestrationExecutor(orch, { id: 'p5', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('timeout')));
});

test('validate: ruta de proyecto inexistente produce error', async () => {
  const orch = makeOrch(['agent-uno', 'agent-dos'], [makeNode(0, 1)]);
  const executor = new OrchestrationExecutor(orch, {
    id: 'p6', path: '/ruta/que/no/existe', aiProvider: 'claude',
  });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('ruta del proyecto')));
});

test('validate: nodo con índices incorrectos produce error', async () => {
  const dir  = makeProjectDir('proj-bad-indices').dir;
  // El nodo 0→1 se define con from=1,to=2 (debería ser from=0,to=1)
  const orch = makeOrch(['agent-uno', 'agent-dos'], [makeNode(1, 2)]);
  const executor = new OrchestrationExecutor(orch, { id: 'p7', path: dir, aiProvider: 'claude' });

  const { valid, errors } = await executor.validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('índices inválidos')));
});
