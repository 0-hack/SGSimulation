// Simulation engine: holds the game state and advances it day by day.
// Pure-ish logic (no DOM) so it can be unit-tested in Node as well.
import {
  BUILDINGS, POLICIES, START_DATE, GRID_SIZE, POP_SCALE,
  AFFAIRS, SANDBOX, FLEET_TIMELINE,
} from './data.js';
import { onLand, inReservoir, inRiver } from './shape.js';
import { ROADS_LIVE } from './roadsLive.js';

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
    // (SEED_1965 + the dense heritage town, all seeded into the grid by the 3D view
    // at their historical economic weight): its kampongs, shophouses and early HDB
    // estates house this many people, its port/factories/godowns/services employ
    // the workforce, and its power stations + water mains supply them. Deliberately
    // set so homes sit just BELOW the population — a mild housing shortage, the real
    // pressing problem of 1965 — and the labour force outnumbers the jobs the young
    // economy offers (~11% unemployment). The player grows the nation out of both.
    population: 51500,
    // Age structure. 1965 Singapore was a strikingly YOUNG society — a post-war baby
    // boom, few elderly — with a wide working-age base. Cohorts age over the decades:
    // births feed the young (family policy), migrants top up the working-age
    // (immigration policy), and the elderly grow as healthcare lengthens lives —
    // driving pension & healthcare costs (softened by CPF). The working cohort IS
    // the workforce, so an ageing nation faces a shrinking tax base.
    cohorts: { young: 18025, work: 31930, old: 1545 },   // 35% / 62% / 3% of 51,500

    approval: 58,
    education: 20,
    health: 25,
    safety: 30,
    pollution: 5,
    debt: 0,                  // outstanding government bonds ($M)
    grid,
    policies,
    flags: {},                // affairs already fired (once-guards)
    affairsAt: {},            // affair id -> month index it last fired (cooldowns)
    pathFlags: {},            // choices that branch the nation's path (e.g. 'aligned')
    unrest: 0.1,              // domestic unrest 0..1 — stoked by neglect & hard choices, drags approval, draws internal crises
    unlocked: {},             // buildings unlocked by choices
    log: [{ d: { ...START_DATE }, text: 'A young republic stands alone. The journey begins — and the path is yours to write.' }],
    pendingEvent: null,       // event awaiting player choice
    roads: { nodes: [], edges: [], islands: [] }, // player-drawn freeform road network
    reclaimed: [],            // [x,y] sea cells reclaimed into finished, buildable land
    reclaiming: [],           // { x,y,total,left } cells still rising from the sea (legacy per-cell)
    reclaimAreas: [],         // { poly:[[x,z]..], cells:[[x,y]..], total,left } free-shaped areas rising
    reclaimedAreas: [],       // { poly, cells } finished free-shaped reclaimed land (smooth coastline)
    economy: { inflation: 0.02, priceIndex: 1, currency: 1 }, // dynamic inflation / price level / SGD strength
    climate: { water: 1, heat: 0.3 },   // live weather → reservoir yield (water) & heat/aircon load, driven by the 3D scene
    threat: 0.5,   // external/regional danger (0 calm … 1 dire). 1965 opened tense — Konfrontasi, a hostile split from Malaysia, Britain leaving. Offset by military strength; shaped by the International Stance.
    constructing: [],         // [x,y] cells whose building is still being built
    demolishing: [],          // [x,y] cells whose building is being torn down (timed teardown)
    plants: [],               // individually-placed tropical plants: { x, z, kind, rot, s } in world coords
    surfaces: {},             // painted ground surfaces, sparse: "x,y" -> surface type (cosmetic only)
    removedTrees: {},         // ambient trees the player bulldozed, sparse: "x,y" -> 1 (so clearings persist)
    removedLandmarks: {},     // fixed landmarks the player demolished, sparse: id -> 1 (e.g. "airport")
    landmarks: [],            // 3D-designed landmarks saved into THIS world (per-player; for build menu + visitors)
    projects: [],             // active guided national projects the player is building toward
    projectsDone: [],         // ids of completed national projects
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
  const CELL = 1600 / GRID_SIZE; // world units per cell (matches scene3d's WORLD_SIZE/N)
  return { x: (x + 0.5 - GRID_SIZE / 2) * CELL, z: (GRID_SIZE / 2 - y - 0.5) * CELL, y: 0 };
}

// Recreate roughly how Singapore looked at independence: a small developed town
// in the south (the colonial city/port) with a sparse street grid, and a handful
// of kampongs dotted across an otherwise rural island. Players build out the rest.
// Inject the traced 1966 road network into a roads object: the full, smoothed,
// interconnected graph — nodes shared between edges so the streets connect at
// every junction. Single-lane streets carry an `oneway` flag (lanes: 1); dirt
// streets carry a `dirt` flag (the 5th edge field). `traced` marks them all for
// the slim, no-stop-line rendering. Seeded only once.
function injectTracedRoads(roads) {
  const base = roads.nodes.length;
  for (const [x, z] of ROADS_LIVE.nodes) roads.nodes.push({ x, z, y: 0 });
  for (const [a, b, ow, cls, dirt] of ROADS_LIVE.edges)
    roads.edges.push({
      a: a + base, b: b + base, ctrl: null,
      type: 'road', lanes: ow ? 1 : 2, elevated: false,
      oneway: !!ow, dirt: !!dirt, traced: true, roadClass: cls || 3,
    });
  roads.seeded1966 = true;
}

function seed1965(state) {
  // The real 1966 road network is the starting infrastructure — no colonial
  // street grid or town blocks, and no scattered seed kampongs (they obstructed
  // the roads). The map starts as the bare island + roads; the player builds.
  injectTracedRoads(state.roads);
}

// ---------------------------------------------------------------------------
// Save serialization — the grid is GRID_SIZE² cells but almost all are empty, so
// store it SPARSELY (just the filled cells). On a 640 grid the dense array would be
// ~2.7 MB of "null,"; sparse it is a few KB. Pack before saving, unpack on load.
// ---------------------------------------------------------------------------
export function packState(state) {
  if (!state || !Array.isArray(state.grid)) return state;
  const g = state.grid, cells = [];
  for (let y = 0; y < g.length; y++) { const row = g[y]; if (!row) continue; for (let x = 0; x < row.length; x++) if (row[x]) cells.push([x, y, row[x]]); }
  return { ...state, grid: { __sparse: true, w: (g[0] && g[0].length) || GRID_SIZE, h: g.length, cells } };
}
export function unpackState(state) {
  if (!state || !state.grid || !state.grid.__sparse) return state;
  const sp = state.grid, grid = Array.from({ length: sp.h }, () => Array(sp.w).fill(null));
  for (const [x, y, c] of (sp.cells || [])) if (y >= 0 && y < sp.h && x >= 0 && x < sp.w) grid[y][x] = c;
  state.grid = grid;
  return state;
}

// Bring a loaded save up to the current map size (e.g. older, smaller grids):
// re-centre the existing layout onto a fresh GRID_SIZE×GRID_SIZE grid.
export function ensureGrid(state) {
  if (!state) return state;
  unpackState(state); // expand a sparse-saved grid back to the dense 2D array
  if (typeof state.debt !== 'number') state.debt = 0;
  if (!state.climate) state.climate = { water: 1, heat: 0.3 };
  if (typeof state.threat !== 'number') state.threat = 0.5;
  if (typeof state.unrest !== 'number') state.unrest = 0.1;
  if (!state.affairsAt || typeof state.affairsAt !== 'object') state.affairsAt = {};
  if (!state.pathFlags || typeof state.pathFlags !== 'object') state.pathFlags = {};
  // Older saves stored population as one number — split it into age cohorts once.
  if (!state.cohorts) { const P = state.population || 0; state.cohorts = { young: Math.round(P * 0.30), work: Math.round(P * 0.63), old: Math.round(P * 0.07) }; }
  if (!state.roads) state.roads = { nodes: [], edges: [], islands: [] };
  if (!Array.isArray(state.reclaimed)) state.reclaimed = [];
  if (!Array.isArray(state.reclaiming)) state.reclaiming = [];
  if (!Array.isArray(state.reclaimAreas)) state.reclaimAreas = [];
  if (!Array.isArray(state.reclaimedAreas)) state.reclaimedAreas = [];
  if (!Array.isArray(state.landmarks)) state.landmarks = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.projectsDone)) state.projectsDone = [];
  if (!Array.isArray(state.roadworks)) state.roadworks = [];
  if (!Array.isArray(state.railways)) state.railways = [];
  if (!Array.isArray(state.airstrips)) state.airstrips = [];
  if (!Array.isArray(state.plants)) state.plants = [];
  if (!state.surfaces || typeof state.surfaces !== 'object') state.surfaces = {};
  if (!state.removedTrees || typeof state.removedTrees !== 'object') state.removedTrees = {};
  if (!state.removedLandmarks || typeof state.removedLandmarks !== 'object') state.removedLandmarks = {};
  if (!state.economy) state.economy = { inflation: 0.02, priceIndex: 1, currency: 1 };
  // Rebuild the active-construction & demolition lists from the grid (robust across saves).
  state.constructing = [];
  state.demolishing = [];
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    const c = state.grid?.[y]?.[x]; if (!c) continue;
    if (c.build && c.build.left > 0) state.constructing.push([x, y]);
    if (c.demolish && c.demolish.left > 0) state.demolishing.push([x, y]);
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
  if (SANDBOX) return true;              // test mode: every building buildable from the start
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

// (demolishDays is defined alongside buildDays below.)

// Queue a batch of demolitions, charging a small teardown fee per item. Buildings
// get cell.demolish={total,left} and stop counting in derive() immediately (they
// are being torn down); infra entries get entry.demolish={total,left}. The actual
// removal happens over time in advanceDemolition().
// items: [{kind:'building',x,y} | {kind:'road'|'rail'|'air', ref}]
export function queueDemolish(state, items) {
  state.demolishing = state.demolishing || [];
  let fee = 0;
  for (const it of (items || [])) {
    if (it.kind === 'building') {
      const c = state.grid?.[it.y]?.[it.x]; if (!c || c.demolish) continue;
      // A half-built site clears faster than a finished building (it's just a
      // frame and hoardings), but still not instantly.
      const days = c.build ? clamp(Math.round(demolishDays(BUILDINGS[c.k]) * 0.5), 4, 60) : demolishDays(BUILDINGS[c.k]);
      c.demolish = { total: days, left: days };
      state.demolishing.push([it.x, it.y]);
      fee += 2;
    } else if (it.ref && !it.ref.demolish) {
      it.ref.demolish = { total: 4, left: 4 };
      fee += 1;
    }
  }
  state.treasury -= fee;
  return fee;
}

// Advance every teardown by one day; remove what has finished. Buildings clear to
// an empty cell; infra entries are filtered out of their arrays. Sets a counter
// the view watches so it can rebuild the road/rail/runway meshes once on change.
function advanceDemolition(state) {
  if (state.demolishing && state.demolishing.length) {
    const still = [];
    for (const [x, y] of state.demolishing) {
      const c = state.grid?.[y]?.[x];
      if (!c || !c.demolish) continue;
      c.demolish.left -= 1;
      if (c.demolish.left <= 0) state.grid[y][x] = null; else still.push([x, y]);
    }
    state.demolishing = still;
  }
  let infraDone = false;
  const sweep = (arr) => {
    if (!arr || !arr.length) return arr;
    let any = false;
    for (const e of arr) if (e && e.demolish) { e.demolish.left -= 1; if (e.demolish.left <= 0) { e._demoDone = true; any = true; infraDone = true; } }
    return any ? arr.filter((e) => !(e && e._demoDone)) : arr;
  };
  if (state.roads) state.roads.edges = sweep(state.roads.edges);
  state.railways = sweep(state.railways);
  state.airstrips = sweep(state.airstrips);
  if (infraDone) state._infraDemoDone = (state._infraDemoDone || 0) + 1;
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
// How much imported materials/tech cost shifts with the local currency. A strong
// SGD (currency > 1) makes imports cheaper; a weak one makes them dearer. Gentle
// and clamped (±25%), and exactly 1.0 at the 1965 baseline so existing balance is
// unchanged until the economy actually moves the currency.
export function currencyCostFactor(state) {
  return clamp(1 / Math.sqrt(currencyStrength(state) || 1), 0.8, 1.25);
}
// Technology maturity: a building's base cost is its price the moment the world
// invents it (already era-appropriate). Early adopters pay that full price; as the
// years pass the design commoditises and materials get cheaper, so the SAME
// building costs progressively LESS in real terms — down to a ~30% discount once
// long-mature. (Inflation still lifts the NOMINAL price separately.) Returns a
// multiplier 1.0 (brand-new) → 0.7 (long-mature). 1.0 at every building's own
// invention year, so the balanced era-priced start is undisturbed.
export function techMaturityFactor(state, b) {
  if (!b || !b.year) return 1;
  const y = (state && state.date && state.date.y) || b.year;
  const age = Math.max(0, y - b.year);              // years since the world invented it
  return clamp(1 - age * 0.012, 0.7, 1);
}
// Current purchase cost of a building ($M) after inflation + technology maturity +
// currency strength (a stronger currency / cheaper imports ease the price).
export function buildingCost(state, key) {
  const b = BUILDINGS[key];
  if (!b) return 0;
  return Math.round(b.cost * priceIndex(state) * techMaturityFactor(state, b) * currencyCostFactor(state));
}

// Construction time in game-days. Real projects take real time: each building
// carries a realistic duration in months (data.js BUILD_MONTHS → b.buildMonths);
// a whole HDB estate is ~3.5 years, a power station or port several years, a hut
// a couple of months. Custom 3D landmarks (no buildMonths) fall back to a
// cost + complexity estimate. Nothing produces until it tops out.
export function buildDays(b) {
  if (!b) return 30;
  if (b.buildMonths) return Math.max(1, Math.round(b.buildMonths * DAYS_IN_MONTH));
  let months = 6 + Math.sqrt(b.cost || 1) * 1.6;               // designed-landmark estimate
  if (b.landmarkParts) months += b.landmarkParts.length * 1.0; // more parts → longer
  return clamp(Math.round(months * DAYS_IN_MONTH), 30, 60 * DAYS_IN_MONTH);
}
// How long a building takes to TEAR DOWN — much faster than building it (a wreck
// beats a build), but still weeks to a few months for a big structure, so the
// hoarding + wrecking crane read as a real job in progress. Capped at ~6 months.
export function demolishDays(b) { return clamp(Math.round(buildDays(b) * 0.12), 8, 6 * DAYS_IN_MONTH); }

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
    lanes: route.lanes || 2, elevated: !!route.elevated, mrt: !!route.mrt, tunnel: !!route.tunnel,
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

// ---------------------------------------------------------------------------
// Freehand road eraser. Demolishing roads is now a drag, not a whole-edge tap:
// the player drags a stroke along (or across) the tarmac and ONLY the portion
// under the brush is removed — any length, any sub-segment. We sample each road's
// polyline, find the runs within `radius` of the stroke, and split the edge at
// those run boundaries so the covered pieces become their own edges (which the
// caller queues for a timed teardown) while the rest of the road stays live.
// ---------------------------------------------------------------------------
// Min distance from a world point to a freehand stroke (polyline of {x,z}).
function _strokeDist(x, z, stroke) {
  if (stroke.length === 1) return Math.hypot(x - stroke[0].x, z - stroke[0].z);
  let d = Infinity;
  for (let i = 0; i < stroke.length - 1; i++) { const pr = _projSeg({ x, z }, stroke[i], stroke[i + 1]); if (pr.d < d) d = pr.d; }
  return d;
}
// Point at arc-length `s` along a polyline `line` (with prefix-sum `arc`).
function _ptAtArc(line, arc, s) {
  const total = arc[arc.length - 1];
  if (s <= 0) return { x: line[0].x, z: line[0].z };
  if (s >= total) return { x: line[line.length - 1].x, z: line[line.length - 1].z };
  for (let i = 0; i < line.length - 1; i++) {
    if (s <= arc[i + 1]) { const t = (s - arc[i]) / Math.max(1e-6, arc[i + 1] - arc[i]); return { x: line[i].x + (line[i + 1].x - line[i].x) * t, z: line[i].z + (line[i + 1].z - line[i].z) * t }; }
  }
  return { x: line[line.length - 1].x, z: line[line.length - 1].z };
}
// Sub-polyline of `line` between arc lengths s0..s1 (keeps interior vertices).
function _sliceLine(line, arc, s0, s1) {
  const out = [_ptAtArc(line, arc, s0)];
  for (let i = 0; i < line.length; i++) if (arc[i] > s0 + 1e-6 && arc[i] < s1 - 1e-6) out.push({ x: line[i].x, z: line[i].z });
  out.push(_ptAtArc(line, arc, s1));
  return out;
}
// Walk a road polyline and split it into alternating covered / uncovered runs
// (a run = { s0, s1, cov }) by sampling the distance to the stroke every ~1 unit.
function _coverRuns(line, stroke, radius) {
  const arc = [0]; for (let i = 1; i < line.length; i++) arc.push(arc[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
  const total = arc[arc.length - 1];
  if (total < 1e-3) return { arc, total, runs: [] };
  const nS = Math.max(3, Math.ceil(total) + 1);
  const flags = [];
  for (let k = 0; k < nS; k++) { const p = _ptAtArc(line, arc, total * k / (nS - 1)); flags.push(_strokeDist(p.x, p.z, stroke) <= radius); }
  const bounds = [0], cov = [flags[0]];
  for (let k = 1; k < nS; k++) if (flags[k] !== flags[k - 1]) { bounds.push(total * (k - 0.5) / (nS - 1)); cov.push(flags[k]); }
  bounds.push(total);
  const runs = []; for (let i = 0; i < cov.length; i++) runs.push({ s0: bounds[i], s1: bounds[i + 1], cov: cov[i] });
  return { arc, total, runs };
}
// PREVIEW only: the covered road sub-polylines (no mutation) for the red highlight.
export function roadEraseCover(roads, stroke, radius = 4) {
  const out = [];
  if (!roads || !roads.edges || !stroke || !stroke.length) return out;
  const S = stroke.length >= 2 ? stroke : [stroke[0], { x: stroke[0].x + 0.01, z: stroke[0].z + 0.01 }];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of S) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  minX -= radius + 4; minZ -= radius + 4; maxX += radius + 4; maxZ += radius + 4;
  for (const e of roads.edges) {
    if (!e || e.demolish) continue;
    const line = _edgeLine(roads, e); if (line.length < 2) continue;
    let exmin = Infinity, exmax = -Infinity, ezmin = Infinity, ezmax = -Infinity;
    for (const p of line) { exmin = Math.min(exmin, p.x); exmax = Math.max(exmax, p.x); ezmin = Math.min(ezmin, p.z); ezmax = Math.max(ezmax, p.z); }
    if (exmax < minX || exmin > maxX || ezmax < minZ || ezmin > maxZ) continue;
    const { arc, runs } = _coverRuns(line, S, radius);
    for (const r of runs) if (r.cov) out.push(_sliceLine(line, arc, r.s0, r.s1));
  }
  return out;
}
// COMMIT: split every road the stroke covers and return the covered pieces (now
// live edges in roads.edges) so the caller can queue them for a timed teardown.
export function eraseRoadsAlong(roads, stroke, radius = 4) {
  if (!roads || !roads.edges || !stroke || !stroke.length) return [];
  const S = stroke.length >= 2 ? stroke : [stroke[0], { x: stroke[0].x + 0.01, z: stroke[0].z + 0.01 }];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of S) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  minX -= radius + 4; minZ -= radius + 4; maxX += radius + 4; maxZ += radius + 4;
  const nodes = roads.nodes;
  const nodeAt = (x, z) => { for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (Math.hypot(n.x - x, n.z - z) < 1.0) return i; } nodes.push({ x, z, y: 0 }); return nodes.length - 1; };
  const newEdges = [], cut = [];
  for (const e of roads.edges) {
    if (!e || e.demolish) { newEdges.push(e); continue; }
    const line = _edgeLine(roads, e); if (line.length < 2) { newEdges.push(e); continue; }
    let exmin = Infinity, exmax = -Infinity, ezmin = Infinity, ezmax = -Infinity;
    for (const p of line) { exmin = Math.min(exmin, p.x); exmax = Math.max(exmax, p.x); ezmin = Math.min(ezmin, p.z); ezmax = Math.max(ezmax, p.z); }
    if (exmax < minX || exmin > maxX || ezmax < minZ || ezmin > maxZ) { newEdges.push(e); continue; }
    const { arc, total, runs } = _coverRuns(line, S, radius);
    if (!runs.some((r) => r.cov)) { newEdges.push(e); continue; }     // stroke missed this road
    const straight = !(e.poly && e.poly.length >= 2) && !e.ctrl;
    const A = roads.nodes[e.a], B = roads.nodes[e.b];
    const stops = [{ x: A.x, z: A.z, node: e.a }];
    for (let i = 1; i < runs.length; i++) { const p = _ptAtArc(line, arc, runs[i].s0); stops.push({ x: p.x, z: p.z, node: nodeAt(p.x, p.z) }); }
    stops.push({ x: B.x, z: B.z, node: e.b });
    for (let i = 0; i < runs.length; i++) {
      const s = stops[i], t = stops[i + 1]; if (s.node === t.node) continue;   // degenerate sliver
      const piece = { a: s.node, b: t.node, ctrl: null, type: e.type, lanes: e.lanes, elevated: e.elevated };
      if (e.traced) piece.traced = true; if (e.oneway) piece.oneway = e.oneway; if (e.roadClass != null) piece.roadClass = e.roadClass;
      if (!straight) piece.poly = _sliceLine(line, arc, runs[i].s0, runs[i].s1);
      newEdges.push(piece);
      if (runs[i].cov) cut.push(piece);
    }
  }
  roads.edges = newEdges;
  return cut;
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
      (state.railways || (state.railways = [])).push({ pts: w.pts.map((p) => [p.x, p.z]), elevated: !!w.elevated, mrt: !!w.mrt });
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
  if (SANDBOX) return 0;                 // test mode: unlimited, interest-free borrowing
  const ceil = debtCeiling(state);
  const util = ceil > 0 ? Math.min(1, (state.debt || 0) / ceil) : 1;
  // Fisher: nominal yield ≈ real rate + inflation + credit-risk premium.
  return 0.02 + Math.max(0, inflationRate(state)) + util * 0.06; // ~4% .. ~12%
}
// How much the government can owe — scales with the economy (annual revenue) & population.
export function debtCeiling(state) {
  if (SANDBOX) return 1e9;               // test mode: effectively unlimited bond issuance
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
    cpfRetire: 0,   // share of elderly support self-funded through CPF (vs borne by the treasury)
    threatMod: 0,   // international stance's effect on external threat (diplomacy lowers it)
    defenceMod: 0,  // multiplier on military strength (National Service, defence budget, posture)
    safetyMod: 0,   // law-and-order policies' effect on the safety stock
  };
  const add = (fx) => {
    if (!fx) return;
    for (const [k, v] of Object.entries(fx)) {
      if (k in m) m[k] += v;
    }
  };
  // The player may enact ANY policy at any time — nothing is time-locked. What a
  // policy DELIVERS, though, depends on the nation's condition (see the economy &
  // population update), so a law passed before its moment simply underperforms.
  for (const [key, p] of Object.entries(POLICIES)) {
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
// Water sources that depend on rainfall (so a drought shrinks their yield). Firm
// sources — desalination, NEWater, piped mains/standpipes — are weather-proof.
const RAIN_WATER = new Set(['reservoir', 'reservoir_big']);

// Fossil-fuelled generation burns IMPORTED fuel (oil, then gas), so it adds to the
// national import bill; clean sources (solar, nuclear) don't. The player can cut the
// bill — and exposure to oil shocks — by going clean.
const FOSSIL_POWER = new Set(['diesel', 'power_station', 'gas_power', 'waste_energy']);

// ---------------------------------------------------------------------------
// Neighbourhood coverage — where you build finally MATTERS. The map is bucketed
// into coarse ~16-cell districts. Every service building (schools, clinics, parks,
// the MRT, markets, community centres…) broadcasts AMENITY over a soft disk around
// it, and every heavy polluter (factories, power stations, the port…) broadcasts
// BLIGHT. Each home samples its own district: living near schools, parks and
// transit is good; living in a factory's shadow is not. Returns population-weighted
// `serviceAccess` (0–1: are people's needs within reach) and `blight` (0–1: how
// many live under industrial nuisance). Cheap: one stamp per emitter + one sample
// per home, no extra full-grid rescan.
const COARSE = 16;
function neighbourhoodCoverage(emitters, receivers) {
  if (!receivers.length) return { serviceAccess: 0.55, blight: 0 };
  const N = Math.ceil(GRID_SIZE / COARSE);
  const amen = new Float32Array(N * N), nuis = new Float32Array(N * N);
  for (const e of emitters) {
    const cx = (e.x / COARSE) | 0, cy = (e.y / COARSE) | 0;
    const Ra = e.amen > 0 ? 3 : 0, Rn = e.nuis > 0 ? 4 : 0, R = Math.max(Ra, Rn);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const gx = cx + ox, gy = cy + oy; if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
      const d = Math.hypot(ox, oy), id = gy * N + gx;
      if (e.amen > 0 && d <= Ra) amen[id] += e.amen * (1 - d / (Ra + 1));   // fades with distance
      if (e.nuis > 0 && d <= Rn) nuis[id] += e.nuis * (1 - d / (Rn + 1));
    }
  }
  let sa = 0, bl = 0, hw = 0;
  for (const r of receivers) {
    const id = (((r.y / COARSE) | 0) * N) + ((r.x / COARSE) | 0);
    sa += r.homes * Math.min(1, amen[id] / 11);   // ~11 of nearby amenity reads as "well served"
    bl += r.homes * Math.min(1, nuis[id] / 16);
    hw += r.homes;
  }
  return { serviceAccess: hw ? sa / hw : 0.55, blight: hw ? bl / hw : 0 };
}

export function derive(state) {
  let homes = 0, jobs = 0, food = 0, powerGen = 0, powerUse = 0, waterGen = 0, waterUse = 0, waterGenRain = 0, fossilGen = 0;
  let pollutionSrc = 0, happinessLocal = 0, directIncome = 0, bUpkeep = 0;
  let eduCap = 0, healthCap = 0, safetyCap = 0, defenceCap = 0;
  let counts = {};
  const emitters = [], receivers = [];   // for the neighbourhood-coverage pass below

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const cell = state.grid[y]?.[x];
      if (!cell) continue;
      const b = BUILDINGS[cell.k];
      if (!b) continue;
      if (cell.build && cell.build.left > 0) continue; // still under construction — no output yet
      if (cell.demolish) continue;                     // being torn down — no longer functioning
      // Economic weight: a standing 1965 heritage building counts as the small,
      // fractional structure it is (cell.w); everything the player builds is w=1.
      const w = cell.w || 1;
      counts[cell.k] = (counts[cell.k] || 0) + 1;
      // Neighbourhood roles: homes RECEIVE coverage; service/industry buildings
      // EMIT amenity (from their happiness) or blight (from their pollution).
      if ((b.homes || 0) > 0) receivers.push({ x, y, homes: (b.homes || 0) * w });
      else { const am = Math.max(0, b.happiness || 0) * w, nu = Math.max(0, b.pollution || 0) * w; if (am > 0 || nu > 0) emitters.push({ x, y, amen: am, nuis: nu }); }
      homes += (b.homes || 0) * w;
      food += (b.food || 0) * w;
      jobs += (b.jobs || 0) * w;
      if (b.power > 0) { powerGen += b.power * w; if (FOSSIL_POWER.has(cell.k)) fossilGen += b.power * w; } else powerUse += -b.power * w;
      if (b.water > 0) { if (RAIN_WATER.has(cell.k)) waterGenRain += b.water * w; else waterGen += b.water * w; } else waterUse += -b.water * w;
      pollutionSrc += (b.pollution || 0) * w;
      happinessLocal += (b.happiness || 0) * w;
      directIncome += (b.income || 0) * w;
      eduCap += (b.education || 0) * w;
      healthCap += (b.health || 0) * w;
      safetyCap += (b.safety || 0) * w;
      defenceCap += (b.defence || 0) * w;
      bUpkeep += (b.upkeep || 0) * w;
    }
  }

  const cov = neighbourhoodCoverage(emitters, receivers);   // where people live vs where the services & nuisance are

  const mods = policyMods(state);
  const pop = state.population;
  const climate = state.climate || { water: 1, heat: 0 };

  // Residents consume extra power & water on top of building loads. In a HEATWAVE
  // (climate.heat) fans and, later, air-conditioning push electricity demand up.
  powerUse += pop * 0.0009;
  powerUse *= 1 + (climate.heat || 0) * 0.12;
  // Rain-fed supply — the Central Catchment reservoirs (MacRitchie/Peirce/Seletar)
  // and any dammed reservoirs — rises and falls with the weather: a drought
  // (climate.water < 1) shrinks the yield, a wet spell tops it up. Desalination,
  // NEWater and piped mains are weather-proof (firm), so they aren't scaled.
  waterGen += (waterGenRain + 45) * (climate.water == null ? 1 : climate.water);
  waterUse += pop * 0.0016 * (1 + mods.waterDemandMult);

  const mods_jobs = jobs * (1 + mods.jobsBoost);
  const powerRatio = powerUse > 0 ? powerGen / powerUse : 2;
  const waterRatio = waterUse > 0 ? waterGen / waterUse : 2;

  // The workforce IS the working-age cohort (15–64), so an ageing society has fewer
  // taxpayers per head. Falls back to 62% of the population for older saves.
  const co = state.cohorts || { young: pop * 0.32, work: pop * 0.62, old: pop * 0.06 };
  const workforce = co.work;
  const employed = Math.min(workforce, mods_jobs);
  const unemployment = workforce > 0 ? clamp((workforce - employed) / workforce, 0, 1) : 0;
  // Old-age dependency: non-working (young + elderly) supported per working adult.
  const dependency = workforce > 0 ? (co.young + co.old) / workforce : 0;

  // DEFENCE — military strength from camps, bases and the arms industry, multiplied
  // by National Service, the defence budget and posture (mods.defenceMod), and by
  // home-grown innovation (each defence R&D lab sharpens the whole force). It stands
  // against the external THREAT: a bigger, richer nation is a bigger prize, so it
  // needs more of it. Security ≥ 1 means the nation can hold its own.
  const labInnov = Math.min(0.6, (counts.defence_lab || 0) * 0.09);
  // The British garrison shielded the island at independence and drew down to nothing
  // by the 1971 "East of Suez" withdrawal — so the early nation is protected while it
  // races to raise its own forces, and the security crisis lands exactly when they leave.
  const britShield = clamp((1971 - state.date.y) / 6, 0, 1) * 42;
  const defence = defenceCap * (1 + mods.defenceMod) * (1 + labInnov) + britShield;
  const threat = state.threat == null ? 0.5 : state.threat;
  const defenceNeed = threat * (26 + pop / 2200 + mods_jobs / 2600);   // scales with the size of the prize
  const security = clamp(defence / Math.max(1, defenceNeed), 0, 2);
  const insecurity = clamp(1 - security, 0, 1);

  // Housing pressure: >1 means overcrowded.
  const housingPressure = homes > 0 ? pop / homes : (pop > 0 ? 3 : 0);

  // DOMESTIC INCIDENT RISK — the odds that daily life goes wrong, driven by the very
  // conditions that breed trouble: joblessness and thin policing feed crime;
  // overcrowding, dirty air and weak healthcare feed disease; heavy industry with
  // poor safety feeds accidents. Managing the nation well keeps these rare.
  const saf = (state.safety == null ? 30 : state.safety) / 100;
  const hea = (state.health == null ? 30 : state.health) / 100;
  const overcrowd = Math.max(0, housingPressure - 1);
  const industryI = clamp(pollutionSrc / 45, 0, 1);
  const crimeRisk = clamp(0.30 * unemployment + 0.34 * (1 - saf) + 0.16 * cov.blight, 0, 1);
  const diseaseRisk = clamp(0.34 * (1 - hea) + 0.28 * overcrowd + 0.20 * ((state.pollution || 0) / 100), 0, 1);
  const accidentRisk = clamp(0.30 * industryI + 0.26 * (1 - saf) + 0.12 * cov.blight, 0, 1);

  // Food self-sufficiency: locally-grown food vs the population it can feed. Most
  // food is imported (so low is normal/historical), but farms lift it — a modest
  // resilience + happiness win, in the spirit of the "30 by 30" goal.
  const foodNeed = Math.max(1, pop);
  const foodSelf = clamp(food / foodNeed, 0, 1.5);

  // IMPORT BILL — a resource-poor island buys most of what it eats, burns and uses.
  // Food it doesn't grow, fuel for its fossil power stations, and general materials
  // all come from abroad, so the bill scales DOWN with self-sufficiency (farms, clean
  // energy) and UP when the currency is weak (imports priced in stronger money) or an
  // oil shock strikes (state.fuelShock). Exposed exactly where the real Singapore was.
  const cur = (state.economy && state.economy.currency) || 1;
  const currencyFactor = clamp(2 - cur, 0.6, 1.7);         // weak SGD → dearer imports
  const foodImport = (1 - clamp(foodSelf, 0, 1)) * (pop / 1000) * 0.42;
  const energyImport = fossilGen * 0.02 * (1 + (state.fuelShock || 0));
  const materialsImport = (pop / 1000) * 0.34;
  const importBill = (foodImport + energyImport + materialsImport) * currencyFactor;

  // TRAFFIC CONGESTION — the daily commute. Car use grows with the population and its
  // wealth (motorisation), reined in by the car-quota / ERP policy; MRT and rail
  // stations carry commuters off the roads. Gridlock wastes working hours (productivity),
  // chokes the air and infuriates commuters — Singapore's answer was the world's first
  // road-pricing scheme AND a world-class metro.
  const carQuota = !!(state.policies && state.policies.car_quota);
  const motorDemand = (pop / 1000) * (0.6 + (state.education || 20) / 130) * (carQuota ? 0.78 : 1);
  const transitCap = (counts.mrt || 0) * 35 + (counts.rail_station || 0) * 16;
  const congestion = clamp((motorDemand - transitCap) / 300, 0, 1);

  return {
    homes, jobs: mods_jobs, baseJobs: jobs, counts,
    food, foodNeed, foodSelf,
    powerGen, powerUse, powerRatio, fossilGen,
    waterGen, waterUse, waterRatio,
    pollutionSrc, happinessLocal, directIncome, bUpkeep,
    eduCap, healthCap, safetyCap,
    workforce, employed, unemployment, housingPressure,
    serviceAccess: cov.serviceAccess, blight: cov.blight,
    young: co.young, working: co.work, elderly: co.old, dependency,
    defenceCap, defence, threat, defenceNeed, security, insecurity,
    crimeRisk, diseaseRisk, accidentRisk,
    importBill, foodImport, energyImport, materialsImport,
    congestion,
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
  // An ageing, dependency-heavy society strains services and stokes anxiety about
  // pensions and care (eased by immigration keeping the workforce young).
  t -= clamp(((d.dependency || 0.6) - 0.62) * 14, 0, 10);
  // Security: a nation that cannot defend itself against a real external threat is a
  // frightened one; a strong, secure defence reassures (up to a point).
  t -= (d.insecurity || 0) * 14;
  t += clamp(((d.security || 0) - 1) * 4, 0, 4);
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
  // WHERE people live matters: good local access to schools, clinics, parks and
  // transit lifts approval; living in the shadow of heavy industry drags it down.
  t += (d.serviceAccess - 0.5) * 12;      // well-served neighbourhoods (+6) vs service deserts (−6)
  t -= (d.blight || 0) * 12;              // homes packed against factories/power stations
  t -= (d.congestion || 0) * 8;           // a soul-crushing daily commute sours the mood
  // Home-grown food is a modest resilience/pride boost (no penalty for importing)
  t += clamp(d.foodSelf || 0, 0, 1) * 4;
  // Domestic unrest — strikes, scandals, communal friction left to fester sour
  // the national mood until they are answered.
  t -= (state.unrest || 0) * 18;
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
  if (fx.threatSpike) state.threatBuf = (state.threatBuf || 0) + fx.threatSpike;  // an event ratchets external tension up (decays over months)
  if (fx.fuelShock) state.fuelShock = (state.fuelShock || 0) + fx.fuelShock;       // an oil shock swells the energy import bill (decays)
  if (fx.unlock) state.unlocked[fx.unlock] = true;
  // growthShock / growth modifiers are temporary; store as a decaying buffer.
  if (fx.growthShock) state.growthBuf = (state.growthBuf || 0) + fx.growthShock;
  if (fx.growth) state.growthBuf = (state.growthBuf || 0) + fx.growth;
  if (fx.jobsBoost || fx.incomeMult) {
    state.perks = state.perks || { jobsBoost: 0, incomeMult: 0 };
    state.perks.jobsBoost += fx.jobsBoost || 0;
    state.perks.incomeMult += fx.incomeMult || 0;
  }
  if (fx.unlockMany) for (const k of fx.unlockMany) state.unlocked[k] = true;
  if (fx.unrest) state.unrest = clamp((state.unrest || 0) + fx.unrest, 0, 1); // hard choices & neglect stoke (or calm) the streets
  if (fx.flag) (state.pathFlags || (state.pathFlags = {}))[fx.flag] = true;    // record a branch in the nation's path
  if (fx.spawn) spawnDevelopment(state, fx.spawn); // a decision the government builds itself (e.g. an emergency hospital)
  if (fx.project) startProject(state, fx.project, d); // a decision the PLAYER is guided to build
}

// ---------------------------------------------------------------------------
// Guided national projects — instead of teleporting buildings in, a decision can
// UNLOCK the needed building types and set a tracked build task ("build 3 MRT
// stations + 2 viaducts"). The player builds them (so they cost money and feed the
// economy like anything else); finishing the checklist pays a national reward.
// ---------------------------------------------------------------------------
function startProject(state, p, d) {
  if (!p || !p.id) return;
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.projectsDone)) state.projectsDone = [];
  if (state.projects.some((x) => x.id === p.id) || state.projectsDone.includes(p.id)) return;
  const dd = d || derive(state);
  const base = {};
  for (const n of (p.need || [])) { state.unlocked[n.key] = true; base[n.key] = (dd.counts && dd.counts[n.key]) || 0; }
  state.projects.push({
    id: p.id, title: p.title, hint: p.hint || '',
    need: (p.need || []).map((n) => ({ key: n.key, count: n.count })),
    base, reward: p.reward || null,
  });
}
// Per-project progress for the UI: how many of each required building are built
// SINCE the project began (so pre-existing buildings don't auto-complete it).
export function projectProgress(state, d) {
  if (!state || !Array.isArray(state.projects)) return [];
  const dd = d || derive(state);
  return state.projects.map((pr) => {
    const items = pr.need.map((n) => {
      const have = Math.max(0, ((dd.counts[n.key] || 0) - (pr.base[n.key] || 0)));
      return { key: n.key, have: Math.min(have, n.count), count: n.count };
    });
    return { id: pr.id, title: pr.title, hint: pr.hint, items, done: items.every((it) => it.have >= it.count) };
  });
}
// Complete any project whose checklist is met: pay the reward, log it, retire it.
function updateProjects(state, d) {
  if (!state.projects || !state.projects.length) return;
  const prog = projectProgress(state, d);
  const done = new Set(prog.filter((p) => p.done).map((p) => p.id));
  if (!done.size) return;
  const still = [];
  for (const pr of state.projects) {
    if (done.has(pr.id)) {
      (state.projectsDone || (state.projectsDone = [])).push(pr.id);
      if (pr.reward) applyEffects(state, pr.reward, d);
      state.lastProjectDone = pr.title;
      (state.justCompleted || (state.justCompleted = [])).push(pr.title); // for the UI to celebrate
      logEvent(state, `🏗️ National project complete — ${pr.title}`,
        `The nation delivered on ${pr.title}. ${summarizeFx(pr.reward) || 'A milestone for the young state.'}`,
        'project');
    } else still.push(pr);
  }
  state.projects = still;
}
// Re-check projects immediately (called by the UI right after the player builds).
export function checkProjects(state) { updateProjects(state, derive(state)); return state.lastProjectDone; }

// Drop a government development onto the map when the player accepts a proposal
// (e.g. converting the British bases into the Jurong industrial estate). Each item
// { key, cx, cy } lands on the nearest free land cell and rises as a construction
// site, so the decision is VISIBLE and feeds the economy (jobs/income) once built.
function spawnDevelopment(state, list) {
  if (!Array.isArray(state.constructing)) state.constructing = [];
  state.govBuilt = state.govBuilt || []; // cells added by events (so the view can pick them up)
  for (const s of (list || [])) {
    const b = BUILDINGS[s.key]; if (!b) continue;
    const gx0 = Math.round((s.cx ?? 0.5) * GRID_SIZE), gy0 = Math.round((s.cy ?? 0.5) * GRID_SIZE);
    const cell = nearestBuildableCell(state, gx0, gy0, 18); if (!cell) continue;
    const days = buildDays(b);
    state.grid[cell.y][cell.x] = { k: s.key, gov: true, build: { total: days, left: days } };
    state.constructing.push([cell.x, cell.y]);
    state.govBuilt.push([cell.x, cell.y]);
  }
}
// Nearest empty Singapore-land grid cell to (gx,gy) within `rad` (ring search).
function nearestBuildableCell(state, gx, gy, rad) {
  for (let d = 0; d <= rad; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
    if (d > 0 && Math.max(Math.abs(ox), Math.abs(oy)) !== d) continue;
    const x = gx + ox, y = gy + oy;
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue;
    if (!state.grid[y][x] && isLandCell(x, y)) return { x, y };
  }
  return null;
}

// A month index for cooldown bookkeeping (monotonic across years).
function monthIndex(date) { return date.y * 12 + date.m; }

// How eligible an affair is right now: 0 = cannot fire, >0 = pick-weight.
// Gates on era window, once/cooldown, and the affair's own `when(state,d)`
// condition (which can also SCALE the weight so crises that fit the nation's
// current condition are the ones most likely to surface).
function affairWeight(state, d, a, mi) {
  if (a.atStart) return 0;                                     // founding briefing is fired separately
  if (a.minYear && state.date.y < a.minYear) return 0;
  if (a.maxYear && state.date.y > a.maxYear) return 0;
  if (a.once && state.flags[a.id]) return 0;
  const at = state.affairsAt || (state.affairsAt = {});
  if (a.cooldownMonths && at[a.id] != null && (mi - at[a.id]) < a.cooldownMonths) return 0;
  let w = a.weight != null ? a.weight : 1;
  if (a.when) { const r = a.when(state, d); if (!r) return 0; if (typeof r === 'number') w *= r; }
  return w > 0 ? w : 0;
}

// Emergent affairs of state — foreign & internal news the PM must answer. No
// fixed real-history replay: the founding briefing opens the game, then crises
// surface from the nation's OWN condition (threat, unrest, joblessness, housing)
// plus chance, and the player's choices push that condition — so the timeline
// branches into each player's own path.
function maybeAffair(state) {
  if (state.pendingEvent) return;
  // The founding briefing fires first, once. (No derive needed for the gate below —
  // it reads cheap scalar stocks — so we only pay for a full derive once an affair
  // actually clears the probability check and needs its state-weighting.)
  if (!state.flags.founding) {
    const f = AFFAIRS.find((a) => a.atStart);
    if (f) { fireEvent(state, f); return; }
  }
  // Monthly chance rises with external tension and domestic unrest, so a shaky,
  // threatened nation faces more decisions to steer through — capped so even a
  // nation in crisis isn't interrupted every single month.
  const pressure = clamp(1 + (state.threat || 0) * 0.8 + (state.unrest || 0) * 1.2, 1, 2.2);
  if (Math.random() > (1 / 13) * pressure) return;
  const d = derive(state);
  const mi = monthIndex(state.date);
  let total = 0; const pool = [];
  for (const a of AFFAIRS) { const w = affairWeight(state, d, a, mi); if (w > 0) { pool.push([a, w]); total += w; } }
  if (total <= 0) return;
  let r = Math.random() * total, pick = pool[0][0];
  for (const [a, w] of pool) { r -= w; if (r <= 0) { pick = a; break; } }
  fireEvent(state, pick);
}

// ---------------------------------------------------------------------------
// Daily life — the living texture of the nation reported to the News panel.
// These carry NO gameplay effect: they are colour, drawn from the CURRENT
// conditions on the ground (jobs, homes, health, schools, air, traffic, food,
// water, power, prices), so the player reads how ordinary life is going and WHY.
// Each item is { w: weight by condition, head, detail }. One may surface a
// month; a well-run nation hears cheer, a strained one hears grumbles.
// ---------------------------------------------------------------------------
function dailyLifePool(state, d) {
  const cur = (state.economy && state.economy.currency) || 1;
  const pool = [
    // — good news, when conditions are good —
    { w: d.unemployment < 0.05 ? 2.5 : 0.2, head: '💼 Hiring signs go up across the estates',
      detail: `Jobs are plentiful — unemployment is just ${Math.round(d.unemployment * 100)}%. Factories and offices are competing for hands, and pay packets are fattening.` },
    { w: state.education > 60 ? 2 : 0.2, head: '🎓 A new cohort graduates',
      detail: 'Schools and institutes turn out another wave of skilled young workers. Employers are already circling the top of the class.' },
    { w: (d.foodSelf || 0) > 0.4 ? 1.8 : 0.1, head: '🥬 Markets brim with home-grown produce',
      detail: `Local farms now feed a good share of the island (${Math.round((d.foodSelf || 0) * 100)}% self-sufficient). Fresh greens, eggs and fish keep the wet markets cheap and lively.` },
    { w: state.pollution < 18 && (d.happinessLocal || 0) > 0 ? 1.6 : 0.1, head: '🌳 Clean air and green corners lift the mood',
      detail: 'Parks fill on the weekend, the skies are clear, and the "garden city" is starting to feel like more than a slogan.' },
    { w: d.homes > state.population * 1.05 ? 1.6 : 0.1, head: '🔑 New flats, new keys',
      detail: 'Families collect the keys to bright new homes and leave the crowded old quarters behind. Housing is finally keeping ahead of the queue.' },
    { w: state.safety > 70 ? 1.4 : 0.1, head: '👮 Streets feel safe after dark',
      detail: 'Petty crime is low and the beat officers are a familiar sight. Shops stay open late and parents let the children roam.' },
    // — grumbles, when conditions bite —
    { w: (d.congestion || 0) > 0.35 ? 2.2 : 0.1, head: '🚗 Rush hour crawls to a standstill',
      detail: `The roads are choking — congestion is at ${Math.round((d.congestion || 0) * 100)}%. Commuters lose hours in jams; buses, an MRT line or a Car Quota would clear the arteries.` },
    { w: d.unemployment > 0.12 ? 2.4 : 0.1, head: '💢 Coffee-shop talk turns to jobs',
      detail: `Work is scarce — unemployment is ${Math.round(d.unemployment * 100)}%. Young men loiter, tempers fray, and families tighten their belts. More factories, offices and trade would help.` },
    { w: (d.housingPressure || 0) > 1.05 ? 2.2 : 0.1, head: '🏚️ Three families to a flat',
      detail: 'Homes are overcrowded and the waiting list keeps growing. Build more housing before the squeeze turns to real anger.' },
    { w: state.pollution > 35 ? 2 : 0.1, head: '🏭 A pall of smoke over the districts',
      detail: `The air is heavy (pollution ${Math.round(state.pollution)}%). Washing greys on the line and clinics see more coughs. Green space, cleaner power and the MRT would clear it.` },
    { w: d.waterRatio < 1 ? 2.2 : 0.05, head: '🚰 Taps run dry in the afternoon',
      detail: 'Water demand outstrips supply and rationing bites. Reservoirs, water mains or desalination are needed before the wells run low.' },
    { w: d.powerRatio < 1 ? 2.2 : 0.05, head: '💡 Blackouts flicker through the estates',
      detail: 'Generation can\'t meet demand and the lights dim at peak hours. More power stations would end the brownouts.' },
    { w: (state.economy && state.economy.inflation > 0.06) ? 1.8 : 0.1, head: '🧾 The cost of living pinches',
      detail: `Prices are climbing (inflation ${Math.round((state.economy?.inflation || 0) * 100)}%). Hawker plates and market baskets cost more; a stronger treasury and currency would steady them.` },
    { w: cur < 0.85 ? 1.4 : 0.1, head: '💱 A weak dollar makes imports dear',
      detail: 'The currency is soft, so imported fuel, food and machinery cost more. Reserves, exports and sound money would firm it up.' },
    // — evergreen flavour (always a little chance) —
    { w: 0.5, head: '🏮 Festivals colour the calendar',
      detail: 'Lion dances, Hari Raya open houses, Deepavali lights and Christmas markets roll through the year — the everyday multicultural life of the island.' },
    { w: 0.5, head: '🍜 The hawker centre hums at supper',
      detail: 'Char kway teow, satay and kopi draw the evening crowd. Whatever the headlines, the queue for supper never gets shorter.' },
  ];
  return pool;
}
function maybeDailyLife(state) {
  if (state.pendingEvent) return;                 // don't clutter over a decision briefing
  if (Math.random() > 0.34) return;               // ~ a few colour items a year
  const d = derive(state);
  const pool = dailyLifePool(state, d);
  let total = 0; for (const it of pool) total += Math.max(0, it.w);
  if (total <= 0) return;
  let r = Math.random() * total, pick = pool[0];
  for (const it of pool) { r -= Math.max(0, it.w); if (r <= 0) { pick = it; break; } }
  logEvent(state, pick.head, pick.detail, 'daily');
}

// World-technology timeline: when a building tech or fleet generation reaches
// the historical year it was invented & used in the world, announce that it's
// now available for the nation to ADOPT (build it if you can afford it). The
// first sighting per item is recorded in state.techSeen so nothing repeats.
// Tech already in use when the game (or a save) begins is recorded silently.
function checkNewTech(state) {
  const y = state.date.y;
  if (!state.techSeen) state.techSeen = {};
  const fresh = [];
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (!b.year || b.year > y || state.techSeen[key]) continue;
    const isNew = b.year === y && (state.daysElapsed || 0) > 1;   // invented this very year, mid-game
    state.techSeen[key] = 1;
    if (isNew) {
      fresh.push(`${b.icon || ''} ${b.name}`.trim());
      logEvent(state, `${b.icon || '🔬'} New technology available: ${b.name}`,
        `The world has invented it, and the nation can now build it. ${b.desc || ''} As the technology matures it will grow cheaper to import — and a stronger currency eases the price further.`,
        'tech');
    }
  }
  for (const kind of ['car', 'train']) {
    for (const g of (FLEET_TIMELINE[kind] || [])) {
      const tk = `fleet:${kind}:${g.id}`;
      if (g.year > y || state.techSeen[tk]) continue;
      const isNew = g.year === y && (state.daysElapsed || 0) > 1;
      state.techSeen[tk] = 1;
      if (isNew) fresh.push(kind === 'car' ? '🚗 newer cars appear on the world’s roads' : '🚆 a newer generation of trains enters service');
    }
  }
  if (fresh.length) (state.newTech || (state.newTech = [])).push(...fresh);
}

// Short label for the news log / toast, by scope.
function affairKind(ev) { return ev.scope === 'foreign' ? 'Foreign Affairs' : 'Internal Affairs'; }

// Turn a choice's raw effect deltas into a plain-language consequence line for
// the news, so the player can read what a decision actually did.
function summarizeFx(fx) {
  if (!fx) return '';
  const p = [];
  if (fx.treasury) p.push(`treasury ${fx.treasury > 0 ? '+' : '−'}$${Math.abs(fx.treasury)}M`);
  if (fx.approval) p.push(`approval ${fx.approval > 0 ? '+' : ''}${fx.approval}`);
  if (fx.threatSpike) p.push(fx.threatSpike > 0 ? 'external tension rises' : 'external tension eases');
  if (fx.unrest) p.push(fx.unrest > 0 ? 'unrest simmers' : 'unrest cools');
  if (fx.growth) p.push(fx.growth > 0 ? 'growth quickens' : 'growth slows');
  if (fx.growthShock) p.push('a growth shock');
  if (fx.incomeMult) p.push(fx.incomeMult > 0 ? 'investment warms' : 'investment cools');
  if (fx.jobsBoost) p.push('more jobs');
  if (fx.fuelShock) p.push('the fuel bill jumps');
  if (fx.healthShock) p.push(fx.healthShock > 0 ? 'public health recovers' : 'public health suffers');
  if (fx.unlockMany) p.push('new options unlocked');
  if (fx.project) p.push('a national project begins');
  if (fx.spawn) p.push('the state breaks ground itself');
  if (fx.flag) p.push('the nation\'s path shifts');
  return p.length ? p.join(' · ') + '.' : '';
}

function fireEvent(state, ev) {
  const d = derive(state);
  applyEffects(state, ev.effects, d);
  state.flags[ev.id] = true;                                   // once-guard
  (state.affairsAt || (state.affairsAt = {}))[ev.id] = monthIndex(state.date);   // cooldown clock
  const icon = ev.icon || '📰';
  const scope = ev.scope || 'internal';
  logEvent(state, `${icon} ${ev.title}`, ev.body, scope);
  const brief = { id: ev.id, scope, kind: affairKind(ev), icon, title: ev.title, body: ev.body };
  if (ev.choice) state.pendingEvent = { ...brief, choice: ev.choice };
  else state.lastEvent = brief;
}

export function resolveEvent(state, optionIndex) {
  const ev = state.pendingEvent;
  if (!ev) return;
  const opt = ev.choice.options[optionIndex];
  applyEffects(state, opt?.fx, derive(state));
  const consequence = summarizeFx(opt?.fx);
  logEvent(state, `↳ ${ev.title}`,
    `Your decision: ${opt?.label || 'decided'}.${consequence ? ' ' + consequence : ''}`,
    ev.scope || 'internal');
  state.pendingEvent = null;
}

// A building has burned down (the 3D fire ran its course without being doused).
// The nation loses that building's economic output for good, pays for the
// emergency response and clearance, and takes an approval / health / air-quality
// hit — a real disaster on the ground, not just a puff of smoke. Returns a short
// summary for the UI, or null if there was nothing there. Trees/plants call this
// with no grid cell and just log lightly.
export function fireDamage(state, x, y, cause) {
  const cell = state.grid?.[y]?.[x];
  const b = cell ? BUILDINGS[cell.k] : null;
  const name = (cell && cell.name) || (b && b.name) || 'a building';
  if (cell) state.grid[y][x] = null;                          // the structure is lost
  const val = b ? b.cost : 6;
  const cost = clamp(val * 0.22 + 2, 2, 45);                  // firefighting + clearance
  state.treasury -= cost;
  const sev = clamp((b ? b.homes / 8000 + b.jobs / 6000 : 0) + 0.5, 0.5, 3);  // bigger loss → bigger shock
  state.approval = clamp(state.approval - 2.2 * sev, 0, 100);
  state.health = clamp(state.health - 1.2 * sev, 0, 100);
  state.pollution = clamp(state.pollution + 3, 0, 100);
  const why = cause || 'a blaze took hold before crews could reach it';
  logEvent(state, `🔥 Fire destroys ${name}`,
    `${cap(why)} The structure is a total loss; emergency response and clearance cost about $${Math.round(cost)}M, and the neighbourhood is shaken. Fire Stations, Police Posts (safety), and greenery around buildings cut the risk; rain and quick response put blazes out before they spread.`,
    'fire');
  return { name, cost: Math.round(cost), cause: why };
}
// Capitalise the first letter of a sentence fragment.
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// A news item. `text` is the headline; optional `detail` is the fuller story —
// what happened, WHY, and what it means — shown under the headline in the News
// panel. `scope` tints it (foreign/internal/fire/incident/daily/tech/project).
function logEvent(state, text, detail, scope) {
  state.log.unshift({ d: { ...state.date }, text, detail: detail || '', scope: scope || '' });
  if (state.log.length > 60) state.log.length = 60;
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
  // Health & safety aren't just about how many hospitals/police you build — the
  // social conditions matter. Overcrowding and dirty air breed illness; joblessness
  // and slums breed crime. So chronic bad conditions hold these stocks DOWN even
  // when capacity is there, and lift when the nation is well-run.
  const overcrowd = Math.max(0, d.housingPressure - 1);
  const healthTarget = clamp(25 + (d.healthCap / denom) * m.healthMult - state.pollution * 0.18 - overcrowd * 12, 0, 100);
  const safetyTarget = clamp(25 + (d.safetyCap / denom) + (m.safetyMod || 0) - (d.unemployment * 14 + d.blight * 8), 0, 100);
  state.education = approach(state.education, eduTarget, 0.15);
  state.health = approach(state.health, healthTarget, 0.15);
  state.safety = approach(state.safety, safetyTarget, 0.15);

  // Pollution accumulates from sources, decays naturally + via green/MRT — and now
  // from traffic: gridlocked, idling cars foul the air.
  const pollTarget = clamp((d.pollutionSrc + (d.congestion || 0) * 12) * 1.2 * (1 + m.pollutionMult), 0, 100);
  state.pollution = clamp(approach(state.pollution, pollTarget, 0.2), 0, 100);

  // Domestic unrest cools each month, but joblessness and overcrowding keep it
  // simmering — so internal crises can brew from the ground conditions the player
  // lets slide, not just from prior events.
  const unrestPush = Math.max(0, d.unemployment - 0.08) * 0.5 + Math.max(0, d.housingPressure - 1) * 0.10;
  // A stable regime (National Service, anti-corruption, a firm press, law & order…)
  // cools unrest faster — the "stability" the player weighs against liberty.
  const stabilityCool = clamp((m.stability || 0) * 0.004, 0, 0.12);
  state.unrest = clamp((state.unrest || 0) * (0.96 - stabilityCool) + unrestPush, 0, 1);

  // --- Finances ($ millions / month) ---
  // Congestion wastes working hours, so it drags productivity (and thus tax revenue).
  const productivity = (1 + m.productivity + (state.education - 20) * 0.004) * (1 - (d.congestion || 0) * 0.16);
  const popReal = state.population;
  // Income tax scales with employed workforce, productivity & policy multiplier —
  // but rates bite differently by CONDITION. Squeezing a high rate out of a nation
  // with few jobs yields little (a thin, jobless base can't be taxed hard) and, past
  // a point, back-fires: the harder you tax an already-strained economy, the less
  // each extra point returns (a Laffer-style ceiling). So a "High tax" law passed in
  // a downturn underperforms a modest one in a boom.
  const taxBase = (d.employed / 1000) * 0.9 * productivity;
  // Only a HIGH rate risks a Laffer-style backfire: on a jobless, strained economy
  // each extra point returns steadily less. Low and moderate rates are unpenalised.
  const highTax = state.policies.income_tax === 'high';
  const taxEfficiency = highTax ? clamp(1 - 0.6 * (0.5 + d.unemployment * 2.6), 0.3, 1) : 1;
  const incomeTax = taxBase * m.taxMult * taxEfficiency;
  state.lastTaxEfficiency = taxEfficiency;                     // surfaced in the finance ledger / stats
  const gst = m.gstRevenue > 0 ? (popReal / 1000) * 0.25 : 0;
  // Investor confidence: capital shuns an insecure nation and rewards a safe, stable
  // one — so trade & business income scale with security. Peace and a credible
  // defence are, in the end, an economic policy.
  const confidence = 0.72 + 0.28 * clamp(d.security || 1, 0, 1.25);
  const business = d.directIncome * (1 + m.incomeMult + perks.incomeMult) * confidence;
  const grossIncome = incomeTax + gst + business;

  // Building upkeep — weighted, so a fractional heritage structure costs a fraction
  // of a full player-built one to maintain (matches how it's counted in derive()).
  let upkeep = d.bUpkeep || 0;
  upkeep += m.upkeep;                       // policy running costs
  upkeep += popReal * 0.00012;              // general public-service cost

  // Ageing society — the elderly draw a state pension and cost more in healthcare.
  // CPF (m.cpfRetire) lets them fund their own retirement, so the treasury bears only
  // the uncovered share; a generous healthcare subsidy (m.healthMult) costs more but
  // buys longer, healthier lives. Negligible for the young 1965 nation, a heavy burden
  // once it greys — exactly Singapore's central fiscal question.
  const elderly = (state.cohorts && state.cohorts.old) || 0;
  const pension = elderly * 0.0011 * (1 - m.cpfRetire);
  const elderCare = elderly * 0.0007 * m.healthMult;
  const social = pension + elderCare;
  upkeep += social;

  // Import bill — a resource-poor island buys most of its food, fuel and materials
  // from abroad (d.importBill). Self-sufficiency (farms, clean energy) shrinks it; a
  // weak currency or an oil shock swells it. A real, structural drain on the treasury.
  const imports = d.importBill || 0;
  upkeep += imports;

  // Debt servicing — interest on outstanding government bonds.
  const interest = (state.debt || 0) * bondRate(state) / 12;
  upkeep += interest;

  // Oil/fuel shock (from events) fades over time.
  if (state.fuelShock) state.fuelShock *= 0.88;

  const net = grossIncome - upkeep;
  state.treasury += net;
  state.lastFinance = {
    incomeTax, gst, business, grossIncome, upkeep, interest, social, imports, net,
  };

  // --- Population dynamics, by AGE COHORT (monthly slices) ------------------
  const co = state.cohorts || (state.cohorts = { young: Math.round(popReal * 0.32), work: Math.round(popReal * 0.62), old: Math.round(popReal * 0.06) });

  // BIRTHS feed the young. Driven by the family-planning policy (m.birth: "Stop at
  // Two" halves it, "Have Three" lifts it), by health, and by the demographic
  // transition — as a nation grows richer and greyer, couples simply have fewer
  // children (Singapore's real, stubborn low-fertility trap).
  const fertility = m.birth * (0.6 + state.health / 250) * clamp(1 - (co.old / (popReal || 1)) * 0.8, 0.45, 1);
  const births = co.work * 0.052 * fertility / 12;

  // AGEING — children become workers (~15 yrs), workers retire (~48 yrs of working life).
  const yToW = co.young / (15 * 12);
  const wToO = co.work / (48 * 12);
  // DEATHS — mostly the elderly; better healthcare (m.healthMult) and public health
  // (state.health) lengthen old age, so people live longer AND the elderly pile up.
  const oldMonths = 12 * (9 + (state.health / 100) * 9 + (m.healthMult - 1) * 22);
  const deathsOld = co.old / oldMonths;
  const bgDeath = 0.0006 / 12;                          // low background mortality of the young & working

  // MIGRATION is working-age: foreign workers & talent, set by the immigration policy
  // (m.migration: Strict repels, Open Doors pulls) plus jobs, approval and housing room.
  // A punishing tax rate on a jobless economy is also a push factor — people vote with
  // their feet, so over-taxing a downturn shrinks the workforce (the player's warning).
  const housingRoom = d.homes - popReal;
  const jobSurplus = d.jobs - d.employed;
  const taxFlight = (state.policies.income_tax === 'high') ? (0.4 + d.unemployment * 3) * 0.05 : 0;
  const attract = (state.approval - 50) * 0.02 + (jobSurplus > 0 ? 0.04 : -0.08) + m.migration * 0.06 - taxFlight;
  let migration = co.work * 0.004 * attract;
  if (housingRoom <= 0) migration = Math.min(migration, 0) - co.work * 0.003;   // no homes → no new arrivals, some leave
  else migration = Math.min(migration, housingRoom * 0.25);

  // Growth buffer (events/policies) + utility-shortage emigration, spread across ages.
  const growthAdd = popReal * ((state.growthBuf || 0) + m.growth) / 12;
  state.growthBuf = (state.growthBuf || 0) * 0.85;
  let shortage = 0;
  if (d.powerRatio < 1) shortage += popReal * (1 - d.powerRatio) * 0.01;
  if (d.waterRatio < 1) shortage += popReal * (1 - d.waterRatio) * 0.012;

  co.young = Math.max(0, co.young + births - yToW - co.young * bgDeath + growthAdd * 0.30 - shortage * 0.30);
  co.work = Math.max(0, co.work + yToW - wToO + migration - co.work * bgDeath + growthAdd * 0.60 - shortage * 0.65);
  co.old = Math.max(0, co.old + wToO - deathsOld + growthAdd * 0.10 - shortage * 0.05);
  state.population = Math.max(0, Math.round(co.young + co.work + co.old));

  // --- External threat & security ------------------------------------------
  // The region's danger level eases toward an era baseline, pushed down by good
  // diplomacy (the International Stance, m.threatMod) and up by event shocks
  // (Konfrontasi, the British pull-out, regional flare-ups) held in a decaying buffer.
  const threatTgt = clamp(threatBaseline(state.date.y) + m.threatMod + (state.threatBuf || 0), 0.05, 1);
  state.threat = clamp(approach(state.threat, threatTgt, 0.06), 0, 1);
  state.threatBuf = (state.threatBuf || 0) * 0.9;
  // An underdefended nation facing a real threat gets TESTED — a maritime
  // provocation, a border incident, capital taking fright. Strong defences make it
  // vanishingly rare; weak ones invite it, and each incident ratchets tensions up.
  if (d.insecurity > 0.35 && state.threat > 0.4 && Math.random() < d.insecurity * state.threat * 0.16) {
    const hit = Math.round(18 + d.insecurity * 80);
    state.treasury -= hit;
    state.approval = clamp(state.approval - (3 + d.insecurity * 5), 0, 100);
    state.threatBuf = (state.threatBuf || 0) + 0.06;
    logEvent(state, '⚔️ A hostile provocation tests the nation',
      `With defences below what the threat demands, a neighbour called the bluff — a maritime incursion and rattled markets cost about $${hit}M and shook confidence. Raise defence strength (camps, bases, the arms industry, National Service) until it at least matches the external threat.`,
      'foreign');
  }

  // --- Domestic incidents — crime, disease, industrial accidents ------------
  // The worse the conditions (d.*Risk), the likelier daily life goes wrong. Each
  // strikes the relevant stock, the treasury and approval, and makes the news — the
  // living texture of a nation that must be actively kept safe, healthy and fed.
  if (Math.random() < d.crimeRisk * 0.34) {
    const s = d.crimeRisk;
    state.safety = clamp(state.safety - (2 + 4 * s), 0, 100);
    state.approval = clamp(state.approval - (1.4 + 3 * s), 0, 100);
    state.treasury -= 3 + 10 * s;
    state.incidentCount = (state.incidentCount || 0) + 1;
    const why = [];
    if (d.unemployment > 0.1) why.push('idle hands — joblessness runs high');
    if ((d.security || 1) < 1 || state.safety < 45) why.push('too few police on the beat');
    if ((d.blight || 0) > 0.2) why.push('neglected estates in the shadow of industry');
    logEvent(state, '🚨 A crime wave hits the estates',
      `Break-ins and gang trouble spread through the neighbourhoods, costing about $${Math.round(3 + 10 * s)}M and denting confidence. Root causes: ${why.join('; ') || 'a hard month on the ground'}. More Police Posts, jobs and better-served estates would cool it.`,
      'incident');
  }
  if (Math.random() < d.diseaseRisk * 0.30) {
    const s = d.diseaseRisk;
    state.health = clamp(state.health - (5 + 14 * s), 0, 100);
    state.approval = clamp(state.approval - (1.4 + 3 * s), 0, 100);
    state.treasury -= 8 + 20 * s;
    state.incidentCount = (state.incidentCount || 0) + 1;
    const why = [];
    if (state.health < 45) why.push('thin clinic and hospital coverage');
    if ((d.housingPressure || 0) > 1) why.push('overcrowded homes spreading infection');
    if ((state.pollution || 0) > 30) why.push('foul air and water');
    logEvent(state, '🦠 A disease outbreak spreads',
      `Fever races through the crowded districts; wards fill and clean-up runs to about $${Math.round(8 + 20 * s)}M. Root causes: ${why.join('; ') || 'seasonal bad luck'}. Clinics, hospitals, sewerage and less crowding would blunt the next one.`,
      'incident');
  }
  if (Math.random() < d.accidentRisk * 0.2) {
    const s = d.accidentRisk;
    state.treasury -= 6 + 25 * s;
    state.approval = clamp(state.approval - (1 + 3 * s), 0, 100);
    state.pollution = clamp(state.pollution + 3, 0, 100);
    state.health = clamp(state.health - (1 + 3 * s), 0, 100);
    state.incidentCount = (state.incidentCount || 0) + 1;
    logEvent(state, '⚠️ An industrial accident at the works',
      `A fire and chemical spill at a heavy plant leaves casualties and a clean-up bill near $${Math.round(6 + 25 * s)}M, and fouls the air. It is the price of packing homes hard against unsafe industry with too little safety cover — zone heavy works away from housing and keep safety high.`,
      'incident');
  }

  // Approval glides toward its target.
  state.approval = clamp(approach(state.approval, approvalTarget(state, d), 0.25), 0, 100);

  // Settle inflation / price level from this month's economic performance.
  updateEconomy(state, d);
}

// Baseline regional danger by era — the Cold War and Konfrontasi made the 1960s–70s
// perilous for a tiny new state; it eased with ASEAN and prosperity, with a modest
// modern uptick (terrorism, great-power friction). The International Stance shifts it.
function threatBaseline(year) {
  if (year < 1971) return 0.55;   // Konfrontasi hangover; Britain still leaving
  if (year < 1980) return 0.44;   // post-withdrawal; racing to build the SAF
  if (year < 2001) return 0.32;   // relative calm under a stable ASEAN
  return 0.4;                     // 9/11-era security concerns; sharper rivalries
}

// ---------------------------------------------------------------------------
// Main tick — advance one day. Returns derived stats for the UI.
// ---------------------------------------------------------------------------
export function tickDay(state) {
  state.date = addDay(state.date);
  state.daysElapsed = (state.daysElapsed || 0) + 1;
  advanceConstruction(state); // tick building sites toward completion
  advanceDemolition(state);   // tick teardowns; clear finished demolitions
  advanceReclamation(state);  // tick land reclamation (sea rising into land)
  advanceRoadworks(state);    // tick drawn roads/railways toward completion

  const d = derive(state);
  updateProjects(state, d); // a guided national project may have just been finished

  // Smooth daily drift so meters visibly move between monthly settlements.
  state.approval = clamp(approach(state.approval, approvalTarget(state, d), 0.02), 0, 100);

  // Daily treasury trickle (1/30th of last month's net) for a live feel.
  if (state.lastFinance) state.treasury += state.lastFinance.net / DAYS_IN_MONTH;

  if (state.date.d === 1) {
    monthlyUpdate(state, derive(state));
    checkNewTech(state);      // announce world inventions that reached their historical year
    maybeAffair(state);       // emergent foreign/internal affairs the PM must answer
    maybeDailyLife(state);    // colour news: how ordinary life is going, and why
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
