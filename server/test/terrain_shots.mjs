// Close-up 45° orbit of the Central Catchment terrain, from 8 angles around it.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
import { mkdirSync } from 'node:fs';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/terrain';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.$eval('#m-nation', (e) => { e.value = ''; });
  await page.type('#m-nation', 'Singapura');
  await page.type('#m-owner', 'Surveyor');
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(800);
  await page.click('.spd[data-spd="0"]').catch(() => {});   // pause the clock
  await page.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('hidden');
    document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
    document.querySelector('#alerts')?.style.setProperty('display', 'none');
    const v = window.__sgview;
    v.weather = { type: 'sunny', cloud: 0.08, rain: 0, wind: 0.2, windDir: 0.6 };
    v._wTarget = { cloud: 0.08, rain: 0, wind: 0.2 };
    v._weatherTimer = 1e9;            // lock clear skies for the shots
    v.gameDays = 8;                  // DAY_CYCLE/2 -> noon (timeOfDay is derived from gameDays)
    v.advanceClock = () => {};       // freeze the clock so the sun stays at noon
    v.render();
  });

  // terrain centre (HILL_CENTER ~[0.412,0.498]) -> world target
  const tgt = await page.evaluate(() => {
    const v = window.__sgview, WORLD = v.land.length * 10;
    return { x: (0.412 - 0.5) * WORLD, z: (0.5 - 0.498) * WORLD };
  });

  const N = 8, PHI = Math.PI / 4;     // 45° elevation
  const RADIUS = 340;                 // frames the whole massif with some context
  for (let k = 0; k < N; k++) {
    const theta = (k / N) * Math.PI * 2;
    await page.evaluate(({ tx, tz, theta, phi, r }) => {
      const v = window.__sgview;
      v.gameDays = 8;                  // keep it pinned at noon
      v.target.set(tx, 4, tz);
      v.cam.theta = theta; v.cam.phi = phi; v.cam.radius = r;
      v.render(); v.render();
    }, { tx: tgt.x, tz: tgt.z, theta, phi: PHI, r: RADIUS });
    await sleep(250);
    const deg = Math.round((theta * 180) / Math.PI);
    const name = `angle-${String(k + 1).padStart(2, '0')}-${String(deg).padStart(3, '0')}deg`;
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }
} catch (e) {
  console.error('terrain shots failed:', e);
} finally {
  await browser.close();
  server.close();
}
