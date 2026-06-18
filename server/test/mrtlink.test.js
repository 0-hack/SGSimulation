// MRT is drawn with the 🚇 MRT toolkit mode (connect / straight / curve / freeform);
// there is no separate "viaduct" building (that was a duplicate). A drawn MRT line
// LINKS to its MRT stations, and a drawn railway to its train stations, by snapping
// the endpoint onto the station as you build.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:480, height:860, isMobile:true, hasTouch:true });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  // the viaduct building is gone; the MRT draw mode + station remain
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Transport/.test(t.textContent)).click());
  await new Promise(r=>setTimeout(r,200));
  const ui = await p.evaluate(()=>({
    txt: document.body.innerText,
    mrtMode: [...document.querySelectorAll('.road-types .opt')].some(b=>/MRT/.test(b.textContent)),
  }));
  ok(ui.mrtMode, 'the Transport toolkit offers a 🚇 MRT draw mode');
  ok(!/Elevated MRT Viaduct/.test(ui.txt), 'the duplicate "Elevated MRT Viaduct" building is gone');
  ok(/MRT Station/.test(ui.txt), 'the MRT Station building is still offered');

  const r = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length;
    const place = (key) => { let cx=-1, cy=Math.round(N*0.42)+ (key==='mrt'?0:6);
      for (let x=Math.round(N*0.42); x<N*0.42+14; x++){ if (v.isLand(x,cy) && !v.buildings.has(`${x},${cy}`) && !(v.heritageMask&&v.heritageMask[cy][x])) { cx=x; break; } }
      v.state.grid[cy][cx] = { k:key }; v.syncAll && v.syncAll(); return v.buildings.get(`${cx},${cy}`).group.position; };
    const mrtPos = place('mrt'), trainPos = place('rail_station');
    const snapAt = (type, pos) => { v.setDrawMode(true, ()=>{}, { type, rail:true, elevated:type==='mrt' }); const s = v._drawSnap(pos.x+3, pos.z+2); v.setDrawMode(false); return s; };
    const m = snapAt('mrt', mrtPos), t = snapAt('railway', trainPos);
    const hit = (s, pos) => !!(s && s.kind==='station' && Math.hypot(s.x-pos.x, s.z-pos.z) < 0.01);
    // a railway draw must NOT grab an MRT station (wrong type)
    v.setDrawMode(true, ()=>{}, { type:'railway', rail:true }); const wrong = v._drawSnap(mrtPos.x+3, mrtPos.z+2); v.setDrawMode(false);
    return { mrt: hit(m, mrtPos), train: hit(t, trainPos), wrongType: !(wrong && wrong.kind==='station' && Math.abs(wrong.x-mrtPos.x)<0.01) };
  });
  ok(r.mrt, 'drawing an MRT line snaps its endpoint onto a nearby MRT station (links)');
  ok(r.train, 'drawing a railway snaps onto a nearby Train Station');
  ok(r.wrongType, 'a railway does not snap to an MRT station (right station for the right line)');
  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
