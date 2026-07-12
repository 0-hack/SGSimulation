// The tracer highlights ROAD JOINS: wherever a road you draw meets another road
// (an endpoint landing on it = T/end-to-end, or a mid-span crossing = X) a green
// ring is drawn, the count shows in the stat, and every join is written into the
// exported JSON so the map build connects them and vehicles drive across. Works for
// all three road kinds (2-way, single, dirt).
import puppeteer from 'puppeteer';
import { app } from '../server.js';
process.env.TRACE_EDIT = '1';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const p = await browser.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(base + '/trace.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));

  // A = 2-way trunk (horizontal). B = single lane meeting A at its end (T/end join).
  // C = dirt road crossing A mid-span (X join). D = a lone 2-way that touches nothing.
  const imported = {
    version: 3,
    roads: [
      { pts: [[0.30, 0.55], [0.45, 0.55]], oneway: false, dirt: false }, // A
      { pts: [[0.45, 0.55], [0.45, 0.62]], oneway: true,  dirt: false }, // B: shares A's end
      { pts: [[0.35, 0.50], [0.35, 0.60]], oneway: false, dirt: true  }, // C: crosses A at 0.35,0.55
      { pts: [[0.70, 0.20], [0.78, 0.20]], oneway: false, dirt: false }, // D: isolated (no join)
    ],
  };
  const { writeFileSync } = await import('node:fs');
  const tmp = '/tmp/_tracer_join.json'; writeFileSync(tmp, JSON.stringify(imported));
  await (await p.$('#load')).uploadFile(tmp);
  await new Promise(r => setTimeout(r, 400));

  const res = await p.evaluate(() => {
    const stat = document.getElementById('stat').innerText || document.getElementById('stat').textContent || '';
    let captured = null; const realCreate = URL.createObjectURL, realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    return new Promise((resolve) => {
      const rd = new FileReader();
      URL.createObjectURL = (blob) => { rd.onload = () => { try { captured = JSON.parse(rd.result); } catch {} URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; resolve({ stat, exp: captured }); }; rd.readAsText(blob); return 'blob:stub'; };
      document.getElementById('export').click();
    });
  });

  const e = res.exp || {};
  const joins = Array.isArray(e.joins) ? e.joins : [];
  ok(/join/i.test(res.stat), `the stat reports joins (stat: ${res.stat.replace(/\s+/g, ' ').trim().slice(-40)})`);
  ok(joins.length >= 2, `Export carries the join points (${joins.length} — expected the T-end and the crossing)`);
  // the two joins should sit at A's end (~0.45,0.55) and the crossing (~0.35,0.55)
  const near = (jx, jy, x, y) => Math.hypot(jx - x, jy - y) < 0.01;
  ok(joins.some(([x, y]) => near(x, y, 0.45, 0.55)), 'a join marks the T where the single lane meets the 2-way end');
  ok(joins.some(([x, y]) => near(x, y, 0.35, 0.55)), 'a join marks the X where the dirt road crosses the 2-way');
  ok(!joins.some(([x, y]) => near(x, y, 0.74, 0.20)), 'the isolated road produces NO join (touching only is detected)');
  ok(e.roads && e.roads.length >= 4 && e.roads.some(r => r.oneway) && e.roads.some(r => r.dirt), 'all three road kinds still export with their types');
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
