// Plants, surface painting, slope foundations + the new buildings all working in
// the live 3D scene without errors.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 520, height: 880, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  // ---- PLANTS: place, render, remove --------------------------------------
  const pl = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const c = v.worldOfCell(Math.round(N * 0.46), Math.round(N * 0.46));
    const before = v.plantGroup ? v.plantGroup.children.length : 0;
    v.addPlant(c.x, c.z, 'rain_tree', 0.3, 1); v.addPlant(c.x + 3, c.z, 'palm', 0, 1); v.addPlant(c.x, c.z + 3, 'orchid', 0, 1);
    const planted = v.state.plants.length === 3 && v.plantGroup.children.length === before + 3;
    const removed = v.removePlantNear(c.x + 3, c.z, 1.0) && v.state.plants.length === 2;
    return { planted, removed };
  });
  ok(pl.planted, 'individual plants are placed and rendered (3 specimens)');
  ok(pl.removed, 'tapping a plant removes it (and only it)');

  // ---- SURFACE PAINT: paint, render, clear --------------------------------
  const sf = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const x = Math.round(N * 0.5), y = Math.round(N * 0.5);
    v.paintSurfaceCell(x, y, 'concrete'); v.paintSurfaceCell(x + 1, y, 'plaza');
    const painted = v.state.surfaces[`${x},${y}`] === 'concrete' && v.surfaceTiles.has(`${x},${y}`) && v.surfaceTiles.size === 2;
    v.paintSurfaceCell(x, y, 'clear');
    const cleared = !v.state.surfaces[`${x},${y}`] && !v.surfaceTiles.has(`${x},${y}`);
    return { painted, cleared };
  });
  ok(sf.painted, 'painting a surface stores + renders a ground tile');
  ok(sf.cleared, 'painting "clear" removes the surface override');

  // ---- SLOPE FOUNDATION: find a steep cell, place, toggle cut/lift, commit -
  const fd = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    // hunt for a steep, buildable cell (Bukit Timah / hilly ground)
    let sx = -1, sy = -1, range = 0;
    for (let y = 2; y < N - 2 && sx < 0; y += 3) for (let x = 2; x < N - 2; x += 3) {
      if (!v.isLand(x, y) || v.isRoadAt(x, y) || v.buildings.has(`${x},${y}`) || v.state.grid[y][x]) continue;
      const lv = v.footprintLevels(x, y); if (lv.range > 1.4) { sx = x; sy = y; range = lv.range; break; }
    }
    if (sx < 0) return { found: false };
    S.selectBuilding('hdb_flat');
    S.onTileTap(sx, sy, v.worldOfCell(sx, sy));
    const needsFound = S.adjust && S.adjust.fy != null && S.adjust.fmode === 'cut';   // excavate by default
    const cutY = S.adjust.fy;
    S.toggleFoundation();
    const lifted = S.adjust.fmode === 'lift' && S.adjust.fy > cutY;                   // elevate raises it
    S.commitAdjust();
    const cell = v.state.grid[sy][sx];
    const persisted = cell && typeof cell.fy === 'number' && cell.fmode === 'lift';
    return { found: true, range: +range.toFixed(2), needsFound, lifted, persisted };
  });
  ok(fd.found, `found a steep buildable cell (range ${fd.range})`);
  ok(fd.needsFound, 'a building on uneven ground gets a foundation (excavated by default)');
  ok(fd.lifted, '⛰ Cut / 🏗 Lift toggles between excavate and elevate (elevate raises it)');
  ok(fd.persisted, 'the chosen foundation is saved on the built cell');

  // ---- NEW BUILDINGS render in-scene without error ------------------------
  const nb = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const keys = ['vertical_farm', 'hawker_centre', 'fish_farm', 'data_centre', 'desalination'];
    const y0 = Math.round(N * 0.44); let cx = Math.round(N * 0.40), okAll = true;
    for (const k of keys) { v.state.grid[y0][cx] = { k }; v.onBuilt(cx, y0, k); if (!v.buildings.has(`${cx},${y0}`)) okAll = false; cx += 2; }
    return { okAll };
  });
  ok(nb.okAll, 'the new farm/era buildings build into the scene');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
