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
    const placed = v.heritageGroup ? v.heritageGroup.children.length : 0;
    const masked = v.heritageMask ? v.heritageMask.flat().filter(Boolean).length : 0;
    // every masked cell is on land and unbuildable, and has a name where expected
    let onLand=0, blocked=0, named=0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(v.heritageMask[y][x]){
      if(v.land[y][x]) onLand++;
      if(!v.isLand(x,y)) blocked++;             // heritage cells must read as NOT buildable
      if(v.heritageAt(x,y)) named++;
    }
    // the standing city IS in the economy now — heritage cells fill the grid and
    // are flagged + rendered only once (heritageGroup, not the grid mesh pass)
    const grid = v.state.grid;
    let gridFilled=0, heritageCells=0, dup=0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++){ const c=grid[y][x]; if(c){ gridFilled++; if(c.heritage){ heritageCells++; if(v.buildings.has(`${x},${y}`)) dup++; } } }
    const d = derive(v.state);
    return { placed, masked, onLand, blocked, named, gridFilled, heritageCells, dup,
      homes:d.homes, jobs:Math.round(d.jobs), powerRatio:+d.powerRatio.toFixed(2), waterRatio:+d.waterRatio.toFixed(2),
      pressure:+d.housingPressure.toFixed(2), pop:v.state.population };
  });
  ok(r.placed >= 25, `the 1965 city is placed on the map (${r.placed} buildings)`);
  ok(r.masked === r.placed && r.onLand === r.masked, `every landmark sits on land (${r.onLand}/${r.masked})`);
  ok(r.blocked === r.masked, `heritage cells are unbuildable (${r.blocked}/${r.masked})`);
  ok(r.named >= 18, `landmarks carry names for inspection (${r.named} named cells)`);
  ok(r.heritageCells === r.placed, `every landmark is a real grid cell (${r.heritageCells}/${r.placed})`);
  ok(r.dup === 0, 'heritage is drawn once — not duplicated by the grid mesh pass');
  ok(r.homes > 0 && r.jobs > 0, `the city functions: houses & employs people (homes ${r.homes}, jobs ${r.jobs})`);
  ok(r.powerRatio >= 1 && r.waterRatio >= 1, `the city is powered & watered from day one (power ${r.powerRatio}×, water ${r.waterRatio}×)`);
  ok(r.pressure <= 1.1, `the starting population is housed (pressure ${r.pressure}, pop ${r.pop})`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
