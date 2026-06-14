// UI rendering helpers: builds the contents of each bottom sheet/panel.
// Returns DOM and wires callbacks; keeps main.js focused on orchestration.
import { BUILDINGS, CATEGORIES, POLICIES, POP_SCALE, THEMES, ROAD_TYPES } from './data.js';
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
    `<span class="bi">${ICONS.bulldoze}</span> Bulldoze`);
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
  if (ctx.cat === 'roads') { wrap.append(renderRoads(ctx)); return wrap; }
  // Reclaim category shows the land-reclamation tool instead of buildings.
  if (ctx.cat === 'land') { wrap.append(renderReclaim(state, ctx)); return wrap; }

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

  // bridge / flyover toggle — only meaningful for roads & railways, not runways
  if (!ROAD_TYPES[r.type]?.air) {
    const bridge = el('div', 'checkbox');
    bridge.innerHTML = `<span class="switch${r.elevated ? ' on' : ''}"></span> Elevated flyover / bridge`;
    bridge.querySelector('.switch').onclick = () => ctx.toggleBridge();
    wrap.append(bridge);
  }

  // tools — ✏️ Draw (freehand) leads
  wrap.append(el('div', 'section-title', 'Tool'));
  const tools = el('div', 'road-tools');
  const onLand = !ROAD_TYPES[r.type]?.rail && !ROAD_TYPES[r.type]?.air;   // roundabout is road-only
  const defs = [
    ['draw', '✏️ Draw'], ['straight', '▭ Straight'], ['curveL', '↰ Curve'], ['curveR', '↱ Curve'],
    ...(onLand ? [['roundabout', 'Roundabout']] : []), ['erase', 'Erase'],
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

  const grid = el('div', 'dash-grid');

  grid.append(metric('💵 Treasury', money(state.treasury),
    state.lastFinance ? `${state.lastFinance.net >= 0 ? '▲' : '▼'} ${money(Math.abs(state.lastFinance.net))}/mo` : ''));
  grid.append(metric('👥 Population', num(popReal),
    `${num(d.homes * POP_SCALE)} homes`));

  grid.append(meterMetric('🙂 Approval', state.approval));
  grid.append(meterMetric('🛡️ Safety', state.safety));
  grid.append(meterMetric('📚 Education', state.education));
  grid.append(meterMetric('⚕️ Health', state.health));

  // Power & water as supply/demand
  grid.append(ratioMetric('⚡ Power', d.powerGen, d.powerUse, 'MW'));
  grid.append(ratioMetric('💧 Water', d.waterGen, d.waterUse, 'units'));

  grid.append(metric('💼 Jobs', num(d.jobs),
    `${pct((1 - d.unemployment) * 100)} employed`));
  grid.append(meterMetric('☁️ Pollution', state.pollution, true));

  // Inflation & currency — a live read on economic management.
  const infl = inflationRate(state) * 100;
  const inflArrow = infl > 4 ? '▲' : infl < 1.5 ? '▼' : '◆';
  grid.append(metric('📈 Inflation', `${infl.toFixed(1)}%`,
    `prices ×${priceIndex(state).toFixed(2)} ${inflArrow}`));
  grid.append(metric('💱 SGD strength', `×${currencyStrength(state).toFixed(2)}`,
    currencyStrength(state) >= 1 ? 'strong currency' : 'weak currency'));

  wrap.append(grid);

  // Finance ledger
  if (state.lastFinance) {
    wrap.append(el('div', 'section-title', 'Monthly Budget'));
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
    for (const amt of [100, 250, 500]) {
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

function metric(label, val, sub) {
  const m = el('div', 'metric');
  m.innerHTML = `<div class="m-label">${label}</div><div class="m-val">${val}</div>${sub ? `<div class="m-sub">${sub}</div>` : ''}`;
  return m;
}
function meterMetric(label, v, invert = false) {
  const m = el('div', 'metric');
  const color = invert ? (v <= 33 ? 'var(--good)' : v <= 66 ? 'var(--warn)' : 'var(--bad)') : barColor(v);
  m.innerHTML = `<div class="m-label">${label}</div><div class="m-val">${pct(v)}</div>
    <div class="bar"><i style="width:${Math.min(100, v)}%;background:${color}"></i></div>`;
  return m;
}
function ratioMetric(label, gen, use, unit) {
  const m = el('div', 'metric');
  const ratio = use > 0 ? gen / use : 2;
  const okPct = Math.min(100, ratio * 100);
  const color = ratio >= 1 ? 'var(--good)' : ratio >= 0.8 ? 'var(--warn)' : 'var(--bad)';
  m.innerHTML = `<div class="m-label">${label}</div>
    <div class="m-val" style="font-size:15px">${Math.round(gen)} / ${Math.round(use)} ${unit}</div>
    <div class="m-sub">${ratio >= 1 ? 'Surplus' : 'SHORTAGE'}</div>
    <div class="bar"><i style="width:${okPct}%;background:${color}"></i></div>`;
  return m;
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
