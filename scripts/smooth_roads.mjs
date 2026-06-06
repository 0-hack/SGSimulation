// Clean + smooth the traced 1966 road graph WITHOUT changing its topology, so
// the network stays faithful to the trace and fully interconnected:
//   1. drop tiny isolated specks (noise),
//   2. prune very short dead-end hairs (skeleton spurs),
//   3. Taubin-smooth node positions (de-jagged, no shrinkage) — every original
//      edge is kept, junctions keep connecting.
// Emits ROAD_NODES_1966 + ROAD_EDGES_1966 ([a,b,oneway]) + RESERVOIRS_1966.
import { ROAD_NODES_1966, ROAD_EDGES_1966, RESERVOIRS_1966 } from '/tmp/roads_orig.js';
import { writeFileSync } from 'node:fs';

let N = ROAD_NODES_1966.map(([x, z]) => ({ x, z }));
// undirected edge set with oneway flag
const eMap = new Map();                       // "a:b" -> oneway
const ek = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
for (const [a, b, ow] of ROAD_EDGES_1966) {
  if (a === b || a == null || b == null) continue;
  const k = ek(a, b);
  eMap.set(k, eMap.get(k) || !!ow);
}
let edges = [...eMap.keys()].map((k) => { const [a, b] = k.split(':').map(Number); return { a, b, ow: eMap.get(k) }; });

const buildAdj = () => {
  const adj = Array.from({ length: N.length }, () => new Set());
  for (const { a, b } of edges) { adj[a].add(b); adj[b].add(a); }
  return adj;
};
const dist = (i, j) => Math.hypot(N[i].x - N[j].x, N[i].z - N[j].z);

// --- 1. keep only sizeable connected components (drop floating specks) ---
{
  const adj = buildAdj();
  const comp = new Array(N.length).fill(-1);
  let nc = 0;
  for (let s = 0; s < N.length; s++) {
    if (comp[s] !== -1 || adj[s].size === 0) continue;
    const stack = [s]; comp[s] = nc; const members = [s];
    while (stack.length) { const u = stack.pop(); for (const v of adj[u]) if (comp[v] === -1) { comp[v] = nc; members.push(v); stack.push(v); } }
    nc++;
  }
  // component total edge length
  const compLen = new Array(nc).fill(0);
  for (const { a, b } of edges) compLen[comp[a]] += dist(a, b);
  const compCnt = new Array(nc).fill(0);
  for (let i = 0; i < N.length; i++) if (comp[i] >= 0) compCnt[comp[i]]++;
  const keep = (c) => compLen[c] >= 18 || compCnt[c] >= 6;   // drop tiny isolated bits
  edges = edges.filter(({ a }) => keep(comp[a]));
}

// --- 2. iteratively prune short dead-end hairs ---
for (let pass = 0; pass < 4; pass++) {
  const adj = buildAdj();
  const before = edges.length;
  edges = edges.filter(({ a, b }) => {
    const da = adj[a].size, db = adj[b].size;
    const isHair = (da === 1 || db === 1) && dist(a, b) < 4.5;   // a stubby spur tip
    return !isHair;
  });
  if (edges.length === before) break;
}

// --- compact node indices to those still referenced ---
{
  const used = new Set();
  for (const { a, b } of edges) { used.add(a); used.add(b); }
  const remap = new Map(); const newN = [];
  for (const i of used) { remap.set(i, newN.length); newN.push(N[i]); }
  N = newN;
  edges = edges.map(({ a, b, ow }) => ({ a: remap.get(a), b: remap.get(b), ow }));
}

// --- 3. Taubin smoothing (λ then μ) of node positions: de-jagged, no shrink ---
function smoothPass(weight) {
  const adj = buildAdj();
  const out = N.map((p) => ({ x: p.x, z: p.z }));
  for (let i = 0; i < N.length; i++) {
    const nb = adj[i]; if (nb.size === 0) continue;
    let sx = 0, sz = 0;
    for (const j of nb) { sx += N[j].x; sz += N[j].z; }
    const ax = sx / nb.size, az = sz / nb.size;
    out[i].x = N[i].x + weight * (ax - N[i].x);
    out[i].z = N[i].z + weight * (az - N[i].z);
  }
  N = out;
}
for (let it = 0; it < 6; it++) { smoothPass(0.55); smoothPass(-0.54); }   // Taubin λ/μ

const round = (v) => Math.round(v * 10) / 10;
const outNodes = N.map((p) => [round(p.x), round(p.z)]);
const outEdges = edges.map(({ a, b, ow }) => `[${a},${b},${ow ? 1 : 0}]`);

const body = `// 1966 Singapore road network + reservoirs, traced from the 1966 survey map
// (NUS Libmaps GeoTIFF), georeferenced onto the game island. Auto-generated:
// the full interconnected trace, de-noised and Taubin-smoothed (topology kept).
// NODES: [x, z] world coords.  EDGES: [a, b, oneway].  RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${outNodes.map(([x, z]) => `[${x},${z}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${outEdges.join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(RESERVOIRS_1966)};
`;
writeFileSync(new URL('../public/js/roads1966.js', import.meta.url), body);
console.log(`nodes=${outNodes.length} edges=${outEdges.length} oneway=${edges.filter((e) => e.ow).length}`);
