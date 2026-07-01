// The standing 1965 city is economically REAL: demolishing prebuilt housing, power
// or water plainly moves the national stats, the start sits on a historical footing,
// and the National Dashboard groups the numbers by category with hover explanations.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 900, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await sleep(600);

  // ---- The 1965 start is a real, balanced economy -------------------------
  const start = await p.evaluate(() => {
    const st = window.__sg.state, d = window.__sg.derive();
    return {
      pop: st.population, homes: Math.round(d.homes), pressure: +d.housingPressure.toFixed(2),
      unemp: +(d.unemployment * 100).toFixed(1),
      powerRatio: +d.powerRatio.toFixed(2), waterRatio: +d.waterRatio.toFixed(2),
    };
  });
  ok(start.pressure >= 1.0 && start.pressure <= 1.12, `1965 opens on a mild housing shortage (occupancy ${Math.round(start.pressure * 100)}%)`);
  ok(start.unemp >= 8 && start.unemp <= 15, `unemployment is a historical ~11% (${start.unemp}%)`);
  ok(start.powerRatio > 1 && start.waterRatio > 1, `power & water open in a thin surplus (×${start.powerRatio} / ×${start.waterRatio})`);

  // ---- Demolishing a prebuilt POWER STATION drops generation --------------
  const power = await p.evaluate(() => {
    const st = window.__sg.state, v = window.__sgview;
    const find = (pred) => { for (let y = 0; y < st.grid.length; y++) for (let x = 0; x < st.grid[y].length; x++) { const c = st.grid[y][x]; if (c && pred(c)) return { x, y }; } return null; };
    const gen0 = window.__sg.derive().powerGen;
    const ps = find((c) => c.k === 'power_station' && c.heritage);
    const removed = ps && v.removeHeritageVisual(ps.x, ps.y); window.__sg.afterEdit();
    return { removed: !!removed, gen0: Math.round(gen0), gen1: Math.round(window.__sg.derive().powerGen) };
  });
  ok(power.removed && power.gen1 < power.gen0 - 50, `demolishing a 1965 power station cuts generation (${power.gen0} → ${power.gen1} MW)`);

  // ---- Demolishing a prebuilt HOME (incl. the decorative old town) drops homes
  const housing = await p.evaluate(() => {
    const st = window.__sg.state, v = window.__sgview;
    const find = (pred) => { for (let y = 0; y < st.grid.length; y++) for (let x = 0; x < st.grid[y].length; x++) { const c = st.grid[y][x]; if (c && pred(c)) return { x, y }; } return null; };
    const homes0 = window.__sg.derive().homes;
    const sh = find((c) => c.k === 'shophouse' && c.heritage);
    const removed = sh && v.removeHeritageVisual(sh.x, sh.y); window.__sg.afterEdit();
    const d1 = window.__sg.derive();
    return { removed: !!removed, homes0: Math.round(homes0), homes1: Math.round(d1.homes), press0: null };
  });
  ok(housing.removed && housing.homes1 < housing.homes0, `demolishing a prebuilt shophouse removes homes (${housing.homes0} → ${housing.homes1})`);

  // ---- Finances stay sane after a month ----------------------------------
  const fin = await p.evaluate(() => { window.__sg.tick(31); const f = window.__sg.state.lastFinance; return { net: f ? +f.net.toFixed(1) : null, treasury: +window.__sg.state.treasury.toFixed(0) }; });
  ok(fin.net !== null && fin.treasury > 0, `the monthly budget resolves and the treasury holds ($${fin.treasury}M, net ${fin.net}/mo)`);

  // ---- The National Dashboard groups stats by category with explanations --
  const dash = await p.evaluate(() => {
    document.querySelector('.tool[data-panel="dash"]').click();
    return new Promise((res) => setTimeout(() => {
      const titles = [...document.querySelectorAll('#sheet-content .section-title')].map((s) => s.textContent);
      const wantCats = ['Housing & People', 'Supply Chain & Utilities', 'Economy', 'Society & Environment', 'Financial Planning'];
      const hasCats = wantCats.every((c) => titles.includes(c));
      const tipCards = [...document.querySelectorAll('#sheet-content .metric.has-tip')];
      const allHaveTips = tipCards.length >= 8 && tipCards.every((c) => { const t = c.querySelector('.m-tip'); return t && t.textContent.trim().length > 30; });
      // reveal one tooltip and confirm it becomes visible (in-flow, non-zero height)
      const one = tipCards[0]; one.classList.add('show-tip');
      const tip = one.querySelector('.m-tip'); const shows = tip.offsetHeight > 0;
      return res({ hasCats, tipCount: tipCards.length, allHaveTips, shows });
    }, 400));
  });
  ok(dash.hasCats, 'the dashboard is organised into categories (Housing, Supply Chain, Economy, Society, Finance)');
  ok(dash.allHaveTips, `each stat carries a plain-language explanation (${dash.tipCount} metrics with tooltips)`);
  ok(dash.shows, 'hovering/tapping a stat reveals its explanation');

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
