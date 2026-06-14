// Verifies the railway tunnel rule: a line drawn across high ground offers a
// choice — run OVER the hill (cheaper) or bore a TUNNEL through it (costs extra).
// Checks the profile maths, the two-option commit bar, the carried tunnel flag,
// and that a tunnelled railway renders with portals (and legacy data still works).
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

  // Find the strip that crosses a summit (maximises terrain above the straight
  // grade) — i.e. the spot where a tunnel makes sense — by scoring rail profiles.
  const probe = await p.evaluate(()=>{
    const v = window.__sgview;
    const dirs=[[1,0],[0,1],[0.7,0.7],[0.7,-0.7]];
    const strip=(X,Z,d)=>{ const pts=[]; for (let i=-7;i<=7;i++) pts.push({x:X+d[0]*i*4, z:Z+d[1]*i*4}); return pts; };
    let best=null;
    for (let X=-120; X<=120; X+=10) for (let Z=-120; Z<=120; Z+=10) for (const d of dirs) {
      const pr=v._railProfile(strip(X,Z,d), 2.0);
      if (!best || pr.maxAbove>best.maxAbove) best={ X, Z, dir:d, maxAbove:pr.maxAbove, boreVolume:pr.boreVolume, buriedLen:pr.buriedLen, buriedCount:pr.buried.filter(Boolean).length };
    }
    return { best, maxAbove:best.maxAbove, boreVolume:best.boreVolume, buriedLen:best.buriedLen, buriedCount:best.buriedCount };
  });
  ok(probe.maxAbove > 3, `rail profile detects high ground (max ${probe.maxAbove.toFixed(1)} m above grade)`);
  ok(probe.boreVolume > 0 && probe.buriedCount > 0, `bore volume + buried length computed (${Math.round(probe.boreVolume)} m³, ${Math.round(probe.buriedLen)} m)`);

  // Draw a railway over the hill and confirm the two-choice commit bar.
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Railway/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Draw/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));
  const draw = await p.evaluate((b)=>{
    const v=window.__sgview; const pts=[];
    for (let i=-7;i<=7;i++) pts.push({ x:b.X+b.dir[0]*i*4, z:b.Z+b.dir[1]*i*4, y:0 });
    v.onStroke && v.onStroke(pts);
    const acts=[...document.querySelectorAll('#dc-actions button')].filter(x=>!x.classList.contains('hidden'));
    return { open:!document.getElementById('draw-confirm').classList.contains('hidden'),
             detail: document.getElementById('dc-detail')?.innerHTML||'',
             labels: acts.map(x=>x.textContent.trim()) };
  }, probe.best);
  ok(draw.open, 'commit bar opened for the hill-crossing railway');
  ok(draw.labels.some(l=>/Over/.test(l)) && draw.labels.some(l=>/Tunnel/.test(l)), `offers Over + Tunnel choices: ${JSON.stringify(draw.labels)}`);
  ok(/Tunnel/.test(draw.detail) && /Over/.test(draw.detail) && /m³/.test(draw.detail), 'breakdown explains over vs tunnel with bore volume');

  await p.screenshot({ path: 'server/test/_railtunnel-commit.png' });

  // Pick the Tunnel option → a rail roadwork is queued carrying tunnel:true.
  const queued = await p.evaluate(()=>{
    const btn=[...document.querySelectorAll('#dc-actions button')].find(b=>/Tunnel/.test(b.textContent));
    btn && btn.click();
    const rw=(window.__sgview.state.roadworks||[]).filter(w=>w.kind==='rail');
    return { count: rw.length, tunnel: rw.length? !!rw[rw.length-1].tunnel : false };
  });
  ok(queued.count >= 1 && queued.tunnel, 'choosing Tunnel queues a rail roadwork with tunnel flag set');

  // Render a finished tunnelled railway and confirm portals appear; legacy
  // array railways must still render (backward compatibility).
  const render = await p.evaluate((b)=>{
    const v=window.__sgview;
    const pts=[]; for (let i=-7;i<=7;i++) pts.push([b.X+b.dir[0]*i*4, b.Z+b.dir[1]*i*4]);
    v.state.railways = [ { pts, tunnel:true }, pts.map(q=>[q[0]+8,q[1]+8]) ];  // tunnelled + legacy array
    v._buildPlayerRailways(v.state);
    // a portal group contains a CylinderGeometry (the bore) — count them
    let bores=0, total=0;
    v._pRailGroup.traverse(o=>{ total++; if (o.geometry && o.geometry.type==='CylinderGeometry') bores++; });
    return { children: v._pRailGroup.children.length, bores, total };
  }, probe.best);
  ok(render.children > 0, 'tunnelled + legacy railways rendered into the scene');
  ok(render.bores >= 2, `tunnel portals rendered (${render.bores} bore mouths for entry/exit)`);

  // A railway on flat ground must NOT offer a tunnel (single Build button).
  const flat = await p.evaluate(()=>{
    const v=window.__sgview;
    let f=null;
    for (let X=-120; X<=120 && !f; X+=8) for (let Z=-120; Z<=120 && !f; Z+=8) {
      const pts=[]; for (let i=-7;i<=7;i++) pts.push({x:X+i*4,z:Z});
      const pr=v._railProfile(pts,2.0); if (pr.maxAbove<1.5 && pr.len>0) f={X,Z,pts:pts.map(q=>({x:q.x,z:q.z,y:0}))};
    }
    if (!f) return { skip:true };
    v.onStroke && v.onStroke(f.pts);
    const dynBtns=[...document.querySelectorAll('#dc-actions .dc-dyn')];
    const buildVisible=!document.getElementById('dc-build').classList.contains('hidden');
    return { skip:false, dyn:dynBtns.length, buildVisible, detail:document.getElementById('dc-detail').innerHTML };
  });
  ok(flat.skip || (flat.dyn===0 && flat.buildVisible), `flat railway shows a single Build (no tunnel choice): ${flat.skip?'(skipped)':JSON.stringify({dyn:flat.dyn})}`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
