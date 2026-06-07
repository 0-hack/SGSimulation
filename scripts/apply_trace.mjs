// Convert a hand-traced road file (from public/trace.html) into the game's
// road network. Usage:  node scripts/apply_trace.mjs path/to/sg1966-trace.json
//
// The trace stores roads as polylines in game-normalised coords [nx,ny].
// We snap nearby points into shared nodes (so crossing/meeting roads connect),
// decimate, lightly smooth, and rewrite public/js/roads1966.js — keeping the
// existing RESERVOIRS_1966 untouched.
import { readFileSync, writeFileSync } from 'node:fs';

const WORLD = 1600;
const STEP = 9;       // world-units between kept points along a road
const MERGE = 7;      // world-units: points this close fuse into one node (junctions)

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply_trace.mjs <trace.json>'); process.exit(1); }
const trace = JSON.parse(readFileSync(file, 'utf8'));
const polylines = (trace.roads || []).filter((r) => r.length >= 2);

const { RESERVOIRS_1966 } = await import('../public/js/roads1966.js');

const toWorld = ([nx, ny]) => [(nx - 0.5) * WORLD, (0.5 - ny) * WORLD];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// spatial hash for node merging
const nodes = [];
const cell = MERGE;
const grid = new Map();
const key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
function nodeAt(p) {
  const cx = Math.floor(p[0] / cell), cz = Math.floor(p[1] / cell);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const arr = grid.get((cx + dx) + ',' + (cz + dz));
    if (arr) for (const id of arr) if (dist(nodes[id], p) <= MERGE) return id;
  }
  const id = nodes.length; nodes.push(p.slice());
  const k = key(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(id);
  return id;
}

const edgeSet = new Set();
const edges = [];
function addEdge(a, b) { if (a === b) return; const k = a < b ? a + ':' + b : b + ':' + a; if (edgeSet.has(k)) return; edgeSet.add(k); edges.push([a, b]); }

for (const poly of polylines) {
  const w = poly.map(toWorld);
  // decimate by arc length, always keeping the two endpoints
  const kept = [w[0]]; let last = w[0];
  for (let i = 1; i < w.length - 1; i++) { if (dist(w[i], last) >= STEP) { kept.push(w[i]); last = w[i]; } }
  kept.push(w[w.length - 1]);
  let prev = nodeAt(kept[0]);
  for (let i = 1; i < kept.length; i++) { const id = nodeAt(kept[i]); addEdge(prev, id); prev = id; }
}

// light Taubin smoothing (freehand jitter) — topology preserved
const adj = nodes.map(() => new Set());
for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); }
function smooth(w) {
  const out = nodes.map((p) => p.slice());
  for (let i = 0; i < nodes.length; i++) {
    const nb = adj[i]; if (!nb.size) continue;
    let sx = 0, sz = 0; for (const j of nb) { sx += nodes[j][0]; sz += nodes[j][1]; }
    out[i][0] = nodes[i][0] + w * (sx / nb.size - nodes[i][0]);
    out[i][1] = nodes[i][1] + w * (sz / nb.size - nodes[i][1]);
  }
  for (let i = 0; i < nodes.length; i++) { nodes[i][0] = out[i][0]; nodes[i][1] = out[i][1]; }
}
for (let k = 0; k < 3; k++) { smooth(0.5); smooth(-0.48); }

const rd = (v) => Math.round(v * 10) / 10;
const onodes = nodes.map((p) => `[${rd(p[0])},${rd(p[1])}]`);
const oedges = edges.map(([a, b]) => `[${a},${b},0]`);
const body = `// 1966 Singapore road network + reservoirs. Hand-traced over the survey map
// with public/trace.html, then snapped/smoothed by scripts/apply_trace.mjs.
// NODES: [x, z] world coords.  EDGES: [a, b, oneway].  RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${onodes.join(', ')}];

export const ROAD_EDGES_1966 = [${oedges.join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(RESERVOIRS_1966)};
`;
writeFileSync(new URL('../public/js/roads1966.js', import.meta.url), body);
console.log(`applied ${polylines.length} traced roads -> ${nodes.length} nodes / ${edges.length} edges`);
