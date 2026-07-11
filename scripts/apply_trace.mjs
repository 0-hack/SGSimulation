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
import { reconnectGraph, connectCrossings, relaxZigzag, mergeComponents } from './reconnect_roads.mjs';

// SIMPLIFY: Douglas-Peucker tolerance in world units (~0.15u ≈ 5.5m) — how far the
//   kept polyline may stray from the raw trace. Kept SMALL so a freehand curve keeps
//   enough points to render as a faithful smooth line (no facets) rather than being
//   flattened into long straight chords.
// MERGE: weld radius for road ENDPOINTS — endpoints within this distance share a
//   node, joining the junctions the player drew coincident (and T-junctions, where an
//   end lands on another road's body) WITHOUT collapsing distinct parallel streets
//   (which sit ~2.3u apart in the south, so this stays below that).
// MERGE_MID: a much smaller weld radius for INTERIOR curve points — they only dedupe
//   near-coincident samples, so the curve is NOT quantised onto a coarse grid (that
//   quantising is what made traced freehand curves look rigid/faceted before).
const WORLD = 1600, SIMPLIFY = 0.15, MERGE = 2, MERGE_MID = 0.25;
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
// Drop JITTER spikes from a freehand stroke: a vertex where the line turns by more
// than `maxTurn` degrees is a near-reversal (the hand crossed back on itself) — no
// real road bends that sharply, so removing it makes the road both smoother AND more
// faithful. Iterated, since dropping one spike can expose another. Real corners
// (grid junctions ~90°, normal bends) are well below the threshold and untouched.
function deSpike(pts, maxTurn = 150) {
  if (pts.length < 3) return pts;
  const turnAt = (a, b, c) => {
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
    const la = Math.hypot(ux, uz) || 1, lb = Math.hypot(vx, vz) || 1;
    let cc = (ux * vx + uz * vz) / (la * lb); cc = Math.max(-1, Math.min(1, cc));
    return Math.acos(cc) * 180 / Math.PI;
  };
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      if (turnAt(pts[i - 1], pts[i], pts[i + 1]) > maxTurn) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}
// Stitch open polyline pieces back into closed loops by joining nearest endpoints —
// used when an edited coastline arrives as arcs (the un-erased spans) plus the newly
// drawn replacement span. Already-closed loops (islands) pass straight through.
function chainLoops(polys, tol = 0.06) {
  const closedLoop = (p) => p.length >= 3 && dist(p[0], p[p.length - 1]) < 0.01;
  const closed = [], open = [];
  for (const p of polys) (closedLoop(p) ? closed : open).push(p.slice());
  const used = new Array(open.length).fill(false), loops = [...closed];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    let chain = open[i].slice(); used[i] = true;
    for (let guard = 0; guard <= open.length; guard++) {
      const end = chain[chain.length - 1];
      let best = -1, bestD = tol, rev = false;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const ds = dist(end, open[j][0]), de = dist(end, open[j][open[j].length - 1]);
        if (ds < bestD) { bestD = ds; best = j; rev = false; }
        if (de < bestD) { bestD = de; best = j; rev = true; }
      }
      if (best < 0) break;
      const seg = rev ? open[best].slice().reverse() : open[best];
      chain.push(...seg.slice(1)); used[best] = true;
    }
    loops.push(chain);
  }
  return loops;
}
function decimateN(pts, minD) {
  // emit at FOUR decimals: three quantised every point onto a 1.6-world-unit grid,
  // which read as a wobble/offset against the drawn trace (railway, coast). 0.0001
  // normalised ≈ 0.16u — visually exact. Also always keep the true last point, so
  // an open line is never shortened by the spacing filter.
  if (pts.length < 3) return pts.map(([x, y]) => [r4(x), r4(y)]);
  const out = [pts[0]]; let last = pts[0];
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], last) >= minD) { out.push(pts[i]); last = pts[i]; }
  if (last !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out.map(([x, y]) => [r4(x), r4(y)]);
}

// Convert the current ROAD_NODES/EDGES graph into tracer polylines (chains of
// degree-2 nodes), in game-normalised coords — so the tracer can load and edit
// the existing network instead of starting blank.
export function graphToTrace(nodes, edges) {
  const adj = nodes.map(() => []);
  for (const e of edges) { adj[e[0]].push({ n: e[1], ow: !!e[2], dirt: !!e[4] }); adj[e[1]].push({ n: e[0], ow: !!e[2], dirt: !!e[4] }); }
  const used = new Set(), ek = (a, b) => (a < b ? a + ':' + b : b + ':' + a), roads = [];
  const walk = (a, entry) => {
    const pts = [a]; let prev = a, cur = entry.n; used.add(ek(a, entry.n)); pts.push(cur);
    while (adj[cur].length === 2) {
      const nxt = adj[cur].find(e => e.n !== prev);
      if (!nxt || used.has(ek(cur, nxt.n))) break;
      used.add(ek(cur, nxt.n)); prev = cur; cur = nxt.n; pts.push(cur);
    }
    return { pts, ow: entry.ow, dirt: entry.dirt };
  };
  for (let i = 0; i < nodes.length; i++) { if (adj[i].length === 2) continue; for (const e of adj[i]) if (!used.has(ek(i, e.n))) roads.push(walk(i, e)); }
  for (let i = 0; i < nodes.length; i++) for (const e of adj[i]) if (!used.has(ek(i, e.n))) roads.push(walk(i, e));
  return { roads: roads.filter(c => c.pts.length >= 2).map(c => ({ pts: c.pts.map(j => toNorm(nodes[j]).map(r4)), oneway: c.ow, dirt: c.dirt })) };
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
// FAITHFUL preset: map a trace to the network EXACTLY as drawn — no de-jitter,
// no self-loop removal, minimal simplification, and a small endpoint weld that
// only fuses genuinely-coincident junctions (so roads drawn apart stay apart and
// small roads are not snapped onto their neighbours). Used by the live tracer's
// "Add to game" / Export-and-apply path. Explicit opts still override each field.
// merge (the ENDPOINT weld) only fuses ends that are visually the SAME point (0.35u —
// under a road's own width), so a drawn line's last segment is never bent toward a
// neighbour. Junctions that land a unit or two short are connected by reconnectGraph
// with short CONNECTOR edges instead, which adds a stub but moves no drawn geometry.
// mergeMid stays tiny so INTERIOR curve points are never snapped (curves stay faithful).
// simplify 0.3: DP within ±0.3u — under HALF the carriageway (renderHW 0.34), so the
// drawn route is untouched visually, while freehand pen shake (which otherwise bakes
// as zigzag headings and phantom self-crossings) is flattened out.
export const FAITHFUL = { exact: true, simplify: 0.3, mergeMid: 0.12, merge: 0.35 };

export async function applyTrace(t, opts = {}) {
  if (opts.faithful) opts = { ...FAITHFUL, ...opts };
  const roadsIn = (t.roads || []).map(r => Array.isArray(r) ? { pts: r, oneway: false } : r).filter(r => r.pts.length >= 2);
  const bulldozeIn = (t.bulldoze || []).map(a => a.pts || a).filter(p => p.length >= 1);
  const mainlandIn = (t.mainland || t.coast || []).filter(p => p.length >= 2); // >=2: edited-coast arcs are stitched into loops below
  const islandsIn = (t.islands || []).filter(p => p.length >= 3);
  const reservoirsIn = (t.reservoirs || t.resv || []).filter(p => p.length >= 2); // >=2: edited-lake arcs stitched below
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
  // Per-apply fidelity overrides: opts.simplify (DP tolerance) and opts.mergeMid
  // (interior weld radius) let a "100% faithful" apply keep tighter to the raw
  // trace than the defaults, without changing the defaults for other callers.
  const SIMP = opts.simplify ?? SIMPLIFY, MMID = opts.mergeMid ?? MERGE_MID, MRG = opts.merge ?? MERGE;
  let outNodes = cur.ROAD_NODES_1966, outEdges = cur.ROAD_EDGES_1966.map(e => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2, e[4] ? 1 : 0]);
  let roundabouts = (cur.ROUNDABOUTS_1966 || []).map(r => r.slice());   // [x,z,r] world — carried across applies
  if (roadsIn.length || (opts.mergeRoads && bulldozeIn.length)) {
    const merge = !!opts.mergeRoads;
    // when merging, seed the graph with the existing network so new roads snap to it
    let nodes = merge ? cur.ROAD_NODES_1966.map(p => [p[0], p[1]]) : [];
    let edges = merge ? cur.ROAD_EDGES_1966.map(e => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2, e[4] ? 1 : 0]) : [];
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
    // index only LIVE nodes (still on a surviving edge) so new roads never weld to the
    // orphan ghost nodes left behind by bulldozed edges (which sit on the OLD road path)
    const liveNodes = new Set(); for (const e of edges) { liveNodes.add(e[0]); liveNodes.add(e[1]); }
    nodes.forEach((p, id) => { if (!liveNodes.has(id)) return; const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id); });
    // weld to an existing node within radius `r` (defaults to the endpoint radius);
    // the spatial grid stays keyed at the larger MERGE cell so a 3×3 scan still finds
    // any neighbour within MERGE (and the smaller MERGE_MID is a subset of that).
    const nodeAt = (p, r = MRG) => {
      const cx = Math.floor(p[0] / MERGE), cz = Math.floor(p[1] / MERGE);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get((cx + dx) + ',' + (cz + dz));
        if (arr) for (const id of arr) if (dist(nodes[id], p) <= r) return id;
      }
      const id = nodes.length; nodes.push(p.slice());
      const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
      return id;
    };
    const seen = new Set(edges.map(e => (e[0] < e[1] ? e[0] + ':' + e[1] : e[1] + ':' + e[0])));
    const newEdges = [];
    const addEdge = (a, b, ow, dirt) => { if (a === b) return; const k = a < b ? a + ':' + b : b + ':' + a; if (seen.has(k)) return; seen.add(k); const e = [a, b, ow ? 1 : 0, 2, dirt ? 1 : 0]; edges.push(e); newEdges.push(e); };
    // A road tagged `base:true` is the existing network re-exported by the tracer
    // (one segment per edge). It must rebuild 1:1, so it welds only at BASE_WELD —
    // below the network's node spacing — and is never simplified/de-jittered. That
    // way a FULL-map export reproduces the existing roads exactly while freshly
    // DRAWN roads still weld their junctions at the generous endpoint radius.
    const BASE_WELD = 0.02;
    // ---- fold DUPLICATE strokes: a road traced twice must bake as ONE road ----
    // Freehand passes over the same road land ~1–2u apart — 2–3 carriageway widths —
    // so both twins bake, cross each other constantly, and every crossing becomes a
    // fake junction: the road renders as a patchwork of fragments and each junction
    // near town sprouts traffic lights. Keep the FIRST drawing of any stretch and
    // drop later strokes' runs that hug already-accepted geometry (within DUP).
    // A SHORT hug (< CROSS_KEEP along the stroke) is a genuine crossing or a moment
    // of riding along another road — kept, so X- and T-junctions are untouched.
    const DUP = 1.6, CROSS_KEEP = 5, NOVEL_MIN = 3.5, JIT = 0.4;
    const cellW = 2, gkW = (x, z) => Math.floor(x / cellW) + ',' + Math.floor(z / cellW);
    const accSegs = [], accGrid = new Map();
    const accAdd = (a, b) => {
      const i = accSegs.length; accSegs.push([a, b]);
      const n = Math.max(1, Math.ceil(dist(a, b) / cellW)); const put = new Set();
      for (let s = 0; s <= n; s++) { const t = s / n, k = gkW(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (!put.has(k)) { put.add(k); (accGrid.get(k) || accGrid.set(k, []).get(k)).push(i); } }
    };
    const dToAcc = (p) => {
      const cx = Math.floor(p[0] / cellW), cz = Math.floor(p[1] / cellW); let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const arr = accGrid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
        for (const i of arr) { const [a, b] = accSegs[i], ddx = b[0] - a[0], ddz = b[1] - a[1], l2 = ddx * ddx + ddz * ddz || 1e-9;
          let t = ((p[0] - a[0]) * ddx + (p[1] - a[1]) * ddz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(p[0] - (a[0] + ddx * t), p[1] - (a[1] + ddz * t)); if (d < best) best = d; }
      }
      return best;
    };
    // A point DUPLICATES accepted geometry only when a nearby segment also runs the
    // SAME WAY (|cos| ≥ 0.7 ≈ within 45°). Nearness alone must not count: in a dense
    // grid a short cross-street sits within DUP of the parallels it connects — that
    // is a junction, not a re-trace, and eating it shatters the network.
    const dupNear = (p, dirx, dirz) => {
      const cx = Math.floor(p[0] / cellW), cz = Math.floor(p[1] / cellW);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const arr = accGrid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
        for (const i of arr) {
          const [a, b] = accSegs[i], ddx = b[0] - a[0], ddz = b[1] - a[1], l2 = ddx * ddx + ddz * ddz || 1e-9;
          const t = ((p[0] - a[0]) * ddx + (p[1] - a[1]) * ddz) / l2;
          if (t < 0 || t > 1) continue;   // projects past the segment's tip — a road CONTINUING beyond another's end is not a re-trace
          if (Math.hypot(p[0] - (a[0] + ddx * t), p[1] - (a[1] + ddz * t)) > DUP) continue;
          const sl = Math.sqrt(l2);
          if (Math.abs((ddx * dirx + ddz * dirz) / sl) >= 0.7) return true;
        }
      }
      return false;
    };
    const strokes = [], spliceEnds = []; let dupDropped = 0;
    const DBG = process.env.DBG_X ? [parseFloat(process.env.DBG_X), parseFloat(process.env.DBG_Z)] : null;
    const dbgStrokes = (tag) => { if (!DBG) return; let n = 0;
      for (const st of strokes) for (const q of st.w) if (Math.hypot(q[0] - DBG[0], q[1] - DBG[1]) < 8) { n++; }
      console.log('[dbg]', tag, 'stroke pts near', n); };
    const dbgNodes = (tag) => { if (!DBG) return; let n = 0;
      for (const e of edges) for (const id of [e[0], e[1]]) if (Math.hypot(nodes[id][0] - DBG[0], nodes[id][1] - DBG[1]) < 8) n++;
      console.log('[dbg]', tag, 'edge-endpoints near', n); };
    // Classify a polyline against everything accepted so far — AND against its own
    // earlier body (a stroke drawn out-and-back must fold onto itself) — and return
    // the spans worth keeping. A chain that hugs other geometry for most of its
    // length with no real novel stretch is a duplicate twin: dropped whole.
    const foldSpans = (w, wholeDrop = true) => {
      const s = [0]; for (let i = 1; i < w.length; i++) s.push(s[i - 1] + dist(w[i - 1], w[i]));
      // local direction at each point, for the parallel test
      const dirAt = (i) => {
        const a = w[Math.max(0, i - 1)], b = w[Math.min(w.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return [dx / l, dz / l];
      };
      const selfDup = (i, dirx, dirz) => {   // hugs a much EARLIER, same-way part of this stroke
        for (let j = 1; j < w.length && s[i] - s[j] > 6; j++) {
          const a = w[j - 1], b = w[j], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9;
          const t = ((w[i][0] - a[0]) * dx + (w[i][1] - a[1]) * dz) / l2;
          if (t < 0 || t > 1) continue;
          if (Math.hypot(w[i][0] - (a[0] + dx * t), w[i][1] - (a[1] + dz * t)) > DUP) continue;
          if (Math.abs((dx * dirx + dz * dirz) / Math.sqrt(l2)) >= 0.7) return true;
        }
        return false;
      };
      const dup = w.map((p, i) => { const [dx, dz] = dirAt(i); return dupNear(p, dx, dz) || selfDup(i, dx, dz); });
      const runs = []; let st = 0;
      for (let i = 1; i <= w.length; i++) if (i === w.length || dup[i] !== dup[st]) { runs.push({ st, en: i - 1, dup: dup[st] }); st = i; }
      const total = s[w.length - 1] || 1e-9;
      const dupLen = runs.reduce((a, r) => a + (r.dup ? s[r.en] - s[r.st] : 0), 0);
      const maxNovel = Math.max(0, ...runs.filter((r) => !r.dup).map((r) => s[r.en] - s[r.st]));
      // Whole-drop: the chain hugs its twin for most of its length with no real
      // novel stretch, and both ends sit within the hug radius of the twin — a
      // braid fragment or a doubled dead-end spur. Its endpoints are spliced back
      // into the twin below, and mergeComponents guarantees nothing is severed.
      if (wholeDrop && dupLen / total > 0.6 && maxNovel < 4
          && dToAcc(w[0]) <= 1.7 && dToAcc(w[w.length - 1]) <= 1.7) {
        // A twin fragment — nothing new here. Its ENDPOINTS may be junctions the
        // network routes through, so hand them back for splicing: after the bake,
        // each is joined into the road it duplicated (no path it carried is lost).
        return { spans: [], folded: true, ends: [w[0], w[w.length - 1]] };
      }
      // short duplicate runs are crossings — keep them
      for (const r of runs) if (r.dup && s[r.en] - s[r.st] < CROSS_KEEP) r.dup = false;
      // short novel wander BETWEEN dropped runs is re-trace noise, not a new road
      for (let i = 0; i < runs.length; i++) { const r = runs[i];
        if (!r.dup && s[r.en] - s[r.st] < NOVEL_MIN && (runs[i - 1]?.dup || runs[i + 1]?.dup)) r.dup = true; }
      // emit each kept span, padded ONE point into the dropped side so its end lies
      // within DUP of the kept twin — the self-heal then welds/joins it there
      const spans = []; let i = 0;
      while (i < runs.length) {
        if (runs[i].dup) { i++; continue; }
        let j = i; while (j + 1 < runs.length && !runs[j + 1].dup) j++;
        const a = Math.max(0, runs[i].st - 1), b = Math.min(w.length - 1, runs[j].en + 1);
        if (b > a && s[b] - s[a] >= 1.0) spans.push(w.slice(a, b + 1));
        i = j + 1;
      }
      return { spans, folded: runs.some((r) => r.dup) };
    };
    const knots = [];              // roundabout scribbles found this run: {c:[x,z], R, maxR}
    const ringClear = new Map();   // roundabout index -> clear radius (covers the source scribble)
    // Base strokes are the existing network, one 2-pt segment per edge. Rebuild the
    // POLYLINES first (chains through degree-2 joints, same road flags) so the fold
    // can also clean twins an OLDER apply baked into the base map itself — re-traced
    // roads from before the fold existed render as braided double roads. Longest
    // chains are accepted first: the principal drawing wins, its twin folds away.
    {
      const bnode = new Map(), bpts = [], badj = [], bsegs = [];
      for (const road of roadsIn) {
        if (!road.base) continue;
        const idOf = (q) => { const k = q[0] + ',' + q[1]; let id = bnode.get(k); if (id == null) { id = bpts.length; bnode.set(k, id); bpts.push(toWorld(q)); badj.push([]); } return id; };
        for (let i = 1; i < road.pts.length; i++) {
          const a = idOf(road.pts[i - 1]), b = idOf(road.pts[i]); if (a === b) continue;
          const si = bsegs.length; bsegs.push({ a, b, ow: !!road.oneway, dirt: !!road.dirt });
          badj[a].push(si); badj[b].push(si);
        }
      }
      const busd = new Array(bsegs.length).fill(false);
      const bwalk = (start, si) => {
        const flags = { ow: bsegs[si].ow, dirt: bsegs[si].dirt };
        let cur = start, seg = si; const ids = [start];
        while (true) {
          busd[seg] = true;
          const e = bsegs[seg], nxt = e.a === cur ? e.b : e.a;
          ids.push(nxt); cur = nxt;
          if (badj[cur].length !== 2) break;
          const nb = badj[cur].find((x) => !busd[x]); if (nb == null) break;
          if (bsegs[nb].ow !== flags.ow || bsegs[nb].dirt !== flags.dirt) break;
          seg = nb;
        }
        return { ids, ...flags };
      };
      const bchains = [];
      for (let n = 0; n < bpts.length; n++) { if (badj[n].length === 2) continue; for (const si of badj[n]) if (!busd[si]) bchains.push(bwalk(n, si)); }
      for (let si = 0; si < bsegs.length; si++) if (!busd[si]) bchains.push(bwalk(bsegs[si].a, si));   // pure loops
      const blen = (c) => { let l = 0; for (let i = 1; i < c.ids.length; i++) l += dist(bpts[c.ids[i - 1]], bpts[c.ids[i]]); return l; };
      bchains.sort((p, q) => blen(q) - blen(p));
      // ---- base LOOPS are roundabouts too ----
      // A small closed circuit in the old bake — one junction-free loop chain, or
      // the 2–3 arcs a loop splits into between its approach junctions — is a
      // scribbled roundabout from an earlier trace, baked as an angular blob.
      // Convert it to a knot: the arcs are removed here, a clean ring replaces it.
      const knotFromChains = (list) => {
        const pts = []; let len = 0;
        for (const c of list) { for (const id of c.ids) pts.push(bpts[id]); len += blen(c); }
        if (len < 6 || len > 30 || pts.length < 5) return null;
        let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
        const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz));
        const maxR = Math.max(...rs), R = rs.reduce((a, b) => a + b, 0) / rs.length;
        // ONLY unambiguously roundabout-sized loops convert (<=2.2u radius ≈ 135m
        // across — 1965 Singapore had no big roundabouts). A larger drawn circuit
        // is a real loop ROAD (a circus, a block, a service loop): kept as drawn.
        if (maxR > 2.2 || maxR < 1.2 || Math.min(...rs) < 0.25 * maxR) return null;   // not roundabout-shaped
        let v = 0; for (const r of rs) v += (r - R) * (r - R);
        return { c: [cx, cz], R: Math.max(1.6, Math.min(4.2, R + Math.sqrt(v / rs.length))), maxR };
      };
      const isLoopable = (c) => !c.dirt && !c._knot && c.ids.length >= 3 && blen(c) <= 34;
      for (const c of bchains) {   // single junction-free loops
        if (!isLoopable(c) || dist(bpts[c.ids[0]], bpts[c.ids[c.ids.length - 1]]) > 3) continue;
        const k = knotFromChains([c]); if (k) { c._knot = true; knots.push(k); }
      }
      const ekey = (c) => { const a = c.ids[0], b = c.ids[c.ids.length - 1]; return a < b ? a + ':' + b : b + ':' + a; };
      const groups = new Map();   // 2-arc loops: two chains joining the same junction pair
      bchains.forEach((c) => { if (!isLoopable(c)) return; const k = ekey(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); });
      for (const [, g] of groups) {
        for (let i = 0; i < g.length - 1; i++) { if (g[i]._knot) continue;
          for (let j = i + 1; j < g.length; j++) { if (g[j]._knot) continue;
            const k = knotFromChains([g[i], g[j]]); if (!k) continue;
            g[i]._knot = g[j]._knot = true; knots.push(k); break; } }
      }
      const jadj = new Map();   // 3-arc loops: chains ab, bc, ca between three junctions
      bchains.forEach((c) => { if (!isLoopable(c)) return; const a = c.ids[0], b = c.ids[c.ids.length - 1]; if (a === b) return;
        (jadj.get(a) || jadj.set(a, []).get(a)).push({ to: b, c }); (jadj.get(b) || jadj.set(b, []).get(b)).push({ to: a, c }); });
      for (const [a, la] of jadj) for (const e1 of la) {
        const b = e1.to; if (b <= a || e1.c._knot) continue;
        for (const e2 of (jadj.get(b) || [])) {
          const c2 = e2.to; if (c2 <= b || c2 === a || e2.c._knot || e2.c === e1.c) continue;
          const e3 = (jadj.get(c2) || []).find((x) => x.to === a && !x.c._knot && x.c !== e1.c && x.c !== e2.c);
          if (!e3) continue;
          const k = knotFromChains([e1.c, e2.c, e3.c]); if (!k) continue;
          e1.c._knot = e2.c._knot = e3.c._knot = true; knots.push(k); break;
        }
      }
      if (knots.length) did.push(`${knots.length} baked loop blob(s) read as roundabouts`);
      // Base chains bake VERBATIM — the duplicate fold must NEVER run on the base
      // network. What reads as a "braided twin" is often real: a dual carriageway
      // drawn as two one-way lines, or two close parallel streets. Folding deletes
      // or displaces drawn roads. How they LOOK is handled without touching the
      // drawing: tremor smoothing, junction caps and width blending.
      for (const c of bchains) {
        if (c._knot) continue;
        const w = c.ids.map((id) => bpts[id]);
        strokes.push({ w, oneway: c.ow, dirt: c.dirt, base: true });
        for (let x = 1; x < w.length; x++) accAdd(w[x - 1], w[x]);
      }
    }
    // dwell-strip every freehand stroke up front: sub-JIT steps are hand tremor while
    // paused, not road shape — they zigzag the heading and self-cross into phantom junctions
    const free = [];
    for (const road of roadsIn) {
      if (road.base) continue;
      let w = road.pts.map(toWorld);
      if (w.length > 2) { const sp = [w[0]]; for (let i = 1; i < w.length; i++) if (dist(w[i], sp[sp.length - 1]) >= JIT || i === w.length - 1) sp.push(w[i]); w = sp; }
      if (w.length >= 2) free.push({ w, oneway: road.oneway, dirt: road.dirt });
    }
    // ---- roundabouts: a small scribbled LOOP means "roundabout here" ----
    // A hand-drawn roundabout is a compact knot 1–3u across — the size of the road
    // itself — that can never bake as sensible geometry. Treat it as an annotation:
    // drop the scribble and synthesize a CLEAN ring road of the same size in its
    // place (the approaches self-heal onto the ring), persist [x,z,r] so the game
    // renders the centre island and skips traffic lights there.
    const knotOf = (w) => {
      if (w.length < 4) return null;
      let cx = 0, cz = 0; for (const p of w) { cx += p[0]; cz += p[1]; } cx /= w.length; cz /= w.length;
      const rs = w.map((p) => Math.hypot(p[0] - cx, p[1] - cz));
      const maxR = Math.max(...rs), R = rs.reduce((a, b) => a + b, 0) / rs.length;
      let len = 0; for (let i = 1; i < w.length; i++) len += dist(w[i - 1], w[i]);
      if (maxR > 6 || len < 3.5) return null;            // a whole compact stroke, deliberately drawn
      let cov = 0;                                       // it must actually LOOP (≥150° swept)
      for (let i = 1; i < w.length; i++) {
        const a0 = Math.atan2(w[i - 1][1] - cz, w[i - 1][0] - cx), a1 = Math.atan2(w[i][1] - cz, w[i][0] - cx);
        let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; cov += d;
      }
      if (Math.abs(cov) < Math.PI * 5 / 6) return null;
      let v = 0; for (const r of rs) v += (r - R) * (r - R);
      return { c: [cx, cz], R: Math.max(1.6, Math.min(4.2, R + Math.sqrt(v / rs.length))) };
    };
    const rest = [];
    for (const f of free) { const k = knotOf(f.w); if (k) knots.push(k); else rest.push(f); }
    let newRounds = 0;
    for (const k of knots) {   // cluster re-scribbled knots; two rings that would touch are ONE roundabout
      const hit = roundabouts.findIndex((o) => Math.hypot(o[0] - k.c[0], o[1] - k.c[1]) < o[2] + k.R + 1.5);
      const clear = Math.max(k.R + 0.5, (k.maxR || 0) + 0.4);
      if (hit >= 0) { ringClear.set(hit, Math.max(ringClear.get(hit) || 0, clear)); continue; }
      roundabouts.push([r1(k.c[0]), r1(k.c[1]), r1(k.R)]); newRounds++;
      ringClear.set(roundabouts.length - 1, clear);
    }
    if (newRounds) did.push(`roundabouts -> ${newRounds} new (${roundabouts.length} total)`);
    // Synthesize a clean closed ring for EVERY roundabout the map doesn't already
    // carry as clean geometry. Carried-over entries need re-synthesizing after a
    // fresh apply (the trace's base still holds the old scribble); a future base
    // export that already contains the ring itself is detected and left alone —
    // a clean ring has road ON the circle and nothing near the centre island.
    let ringsMade = 0;
    for (let ri = 0; ri < roundabouts.length; ri++) {
      const [cx, cz, R] = roundabouts[ri], ring = [];
      for (let i = 0; i <= 24; i++) { const a = (i % 24) / 24 * 2 * Math.PI; ring.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]); }
      let onCircle = 0; for (const p of ring) if (dToAcc(p) <= 0.5) onCircle++;
      if (onCircle / ring.length > 0.8 && dToAcc([cx, cz]) > 0.6) continue;   // ring already baked clean
      strokes.push({ w: ring, oneway: false, dirt: false, ringIdx: ri }); ringsMade++;
      for (let i = 1; i < ring.length; i++) accAdd(ring[i - 1], ring[i]);
    }
    if (ringsMade) did.push(`roundabouts -> ${ringsMade} ring(s) built (${roundabouts.length} on map)`);
    dbgStrokes('after base+rings');
    // ---- fold duplicates & keep the novel spans of every remaining stroke ----
    for (const road of rest) {
      const { spans, folded, ends } = foldSpans(road.w);
      if (folded) dupDropped++;
      for (const sp of spans) { strokes.push({ w: sp, oneway: road.oneway, dirt: road.dirt }); for (let x = 1; x < sp.length; x++) accAdd(sp[x - 1], sp[x]); }
      if (ends) spliceEnds.push(...ends);
    }
    if (dupDropped) did.push(`folded ${dupDropped} re-traced stroke(s) into the roads they duplicate`);
    const ringNodes = new Map();   // roundabout index -> node ids of its synthesized ring
    for (const road of strokes) {
      // simplify each stroke (keep corners/curves, drop oversampling), then weld it
      // into the shared graph: ENDPOINTS weld at MERGE (so junctions/T-junctions join),
      // INTERIOR points weld at the tiny MERGE_MID (so the curve keeps its shape and is
      // NOT snapped onto a coarse grid). No decimation, no smoothing — the road follows
      // the trace exactly. deSpike drops only >150° near-reversals (hand jitter, never
      // a real road), so it runs even in exact mode; base strokes stay verbatim.
      // Synthesized rings bypass BOTH passes: they are already clean, and DP with a
      // closed loop's identical endpoints would collapse the circle to a point.
      const ew = road.base ? BASE_WELD : MRG, iw = road.base ? BASE_WELD : MMID;
      // base chains and rings bake VERBATIM — no simplify: a closed loop chain has
      // identical first/last points, and DP against that zero-length anchor chord
      // measures every interior point at 0 — the whole loop collapses and vanishes.
      const kept = road.ringIdx != null || road.base ? road.w : deSpike(simplify(road.w, SIMP), 150);
      let prev = nodeAt(kept[0], ew);
      const ids = [prev];
      for (let i = 1; i < kept.length; i++) {
        const id = nodeAt(kept[i], i === kept.length - 1 ? ew : iw);
        addEdge(prev, id, road.oneway, road.dirt); prev = id; ids.push(id);
      }
      if (road.ringIdx != null) ringNodes.set(road.ringIdx, new Set(ids));
    }
    dbgNodes('after bake');
    // Re-attach the junctions of folded twins. Each endpoint of a whole-dropped
    // chain was a junction other roads route through; the fold removed its edges
    // but the twin road runs right beside it. Splice the junction node INTO the
    // twin (split the edge at the projection, connect through), so the network
    // keeps every path the dropped fragment carried. Purely additive — no drawn
    // geometry moves.
    if (spliceEnds.length) {
      const findNode = (p, r) => {
        const cx = Math.floor(p[0] / MERGE), cz = Math.floor(p[1] / MERGE); let best = r, id = -1;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
          for (const i of arr) { const d = dist(nodes[i], p); if (d < best) { best = d; id = i; } }
        }
        return id;
      };
      const ecell = 2, egk = (x, z) => Math.floor(x / ecell) + ',' + Math.floor(z / ecell), eGrid = new Map();
      const addE = (ei) => { const e = edges[ei]; if (!e) return; const A = nodes[e[0]], B = nodes[e[1]];
        const n = Math.max(1, Math.ceil(dist(A, B) / ecell)); const put = new Set();
        for (let s2 = 0; s2 <= n; s2++) { const t = s2 / n, k = egk(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t); if (!put.has(k)) { put.add(k); (eGrid.get(k) || eGrid.set(k, []).get(k)).push(ei); } } };
      for (let i = 0; i < edges.length; i++) addE(i);
      const adjAll = new Map();
      const link = (a, b) => { (adjAll.get(a) || adjAll.set(a, new Set()).get(a)).add(b); (adjAll.get(b) || adjAll.set(b, new Set()).get(b)).add(a); };
      for (const e of edges) link(e[0], e[1]);
      const doneSplice = new Set();
      for (const p of spliceEnds) {
        const dk = Math.round(p[0] * 5) + ':' + Math.round(p[1] * 5);
        if (doneSplice.has(dk)) continue; doneSplice.add(dk);
        const X = findNode(p, 0.35); if (X < 0) continue;
        const nbrs = adjAll.get(X) || new Set();
        // nearest foreign EDGE BODY within the fold's own hug radius…
        const cx = Math.floor(p[0] / ecell), cz = Math.floor(p[1] / ecell);
        let be = -1, bt = 0, bd = DUP + 0.2; const seenE = new Set();
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const arr = eGrid.get((cx + dx) + ',' + (cz + dz)); if (!arr) continue;
          for (const ei of arr) {
            if (seenE.has(ei)) continue; seenE.add(ei);
            const e = edges[ei]; if (!e || e[0] === X || e[1] === X || nbrs.has(e[0]) || nbrs.has(e[1])) continue;
            const A = nodes[e[0]], B = nodes[e[1]], ddx = B[0] - A[0], ddz = B[1] - A[1], l2 = ddx * ddx + ddz * ddz || 1e-9;
            const t = ((p[0] - A[0]) * ddx + (p[1] - A[1]) * ddz) / l2;
            if (t < 0.05 || t > 0.95) continue;
            const d = Math.hypot(p[0] - (A[0] + ddx * t), p[1] - (A[1] + ddz * t));
            if (d < bd) { bd = d; be = ei; bt = t; }
          }
        }
        // …or the nearest foreign NODE (a dropped sliver often ends level with the
        // other chain's vertex, where no edge body projects)
        let bn = -1, bnd = DUP + 0.2;
        { const gx = Math.floor(p[0] / MERGE), gz = Math.floor(p[1] / MERGE);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const arr = grid.get((gx + dx) + ',' + (gz + dz)); if (!arr) continue;
            for (const i of arr) { if (i === X || nbrs.has(i)) continue;
              const d = dist(nodes[i], p); if (d > 1e-9 && d < bnd) { bnd = d; bn = i; } } } }
        if (bn >= 0 && (be < 0 || bnd <= bd)) {
          edges.push([X, bn, 0, 2, 0]); addE(edges.length - 1); link(X, bn);
        } else if (be >= 0) {
          const e = edges[be], A = nodes[e[0]], B = nodes[e[1]];
          const M = nodes.length; nodes.push([A[0] + (B[0] - A[0]) * bt, A[1] + (B[1] - A[1]) * bt]);
          edges[be] = [e[0], M, e[2], e[3], e[4]]; edges.push([M, e[1], e[2], e[3], e[4]]);
          addE(be); addE(edges.length - 1);
          edges.push([X, M, 0, 2, 0]); addE(edges.length - 1); link(X, M);
        }
      }
    }
    // ---- roundabout cleanup ----
    // The knot the user scribbled may ALREADY be baked into the base network from an
    // earlier apply — a blob of short edges sitting where the clean ring now stands.
    // Clear every non-ring edge that lies wholly inside a new ring, then hook each
    // dangling end near a ring onto its nearest ring node so all approaches join it.
    if (ringNodes.size) {
      const ringSet = new Set(); for (const s of ringNodes.values()) for (const id of s) ringSet.add(id);
      const clearOf = (ri) => Math.max(ringClear.get(ri) || 0, roundabouts[ri][2] + 0.5);
      const inR = (id, cx, cz, CLR) => Math.hypot(nodes[id][0] - cx, nodes[id][1] - cz) <= CLR;
      edges = edges.filter((e) => {
        if (ringSet.has(e[0]) || ringSet.has(e[1])) return true;
        for (const ri of ringNodes.keys()) { const [cx, cz] = roundabouts[ri], CLR = clearOf(ri); if (inR(e[0], cx, cz, CLR) && inR(e[1], cx, cz, CLR)) return false; }
        return true;
      });
      // Trim edges that INVADE a ring: a road may not overlap the circle. One that
      // stabs inside is re-ended on the nearest ring node; one that runs straight
      // through (a chord) becomes two approaches, one hooked on each side. This is
      // what clears the overlapping stubs where approaches used to cross the island.
      const rings = [...ringNodes.entries()].map(([ri, ids]) => ({ ids: [...ids], c: roundabouts[ri] }));
      const nearestRing = (ids, p) => { let best = Infinity, bj = -1; for (const id of ids) { const d = dist(p, nodes[id]); if (d < best) { best = d; bj = id; } } return bj; };
      const trimmed = [];
      for (const e0 of edges) {
        let e = e0, drop = false;
        for (const { ids, c: [cx, cz, R] } of rings) {
          if (ringSet.has(e[0]) && ringSet.has(e[1])) break;
          const A = nodes[e[0]], B = nodes[e[1]];
          const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz || 1e-9;
          const tp = ((cx - A[0]) * dx + (cz - A[1]) * dz) / l2, tc = tp < 0 ? 0 : tp > 1 ? 1 : tp;
          if (Math.hypot(cx - (A[0] + dx * tc), cz - (A[1] + dz * tc)) > R - 0.2) continue;   // stays outside the circle
          const da = Math.hypot(A[0] - cx, A[1] - cz), db = Math.hypot(B[0] - cx, B[1] - cz);
          if (da <= R + 0.3 && db <= R + 0.3) { drop = true; break; }
          if (da < R - 0.2 || db < R - 0.2) {                       // stabs in: end on the ring instead
            const inIdx = da < db ? 0 : 1, nr = nearestRing(ids, nodes[e[inIdx]]);
            if (nr === e[1 - inIdx]) { drop = true; break; }
            e = inIdx === 0 ? [nr, e[1], e[2], e[3], e[4]] : [e[0], nr, e[2], e[3], e[4]];
            continue;
          }
          // both ends outside, chord through the middle: split into two approaches
          const disc = Math.sqrt(Math.max(0, (R - 0.2) * (R - 0.2) - Math.pow(Math.hypot(cx - (A[0] + dx * tp), cz - (A[1] + dz * tp)), 2)) / l2);
          const t1 = tp - disc, t2 = tp + disc;
          const P1 = [A[0] + dx * t1, A[1] + dz * t1], P2 = [A[0] + dx * t2, A[1] + dz * t2];
          const n1 = nearestRing(ids, P1), n2 = nearestRing(ids, P2);
          if (n2 !== e[1]) trimmed.push([n2, e[1], e[2], e[3], e[4]]);
          if (n1 === e[0]) { drop = true; break; }
          e = [e[0], n1, e[2], e[3], e[4]];
        }
        if (!drop && e[0] !== e[1]) trimmed.push(e);
      }
      edges = trimmed;
      const degc = new Map(); for (const e of edges) { degc.set(e[0], (degc.get(e[0]) || 0) + 1); degc.set(e[1], (degc.get(e[1]) || 0) + 1); }
      for (let ni = 0; ni < nodes.length; ni++) {
        if ((degc.get(ni) || 0) !== 1 || ringSet.has(ni)) continue;
        for (const [ri, ids] of ringNodes) {
          const [cx, cz, R] = roundabouts[ri];
          if (Math.hypot(nodes[ni][0] - cx, nodes[ni][1] - cz) > Math.max(R + 3.5, clearOf(ri) + 2)) continue;
          let best = Infinity, bj = -1;
          for (const id of ids) { const d = dist(nodes[ni], nodes[id]); if (d < best) { best = d; bj = id; } }
          if (bj >= 0 && best > 1e-9) edges.push([ni, bj, 0, 2, 0]);
          break;
        }
      }
    }
    dbgNodes('after ring cleanup');
    // drop degenerate TINY self-loops: a chain of degree-2 nodes that returns to its
    // own start within a few world units is a freehand stroke that crossed itself, not
    // a real loop — it renders as a sharp spur, so remove its edges. (skipped in exact mode)
    if (!opts.exact) {
      const a2 = new Map(); const pushA = (n, rec) => { let x = a2.get(n); if (!x) a2.set(n, x = []); x.push(rec); };
      edges.forEach((e, i) => { pushA(e[0], { n: e[1], e: i }); pushA(e[1], { n: e[0], e: i }); });
      const deg = (n) => (a2.get(n)?.length || 0), dd = (a, b) => Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]);
      const seen = new Set(), drop = new Set();
      const walk = (start, ei) => { const ns = [start], es = []; let cur = start, edge = ei;
        while (true) { seen.add(edge); es.push(edge); const e = edges[edge], nxt = e[0] === cur ? e[1] : e[0]; ns.push(nxt); cur = nxt;
          if (deg(cur) !== 2) break; const nb = a2.get(cur).find((x) => !seen.has(x.e)); if (!nb) break; edge = nb.e; } return { ns, es }; };
      const consider = (ns, es) => { const s = ns[0], e = ns[ns.length - 1]; if (s !== e && dd(s, e) >= 3) return;
        let span = 0; for (const x of ns) span = Math.max(span, dd(s, x)); if (span < 4) es.forEach((x) => drop.add(x)); };
      for (const [node, list] of a2) { if (deg(node) === 2) continue; for (const nb of list) if (!seen.has(nb.e)) { const { ns, es } = walk(node, nb.e); consider(ns, es); } }
      for (let i = 0; i < edges.length; i++) if (!seen.has(i)) { const { ns, es } = walk(edges[i][0], i); consider(ns, es); }   // pure loops
      if (drop.size) edges = edges.filter((_, i) => !drop.has(i));
    }
    // compact: keep only nodes referenced by an edge (drops orphans from bulldoze)
    const used = new Set(); for (const e of edges) { used.add(e[0]); used.add(e[1]); }
    const remap = new Map(), cnodes = [];
    for (const id of used) { remap.set(id, cnodes.length); cnodes.push(nodes[id]); }
    nodes = cnodes; edges = edges.map(e => [remap.get(e[0]), remap.get(e[1]), e[2], e[3], e[4] || 0]);
    // melt zigzag BEFORE healing: at this point every road is still a clean
    // degree-2 chain, so the left-right stitching of an old bake can relax freely —
    // after the heal/crossing passes the same vertices may be pinned as junctions
    relaxZigzag(nodes, edges);
    // self-heal: weld every dangling road end back into the graph (endpoints -> nearest
    // node/junction, else spliced onto the road body it touches). A hand trace leaves
    // hundreds of junctions a unit or two short; without this the map shatters into ~1000
    // disconnected islands. Only endpoints move, so the traced curves are untouched.
    const healed = reconnectGraph(nodes, edges);
    // strokes drawn at different times often just CROSS each other with no shared node —
    // turn every such mid-span crossing into a real junction so the roads connect.
    const crossed = connectCrossings(healed.nodes, healed.edges);
    nodes = crossed.nodes; edges = crossed.edges;
    // guarantee: nothing the fold/cleanup touched may leave a region hanging — any
    // component within touching distance of another gets a connector at the gap
    const rejoined = mergeComponents(nodes, edges);
    if (rejoined) did.push(`rejoined ${rejoined} hanging fragment(s)`);
    // final polish: melt the left-right-left stitching that twin-folding (or a shaky
    // hand) leaves behind — junctions stay pinned, smooth curves and corners untouched
    relaxZigzag(nodes, edges);
    dbgNodes('final');
    outNodes = nodes.map(p => [r1(p[0]), r1(p[1])]); outEdges = edges;
    if (roadsIn.length) did.push(merge ? `roads +${newEdges.length} added -> ${outEdges.length} total` : `roads -> ${outNodes.length} nodes / ${outEdges.length} edges`);
  }

  let reservoirs = cur.RESERVOIRS_1966;
  if (reservoirsIn.length) { reservoirs = chainLoops(reservoirsIn, 0.05).map(p => decimateN(p, 0.0015)).filter(p => p.length >= 3); did.push(`reservoirs -> ${reservoirs.length} traced`); }

  if (roadsIn.length || reservoirsIn.length || (opts.mergeRoads && bulldozeIn.length)) {
    const body = `// 1966 Singapore road network + reservoirs. NODES: [x,z] world.
// EDGES: [a,b,oneway,class,dirt?].  oneway=1 -> single lane.  dirt=1 -> brown
// off-track road (5th field omitted when 0).  RESERVOIRS: normalised polygons.
// ROUNDABOUTS: [x,z,r] world — small traced circles that render a centre island.
export const ROAD_NODES_1966 = [${outNodes.map(p => `[${p[0]},${p[1]}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${outEdges.map(e => e[4] ? `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2},1]` : `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2}]`).join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(reservoirs)};

export const ROUNDABOUTS_1966 = ${JSON.stringify(roundabouts)};
`;
    writeFileSync(roadsURL, body);
  }

  if (mainlandIn.length || islandsIn.length || foreignIn.length) {
    let s = readFileSync(shapeURL, 'utf8');
    const arr = polys => '[' + polys.map(p => '[' + p.map(([x, y]) => `[${x}, ${y}]`).join(', ') + ']').join(',\n  ') + ']';
    const replExport = (txt, name, value) => { const re = new RegExp(`export const ${name} = \\[[\\s\\S]*?\\];`); if (!re.test(txt)) throw new Error(`could not find export ${name} in shape.js`); return txt.replace(re, () => `export const ${name} = ${value};`); };
    if (mainlandIn.length) {
      // The mainland is the loop with the largest AREA (not the most points), so a
      // re-traced coastline becomes the island even if drawn with few points, and a
      // small detailed island never usurps the mainland.
      const polyArea = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a) / 2; };
      // stitch edited-coast arcs back into loops. The join radius is TIGHT (0.02 ≈ 32u):
      // the old 0.12 (≈190u!) could chain an arc to the wrong neighbour and bridge the
      // gap with a long straight chord — the "abrupt join" that rewrote a drawn coastline.
      // Decimation is ~1.3u so the traced shoreline detail survives.
      const loops = chainLoops(mainlandIn, 0.02).map(p => decimateN(p, 0.0008)).filter(p => p.length >= 3).sort((a, b) => polyArea(b) - polyArea(a));
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
    // keep near-full point density (~1u spacing): the old 0.003 (≈4.8u) decimation
    // visibly flattened the hand-traced railway curves.
    const polyN = p => '[' + decimateN(p, 0.0006).map(([x, y]) => `[${x},${y}]`).join(',') + ']';
    if (housesIn.length) { const hstr = housesIn.map(b => `{ type: '${b.type}', cx: ${r3(b.cx)}, cy: ${r3(b.cy)}, w: ${r4(b.w)}, h: ${r4(b.h)}, rot: ${r3((b.rot || 0) * Math.PI / 180)}, hgt: ${r2(b.hgt || 1)} }`).join(', '); replC('CUSTOM_HOUSES', `[${hstr}]`); did.push(`houses -> ${housesIn.length}`); }
    if (railwayIn.length) { replC('CUSTOM_RAILWAYS', '[' + railwayIn.map(polyN).join(', ') + ']'); did.push(`railway -> ${railwayIn.length}`); }
    if (sandsIn.length) { const sandLoops = chainLoops(sandsIn, 0.05).filter(p => p.length >= 3); replC('CUSTOM_SANDS', '[' + sandLoops.map(polyN).join(', ') + ']'); did.push(`sands -> ${sandLoops.length}`); }
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
