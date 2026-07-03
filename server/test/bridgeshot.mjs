// Ad-hoc screenshot: build player roads that cross the KTM rail and the sea, plus a
// wide road meeting a narrow bridge, and capture the auto-bridge + smooth-merge result.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/bridge';
import { mkdirSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(700);

  const info = await page.evaluate(async () => {
    const { WORLD_SIZE } = await import('/js/data.js');
    const v = window.__sgview, N = v.land.length, W = WORLD_SIZE;
    const TILE = W / N;
    const cw = (gx, gy) => ({ x: (gx + 0.5) / N * W - W / 2, z: W / 2 - (gy + 0.5) / N * W });
    // 1) a rail cell near the middle of the map
    let rail = null;
    for (let gy = Math.round(N * 0.30); gy < Math.round(N * 0.75) && !rail; gy++)
      for (let gx = Math.round(N * 0.30); gx < Math.round(N * 0.70); gx++)
        if (v._railMask?.[gy]?.[gx] && v.land[gy]?.[gx]) { rail = { gx, gy }; break; }   // a rail cell on land
    let railInfo = null;
    if (rail) {
      // find the THIN axis of the rail corridor at this cell → cross along it
      const span = (dx, dy) => { let n = 0; for (let k = 1; k < 40; k++) { const x = rail.gx + dx * k, y = rail.gy + dy * k; if (v._railMask?.[y]?.[x]) n++; else break; } return n; };
      const wx = span(1, 0) + span(-1, 0), wz = span(0, 1) + span(0, -1);
      const c = cw(rail.gx, rail.gy);
      const ax = wx <= wz ? 1 : 0, az = wx <= wz ? 0 : 1;   // cross along the narrower axis
      const len = 34;
      const poly = [];
      for (let t = -len; t <= len; t += 3) poly.push({ x: c.x + ax * t, z: c.z + az * t });
      v.state.roads.edges.push({ a: 0, b: 0, ctrl: null, poly, type: 'road', lanes: 2, elevated: false });
      // a WIDE expressway meeting the same crossing point end-on, to show the smooth merge
      const poly2 = [];
      for (let t = 0; t <= len; t += 3) poly2.push({ x: c.x - ax * 0 + az * t, z: c.z - az * 0 - ax * t });
      railInfo = { c, ax, az };
    }
    // 2) a road running from inland out across the coastline into the sea
    let coast = null;
    const isSea = (gx, gy) => !(v.land[gy]?.[gx]) && !(v.reclaimedMask?.[gy]?.[gx]);
    for (let gy = Math.round(N * 0.55); gy < Math.round(N * 0.85) && !coast; gy++)
      for (let gx = Math.round(N * 0.35); gx < Math.round(N * 0.65); gx++)
        if (v.land[gy]?.[gx] && isSea(gy + 3 <= N ? gy : gy, gx) === false) {
          // land cell whose south neighbours turn to sea within a few cells
          if (isSea(gx, gy + 4) && v.land[gy]?.[gx]) { coast = { gx, gy }; break; }
        }
    if (coast) {
      const a = cw(coast.gx, coast.gy - 6), b = cw(coast.gx, coast.gy + 10);
      const poly = [];
      for (let t = 0; t <= 1.0001; t += 0.06) poly.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      v.state.roads.edges.push({ a: 0, b: 0, ctrl: null, poly, type: 'avenue', lanes: 3, elevated: false });
    }
    v.rebuildRoadNet();
    // count bridge pillars created
    let pillars = 0; v.roadGroup.traverse((o) => { if (o.geometry?.type === 'CylinderGeometry') pillars++; });
    // force a bright clear day so the bridges are legible
    v.weather = { type: 'sunny', cloud: 0.04, rain: 0, wind: 0.2, windDir: 0.6 };
    v._wTarget = { ...v.weather }; v._pickWeather = () => {}; v._updateWeather = () => {};
    v.gameDays = 0.5; v.timeOfDay = 0.45; for (let i = 0; i < 6; i++) v.render();
    return { hasRail: !!rail, rail: railInfo, hasCoast: !!coast, coast: coast && cw(coast.gx, coast.gy), pillars, W, camW: N * 10 };
  });
  console.log('built:', JSON.stringify(info));

  const focus = async (name, cx, cz, theta, phi, radius) => {
    await page.evaluate(({ cx, cz, theta, phi, radius }) => {
      const v = window.__sgview;
      v.target.set(cx, 0, cz);
      v.cam.theta = theta; v.cam.phi = phi; v.cam.radius = Math.min(radius, v.MAX_R);
      document.querySelector('#sheet')?.classList.add('hidden');
      document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
      document.querySelector('#alerts')?.style.setProperty('display', 'none');
      v.render(); v.render();
    }, { cx, cz, theta, phi, radius });
    await sleep(300);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  };
  if (info.rail) { await focus('rail-bridge', info.rail.c.x, info.rail.c.z, -0.7, 0.62, 60); await focus('rail-bridge-2', info.rail.c.x, info.rail.c.z, 1.35, 0.5, 52); }
  if (info.coast) await focus('sea-bridge', info.coast.x, info.coast.z, -0.7, 0.55, 70);
  await focus('overview', 0, 0, -0.7, 0.9, info.camW * 1.05);
} catch (e) { console.error('shots failed:', e); }
finally { await browser.close(); server.close(); }
