/**
 * tests/backend/orchestrator.test.js
 *
 * Unit tests for:
 *   - extractHandoff / stripHandoff  (protocolo HANDOFF entre agentes)
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

// ── validate (formato DAG) ───────────────────────────────────────────────────

function dagNode(id, agentName, dependsOn = [], extra = {}) {
  return {
    id, agentName, dependsOn,
    dataFlow:     { agentOutput: true, filesModified: false },
    contextExtra: { fixed: { freeText: '', files: [] }, temporal: [] },
    ...extra,
  };
}

function makeDag(nodes) {
  return { id: 'orch-dag', name: 'DAG', projectId: 'p-test', nodes,
    executionConfig: { timeout: 300_000, maxTurns: 10, stopOnError: true } };
}

test('validate: orquestación sin nodos produce error', async () => {
  const dir = makeProjectDir('proj-dag-empty').dir;
  const { valid, errors } = await new OrchestrationExecutor(makeDag([]), { id: 'p8', path: dir }).validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('al menos 1 agente')));
});

test('validate: nodo flotante produce error', async () => {
  const dir  = makeProjectDir('proj-dag-floating').dir;
  const orch = makeDag([dagNode('a', 'agent-uno'), dagNode('b', 'agent-dos', [], { isRoot: false })]);
  const { valid, errors } = await new OrchestrationExecutor(orch, { id: 'p9', path: dir }).validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('sin conectar')));
});

test('validate: dependencia inexistente produce error', async () => {
  const dir  = makeProjectDir('proj-dag-baddep').dir;
  const orch = makeDag([dagNode('a', 'agent-uno'), dagNode('b', 'agent-dos', ['no-existe'])]);
  const { valid, errors } = await new OrchestrationExecutor(orch, { id: 'p10', path: dir }).validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('no existe')));
});

test('validate: nodo sin dependsOn no lanza', async () => {
  const dir  = makeProjectDir('proj-dag-nodeps').dir;
  const orch = makeDag([{ id: 'a', agentName: 'agent-uno' }]);
  const { valid, errors } = await new OrchestrationExecutor(orch, { id: 'p11', path: dir }).validate();
  assert.equal(valid, true, errors.join(', '));
});

test('validate: ciclo produce error', async () => {
  const dir  = makeProjectDir('proj-dag-cycle').dir;
  const orch = makeDag([dagNode('r', 'agent-uno'), dagNode('a', 'agent-dos', ['r', 'b']), dagNode('b', 'agent-uno', ['a'])]);
  const { valid, errors } = await new OrchestrationExecutor(orch, { id: 'p12', path: dir }).validate();
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('ciclo')));
});

test('estimate: suelo por los prompts y media de las ejecuciones anteriores', () => {
  const dir  = makeProjectDir('proj-estimate').dir;
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'x'.repeat(4000));
  const orch = makeDag([dagNode('a', 'agent-uno'), dagNode('b', 'agent-dos', ['a'])]);

  const first = new OrchestrationExecutor(orch, { id: 'p13', path: dir }).estimate();
  assert.equal(first.priced, true);                      // Claude CLI by default
  assert.ok(first.steps[0].inputTokens > first.steps[1].inputTokens, 'only the root gets the project context');
  assert.ok(first.totals.minCostUSD > 0);
  assert.equal(first.totals.history, null);

  const execDir = path.join(dir, '.agent-hub', 'executions', 'e1');
  fs.mkdirSync(execDir, { recursive: true });
  fs.writeFileSync(path.join(execDir, 'metadata.json'), JSON.stringify({
    orchestrationId: 'orch-dag', executionId: 'e1', status: 'success', startedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(path.join(execDir, 'result.json'), JSON.stringify({
    totalTokensUsed: { input: 300, output: 30 }, estimatedCost: 0.5,
    results: [
      { nodeId: 'a', status: 'success', tokensUsed: { input: 100, output: 10 }, estimatedCost: 0.2 },
      { nodeId: 'b', status: 'success', tokensUsed: { input: 200, output: 20 }, estimatedCost: 0.3 },
    ],
  }));

  const again = new OrchestrationExecutor(orch, { id: 'p13', path: dir }).estimate();
  assert.deepEqual(again.steps[1].history, { runs: 1, input: 200, output: 20, costUSD: 0.3 });
  assert.equal(again.totals.history.costUSD, 0.5);
});
