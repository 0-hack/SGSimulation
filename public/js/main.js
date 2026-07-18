// Main controller: boots the menu, runs the game loop, wires the UI & cloud.
import {
  newGame, tickDay, build, demolish, queueDemolish, queueDemoVisual, canPlace, derive, fireDamage,
  resolveEvent, snapshot, refreshSummary, ensureGrid, packState, issueBond, repayDebt,
  projectProgress, checkProjects,
  reclaimLand, reclaimCost, buildingCost, priced, placeProp, removeProp, placeBridge, removeBridge,
  routeLength, addRoadwork, smoothRoute, spliceRoad,
  polyArea, reclaimAreaCost, addReclaimArea,
  roadEraseCover, eraseRoadsAlong,
} from './engine.js';
import { Scene3D } from './scene3d.js';
import { refreshRoadsLive } from './roadsLive.js';
import { api } from './api.js';
import {
  updateHud, renderBuild, renderPolicy, renderDash, renderNews,
  money, num, pct, el,
} from './ui.js';
import { BUILDINGS, CATEGORIES, POP_SCALE, ROAD_TYPES, PLANTS, SURFACE_TYPES, landmarkToBuilding, communityBuildToBuilding, SANDBOX } from './data.js';
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

// Fetch the community list once (per sort/filter) into G.community, then re-render.
// Caching in state avoids losing an in-flight fetch to a panel re-render.
async function loadCommunity() {
  G.community.loading = true; G.community.list = null; if (G.currentPanel === 'build') refreshPanel();
  try {
    const q = `/api/builds?sort=${G.community.sort}${G.community.func ? `&func=${G.community.func}` : ''}&limit=40`;
    const data = await fetch(q).then((r) => r.json());
    G.community.list = (data && data.builds) || [];
  } catch (e) { G.community.list = 'error'; }
  G.community.loading = false;
  if (G.currentPanel === 'build') refreshPanel();
}

// Download a COMMUNITY build (counts toward its popularity), register it as a
// buildable definition (priced by its size & era, like everything else) and select
// it so the player just taps the map to construct it.
async function downloadCommunity(build) {
  try {
    const full = await fetch(`/api/builds/${build.id}/download`, { method: 'POST' }).then((r) => r.json());
    if (!full || full.error || !full.design) { toast('Could not download that build.', true); return; }
    const [key, def] = communityBuildToBuilding(full);
    BUILDINGS[key] = def;
    // persist the definition INTO the save: without this, reloading orphans every
    // placed copy (zero output + a crash on inspect) since BUILDINGS is in-memory only.
    if (G.state) (G.state.communityDefs = G.state.communityDefs || {})[key] = def;
    clearAdjustSilently();
    G.build.selected = key; G.build.bulldoze = false;
    G.view.setPreview(key, null);
    refreshPanel(); updateToolBanner(); closeSheet();
    toast(`⬇ ${def.name} ready — tap the map to build it (${money(buildingCost(G.state, key))}).`);
  } catch (e) { toast('Download failed: ' + e.message, true); }
}

const LS_SAVE = 'sg_save_v1';
const LS_NAME = 'sg_owner';

// Time speed. The player picks a base rate in IN-GAME DAYS PER REAL SECOND
// (G.dayRate); Play / Fast / Hyper multiply it. Day/night is locked to the
// calendar (1 in-game day = one sun cycle) and advances at the SAME rate as the
// date at every stock speed, so the clock, the weather and the calendar agree.
const SPEED_MULT = [0, 1, 5, 20];   // pause / play / fast / hyper multipliers
// Max in-game days/sec the day-night cycle VISIBLY advances. Covers every stock
// speed at the default rate (Hyper = 0.1 × 20 = 2 d/s), so the sun, the weather and
// the date all run in lockstep on the calendar — the cap only kicks in at extreme
// custom rates, where a faster cycle would just strobe the lighting.
const SUN_CAP = 2;
// Airport runways must be on flat ground. If the chosen strip varies in height by
// more than FLAT_TOL, the player pays EARTHWORK_RATE per m³ of earth moved to level it.
// Airport runways AND railways are laid on flat/graded ground: if the strip crosses
// terrain that varies by more than FLAT_TOL, the player pays EARTHWORK_RATE per m³ to
// cut the hills (and fill the dips) to a smooth line.
const FLAT_TOL = 1.5;               // metres of height variation tolerated before clearing/flattening is required
const EARTHWORK_RATE = 0.012;       // $M per m³ of cut/fill (× live price index)
const SLOPE_TOL = 0.7;              // ground unevenness (world units) under a footprint before a foundation is offered
// Does the footprint at (x,y) need a foundation? Returns {flo,fhi,range} or null.
function slopeFoundation(x, y) {
  if (!G.view || !G.view.footprintLevels) return null;
  const lv = G.view.footprintLevels(x, y);
  return (lv && lv.range > SLOPE_TOL) ? { flo: lv.lo, fhi: lv.hi, range: lv.range } : null;
}
const currentRate = () => G.dayRate * SPEED_MULT[G.speed];

const $ = (id) => document.getElementById(id);

// Demolish road brush: world-radius of the bulldozer. A single click tears out a
// chunk this wide; a drag sweeps a stroke of it (like painting). ~1.6 tiles.
const DEMO_BRUSH = 4;

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
  build: { cat: 'residential', selected: null, bulldoze: false, theme: null, rot: 0 },
  community: { sort: 'downloads', func: '', list: null, loading: false },   // browse state + cached results for the Community tab
  adjust: null,                 // { x, y, key, theme, rot, wx, wz } — a placed-but-not-yet-committed object being positioned (wx/wz = exact world spot)
  demoSel: new Map(),           // Demolish multi-select: key -> target ({kind,x,y|i,poly,label}). Committed (timed) on Done.
  demoHover: null,              // the Demolish target currently under the cursor (shown red alongside the selection)
  demoCuts: [],                 // freehand road-erase strokes: { id, stroke:[{x,z}], radius, polys:[[{x,z}]] }. Committed on Done.
  demoCutId: 0,                 // running id for road-erase strokes
  demoRoadPreview: null,        // live hover preview (road chunk under the cursor) — what a click would cut
  pieceRot: 0,                  // running orientation of the road piece being aimed (for the dial)
  road: { tool: null, type: 'road', elevated: false, pending: [] },
  bridge: { active: false, w: 1.6, rot: 0, pending: null },  // Bridge tool: tap the river to drop a deck that auto-fits bank to bank; move/rotate/width then ✓ Done
  reclaim: { active: false },  // land-reclamation tool: tap sea to fill land
  plant: { active: false, kind: null },  // Plants tool: tap to place individual tropical specimens
  surface: { active: false, type: 'concrete', scale: 1 },  // Surface-paint tool: drag to paint ground surfaces (brush scale in cells)
  editPause: false,            // true while a build/road/reclaim tool is active — freezes time & the world

  currentPanel: null,
  dirty: false,          // unsaved changes since last cloud save
};

// ===========================================================================
// Boot
// ===========================================================================
const BUILD = '2026-06-16 · guided-projects v36' + (SANDBOX ? ' · 🧪 SANDBOX' : '');
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

  // ✓ Done: confirm the object you're positioning / commit the demolish selection,
  // else exit place mode.
  $('tool-banner-stop').onclick = () => { if (G.bridge.pending) commitBridge(); else if (G.adjust) commitAdjust(); else if (G.build.bulldoze && demoCount()) commitDemolish(); else cancelTools(); };
  // 🗑 Remove: discard the object you're positioning, or clear the demolish selection.
  $('tool-banner-remove').onclick = () => { if (G.bridge.pending) cancelBridge('Removed.'); else if (G.adjust) cancelAdjust('Removed.'); else if (G.build.bulldoze && demoCount()) { clearDemoSelection(); toast('Selection cleared.'); } };
  // ⛰ Cut / 🏗 Lift: switch a sloped building between excavated and elevated.
  $('tool-banner-found').onclick = () => toggleFoundation();
  $('tool-banner-rotate').onclick = () => {
    if (G.bridge.pending) setBridgeRot((G.bridge.pending.rot || 0) + Math.PI / 4);
    else if (G.adjust) rotateAdjust(Math.PI / 4);         // 45° snap (drag/dial give any angle)
    else if (G.view && G.view.pieceMode) rotatePieceBy(Math.PI / 4);
    else if (G.build.selected) rotateBuild(Math.PI / 4);  // 45° per tap (pre-aims the ghost)
  };
  // commit bar for a drawn route / reclaim area
  $('dc-build').onclick = () => { const fn = G._pendingCommit; closeCommit(false); if (fn) fn(); };
  $('dc-cancel').onclick = () => { closeCommit(true); toast('Discarded.'); };
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape' && G._pendingCommit) { closeCommit(true); toast('Discarded.'); e.preventDefault(); return; }
    if (e.key === 'Escape' && G.bridge.pending) { cancelBridge('Cancelled.'); e.preventDefault(); return; }
    if (e.key === 'Escape' && G.adjust) { cancelAdjust('Cancelled.'); e.preventDefault(); return; }
    if (e.key === 'Escape' && G.build.bulldoze && demoCount()) { clearDemoSelection(); toast('Selection cleared.'); e.preventDefault(); return; }
    if (e.key === 'Escape' && activeTool()) { cancelTools(); toast('Stopped placing.'); e.preventDefault(); }
    if (e.key === 'r' || e.key === 'R') {
      if (G.bridge.pending) { setBridgeRot((G.bridge.pending.rot || 0) + Math.PI / 4); e.preventDefault(); }
      else if (G.adjust) { rotateAdjust(Math.PI / 4); e.preventDefault(); }
      else if (G.view && G.view.pieceMode) { rotatePieceBy(Math.PI / 4); e.preventDefault(); }
      else if (G.build.selected) { rotateBuild(Math.PI / 4); e.preventDefault(); }
    }
  });
  // The facing dial in the banner is draggable for fine angle (Sims-style),
  // complementing drag-to-rotate on the building itself.
  setupRotDialDrag();

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

  // If a New Game reloaded the page to pick up a base-map edit, show the loading
  // overlay straight away so the menu doesn't flash before the game resumes.
  try { if (sessionStorage.getItem('sg-newgame')) showLoading('Building the 3D city…'); } catch {}
  // Record the base-map signature; and if a New Game reloaded the page to pick up
  // a coast/reservoir/sands edit, resume that New Game now that the scene is fresh.
  fetchMapSig().then((s) => {
    mapSig = s;
    let pending = null; try { pending = sessionStorage.getItem('sg-newgame'); sessionStorage.removeItem('sg-newgame'); } catch {}
    if (pending) { try { const p = JSON.parse(pending); if (p.name) $('m-nation').value = p.name; if (p.owner) $('m-owner').value = p.owner; } catch {} startNew(); }
  });

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

// Probe each WebGL flavour on a FRESH canvas (a canvas locks to one context type
// once created) and report the GPU when available — so a failure tells us whether
// WebGL is genuinely unavailable vs. some other init error.
function webglProbe() {
  const lines = [];
  for (const n of ['webgl2', 'webgl', 'experimental-webgl']) {
    const c = document.createElement('canvas'); let s = 'null', e = '';
    try {
      const g = c.getContext(n);
      if (g) { s = 'OK'; try { const d = g.getExtension('WEBGL_debug_renderer_info'); s = 'OK — ' + (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)); } catch (_) {} }
    } catch (ex) { e = ex.message; }
    lines.push(n + ': ' + s + (e ? ' (' + e + ')' : ''));
  }
  return lines.join('\n');
}
// Show the 3D-init failure ON the page (copyable/screenshot-able) with a WebGL
// probe and Safari guidance, instead of a dead-end "needs WebGL" alert.
function reportSceneError(err) {
  const diag = webglProbe();
  try { console.error('3D init failed:', err); console.error('WebGL probe:\n' + diag); } catch (_) {}
  const off = !/OK/.test(diag); // no WebGL flavour succeeded at all
  let box = document.getElementById('gl-error');
  if (!box) { box = document.createElement('div'); box.id = 'gl-error'; document.body.appendChild(box); }
  box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;max-height:64vh;overflow:auto;z-index:99999;background:#241015;color:#ffe;border:1px solid #c2566b;border-radius:10px;padding:14px 16px;font:12px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap';
  box.textContent =
    'The 3D view could not start.\n\n' +
    'Error: ' + ((err && err.message) || err) + '\n\n' +
    'WebGL on this browser:\n' + diag + '\n\n' +
    (off
      ? 'WebGL appears DISABLED here. In Safari: Settings ▸ Advanced ▸ "Show features for web developers", then Develop ▸ Feature Flags — make sure WebGL/WebGL 2.0 is ON; turn OFF Lockdown Mode for this site; use Safari 15+. On iPhone/iPad use Safari (not an in-app browser). Then reload.'
      : 'WebGL is available, so this is a different init error — please screenshot this whole box and send it.') +
    '\n\n(tap to dismiss)';
  box.onclick = () => box.remove();
}

// ---- loading overlay -------------------------------------------------------
// Building a new game seeds the state and (re)builds the 3D scene — terrain plus
// the dense 1966 road network — which blocks for a moment. Show an overlay so the
// player sees it's working instead of a frozen menu.
function showLoading(msg) { const el = $('loading'); if (!el) return; setLoadingMsg(msg || 'Laying out the island…'); el.classList.remove('hidden', 'fade'); }
function setLoadingMsg(msg) { const m = $('loading-msg'); if (m && msg) m.textContent = msg; }
function hideLoading() { const el = $('loading'); if (!el) return; el.classList.add('fade'); setTimeout(() => el.classList.add('hidden'), 380); }
// Resolve only after the browser has actually painted (double rAF), so an overlay
// shown right before heavy synchronous work is visible while that work runs.
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function showGameShell(playing = true) {
  $('menu').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('toolbar').classList.remove('hidden');
  if (!G.view) {
    try {
      G.view = new Scene3D($('city'), { onTileTap: onTileTap, onGroundTap: onGroundTap, onDemolishHover: onDemolishHover, onDemolishStroke: onDemolishStroke, onAdjustRotate: onAdjustRotate, onDisaster: onDisaster, onFireHover: onFireHover, onProgressHover: onProgressHover });
      window.__sgview = G.view; // exposed for debugging / disaster FX hooks
    } catch (err) {
      reportSceneError(err);
      showMenu();
      return;
    }
  }
  G.view.resize();
  // start the date accumulator on the same day-fraction as the visible clock, so the
  // calendar flips at the visible MIDNIGHT (not mid-morning) and stays in phase.
  G.acc = ((G.view.gameDays % 1) + 1) % 1;
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

// Signature of the non-road base map (coast/reservoir/sands/railway) at the time
// the page loaded. New Game compares against the live one to know whether those
// features were edited (tracer "Save to map") and the 3D scene needs rebuilding.
let mapSig = null;
async function fetchMapSig() { try { const r = await fetch('/api/trace/mapsig'); return (await r.json()).sig || ''; } catch { return ''; } }

async function startNew() {
  const name = $('m-nation').value.trim() || 'New Singapura';
  const owner = $('m-owner').value.trim() || 'Anonymous';
  localStorage.setItem(LS_NAME, owner);
  showLoading('Seeding 1965 Singapore…');
  await nextPaint();                       // let the overlay paint before the heavy work
  // Pull the freshest base map before seeding, so a road edit saved via the tracer
  // ("Save to map") shows up in this new game without needing a browser reload.
  // First-ever game also builds Scene3D after this, so its mask/decor are fresh too.
  await refreshRoadsLive();
  // Roads refresh live above, but coast/reservoir/sands/railway are baked into the
  // 3D scene once at creation. If they were edited since load, reload the page to
  // rebuild the scene cleanly, resuming this New Game right after (see boot()).
  const sig = await fetchMapSig();
  if (mapSig !== null && sig && sig !== mapSig) {
    setLoadingMsg('Updating the base map…');
    try { sessionStorage.setItem('sg-newgame', JSON.stringify({ name, owner })); } catch {}
    location.reload(); return;             // overlay stays up; boot() resumes with it on reload
  }
  G.state = newGame({ name, owner });
  G.cloud = null;
  G.readOnly = false;
  G.dirty = true;
  $('visit-banner').classList.add('hidden');
  setLoadingMsg('Building the 3D city…');
  await nextPaint();
  showGameShell();
  await nextPaint();                       // tick the spinner between the two heavy steps
  attachState();
  saveLocal();
  hideLoading();
  toast('A new nation is born. 🇸🇬');
  // Start on the clean map (no build sheet) so the player sees the whole island first.
}

async function continueGame() {
  const raw = localStorage.getItem(LS_SAVE);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    showLoading('Loading your saved nation…');
    await nextPaint();
    G.state = data.state;
    G.cloud = data.cloud || null;
    G.readOnly = false;
    $('visit-banner').classList.add('hidden');
    showGameShell();
    await nextPaint();
    attachState();
    hideLoading();
    toast('Welcome back, Prime Minister.');
  } catch {
    hideLoading();
    toast('Could not load saved game.');
  }
}

function attachState() {
  ensureGrid(G.state); // migrate older/smaller saves to the current map size + roads
  _decFxSeen.clear();  // per-state decision uids restart at 0 — forget the last game's
  // Designed landmarks become buildable: the landmarks saved INTO this world
  // (so visitors see them too) plus — when it's your own game — your personal
  // library from this browser. Your library is also snapshotted into the world.
  registerLandmarks(G.state.landmarks || []);
  if (!G.readOnly) { const lib = loadLibrary(); registerLandmarks(lib); G.state.landmarks = lib; }
  // community-downloaded buildings saved into this world become resolvable again
  // (their defs live in the save, so placed copies work after reload & for visitors)
  for (const [k, def] of Object.entries(G.state.communityDefs || {})) BUILDINGS[k] = def;
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

  if (G.state && G.speed > 0 && !G.editPause) {
    // drive the day/night sun & weather clock in lockstep with the date: the clock
    // gets the SAME sim-days the date accumulates (weather stays on the calendar);
    // only the visible sun is capped at extreme custom rates so it doesn't strobe.
    const rate = currentRate();
    if (G.view) G.view.advanceClock(dt * rate, dt * Math.min(rate, SUN_CAP));
    G.acc += dt * rate;
    let ticks = 0;
    const rwBefore = (G.state.roadworks || []).length;
    while (G.acc >= 1 && ticks < 60) {
      tickDay(G.state);
      G.acc -= 1;
      ticks++;
    }
    if (ticks > 0) {
      G.dirty = true;
      G.hudTimer += dt;
      if (G.view) { G.view.syncConstruction(G.state); G.view.syncDemolition(G.state); G.view.syncReclamation(G.state); G.view.syncRoadworks(G.state); // advance sites/teardowns/land/routes
        if ((G.state.roadworks || []).length < rwBefore) { G.view.rebuildRoadNet(); G.view._buildPlayerRailways(G.state); G.view._buildPlayerAirstrips(G.state); } } // a route finished -> render it for real
      updateHud(G.state, G.readOnly);
      updateShortages();
      flushProjectToasts();             // a national project may have just topped out
      // refresh open live panels occasionally
      if (G.currentPanel === 'dash' && G.hudTimer > 0.5) { refreshPanel(); G.hudTimer = 0; }
    }
  }

  renderDecisions();                    // keep the (non-blocking) decisions panel in sync
  if (G.view) { G.view.render(); updateWeatherHud(); }
}
// While the tab is hidden, rAF is suspended — the first frame back would otherwise
// carry the WHOLE away-time as one delta and leap the date forward by hours of game
// time. Dropping the frame anchor makes the resume frame a clean dt=0 restart.
document.addEventListener('visibilitychange', () => { if (!document.hidden) G.lastFrame = 0; });

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
  // Pull the live climate (reservoir yield + heat load) from the 3D weather into the
  // sim so a drought squeezes water supply and a heatwave lifts power demand.
  if (G.view && G.view.climate && G.state) { G.state.climate.water = G.view.climate.water; G.state.climate.heat = G.view.climate.heat; }
  const d = derive(G.state);
  const power = d.powerRatio < 1;
  const water = d.waterRatio < 1;
  G.view.setShortages({ power, water, powerRatio: d.powerRatio, waterRatio: d.waterRatio });

  const alerts = $('alerts');
  const msgs = [];
  // Active national projects come first — a live build checklist guiding the player.
  for (const p of projectProgress(G.state, d)) {
    const parts = p.items.map((it) => `${BUILDINGS[it.key] ? BUILDINGS[it.key].name : it.key} ${it.have}/${it.count}`);
    msgs.push({ t: `📋 ${p.title}: ${parts.join(', ')}`, warn: false, proj: true });
  }
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
  for (const m of msgs.slice(0, 4)) {
    alerts.append(el('div', 'alert' + (m.warn ? ' warn' : '') + (m.proj ? ' project' : ''), m.t));
  }
}
// Celebrate any national project the player just finished (engine flags them).
function flushProjectToasts() {
  const done = G.state && G.state.justCompleted;
  if (done && done.length) {
    for (const title of done) toast(`🎉 National project complete — ${title}! The nation reaps the reward.`);
    G.state.justCompleted = [];
  }
  // Announce world inventions that have just become available to adopt.
  const tech = G.state && G.state.newTech;
  if (tech && tech.length) {
    for (const name of tech) toast(`🌍 New in the world: ${name} — build it when you can afford it.`);
    G.state.newTech = [];
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

function onTileTap(x, y, world, landmark) {
  if (G.readOnly) { toast('You are visiting — building is disabled here.'); return; }
  // Plants tool: tap open ground to place a specimen; tap directly on a plant to remove it.
  if (G.plant.active && G.plant.kind && world) {
    if (G.view.removePlantNear(world.x, world.z, 1.0)) { G.dirty = true; }
    else { G.view.addPlant(world.x, world.z, G.plant.kind, Math.random() * Math.PI * 2, 0.85 + Math.random() * 0.4); G.dirty = true; }
    return;
  }
  // Bridge tool: the first tap on the river drops a pending bridge; further taps MOVE
  // it. The deck AUTO-FITS bank to bank along its angle — rotate and the fit follows;
  // the panel slider sets only the width. ✓ builds it.
  if (G.bridge.active && !G.build.bulldoze && world) {
    const rot = G.bridge.pending ? G.bridge.pending.rot : G.bridge.rot;
    const fit = G.view.fitBridgeAt(world.x, world.z, rot);
    if (!fit) { toast('Tap ON the river — the bridge sizes itself bank to bank. Rotate if it cannot reach a bank at this angle.'); return; }
    if (!G.bridge.pending) {
      G.bridge.pending = { ...fit, w: G.bridge.w, rot };
      toast('Positioning bridge — it fits the banks itself · tap to move · drag the dial to rotate · panel slider sets width · ✓ Done.');
    } else Object.assign(G.bridge.pending, fit);
    G.view.setBridgePreview(G.bridge.pending);
    updateToolBanner();
    return;
  }
  const b = G.build;
  if (b.bulldoze) {
    // Multi-select: a tap TOGGLES the item under the cursor in/out of the teardown
    // selection (tap a red one again to undo). Nothing is removed until ✓ Done.
    // `landmark` (e.g. the airport) is a fixed structure the 3D pick hit directly.
    const t = landmark ? { kind: landmark.kind || 'landmark', id: landmark.id, part: landmark.part, i: landmark.i, label: landmark.label } : findDemoTarget({ x, y }, world);
    if (t) {
      const key = demoKey(t);
      if (G.demoSel.has(key)) G.demoSel.delete(key);        // tap a selected (red) item again -> undo
      else G.demoSel.set(key, { ...t, key });
      refreshDemoVisual();
      updateToolBanner();
      return;
    }
    // No discrete object under the cursor → Cities-Skylines-style road bulldozer:
    // a click tears out a brush-sized chunk of the road right here (drag for more).
    if (world) {
      const polys = roadEraseCover(G.state.roads, [{ x: world.x, z: world.z }], DEMO_BRUSH);
      if (polys.length) {
        G.demoCuts.push({ id: ++G.demoCutId, stroke: [{ x: world.x, z: world.z }], radius: DEMO_BRUSH, polys });
        refreshDemoVisual();
        updateToolBanner();
        return;
      }
    }
    toast('Nothing to demolish here — point at a building, tree or landmark, or a road.');
    return;
  }
  // While positioning a placed object, a tap MOVES it to the exact spot (sub-cell).
  if (G.adjust) {
    let tx = x, ty = y, wx = world && world.x, wz = world && world.z;
    if (G.adjust.key === 'mrt') { const s = G.view._nearestTrackCell(x, y, 4, true); if (s && placementOk(s.x, s.y)) { tx = s.x; ty = s.y; wx = undefined; wz = undefined; alignAdjustToViaduct(tx, ty); } }
    if (!placementOk(tx, ty)) { toast('Can\'t put it there.'); return; }
    const mf = G.adjust.key === 'mrt' ? null : slopeFoundation(tx, ty);   // re-evaluate the slope at the new spot
    G.adjust.flo = mf ? mf.flo : null; G.adjust.fhi = mf ? mf.fhi : null;
    if (mf) { if (!G.adjust.fmode) G.adjust.fmode = 'lift'; G.adjust.fy = G.adjust.fmode === 'lift' ? mf.fhi : mf.flo; }
    else { G.adjust.fmode = null; G.adjust.fy = null; }
    G.adjust.x = tx; G.adjust.y = ty; G.adjust.wx = wx; G.adjust.wz = wz; G.view.moveAdjust(tx, ty, wx, wz, G.adjust.fy, G.adjust.fmode);
    updateToolBanner();
    return;
  }
  const heritage = G.view.heritageAt && G.view.heritageAt(x, y);
  if (b.selected) {
    // MRT stations snap onto the MRT line you've drawn (cell-locked, no free offset).
    let tx = x, ty = y, wx = world && world.x, wz = world && world.z;
    if (b.selected === 'mrt') { const s = G.view._nearestTrackCell(x, y, 4, true); if (s && placementOk(s.x, s.y)) { tx = s.x; ty = s.y; wx = undefined; wz = undefined; } }
    // Street furniture (a lamp / signal) is a PROP: it isn't grid-bound, so it can be
    // dropped FREELY at the kerb / verge / even over a road — land is the only rule.
    const isProp = !!(BUILDINGS[b.selected] && BUILDINGS[b.selected].prop);
    if (isProp) {
      if (!G.view.isLand(tx, ty)) { toast('You can only place it on land. 🏝️'); return; }
    } else if (!placementOk(tx, ty)) {
      if (G.view.heritageAt && G.view.heritageAt(tx, ty)) toast(`🏛 ${G.view.heritageAt(tx, ty)} — a 1965 landmark already stands here.`);
      else if (!G.view.isLand(tx, ty)) toast('You can only build on land. 🏝️');
      else if (G.view.isRoadAt(tx, ty)) toast('There is a road here — you can\'t build on the road. 🛣️');
      else toast('Tile occupied.');
      return;
    }
    // Don't build yet: place a PENDING object you can rotate / move / remove first.
    const theme = BUILDINGS[b.selected].customizable ? b.theme : null;
    let rot = b.rot || 0;
    if (b.selected === 'mrt') { const w = G.view.worldOfCell(tx, ty); const info = G.view._viaductInfoAt(w.x, w.z, 2.5 * 2.2); if (info) rot = info.bearing; } // face along the track
    // On steep/uneven ground the building gets a foundation so it isn't buried by
    // the slope: default to ELEVATE (a platform up to the high side, always fully
    // visible); the player can switch to EXCAVATE (cut the hill open) in the banner.
    // Props sit straight on the ground (no foundation).
    const fnd = (b.selected === 'mrt' || isProp) ? null : slopeFoundation(tx, ty);
    const fmode = fnd ? 'lift' : null, fy = fnd ? fnd.fhi : null;
    G.adjust = { x: tx, y: ty, key: b.selected, prop: isProp, theme, rot, wx, wz, fy, fmode, flo: fnd ? fnd.flo : null, fhi: fnd ? fnd.fhi : null };
    G.view.enterAdjust(tx, ty, b.selected, theme, G.adjust.rot, wx, wz, fy, fmode);
    updateToolBanner();
    if (isProp) { toast(`Positioning ${BUILDINGS[b.selected].name}. Drag to rotate · tap to move · ✓ Done — drop it right at the kerb.`); return; }
    const linked = b.selected === 'mrt' && (tx !== x || ty !== y) ? ' Linked to the MRT line.' : '';
    const slope = fnd ? ' Uneven ground — 🏗 Elevated on a platform; tap ⛰ to Excavate (cut the hill) instead.' : '';
    toast(`Positioning ${BUILDINGS[b.selected].name}.${linked}${slope} Drag it to rotate · tap to move · ✓ Done.`);
  } else {
    // inspect
    const cell = G.state.grid[y][x];
    if (cell && cell.heritage) toast(`🏛 ${cell.name || heritage || BUILDINGS[cell.k].name} (here since 1965)`);
    else if (cell) toast(`${BUILDINGS[cell.k].icon} ${BUILDINGS[cell.k].name}`);
    else if (heritage) toast(`🏛 ${heritage} (here since 1965)`);
  }
}
// Can a building stand on this cell? (land, off-road, not a landmark, not occupied.)
function placementOk(x, y) {
  if (!G.view.isLand(x, y)) return false;
  if (G.view.isRoadAt(x, y)) return false;
  if (G.view.heritageAt && G.view.heritageAt(x, y)) return false;
  return !(G.state.grid[y] && G.state.grid[y][x]);
}
// Rotate the object being positioned — it turns on the ground so you can SEE it.
function rotateAdjust(delta) {
  if (!G.adjust) return;
  G.adjust.rot = ((G.adjust.rot || 0) + delta) % (Math.PI * 2);
  G.view.setAdjustRotation(G.adjust.rot);
  updateRotDial();
}
// Switch the pending building between EXCAVATE (cut the ground level down to the
// low side) and ELEVATE (raise it on a platform up to the high side).
function toggleFoundation() {
  if (!G.adjust || G.adjust.flo == null) return;
  G.adjust.fmode = G.adjust.fmode === 'lift' ? 'cut' : 'lift';
  G.adjust.fy = G.adjust.fmode === 'lift' ? G.adjust.fhi : G.adjust.flo;
  G.view.setAdjustFoundation(G.adjust.fy, G.adjust.fmode);
  updateToolBanner();
  toast(G.adjust.fmode === 'lift' ? '🏗 Elevated on a platform.' : '⛰ Slope cut open for the building.');
}
// Turn the pending station to line up with the MRT track it just snapped onto.
function alignAdjustToViaduct(gx, gy) {
  if (!G.adjust) return;
  const w = G.view.worldOfCell(gx, gy);
  const info = G.view._viaductInfoAt(w.x, w.z, 2.5 * 2.2);
  if (info) { G.adjust.rot = info.bearing; G.view.setAdjustRotation(info.bearing); updateRotDial(); }
}
// ✓ Done — commit the positioned object: charge for it and start construction.
function commitAdjust() {
  const a = G.adjust; if (!a) return;
  if (a.prop) {                                       // free street furniture: no grid cell, no build time
    const ctr = G.view.worldOfCell(a.x, a.y);
    const wx = (a.wx != null) ? a.wx : ctr.x, wz = (a.wz != null) ? a.wz : ctr.z;
    const p = placeProp(G.state, { type: a.key, x: wx, z: wz, rot: a.rot || 0 });
    if (!p) { toast(`Need ${money(buildingCost(G.state, a.key))} to place ${BUILDINGS[a.key].name}.`); return; }
    G.view.clearAdjust(); G.view.syncProps(G.state); G.adjust = null; afterEdit();
    toast(`${BUILDINGS[a.key].icon} ${BUILDINGS[a.key].name} placed at the kerb.`);
    updateToolBanner();
    return;
  }
  if (!canPlace(G.state, a.x, a.y, a.key)) {
    if (G.state.treasury < buildingCost(G.state, a.key)) toast(`Need ${money(buildingCost(G.state, a.key))} to build ${BUILDINGS[a.key].name}.`);
    else toast('Cannot build here.');
    return;
  }
  // the slope-foundation surcharge is part of the bill — gate on BOTH up front, so the
  // charge below can't slip past the affordability check canPlace just made.
  if (a.fy != null && a.flo != null) {
    const range = Math.max(0, (a.fhi || 0) - (a.flo || 0));
    const sur = a.fmode === 'lift' ? Math.round(priced(5 + range * 5, G.state)) : Math.round(priced(3 + range * 6, G.state));
    if (G.state.treasury < buildingCost(G.state, a.key) + sur) {
      toast(`Need ${money(buildingCost(G.state, a.key) + sur)} — including ${money(sur)} for the slope foundation.`);
      return;
    }
  }
  const theme = BUILDINGS[a.key].customizable ? a.theme : null;
  build(G.state, a.x, a.y, a.key, theme);
  const cell = G.state.grid[a.y][a.x];
  let foundMsg = '';
  if (cell) {
    cell.r = a.rot || 0;                                  // keep the chosen orientation
    if (a.wx != null && a.wz != null) {                   // keep the chosen sub-cell spot (free placement)
      const ctr = G.view.worldOfCell(a.x, a.y);
      cell.ox = a.wx - ctr.x; cell.oz = a.wz - ctr.z;
    }
    if (a.fy != null && a.flo != null) {                  // foundation on a slope: store it + charge earthwork/platform + extra time
      cell.fy = a.fy; cell.fmode = a.fmode;
      const range = Math.max(0, (a.fhi || 0) - (a.flo || 0));
      const sur = a.fmode === 'lift' ? Math.round(priced(5 + range * 5, G.state)) : Math.round(priced(3 + range * 6, G.state));
      G.state.treasury -= sur;
      if (cell.build) { const extra = Math.max(2, Math.round(range * 1.5)); cell.build.total += extra; cell.build.left += extra; }
      foundMsg = a.fmode === 'lift' ? ` 🏗 Elevated on a platform (${money(sur)}).` : ` ⛰ Ground excavated to level (${money(sur)}).`;
    }
  }
  G.view.clearAdjust();
  G.view.syncConstruction(G.state);   // it now tops out over time
  G.adjust = null;
  afterEdit();
  const total = (cell && cell.build) ? cell.build.total : 30;
  const eta = fmtDur(total);
  const doneNote = total >= 300 ? `, ready ~${G.state.date.y + Math.round(total / 360)}` : '';
  toast(`🏗️ ${BUILDINGS[a.key].name} — construction started (~${eta}${doneNote}). Fast-forward to speed it up.${foundMsg}`);
  updateToolBanner();                 // back to place-mode (ready for the next one)
}
// "~3.5 yr" / "~8 mo" / "~3 wk" / "~5 d" from a count of game-days.
function fmtDur(days) {
  if (days >= 360) { const y = days / 360; return `${y % 1 === 0 ? y : y.toFixed(1)} yr`; }
  if (days >= 60) return `${Math.round(days / 30)} mo`;
  if (days >= 14) return `${Math.round(days / 7)} wk`;
  return `${Math.round(days)} d`;
}
// Discard the object being positioned (it was never charged).
function cancelAdjust(msg) {
  if (!G.adjust) return;
  G.view.clearAdjust(); G.adjust = null;
  updateToolBanner();
  if (msg) toast(msg);
}
// ---- Bridge tool: the player places the bridge personally — position (tap), angle
// (dial / R), length & width (panel sliders) — and the road snaps straight across it.
function commitBridge() {
  const b = G.bridge.pending; if (!b) return;
  const placed = placeBridge(G.state, b);
  if (!placed) { toast('Treasury too low for this bridge.'); return; }
  G.bridge.pending = null;
  G.view.setBridgePreview(null);
  G.view.rebuildRoadNet();               // the deck appears and any road over it snaps straight on top
  afterEdit();
  toast('🌉 Bridge built — the road runs straight across the deck.');
  updateToolBanner();
}
function cancelBridge(msg) {
  if (!G.bridge.pending) return;
  G.bridge.pending = null;
  if (G.view) G.view.setBridgePreview(null);
  updateToolBanner();
  if (msg) toast(msg);
}
function setBridgeRot(rad) {
  rad = ((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (G.bridge.pending) {
    // re-fit the span at the new angle from the deck's centre (mid-water); if no
    // bank is reachable at that angle, resist — keep the last good fit instead.
    const p = G.bridge.pending;
    const fit = G.view.fitBridgeAt(p.x, p.z, rad);
    if (!fit) return;
    Object.assign(p, fit, { rot: rad });
    G.bridge.rot = rad;
    G.view.setBridgePreview(p);
  } else G.bridge.rot = rad;
  updateRotDial();
}
// fully drop the tool (used when another tool takes over)
function clearBridgeTool() {
  if (G.bridge.pending && G.view) G.view.setBridgePreview(null);
  G.bridge.active = false; G.bridge.pending = null;
}
function selectBridgeTool() {
  clearAdjustSilently();
  if (demoCount() || G.demoHover) clearDemoSelection();
  const on = !G.bridge.active;
  clearBridgeTool();
  G.bridge.active = on;
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.plant.active = false; G.plant.kind = null; G.surface.active = false;
  G.road.tool = null; G.road.pending = [];
  if (G.view) { G.view.setPreview(null); G.view.setBulldoze(false); G.view.setRoadMode(false); G.view.setPaintMode(false); G.view.setDrawMode(false); G.view.setPieceMode(false); G.view.setRoundaboutPreview(false); G.view.setPlantMode(false); G.view.showRoadPreview([]); }
  refreshPanel(); updateToolBanner();
  if (G.bridge.active) { closeSheet(); toast('Bridge: tap the river where the bridge should stand — it fits the banks itself; move, rotate, set width, then ✓ Done.'); }
}
function setBridgeW(v) { G.bridge.w = v; if (G.bridge.pending) { G.bridge.pending.w = v; G.view.setBridgePreview(G.bridge.pending); } }

function afterEdit() {
  G.dirty = true;
  checkProjects(G.state);   // building may have just finished a national project
  flushProjectToasts();
  refreshSummary(G.state);
  updateHud(G.state, G.readOnly);
  updateShortages();
  if (G.currentPanel === 'build' || G.currentPanel === 'dash') refreshPanel(); // affordability/finances may change
}

// A fire in the 3D scene finished burning a building down: apply the real
// consequence. The engine records the loss (removes its output, charges the
// emergency response, dents approval / health / air quality, logs the news); the
// view drops the model. Skipped while visiting someone else's nation.
function onDisaster(info) {
  if (G.readOnly || !G.state || !info || info.kind !== 'fire') return;
  const { gx, gy } = info;
  const cell = G.state.grid?.[gy]?.[gx];
  if (!cell) return;
  const heritage = !!cell.heritage;
  const res = fireDamage(G.state, gx, gy, info.cause && info.cause.why); // nulls the grid cell + applies the hit + logs WHY
  if (heritage) { if (G.view.removeHeritageVisual) G.view.removeHeritageVisual(gx, gy); }
  else if (G.view.removeBuilding) G.view.removeBuilding(gx, gy);
  afterEdit();
  if (res) toast(`🔥 Fire! ${res.name} destroyed${info.cause ? ` — ${info.cause.label}` : ''}. $${res.cost}M response. See News for details.`);
}

// The cursor is over a blaze: show a floating card explaining what's burning and
// WHY (dry weather, no greenery, thin fire cover, tinder homes, spread, arson…).
// Owns the hover card only outside Demolish mode (where the demolish card owns it).
let _fireHoverShown = false;
function onFireHover(info) {
  if (G.build && G.build.bulldoze) { if (_fireHoverShown) { hideHoverInfo(); _fireHoverShown = false; } return; }
  if (info) { showHoverInfo(fireInfoHtml(info)); _fireHoverShown = true; }
  else if (_fireHoverShown) { hideHoverInfo(); _fireHoverShown = false; }
}
function fireInfoHtml(info) {
  const label = info.label ? `<div class="hi-stats" style="color:#e0603f">${escapeHtml(info.label)}</div>` : '';
  const why = info.why ? `<div class="hi-body">${escapeHtml(info.why)}</div>` : '';
  const tip = info.wet
    ? `<div class="hi-body" style="color:var(--teal)">Rain is dousing it — hold on and it may be saved.</div>`
    : `<div class="hi-body">Rain, Fire Stations, Police (safety) and greenery nearby help stop it before it spreads.</div>`;
  return `<b>🔥 ${escapeHtml(info.kindLabel || 'Something')} on fire</b>${label}${why}${tip}`;
}

// The cursor is over a work-in-progress (a building/road/land being built, torn
// down or reclaimed): show its progress and time LEFT. Defers to the fire card and,
// in Demolish mode, to the demolish card (which shows the same line inline).
let _progressHoverShown = false;
function onProgressHover(info) {
  if (G.build && G.build.bulldoze) { if (_progressHoverShown) { hideHoverInfo(); _progressHoverShown = false; } return; }
  if (_fireHoverShown) { if (_progressHoverShown) { hideHoverInfo(); _progressHoverShown = false; } return; }  // fire card wins
  if (info) { showHoverInfo(progressInfoHtml(info)); _progressHoverShown = true; }
  else if (_progressHoverShown) { hideHoverInfo(); _progressHoverShown = false; }
}
// A short "🏗️ Name — 62% done · ~1.3 yr left" style card for an active job.
function progressLine(info) {
  const pct = info.total ? Math.max(0, Math.min(100, Math.round((1 - info.left / info.total) * 100))) : 0;
  const verb = info.kind === 'build' ? 'Under construction' : info.kind === 'reclaim' ? 'Reclaiming land' : 'Being demolished';
  return `<div class="hi-stats">${verb} · ${pct}% done</div><div class="hi-body">⏳ ~${fmtDur(info.left)} left. Fast-forward with the speed controls to finish sooner.</div>`;
}
function progressInfoHtml(info) {
  const icon = info.kind === 'build' ? '🏗️' : info.kind === 'reclaim' ? '🏝️' : '🚜';
  return `<b>${icon} ${escapeHtml(info.label || 'Works')}</b>${progressLine(info)}`;
}

// ---- placement-tool state (build / bulldoze / reclaim / road) --------------
// You stay in "place mode" so you can place many in a row; this shows what's
// active and gives an explicit way to STOP (the ✕ Done button or Esc).
function activeTool() {
  if (G.readOnly) return null;
  if (G.build.selected && BUILDINGS[G.build.selected]) return { verb: 'build', label: BUILDINGS[G.build.selected].name };
  if (G.build.bulldoze) return { verb: 'remove', label: '🚜 Demolish' };
  if (G.plant.active && G.plant.kind) return { verb: 'plant', label: '🌿 ' + (PLANTS[G.plant.kind]?.name || 'Plant') };
  if (G.surface.active) return { verb: 'paint', label: '🎨 ' + (G.surface.type === 'clear' ? 'Clear surface' : (SURFACE_TYPES[G.surface.type]?.name || 'Surface')) };
  if (G.reclaim.active) return { verb: 'fill with land', label: '🏝 Reclaim' };
  if (G.bridge.active) return { verb: 'place a bridge', label: '🌉 Bridge' };
  if (G.road.tool) return { verb: 'draw', label: '🛣 Road · ' + G.road.tool };
  return null;
}
function updateToolBanner() {
  const t = activeTool(), el = $('tool-banner'), adjusting = !!G.adjust, bridging = !!G.bridge.pending;
  // Editing a tool freezes the clock and the living map so you can build calmly.
  setEditPause(!!t || adjusting || bridging);
  if (!el) return;
  if (!t && !adjusting && !bridging) { el.classList.add('hidden'); return; }
  const piece = G.road.tool === 'straight' || G.road.tool === 'curveL' || G.road.tool === 'curveR';
  if (bridging) {
    const b = G.bridge.pending;
    $('tool-banner-text').innerHTML = `<b>⏸ Positioning · 🌉 Bridge (fits banks: ${Math.round(b.len * 12.5)} m × ${Math.round(b.w * 12.5)} m)</b><br><span class="tb-sub">Tap the river to move · dial / ↻ to rotate (span refits) · panel slider sets width · 🗑 Remove · ✓ Done</span>`;
  } else if (adjusting) {
    const name = BUILDINGS[G.adjust.key]?.name || 'object';
    $('tool-banner-text').innerHTML = `<b>⏸ Positioning · ${name}</b><br><span class="tb-sub">Drag it to rotate · tap a new spot to move · dial / ↻ for snaps · 🗑 Remove · ✓ Done</span>`;
  } else if (G.build.bulldoze) {
    updateDemoBanner();   // shows the live selection count + hovered target
  } else {
    const rotHint = G.build.selected ? ' · drag to rotate after placing' : '';
    $('tool-banner-text').innerHTML = `<b>⏸ Edit mode · ${t.label}</b><br><span class="tb-sub">Time paused — tap the map to ${t.verb}${rotHint}</span>`;
  }
  const demoReady = G.build.bulldoze && demoCount() > 0;
  const found = $('tool-banner-found'); if (found) {
    const show = adjusting && G.adjust.flo != null;
    found.classList.toggle('hidden', !show);
    if (show) found.textContent = G.adjust.fmode === 'lift' ? '🏗 Elevated' : '⛰ Excavated';
  }
  $('tool-banner-rotate').classList.toggle('hidden', !(adjusting || piece || G.build.selected || bridging));
  $('tool-banner-remove').classList.toggle('hidden', !(adjusting || demoReady || bridging));   // 🗑 = clear the selection
  const stop = $('tool-banner-stop'); if (stop) stop.textContent = (adjusting || demoReady || bridging) ? '✓ Done' : '✕ Done';
  updateRotDial();   // show the live-facing dial alongside the rotate button
  el.classList.remove('hidden');
}
// Spin the building (and its ghost preview) before it's placed. Steps of 15° give
// effectively any-angle control; the chosen angle rides along onto the placed cell.
// The banner dial shows the live orientation so you can SEE the facing while the
// ghost itself sits under your finger on the rotate button.
function rotateBuild(delta) {
  G.build.rot = ((G.build.rot || 0) + delta) % (Math.PI * 2);
  if (G.view) G.view.setBuildRotation(G.build.rot);
  updateRotDial();
}
function rotatePieceBy(delta) {
  G.pieceRot = ((G.pieceRot || 0) + delta) % (Math.PI * 2);
  if (G.view) G.view.rotatePiece(delta);
  updateRotDial();
}
// Live "current facing" dial in the tool banner: a top-down footprint whose front
// marker spins to the chosen angle, plus the degrees. Sits at the far left of the
// banner, clear of the rotate button, so it's never hidden by the cursor.
function rotDialState() {
  if (G.bridge.pending) return { rad: G.bridge.pending.rot || 0, show: true };
  if (G.adjust) return { rad: G.adjust.rot || 0, show: true };
  if (G.build.selected) return { rad: G.build.rot || 0, show: true };
  const piece = G.road.tool === 'straight' || G.road.tool === 'curveL' || G.road.tool === 'curveR';
  if (piece && G.view && G.view.pieceMode) return { rad: G.pieceRot || 0, show: true };
  return { rad: 0, show: false };
}
// Drop the pending object without UI/toast — used when the tool/selection changes.
function clearAdjustSilently() { if (G.adjust) { if (G.view) G.view.clearAdjust(); G.adjust = null; } }
// How many things are staged for demolition (tapped objects + freehand road cuts).
function demoCount() { return G.demoSel.size + ((G.demoCuts && G.demoCuts.length) || 0); }
// Empty the Demolish selection (no teardown happens) and clear its red highlights.
function clearDemoSelection() {
  G.demoSel.clear(); G.demoHover = null; G.demoCuts = []; G.demoRoadPreview = null;
  if (G.view) { G.view.demoSetSelection([]); if (G.view.showDemoRoadHover) G.view.showDemoRoadHover([]); }
  updateToolBanner();
}
function updateRotDial() {
  const dial = $('tool-banner-dial'); if (!dial) return;
  const st = rotDialState();
  dial.classList.toggle('hidden', !st.show);
  if (!st.show) return;
  const deg = ((Math.round(st.rad * 180 / Math.PI) % 360) + 360) % 360;
  const face = dial.querySelector('.tb-dial-face');
  if (face) face.style.transform = `rotate(${deg}deg)`;   // top-down footprint turns with the building
  const d = $('tool-banner-deg'); if (d) d.textContent = deg + '°';
}
// Make the facing dial a draggable control: scrub it to set any angle precisely,
// for whatever is currently being aimed (pending object, selected building, or
// road piece). Pairs with drag-to-rotate on the building for quick + fine control.
function setupRotDialDrag() {
  const dial = $('tool-banner-dial'); if (!dial) return;
  let dragging = false;
  const angleAt = (e) => {
    const r = dial.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  const apply = (e) => {
    const rad = ((angleAt(e) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (G.bridge.pending) { setBridgeRot(rad); return; }
    if (G.adjust) { G.adjust.rot = rad; G.view.setAdjustRotation(rad); }
    else if (G.view && G.view.pieceMode) { rotatePieceBy(rad - (G.pieceRot || 0)); return; }
    else if (G.build.selected) { G.build.rot = rad; if (G.view) G.view.setBuildRotation(rad); }
    else return;
    updateRotDial();
  };
  dial.addEventListener('pointerdown', (e) => { if (!rotDialState().show) return; dragging = true; try { dial.setPointerCapture(e.pointerId); } catch {} apply(e); e.preventDefault(); e.stopPropagation(); });
  dial.addEventListener('pointermove', (e) => { if (dragging) { apply(e); e.preventDefault(); } });
  const stop = (e) => { if (dragging) { dragging = false; try { dial.releasePointerCapture(e.pointerId); } catch {} } };
  dial.addEventListener('pointerup', stop);
  dial.addEventListener('pointercancel', stop);
  dial.style.cursor = 'grab';
  dial.title = 'Drag to set the facing angle';
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
  clearAdjustSilently();
  clearBridgeTool();
  hideHoverInfo();
  if (demoCount() || G.demoHover) clearDemoSelection();
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.plant.active = false; G.plant.kind = null; G.surface.active = false;
  G.road.tool = null; G.road.pending = [];
  closeCommit(true);
  if (G.view) { G.view.setPreview(null); G.view.setBulldoze(false); G.view.setRoadMode(false); G.view.setPaintMode(false); G.view.setDrawMode(false); G.view.setPieceMode(false); G.view.setRoundaboutPreview(false); G.view.setPlantMode(false); G.view.showRoadPreview([]); }
  updateToolBanner();
  if (G.currentPanel === 'build') refreshPanel();
}
// Surface-paint tool: pick a ground surface and drag to paint it over the land.
function selectSurface(type) {
  clearAdjustSilently();
  clearBridgeTool();
  if (demoCount() || G.demoHover) clearDemoSelection();
  G.surface.type = type; G.surface.active = true;
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false; G.plant.active = false; G.plant.kind = null; G.road.tool = null;
  if (G.view) { G.view.setPreview(null); G.view.setBulldoze(false); G.view.setRoadMode(false); G.view.setDrawMode(false); G.view.setPieceMode(false); G.view.setPlantMode(false); G.view.setRoundaboutPreview(false); G.view.showRoadPreview([]); G.view.setPaintMode(true, onPaintSurface, G.surface.scale); }
  closeSheet();
  updateToolBanner();
  const nm = type === 'clear' ? 'natural ground' : (SURFACE_TYPES[type]?.name || 'surface');
  toast(`Surface paint: drag to paint ${nm}. Adjust the brush size in the panel. ✕ Done / Esc to stop.`);
}
function setSurfaceScale(scale) {
  G.surface.scale = scale;
  if (G.surface.active && G.view) G.view.setPaintMode(true, onPaintSurface, scale);
}
function onPaintSurface(x, y) {
  if (G.readOnly || !G.surface.active) return;
  G.view.paintSurfaceCell(x, y, G.surface.type);
  G.dirty = true;
}
// Plants tool: pick a tropical species and start placing single specimens.
function selectPlant(kind) {
  clearAdjustSilently();
  clearBridgeTool();
  if (demoCount() || G.demoHover) clearDemoSelection();
  G.plant.active = true; G.plant.kind = kind;
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false; G.road.tool = null;
  if (G.view) { G.view.setPreview(null); G.view.setBulldoze(false); G.view.setRoadMode(false); G.view.setDrawMode(false); G.view.setPieceMode(false); G.view.setPaintMode(false); G.view.setRoundaboutPreview(false); G.view.showRoadPreview([]); G.view.setPlantMode(true, kind); }
  closeSheet();
  updateToolBanner();
  toast(`Planting ${PLANTS[kind]?.name || 'plant'} — tap open ground to plant, tap a plant to remove it. ✕ Done / Esc to stop.`);
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
// ---- Demolish targeting ----------------------------------------------------
// What will the Demolish tool remove for a given cursor? A building (or heritage
// landmark) on the tile under the cursor wins — you're pointing AT it. Otherwise
// the nearest piece of transport infrastructure to the EXACT cursor point, but
// only within a TIGHT per-type radius (on or just beside the carriageway), so you
// hit the road you're actually over — not a random nearby one two tiles away.
function findDemoTarget(cell, world) {
  if (cell) {
    const here = G.state.grid[cell.y] && G.state.grid[cell.y][cell.x];
    if (here && !here.demolish) {                          // (a cell already being torn down is skipped below)
      // a prebuilt heritage building seeded into the grid -> target it as HERITAGE so its
      // real 3D model (which lives in the heritage group, not this.buildings) turns red.
      if (here.heritage) return { kind: 'heritage', x: cell.x, y: cell.y, label: here.name || BUILDINGS[here.k]?.name || 'Heritage building' };
      return { kind: 'building', x: cell.x, y: cell.y, label: BUILDINGS[here.k]?.name || 'building' };
    }
    if (!here) {
      const hl = G.view.heritageLabelAt && G.view.heritageLabelAt(cell.x, cell.y);  // named landmark OR decorative shophouse
      if (hl) return { kind: 'heritage', x: cell.x, y: cell.y, label: hl };
      if (G.view.hasTreeAt && G.view.hasTreeAt(cell.x, cell.y)) return { kind: 'tree', x: cell.x, y: cell.y, label: 'Trees' };
    }
  }
  if (world) return findInfraTarget(world.x, world.z);
  return null;
}
// A stable key for a demolish target (so the selection can toggle it).
function demoKey(t) {
  return t.kind === 'building' ? `b:${t.x},${t.y}` : t.kind === 'heritage' ? `h:${t.x},${t.y}`
    : t.kind === 'tree' ? `t:${t.x},${t.y}` : t.kind === 'landmark' ? `L:${t.id}`
    : t.kind === 'airportPart' ? `A:${t.part}` : t.kind === 'prop' ? `P:${t.i}` : `${t.kind}:${t.i}`;
}
// The live state-object behind an infra target (for queueing its timed teardown).
function infraRef(t) {
  if (t.kind === 'road') return G.state.roads.edges[t.i];
  if (t.kind === 'rail') return G.state.railways[t.i];
  if (t.kind === 'air') return G.state.airstrips[t.i];
  return null;
}
// Push the full red highlight (everything selected, plus the hovered item) to the
// scene so you can see exactly what a ✓ Done will tear down.
function refreshDemoVisual() {
  if (!G.view) return;
  const arr = [...G.demoSel.values()];
  if (G.demoHover && !G.demoSel.has(G.demoHover.key)) arr.push(G.demoHover);
  // freehand road cuts: a red ribbon for every covered road sub-piece
  for (const cut of (G.demoCuts || [])) (cut.polys || []).forEach((poly, j) => arr.push({ kind: 'roadcut', key: `cut:${cut.id}:${j}`, poly }));
  G.view.demoSetSelection(arr);
}
// Nearest road / railway / MRT viaduct / runway to (x,z), within its own tight hit
// radius. Returns { kind, i, poly, label } — poly is the world polyline so the
// scene can trace a red highlight over the exact piece that will be removed.
function findInfraTarget(x, z) {
  let best = null, bestD = Infinity;
  const consider = (kind, i, poly, hit, label) => {
    if (!poly || poly.length < 2) return;
    let d = 1e9; for (let k = 0; k < poly.length - 1; k++) d = Math.min(d, segPointDistW(x, z, poly[k], poly[k + 1]));
    if (d <= hit && d < bestD) { bestD = d; best = { kind, i, poly, label }; }
  };
  // NB: roads are no longer tap-targeted as whole fixed-length edges — they're
  // demolished by dragging a freehand stroke over them (onDemolishStroke). Only
  // the singular landmarks (railway/MRT viaduct, runway) are whole-edge tap targets.
  (G.state.railways || []).forEach((e, i) => {
    const pts = (e.pts || e).map((p) => ({ x: p[0], z: p[1] }));
    consider('rail', i, pts, (e.mrt ? ROAD_TYPES.mrt.width : ROAD_TYPES.railway.width) / 2 + 1.8, e.mrt ? 'MRT viaduct' : 'Railway');
  });
  (G.state.airstrips || []).forEach((e, i) => {
    const pts = (e.pts || e).map((p) => ({ x: p[0], z: p[1] }));
    consider('air', i, pts, ROAD_TYPES.airport.width / 2 + 2, 'Runway');
  });
  return best;
}
// ✓ Done in Demolish mode: commit the whole red selection as TIMED teardowns
// (they come down over a few days, like construction in reverse), then clear the
// selection. Heritage landmarks & trees (decorative, outside the economy) come down
// at once; freehand road strokes split the roads and queue the covered pieces.
function commitDemolish() {
  const cuts = G.demoCuts || [];
  if (!G.demoSel.size && !cuts.length) { cancelTools(); return; }
  const items = [];
  const propIdx = [];                    // free-placed street furniture cleared at once (a lamp is a quick job)
  const bridgeIdx = [];                  // player-placed bridges cleared at once; roads re-route after
  let maxDemo = 0;                       // longest teardown in this batch (for the toast)
  for (const t of G.demoSel.values()) {
    if (t.kind === 'prop') { propIdx.push(t.i); continue; }
    if (t.kind === 'bridge') { bridgeIdx.push(t.i); continue; }
    if (t.kind === 'building') items.push({ kind: 'building', x: t.x, y: t.y });
    else if (t.kind === 'heritage') {
      // A prebuilt heritage house that sits in the grid tears down over TIME (hoarding
      // + wrecking crane), just like a player building — no more instant vanish. A
      // purely decorative terrace with no grid cell (nothing to time) clears at once.
      const c = G.state.grid?.[t.y]?.[t.x];
      if (c && c.heritage) items.push({ kind: 'building', x: t.x, y: t.y });
      else if (G.view.removeHeritageVisual) G.view.removeHeritageVisual(t.x, t.y);
    }
    // Trees & fixed landmarks (airport) also come down over time, behind a hoarding —
    // a tree in days, a landmark over months — instead of vanishing at once.
    else if (t.kind === 'tree') { maxDemo = Math.max(maxDemo, queueDemoVisual(G.state, { kind: 'tree', x: t.x, y: t.y })); G.dirty = true; }
    else if (t.kind === 'airportPart') { maxDemo = Math.max(maxDemo, queueDemoVisual(G.state, { kind: 'airportPart', id: t.part })); G.dirty = true; }
    else if (t.kind === 'landmark') { maxDemo = Math.max(maxDemo, queueDemoVisual(G.state, { kind: 'landmark', id: t.id })); G.dirty = true; }
    else { const ref = infraRef(t); if (ref) items.push({ kind: t.kind, ref }); }
  }
  // freehand road erasers: split each covered road and queue the covered pieces
  let roadsRebuilt = false;
  for (const cut of cuts) {
    const pieces = eraseRoadsAlong(G.state.roads, cut.stroke, cut.radius || 4);
    for (const ref of pieces) items.push({ kind: 'road', ref });
    if (pieces.length) roadsRebuilt = true;
  }
  const n = G.demoSel.size + cuts.length;
  if (propIdx.length) {                  // remove props highest-index-first so earlier indices stay valid
    propIdx.sort((p, q) => q - p).forEach((i) => removeProp(G.state, i));
    G.view.syncProps(G.state); G.dirty = true;
  }
  if (bridgeIdx.length) {                // remove bridges highest-index-first; the road net re-drapes
    bridgeIdx.sort((p, q) => q - p).forEach((i) => removeBridge(G.state, i));
    roadsRebuilt = true; G.dirty = true;
  }
  if (items.length) queueDemolish(G.state, items);
  for (const it of items) { if (it.kind === 'building') { const c = G.state.grid?.[it.y]?.[it.x]; if (c && c.demolish) maxDemo = Math.max(maxDemo, c.demolish.total); } }
  G.demoSel.clear(); G.demoHover = null; G.demoCuts = []; G.demoRoadPreview = null;
  G.view.demoSetSelection([]);          // drop the selection tint; the teardown visuals take over
  if (G.view.showDemoRoadHover) G.view.showDemoRoadHover([]);
  if (roadsRebuilt && G.view.rebuildRoadNet) G.view.rebuildRoadNet();   // show the freshly-split road geometry
  G.view.syncDemolition(G.state);       // start the teardown immediately
  afterEdit();
  toast(`🚜 Demolishing ${n} item${n > 1 ? 's' : ''} — hoardings go up; cleared over ~${maxDemo ? fmtDur(maxDemo) : 'a few days'}.`);
  updateToolBanner();
}
// Dragged a freehand stroke in Demolish mode (like drawing a road, in reverse):
// mark every road portion the brush covered as a red, removable selection.
function onDemolishStroke(stroke) {
  if (G.readOnly || !G.build.bulldoze) return;
  if (!stroke || stroke.length < 1) return;
  const polys = roadEraseCover(G.state.roads, stroke, DEMO_BRUSH);
  if (!polys.length) { toast('No road under that stroke — drag along a road to demolish it.'); return; }
  G.demoCuts = G.demoCuts || [];
  G.demoCuts.push({ id: ++G.demoCutId, stroke: stroke.map((p) => ({ x: p.x, z: p.z })), radius: DEMO_BRUSH, polys });
  if (G.view.showDemoRoadHover) G.view.showDemoRoadHover([]);   // the chunk is now committed (red); drop the hover ghost
  refreshDemoVisual();
  updateToolBanner();
}
// Cursor moved in Demolish mode: track what's under it and show it red alongside
// the existing selection, so you can see what a tap will toggle. `landmark` is a
// fixed structure (e.g. the airport) the 3D pick hit directly.
// ---- hover-info: tell the player WHAT a building is before they keep/remove it ----
let _hoverInfoEl = null;
document.addEventListener('pointermove', (e) => { G._cursor = { x: e.clientX, y: e.clientY }; }, { passive: true });
function hoverInfoEl() {
  if (!_hoverInfoEl) { _hoverInfoEl = document.createElement('div'); _hoverInfoEl.className = 'hover-info'; _hoverInfoEl.style.display = 'none'; document.body.appendChild(_hoverInfoEl); }
  return _hoverInfoEl;
}
function hideHoverInfo() { if (_hoverInfoEl) _hoverInfoEl.style.display = 'none'; }
function showHoverInfo(html) {
  const el = hoverInfoEl(); el.innerHTML = html; el.style.display = 'block';
  const vw = window.innerWidth, vh = window.innerHeight, pad = 10, cur = G._cursor || { x: vw / 2, y: 80 };
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = cur.x + 16; if (x + w > vw - pad) x = cur.x - w - 16;
  let y = cur.y + 18; if (y + h > vh - pad) y = Math.max(pad, cur.y - h - 12);
  el.style.left = `${Math.max(pad, x)}px`; el.style.top = `${Math.max(pad, y)}px`;
}
// A compact line of what a building does, from its data.
function buildingStatLine(b) {
  const s = [];
  if (b.homes) s.push(`🏠 ${num(b.homes * POP_SCALE)} homes`);
  if (b.jobs) s.push(`💼 ${num(b.jobs)} jobs`);
  if (b.food) s.push(`🌾 feeds ${num(b.food * POP_SCALE)}`);
  if (b.power) s.push(`⚡ ${b.power > 0 ? '+' : ''}${b.power}`);
  if (b.water) s.push(`💧 ${b.water > 0 ? '+' : ''}${b.water}`);
  if (b.defence) s.push(`🛡️ ${b.defence} def`);
  if (b.income) s.push(`💵 +$${b.income}/mo`);
  if (b.education) s.push(`📚 +${b.education}`);
  if (b.health) s.push(`⚕️ +${b.health}`);
  if (b.safety) s.push(`👮 +${b.safety}`);
  if (b.happiness) s.push(`🙂 ${b.happiness > 0 ? '+' : ''}${b.happiness}`);
  return s.join(' · ');
}
// The name / description / stats for whatever the demolish cursor is over.
function demoInfoHtml(t) {
  if (!t) return null;
  const prog = progressAtCell(t);   // if it's mid-build / mid-teardown, show the time left too
  if (t.kind === 'landmark') return `<b>${escapeHtml(t.label || 'Landmark')}</b>${prog}<div class="hi-body">A fixed national landmark. Removing it clears the land. Tap a single building to remove just that part.</div>`;
  if (t.kind === 'airportPart') return `<b>✈️ ${escapeHtml(t.label || 'Airport building')}</b>${prog}<div class="hi-body">One building of the airport complex. You can tear it down on its own — the rest of the airport stays.</div>`;
  if (t.kind === 'prop') { const pr = G.state.props?.[t.i], pb = pr && BUILDINGS[pr.type]; return `<b>${pb?.icon || '🪧'} ${escapeHtml(pb?.name || 'Street furniture')}</b>${prog}<div class="hi-body">Free-placed street furniture. Removing it clears the spot at once.</div>`; }
  if (t.kind === 'tree') return `<b>🌳 Tree</b>${prog}<div class="hi-body">Greenery that cleans the air and cools the city.</div>`;
  const c = G.state.grid?.[t.y]?.[t.x], b = c && BUILDINGS[c.k];
  if (!b) return `<b>${t.kind === 'heritage' ? '🏚️ Heritage building' : 'Building'}</b>${prog}<div class="hi-body">Part of the standing 1965 town.</div>`;
  const nm = (c.name ? `${escapeHtml(c.name)} · ` : '') + escapeHtml(b.name);
  const stats = buildingStatLine(b);
  return `<b>${b.icon || ''} ${nm}</b>${stats ? `<div class="hi-stats">${stats}</div>` : ''}${prog}<div class="hi-body">${escapeHtml(b.desc || '')}</div>`;
}
// A time-left line for a cell mid-build or mid-teardown (used inside the demolish card).
function progressAtCell(t) {
  const c = (t && t.x != null) ? G.state.grid?.[t.y]?.[t.x] : null;
  if (c && c.build && c.build.left > 0) return progressLine({ kind: 'build', left: c.build.left, total: c.build.total });
  if (c && c.demolish) return progressLine({ kind: 'demolish', left: c.demolish.left, total: c.demolish.total });
  return '';
}

function onDemolishHover(cell, world, landmark) {
  if (G.readOnly || !G.build.bulldoze) { hideHoverInfo(); return; }
  const t = landmark ? { kind: landmark.kind || 'landmark', id: landmark.id, part: landmark.part, i: landmark.i, label: landmark.label } : findDemoTarget(cell, world);
  G.demoHover = t ? { ...t, key: demoKey(t) } : null;
  const info = t ? demoInfoHtml(t) : null;   // show the player what it is before they decide
  if (info) showHoverInfo(info); else hideHoverInfo();
  // Cities-Skylines-style live bulldozer feedback: when NOT pointing at a discrete
  // object, light up (in orange-red) the road chunk a click would tear out right here.
  let preview = null;
  if (!t && world) { const polys = roadEraseCover(G.state.roads, [{ x: world.x, z: world.z }], DEMO_BRUSH); if (polys.length) preview = polys; }
  G.demoRoadPreview = preview;
  if (G.view.showDemoRoadHover) G.view.showDemoRoadHover(preview || []);
  refreshDemoVisual();
  updateDemoBanner();
}
// Drag-rotated the pending building with the cursor — mirror the angle into the
// game state + the toolbar dial so everything stays in sync.
function onAdjustRotate(rad) {
  if (!G.adjust) return;
  G.adjust.rot = ((rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  updateRotDial();
}
function updateDemoBanner() {
  if (!G.build.bulldoze || G.adjust) return;
  const txt = $('tool-banner-text'); if (!txt) return;
  const n = demoCount(), hov = G.demoHover;
  const head = n ? `🚜 Demolish · ${n} selected` : '🚜 Demolish';
  let sub;
  if (hov) { const sel = G.demoSel.has(hov.key); sub = `${sel ? 'Tap again to keep' : 'Tap to select'} ${hov.label}` + (n ? ' · ✓ Done to tear down' : ''); }
  else if (G.demoRoadPreview) sub = 'Click to bulldoze this stretch of road · drag for more · ✓ Done';
  else sub = n ? 'Tap more, or click/drag a road to add · ✓ Done tears them down over time' : 'Tap a building, shophouse, tree or landmark — or click/drag a road';
  txt.innerHTML = `<b>${head}</b><br><span class="tb-sub">${sub}</span>`;
}
// Distance from point (x,z) to segment a-b ({x,z}).
function segPointDistW(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function onGroundTap(x, z) {
  if (G.readOnly) { toast('Read-only while visiting.'); return; }
  const R = G.road;
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
  const route = opts.raw ? pts.map((p) => ({ x: p.x, z: p.z })) : smoothRoute(pts, Math.min(7, Math.max(3, (G.view?.cam?.radius || 70) * 0.035)));
  // an elevated flyover / viaduct / raised runway costs more (deck + pillars) but
  // needs NO earthworks — it bridges over everything below instead of cutting it.
  const elevated = G.road.elevated || !!T.alwaysElevated;   // MRT viaducts are always raised
  const cost = priced(T.cost * Math.max(1, len / 20) * (elevated ? 1.8 : 1), G.state);
  let total = cost, days = Math.max(8, Math.min(80, Math.round(len / 8))) + (elevated ? 6 : 0);
  let detail = elevated ? `${Math.round(len)} m elevated ${T.name.toLowerCase()} · ${money(cost)}` : `${Math.round(len)} m · ${money(cost)}`;
  // Charge `amount`, queue construction, and (for railways) carry the tunnel flag.
  const doBuild = (amount, buildDays, tunnel, note) => {
    if (G.state.treasury < amount) { toast(`Need ${money(amount)} to build this ${T.name.toLowerCase()}.`); return; }
    G.state.treasury -= amount;
    const kind = T.air ? 'air' : T.rail ? 'rail' : 'road';
    addRoadwork(G.state, { pts: route, kind, type: G.road.type, lanes: T.lanes, elevated, mrt: !!T.mrt, tunnel: !!tunnel, total: buildDays });
    G.view.syncRoadworks(G.state);
    G.view.clearRoadPreview();
    if (G.view.clearPieceChain) G.view.clearPieceChain();   // staged chain is now under construction
    afterEdit();
    toast(`${T.name} — ${note || 'construction started'} (${money(amount)}).`);
    cancelTools();   // confirming a build exits edit mode (clears the hovering ghost, resumes time)
  };
  const title = `${T.icon || ''} ${T.name}`;
  // HARD RULE: an airport runway must sit on FLAT GROUND. While drawing, detect the
  // terrain under the strip; if it crosses a slope/hill, break down the cost to clear
  // & flatten it (cut the hill down to the low ground) so the runway lies flat.
  if (T.air && !elevated) {
    const st = G.view._corridorTerrainStats(route, 4.5);
    if (st.range > FLAT_TOL) {
      const fcost = priced(EARTHWORK_RATE * st.volume, G.state);
      total += fcost; days += Math.min(60, Math.round(st.volume / 350));
      const where = st.range > 6 ? 'a hill' : 'a slope';
      detail = `${Math.round(len)} m runway — ⛰ drawn across ${where} (ground rises ${st.range.toFixed(1)} m). It will be cut down to flat ground.<br>` +
        `🛬 Runway ${money(cost)}<br>🏗 Clear &amp; flatten the hill — ${Math.round(st.volume).toLocaleString()} m³ ${money(fcost)}<br><b>Total ${money(total)}</b>`;
      promptCommit({ title, detail, confirm: 'Build', onConfirm: () => doBuild(total, days, false, 'clearing the hill flat & building') });
      return;
    }
  }
  // RAILWAY across uneven ground: like a runway, the line is laid on a SMOOTH grade
  // and any hill in the way is CUT down (dips filled) so the track never climbs at
  // silly angles. Charge the earthworks and show the breakdown (same as the runway).
  if (T.rail && !elevated) {
    const prof = G.view._railProfile(route.map((p) => ({ x: p.x, z: p.z })), 1.4);
    if (prof.cutMax > FLAT_TOL) {
      const fcost = priced(EARTHWORK_RATE * prof.earthVolume, G.state);
      total += fcost; days += Math.min(60, Math.round(prof.earthVolume / 350));
      const where = prof.cutMax > 6 ? 'a hill' : 'a slope';
      detail = `${Math.round(len)} m railway — ⛰ crosses ${where} (rises ${prof.cutMax.toFixed(1)} m). The line is graded & the hill cut flat for a smooth track.<br>` +
        `🚆 Track ${money(cost)}<br>🏗 Clear &amp; flatten ${Math.round(prof.earthVolume).toLocaleString()} m³ ${money(fcost)}<br><b>Total ${money(total)}</b>`;
      promptCommit({ title, detail, confirm: 'Build', onConfirm: () => doBuild(total, days, false, 'cutting the hill flat & laying track') });
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
  const elev = G.road.elevated || !!T.alwaysElevated;        // MRT viaducts are always raised
  if (tool === 'draw') G.view.setDrawMode(true, onRouteDrawn, { type: G.road.type, elevated: elev, rail: !!T.rail, air: !!T.air });
  else G.view.setDrawMode(false);
  G.view.setPieceMode(piece, piece ? { piece: tool, kind: T.air ? 'air' : T.rail ? 'rail' : 'road', type: G.road.type, elevated: elev, onChain: onPieceChain } : null);
  G.view.setRoundaboutPreview(tool === 'roundabout');        // translucent ring shows where it lands
  G.view.setRoadMode(!!tool && !piece && tool !== 'draw');   // roundabout / erase use plain taps
}
// Each tap stages another fixed piece onto the pending chain — show the running
// cost in the commit bar (built first, then ONE confirm starts construction, just
// like freeform Draw). The route is the exact piece geometry (no extra smoothing).
function onPieceChain(mergedPts) {
  onRouteDrawn(mergedPts, { raw: true });
}
function selectRoadTool(tool) {
  clearAdjustSilently();
  clearBridgeTool();
  G.road.tool = G.road.tool === tool ? null : tool;
  G.road.pending = [];
  G.pieceRot = 0;             // fresh orientation for a newly-picked piece tool
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.view.setPreview(null); G.view.setBulldoze(false); G.view.setPaintMode(false);
  applyRoadToolMode();
  G.view.showRoadPreview([]);
  refreshPanel();
  if (G.road.tool) {
    closeSheet();
    const msg = { draw: 'Draw freely by dragging. Hover an existing road end to continue from it. Release to see the cost, then Build.',
      straight: 'Tap to add straight pieces end-to-end (switch piece to turn). Build them up, then ✔ Build to start construction. R / ↻ aims the first piece.',
      curveL: 'Tap to add curve pieces (↻ / R turns them the other way). Chain them up, then ✔ Build to start construction.',
      roundabout: 'Tap to place a roundabout.' }[G.road.tool];
    toast(msg + ' ✕ Done / Esc to stop.');
  }
  updateToolBanner();
}
function toggleReclaim() {
  G.reclaim.active = !G.reclaim.active;
  if (G.reclaim.active) {
    clearBridgeTool();
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
      community: G.community, downloadCommunity,
      setCommSort: (s) => { G.community.sort = s; loadCommunity(); },
      setCommFunc: (f) => { G.community.func = f; loadCommunity(); },
      road: G.road, reclaim: G.reclaim, toggleReclaim, plant: G.plant, selectPlant,
      surface: G.surface, selectSurface, setSurfaceScale,
      bridge: G.bridge, selectBridgeTool, setBridgeW,
      selectRoadTool, setRoadType: (t) => { G.road.type = t; applyRoadToolMode(); refreshPanel(); },
      toggleBridge: () => { G.road.elevated = !G.road.elevated; refreshPanel(); },
      setCat: (c) => { clearAdjustSilently(); G.build.cat = c; if (c !== 'roads') { G.road.tool = null; G.view.setRoadMode(false); } if (c !== 'land') { G.reclaim.active = false; G.surface.active = false; G.view.setPaintMode(false); } if (c !== 'plants' && G.plant.active) { G.plant.active = false; G.plant.kind = null; G.view.setPlantMode(false); } refreshPanel(); updateToolBanner(); if (c === 'community' && !G.community.loading && G.community.list == null) loadCommunity(); },
      setTheme: (t) => { G.build.theme = t; if (G.adjust) { G.adjust.theme = t; G.view.enterAdjust(G.adjust.x, G.adjust.y, G.adjust.key, t, G.adjust.rot); } else if (G.build.selected) G.view.setPreview(G.build.selected, t); refreshPanel(); },
      selectBuilding: (k) => {
        clearAdjustSilently();
        clearBridgeTool();
        G.build.selected = G.build.selected === k ? null : k;
        G.build.bulldoze = false; G.reclaim.active = false; G.view.setPaintMode(false);
        G.road.tool = null; G.view.setRoadMode(false); G.view.setDrawMode(false); G.view.setPieceMode(false); G.view.showRoadPreview([]);
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
        clearAdjustSilently();
        clearBridgeTool();
        G.demoSel.clear(); G.demoHover = null; G.demoCuts = [];
        G.build.bulldoze = !G.build.bulldoze;
        G.build.selected = null; G.reclaim.active = false; G.view.setPaintMode(false);
        G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
        G.view.setBulldoze(G.build.bulldoze);
        refreshPanel();
        if (G.build.bulldoze) { closeSheet(); toast('Demolish: tap buildings & roads to select them (they turn red), tap again to unselect, then ✓ Done to tear them down over time. Esc to stop.'); }
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
// The PM's decisions live in a NON-BLOCKING panel on the right. The clock keeps
// running while briefings sit there — the country carries on under its existing
// settings — and the PM answers each one whenever they like. Rebuilt only when the
// set of pending decisions changes, so buttons stay clickable between frames.
const _decFxSeen = new Set();
function renderDecisions() {
  const panel = $('decisions'); if (!panel) return;
  const q = (G.state && G.state.pendingDecisions) || [];
  // announce each briefing once as it appears: play its FX + a gentle toast (the
  // panel no longer steals the screen, so the toast tells the player to look right)
  for (const ev of q) {
    if (_decFxSeen.has(ev.uid)) continue;
    _decFxSeen.add(ev.uid);
    const fx = DISASTER_FX[ev.id];
    if (fx && G.view?.playDisaster) G.view.playDisaster(fx);
    toast(`${ev.icon || '🏛'} ${ev.title} — decide when you're ready ▸`);
  }
  if (!q.length) { panel.classList.add('hidden'); panel.innerHTML = ''; panel.dataset.sig = ''; return; }
  const sig = q.map((d) => d.uid).join(',');
  if (panel.dataset.sig === sig) return;   // unchanged — leave the live buttons alone
  panel.dataset.sig = sig;
  panel.innerHTML = '';
  const head = el('div', 'dec-head');
  head.append(el('span', 'dec-title', '🏛 Decisions'));
  const count = el('span', 'dec-count', String(q.length)); head.querySelector('.dec-title').append(count);
  const collapse = el('button', 'dec-collapse'); collapse.textContent = panel.classList.contains('collapsed') ? '▸' : '▾';
  collapse.onclick = () => { panel.classList.toggle('collapsed'); collapse.textContent = panel.classList.contains('collapsed') ? '▸' : '▾'; };
  head.append(collapse); panel.append(head);
  const list = el('div', 'dec-list');
  for (const ev of q) list.append(decisionCard(ev));
  panel.append(list);
  panel.classList.remove('hidden');
}
function decisionCard(ev) {
  const card = el('div', 'dec-card ' + (ev.scope === 'foreign' ? 'foreign' : 'internal'));
  const kicker = el('div', 'event-kicker ' + (ev.scope === 'foreign' ? 'foreign' : 'internal'));
  kicker.textContent = `${ev.icon || '📰'}  ${ev.kind || 'National News'}`;
  card.append(kicker, el('div', 'dec-card-title', ev.title), el('div', 'dec-card-body', ev.body));
  const actions = el('div', 'dec-actions');
  ev.choice.options.forEach((opt, i) => {
    const b = el('button', 'btn' + (i === 0 ? ' btn-primary' : ''), opt.label);
    b.onclick = () => onDecision(ev, i);
    actions.append(b);
  });
  card.append(actions);
  return card;
}
function onDecision(ev, i) {
  if (G.readOnly) { toast('👁️ Visiting — only the owner can decide this.'); return; }
  const opt = resolveEvent(G.state, ev.uid, i);   // sim never paused — just drop this card
  if (G.view) G.view.syncConstruction(G.state);   // show anything the decision built itself (e.g. an emergency hospital)
  G.dirty = true;
  if (opt && opt.fx && opt.fx.spawn) toast('🏗 Works approved — construction has begun on the map.');
  if (opt && opt.fx && opt.fx.project) {           // a guided build task: point the player at the Build menu
    const p = opt.fx.project;
    toast(`📋 National project: ${p.title}. ${p.hint}.`);
    openPanel('build');
  }
  renderDecisions();
  updateHud(G.state, G.readOnly);
}

// Map affair ids to an animated disaster in the 3D scene.
const DISASTER_FX = {
  flash_floods: 'flood', epidemic: 'haze', haze: 'haze',
  oil_shock: 'haze', global_downturn: 'quake', trade_dispute: 'quake',
};

// Notify non-choice events via toast (engine stores lastEvent) + play FX.
function maybeAnnounce() {
  if (G.state?.lastEvent) {
    const ev = G.state.lastEvent;
    toast(`${ev.icon || '📰'} ${ev.title}`);
    const fx = DISASTER_FX[ev.id];
    if (fx && G.view?.playDisaster) G.view.playDisaster(fx);
    G.state.lastEvent = null;
  }
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
    info.innerHTML = 'Save your nation to <b>the cloud server</b> — the game\'s save of record. After the first save it <b>auto-syncs</b> as you play, and other players can visit it.';
    wrap.append(info);
  }

  // public toggle
  const pub = el('label', 'checkbox');
  pub.innerHTML = `<input type="checkbox" id="cl-public" checked> List my nation publicly so others can visit`;
  wrap.append(pub);

  const saveBtn = el('button', 'btn btn-primary big', G.cloud ? 'Update Cloud Save' : 'Save to Cloud');
  saveBtn.onclick = () => cloudSave($('cl-public')?.checked !== false);
  wrap.append(saveBtn);

  // no "Save Locally Now": the cloud server is the save of record. Once a nation is
  // on the cloud it auto-syncs there; the browser copy is just silent crash recovery.
  if (G.cloud) wrap.append(el('div', 'cloud-info', '☁️ Auto-sync is on — your nation saves itself to the cloud as you play.'));

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
    const packed = packState(G.state); // store the grid sparsely (a 640² grid is ~2.7 MB dense)
    if (G.cloud) {
      await api.updateWorld(G.cloud.id, G.cloud.token, {
        name: G.state.name, owner: G.state.owner, state: packed, isPublic,
      });
    } else {
      const res = await api.createWorld({
        name: G.state.name, owner: G.state.owner, state: packed, isPublic,
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
    localStorage.setItem(LS_SAVE, JSON.stringify({ state: packState(G.state), cloud: G.cloud }));
  } catch { /* quota */ }
}

// Quietly push the running nation to the cloud — the save of record. Runs on a timer
// once the nation has a cloud world (id + token). Omits isPublic so the world KEEPS
// its chosen visibility; no toasts (failures just retry on the next cycle). The
// browser copy (saveLocal) stays only as silent crash recovery between syncs.
let _cloudSyncBusy = false;
async function cloudSync() {
  if (!G.state || G.readOnly || !G.cloud || _cloudSyncBusy) return;
  _cloudSyncBusy = true;
  try {
    G.state.landmarks = loadLibrary();
    refreshSummary(G.state);
    await api.updateWorld(G.cloud.id, G.cloud.token, { name: G.state.name, owner: G.state.owner, state: packState(G.state) });
    G.dirty = false;
  } catch { /* transient network hiccup — the next cycle retries */ }
  finally { _cloudSyncBusy = false; }
}
setInterval(cloudSync, 90000);

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
    // snapshot the buildable catalogue: the visited world's landmarks/community defs
    // register into BUILDINGS while visiting, and are rolled back on leave — so a
    // visit can't pollute (or overwrite entries in) YOUR build menu.
    if (!G._visitBackup) G._visitBackup = { ...BUILDINGS };
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
    restoreCatalogue();                     // if arriving from a visit, drop its defs first
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
  restoreCatalogue();                       // drop the visited world's defs from the build menu
  // Drop the visited state BEFORE clearing read-only: with no local save to restore,
  // the old order left someone else's nation live with autosave armed — 15s later it
  // was written into YOUR save slot.
  if (localStorage.getItem(LS_SAVE)) { G.readOnly = false; continueGame(); }
  else { G.state = null; G.cloud = null; G.readOnly = false; showMenu(); }
}
// Roll BUILDINGS back to the pre-visit snapshot (removes added keys, restores overwritten ones).
function restoreCatalogue() {
  if (!G._visitBackup) return;
  for (const k of Object.keys(BUILDINGS)) if (!(k in G._visitBackup)) delete BUILDINGS[k];
  Object.assign(BUILDINGS, G._visitBackup);
  G._visitBackup = null;
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

// Minimal hook for automated tests to drive the place-then-adjust flow directly.
window.__sg = {
  onTileTap, rotateAdjust, commitAdjust, findDemoTarget, onDemolishHover, onDemolishStroke, onAdjustRotate, commitDemolish, demoKey,
  cancelAdjust: (m) => cancelAdjust(m),
  selectBuilding: (k) => { clearAdjustSilently(); G.build.selected = k; G.build.bulldoze = false; if (G.view) G.view.setPreview(k, G.build.theme); updateToolBanner(); },
  setBulldoze: (on) => { clearAdjustSilently(); if (!on) hideHoverInfo(); G.demoSel.clear(); G.demoHover = null; G.demoCuts = []; G.build.selected = null; G.build.bulldoze = !!on; if (G.view) G.view.setBulldoze(!!on); updateToolBanner(); },
  selectPlant, selectSurface, setSurfaceScale, toggleFoundation,
  selectBridgeTool, commitBridge, cancelBridge, setBridgeRot, setBridgeW,
  tick: (n = 1) => { for (let i = 0; i < n; i++) tickDay(G.state); if (G.view) { G.view.syncConstruction(G.state); G.view.syncDemolition(G.state); } },
  derive: () => derive(G.state),
  afterEdit: () => afterEdit(),
  get adjust() { return G.adjust; },
  get demoSel() { return G.demoSel; },
  get demoCuts() { return G.demoCuts; },
  get demoRoadPreview() { return G.demoRoadPreview; },
  get state() { return G.state; },
  get build() { return G.build; },
  get plant() { return G.plant; },
  get surface() { return G.surface; },
  get bridge() { return G.bridge; },
};

boot();
