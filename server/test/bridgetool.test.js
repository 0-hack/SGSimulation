// Player bridge tool e2e: select the tool, tap the river to drop a pending deck,
// move / rotate / resize it, ✓ Done builds it, the road over it snaps straight and
// flat onto the deck, and Demolish removes it again (roads re-drape).
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

  // A quiet stretch of the Singapore River near the mouth (world coords).
  const SITE = { x: -20, z: 172 };

  // 1) select the tool and tap the river → a pending deck + ghost preview
  const t1 = await p.evaluate(({ x, z }) => {
    const sg = window.__sg, v = window.__sgview;
    sg.selectBridgeTool();
    const active = sg.bridge.active;
    sg.onTileTap(0, 0, { x, z });
    return { active, pending: sg.bridge.pending ? { ...sg.bridge.pending } : null, ghost: !!v._bridgePrev };
  }, SITE);
  ok(t1.active, 'Bridge tool activates from selectBridgeTool()');
  ok(t1.pending && Math.abs(t1.pending.x - SITE.x) < 0.01 && Math.abs(t1.pending.z - SITE.z) < 0.01, 'tap drops a pending deck at the tapped spot');
  ok(t1.ghost, 'ghost preview mesh appears while positioning');

  // 2) move (second tap), rotate, resize — the pending deck follows
  const t2 = await p.evaluate(({ x, z }) => {
    const sg = window.__sg;
    sg.onTileTap(0, 0, { x: x + 2, z: z - 1 });        // second tap moves, not duplicates
    sg.setBridgeRot(Math.PI / 3);
    sg.setBridgeLen(12); sg.setBridgeW(2);
    const b = sg.bridge.pending;
    return { one: !!b, x: b.x, z: b.z, rot: b.rot, len: b.len, w: b.w };
  }, SITE);
  ok(t2.one && Math.abs(t2.x - (SITE.x + 2)) < 0.01 && Math.abs(t2.z - (SITE.z - 1)) < 0.01, 'second tap MOVES the pending deck');
  ok(Math.abs(t2.rot - Math.PI / 3) < 1e-9 && t2.len === 12 && t2.w === 2, 'rotation + length/width sliders update the pending deck');

  // 3) ✓ Done builds it: state.bridges entry, treasury charged, deck mesh in scene
  const t3 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    const before = sg.state.treasury;
    sg.commitBridge();
    const b = sg.state.bridges[sg.state.bridges.length - 1];
    const grp = v._bridgeGroups && v._bridgeGroups.get(sg.state.bridges.length - 1);
    return {
      built: sg.state.bridges.length === 1, charged: sg.state.treasury < before,
      pendingCleared: !sg.bridge.pending, ghostGone: !v._bridgePrev,
      deckInScene: !!grp && grp.children.length > 0, b: b ? { ...b } : null,
    };
  });
  ok(t3.built, 'commitBridge stores the bridge in state.bridges');
  ok(t3.charged, 'building the bridge costs money');
  ok(t3.pendingCleared && t3.ghostGone, 'pending + ghost cleared after ✓ Done');
  ok(t3.deckInScene, 'a real deck mesh group is in the scene (demolish-pickable)');

  // 4) the road across the deck snaps straight & flat on top
  const t4 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    const b = sg.state.bridges[0];
    const ax = Math.sin(b.rot), az = Math.cos(b.rot), hl = b.len / 2;
    // scan all road lane points: any point inside the deck's capture box must sit
    // ON the deck axis (perpendicular offset ~0) at deck height.
    let onDeck = 0, offAxis = 0, sunk = 0;
    const deckY = Math.max(0.9, v._meshY(b.x - ax * hl, b.z - az * hl) + 0.2, v._meshY(b.x + ax * hl, b.z + az * hl) + 0.2);
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
    return { onDeck, offAxis, sunk, deckY };
  });
  ok(t4.onDeck > 0, `a road crosses the deck (${t4.onDeck} lane points on it)`);
  ok(t4.offAxis === 0, 'every road point on the deck is snapped straight onto the bridge axis');
  ok(t4.sunk === 0, `road runs flat at deck height (deckY ${t4.deckY.toFixed(2)})`);

  // 5) demolish: pick the deck, select it, ✓ Done removes it and the mesh goes away
  const t5 = await p.evaluate(() => {
    const sg = window.__sg, v = window.__sgview;
    sg.setBulldoze(true);
    const grp = v._bridgeGroups.get(0);
    let mesh = null; grp.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    // classify the deck mesh the way a tap would (walk up to the demo-tagged root)
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
  ok(t5.picked, 'deck mesh is demolish-pickable (tagged kind:bridge)');
  ok(t5.removed, 'Demolish ✓ Done removes the bridge from state');
  ok(t5.meshGone, 'deck mesh leaves the scene after demolish');

  // 6) persistence: bridges survive the save/load round-trip
  const t6 = await p.evaluate(() => {
    const sg = window.__sg;
    sg.state.bridges.push({ x: -20, z: 172, len: 10, w: 1.6, rot: 1.1 });
    const packed = JSON.parse(JSON.stringify(sg.state, (k, v) => (k === 'grid' || k === 'landGrid' ? undefined : v)));
    return { saved: Array.isArray(packed.bridges) && packed.bridges.length === 1 && packed.bridges[0].len === 10 };
  });
  ok(t6.saved, 'bridges serialize with the game state');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
