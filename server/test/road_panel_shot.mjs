// Screenshot proof: open Build → Roads and capture the mode buttons.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const out = process.env.SHOT || '/tmp/road_panel.png';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.error('pageerror:', e.message));
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new');
  await p.waitForSelector('#game:not(.hidden)');
  await sleep(500);

  // open Build, then the Roads category
  await p.click('.tool[data-panel="build"]');
  await p.waitForSelector('.cat-tab');
  await p.evaluate(() => [...document.querySelectorAll('.cat-tab')].find((t) => /Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-types .opt');
  await sleep(200);

  // dump the actual button labels to the console as text proof
  const labels = await p.evaluate(() => [...document.querySelectorAll('.road-types .opt')].map((b) => b.textContent.trim()));
  console.log('ROAD MODE BUTTONS:', JSON.stringify(labels));

  // screenshot just the bottom sheet (the Build panel)
  const sheet = await p.$('#sheet');
  await sheet.screenshot({ path: out });
  console.log('saved', out);
} catch (e) {
  console.error('shot failed:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
