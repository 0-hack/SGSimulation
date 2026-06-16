// Phase-2 review shots: a drawn MRT viaduct with a metro running on it, the old
// 1965 train station, and a heavy-rail train. Not part of the test suite.
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
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(700);
  await page.evaluate(() => { document.querySelector('#sheet')?.classList.add('hidden'); document.querySelectorAll('#toast,.toast').forEach(t=>t.remove()); document.querySelector('#alerts')?.style.setProperty('display','none'); });

  // Lay an MRT viaduct + a heavy railway + a train station into the live state in a
  // clear inland strip, then rebuild the rail/building meshes.
  const info = await page.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    // find a clear, flat-ish inland band
    const cy = Math.round(N*0.40);
    const c2w = (gx,gy)=>({ x:(gx/N - 0.5)*v.WORLD || (gx - N/2)*(1600/N), z:(0.5 - gy/N)*v.WORLD });
    // world helper using the same mapping as the engine (WORLD=1600)
    const W=1600, w=(gx,gy)=>[ (gx/N-0.5)*W, (0.5-gy/N)*W ];
    const x0 = Math.round(N*0.33), x1 = Math.round(N*0.52);
    // MRT line (mrt:true => elevated guideway) and a heavy railway just south of it
    const mrt = []; for (let x=x0;x<=x1;x++) mrt.push(w(x, cy-3));
    const rail = []; for (let x=x0;x<=x1;x++) rail.push(w(x, cy+4));
    v.state.railways = v.state.railways || [];
    v.state.railways.push({ pts: mrt, elevated:true, mrt:true });
    v.state.railways.push({ pts: rail, elevated:false, mrt:false });
    // a train station beside the railway, in a guaranteed-clear inland cell
    const sgx = x0 + 6, sgy = cy + 8;
    if (v.heritageMask && v.heritageMask[sgy]) v.heritageMask[sgy][sgx] = false;
    v.state.grid[sgy][sgx] = { k:'rail_station' };
    v._buildPlayerRailways(v.state);
    v.syncAll && v.syncAll();
    const mid = w(Math.round((x0+x1)/2), cy);
    const sw = w(sgx, sgy);
    return { trains: (v._trains||[]).length, mids: mid, station: sw };
  });
  console.log('trains running:', info.trains, 'station at', info.sgx, info.sgy);

  // Park each train mid-line, FREEZE motion (render skips _updateTrains when frozen)
  // so the train holds still for the shot, and read back live world positions.
  const live = await page.evaluate(() => {
    const v = window.__sgview;
    for (const tr of (v._trains||[])) { tr.u = 0.5; tr.dir = 1; }
    v.render();
    const out = (v._trains||[]).map(tr => { const c = tr.cars[0]; return { kind: tr.track.kind, x:c.position.x, y:c.position.y, z:c.position.z, vis:c.visible }; });
    v.frozen = true;                 // hold all moving parts still while we photograph
    return { trains: out };
  });
  console.log('train heads:', JSON.stringify(live.trains));

  async function frame(name, world, theta, phi, radius, day, ty=0){
    await page.evaluate(({world,theta,phi,radius,ty})=>{ const v=window.__sgview; v.target.set(world[0],ty,world[1]); v.cam.theta=theta; v.cam.phi=phi; v.cam.radius=radius; v.render(); }, {world,theta,phi,radius,ty});
    await lock(page, day);
    await page.evaluate(()=>{ document.querySelector('#sheet')?.classList.add('hidden'); });
    await sleep(250);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }
  const mrtT = live.trains.find(t=>t.kind==='mrt') || live.trains[0];
  const hvyT = live.trains.find(t=>t.kind==='train') || live.trains[0];
  await frame('p2-overview-day',   info.mids, -0.7, 0.5, 95, true);
  await frame('p2-overview-night', info.mids, -0.7, 0.5, 95, false);
  if (mrtT) { await frame('p2-mrt-train', [mrtT.x, mrtT.z], -0.7, 0.7, 11, true, mrtT.y+1);
              await frame('p2-mrt-night', [mrtT.x, mrtT.z], -0.7, 0.7, 11, false, mrtT.y+1); }
  if (hvyT) { await frame('p2-heavy-train', [hvyT.x, hvyT.z], -0.7, 0.66, 10, true, hvyT.y+1); }
  // the old 1965 train station
  await frame('p2-station', info.station, -0.8, 0.64, 15, true, 2);
  await frame('p2-station-night', info.station, -0.8, 0.64, 15, false, 2);
} catch (e) { console.error('shots failed:', e); }
finally { await browser.close(); server.close(); }
