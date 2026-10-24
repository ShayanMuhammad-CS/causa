// Records demo video v1 of the REAL app in sample mode (no ?mock=1). Usage: node record-demo.cjs [url]
const { chromium } = require('B:/open-agent-hackathon/tools/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const URL = process.argv[2] || 'http://localhost:5173/';
const OUT = path.resolve(__dirname, '../../docs/video/raw');
const Q1 = "Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?";
const Q2 = "Is Ford's revenue slowdown company-specific or sector-wide?";
const SAMPLE = 'Sample mode: real SEC + World Bank data, local DuckDB stand-in for Zetaris; live Zetaris + Nightshift run in v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  await ctx.addInitScript(() => { try { localStorage.setItem('causa-theme', 'light'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = [
      "#cap{position:fixed;left:0;right:0;bottom:0;z-index:99998;padding:14px 40px 16px;background:rgba(10,14,25,.90);color:#fff;font:600 25px/1.3 'IBM Plex Sans',system-ui,sans-serif;text-align:center;display:none;border-top:3px solid #5b8cff}",
      "#cap small{display:block;margin-top:5px;font:500 15px/1.2 system-ui,sans-serif;color:#ffd479}",
      "#card{position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#0b1020,#1b2a55);color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:'IBM Plex Sans',system-ui,sans-serif;padding:60px}",
      "#card h1{font:700 58px/1.15 Newsreader,Georgia,serif;margin:0 0 22px}#card p{font-size:27px;margin:8px 0;color:#d6e0ff}#card .f{font-size:20px;color:#ffd479;margin-top:30px;max-width:900px}",
      "body{padding-bottom:130px}"].join('\n');
    document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'cap'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'card'; document.body.appendChild(k);
    window.__cap = (t, sub) => { const e = document.getElementById('cap'); if (!t) { e.style.display = 'none'; return; } e.innerHTML = t + (sub ? '<small>' + sub + '</small>' : ''); e.style.display = 'block'; };
    window.__card = html => { const e = document.getElementById('card'); e.innerHTML = html || ''; e.style.display = html ? 'flex' : 'none'; };
  });
  const cap = (t, sub) => page.evaluate(([t, sub]) => window.__cap(t, sub), [t, sub]);
  const card = h => page.evaluate(h => window.__card(h), h);
  const show = async (sel, block = 'start', n = 0) => { const l = page.locator(sel).nth(n); if (await l.count()) await l.evaluate((e, b) => e.scrollIntoView({ behavior: 'smooth', block: b }), block); };
  const say = async (t, ms, sel, sub, block) => { await cap(t, sub); if (sel) await show(sel, block); await sleep(ms); };

  // a. title
  await card('<h1>Causa — answers you can check</h1><p>Track 02 · The Agent That Can Explain Why</p><p>Team MARS</p><div class="f">Sample mode: real SEC + World Bank data, local DuckDB stand-in for Zetaris</div>');
  await sleep(6000); await card('');
  // b. problem
  await say('THE PROBLEM: an analyst is asked "why did sales lag?" The proof is scattered across filings, industry codes and macro data. The answer ends up as a slide nobody can check.', 7000, null, SAMPLE);
  await say('THE FIX: Causa answers "why" and shows its work, so you can check it. Let us ask a real question.', 4500, null, SAMPLE);
  // c. ask
  await cap('');
  const ta = page.locator('#q'); await ta.click();
  await ta.pressSequentially(Q1, { delay: 70 });
  await sleep(1200);
  await page.getByRole('button', { name: 'Investigate' }).click();
  await sleep(1500);
  // d.
  await say('Step 1: a safety contract. Scout Intent checks the request is safe and sets the tools and budget (read-only).', 5500, 'section[aria-label="Execution contract"]', SAMPLE, 'center');
  await page.waitForSelector('.st-pill.st-done', { timeout: 180000 });
  await sleep(500);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await sleep(900);
  await say('Step 2: real companies only. World Model matches Target and Walmart to real SEC IDs. Unknown names are refused, not invented.', 5500, 'section[aria-label="Grounded entities"]', SAMPLE, 'center');
  await say('Step 3: memory. H-MEM reuses earlier verified findings when relevant. This first question starts cold.', 5000, 'section[aria-label="Recalled memories"]', SAMPLE, 'center');
  await say('Step 4: competing explanations. Company-specific, sector-wide or macro? Each is tested and gets a verdict.', 5500, 'h2:has-text("Competing hypotheses")', SAMPLE, 'start');
  await say('Markovian keeps the agent working context small: far fewer tokens than a naive growing transcript.', 5500, '.markov', SAMPLE, 'center');
  await say('Step 5: proof. Every test is a read-only SQL query, with its result rows and data source.', 3500, 'article.ecard', SAMPLE, 'start');
  await page.locator('article.ecard').first().hover().catch(() => {});
  await page.evaluate(() => window.scrollBy({ top: 260, behavior: 'smooth' })); await sleep(3500);
  await say('Step 6: the answer. Ranked causes, a confidence level, and "verified by critic" on each claim.', 5500, 'h2:has-text("Answer")', SAMPLE, 'start');
  await cap('Click any citation and it jumps to the exact query and rows behind the claim.', SAMPLE);
  const chip = page.locator('.cites .cite').first();
  if (await chip.count()) { await chip.hover(); await sleep(1200); await chip.click(); }
  await sleep(5000);
  await say('Evidence graph: each claim traced back to its evidence and source table.', 5000, 'h2:has-text("Evidence graph")', SAMPLE, 'start');
  await say('AI provider log: this run shows provider "sample". In live mode every call shows its Nemotron model via Meterless Nightshift.', 6500, 'section[aria-label="AI provider log"]', SAMPLE, 'center');
  await say('Verified findings are remembered with provenance. The audit drawer shows who wrote what, and why.', 4000, 'section[aria-label="Remembered"]', SAMPLE, 'center');
  const aud = page.locator('section[aria-label="Remembered"] button.link').first();
  if (await aud.count()) {
    await aud.click(); await sleep(5500); await page.keyboard.press('Escape'); await sleep(800);
    const close = page.getByRole('button', { name: /close/i }); if (await close.count()) await close.first().click().catch(() => {});
  }
  // e. second question
  await cap('A second, different question, to show it is not hardcoded.', SAMPLE);
  await page.locator('button.brand').click(); await sleep(1500);
  await ta.click(); await ta.pressSequentially(Q2, { delay: 60 }); await sleep(900);
  await page.getByRole('button', { name: 'Investigate' }).click();
  await page.waitForSelector('.st-pill.st-done', { timeout: 180000 });
  await page.evaluate(() => window.scrollTo({ top: 0 })); await sleep(800);
  await say('Ford: tested on real data. This time the evidence supports "sector-wide", not "company-specific".', 6000, 'h2:has-text("Competing hypotheses")', SAMPLE, 'start');
  await say('Same format: ranked claims, confidence, citations.', 5500, 'h2:has-text("Answer")', SAMPLE, 'start');
  // f. architecture
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await say('Built on: Zetaris data layer · Meterless (Nightshift, H-MEM, World Model, Markovian, Scout Intent) · NVIDIA Nemotron', 6500, null, SAMPLE);
  await cap('');
  // g. end
  await card('<h1>Causa — answers you can check</h1><p>github.com/ShayanMuhammad-CS/causa</p><div class="f">v1 — sample mode; v2 adds the live Zetaris + Nightshift run</div>');
  await sleep(6000);
  const vid = page.video(); await ctx.close(); await browser.close();
  fs.copyFileSync(await vid.path(), path.resolve(__dirname, '../../docs/video/raw.webm'));
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
