// MRT trains must stop at EVERY station on their line — including stations added
// after the train first spawned (the bug: a train only halted at the first station
// built, then ran past the rest). Stations are placed and TOPPED OUT through the
// normal construction path (commit → syncConstruction), NOT by re-running
// _buildPlayerRailways, so this catches the stale-stops regression. Also checks the
// viaduct is two-way (a train per direction) and the train is sized to the platform.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  const r = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length, W = 1600;
    const w = (gx, gy) => [(gx / N - 0.5) * W, (0.5 - gy / N) * W];
    const clear = (x, y) => v.isLand(x, y) && !v.isRoadAt(x, y) && !(v.heritageMask && v.heritageMask[y][x]) && !v.state.grid[y][x];
    // find a long clear straight row for the viaduct
    let row = -1, x0 = 0; for (let y = 24; y < N - 24 && row < 0; y++) { let run = 0, sx = 0; for (let x = 24; x < N - 24; x++) { if (clear(x, y)) { if (run === 0) sx = x; run++; if (run >= 46) { row = y; x0 = sx; break; } } else run = 0; } }
    const x1 = x0 + 44, line = []; for (let gx = x0; gx <= x1; gx++) line.push(w(gx, row));
    // draw the MRT line and spawn its trains BEFORE any station exists
    v.state.railways = [{ pts: line, elevated: true, mrt: true }];
    v._buildPlayerRailways(v.state);
    v.state.treasury = 9e9;
    const stopsAtSpawn = ((v._trains || []).find(t => t.track.kind === 'mrt') || { stops: [] }).stops.length;

    // place three stations on the line, topping each out via the construction path
    // (commit then finish), NEVER re-running _buildPlayerRailways / _buildTrains
    const finish = (sx, sy) => { const c = v.state.grid[sy][sx]; if (c && c.build) delete c.build; v.state.constructing = (v.state.constructing || []).filter(([x, y]) => !(x === sx && y === sy)); v.syncConstruction(v.state); };
    for (const sgx of [x0 + 8, x0 + 22, x0 + 36]) {
      S.selectBuilding('mrt'); S.onTileTap(sgx, row + 3);
      if (!S.adjust) continue;
      const sx = S.adjust.x, sy = S.adjust.y; S.commitAdjust(); finish(sx, sy);
    }
    S.selectBuilding(null);

    const mrtTrains = (v._trains || []).filter(t => t.track.kind === 'mrt');
    const stopsNow = mrtTrains.map(t => t.stops.length);
    // total length of a 2-car set (world units): centre-to-centre gap + one car
    const tr = mrtTrains[0];
    const carLen = tr ? tr.carU * tr.total / 1.06 : 0;
    const trainLen = tr ? (tr.cars.length - 1) * tr.carU * tr.total + carLen : 0;
    const laterals = mrtTrains.map(t => t.lateral);
    return { stopsAtSpawn, stopsNow, trains: mrtTrains.length, trainLen, carLen, cars: tr ? tr.cars.length : 0, laterals };
  });

  ok(r.stopsAtSpawn === 0, `no stops before any station is built (${r.stopsAtSpawn})`);
  ok(r.stopsNow.length > 0 && r.stopsNow.every(s => s === 3), `every train halts at all 3 stations, not just the first (${JSON.stringify(r.stopsNow)})`);
  ok(r.trains === 2, `the viaduct is two-way — a train runs each direction (${r.trains} trains)`);
  ok(r.laterals.length === 2 && r.laterals[0] * r.laterals[1] < 0 && Math.abs(r.laterals[0]) > 0.1, `the two trains sit on opposite tracks so they pass (${r.laterals.map(x => +x.toFixed(2))})`);
  ok(r.cars === 2, `an MRT set is a short 2-car metro (${r.cars} cars)`);
  ok(r.trainLen > 1.6 && r.trainLen < 3.2, `the train is sized to the platform (~2.5 units long, was ~8.4) — ${r.trainLen.toFixed(2)}`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
