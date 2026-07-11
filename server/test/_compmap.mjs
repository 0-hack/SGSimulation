// Render the island: survey map + road graph colored by component
// (largest = cyan, all other components = red). Breaks show as red islands.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = process.env.ROOT || process.cwd();
const rd = await import(ROOT + '/public/js/roads1966.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(ROOT + '/public/trace-data.json', 'utf8')).bg;
const mapB64 = readFileSync(ROOT + '/public/trace-map.jpg').toString('base64');
const N = rd.ROAD_NODES_1966, E = rd.ROAD_EDGES_1966;
const par = Array.from({ length: N.length }, (_, i) => i);
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (const e of E) { const a = find(e[0]), b = find(e[1]); if (a !== b) par[a] = b; }
const sz = new Map();
for (let i = 0; i < N.length; i++) { const r = find(i); sz.set(r, (sz.get(r) || 0) + 1); }
const bigRoot = [...sz.entries()].sort((a, b) => b[1] - a[1])[0][0];
// world -> normalized
const toN = ([x, z]) => [x / 1600 + 0.5, 0.5 - z / 1600];
const main = [], off = [];
for (const e of E) {
  const seg = [toN(N[e[0]]), toN(N[e[1]])];
  (find(e[0]) === bigRoot ? main : off).push(seg);
}
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await browser.newPage();
const W = 3000, H = 1600;
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`);
const b64 = await p.evaluate(async ({ W, H, bg, mapB64, main, off }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const x0 = 0.0, x1 = 1.0, y0 = 0.17, y1 = 0.80;   // island span, tracer y-up flipped
  const sx = W / (x1 - x0), sy = H / (y1 - y0);
  const X = (nx) => (nx - x0) * sx, Y = (ny) => (ny - y0) * sy;
  ctx.fillStyle = '#101318'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.45;
  ctx.drawImage(img, X(bg.gxL), Y(1 - bg.gyT), (bg.gxR - bg.gxL) * sx, (bg.gyT - bg.gyB) * sy);
  ctx.globalAlpha = 1; ctx.lineCap = 'round';
  const draw = (segs, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
    for (const [a, b] of segs) { ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); } ctx.stroke(); };
  draw(main, 'rgba(55,208,255,0.85)', 1.1);
  draw(off, '#ff3040', 1.6);
  return cv.toDataURL('image/png');
}, { W, H, bg, mapB64, main, off });
writeFileSync(process.env.OUT || '/tmp/compmap.png', Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', process.env.OUT || '/tmp/compmap.png');
