// Diagnostic: rebuild base chains exactly like applyTrace, run the fold, and render
// dropped chains (red) over kept ones (grey) to inspect what the fold eats.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const TRACE = '/root/.claude/uploads/cadd2c3e-e5c3-5c88-a489-860c34f300b0/d77e3030-sg1966trace_12.json';
const OUT = process.env.OUT || '/tmp/folddebug.png';
const t = JSON.parse(readFileSync(TRACE, 'utf8'));
const W = 1600, toWorld = ([nx, ny]) => [(nx - 0.5) * W, (0.5 - ny) * W];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DUP = 1.6, CROSS_KEEP = 5, NOVEL_MIN = 3.5;
const cellW = 2, gkW = (x, z) => Math.floor(x / cellW) + ',' + Math.floor(z / cellW);
const accSegs = [], accGrid = new Map();
const accAdd = (a, b) => { const i = accSegs.length; accSegs.push([a, b]);
  const n = Math.max(1, Math.ceil(dist(a, b) / cellW)); const put = new Set();
  for (let s = 0; s <= n; s++) { const tt = s / n, k = gkW(a[0]+(b[0]-a[0])*tt, a[1]+(b[1]-a[1])*tt); if (!put.has(k)) { put.add(k); (accGrid.get(k) || accGrid.set(k, []).get(k)).push(i); } } };
const dupNear = (p, dirx, dirz) => {
  const cx = Math.floor(p[0] / cellW), cz = Math.floor(p[1] / cellW);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const arr = accGrid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
    for (const i of arr) { const [a, b] = accSegs[i], ddx = b[0]-a[0], ddz = b[1]-a[1], l2 = ddx*ddx+ddz*ddz || 1e-9;
      const tt = ((p[0]-a[0])*ddx + (p[1]-a[1])*ddz) / l2;
      if (tt < 0 || tt > 1) continue;
      if (Math.hypot(p[0]-(a[0]+ddx*tt), p[1]-(a[1]+ddz*tt)) > DUP) continue;
      if (Math.abs((ddx*dirx + ddz*dirz) / Math.sqrt(l2)) >= 0.7) return true; } }
  return false;
};
// base chains
const bnode = new Map(), bpts = [], badj = [], bsegs = [];
for (const road of t.roads) {
  if (!road.base) continue;
  const idOf = (q) => { const k = q[0] + ',' + q[1]; let id = bnode.get(k); if (id == null) { id = bpts.length; bnode.set(k, id); bpts.push(toWorld(q)); badj.push([]); } return id; };
  for (let i = 1; i < road.pts.length; i++) { const a = idOf(road.pts[i-1]), b = idOf(road.pts[i]); if (a === b) continue;
    const si = bsegs.length; bsegs.push({ a, b, ow: !!road.oneway, dirt: !!road.dirt }); badj[a].push(si); badj[b].push(si); }
}
const busd = new Array(bsegs.length).fill(false);
const bwalk = (start, si) => { const flags = { ow: bsegs[si].ow, dirt: bsegs[si].dirt };
  let cur = start, seg = si; const ids = [start];
  while (true) { busd[seg] = true; const e = bsegs[seg], nxt = e.a === cur ? e.b : e.a; ids.push(nxt); cur = nxt;
    if (badj[cur].length !== 2) break; const nb = badj[cur].find((x) => !busd[x]); if (nb == null) break;
    if (bsegs[nb].ow !== flags.ow || bsegs[nb].dirt !== flags.dirt) break; seg = nb; }
  return { ids, ...flags }; };
const bchains = [];
for (let n = 0; n < bpts.length; n++) { if (badj[n].length === 2) continue; for (const si of badj[n]) if (!busd[si]) bchains.push(bwalk(n, si)); }
for (let si = 0; si < bsegs.length; si++) if (!busd[si]) bchains.push(bwalk(bsegs[si].a, si));
const blen = (c) => { let l = 0; for (let i = 1; i < c.ids.length; i++) l += dist(bpts[c.ids[i-1]], bpts[c.ids[i]]); return l; };
bchains.sort((p, q) => blen(q) - blen(p));
const kept = [], dropped = [];
const lens = [];
for (const c of bchains) {
  const w = c.ids.map((id) => bpts[id]);
  const s = [0]; for (let i = 1; i < w.length; i++) s.push(s[i-1] + dist(w[i-1], w[i]));
  const dirAt = (i) => { const a = w[Math.max(0, i-1)], b = w[Math.min(w.length-1, i+1)]; const dx = b[0]-a[0], dz = b[1]-a[1], l = Math.hypot(dx, dz) || 1; return [dx/l, dz/l]; };
  const dup = w.map((p, i) => { const [dx, dz] = dirAt(i); return dupNear(p, dx, dz); });
  const runs = []; let st = 0;
  for (let i = 1; i <= w.length; i++) if (i === w.length || dup[i] !== dup[st]) { runs.push({ st, en: i-1, dup: dup[st] }); st = i; }
  const total = s[w.length-1] || 1e-9;
  const dupLen = runs.reduce((a, r) => a + (r.dup ? s[r.en]-s[r.st] : 0), 0);
  const maxNovel = Math.max(0, ...runs.filter((r) => !r.dup).map((r) => s[r.en]-s[r.st]));
  if (dupLen/total > 0.6 && maxNovel < 4) { dropped.push(w); lens.push(total); continue; }
  kept.push(w);
  for (let i = 1; i < w.length; i++) accAdd(w[i-1], w[i]);
}
lens.sort((a,b)=>a-b);
console.log('dropped:', dropped.length, '| len p50', lens[Math.floor(lens.length/2)]?.toFixed(1), 'p90', lens[Math.floor(lens.length*0.9)]?.toFixed(1), 'max', lens[lens.length-1]?.toFixed(1));
// render full map: kept grey, dropped red
const S = 2400;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const p = await browser.newPage(); await p.setViewport({ width: S, height: S });
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const b64 = await p.evaluate(({ S, kept, dropped }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  ctx.fillStyle = '#101318'; ctx.fillRect(0, 0, S, S);
  const X = (x) => (x / 1600 + 0.5) * S, Y = (z) => (0.5 - z / 1600) * S;
  const draw = (polys, col, wd) => { ctx.strokeStyle = col; ctx.lineWidth = wd;
    for (const p of polys) { ctx.beginPath(); p.forEach(([x, z], i) => { i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z)); }); ctx.stroke(); } };
  draw(kept, '#9aa3ad', 1.1); draw(dropped, '#ff3b30', 1.6);
  return cv.toDataURL('image/png');
}, { S, kept, dropped });
writeFileSync(OUT, Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', OUT);
await browser.close();
