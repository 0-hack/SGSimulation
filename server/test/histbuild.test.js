// Historic 1950s–60s central-area landmarks (Raffles Hotel, Fullerton, Victoria
// Theatre, Sri Mariamman, Sultan Mosque, Lau Pa Sat) appear in a Heritage build
// category, render as recognisable models, and can be built & demolished.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const HERITAGE = ['raffles_hotel','fullerton','victoria_theatre','sri_mariamman','sultan_mosque','lau_pa_sat'];
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:900, height:820 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r=>setTimeout(r,1500));

  await p.click('[data-panel="build"]');
  await new Promise(r=>setTimeout(r,300));
  const menu = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cat-tab')];
    const tab = tabs.find((t) => /Heritage/i.test(t.textContent));
    if (tab) tab.click();
    const text = [...document.querySelectorAll('.bcard')].map((c) => c.textContent).join(' | ');
    return { hasTab: !!tab, text };
  });
  const NAMES = { raffles_hotel:'Raffles', fullerton:'Fullerton', victoria_theatre:'Victoria', sri_mariamman:'Mariamman', sultan_mosque:'Sultan', lau_pa_sat:'Lau Pa Sat' };
  ok(menu.hasTab, 'the build menu has a Heritage category');
  ok(HERITAGE.every((k) => new RegExp(NAMES[k]).test(menu.text)), 'all six landmarks are listed in the menu');

  const flow = await p.evaluate((KEYS) => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let rendered = 0; const clears = [];
    for (let y=Math.round(N*0.4); y<Math.round(N*0.6) && clears.length<KEYS.length+1; y++) for (let x=Math.round(N*0.4); x<Math.round(N*0.6); x++){
      if (v.isLand(x,y) && !v.isRoadAt(x,y) && !(v.state.grid[y]&&v.state.grid[y][x]) && !(v.heritageMask&&v.heritageMask[y]&&v.heritageMask[y][x])) clears.push({x,y});
      if (clears.length>=KEYS.length+1) break;
    }
    KEYS.forEach((k, i) => { const c=clears[i]; v.state.grid[c.y][c.x]={k}; v._addMesh(c.x,c.y,k,false); if (v.buildings.has(`${c.x},${c.y}`)) rendered++; v.removeBuilding(c.x,c.y); v.state.grid[c.y][c.x]=null; });
    const c = clears[KEYS.length];
    S.selectBuilding('raffles_hotel'); S.onTileTap(c.x, c.y, v.worldOfCell(c.x, c.y)); S.commitAdjust();
    const cell = v.state.grid[c.y][c.x];   // placed & charged (now a construction site that tops out over time)
    const built = !!cell && cell.k === 'raffles_hotel';
    S.setBulldoze(true); S.onTileTap(c.x, c.y, v.worldOfCell(c.x, c.y)); const sel = S.demoSel.size; S.commitDemolish(); S.setBulldoze(false);
    const queued = !!(v.state.grid[c.y][c.x] && v.state.grid[c.y][c.x].demolish);
    return { rendered, built, sel, queued };
  }, HERITAGE);
  ok(flow.rendered === 6, `all six models render (${flow.rendered}/6)`);
  ok(flow.built, 'a heritage landmark can be built through the normal place-then-Done flow');
  ok(flow.sel === 1 && flow.queued, 'a built heritage landmark can be demolished (timed teardown queued)');
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
