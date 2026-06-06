// Quick views of the east-side airport: a top-down locator + close 45° angles.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
import { mkdirSync } from 'node:fs';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/airport';
mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.$eval('#m-nation', (e) => { e.value = ''; });
  await page.type('#m-nation', 'Singapura');
  await page.type('#m-owner', 'Aviator');
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(800);
  const tgt = await page.evaluate(() => {
    const v = window.__sgview;
    document.querySelector('#sheet')?.classList.add('hidden');
    document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
    document.querySelector('#alerts')?.style.setProperty('display', 'none');
    v.weather = { type: 'sunny', cloud: 0.08, rain: 0, wind: 0.2, windDir: 0.6 };
    v._wTarget = { cloud: 0.08, rain: 0, wind: 0.2 }; v._weatherTimer = 1e9;
    v.gameDays = 8; v.advanceClock = () => {};
    return v._airportCenter || { cx: 55, cz: 17.5 };
  });

  const shot = async (name, { tx, tz, theta, phi, r }) => {
    await page.evaluate(({ tx, tz, theta, phi, r }) => {
      const v = window.__sgview;
      v.gameDays = 8; v.target.set(tx, 6, tz);
      v.cam.theta = theta; v.cam.phi = phi; v.cam.radius = r; v.render(); v.render();
    }, { tx, tz, theta, phi, r });
    await sleep(250);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  };

  const WORLD = await page.evaluate(() => window.__sgview.land.length * 10);
  await shot('00-locator', { tx: 0, tz: 0, theta: 0.0, phi: 0.32, r: WORLD * 1.25 });
  await shot('00b-airport-top', { tx: tgt.cx, tz: tgt.cz, theta: tgt.rot || 0, phi: 0.18, r: 150 });
  const angles = [[1, 0.6], [2, 2.0], [3, 3.5], [4, 5.0]];
  for (const [k, th] of angles) await shot(`0${k}-close-${k}`, { tx: tgt.cx, tz: tgt.cz, theta: th, phi: Math.PI / 4, r: 130 });
  console.log('ERRORS', errs.slice(0, 5));
} catch (e) {
  console.error('airport shots failed:', e);
} finally {
  await browser.close();
  server.close();
}
