// The Map Tracer is creator tooling that edits the SHARED base map. On servers
// without TRACE_EDIT=1 it is invisible AND unreachable: the "Map Tracer" nav link is
// hidden on the game page, and the static route itself (trace.html + its data/map
// assets) redirects back to the game. With TRACE_EDIT=1 everything appears as before.
import puppeteer from 'puppeteer';
const origEnv = process.env.TRACE_EDIT;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

try {
  const p = await browser.newPage();

  // --- editing OFF (default): tracer hidden AND unreachable ---
  delete process.env.TRACE_EDIT;
  const { app } = await import('../server.js?off');
  const s1 = app.listen(0); const base1 = `http://localhost:${s1.address().port}`;
  await p.goto(base1 + '/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const navOff = await p.evaluate(() => !![...document.querySelectorAll('#page-nav .pagenav-item')].find((a) => /Map Tracer/.test(a.textContent)));
  ok(!navOff, 'TRACE_EDIT off: the Map Tracer link is HIDDEN from the game nav');
  await p.goto(base1 + '/trace.html', { waitUntil: 'networkidle0' });
  ok(new URL(p.url()).pathname === '/', `TRACE_EDIT off: /trace.html redirects to the game (${new URL(p.url()).pathname})`);
  const assets = await p.evaluate(async () => {
    const out = {};
    for (const f of ['/trace-data.json', '/trace-map.jpg']) { const r = await fetch(f); out[f] = new URL(r.url).pathname; }
    return out;
  });
  ok(Object.values(assets).every((v) => v === '/'), `TRACE_EDIT off: tracer assets redirect too (${JSON.stringify(assets)})`);
  s1.close();

  // --- editing ON: creator tooling appears and the page serves ---
  process.env.TRACE_EDIT = '1';
  const { app: app2 } = await import('../server.js?on');
  const s2 = app2.listen(0); const base2 = `http://localhost:${s2.address().port}`;
  await p.goto(base2 + '/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const navOn = await p.evaluate(() => !![...document.querySelectorAll('#page-nav .pagenav-item')].find((a) => /Map Tracer/.test(a.textContent)));
  ok(navOn, 'TRACE_EDIT=1: the Map Tracer link shows in the game nav');
  await p.goto(base2 + '/trace.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));
  const onPage = await p.evaluate(() => ({
    path: location.pathname,
    save: !!(document.getElementById('applygame') && getComputedStyle(document.getElementById('applygame').parentElement).display !== 'none'),
  }));
  ok(onPage.path === '/trace.html', 'TRACE_EDIT=1: trace.html serves normally');
  ok(onPage.save, 'TRACE_EDIT=1: the "Save to map" button is visible');
  s2.close();
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally {
  if (origEnv === undefined) delete process.env.TRACE_EDIT; else process.env.TRACE_EDIT = origEnv;
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
