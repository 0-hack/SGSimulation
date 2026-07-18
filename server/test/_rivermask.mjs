// Zoomed crop of trace-map.jpg with the water-colour mask tinted cyan — for tuning
// the classifier + finding exact seed coords. env: OUT, X0/X1/Y0/Y1 (base-48), Z (zoom)
import puppeteer from 'puppeteer';
import { app } from '../server.js';
import { readFileSync, writeFileSync } from 'node:fs';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT = process.env.OUT || '/tmp/rivermask.png';
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const BX0 = +(process.env.X0 || 22.6), BX1 = +(process.env.X1 || 23.7);
const BY0 = +(process.env.Y0 || 18.5), BY1 = +(process.env.Y1 || 19.3);
const Z = +(process.env.Z || 3);
// classifier params: water iff b-r>=DR && g-r>=DG && b>=BMIN && r<=RMAX
const TH = { DR: +(process.env.DR ?? 12), DG: +(process.env.DG ?? 6), BMIN: +(process.env.BMIN ?? 110), RMAX: +(process.env.RMAX ?? 255) };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const p = await browser.newPage();
  await p.goto(base + '/trace.html', { waitUntil: 'domcontentloaded' });
  const res = await p.evaluate(async ({ bg, BX0, BX1, BY0, BY1, Z, TH }) => {
    const img = new Image(); img.src = '/trace-map.jpg';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const IW = img.naturalWidth, IH = img.naturalHeight;
    const nx2px = (nx) => (nx - bg.gxL) / (bg.gxR - bg.gxL) * IW;
    const ny2py = (ny) => (bg.gyT - ny) / (bg.gyT - bg.gyB) * IH;
    const X0 = Math.round(nx2px(BX0 / 48)), X1 = Math.round(nx2px(BX1 / 48));
    const Y0 = Math.round(ny2py(BY1 / 48)), Y1 = Math.round(ny2py(BY0 / 48));
    const W = X1 - X0, H = Y1 - Y0;
    const cv = document.createElement('canvas'); cv.width = W * Z; cv.height = H * Z;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, X0, Y0, W, H, 0, 0, W * Z, H * Z);
    const o = ctx.getImageData(0, 0, W * Z, H * Z);
    const d = o.data;
    for (let k = 0; k < W * Z * H * Z; k++) {
      const i = k * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (b - r >= TH.DR && g - r >= TH.DG && b >= TH.BMIN && r <= TH.RMAX) { d[i] = 0; d[i + 1] = 255; d[i + 2] = 255; }
    }
    ctx.putImageData(o, 0, 0);
    // base-unit grid for reading coordinates off the image
    ctx.strokeStyle = '#f0f'; ctx.fillStyle = '#f0f'; ctx.font = '12px sans-serif'; ctx.lineWidth = 1;
    const pxb = W * Z / (BX1 - BX0), pyb = H * Z / (BY1 - BY0);
    for (let gx = Math.ceil(BX0 * 10) / 10; gx < BX1; gx += 0.1) {
      const x = (gx - BX0) * pxb; ctx.globalAlpha = Math.abs(gx * 10 - Math.round(gx * 10)) < 0.01 && Math.round(gx * 10) % 5 === 0 ? 0.8 : 0.25;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H * Z); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(gx.toFixed(1), x + 2, 12);
    }
    for (let gy = Math.ceil(BY0 * 10) / 10; gy < BY1; gy += 0.1) {
      const y = (BY1 - gy) * pyb; ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W * Z, y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(gy.toFixed(1), 2, y - 2);
    }
    return { png: cv.toDataURL('image/png') };
  }, { bg, BX0, BX1, BY0, BY1, Z, TH });
  writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  console.log('saved', OUT);
} finally { await browser.close(); server.close(); }
