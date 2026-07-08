// The map tracer (public/trace.html): loading a JSON file REPLACES the default map
// (the game overlay is dropped so only the imported trace shows), and Export writes a
// COMPLETE snapshot that carries every traced layer type back out — road, railway,
// reservoir, coast and sands alike — so a save never covers only part of the trace.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
process.env.TRACE_EDIT = '1';   // creator-tool test: the tracer route is gated otherwise
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
try {
  const p = await browser.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(base + '/trace.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));   // let the tracer boot (loads map + game overlay)

  // an imported file carrying EVERY layer type
  const imported = {
    version: 3,
    roads: [ { pts: [[0.30, 0.55], [0.40, 0.55]], oneway: false, dirt: false }, { pts: [[0.40, 0.55], [0.40, 0.60]], oneway: true, dirt: false }, { pts: [[0.40, 0.60], [0.50, 0.60]], oneway: false, dirt: true } ],
    railway: [ [[0.20, 0.50], [0.60, 0.50]] ],
    reservoirs: [ [[0.55, 0.62], [0.60, 0.62], [0.60, 0.66], [0.55, 0.66]] ],
    mainland: [ [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]] ],
    sands: [ [[0.10, 0.10], [0.20, 0.10], [0.20, 0.14]] ],
  };

  // the tracer's globals aren't on window (let/const), but its <input id=load> handler is
  // wired — drive it by uploading the file, exactly like a user picking it.
  const { writeFileSync } = await import('node:fs');
  const tmp = '/tmp/_tracer_import.json'; writeFileSync(tmp, JSON.stringify(imported));
  const input = await p.$('#load');
  await input.uploadFile(tmp);
  await new Promise(r => setTimeout(r, 400));

  // after import: the game overlay is gone (default replaced) and the stat reflects the
  // imported counts. read the visible stat + trigger Export to inspect the snapshot.
  const res = await p.evaluate(() => {
    const stat = document.getElementById('stat').innerText || document.getElementById('stat').textContent || '';
    // capture the Blob that Export builds by stubbing the download
    let captured = null; const realCreate = URL.createObjectURL; const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};   // don't actually download
    return new Promise((resolve) => {
      const rd = new FileReader();
      URL.createObjectURL = (blob) => { rd.onload = () => { try { captured = JSON.parse(rd.result); } catch {} URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; resolve({ stat, exp: captured }); }; rd.readAsText(blob); return 'blob:stub'; };
      document.getElementById('export').click();
    });
  });

  const inGame = /in&nbsp;game|in game/.test(res.stat);
  ok(!inGame, `loading a file replaces the default — no game overlay left underneath (stat: ${res.stat.replace(/\s+/g, ' ').trim().slice(0, 60)})`);
  const e = res.exp || {};
  ok(e && Array.isArray(e.roads) && e.roads.length >= 3, `Export keeps every traced road (${e.roads ? e.roads.length : 0})`);
  ok(e.roads && e.roads.some(r => r.oneway) && e.roads.some(r => r.dirt), 'Export keeps the road sub-types (single lane + dirt)');
  ok(Array.isArray(e.railway) && e.railway.length >= 1, `Export keeps the traced railway (${e.railway ? e.railway.length : 0})`);
  ok(Array.isArray(e.reservoirs) && e.reservoirs.length >= 1, `Export keeps the traced reservoir (${e.reservoirs ? e.reservoirs.length : 0})`);
  ok(Array.isArray(e.mainland) && e.mainland.length >= 1, `Export keeps the traced coastline (${e.mainland ? e.mainland.length : 0})`);
  ok(Array.isArray(e.sands) && e.sands.length >= 1, `Export keeps the traced sands (${e.sands ? e.sands.length : 0})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
