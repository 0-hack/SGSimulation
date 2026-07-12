// Reclassify mis-flagged roads to match the survey map's legend.
//
// The owner's legend: solid RED road = 2-way. A large share of built-up roads are
// currently flagged DIRT (rendering as brown kampong tracks) even though they run
// straight along the map's solid-red roads — that is the "2-way not traced on the
// red line" complaint: the road IS there, just typed wrong. This flips DIRT -> 2-way
// wherever a road demonstrably follows a printed red road (red casing present along
// >= THRESH of its length, sampled perpendicular at full resolution). Genuine kampong
// tracks and sea-spanning garbage have no red casing (score ~0) and are left alone.
//
// Flags only — no vertex moves, no adds, no deletes. --write rewrites roads1966.js.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const roadsURL = new URL('../../public/js/roads1966.js', import.meta.url);
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const N = rd.ROAD_NODES_1966, E = rd.ROAD_EDGES_1966;
const THRESH = Number(process.env.THRESH ?? 0.7);

// dirt edges as normalized endpoint pairs (only these are scored)
const dirtIdx = [], pairs = [];
E.forEach((e, i) => { if (!e[4]) return; dirtIdx.push(i);
  pairs.push([[N[e[0]][0] / 1600 + 0.5, 0.5 - N[e[0]][1] / 1600], [N[e[1]][0] / 1600 + 0.5, 0.5 - N[e[1]][1] / 1600]]); });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 900000 });
const p = await browser.newPage();
const scores = await p.evaluate(async ({ mapB64, bg, pairs }) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const W = img.naturalWidth, H = img.naturalHeight;
  // scan the map in horizontal strips to keep one giant getImageData off the heap
  const STRIP = 512, red = new Uint8Array(W * H);
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = STRIP;
  const cx = cvs.getContext('2d', { willReadFrequently: true });
  for (let y0 = 0; y0 < H; y0 += STRIP) {
    const h = Math.min(STRIP, H - y0);
    cx.clearRect(0, 0, W, h); cx.drawImage(img, 0, y0, W, h, 0, 0, W, h);
    const d = cx.getImageData(0, 0, W, h).data;
    for (let i = 0, q = 0; i < h * W * 4; i += 4, q++) { const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r >= 95 && r <= 215 && g < 100 && b < 120 && r - g >= 40 && r - b >= 35) red[(y0 + (q / W | 0)) * W + (q % W)] = 1; }
  }
  const isRed = (x, y) => x >= 0 && y >= 0 && x < W && y < H && red[y * W + x] === 1;
  const toPix = (nx, ny) => [(nx - bg.gxL) / (bg.gxR - bg.gxL) * W, (ny - (1 - bg.gyT)) / (bg.gyT - bg.gyB) * H];
  return pairs.map(([a, b]) => {
    const [ax, ay] = toPix(a[0], a[1]), [bx, by] = toPix(b[0], b[1]);
    const L = Math.hypot(bx - ax, by - ay); if (L < 1) return 0;
    const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
    const steps = Math.max(2, Math.ceil(L / 3)); let hit = 0, tot = 0;
    for (let s = 0; s <= steps; s++) { const t = s / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; tot++;
      let f = false; for (let o = -9; o <= 9; o++) { if (isRed(Math.round(x + nx * o), Math.round(y + ny * o))) { f = true; break; } } if (f) hit++; }
    return hit / tot;
  });
}, { mapB64, bg, pairs });
await browser.close();

let flip = 0;
const flipSet = new Set();
for (let k = 0; k < dirtIdx.length; k++) if (scores[k] >= THRESH) { flipSet.add(dirtIdx[k]); flip++; }
console.log('dirt edges:', dirtIdx.length, '| flip -> 2-way (score >=', THRESH + '):', flip, '| stay dirt:', dirtIdx.length - flip);

if (process.argv.includes('--write')) {
  const NE = E.map((e, i) => flipSet.has(i) ? [e[0], e[1], 0, e[3] || 2, 0] : e);
  const r1 = (v) => Math.round(v * 10) / 10;
  const emitN = 'export const ROAD_NODES_1966 = [' + N.map((q) => `[${r1(q[0])},${r1(q[1])}]`).join(', ') + '];';
  const emitE = 'export const ROAD_EDGES_1966 = [' + NE.map((e) => e[4] ? `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2},1]` : (e[2] || (e[3] && e[3] !== 2)) ? `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2}]` : `[${e[0]},${e[1]}]`).join(',') + '];';
  let s = readFileSync(roadsURL, 'utf8')
    .replace(/export const ROAD_NODES_1966 = \[[\s\S]*?\];/, () => emitN)
    .replace(/export const ROAD_EDGES_1966 = \[[\s\S]*?\];/, () => emitE);
  writeFileSync(roadsURL, s);
  console.log('rewrote roads1966.js: flipped', flip, 'dirt roads to 2-way');
}
