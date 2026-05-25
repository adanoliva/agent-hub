const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-tests-'));
process.env.CDM_DATA_DIR = tmpRoot;

const { readConfig, writeConfig, bootstrapDirectories, getAgentDir } = require('../../src/backend/config');
const { startServer } = require('../../src/backend/server');

let server;
let baseUrl;

function makeAgentMd({ name, description, model = 'sonnet', tools = [], system }) {
  const toolsYaml = tools.map((t) => `  - ${t}`).join('\n');
  return `---\nname: ${name}\ndescription: ${description}\nmodel: ${model}\ntools:\n${toolsYaml || '  []'}\n---\n\n${system}\n`;
}

test.before(async () => {
  const cfg = readConfig();
  bootstrapDirectories(cfg);

  const projectPath = path.join(tmpRoot, 'demo-project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), '# Demo\n\nContexto base de proyecto para pruebas de dashboard y salud.', 'utf8');

  const globalDir = getAgentDir('global');
  fs.writeFileSync(
    path.join(globalDir, 'quality-check.md'),
    makeAgentMd({
      name: 'quality-check',
      description: 'Valida calidad de codigo',
      tools: [],
      system: 'Revisa calidad del codigo y reporta hallazgos con pasos claros.',
    }),
    'utf8',
  );

  cfg.projects = [
    {
      id: 'p-test-1',
      name: 'Demo Test',
      categoryId: 'web',
      techId: 'react',
      path: projectPath,
      status: 'active',
      aiProvider: 'claude',
      agentHashes: {},
      excludedAgents: [],
      includedAgents: [],
      createdAt: new Date().toISOString(),
      lastSyncAt: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)).toISOString(),
    },
  ];

  writeConfig(cfg);

  server = await startServer(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('dashboard returns health and notifications', async () => {
  const res = await fetch(`${baseUrl}/dashboard`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(typeof body.agents.total, 'number');
  assert.ok(Array.isArray(body.notifications));
  assert.ok(Array.isArray(body.projectHealth));
  assert.equal(body.projectHealth.length, 1);
  assert.equal(body.projectHealth[0].projectId, 'p-test-1');
});

test('dismiss, snooze and restore notification flow works', async () => {
  const firstDash = await (await fetch(`${baseUrl}/dashboard`)).json();
  const notif = firstDash.notifications.find((n) => n.type === 'optimization');
  assert.ok(notif, 'expected at least one dismissible notification');

  const snoozeRes = await fetch(`${baseUrl}/dashboard/notifications/snooze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: notif.id, days: 7 }),
  });
  assert.equal(snoozeRes.status, 200);

  const afterSnooze = await (await fetch(`${baseUrl}/dashboard`)).json();
  assert.ok(!afterSnooze.notifications.some((n) => n.id === notif.id));
  assert.ok((afterSnooze.hiddenSnoozed || 0) >= 1);

  const restoreRes = await fetch(`${baseUrl}/dashboard/notifications/restore`, { method: 'POST' });
  assert.equal(restoreRes.status, 200);

  const afterRestore = await (await fetch(`${baseUrl}/dashboard`)).json();
  assert.ok(afterRestore.notifications.some((n) => n.id === notif.id));

  const dismissRes = await fetch(`${baseUrl}/dashboard/notifications/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: notif.id }),
  });
  assert.equal(dismissRes.status, 200);

  const afterDismiss = await (await fetch(`${baseUrl}/dashboard`)).json();
  assert.ok(!afterDismiss.notifications.some((n) => n.id === notif.id));
  assert.ok((afterDismiss.hiddenDismissed || 0) >= 1);
});

test('sync preview endpoint returns expected summary', async () => {
  const res = await fetch(`${baseUrl}/projects/p-test-1/sync-preview`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.ok(body.summary);
  assert.equal(typeof body.summary.total, 'number');
  assert.ok(Array.isArray(body.toAdd));
  assert.ok(Array.isArray(body.toUpdate));
});
