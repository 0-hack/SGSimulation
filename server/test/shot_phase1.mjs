// Phase-1 review shots: real demolishable shophouses (day + night glow) and the
// rectangular long-corridor HDB slabs. Not part of the test suite.
import puppeteer from 'puppeteer';
import { app } from '../server.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/shots';
import { mkdirSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lock(page, day) {
  return page.evaluate((day) => {
    const v = window.__sgview;
    v.gameDays = day ? 0.5 : 0.0;     // 0.5 = midday, 0.0 = midnight
    v.advanceClock = () => {};         // freeze the running loop's clock
    v._pickWeather = () => {};         // and weather, so it can't drift to overcast
    for (let i=0;i<4;i++) v.render();
  }, day);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(800);
  await page.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('hidden');
    document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
    document.querySelector('#alerts')?.style.setProperty('display','none');
  });

  // Find the densest decorative-shophouse pocket (use mesh world positions), and an HDB slab.
  const targets = await page.evaluate(() => {
    const v = window.__sgview;
    const decor = (v.heritagePlacements||[]).filter(p=>p.decor && p.mesh);
    // pick the cell with the most decor neighbours within a small radius — the dense core
    let best=null, bestN=-1;
    for (const p of decor){
      let n=0; for (const q of decor){ if(Math.abs(q.gx-p.gx)<=4 && Math.abs(q.gy-p.gy)<=4) n++; }
      if(n>bestN){ bestN=n; best=p; }
    }
    const c = { x: best.mesh.position.x, z: best.mesh.position.z };
    // find an HDB slab placement (named landmark seeded into grid) by scanning placements meshes
    let hdb=null;
    const named = (v.heritagePlacements||[]).filter(p=>!p.decor && p.mesh);
    for (const p of named){ if(p.key==='hdb_newtown'||p.key==='hdb_flat'){ hdb={ k:p.key, w:{x:p.mesh.position.x, z:p.mesh.position.z} }; break; } }
    return { c, core:bestN, hdb };
  });
  console.log('shophouse dense-core neighbours', targets.core, 'hdb', targets.hdb && targets.hdb.k);

  async function frame(name, world, theta, phi, radius, day) {
    await page.evaluate(({world, theta, phi, radius})=>{
      const v=window.__sgview;
      v.target.set(world.x, 0, world.z);
      v.cam.theta=theta; v.cam.phi=phi; v.cam.radius=radius;
      v.render();
    }, {world, theta, phi, radius});
    await lock(page, day);
    await page.evaluate(()=>{ document.querySelector('#sheet')?.classList.add('hidden'); });
    await sleep(250);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }

  // Shophouses — close up, day then night
  await frame('p1-shophouse-day',   targets.c, -0.7, 0.62, 28, true);
  await frame('p1-shophouse-night', targets.c, -0.7, 0.62, 28, false);
  await frame('p1-shophouse-wide',  targets.c, -0.7, 0.55, 60, false);
  // HDB slab — close, day then night
  if (targets.hdb) {
    await frame('p1-hdb-day',   targets.hdb.w, -0.4, 0.5, 44, true);
    await frame('p1-hdb-top',   targets.hdb.w,  0.0, 0.32, 40, true);
    await frame('p1-hdb-night', targets.hdb.w, -0.4, 0.55, 44, false);
  }
} catch (e) {
  console.error('shots failed:', e);
} finally {
  await browser.close();
  server.close();
}
