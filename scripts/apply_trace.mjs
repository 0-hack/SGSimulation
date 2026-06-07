// Apply a hand-traced file (from public/trace.html) to the game's source.
// Usage:  node scripts/apply_trace.mjs path/to/sg1966-trace.json
//
// Every layer is OPTIONAL and applied independently (trace & apply one at a time
// if you like). All coords are game-normalised [nx,ny] (x east, y north).
//   roads      [{pts,oneway}] -> public/js/roads1966.js   ROAD_NODES/EDGES
//   reservoirs [[...]]        -> public/js/roads1966.js   RESERVOIRS_1966
//   mainland   [[...]]        -> public/js/shape.js        SG_OUTLINE
//   islands    [[...]]        -> public/js/shape.js        SG_ISLANDS
//   foreign    [[...]]        -> public/js/shape.js        SG_FOREIGN  (grey Malaysia)
//   airport    [[...]]        -> public/js/scene3d.js      AIRPORT south/north (runway)
//   buildings  [{type,cx,cy,w,h,rot,hgt}] -> scene3d.js    AIRPORT.buildings (hand-placed)
import { readFileSync, writeFileSync } from 'node:fs';

const WORLD = 1600, STEP = 9, MERGE = 7;
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/apply_trace.mjs <trace.json>'); process.exit(1); }
const t = JSON.parse(readFileSync(file, 'utf8'));

// accept v3 keys, fall back to the v2 names (coast=mainland, resv=reservoirs)
const roadsIn = (t.roads || []).map(r => Array.isArray(r) ? { pts: r, oneway: false } : r).filter(r => r.pts.length >= 2);
const mainlandIn = (t.mainland || t.coast || []).filter(p => p.length >= 3);
const islandsIn = (t.islands || []).filter(p => p.length >= 3);
const reservoirsIn = (t.reservoirs || t.resv || []).filter(p => p.length >= 3);
const foreignIn = (t.foreign || []).filter(p => p.length >= 3);
const airportIn = (t.airport || []).map(a => a.pts || a).filter(p => p.length >= 2);
const buildingsIn = (t.buildings || []).filter(b => b && b.type && b.w > 0 && b.h > 0);

const cur = await import('../public/js/roads1966.js');
const shapeURL = new URL('../public/js/shape.js', import.meta.url);
const sceneURL = new URL('../public/js/scene3d.js', import.meta.url);
const roadsURL = new URL('../public/js/roads1966.js', import.meta.url);

const r1 = v => Math.round(v * 10) / 10;        // world coords: 0.1 precision
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;    // normalised: 0.001 precision
const r4 = v => Math.round(v * 10000) / 10000;  // small footprints
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toWorld = ([nx, ny]) => [(nx - 0.5) * WORLD, (0.5 - ny) * WORLD];
function decimateN(pts, minD) {
  if (pts.length < 3) return pts.map(([x, y]) => [r3(x), r3(y)]);
  const out = [pts[0]]; let last = pts[0];
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], last) >= minD) { out.push(pts[i]); last = pts[i]; }
  return out.map(([x, y]) => [r3(x), r3(y)]);
}
const did = [];

// ---------------- roads ----------------
let outNodes = cur.ROAD_NODES_1966, outEdges = cur.ROAD_EDGES_1966.map(e => [e[0], e[1], e[2] ? 1 : 0]);
if (roadsIn.length) {
  const nodes = [], grid = new Map();
  const key = (x, z) => Math.floor(x / MERGE) + ',' + Math.floor(z / MERGE);
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
  const seen = new Set(), edges = [];
  const addEdge = (a, b, ow) => { if (a === b) return; const k = a < b ? a + ':' + b : b + ':' + a; if (seen.has(k)) return; seen.add(k); edges.push([a, b, ow ? 1 : 0]); };
  for (const road of roadsIn) {
    const w = road.pts.map(toWorld), kept = [w[0]]; let last = w[0];
    for (let i = 1; i < w.length - 1; i++) if (dist(w[i], last) >= STEP) { kept.push(w[i]); last = w[i]; }
    kept.push(w[w.length - 1]);
    let prev = nodeAt(kept[0]);
    for (let i = 1; i < kept.length; i++) { const id = nodeAt(kept[i]); addEdge(prev, id, road.oneway); prev = id; }
  }
  // light Taubin smoothing (freehand jitter), topology preserved
  const adj = nodes.map(() => new Set());
  for (const [a, b] of edges) { adj[a].add(b); adj[b].add(a); }
  const smooth = wt => { const o = nodes.map(p => p.slice());
    for (let i = 0; i < nodes.length; i++) { const nb = adj[i]; if (!nb.size) continue;
      let sx = 0, sz = 0; for (const j of nb) { sx += nodes[j][0]; sz += nodes[j][1]; }
      o[i][0] = nodes[i][0] + wt * (sx / nb.size - nodes[i][0]); o[i][1] = nodes[i][1] + wt * (sz / nb.size - nodes[i][1]); }
    for (let i = 0; i < nodes.length; i++) nodes[i] = o[i]; };
  for (let k = 0; k < 3; k++) { smooth(0.5); smooth(-0.48); }
  outNodes = nodes.map(p => [r1(p[0]), r1(p[1])]);
  outEdges = edges;
  did.push(`roads -> ${outNodes.length} nodes / ${outEdges.length} edges (${edges.filter(e => e[2]).length} one-way)`);
}

// ---------------- reservoirs ----------------
let reservoirs = cur.RESERVOIRS_1966;
if (reservoirsIn.length) { reservoirs = reservoirsIn.map(p => decimateN(p, 0.004)); did.push(`reservoirs -> ${reservoirs.length} traced`); }

// ---------------- write roads1966.js (only if roads or reservoirs changed) ----------------
if (roadsIn.length || reservoirsIn.length) {
  const body = `// 1966 Singapore road network + reservoirs. Hand-traced over the survey map
// with public/trace.html, then applied by scripts/apply_trace.mjs.
// NODES: [x, z] world coords.  EDGES: [a, b, oneway].  RESERVOIRS: normalised polygons.
export const ROAD_NODES_1966 = [${outNodes.map(p => `[${p[0]},${p[1]}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${outEdges.map(e => `[${e[0]},${e[1]},${e[2]}]`).join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(reservoirs)};
`;
  writeFileSync(roadsURL, body);
}

// ---------------- shape.js: mainland / islands / foreign ----------------
if (mainlandIn.length || islandsIn.length || foreignIn.length) {
  let s = readFileSync(shapeURL, 'utf8');
  const arr = polys => '[' + polys.map(p => '[' + p.map(([x, y]) => `[${x}, ${y}]`).join(', ') + ']').join(',\n  ') + ']';
  const replExport = (txt, name, value) => {
    const re = new RegExp(`export const ${name} = \\[[\\s\\S]*?\\];`);
    if (!re.test(txt)) throw new Error(`could not find export ${name} in shape.js`);
    return txt.replace(re, () => `export const ${name} = ${value};`);
  };
  if (mainlandIn.length) {
    const main = decimateN(mainlandIn.sort((a, b) => b.length - a.length)[0], 0.004);
    s = replExport(s, 'SG_OUTLINE', '[' + main.map(([x, y]) => `[${x}, ${y}]`).join(', ') + ']');
    did.push(`mainland -> SG_OUTLINE (${main.length} pts)`);
  }
  if (islandsIn.length) {
    s = replExport(s, 'SG_ISLANDS', arr(islandsIn.map(p => decimateN(p, 0.004))));
    did.push(`islands -> SG_ISLANDS (${islandsIn.length})`);
  }
  if (foreignIn.length) {
    s = replExport(s, 'SG_FOREIGN', arr(foreignIn.map(p => decimateN(p, 0.005))));
    did.push(`foreign -> SG_FOREIGN (${foreignIn.length})`);
  }
  writeFileSync(shapeURL, s);
}

// ---------------- scene3d.js: airport runway + hand-placed buildings ----------------
if (airportIn.length || buildingsIn.length) {
  let sc = readFileSync(sceneURL, 'utf8');
  if (airportIn.length) {
    const run = airportIn.sort((a, b) => b.length - a.length)[0];
    const A = run[0], B = run[run.length - 1];
    const south = A[1] <= B[1] ? A : B, north = A[1] <= B[1] ? B : A;   // smaller ny = south
    const re = /south: \{ x: [-\d.]+, y: [-\d.]+ \}, north: \{ x: [-\d.]+, y: [-\d.]+ \},/;
    if (!re.test(sc)) throw new Error('could not find AIRPORT south/north in scene3d.js');
    sc = sc.replace(re, `south: { x: ${r3(south[0])}, y: ${r3(south[1])} }, north: { x: ${r3(north[0])}, y: ${r3(north[1])} },`);
    did.push(`airport -> runway south(${r3(south[0])},${r3(south[1])}) north(${r3(north[0])},${r3(north[1])})`);
  }
  if (buildingsIn.length) {
    const bstr = buildingsIn.map(b => `{ type: '${b.type}', cx: ${r3(b.cx)}, cy: ${r3(b.cy)}, w: ${r4(b.w)}, h: ${r4(b.h)}, rot: ${r3((b.rot || 0) * Math.PI / 180)}, hgt: ${r2(b.hgt || 1)} }`).join(', ');
    const re = /buildings: \[[\s\S]*?\],/;
    if (!re.test(sc)) throw new Error('could not find AIRPORT buildings in scene3d.js');
    sc = sc.replace(re, () => `buildings: [${bstr}],`);
    did.push(`airport buildings -> ${buildingsIn.length} placed`);
  }
  writeFileSync(sceneURL, sc);
}

if (!did.length) console.log('nothing to apply (no recognised layers in the trace file).');
else { console.log('applied:'); did.forEach(d => console.log('  ' + d)); }
