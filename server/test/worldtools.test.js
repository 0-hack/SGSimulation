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

  // ---- SURFACE PAINT sits on the RENDERED hill mesh (no green poking through) -----
  const sd = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    let sx = -1, sy = -1, best = 0;     // pick the STEEPEST cell to stress the draping
    for (let y = 2; y < N - 2; y += 2) for (let x = 2; x < N - 2; x++) {
      if (!v.isLand(x, y) || v.isRoadAt(x, y)) continue;
      const lv = v.footprintLevels ? v.footprintLevels(x, y) : null;
      if (lv && lv.range > best && lv.range < 6) { best = lv.range; sx = x; sy = y; }
    }
    if (sx < 0) return { found: false };
    v.paintSurfaceCell(sx, sy, 'concrete');
    const m = v.surfaceTiles.get(`${sx},${sy}`), pos = m.geometry.attributes.position, idx = m.geometry.index;
    let minY = Infinity, maxY = -Infinity, vErr = 0;
    for (let i = 0; i < pos.count; i++) {
      const wx = m.position.x + pos.getX(i), wz = m.position.z + pos.getZ(i), wy = m.position.y + pos.getY(i);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      vErr = Math.max(vErr, Math.abs(wy - (v._meshTriY(wx, wz) + 0.08)));   // vertices ON the triangle mesh
    }
    const draped = (maxY - minY) > 0.2, exact = vErr < 0.002;
    // INTERIOR check: at every surface triangle's centre the paint must stay AT/ABOVE
    // the terrain triangle — i.e. the green hill never protrudes through it.
    let poke = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 + m.position.x;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 + m.position.z;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 + m.position.y;
      poke = Math.max(poke, v._meshTriY(cx, cz) - cy);     // > 0 means terrain rises above the paint
    }
    const noPoke = poke < 0.05;
    v.paintSurfaceCell(sx, sy, 'clear');
    return { found: true, range: +best.toFixed(2), draped, exact, poke: +poke.toFixed(3), noPoke };
  });
  ok(sd.found && sd.draped && sd.exact, `painted surface sits exactly on the rendered hill mesh (steep range ${sd.range})`);
  ok(sd.noPoke, `the terrain never pokes through the paint, even on the steepest cell (max protrusion ${sd.poke})`);

  // ---- PAINT CURSOR: a brush ring shows the footprint; hidden when the tool ends -
  const pc = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    v.setPaintMode(true, () => {}, 2);
    const c = v.worldOfCell(Math.round(N * 0.5), Math.round(N * 0.5));
    v._updatePaintBrush({ x: c.x, z: c.z }, v.paintRadius);
    const shown = !!(v._paintBrush && v._paintBrush.visible) && v.paintRadius === 2;
    const ringPts = v._paintBrush.geometry.attributes.position.count;
    v.setPaintMode(false);
    const hiddenAfter = !!v._paintBrush && v._paintBrush.visible === false;
    return { shown, ringPts, hiddenAfter };
  });
  ok(pc.shown && pc.ringPts > 12, 'the paint brush ring shows the cursor footprint (so you can see which cells you\'ll paint)');
  ok(pc.hiddenAfter, 'leaving the paint tool hides the brush cursor');

  // ---- TREES sit on the actual ground under each one (not floating on a slope) ----
  const tr = await p.evaluate(() => {
    const v = window.__sgview; let maxErr = 0, maxSpread = 0, n = 0;
    for (const [key, g] of (v.natureCells || new Map())) {
      const trees = g.userData && g.userData.trees; if (!trees) continue;
      const [x, y] = key.split(',').map(Number); const c = v.worldOfCell(x, y);
      const ys = [];
      for (const t of trees) { const wy = g.position.y + t.node.position.y; maxErr = Math.max(maxErr, Math.abs(wy - v._meshTriY(c.x + t.dx, c.z + t.dz))); ys.push(wy); }
      if (ys.length > 1) maxSpread = Math.max(maxSpread, Math.max(...ys) - Math.min(...ys));
      if (++n > 4000) break;
    }
    return { n, maxErr: +maxErr.toFixed(3), maxSpread: +maxSpread.toFixed(2) };
  });
  ok(tr.n > 0 && tr.maxErr < 0.05, `every ambient tree sits on the ground beneath it (max gap ${tr.maxErr} over ${tr.n} clumps)`);
  ok(tr.maxSpread > 0.3, `clumps on slopes spread their trees down the contour (max in-clump height spread ${tr.maxSpread})`);

  // ---- DEMOLITION raises a wrecking scaffold so a slow teardown READS as one ------
  const ds = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let bx = -1, by = -1;
    for (let y = 4; y < N - 4 && bx < 0; y += 2) for (let x = 4; x < N - 4; x++) {
      if (v.isLand(x, y) && !v.isRoadAt(x, y) && !v.buildings.has(`${x},${y}`) && !v.state.grid[y][x] && !(v.heritageLabelAt && v.heritageLabelAt(x, y))) { bx = x; by = y; break; }
    }
    if (bx < 0) return { found: false };
    v.state.grid[by][bx] = { k: 'hdb_flat' }; v._addMesh(bx, by, 'hdb_flat', false);
    const id = `${bx},${by}`;
    S.setBulldoze(true);
    S.onTileTap(bx, by, v.worldOfCell(bx, by));
    S.commitDemolish();                                           // queues a TIMED teardown -> scaffold goes up
    const hasScaffold = !!(v._demoSites && v._demoSites.has(id));
    const total = (v.state.grid[by][bx] && v.state.grid[by][bx].demolish) ? v.state.grid[by][bx].demolish.total : 30;
    const plat0 = hasScaffold ? v._demoSites.get(id).plat.position.y : 0;
    S.tick(Math.floor(total * 0.5));                              // halfway through: still standing, coming down
    const midStanding = !!(v._demoSites && v._demoSites.has(id)) && v.buildings.has(id);
    const platMid = (v._demoSites && v._demoSites.has(id)) ? v._demoSites.get(id).plat.position.y : 0;
    const descended = platMid < plat0;                            // platform rode down while it stood
    S.tick(total + 3);                                            // finish it off
    const cleared = !(v._demoSites && v._demoSites.has(id)) && !v.buildings.has(id);
    S.setBulldoze(false);
    return { found: true, hasScaffold, total, midStanding, descended, cleared };
  });
  ok(ds.found && ds.hasScaffold, 'confirming a demolition raises a wrecking scaffold/hoarding around the building');
  ok(ds.total >= 60, `the teardown is a realistic, multi-week job (${ds.total} days), not instant`);
  ok(ds.midStanding && ds.descended, 'the barrier stands and the platform rides down while the building is still coming apart');
  ok(ds.cleared, 'the scaffold is pulled once the teardown finishes (and the building is gone)');

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
    // a prebuilt heritage house in the grid now tears down over TIME (not instantly)
    const gc = v.state.grid[hy] && v.state.grid[hy][hx];
    const timed = !!(gc && gc.demolish);
    const total = timed ? gc.demolish.total : 0;
    const standingAfterDone = timed ? !!v._heritageMeshAt(hx, hy) : false;  // still up right after Done
    if (total) S.tick(total + 3);                                          // wait the teardown out
    const removed = v.heritagePlacements.length === before - 1 && !v.heritageLabelAt(hx, hy);
    S.setBulldoze(false);
    return { found: true, isHeritage, red: red > 0, sel, timed, standingAfterDone, removed };
  });
  ok(dmH.found && dmH.isHeritage, 'a prebuilt shophouse / heritage building is detected by Demolish');
  ok(dmH.red, 'hovering the prebuilt shophouse turns its 3D model red');
  ok(dmH.timed && dmH.standingAfterDone, 'the old house is torn down over TIME (still standing right after Done), not vanished instantly');
  ok(dmH.sel && dmH.removed, 'Done demolishes the prebuilt shophouse (model + cell freed) once the teardown finishes');

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

  // (5) TRUE 3D PICKING: pointing at a building's body picks the BUILDING, not the
  // ground cell behind it (the bug that made tall buildings/airport un-hoverable).
  const dmPick = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    let bx = -1, by = -1;
    for (let y = 8; y < N - 8 && bx < 0; y += 2) for (let x = 8; x < N - 8; x++) {
      if (v.isLand(x, y) && !v.isRoadAt(x, y) && !v.buildings.has(`${x},${y}`) && !v.state.grid[y][x] && !(v.heritageLabelAt && v.heritageLabelAt(x, y))) { bx = x; by = y; break; }
    }
    if (bx < 0) return { found: false };
    v.state.grid[by][bx] = { k: 'hdb_flat' }; v._addMesh(bx, by, 'hdb_flat', false);   // full height now (no rise animation)
    v.scene.updateMatrixWorld(true);   // flush transforms so the raycast sees the brand-new mesh (the render loop does this each frame)
    const grp = v.buildings.get(`${bx},${by}`).group;
    const rect = v.canvas.getBoundingClientRect();
    // screen point over the building BODY (a few units up the facade), in the angled default view
    const sp = v.worldToScreen(grp.position.x, grp.position.y + 4, grp.position.z);
    if (!sp.visible) return { found: false };
    const lp = { x: sp.x - rect.left, y: sp.y - rect.top };
    const pick = v.pickDemo(lp);
    const pickedRight = !!pick && pick.kind === 'building' && pick.x === bx && pick.y === by;
    return { found: true, pickedRight };
  });
  ok(dmPick.found && dmPick.pickedRight, 'pointing at a building body picks the BUILDING (true 3D mesh pick, any angle)');

  // (6) AIRPORT (fixed landmark): selectable, demolished on Done, land freed, persisted
  const dmAir = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    if (!v.airportGroup) return { found: false };
    let maskedBefore = false;
    for (let y = 0; y < N && !maskedBefore; y++) for (let x = 0; x < N; x++) if (v.airportMask[y][x]) { maskedBefore = true; break; }
    S.setBulldoze(true);
    const lm = { id: 'airport', label: 'Paya Lebar Airport' };
    S.onTileTap(-1, -1, { x: v._airportCenter.cx, z: v._airportCenter.cz }, lm);  // simulate the 3D pick selecting it
    const sel = S.demoSel.size === 1;
    S.commitDemolish();
    const hidden = v.airportGroup.visible === false;
    let maskedAfter = false;
    for (let y = 0; y < N && !maskedAfter; y++) for (let x = 0; x < N; x++) if (v.airportMask[y][x]) { maskedAfter = true; break; }
    const persisted = !!(v.state.removedLandmarks && v.state.removedLandmarks.airport);
    S.setBulldoze(false);
    return { found: true, maskedBefore, sel, hidden, freed: !maskedAfter, persisted };
  });
  ok(dmAir.found && dmAir.maskedBefore && dmAir.sel, 'the airport (fixed landmark) can be selected for demolition');
  ok(dmAir.hidden && dmAir.freed && dmAir.persisted, 'Done removes the airport, frees its land, and the removal persists');

  // (7) CS-style road bulldozer: hover shows a live chunk; a single CLICK tears it out
  const dmBull = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, roads = v.state.roads;
    if (!roads || !roads.edges || !roads.edges.length) return { found: false };
    const lineOf = (e) => { if (e.poly && e.poly.length >= 2) return e.poly.map((q) => ({ x: q.x, z: q.z })); const a = roads.nodes[e.a], b = roads.nodes[e.b]; return (a && b) ? [{ x: a.x, z: a.z }, { x: b.x, z: b.z }] : []; };
    const cellOf = (w) => ({ x: Math.floor((w.x / 1600 + 0.5) * v.land.length), y: Math.floor((0.5 - w.z / 1600) * v.land.length) });
    let pt = null;
    for (const e of roads.edges) {
      if (e.demolish) continue; const l = lineOf(e); if (l.length < 2) continue;
      if (Math.hypot(l[l.length - 1].x - l[0].x, l[l.length - 1].z - l[0].z) < 12) continue;
      for (let f = 0.3; f <= 0.7; f += 0.1) { const q = l[Math.min(l.length - 1, Math.floor(l.length * f))]; if (!S.findDemoTarget(cellOf(q), { x: q.x, z: q.z })) { pt = q; break; } }
      if (pt) break;
    }
    if (!pt) return { found: false };
    S.setBulldoze(true);
    S.onDemolishHover(cellOf(pt), { x: pt.x, z: pt.z }, null);    // hover the road
    const hoverChunk = !!(S.demoRoadPreview && S.demoRoadPreview.length);
    const before = roads.edges.length;
    S.onTileTap(cellOf(pt).x, cellOf(pt).y, { x: pt.x, z: pt.z }); // single click bulldozes a chunk
    const staged = S.demoCuts.length === 1;
    S.commitDemolish();
    const split = roads.edges.length > before, queued = roads.edges.some((e) => e && e.demolish);
    S.setBulldoze(false);
    return { found: true, hoverChunk, staged, split, queued };
  });
  ok(dmBull.found && dmBull.hoverChunk, 'hovering a road shows a live red chunk (what a click would tear out)');
  ok(dmBull.staged && dmBull.split && dmBull.queued, 'a single click bulldozes a brush-sized chunk of road (CS-style)');

  // ---- VEHICLES: realistic (slower) speeds + acceleration/braking ------------
  const veh = await p.evaluate(() => {
    const v = window.__sgview;
    v._ensureVehicles(14);
    const vs = v.vehicles; if (!vs.length) return { found: false };
    const allAccel = vs.every((a) => typeof a.vel === 'number' && typeof a.accel === 'number' && typeof a.brake === 'number' && a.accel > 0);
    const maxSpeed = Math.max(...vs.map((a) => a.speed)), minSpeed = Math.min(...vs.map((a) => a.speed));
    // easing: a stopped car must climb back up gradually, not jump straight to cruise
    const a = vs.find((x) => (v.edgeLen[x.edge] || 0) > 20) || vs[0];
    a.t = a.dir > 0 ? 0.05 : 0.95; a.vel = 0; const cruise = a.speed;
    v._advanceNet([a], 0.05);                                    // ONE short step from a standstill
    const eased = a.vel > 0 && a.vel < cruise * 0.6;
    return { found: true, allAccel, maxSpeed: +maxSpeed.toFixed(2), minSpeed: +minSpeed.toFixed(2), eased };
  });
  ok(veh.found && veh.allAccel, 'every vehicle carries acceleration & braking state');
  ok(veh.maxSpeed < 5 && veh.minSpeed > 0, `vehicle speeds are realistic & slower (fastest ${veh.maxSpeed} u/s — was 7)`);
  ok(veh.eased, 'a stopped vehicle accelerates back up smoothly (no instant jump to cruise)');

  // vehicles must never TELEPORT between separate roads — no per-step jump
  const jump = await p.evaluate(() => {
    const v = window.__sgview; if (!v.vehicles || !v.vehicles.length) return { max: 0, n: 0 };
    let maxJump = 0; const prev = new Map();
    for (let f = 0; f < 60; f++) {
      for (const a of v.vehicles) prev.set(a, { x: a.mesh.position.x, z: a.mesh.position.z });
      v._advanceNet(v.vehicles, 0.25);
      for (const a of v.vehicles) { if (!a.mesh.visible) continue; const p = prev.get(a); const d = Math.hypot(a.mesh.position.x - p.x, a.mesh.position.z - p.z); if (d > maxJump) maxJump = d; }
    }
    return { max: +maxJump.toFixed(2), n: v.vehicles.length };
  });
  ok(jump.max < 3, `no vehicle teleports between separate roads (largest step ${jump.max}u over 0.25s across ${jump.n} vehicles)`);

  // ---- HOVER-INFO: Demolish mode tells you what a building is -----------------
  const hi = await p.evaluate(() => {
    const v = window.__sgview, sg = window.__sg, st = sg.state;
    sg.setBulldoze(true);
    let gx = -1, gy = -1;
    for (let y = 0; y < st.grid.length && gx < 0; y++) for (let x = 0; x < st.grid[y].length; x++) { const c = st.grid[y][x]; if (c && c.heritage) { gx = x; gy = y; break; } }
    const w = v.worldOfCell(gx, gy);
    sg.onDemolishHover({ x: gx, y: gy }, w, null);
    const el = document.querySelector('.hover-info');
    const shown = !!el && getComputedStyle(el).display !== 'none';
    const txt = el ? el.textContent : '';
    sg.setBulldoze(false);
    const gone = (() => { const e = document.querySelector('.hover-info'); return !e || getComputedStyle(e).display === 'none'; })();
    return { shown, txtLen: txt.length, hasName: /station|shophouse|kampong|hospital|market|godown|port|building|flat/i.test(txt), gone };
  });
  ok(hi.shown && hi.hasName && hi.txtLen > 20, 'hovering a building in Demolish mode shows what it is (name + what it does)');
  ok(hi.gone, 'the building info clears when you leave Demolish mode');

  // ---- TRAINS: reduced line speeds + accel/braking ---------------------------
  const trn = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length, C = v.worldOfCell(Math.round(N * 0.5), Math.round(N * 0.5));
    const V = v.target.constructor;   // THREE.Vector3 (track points are Vector3s)
    v._playerTrainTracks = [{ kind: 'rail', pts: [new V(C.x - 120, 0, C.z), new V(C.x + 120, 0, C.z)] }];  // a straight line to run stock on
    v._buildTrains();
    const trains = v._trains || []; if (!trains.length) return { found: false };
    const allAccel = trains.every((t) => typeof t.vel === 'number' && typeof t.accel === 'number' && typeof t.brake === 'number');
    const maxSpeed = Math.max(...trains.map((t) => t.speed));
    const tr0 = trains[0]; tr0.u = 0.5; tr0.vel = 0; tr0.dwell = 0; const cruise = tr0.speed;
    v._updateTrains(0.05);                                          // one step from a standstill
    const eased = tr0.vel > 0 && tr0.vel < cruise * 0.7;
    return { found: true, allAccel, maxSpeed: +maxSpeed.toFixed(2), eased };
  });
  ok(trn.found && trn.allAccel, 'every train carries acceleration & braking state');
  ok(trn.maxSpeed < 7 && trn.eased, `train speeds are realistic & slower, and ease in/out of stations (fastest ${trn.maxSpeed} u/s — was 13)`);

  // ---- 2-WAY road gets a centre lane line; 1-way does not --------------------
  const lane = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length, C = v.worldOfCell(Math.round(N * 0.5) + 18, Math.round(N * 0.5));
    const markVerts = () => { const m = v.roadGroup.children.find((c) => c.material && c.material.color && Math.abs(c.material.color.getHex() - 0xfaf3d8) <= 6); return m ? m.geometry.attributes.position.count : 0; };
    v.state.roads = { nodes: [{ x: C.x - 30, z: C.z, y: 0 }, { x: C.x + 30, z: C.z, y: 0 }], edges: [{ a: 0, b: 1, type: 'road', lanes: 2 }], islands: [] };
    v.rebuildRoadNet(); const twoWay = markVerts();
    v.state.roads.edges[0].oneway = true; v.rebuildRoadNet(); const oneWay = markVerts();
    return { twoWay, oneWay };
  });
  ok(lane.twoWay > 0, 'a two-way road gets a dashed centre line');
  ok(lane.oneWay < lane.twoWay, 'a one-way road has no centre line (so the two read differently)');

  // ---- DIRT road: worn-brown centre fading to grass-green edges (kampong) -----
  const dirt = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length, C = v.worldOfCell(Math.round(N * 0.5), Math.round(N * 0.5) + 18);
    v.state.roads = { nodes: [{ x: C.x - 30, z: C.z, y: 0 }, { x: C.x + 30, z: C.z, y: 0 }], edges: [{ a: 0, b: 1, type: 'road', dirt: true, traced: true }], islands: [] };
    v.rebuildRoadNet();
    const meshes = v.roadGroup.children.filter((c) => c.geometry && c.geometry.attributes && c.geometry.attributes.color);
    if (!meshes.length) return { found: false };
    let green = false, brown = false;
    for (const m of meshes) { const col = m.geometry.attributes.color; for (let i = 0; i < col.count; i++) { const r = col.getX(i), g = col.getY(i), b = col.getZ(i); if (g > r + 0.05 && g > b + 0.05) green = true; if (r > g + 0.05 && r > b + 0.05) brown = true; } }
    return { found: true, green, brown, verts: meshes[0].geometry.attributes.color.count };
  });
  ok(dirt.found, 'dirt roads render as a vertex-coloured ribbon');
  ok(dirt.green && dirt.brown, 'the dirt path fades from a worn brown centre to grass-green edges (not a flat brown stripe)');

  // ---- WEATHER: rain falls under the clouds (not snapped to the camera) -------
  const rainT = await p.evaluate(() => {
    const v = window.__sgview, tx = v.target.x, tz = v.target.z;
    v.clouds.forEach((c, i) => c.position.set(i === 0 ? tx + 200 : tx + 6000, 92, tz));   // one cloud near (offset), rest far
    v.weather = { ...v.weather, rain: 1, cloud: 0.95, wind: 0.5, windDir: 0 }; v._wTarget = { cloud: 0.95, rain: 1, wind: 0.5 }; v._floodRain = false;
    for (let i = 0; i < 50; i++) v._updateWeather(0.04);
    const arr = v.rain.geometry.attributes.position.array, cx = v.clouds[0].position.x, cz = v.clouds[0].position.z;
    let active = 0, nearCloud = 0, nearCam = 0;
    for (let i = 0; i < arr.length; i += 3) { if (arr[i + 1] > -9000) { active++; if (Math.hypot(arr[i] - cx, arr[i + 2] - cz) < 90) nearCloud++; if (Math.hypot(arr[i] - tx, arr[i + 2] - tz) < 90) nearCam++; } }
    return { active, nearCloud, nearCam, visible: v.rain.visible };
  });
  ok(rainT.visible && rainT.active > 0, 'rain falls under a cloud near the view');
  ok(rainT.nearCloud === rainT.active && rainT.nearCam === 0, 'every raindrop sits under the cloud, NOT snapped to the camera');

  // ---- WEATHER: wind drifts slowly; storms throw lightning --------------------
  const wxT = await p.evaluate(() => {
    const v = window.__sgview, d0 = v.weather.windDir;
    for (let i = 0; i < 200; i++) v._updateWeather(0.05);                 // ~10s of drift
    const drift = Math.abs(v.weather.windDir - d0);
    const tx = v.target.x, tz = v.target.z;
    v.clouds.forEach((c) => c.position.set(tx + (Math.random() - 0.5) * 200, 95, tz + (Math.random() - 0.5) * 200));
    v.weather = { ...v.weather, rain: 1, wind: 0.9 }; v._wTarget = { ...v._wTarget, rain: 1, wind: 0.9 }; v._boltTimer = -1; v._bolts.length = 0; v._flash = 0;
    v._updateWeather(0.02);
    return { drift: +drift.toFixed(4), bolts: v._bolts.length, flash: v._flash > 0 };
  });
  ok(wxT.drift > 0 && wxT.drift < 1.5, `wind direction drifts slowly & continuously (${wxT.drift} rad over ~10s)`);
  ok(wxT.bolts > 0 && wxT.flash, 'a storm throws a lightning bolt and flashes the sky');

  // ---- POWER: building lights run on the grid; a shortage browns them out -----
  const powT = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    let bx = -1, by = -1;
    for (let y = 4; y < N - 4 && bx < 0; y += 2) for (let x = 4; x < N - 4; x++) { if (v.isLand(x, y) && !v.isRoadAt(x, y) && !v.buildings.has(`${x},${y}`) && !v.state.grid[y][x] && !(v.heritageLabelAt && v.heritageLabelAt(x, y))) { bx = x; by = y; break; } }
    if (bx < 0) return { found: false };
    v.state.grid[by][bx] = { k: 'hdb_flat' }; v._addMesh(bx, by, 'hdb_flat', false);
    const grp = v.buildings.get(`${bx},${by}`).group;
    let lit = null; grp.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m.emissiveMap || (m.userData && (m.userData.glowK ?? 0) >= 1)) lit = m; } });
    if (!lit) return { found: false };
    v.gameDays = 0.0;   // midnight -> lights on
    v.setShortages({ power: false, water: false, powerRatio: 1.5 }); v._updateDayNight(); const full = lit.emissiveIntensity;
    v.setShortages({ power: true, water: false, powerRatio: 0.1 }); v._updateDayNight(); const short = lit.emissiveIntensity;
    v.setShortages({ power: true, water: false, powerRatio: 0.0 }); v._updateDayNight(); const blackout = lit.emissiveIntensity;
    return { found: true, full: +full.toFixed(3), short: +short.toFixed(3), blackout: +blackout.toFixed(3) };
  });
  ok(powT.found && powT.full > 0, 'building windows glow at night when there is enough power');
  ok(powT.short < powT.full * 0.5, `a power shortage browns out the city lights (${powT.short} vs ${powT.full})`);
  ok(powT.blackout <= powT.short && powT.blackout < powT.full * 0.25, 'with little or no generation the lights nearly go out');

  // ---- FIRE: hot/dry land smokes & burns; rain douses it; greenery cools it ----
  const fireT = await p.evaluate(() => {
    const v = window.__sgview, tx = v.target.x, tz = v.target.z;
    const before = v._fires.length;
    const f = v.igniteFireAt(tx, tz, 'building', null);
    const ignited = v._fires.length === before + 1 && !!f.flame && !!f.smoke && !!f.light;
    const y0 = f.smoke.geometry.attributes.position.array[1];
    v.weather = { ...v.weather, rain: 0, wind: 0.3 };
    v._updateFire(0.1);
    const smokeRises = f.smoke.geometry.attributes.position.array[1] > y0;
    v.weather = { ...v.weather, rain: 1 };
    let steps = 0; while (v._fires.length > 0 && steps < 300) { v._updateFire(0.2); steps++; }
    const doused = v._fires.length === 0;
    v._dryness = 0.5; v.weather = { ...v.weather, rain: 1, cloud: 0.9 }; for (let i = 0; i < 60; i++) v._updateFire(0.1); const wet = v._dryness;
    v.weather = { ...v.weather, rain: 0, cloud: 0 }; for (let i = 0; i < 500; i++) v._updateFire(0.1); const dry = v._dryness;
    return { ignited, smokeRises, doused, wet: +wet.toFixed(2), dry: +dry.toFixed(2) };
  });
  ok(fireT.ignited && fireT.smokeRises, 'a fire raises flickering flames + a warm light + a rising smoke column');
  ok(fireT.doused, 'rain puts the fire out');
  ok(fireT.dry > fireT.wet + 0.2, `the land dries out under clear sun and wets in rain (wet ${fireT.wet} -> dry ${fireT.dry})`);

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
