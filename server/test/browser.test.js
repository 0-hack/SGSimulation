// End-to-end browser test: boots the real client in headless Chrome, plays the
// game (new nation, build, tick time, change policy, cloud save, visit).
import puppeteer from 'puppeteer';
import { app } from '../server.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  ],
});

let page;
try {
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
  const errors = [];
  globalThis.__perr = errors;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base, { waitUntil: 'networkidle0' });
  ok(await page.$('#menu'), 'menu screen renders');

  // Start a new nation
  await page.$eval('#m-nation', (e) => { e.value = ''; }); // clear prefilled text
  await page.type('#m-nation', 'Testlandia');
  await page.type('#m-owner', 'E2E Bot');
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  ok(true, 'new game starts and game screen shows');

  const nation = await page.$eval('#hud-nation', (e) => e.textContent);
  ok(nation === 'Testlandia', 'HUD shows the nation name');

  // 3D scene initialised with a WebGL context.
  const sceneInfo = await page.evaluate(() => {
    const c = document.querySelector('#city');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { hasGL: !!gl, buildings: window.__sgview ? window.__sgview.buildings.size : -1 };
  });
  ok(sceneInfo.hasGL, '3D canvas has a WebGL context');
  ok(sceneInfo.buildings >= 1, `3D scene rendered ${sceneInfo.buildings} seed building(s)`);

  // Open build panel and place a building by tapping the canvas centre.
  await page.click('.tool[data-panel="build"]');
  await page.waitForSelector('.bcard');
  // select first building (kampong/hdb) then place
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.bcard:not(.locked)')];
    cards[1]?.click(); // hdb_flat typically
  });
  await new Promise((r) => setTimeout(r, 200));
  const treasuryBefore = await page.$eval('#hud-treasury', (e) => e.textContent);
  // Find a free land cell, project it to screen, and tap there to build.
  const spot = await page.evaluate(() => {
    const v = window.__sgview;
    for (let y = 7; y <= 14; y++) for (let x = 6; x <= 16; x++) {
      if (v.isLand(x, y) && !v.state.grid[y][x]) { const s = v.cellToScreen(x, y); return { x, y, sx: s.x, sy: s.y }; }
    }
    return null;
  });
  await page.mouse.click(spot.sx, spot.sy);
  await new Promise((r) => setTimeout(r, 200));
  const treasuryAfter = await page.$eval('#hud-treasury', (e) => e.textContent);
  ok(treasuryBefore !== treasuryAfter, `building placed (treasury ${treasuryBefore} → ${treasuryAfter})`);

  // The placed building appears as an animated mesh in the 3D scene.
  const builtCount = await page.evaluate(() => window.__sgview.buildings.size);
  ok(builtCount >= 2, `3D scene now has ${builtCount} building meshes`);

  // A disaster animation runs without throwing.
  await page.evaluate(() => window.__sgview.playDisaster('flood'));
  await new Promise((r) => setTimeout(r, 400));
  const floodOk = await page.evaluate(() => !!window.__sgview.disaster || window.__sgview.floodPlane.visible);
  ok(floodOk, 'flood disaster animation triggered');

  // Zooming in to street level spawns animated pedestrians (LOD).
  const peopled = await page.evaluate(async () => {
    const v = window.__sgview;
    v.cam.radius = 50;                      // street-level zoom
    await new Promise((r) => setTimeout(r, 500));
    return { on: v.peopleOn, count: v.people.length };
  });
  ok(peopled.on && peopled.count > 0, `street zoom spawned ${peopled.count} pedestrians`);

  // Day/night clock is advancing.
  const t0 = await page.evaluate(() => window.__sgview.timeOfDay);
  await new Promise((r) => setTimeout(r, 600));
  const t1 = await page.evaluate(() => window.__sgview.timeOfDay);
  ok(t0 !== t1, 'day/night cycle is running');

  // Speed up and let time pass.
  await page.click('.spd[data-spd="3"]');
  const date0 = await page.$eval('#hud-date', (e) => e.textContent);
  await new Promise((r) => setTimeout(r, 1500));
  const date1 = await page.$eval('#hud-date', (e) => e.textContent);
  ok(date0 !== date1, `time advances (${date0} → ${date1})`);

  // A random event modal may have popped during the run — resolve it first.
  const dismissModal = async () => {
    const open = await page.$eval('#event-modal', (e) => !e.classList.contains('hidden')).catch(() => false);
    if (open) { await page.click('#event-actions button'); await new Promise((r) => setTimeout(r, 150)); }
  };
  await page.click('.spd[data-spd="0"]');
  await dismissModal();

  // Change a policy.
  await page.click('.tool[data-panel="policy"]');
  await page.waitForSelector('.opt, .switch');
  await page.evaluate(() => document.querySelector('.opt:not(.active), .switch')?.click());
  await new Promise((r) => setTimeout(r, 150));
  ok(true, 'policy panel interactive');

  // Dashboard renders metrics.
  await dismissModal();
  await page.click('.tool[data-panel="dash"]');
  await page.waitForSelector('.metric', { timeout: 8000 });
  const metrics = await page.$$eval('.metric', (els) => els.length);
  ok(metrics >= 8, `dashboard shows ${metrics} metrics`);

  // Cloud save.
  await page.click('.tool[data-panel="cloud"]');
  await page.waitForSelector('.cloud-info');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Save to Cloud/.test(b.textContent))?.click());
  await page.waitForFunction(() => /\/world\//.test(document.querySelector('.share-row input')?.value || ''), { timeout: 5000 });
  const shareLink = await page.$eval('.share-row input', (e) => e.value);
  ok(/\/world\/[\w-]+/.test(shareLink), 'cloud save returns a shareable link');

  // Visit browser lists the saved world.
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Visit Other Nations/.test(b.textContent))?.click());
  await page.waitForSelector('.world-card', { timeout: 5000 });
  const worldCards = await page.$$eval('.world-card', (els) => els.length);
  ok(worldCards >= 1, `world browser lists ${worldCards} nation(s)`);

  ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  fail++;
  console.error('  ✗ browser test threw:', err.message);
  try {
    const pg = page;
    console.error('     title:', await pg.$eval('#sheet-title', (e) => e.textContent).catch(() => 'n/a'));
    console.error('     modalOpen:', await pg.$eval('#event-modal', (e) => !e.classList.contains('hidden')).catch(() => 'n/a'));
    console.error('     sheetHidden:', await pg.$eval('#sheet', (e) => e.classList.contains('hidden')).catch(() => 'n/a'));
    console.error('     content head:', await pg.$eval('#sheet-content', (e) => e.innerHTML.slice(0, 100)).catch(() => 'n/a'));
    console.error('     pageErrors:', globalThis.__perr || []);
  } catch {}
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
