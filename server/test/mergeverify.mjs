// Verify the smooth-merge: an elevated (bridge) narrow road that joins a wide
// expressway at a shared node flares its deck toward the expressway's width near the
// junction, instead of butting a thin ribbon against a wide one. Measured on the
// rendered road mesh: the bridge's half-width near the junction must exceed its own
// nominal half-width and approach the expressway's.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  const r = await p.evaluate(async () => {
    const { ROAD_TYPES } = await import('/js/data.js');
    const v = window.__sgview;
    const narrowHW = ROAD_TYPES.road.renderHW, wideHW = ROAD_TYPES.expressway.renderHW;
    // fresh graph: A—B narrow BRIDGE (elevated), B—C wide expressway, colinear on z=0
    const A = { x: -40, z: 0, y: 0 }, B = { x: 0, z: 0, y: 0 }, C = { x: 40, z: 0, y: 0 };
    const polyAB = []; for (let x = -40; x <= 0.001; x += 2) polyAB.push({ x, z: 0 });
    const polyBC = []; for (let x = 0; x <= 40.001; x += 2) polyBC.push({ x, z: 0 });
    v.state.roads = { nodes: [A, B, C], islands: [], edges: [
      { a: 0, b: 1, ctrl: null, poly: polyAB, type: 'road', lanes: 2, elevated: true },
      { a: 1, b: 2, ctrl: null, poly: polyBC, type: 'expressway', lanes: 4, elevated: false },
    ] };
    v.rebuildRoadNet();
    // gather every road-ribbon vertex, bucket by x, track max |z| (perpendicular half-width)
    const halfAt = (xLo, xHi) => {
      let mx = 0;
      v.roadGroup.traverse((o) => {
        const pos = o.geometry?.attributes?.position; if (!pos) return;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); if (x >= xLo && x <= xHi) mx = Math.max(mx, Math.abs(z)); }
      });
      return mx;
    };
    return {
      narrowHW, wideHW,
      farFromJunction: halfAt(-38, -30),   // deep on the bridge, away from the merge
      nearJunction: halfAt(-6, -1),        // the bridge end that meets the expressway
    };
  });
  ok(Math.abs(r.farFromJunction - r.narrowHW) < 0.12, `the bridge keeps its own width away from the junction (${r.farFromJunction.toFixed(2)} ≈ ${r.narrowHW})`);
  ok(r.nearJunction > r.narrowHW + 0.08, `the bridge flares wider as it meets the expressway (${r.nearJunction.toFixed(2)} > ${r.narrowHW})`);
  ok(r.nearJunction <= r.wideHW + 0.05, `the flare merges up to the expressway's width, no wider (${r.nearJunction.toFixed(2)} ≲ ${r.wideHW})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
