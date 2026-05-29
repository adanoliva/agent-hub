const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const shotDir = path.join(os.tmpdir(), 'wizard-shots');
fs.mkdirSync(shotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  // Intercept API calls so app doesn't crash without a backend
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/config')) return route.fulfill({ json: { version: '1.9.1', aiProvider: 'cli', apiKey: '', githubToken: '', githubModel: 'gpt-4o-mini', theme: 'dark', closeAction: 'ask', agentsDirectoryEnabled: true, agentsDirectoryUrl: '', categories: [], projects: [] } });
    if (url.includes('/projects')) return route.fulfill({ json: [] });
    if (url.includes('/detect-cli')) return route.fulfill({ json: { found: false } });
    return route.fulfill({ json: {} });
  });

  await page.goto('http://localhost:5173');
  // Clear wizard done flag so wizard shows
  await page.evaluate(() => localStorage.removeItem('cdm-wizard-done'));
  await page.reload();
  await page.waitForTimeout(2500);

  // Check wizard is visible
  const wizVisible = await page.locator('.wiz-overlay').isVisible().catch(() => false);
  console.log('Wizard visible:', wizVisible);

  await page.screenshot({ path: path.join(shotDir, 'slide0.png'), fullPage: false });
  console.log('Slide 0 saved');

  for (let i = 1; i <= 3; i++) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(b => /Siguiente|Comenzar/.test(b.textContent || ''));
      if (b) { b.click(); return true; }
      return false;
    });
    console.log(`  clicked next (${i-1}→${i}):`, clicked);
    await page.waitForTimeout(i === 3 ? 1800 : 700);
    await page.screenshot({ path: path.join(shotDir, `slide${i}.png`) });
    console.log(`Slide ${i} saved`);
  }

  await browser.close();
  console.log('Done. Screenshots in:', shotDir);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
