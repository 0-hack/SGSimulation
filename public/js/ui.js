// UI rendering helpers: builds the contents of each bottom sheet/panel.
// Returns DOM and wires callbacks; keeps main.js focused on orchestration.
import { BUILDINGS, CATEGORIES, POLICIES, POP_SCALE } from './data.js';
import { derive, isUnlocked, formatDate } from './engine.js';
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
      `<span class="ci">${ICONS[CAT_ICON[c.id]] || ''}</span>${c.name}`);
    t.onclick = () => ctx.setCat(c.id);
    tabs.append(t);
  }
  wrap.append(tabs);

  // Buildings in category
  const grid = el('div', 'build-grid');
  for (const [key, b] of Object.entries(BUILDINGS)) {
    if (b.cat !== ctx.cat) continue;
    const unlocked = isUnlocked(state, key);
    const affordable = state.treasury >= b.cost;
    const card = el('button', 'bcard'
      + (unlocked ? '' : ' locked')
      + (ctx.selected === key ? ' selected' : ''));

    const tags = buildingTags(b);
    card.innerHTML = `
      <div class="b-top">
        <span class="b-ico">${b.icon}</span>
        <div style="flex:1">
          <div class="b-name">${b.name}</div>
          <div class="b-cost">${money(b.cost)} · upkeep ${money(b.upkeep)}/mo</div>
        </div>
      </div>
      <div class="b-desc">${b.desc}</div>
      <div class="b-tags">${tags}</div>
      ${unlocked ? '' : `<span class="b-lock">🔒 ${b.year}</span>`}`;
    if (!affordable && unlocked) card.style.opacity = '0.6';
    if (unlocked) card.onclick = () => ctx.selectBuilding(key);
    grid.append(card);
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
export function renderDash(state) {
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
    ledger.append(row('Upkeep & services', -f.upkeep, 'neg'));
    const net = el('div', 'row');
    net.style.cssText = 'border-top:1px solid var(--line);padding-top:5px;font-weight:800';
    net.innerHTML = `<span>Net / month</span><span class="${f.net >= 0 ? 'pos' : 'neg'}">${money(f.net)}</span>`;
    ledger.append(net);
    led.append(ledger);
    wrap.append(led);
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
