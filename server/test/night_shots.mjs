// Verify: notifications top-left/transparent, small island trees, and a night
// scene where bodies darken while only lit windows glow.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const dir = process.env.SHOT_DIR || '/tmp';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 900, deviceScaleFactor: 2 });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await sleep(500);

  // place a few buildings so there are lit windows at night
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.bcard');
  await p.evaluate(() => { const c = [...document.querySelectorAll('.bcard:not(.locked)')]; (c[1] || c[0])?.click(); });
  await sleep(150);
  await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length, c = Math.floor(N / 2);
    const spots = [];
    for (let r = 0; r < N && spots.length < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = c + dx, y = c + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (v.isLand(x, y) && !v.state.grid[y][x] && !(v.isRoadAt && v.isRoadAt(x, y))) { const s = v.cellToScreen(x, y); if (s.visible) spots.push(s); }
    }
    window.__spots = spots;
  });
  const spots = await p.evaluate(() => window.__spots);
  for (const s of spots.slice(0, 5)) { await p.mouse.click(s.x, s.y); await sleep(60); }
  await p.keyboard.press('Escape'); await sleep(100);

  // a notification, captured top-left
  await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))); // no-op
  await p.evaluate(() => { const t = document.getElementById('toast'); t.textContent = 'Road — construction started ($24M).'; t.classList.remove('hidden'); });
  // frame the city, daytime
  await p.evaluate(() => { const v = window.__sgview; v.cam.phi = 0.7; v.cam.radius = Math.min(v.MAX_R, v.land.length * 6); v.gameDays = 0.36 * 16; v.render(); v.render(); });
  await sleep(150);
  await p.screenshot({ path: `${dir}/notify_day.png` });
  console.log('saved notify_day.png');

  // NIGHT: push the clock to midnight and render
  const dn = await p.evaluate(() => { const v = window.__sgview; v.gameDays = 16 * 0.0; v._updateDayNight(); v.render(); v.render(); return { timeOfDay: v.timeOfDay, nightFactor: v.nightFactor }; });
  console.log('night state:', JSON.stringify(dn));
  await p.evaluate(() => { const t = document.getElementById('toast'); t.textContent = 'Night has fallen.'; t.classList.remove('hidden'); });
  await sleep(150);
  await p.screenshot({ path: `${dir}/night.png` });
  console.log('saved night.png');
} catch (e) { console.error('night_shots failed:', e); process.exitCode = 1; }
finally { await browser.close(); server.close(); }
