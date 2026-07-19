// Repro/verify: on a SLOW first load (cold cache, throttled network) a click on
// "Start New Nation" that lands before main.js's module graph finishes must still
// respond — loading overlay immediately, game boots from the queued tap.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 800 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await p.target().createCDPSession();
  await cdp.send('Network.enable');
  // ~1.5 Mbps: the ~3 MB module graph takes >15 s, so our click is far ahead of boot
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1.5e6 / 8, uploadThroughput: 1e6 / 8 });
  // do NOT await the navigation: the menu paints long before DOMContentLoaded
  // (module scripts defer it) — click as soon as the parser has passed the inline
  // stub at the end of <body>, while the module graph is still downloading
  const nav = p.goto(base, { waitUntil: 'networkidle0', timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 200; i++) {
    const ready = await p.evaluate(() => !!document.querySelector('script[src="/js/main.js"]')).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const booted0 = await p.evaluate(() => !!window.__sgBooted);
  await p.click('#btn-new');
  const t0 = Date.now();
  await p.waitForFunction(() => !document.getElementById('loading').classList.contains('hidden'), { timeout: 3000 });
  ok(!booted0, `clicked before boot (module graph still loading)`);
  ok(true, `loading overlay appeared ${Date.now() - t0}ms after the click`);

  await p.waitForFunction(() => document.getElementById('game') && !document.getElementById('game').classList.contains('hidden'), { timeout: 120000 });
  ok(true, 'queued tap replayed: the game started without a second click');
  // drop throttling for the remainder
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await p.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), { timeout: 60000 });
  const state = await p.evaluate(() => ({ hasState: !!window.__sg?.state }));
  ok(state.hasState, 'game state seeded');
  ok(true, 'loading overlay cleared after boot');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));

  // same drill for "Visit Other Nations": early tap must open the browser sheet
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 900, height: 800 });
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  const cdp2 = await p2.target().createCDPSession();
  await cdp2.send('Network.enable');
  await cdp2.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1.5e6 / 8, uploadThroughput: 1e6 / 8 });
  p2.goto(base, { waitUntil: 'networkidle0', timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 200; i++) {
    const ready = await p2.evaluate(() => !!document.querySelector('script[src="/js/main.js"]')).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const booted2 = await p2.evaluate(() => !!window.__sgBooted);
  await p2.click('#btn-browse');
  await p2.waitForFunction(() => !document.getElementById('loading').classList.contains('hidden'), { timeout: 3000 });
  ok(!booted2, 'visit: clicked before boot');
  await cdp2.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await p2.waitForFunction(() => {
    const game = document.getElementById('game'), sheet = document.getElementById('sheet');
    return game && !game.classList.contains('hidden') && sheet && !sheet.classList.contains('hidden');
  }, { timeout: 120000 });
  ok(true, 'visit: queued tap replayed — nation browser opened without a second click');
  ok(errs2.length === 0, 'visit: no page errors' + (errs2.length ? ': ' + errs2[0] : ''));
} catch (e) { fail++; console.error('  ✗ threw:', e.message); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
