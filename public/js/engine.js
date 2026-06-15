// Simulation engine: holds the game state and advances it day by day.
// Pure-ish logic (no DOM) so it can be unit-tested in Node as well.
import {
  BUILDINGS, POLICIES, START_DATE, GRID_SIZE, POP_SCALE,
  HISTORICAL_EVENTS, RANDOM_EVENTS,
} from './data.js';
import { onLand, inReservoir, inRiver } from './shape.js';
import { ROAD_NODES_1966, ROAD_EDGES_1966 } from './roads1966.js';

// Is grid cell (x,y) on Singapore land (mainland or islands), not reservoir/river?
function isLandCell(x, y) {
  return onLand((x + 0.5) / GRID_SIZE, (y + 0.5) / GRID_SIZE)
    && !inReservoir(x, y, GRID_SIZE) && !inRiver(x, y, GRID_SIZE);
}

const DAYS_IN_MONTH = 30;
const STATE_VERSION = 1;

// ---- date helpers ----------------------------------------------------------
function addDay(date) {
  let { y, m, d } = date;
  d += 1;
  if (d > DAYS_IN_MONTH) { d = 1; m += 1; }
  if (m > 12) { m = 1; y += 1; }
  return { y, m, d };
}
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(date) {
  return `${String(date.d).padStart(2, '0')} ${MONTHS[date.m]} ${date.y}`;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function approach(cur, target, rate) { return cur + (target - cur) * rate; }

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------
export function newGame({ name = 'New Singapore', owner = 'Anonymous' } = {}) {
  const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

  const policies = {};
  for (const [key, p] of Object.entries(POLICIES)) {
    policies[key] = p.type === 'toggle' ? false : (p.default ?? p.options[0].id);
  }

  const state = {
    version: STATE_VERSION,
    name, owner,
    date: { ...START_DATE },
    speed: 0,                 // 0 paused; set by UI
    treasury: 180,            // $ millions
    // Scaled citizens (×POP_SCALE for display). Sized to the standing 1965 city
    // (SEED_1965, seeded into the grid by the 3D view): its kampongs, shophouses
    // and early HDB estates house this many people, its port/factories/services
    // employ the workforce, and its power stations + water mains supply them.
    // Deliberately set so the labour force slightly outnumbers the jobs the young
    // economy can offer — ~10% unemployment, the real, pressing problem of 1965
    // that drove the industrialisation drive. The player grows the city out of it.
    population: 47500,
    approval: 58,
    education: 20,
    health: 25,
    safety: 30,
    pollution: 5,
    debt: 0,                  // outstanding government bonds ($M)
    grid,
    policies,
    flags: {},                // historical events fired
    unlocked: {},             // buildings unlocked by choices
    log: [{ d: { ...START_DATE }, text: 'Singapore gains independence. The journey begins.' }],
    pendingEvent: null,       // event awaiting player choice
    roads: { nodes: [], edges: [], islands: [] }, // player-drawn freeform road network
    reclaimed: [],            // [x,y] sea cells reclaimed into finished, buildable land
    reclaiming: [],           // { x,y,total,left } cells still rising from the sea (legacy per-cell)
    reclaimAreas: [],         // { poly:[[x,z]..], cells:[[x,y]..], total,left } free-shaped areas rising
    reclaimedAreas: [],       // { poly, cells } finished free-shaped reclaimed land (smooth coastline)
    economy: { inflation: 0.02, priceIndex: 1, currency: 1 }, // dynamic inflation / price level / SGD strength
    constructing: [],         // [x,y] cells whose building is still being built
    landmarks: [],            // 3D-designed landmarks saved into THIS world (per-player; for build menu + visitors)
    roadworks: [],            // routes (road/rail/air) drawn on the map, still under construction
    railways: [],             // finished player-drawn railway lines (polylines of {x,z})
    airstrips: [],            // finished player-drawn airport runways (polylines of {x,z})
    summary: {},
    daysElapsed: 0,
  };

  seed1965(state);            // historical southern town + scattered kampongs
  refreshSummary(state);
  return state;
}

// Grid cell -> world coordinates (must match scene3d's cellToWorld).
function cellWorld(x, y) {
  return { x: (x + 0.5 - GRID_SIZE / 2) * 10, z: (GRID_SIZE / 2 - y - 0.5) * 10, y: 0 };
}

// Recreate roughly how Singapore looked at independence: a small developed town
// in the south (the colonial city/port) with a sparse street grid, and a handful
// of kampongs dotted across an otherwise rural island. Players build out the rest.
// Inject the traced 1966 road network into a roads object: the full, smoothed,
// interconnected graph — nodes shared between edges so the streets connect at
// every junction. One-way streets carry a `oneway` flag (lanes: 1). `traced`
// marks them for the slim, no-stop-line rendering. Seeded only once.
function injectTracedRoads(roads) {
  const base = roads.nodes.length;
  for (const [x, z] of ROAD_NODES_1966) roads.nodes.push({ x, z, y: 0 });
  for (const [a, b, ow, cls] of ROAD_EDGES_1966)
    roads.edges.push({
      a: a + base, b: b + base, ctrl: null,
      type: 'road', lanes: ow ? 1 : 2, elevated: false,
      oneway: !!ow, traced: true, roadClass: cls || 3,
    });
  roads.seeded1966 = true;
}

function seed1965(state) {
  // The real 1966 road network is the starting infrastructure — no colonial
  // street grid or town blocks, and no scattered seed kampongs (they obstructed
  // the roads). The map starts as the bare island + roads; the player builds.
  injectTracedRoads(state.roads);
}

// Bring a loaded save up to the current map size (e.g. older, smaller grids):
// re-centre the existing layout onto a fresh GRID_SIZE×GRID_SIZE grid.
export function ensureGrid(state) {
  if (!state) return state;
  if (typeof state.debt !== 'number') state.debt = 0;
  if (!state.roads) state.roads = { nodes: [], edges: [], islands: [] };
  if (!Array.isArray(state.reclaimed)) state.reclaimed = [];
  if (!Array.isArray(state.reclaiming)) state.reclaiming = [];
  if (!Array.isArray(state.reclaimAreas)) state.reclaimAreas = [];
  if (!Array.isArray(state.reclaimedAreas)) state.reclaimedAreas = [];
  if (!Array.isArray(state.landmarks)) state.landmarks = [];
  if (!Array.isArray(state.roadworks)) state.roadworks = [];
  if (!Array.isArray(state.railways)) state.railways = [];
  if (!Array.isArray(state.airstrips)) state.airstrips = [];
  if (!state.economy) state.economy = { inflation: 0.02, priceIndex: 1, currency: 1 };
  // Rebuild the active-construction list from the grid (robust across saves).
  state.constructing = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    const c = state.grid?.[y]?.[x]; if (c && c.build && c.build.left > 0) state.constructing.push([x, y]);
  }
  if (!state.roads.islands) state.roads.islands = [];
  // back-fill the traced 1966 roads into saves that predate them (so existing
  // games aren't left road-less after the update); skip if already seeded or
  // the player has drawn their own roads.
  if (!state.roads.seeded1966 && !state.roads.edges.some((e) => e.traced)) {
    if (state.roads.edges.length === 0) injectTracedRoads(state.roads);
    else state.roads.seeded1966 = true; // had hand-drawn roads — leave them be
  }
  const g = state.grid;
  const ok = Array.isArray(g) && g.length === GRID_SIZE && Array.isArray(g[0]) && g[0].length === GRID_SIZE;
  if (ok) return state;
  const old = Array.isArray(g) ? g : [];
  const oldH = old.length, oldW = oldH ? (old[0]?.length || 0) : 0;
  const off = Math.floor((GRID_SIZE - oldW) / 2), offY = Math.floor((GRID_SIZE - oldH) / 2);
  const next = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  for (let y = 0; y < oldH; y++) for (let x = 0; x < oldW; x++) {
    const ny = y + offY, nx = x + off;
    if (ny >= 0 && nx >= 0 && ny < GRID_SIZE && nx < GRID_SIZE) next[ny][nx] = old[y]?.[x] || null;
  }
  state.grid = next;
  return state;
}

// ---------------------------------------------------------------------------
// Building placement
// ---------------------------------------------------------------------------
export function canPlace(state, x, y, key) {
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return false;
  if (state.grid[y][x]) return false;
  const b = BUILDINGS[key];
  if (!b) return false;
  if (!isUnlocked(state, key)) return false;
  return state.treasury >= buildingCost(state, key);
}
export function isUnlocked(state, key) {
  const b = BUILDINGS[key];
  if (!b) return false;
  if (state.unlocked[key]) return true;
  return state.date.y >= b.year;
}
function place(state, x, y, key, theme) {
  state.grid[y][x] = theme ? { k: key, c: theme } : { k: key };
}
export function build(state, x, y, key, theme) {
  if (!canPlace(state, x, y, key)) return false;
  state.treasury -= buildingCost(state, key);
  place(state, x, y, key, theme);
  // Construction takes time (by complexity): the building gives no homes/jobs/
  // utilities and pays no upkeep until it tops out. Tracked on the cell + a flat
  // list so the daily advance stays cheap.
  const days = buildDays(BUILDINGS[key]);
  state.grid[y][x].build = { total: days, left: days };
  (state.constructing || (state.constructing = [])).push([x, y]);
  return true;
}
// Advance every active construction site by one day; drop the marker when done.
function advanceConstruction(state) {
  if (!state.constructing || !state.constructing.length) return;
  const still = [];
  for (const [x, y] of state.constructing) {
    const c = state.grid[y] && state.grid[y][x];
    if (!c || !c.build) continue;                 // demolished or already finished
    c.build.left -= 1;
    if (c.build.left <= 0) delete c.build;         // topped out — now operational
    else still.push([x, y]);
  }
  state.constructing = still;
}
export function demolish(state, x, y) {
  const cell = state.grid?.[y]?.[x];
  if (!cell) return false;
  state.grid[y][x] = null;
  state.treasury -= 2; // demolition cost
  return true;
}

// ---------------------------------------------------------------------------
// Land reclamation — turning sea into buildable land for money.
// Cost is by AREA (charged per cell) and rises with INFLATION over the years:
// a cell reclaimed in 1965 is cheap; the same cell in 2010 costs several times
// more. (Geometry validation — "is this open Singapore sea?" — lives in the
// 3D view's canReclaim(), which has the coastline & foreign-land masks.)
// ---------------------------------------------------------------------------
export const RECLAIM = { basePerCell: 2, days: 8 }; // $M/cell at 1965 prices (× live price index); days to rise
// Cost to reclaim `cells` cells at today's prices ($M).
export function reclaimCost(state, cells = 1) {
  return Math.round(RECLAIM.basePerCell * priceIndex(state) * cells * 10) / 10;
}
// Area of a polygon of [x,z] points (shoelace), in world units².
export function polyArea(poly) {
  let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a) / 2;
}
// Reclamation priced by the actual LAND AREA drawn (a cell is 10×10 = 100 units²).
export function reclaimAreaCost(state, areaUnits) {
  return Math.round(RECLAIM.basePerCell * priceIndex(state) * (areaUnits / 100) * 10) / 10;
}
// Queue a free-shaped reclamation. `cells` are the grid cells it covers (for
// buildability); `poly` is the smooth outline (for rendering). Charges by area.
export function addReclaimArea(state, { poly, cells, total }) {
  if (!Array.isArray(state.reclaimAreas)) state.reclaimAreas = [];
  state.reclaimAreas.push({ poly, cells, total: total || RECLAIM.days, left: total || RECLAIM.days });
  return { ok: true };
}
// ---------------------------------------------------------------------------
// Inflation & prices — a live price level (priceIndex) compounds from a dynamic
// inflation rate that responds to how well the player runs the economy. All
// in-game purchases (buildings, roads, reclamation) are charged at today's
// prices = base (1965) cost × priceIndex.
// ---------------------------------------------------------------------------
export function priceIndex(state) { return (state && state.economy && state.economy.priceIndex) || 1; }
export function inflationRate(state) { return (state && state.economy && state.economy.inflation != null) ? state.economy.inflation : 0.02; }
export function currencyStrength(state) { return (state && state.economy && state.economy.currency) || 1; }
// A 1965-baseline price charged at today's price level.
export function priced(base, state) { return Math.round(base * priceIndex(state) * 10) / 10; }
// Current purchase cost of a building ($M) after inflation.
export function buildingCost(state, key) { const b = BUILDINGS[key]; return b ? Math.round(b.cost * priceIndex(state)) : 0; }

// Construction time in game-days, from a building's complexity (its base cost,
// plus part count for 3D-designed landmarks). Bigger/more elaborate = longer.
export function buildDays(b) {
  if (!b) return 2;
  let days = Math.sqrt(b.cost || 1) * 1.6;
  if (b.landmarkParts) days += b.landmarkParts.length * 0.8; // designed complexity
  return clamp(Math.round(days), 2, 48);
}

// The inflation rate the economy is pulling toward this month (annualised).
// Golden rules: ~2% central-bank anchor, demand-pull when the labour market is
// tight (Phillips curve), fiscal slippage (debt/deficits) weakens the currency
// and imports inflation, while a strong treasury + credible, productive,
// well-approved government anchors low inflation (Singapore's strong-SGD model);
// utility shortages and pollution are supply shocks.
function inflationTarget(state, d) {
  let t = 0.02;
  t += (0.045 - d.unemployment) * 0.5;                 // demand-pull / Phillips curve
  const debtLoad = clamp((state.debt || 0) / Math.max(1, debtCeiling(state)), 0, 1.5);
  t += debtLoad * 0.03;                                // heavy debt -> weaker currency
  const net = state.lastFinance ? state.lastFinance.net : 0;
  t -= clamp(net / 250, -0.02, 0.02);                  // surplus strengthens, deficit weakens
  t -= clamp(state.treasury / 1500, -0.4, 0.6) * 0.02; // reserves back a strong currency
  t -= (state.approval - 50) / 50 * 0.01;              // political stability anchors expectations
  t -= (state.education - 20) / 100 * 0.012;           // productivity
  if (d.powerRatio < 1) t += (1 - d.powerRatio) * 0.05; // supply shock: power
  if (d.waterRatio < 1) t += (1 - d.waterRatio) * 0.05; // supply shock: water
  t += clamp((state.pollution - 25) / 100, 0, 0.025);   // cost-push from pollution
  return clamp(t, -0.02, 0.30);
}
// Settle the economy each month: glide inflation toward target (sticky
// expectations), compound the price level, and update currency strength.
function updateEconomy(state, d) {
  const e = state.economy || (state.economy = { inflation: 0.02, priceIndex: 1, currency: 1 });
  e.inflation = approach(e.inflation, inflationTarget(state, d), 0.2);
  e.priceIndex = Math.max(1, e.priceIndex * (1 + e.inflation / 12)); // prices never fall below 1965
  const strengthTarget = clamp(
    1 + (0.02 - e.inflation) * 4 + state.treasury / 4000
      - (state.debt || 0) / Math.max(1, debtCeiling(state)) * 0.3, 0.4, 2.5);
  e.currency = approach(e.currency, strengthTarget, 0.1);
}

// Charge for one reclaimed cell. Reclamation, like a building, takes time: the
// cell is added to `reclaiming` and only becomes buildable land (moved into
// `reclaimed`) once it has risen from the sea. Returns { ok, cost, reason }.
export function reclaimLand(state, x, y) {
  if (!Array.isArray(state.reclaimed)) state.reclaimed = [];
  if (!Array.isArray(state.reclaiming)) state.reclaiming = [];
  const cost = reclaimCost(state, 1);
  if (state.treasury < cost) return { ok: false, reason: 'funds', cost };
  state.reclaiming.push({ x, y, total: RECLAIM.days, left: RECLAIM.days });
  state.treasury -= cost;
  return { ok: true, cost };
}
// Advance every active reclamation by a day; finished cells/areas become real land.
function advanceReclamation(state) {
  if (state.reclaiming && state.reclaiming.length) {            // legacy per-cell
    const still = [];
    for (const r of state.reclaiming) { r.left -= 1; if (r.left <= 0) (state.reclaimed || (state.reclaimed = [])).push([r.x, r.y]); else still.push(r); }
    state.reclaiming = still;
  }
  if (state.reclaimAreas && state.reclaimAreas.length) {        // free-shaped areas
    const still = [];
    for (const a of state.reclaimAreas) {
      a.left -= 1;
      if (a.left <= 0) (state.reclaimedAreas || (state.reclaimedAreas = [])).push({ poly: a.poly, cells: a.cells });
      else still.push(a);
    }
    state.reclaimAreas = still;
  }
}

// ---------------------------------------------------------------------------
// Drawn routes (roads / railways) under construction
// ---------------------------------------------------------------------------
// Length of a polyline of {x,z} in world units.
export function routeLength(pts) {
  let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}
// Chaikin corner-cutting: repeatedly round off every corner so a jagged, hand-drawn
// polyline becomes a genuinely smooth, flowing curve — independent of how jittery the
// input was (Catmull-Rom passes *through* the points, so it kept hand-drawn kinks).
// Endpoints are preserved. `iterations` controls how round it gets.
// Perpendicular distance from point p to the segment a-b.
function _segDist(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
// Ramer–Douglas–Peucker: drop points that lie within `eps` of the line through the
// kept points. Straight runs collapse to a straight line; only genuine bends survive.
function _rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = _segDist(pts[i], a, b); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD > eps) {
    const left = _rdp(pts.slice(0, idx + 1), eps), right = _rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
// Turn a hand-drawn stroke into a clean route: SIMPLIFY first (so a line you meant
// to be straight stays straight and hand jitter is removed), then gently round the
// remaining genuine bends so deliberate curves flow. `eps` is the simplify tolerance.
export function smoothRoute(pts, eps = 4) {
  let P = (pts || []).map((p) => ({ x: p.x, z: p.z }));
  if (P.length < 3) return P;
  P = _rdp(P, eps);                 // straight sections -> just their endpoints; jitter gone
  if (P.length < 3) return P;       // a straight line stays perfectly straight
  for (let it = 0; it < 3; it++) {  // Chaikin ×3: round the bends smoothly (straights stay straight)
    const out = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(P[P.length - 1]);
    P = out;
  }
  return P;
}
// Queue a drawn route for construction. Returns { ok, cost }.
export function addRoadwork(state, route) {
  if (!state.roadworks) state.roadworks = [];
  state.roadworks.push({
    pts: route.pts, kind: route.kind || 'road', type: route.type || 'road',
    lanes: route.lanes || 2, elevated: !!route.elevated, tunnel: !!route.tunnel,
    total: route.total, left: route.total,
  });
  return { ok: true };
}
// ---------------------------------------------------------------------------
// Road-network connectivity — splice a freshly built road into the graph so it
// JOINS whatever it touches: end-to-end at a shared node, a T where one end meets
// the middle of another road, and an X where two roads cross. Junctions become
// shared nodes, so the unified nav graph lets vehicles drive through them.
// ---------------------------------------------------------------------------
// Intersection of segment a→b with c→d, interior to BOTH (touches exactly at an
// endpoint are left to node-merging). Returns the crossing point + params, else null.
function _segCross(a, b, c, d) {
  const r1x = b.x - a.x, r1z = b.z - a.z, r2x = d.x - c.x, r2z = d.z - c.z, den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-9) return null;                       // parallel / degenerate
  const t = ((c.x - a.x) * r2z - (c.z - a.z) * r2x) / den, u = ((c.x - a.x) * r1z - (c.z - a.z) * r1x) / den;
  if (t < 1e-4 || t > 1 - 1e-4 || u < 1e-4 || u > 1 - 1e-4) return null;
  return { t, u, x: a.x + r1x * t, z: a.z + r1z * t };
}
function _projSeg(pt, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  let t = ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
  const x = a.x + dx * t, z = a.z + dz * t; return { x, z, t, d: Math.hypot(pt.x - x, pt.z - z) };
}
// The world polyline of an edge (straight a→b, quadratic-Bézier ctrl, or stored poly).
function _edgeLine(roads, e) {
  if (e.poly && e.poly.length >= 2) return e.poly.map((p) => ({ x: p.x, z: p.z }));
  const a = roads.nodes[e.a], b = roads.nodes[e.b]; if (!a || !b) return [];
  if (e.ctrl) { const o = []; for (let i = 0; i <= 10; i++) { const t = i / 10, it = 1 - t; o.push({ x: it * it * a.x + 2 * it * t * e.ctrl.x + t * t * b.x, z: it * it * a.z + 2 * it * t * e.ctrl.z + t * t * b.z }); } return o; }
  return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
}
// Split existing edge `ei` at the given world points (projected onto it). Replaces
// the edge in place with the first piece and appends the rest; returns the new
// junction nodes. Pieces inherit the edge's attributes (type/lanes/traced/…).
function _splitEdge(roads, ei, pts, nodeAt) {
  const e = roads.edges[ei], line = _edgeLine(roads, e); if (line.length < 2) return [];
  const straight = !(e.poly && e.poly.length >= 2) && !e.ctrl;
  const segArc = [0]; for (let i = 1; i < line.length; i++) segArc.push(segArc[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
  const total = segArc[segArc.length - 1];
  const cuts = [];
  for (const pt of pts) {
    let bd = Infinity, bs = 0, bx = pt.x, bz = pt.z;
    for (let i = 0; i < line.length - 1; i++) { const pr = _projSeg(pt, line[i], line[i + 1]); if (pr.d < bd) { bd = pr.d; bs = segArc[i] + pr.t * (segArc[i + 1] - segArc[i]); bx = pr.x; bz = pr.z; } }
    if (bs > 2 && bs < total - 2) cuts.push({ s: bs, x: bx, z: bz });   // ignore cuts at the very ends (use the endpoint node)
  }
  if (!cuts.length) return [];
  cuts.sort((a, b) => a.s - b.s);
  const uniq = [cuts[0]]; for (let i = 1; i < cuts.length; i++) if (cuts[i].s - uniq[uniq.length - 1].s > 1.5) uniq.push(cuts[i]);
  const made = uniq.map((c) => ({ x: c.x, z: c.z, node: nodeAt(c.x, c.z) }));
  const attr = (a, b, poly2) => { const o = { a, b, ctrl: null, type: e.type, lanes: e.lanes, elevated: e.elevated }; if (e.traced) o.traced = true; if (e.oneway) o.oneway = e.oneway; if (e.roadClass != null) o.roadClass = e.roadClass; if (!straight) o.poly = poly2; return o; };
  const slice = (s0, p0, s1, p1) => { const out = [{ x: p0.x, z: p0.z }]; for (let i = 0; i < line.length; i++) if (segArc[i] > s0 + 1e-6 && segArc[i] < s1 - 1e-6) out.push({ x: line[i].x, z: line[i].z }); out.push({ x: p1.x, z: p1.z }); return out; };
  const A = roads.nodes[e.a], B = roads.nodes[e.b];
  const stops = [{ s: 0, x: A.x, z: A.z, node: e.a }, ...uniq.map((c, k) => ({ s: c.s, x: made[k].x, z: made[k].z, node: made[k].node })), { s: total, x: B.x, z: B.z, node: e.b }];
  for (let k = 0; k < stops.length - 1; k++) {
    const s = stops[k], t = stops[k + 1];
    if (s.node === t.node) continue;
    const piece = attr(s.node, t.node, straight ? null : slice(s.s, s, t.s, t));
    if (k === 0) roads.edges[ei] = piece; else roads.edges.push(piece);
  }
  return made;
}
// Splice the drawn polyline P (array of {x,z}) into the road graph.
export function spliceRoad(roads, P, meta) {
  if (!P || P.length < 2) return;
  const JOIN = 4.5, nodes = roads.nodes, edges = roads.edges, nE = edges.length;
  const nodeAt = (x, z) => { for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (Math.hypot(n.x - x, n.z - z) < JOIN) return i; } nodes.push({ x, z, y: 0 }); return nodes.length - 1; };
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  minX -= JOIN; minZ -= JOIN; maxX += JOIN; maxZ += JOIN;
  const arc = [0]; for (let i = 1; i < P.length; i++) arc.push(arc[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  const events = [], edgeSplits = new Map();
  const addSplit = (ei, pt) => { let a = edgeSplits.get(ei); if (!a) { a = []; edgeSplits.set(ei, a); } a.push(pt); };
  for (let ei = 0; ei < nE; ei++) {
    const line = _edgeLine(roads, edges[ei]); if (line.length < 2) continue;
    let exmin = Infinity, exmax = -Infinity, ezmin = Infinity, ezmax = -Infinity;
    for (const p of line) { exmin = Math.min(exmin, p.x); exmax = Math.max(exmax, p.x); ezmin = Math.min(ezmin, p.z); ezmax = Math.max(ezmax, p.z); }
    if (exmax < minX || exmin > maxX || ezmax < minZ || ezmin > maxZ) continue;     // bbox prefilter
    for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < line.length - 1; j++) {
      const h = _segCross(P[i], P[i + 1], line[j], line[j + 1]);
      if (h) { events.push({ s: arc[i] + (arc[i + 1] - arc[i]) * h.t, x: h.x, z: h.z }); addSplit(ei, { x: h.x, z: h.z }); }
    }
  }
  // endpoint T-joins: an end that lands on the MIDDLE of an existing road (not near a node)
  const endJoin = (pi, sVal) => {
    const pt = P[pi];
    for (const n of nodes) if (Math.hypot(n.x - pt.x, n.z - pt.z) < JOIN) return;     // already meets a node
    let best = null;
    for (let ei = 0; ei < nE; ei++) { const line = _edgeLine(roads, edges[ei]); for (let j = 0; j < line.length - 1; j++) { const pr = _projSeg(pt, line[j], line[j + 1]); if (pr.d < JOIN && (!best || pr.d < best.d)) best = { d: pr.d, x: pr.x, z: pr.z, ei }; } }
    if (best) { events.push({ s: sVal, x: best.x, z: best.z }); addSplit(best.ei, { x: best.x, z: best.z }); }
  };
  endJoin(0, 0); endJoin(P.length - 1, arc[arc.length - 1]);
  for (const [ei, pts] of edgeSplits) _splitEdge(roads, ei, pts, nodeAt);            // cut existing roads at junctions
  // build the new road, broken at each junction so it shares those nodes
  events.sort((a, b) => a.s - b.s);
  const startNode = nodeAt(P[0].x, P[0].z), endNode = nodeAt(P[P.length - 1].x, P[P.length - 1].z);
  const stops = [{ s: 0, x: P[0].x, z: P[0].z, node: startNode }];
  for (const ev of events) { const node = nodeAt(ev.x, ev.z); if (node !== stops[stops.length - 1].node) stops.push({ s: ev.s, x: ev.x, z: ev.z, node }); }
  if (endNode !== stops[stops.length - 1].node) stops.push({ s: arc[arc.length - 1], x: P[P.length - 1].x, z: P[P.length - 1].z, node: endNode });
  for (let k = 0; k < stops.length - 1; k++) {
    const A = stops[k], B = stops[k + 1]; if (A.node === B.node) continue;
    const sub = [{ x: A.x, z: A.z }];
    for (let i = 0; i < P.length; i++) if (arc[i] > A.s + 1e-6 && arc[i] < B.s - 1e-6) sub.push({ x: P[i].x, z: P[i].z });
    sub.push({ x: B.x, z: B.z });
    if (sub.length >= 2) edges.push({ a: A.node, b: B.node, ctrl: null, poly: sub, type: meta.type, lanes: meta.lanes, elevated: meta.elevated });
  }
}

// Advance route construction; finished routes become real roads/railways.
function advanceRoadworks(state) {
  if (!state.roadworks || !state.roadworks.length) return;
  const still = [];
  for (const w of state.roadworks) {
    w.left -= 1;
    if (w.left > 0) { still.push(w); continue; }
    if (w.kind === 'rail') {
      // store geometry + whether it's an elevated viaduct (renderer reads elevated)
      (state.railways || (state.railways = [])).push({ pts: w.pts.map((p) => [p.x, p.z]), elevated: !!w.elevated });
    } else if (w.kind === 'air') {
      (state.airstrips || (state.airstrips = [])).push({ pts: w.pts.map((p) => [p.x, p.z]), elevated: !!w.elevated });
    } else {
      // a drawn road is spliced into the graph: it carries its full smoothed
      // polyline (so it renders as one uniform ribbon) AND is broken at every place
      // it meets/crosses an existing road, sharing a junction node there so traffic
      // can drive straight through end-to-end joins, T-junctions and crossings.
      spliceRoad(state.roads, w.pts.map((p) => ({ x: p.x, z: p.z })), { type: w.type, lanes: w.lanes, elevated: w.elevated });
    }
  }
  state.roadworks = still;
}

// ---------------------------------------------------------------------------
// Public finance — government bonds (borrowing).
// ---------------------------------------------------------------------------
// Annual coupon rate rises with how much of the borrowing limit is used (credit risk).
export function bondRate(state) {
  const ceil = debtCeiling(state);
  const util = ceil > 0 ? Math.min(1, (state.debt || 0) / ceil) : 1;
  // Fisher: nominal yield ≈ real rate + inflation + credit-risk premium.
  return 0.02 + Math.max(0, inflationRate(state)) + util * 0.06; // ~4% .. ~12%
}
// How much the government can owe — scales with the economy (annual revenue) & population.
export function debtCeiling(state) {
  const annualRev = (state.lastFinance?.grossIncome || 0) * 12;
  const pop = (state.population || 0) * POP_SCALE;
  return Math.round(Math.max(400, annualRev * 3 + pop * 0.002));
}
// Issue bonds to raise cash now (capped by the ceiling). Returns the amount raised.
export function issueBond(state, amount) {
  const room = Math.max(0, debtCeiling(state) - (state.debt || 0));
  const amt = Math.max(0, Math.min(Math.round(amount), room));
  if (!amt) return 0;
  state.debt = (state.debt || 0) + amt;
  state.treasury += amt;
  return amt;
}
// Repay outstanding debt from the treasury. Returns the amount repaid.
export function repayDebt(state, amount) {
  const amt = Math.max(0, Math.min(Math.round(amount), state.debt || 0, Math.floor(state.treasury)));
  if (!amt) return 0;
  state.debt -= amt;
  state.treasury -= amt;
  return amt;
}

// ---------------------------------------------------------------------------
// Policy modifiers — aggregate all active policy effects into one bag.
// ---------------------------------------------------------------------------
function policyMods(state) {
  const m = {
    taxMult: 1, approval: 0, growth: 0, migration: 0, birth: 1,
    housingAfford: 0, eduMult: 1, healthMult: 1, productivity: 0,
    incomeMult: 0, jobsBoost: 0, stability: 0, upkeep: 0,
    gstRevenue: 0, pollutionMult: 0, waterDemandMult: 0,
  };
  const add = (fx) => {
    if (!fx) return;
    for (const [k, v] of Object.entries(fx)) {
      if (k in m) m[k] += v;
    }
  };
  for (const [key, p] of Object.entries(POLICIES)) {
    if (state.date.y < p.year) continue;
    const val = state.policies[key];
    if (p.type === 'toggle') {
      if (val) add(p.fx);
    } else {
      const opt = p.options.find((o) => o.id === val);
      add(opt?.fx);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Derived statistics — recomputed each tick from the grid + policies.
// ---------------------------------------------------------------------------
export function derive(state) {
  let homes = 0, jobs = 0, powerGen = 0, powerUse = 0, waterGen = 0, waterUse = 0;
  let pollutionSrc = 0, happinessLocal = 0, directIncome = 0;
  let eduCap = 0, healthCap = 0, safetyCap = 0;
  let counts = {};

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = state.grid[y]?.[x];
      if (!cell) continue;
      const b = BUILDINGS[cell.k];
      if (!b) continue;
      if (cell.build && cell.build.left > 0) continue; // still under construction — no output yet
      counts[cell.k] = (counts[cell.k] || 0) + 1;
      homes += b.homes || 0;
      jobs += b.jobs || 0;
      if (b.power > 0) powerGen += b.power; else powerUse += -b.power;
      if (b.water > 0) waterGen += b.water; else waterUse += -b.water;
      pollutionSrc += b.pollution || 0;
      happinessLocal += b.happiness || 0;
      directIncome += b.income || 0;
      eduCap += b.education || 0;
      healthCap += b.health || 0;
      safetyCap += b.safety || 0;
    }
  }

  const mods = policyMods(state);
  const pop = state.population;

  // Residents consume extra power & water on top of building loads.
  powerUse += pop * 0.0009;
  waterGen += 45;   // the Central Catchment reservoirs (MacRitchie/Peirce/Seletar)
  waterUse += pop * 0.0016 * (1 + mods.waterDemandMult);

  const mods_jobs = jobs * (1 + mods.jobsBoost);
  const powerRatio = powerUse > 0 ? powerGen / powerUse : 2;
  const waterRatio = waterUse > 0 ? waterGen / waterUse : 2;

  const workforce = pop * 0.62;
  const employed = Math.min(workforce, mods_jobs);
  const unemployment = workforce > 0 ? clamp((workforce - employed) / workforce, 0, 1) : 0;

  // Housing pressure: >1 means overcrowded.
  const housingPressure = homes > 0 ? pop / homes : (pop > 0 ? 3 : 0);

  return {
    homes, jobs: mods_jobs, baseJobs: jobs, counts,
    powerGen, powerUse, powerRatio,
    waterGen, waterUse, waterRatio,
    pollutionSrc, happinessLocal, directIncome,
    eduCap, healthCap, safetyCap,
    workforce, employed, unemployment, housingPressure,
    mods,
  };
}

// Approval is a smoothed stock driven toward a target from current conditions.
function approvalTarget(state, d) {
  const m = d.mods;
  let t = 50;
  // Housing
  t += d.housingPressure <= 1 ? 8 : -clamp((d.housingPressure - 1) * 30, 0, 30);
  // Jobs
  t -= d.unemployment * 45;
  // Utilities
  t += d.powerRatio >= 1 ? 6 : -clamp((1 - d.powerRatio) * 40, 0, 40);
  t += d.waterRatio >= 1 ? 6 : -clamp((1 - d.waterRatio) * 40, 0, 40);
  // Environment & services
  t -= clamp(state.pollution * 0.4, 0, 25);
  t += (state.health - 50) * 0.18;
  t += (state.education - 50) * 0.12;
  t += (state.safety - 50) * 0.16;
  // Amenities (parks, MRT, etc.) — scale by city size
  t += clamp(d.happinessLocal / Math.max(1, d.homes / 4000), 0, 14);
  // Policy approval
  t += m.approval;
  // Fiscal stress — deficits and heavy national debt are unpopular
  if (state.treasury < 0) t -= clamp(-state.treasury / 20, 0, 20);
  if (state.debt > 0) t -= clamp((state.debt / Math.max(1, debtCeiling(state))) * 12, 0, 12);
  return clamp(t, 0, 100);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function applyEffects(state, fx, d) {
  if (!fx) return;
  if (fx.treasury) state.treasury += fx.treasury;
  if (fx.approval) state.approval = clamp(state.approval + fx.approval, 0, 100);
  if (fx.pollutionSpike) state.pollution = clamp(state.pollution + fx.pollutionSpike, 0, 100);
  if (fx.healthShock) state.health = clamp(state.health + fx.healthShock, 0, 100);
  if (fx.unlock) state.unlocked[fx.unlock] = true;
  // growthShock / growth modifiers are temporary; store as a decaying buffer.
  if (fx.growthShock) state.growthBuf = (state.growthBuf || 0) + fx.growthShock;
  if (fx.growth) state.growthBuf = (state.growthBuf || 0) + fx.growth;
  if (fx.jobsBoost || fx.incomeMult) {
    state.perks = state.perks || { jobsBoost: 0, incomeMult: 0 };
    state.perks.jobsBoost += fx.jobsBoost || 0;
    state.perks.incomeMult += fx.incomeMult || 0;
  }
}

function checkHistorical(state) {
  for (const ev of HISTORICAL_EVENTS) {
    if (state.flags[ev.id]) continue;
    if (state.date.y > ev.y || (state.date.y === ev.y && state.date.m >= ev.m)) {
      state.flags[ev.id] = true;
      fireEvent(state, ev);
      return; // one per tick keeps it readable
    }
  }
}

function maybeRandomEvent(state) {
  if (state.pendingEvent) return;
  // ~ roughly one random event every ~14 months
  if (Math.random() > 1 / (14 * DAYS_IN_MONTH)) return;
  const pool = RANDOM_EVENTS.filter((e) => state.date.y >= (e.minYear || 0));
  if (!pool.length) return;
  const ev = pool[Math.floor(Math.random() * pool.length)];
  fireEvent(state, ev);
}

function fireEvent(state, ev) {
  const d = derive(state);
  applyEffects(state, ev.effects, d);
  logEvent(state, ev.title);
  if (ev.choice) {
    state.pendingEvent = { id: ev.id, title: ev.title, body: ev.body, choice: ev.choice };
  } else {
    state.lastEvent = { id: ev.id, title: ev.title, body: ev.body };
  }
}

export function resolveEvent(state, optionIndex) {
  const ev = state.pendingEvent;
  if (!ev) return;
  const opt = ev.choice.options[optionIndex];
  applyEffects(state, opt?.fx, derive(state));
  logEvent(state, `${ev.title}: ${opt?.label || 'decided'}`);
  state.pendingEvent = null;
}

function logEvent(state, text) {
  state.log.unshift({ d: { ...state.date }, text });
  if (state.log.length > 40) state.log.length = 40;
}

// ---------------------------------------------------------------------------
// Monthly economy + population update
// ---------------------------------------------------------------------------
function monthlyUpdate(state, d) {
  const m = d.mods;
  const perks = state.perks || { jobsBoost: 0, incomeMult: 0 };

  // --- Stocks move toward capacity-driven targets (per 10k pop saturates) ---
  const denom = Math.max(1, d.homes / 6000);
  const eduTarget = clamp(20 + (d.eduCap / denom) * m.eduMult, 0, 100);
  const healthTarget = clamp(25 + (d.healthCap / denom) * m.healthMult, 0, 100);
  const safetyTarget = clamp(25 + (d.safetyCap / denom), 0, 100);
  state.education = approach(state.education, eduTarget, 0.15);
  state.health = approach(state.health, healthTarget, 0.15);
  state.safety = approach(state.safety, safetyTarget, 0.15);

  // Pollution accumulates from sources, decays naturally + via green/MRT.
  const pollTarget = clamp(d.pollutionSrc * 1.2 * (1 + m.pollutionMult), 0, 100);
  state.pollution = clamp(approach(state.pollution, pollTarget, 0.2), 0, 100);

  // --- Finances ($ millions / month) ---
  const productivity = 1 + m.productivity + (state.education - 20) * 0.004;
  const popReal = state.population;
  // Income tax scales with employed workforce, productivity & policy multiplier.
  const taxBase = (d.employed / 1000) * 0.9 * productivity;
  const incomeTax = taxBase * m.taxMult;
  const gst = m.gstRevenue > 0 ? (popReal / 1000) * 0.25 : 0;
  const business = d.directIncome * (1 + m.incomeMult + perks.incomeMult);
  const grossIncome = incomeTax + gst + business;

  let upkeep = 0;
  for (const [k, n] of Object.entries(d.counts)) upkeep += (BUILDINGS[k].upkeep || 0) * n;
  upkeep += m.upkeep;                       // policy running costs
  upkeep += popReal * 0.00012;              // general public-service cost

  // Debt servicing — interest on outstanding government bonds.
  const interest = (state.debt || 0) * bondRate(state) / 12;
  upkeep += interest;

  const net = grossIncome - upkeep;
  state.treasury += net;
  state.lastFinance = {
    incomeTax, gst, business, grossIncome, upkeep, interest, net,
  };

  // --- Population dynamics ---
  // Birth/death
  const birthRate = 0.011 * m.birth * (0.7 + state.health / 200);
  const deathRate = 0.006 * (1.3 - state.health / 160);
  let dPop = popReal * (birthRate - deathRate) / 12; // monthly slice

  // Migration: attractiveness from jobs surplus, approval, housing room.
  const housingRoom = d.homes - popReal;
  const jobSurplus = d.jobs - d.employed;
  const attract = (state.approval - 50) * 0.02
    + (jobSurplus > 0 ? 0.04 : -0.08)
    + m.migration * 0.05;
  let migration = popReal * 0.004 * attract;
  // Can't grow into nonexistent homes; overcrowding pushes people out.
  if (housingRoom <= 0) migration = Math.min(migration, 0) - popReal * 0.003;
  else migration = Math.min(migration, housingRoom * 0.25);

  // Growth buffer (events/policies) decays over time.
  const growthMod = (state.growthBuf || 0) + m.growth;
  dPop += popReal * growthMod / 12;
  state.growthBuf = (state.growthBuf || 0) * 0.85;

  // Utility shortages cause real harm (health/emigration).
  if (d.powerRatio < 1) { dPop -= popReal * (1 - d.powerRatio) * 0.01; }
  if (d.waterRatio < 1) { dPop -= popReal * (1 - d.waterRatio) * 0.012; }

  state.population = Math.max(0, Math.round(popReal + dPop + migration));

  // Approval glides toward its target.
  state.approval = clamp(approach(state.approval, approvalTarget(state, d), 0.25), 0, 100);

  // Settle inflation / price level from this month's economic performance.
  updateEconomy(state, d);
}

// ---------------------------------------------------------------------------
// Main tick — advance one day. Returns derived stats for the UI.
// ---------------------------------------------------------------------------
export function tickDay(state) {
  state.date = addDay(state.date);
  state.daysElapsed = (state.daysElapsed || 0) + 1;
  advanceConstruction(state); // tick building sites toward completion
  advanceReclamation(state);  // tick land reclamation (sea rising into land)
  advanceRoadworks(state);    // tick drawn roads/railways toward completion

  const d = derive(state);

  // Smooth daily drift so meters visibly move between monthly settlements.
  state.approval = clamp(approach(state.approval, approvalTarget(state, d), 0.02), 0, 100);

  // Daily treasury trickle (1/30th of last month's net) for a live feel.
  if (state.lastFinance) state.treasury += state.lastFinance.net / DAYS_IN_MONTH;

  if (state.date.d === 1) {
    monthlyUpdate(state, derive(state));
    checkHistorical(state);
    maybeRandomEvent(state);
  }

  refreshSummary(state);
  return derive(state);
}

// Compact summary stored alongside the state for the server browse list.
export function refreshSummary(state) {
  state.summary = {
    year: state.date.y,
    population: state.population * POP_SCALE,
    approval: Math.round(state.approval),
    treasury: Math.round(state.treasury),
  };
}

// Convenience snapshot for the HUD.
export function snapshot(state) {
  const d = derive(state);
  return {
    date: state.date,
    dateStr: formatDate(state.date),
    treasury: state.treasury,
    population: state.population * POP_SCALE,
    approval: state.approval,
    education: state.education,
    health: state.health,
    safety: state.safety,
    pollution: state.pollution,
    derived: d,
    finance: state.lastFinance,
  };
}

export { STATE_VERSION };
