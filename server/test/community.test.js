// The in-game Community build menu: browse player-shared designs (sorted by
// downloads / filtered by function), tap Build to download one — it registers as a
// buildable, priced for its size & era — then place & construct it like anything.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
let pub = {};
try {
  const p = await browser.newPage();
  await p.setViewport({ width:900, height:820 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r=>setTimeout(r,1400));
  // publish a build (same origin as the game)
  pub = await p.evaluate(async () => {
    const design = { parts: Array.from({length:5},(_,i)=>({t:'box',x:i,y:0,z:0,w:2,h:3,d:2,c:'#c8b088'})), stats:{ jobs:80, income:4, power:-6, happiness:3 } };
    return fetch('/api/builds',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ name:'Test Community Hall', author:'Tester', func:'civic', size:1.3, year:1980, design })}).then(r=>r.json());
  });
  // open Build ▸ Community
  await p.click('[data-panel="build"]'); await new Promise(r=>setTimeout(r,250));
  await p.evaluate(()=>{ const t=[...document.querySelectorAll('.cat-tab')].find(x=>/Community/i.test(x.textContent)); if(t) t.click(); });
  await p.waitForSelector('.comm-card', { timeout: 6000 });
  const menu = await p.evaluate(() => {
    const cards=[...document.querySelectorAll('.comm-card')];
    return { cards: cards.length, hasMine: cards.some(c=>/Test Community Hall/.test(c.textContent)) };
  });
  ok(menu.cards >= 1 && menu.hasMine, `the community build shows in the in-game menu (${menu.cards} card(s))`);

  // tap Build → it downloads, registers & is selected for placement (wait for the
  // tool banner to show the design name, i.e. the download finished)
  await p.evaluate(()=>{ const c=[...document.querySelectorAll('.comm-card')].find(x=>/Test Community Hall/.test(x.textContent)); c.querySelector('.cc-build').click(); });
  await new Promise(r=>setTimeout(r,4000));   // let the download + register + select settle
  const place = await p.evaluate(async () => {
    const v=window.__sgview, S=window.__sg, N=v.land.length;
    let cell=null;
    for (let y=Math.round(N*0.42);y<N*0.58&&!cell;y++) for(let x=Math.round(N*0.42);x<N*0.58;x++){ if(v.isLand(x,y)&&!v.isRoadAt(x,y)&&!(v.state.grid[y]&&v.state.grid[y][x])&&!(v.heritageMask&&v.heritageMask[y]&&v.heritageMask[y][x])){cell={x,y};break;} }
    const banner = (document.getElementById('tool-banner-text')||{}).textContent||'';
    S.onTileTap(cell.x, cell.y, v.worldOfCell(cell.x, cell.y));
    const adjustSet = !!v._adjust, adjustKey = v._adjust && v._adjust.key;
    S.commitAdjust();
    const c = v.state.grid[cell.y][cell.x];
    const id = `${cell.x},${cell.y}`;
    return { adjustSet, adjustKey, key: c&&c.k, isCommunity: !!(c&&c.k&&c.k.startsWith('cm_')), onMap: (v.sites&&v.sites.has(id)) || v.buildings.has(id) };
  });
  ok(place.isCommunity, `tapping Build downloads & constructs the community design (key ${place.key})`);
  ok(place.onMap, 'the downloaded build goes up on the map (construction site)');

  // the download was counted
  const dl = await p.evaluate((id)=>fetch('/api/builds/'+id).then(r=>r.json()).then(b=>b.downloads), pub.id);
  ok(dl >= 1, `building it counted a download (${dl})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally {
  if (pub.id && pub.token) { try { await fetch(`${base}/api/builds/${pub.id}`, { method:'DELETE', headers:{'x-build-token':pub.token} }); } catch {} }
  await browser.close(); server.close();
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
