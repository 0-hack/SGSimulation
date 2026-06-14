// Verifies the railway grading rule: a railway across uneven ground is laid on a
// SMOOTH straight grade and the hill in the way is CUT down to it (with an earthwork
// cost breakdown) — like a runway. No tunnels. A flat railway needs no flattening.
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

  // hilliest strip + its grading profile
  const probe = await p.evaluate(()=>{
    const v=window.__sgview;
    const dirs=[[1,0],[0,1],[0.7,0.7],[0.7,-0.7]];
    const strip=(X,Z,d)=>{ const pts=[]; for(let i=-7;i<=7;i++) pts.push({x:X+d[0]*i*4, z:Z+d[1]*i*4}); return pts; };
    let best=null;
    for(let X=-120;X<=120;X+=10) for(let Z=-120;Z<=120;Z+=10) for(const d of dirs){ const pr=v._railProfile(strip(X,Z,d),1.4); if(!best||pr.cutMax>best.cutMax) best={X,Z,d,cutMax:pr.cutMax,earth:pr.earthVolume}; }
    return best;
  });
  ok(probe.cutMax > 3, `rail profile detects a hill above the grade line (cut up to ${probe.cutMax.toFixed(1)} m)`);
  ok(probe.earth > 0, `earthwork volume to flatten it computed (${Math.round(probe.earth)} m³)`);

  // draw a railway over the hill → commit bar shows the flatten breakdown, single Build
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Railway/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Draw/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));
  const bar = await p.evaluate((b)=>{
    const v=window.__sgview; const pts=[];
    for(let i=-7;i<=7;i++) pts.push({x:b.X+b.d[0]*i*4, z:b.Z+b.d[1]*i*4, y:0});
    v.onStroke && v.onStroke(pts);
    const dyn=[...document.querySelectorAll('#dc-actions .dc-dyn')];
    return { open:!document.getElementById('draw-confirm').classList.contains('hidden'), detail:document.getElementById('dc-detail').innerHTML, dyn:dyn.length, buildVisible:!document.getElementById('dc-build').classList.contains('hidden') };
  }, probe);
  ok(bar.open && /flatten|🏗|graded/.test(bar.detail) && /m³/.test(bar.detail), `commit shows the flatten/earthwork breakdown: ${bar.detail.replace(/<[^>]+>/g,' ').slice(0,90)}`);
  ok(bar.dyn===0 && bar.buildVisible, 'a single Build (no Over/Tunnel choice — tunnels removed)');

  // build it and confirm the hill is CUT down to the smooth grade
  const built = await p.evaluate((b)=>{
    const v=window.__sgview;
    const pts=[]; for(let i=-7;i<=7;i++) pts.push([b.X+b.d[0]*i*4, b.Z+b.d[1]*i*4]);
    v._carves=null; v._railCarves=null;
    const prof=v._railProfile(pts.map(q=>({x:q[0],z:q[1]})),1.4);    // RAW grade + above
    let pk=0,pki=0; for(let i=0;i<prof.above.length;i++) if(prof.above[i]>pk){pk=prof.above[i];pki=i;}
    const peak=prof.dense[pki], gradeAtPeak=prof.grade[pki], rawAtPeak=v._roadY(peak.x,peak.z);
    v.state.railways=[{pts, tunnel:false}];
    v._buildPlayerRailways(v.state);                                 // sets carves + cuts the hill
    const cutAtPeak=v._roadY(peak.x,peak.z);                         // terrain AFTER the cut
    let dev=0; const g0=prof.grade[0], g1=prof.grade[prof.grade.length-1], n=prof.grade.length-1;
    for(let i=0;i<prof.grade.length;i++) dev=Math.max(dev, Math.abs(prof.grade[i]-(g0+(g1-g0)*i/n)));
    return { rawAtPeak:+rawAtPeak.toFixed(1), gradeAtPeak:+gradeAtPeak.toFixed(1), cutAtPeak:+cutAtPeak.toFixed(1), gradeDev:+dev.toFixed(3), kids:v._pRailGroup.children.length };
  }, probe);
  ok(built.kids > 0, 'graded railway rendered into the scene');
  ok(built.cutAtPeak < built.rawAtPeak - 2 && built.cutAtPeak < built.gradeAtPeak + 1.5, `the hill is CUT down to the grade (peak ${built.rawAtPeak} m → ${built.cutAtPeak} m, grade ${built.gradeAtPeak} m)`);
  ok(built.gradeDev < 0.01, `the track grade is a SMOOTH straight line (deviation ${built.gradeDev} m)`);

  // a flat railway needs no flattening — single plain Build, no earthwork line
  const flat = await p.evaluate(()=>{
    const v=window.__sgview;
    let f=null;
    for(let X=-120;X<=120 && !f;X+=8) for(let Z=-120;Z<=120 && !f;Z+=8){
      const pts=[]; for(let i=-7;i<=7;i++) pts.push({x:X+i*4,z:Z});
      const pr=v._railProfile(pts,1.4); if(pr.cutMax<1.0 && pr.len>0) f={pts:pts.map(q=>({x:q.x,z:q.z,y:0}))};
    }
    if(!f) return { skip:true };
    v.onStroke && v.onStroke(f.pts);
    return { skip:false, detail:document.getElementById('dc-detail').innerHTML, dyn:[...document.querySelectorAll('#dc-actions .dc-dyn')].length };
  });
  ok(flat.skip || (!/flatten|🏗/.test(flat.detail) && flat.dyn===0), `a flat railway needs no flattening: ${flat.skip?'(skipped)':flat.detail.replace(/<[^>]+>/g,' ').slice(0,50)}`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
