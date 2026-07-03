// Analytical check that auto-bridging works: build a player road across the KTM rail
// and another from land out into the sea, then read the sampled edge's height profile
// and confirm the crossing span is lifted onto a deck while the approaches sit on the
// ground. Also confirms a bridge flares to merge with a wider connecting road.
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
    const { WORLD_SIZE } = await import('/js/data.js');
    const v = window.__sgview, N = v.land.length, W = WORLD_SIZE;
    const cw = (gx, gy) => ({ x: (gx + 0.5) / N * W - W / 2, z: W / 2 - (gy + 0.5) / N * W });
    const lift = (pts) => { let mx = 0; for (const q of pts) mx = Math.max(mx, q.y - v._roadY(q.x, q.z)); return mx; };
    const endLift = (pts) => Math.max(pts[0].y - v._roadY(pts[0].x, pts[0].z), pts[pts.length - 1].y - v._roadY(pts[pts.length - 1].x, pts[pts.length - 1].z));

    // 1) RAIL crossing: an interior rail cell with land all around, crossed on its thin axis
    let rail = null;
    const landAround = (gx, gy) => { for (let oy = -6; oy <= 6; oy++) for (let ox = -6; ox <= 6; ox++) if (!v.land[gy + oy]?.[gx + ox]) return false; return true; };
    for (let gy = 8; gy < N - 8 && !rail; gy++) for (let gx = 8; gx < N - 8; gx++) if (v._railMask?.[gy]?.[gx] && landAround(gx, gy)) { rail = { gx, gy }; break; }
    let railRes = null;
    if (rail) {
      const span = (dx, dy) => { let n = 0; for (let k = 1; k < 40; k++) { if (v._railMask?.[rail.gy + dy * k]?.[rail.gx + dx * k]) n++; else break; } return n; };
      const wx = span(1, 0) + span(-1, 0), wz = span(0, 1) + span(0, -1);
      const ax = wx <= wz ? 1 : 0, az = wx <= wz ? 0 : 1, c = cw(rail.gx, rail.gy);
      const poly = []; for (let t = -34; t <= 34; t += 3) poly.push({ x: c.x + ax * t, z: c.z + az * t });
      const e = { a: 0, b: 0, ctrl: null, poly, type: 'road', lanes: 2, elevated: false };
      const pts = v._sampleEdge(v.state.roads, e);
      railRes = { maxLift: lift(pts), endLift: endLift(pts) };
    }

    // 2) SEA crossing: a coastal land cell whose neighbour a few cells out is open sea
    const isSea = (gx, gy) => !(v.land[gy]?.[gx]) && !(v.reclaimedMask?.[gy]?.[gx]);
    let coast = null;
    for (let gy = 8; gy < N - 12 && !coast; gy++) for (let gx = 8; gx < N - 8; gx++) if (v.land[gy]?.[gx] && isSea(gx, gy + 8) && isSea(gx, gy + 10)) { coast = { gx, gy }; break; }
    let seaRes = null;
    if (coast) {
      const a = cw(coast.gx, coast.gy - 2), b = cw(coast.gx, coast.gy + 12);
      const poly = []; for (let t = 0; t <= 1.0001; t += 0.05) poly.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      const e = { a: 0, b: 0, ctrl: null, poly, type: 'road', lanes: 2, elevated: false };
      const pts = v._sampleEdge(v.state.roads, e);
      // height at the far (sea) end
      const far = pts[pts.length - 1];
      seaRes = { maxLift: lift(pts), farAbsY: far.y, seaY: -1.2 };
    }
    return { hasRail: !!rail, railRes, hasCoast: !!coast, seaRes };
  });

  ok(r.hasRail, 'found an interior rail cell to cross');
  ok(r.railRes && r.railRes.maxLift > 2.0, `road over the rail is lifted onto a deck (max lift ${r.railRes?.maxLift.toFixed(2)}m)`);
  ok(r.railRes && r.railRes.endLift < 0.6, `the rail-bridge approaches ramp back down to the ground (end lift ${r.railRes?.endLift.toFixed(2)}m)`);
  ok(r.hasCoast, 'found a coastline to bridge into the sea');
  ok(r.seaRes && r.seaRes.maxLift > 1.0, `road over the sea is lifted onto a causeway deck (max lift ${r.seaRes?.maxLift.toFixed(2)}m)`);
  ok(r.seaRes && r.seaRes.farAbsY > r.seaRes.seaY + 1.0, `the sea span sits above the water surface (deck y ${r.seaRes?.farAbsY.toFixed(2)} > sea ${r.seaRes?.seaY})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
