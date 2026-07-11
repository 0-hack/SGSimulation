// Redraw the 2-way MAIN roads by re-bending the legacy ghost chains onto the map.
//
// The legacy machine-traced 2-way sketch has the right TOPOLOGY (it is what holds
// the owner's hand-traced clusters together) but bad GEOMETRY — it wanders off the
// printed roads. Dropping it and re-tracing from colour alone fails: on aged sheets
// the red fill fades to the exact hue of the contour lines. So instead each ghost
// chain is re-bent onto road EVIDENCE (confident red fill + black casing lines)
// with an A* constrained to a corridor around the ghost path. Junction nodes are
// preserved (moved onto the road only when no owner edge holds them), so the
// network's connectivity survives by construction and the owner's drawing is never
// touched.
//
// --write rewrites roads1966.js; DEBUG_TILE=x0,z0,x1,z1 + DEBUG_OUT=file.png dumps
// an evidence/result overlay for inspection.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { reconnectGraph, connectCrossings, mergeComponents, relaxZigzag } from '../../scripts/reconnect_roads.mjs';

const roadsURL = new URL('../../public/js/roads1966.js', import.meta.url);
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
let N = rd.ROAD_NODES_1966.map((p) => p.slice()), E = rd.ROAD_EDGES_1966.map((e) => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2, e[4] ? 1 : 0]);

// ---- ghost reference from git history (same provenance test as before) ----------
const refSegs = [];
{
  const root = new URL('../..', import.meta.url).pathname;
  for (const sha of ['749b42b', '2ca7c47', 'ee235b9', '02076db', '5e15bbf']) {
    const src = execSync(`git show ${sha}:public/js/roads1966.js`, { cwd: root, maxBuffer: 1e8 }).toString();
    const m = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
    // every flavour: the machine era embedded 1-way and dirt sketches too
    for (const e of m.ROAD_EDGES_1966) refSegs.push([m.ROAD_NODES_1966[e[0]], m.ROAD_NODES_1966[e[1]]]);
  }
}
const refCell = 2, refGrid = new Map(), rgk = (x, y) => (x / refCell | 0) + ':' + (y / refCell | 0);
refSegs.forEach((s, i) => {
  const n = Math.max(1, Math.ceil(Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) / refCell)); const put = new Set();
  for (let k = 0; k <= n; k++) { const t = k / n, key = rgk(s[0][0] + (s[1][0] - s[0][0]) * t, s[0][1] + (s[1][1] - s[0][1]) * t);
    if (!put.has(key)) { put.add(key); (refGrid.get(key) || refGrid.set(key, []).get(key)).push(i); } }
});
const dRef = (x, y) => { let best = 1e9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const arr = refGrid.get(((x / refCell | 0) + dx) + ':' + ((y / refCell | 0) + dy)); if (!arr) continue;
    for (const i of arr) { const [A, B] = refSegs[i], ddx = B[0] - A[0], ddy = B[1] - A[1], l2 = ddx * ddx + ddy * ddy || 1e-9;
      let t = ((x - A[0]) * ddx + (y - A[1]) * ddy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dd = Math.hypot(x - (A[0] + ddx * t), y - (A[1] + ddy * t)); if (dd < best) best = dd; } }
  return best; };

// ---- walk the current graph into chains, classify ghosts -------------------------
const adj = new Map();
E.forEach((e, i) => { (adj.get(e[0]) || adj.set(e[0], []).get(e[0])).push({ n: e[1], i }); (adj.get(e[1]) || adj.set(e[1], []).get(e[1])).push({ n: e[0], i }); });
const deg = (n) => (adj.get(n) || []).length;
const used = new Set();
const flagsOf = (i) => E[i][2] * 2 + E[i][4];
const walk = (start, first) => {
  const segs = [first.i], nodes = [start, first.n]; let cur = first.n; used.add(first.i);
  while (deg(cur) === 2) {
    const nb = (adj.get(cur) || []).find((x) => !used.has(x.i) && flagsOf(x.i) === flagsOf(first.i));
    if (!nb) break; used.add(nb.i); segs.push(nb.i); nodes.push(nb.n); cur = nb.n;
  }
  return { segs, nodes };
};
const chains = [];
for (const [n, list] of adj) {
  if (deg(n) === 2) continue;
  for (const l of list) { if (used.has(l.i)) continue; chains.push(walk(n, l)); }
}
for (let i = 0; i < E.length; i++) if (!used.has(i)) chains.push(walk(E[i][0], { n: E[i][1], i }));

const ghosts = [];
for (const ch of chains) {
  const e0 = E[ch.segs[0]];
  let len = 0; const samples = [];
  for (const i of ch.segs) { const e = E[i], A = N[e[0]], B = N[e[1]], L = Math.hypot(A[0] - B[0], A[1] - B[1]); len += L;
    const n = Math.max(1, Math.ceil(L / 1.5));
    for (let k = 0; k <= n; k++) samples.push([A[0] + (B[0] - A[0]) * k / n, A[1] + (B[1] - A[1]) * k / n]); }
  const meanSeg = len / ch.segs.length;
  const hit = samples.filter(([x, y]) => dRef(x, y) < 1.2).length / samples.length;
  if (len >= 8 && meanSeg > 2.0 && hit >= 0.6) ghosts.push({ ...ch, flags: [e0[2], e0[3], e0[4]] });
}
const kindOf = (g) => g.flags[2] ? 'dirt' : g.flags[0] ? 'oneway' : '2way';
{
  const byKind = {};
  for (const g of ghosts) byKind[kindOf(g)] = (byKind[kindOf(g)] || 0) + 1;
  console.log('ghost chains to re-bend:', ghosts.length, JSON.stringify(byKind));
}

// nodes owned by anything non-ghost must not move
const ghostEdgeSet = new Set(); for (const g of ghosts) for (const i of g.segs) ghostEdgeSet.add(i);
const pinned = new Set();
E.forEach((e, i) => { if (!ghostEdgeSet.has(i)) { pinned.add(e[0]); pinned.add(e[1]); } });

// ---- browser: evidence mask + corridor A* per chain ------------------------------
const chainsPx = ghosts.map((g) => g.nodes.map((n) => N[n]));
const pinnedEnds = ghosts.map((g) => [pinned.has(g.nodes[0]), pinned.has(g.nodes[g.nodes.length - 1])]);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 900000 });
const p = await browser.newPage();
const res = await p.evaluate(async ({ mapB64, bg, chainsPx, pinnedEnds, DBG }) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const W2 = img.naturalWidth >> 1, H2 = img.naturalHeight >> 1;
  const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W2, H2);
  const d = ctx.getImageData(0, 0, W2, H2).data;

  // evidence tier 1: red road fill (strict seed + bounded growth into relaxed tier)
  const red = new Uint8Array(W2 * H2), weak = new Uint8Array(W2 * H2);
  // evidence tier 2: black casing/centre lines (thin dark, not green/blue features)
  const dark = new Uint8Array(W2 * H2);
  for (let i = 0, q = 0; i < d.length; i += 4, q++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r >= 95 && r <= 215 && g < 100 && b < 120 && r - g >= 40 && r - b >= 35) red[q] = 1;
    if (r >= 90 && r <= 225 && g < 100 && b < 130 && r - g >= 26 && r - b >= 26) weak[q] = 1;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 95 && g < r + 15 && b < r + 40) dark[q] = 1;
  }
  for (let pass = 0; pass < 10; pass++) {
    let grown = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const q = y * W2 + x;
      if (red[q] || !weak[q]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W2 && yy < H2 && red[yy * W2 + xx] === 1) { red[q] = 2; grown++; dy = 2; break; }
      }
    }
    for (let q = 0; q < red.length; q++) if (red[q] === 2) red[q] = 1;
    if (!grown) break;
  }
  // blob removal on both tiers (buildings / solid dark areas), Chebyshev DT
  const deblob = (m, core, margin) => {
    const BIG = 30000;
    const dt = new Int16Array(W2 * H2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      if (!m[i]) { dt[i] = 0; continue; }
      dt[i] = (x === 0 || y === 0 || x === W2 - 1) ? 1
        : Math.min(dt[i - 1], dt[i - W2], dt[i - W2 - 1], dt[i - W2 + 1]) + 1;
    }
    for (let y = H2 - 1; y >= 0; y--) for (let x = W2 - 1; x >= 0; x--) {
      const i = y * W2 + x; if (!dt[i]) continue;
      if (x === W2 - 1 || y === H2 - 1 || x === 0) { dt[i] = Math.min(dt[i], 1); continue; }
      dt[i] = Math.min(dt[i], Math.min(dt[i + 1], dt[i + W2], dt[i + W2 - 1], dt[i + W2 + 1]) + 1);
    }
    const d2 = new Int16Array(W2 * H2).fill(BIG);
    for (let i = 0; i < d2.length; i++) if (dt[i] >= core) d2[i] = 0;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = y * W2 + x; if (!d2[i]) continue;
      let v = d2[i];
      if (x > 0) v = Math.min(v, d2[i - 1] + 1);
      if (y > 0) { v = Math.min(v, d2[i - W2] + 1);
        if (x > 0) v = Math.min(v, d2[i - W2 - 1] + 1);
        if (x < W2 - 1) v = Math.min(v, d2[i - W2 + 1] + 1); }
      d2[i] = v;
    }
    for (let y = H2 - 1; y >= 0; y--) for (let x = W2 - 1; x >= 0; x--) {
      const i = y * W2 + x; if (!d2[i]) continue;
      let v = d2[i];
      if (x < W2 - 1) v = Math.min(v, d2[i + 1] + 1);
      if (y < H2 - 1) { v = Math.min(v, d2[i + W2] + 1);
        if (x < W2 - 1) v = Math.min(v, d2[i + W2 + 1] + 1);
        if (x > 0) v = Math.min(v, d2[i + W2 - 1] + 1); }
      d2[i] = v;
    }
    for (let i = 0; i < m.length; i++) if (m[i] && d2[i] <= margin) m[i] = 0;
  };
  deblob(red, 6, 7);
  deblob(dark, 5, 6);
  // keep only LINE-like dark pixels: casing lines fill ~7-14 px of a 7x7 window,
  // buildings/stipple far more — without this the A* rides through built-up blocks
  {
    const cnt = new Uint8Array(W2 * H2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      if (!dark[y * W2 + x]) continue;
      let n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W2 && yy < H2 && dark[yy * W2 + xx]) n++;
      }
      cnt[y * W2 + x] = Math.min(255, n);
    }
    for (let q = 0; q < dark.length; q++) if (dark[q] && cnt[q] > 18) dark[q] = 0;
  }

  const toPix = (wx, wz) => { const nx = wx / 1600 + 0.5, ny = 0.5 - wz / 1600;
    return [(nx - bg.gxL) / (bg.gxR - bg.gxL) * W2, (ny - (1 - bg.gyT)) / (bg.gyT - bg.gyB) * H2]; };
  const toWorld = (px, py) => {
    const nx = bg.gxL + px / W2 * (bg.gxR - bg.gxL), ny = (1 - bg.gyT) + py / H2 * (bg.gyT - bg.gyB);
    return [Math.round((nx - 0.5) * 16000) / 10, Math.round((0.5 - ny) * 16000) / 10];
  };
  const inB = (x, y) => x >= 0 && y >= 0 && x < W2 && y < H2;
  const evid = (x, y) => !inB(x, y) ? 0 : red[y * W2 + x] ? 2 : dark[y * W2 + x] ? 1 : 0;

  // snap an endpoint onto evidence nearby (red preferred), unless pinned
  const snap = (px, py, rMaxRed, rMaxDark) => {
    let best = null;
    for (let r = 0; r <= rMaxRed; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(px) + dx, y = Math.round(py) + dy;
        if (inB(x, y) && red[y * W2 + x]) { best = [x, y]; break; }
      }
      if (best) return best;
    }
    for (let r = 0; r <= rMaxDark; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(px) + dx, y = Math.round(py) + dy;
        if (inB(x, y) && dark[y * W2 + x]) { best = [x, y]; break; }
      }
      if (best) return best;
    }
    return [Math.round(px), Math.round(py)];
  };

  const simplify = (pts, eps) => {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [s, e] = st.pop(), a = pts[s], b = pts[e];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
      let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) { const dd = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L; if (dd > md) { md = dd; mi = i; } }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([s, mi], [mi, e]); }
    }
    const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  const stepCost = (x, y) => { const e = evid(x, y); return e === 2 ? 1 : e === 1 ? 2.2 : 6; };
  const corridor = (wpts, R, extra) => {
    const allowed = new Set(extra);
    for (let k = 1; k < wpts.length; k++) {
      const A = wpts[k - 1], B = wpts[k];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]), steps = Math.max(1, Math.ceil(L / 3));
      for (let s = 0; s <= steps; s++) {
        const cx = Math.round(A[0] + (B[0] - A[0]) * s / steps), cy = Math.round(A[1] + (B[1] - A[1]) * s / steps);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = cx + dx, y = cy + dy;
          if (inB(x, y)) allowed.add(y * W2 + x);
        }
      }
    }
    return allowed;
  };
  const astar = (allowed, s0, s1) => {
    const startK = s0[1] * W2 + s0[0], goalK = s1[1] * W2 + s1[0];
    const gS = new Map([[startK, 0]]), from = new Map();
    const open = [[Math.hypot(s1[0] - s0[0], s1[1] - s0[1]), startK]];
    let found = startK === goalK, guard = 0;
    while (open.length && guard++ < 700000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === goalK) { found = true; break; }
      const cx = cur % W2, cy = (cur / W2) | 0, gc = gS.get(cur);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx, y = cy + dy, k = y * W2 + x;
        if (!allowed.has(k)) continue;
        const ng = gc + stepCost(x, y) * (dx && dy ? 1.414 : 1);
        if (ng < (gS.get(k) ?? Infinity)) {
          gS.set(k, ng); from.set(k, cur);
          open.push([ng + Math.hypot(s1[0] - x, s1[1] - y), k]);
        }
      }
    }
    if (!found) return null;
    const path = []; let cur = goalK;
    while (cur !== undefined) { path.push([cur % W2, (cur / W2) | 0]); cur = from.get(cur); }
    path.reverse();
    return path;
  };
  const fracOf = (path) => { let h = 0; for (const [x, y] of path) if (evid(x, y)) h++; return h / path.length; };

  const R = 14;                      // corridor half-width in px (~4.6u)
  const out = [];
  let rescued = 0;
  for (let ci = 0; ci < chainsPx.length; ci++) {
    const wpts = chainsPx[ci].map(([wx, wz]) => toPix(wx, wz));
    const p0 = wpts[0], p1 = wpts[wpts.length - 1];
    const s0 = pinnedEnds[ci][0] ? [Math.round(p0[0]), Math.round(p0[1])] : snap(p0[0], p0[1], 10, 6);
    const s1 = pinnedEnds[ci][1] ? [Math.round(p1[0]), Math.round(p1[1])] : snap(p1[0], p1[1], 10, 6);
    const ends = [s0[1] * W2 + s0[0], s1[1] * W2 + s1[0]];
    let path = astar(corridor(wpts, R, ends), s0, s1);
    if (!path) { path = wpts.map(([x, y]) => [Math.round(x), Math.round(y)]); path[0] = s0; path[path.length - 1] = s1; }
    let frac = fracOf(path);
    // rescue: a near-zero-evidence result usually means the ghost ran far off the
    // real road — retry in a wide corridor and accept only a confident lock-on
    if (frac < 0.15) {
      const wide = astar(corridor(wpts, 34, ends), s0, s1);
      if (wide) { const wf = fracOf(wide); if (wf >= 0.35) { path = wide; frac = wf; rescued++; } }
    }
    out.push({ pts: simplify(path, 1.2).map(([x, y]) => toWorld(x, y)), frac });
  }

  // debug tile: evidence (red tier = green, dark tier = blue) + re-bent chains
  let dbg = null;
  if (DBG) {
    const [ax0, ay1] = toPix(DBG[0], DBG[1]), [ax1, ay0] = toPix(DBG[2], DBG[3]);
    const cw = Math.round(ax1 - ax0), chh = Math.round(ay1 - ay0);
    const S = Math.max(1, Math.min(3, Math.floor(1600 / Math.max(cw, chh))));
    const c2 = document.createElement('canvas'); c2.width = cw * S; c2.height = chh * S;
    const cx2 = c2.getContext('2d');
    cx2.imageSmoothingEnabled = false;
    cx2.drawImage(cv, ax0, ay0, cw, chh, 0, 0, cw * S, chh * S);
    const od = cx2.getImageData(0, 0, cw * S, chh * S);
    for (let y = 0; y < chh * S; y++) for (let x = 0; x < cw * S; x++) {
      const mx = ax0 + (x / S | 0), my = ay0 + (y / S | 0);
      if (!inB(mx | 0, my | 0)) continue;
      const q = (my | 0) * W2 + (mx | 0), o = (y * cw * S + x) * 4;
      if (red[q]) { od.data[o] = 40; od.data[o + 1] = 220; od.data[o + 2] = 90; }
      else if (dark[q]) { od.data[o] = 60; od.data[o + 1] = 120; od.data[o + 2] = 255; }
    }
    cx2.putImageData(od, 0, 0);
    for (const { pts, frac } of out) {
      cx2.strokeStyle = frac >= 0.15 ? '#ff2bd6' : '#ffee00'; cx2.lineWidth = 2; cx2.lineCap = 'round';
      cx2.beginPath(); let first = true;
      for (const [wx, wz] of pts) { const [ppx, ppy] = toPix(wx, wz); first ? cx2.moveTo((ppx - ax0) * S, (ppy - ay0) * S) : cx2.lineTo((ppx - ax0) * S, (ppy - ay0) * S); first = false; }
      cx2.stroke();
    }
    dbg = c2.toDataURL('image/png');
  }
  return { chains: out, rescued, dbg };
}, { mapB64, bg, chainsPx, pinnedEnds, DBG: process.env.DEBUG_TILE ? process.env.DEBUG_TILE.split(',').map(Number) : null });
await browser.close();

const fr = res.chains.map((c) => c.frac).sort((a, b) => a - b);
console.log('re-bent:', res.chains.length, 'chains (', res.rescued, 'rescued wide) | evidence coverage p10/p50/p90:',
  fr[Math.floor(fr.length * 0.1)].toFixed(2), fr[Math.floor(fr.length * 0.5)].toFixed(2), fr[Math.floor(fr.length * 0.9)].toFixed(2));
{
  const bins = new Array(10).fill(0);
  for (const c of res.chains) bins[Math.min(9, Math.floor(c.frac * 10))]++;
  console.log('frac histogram 0.0-1.0:', bins.join(' '));
}
if (res.dbg && process.env.DEBUG_OUT) writeFileSync(process.env.DEBUG_OUT, Buffer.from(res.dbg.split(',')[1], 'base64'));

if (process.argv.includes('--write')) {
  // swap each ghost chain's geometry for its re-bent path. Endpoints keep their node
  // ids (all incident chains agree on the snapped position); interiors are rebuilt.
  // Chains whose corridor holds (almost) no road evidence are INVENTIONS — the map
  // shows no road there (ghosts across the airfield, through fields) — drop them.
  const MIN_EVID = Number(process.env.MIN_EVID ?? 0.15);
  const dropEdge = new Set();
  for (const g of ghosts) for (const i of g.segs) dropEdge.add(i);
  E = E.filter((_, i) => !dropEdge.has(i));
  const addChain = (ci) => {
    const g = ghosts[ci], path = res.chains[ci].pts, [ow, cls, dirt] = g.flags;
    const n0 = g.nodes[0], n1 = g.nodes[g.nodes.length - 1];
    if (!pinned.has(n0)) N[n0] = path[0].slice();
    if (!pinned.has(n1)) N[n1] = path[path.length - 1].slice();
    let prev = n0;
    for (let k = 1; k < path.length - 1; k++) {
      const id = N.length; N.push(path[k].slice());
      E.push([prev, id, ow, cls, dirt]); prev = id;
    }
    E.push([prev, n1, ow, cls, dirt]);
  };
  // put a chain back exactly as it was (its old nodes still exist)
  const addOriginal = (ci) => {
    const g = ghosts[ci], [ow, cls, dirt] = g.flags;
    for (let k = 1; k < g.nodes.length; k++) E.push([g.nodes[k - 1], g.nodes[k], ow, cls, dirt]);
  };
  const candidates = [];
  let bentOD = 0, keptOD = 0;
  for (let ci = 0; ci < ghosts.length; ci++) {
    const kind = kindOf(ghosts[ci]);
    if (kind !== '2way') {
      // 1-way/dirt sketches follow real roads (badly) — re-bend on confident
      // evidence, otherwise leave the geometry alone. NEVER drop: a misclassified
      // owner stroke must survive.
      if (res.chains[ci].frac >= 0.25) { addChain(ci); bentOD++; } else { addOriginal(ci); keptOD++; }
      continue;
    }
    if (res.chains[ci].frac < MIN_EVID) {
      let len = 0; const p = res.chains[ci].pts;
      for (let k = 1; k < p.length; k++) len += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      candidates.push({ ci, len });
    } else addChain(ci);
  }
  console.log('oneway/dirt: re-bent', bentOD, '| kept as-is (weak evidence)', keptOD);
  // low-evidence chains are fantasy — the map shows no road. Re-add one ONLY when it
  // alone holds two inhabited parts of the network together (and never a dead-end
  // feeder into the fields). Shortest first: prefer the least invented geometry.
  {
    const par = [], find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const degN = new Map();
    const grow = () => { while (par.length < N.length) par.push(par.length); };
    grow();
    for (const e of E) { grow(); const a = find(e[0]), b = find(e[1]); if (a !== b) par[a] = b;
      degN.set(e[0], (degN.get(e[0]) || 0) + 1); degN.set(e[1], (degN.get(e[1]) || 0) + 1); }
    candidates.sort((a, b) => a.len - b.len);
    let kept = 0;
    for (const { ci } of candidates) {
      const g = ghosts[ci], n0 = g.nodes[0], n1 = g.nodes[g.nodes.length - 1];
      if (!degN.get(n0) || !degN.get(n1)) continue;              // dead-end feeder: drop
      grow();
      const a = find(n0), b = find(n1);
      if (a === b) continue;                                     // redundant shortcut: drop
      addChain(ci); grow(); par[a] = b; kept++;
    }
    console.log('fantasy chains: kept', kept, 'load-bearing of', candidates.length, '(rest dropped)');
  }
  // compact orphans (old chain interiors)
  {
    const usedN = new Set(); for (const e of E) { usedN.add(e[0]); usedN.add(e[1]); }
    const remap = new Map(), NN = [];
    for (const id of usedN) { remap.set(id, NN.length); NN.push(N[id]); }
    N = NN; E = E.map((e) => [remap.get(e[0]), remap.get(e[1]), e[2], e[3], e[4]]);
  }
  const healed = reconnectGraph(N, E);
  const crossed = connectCrossings(healed.nodes, healed.edges);
  N = crossed.nodes; E = crossed.edges;
  mergeComponents(N, E);
  relaxZigzag(N, E);
  const r1 = (v) => Math.round(v * 10) / 10;
  const emitN = 'export const ROAD_NODES_1966 = [' + N.map((p) => `[${r1(p[0])},${r1(p[1])}]`).join(', ') + '];';
  const emitE = 'export const ROAD_EDGES_1966 = [' + E.map((e) => e[4] ? `[${e[0]},${e[1]},${e[2]},${e[3]},1]` : (e[2] || e[3] !== 2) ? `[${e[0]},${e[1]},${e[2]},${e[3]}]` : `[${e[0]},${e[1]}]`).join(',') + '];';
  let s = readFileSync(roadsURL, 'utf8')
    .replace(/export const ROAD_NODES_1966 = \[[\s\S]*?\];/, () => emitN)
    .replace(/export const ROAD_EDGES_1966 = \[[\s\S]*?\];/, () => emitE);
  writeFileSync(roadsURL, s);
  console.log('rewrote roads1966.js: nodes', N.length, 'edges', E.length);
}
