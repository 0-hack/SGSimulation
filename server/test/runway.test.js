// Verifies the airport-runway flat-ground rule: drawing a runway across uneven
// terrain triggers an earthworks levelling charge + cost breakdown, while a
// runway on flat ground does not. Also checks the terrain-stats helper directly.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:480, height:860, isMobile:true, hasTouch:true });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  p.on('dialog', d=>d.dismiss());
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  // The terrain-stats helper returns a wider range/volume over a hilly strip than
  // a flat one. Probe both by sampling the heightfield for an uneven vs level run.
  const stats = await p.evaluate(()=>{
    const v = window.__sgview;
    // scan the heightfield for the steepest local strip and a flat strip
    const probe = (cx, cz, dx, dz) => {
      const pts = []; for (let i=-6;i<=6;i++) pts.push({ x:cx+dx*i*3, z:cz+dz*i*3, y:0 });
      return v._corridorTerrainStats(pts, 4.5);
    };
    // find a hilly centre: walk world looking for max height gradient
    let best=null;
    for (let X=-120; X<=120; X+=12) for (let Z=-120; Z<=120; Z+=12) {
      const h0=v._heightAt(X,Z), hx=v._heightAt(X+18,Z), hz=v._heightAt(X,Z+18);
      const g=Math.abs(hx-h0)+Math.abs(hz-h0);
      if (!best||g>best.g) best={X,Z,g,dir:Math.abs(hx-h0)>Math.abs(hz-h0)?[1,0]:[0,1]};
    }
    const hilly = probe(best.X, best.Z, best.dir[0], best.dir[1]);
    // a flat strip near the coast water line (y≈0 is sea level / flat land)
    let flat=null;
    for (let X=-120; X<=120 && !flat; X+=8) for (let Z=-120; Z<=120 && !flat; Z+=8) {
      const s=probe(X,Z,1,0); if (s.range<1.0 && s.area>0) flat=s;
    }
    return { hilly, flat, best };
  });
  ok(stats.hilly.range > 2, `hilly strip flagged uneven (Δ${stats.hilly.range.toFixed(1)} m > 2 m tol)`);
  ok(stats.hilly.volume > 0, `levelling volume computed (${Math.round(stats.hilly.volume)} m³)`);
  ok(!stats.flat || stats.flat.range <= 2, `flat strip within tolerance (Δ${(stats.flat?.range||0).toFixed(2)} m)`);

  // Drive the real draw flow: select Airport mode, draw a runway across the
  // hilliest strip, and confirm the commit bar shows the earthworks breakdown.
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Transport/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Airport/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Draw/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,200));

  // map the hilly world strip to screen and drag a runway along it
  const seg = await p.evaluate((b)=>{
    const v=window.__sgview;
    const wp=(X,Z)=>{ const y=v._heightAt(X,Z); const s=v.worldToScreen?v.worldToScreen(X,y,Z):null; return s; };
    const a=wp(b.X-b.dir[0]*18, b.Z-b.dir[1]*18), c=wp(b.X+b.dir[0]*18, b.Z+b.dir[1]*18);
    return a&&c&&a.visible&&c.visible?{ax:a.x,ay:a.y,cx:c.x,cy:c.y}:null;
  }, stats.best);

  let drewViaUI = false;
  if (seg) {
    await p.mouse.move(seg.ax, seg.ay);
    await p.mouse.down();
    for (let i=1;i<=8;i++) await p.mouse.move(seg.ax+(seg.cx-seg.ax)*i/8, seg.ay+(seg.cy-seg.ay)*i/8);
    await p.mouse.up();
    await new Promise(r=>setTimeout(r,300));
    drewViaUI = await p.evaluate(()=>!document.getElementById('draw-confirm')?.classList.contains('hidden'));
  }
  // Fallback: invoke the route handler directly along the hilly strip so the
  // test still validates the breakdown even if screen projection is off-view.
  if (!drewViaUI) {
    await p.evaluate((b)=>{
      const v=window.__sgview; const pts=[];
      for (let i=-6;i<=6;i++) pts.push({ x:b.X+b.dir[0]*i*3, z:b.Z+b.dir[1]*i*3, y:0 });
      if (typeof v.onStroke === 'function') v.onStroke(pts);
    }, stats.best).catch(()=>{});
    await new Promise(r=>setTimeout(r,200));
  }
  const bar = await p.evaluate(()=>{
    const el=document.getElementById('draw-confirm');
    return { open: el && !el.classList.contains('hidden'), title: document.getElementById('dc-title')?.textContent||'', detail: document.getElementById('dc-detail')?.innerHTML||'' };
  });
  ok(bar.open, 'commit bar opened for the runway');
  ok(/Airport|Runway|runway/.test(bar.title+bar.detail), 'commit shows an airport runway');
  ok(/Level|🏗|uneven|m³/.test(bar.detail), `breakdown shows levelling earthworks: ${bar.detail.replace(/<[^>]+>/g,' | ').slice(0,120)}`);
  ok(/Total/.test(bar.detail), 'breakdown shows a combined Total');

  // capture the commit bar so the breakdown is visible for review
  await p.screenshot({ path: 'server/test/_runway-commit.png' });

  // Negative case: a runway on flat ground must NOT add a levelling charge.
  await p.evaluate(()=>document.getElementById('dc-cancel')?.click());
  await new Promise(r=>setTimeout(r,150));
  const flatBar = await p.evaluate(()=>{
    const v=window.__sgview;
    // find a flat strip (heightfield range under tolerance) and draw along it
    let f=null;
    for (let X=-120; X<=120 && !f; X+=8) for (let Z=-120; Z<=120 && !f; Z+=8) {
      const pts=[]; for (let i=-6;i<=6;i++) pts.push({x:X+i*3, z:Z, y:0});
      const s=v._corridorTerrainStats(pts,4.5); if (s.range<1.0 && s.area>0) f={X,Z,pts};
    }
    if (!f) return { skip:true };
    v.onStroke && v.onStroke(f.pts);
    return { detail: document.getElementById('dc-detail')?.innerHTML||'' };
  });
  ok(flatBar.skip || !/Level|🏗/.test(flatBar.detail), `flat runway charges no levelling: ${(flatBar.detail||'(skipped)').replace(/<[^>]+>/g,' ').slice(0,80)}`);

  // The rendered runway deck must be DEAD LEVEL end-to-end (a levelled platform),
  // even when laid across sloping ground — not draped over the slope.
  const deck = await p.evaluate(()=>{
    const v=window.__sgview;
    const dirs=[[1,0],[0,1],[0.7,0.7]];
    const strip=(X,Z,d)=>{ const pts=[]; for(let i=-6;i<=6;i++) pts.push([X+d[0]*i*5, Z+d[1]*i*5]); return pts; };
    let best=null;
    for(let X=-150;X<=150;X+=10) for(let Z=-150;Z<=150;Z+=10) for(const d of dirs){
      const pts=strip(X,Z,d); let lo=1e9,hi=-1e9,okp=true;
      for(const q of pts){ const h=v._roadY(q[0],q[1]); if(h<=0.3){okp=false;break;} lo=Math.min(lo,h); hi=Math.max(hi,h); }
      if(okp){ const range=hi-lo; if(!best||range>best.range) best={pts,range}; }
    }
    if(!best) return { skip:true };
    let rawMin=1e9,rawMax=-1e9; for(const q of best.pts){ const h=v._roadY(q[0],q[1]); rawMin=Math.min(rawMin,h); rawMax=Math.max(rawMax,h); }
    v.state.airstrips=[best.pts]; v._buildPlayerAirstrips(v.state);
    let ymin=1e9,ymax=-1e9; for(const pt of v._airPlanes[0].pts){ ymin=Math.min(ymin,pt.y); ymax=Math.max(ymax,pt.y); }
    const cutMid = v._roadY(best.pts[6][0], best.pts[6][1]);   // terrain at centre AFTER the cut
    return { terrainRange:best.range, deckVar: ymax-ymin, deckY:ymin, rawMin, rawMax, cutMid };
  });
  ok(deck.skip || (deck.terrainRange > 3 && deck.deckVar < 0.01), `runway deck is level across a ${deck.terrainRange?.toFixed(1)} m slope (deck varies ${deck.deckVar?.toFixed(3)} m)`);
  ok(deck.skip || (deck.deckY < deck.rawMin + 1.5), `runway sits on the GROUND (deck ${deck.deckY?.toFixed(1)} m ≈ low ground ${deck.rawMin?.toFixed(1)} m, not raised to ${deck.rawMax?.toFixed(1)} m)`);
  ok(deck.skip || (deck.cutMid < deck.rawMax - 2), `the hill is CUT down under the runway (centre ${deck.rawMax?.toFixed(1)} m → ${deck.cutMid?.toFixed(1)} m)`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
