// Editing-mode smarts: (1) the Straight tool building a railway over a hill now
// routes through the drawn-route flow and offers the Over/Tunnel choice; (2) the
// draw cursor detects existing road ends/junctions (and railway/runway ends) to
// snap onto, so new routes connect.
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

  // (1) Railway via the STRAIGHT tool across a hill → Over/Tunnel choice.
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Railway/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));
  const tunnel = await p.evaluate(()=>{
    const v=window.__sgview;
    // find the strip crossing a summit (max terrain above the straight grade)
    const dirs=[[1,0],[0,1],[0.7,0.7],[0.7,-0.7]];
    const strip=(X,Z,d)=>{ const pts=[]; for(let i=-7;i<=7;i++) pts.push({x:X+d[0]*i*4, z:Z+d[1]*i*4}); return pts; };
    let best=null;
    for(let X=-120;X<=120;X+=10) for(let Z=-120;Z<=120;Z+=10) for(const d of dirs){ const pr=v._railProfile(strip(X,Z,d),2.0); if(!best||pr.maxAbove>best.maxAbove) best={X,Z,d,maxAbove:pr.maxAbove}; }
    // emulate the Straight tool: two ground taps a→b across the hill (the exact
    // path a real tap takes: roadMode tap → onGroundTap → addRoadEdge → onRouteDrawn)
    const a={x:best.X-best.d[0]*24, z:best.Z-best.d[1]*24}, b={x:best.X+best.d[0]*24, z:best.Z+best.d[1]*24};
    v.onGroundTap(a.x, a.z); v.onGroundTap(b.x, b.z);
    const acts=[...document.querySelectorAll('#dc-actions button')].filter(x=>!x.classList.contains('hidden'));
    return { maxAbove:best.maxAbove, open:!document.getElementById('draw-confirm').classList.contains('hidden'),
             labels:acts.map(x=>x.textContent.trim()), detail:document.getElementById('dc-detail').innerHTML };
  });
  ok(tunnel.maxAbove>2.5, `found a hill strip for the railway (${tunnel.maxAbove.toFixed(1)} m above grade)`);
  ok(tunnel.open && tunnel.labels.some(l=>/Over/.test(l)) && tunnel.labels.some(l=>/Tunnel/.test(l)), `straight-tool railway over a hill offers Over + Tunnel: ${JSON.stringify(tunnel.labels)}`);

  // (2) snap detection for the draw cursor.
  const snap = await p.evaluate(()=>{
    const v=window.__sgview;
    // a road node from the seeded 1966 network
    const n=v.navNodes[0];
    const before = v._drawSnap(n.x+1, n.z+1);   // road draw mode flags default
    v._drawRail=false; v._drawAir=false; v._drawArea=false;
    const roadSnap = v._drawSnap(n.x+1.5, n.z+1.5);
    // a railway end
    v.state.railways=[[[20,20],[60,20]]]; // legacy world poly
    v._drawRail=true;
    const railSnap = v._drawSnap(61, 21);
    v._drawRail=false;
    // far from anything → no snap
    const none = v._drawSnap(99999, 99999);
    return { roadSnap:!!roadSnap, roadKind:roadSnap&&roadSnap.kind, railSnap:!!railSnap, railKind:railSnap&&railSnap.kind, none:!!none };
  });
  ok(snap.roadSnap, `road draw cursor snaps onto an existing road feature (${snap.roadKind})`);
  ok(snap.railSnap && snap.railKind==='end', 'railway draw cursor snaps onto an existing railway end');
  ok(!snap.none, 'no snap when far from any route (cursor stays free)');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
