// Verifies the online "visit another player's nation" flow end-to-end.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  // Player A creates and cloud-saves a nation.
  const a = await browser.newPage();
  await a.setViewport({ width:390, height:780, isMobile:true, hasTouch:true });
  await a.goto(base, { waitUntil:'networkidle0' });
  await a.$eval('#m-nation', e=>e.value='Lion City');
  await a.$eval('#m-owner', e=>e.value='Alice');
  await a.click('#btn-new');
  await a.waitForSelector('#game:not(.hidden)');
  await a.click('.tool[data-panel="cloud"]');
  await a.waitForSelector('.cloud-info');
  await a.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Save to Cloud/.test(b.textContent))?.click());
  await a.waitForFunction(()=>/\/world\//.test(document.querySelector('.share-row input')?.value||''),{timeout:5000});
  const link = await a.$eval('.share-row input', e=>e.value);
  const id = link.split('/world/')[1];
  ok(!!id, `Alice saved 'Lion City' to cloud (id ${id.slice(0,8)}…)`);

  // Player B (fresh browser context, no local save) visits via deep link.
  const ctxB = await browser.createBrowserContext();
  const b = await ctxB.newPage();
  await b.setViewport({ width:390, height:780, isMobile:true, hasTouch:true });
  const berr=[]; b.on('pageerror',e=>berr.push(e.message));
  await b.goto(`${base}/world/${id}`, { waitUntil:'networkidle0' });
  await b.waitForSelector('#visit-banner:not(.hidden)', { timeout:5000 });
  const banner = await b.$eval('#visit-name', e=>e.textContent);
  ok(/Lion City/.test(banner) && /Alice/.test(banner), `Player B sees visit banner: "${banner}"`);
  const nation = await b.$eval('#hud-nation', e=>e.textContent);
  ok(nation==='Lion City', 'visited nation name shows in HUD');

  // Building must be disabled while visiting.
  await b.click('.tool[data-panel="build"]');
  const readOnlyToast = await b.$eval('#toast', e=>e.textContent).catch(()=>'');
  ok(/Read-only|visiting/i.test(readOnlyToast), 'editing is blocked while visiting');

  // Visitor can press play and watch it run.
  await b.click('#visit-banner').catch(()=>{});
  await b.click('.spd[data-spd="2"]');
  const d0 = await b.$eval('#hud-date', e=>e.textContent);
  await new Promise(r=>setTimeout(r,1200));
  const d1 = await b.$eval('#hud-date', e=>e.textContent);
  ok(d0!==d1, `visitor can watch time advance (${d0} → ${d1})`);
  ok(berr.length===0, 'no errors during visit'+(berr.length?': '+berr[0]:''));

  // Browse list shows the public nation.
  const list = await (await fetch(`${base}/api/worlds`)).json();
  ok(list.worlds.some(w=>w.name==='Lion City'), 'public browse list includes the nation');
} catch(e){ fail++; console.error('  ✗ threw:', e.message); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
