// The map tracer (public/trace.html): files flow OUT only. There is no local Save
// button and no Load file-import (a tampered JSON could otherwise be drawn over the
// shared map) — the session autosaves silently instead. Export still writes a
// COMPLETE snapshot carrying every traced layer type (roads with their sub-types,
// coast, reservoirs, railway) pulled from the live game overlay.
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
  await new Promise(r => setTimeout(r, 1200));   // let the tracer boot + load the game overlay

  // the tamper-prone local controls are gone; Export and New remain
  const ui = await p.evaluate(() => ({
    save: !!document.getElementById('save'),
    load: !!document.getElementById('load'),
    exp: !!document.getElementById('export'),
    fresh: !!document.getElementById('newsession'),
  }));
  ok(!ui.save, 'the local 💾 Save button is removed');
  ok(!ui.load, 'the 📂 Load file-import is removed (no JSON can be imported)');
  ok(ui.exp && ui.fresh, 'Export and 🆕 New remain');

  // Export still writes the COMPLETE map: capture the download blob
  const res = await p.evaluate(() => new Promise((resolve) => {
    const rd = new FileReader(); const realCreate = URL.createObjectURL; const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    URL.createObjectURL = (blob) => { rd.onload = () => { let j = null; try { j = JSON.parse(rd.result); } catch {} URL.createObjectURL = realCreate; HTMLAnchorElement.prototype.click = realClick; resolve(j); }; rd.readAsText(blob); return 'blob:stub'; };
    document.getElementById('export').click();
  }));
  const e = res || {};
  ok(Array.isArray(e.roads) && e.roads.length > 1000, `Export carries the whole road network (${e.roads ? e.roads.length : 0})`);
  ok(e.roads && e.roads.some(r => r.dirt) && e.roads.some(r => r.oneway), 'Export keeps the road sub-types (dirt + single lane)');
  ok(Array.isArray(e.mainland) && e.mainland.length >= 1, `Export keeps the coastline (${e.mainland ? e.mainland.length : 0})`);
  ok(Array.isArray(e.reservoirs) && e.reservoirs.length >= 1, `Export keeps the reservoirs (${e.reservoirs ? e.reservoirs.length : 0})`);
  ok(Array.isArray(e.railway) && e.railway.length >= 1, `Export keeps the railway (${e.railway ? e.railway.length : 0})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
