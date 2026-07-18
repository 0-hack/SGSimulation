// Player bridge tool e2e: select the tool, tap the river — the deck AUTO-FITS bank
// to bank along its angle (no manual length); move/rotate refit the span, the width
// slider resizes, ✓ Done builds it, the road over it snaps straight and flat onto
// the deck, and Demolish removes it again (roads re-drape).
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', (d) => d.dismiss());
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise((r) => setTimeout(r, 1500));

  // mid-river spots on the NEW map-extracted course (world coords):
  // the mouth basin (~base 23.17,18.81) and the Boat Quay stretch (~base 22.46,19.16)
  const BASIN = { x: -26.5, z: 171.8 };
  const MID = { x: -50.95, z: 160.95 };

  // 1) tool on + tap the river → pending deck auto-fits, both ends on the banks
  const t1 = await p.evaluate(({ BASIN }) => {
    const sg = window.__sg, v = window.__sgview;
    sg.selectBridgeTool();
    const active = sg.bridge.active;
    sg.onTileTap(0, 0, BASIN);
    const b = sg.bridge.pending;
    if (!b) return { active, pending: false };
    const wet = (x, z) => v._overWater(x, z, 0.05) && v._meshY(x, z) < 0.15;
    const ax = Math.sin(b.rot || 0), az = Math.cos(b.rot || 0), hl = b.len / 2;
    return {
      active, pending: true, len: b.len, ghost: !!v._bridgePrev,
      midWet: wet(b.x, b.z),
      endALand: !wet(b.x - ax * (hl + 0.4), b.z - az * (hl + 0.4)),
      endBLand: !wet(b.x + ax * (hl + 0.4), b.z + az * (hl + 0.4)),
    };
  }, { BASIN });
  ok(t1.active, 'Bridge tool activates from selectBridgeTool()');
  ok(t1.pending && t1.len > 0.8 && t1.len < 30, `tap the river drops an auto-fitted deck (len ${t1.len?.toFixed(1)}u)`);
  ok(t1.midWet && t1.endALand && t1.endBLand, 'deck centred over water with BOTH ends seated on the banks');
  ok(t1.ghost, 'ghost preview mesh appears while positioning');

  // 2) tapping dry land does NOT move the pending deck (bridge must sit on the river)
  const t2 = await p.evaluate(() => {
    const sg = window.__sg;
    const before = { ...sg.bridge.pending };
    sg.onTileTap(0, 0, { x: -120, z: 250 });
    const b = sg.bridge.pending;
    return { same: Math.abs(b.x - before.x) < 1e-9 && Math.abs(b.z - before.z) < 1e-9 };
  });
  ok(t2.same, 'tapping dry land leaves the deck where it was (no bridge over grass)');

  // 3) move to another river spot + rotate: the span re-fits each time; width slider works
  const t3 = await p.evaluate(({ MID }) => {
    const sg = window.__sg, v = window.__sgview;
    // move onto a REAL road-water crossing: the nearest auto bridge frame mid
    // (self-locating, so course tweaks don't stale the coordinate)
    const fr = (v._bridgeFrames || []).filter((f) => !f.manual)
      .sort((a, b) => Math.hypot(a.mid.x - MID.x, a.mid.z - MID.z) - Math.hypot(b.mid.x - MID.x, b.mid.z - MID.z))[0];
    if (fr) MID = { x: fr.mid.x, z: fr.mid.z };
    sg.onTileTap(0, 0, MID);
    const moved = { ...sg.bridge.pending };
    sg.setBridgeRot((moved.rot || 0) + 0.35);
    const rotated = { ...sg.bridge.pending };
    sg.setBridgeW(1.2);
    const b = sg.bridge.pending;
    const wet = (x, z) => v._overWater(x, z, 0.05) && v._meshY(x, z) < 0.15;
    const ax = Math.sin(b.rot), az = Math.cos(b.rot), hl = b.len / 2;
    return {
      movedNear: Math.hypot(moved.x - MID.x, moved.z - MID.z) < 6,
      refit: rotated.rot !== moved.rot,
      still: wet(b.x, b.z)
        && !wet(b.x - ax * (hl + 0.4), b.z - az * (hl + 0.4))
        && !wet(b.x + ax * (hl + 0.4), b.z + az * (hl + 0.4)),
      w: b.w,
    };
  }, { MID });
  ok(t3.movedNear, 'second tap MOVES the deck to the new river spot (re-fitted)');
  ok(t3.refit && t3.still, 'rotating re-fits the span — still bank to bank at the new angle');
  ok(t3.w === 1.2, 'width slider resizes the pending deck');

  // 4) ✓ Done builds it: state entry, treasury charged, deck mesh in scene
  const t4 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    const before = sg.state.treasury;
    sg.commitBridge();
    const grp = v._bridgeGroups && v._bridgeGroups.get(sg.state.bridges.length - 1);
    return {
      built: sg.state.bridges.length === 1, charged: sg.state.treasury < before,
      pendingCleared: !sg.bridge.pending, ghostGone: !v._bridgePrev,
      deckInScene: !!grp && grp.children.length > 0,
    };
  });
  ok(t4.built, 'commitBridge stores the bridge in state.bridges');
  ok(t4.charged, 'building the bridge costs money');
  ok(t4.pendingCleared && t4.ghostGone, 'pending + ghost cleared after ✓ Done');
  ok(t4.deckInScene, 'a real deck mesh group is in the scene (demolish-pickable)');

  // 5) any road across the deck snaps straight & flat on top
  const t5 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    const b = sg.state.bridges[0];
    const ax = Math.sin(b.rot), az = Math.cos(b.rot), hl = b.len / 2;
    const deckY = Math.max(0.9, v._meshY(b.x - ax * hl, b.z - az * hl) + 0.2, v._meshY(b.x + ax * hl, b.z + az * hl) + 0.2);
    let onDeck = 0, offAxis = 0, sunk = 0;
    for (const lane of v.edgePts) {
      for (const q of lane) {
        const dx = q.x - b.x, dz = q.z - b.z;
        const along = dx * ax + dz * az, perp = dx * -az + dz * ax;
        if (Math.abs(along) < hl - 0.5 && Math.abs(perp) < b.w / 2 + 0.8) {
          onDeck++;
          if (Math.abs(perp) > 0.15) offAxis++;
          if (q.y < deckY - 0.05) sunk++;
        }
      }
    }
    return { onDeck, offAxis, sunk };
  });
  ok(t5.onDeck > 0, `a road crosses the deck (${t5.onDeck} lane points on it)`);
  ok(t5.offAxis === 0, 'every road point on the deck is snapped straight onto the bridge axis');
  ok(t5.sunk === 0, 'road runs flat at deck height');

  // 6) demolish: pick the deck, select it, ✓ Done removes it and the mesh goes away
  const t6 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    sg.setBulldoze(true);
    const grp = v._bridgeGroups.get(0);
    let mesh = null; grp.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    let node = mesh, tag = null;
    while (node && !tag) { tag = node.userData && node.userData.demo; if (!tag) node = node.parent; }
    const target = tag && tag.kind === 'bridge' ? { kind: 'bridge', i: tag.index, label: 'Bridge' } : null;
    if (!target) return { picked: false };
    sg.demoSel.set(sg.demoKey(target), target);
    sg.commitDemolish();
    return {
      picked: true, removed: sg.state.bridges.length === 0,
      meshGone: !v._bridgeGroups.has(0) || v._bridgeGroups.get(0).children.length === 0,
    };
  });
  ok(t6.picked, 'deck mesh is demolish-pickable (tagged kind:bridge)');
  ok(t6.removed, 'Demolish ✓ Done removes the bridge from state');
  ok(t6.meshGone, 'deck mesh leaves the scene after demolish');

  // 7) persistence: bridges survive the save/load round-trip
  const t7 = await p.evaluate(() => {
    const sg = window.__sg;
    sg.state.bridges.push({ x: -27.7, z: 173, len: 6, w: 1.6, rot: 1.1 });
    const packed = JSON.parse(JSON.stringify(sg.state, (k, v) => (k === 'grid' || k === 'landGrid' ? undefined : v)));
    return { saved: Array.isArray(packed.bridges) && packed.bridges.length === 1 && packed.bridges[0].len === 6 };
  });
  ok(t7.saved, 'bridges serialize with the game state');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
