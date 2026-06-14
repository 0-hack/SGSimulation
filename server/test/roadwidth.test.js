// Verifies a drawn road keeps a CONSTANT perpendicular width through its bends
// (the miter join), by measuring the rendered road mesh on a wavy centre-line.
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

  const r = await p.evaluate(()=>{
    const v=window.__sgview;
    // ONE wavy road on a fresh graph (no traced roads) so the road mesh is just this
    const poly=[]; for(let i=0;i<=40;i++) poly.push({ x:-80+i*4, z: Math.sin(i*0.5)*14 });
    v.state.roads = { nodes:[{x:poly[0].x,z:poly[0].z,y:0},{x:poly[40].x,z:poly[40].z,y:0}], edges:[{a:0,b:1,poly,type:'road',lanes:2}], islands:[] };
    v.rebuildRoadNet();
    const hw = (v.constructor, 0.34);                 // ROAD_TYPES.road.renderHW
    // find the road mesh (2 verts per centre point)
    let mesh=null; v.roadGroup.traverse(o=>{ if(o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count===poly.length*2) mesh=o; });
    if(!mesh) return { found:false };
    const pos=mesh.geometry.attributes.position.array;
    const Vx=(k)=>pos[3*k], Vz=(k)=>pos[3*k+2];
    const widths=[];
    for(let i=0;i<poly.length-1;i++){
      const dx=poly[i+1].x-poly[i].x, dz=poly[i+1].z-poly[i].z, l=Math.hypot(dx,dz)||1, nx=-dz/l, nz=dx/l;
      const w=Math.abs((Vx(2*i)-Vx(2*i+1))*nx + (Vz(2*i)-Vz(2*i+1))*nz);   // perpendicular width
      widths.push(w);
    }
    let mn=1e9,mx=-1e9,sum=0; for(const w of widths){ mn=Math.min(mn,w); mx=Math.max(mx,w); sum+=w; }
    return { found:true, hw, target:hw*2, min:mn, max:mx, mean:sum/widths.length, spread:mx-mn };
  });
  ok(r.found, 'rendered the wavy road mesh');
  ok(r.found && Math.abs(r.mean - r.target) < 0.06, `road width matches the fixed size (${r.mean?.toFixed(3)} m ≈ ${r.target?.toFixed(3)} m)`);
  ok(r.found && r.spread < 0.05, `width is CONSTANT through the bends (spread ${r.spread?.toFixed(3)} m, min ${r.min?.toFixed(3)} / max ${r.max?.toFixed(3)})`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
