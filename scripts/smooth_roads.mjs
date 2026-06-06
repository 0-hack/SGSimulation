// Re-process the traced 1966 road graph (thousands of tiny straight edges) into
// smooth STROKES. Real roads flow through intersections, so we trace strokes:
// from an unused edge, keep extending through each node along the straightest
// continuation, then Chaikin-smooth and prune stubby spurs. Emits
// ROAD_NODES_1966 (stroke endpoints) + ROAD_CHAINS_1966 (smoothed polylines).
import { ROAD_NODES_1966, ROAD_EDGES_1966, RESERVOIRS_1966 } from '../public/js/roads1966.js';
import { writeFileSync } from 'node:fs';

const N = ROAD_NODES_1966.map(([x, z]) => ({ x, z }));
const adj = Array.from({ length: N.length }, () => new Set());
const owKey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
const oneway = new Map();
for (const [a, b, ow] of ROAD_EDGES_1966) {
  if (a === b) continue; adj[a].add(b); adj[b].add(a);
  if (ow) oneway.set(owKey(a, b), true);
}

const eKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
const used = new Set();
const heading = (i, j) => { const dx = N[j].x - N[i].x, dz = N[j].z - N[i].z; const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

// extend a stroke from node `cur` (arriving along heading h) picking the
// unused neighbour whose direction best continues h (max dot, > cos120°).
function extend(prev, cur, push) {
  for (;;) {
    const [hx, hz] = heading(prev, cur);
    let best = -1, bestDot = -0.5;     // require turn < ~120°
    for (const k of adj[cur]) {
      if (k === prev) continue;
      if (used.has(eKey(cur, k))) continue;
      const [dx, dz] = heading(cur, k);
      const dot = dx * hx + dz * hz;
      if (dot > bestDot) { bestDot = dot; best = k; }
    }
    if (best === -1) break;
    used.add(eKey(cur, best));
    push(best);
    prev = cur; cur = best;
  }
}

const strokes = [];
// seed from every edge; strongest seeds first doesn't matter much
const allEdges = [];
for (let a = 0; a < N.length; a++) for (const b of adj[a]) if (a < b) allEdges.push([a, b]);
for (const [a, b] of allEdges) {
  if (used.has(eKey(a, b))) continue;
  used.add(eKey(a, b));
  const path = [a, b];
  extend(a, b, (k) => path.push(k));               // forward
  const back = [];
  extend(b, a, (k) => back.push(k));               // backward
  back.reverse(); const full = back.concat(path);
  strokes.push(full);
}

const plen = (path) => { let s = 0; for (let i = 1; i < path.length; i++) s += Math.hypot(N[path[i]].x - N[path[i - 1]].x, N[path[i]].z - N[path[i - 1]].z); return s; };

function chaikin(pts, iters) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    if (p.length < 3) break;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
function decimate(pts, minD) {
  if (pts.length < 3) return pts;
  const out = [pts[0]]; let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (Math.hypot(pts[i].x - last.x, pts[i].z - last.z) >= minD) { out.push(pts[i]); last = pts[i]; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const round = (v) => Math.round(v * 10) / 10;
const jIndex = new Map(); const outNodes = [];
function nodeIdAt(p) {                              // snap endpoints to a shared node within 4u
  for (const [key, id] of jIndex) { const o = outNodes[id]; if (Math.hypot(o[0] - p.x, o[1] - p.z) < 4) return id; }
  const id = outNodes.length; outNodes.push([round(p.x), round(p.z)]); jIndex.set(id, id); return id;
}

const outChains = [];
for (const path of strokes) {
  const L = plen(path);
  if (L < 7 && path.length <= 3) continue;          // drop tiny specks / stubs
  const raw = path.map((i) => N[i]);
  let sm = chaikin(raw, 3);
  sm = decimate(sm, 2.2);
  sm[0] = raw[0]; sm[sm.length - 1] = raw[raw.length - 1];
  const owVotes = []; for (let i = 1; i < path.length; i++) owVotes.push(oneway.has(owKey(path[i - 1], path[i])));
  const ow = owVotes.filter(Boolean).length > owVotes.length / 2;
  const a = nodeIdAt(sm[0]), b = nodeIdAt(sm[sm.length - 1]);
  outChains.push([a, b, ow ? 1 : 0, sm.map((p) => [round(p.x), round(p.z)])]);
}

const fmtPts = (pts) => '[' + pts.map(([x, z]) => `[${x},${z}]`).join(',') + ']';
const body = `// 1966 Singapore road network + reservoirs, traced from the 1966 survey map
// (NUS Libmaps GeoTIFF), georeferenced onto the game island. Auto-generated.
// NODES: [x, z] world coords (stroke endpoints).
// CHAINS: [aNode, bNode, oneway, [[x,z]...] smoothed polyline].
// RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${outNodes.map(([x, z]) => `[${x},${z}]`).join(', ')}];

export const ROAD_CHAINS_1966 = [
${outChains.map(([a, b, ow, pts]) => `[${a},${b},${ow},${fmtPts(pts)}]`).join(',\n')}
];

export const RESERVOIRS_1966 = ${JSON.stringify(RESERVOIRS_1966)};
`;
writeFileSync(new URL('../public/js/roads1966.js', import.meta.url), body);
const totalPts = outChains.reduce((s, c) => s + c[3].length, 0);
const lens = outChains.map((c, i) => plen(strokes[i] || [])); // approx
console.log(`strokes=${strokes.length} kept=${outChains.length} nodes=${outNodes.length} avgPts=${(totalPts / outChains.length).toFixed(1)} totalPts=${totalPts}`);
