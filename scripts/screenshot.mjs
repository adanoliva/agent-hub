import { _electron as electron } from 'playwright-core';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = resolve(ROOT, 'scripts', 'screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_BIN = resolve(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

console.log('Lanzando Agent Hub…');
const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 60_000,
});

await new Promise(r => setTimeout(r, 8000));

const page = app.windows().find(w => !w.url().startsWith('devtools://'))
  ?? await app.firstWindow();

console.log('Ventanas:', app.windows().map(w => w.url()));

async function shot(name) {
  const f = resolve(SHOT_DIR, name + '.png');
  await page.screenshot({ path: f });
  console.log('✓', name);
}

async function wait(ms) { await new Promise(r => setTimeout(r, ms)); }

// Navega haciendo click en el botón del sidebar que contiene el icono dado
async function navByIcon(iconClass) {
  await page.evaluate(cls => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.querySelector('.' + cls) || b.querySelector('[class*="' + cls.replace('ti-','') + '"]'));
    if (btn) { btn.click(); return 'ok'; }
    // fallback: buscar en cualquier elemento clickable
    const all = [...document.querySelectorAll('[class*="sidebar"] *, nav *, aside *')];
    const el = all.find(e => e.querySelector?.('.' + cls));
    el?.click();
  }, iconClass);
  await wait(1800);
}

await page.waitForSelector('.statusbar, .sidebar, nav', { timeout: 15000 }).catch(() => {});
await wait(800);

// Verificar qué botones hay en el sidebar
const sidebarInfo = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  return btns.map((b, i) => ({ i, cls: b.className, icons: [...b.querySelectorAll('i')].map(e => e.className) })).slice(0, 10);
});
console.log('Sidebar buttons:', JSON.stringify(sidebarInfo, null, 2));

// ── 1. DASHBOARD ──────────────────────────────────────────────────────────────
await shot('01-dashboard');

// ── 2. PROYECTOS ──────────────────────────────────────────────────────────────
await navByIcon('ti-layout-grid');
await shot('02-projects');

// ── 3. AGENTES ────────────────────────────────────────────────────────────────
await navByIcon('ti-cpu');
await shot('03-agents');

// ── 4. AGENTES — editor abierto ───────────────────────────────────────────────
await page.evaluate(() => {
  const card = document.querySelector('.agent-card');
  card?.click();
});
await wait(1000);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.title?.toLowerCase().includes('edit') || b.querySelector?.('.ti-pencil'));
  btn?.click();
});
await wait(1200);
await shot('04-agents-editor');

await page.keyboard.press('Escape');
await wait(600);

// ── 5. ORQUESTACIONES — lista ─────────────────────────────────────────────────
await navByIcon('ti-topology-ring-2');
await shot('05-orchestrations');

// ── 6. ORQUESTACIONES — editor DAG ───────────────────────────────────────────
await page.evaluate(() => {
  const card = document.querySelector('.orch-card');
  if (card) { card.click(); return; }
  const btn = [...document.querySelectorAll('button')]
    .find(b => b.textContent?.includes('Nueva') || b.textContent?.includes('orquestación'));
  btn?.click();
});
await wait(2500);
await shot('06-orchestration-editor');

// ── 7. CHAT ───────────────────────────────────────────────────────────────────
await navByIcon('ti-message-chatbot');
await shot('07-chat');

// ── 8. SETTINGS ───────────────────────────────────────────────────────────────
await navByIcon('ti-settings');
await shot('08-settings');

console.log('\nCapturas guardadas en:', SHOT_DIR);
await app.close();
