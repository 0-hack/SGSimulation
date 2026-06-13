// Main controller: boots the menu, runs the game loop, wires the UI & cloud.
import {
  newGame, tickDay, build, demolish, canPlace, derive,
  resolveEvent, snapshot, refreshSummary, ensureGrid, issueBond, repayDebt,
  reclaimLand, reclaimCost,
} from './engine.js';
import { Scene3D } from './scene3d.js';
import { api } from './api.js';
import {
  updateHud, renderBuild, renderPolicy, renderDash, renderNews,
  money, num, pct, el,
} from './ui.js';
import { BUILDINGS, POP_SCALE, ROAD_TYPES } from './data.js';
import { injectIcons, ICONS, WEATHER } from './icons.js';

const LS_SAVE = 'sg_save_v1';
const LS_NAME = 'sg_owner';

// Game days per real second for each speed step.
const SPEED_RATE = [0, 2, 8, 26];

const $ = (id) => document.getElementById(id);

const G = {
  state: null,
  view: null,
  speed: 1,
  prevSpeed: 1,
  readOnly: false,
  cloud: null,           // { id, token } for the player's own world
  acc: 0,
  lastFrame: 0,
  hudTimer: 0,
  build: { cat: 'residential', selected: null, bulldoze: false, theme: null },
  road: { tool: null, type: 'street', elevated: false, pending: [] },
  reclaim: { active: false },  // land-reclamation tool: tap sea to fill land

  currentPanel: null,
  dirty: false,          // unsaved changes since last cloud save
};

// ===========================================================================
// Boot
// ===========================================================================
function boot() {
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

  // speed buttons
  document.querySelectorAll('.spd').forEach((b) => {
    b.onclick = () => setSpeed(parseInt(b.dataset.spd, 10));
  });
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
  $('game').classList.add('hidden');
  $('toolbar').classList.add('hidden');
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

  if (G.state && G.speed > 0 && !G.state.pendingEvent) {
    // drive the day/night sun & weather clock in lockstep with the date
    if (G.view) G.view.advanceClock(dt * SPEED_RATE[G.speed]);
    G.acc += dt * SPEED_RATE[G.speed];
    let ticks = 0;
    while (G.acc >= 1 && ticks < 60) {
      tickDay(G.state);
      G.acc -= 1;
      ticks++;
      if (G.state.pendingEvent) break;
    }
    if (ticks > 0) {
      G.dirty = true;
      G.hudTimer += dt;
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
}

// ===========================================================================
// Building interaction
// ===========================================================================
function onTileTap(x, y) {
  if (G.readOnly) { toast('You are visiting — building is disabled here.'); return; }
  const b = G.build;
  if (G.reclaim.active) {
    if (!G.view.canReclaim(x, y)) { toast('You can only reclaim open Singapore sea. 🌊'); return; }
    const cost = reclaimCost(G.state, 1);
    if (G.state.treasury < cost) { toast(`Need ${money(cost)} to reclaim this tile.`); return; }
    const r = reclaimLand(G.state, x, y);
    if (r.ok) { G.view.applyReclaim(x, y); afterEdit(); toast(`Reclaimed land for ${money(r.cost)}. 🏝️`); }
    return;
  }
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
      G.view.onBuilt(x, y, b.selected, theme);
      afterEdit();
    } else {
      const bd = BUILDINGS[b.selected];
      if (G.state.grid[y][x]) toast('Tile occupied.');
      else if (G.state.treasury < bd.cost) toast(`Need ${money(bd.cost)} to build ${bd.name}.`);
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

// ===========================================================================
// Freeform road drawing
// ===========================================================================
const SNAP = 4; // world units to snap onto an existing node
function roadNodeAt(roads, x, z) {
  for (let i = 0; i < roads.nodes.length; i++) {
    const n = roads.nodes[i];
    if (Math.hypot(n.x - x, n.z - z) < SNAP) return i;
  }
  roads.nodes.push({ x, z, y: 0 });
  return roads.nodes.length - 1;
}
function addRoadEdge(a, b, ctrl) {
  const t = G.road.type;
  const T = ROAD_TYPES[t];
  if (G.state.treasury < T.cost) { toast(`Need ${money(T.cost)} for this ${T.name.toLowerCase()}.`); return false; }
  const roads = G.state.roads;
  const ai = roadNodeAt(roads, a.x, a.z), bi = roadNodeAt(roads, b.x, b.z);
  if (ai === bi) return false;
  roads.edges.push({ a: ai, b: bi, ctrl: ctrl || null, type: t, lanes: T.lanes, elevated: G.road.elevated });
  G.state.treasury -= T.cost;
  G.view.rebuildRoadNet();
  afterEdit();
  return true;
}
function placeRoundabout(x, z) {
  const T = ROAD_TYPES[G.road.type];
  const cost = T.cost * 4;
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
  const pt = { x, z };
  if (R.tool === 'straight') {
    R.pending.push(pt);
    if (R.pending.length >= 2) {
      if (addRoadEdge(R.pending[0], pt)) R.pending = [pt]; else R.pending = [];
    }
  } else if (R.tool === 'curve') {
    R.pending.push(pt);
    if (R.pending.length >= 3) {
      if (addRoadEdge(R.pending[0], pt, R.pending[1])) R.pending = [pt]; else R.pending = [];
    }
  }
  G.view.showRoadPreview(R.pending, R.type, R.elevated);
}
function selectRoadTool(tool) {
  G.road.tool = G.road.tool === tool ? null : tool;
  G.road.pending = [];
  G.build.selected = null; G.build.bulldoze = false; G.reclaim.active = false;
  G.view.setPreview(null); G.view.setBulldoze(false);
  G.view.setRoadMode(!!G.road.tool);
  G.view.showRoadPreview([]);
  refreshPanel();
  if (G.road.tool) {
    closeSheet();
    const msg = { straight: 'Tap two points to lay a straight road (keep tapping to chain).',
      curve: 'Tap start, a curve point, then the end. Chains on.',
      roundabout: 'Tap to place a roundabout.', erase: 'Tap a road to remove it.' }[G.road.tool];
    toast(msg);
  }
}
function toggleReclaim() {
  G.reclaim.active = !G.reclaim.active;
  if (G.reclaim.active) {
    G.build.selected = null; G.build.bulldoze = false;
    G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
    G.view.setPreview(null); G.view.setBulldoze(false);
    closeSheet();
    toast('Reclaim mode: tap open sea to fill new land (costs money). 🏝️');
  }
  refreshPanel();
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
    content.append(renderBuild(G.state, {
      cat: G.build.cat, selected: G.build.selected, bulldoze: G.build.bulldoze, theme: G.build.theme,
      road: G.road, reclaim: G.reclaim, toggleReclaim,
      selectRoadTool, setRoadType: (t) => { G.road.type = t; refreshPanel(); },
      toggleBridge: () => { G.road.elevated = !G.road.elevated; refreshPanel(); },
      setCat: (c) => { G.build.cat = c; if (c !== 'roads') { G.road.tool = null; G.view.setRoadMode(false); } if (c !== 'land') G.reclaim.active = false; refreshPanel(); },
      setTheme: (t) => { G.build.theme = t; if (G.build.selected) G.view.setPreview(G.build.selected, t); refreshPanel(); },
      selectBuilding: (k) => {
        G.build.selected = G.build.selected === k ? null : k;
        G.build.bulldoze = false; G.reclaim.active = false;
        G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
        G.view.setPreview(G.build.selected, G.build.theme);
        refreshPanel();
        if (G.build.selected) {
          closeSheet();
          const custom = BUILDINGS[k].customizable ? ' (colour applied)' : '';
          toast(`Tap the map to place ${BUILDINGS[k].name}${custom}.`);
        }
      },
      toggleBulldoze: () => {
        G.build.bulldoze = !G.build.bulldoze;
        G.build.selected = null; G.reclaim.active = false;
        G.road.tool = null; G.view.setRoadMode(false); G.view.showRoadPreview([]);
        G.view.setBulldoze(G.build.bulldoze);
        refreshPanel();
        if (G.build.bulldoze) { closeSheet(); toast('Bulldoze mode: tap buildings to remove.'); }
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
    refreshSummary(G.state);
    G.view.setState(G.state);
    G.view.centerCamera();
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
