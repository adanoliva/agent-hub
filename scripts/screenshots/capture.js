// npm run screenshots — regenerates docs/screenshots/*.png and docs/web/screenshots/*.png.
// Runs the real UI (dist/renderer, so `npm run build:renderer` first) against an isolated backend with demo
// data (seed.js) and a fake `claude` (fake-claude.js): no tokens spent, none of your data on screen.
// Needs Chrome or Edge installed (Playwright drives the installed browser).
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { seed } = require('./seed');

const REPO    = path.resolve(__dirname, '..', '..');
const PORT    = 3799;                       // not 3737: the user's own Agent Hub may be running
const BASE    = `http://localhost:${PORT}`;
const ROOT    = path.join(os.tmpdir(), 'agent-hub-screenshots');
const OUT     = process.env.SCREENSHOT_OUT   // a scratch folder, to try changes without touching the docs
  ? [process.env.SCREENSHOT_OUT]
  : [path.join(REPO, 'docs', 'screenshots'), path.join(REPO, 'docs', 'web', 'screenshots')];
const ONLY    = process.argv.slice(2);      // optional: names to (re)take, e.g. `npm run screenshots -- 03-agents`
const DELAY_FILE = path.join(ROOT, 'fake-delay.txt');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = async (method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

function startBackend(dataDir) {
  // A `claude` that is our fake goes first in the PATH; everything else (git, node) is the real one
  const bin = path.join(ROOT, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude.cmd'), `@node "${path.join(__dirname, 'fake-claude.js')}" %*\r\n`);
  const env = { ...process.env, CDM_DATA_DIR: dataDir, PORT: String(PORT), FAKE_DELAY_FILE: DELAY_FILE,
    PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const child = spawn(process.execPath, [path.join(REPO, 'src', 'backend', 'server-standalone.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', d => process.env.DEBUG && process.stderr.write(d));
  return child;
}

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(300);
  }
  throw new Error('El backend de demostración no arrancó');
}

const n = (id, agentName, dependsOn, x, y, extra = {}) => ({
  id, agentName, dependsOn, ...(dependsOn.length ? {} : { isRoot: true }), x, y,
  dataFlow: { agentOutput: true, filesModified: true, projectContext: !dependsOn.length },
  contextExtra: { fixed: { freeText: extra.task || '', files: [] }, temporal: extra.temporal || [] },
  ...(extra.gateAfter && { gateAfter: true }),
});

async function seedOrchestrations() {
  const exec = { timeout: 1_800_000, stepTimeout: 600_000, maxTurns: 10, stopOnError: true, validateAfterEachStep: false };
  const main = await api('POST', '/orchestrations', { projectId: 'p-api', name: 'Refactor + tests + revisión',
    description: 'Extrae la validación, la cubre con tests y la documenta en paralelo, y pasa revisión',
    executionConfig: { ...exec, maxBudgetUSD: 2 },
    nodes: [
      n('n-refactor', 'refactor-expert', [], 278, 200, { task: 'Extrae la validación de los pedidos a un middleware reutilizable con zod.' }),
      n('n-tests', 'test-writer', ['n-refactor'], 140, 360),
      n('n-docs', 'doc-writer', ['n-refactor'], 416, 360),
      n('n-review', 'code-reviewer', ['n-tests', 'n-docs'], 278, 520),
    ] });
  const audit = await api('POST', '/orchestrations', { projectId: 'p-api', name: 'Auditoría de seguridad',
    description: 'OWASP Top 10 sobre la API y revisión de los hallazgos', executionConfig: exec,
    nodes: [
      n('a-audit', 'security-audit', [], 278, 200, { task: 'Audita la API de pedidos con el OWASP Top 10 como guía.',
        temporal: [{ id: 'scope', type: 'text', label: 'Alcance de la auditoría', placeholder: 'p. ej. solo /auth y /orders', required: false }] }),
      n('a-review', 'code-reviewer', ['a-audit'], 278, 360),
    ] });
  await api('POST', '/orchestrations', { projectId: 'p-tienda', name: 'Componente accesible', description: 'Nuevo componente, revisión de accesibilidad y tests',
    executionConfig: exec,
    nodes: [n('t-react', 'react-dev', [], 278, 200, { task: 'Crea el carrito lateral con TanStack Query.' }), n('t-a11y', 'accessibility', ['t-react'], 278, 360), n('t-tests', 'test-writer', ['t-a11y'], 278, 520)] });
  return { main, audit };
}

async function runToEnd(orch) {
  const before = (await api('GET', `/orchestrations/${orch.id}/executions`)).length;
  await api('POST', `/orchestrations/${orch.id}/execute`, { temporalContexts: {} });
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    const list = await api('GET', `/orchestrations/${orch.id}/executions`);
    if (list.length > before && list[0].status && list[0].status !== 'running') return list[0];
  }
  throw new Error(`«${orch.name}» no terminó`);
}

// ── UI helpers ──────────────────────────────────────────────────────────────

// Local paths on screen (the fake claude's location, the temp project folders, the user name) → generic ones
const SANITIZE = [
  [path.join(ROOT, 'bin', 'claude.cmd'), 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd'],
  [path.join(ROOT, 'projects'), 'C:\\dev\\proyectos'],
  [ROOT, 'C:\\dev'],
  [os.homedir(), 'C:\\Users\\dev'],
  [os.userInfo().username, 'dev'],
].flatMap(([from, to]) => [[from, to], [from.replace(/\\/g, '/'), to.replace(/\\/g, '/')]]);

async function sanitize(page) {
  await page.evaluate((pairs) => {
    const fix = (s) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), s);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue) n.nodeValue = fix(n.nodeValue);
    for (const el of document.querySelectorAll('input, textarea')) if (el.value) el.value = fix(el.value);
  }, SANITIZE);
}

async function shot(page, name) {
  if (ONLY.length && !ONLY.includes(name)) return;
  await page.mouse.move(1500, 860);   // no hover tooltips
  await sleep(600);                   // animations and toasts settle
  await sanitize(page);
  const buf = await page.screenshot({ type: 'png' });
  for (const dir of OUT) {
    if (name.startsWith('12-') && dir.includes(path.join('docs', 'web'))) continue;   // the web carousel doesn't use it
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), buf);
  }
  console.log(`  ✓ ${name}`);
}

// Agent editors close with their ✕; other modals with a click outside them
async function closeModal(page) {
  const close = page.locator('.overlay .agent-editor button:has(i.ti-x)').first();   // editors have their own ✕
  if (await close.count()) await close.click();
  else await page.locator('.overlay').first().click({ position: { x: 8, y: 8 } });
  await page.waitForSelector('.overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
}

const nav = (page, label) => page.click(`nav.sidebar button[title="${label}"]`);

async function main() {
  if (!fs.existsSync(path.join(REPO, 'dist', 'renderer', 'index.html'))) {
    throw new Error('Falta dist/renderer: ejecuta antes `npm run build:renderer`');
  }
  console.log('Datos de demostración en', ROOT);
  const { dataDir, projects } = seed(ROOT);
  fs.writeFileSync(DELAY_FILE, '400');
  const backend = startBackend(dataDir);
  try {
    await waitHealth();
    for (const id of ['p-api', 'p-tienda', 'p-ventas', 'p-juego']) await api('POST', `/projects/${id}/sync`);   // app-reservas keeps pending updates
    const { main: mainOrch, audit } = await seedOrchestrations();
    console.log('Ejecutando historial con el claude de demostración…');
    await runToEnd(mainOrch);
    await runToEnd(audit);
    await runToEnd(mainOrch);
    // Those runs already wrote the agents' files: back to the first commit (keeping .agent-hub/, the history)
    // so the captured run changes them again and its steps have a diff
    const git = (...a) => execFileSync('git', a, { cwd: projects.find(p => p.id === 'p-api').path, encoding: 'utf8' }).trim();
    git('reset', '--hard', '-q', git('rev-list', '--max-parents=0', 'HEAD'));
    git('clean', '-fdq', '-e', '.agent-hub');
    await api('POST', '/projects/p-api/sync');   // the reset also took the synced agents

    const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER || 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, locale: 'es-ES' });
    const page = await context.newPage();
    await takeAll(page, { mainOrch });
    await browser.close();
  } finally {
    backend.kill();
  }
}

async function takeAll(page, ctx) {
  // First launch: the wizard
  await page.goto(BASE);
  await page.waitForSelector('nav.sidebar, .wizard, .overlay', { timeout: 15000 });
  await shot(page, '00-wizard');

  await page.evaluate(() => localStorage.setItem('cdm-wizard-done', '1'));
  await page.reload();
  await page.waitForSelector('nav.sidebar');
  await sleep(1500);
  await shot(page, '01-dashboard');

  await nav(page, 'Proyectos');     await sleep(800);  await shot(page, '02-projects');

  // Agents: global catalog, a global agent's editor, a project agent's editor
  await nav(page, 'Agentes');       await sleep(1200); await shot(page, '03-agents');
  await page.locator('.agent-card', { hasText: 'code-reviewer' }).first().click();
  await page.waitForSelector('.agent-editor');
  await shot(page, '04-agents-editor');
  await closeModal(page);
  await page.locator('.tree-node', { hasText: 'api-pedidos' }).first().click();
  await page.locator('.agent-card', { hasText: 'pedidos-domain' }).first().click();
  await page.waitForSelector('.agent-editor');
  await shot(page, '05-project-agent-editor');
  await closeModal(page);

  // Orchestrations: list, DAG editor, a selected connection
  await nav(page, 'Orquestaciones'); await sleep(1000); await shot(page, '06-orchestrations');
  await page.locator('.orch-card', { hasText: 'Refactor' }).click();
  await page.waitForSelector('.orch-node-agent');
  await sleep(800);
  await shot(page, '07-orchestration-editor');
  await page.locator('.orch-conn-dot').nth(1).click({ force: true });   // refactor-expert → test-writer
  await sleep(800);
  await shot(page, '08-orchestration-editor-active');

  // Execution: the pre-run form with the cost estimate, the parallel level running, the result with a step diff
  await page.locator('.orch-editor button:has(i.ti-player-play)').last().click();   // the editor's own Ejecutar
  await page.getByText('Comenzar ejecución').waitFor();
  await sleep(1200);   // estimate request
  await shot(page, '13-execution-estimate');
  fs.writeFileSync(DELAY_FILE, '9000');
  await page.getByText('Comenzar ejecución').click();
  await sleep(13_000); // the root step (9 s) is done, the two parallel agents are running
  await shot(page, '09-execution-panel');
  await page.getByText('Ejecutar de nuevo').waitFor({ timeout: 90_000 });
  fs.writeFileSync(DELAY_FILE, '400');
  const diff = page.locator('summary', { hasText: 'Cambios del paso' }).first();
  await diff.scrollIntoViewIfNeeded();
  await diff.click();
  await page.waitForSelector('.orch-step-diff');
  await shot(page, '14-execution-result');

  // Project chat with its saved conversation
  await nav(page, 'Chat IA');
  await page.selectOption('select.chat-proj-sel', 'p-api');
  await sleep(1200);
  await shot(page, '10-chat');

  await nav(page, 'Ajustes');       await sleep(1500); await shot(page, '11-settings');
}

main().catch(e => { console.error(e); process.exit(1); });
