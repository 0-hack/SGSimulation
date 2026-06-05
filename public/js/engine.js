// Simulation engine: holds the game state and advances it day by day.
// Pure-ish logic (no DOM) so it can be unit-tested in Node as well.
import {
  BUILDINGS, POLICIES, START_DATE, GRID_SIZE, POP_SCALE,
  HISTORICAL_EVENTS, RANDOM_EVENTS,
} from './data.js';
import { pointInPolygon, inReservoir } from './shape.js';

// Is grid cell (x,y) on the island (land) and not in the protected reservoir?
function isLandCell(x, y) {
  return pointInPolygon((x + 0.5) / GRID_SIZE, (y + 0.5) / GRID_SIZE) && !inReservoir(x, y, GRID_SIZE);
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
    population: 12000,        // scaled citizens (×POP_SCALE for display)
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
function seed1965(state) {
  const c = Math.floor(GRID_SIZE / 2);
  // the colonial city/port sat on the SOUTH coast (low y), by the Singapore River.
  let south = c;
  for (let y = 0; y < GRID_SIZE; y++) { if (isLandCell(c, y)) { south = y; break; } }
  const ty = Math.min(c - 3, south + 4);   // a few cells inland from the south shore

  // a compact street grid of nodes over land cells around the anchor
  const roads = state.roads, nodeAt = new Map();
  const node = (x, y) => {
    const k = x + ',' + y;
    if (nodeAt.has(k)) return nodeAt.get(k);
    const w = cellWorld(x, y); roads.nodes.push(w);
    const id = roads.nodes.length - 1; nodeAt.set(k, id); return id;
  };
  const onLand = (x, y) => isLandCell(x, y);
  for (let gx = -3; gx <= 3; gx++) {
    for (let gy = -2; gy <= 2; gy++) {
      const x = c + gx, y = ty + gy;
      if (!onLand(x, y)) continue;
      if (onLand(x + 1, y)) roads.edges.push({ a: node(x, y), b: node(x + 1, y), ctrl: null, type: 'street', lanes: 2, elevated: false });
      if (onLand(x, y + 1)) roads.edges.push({ a: node(x, y), b: node(x, y + 1), ctrl: null, type: 'street', lanes: 2, elevated: false });
    }
  }

  // a few kampongs in the town + a reservoir, plus rural kampongs further out
  const placeAt = (x, y, k) => { if (x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE && isLandCell(x, y) && !state.grid[y][x]) place(state, x, y, k); };
  placeAt(c, ty, 'kampong'); placeAt(c + 1, ty, 'kampong'); placeAt(c - 1, ty + 1, 'kampong');
  placeAt(c + 2, ty - 1, 'reservoir');
  // scatter rural kampongs around the island
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 6; tries++) {
    const x = Math.floor(Math.random() * GRID_SIZE), y = Math.floor(Math.random() * GRID_SIZE);
    if (isLandCell(x, y) && !state.grid[y][x] && Math.hypot(x - c, y - ty) > 6) { place(state, x, y, 'kampong'); placed++; }
  }
}

// Bring a loaded save up to the current map size (e.g. older, smaller grids):
// re-centre the existing layout onto a fresh GRID_SIZE×GRID_SIZE grid.
export function ensureGrid(state) {
  if (!state) return state;
  if (typeof state.debt !== 'number') state.debt = 0;
  if (!state.roads) state.roads = { nodes: [], edges: [], islands: [] };
  if (!state.roads.islands) state.roads.islands = [];
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
  return state.treasury >= b.cost;
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
  state.treasury -= BUILDINGS[key].cost;
  place(state, x, y, key, theme);
  return true;
}
export function demolish(state, x, y) {
  const cell = state.grid?.[y]?.[x];
  if (!cell) return false;
  state.grid[y][x] = null;
  state.treasury -= 2; // demolition cost
  return true;
}

// ---------------------------------------------------------------------------
// Public finance — government bonds (borrowing).
// ---------------------------------------------------------------------------
// Annual coupon rate rises with how much of the borrowing limit is used (credit risk).
export function bondRate(state) {
  const ceil = debtCeiling(state);
  const util = ceil > 0 ? Math.min(1, (state.debt || 0) / ceil) : 1;
  return 0.045 + util * 0.06;               // 4.5% .. ~10.5%
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
}

// ---------------------------------------------------------------------------
// Main tick — advance one day. Returns derived stats for the UI.
// ---------------------------------------------------------------------------
export function tickDay(state) {
  state.date = addDay(state.date);
  state.daysElapsed = (state.daysElapsed || 0) + 1;

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
