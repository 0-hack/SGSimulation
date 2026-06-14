// Main controller: boots the menu, runs the game loop, wires the UI & cloud.
import {
  newGame, tickDay, build, demolish, canPlace, derive,
  resolveEvent, snapshot, refreshSummary, ensureGrid, issueBond, repayDebt,
  reclaimLand, reclaimCost, buildingCost, priced,
  routeLength, addRoadwork, smoothRoute, spliceRoad,
  polyArea, reclaimAreaCost, addReclaimArea,
} from './engine.js';
import { Scene3D } from './scene3d.js';
import { api } from './api.js';
import {
  updateHud, renderBuild, renderPolicy, renderDash, renderNews,
  money, num, pct, el,
} from './ui.js';
import { BUILDINGS, CATEGORIES, POP_SCALE, ROAD_TYPES, landmarkToBuilding } from './data.js';
import { loadLibrary } from './landmarks.js';
import { injectIcons, ICONS, WEATHER } from './icons.js';

// Make 3D-designed landmarks buildable at runtime (per-player; no server writes).
// Idempotent — safe to call again when new designs appear.
function registerLandmarks(list) {
  let n = 0;
  for (const lm of (list || [])) {
    if (!lm || !lm.parts || !lm.parts.length) continue;
    const [key, def] = landmarkToBuilding(lm, lm.id || lm.name || n);
    BUILDINGS[key] = def; n++;
  }
  if (n && !CATEGORIES.some((c) => c.id === 'landmark')) CATEGORIES.push({ id: 'landmark', name: 'Landmarks', icon: '🏛️' });
  return n;
}

const LS_SAVE = 'sg_save_v1';
const LS_NAME = 'sg_owner';

// Game days per real second for each speed step.
// Time speed. The player picks a base rate in IN-GAME DAYS PER REAL SECOND
// (G.dayRate); Play / Fast / Hyper multiply it. Day/night is locked to the
// calendar (1 in-game day = one sun cycle), so the sun's *visible* advance is
// capped (SUN_CAP) to avoid strobing when fast-forwarding — the date still races
// ahead at the full chosen rate.
const SPEED_MULT = [0, 1, 5, 20];   // pause / play / fast / hyper multipliers
const SUN_CAP = 0.5;                // max in-game days/sec the day-night cycle visibly advances
// Airport runways must be on flat ground. If the chosen strip varies in height by
// more than FLAT_TOL, the player pays EARTHWORK_RATE per m³ of earth moved to level it.
const FLAT_TOL = 2;                 // metres of height variation tolerated before levelling is required
const EARTHWORK_RATE = 0.012;       // $M per m³ of cut/fill (× live price index)
// A railway crossing ground more than RAIL_HILL_TOL above its grade can be bored
// as a tunnel instead of climbing over; the bore costs TUNNEL_RATE per m³ of rock.
const RAIL_HILL_TOL = 2.5;          // metres above grade before a tunnel is offered
const TUNNEL_RATE = 0.02;           // $M per m³ of rock bored (× live price index)
const currentRate = () => G.dayRate * SPEED_MULT[G.speed];

const $ = (id) => document.getElementById(id);

const G = {
  state: null,
  view: null,
  speed: 1,
  prevSpeed: 1,
  dayRate: 0.1,          // in-game days per real second at Play speed (~10s per day; player-adjustable)
  readOnly: false,
  cloud: null,           // { id, token } for the player's own world
  acc: 0,
  lastFrame: 0,
  hudTimer: 0,
  build: { cat: 'residential', selected: null, bulldoze: false, theme: null },
  road: { tool: null, type: 'road', elevated: false, pending: [] },
  reclaim: { active: false },  // land-reclamation tool: tap sea to fill land
  editPause: false,            // true while a build/road/reclaim tool is active — freezes time & the world

  currentPanel: null,
  dirty: false,          // unsaved changes since last cloud save
};

// ===========================================================================
// Boot
// ===========================================================================
const BUILD = '2026-06-14 · lego-chain-then-build v22';
function boot() {
  console.log('%cSG build: ' + BUILD, 'font-weight:bold;color:#11a39c');
  const vEl = document.querySelector('.version'); if (vEl) vEl.textContent = 'build ' + BUILD;
  injectIcons(); // swap [data-icon] placeholders for custom SVG icons
  // restore owner name
  const savedName = localStorage.getItem(LS_NAME);
  if (savedName) $('m-owner').value = savedName;

  // continue button if a local save exists
  if (localStorage.getItem(LS_SAVE)) $('btn-continue').classList.remove('hidden');

  $('btn-new').onclick = startNew;
  $('btn-continue').onclick = continueGame;
  $('btn-browse').onclick = () => { showGameShell(false); openBrowser(); };

  $('btn-menu').onclick = () => { saveLocal(); showMenu(); };
  $('sheet-close').onclick = closeSheet;
  document.querySelector('#sheet .sheet-backdrop').onclick = closeSheet;

  // exit "place mode": the ✕ Done button or the Esc key
  $('tool-banner-stop').onclick = cancelTools;
  $('tool-banner-rotate').onclick = () => { if (G.view && G.view.pieceMode) G.view.rotatePiece(Math.PI / 4); };
  // commit bar for a drawn route / reclaim area
  $('dc-build').onclick = () => { const fn = G._pendingCommit; closeCommit(false); if (fn) fn(); };
  $('dc-cancel').onclick = () => { closeCommit(true); toast('Discarded.'); };
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape' && G._pendingCommit) { closeCommit(true); toast('Discarded.'); e.preventDefault(); return; }
    if (e.key === 'Escape' && activeTool()) { cancelTools(); toast('Stopped placing.'); e.preventDefault(); }
    if ((e.key === 'r' || e.key === 'R') && G.view && G.view.pieceMode) { G.view.rotatePiece(Math.PI / 4); e.preventDefault(); }
  });

  // speed buttons + adjustable rate chip
  document.querySelectorAll('.spd').forEach((b) => {
    b.onclick = () => setSpeed(parseInt(b.dataset.spd, 10));
  });
  $('rate-chip').onclick = promptDayRate;
  updateRateChip();
  // toolbar
  document.querySelectorAll('.tool').forEach((b) => {
    b.onclick = () => openPanel(b.dataset.panel);
  });

  $('btn-leave-visit').onclick = leaveVisit;

  // deep link: /world/<id>
  const m = location.pathname.match(/^\/world\/([\w-]+)/);
  if (m) { showGameShell(false); visitWorld(m[1]); }

  requestAnimationFrame(loop);
}

// ===========================================================================
// Menu / lifecycle
// ===========================================================================
function showMenu() {
  G.speed = 0;
  setEditPause(false);
  $('game').classList.add('hidden');
  $('toolbar').classList.add('hidden');
  $('tool-banner')?.classList.add('hidden');
  closeSheet();
  $('menu').classList.remove('hidden');
  if (localStorage.getItem(LS_SAVE)) $('btn-continue').classList.remove('hidden');
}

function showGameShell(playing = true) {
  $('menu').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('toolbar').classList.remove('hidden');
  if (!G.view) {
    try {
      G.view = new Scene3D($('city'), { onTileTap: onTileTap, onGroundTap: onGroundTap });
      window.__sgview = G.view; // exposed for debugging / disaster FX hooks
    } catch (err) {
      alert('This game needs a browser with WebGL/3D support.\n\n' + err.message);
      showMenu();
      return;
    }
  }
  G.view.resize();
  if (playing) setSpeed(1);
  // surface the camera controls once per session, then fade it out
  if (!sessionStorage.getItem('camHintSeen')) {
    const hint = $('cam-hint');
    if (hint) {
      hint.classList.remove('hidden');
      setTimeout(() => hint.classList.add('fade'), 6500);
      setTimeout(() => hint.classList.add('hidden'), 7600);
      sessionStorage.setItem('camHintSeen', '1');
    }
  }
}

function startNew() {
  const name = $('m-nation').value.trim() || 'New Singapura';
  const owner = $('m-owner').value.trim() || 'Anonymous';
  localStorage.setItem(LS_NAME, owner);
  G.state = newGame({ name, owner });
  G.cloud = null;
  G.readOnly = false;
  G.dirty = true;
  $('visit-banner').classList.add('hidden');
  showGameShell();
  attachState();
  saveLocal();
  toast('A new nation is born. 🇸🇬');
  openPanel('build');
}

function continueGame() {
  const raw = localStorage.getItem(LS_SAVE);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    G.state = data.state;
    G.cloud = data.cloud || null;
    G.readOnly = false;
    $('visit-banner').classList.add('hidden');
    showGameShell();
    attachState();
    toast('Welcome back, Prime Minister.');
  } catch {
    toast('Could not load saved game.');
  }
}

function attachState() {
  ensureGrid(G.state); // migrate older/smaller saves to the current map size + roads
  // Designed landmarks become buildable: the landmarks saved INTO this world
  // (so visitors see them too) plus — when it's your own game — your personal
  // library from this browser. Your library is also snapshotted into the world.
  registerLandmarks(G.state.landmarks || []);
  if (!G.readOnly) { const lib = loadLibrary(); registerLandmarks(lib); G.state.landmarks = lib; }
  refreshSummary(G.state);
  G.view.setState(G.state);
  G.view.centerCamera();
  updateHud(G.state, G.readOnly);
  updateShortages();
  // toolbar availability in read-only mode
  document.querySelectorAll('.tool').forEach((b) => {
    const editor = b.dataset.panel === 'build' || b.dataset.panel === 'policy' || b.dataset.panel === 'cloud';
    b.style.opacity = (G.readOnly && editor) ? '0.4' : '1';
  });
}

// ===========================================================================
// Game loop
// ===========================================================================
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = G.lastFrame ? (ts - G.lastFrame) / 1000 : 0;
  G.lastFrame = ts;

  if (G.state && G.speed > 0 && !G.state.pendingEvent && !G.editPause) {
    // drive the day/night sun & weather clock in lockstep with the date
    const rate = currentRate();
    if (G.view) G.view.advanceClock(dt * Math.min(rate, SUN_CAP)); // cap the sun so fast-forward doesn't strobe
    G.acc += dt * rate;
    let ticks = 0;
    const rwBefore = (G.state.roadworks || []).length;
    while (G.acc >= 1 && ticks < 60) {
      tickDay(G.state);
      G.acc -= 1;
      ticks++;
      if (G.state.pendingEvent) break;
    }
    if (ticks > 0) {
      G.dirty = true;
      G.hudTimer += dt;
      if (G.view) { G.view.syncConstruction(G.state); G.view.syncReclamation(G.state); G.view.syncRoadworks(G.state); // advance sites/land/routes
        if ((G.state.roadworks || []).length < rwBefore) { G.view.rebuildRoadNet(); G.view._buildPlayerRailways(G.state); G.view._buildPlayerAirstrips(G.state); } } // a route finished -> render it for real
      updateHud(G.state, G.readOnly);
      updateShortages();
      if (G.state.pendingEvent) { showEvent(); }
      // refresh open live panels occasionally
      if (G.currentPanel === 'dash' && G.hudTimer > 0.5) { refreshPanel(); G.hudTimer = 0; }
    }
  }

  if (G.view) { G.view.render(); updateWeatherHud(); }
}

let lastWeather = '';
function updateWeatherHud() {
  const w = G.view?.weather?.type;
  if (!w || w === lastWeather) return;
  lastWeather = w;
  const meta = WEATHER[w] || WEATHER.sunny;
  const elw = $('hud-weather');
  if (elw) elw.innerHTML = `<span class="w-ico">${ICONS[meta.icon]}</span>${meta.label}`;
}

let lastShortageKey = '';
function updateShortages() {
  const d = derive(G.state);
  const power = d.powerRatio < 1;
  const water = d.waterRatio < 1;
  G.view.setShortages({ power, water });

  const alerts = $('alerts');
  const msgs = [];
  if (power) msgs.push({ t: 'Power shortage — build more generation', warn: false });
  if (water) msgs.push({ t: 'Water shortage — build reservoirs / plants', warn: false });
  if (d.housingPressure > 1.05) msgs.push({ t: 'Housing shortage — citizens are overcrowded', warn: true });
  if (d.unemployment > 0.18) msgs.push({ t: 'High unemployment — build industry & offices', warn: true });
  if (G.state.treasury < 0) msgs.push({ t: 'Treasury in deficit', warn: false });
  if (G.state.approval < 30) msgs.push({ t: 'Approval is dangerously low', warn: false });

  const key = msgs.map((m) => m.t).join('|');
  if (key === lastShortageKey) return;
  lastShortageKey = key;
  alerts.innerHTML = '';
  for (const m of msgs.slice(0, 3)) {
    alerts.append(el('div', 'alert' + (m.warn ? ' warn' : ''), m.t));
  }
}

function setSpeed(s) {
  G.speed = s;
  document.querySelectorAll('.spd').forEach((b) => {
    b.classList.toggle('active', parseInt(b.dataset.spd, 10) === s);
  });
  updateRateChip();
}
// A readable label for the current effective speed (days/s when fast, else s/day).
function updateRateChip() {
  const chip = $('rate-chip'); if (!chip) return;
  const r = currentRate();
  chip.textContent = r <= 0 ? '⏸ paused' : (r >= 1 ? `⏱ ${(+r.toFixed(2))} days/s` : `⏱ ${Math.round(1 / r)}s/day`);
}
// Let the player choose the base Play rate in in-game days per real second.
function promptDayRate() {
  const cur = G.dayRate;
  const suggest = cur >= 1 ? String(+cur.toFixed(2)) : `0.1  (≈ ${Math.round(1 / cur)}s per day)`;
  const v = prompt('Game speed at Play — in-game DAYS per real second (decimal).\nLower = slower / more time to watch day & night.\ne.g. 0.1 = 10s per day, 1 = a day every second, 5 = fast-forward.', String(+cur.toFixed(3)));
  if (v == null) return;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) { toast('Enter a positive number of days per second.'); return; }
  G.dayRate = Math.min(50, Math.max(0.01, n));
  if (G.speed === 0) setSpeed(1); // un-pause so the new rate takes effect
  else updateRateChip();
  toast(`Speed: ${G.dayRate >= 1 ? `${+G.dayRate.toFixed(2)} days/s` : `${Math.round(1 / G.dayRate)}s per day`} at Play.`);
}

// ===========================================================================
// Building interaction
// ===========================================================================
// Reclaim land freehand: the player draws a loop over open sea (like trace.html),
// and on release we fill every reclaimable cell inside it — after a cost prompt.
function onReclaimArea(pts) {
  if (G.readOnly) { G.view.clearRoadPreview(); return; }
  if (!pts || pts.length < 3) { G.view.clearRoadPreview(); toast('Draw a loop over open sea to reclaim it. 🏝️'); return; }
  // smooth the freehand loop into a clean shape; the land takes this exact form
  const poly = smoothRoute(pts, Math.min(12, Math.max(4, (G.view?.cam?.radius || 70) * 0.05))).map((q) => [q.x, q.z]);
  const cells = G.view._cellsInArea(poly.map(([x, z]) => ({ x, z })));
  if (!cells.length) { G.view.clearRoadPreview(); toast('That loop encloses no open sea — draw it around the water. 🏝️'); return; }
  const area = polyArea(poly);                       // world units² of land
  const cost = reclaimAreaCost(G.state, area);       // priced by area + live inflation
  const total = Math.max(4, Math.min(30, Math.round(Math.sqrt(area) / 4))); // bigger fills take longer to rise
  promptCommit({
    title: '🏝 Reclaim land',
    detail: `${Math.round(area / 100)} tiles (${(area / 1e6).toFixed(2)} km²) · ${money(cost)}`,
    confirm: 'Reclaim',
    onConfirm: () => {
      if (G.state.treasury < cost) { toast(`Need ${money(cost)} to reclaim this area.`); return; }
      G.state.treasury -= cost;
      addReclaimArea(G.state, { poly, cells, total });
      G.view.syncReclamation(G.state);
      G.view.clearRoadPreview();
      afterEdit();
      toast(`Reclaiming new land (${money(cost)}). 🏝️ It rises over ${total} days.`);
    },
  });
}

function onTileTap(x, y) {
  if (G.readOnly) { toast('You are visiting — building is disabled here.'); return; }
  const b = G.build;
  if (b.bulldoze) {
    if (demolish(G.state, x, y)) { G.view.onDemolished(x, y); afterEdit(); toast('Demolished.'); }
    return;
  }
  if (b.selected) {
    if (!G.view.isLand(x, y)) { toast('You can only build on land. 🏝️'); return; }
    if (G.view.isRoadAt(x, y)) { toast('There is a road here — you can\'t build on the road. 🛣️'); return; }
    if (canPlace(G.state, x, y, b.selected)) {
      const theme = BUILDINGS[b.selected].customizable ? b.theme : null;
      build(G.state, x, y, b.selected, theme);
      G.view.syncConstruction(G.state); // shows the construction site (it tops out over time)
      afterEdit();
      toast(`${BUILDINGS[b.selected].name} — construction started.`);
    } else {
      const bd = BUILDINGS[b.selected];
      if (G.state.grid[y][x]) toast('Tile occupied.');
      else if (G.state.treasury < buildingCost(G.state, b.selected)) toast(`Need ${money(buildingCost(G.state, b.selected))} to build ${bd.name}.`);
      else toast('Cannot build here.');
    }
  } else {
    // inspect
    const cell = G.state.grid[y][x];
    if (cell) toast(`${BUILDINGS[cell.k].icon} ${BUILDINGS[cell.k].name}`);
  }
}

function afterEdit() {
  G.dirty = true;
  refreshSummary(G.state);
  updateHud(G.state, G.readOnly);
  updateShortages();
  if (G.currentPanel === 'build' || G.currentPanel === 'dash') refreshPanel(); // affordability/finances may change
}

// ---- placement-tool state (build / bulldoze / reclaim / road) --------------
// You stay in "place mode" so you can place many in a row; this shows what's
// active and gives an explicit way to STOP (the ✕ Done button or Esc).
function activeTool() {
  if (G.readOnly) return null;
  if (G.build.selected && BUILDINGS[G.build.selected]) return { verb: 'build', label: BUILDINGS[G.build.selected].name };
  if (G.build.bulldoze) return { verb: 'remove', label: '🚜 Bulldoze' };
  if (G.reclaim.active) return { verb: 'fill with land', label: '🏝 Reclaim' };
  if (G.road.tool) return { verb: 'draw', label: '🛣 Road · ' + G.road.tool };
  return null;
}
function updateToolBanner() {
  const t = activeTool(), el = $('tool-banner');
  // Editing a tool freezes the clock and the living map so you can build calmly.
  setEditPause(!!t);
  if (!el) return;
  if (!t) { el.classList.add('hidden'); return; }
  $('tool-banner-text').innerHTML = `<b>⏸ Edit mode · ${t.label}</b><br><span class="tb-sub">Time paused — tap the map to ${t.verb}</span>`;
  const piece = G.road.tool === 'straight' || G.road.tool === 'curveL' || G.road.tool === 'curveR';
  $('tool-banner-rotate').classList.toggle('hidden', !piece);   // rotate only matters for free piece placement
  el.classList.remove('hidden');
}
// Enter/leave edit mode: pause time (the loop checks G.editPause), freeze the
// world animation, and flag the UI so it's obvious editing is on.
function setEditPause(on) {
  if (G.editPause === on) return;
  G.editPause = on;
  document.body.classList.toggle('edit-mode', on);
  if (G.view) G.view.setFrozen(on);
}
function cancelTools() {
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.road.tool = null; G.road.pending = [];
  closeCommit(true);
  if (G.view) { G.view.setPreview(null); G.view.setBulldoze(false); G.view.setRoadMode(false); G.view.setPaintMode(false); G.view.setDrawMode(false); G.view.showRoadPreview([]); }
  updateToolBanner();
  if (G.currentPanel === 'build') refreshPanel();
}

// ===========================================================================
// Freeform road drawing
// ===========================================================================
function placeRoundabout(x, z) {
  const T = ROAD_TYPES[G.road.type];
  if (T.rail || T.air) { toast('Roundabouts are for roads only — use Draw for a railway/runway.'); return; }
  const cost = priced(T.cost * 4, G.state);
  if (G.state.treasury < cost) { toast(`Need ${money(cost)} for a roundabout.`); return; }
  const roads = G.state.roads, r = 6, k = 8, base = roads.nodes.length;
  for (let i = 0; i < k; i++) roads.nodes.push({ x: x + Math.cos(i / k * Math.PI * 2) * r, z: z + Math.sin(i / k * Math.PI * 2) * r, y: 0 });
  for (let i = 0; i < k; i++) {
    const a = base + i, b = base + (i + 1) % k;
    const mx = (roads.nodes[a].x + roads.nodes[b].x) / 2, mz = (roads.nodes[a].z + roads.nodes[b].z) / 2;
    const cx = x + (mx - x) * 1.25, cz = z + (mz - z) * 1.25;   // bulge outward for a round arc
    roads.edges.push({ a, b, ctrl: { x: cx, z: cz }, type: G.road.type, lanes: T.lanes, elevated: false });
  }
  roads.islands.push({ x, z, r });
  G.state.treasury -= cost;
  G.view.rebuildRoadNet();
  afterEdit();
  toast('Roundabout built.');
}
function eraseRoadAt(x, z) {
  const roads = G.state.roads;
  let best = -1, bestD = 6;
  roads.edges.forEach((e, i) => {
    // drawn roads carry a full polyline — test every point along it so the whole
    // curve is erasable, not just its endpoints
    if (e.poly && e.poly.length) {
      for (const p of e.poly) { const d = Math.hypot(p.x - x, p.z - z); if (d < bestD) { bestD = d; best = i; } }
      return;
    }
    const a = roads.nodes[e.a], b = roads.nodes[e.b];
    if (!a || !b) return;
    const mx = e.ctrl ? e.ctrl.x : (a.x + b.x) / 2, mz = e.ctrl ? e.ctrl.z : (a.z + b.z) / 2;
    for (const [px, pz] of [[a.x, a.z], [mx, mz], [b.x, b.z]]) {
      const d = Math.hypot(px - x, pz - z); if (d < bestD) { bestD = d; best = i; }
    }
  });
  if (best >= 0) { roads.edges.splice(best, 1); G.view.rebuildRoadNet(); afterEdit(); toast('Road removed.'); }
  else toast('No road here to erase.');
}

function onGroundTap(x, z) {
  if (G.readOnly) { toast('Read-only while visiting.'); return; }
  const R = G.road;
  if (R.tool === 'erase') { eraseRoadAt(x, z); return; }
  if (G.view.isReserveAt(x, z)) { toast('Protected Central Catchment — no roads on the reservoir.'); return; }
  if (G.view.isRiverAt(x, z)) { toast('That\'s the Singapore River — roads can\'t cross open water.'); return; }
  if (R.tool === 'roundabout') { placeRoundabout(x, z); return; }
}
// A route drawn freehand on the map → show a commit prompt with the cost; on
// confirm, queue it for construction (cost reflects the live price/inflation).
function onRouteDrawn(pts, opts = {}) {
  if (G.readOnly) { G.view.clearRoadPreview(); return; }
  // a bare tap (or a stroke that never left the start point) draws nothing.
  if (!pts || pts.length < 2) { G.view.clearRoadPreview(); toast('Hold and drag across the map to draw the route. ✏️'); return; }
  const T = ROAD_TYPES[G.road.type] || ROAD_TYPES.road;
  const len = routeLength(pts);
  if (len < 8) { G.view.clearRoadPreview(); toast('That route is too short — drag a longer line.'); return; }
  // freeform strokes get smoothed; staged Lego pieces keep their exact geometry
  const route = opts.raw ? pts.map((p) => ({ x: p.x, z: p.z })) : smoothRoute(pts, Math.min(12, Math.max(4, (G.view?.cam?.radius || 70) * 0.05)));
  const cost = priced(T.cost * Math.max(1, len / 20), G.state);
  let total = cost, days = Math.max(8, Math.min(80, Math.round(len / 8)));
  let detail = `${Math.round(len)} m · ${money(cost)}`;
  // Charge `amount`, queue construction, and (for railways) carry the tunnel flag.
  const doBuild = (amount, buildDays, tunnel, note) => {
    if (G.state.treasury < amount) { toast(`Need ${money(amount)} to build this ${T.name.toLowerCase()}.`); return; }
    G.state.treasury -= amount;
    const kind = T.air ? 'air' : T.rail ? 'rail' : 'road';
    addRoadwork(G.state, { pts: route, kind, type: G.road.type, lanes: T.lanes, elevated: G.road.elevated, tunnel: !!tunnel, total: buildDays });
    G.view.syncRoadworks(G.state);
    G.view.clearRoadPreview();
    if (G.view.clearPieceChain) G.view.clearPieceChain();   // staged chain is now under construction
    afterEdit();
    toast(`${T.name} — ${note || 'construction started'} (${money(amount)}).`);
  };
  const title = `${T.icon || ''} ${T.name}`;
  // HARD RULE: an airport runway must sit on flat ground. If the chosen strip is
  // uneven, the player pays for earthworks to level it (cost breakdown by volume).
  if (T.air) {
    const st = G.view._corridorTerrainStats(route, 4.5);
    if (st.range > FLAT_TOL) {
      const fcost = priced(EARTHWORK_RATE * st.volume, G.state);
      total += fcost; days += Math.min(60, Math.round(st.volume / 350));
      detail = `${Math.round(len)} m runway — ⚠ ground is uneven (Δ${st.range.toFixed(1)} m).<br>` +
        `🛬 Runway ${money(cost)}<br>🏗 Level ${Math.round(st.volume).toLocaleString()} m³ ${money(fcost)}<br><b>Total ${money(total)}</b>`;
      promptCommit({ title, detail, confirm: 'Build', onConfirm: () => doBuild(total, days, false, 'levelling ground & building') });
      return;
    }
  }
  // RAILWAY through high ground: offer a choice — run the line OVER the hill
  // (cheaper, follows the slope) or bore a TUNNEL straight through it (costs
  // extra for the excavation). Only offered when the route actually crosses a hill.
  if (T.rail) {
    const prof = G.view._railProfile(route.map((p) => ({ x: p.x, z: p.z })), 2.0);
    if (prof.maxAbove > RAIL_HILL_TOL) {
      const bore = priced(TUNNEL_RATE * prof.boreVolume, G.state);
      const tTotal = cost + bore, tDays = days + Math.min(90, Math.round(prof.boreVolume / 300));
      detail = `${Math.round(len)} m railway — ⛰ crosses high ground (up to ${prof.maxAbove.toFixed(1)} m above grade).<br>` +
        `⛰ <b>Over</b> the hill ${money(cost)}<br>` +
        `🚇 <b>Tunnel</b> through — bore ${Math.round(prof.boreVolume).toLocaleString()} m³ (~${Math.round(prof.buriedLen)} m): track ${money(cost)} + ${money(bore)} = <b>${money(tTotal)}</b>`;
      promptCommit({
        title, detail,
        actions: [
          { label: `⛰ Over ${money(cost)}`, onPick: () => doBuild(cost, days, false, 'laying track over the hill') },
          { label: `🚇 Tunnel ${money(tTotal)}`, primary: true, onPick: () => doBuild(tTotal, tDays, true, 'boring the tunnel & laying track') },
        ],
      });
      return;
    }
  }
  promptCommit({ title, detail, confirm: 'Build', onConfirm: () => doBuild(total, days, false) });
}
// Bottom commit bar for a drawn route/area: shows the cost and Build / Cancel.
// Cancel (or Esc) discards the drawing; confirm runs onConfirm.
// `actions` (optional) renders several build choices (e.g. railway Over vs
// Tunnel); otherwise a single Build button runs `onConfirm`.
function promptCommit({ title, detail, confirm = 'Build', onConfirm, actions }) {
  const bar = $('draw-confirm');
  $('dc-title').textContent = title;
  $('dc-detail').innerHTML = detail;   // detail is built from our own strings (allows a breakdown with <br>)
  const acts = $('dc-actions');
  [...acts.querySelectorAll('.dc-dyn')].forEach((b) => b.remove());  // drop any buttons from a previous prompt
  const build = $('dc-build');
  if (actions && actions.length) {
    build.classList.add('hidden');     // the single fixed Build button is unused for a multi-choice prompt
    G._pendingCommit = null;
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'dc-dyn ' + (a.primary ? 'dc-build' : 'dc-alt');
      b.textContent = a.label;
      b.onclick = () => { closeCommit(false); a.onPick && a.onPick(); };
      acts.appendChild(b);
    }
  } else {
    build.classList.remove('hidden');
    build.textContent = confirm;
    G._pendingCommit = onConfirm;
  }
  bar.classList.remove('hidden');
}
function closeCommit(discard) {
  $('draw-confirm')?.classList.add('hidden');
  G._pendingCommit = null;
  if (discard && G.view) { G.view.clearRoadPreview(); if (G.view.clearPieceChain) G.view.clearPieceChain(); }
}
function applyRoadToolMode() {
  const tool = G.road.tool;
  const T = ROAD_TYPES[G.road.type] || ROAD_TYPES.road;
  const piece = tool === 'straight' || tool === 'curveL' || tool === 'curveR';   // fixed Lego pieces
  if (tool === 'draw') G.view.setDrawMode(true, onRouteDrawn, { type: G.road.type, elevated: G.road.elevated, rail: !!T.rail, air: !!T.air });
  else G.view.setDrawMode(false);
  G.view.setPieceMode(piece, piece ? { piece: tool, kind: T.air ? 'air' : T.rail ? 'rail' : 'road', type: G.road.type, elevated: G.road.elevated, onChain: onPieceChain } : null);
  G.view.setRoadMode(!!tool && !piece && tool !== 'draw');   // roundabout / erase use plain taps
}
// Each tap stages another fixed piece onto the pending chain — show the running
// cost in the commit bar (built first, then ONE confirm starts construction, just
// like freeform Draw). The route is the exact piece geometry (no extra smoothing).
function onPieceChain(mergedPts) {
  onRouteDrawn(mergedPts, { raw: true });
}
function selectRoadTool(tool) {
  G.road.tool = G.road.tool === tool ? null : tool;
  G.road.pending = [];
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.view.setPreview(null); G.view.setBulldoze(false); G.view.setPaintMode(false);
  applyRoadToolMode();
  G.view.showRoadPreview([]);
  refreshPanel();
  if (G.road.tool) {
    closeSheet();
    const msg = { draw: 'Draw freely by dragging. Hover an existing road end to continue from it. Release to see the cost, then Build.',
      straight: 'Tap to add straight pieces end-to-end (switch piece to turn). Build them up, then ✔ Build to start construction. R / ↻ aims the first piece.',
      curveL: 'Tap to add left-curve pieces. Chain them up, then ✔ Build to start construction. R / ↻ aims the first piece.',
      curveR: 'Tap to add right-curve pieces. Chain them up, then ✔ Build to start construction. R / ↻ aims the first piece.',
      roundabout: 'Tap to place a roundabout.', erase: 'Tap a road to remove it.' }[G.road.tool];
    toast(msg + ' ✕ Done / Esc to stop.');
  }
  updateToolBanner();
}
function toggleReclaim() {
  G.reclaim.active = !G.reclaim.active;
  if (G.reclaim.active) {
    G.build.selected = null; G.build.bulldoze = false;
    G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
    G.view.setPreview(null); G.view.setBulldoze(false);
    closeCommit(true);
    G.view.setDrawMode(true, onReclaimArea, { area: true }); // draw a loop over the sea, like trace.html
    closeSheet();
    toast('Reclaim mode: draw a loop around the sea you want to fill — release to see the cost. 🏝️ ✕ Done / Esc to stop.');
  } else {
    G.view.setDrawMode(false);
    closeCommit(true);
  }
  refreshPanel();
  updateToolBanner();
}

// ===========================================================================
// Sheets / panels
// ===========================================================================
function openPanel(panel) {
  if (G.readOnly && (panel === 'build' || panel === 'policy' || panel === 'cloud')) {
    toast('Read-only while visiting another nation.');
    return;
  }
  G.currentPanel = panel;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
  $('sheet').classList.remove('hidden');
  refreshPanel();
}

function refreshPanel() {
  const panel = G.currentPanel;
  const title = {
    build: 'Build', policy: 'Policies & Laws',
    dash: 'National Dashboard', events: 'National News', cloud: 'Save & Share',
  }[panel] || 'Panel';
  $('sheet-title').textContent = title;
  const content = $('sheet-content');
  content.innerHTML = '';

  if (panel === 'build') {
    // pick up any landmarks designed since the game loaded (without a reload)
    if (!G.readOnly) { const lib = loadLibrary(); registerLandmarks(lib); G.state.landmarks = lib; }
    content.append(renderBuild(G.state, {
      cat: G.build.cat, selected: G.build.selected, bulldoze: G.build.bulldoze, theme: G.build.theme,
      road: G.road, reclaim: G.reclaim, toggleReclaim,
      selectRoadTool, setRoadType: (t) => { G.road.type = t; applyRoadToolMode(); refreshPanel(); },
      toggleBridge: () => { G.road.elevated = !G.road.elevated; refreshPanel(); },
      setCat: (c) => { G.build.cat = c; if (c !== 'roads') { G.road.tool = null; G.view.setRoadMode(false); } if (c !== 'land') { G.reclaim.active = false; G.view.setPaintMode(false); } refreshPanel(); updateToolBanner(); },
      setTheme: (t) => { G.build.theme = t; if (G.build.selected) G.view.setPreview(G.build.selected, t); refreshPanel(); },
      selectBuilding: (k) => {
        G.build.selected = G.build.selected === k ? null : k;
        G.build.bulldoze = false; G.reclaim.active = false; G.view.setPaintMode(false);
        G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
        G.view.setPreview(G.build.selected, G.build.theme);
        refreshPanel();
        if (G.build.selected) {
          closeSheet();
          const custom = BUILDINGS[k].customizable ? ' (colour applied)' : '';
          toast(`Tap the map to place ${BUILDINGS[k].name}${custom}. ✕ Done / Esc to stop.`);
        }
        updateToolBanner();
      },
      toggleBulldoze: () => {
        G.build.bulldoze = !G.build.bulldoze;
        G.build.selected = null; G.reclaim.active = false; G.view.setPaintMode(false);
        G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
        G.view.setBulldoze(G.build.bulldoze);
        refreshPanel();
        if (G.build.bulldoze) { closeSheet(); toast('Bulldoze mode: tap buildings to remove. ✕ Done / Esc to stop.'); }
        updateToolBanner();
      },
    }));
  } else if (panel === 'policy') {
    content.append(renderPolicy(G.state, {
      readOnly: G.readOnly,
      setPolicy: (k, v) => { G.state.policies[k] = v; G.dirty = true; refreshPanel(); toast('Policy updated.'); },
      togglePolicy: (k) => { G.state.policies[k] = !G.state.policies[k]; G.dirty = true; refreshPanel(); },
    }));
  } else if (panel === 'dash') {
    content.append(renderDash(G.state, {
      borrow: (amt) => {
        if (G.readOnly) return;
        const got = issueBond(G.state, amt);
        if (got > 0) { afterEdit(); toast(`Issued ${money(got)} in bonds.`); } else toast('Borrowing limit reached.');
      },
      repay: (amt) => {
        if (G.readOnly) return;
        const paid = repayDebt(G.state, amt);
        if (paid > 0) { afterEdit(); toast(`Repaid ${money(paid)} of debt.`); } else toast('Not enough in the treasury to repay.');
      },
    }));
  } else if (panel === 'events') {
    content.append(renderNews(G.state));
  } else if (panel === 'cloud') {
    content.append(renderCloud());
  }
}

function closeSheet() {
  $('sheet').classList.add('hidden');
  G.currentPanel = null;
  document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
}

// ===========================================================================
// Events modal
// ===========================================================================
function showEvent() {
  const ev = G.state.pendingEvent;
  if (!ev) return;
  disasterForPending();
  G.prevSpeed = G.speed || 1;
  setSpeed(0);
  $('event-title').textContent = ev.title;
  $('event-body').textContent = ev.body;
  const actions = $('event-actions');
  actions.innerHTML = '';
  ev.choice.options.forEach((opt, i) => {
    const b = el('button', 'btn' + (i === 0 ? ' btn-primary' : ''), opt.label);
    b.onclick = () => {
      resolveEvent(G.state, i);
      $('event-modal').classList.add('hidden');
      afterEdit();
      setSpeed(G.prevSpeed || 1);
    };
    actions.append(b);
  });
  $('event-modal').classList.remove('hidden');
}

// Map event ids to an animated disaster in the 3D scene.
const DISASTER_FX = {
  flood: 'flood', covid: 'haze', sars: 'haze', haze: 'haze',
  oil_crisis: 'haze', recession_85: 'quake', afc: 'quake', gfc: 'quake',
};

// Notify non-choice events via toast (engine stores lastEvent) + play FX.
function maybeAnnounce() {
  if (G.state?.lastEvent) {
    const ev = G.state.lastEvent;
    toast(`📰 ${ev.title}`);
    const fx = DISASTER_FX[ev.id];
    if (fx && G.view?.playDisaster) G.view.playDisaster(fx);
    G.state.lastEvent = null;
  }
}

// Also fire FX for events that carry a player choice (e.g. flood) as they appear.
function disasterForPending() {
  const ev = G.state?.pendingEvent;
  if (!ev || ev._fxShown) return;
  ev._fxShown = true;
  const fx = DISASTER_FX[ev.id];
  if (fx && G.view?.playDisaster) G.view.playDisaster(fx);
}

// ===========================================================================
// Cloud save / share
// ===========================================================================
function renderCloud() {
  const wrap = el('div');
  const info = el('div', 'cloud-info');
  if (G.cloud) {
    const link = `${location.origin}/world/${G.cloud.id}`;
    info.innerHTML = `Your nation is saved on the cloud. Share this link so others can <b>visit your Singapore</b>:`;
    wrap.append(info);
    const share = el('div', 'share-row');
    const input = el('input'); input.value = link; input.readOnly = true;
    const copy = el('button', 'btn tiny', 'Copy');
    copy.onclick = () => { navigator.clipboard?.writeText(link); toast('Link copied!'); };
    share.append(input, copy);
    wrap.append(share);
  } else {
    info.innerHTML = 'Save your nation to <b>the cloud server</b> to keep it forever and let other players visit. Local progress is auto-saved on this device.';
    wrap.append(info);
  }

  // public toggle
  const pub = el('label', 'checkbox');
  pub.innerHTML = `<input type="checkbox" id="cl-public" checked> List my nation publicly so others can visit`;
  wrap.append(pub);

  const saveBtn = el('button', 'btn btn-primary big', G.cloud ? 'Update Cloud Save' : 'Save to Cloud');
  saveBtn.onclick = () => cloudSave($('cl-public')?.checked !== false);
  wrap.append(saveBtn);

  const localBtn = el('button', 'btn big', 'Save Locally Now');
  localBtn.onclick = () => { saveLocal(); toast('Saved on this device.'); };
  wrap.append(localBtn);

  const browseBtn = el('button', 'btn big', 'Visit Other Nations');
  browseBtn.onclick = () => { closeSheet(); openBrowser(); };
  wrap.append(browseBtn);

  return wrap;
}

async function cloudSave(isPublic) {
  if (G.readOnly) return;
  toast('Saving to cloud…');
  G.state.landmarks = loadLibrary(); // bundle your designs so visitors can see them
  refreshSummary(G.state);
  try {
    if (G.cloud) {
      await api.updateWorld(G.cloud.id, G.cloud.token, {
        name: G.state.name, owner: G.state.owner, state: G.state, isPublic,
      });
    } else {
      const res = await api.createWorld({
        name: G.state.name, owner: G.state.owner, state: G.state, isPublic,
      });
      G.cloud = { id: res.id, token: res.token };
    }
    G.dirty = false;
    saveLocal();
    toast('Saved to cloud');
    if (G.currentPanel === 'cloud') refreshPanel();
  } catch (err) {
    toast('Cloud save failed: ' + err.message);
  }
}

function saveLocal() {
  if (!G.state || G.readOnly) return;
  G.state.landmarks = loadLibrary(); // keep your designs travelling with the save
  try {
    localStorage.setItem(LS_SAVE, JSON.stringify({ state: G.state, cloud: G.cloud }));
  } catch { /* quota */ }
}

// ===========================================================================
// World browser / visiting
// ===========================================================================
async function openBrowser() {
  G.currentPanel = 'browse';
  $('sheet-title').textContent = 'Visit Other Nations';
  $('sheet').classList.remove('hidden');
  const content = $('sheet-content');
  content.innerHTML = '';
  content.append(el('div', 'empty', 'Loading nations…'));
  try {
    const { worlds } = await api.listWorlds({ limit: 50 });
    content.innerHTML = '';
    if (!worlds.length) {
      content.append(el('div', 'empty', 'No public nations yet. Be the first to save one to the cloud!'));
      const back = el('button', 'btn big', '← Back');
      back.onclick = closeSheet;
      content.append(back);
      return;
    }
    for (const w of worlds) {
      const card = el('div', 'world-card');
      const mine = G.cloud && G.cloud.id === w.id;
      card.innerHTML = `
        <div class="wc-head">
          <span class="wc-name">${escapeHtml(w.name)} ${mine ? '⭐' : ''}</span>
          <span class="wc-owner">by ${escapeHtml(w.owner)}</span>
        </div>
        <div class="wc-stats">
          <span>📅 <b>${w.year}</b></span>
          <span>👥 <b>${num(w.population)}</b></span>
          <span>🙂 <b>${pct(w.approval)}</b></span>
          <span>💵 <b>${money(w.treasury)}</b></span>
        </div>`;
      const visit = el('button', 'btn tiny', mine ? 'Open my nation' : '👁️ Visit');
      visit.onclick = () => { closeSheet(); mine ? loadMine(w.id) : visitWorld(w.id); };
      card.append(visit);
      content.append(card);
    }
  } catch (err) {
    content.innerHTML = '';
    content.append(el('div', 'empty', 'Could not load nations: ' + err.message));
  }
}

async function visitWorld(id) {
  showGameShell(false);
  toast('Loading nation…');
  try {
    const world = await api.loadWorld(id);
    G.state = world.state;
    G.readOnly = true;
    G.cloud = null;
    // attachState() registers this world's landmarks BEFORE rendering, then
    // setStates + centres the camera — so visitors see what the owner built.
    attachState();
    $('visit-name').textContent = `${world.name} (by ${world.owner})`;
    $('visit-banner').classList.remove('hidden');
    setSpeed(0);
    toast('👁️ Visiting — press ▶ to watch it run. Building is disabled.');
  } catch (err) {
    toast('Could not load: ' + err.message);
    showMenu();
  }
}

async function loadMine(id) {
  showGameShell(false);
  try {
    const world = await api.loadWorld(id);
    G.state = world.state;
    G.readOnly = false;
    $('visit-banner').classList.add('hidden');
    attachState();
    saveLocal();
    setSpeed(1);
    toast('Resumed your nation.');
  } catch (err) { toast('Load failed: ' + err.message); }
}

function leaveVisit() {
  $('visit-banner').classList.add('hidden');
  G.readOnly = false;
  if (localStorage.getItem(LS_SAVE)) continueGame();
  else showMenu();
}

// ===========================================================================
// Toast + utilities
// ===========================================================================
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Periodic local autosave + announce non-choice events.
setInterval(() => { if (G.state && !G.readOnly) saveLocal(); }, 15000);
setInterval(maybeAnnounce, 1200);

window.addEventListener('beforeunload', () => { if (!G.readOnly) saveLocal(); });

boot();
