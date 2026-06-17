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
    return { meshes, before, withRoad, afterRemove, lights: (v.lights||[]).length, headEmissive };
  });

  ok(r.before > 0, `existing roads are lined with street lamps (${r.before} lamp triangles)`);
  ok(r.meshes > 0 && r.meshes <= 2, `lamps are merged into ≤2 meshes for performance (${r.meshes})`);
  ok(r.withRoad > r.before, `a new player road gets street lamps automatically (${r.before} → ${r.withRoad})`);
  ok(r.afterRemove === r.before, `demolishing the road removes its lamps too (back to ${r.afterRemove})`);
  ok(r.lights > 0, `junctions carry traffic lights (${r.lights})`);
  ok(r.headEmissive > 0, `street lamps glow after dark (emissive ${r.headEmissive})`);
  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
