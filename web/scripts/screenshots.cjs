// Usage: node scripts/screenshots.cjs  (dev server must run on :5173). Uses mock mode.
const { chromium } = require('B:/open-agent-hackathon/tools/node_modules/playwright');
const path = require('path');
const out = path.resolve(__dirname, '../../docs/screens');
require('fs').mkdirSync(out, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(t => localStorage.setItem('causa-theme', t), theme);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    await page.goto(`${BASE}/?mock=1`);
    await page.waitForSelector('textarea');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${theme}-1-ask.png` });
    await page.click('.suggest button >> nth=0');
    await page.click('button[type=submit]');
    await page.waitForTimeout(11500);
    await page.screenshot({ path: `${out}/${theme}-2-mid.png` });
    await page.waitForSelector('.answer', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${theme}-3-final.png`, fullPage: true });
    await page.click('.mem-foot .link >> nth=0');
    await page.waitForSelector('.ledger');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${theme}-4-audit.png` });
    await ctx.close();
  }
  // mobile check
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mock=1&speed=4`);
  await page.click('.suggest button >> nth=1');
  await page.click('button[type=submit]');
  await page.waitForSelector('.answer', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/mobile-final.png`, fullPage: true });
  console.log('hscroll', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await browser.close();
})();
