// Phase-3 review shots: the world-technology builds (nuclear, combined-cycle gas,
// waste-to-energy, modern HDB point blocks) and the economy-driven fleet (a
// developed 2015 nation running sleek contemporary cars). Not part of the suite.
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
  await page.setViewport({ width: 1200, height: 850, deviceScaleFactor: 1.4 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#btn-new'); await page.waitForSelector('#game:not(.hidden)');
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#sheet')?.classList.add('hidden'); document.querySelectorAll('#toast,.toast').forEach(t=>t.remove()); document.querySelector('#alerts')?.style.setProperty('display','none'); });

  // Drop the four world-tech buildings in a clear inland row, then frame each.
  const info = await page.evaluate(() => {
    const v = window.__sgview, N = v.land.length, W = 1600;
    const w = (gx,gy)=>[ (gx/N-0.5)*W, (0.5-gy/N)*W ];
    const cy = Math.round(N*0.42);
    const keys = ['nuclear','gas_power','waste_energy','hdb_highrise'];
    const placed = {};
    let gx0 = Math.round(N*0.36);
    for (let i=0;i<keys.length;i++){ const gx=gx0+i*5, gy=cy; if(v.heritageMask&&v.heritageMask[gy]) v.heritageMask[gy][gx]=false; v.state.grid[gy][gx]={k:keys[i]}; placed[keys[i]]=w(gx,gy); }
    v.syncAll && v.syncAll();
    return { placed };
  });

  async function frame(name, world, theta, phi, radius, day, ty=0){
    await page.evaluate(({world,theta,phi,radius,ty})=>{ const v=window.__sgview; v.target.set(world[0],ty,world[1]); v.cam.theta=theta; v.cam.phi=phi; v.cam.radius=radius; v.render(); }, {world,theta,phi,radius,ty});
    await lock(page, day);
    await page.evaluate(()=>{ document.querySelector('#sheet')?.classList.add('hidden'); });
    await sleep(220);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }
  await frame('p3-nuclear', info.placed.nuclear, -0.6, 0.6, 17, true, 5);
  await frame('p3-gas', info.placed.gas_power, -0.7, 0.55, 28, true, 4);
  await frame('p3-waste', info.placed.waste_energy, -0.7, 0.55, 30, true, 4);
  await frame('p3-highrise', info.placed.hdb_highrise, -0.7, 0.6, 34, true, 6);
  await frame('p3-tech-row', [ (info.placed.gas_power[0]+info.placed.waste_energy[0])/2, info.placed.gas_power[1] ], -0.7, 0.5, 80, true, 4);

  // Economy-driven fleet: push the nation to a developed 2015 and show the sleek
  // contemporary cars a strong economy imports. Freeze on one car so it holds still.
  const car = await page.evaluate(() => {
    const v = window.__sgview;
    v.state.date.y = 2015; v.state.education = 88; v.state.treasury = 2500; v.state.approval = 72;
    v._fleet = null;
    for (let i=0;i<50;i++) v.render();        // let contemporary cars spawn & spread out
    const cars = (v.vehicles||[]).filter(a=>a.kind==='car'||a.kind==='taxi');
    const a = cars[Math.floor(cars.length/2)] || (v.vehicles||[])[0];
    v.frozen = true;                          // hold the fleet still for the photo
    return a ? { x:a.mesh.position.x, z:a.mesh.position.z, n:cars.length } : null;
  });
  console.log('contemporary cars on the road:', car && car.n);
  if (car) await frame('p3-fleet-2015', [car.x, car.z], -0.5, 0.62, 14, true, 0.6);
} catch (e) { console.error('shots failed:', e); }
finally { await browser.close(); server.close(); }
