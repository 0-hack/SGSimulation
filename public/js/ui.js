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

  // Buildings in category — only those whose technology is available yet are
  // shown; more surface automatically as the decades pass. Anything shown can
  // be built (borrow from the dashboard if the treasury is short).
  const grid = el('div', 'build-grid');
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (b.cat !== ctx.cat) continue;
    if (!isUnlocked(state, key)) continue;       // not invented yet — hidden, not locked
    const cost = buildingCost(state, key);       // base cost × today's price level
    const affordable = state.treasury >= cost;
    const card = el('button', 'bcard' + (ctx.selected === key ? ' selected' : ''));

    const tags = buildingTags(b);
    const inflated = cost > b.cost ? ` <span class="b-infl" title="Base ${money(b.cost)} × inflation">▲</span>` : '';
    card.innerHTML = `
      <div class="b-top">
        <span class="b-ico">${b.icon}</span>
        <div style="flex:1">
          <div class="b-name">${b.name}</div>
          <div class="b-cost">${money(cost)}${inflated} · upkeep ${money(b.upkeep)}/mo · ~${buildDays(b)}d</div>
        </div>
      </div>
      <div class="b-desc">${b.desc}</div>
      <div class="b-tags">${tags}</div>`;
    if (!affordable) card.style.opacity = '0.6';
    card.onclick = () => ctx.selectBuilding(key);
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
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

function buildingTags(b) {
  const t = [];
  if (b.homes) t.push(`<span class="tag good">🏠 ${num(b.homes * POP_SCALE)}</span>`);
  if (b.jobs) t.push(`<span class="tag good">💼 ${num(b.jobs)}</span>`);
  if (b.power > 0) t.push(`<span class="tag good">⚡ +${b.power}</span>`);
  if (b.power < 0) t.push(`<span class="tag">⚡ ${b.power}</span>`);
  if (b.water > 0) t.push(`<span class="tag good">💧 +${b.water}</span>`);
  if (b.water < 0) t.push(`<span class="tag">💧 ${b.water}</span>`);
  if (b.income) t.push(`<span class="tag good">💰 +${money(b.income)}/mo</span>`);
  if (b.pollution > 0) t.push(`<span class="tag bad">☁️ +${b.pollution}</span>`);
  if (b.pollution < 0) t.push(`<span class="tag good">🌿 ${b.pollution}</span>`);
  if (b.education) t.push(`<span class="tag good">📚 +${b.education}</span>`);
  if (b.health) t.push(`<span class="tag good">⚕️ +${b.health}</span>`);
  if (b.safety) t.push(`<span class="tag good">🛡️ +${b.safety}</span>`);
  return t.join('');
}

// ===========================================================================
// POLICY PANEL
// ===========================================================================
export function renderPolicy(state, ctx) {
  const wrap = el('div');
  wrap.append(el('p', 'policy-desc', 'Laws and policies shape your society for decades. Choices have trade-offs — revenue vs. happiness, growth vs. harmony.'));

  for (const [key, p] of Object.entries(POLICIES)) {
    const unlocked = state.date.y >= p.year;
    const box = el('div', 'policy' + (unlocked ? '' : ' locked'));
    const head = el('div', 'policy-head');
    head.innerHTML = `<span class="p-ico">${p.icon}</span><span class="p-name">${p.name}</span>`;

    if (p.type === 'toggle') {
      const sw = el('div', 'switch' + (state.policies[key] ? ' on' : ''));
      if (unlocked && !ctx.readOnly) sw.onclick = () => ctx.togglePolicy(key);
      head.append(sw);
    }
    box.append(head);
    box.append(el('div', 'policy-desc', p.desc + (unlocked ? '' : ` <b>(available ${p.year})</b>`)));

    if (p.type === 'level') {
      const opts = el('div', 'opts');
      for (const o of p.options) {
        const b = el('button', 'opt' + (state.policies[key] === o.id ? ' active' : ''), o.label);
        if (unlocked && !ctx.readOnly) b.onclick = () => ctx.setPolicy(key, o.id);
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
  wrap.append(section('Society & Environment', [
    meterMetric('🙂 Approval', state.approval, false,
      'How happy citizens are with your leadership. Jobs, homes, utilities, services and clean air lift it; shortages, unemployment and pollution sink it. Let it fall too far and you risk unrest.'),
    meterMetric('🛡️ Safety', state.safety, false,
      'Law, order and fire protection. Police posts, fire stations and community centres raise it; safe streets keep citizens and investors confident.'),
    meterMetric('📚 Education', state.education, false,
      'The skill of your workforce. Schools and technical institutes raise it, lifting productivity and tax revenue — the bet behind Singapore\'s rise.'),
    meterMetric('⚕️ Health', state.health, false,
      'Public health. Hospitals, clinics, clean water and sewerage raise it, cutting death rates and softening epidemics.'),
    meterMetric('☁️ Pollution', state.pollution, true,
      'Dirty air from industry and power stations. High pollution harms health and happiness; parks, nature, the MRT and clean energy bring it down.'),
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
    const svc = f.upkeep - (f.interest || 0);
    ledger.append(row('Upkeep & services', -svc, 'neg'));
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
function metric(label, val, sub, tip, opts = {}) {
  const m = el('div', 'metric' + (opts.span2 ? ' span2' : '') + (tip ? ' has-tip' : ''));
  m.innerHTML = `<div class="m-label">${label}${tip ? '<span class="m-info" title="What is this?">i</span>' : ''}</div>
    <div class="m-val"${opts.valStyle ? ` style="${opts.valStyle}"` : ''}>${val}</div>
    ${sub ? `<div class="m-sub">${sub}</div>` : ''}
    ${opts.bar || ''}
    ${tip ? `<div class="m-tip">${tip}</div>` : ''}`;
  if (tip) m.addEventListener('click', () => m.classList.toggle('show-tip'));   // tap to reveal on touch devices
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
export function renderNews(state) {
  const wrap = el('div');
  if (!state.log.length) { wrap.append(el('div', 'empty', 'No news yet. History is being written…')); return wrap; }
  for (const entry of state.log) {
    const item = el('div', 'news-item');
    item.innerHTML = `<div class="news-date">${formatDate(entry.d)}</div><div class="news-text">${entry.text}</div>`;
    wrap.append(item);
  }
  return wrap;
}

export { el };
