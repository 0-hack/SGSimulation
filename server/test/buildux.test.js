// Sims-like build/demolish UX: free sub-cell placement, drag-to-rotate, precise
// demolish targeting (no more "removes a random nearby thing"), and buildable
// land right beside roads.
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

  // ---- 1) FREE SUB-CELL PLACEMENT --------------------------------------------
  const f = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    const clear = (x, y) => v.isLand(x, y) && !v.buildings.has(`${x},${y}`) && !v.isRoadAt(x, y) && !(v.heritageMask && v.heritageMask[y][x]) && !v.state.grid[y][x];
    const cy = Math.round(N * 0.42); let cx = -1;
    for (let x = Math.round(N * 0.42); x < N * 0.42 + 60; x++) if (clear(x, cy)) { cx = x; break; }
    const ctr = v.worldOfCell(cx, cy);
    const world = { x: ctr.x + 0.8, z: ctr.z - 0.6 };     // a clear sub-cell offset
    S.selectBuilding('hdb_flat');
    S.onTileTap(cx, cy, world);                            // place pending at the exact point
    const adjOff = Math.abs(S.adjust.wx - world.x) < 1e-6 && Math.abs(S.adjust.wz - world.z) < 1e-6;
    S.commitAdjust();
    const cell = v.state.grid[cy][cx];
    const savedOff = cell && Math.abs(cell.ox - 0.8) < 1e-6 && Math.abs(cell.oz + 0.6) < 1e-6;
    // the construction site should sit at the offset spot, not the cell centre
    const site = v.sites.get(`${cx},${cy}`);
    const sitePos = site && Math.abs(site.group.position.x - (ctr.x + 0.8)) < 0.01 && Math.abs(site.group.position.z - (ctr.z - 0.6)) < 0.01;
    return { adjOff, savedOff, sitePos };
  });
  ok(f.adjOff, 'placing follows the exact cursor point (sub-cell), not the tile centre');
  ok(f.savedOff, 'the sub-cell offset is persisted on the grid cell (ox/oz)');
  ok(f.sitePos, 'the building renders at the chosen sub-cell spot');

  // ---- 2) DRAG-TO-ROTATE (real pointer gesture on the building) --------------
  const r = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    const clear = (x, y) => v.isLand(x, y) && !v.buildings.has(`${x},${y}`) && !v.isRoadAt(x, y) && !(v.heritageMask && v.heritageMask[y][x]) && !v.state.grid[y][x];
    const cy = Math.round(N * 0.45); let cx = -1;
    for (let x = Math.round(N * 0.45); x < N * 0.45 + 60; x++) if (clear(x, cy)) { cx = x; break; }
    const ctr = v.worldOfCell(cx, cy);
    S.selectBuilding('factory');
    S.onTileTap(cx, cy, ctr);                              // pending object at the cell
    v.centerCamera && v.centerCamera();
    // screen point over the building, and a second point to drag toward
    const hy = v._adjust.mesh.position.y;
    const s0 = v.worldToScreen(ctr.x, hy, ctr.z);
    const s1 = v.worldToScreen(ctr.x + 24, hy, ctr.z + 24);  // a clearly different ground direction
    const cv = document.getElementById('city');
    const rot0 = S.adjust.rot;
    const pe = (type, s) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: s.x, clientY: s.y, button: 0, bubbles: true }));
    pe('pointerdown', s0);                                 // grab the building -> rotate drag
    const grabbed = v._rotDrag === true;
    pe('pointermove', s1);                                 // swivel it
    pe('pointerup', s1);
    const rotChanged = Math.abs(S.adjust.rot - rot0) > 1e-3;
    const meshSynced = Math.abs(v._adjust.mesh.rotation.y - S.adjust.rot) < 1e-6;
    const noTapMove = S.adjust.x === cx && S.adjust.y === cy;  // a rotate-drag must NOT move/commit it
    S.cancelAdjust('x');
    return { grabbed, rotChanged, meshSynced, noTapMove };
  });
  ok(r.grabbed, 'pressing on the pending building starts a rotate-drag (not a camera orbit)');
  ok(r.rotChanged && r.meshSynced, 'dragging swivels the building and keeps mesh + state angle in sync');
  ok(r.noTapMove, 'a rotate-drag does not move or commit the building');

  // ---- 3) DEMOLISH ROADS: freehand drag (any length, not a whole edge) + timed teardown
  const d = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg;
    const C = v.worldOfCell(Math.round(v.land.length * 0.5), Math.round(v.land.length * 0.5));
    const roads = v.state.roads; const base = roads.nodes.length;
    roads.nodes.push({ x: C.x - 20, z: C.z, y: 0 }, { x: C.x + 20, z: C.z, y: 0 });         // road A
    roads.nodes.push({ x: C.x - 20, z: C.z + 5, y: 0 }, { x: C.x + 20, z: C.z + 5, y: 0 }); // road B
    roads.edges.push({ a: base, b: base + 1, type: 'road', lanes: 2 });
    roads.edges.push({ a: base + 2, b: base + 3, type: 'road', lanes: 2 });
    v.rebuildRoadNet();
    const cellOf = (w) => ({ x: Math.floor((w.x / 1600 + 0.5) * v.land.length), y: Math.floor((0.5 - w.z / 1600) * v.land.length) });
    // a TAP on a road no longer selects a whole fixed-length edge (roads are freehand-only now)
    const tapRoad = S.findDemoTarget(cellOf({ x: C.x, z: C.z }), { x: C.x, z: C.z });
    const noWholeEdge = !tapRoad || tapRoad.kind !== 'road';
    S.setBulldoze(true);
    // freehand-drag the MIDDLE of road A, then the middle of road B -> two cuts accumulate
    // (each drag adds exactly one cut, however much tarmac it covers)
    S.onDemolishStroke([{ x: C.x - 6, z: C.z }, { x: C.x, z: C.z }, { x: C.x + 6, z: C.z }]);
    S.onDemolishStroke([{ x: C.x - 6, z: C.z + 5 }, { x: C.x, z: C.z + 5 }, { x: C.x + 6, z: C.z + 5 }]);
    const markedTwo = S.demoCuts.length === 2;
    const beforeEdges = roads.edges.length;
    S.commitDemolish();
    const split = v.state.roads.edges.length > beforeEdges;                                  // each road cut into pieces
    const queued = v.state.roads.edges.filter((e) => e && e.demolish).length >= 2;           // a covered piece per road, timed
    const cutsCleared = S.demoCuts.length === 0;
    S.tick(6);                                                                                // a few days pass -> covered pieces torn down
    const middlesGone = !v.state.roads.edges.some((e) => e && e.demolish);
    const remnantsRemain = v.state.roads.edges.length > 0;                                    // end pieces survive (not a whole-edge wipe)
    S.setBulldoze(false);
    return { noWholeEdge, markedTwo, split, queued, cutsCleared, middlesGone, remnantsRemain };
  });
  ok(d.noWholeEdge, 'tapping a road no longer selects a whole fixed-length edge (freehand only)');
  ok(d.markedTwo, 'dragging along two roads accumulates two freehand cuts');
  ok(d.split && d.queued, '✓ Done splits the roads and queues only the dragged portions (timed, not instant)');
  ok(d.cutsCleared, '✓ Done clears the pending freehand cuts');
  ok(d.middlesGone && d.remnantsRemain, 'after a few days the dragged portions are torn down while the rest of the road survives');

  // ---- 3b) BUILDING teardown is timed and stops functioning immediately ------
  const d2 = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    const clear = (x, y) => v.isLand(x, y) && !v.buildings.has(`${x},${y}`) && !v.isRoadAt(x, y) && !(v.heritageMask && v.heritageMask[y][x]) && !v.state.grid[y][x];
    const cy = Math.round(N * 0.48); let cx = -1;
    for (let x = Math.round(N * 0.40); x < N * 0.55; x++) if (clear(x, cy)) { cx = x; break; }
    // force a finished building into the grid + scene
    v.state.grid[cy][cx] = { k: 'hdb_flat' };
    v.onBuilt(cx, cy, 'hdb_flat');
    const inScene = v.buildings.has(`${cx},${cy}`);
    S.setBulldoze(true);
    S.onTileTap(cx, cy, v.worldOfCell(cx, cy));             // select the building
    const sel = S.demoSel.size === 1;
    S.commitDemolish();
    const marked = !!(v.state.grid[cy][cx] && v.state.grid[cy][cx].demolish);  // teardown timer set, still standing
    S.tick(30);                                            // wait it out
    const gone = !v.state.grid[cy][cx] && !v.buildings.has(`${cx},${cy}`);     // cell cleared + mesh removed
    S.setBulldoze(false);
    return { inScene, sel, marked, gone };
  });
  ok(d2.inScene && d2.sel, 'a building can be selected for demolition');
  ok(d2.marked, '✓ Done marks the building for a timed teardown (it stands while coming down)');
  ok(d2.gone, 'after the teardown days the building is fully removed from the grid and scene');

  // ---- 4) BUILD AT THE KERB --------------------------------------------------
  const k = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const C = v.worldOfCell(Math.round(N * 0.55), Math.round(N * 0.55));
    const roads = v.state.roads; const base = roads.nodes.length;
    roads.nodes.push({ x: C.x - 30, z: C.z, y: 0 }, { x: C.x + 30, z: C.z, y: 0 });
    roads.edges.push({ a: base, b: base + 1, type: 'road', lanes: 2 });
    v.rebuildRoadNet();
    // a cell whose centre is ~2.5u from the road centreline (one tile away): under
    // the old fat 3.5u margin it was blocked; now (1.5u clearance) it's buildable.
    const cellOf = (w) => ({ x: Math.floor((w.x / 1600 + 0.5) * N), y: Math.floor((0.5 - w.z / 1600) * N) });
    const adj = cellOf({ x: C.x, z: C.z + 2.5 });
    const onRoad = cellOf({ x: C.x, z: C.z });       // a cell on the tarmac stays blocked
    return { kerbBuildable: !v.isRoadAt(adj.x, adj.y), tarmacBlocked: v.isRoadAt(onRoad.x, onRoad.y) };
  });
  ok(k.kerbBuildable, 'a tile ~1 away from a road is now buildable (build at the kerb)');
  ok(k.tarmacBlocked, 'a tile ON the road is still blocked (no building on the tarmac)');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
