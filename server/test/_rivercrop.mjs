// Crop the river corridor out of trace-map.jpg (registered via trace-data.json bg
// rect) and mark the CURRENT in-game river centreline on it — shows how far the
// traced course drifts from the map's real river. env: OUT, X0/X1/Y0/Y1 (base-48).
import puppeteer from 'puppeteer';
import { app } from '../server.js';
import { readFileSync } from 'node:fs';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT = process.env.OUT || '/tmp/rivercrop.png';
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
// base-48 window around the river (game coords): x 19.9..24.2, y 18.4..19.8
const BX0 = +(process.env.X0 || 19.9), BX1 = +(process.env.X1 || 24.2);
const BY0 = +(process.env.Y0 || 18.4), BY1 = +(process.env.Y1 || 19.8);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const p = await browser.newPage();
  await p.goto(base + '/trace.html', { waitUntil: 'domcontentloaded' });
  const png = await p.evaluate(async ({ bg, BX0, BX1, BY0, BY1, riverSrc }) => {
    const img = new Image();
    img.src = '/trace-map.jpg';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const IW = img.naturalWidth, IH = img.naturalHeight;
    const nx2px = (nx) => (nx - bg.gxL) / (bg.gxR - bg.gxL) * IW;
    const ny2py = (ny) => (bg.gyT - ny) / (bg.gyT - bg.gyB) * IH;
    const x0 = nx2px(BX0 / 48), x1 = nx2px(BX1 / 48);
    const y0 = ny2py(BY1 / 48), y1 = ny2py(BY0 / 48);   // larger base-y = further north = smaller py
    const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, x0, y0, W, H, 0, 0, W, H);
    // overlay the CURRENT in-game river control points (base-48) in magenta
    ctx.strokeStyle = '#f0f'; ctx.fillStyle = '#f0f'; ctx.lineWidth = 2;
    const pts = riverSrc.map(([x, y, w]) => [(nx2px(x / 48) - x0), (ny2py(y / 48) - y0), w]);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); }
    return cv.toDataURL('image/png');
  }, {
    bg, BX0, BX1, BY0, BY1,
    riverSrc: [
      [23.58, 18.78, 0.084], [23.45, 18.79, 0.060], [23.34, 18.78, 0.021], [23.23, 18.75, 0.035],
      [23.13, 18.86, 0.043], [23.07, 18.99, 0.031], [22.99, 19.07, 0.015], [22.81, 19.09, 0.030],
      [22.70, 19.05, 0.027], [22.60, 19.18, 0.025], [22.45, 19.16, 0.015], [22.27, 19.16, 0.021],
      [22.12, 19.04, 0.020], [21.95, 19.08, 0.020], [21.84, 19.11, 0.017], [21.83, 19.26, 0.031],
      [21.77, 19.34, 0.024], [21.62, 19.34, 0.012], [21.30, 19.34, 0.021], [21.00, 19.34, 0.020],
      [20.66, 19.35, 0.019], [20.34, 19.35, 0.014],
    ],
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  console.log('saved', OUT);
} finally { await browser.close(); server.close(); }
