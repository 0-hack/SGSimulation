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

  // ---- Weather feeds the sim: drought squeezes water, heat lifts power --------
  const climate = await p.evaluate(() => {
    const st = window.__sg.state, D = () => window.__sg.derive();
    st.climate = { water: 1, heat: 0 }; const b = D();
    st.climate = { water: 0.7, heat: 0 }; const dry = D();
    st.climate = { water: 1.15, heat: 0 }; const wet = D();
    st.climate = { water: 1, heat: 1 }; const hot = D();
    st.climate = { water: 1, heat: 0.3 };
    return { base: Math.round(b.waterGen), dry: Math.round(dry.waterGen), wet: Math.round(wet.waterGen), pBase: Math.round(b.powerUse), pHot: Math.round(hot.powerUse) };
  });
  ok(climate.dry < climate.base && climate.wet > climate.base, `a drought cuts water supply, a wet spell tops it up (${climate.dry} < ${climate.base} < ${climate.wet})`);
  ok(climate.pHot > climate.pBase, `a heatwave lifts electricity demand (${climate.pBase} → ${climate.pHot} MW)`);

  // ---- A fire burns a building down: real loss + emergency cost + news --------
  const fire = await p.evaluate(() => {
    const st = window.__sg.state, v = window.__sgview;
    let gx = -1, gy = -1;
    for (let y = 2; y < st.grid.length - 2 && gx < 0; y++) for (let x = 2; x < st.grid[y].length - 2; x++) { if (!st.grid[y][x] && v.isLand(x, y)) { gx = x; gy = y; break; } }
    st.grid[gy][gx] = { k: 'factory' };
    const c = v.worldOfCell(gx, gy), t0 = st.treasury, a0 = st.approval;
    v.weather = { ...v.weather, rain: 0, cloud: 0 }; v._dryness = 0.2;   // dry → the fire is NOT doused
    v.igniteFireAt(c.x, c.z, 'building', `${gx},${gy}`);
    const lit = v._fires.length > 0;
    v._updateFire(20);                                                   // one step longer than its life → it burns out
    return { lit, cleared: st.grid[gy][gx] === null, cost: +(t0 - st.treasury).toFixed(1), approvalDropped: st.approval < a0, logged: st.log.slice(0, 4).some((e) => /Fire destroys/.test(e.text)) };
  });
  ok(fire.lit && fire.cleared, 'a fire that is not doused burns the building down (removed from the map & economy)');
  ok(fire.cost > 0 && fire.approvalDropped && fire.logged, `the blaze costs an emergency response ($${fire.cost}M), dents approval, and makes the news`);

  // ---- WHERE you build matters: local service access & industrial blight ------
  const cov = await p.evaluate(() => {
    const st = window.__sg.state, D = () => window.__sg.derive();
    const start = D();                                    // the standing 1965 town
    for (let y = 0; y < st.grid.length; y++) for (let x = 0; x < st.grid[y].length; x++) st.grid[y][x] = null;
    st.grid[100][100] = { k: 'hdb_flat' }; st.grid[100][101] = { k: 'hdb_flat' }; st.grid[101][100] = { k: 'hdb_flat' };
    const alone = D();                                    // an isolated estate, nothing nearby
    st.grid[100][102] = { k: 'school' }; st.grid[102][100] = { k: 'park' }; st.grid[101][101] = { k: 'clinic' };
    const served = D();                                   // now with services next door
    const a0 = window.__sg.derive();
    st.grid[99][99] = { k: 'factory' }; st.grid[99][100] = { k: 'processing' };
    const blighted = D();
    // approval target reacts to blight (compare the pull it exerts)
    return { startAccess: +start.serviceAccess.toFixed(2), alone: +alone.serviceAccess.toFixed(2), served: +served.serviceAccess.toFixed(2), blight0: +a0.blight.toFixed(2), blight1: +blighted.blight.toFixed(2) };
  });
  ok(cov.alone < 0.15 && cov.served > cov.alone + 0.3, `an isolated estate has poor service access (${cov.alone}) that a school/clinic/park nearby lifts (${cov.served})`);
  ok(cov.blight1 > cov.blight0 + 0.3, `building homes against heavy industry raises blight (${cov.blight0} → ${cov.blight1})`);
  ok(cov.startAccess > 0.5, `the dense 1965 town is reasonably well-served (access ${cov.startAccess})`);

  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
