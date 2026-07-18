// Extract the REAL Singapore River course from trace-map.jpg (registered by the
// trace-data.json bg rect). Water-colour mask, AND-ed with a hand-sketched corridor
// around the channel (so heavy closing can seal bridge/label cuts without leaking
// into pools or the sea), flood-filled from the mouth; BFS geodesic rings give the
// ordered centreline, perpendicular marches through the raw mask give the widths.
// Emits base-48 [x, y, halfW] rows (mouth -> inland) + a debug overlay PNG.
// env: OUT (debug png), JSON (rows file)
import puppeteer from 'puppeteer';
import { app } from '../server.js';
import { readFileSync, writeFileSync } from 'node:fs';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT = process.env.OUT || '/tmp/riverextract.png';
const JSONOUT = process.env.JSON || '/tmp/riverextract.json';
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const p = await browser.newPage();
  await p.goto(base + '/trace.html', { waitUntil: 'domcontentloaded' });
  const res = await p.evaluate(async ({ bg }) => {
    const img = new Image(); img.src = '/trace-map.jpg';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const IW = img.naturalWidth, IH = img.naturalHeight;
    const BX0 = 19.8, BX1 = 23.8, BY0 = 18.4, BY1 = 19.7;
    const nx2px = (nx) => (nx - bg.gxL) / (bg.gxR - bg.gxL) * IW;
    const ny2py = (ny) => (bg.gyT - ny) / (bg.gyT - bg.gyB) * IH;
    const X0 = Math.round(nx2px(BX0 / 48)), X1 = Math.round(nx2px(BX1 / 48));
    const Y0 = Math.round(ny2py(BY1 / 48)), Y1 = Math.round(ny2py(BY0 / 48));
    const W = X1 - X0, H = Y1 - Y0;
    const ppb = W / (BX1 - BX0);                     // px per base unit (square)
    const b2x = (bx) => (bx - BX0) * ppb, b2y = (by) => (BY1 - by) * ppb;
    const px2bx = (x) => BX0 + x / ppb, py2by = (y) => BY1 - y / ppb;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, X0, Y0, W, H, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    // rough hand-sketched channel corridor (mouth -> inland); the pixel mask does the
    // fine positioning — this only needs to CONTAIN the river and EXCLUDE other water
    const WAY = [
      [23.30, 18.78], [23.19, 18.88], [23.10, 18.97], [23.02, 19.02], [22.92, 19.06],
      [22.80, 19.03], [22.71, 19.02], [22.62, 19.05], [22.60, 19.12], [22.58, 19.18],
      [22.52, 19.22], [22.44, 19.20], [22.36, 19.14], [22.28, 19.15], [22.20, 19.13],
      [22.10, 19.10], [21.98, 19.07], [21.88, 19.07], [21.82, 19.12], [21.78, 19.20],
      [21.70, 19.28], [21.60, 19.31], [21.45, 19.30], [21.30, 19.31], [21.10, 19.32],
      [20.90, 19.30], [20.70, 19.30], [20.50, 19.31], [20.30, 19.33], [20.10, 19.34], [19.95, 19.34],
    ].map(([x, y]) => [b2x(x), b2y(y)]);
    const BUF = 0.11 * ppb;
    const segDist = (px, py, ax, ay, bx, by) => {
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
      return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
    };
    const inCorr = (x, y) => {
      for (let i = 0; i < WAY.length - 1; i++) {
        if (segDist(x, y, WAY[i][0], WAY[i][1], WAY[i + 1][0], WAY[i + 1][1]) <= BUF) return true;
      }
      return false;
    };
    const wat = new Uint8Array(W * H);       // raw water mask (for widths)
    const corr = new Uint8Array(W * H);      // corridor-bounded (for connectivity)
    for (let y = 0, k = 0; y < H; y++) for (let x = 0; x < W; x++, k++) {
      const i = k * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const isWat = (b - r >= -4 && g - r >= -8 && b >= 118 && r <= 226) ? 1 : 0;
      wat[k] = isWat;
      if (isWat && inCorr(x, y)) corr[k] = 1;
    }
    // Walk the sketch polyline in even steps; at each station scan the PERPENDICULAR
    // through the raw water mask and re-centre onto the wet run nearest the sketch —
    // the sketch gives the order, the map's own pixels give the exact position/width.
    const stations = [];
    for (let i = 0; i < WAY.length - 1; i++) {
      const [ax, ay] = WAY[i], [bx, by] = WAY[i + 1];
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / 6));
      for (let s = 0; s < n; s++) stations.push({ x: ax + (bx - ax) * s / n, y: ay + (by - ay) * s / n });
    }
    stations.push({ x: WAY[WAY.length - 1][0], y: WAY[WAY.length - 1][1] });
    const recentred = stations.map((pt, i) => {
      const a = stations[Math.max(0, i - 1)], b = stations[Math.min(stations.length - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const L = Math.hypot(tx, ty) || 1;
      const nx = -ty / L, ny = tx / L;
      // collect wet intervals along the perpendicular (gap tolerance 2px)
      const SPAN = Math.round(BUF), runs = [];
      let t0 = null, gap = 0, last = null;
      for (let t = -SPAN; t <= SPAN; t++) {
        const x = Math.round(pt.x + nx * t), y = Math.round(pt.y + ny * t);
        const wet = x >= 0 && y >= 0 && x < W && y < H && wat[y * W + x];
        if (wet) { if (t0 === null) t0 = t; last = t; gap = 0; }
        else if (t0 !== null && ++gap > 2) { runs.push([t0, last]); t0 = null; }
      }
      if (t0 !== null) runs.push([t0, last]);
      if (!runs.length) return { x: pt.x, y: pt.y, w: NaN };
      let best = runs[0];
      for (const r of runs) { if (Math.abs((r[0] + r[1]) / 2) < Math.abs((best[0] + best[1]) / 2)) best = r; }
      const mid = (best[0] + best[1]) / 2;
      return { x: pt.x + nx * mid, y: pt.y + ny * mid, w: (best[1] - best[0]) / 2 };
    });
    // fill missing widths from neighbours, then smooth positions + widths
    for (let i = 0; i < recentred.length; i++) {
      if (!Number.isNaN(recentred[i].w)) continue;
      let a = i - 1; while (a >= 0 && Number.isNaN(recentred[a].w)) a--;
      let b = i + 1; while (b < recentred.length && Number.isNaN(recentred[b].w)) b++;
      const wa = a >= 0 ? recentred[a].w : (b < recentred.length ? recentred[b].w : 8);
      const wb = b < recentred.length ? recentred[b].w : wa;
      recentred[i].w = (wa + wb) / 2;
    }
    const sm = recentred.map((r, i) => {
      const a = recentred[Math.max(0, i - 1)], b = recentred[Math.min(recentred.length - 1, i + 1)];
      return { x: (a.x + r.x + b.x) / 3, y: (a.y + r.y + b.y) / 3 };
    });
    const wsm = recentred.map((r, i) => {
      const a = recentred[Math.max(0, i - 1)], b = recentred[Math.min(recentred.length - 1, i + 1)];
      return (a.w + r.w + b.w) / 3;
    });
    // emit rows every ~14px, half-width clamped per reach (canal west, basin at mouth)
    const rows = [];
    let acc = 1e9, prev = null;
    for (let i = 0; i < sm.length; i++) {
      const pt = sm[i];
      if (prev) acc += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      prev = pt;
      if (acc < 14 && i !== sm.length - 1) continue;
      acc = 0;
      const bx = px2bx(pt.x), by = py2by(pt.y);
      const wMax = bx > 23.0 ? 0.09 : bx > 21.7 ? 0.055 : 0.035;
      rows.push([+bx.toFixed(3), +by.toFixed(3), +Math.max(0.012, Math.min(wMax, wsm[i] / ppb)).toFixed(3)]);
    }
    // extend the mouth out to the game's traced coastline so the channel joins the sea
    if (rows.length > 2) {
      const [x0, y0] = rows[0], [x1, y1] = rows[1];
      let dx = x0 - x1, dy = y0 - y1; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const w0 = rows[0][2];
      rows.unshift([+(x0 + dx * 0.30).toFixed(3), +(y0 + dy * 0.30).toFixed(3), +Math.min(0.09, w0 * 1.3).toFixed(3)]);
    }
    // debug overlay: raw corridor water (green), centreline (magenta), rows + widths (yellow)
    const o = ctx.getImageData(0, 0, W, H);
    for (let k = 0; k < W * H; k++) if (corr[k]) o.data[k * 4 + 1] = 255;
    ctx.putImageData(o, 0, 0);
    ctx.strokeStyle = '#f0f'; ctx.lineWidth = 2; ctx.beginPath();
    sm.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y))); ctx.stroke();
    ctx.fillStyle = '#ff0'; ctx.strokeStyle = '#ff0'; ctx.lineWidth = 1;
    for (const [bx, by, w] of rows) {
      ctx.beginPath(); ctx.arc(b2x(bx), b2y(by), 2.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(b2x(bx), b2y(by), w * ppb, 0, 7); ctx.stroke();
    }
    return { png: cv.toDataURL('image/png'), rows, stations: stations.length };
  }, { bg });
  if (res.error) { console.error('FAIL:', res.error); process.exit(1); }
  writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  writeFileSync(JSONOUT, JSON.stringify(res.rows));
  console.log('saved', OUT, JSONOUT, 'rows:', res.rows.length, 'stations:', res.stations);
} finally { await browser.close(); server.close(); }
