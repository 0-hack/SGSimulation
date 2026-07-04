// Repair a traced 1966 road graph: weld the many broken junctions back together.
//
// The tracer welds a road's endpoints only to nearby NODES, never onto another road's
// mid-span, and only within a small radius — so hand-traced T-junctions and any ends
// that land a couple of units short stay disconnected, shattering the map into ~1000
// islands. reconnectGraph() walks every dangling road END and:
//   A) welds it to the nearest unrelated NODE within WELD (a real junction/dead-end pair)
//   B) else splices it onto the nearest road BODY within WELDT (a T-junction: the edge is
//      split at the touch point and the end joined to it)
// Only ENDPOINTS move — every interior curve point is left exactly as traced, so the
// careful freehand curves are preserved. Road type flags (single/dirt/class) are kept.
//
// Exported so apply_trace can self-heal the network on every save; the CLI below also
// runs a gentle sharp-corner smoothing pass before rewriting public/js/roads1966.js.
// Usage: node scripts/reconnect_roads.mjs [--write] [--smooth]   (dry-run prints stats)
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function countComponents(N, E) {
  const adj = Array.from({ length: N.length }, () => []), deg = new Array(N.length).fill(0);
  for (const e of E) { if (!e) continue; adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); deg[e[0]]++; deg[e[1]]++; }
  const seen = new Array(N.length).fill(false); let c = 0;
  for (let i = 0; i < N.length; i++) { if (seen[i] || deg[i] === 0) continue; c++; const st = [i]; while (st.length) { const x = st.pop(); if (seen[x]) continue; seen[x] = true; for (const y of adj[x]) if (!seen[y]) st.push(y); } }
  return c;
}

// Weld dangling road ends back into the graph. Returns { nodes, edges } with the same
// [a,b,ow,cls,dirt] edge shape. Pure — does not mutate the inputs.
export function reconnectGraph(N0, E0, { weld = 1.8, weldT = 1.6 } = {}) {
  let N = N0.map((p) => p.slice());
  let E = E0.map((e) => [e[0], e[1], e[2] || 0, e[3] || 2, e[4] || 0]);
  const cell = Math.max(weld, weldT) + 0.01, gk = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
  let grid = new Map();
  const buildGrid = () => { grid = new Map(); N.forEach((p, i) => { const k = gk(p[0], p[1]); (grid.get(k) || grid.set(k, []).get(k)).push(i); }); };
  const buildAdj = () => { const a = Array.from({ length: N.length }, () => new Set()); for (const e of E) { if (!e) continue; a[e[0]].add(e[1]); a[e[1]].add(e[0]); } return a; };
  const nearNodes = (p) => { const cx = Math.floor(p[0] / cell), cz = Math.floor(p[1] / cell), out = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const arr = grid.get((cx + dx) + ',' + (cz + dz)); if (arr) out.push(...arr); } return out; };
  buildGrid(); let adj = buildAdj();

  // Phase A: weld each dangling end to the nearest unrelated node (union-find).
  const uf = new Array(N.length); for (let i = 0; i < N.length; i++) uf[i] = i;
  const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  for (let i = 0; i < N.length; i++) {
    if (adj[i].size !== 1) continue;
    let best = weld, bj = -1;
    for (const j of nearNodes(N[i])) { if (j === i || adj[i].has(j) || find(j) === find(i)) continue; const d = dist(N[i], N[j]); if (d > 1e-9 && d < best) { best = d; bj = j; } }
    if (bj >= 0) uf[find(i)] = find(bj);
  }
  { const rep = new Map(), nn = []; const idOf = (r) => { r = find(r); if (!rep.has(r)) { rep.set(r, nn.length); nn.push(N[r]); } return rep.get(r); };
    const seen = new Set(), ne = []; for (const e of E) { if (!e) continue; const a = idOf(e[0]), b = idOf(e[1]); if (a === b) continue; const k = a < b ? a + ':' + b : b + ':' + a; if (seen.has(k)) continue; seen.add(k); ne.push([a, b, e[2], e[3], e[4]]); } N = nn; E = ne; }
  buildGrid(); adj = buildAdj();

  // Phase B: splice each remaining dangling end onto the nearest road body (T-junction).
  const edgeGrid = new Map();
  // bucket an edge into EVERY cell it crosses (not just its endpoints), so a T-junction
  // that meets the middle of a long segment is still found.
  const addEdgeCell = (ei) => { const e = E[ei]; if (!e) return; const A = N[e[0]], B = N[e[1]]; const L = dist(A, B), n = Math.max(1, Math.ceil(L / cell)); const put = new Set();
    for (let s = 0; s <= n; s++) { const t = s / n, k = gk(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); if (!put.has(k)) { put.add(k); (edgeGrid.get(k) || edgeGrid.set(k, []).get(k)).push(ei); } } };
  for (let i = 0; i < E.length; i++) addEdgeCell(i);
  for (let i = 0; i < N.length; i++) {
    if (adj[i].size !== 1) continue;
    const p = N[i], cx = Math.floor(p[0] / cell), cz = Math.floor(p[1] / cell);
    let best = weldT, be = -1, bt = 0; const seenE = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const arr = edgeGrid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
      for (const ei of arr) { if (seenE.has(ei)) continue; seenE.add(ei); const e = E[ei]; if (!e || e[0] === i || e[1] === i) continue;
        const A = N[e[0]], B = N[e[1]], ddx = B[0] - A[0], ddz = B[1] - A[1], l2 = ddx * ddx + ddz * ddz || 1e-9;
        let t = ((p[0] - A[0]) * ddx + (p[1] - A[1]) * ddz) / l2; if (t < 0.08 || t > 0.92) continue;
        const qx = A[0] + t * ddx, qz = A[1] + t * ddz, d = Math.hypot(p[0] - qx, p[1] - qz);
        if (d < best) { best = d; be = ei; bt = t; } } }
    if (be >= 0) {
      const e = E[be], A = N[e[0]], B = N[e[1]], mid = N.length;
      N.push([A[0] + bt * (B[0] - A[0]), A[1] + bt * (B[1] - A[1])]);
      E[be] = [e[0], mid, e[2], e[3], e[4]]; E.push([mid, e[1], e[2], e[3], e[4]]);
      const my = E.find((x) => x && (x[0] === i || x[1] === i));
      E.push([i, mid, my ? my[2] : 0, my ? my[3] : 2, my ? my[4] : 0]);
      addEdgeCell(E.length - 1); addEdgeCell(E.length - 2);
      adj[i] = new Set([mid]); adj[mid] = new Set([e[0], e[1], i]);
    }
  }
  return { nodes: N, edges: E.filter(Boolean) };
}

// Turn every mid-span CROSSING into a real junction. Strokes drawn at different times
// often just pass through each other — visually an X, but no shared node, so the two
// roads are NOT connected in the graph. This finds every pair of edges that
// geometrically intersect (and don't already share a node), places one junction node
// at the crossing (reusing a nearby endpoint when one sits within `weldNear`), and
// splits both edges there. 1966 roads have no grade separation, so a crossing is
// always a junction. Only the crossing point is added — the traced lines don't move.
export function connectCrossings(N0, E0, { minT = 0.02, weldNear = 0.5 } = {}) {
  const N = N0.map((p) => p.slice());
  let E = E0.map((e) => [e[0], e[1], e[2] || 0, e[3] || 2, e[4] || 0]);
  const cell = 4, gk = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell), grid = new Map();
  for (let i = 0; i < E.length; i++) { const A = N[E[i][0]], B = N[E[i][1]], L = dist(A, B), n = Math.max(1, Math.ceil(L / cell)); const put = new Set();
    for (let s = 0; s <= n; s++) { const t = s / n, k = gk(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); if (!put.has(k)) { put.add(k); (grid.get(k) || grid.set(k, []).get(k)).push(i); } } }
  const splits = new Map();   // edge index -> [{t, node}]
  const addSplit = (ei, t, node) => { let a = splits.get(ei); if (!a) splits.set(ei, a = []); a.push({ t, node }); };
  const tested = new Set(); let found = 0;
  for (const [, arr] of grid) for (let x = 0; x < arr.length; x++) for (let y = x + 1; y < arr.length; y++) {
    const i = arr[x], j = arr[y], key = i < j ? i + ':' + j : j + ':' + i;
    if (tested.has(key)) continue; tested.add(key);
    const a = E[i], b = E[j];
    if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;   // already joined
    const P = N[a[0]], Q = N[a[1]], R = N[b[0]], S = N[b[1]];
    const d1x = Q[0] - P[0], d1z = Q[1] - P[1], d2x = S[0] - R[0], d2z = S[1] - R[1];
    const den = d1x * d2z - d1z * d2x; if (Math.abs(den) < 1e-9) continue;            // parallel/collinear: leave overlapping strokes alone
    const t = ((R[0] - P[0]) * d2z - (R[1] - P[1]) * d2x) / den;
    const u = ((R[0] - P[0]) * d1z - (R[1] - P[1]) * d1x) / den;
    if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) continue;
    const X = [P[0] + t * d1x, P[1] + t * d1z];
    // the junction node: reuse the closest endpoint of either edge if it's basically AT
    // the crossing (avoids a sliver segment), otherwise mint a node at the crossing.
    const cand = [[a[0], dist(X, P)], [a[1], dist(X, Q)], [b[0], dist(X, R)], [b[1], dist(X, S)]].sort((p, q) => p[1] - q[1]);
    const node = cand[0][1] <= weldNear ? cand[0][0] : (N.push(X), N.length - 1);
    let did = false;
    if (t > minT && t < 1 - minT && node !== a[0] && node !== a[1]) { addSplit(i, t, node); did = true; }
    if (u > minT && u < 1 - minT && node !== b[0] && node !== b[1]) { addSplit(j, u, node); did = true; }
    if (did) found++;
  }
  if (!splits.size) return { nodes: N, edges: E, crossings: 0 };
  const out = [];
  for (let ei = 0; ei < E.length; ei++) {
    const e = E[ei], sp = splits.get(ei);
    if (!sp || !sp.length) { out.push(e); continue; }
    sp.sort((p, q) => p.t - q.t);
    let prev = e[0]; const seen = new Set([e[0], e[1]]);
    for (const { node } of sp) { if (seen.has(node)) continue; seen.add(node); out.push([prev, node, e[2], e[3], e[4]]); prev = node; }
    out.push([prev, e[1], e[2], e[3], e[4]]);
  }
  return { nodes: N, edges: out.filter((e) => e[0] !== e[1]), crossings: found };
}

// Gently round SHARP corners (degree-2 chain points only): a light Laplacian nudge
// toward the neighbour midpoint where the road kinks hard. Junctions and dead-ends are
// pinned and smooth bends barely move, so the careful curves stay — only jagged kinks soften.
export function smoothSharp(N0, E, { iters = 2, pull = 0.22, cosGate = 0.7 } = {}) {
  let N = N0.map((p) => p.slice());
  const adj = Array.from({ length: N.length }, () => new Set());
  for (const e of E) { if (!e) continue; adj[e[0]].add(e[1]); adj[e[1]].add(e[0]); }
  const cosTurn = (a, b, c) => { const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1]; const la = Math.hypot(ux, uz) || 1, lb = Math.hypot(vx, vz) || 1; return Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (la * lb))); };
  for (let it = 0; it < iters; it++) {
    const moved = N.map((p) => p.slice());
    for (let i = 0; i < N.length; i++) {
      if (adj[i].size !== 2) continue; const [a, b] = [...adj[i]];
      if (cosTurn(N[a], N[i], N[b]) > cosGate) continue;   // already gentle — leave it
      moved[i][0] = N[i][0] * (1 - pull) + (N[a][0] + N[b][0]) / 2 * pull;
      moved[i][1] = N[i][1] * (1 - pull) + (N[a][1] + N[b][1]) / 2 * pull;
    }
    N = moved;
  }
  return N;
}

// ---- CLI: repair public/js/roads1966.js in place ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const roadsURL = new URL('../public/js/roads1966.js', import.meta.url);
  const mod = await import('../public/js/roads1966.js?u=' + Date.now());
  const N0 = mod.ROAD_NODES_1966, E0 = mod.ROAD_EDGES_1966;
  const before = { comps: countComponents(N0, E0), nodes: N0.length, edges: E0.length };
  let { nodes, edges } = reconnectGraph(N0, E0);
  const cx = connectCrossings(nodes, edges); nodes = cx.nodes; edges = cx.edges;
  console.log('crossings connected:', cx.crossings);
  if (process.argv.includes('--smooth')) nodes = smoothSharp(nodes, edges);
  const r1 = (v) => Math.round(v * 10) / 10; nodes = nodes.map((p) => [r1(p[0]), r1(p[1])]);
  console.log('before:', JSON.stringify(before));
  console.log('after :', JSON.stringify({ comps: countComponents(nodes, edges), nodes: nodes.length, edges: edges.length }));
  if (process.argv.includes('--write')) {
    const emitN = 'export const ROAD_NODES_1966 = [' + nodes.map((p) => `[${p[0]},${p[1]}]`).join(', ') + '];';
    const emitE = 'export const ROAD_EDGES_1966 = [' + edges.map((e) => e[4] ? `[${e[0]},${e[1]},${e[2]},${e[3]},${e[4]}]` : (e[3] !== 2 || e[2]) ? `[${e[0]},${e[1]},${e[2]},${e[3]}]` : `[${e[0]},${e[1]}]`).join(', ') + '];';
    let out = readFileSync(roadsURL, 'utf8').replace(/export const ROAD_NODES_1966 = \[[\s\S]*?\];/, emitN).replace(/export const ROAD_EDGES_1966 = \[[\s\S]*?\];/, emitE);
    writeFileSync(roadsURL, out); console.log('wrote', roadsURL.pathname);
  }
}
