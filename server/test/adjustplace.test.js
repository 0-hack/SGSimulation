// Place-then-adjust: tapping the map PLACES a pending object (nothing charged yet)
// that you can rotate, move and remove, committing only on ✓ Done. MRT stations
// snap onto a drawn MRT line so they link up.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:520, height:880, isMobile:true, hasTouch:true });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  // Drive the build API directly (robust vs screen taps), exercising the real handlers.
  const r = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const S = window.__sg;
    const clear = (x,y) => v.isLand(x,y) && !v.buildings.has(`${x},${y}`) && !v.isRoadAt(x,y) && !(v.heritageMask&&v.heritageMask[y][x]) && !v.state.grid[y][x];
    // three distinct clear cells: place, move-target, remove-target
    const cy = Math.round(N*0.42); const clears = [];
    for (let x=Math.round(N*0.42); x<N*0.42+40 && clears.length<3; x++){ if (clear(x,cy)) clears.push(x); }
    const [cx, mx, rx] = clears;
    S.selectBuilding('hdb_flat');
    const t0 = v.state.treasury;
    S.onTileTap(cx, cy);                          // tap → pending (not charged)
    const pending = v.adjustActive(), chargedYet = v.state.treasury !== t0, inGrid0 = !!v.state.grid[cy][cx];
    const rotBefore = S.adjust.rot;
    S.rotateAdjust(Math.PI/6); S.rotateAdjust(Math.PI/6);   // rotate the placed object
    const rotChanged = Math.abs(S.adjust.rot - rotBefore) > 1e-6 && Math.abs(v._adjust.mesh.rotation.y - S.adjust.rot) < 1e-6;
    S.onTileTap(mx, cy);                          // tap a new spot → moves the pending
    const moved = S.adjust.x === mx && v._adjust.x === mx;
    S.commitAdjust();                             // ✓ Done → charge + build + clear pending
    const charged = v.state.treasury < t0, inGrid = !!v.state.grid[cy][mx], cleared = !v.adjustActive();
    const keptRot = inGrid && Math.abs((v.state.grid[cy][mx].r||0) - (rotBefore + Math.PI/3)) < 1e-6;
    // remove path: place again then cancel — no charge, no grid cell
    const t1 = v.state.treasury;
    S.selectBuilding('hdb_flat'); S.onTileTap(rx, cy); const placed2 = v.adjustActive();
    S.cancelAdjust('x'); const refunded = v.state.treasury === t1 && !v.adjustActive() && !v.state.grid[cy][rx];
    return { pending, chargedYet, inGrid0, rotChanged, moved, charged, inGrid, cleared, keptRot, placed2, refunded };
  });
  ok(r.pending && !r.chargedYet && !r.inGrid0, 'a tap places a PENDING object — nothing charged, nothing in the grid yet');
  ok(r.rotChanged, 'Rotate turns the placed object on the ground');
  ok(r.moved, 'tapping a new spot MOVES the placed object');
  ok(r.charged && r.inGrid && r.cleared, '✓ Done commits it: charged, built at the moved spot, pending cleared');
  ok(r.keptRot, 'the chosen rotation is kept on the committed building');
  ok(r.placed2 && r.refunded, 'Remove discards the pending object with no charge and no grid cell');

  // MRT station snaps onto a drawn MRT line (links up).
  const m = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length, W = 1600;
    const w=(gx,gy)=>[(gx/N-0.5)*W,(0.5-gy/N)*W];
    const cy=Math.round(N*0.36), x0=Math.round(N*0.40), x1=Math.round(N*0.48);
    const line=[]; for(let gx=x0;gx<=x1;gx++) line.push(w(gx,cy));
    v.state.railways=(v.state.railways||[]); v.state.railways.push({pts:line, elevated:true, mrt:true});
    v._buildPlayerRailways(v.state);
    S.selectBuilding('mrt');
    // tap a few cells AWAY from the line; the station should snap ONTO it
    S.onTileTap(Math.round((x0+x1)/2), cy+2);
    const onLine = v.adjustActive() && Math.abs(S.adjust.y - cy) <= 1;   // snapped back to the line row
    S.cancelAdjust();
    return { onLine };
  });
  ok(m.onLine, 'placing an MRT station near the drawn MRT line snaps it onto the line (links)');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
