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

  // ---- 3) PRECISE DEMOLISH TARGETING (the random-removal fix) ----------------
  const d = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg;
    // two parallel roads 5 units apart, through a known spot
    const C = v.worldOfCell(Math.round(v.land.length * 0.5), Math.round(v.land.length * 0.5));
    const roads = v.state.roads; const base = roads.nodes.length;
    roads.nodes.push({ x: C.x - 20, z: C.z, y: 0 }, { x: C.x + 20, z: C.z, y: 0 });         // road A
    roads.nodes.push({ x: C.x - 20, z: C.z + 5, y: 0 }, { x: C.x + 20, z: C.z + 5, y: 0 }); // road B
    const eA = roads.edges.length; roads.edges.push({ a: base, b: base + 1, type: 'road', lanes: 2 });
    const eB = roads.edges.length; roads.edges.push({ a: base + 2, b: base + 3, type: 'road', lanes: 2 });
    v.rebuildRoadNet();
    const cellOf = (w) => ({ x: Math.floor((w.x / 1600 + 0.5) * v.land.length), y: Math.floor((0.5 - w.z / 1600) * v.land.length) });
    const nearA = { x: C.x, z: C.z + 1 };       // 1u from A, 4u from B
    const nearB = { x: C.x, z: C.z + 4 };       // 1u from B, 4u from A
    const tA = S.findDemoTarget(cellOf(nearA), nearA);
    const tB = S.findDemoTarget(cellOf(nearB), nearB);
    const hitsA = tA && tA.kind === 'road' && tA.i === eA;
    const hitsB = tB && tB.kind === 'road' && tB.i === eB;
    // far point (8u from either) hits NOTHING (old code would have grabbed nearest within 6u)
    const far = { x: C.x, z: C.z + 14 };
    const tFar = S.findDemoTarget(cellOf(far), far);
    const farMiss = !tFar;
    // now actually remove exactly road B via the demolish tap path
    const before = roads.edges.length;
    S.setBulldoze(true);
    S.onTileTap(cellOf(nearB).x, cellOf(nearB).y, nearB);
    const removedOne = roads.edges.length === before - 1;
    const removedRight = !roads.edges.some((e, i) => i === eA ? false : false) && roads.edges[eA]; // A still present
    S.setBulldoze(false);
    return { hitsA, hitsB, farMiss, removedOne, aStillThere: !!roads.edges[eA] };
  });
  ok(d.hitsA && d.hitsB, 'demolish targets the road actually under the cursor (A vs B distinguished)');
  ok(d.farMiss, 'a point away from all roads targets NOTHING (no fat 6-unit grab radius)');
  ok(d.removedOne && d.aStillThere, 'tapping removes EXACTLY the targeted road, leaving the neighbour intact');

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
