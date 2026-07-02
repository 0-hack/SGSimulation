// Street lamps + junction traffic lights are derived from the live road network:
// they line every surface road, glow after dark, are added automatically to a
// player's new road, and are removed when that road is demolished (the whole
// furniture group is rebuilt on each road change). Built as 2 merged meshes.
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
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  const r = await p.evaluate(() => {
    const v = window.__sgview, W = 1600, N = v.land.length;
    const tris = () => { let t=0; v._lampGroup?.traverse(o=>{ if(o.isMesh) t += o.geometry.index.count; }); return t; };
    let meshes=0; v._lampGroup?.traverse(o=>{ if(o.isMesh) meshes++; });
    const before = tris();
    // a player road across open land → lamps must appear along it
    const gy = Math.round(N*0.30); const pts=[];
    for (let gx=Math.round(N*0.30); gx<=Math.round(N*0.50); gx+=2) pts.push({ x:(gx/N-0.5)*W, z:(0.5-gy/N)*W });
    v.state.roads.edges.push({ a:0,b:0,ctrl:null, poly:pts, type:'road', lanes:2, elevated:false });
    v.rebuildRoadNet(); const withRoad = tris();
    v.state.roads.edges.pop();                       // demolish it
    v.rebuildRoadNet(); const afterRemove = tris();
    // the lamp heads glow after dark (ALL_MATS night pass drives emissiveIntensity)
    v.gameDays = 0.0; v.advanceClock=()=>{}; v._pickWeather=()=>{}; for(let i=0;i<4;i++) v.render();
    let headEmissive = 0; v._lampGroup?.traverse(o=>{ if(o.isMesh && (o.material.userData?.glowK??0) >= 1) headEmissive = o.material.emissiveIntensity; });
    // junction signal: a compact 1965 THREE-aspect light (red/amber/green) that cycles
    const lt = (v.lights||[])[0];
    let hasThree=false, sigH=99, cycles=false;
    if (lt && lt.lenses) {
      hasThree = !!(lt.lenses.red && lt.lenses.amber && lt.lenses.green);
      const grp = lt.lenses.green.parent; grp.updateMatrixWorld(true);
      let miny=1e9,maxy=-1e9; grp.traverse(o=>{ if(o.isMesh){ o.geometry.computeBoundingBox(); const b=o.geometry.boundingBox.clone(); b.applyMatrix4(o.matrixWorld); miny=Math.min(miny,b.min.y); maxy=Math.max(maxy,b.max.y);} });
      sigH = maxy - miny;
      lt.phase=0; lt.t=0; v._updateLights(0.001); const g0=lt.lenses.green.material.emissiveIntensity;
      lt.phase=1; v._updateLights(0.001); const r1=lt.lenses.red.material.emissiveIntensity, g1=lt.lenses.green.material.emissiveIntensity;
      cycles = g0>0.5 && r1>0.5 && g1<0.5;   // green lit on phase 0, red lit (green dark) on phase 1
    }
    return { meshes, before, withRoad, afterRemove, lights: (v.lights||[]).length, headEmissive, hasThree, sigH, cycles };
  });

  ok(r.before > 0, `existing roads are lined with street lamps (${r.before} lamp triangles)`);
  ok(r.meshes > 0 && r.meshes <= 2, `lamps are merged into ≤2 meshes for performance (${r.meshes})`);
  ok(r.withRoad > r.before, `a new player road gets street lamps automatically (${r.before} → ${r.withRoad})`);
  ok(r.afterRemove === r.before, `demolishing the road removes its lamps too (back to ${r.afterRemove})`);
  ok(r.lights > 0, `junctions carry traffic lights (${r.lights})`);
  ok(r.hasThree && r.cycles, 'junction signals are a 1965 THREE-aspect light (red/amber/green) that cycles');
  ok(r.sigH < 1.0, `the signal is compact/kerb-height (${r.sigH.toFixed(2)}u), not an oversized post`);
  ok(r.headEmissive > 0, `street lamps glow after dark (emissive ${r.headEmissive})`);
  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
