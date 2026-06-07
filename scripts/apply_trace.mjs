// Convert a hand-traced file (from public/trace.html) into the game's data.
// Usage:  node scripts/apply_trace.mjs path/to/sg1966-trace.json
//
// Trace layers (all in game-normalised coords [nx,ny]):
//   roads : [{pts, oneway}]  -> ROAD_NODES_1966 / ROAD_EDGES_1966 (junctions snapped)
//   resv  : [[...]]          -> RESERVOIRS_1966 (normalised polygons)  [if traced]
//   coast : [[...]]          -> scripts/traced-shape.json (outline+islands) for review
// public/js/roads1966.js is rewritten; the coastline is staged separately because
// it cascades into the island shape, terrain and airport (integrated by hand).
import { readFileSync, writeFileSync } from 'node:fs';

const WORLD = 1600;
const STEP = 9;       // world-units between kept road points
const MERGE = 7;      // world-units: points this close fuse into one node (junctions)

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply_trace.mjs <trace.json>'); process.exit(1); }
const trace = JSON.parse(readFileSync(file, 'utf8'));
const roadsIn = (trace.roads || []).map(r => Array.isArray(r) ? { pts: r, oneway: false } : r).filter(r => r.pts.length >= 2);
const coastIn = (trace.coast || []).filter(p => p.length >= 3);
const resvIn = (trace.resv || []).filter(p => p.length >= 3);

const current = await import('../public/js/roads1966.js');

const toWorld = ([nx, ny]) => [(nx - 0.5) * WORLD, (0.5 - ny) * WORLD];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------- roads: snap to a shared-node graph (junctions connect) ----------
const nodes = [], grid = new Map();
const key = (x, z) => Math.floor(x / MERGE) + ',' + Math.floor(z / MERGE);
function nodeAt(p) {
  const cx = Math.floor(p[0] / MERGE), cz = Math.floor(p[1] / MERGE);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const arr = grid.get((cx + dx) + ',' + (cz + dz));
    if (arr) for (const id of arr) if (dist(nodes[id], p) <= MERGE) return id;
  }
  const id = nodes.length; nodes.push(p.slice());
  const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
  return id;
}
const seen = new Set(), edges = [];
function addEdge(a, b, ow) { if (a === b) return; const k = a < b ? a + ':' + b : b + ':' + a; if (seen.has(k)) return; seen.add(k); edges.push([a, b, ow ? 1 : 0]); }

for (const road of roadsIn) {
  const w = road.pts.map(toWorld);
  const kept = [w[0]]; let last = w[0];
  for (let i = 1; i < w.length - 1; i++) if (dist(w[i], last) >= STEP) { kept.push(w[i]); last = w[i]; }
  kept.push(w[w.length - 1]);
  let prev = nodeAt(kept[0]);
  for (let i = 1; i < kept.length; i++) { const id = nodeAt(kept[i]); addEdge(prev, id, road.oneway); prev = id; }
}
// light Taubin smoothing (freehand jitter), topology preserved
const adj = nodes.map(() => new Set());
for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); }
function smooth(wt) {
  const out = nodes.map(p => p.slice());
  for (let i = 0; i < nodes.length; i++) { const nb = adj[i]; if (!nb.size) continue;
    let sx = 0, sz = 0; for (const j of nb) { sx += nodes[j][0]; sz += nodes[j][1]; }
    out[i][0] = nodes[i][0] + wt * (sx / nb.size - nodes[i][0]); out[i][1] = nodes[i][1] + wt * (sz / nb.size - nodes[i][1]); }
  for (let i = 0; i < nodes.length; i++) nodes[i] = out[i];
}
for (let k = 0; k < 3; k++) { smooth(0.5); smooth(-0.48); }

// ---------- reservoirs: normalised polygons (decimated) ----------
function decimateN(pts, minD) {
  if (pts.length < 3) return pts;
  const out = [pts[0]]; let last = pts[0];
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= minD) { out.push(pts[i]); last = pts[i]; }
  return out;
}
const reservoirs = resvIn.length
  ? resvIn.map(p => decimateN(p, 0.004).map(([nx, ny]) => [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000]))
  : current.RESERVOIRS_1966;

// ---------- coast: stage for manual integration ----------
if (coastIn.length) {
  const loops = coastIn.map(p => decimateN(p, 0.004).map(([nx, ny]) => [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000]));
  loops.sort((a, b) => b.length - a.length);
  writeFileSync(new URL('./traced-shape.json', import.meta.url),
    JSON.stringify({ outline: loops[0], islands: loops.slice(1) }, null, 0));
  console.log(`coast: wrote scripts/traced-shape.json (outline ${loops[0].length} pts, ${loops.length - 1} island loop(s)) — integrate into shape.js`);
}

// ---------- write roads1966.js ----------
const rd = v => Math.round(v * 10) / 10;
const body = `// 1966 Singapore road network + reservoirs. Hand-traced over the survey map
// with public/trace.html, then snapped/smoothed by scripts/apply_trace.mjs.
// NODES: [x, z] world coords.  EDGES: [a, b, oneway].  RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${nodes.map(p => `[${rd(p[0])},${rd(p[1])}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${edges.map(([a, b, o]) => `[${a},${b},${o}]`).join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(reservoirs)};
`;
writeFileSync(new URL('../public/js/roads1966.js', import.meta.url), body);
const ow = edges.filter(e => e[2]).length;
console.log(`roads: ${roadsIn.length} traced -> ${nodes.length} nodes / ${edges.length} edges (${ow} one-way)`);
console.log(`reservoirs: ${resvIn.length ? 'updated to ' + reservoirs.length + ' traced' : 'kept existing ' + reservoirs.length}`);
