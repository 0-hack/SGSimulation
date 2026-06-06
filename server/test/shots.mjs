// Ad-hoc screenshot script: boots the client, starts a nation, captures the
// 3D island from several camera angles. Not part of the test suite.
import puppeteer from 'puppeteer';
import { app } from '../server.js';

const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const outDir = process.env.SHOT_DIR || '/tmp/shots';
import { mkdirSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  ],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.$eval('#m-nation', (e) => { e.value = ''; });
  await page.type('#m-nation', 'Singapura');
  await page.type('#m-owner', 'Cartographer');
  await page.click('#btn-new');
  await page.waitForSelector('#game:not(.hidden)');
  await sleep(800);

  // Close any open bottom sheet and clear toasts so the canvas is unobstructed.
  await page.evaluate(() => {
    document.querySelector('#sheet')?.classList.add('hidden');
    document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
    document.querySelector('#alerts')?.style.setProperty('display','none');
  });

  // Daytime, settle the scene.
  await page.evaluate(() => { const v = window.__sgview; v.timeOfDay = 0.45; v.render(); });

  const WORLD = await page.evaluate(() => window.__sgview.land.length * 10);

  // angle presets: [name, theta, phi, radiusFactor]
  const shots = [
    ['01-isometric',  -0.70, 0.92, 1.05],
    ['02-topdown',     0.00, 0.42, 1.00],
    ['03-from-east',   1.20, 0.78, 1.20],
    ['04-from-west',  -2.00, 0.78, 1.20],
    ['05-from-south',  3.14, 0.80, 1.20],
    ['06-from-north',  0.00, 0.80, 1.20],
  ];

  for (const [name, theta, phi, rf] of shots) {
    await page.evaluate(({ theta, phi, r }) => {
      const v = window.__sgview;
      v.target.set(0, 0, 0);
      v.cam.theta = theta; v.cam.phi = phi;
      v.cam.radius = Math.min(r, v.MAX_R);
      v.render(); v.render();
    }, { theta, phi, r: WORLD * rf });
    await page.evaluate(() => {
      document.querySelector('#sheet')?.classList.add('hidden');
      document.querySelectorAll('#toast, .toast').forEach((t) => t.remove());
      document.querySelector('#alerts')?.style.setProperty('display', 'none');
    });
    await sleep(300);
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('saved', name);
  }
} catch (e) {
  console.error('shots failed:', e);
} finally {
  await browser.close();
  server.close();
}
