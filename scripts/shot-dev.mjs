import { chromium } from 'playwright-core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOT_DIR = resolve(ROOT, 'scripts', 'screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

// Conectar al Edge real con remote debugging
const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context  = contexts[0];
const pages    = context.pages();
const page     = pages[0];

console.log('Conectado a:', page.url());

await page.screenshot({ path: resolve(SHOT_DIR, '09-project-agent-editor.png') });
console.log('✓ 09-project-agent-editor.png');

await browser.close();
