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
  // loading overlay should exist and start hidden, appear during New Game, then hide
  const loadStart = await p.evaluate(() => { const el = document.getElementById('loading'); return !!el && el.classList.contains('hidden'); });
  await p.click('#btn-new');
  const loadShown = await p.waitForFunction(() => !document.getElementById('loading').classList.contains('hidden'), { timeout: 5000 }).then(() => true).catch(() => false);
  await p.waitForSelector('#game:not(.hidden)');
  const loadHidden = await p.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 8000 }).then(() => true).catch(() => false);
  ok(loadStart, 'loading overlay exists and starts hidden');
  ok(loadShown, 'clicking New Game shows the loading overlay (so you know it\'s working)');
  ok(loadHidden, 'the overlay clears once the game is ready');

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

  // ---- SLOPE FOUNDATION: elevate by default; excavate actually cuts the hill -
  const fd = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let sx = -1, sy = -1, range = 0;
    for (let y = 2; y < N - 2 && sx < 0; y += 3) for (let x = 2; x < N - 2; x += 3) {
      if (!v.isLand(x, y) || v.isRoadAt(x, y) || v.buildings.has(`${x},${y}`) || v.state.grid[y][x]) continue;
      const lv = v.footprintLevels(x, y); if (lv.range > 0.9) { sx = x; sy = y; range = lv.range; break; }
    }
    if (sx < 0) return { found: false };
    const c = v.worldOfCell(sx, sy), origH = v._heightAt(c.x, c.z);
    S.selectBuilding('hdb_flat');
    S.onTileTap(sx, sy, c);
    const defLift = S.adjust && S.adjust.fmode === 'lift' && S.adjust.fy != null;     // ELEVATE by default
    S.toggleFoundation();                                                              // -> EXCAVATE
    const cutFloor = S.adjust.fy, nowCut = S.adjust.fmode === 'cut';
    const carved = Math.abs(v._heightAt(c.x, c.z) - cutFloor) < 0.5 && cutFloor < origH - 0.2;  // hill cut to the floor
    S.commitAdjust();
    const cell = v.state.grid[sy][sx];
    const persisted = cell && cell.fmode === 'cut' && typeof cell.fy === 'number';
    const stillCut = v._heightAt(c.x, c.z) < origH - 0.2;                             // carve survives commit
    return { found: true, range: +range.toFixed(2), defLift, nowCut, carved, persisted, stillCut };
  });
  ok(fd.found, `found a steep buildable cell (range ${fd.range})`);
  ok(fd.defLift, 'a building on uneven ground is ELEVATED on a platform by default (fully visible)');
  ok(fd.nowCut && fd.carved, '⛰ Excavate actually cuts the slope open (terrain lowered to the building floor)');
  ok(fd.persisted && fd.stillCut, 'the excavation is saved and the cut persists');

  // ---- NEW BUILDINGS render in-scene without error ------------------------
  const nb = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const keys = ['vertical_farm', 'hawker_centre', 'fish_farm', 'data_centre', 'desalination'];
    const y0 = Math.round(N * 0.44); let cx = Math.round(N * 0.40), okAll = true;
    for (const k of keys) { v.state.grid[y0][cx] = { k }; v.onBuilt(cx, y0, k); if (!v.buildings.has(`${cx},${y0}`)) okAll = false; cx += 2; }
    return { okAll };
  });
  ok(nb.okAll, 'the new farm/era buildings build into the scene');

  // ---- DEMOLISH: hover turns the OBJECT red, multi-select toggles, Done tears down -
  // (1) a placed building: hover tints its real mesh red; tap keeps it red; tap again undoes
  const dmB = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let bx = -1, by = -1;
    for (let y = 4; y < N - 4 && bx < 0; y += 2) for (let x = 4; x < N - 4; x++) {
      if (v.isLand(x, y) && !v.isRoadAt(x, y) && !v.buildings.has(`${x},${y}`) && !v.state.grid[y][x] && !(v.heritageLabelAt && v.heritageLabelAt(x, y))) { bx = x; by = y; break; }
    }
    if (bx < 0) return { found: false };
    v.state.grid[by][bx] = { k: 'hdb_flat' }; v.onBuilt(bx, by, 'hdb_flat');
    const c = v.worldOfCell(bx, by), grp = v.buildings.get(`${bx},${by}`).group;
    const reds = () => { let n = 0; grp.traverse((o) => { if (o.userData && o.userData._origMat) n++; }); return n; };
    S.setBulldoze(true);
    S.onDemolishHover({ x: bx, y: by }, c); const hoverRed = reds() > 0;          // hover alone tints it
    S.onTileTap(bx, by, c); const selected = S.demoSel.size === 1 && reds() > 0;  // tap selects + keeps red
    S.onDemolishHover(null, null); const staysRed = reds() > 0 && S.demoSel.size === 1; // moving away keeps it
    S.onTileTap(bx, by, c); const undone = S.demoSel.size === 0 && reds() === 0;   // tap again undoes + restores
    S.setBulldoze(false);
    return { found: true, hoverRed, selected, staysRed, undone };
  });
  ok(dmB.found && dmB.hoverRed, 'hovering a building in Demolish turns the OBJECT red (not just a tile)');
  ok(dmB.selected && dmB.staysRed, 'tapping keeps it red while you select others (multi-select)');
  ok(dmB.undone, 'tapping a red building again undoes the selection and restores it');

  // (2) a prebuilt heritage shophouse: detectable, tints its model, and Done removes it
  const dmH = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let hx = -1, hy = -1;
    for (let y = 0; y < N && hx < 0; y++) for (let x = 0; x < N; x++) { if (v.heritageLabelAt(x, y)) { hx = x; hy = y; break; } }
    if (hx < 0) return { found: false };
    const c = v.worldOfCell(hx, hy);
    S.setBulldoze(true);
    const t = S.findDemoTarget({ x: hx, y: hy }, c); const isHeritage = !!t && t.kind === 'heritage';
    S.onDemolishHover({ x: hx, y: hy }, c);
    const mesh = v._heritageMeshAt(hx, hy); let red = 0; if (mesh) mesh.traverse((o) => { if (o.userData && o.userData._origMat) red++; });
    S.onTileTap(hx, hy, c); const sel = S.demoSel.size === 1;
    const before = v.heritagePlacements.length;
    S.commitDemolish();
    const removed = v.heritagePlacements.length === before - 1 && !v.heritageLabelAt(hx, hy);
    S.setBulldoze(false);
    return { found: true, isHeritage, red: red > 0, sel, removed };
  });
  ok(dmH.found && dmH.isHeritage, 'a prebuilt shophouse / heritage building is detected by Demolish');
  ok(dmH.red, 'hovering the prebuilt shophouse turns its 3D model red');
  ok(dmH.sel && dmH.removed, 'Done demolishes the prebuilt shophouse (model + cell freed)');

  // (3) an ambient tree: detectable, tints red, Done removes it and the clearing persists
  const dmT = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg;
    let key = null; for (const [k, g] of (v.natureCells || new Map())) { if (g.visible) { key = k; break; } }
    if (!key) return { found: false };
    const [gx, gy] = key.split(',').map(Number), c = v.worldOfCell(gx, gy), grp = v.natureCells.get(key);
    S.setBulldoze(true);
    const t = S.findDemoTarget({ x: gx, y: gy }, c); const isTree = !!t && t.kind === 'tree';
    S.onDemolishHover({ x: gx, y: gy }, c); let red = 0; grp.traverse((o) => { if (o.userData && o.userData._origMat) red++; });
    S.onTileTap(gx, gy, c); const sel = S.demoSel.size === 1;
    S.commitDemolish();
    const gone = grp.visible === false, persisted = !!(v.state.removedTrees && v.state.removedTrees[key]);
    S.setBulldoze(false);
    return { found: true, isTree, red: red > 0, sel, gone, persisted };
  });
  ok(dmT.found && dmT.isTree, 'an ambient tree is detected by Demolish');
  ok(dmT.red, 'hovering a tree turns it red');
  ok(dmT.sel && dmT.gone && dmT.persisted, 'Done removes the tree and the clearing is saved');

  // (4) roads: a freehand DRAG marks the covered portion (any length, not a whole edge) -
  const dmR = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, roads = v.state.roads;
    if (!roads || !roads.edges || !roads.edges.length) return { found: false };
    const lineOf = (e) => { if (e.poly && e.poly.length >= 2) return e.poly.map((q) => ({ x: q.x, z: q.z })); const a = roads.nodes[e.a], b = roads.nodes[e.b]; return (a && b) ? [{ x: a.x, z: a.z }, { x: b.x, z: b.z }] : []; };
    let line = null;
    for (const e of roads.edges) { if (e.demolish) continue; const l = lineOf(e); if (l.length >= 2 && Math.hypot(l[l.length - 1].x - l[0].x, l[l.length - 1].z - l[0].z) > 12) { line = l; break; } }
    if (!line) return { found: false };
    let stroke;
    if (line.length >= 4) { const m = Math.floor(line.length / 2); stroke = [line[m - 1], line[m], line[m + 1]].map((q) => ({ x: q.x, z: q.z })); }
    else { const A = line[0], B = line[1], lp = (t) => ({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t }); stroke = [lp(0.4), lp(0.5), lp(0.6)]; }
    S.setBulldoze(true);
    const before = roads.edges.length;
    S.onDemolishStroke(stroke);
    const marked = !!S.demoCuts && S.demoCuts.length === 1 && S.demoCuts[0].polys.length >= 1;
    S.commitDemolish();
    const split = roads.edges.length > before;                 // the edge was cut into pieces
    const queued = roads.edges.some((e) => e && e.demolish);    // only the covered piece is torn down
    S.setBulldoze(false);
    return { found: true, marked, split, queued };
  });
  ok(dmR.found && dmR.marked, 'dragging along a road freely marks the covered portion (red)');
  ok(dmR.split && dmR.queued, 'Done splits the road and tears down ONLY the dragged portion (not a fixed length)');

  // ---- RECLAIM menu is reachable + renders (category tabs wrap, not off-screen)
  const rc = await p.evaluate(() => {
    document.querySelector('.tool[data-panel="build"]').click();
    const tab = [...document.querySelectorAll('.cat-tab')].find(t => /Reclaim/.test(t.textContent));
    if (!tab) return { tab: false };
    const tabs = document.querySelector('.cat-tabs');
    const wraps = getComputedStyle(tabs).flexWrap === 'wrap';
    const onScreen = tab.getBoundingClientRect().right <= window.innerWidth + 1;   // visible without horizontal scroll
    tab.click();
    const hasReclaimBtn = [...document.querySelectorAll('#sheet-content button')].some(b => /reclaim/i.test(b.textContent));
    const hasSurface = !!document.querySelector('#sheet-content .surface-grid');
    return { tab: true, wraps, onScreen, hasReclaimBtn, hasSurface };
  });
  ok(rc.tab && rc.wraps, 'the category tabs wrap so every tab (incl. Reclaim) is reachable');
  ok(rc.onScreen, 'the Reclaim tab is on-screen (no hidden horizontal scroll)');
  ok(rc.hasReclaimBtn && rc.hasSurface, 'the Reclaim/Land menu renders (reclaim button + surface-paint palette)');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
