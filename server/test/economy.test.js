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

  // ---- Age-structured population, driven by POLICY ---------------------------
  const demo = await p.evaluate(() => {
    const st = window.__sg.state;
    const c0 = st.cohorts, sumOk = Math.abs((c0.young + c0.work + c0.old) - st.population) < 2;
    const startWorkPct = c0.work / st.population * 100, startOldPct = c0.old / st.population * 100;
    const snap = () => ({ y: st.cohorts.young, w: st.cohorts.work, o: st.cohorts.old, p: st.population, h: st.health, pol: { ...st.policies }, date: { ...st.date }, gb: st.growthBuf });
    const restore = (s) => { st.cohorts = { young: s.y, work: s.w, old: s.o }; st.population = s.p; st.health = s.h; st.policies = { ...s.pol }; st.date = { ...s.date }; st.growthBuf = s.gb; };
    const base = snap();

    // Family Planning (from 1972): "Have Three" grows the young, "Stop at Two" shrinks it
    st.date = { y: 1975, m: 6, d: 1 }; st.policies.family_policy = 'three'; window.__sg.tick(365 * 2); const yThree = st.cohorts.young; restore(base);
    st.date = { y: 1975, m: 6, d: 1 }; st.policies.family_policy = 'stop2'; window.__sg.tick(365 * 2); const yStop2 = st.cohorts.young; restore(base);

    // Immigration (with housing room): "Open Doors" grows the working-age faster than "Strict"
    const room = () => { st.population = 30000; st.cohorts = { young: 9000, work: 18000, old: 3000 }; st.date = { y: 1975, m: 6, d: 1 }; };
    room(); st.policies.immigration = 'open'; window.__sg.tick(365 * 2); const wOpen = st.cohorts.work; restore(base);
    room(); st.policies.immigration = 'strict'; window.__sg.tick(365 * 2); const wStrict = st.cohorts.work; restore(base);

    // CPF (from 1968): on an aged society, high contribution self-funds retirement → smaller pension bill
    const aged = () => { st.population = 45000; st.cohorts = { young: 10000, work: 20000, old: 15000 }; st.date = { y: 1980, m: 6, d: 1 }; };
    aged(); st.policies.cpf = 'off'; window.__sg.tick(31); const socOff = st.lastFinance.social; restore(base);
    aged(); st.policies.cpf = 'high'; window.__sg.tick(31); const socHigh = st.lastFinance.social; restore(base);

    // Long run: decades of low births + closed borders greys the nation
    st.policies.family_policy = 'stop2'; st.policies.immigration = 'strict'; window.__sg.tick(365 * 22);
    const agedOldPct = st.cohorts.old / st.population * 100, agedWorkPct = st.cohorts.work / st.population * 100, agedDep = window.__sg.derive().dependency;

    return {
      sumOk, startWorkPct: +startWorkPct.toFixed(0), startOldPct: +startOldPct.toFixed(0),
      yThree: Math.round(yThree), yStop2: Math.round(yStop2), wOpen: Math.round(wOpen), wStrict: Math.round(wStrict),
      socOff: +socOff.toFixed(1), socHigh: +socHigh.toFixed(1),
      agedOldPct: +agedOldPct.toFixed(0), agedWorkPct: +agedWorkPct.toFixed(0), agedDep: +agedDep.toFixed(2),
    };
  });
  ok(demo.sumOk && demo.startWorkPct >= 58 && demo.startOldPct <= 6, `1965 opens as a young nation — cohorts sum to the population (${demo.startWorkPct}% working, ${demo.startOldPct}% elderly)`);
  ok(demo.yThree > demo.yStop2 + 500, `Family Planning bites: "Have Three" grows the young vs "Stop at Two" (${demo.yThree} vs ${demo.yStop2})`);
  ok(demo.wOpen > demo.wStrict + 200, `Immigration bites: "Open Doors" grows the working-age vs "Strict" (${demo.wOpen} vs ${demo.wStrict})`);
  ok(demo.socHigh < demo.socOff - 5, `CPF bites: high contribution shrinks the state pension bill ($${demo.socOff}M → $${demo.socHigh}M)`);
  ok(demo.agedOldPct > demo.startOldPct + 8 && demo.agedWorkPct < demo.startWorkPct - 8 && demo.agedDep > 0.85,
    `decades of low births + closed borders grey the nation (elderly ${demo.startOldPct}%→${demo.agedOldPct}%, working ${demo.startWorkPct}%→${demo.agedWorkPct}%, dependency ${demo.agedDep})`);

  // ---- DEFENCE & FOREIGN AFFAIRS ---------------------------------------------
  const def = await p.evaluate(() => {
    const st = window.__sg.state, v = window.__sgview, D = () => window.__sg.derive();
    const emptyLand = () => { for (let y = 4; y < st.grid.length - 4; y++) for (let x = 4; x < st.grid[y].length - 4; x++) if (!st.grid[y][x] && v.isLand(x, y)) return { x, y }; };
    const clearMil = () => { for (let y = 0; y < st.grid.length; y++) for (let x = 0; x < st.grid[y].length; x++) { const c = st.grid[y][x]; if (c && ['military_camp', 'naval_base', 'air_base', 'weapons_factory', 'defence_lab'].includes(c.k)) st.grid[y][x] = null; } };

    st.date = { y: 1965, m: 8, d: 9 }; st.threat = 0.5; clearMil();
    const start = D(); // British shield in place

    st.date = { y: 1975, m: 6, d: 1 };
    const bare = D(); // British gone, no forces of our own

    let c; c = emptyLand(); st.grid[c.y][c.x] = { k: 'air_base' };
    for (let i = 0; i < 3; i++) { c = emptyLand(); st.grid[c.y][c.x] = { k: 'military_camp' }; }
    const armed = D();

    st.policies.national_service = true; const ns = D().defence; st.policies.national_service = false;

    // investor confidence: business income under low vs high security
    clearMil(); st.date = { y: 1975, m: 6, d: 1 }; window.__sg.tick(31); const bizInsecure = st.lastFinance.business;
    c = emptyLand(); st.grid[c.y][c.x] = { k: 'air_base' }; for (let i = 0; i < 3; i++) { c = emptyLand(); st.grid[c.y][c.x] = { k: 'military_camp' }; }
    window.__sg.tick(31); const bizSecure = st.lastFinance.business;

    // International Stance: Regional Cooperation vs Non-Aligned threat (1 year)
    const runStance = (s) => { st.threat = 0.5; st.threatBuf = 0; st.policies.foreign_policy = s; st.date = { y: 1985, m: 1, d: 1 }; window.__sg.tick(365); return st.threat; };
    const thReg = runStance('regional'), thNon = runStance('nonaligned');

    return {
      startSec: +start.security.toFixed(2), bareSec: +bare.security.toFixed(2),
      bareDef: Math.round(bare.defence), armedDef: Math.round(armed.defence), armedSec: +armed.security.toFixed(2), nsDef: Math.round(ns),
      bizInsecure: +bizInsecure.toFixed(1), bizSecure: +bizSecure.toFixed(1),
      thReg: +thReg.toFixed(2), thNon: +thNon.toFixed(2),
    };
  });
  ok(def.startSec >= 1 && def.bareSec < 0.3, `the British garrison secures 1965 (${def.startSec}); after they leave in 1971 an undefended nation is exposed (${def.bareSec})`);
  ok(def.armedDef > def.bareDef + 100 && def.armedSec > def.bareSec + 0.8, `building an air base + camps restores security (defence ${def.bareDef} → ${def.armedDef})`);
  ok(def.nsDef > def.armedDef + 50, `National Service multiplies military strength (${def.armedDef} → ${def.nsDef})`);
  ok(def.bizSecure > def.bizInsecure, `investors reward security — trade income is higher when the nation is safe ($${def.bizInsecure}M → $${def.bizSecure}M/mo)`);
  ok(def.thReg < def.thNon - 0.1, `International Stance bites: Regional Cooperation lowers the external threat vs Non-Aligned (${def.thReg} vs ${def.thNon})`);

  // ---- Domestic incidents: crime / disease / accidents track conditions -------
  const inc = await p.evaluate(() => {
    const st = window.__sg.state, D = () => window.__sg.derive();
    const re = /🚨|🦠|⚠️ An industrial/;
    const count = () => st.log.filter((e) => re.test(e.text)).length;
    // risk responds to conditions: crime worse when jobless/unpoliced
    st.safety = 90; const lowCrime = D().crimeRisk;
    st.safety = 12; const highCrime = D().crimeRisk;
    st.health = 90; const lowDis = D().diseaseRisk;
    st.health = 12; const highDis = D().diseaseRisk;
    // a persistently neglected nation (kept unsafe & unhealthy) suffers a stream of
    // incidents; keep conditions bad each year since the stocks otherwise recover.
    // Count via the state tally (the news log is capped, so it evicts old entries).
    st.incidentCount = 0;
    for (let y = 0; y < 12; y++) { st.safety = 12; st.health = 14; window.__sg.tick(365); }
    const neglected = st.incidentCount;
    return {
      lowCrime: +lowCrime.toFixed(2), highCrime: +highCrime.toFixed(2),
      lowDis: +lowDis.toFixed(2), highDis: +highDis.toFixed(2), neglected,
    };
  });
  ok(inc.highCrime > inc.lowCrime + 0.15, `crime risk tracks conditions — high when jobless & unpoliced, low when safe (${inc.lowCrime} → ${inc.highCrime})`);
  ok(inc.highDis > inc.lowDis + 0.15, `disease risk tracks conditions — high when unhealthy & crowded, low when cared for (${inc.lowDis} → ${inc.highDis})`);
  ok(inc.neglected >= 6, `a neglected nation suffers a stream of incidents (${inc.neglected} crime/disease/accidents over 12 years)`);

  // ---- Import-dependent economy: the island buys food, fuel & materials -------
  const trade = await p.evaluate(() => {
    const st = window.__sg.state, D = () => window.__sg.derive();
    const d0 = D();
    st.economy.currency = 1; const strong = D().importBill;
    st.economy.currency = 0.7; const weak = D().importBill;
    st.economy.currency = 1;
    st.fuelShock = 0; const noShock = D().energyImport;
    st.fuelShock = 1.4; const shock = D().energyImport;
    st.fuelShock = 0;
    const food0 = D().foodImport;
    let placed = 0;
    for (let y = 4; y < st.grid.length - 4 && placed < 16; y++) for (let x = 4; x < st.grid[y].length - 4 && placed < 16; x++) if (!st.grid[y][x] && window.__sgview.isLand(x, y)) { st.grid[y][x] = { k: 'poultry_farm' }; placed++; }
    const food1 = D().foodImport;
    return { bill: +d0.importBill.toFixed(1), strong: +strong.toFixed(1), weak: +weak.toFixed(1), noShock: +noShock.toFixed(1), shock: +shock.toFixed(1), food0: +food0.toFixed(1), food1: +food1.toFixed(1) };
  });
  ok(trade.bill > 20, `a resource-poor island runs a real import bill from day one ($${trade.bill}M/mo)`);
  ok(trade.weak > trade.strong + 5, `a weak currency swells the import bill ($${trade.strong}M → $${trade.weak}M)`);
  ok(trade.shock > trade.noShock + 10, `an oil shock spikes the fuel import bill ($${trade.noShock}M → $${trade.shock}M)`);
  ok(trade.food1 < trade.food0 - 5, `growing your own food cuts food imports ($${trade.food0}M → $${trade.food1}M)`);

  // ---- Traffic congestion: grows with the city, eased by the MRT & ERP --------
  const cong = await p.evaluate(() => {
    const st = window.__sg.state, v = window.__sg.state, D = () => window.__sg.derive();
    const view = window.__sgview;
    const start = D().congestion;
    st.population = 220000; st.cohorts = { young: 66000, work: 132000, old: 22000 }; st.date = { y: 1995, m: 6, d: 1 };
    st.policies.car_quota = false; const big = D().congestion;
    st.policies.car_quota = true; const quota = D().congestion;
    st.policies.car_quota = false;
    let placed = 0;
    for (let y = 4; y < st.grid.length - 4 && placed < 8; y++) for (let x = 4; x < st.grid[y].length - 4 && placed < 8; x++) if (!st.grid[y][x] && view.isLand(x, y)) { st.grid[y][x] = { k: 'mrt' }; placed++; }
    const mrt = D().congestion;
    return { start: +start.toFixed(2), big: +big.toFixed(2), quota: +quota.toFixed(2), mrt: +mrt.toFixed(2) };
  });
  ok(cong.big > cong.start + 0.15, `traffic congestion grows as the city grows (${cong.start} → ${cong.big})`);
  ok(cong.quota < cong.big, `the Car Quota / ERP policy eases congestion (${cong.big} → ${cong.quota})`);
  ok(cong.mrt < cong.big - 0.15, `building the MRT carries commuters off the roads (${cong.big} → ${cong.mrt})`);

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
