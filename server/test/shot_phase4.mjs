// Phase-4 review: street lamps glowing at night + junction traffic lights along
// roads, auto-added to player roads and removed with them. Not part of the suite.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/shots';
import { mkdirSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function lock(page, day){ return page.evaluate((day)=>{ const v=window.__sgview; v.gameDays=day?0.5:0.0; v.advanceClock=()=>{}; v._pickWeather=()=>{}; for(let i=0;i<6;i++) v.render(); }, day); }
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 850, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#btn-new'); await page.waitForSelector('#game:not(.hidden)');
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#sheet')?.classList.add('hidden'); document.querySelectorAll('#toast,.toast').forEach(t=>t.remove()); document.querySelector('#alerts')?.style.setProperty('display','none'); });

  // Pick a busy junction (a node with 3+ roads) and report lamp counts.
  const info = await page.evaluate(() => {
    const v = window.__sgview;
    const headCount = () => { let n=0; v._lampGroup?.traverse(o=>{ if(o.isMesh) n++; }); return n; };
    // a 3+ road junction near the dense grid
    let jn=-1; for (let n=0;n<v.navAdj.length;n++){ if(v.navAdj[n].length>=3){ jn=n; break; } }
    const node = jn>=0 ? v.navNodes[jn] : v.navNodes[0];
    // a lamp head world position to frame on
    let lampPos=null; v._lampGroup?.traverse(o=>{ if(!lampPos && o.isMesh){ o.geometry.computeBoundingBox(); } });
    return { meshes: headCount(), lights: (v.lights||[]).length, node: [node.x, node.z] };
  });
  console.log('lamp meshes:', info.meshes, 'traffic lights:', info.lights);

  // Demolish proof: add a player road, rebuild, count lamps; then remove it, count again.
  const proof = await page.evaluate(() => {
    const v = window.__sgview, W = 1600, N = v.land.length;
    const cnt = () => { let tris=0; v._lampGroup?.traverse(o=>{ if(o.isMesh) tris += o.geometry.index.count; }); return tris; };
    const before = cnt();
    // a long straight road across clear land
    const gy = Math.round(N*0.30);
    const pts = []; for (let gx=Math.round(N*0.30); gx<=Math.round(N*0.50); gx+=2) pts.push({ x:(gx/N-0.5)*W, z:(0.5-gy/N)*W });
    v.state.roads.edges.push({ a:0, b:0, ctrl:null, poly: pts, type:'road', lanes:2, elevated:false });
    v.rebuildRoadNet(); const withRoad = cnt();
    v.state.roads.edges.pop();                 // demolish that road
    v.rebuildRoadNet(); const afterRemove = cnt();
    return { before, withRoad, afterRemove };
  });
  console.log('lamp geometry (triangles*3) — before road:', proof.before, ' with new road:', proof.withRoad, ' after demolish:', proof.afterRemove);

  async function frame(name, world, theta, phi, radius, day){
    await page.evaluate(({world,theta,phi,radius})=>{ const v=window.__sgview; v.target.set(world[0],0,world[1]); v.cam.theta=theta; v.cam.phi=phi; v.cam.radius=radius; v.render(); }, {world,theta,phi,radius});
    await lock(page, day);
    await page.evaluate(()=>{ document.querySelector('#sheet')?.classList.add('hidden'); });
    await sleep(220);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }
  // Frame the dense central district (its shophouse windows are known to glow at
  // night) so we can confirm the street lamps light up alongside them.
  const town = await page.evaluate(() => {
    const v = window.__sgview;
    const decor = (v.heritagePlacements||[]).filter(p=>p.decor && p.mesh);
    let best=null,bn=-1; for(const p of decor){ let n=0; for(const q of decor){ if(Math.abs(q.gx-p.gx)<=4&&Math.abs(q.gy-p.gy)<=4)n++; } if(n>bn){bn=n;best=p;} }
    return best ? [best.mesh.position.x, best.mesh.position.z] : null;
  });
  // confirm the lamp head material is actually emitting after dark
  const glow = await page.evaluate(() => {
    const v = window.__sgview; v.gameDays = 0.0; v.advanceClock=()=>{}; v._pickWeather=()=>{}; for(let i=0;i<6;i++) v.render();
    let head=null; v._lampGroup.traverse(o=>{ if(o.isMesh && o.material.userData && o.material.userData.glowK>=1) head=o; });
    return head ? { glowK: head.material.userData.glowK, emissive: head.material.emissiveIntensity } : null;
  });
  console.log('lamp head emissive at midnight:', JSON.stringify(glow));
  // Lay one clear demo road on open land and frame it: the lamps line it every
  // ~17 m, alternating sides, glowing after dark.
  const demo = await page.evaluate(() => {
    const v = window.__sgview, W = 1600, N = v.land.length;
    const gy = Math.round(N*0.33); const pts=[];
    for (let gx=Math.round(N*0.34); gx<=Math.round(N*0.50); gx+=2) pts.push({ x:(gx/N-0.5)*W, z:(0.5-gy/N)*W });
    v.state.roads.edges.push({ a:0,b:0,ctrl:null, poly:pts, type:'road', lanes:2, elevated:false });
    v.rebuildRoadNet();
    const mid = pts[Math.floor(pts.length/2)];
    return [mid.x, mid.z];
  });
  await frame('p4-lamps-night', demo, -0.5, 0.62, 11, false);
  await frame('p4-lamps-day',   demo, -0.5, 0.62, 11, true);
  if (town) { await frame('p4-town-night', town, -0.7, 0.46, 42, false);
              await frame('p4-town-day',   town, -0.7, 0.46, 42, true); }
} catch (e) { console.error('shots failed:', e); }
finally { await browser.close(); server.close(); }
