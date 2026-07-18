// Where does the WET model say the channel's north edge is at the third stub,
// and does the riverMask (cell-resolution ground paint) extend further?
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860 });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise((r) => setTimeout(r, 1500));
  const out = await p.evaluate(() => {
    const v = window.__sgview;
    const wet = (x, z) => v._overWater(x, z, 0.02) && v._meshY(x, z) < 0.15;
    const res = {};
    for (const bx of [22.00, 22.05, 22.085, 22.13]) {
      const x = (bx / 48 - 0.5) * 1600;
      let northWet = null, southWet = null;
      for (let by = 19.12; by >= 18.92; by -= 0.002) {
        const z = (0.5 - by / 48) * 1600;
        if (wet(x, z)) { if (northWet === null) northWet = by; southWet = by; }
      }
      // riverMask cells along the same column (cell grid = 2.5 world)
      const cells = [];
      for (let by = 19.12; by >= 18.92; by -= 0.01) {
        const z = (0.5 - by / 48) * 1600;
        const gx = Math.floor(x / 2.5 + 320), gy = Math.floor(320 - z / 2.5);
        if (v.riverMask?.[gy]?.[gx]) cells.push(+by.toFixed(3));
      }
      res[bx] = { wetN: northWet, wetS: southWet, maskN: cells[0] ?? null, maskS: cells[cells.length - 1] ?? null };
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close(); server.close(); }
