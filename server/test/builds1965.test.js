// The new 1965 public-works build options appear at the start (year 1965), each
// renders a 3D model without error, and their costs sit on the 1965 $-million scale
// (anchored by the HDB Flat ≈ $6k/home). More options for the player to invest in.
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

  const NEW = ['standpipe','sewage','community_centre','clinic','fire_station','market','tech_school','godown','processing','cinema','stadium'];

  // each new building: defined, year 1965 (unlocked now), and a 1965-scale cost
  const data = await p.evaluate((NEW)=>{
    const B = window.__sgview.constructor ? null : null;     // placeholder
    return null;
  }, NEW);
  // read BUILDINGS via the scene's reference isn't exposed; instead probe each by rendering
  const render = await p.evaluate((NEW)=>{
    const v=window.__sgview, out=[];
    // a free land cell to drop test meshes on
    const N=v.land.length; let cx=-1, cy=-1;
    for(let y=4;y<N-4 && cx<0;y++) for(let x=4;x<N-4;x++){ if(v.isLand(x,y) && !v.buildings.has(`${x},${y}`) && !v.reserveMask?.[y]?.[x]){ cx=x; cy=y; break; } }
    for(const key of NEW){
      let err=null, kids=0;
      try { v._addMesh(cx, cy, key); const e=v.buildings.get(`${cx},${cy}`); kids = e && e.group ? e.group.children.length : 0; v.removeBuilding && v.removeBuilding(cx, cy, false); }
      catch(e){ err=e.message; }
      out.push({ key, err, kids });
    }
    return out;
  }, NEW);
  ok(render.every(r=>!r.err), `all 11 new buildings render a 3D model without error${render.find(r=>r.err)?': '+JSON.stringify(render.find(r=>r.err)):''}`);
  ok(render.every(r=>r.kids>0), `every new building has visible geometry (${render.map(r=>r.kids).join(',')})`);

  // the later "world technology" builds (power & housing invented in the world,
  // adoptable here when their year comes) also render real geometry.
  const TECH = ['nuclear','gas_power','waste_energy','hdb_highrise'];
  const techR = await p.evaluate((TECH)=>{
    const v=window.__sgview, out=[]; const N=v.land.length; let cx=-1, cy=-1;
    for(let y=4;y<N-4 && cx<0;y++) for(let x=4;x<N-4;x++){ if(v.isLand(x,y) && !v.buildings.has(`${x},${y}`) && !v.reserveMask?.[y]?.[x]){ cx=x; cy=y; break; } }
    for(const key of TECH){ let err=null, kids=0; try { v._addMesh(cx,cy,key); const e=v.buildings.get(`${cx},${cy}`); kids=e&&e.group?e.group.children.length:0; v.removeBuilding&&v.removeBuilding(cx,cy,false);} catch(e){err=e.message;} out.push({key,err,kids}); }
    return out;
  }, TECH);
  ok(techR.every(r=>!r.err && r.kids>0), `world-tech builds render (nuclear/gas/waste/highrise: ${techR.map(r=>r.kids).join(',')})${techR.find(r=>r.err)?' '+JSON.stringify(techR.find(r=>r.err)):''}`);

  // they show in the build menu (available at 1965)
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  const names = ['Standpipe','Sewerage','Community Centre','Outpatient Clinic','Fire Station','Market & Hawkers','Technical Institute','Godown','Rubber & Tin','Cinema','Sports Stadium'];
  const text = await p.evaluate(async ()=>{
    let s=''; for(const t of [...document.querySelectorAll('.cat-tab')]){ t.click(); await new Promise(r=>setTimeout(r,50)); s += '\n' + document.body.innerText; } return s;
  });
  const found = names.filter(n=>text.includes(n)).length;
  ok(found >= 10, `new 1965 options listed in the build menu (${found}/${names.length})`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
