// Render the survey map with the current baked roads overlaid, for a world box.
// env BOX=x0,z0,x1,z1  OUT=file.png
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { graphToTrace } from '../../scripts/apply_trace.mjs';
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const roads = graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966).roads;
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const [x0, z0, x1, z1] = (process.env.BOX || '-230,110,-90,210').split(',').map(Number);
const S = 1500;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const p = await browser.newPage(); await p.setViewport({ width: S, height: S });
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const b64 = await p.evaluate(async ({ S, bg, mapB64, roads, x0, z0, x1, z1 }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const nx0 = x0 / 1600 + 0.5, nx1 = x1 / 1600 + 0.5;
  const nyT = 0.5 - z1 / 1600, nyB = 0.5 - z0 / 1600;
  const sx = S / (nx1 - nx0), sy = S / (nyB - nyT);
  const X = (nx) => (nx - nx0) * sx, Y = (ny) => (ny - nyT) * sy;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.drawImage(img, X(bg.gxL), Y(1 - bg.gyT), (bg.gxR - bg.gxL) * sx, (bg.gyT - bg.gyB) * sy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.9;
  for (const r of roads) {
    ctx.strokeStyle = r.dirt ? '#8b4513' : r.ow ? '#ff9f43' : '#37d0ff';
    ctx.lineWidth = r.ow ? 1.6 : 2.4;
    ctx.beginPath();
    r.pts.forEach(([nx, ny], k) => { const px = X(nx), py = Y(ny); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
  }
  return cv.toDataURL('image/png');
}, { S, bg, mapB64, roads, x0, z0, x1, z1 });
writeFileSync(process.env.OUT || '/tmp/maptile.png', Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', process.env.OUT);
await browser.close();
