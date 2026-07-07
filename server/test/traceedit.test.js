// The Map Tracer is creator tooling that edits the SHARED base map, so on servers
// without TRACE_EDIT=1 it stays invisible to ordinary players: the "Map Tracer" nav
// link is hidden on the game page, and trace.html hides its "Save to map" button.
// With TRACE_EDIT=1 both appear. Export/Load inside the tracer work either way.
import puppeteer from 'puppeteer';
const origEnv = process.env.TRACE_EDIT;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

async function probe(page, base) {
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  const navHasTracer = await page.evaluate(() => !![...document.querySelectorAll('#page-nav .pagenav-item')].find((a) => /Map Tracer/.test(a.textContent)));
  await page.goto(base + '/trace.html', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 700));
  const saveVisible = await page.evaluate(() => {
    const b = document.getElementById('applygame');
    return !!(b && b.parentElement && getComputedStyle(b.parentElement).display !== 'none');
  });
  const exportVisible = await page.evaluate(() => !!document.getElementById('export'));
  return { navHasTracer, saveVisible, exportVisible };
}

try {
  // --- editing OFF (default): tracer hidden from players ---
  delete process.env.TRACE_EDIT;
  const { app } = await import('../server.js?off');
  const s1 = app.listen(0); const base1 = `http://localhost:${s1.address().port}`;
  const p = await browser.newPage();
  const off = await probe(p, base1);
  ok(!off.navHasTracer, 'TRACE_EDIT off: the Map Tracer link is HIDDEN from the game nav');
  ok(!off.saveVisible, 'TRACE_EDIT off: trace.html hides the "Save to map" button');
  ok(off.exportVisible, 'TRACE_EDIT off: Export (client-side) still available in the tracer');
  s1.close();

  // --- editing ON: creator tooling appears ---
  process.env.TRACE_EDIT = '1';
  const { app: app2 } = await import('../server.js?on');
  const s2 = app2.listen(0); const base2 = `http://localhost:${s2.address().port}`;
  const on = await probe(p, base2);
  ok(on.navHasTracer, 'TRACE_EDIT=1: the Map Tracer link shows in the game nav');
  ok(on.saveVisible, 'TRACE_EDIT=1: trace.html shows the "Save to map" button');
  s2.close();
} catch (e) { fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally {
  if (origEnv === undefined) delete process.env.TRACE_EDIT; else process.env.TRACE_EDIT = origEnv;
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
