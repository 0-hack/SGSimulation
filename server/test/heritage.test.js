// The 1965 city (SEED_1965) is pre-placed on the map AND wired into the economy:
// landmark buildings render, their cells are unbuildable and protected from
// demolition, they carry names for inspection, and — the point of this test — they
// FUNCTION: seeded into state.grid they house the starting population, employ the
// workforce and supply power & water from day one.
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
  p.on('dialog', d=>d.dismiss());
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');

  const r = await p.evaluate(async ()=>{
    const v=window.__sgview, N=v.land.length;
    const { derive } = await import('/js/engine.js');
    // The FUNCTIONAL 1965 buildings = named landmarks seeded into the economy (not the
    // decorative town shophouses, which carry no economy and are demolishable).
    const all = v.heritagePlacements || [];
    const placements = all.filter(p=>!p.decor);
    const fill = all.filter(p=>p.decor).length;       // real, demolishable town shophouses
    const placed = placements.length;
    let onLand=0, inGrid=0, blocked=0, dup=0;
    for(const pl of placements){
      if(v.land[pl.gy][pl.gx]) onLand++;
      if(!v.isLand(pl.gx, pl.gy)) blocked++;     // heritage cells must read as NOT buildable
      const c=v.state.grid[pl.gy][pl.gx];
      if(c && c.heritage) inGrid++;
      if(v.buildings.has(`${pl.gx},${pl.gy}`)) dup++;  // not double-drawn by the grid pass
    }
    const named = placements.filter(pl=>v.heritageAt(pl.gx,pl.gy)).length;
    // the bespoke central-area landmarks (Raffles Hotel, Fullerton, Victoria Theatre,
    // Sri Mariamman, Sultan Mosque, Lau Pa Sat) stand downtown from day one and are
    // booked into the grid so they FUNCTION (jobs/tourism), not just decorate.
    const HK=['raffles_hotel','fullerton','victoria_theatre','sri_mariamman','sultan_mosque','lau_pa_sat'];
    const landmarkKeys=[...new Set(placements.filter(pl=>HK.includes(pl.key)).map(pl=>pl.key))];
    const landmarksInGrid=placements.filter(pl=>HK.includes(pl.key) && v.state.grid[pl.gy][pl.gx]?.k===pl.key).length;
    // a decorative shophouse can be demolished (removeHeritageVisual frees the cell)
    let demolished=false; if(all.find(p=>p.decor)){ const dc=all.find(p=>p.decor); demolished = v.removeHeritageVisual(dc.gx,dc.gy) && !v.heritageMask[dc.gy][dc.gx]; }
    const masked = v.heritageMask ? v.heritageMask.flat().filter(Boolean).length : 0;
    const d = derive(v.state);
    return { placed, masked, fill, onLand, blocked, inGrid, named, dup, demolished, landmarkKeys, landmarksInGrid,
      homes:d.homes, jobs:Math.round(d.jobs), powerRatio:+d.powerRatio.toFixed(2), waterRatio:+d.waterRatio.toFixed(2),
      pressure:+d.housingPressure.toFixed(2), unemp:+d.unemployment.toFixed(3), pop:v.state.population };
  });
  ok(r.placed >= 25, `the functional 1965 city is placed on the map (${r.placed} landmarks)`);
  ok(r.onLand === r.placed, `every landmark sits on land (${r.onLand}/${r.placed})`);
  ok(r.blocked === r.placed, `heritage cells are unbuildable (${r.blocked}/${r.placed})`);
  ok(r.named >= 18, `landmarks carry names for inspection (${r.named} named)`);
  ok(r.inGrid === r.placed, `every landmark is a real grid cell (${r.inGrid}/${r.placed})`);
  ok(r.landmarkKeys.length === 6, `all 6 named central-area landmarks stand downtown from the start (${r.landmarkKeys.join(', ')})`);
  ok(r.landmarksInGrid === 6, `the named landmarks are booked into the economy (${r.landmarksInGrid}/6)`);
  ok(r.dup === 0, 'heritage is drawn once — not duplicated by the grid mesh pass');
  ok(r.fill >= 40, `the central districts are lined with real, demolishable shophouse terraces (${r.fill})`);
  ok(r.demolished, 'a town shophouse terrace can be demolished (its cells are freed)');
  ok(r.homes > 0 && r.jobs > 0, `the city functions: houses & employs people (homes ${r.homes}, jobs ${r.jobs})`);
  ok(r.powerRatio >= 1 && r.waterRatio >= 1, `the city is powered & watered from day one (power ${r.powerRatio}×, water ${r.waterRatio}×)`);
  ok(r.pressure <= 1.1, `the starting population is housed (pressure ${r.pressure}, pop ${r.pop})`);
  ok(r.unemp >= 0.07 && r.unemp <= 0.13, `unemployment sits at the historical ~10% of 1965 (${(r.unemp*100).toFixed(1)}%)`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
