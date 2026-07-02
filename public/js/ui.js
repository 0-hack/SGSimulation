// UI rendering helpers: builds the contents of each bottom sheet/panel.
// Returns DOM and wires callbacks; keeps main.js focused on orchestration.
import { BUILDINGS, CATEGORIES, POLICIES, POP_SCALE, THEMES, ROAD_TYPES, PLANTS, SURFACE_TYPES, SANDBOX } from './data.js';
import { derive, isUnlocked, formatDate, debtCeiling, bondRate, reclaimCost, buildingCost, buildDays, priceIndex, inflationRate, currencyStrength } from './engine.js';
import { ICONS, CAT_ICON } from './icons.js';

// ---- formatting ----
export function money(m) {
  const v = Math.round(m);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}B`;
  return `$${v}M`;
}
export function num(n) { return Math.round(n).toLocaleString('en-US'); }
export function pct(n) { return `${Math.round(n)}%`; }

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function barColor(v) { return v >= 66 ? 'var(--good)' : v >= 33 ? 'var(--warn)' : 'var(--bad)'; }

// ===========================================================================
// HUD
// ===========================================================================
export function updateHud(state, readOnly) {
  const popReal = state.population * POP_SCALE;
  document.getElementById('hud-nation').textContent = state.name;
  document.getElementById('hud-date').textContent = formatDate(state.date);
  document.getElementById('hud-treasury').textContent = money(state.treasury);
  document.getElementById('hud-pop').textContent = num(popReal);
  const ap = document.getElementById('hud-approval');
  ap.textContent = pct(state.approval);
  const face = state.approval >= 55 ? 'smile' : state.approval >= 32 ? 'meh' : 'frown';
  const faceEl = document.getElementById('approval-face');
  if (faceEl && faceEl.dataset.face !== face) { faceEl.dataset.face = face; faceEl.innerHTML = ICONS[face]; }
  const stat = ap.closest('.stat');
  if (stat) stat.dataset.mood = face;
}

// ===========================================================================
// BUILD PANEL
// ===========================================================================
export function renderBuild(state, ctx) {
  const wrap = el('div');

  // Tool actions: inspect/bulldoze
  const actions = el('div', 'tool-actions');
  const bulldoze = el('button', 'btn danger' + (ctx.bulldoze ? ' active' : ''),
    `<span class="bi">${ICONS.bulldoze}</span> Demolish`);
  bulldoze.onclick = () => ctx.toggleBulldoze();
  actions.append(bulldoze);
  wrap.append(actions);

  // Category tabs
  const tabs = el('div', 'cat-tabs');
  for (const c of CATEGORIES) {
    const t = el('button', 'cat-tab' + (ctx.cat === c.id ? ' active' : ''),
      `<span class="ci">${ICONS[c.id === 'roads' ? 'roads' : CAT_ICON[c.id]] || ''}</span>${c.name}`);
    t.onclick = () => ctx.setCat(c.id);
    tabs.append(t);
  }
  wrap.append(tabs);

  // Roads category shows the road-drawing toolkit instead of buildings.
  // Transport shows the draw toolkit AND its placeable structures (MRT/train
  // stations, single viaduct spans) — so road, rail, MRT all live in one place.
  if (ctx.cat === 'roads') {
    wrap.append(renderRoads(ctx));
    wrap.append(el('div', 'section-title', 'Stations & structures'));
    // fall through to the building grid (filtered to the Transport category)
  } else if (ctx.cat === 'land') {
    // Reclaim category shows the land-reclamation tool instead of buildings.
    wrap.append(renderReclaim(state, ctx)); return wrap;
  } else if (ctx.cat === 'plants') {
    // Plants category shows the individual-plant palette instead of buildings.
    wrap.append(renderPlants(ctx)); return wrap;
  }

  // Colour-theme picker — shown for categories that contain customizable builds.
  const hasCustom = Object.values(BUILDINGS).some((b) => b.cat === ctx.cat && b.customizable);
  if (hasCustom) {
    const picker = el('div', 'theme-picker');
    picker.append(el('span', 'theme-label', '🎨 Estate colour (for customisable builds)'));
    const sw = el('div', 'swatches');
    for (const t of THEMES) {
      const active = (ctx.theme || THEMES[0].color) === t.color;
      const s = el('button', 'swatch' + (active ? ' active' : ''));
      s.style.background = t.color; s.title = t.name;
      s.onclick = () => ctx.setTheme(t.color);
      sw.append(s);
    }
    picker.append(sw);
    wrap.append(picker);
  }

  // A legend so players can read what each little contribution icon + number on a
  // building card means (homes, jobs, power, water, revenue, pollution, …).
  const legend = el('details', 'tag-legend');
  legend.innerHTML = `<summary>ℹ️ What the building icons mean</summary>`
    + `<div class="legend-grid">${TAG_LEGEND.map(([i, n, d]) => `<div class="leg-row"><span class="leg-ico">${i}</span><span class="leg-name">${n}</span><span class="leg-desc">${d}</span></div>`).join('')}`
    + `<div class="leg-row"><span class="leg-ico">🏗️</span><span class="leg-name">Build time</span><span class="leg-desc">How long it takes to construct — it produces nothing until finished</span></div></div>`;
  wrap.append(legend);

  // Buildings in category. Construction is the ONE time-gated system: options the
  // world hasn't invented yet are shown GREYED and sorted to the bottom — you can
  // see what's coming and when, but can only build it once its year arrives. Prices
  // move with inflation, technology maturity (dear when new, cheaper as it matures)
  // and the currency (a strong dollar eases imported materials).
  const grid = el('div', 'build-grid');
  const avail = [], locked = [];
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (b.cat !== ctx.cat) continue;
    (isUnlocked(state, key) ? avail : locked).push([key, b]);
  }
  locked.sort((a, b) => (a[1].year || 0) - (b[1].year || 0));   // soonest-to-arrive first
  for (const [key, b] of avail) grid.append(buildCard(state, ctx, key, b, false));
  if (locked.length) {
    grid.append(el('div', 'build-locked-sep', '🔒 Not yet invented — available as the years pass'));
    for (const [key, b] of locked) grid.append(buildCard(state, ctx, key, b, true));
  }
  wrap.append(grid);
  return wrap;
}

// One build tile. `locked` (tech not invented yet) renders greyed, non-clickable,
// showing the year it becomes available; otherwise it shows the live price with a
// ▲ (dearer: new-tech premium / inflation / weak $) or ▼ (cheaper: matured tech /
// strong $) marker versus the 1965 base.
function buildCard(state, ctx, key, b, locked) {
  const cost = buildingCost(state, key);
  const affordable = state.treasury >= cost;
  const card = el('button', 'bcard' + (ctx.selected === key ? ' selected' : '') + (locked ? ' locked' : ''));
  const tags = buildingTags(b);
  let pmark = '';
  if (cost > Math.round(b.cost * 1.02)) pmark = ` <span class="b-infl up" title="Dearer than the ${money(b.cost)} base — a new-technology premium, inflation and/or a weak currency. It cheapens as the technology matures and the dollar strengthens.">▲</span>`;
  else if (cost < Math.round(b.cost * 0.98)) pmark = ` <span class="b-infl down" title="Cheaper than the ${money(b.cost)} base — the technology has matured and/or a strong currency eases imported materials.">▼</span>`;
  const bt = fmtDuration(buildDays(b));
  const costLine = locked
    ? `<span class="b-lockyr">🔒 Invented ${b.year}</span> · upkeep ${money(b.upkeep)}/mo`
    : `${money(cost)}${pmark} · upkeep ${money(b.upkeep)}/mo`;
  card.innerHTML = `
    <div class="b-top">
      <span class="b-ico">${b.icon}</span>
      <div style="flex:1">
        <div class="b-name">${b.name}</div>
        <div class="b-cost">${costLine}</div>
        <div class="b-time" title="Construction takes this long — the site stands and produces nothing until it's finished. Use the speed controls to fast-forward.">🏗️ builds in ~${bt}</div>
      </div>
    </div>
    <div class="b-desc">${b.desc}</div>
    <div class="b-tags">${tags}</div>`;
  if (locked) { card.disabled = true; card.title = `Available once the world invents it (${b.year}).`; }
  else { if (!affordable) card.style.opacity = '0.6'; card.onclick = () => ctx.selectBuilding(key); }
  return card;
}

// ---- road-drawing toolkit -------------------------------------------------
function renderRoads(ctx) {
  const r = ctx.road;
  const wrap = el('div', 'roads-ui');
  wrap.append(el('p', 'policy-desc', 'Pick a mode — 🚗 Road, 🚆 Railway, or ✈️ Airport — then either ✏️ Draw a freeform route, or pick a fixed PIECE (Straight / Curve) and tap to click pieces together like track. Build the chain up, then ✔ Build once to start construction (auto-connects for traffic).'));

  // mode: road (cars) / railway (trains) / airport (planes)
  const typeRow = el('div', 'road-types');
  for (const [id, t] of Object.entries(ROAD_TYPES)) {
    const btn = el('button', 'opt' + (r.type === id ? ' active' : ''), `${t.icon || ''} ${t.name}`);
    btn.onclick = () => ctx.setRoadType(id);
    typeRow.append(btn);
  }
  wrap.append(el('div', 'section-title', 'Mode'));
  wrap.append(typeRow);

  // elevated toggle — a flyover (road), viaduct (railway) or raised runway, lifted
  // above everything below it. Available for ALL modes EXCEPT the MRT, which is
  // always an elevated viaduct (so we show a fixed note instead of a toggle).
  if (ROAD_TYPES[r.type]?.alwaysElevated) {
    wrap.append(el('p', 'tool-hint', '🚇 The MRT always runs on an elevated viaduct — draw the line and it rises onto concrete piers automatically.'));
  } else {
    const air = ROAD_TYPES[r.type]?.air;
    const label = air ? 'Elevated runway (raised on pillars)' : 'Elevated flyover / bridge';
    const bridge = el('div', 'checkbox');
    bridge.innerHTML = `<span class="switch${r.elevated ? ' on' : ''}"></span> ${label}`;
    bridge.querySelector('.switch').onclick = () => ctx.toggleBridge();
    wrap.append(bridge);
  }

  // tools — ✏️ Draw (freehand) leads. (Demolish lives on the standard top button.)
  wrap.append(el('div', 'section-title', 'Tool'));
  const tools = el('div', 'road-tools');
  const onLand = !ROAD_TYPES[r.type]?.rail && !ROAD_TYPES[r.type]?.air;   // roundabout is road-only
  const defs = [
    ['draw', '✏️ Draw'], ['straight', '▭ Straight'], ['curveL', '↰ Curve'],
    ...(onLand ? [['roundabout', 'Roundabout']] : []),
  ];
  for (const [id, label] of defs) {
    const ico = ICONS[id] || (id.startsWith('curve') ? ICONS.curve : '');
    const b = el('button', 'road-tool' + (r.tool === id ? ' active' : ''),
      `<span class="rt-ico">${ico}</span><span>${label}</span>`);
    b.onclick = () => ctx.selectRoadTool(id);
    tools.append(b);
  }
  wrap.append(el('p', 'tool-hint', 'Tip: tap to chain pieces end-to-end (yellow ring marks the join); the cost adds up. ✔ Build starts construction, ✕ Cancel discards. ↻ Rotate / R aims the first piece.'));
  wrap.append(tools);
  return wrap;
}

// ---- land-reclamation toolkit ---------------------------------------------
function renderReclaim(state, ctx) {
  const wrap = el('div', 'roads-ui');
  const perCell = reclaimCost(state, 1);
  const pIndex = Math.round(priceIndex(state) * 100) / 100;
  const inflPct = (inflationRate(state) * 100).toFixed(1);
  wrap.append(el('p', 'policy-desc', 'Reclaim land from the sea — turn open water into buildable Singapore land. Draw a free-form loop and the new land takes that exact shape (a smooth coastline, not square tiles); release to see the cost — priced by the land area you enclose — then confirm. Reclaim anywhere in the Singapore sea (not the Johor side or protected reservoirs).'));
  wrap.append(el('div', 'section-title', 'Cost (by area & inflation)'));
  wrap.append(el('p', 'policy-desc',
    `<b>${money(perCell)}</b> per land tile. Total cost scales with the area you enclose and with the current price level — ×${pIndex} vs 1965 (inflation ${inflPct}%/yr), so a well-run economy keeps reclamation cheaper. Reclaimed land takes a few days to rise from the sea before you can build on it.`));
  const btn = el('button', 'btn' + (ctx.reclaim.active ? ' active' : ''),
    `<span class="bi">🏝️</span> ${ctx.reclaim.active ? 'Reclaiming — draw a loop over open sea' : 'Start reclaiming land'}`);
  btn.onclick = () => ctx.toggleReclaim();
  wrap.append(btn);

  // ---- Surface paint: change how the ground LOOKS (concrete, plaza, sand…) ----
  if (ctx.surface && ctx.selectSurface) {
    wrap.append(el('div', 'section-title', 'Surface paint'));
    wrap.append(el('p', 'policy-desc', 'Paint the ground a different surface as the country urbanises — concrete, plaza tile, asphalt, sand and more over green. Cosmetic only: it never changes what you can build. Pick a surface, set the brush size, then drag across the map. Paint "Grass" or "Clear" to restore the natural look.'));
    const sg = el('div', 'surface-grid');
    const swatch = (id, name, color) => {
      const sel = ctx.surface.active && ctx.surface.type === id;
      const b = el('button', 'surface-btn' + (sel ? ' selected' : ''),
        `<span class="sf-chip" style="background:${color}"></span><span class="sf-name">${name}</span>`);
      b.onclick = () => ctx.selectSurface(id);
      sg.append(b);
    };
    for (const [id, info] of Object.entries(SURFACE_TYPES)) swatch(id, info.name, '#' + info.color.toString(16).padStart(6, '0'));
    swatch('clear', 'Clear', 'repeating-linear-gradient(45deg,#ccc,#ccc 3px,#fff 3px,#fff 6px)');
    wrap.append(sg);
    // brush-size slider (radius in cells)
    const sr = el('div', 'brush-row');
    sr.append(el('span', 'brush-label', 'Brush'));
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '5'; slider.step = '1'; slider.value = String(ctx.surface.scale ?? 1);
    const out = el('span', 'brush-val', `${(ctx.surface.scale ?? 1) === 0 ? '1 tile' : (ctx.surface.scale * 2 + 1) + ' tiles'}`);
    slider.oninput = (e) => { const v = parseInt(e.target.value, 10); out.textContent = v === 0 ? '1 tile' : (v * 2 + 1) + ' tiles'; ctx.setSurfaceScale(v); };
    sr.append(slider); sr.append(out);
    wrap.append(sr);
  }
  return wrap;
}

// ---- individual plants palette --------------------------------------------
function renderPlants(ctx) {
  const wrap = el('div', 'roads-ui');
  wrap.append(el('p', 'policy-desc', 'Place individual tropical plants — one specimen at a time, not whole forests. Pick a species, then tap open ground to plant it (free & instant); tap a plant again to remove it. Humid-climate species only, no temperate flora.'));
  wrap.append(el('div', 'section-title', 'Trees, palms & flowers'));
  const grid = el('div', 'plant-grid');
  for (const [kind, p] of Object.entries(PLANTS)) {
    const sel = ctx.plant && ctx.plant.active && ctx.plant.kind === kind;
    const btn = el('button', 'plant-btn' + (sel ? ' selected' : ''),
      `<span class="pl-ico">${p.icon}</span><span class="pl-name">${p.name}</span>`);
    btn.title = p.tip || '';
    btn.onclick = () => ctx.selectPlant(kind);
    grid.append(btn);
  }
  wrap.append(grid);
  return wrap;
}

// Round game-days into a human "~3.5 yr" / "~8 mo" / "~3 wk" / "~5 d".
function fmtDuration(days) {
  if (days >= 360) { const y = days / 360; return `${y % 1 === 0 ? y : y.toFixed(1)} yr`; }
  if (days >= 60) return `${Math.round(days / 30)} mo`;
  if (days >= 14) return `${Math.round(days / 7)} wk`;
  return `${Math.round(days)} d`;
}

// What every building-contribution icon means — used for the tag tooltips AND the
// legend in the Build panel, so players can read what each icon + number stands for.
const TAG_LEGEND = [
  ['🏠', 'Homes', 'People this building can house'],
  ['💼', 'Jobs', 'Jobs it provides for the workforce'],
  ['🌾', 'Food', 'People its produce can feed (self-sufficiency)'],
  ['⚡', 'Power', '+ generates electricity · − draws from the grid'],
  ['💧', 'Water', '+ supplies clean water · − consumes water'],
  ['💰', 'Revenue', 'Tax / business income it earns per month'],
  ['☁️', 'Pollution', 'Air pollution it emits (hurts health & mood)'],
  ['🌿', 'Cleans air', 'Greenery that removes pollution'],
  ['📚', 'Education', 'Raises the national education level'],
  ['⚕️', 'Health', 'Raises public health (fewer outbreaks)'],
  ['🛡️', 'Safety', 'Raises law & order (lowers crime)'],
  ['🎖️', 'Defence', 'Military strength against external threat'],
  ['🙂', 'Happiness', 'Local liveability / mood boost'],
];
function tag(cls, icon, num, title) { return `<span class="tag ${cls}" title="${title}">${icon} ${num}</span>`; }
function buildingTags(b) {
  const t = [];
  if (b.homes) t.push(tag('good', '🏠', num(b.homes * POP_SCALE), `Homes — houses ${num(b.homes * POP_SCALE)} people`));
  if (b.jobs) t.push(tag('good', '💼', num(b.jobs), `Jobs — ${num(b.jobs)} jobs for the workforce`));
  if (b.food) t.push(tag('good', '🌾', num(b.food * POP_SCALE), `Food — feeds ${num(b.food * POP_SCALE)} people`));
  if (b.power > 0) t.push(tag('good', '⚡', `+${b.power}`, `Power — generates ${b.power} to the grid`));
  if (b.power < 0) t.push(tag('', '⚡', b.power, `Power — draws ${-b.power} from the grid`));
  if (b.water > 0) t.push(tag('good', '💧', `+${b.water}`, `Water — supplies ${b.water} clean water`));
  if (b.water < 0) t.push(tag('', '💧', b.water, `Water — consumes ${-b.water}`));
  if (b.income) t.push(tag('good', '💰', `+${money(b.income)}/mo`, `Revenue — earns ${money(b.income)} per month`));
  if (b.pollution > 0) t.push(tag('bad', '☁️', `+${b.pollution}`, `Pollution — emits ${b.pollution} (hurts health & mood)`));
  if (b.pollution < 0) t.push(tag('good', '🌿', b.pollution, `Cleans air — removes ${-b.pollution} pollution`));
  if (b.education) t.push(tag('good', '📚', `+${b.education}`, `Education — raises the education level by ${b.education}`));
  if (b.health) t.push(tag('good', '⚕️', `+${b.health}`, `Health — raises public health by ${b.health}`));
  if (b.safety) t.push(tag('good', '🛡️', `+${b.safety}`, `Safety — raises law & order by ${b.safety}`));
  if (b.defence) t.push(tag('good', '🎖️', `+${b.defence}`, `Defence — adds ${b.defence} military strength`));
  return t.join('');
}

// ===========================================================================
// POLICY PANEL
// ===========================================================================
export function renderPolicy(state, ctx) {
  const wrap = el('div');
  wrap.append(el('p', 'policy-desc', 'Laws and policies shape your society for decades. You may enact ANY of them at any time — but what a policy delivers depends on the state of your economy, your citizens\' welfare and stability. A law ahead of its moment simply underperforms.'));

  for (const [key, p] of Object.entries(POLICIES)) {
    const early = state.date.y < p.year;                    // before the era it spread worldwide — allowed, just flagged
    const box = el('div', 'policy');
    const head = el('div', 'policy-head');
    head.innerHTML = `<span class="p-ico">${p.icon}</span><span class="p-name">${p.name}</span>`;

    if (p.type === 'toggle') {
      const sw = el('div', 'switch' + (state.policies[key] ? ' on' : ''));
      if (!ctx.readOnly) sw.onclick = () => ctx.togglePolicy(key);
      head.append(sw);
    }
    box.append(head);
    box.append(el('div', 'policy-desc', p.desc + (early ? ` <span class="p-early">Practised worldwide from ~${p.year} — you can adopt it early, but expect it to underdeliver until the country is ready.</span>` : '')));

    if (p.type === 'level') {
      const opts = el('div', 'opts');
      for (const o of p.options) {
        const b = el('button', 'opt' + (state.policies[key] === o.id ? ' active' : ''), o.label);
        if (!ctx.readOnly) b.onclick = () => ctx.setPolicy(key, o.id);
        opts.append(b);
      }
      box.append(opts);
    }
    wrap.append(box);
  }
  return wrap;
}

// ===========================================================================
// DASHBOARD
// ===========================================================================
export function renderDash(state, ctx = {}) {
  const d = derive(state);
  const wrap = el('div');
  const popReal = state.population * POP_SCALE;
  const workPct = state.population > 0 ? Math.round(d.working / state.population * 100) : 0;
  const oldPct = state.population > 0 ? Math.round(d.elderly / state.population * 100) : 0;
  const youngPct = Math.max(0, 100 - workPct - oldPct);
  const dep = (d.dependency || 0).toFixed(2);
  const occ = Math.round(d.housingPressure * 100);           // people per 100 homes
  const emp = (1 - d.unemployment) * 100;
  const infl = inflationRate(state) * 100;
  const sgd = currencyStrength(state);
  const trade = state.lastFinance ? state.lastFinance.business : d.directIncome;

  // ---- HOUSING & PEOPLE ----------------------------------------------------
  wrap.append(section('Housing & People', [
    metric('👥 Population', num(popReal), `workforce ${num(d.workforce * POP_SCALE)}`,
      'The people living in your nation (each citizen here ≈ 10 real people). More people means more workers and taxes — but every one needs a home, power, water and public services. Grows through births and migration when homes and jobs are available.'),
    metric('🏠 Homes', num(d.homes * POP_SCALE), `${occ}% occupied`,
      'Total housing capacity across every home you have. When homes fall below the population, families are overcrowded; when there is spare room, migrants move in. Build kampongs, flats and HDB estates to add homes.',
      { bar: bar(Math.min(100, occ), occColor(d.housingPressure)) }),
    metric('🏚️ Housing supply', occ <= 100 ? 'Homes for all' : 'Shortage',
      occ <= 100 ? `${100 - occ}% spare room` : `${occ - 100}% overcrowded`,
      'People per home (occupancy). Above 100% is a housing shortage — overcrowding that angers residents and slows growth, the pressing problem of 1965. Demolishing homes raises it; building homes eases it.',
      { valStyle: `color:${occ <= 100 ? 'var(--good)' : 'var(--bad)'};font-size:16px` }),
    metric('💼 Jobs', num(d.jobs), `${pct(emp)} employed`,
      'Jobs your port, factories, godowns, shops and offices provide. Employed workers earn wages and pay income tax. Too few jobs for the workforce means unemployment — build industry, trade and services to create work.'),
    metric('🧑‍🤝‍🧑 Working age', `${workPct}%`, `${youngPct}% young · ${oldPct}% elderly`,
      'The share of the nation of working age — this IS your workforce and tax base. Cohorts age over the decades: births (set by Family Planning policy) feed the young, migrants (Immigration policy) top up the working-age, and better healthcare lengthens old age. An ageing nation has fewer workers supporting more people.',
      { bar: bar(workPct, workPct >= 58 ? 'var(--good)' : workPct >= 48 ? 'var(--warn)' : 'var(--bad)'), valStyle: `color:${workPct >= 58 ? 'var(--good)' : workPct >= 48 ? 'var(--warn)' : 'var(--bad)'}` }),
    metric('🧓 Old-age support', `${dep} : 1`, oldPct >= 18 ? 'ageing society' : oldPct >= 9 ? 'maturing' : 'young nation',
      'Dependents (children + elderly) each worker must support. As the nation greys this climbs, straining pensions and healthcare — costs the treasury bears unless CPF lets people fund their own retirement. Keep it low with births, immigration, and by growing the economy faster than it ages.',
      { bar: bar(Math.min(100, (d.dependency || 0.6) * 55), (d.dependency || 0.6) <= 0.7 ? 'var(--good)' : (d.dependency || 0.6) <= 1 ? 'var(--warn)' : 'var(--bad)') }),
  ]));

  // ---- SUPPLY CHAIN (resources the city needs) -----------------------------
  wrap.append(section('Supply Chain & Utilities', [
    ratioMetric('⚡ Power', d.powerGen, d.powerUse, 'MW',
      'Electricity generated versus consumed. Below 100% is a shortage — the city browns out and power-hungry services and industry falter. Power stations, and later solar/gas/nuclear, keep a healthy surplus.'),
    ratioMetric('💧 Water', d.waterGen, d.waterUse, 'units',
      'Fresh water supplied versus used. Singapore has little natural water, so reservoirs, standpipes and mains — and later desalination and NEWater — are vital. A shortage disrupts homes and industry.'),
    metric('🌾 Food self-sufficiency', `${pct((d.foodSelf || 0) * 100)}`,
      (d.foodSelf || 0) >= 0.3 ? 'home-grown — resilient' : 'mostly imported',
      'Share of food grown on the island. Most is imported (so a low figure is historically normal), but market gardens, poultry, fish and modern farms raise resilience against supply shocks — the spirit of the "30 by 30" goal.'),
    metric('🏭 Trade & industry', `${money(trade)}/mo`, 'business revenue',
      'Monthly revenue from the entrepôt trade — the port, godowns, factories, shops and offices Singapore lived on. This is the engine of the treasury; grow it to fund housing and services.'),
    metric('📦 Import bill', `${money(d.importBill || 0)}/mo`, trade - (d.importBill || 0) >= 0 ? `trade surplus ${money(trade - (d.importBill || 0))}/mo` : `trade deficit ${money((d.importBill || 0) - trade)}/mo`,
      'What the island must buy from abroad each month — food it doesn\'t grow, fuel for its fossil power stations, and general materials. It swells when the currency is weak or an oil shock hits, and shrinks as you build self-sufficiency: farms for food, and solar/nuclear for clean, fuel-free power. The eternal vulnerability of a resource-poor city-state.',
      { valStyle: `color:${trade - (d.importBill || 0) >= 0 ? 'var(--good)' : 'var(--bad)'}` }),
    (() => { const cg = Math.round((d.congestion || 0) * 100); const cc = cg <= 30 ? 'var(--good)' : cg <= 60 ? 'var(--warn)' : 'var(--bad)';
      return metric('🚦 Traffic', `${cg}%`, cg <= 30 ? 'free-flowing' : cg <= 60 ? 'congested' : 'gridlock',
        'Road congestion on the daily commute. It grows with the population and its car ownership, and is relieved by the MRT and rail (which carry commuters off the roads) and the Car Quota / ERP policy. Gridlock wastes working hours (cutting productivity and tax), fouls the air and frustrates commuters. Build the metro and price the roads.',
        { bar: bar(cg, cc), valStyle: `color:${cc}` }); })(),
  ]));

  // ---- ECONOMY -------------------------------------------------------------
  const inflArrow = infl > 4 ? '▲' : infl < 1.5 ? '▼' : '◆';
  wrap.append(section('Economy', [
    metric('📉 Unemployment', `${(d.unemployment * 100).toFixed(1)}%`,
      d.unemployment > 0.15 ? 'high — build jobs' : d.unemployment < 0.05 ? 'near full employment' : 'manageable',
      'Share of the workforce with no job. High unemployment drains approval and tax revenue and breeds unrest; near-zero means labour shortages. In 1965 it stood around 10–14% — the spur for industrialisation.',
      { valStyle: `color:${d.unemployment > 0.15 ? 'var(--bad)' : d.unemployment > 0.08 ? 'var(--warn)' : 'var(--good)'}` }),
    metric('📈 Inflation', `${infl.toFixed(1)}%`, `prices ×${priceIndex(state).toFixed(2)} ${inflArrow}`,
      'How fast prices rise each year. High inflation makes buildings and daily life costlier; disciplined budgets and a strong currency keep it low. Runaway inflation erodes what your treasury can buy.'),
    metric('💱 SGD strength', `×${sgd.toFixed(2)}`, sgd >= 1 ? 'strong currency' : 'weak currency',
      'The Singapore dollar\'s strength versus its 1965 value. A strong currency makes imports and construction cheaper and signals confidence; a weak one makes everything dearer.'),
    metric('💵 Treasury', money(state.treasury),
      state.lastFinance ? `${state.lastFinance.net >= 0 ? '▲' : '▼'} ${money(Math.abs(state.lastFinance.net))}/mo` : 'reserves',
      'Your national reserves in millions of dollars. Building and running the city costs money; a healthy treasury lets you invest ahead. It moves each month by the budget below.'),
  ]));

  // ---- SOCIETY & ENVIRONMENT ----------------------------------------------
  const access = Math.round((d.serviceAccess ?? 0.5) * 100);
  const blight = Math.round((d.blight || 0) * 100);
  wrap.append(section('Society & Environment', [
    meterMetric('🙂 Approval', state.approval, false,
      'How happy citizens are with your leadership. Jobs, homes, utilities, services and clean air lift it; shortages, unemployment and pollution sink it. Let it fall too far and you risk unrest.'),
    metric('🏙️ Service access', `${access}%`, access >= 66 ? 'well served' : access >= 40 ? 'patchy' : 'service desert',
      'How many people live within reach of schools, clinics, parks, markets and the MRT. WHERE you build matters: putting homes near amenities lifts approval; isolated estates with nothing nearby drag it down.',
      { bar: bar(access, barColor(access)), valStyle: `color:${barColor(access)}` }),
    metric('🏭 Industrial blight', `${blight}%`, blight <= 25 ? 'clean neighbourhoods' : blight <= 55 ? 'some homes affected' : 'homes in industry\'s shadow',
      'How many people live packed against heavy industry — factories, power stations, the port. Living in the smoke and noise angers residents. Separate homes from industry, or soften the edge with parks and green buffers.',
      { bar: bar(blight, blight <= 25 ? 'var(--good)' : blight <= 55 ? 'var(--warn)' : 'var(--bad)'), valStyle: `color:${blight <= 25 ? 'var(--good)' : blight <= 55 ? 'var(--warn)' : 'var(--bad)'}` }),
    meterMetric('🛡️ Safety', state.safety, false,
      'Law, order and fire protection. Police posts, fire stations and community centres raise it; safe streets keep citizens and investors confident.'),
    meterMetric('📚 Education', state.education, false,
      'The skill of your workforce. Schools and technical institutes raise it, lifting productivity and tax revenue — the bet behind Singapore\'s rise.'),
    meterMetric('⚕️ Health', state.health, false,
      'Public health. Hospitals, clinics, clean water and sewerage raise it, cutting death rates and softening epidemics.'),
    meterMetric('☁️ Pollution', state.pollution, true,
      'Dirty air from industry and power stations. High pollution harms health and happiness; parks, nature, the MRT and clean energy bring it down.'),
    metric('🚨 Crime risk', `${Math.round((d.crimeRisk || 0) * 100)}%`, (d.crimeRisk || 0) <= 0.3 ? 'orderly' : (d.crimeRisk || 0) <= 0.5 ? 'watchful' : 'restless',
      'How likely crime is to break out. Bred by joblessness, thin policing and slum conditions — not just the number of police posts. When it strikes, safety and approval fall and there\'s a bill to pay. Jobs, police and better neighbourhoods keep it low.',
      { bar: bar(Math.round((d.crimeRisk || 0) * 100), (d.crimeRisk || 0) <= 0.3 ? 'var(--good)' : (d.crimeRisk || 0) <= 0.5 ? 'var(--warn)' : 'var(--bad)') }),
    metric('🦠 Disease risk', `${Math.round((d.diseaseRisk || 0) * 100)}%`, (d.diseaseRisk || 0) <= 0.3 ? 'healthy' : (d.diseaseRisk || 0) <= 0.5 ? 'strained' : 'vulnerable',
      'The chance of a disease outbreak. Rises with overcrowding, dirty air and weak healthcare & sanitation. An outbreak knocks public health and approval and strains the budget. Hospitals, clinics, sewerage, clean air and roomy housing keep it in check.',
      { bar: bar(Math.round((d.diseaseRisk || 0) * 100), (d.diseaseRisk || 0) <= 0.3 ? 'var(--good)' : (d.diseaseRisk || 0) <= 0.5 ? 'var(--warn)' : 'var(--bad)') }),
  ]));

  // ---- DEFENCE & SECURITY --------------------------------------------------
  const threatPct = Math.round((d.threat || 0) * 100);
  const threatWord = threatPct >= 55 ? 'dangerous' : threatPct >= 35 ? 'tense' : 'calm';
  const sec = d.security || 0;
  const secWord = sec >= 1 ? 'secure' : sec >= 0.7 ? 'exposed' : 'at risk';
  const secColor = sec >= 1 ? 'var(--good)' : sec >= 0.7 ? 'var(--warn)' : 'var(--bad)';
  const stanceLabel = { nonaligned: 'Non-Aligned', regional: 'Regional (ASEAN)', western: 'Western-Aligned', armed_neutral: 'Armed Neutrality' }[state.policies && state.policies.foreign_policy] || 'Non-Aligned';
  wrap.append(section('Defence & Security', [
    metric('🛡️ Defence strength', num(d.defence || 0), `need ${num(Math.round(d.defenceNeed || 0))} vs the threat`,
      'The military might of your armed forces — camps, naval & air bases and the arms industry, multiplied by National Service, the defence budget and R&D innovation. It must at least match what the external threat demands. Build it up before a foreign-affairs crisis forces the issue.',
      { bar: bar(Math.min(100, sec * 55), secColor), valStyle: `color:${secColor}` }),
    metric('⚔️ External threat', `${threatPct}%`, `${threatWord} · stance: ${stanceLabel}`,
      'How dangerous the region is for a small nation. It runs high in the early years and eases as the world settles. Your International Stance (in Policies) shifts it — Regional Cooperation and alliances lower it, isolation raises it — and foreign-affairs decisions (a hostile neighbour, a garrison leaving) can spike it.',
      { bar: bar(threatPct, threatPct >= 55 ? 'var(--bad)' : threatPct >= 35 ? 'var(--warn)' : 'var(--good)') }),
    metric('🏰 Security', `${sec.toFixed(2)} : 1`, secWord,
      'Defence strength versus the threat. Below 1 the nation is exposed — approval falls, investors take fright (trade income drops), and hostile provocations can strike. At or above 1 the little red dot can hold its own, reassuring citizens and capital alike.',
      { bar: bar(Math.min(100, sec * 55), secColor), valStyle: `color:${secColor};font-size:16px` }),
    metric('🌐 Foreign policy', stanceLabel, 'set in Policies',
      'Your chosen place in the world, decided in the Policy panel. Non-Aligned keeps a free hand; Regional Cooperation (ASEAN) calms the neighbourhood; Western-Aligned pulls in investment and defence backing at some domestic cost; Armed Neutrality deters through sheer strength. Each ripples through threat, trade and approval.',
      { valStyle: 'font-size:15px' }),
  ]));

  // ---- FINANCIAL PLANNING --------------------------------------------------
  wrap.append(el('div', 'section-title', 'Financial Planning'));
  // Finance ledger
  if (state.lastFinance) {
    const f = state.lastFinance;
    const led = el('div', 'metric span2');
    const ledger = el('div', 'ledger');
    const row = (label, v, cls) => {
      const r = el('div', 'row');
      r.innerHTML = `<span>${label}</span><span class="${cls}">${v >= 0 ? '+' : ''}${money(v)}</span>`;
      return r;
    };
    ledger.append(row('Income tax', f.incomeTax, 'pos'));
    if (f.gst > 0) ledger.append(row('GST', f.gst, 'pos'));
    ledger.append(row('Business & trade', f.business, 'pos'));
    const svc = f.upkeep - (f.interest || 0) - (f.social || 0) - (f.imports || 0);
    ledger.append(row('Upkeep & services', -svc, 'neg'));
    if (f.imports > 0.05) ledger.append(row('Imports (food, fuel, materials)', -f.imports, 'neg'));
    if (f.social > 0.05) ledger.append(row('Pensions & elder care', -f.social, 'neg'));
    if (f.interest > 0.005) ledger.append(row('Bond interest', -f.interest, 'neg'));
    const net = el('div', 'row');
    net.style.cssText = 'border-top:1px solid var(--line);padding-top:5px;font-weight:800';
    net.innerHTML = `<span>Net / month</span><span class="${f.net >= 0 ? 'pos' : 'neg'}">${money(f.net)}</span>`;
    ledger.append(net);
    led.append(ledger);
    wrap.append(led);
  }

  // ---- Borrowing: government bonds ----
  if (ctx.borrow) {
    wrap.append(el('div', 'section-title', 'Treasury & Borrowing'));
    const ceil = debtCeiling(state), debt = state.debt || 0, room = Math.max(0, ceil - debt);
    const fin = el('div', 'metric span2');
    fin.innerHTML = `
      <div class="ledger">
        <div class="row"><span>National debt</span><span class="${debt > 0 ? 'neg' : ''}">${money(debt)}</span></div>
        <div class="row"><span>Borrowing limit</span><span>${money(ceil)}</span></div>
        <div class="row"><span>Coupon rate</span><span>${(bondRate(state) * 100).toFixed(1)}% / yr</span></div>
      </div>`;
    const bar = el('div', 'bar'); bar.style.marginTop = '8px';
    bar.innerHTML = `<i style="width:${Math.min(100, ceil ? debt / ceil * 100 : 0)}%;background:${debt / ceil > 0.8 ? 'var(--bad)' : 'var(--warn)'}"></i>`;
    fin.append(bar);
    const frow = el('div', 'fin-actions');
    for (const amt of (SANDBOX ? [500, 5000, 50000] : [100, 250, 500])) { // sandbox: big denominations for quick test cash
      const b = el('button', 'btn tiny', `Issue ${money(amt)}`);
      if (amt > room + 0.5) { b.disabled = true; b.style.opacity = '0.4'; }
      b.onclick = () => ctx.borrow(amt);
      frow.append(b);
    }
    fin.append(el('div', 'section-title', 'Issue bonds (borrow)'));
    fin.append(frow);
    if (debt > 0) {
      const rrow = el('div', 'fin-actions');
      const r1 = el('button', 'btn tiny', `Repay ${money(Math.min(100, debt))}`); r1.onclick = () => ctx.repay(100); rrow.append(r1);
      const rAll = el('button', 'btn tiny', 'Repay all'); rAll.onclick = () => ctx.repay(debt); rrow.append(rAll);
      fin.append(el('div', 'section-title', 'Repay debt'));
      fin.append(rrow);
    }
    wrap.append(fin);
  }
  return wrap;
}

// A titled group of metric cards.
function section(title, cards) {
  const s = el('div', 'dash-section');
  s.append(el('div', 'section-title', title));
  const grid = el('div', 'dash-grid');
  for (const c of cards) grid.append(c);
  s.append(grid);
  return s;
}
// A meter bar (0–100%) with a fill colour.
function bar(width, color) {
  return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, width))}%;background:${color}"></i></div>`;
}
// Occupancy colour: green when there are homes for all, red when overcrowded.
function occColor(pressure) {
  return pressure <= 1.0 ? 'var(--good)' : pressure <= 1.15 ? 'var(--warn)' : 'var(--bad)';
}
// A metric card. `tip` (optional) adds a hover/tap explanation so players learn
// what the term means and what it does; `opts.bar` appends a meter, `opts.valStyle`
// styles the value, `opts.span2` widens the card to both columns.
// A single body-level tooltip, positioned by JS next to whatever card is hovered.
// Being a fixed overlay (not a child of the card), it never changes the card's size
// or nudges its neighbours — the whole point of moving it out of the grid.
let _statTip = null, _tipFor = null;
function statTipEl() {
  if (!_statTip) {
    _statTip = document.createElement('div'); _statTip.className = 'stat-tip'; _statTip.style.display = 'none';
    document.body.appendChild(_statTip);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.metric.has-tip')) hideStatTip(); }, true);
    window.addEventListener('scroll', hideStatTip, true);
  }
  return _statTip;
}
function showStatTip(card, text) {
  const t = statTipEl(); t.textContent = text; _tipFor = card;
  t.style.display = 'block';
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  const tw = Math.min(300, vw - pad * 2); t.style.width = tw + 'px';
  const r = card.getBoundingClientRect(), th = t.offsetHeight;
  const left = Math.min(Math.max(pad, r.left), vw - tw - pad);
  let top = r.bottom + 6; if (top + th > vh - pad) top = Math.max(pad, r.top - th - 6);   // flip above if no room below
  t.style.left = `${left}px`; t.style.top = `${top}px`;
}
function hideStatTip() { if (_statTip) { _statTip.style.display = 'none'; _tipFor = null; } }

function metric(label, val, sub, tip, opts = {}) {
  const m = el('div', 'metric' + (opts.span2 ? ' span2' : '') + (tip ? ' has-tip' : ''));
  m.innerHTML = `<div class="m-label">${label}${tip ? '<span class="m-info" aria-hidden="true">i</span>' : ''}</div>
    <div class="m-val"${opts.valStyle ? ` style="${opts.valStyle}"` : ''}>${val}</div>
    ${sub ? `<div class="m-sub">${sub}</div>` : ''}
    ${opts.bar || ''}`;
  if (tip) {
    m.addEventListener('mouseenter', () => showStatTip(m, tip));
    m.addEventListener('mouseleave', hideStatTip);
    m.addEventListener('click', (e) => { e.stopPropagation(); (_tipFor === m) ? hideStatTip() : showStatTip(m, tip); });   // tap to toggle on touch
  }
  return m;
}
function meterMetric(label, v, invert = false, tip) {
  const color = invert ? (v <= 33 ? 'var(--good)' : v <= 66 ? 'var(--warn)' : 'var(--bad)') : barColor(v);
  return metric(label, pct(v), null, tip, { bar: bar(v, color) });
}
function ratioMetric(label, gen, use, unit, tip) {
  const ratio = use > 0 ? gen / use : 2;
  const color = ratio >= 1 ? 'var(--good)' : ratio >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  return metric(label, `${Math.round(gen)} / ${Math.round(use)} ${unit}`,
    ratio >= 1 ? `Surplus · ${Math.round(ratio * 100)}%` : `SHORTAGE · ${Math.round(ratio * 100)}%`,
    tip, { valStyle: 'font-size:15px', bar: bar(Math.min(100, ratio * 100), color) });
}

// ===========================================================================
// NEWS / EVENTS LOG
// ===========================================================================
const NEWS_SCOPE = {
  foreign: '🌐 Foreign affairs', internal: '🏛️ Internal affairs', fire: '🔥 Disaster',
  incident: '🚨 On the ground', daily: '🗞️ Daily life', tech: '🔬 Technology', project: '🏗️ National project',
};
export function renderNews(state) {
  const wrap = el('div');
  if (!state.log.length) { wrap.append(el('div', 'empty', 'No news yet. History is being written…')); return wrap; }
  for (const entry of state.log) {
    const item = el('div', 'news-item' + (entry.scope ? ' sc-' + entry.scope : ''));
    const meta = el('div', 'news-meta');
    const date = el('span', 'news-date'); date.textContent = formatDate(entry.d);
    meta.append(date);
    if (entry.scope && NEWS_SCOPE[entry.scope]) { const tag = el('span', 'news-tag'); tag.textContent = NEWS_SCOPE[entry.scope]; meta.append(tag); }
    const head = el('div', 'news-text'); head.textContent = entry.text;
    item.append(meta, head);
    if (entry.detail) { const body = el('div', 'news-detail'); body.textContent = entry.detail; item.append(body); }
    wrap.append(item);
  }
  return wrap;
}

export { el };
