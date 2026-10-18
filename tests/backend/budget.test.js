'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-budget-'));
process.env.CDM_DATA_DIR = tmpRoot;

// Each AI step "costs" $0.60; stubbed before the orchestrator grabs runInProject
const runner = require('../../src/backend/project-runner');
let calls = 0;
runner.runInProject = async () => {
  calls++;
  return { text: 'hecho', inputTokens: 100, outputTokens: 50, costUSD: 0.6, costUnavailable: false, mcpIgnored: [], filesModified: null };
};
const { OrchestrationExecutor } = require('../../src/backend/orchestrator');

const node = (id, agentName, dependsOn) => ({
  id, agentName, dependsOn,
  dataFlow: { agentOutput: true, filesModified: false, projectContext: false },
  contextExtra: { fixed: { freeText: 'tarea', files: [] }, temporal: [] },
});

test('maxBudgetUSD: se detiene tras el nivel que supera el presupuesto', async () => {
  const dir = path.join(tmpRoot, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const orch = {
    id: 'orch-budget', name: 'budget', projectId: 'p-b',
    nodes: [node('a', 'uno', []), node('b', 'dos', ['a'])],
    executionConfig: { timeout: 60_000, maxTurns: 1, stopOnError: true, maxBudgetUSD: 0.5 },
  };
  const ex = new OrchestrationExecutor(orch, { id: 'p-b', path: dir });
  let cancelled = null;
  ex.on('cancelled', (d) => { cancelled = d; });

  const result = await ex.execute();
  assert.equal(calls, 1, 'the second step never runs');
  assert.equal(cancelled?.reason, 'budget_exceeded');
  assert.equal(cancelled.data.limit, 0.5);
  assert.ok(cancelled.data.spent > 0.5);
  assert.equal(result.results.length, 1);
});
