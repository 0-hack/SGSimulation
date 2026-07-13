// Show what a NEW trace changes vs the CURRENT default game map, WITHOUT applying it.
// Spatial diff (robust to coordinate rounding): a new road/coast segment with no
// current segment within TOL is ADDED (green); a current segment with no new segment
// within TOL is REMOVED (red); everything else is unchanged (faint grey). Renders the
// whole island plus auto-zoomed insets on each changed cluster, over the survey map.
// env NEW=<trace.json>  OUTDIR=<dir>
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { graphToTrace } from '../../scripts/apply_trace.mjs';

const NEW = process.env.NEW;
const OUTDIR = process.env.OUTDIR || '/tmp/tracediff';
mkdirSync(OUTDIR, { recursive: true });
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const nt = JSON.parse(readFileSync(NEW, 'utf8'));
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const sh = await import('../../public/js/shape.js?u=' + Date.now());

const toN = ([x, z]) => [x / 1600 + 0.5, 0.5 - z / 1600];
// current baked roads (normalised polylines) + coast polys (already normalised)
const curRoads = graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966).roads.map(r => r.pts);
const curCoast = [sh.SG_OUTLINE, ...(sh.SG_ISLANDS || [])].filter(p => p && p.length >= 2);
const newRoads = (nt.roads || []).map(r => r.pts || r).filter(p => p && p.length >= 2);
const newCoast = (nt.mainland || []).filter(p => p && p.length >= 2);

const TOL = 1.2 / 1600;   // normalised; a segment within this of a match counts unchanged
// spatial diff of polyline set A vs B: returns A-segments with no B-segment within TOL
function diffSegs(A, B) {
  const cell = 4 / 1600, grid = new Map(), gk = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
  for (const p of B) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cell)), seen = new Set();
    for (let s = 0; s <= n; s++) { const t = s / n, k = gk(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!seen.has(k)) { seen.add(k); (grid.get(k) || grid.set(k, []).get(k)).push([a, b]); } } }
  const dSeg = (px, py, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
    let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t)); };
  const near = (px, py) => { const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get((cx + dx) + ',' + (cy + dy)); if (!arr) continue;
      for (const [a, b] of arr) if (dSeg(px, py, a, b) <= TOL) return true; } return false; };
  const out = [];
  for (const p of A) for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i];
    // sample a few points along the segment; unchanged only if ALL are matched
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 / 1600)));
    let allNear = true;
    for (let s = 0; s <= n; s++) { const t = s / n; if (!near(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) { allNear = false; break; } }
    if (!allNear) out.push([a, b]);
  }
  return out;
}
const roadAdded = diffSegs(newRoads, curRoads);
const roadRemoved = diffSegs(curRoads, newRoads);
const coastAdded = diffSegs(newCoast, curCoast);
const coastRemoved = diffSegs(curCoast, newCoast);
console.log('ROADS  added', roadAdded.length, 'removed', roadRemoved.length, 'segments');
console.log('COAST  added', coastAdded.length, 'removed', coastRemoved.length, 'segments');

// cluster changed segments (added+removed, roads+coast) into regions for zoom insets
const changed = [...roadAdded, ...roadRemoved, ...coastAdded, ...coastRemoved].map(([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
const clusters = [];
const CR = 40 / 1600;
for (const c of changed) { let hit = null;
  for (const cl of clusters) if (Math.hypot(cl.cx - c[0], cl.cy - c[1]) < CR) { hit = cl; break; }
  if (hit) { hit.pts.push(c); hit.cx = (hit.cx * (hit.pts.length - 1) + c[0]) / hit.pts.length; hit.cy = (hit.cy * (hit.pts.length - 1) + c[1]) / hit.pts.length; }
  else clusters.push({ cx: c[0], cy: c[1], pts: [c] }); }
clusters.sort((a, b) => b.pts.length - a.pts.length);
console.log('changed clusters:', clusters.length, '| top sizes:', clusters.slice(0, 6).map(c => c.pts.length).join(','));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const p = await browser.newPage();
async function render(name, x0, y0, x1, y1, W, H) {
  await p.setViewport({ width: W, height: H });
  await p.setContent(`<canvas id=c width=${W} height=${H}></canvas>`);
  const b64 = await p.evaluate(async ({ W, H, bg, mapB64, x0, y0, x1, y1, curRoads, curCoast, newRoads, newCoast, roadAdded, roadRemoved, coastAdded, coastRemoved }) => {
    const cv = document.getElementById('c'), ctx = cv.getContext('2d');
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64; await new Promise(r => { img.onload = r; });
    const sx = W / (x1 - x0), sy = H / (y1 - y0);
    const X = nx => (nx - x0) * sx, Y = ny => ((1 - ny) - y0) * sy;   // y-up (tracer orientation)
    ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.5; ctx.drawImage(img, X(bg.gxL), Y(bg.gyT), (bg.gxR - bg.gxL) * sx, (bg.gyB - bg.gyT) * sy * -1); ctx.globalAlpha = 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const drawP = (polys, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; for (const p of polys) { if (!p || p.length < 2) continue; ctx.beginPath(); p.forEach(([nx, ny], i) => { const px = X(nx), py = Y(ny); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); } };
    const drawS = (segs, color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke(); } };
    // unchanged context faint
    drawP(curCoast, 'rgba(150,160,175,0.35)', 1); drawP(curRoads, 'rgba(150,160,175,0.30)', 0.8);
    // removed (in current, not new) = red; added (in new, not current) = green
    drawS(roadRemoved, '#ff3b30', 2.4); drawS(coastRemoved, '#ff8c1a', 2.6);
    drawS(roadAdded, '#20e070', 2.4); drawS(coastAdded, '#37d0ff', 2.6);
    return cv.toDataURL('image/jpeg', 0.9);
  }, { W, H, bg, mapB64, x0, y0, x1, y1, curRoads, curCoast, newRoads, newCoast, roadAdded, roadRemoved, coastAdded, coastRemoved });
  writeFileSync(`${OUTDIR}/${name}.jpg`, Buffer.from(b64.split(',')[1], 'base64'));
  console.log('saved', `${OUTDIR}/${name}.jpg`);
}
// whole island
await render('overview', 0.0, 0.16, 1.0, 0.82, 2600, 1400);
// zoom insets on the largest changed clusters
for (let i = 0; i < Math.min(4, clusters.length); i++) { const cl = clusters[i]; if (cl.pts.length < 3) break;
  const pad = 0.045; await render('change-' + (i + 1), cl.cx - pad, (1 - cl.cy) - pad, cl.cx + pad, (1 - cl.cy) + pad, 1200, 1200); }
await browser.close();
