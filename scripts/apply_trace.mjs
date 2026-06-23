// Apply a hand-traced file (from public/trace.html) to the game's source.
// Usage (CLI):  node scripts/apply_trace.mjs path/to/sg1966-trace.json
// Also exported as applyTrace(trace) so the server can apply traces live
// (real-time corrections from the in-browser tracer) and graphToTrace() to send
// the current road network back to the tracer for editing.
//
// Every layer is OPTIONAL and applied independently. All coords are game-
// normalised [nx,ny] (x east, y north).
//   roads      [{pts,oneway}] -> public/js/roads1966.js   ROAD_NODES/EDGES
//   reservoirs [[...]]        -> public/js/roads1966.js   RESERVOIRS_1966
//   mainland   [[...]]        -> public/js/shape.js        SG_OUTLINE
//   islands    [[...]]        -> public/js/shape.js        SG_ISLANDS
//   foreign    [[...]]        -> public/js/shape.js        SG_FOREIGN
//   airport    [[...]]        -> public/js/scene3d.js      AIRPORT south/north
//   buildings  [{...}]        -> scene3d.js                AIRPORT.buildings
//   houses     [{...}]        -> custom1966.js             CUSTOM_HOUSES
//   railway/sands [[...]]     -> custom1966.js             CUSTOM_RAILWAYS / _SANDS
import { readFileSync, writeFileSync } from 'node:fs';

// SIMPLIFY: Douglas-Peucker tolerance in world units (~0.6u ≈ 22m) — how far the
//   kept polyline may stray from the raw trace. Small, so the dense southern
//   street grid and curves stay faithful instead of being flattened.
// MERGE: weld radius — points within this distance share a node, joining the
//   junctions the player drew coincident WITHOUT collapsing distinct parallel
//   streets (which sit ~2.3u apart in the south, so this stays below that).
const WORLD = 1600, SIMPLIFY = 0.6, MERGE = 2;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toWorld = ([nx, ny]) => [(nx - 0.5) * WORLD, (0.5 - ny) * WORLD];
const toNorm = ([x, z]) => [x / WORLD + 0.5, 0.5 - z / WORLD];
// Douglas-Peucker line simplification (points are [x,z] world units). Keeps
// corners and curve detail while dropping the redundant in-between points of an
// over-sampled freehand stroke. Unlike a uniform step-decimation it NEVER drops a
// whole short road or rounds off a sharp grid junction, so it preserves the fine
// road detail of a careful trace.
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(), a = pts[s], b = pts[e];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / L; // perpendicular distance
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  const out = []; for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
function decimateN(pts, minD) {
  if (pts.length < 3) return pts.map(([x, y]) => [r3(x), r3(y)]);
  const out = [pts[0]]; let last = pts[0];
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], last) >= minD) { out.push(pts[i]); last = pts[i]; }
  return out.map(([x, y]) => [r3(x), r3(y)]);
}

// Convert the current ROAD_NODES/EDGES graph into tracer polylines (chains of
// degree-2 nodes), in game-normalised coords — so the tracer can load and edit
// the existing network instead of starting blank.
export function graphToTrace(nodes, edges) {
  const adj = nodes.map(() => []);
  for (const e of edges) { adj[e[0]].push({ n: e[1], ow: !!e[2] }); adj[e[1]].push({ n: e[0], ow: !!e[2] }); }
  const used = new Set(), ek = (a, b) => (a < b ? a + ':' + b : b + ':' + a), roads = [];
  const walk = (a, entry) => {
    const pts = [a]; let prev = a, cur = entry.n; used.add(ek(a, entry.n)); pts.push(cur);
    while (adj[cur].length === 2) {
      const nxt = adj[cur].find(e => e.n !== prev);
      if (!nxt || used.has(ek(cur, nxt.n))) break;
      used.add(ek(cur, nxt.n)); prev = cur; cur = nxt.n; pts.push(cur);
    }
    return { pts, ow: entry.ow };
  };
  for (let i = 0; i < nodes.length; i++) { if (adj[i].length === 2) continue; for (const e of adj[i]) if (!used.has(ek(i, e.n))) roads.push(walk(i, e)); }
  for (let i = 0; i < nodes.length; i++) for (const e of adj[i]) if (!used.has(ek(i, e.n))) roads.push(walk(i, e));
  return { roads: roads.filter(c => c.pts.length >= 2).map(c => ({ pts: c.pts.map(j => toNorm(nodes[j]).map(r4)), oneway: c.ow })) };
}

// Return ALL current game map layers as tracer polylines/polygons, so the
// tracer can DISPLAY what's already in the game (read-only reference) under each
// "show" filter — roads, coast (+islands), reservoirs, railway, sands, airport.
export async function getGameLayers() {
  const u = '?u=' + Date.now();
  const rd = await import('../public/js/roads1966.js' + u);
  const sh = await import('../public/js/shape.js' + u);
  const cu = await import('../public/js/custom1966.js' + u);
  const { roads } = graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966);
  // airport runway centre-line (2 points) read from scene3d.js
  let airport = [];
  try {
    const sc = readFileSync(new URL('../public/js/scene3d.js', import.meta.url), 'utf8');
    const m = sc.match(/south: \{ x: ([-\d.]+), y: ([-\d.]+) \}, north: \{ x: ([-\d.]+), y: ([-\d.]+) \}/);
    if (m) airport = [[[+m[1], +m[2]], [+m[3], +m[4]]]];
  } catch {}
  return {
    roads,
    mainland: [sh.SG_OUTLINE, ...(sh.SG_ISLANDS || [])].filter(p => p && p.length >= 3),
    reservoirs: (rd.RESERVOIRS_1966 || []).filter(p => p && p.length >= 3),
    railway: cu.CUSTOM_RAILWAYS || [],
    sands: [...(sh.SG_SANDS || []), ...(cu.CUSTOM_SANDS || [])].filter(p => p && p.length >= 3),
    airport,
  };
}

// ---- 3D-designed landmarks (public/design.html) ----
export async function getLandmarks() {  const m = await import('../public/js/custom1966.js?u=' + Date.now());
  return m.CUSTOM_LANDMARKS || [];
}
export async function setLandmarks(list) {
  const customURL = new URL('../public/js/custom1966.js', import.meta.url);
  let cs = readFileSync(customURL, 'utf8');
  const re = /export const CUSTOM_LANDMARKS = \[[\s\S]*?\];/;
  if (!re.test(cs)) throw new Error('CUSTOM_LANDMARKS not found in custom1966.js');
  cs = cs.replace(re, () => 'export const CUSTOM_LANDMARKS = ' + JSON.stringify(list) + ';');
  writeFileSync(customURL, cs);
  return list.length;
}

// Apply a trace object to the game source files. Returns a list of what changed.
// opts.mergeRoads: ADD the traced roads to the existing network (snapping to it)
// instead of replacing — used for non-destructive live corrections.
export async function applyTrace(t, opts = {}) {
  const roadsIn = (t.roads || []).map(r => Array.isArray(r) ? { pts: r, oneway: false } : r).filter(r => r.pts.length >= 2);
  const bulldozeIn = (t.bulldoze || []).map(a => a.pts || a).filter(p => p.length >= 1);
  const mainlandIn = (t.mainland || t.coast || []).filter(p => p.length >= 3);
  const islandsIn = (t.islands || []).filter(p => p.length >= 3);
  const reservoirsIn = (t.reservoirs || t.resv || []).filter(p => p.length >= 3);
  const foreignIn = (t.foreign || []).filter(p => p.length >= 3);
  const airportIn = (t.airport || []).map(a => a.pts || a).filter(p => p.length >= 2);
  const buildingsIn = (t.buildings || []).filter(b => b && b.type && b.w > 0 && b.h > 0);
  const housesIn = (t.houses || []).filter(b => b && b.type && b.w > 0 && b.h > 0);
  const railwayIn = (t.railway || []).map(a => a.pts || a).filter(p => p.length >= 2);
  const sandsIn = (t.sands || []).map(a => a.pts || a).filter(p => p.length >= 2);

  const cur = await import('../public/js/roads1966.js?u=' + Date.now()); // fresh each call
  const shapeURL = new URL('../public/js/shape.js', import.meta.url);
  const sceneURL = new URL('../public/js/scene3d.js', import.meta.url);
  const roadsURL = new URL('../public/js/roads1966.js', import.meta.url);
  const customURL = new URL('../public/js/custom1966.js', import.meta.url);
  const did = [];

  // ---- roads ----
  let outNodes = cur.ROAD_NODES_1966, outEdges = cur.ROAD_EDGES_1966.map(e => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2]);
  if (roadsIn.length || (opts.mergeRoads && bulldozeIn.length)) {
    const merge = !!opts.mergeRoads;
    // when merging, seed the graph with the existing network so new roads snap to it
    let nodes = merge ? cur.ROAD_NODES_1966.map(p => [p[0], p[1]]) : [];
    let edges = merge ? cur.ROAD_EDGES_1966.map(e => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2]) : [];
    // BULLDOZE: drop existing edges scribbled over (within 12u of a delete stroke)
    if (merge && bulldozeIn.length) {
      const strokes = bulldozeIn.map(p => p.map(toWorld)), DEL = 12;
      const near = n => strokes.some(s => s.some(q => dist(n, q) <= DEL));
      const before = edges.length;
      edges = edges.filter(e => !(near(nodes[e[0]]) || near(nodes[e[1]])));
      did.push(`bulldozed ${before - edges.length} road edges`);
    }
    const grid = new Map();
    const key = (x, z) => Math.floor(x / MERGE) + ',' + Math.floor(z / MERGE);
    nodes.forEach((p, id) => { const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); });
    const nodeAt = p => {
      const cx = Math.floor(p[0] / MERGE), cz = Math.floor(p[1] / MERGE);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get((cx + dx) + ',' + (cz + dz));
        if (arr) for (const id of arr) if (dist(nodes[id], p) <= MERGE) return id;
      }
      const id = nodes.length; nodes.push(p.slice());
      const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
      return id;
    };
    const seen = new Set(edges.map(e => (e[0] < e[1] ? e[0] + ':' + e[1] : e[1] + ':' + e[0])));
    const newEdges = [];
    const addEdge = (a, b, ow) => { if (a === b) return; const k = a < b ? a + ':' + b : b + ':' + a; if (seen.has(k)) return; seen.add(k); const e = [a, b, ow ? 1 : 0, 2]; edges.push(e); newEdges.push(e); };
    for (const road of roadsIn) {
      // simplify each stroke (keep corners/curves, drop oversampling), then weld
      // its vertices into the shared node graph — no uniform decimation that would
      // erase short streets, and no smoothing that would distort the grid.
      const kept = simplify(road.pts.map(toWorld), SIMPLIFY);
      let prev = nodeAt(kept[0]);
      for (let i = 1; i < kept.length; i++) { const id = nodeAt(kept[i]); addEdge(prev, id, road.oneway); prev = id; }
    }
    // compact: keep only nodes referenced by an edge (drops orphans from bulldoze)
    const used = new Set(); for (const e of edges) { used.add(e[0]); used.add(e[1]); }
    const remap = new Map(), cnodes = [];
    for (const id of used) { remap.set(id, cnodes.length); cnodes.push(nodes[id]); }
    nodes = cnodes; edges = edges.map(e => [remap.get(e[0]), remap.get(e[1]), e[2], e[3]]);
    outNodes = nodes.map(p => [r1(p[0]), r1(p[1])]); outEdges = edges;
    if (roadsIn.length) did.push(merge ? `roads +${newEdges.length} added -> ${outEdges.length} total` : `roads -> ${outNodes.length} nodes / ${outEdges.length} edges`);
  }

  let reservoirs = cur.RESERVOIRS_1966;
  if (reservoirsIn.length) { reservoirs = reservoirsIn.map(p => decimateN(p, 0.0015)); did.push(`reservoirs -> ${reservoirs.length} traced`); }

  if (roadsIn.length || reservoirsIn.length || (opts.mergeRoads && bulldozeIn.length)) {
    const body = `// 1966 Singapore road network + reservoirs. NODES: [x,z] world.
// EDGES: [a,b,oneway,class].  RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${outNodes.map(p => `[${p[0]},${p[1]}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${outEdges.map(e => `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2}]`).join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(reservoirs)};
`;
    writeFileSync(roadsURL, body);
  }

  if (mainlandIn.length || islandsIn.length || foreignIn.length) {
    let s = readFileSync(shapeURL, 'utf8');
    const arr = polys => '[' + polys.map(p => '[' + p.map(([x, y]) => `[${x}, ${y}]`).join(', ') + ']').join(',\n  ') + ']';
    const replExport = (txt, name, value) => { const re = new RegExp(`export const ${name} = \\[[\\s\\S]*?\\];`); if (!re.test(txt)) throw new Error(`could not find export ${name} in shape.js`); return txt.replace(re, () => `export const ${name} = ${value};`); };
    if (mainlandIn.length) {
      const loops = mainlandIn.map(p => decimateN(p, 0.0015)).sort((a, b) => b.length - a.length);
      s = replExport(s, 'SG_OUTLINE', '[' + loops[0].map(([x, y]) => `[${x}, ${y}]`).join(', ') + ']');
      did.push(`coast -> SG_OUTLINE (${loops[0].length} pts)`);
      const isles = loops.slice(1).concat(islandsIn.map(p => decimateN(p, 0.0015)));
      if (isles.length) { s = replExport(s, 'SG_ISLANDS', arr(isles)); did.push(`coast -> SG_ISLANDS (${isles.length})`); }
    } else if (islandsIn.length) { s = replExport(s, 'SG_ISLANDS', arr(islandsIn.map(p => decimateN(p, 0.0015)))); did.push(`islands -> SG_ISLANDS (${islandsIn.length})`); }
    if (foreignIn.length) { s = replExport(s, 'SG_FOREIGN', arr(foreignIn.map(p => decimateN(p, 0.005)))); did.push(`foreign -> SG_FOREIGN (${foreignIn.length})`); }
    writeFileSync(shapeURL, s);
  }

  if (airportIn.length || buildingsIn.length) {
    let sc = readFileSync(sceneURL, 'utf8');
    if (airportIn.length) {
      const run = airportIn.sort((a, b) => b.length - a.length)[0], A = run[0], B = run[run.length - 1];
      const south = A[1] <= B[1] ? A : B, north = A[1] <= B[1] ? B : A;
      const re = /south: \{ x: [-\d.]+, y: [-\d.]+ \}, north: \{ x: [-\d.]+, y: [-\d.]+ \},/;
      if (!re.test(sc)) throw new Error('could not find AIRPORT south/north in scene3d.js');
      sc = sc.replace(re, `south: { x: ${r3(south[0])}, y: ${r3(south[1])} }, north: { x: ${r3(north[0])}, y: ${r3(north[1])} },`);
      did.push(`airport -> runway`);
    }
    if (buildingsIn.length) {
      const bstr = buildingsIn.map(b => `{ type: '${b.type}', cx: ${r3(b.cx)}, cy: ${r3(b.cy)}, w: ${r4(b.w)}, h: ${r4(b.h)}, rot: ${r3((b.rot || 0) * Math.PI / 180)}, hgt: ${r2(b.hgt || 1)} }`).join(', ');
      const re = /buildings: \[[\s\S]*?\],/; if (!re.test(sc)) throw new Error('could not find AIRPORT buildings in scene3d.js');
      sc = sc.replace(re, () => `buildings: [${bstr}],`); did.push(`airport buildings -> ${buildingsIn.length}`);
    }
    writeFileSync(sceneURL, sc);
  }

  if (housesIn.length || railwayIn.length || sandsIn.length) {
    let cs = readFileSync(customURL, 'utf8');
    const replC = (name, value) => { const re = new RegExp(`export const ${name} = \\[[\\s\\S]*?\\];`); if (!re.test(cs)) throw new Error(`could not find ${name} in custom1966.js`); cs = cs.replace(re, () => `export const ${name} = ${value};`); };
    const polyN = p => '[' + decimateN(p, 0.003).map(([x, y]) => `[${x},${y}]`).join(',') + ']';
    if (housesIn.length) { const hstr = housesIn.map(b => `{ type: '${b.type}', cx: ${r3(b.cx)}, cy: ${r3(b.cy)}, w: ${r4(b.w)}, h: ${r4(b.h)}, rot: ${r3((b.rot || 0) * Math.PI / 180)}, hgt: ${r2(b.hgt || 1)} }`).join(', '); replC('CUSTOM_HOUSES', `[${hstr}]`); did.push(`houses -> ${housesIn.length}`); }
    if (railwayIn.length) { replC('CUSTOM_RAILWAYS', '[' + railwayIn.map(polyN).join(', ') + ']'); did.push(`railway -> ${railwayIn.length}`); }
    if (sandsIn.length) { replC('CUSTOM_SANDS', '[' + sandsIn.map(polyN).join(', ') + ']'); did.push(`sands -> ${sandsIn.length}`); }
    writeFileSync(customURL, cs);
  }
  return did;
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('apply_trace.mjs')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/apply_trace.mjs <trace.json>'); process.exit(1); }
  const did = await applyTrace(JSON.parse(readFileSync(file, 'utf8')));
  if (!did.length) console.log('nothing to apply (no recognised layers).');
  else { console.log('applied:'); did.forEach(d => console.log('  ' + d)); }
}
