// Fidelity diagnostic: how far does the BAKED game map deviate from the DRAWN trace?
// Renders an overlay (drawn = cyan, baked = red) over the original survey map, and
// prints per-layer deviation stats (world units; the island is 1600 across).
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync } from 'node:fs';
import { graphToTrace } from '../../scripts/apply_trace.mjs';

const TRACE = process.env.TRACE_FILE || '/root/.claude/uploads/cadd2c3e-e5c3-5c88-a489-860c34f300b0/d77e3030-sg1966trace_12.json';
const OUT = process.env.SHOT_DIR || '/tmp/fidelity';
const TAG = process.env.TAG || 'now';
mkdirSync(OUT, { recursive: true });

const drawn = JSON.parse(readFileSync(TRACE, 'utf8'));
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const sh = await import('../../public/js/shape.js?u=' + Date.now());
const cu = await import('../../public/js/custom1966.js?u=' + Date.now());
const baked = {
  roads: graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966).roads.map((r) => r.pts),
  railway: cu.CUSTOM_RAILWAYS || [],
  mainland: [sh.SG_OUTLINE, ...(sh.SG_ISLANDS || [])].filter((p) => p && p.length >= 3),
  reservoirs: rd.RESERVOIRS_1966 || [],
};
const drawnL = {
  roads: (drawn.roads || []).map((r) => r.pts || r),
  railway: (drawn.railway || []).map((r) => r.pts || r),
  mainland: drawn.mainland || [],
  reservoirs: drawn.reservoirs || [],
};

// deviation: for every drawn point, distance to the nearest baked segment (same layer)
function deviation(drawnPolys, bakedPolys) {
  const segs = [];
  for (const p of bakedPolys) for (let i = 1; i < p.length; i++) segs.push([p[i - 1], p[i]]);
  const cell = 0.01, grid = new Map(), gk = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  segs.forEach((s, i) => { const n = Math.max(1, Math.ceil(Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) / cell)); const put = new Set();
    for (let k = 0; k <= n; k++) { const t = k / n, key = gk(s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t); if (!put.has(key)) { put.add(key); (grid.get(key) || grid.set(key, []).get(key)).push(i); } } });
  const dPt = (p, s) => { const [a, b] = s, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)); };
  const ds = [], worst = [];
  for (const poly of drawnPolys) for (const p of poly) {
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    let best = Infinity;
    // keep expanding rings until the ring's minimum possible distance exceeds the best
    // hit so far — stopping at the first non-empty ring misses a nearer segment that
    // sits just across a cell boundary.
    for (let r = 0; r <= 6 && (r - 1) * cell <= best; r++)
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const arr = grid.get((cx + dx) + ',' + (cy + dy)); if (!arr) continue;
        for (const i of arr) { const d = dPt(p, segs[i]); if (d < best) best = d; }
      }
    if (best === Infinity) best = 0.04;   // nothing within ~3 cells: cap at 64u for stats
    ds.push(best); if (best > 0.002) worst.push([p[0], p[1], best]);
  }
  ds.sort((a, b) => a - b);
  const W = 1600, q = (f) => (ds[Math.floor(f * (ds.length - 1))] * W);
  return { n: ds.length, mean: ds.reduce((a, b) => a + b, 0) / ds.length * W, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: ds[ds.length - 1] * W, worst };
}

const stats = {};
for (const k of ['roads', 'railway', 'mainland', 'reservoirs']) {
  if (!drawnL[k].length) continue;
  stats[k] = deviation(drawnL[k], baked[k]);
  const s = stats[k];
  console.log(`${TAG} ${k}: pts ${s.n} | mean ${s.mean.toFixed(2)}u | p50 ${s.p50.toFixed(2)} | p90 ${s.p90.toFixed(2)} | p99 ${s.p99.toFixed(2)} | max ${s.max.toFixed(1)}u  (2.5u = 1 grid cell)`);
}

// ---- overlay render: survey map + drawn (cyan) + baked (red) --------------------
const traceData = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8'));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const SIZE = 2400;
await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
await page.setContent(`<canvas id="c" width="${SIZE}" height="${SIZE}" style="display:block"></canvas>`);
await page.evaluate(async ({ SIZE, bg, mapB64, drawnL, baked, views }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  for (const [name, x0, y0, x1, y1] of views) {
    const sx = SIZE / (x1 - x0), sy = SIZE / (y1 - y0);
    const X = (nx) => (nx - x0) * sx, Y = (ny) => ((1 - ny) - y0) * sy;   // tracer orientation: y up
    ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(img, X(bg.gxL), Y(bg.gyT), (bg.gxR - bg.gxL) * sx, (bg.gyT - bg.gyB) * sy);
    ctx.globalAlpha = 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const draw = (polys, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w;
      for (const p of polys) { if (!p || p.length < 2) continue; ctx.beginPath();
        p.forEach(([nx, ny], i) => { const px = X(nx), py = Y(ny); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); } };
    // baked in RED under, drawn in CYAN over — anywhere red peeks out, the game deviates
    for (const k of ['mainland', 'reservoirs', 'railway', 'roads']) { draw(baked[k] || [], '#ff3b30', k === 'roads' ? 2.2 : 3.2); }
    for (const k of ['mainland', 'reservoirs', 'railway', 'roads']) { draw(drawnL[k] || [], 'rgba(55,208,255,0.85)', k === 'roads' ? 1.2 : 1.8); }
    window['done_' + name] = cv.toDataURL('image/png');
  }
}, { SIZE, bg: traceData.bg, mapB64, drawnL, baked, views: [['full', -0.02, 0.14, 0.96, 0.82]] });
const b64 = await page.evaluate(() => window['done_full']);
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/${TAG}-full.png`, Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', `${OUT}/${TAG}-full.png`);
// zoom views on the CBD/rail throat + a NW quadrant
for (const [name, x0, y0, x1, y1] of [['cbd', 0.40, 0.30, 0.52, 0.42], ['nw', 0.15, 0.40, 0.40, 0.65]]) {
  await page.evaluate(async ({ SIZE, bg, drawnL, baked, name, x0, y0, x1, y1 }) => {
    const cv = document.getElementById('c'), ctx = cv.getContext('2d');
    const sx = SIZE / (x1 - x0), sy = SIZE / (y1 - y0);
    const X = (nx) => (nx - x0) * sx, Y = (ny) => ((1 - ny) - y0) * sy;
    ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, SIZE, SIZE);
    const img = document.querySelector('img') || new Image();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const draw = (polys, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w;
      for (const p of polys) { if (!p || p.length < 2) continue; ctx.beginPath();
        p.forEach(([nx, ny], i) => { const px = X(nx), py = Y(ny); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); } };
    for (const k of ['mainland', 'reservoirs', 'railway', 'roads']) draw(baked[k] || [], '#ff3b30', k === 'roads' ? 3 : 4.4);
    for (const k of ['mainland', 'reservoirs', 'railway', 'roads']) draw(drawnL[k] || [], 'rgba(55,208,255,0.9)', k === 'roads' ? 1.6 : 2.4);
    window['done_' + name] = cv.toDataURL('image/png');
  }, { SIZE, bg: traceData.bg, drawnL, baked, name, x0, y0, x1, y1 });
  const zb = await page.evaluate((n) => window['done_' + n], name);
  writeFileSync(`${OUT}/${TAG}-${name}.png`, Buffer.from(zb.split(',')[1], 'base64'));
  console.log('saved', `${OUT}/${TAG}-${name}.png`);
}
await browser.close();
