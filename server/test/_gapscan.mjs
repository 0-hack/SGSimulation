// Diagnostic: over a world box, render the survey map + the CURRENT baked roads
// (2-way cyan, 1-way orange, dirt brown) + a fresh auto-trace of the map's RED
// roads (magenta) drawn ONLY where no current road already covers it. Magenta =
// printed red road the game is missing. env BOX=x0,z0,x1,z1 OUT=file.png
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { graphToTrace } from '../../scripts/apply_trace.mjs';
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const roads = graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966).roads;
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const [bx0, bz0, bx1, bz1] = (process.env.BOX || '-115,-205,-10,-120').split(',').map(Number);
// current baked segments in normalized coords for the "already covered" test
const cur = [];
for (const r of roads) { const p = r.pts; for (let i = 1; i < p.length; i++) cur.push([p[i - 1], p[i]]); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 900000 });
const p = await browser.newPage();
const out = await p.evaluate(async ({ mapB64, bg, roads, cur, box }) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const WF = img.naturalWidth, HF = img.naturalHeight;
  const toPixG = (nx, ny) => [(nx - bg.gxL) / (bg.gxR - bg.gxL) * WF, (ny - (1 - bg.gyT)) / (bg.gyT - bg.gyB) * HF];
  const nb = (wx, wz) => [wx / 1600 + 0.5, 0.5 - wz / 1600];
  const [gx0, gy1] = toPixG(...nb(box[0], box[1])), [gx1, gy0] = toPixG(...nb(box[2], box[3]));
  const cx0 = Math.max(0, Math.floor(gx0)), cy0 = Math.max(0, Math.floor(gy0));
  const W = Math.min(WF, Math.ceil(gx1)) - cx0, H = Math.min(HF, Math.ceil(gy1)) - cy0;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, cx0, cy0, W, H, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const P = (nx, ny) => { const [gx, gy] = toPixG(nx, ny); return [gx - cx0, gy - cy0]; };
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const toWorld = (px, py) => { const nx = bg.gxL + (px + cx0) / WF * (bg.gxR - bg.gxL), ny = (1 - bg.gyT) + (py + cy0) / HF * (bg.gyT - bg.gyB);
    return [(nx - 0.5) * 1600, (0.5 - ny) * 1600]; };

  // red mask (hysteresis) + blob removal, same recipe as the repair tool
  const red = new Uint8Array(W * H), weak = new Uint8Array(W * H);
  for (let i = 0, q = 0; i < d.length; i += 4, q++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r >= 95 && r <= 215 && g < 100 && b < 120 && r - g >= 40 && r - b >= 35) red[q] = 1;
    if (r >= 90 && r <= 225 && g < 100 && b < 130 && r - g >= 26 && r - b >= 26) weak[q] = 1;
  }
  for (let pass = 0; pass < 14; pass++) { let grown = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = y * W + x;
      if (red[q] || !weak[q]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && red[yy * W + xx] === 1) { red[q] = 2; grown++; dy = 2; break; } } }
    for (let q = 0; q < red.length; q++) if (red[q] === 2) red[q] = 1;
    if (!grown) break; }
  const deblob = (m, core, margin) => { const BIG = 30000, dt = new Int16Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x;
      if (!m[i]) { dt[i] = 0; continue; } dt[i] = (x === 0 || y === 0 || x === W - 1) ? 1 : Math.min(dt[i - 1], dt[i - W], dt[i - W - 1], dt[i - W + 1]) + 1; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!dt[i]) continue;
      if (x === W - 1 || y === H - 1 || x === 0) { dt[i] = Math.min(dt[i], 1); continue; } dt[i] = Math.min(dt[i], Math.min(dt[i + 1], dt[i + W], dt[i + W - 1], dt[i + W + 1]) + 1); }
    const d2 = new Int16Array(W * H).fill(BIG);
    for (let i = 0; i < d2.length; i++) if (dt[i] >= core) d2[i] = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!d2[i]) continue; let v = d2[i];
      if (x > 0) v = Math.min(v, d2[i - 1] + 1); if (y > 0) { v = Math.min(v, d2[i - W] + 1); if (x > 0) v = Math.min(v, d2[i - W - 1] + 1); if (x < W - 1) v = Math.min(v, d2[i - W + 1] + 1); } d2[i] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!d2[i]) continue; let v = d2[i];
      if (x < W - 1) v = Math.min(v, d2[i + 1] + 1); if (y < H - 1) { v = Math.min(v, d2[i + W] + 1); if (x < W - 1) v = Math.min(v, d2[i + W + 1] + 1); if (x > 0) v = Math.min(v, d2[i + W - 1] + 1); } d2[i] = v; }
    for (let i = 0; i < m.length; i++) if (m[i] && d2[i] <= margin) m[i] = 0; };
  deblob(red, 12, 13);

  // draw map (dim) then current roads, then red-mask pixels not near a current road
  ctx.globalAlpha = 0.55; ctx.drawImage(img, cx0, cy0, W, H, 0, 0, W, H); ctx.globalAlpha = 1;
  ctx.fillStyle = '#101318'; ctx.globalAlpha = 0.35; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  // rasterize current roads into a coverage grid (2px cells)
  const cell = 4, cover = new Set(), gk = (x, y) => (x / cell | 0) + ':' + (y / cell | 0);
  const stamp = (x, y) => cover.add(gk(x, y));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of roads) {
    ctx.strokeStyle = r.dirt ? '#b06a30' : r.ow ? '#ff9f43' : '#37d0ff';
    ctx.lineWidth = r.ow ? 2.4 : r.dirt ? 2.2 : 3.4;
    ctx.beginPath();
    r.pts.forEach(([nx, ny], k) => { const [px, py] = P(nx, ny); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    // stamp coverage along densified points
    for (let i = 1; i < r.pts.length; i++) { const [ax, ay] = P(...r.pts[i - 1]), [bx, by] = P(...r.pts[i]);
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / cell));
      for (let s = 0; s <= n; s++) { const t = s / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) stamp(x + ddx * cell, y + ddy * cell); } }
  }
  // paint uncovered red pixels magenta
  const img2 = ctx.getImageData(0, 0, W, H);
  let missing = 0, total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!red[y * W + x]) continue; total++;
    if (cover.has(gk(x, y))) continue; missing++;
    const o = (y * W + x) * 4; img2.data[o] = 255; img2.data[o + 1] = 40; img2.data[o + 2] = 230; img2.data[o + 3] = 255;
  }
  ctx.putImageData(img2, 0, 0);
  // downscale to <=1500 wide
  const scale = Math.min(1, 1500 / W);
  const o2 = document.createElement('canvas'); o2.width = Math.round(W * scale); o2.height = Math.round(H * scale);
  o2.getContext('2d').drawImage(cv, 0, 0, o2.width, o2.height);
  return { png: o2.toDataURL('image/jpeg', 0.85), missing, total };
}, { mapB64, bg, roads, cur, box: [bx0, bz0, bx1, bz1] });
writeFileSync(process.env.OUT || '/tmp/gapscan.png', Buffer.from(out.png.split(',')[1], 'base64'));
console.log('saved', process.env.OUT, '| red-mask pixels uncovered by any current road:', out.missing, '/', out.total, '(' + (100 * out.missing / out.total).toFixed(0) + '%)');
await browser.close();
