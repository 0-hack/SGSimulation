// The 1965 downtown reads like the real map: the Raffles Place / Collyer Quay office
// towers stand north-east of the Tanjong Pagar railway terminus on the waterfront —
// well clear of it — and pack cheek-by-jowl (named landmarks reserve only their own
// cell so the dense core sits at its true map position) without fully stacking.
// Guards the CBD georeference + the tight named-landmark placement.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.dismiss());
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  const r = await p.evaluate(() => {
    const v = window.__sgview;
    const H = (v.heritagePlacements || []).filter((q) => !q.decor);
    const at = (key) => H.find((q) => q.key === key);
    const st = at('tanjong_pagar_station');
    const offices = ['bank_of_china', 'asia_insurance', 'finlayson_house', 'ocean_building', 'maritime_building'].map(at).filter(Boolean);
    const dist = (a, b) => Math.hypot(a.gx - b.gx, a.gy - b.gy);
    const nearest = st ? Math.min(...offices.map((o) => dist(o, st))) : 0;
    // north-east of the terminus, at the river mouth: east (bigger gx) and north
    // (bigger gy — larger gy is north in the cell grid, toward the Collyer Quay waterfront)
    const ne = st ? offices.filter((o) => o.gx > st.gx && o.gy > st.gy).length : 0;
    // no two named landmarks share a cell; the 1965 downtown stood cheek-by-jowl, so the
    // Collyer Quay office towers pack tight (adjacent cells allowed) but never fully stack.
    const named = H.filter((q) => q.name);
    let samecell = 0;
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) if (dist(named[i], named[j]) === 0) samecell++;
    let officeSep = 1e9;
    for (let i = 0; i < offices.length; i++) for (let j = i + 1; j < offices.length; j++) officeSep = Math.min(officeSep, dist(offices[i], offices[j]));
    return { hasStation: !!st, offices: offices.length, nearest, ne, samecell, officeSep: +officeSep.toFixed(2), named: named.length };
  });

  ok(r.hasStation && r.offices === 5, `the five Raffles Place office towers are seeded (${r.offices}) beside the station`);
  ok(r.nearest >= 8, `the office district stands clear of the Tanjong Pagar terminus (nearest ${r.nearest.toFixed(1)} cells away)`);
  ok(r.ne >= 4, `the offices sit north-east of the terminus, on the Collyer Quay waterfront (${r.ne}/5)`);
  ok(r.samecell === 0, `no two named landmarks are stacked on the same cell (${r.samecell})`);
  ok(r.officeSep >= 1, `the office towers stand cheek-by-jowl but never fully stack (closest pair ${r.officeSep} cells)`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
