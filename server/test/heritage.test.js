// The 1965 city (SEED_1965) is pre-placed on the map: landmark buildings render,
// their cells are unbuildable, they carry names for inspection, and they sit OUTSIDE
// the economy (state.grid stays empty at the start — the player develops around them).
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

  const r = await p.evaluate(()=>{
    const v=window.__sgview, N=v.land.length;
    const placed = v.heritageGroup ? v.heritageGroup.children.length : 0;
    const masked = v.heritageMask ? v.heritageMask.flat().filter(Boolean).length : 0;
    // every masked cell is on land and unbuildable, and has a name where expected
    let onLand=0, blocked=0, named=0;
    for(let y=0;y<N;y++) for(let x=0;x<N;x++) if(v.heritageMask[y][x]){
      if(v.land[y][x]) onLand++;
      if(!v.isLand(x,y)) blocked++;             // heritage cells must read as NOT buildable
      if(v.heritageAt(x,y)) named++;
    }
    // the player's economy starts empty — heritage is NOT in state.grid
    const gridFilled = v.state.grid.flat().filter(Boolean).length;
    return { placed, masked, onLand, blocked, named, gridFilled };
  });
  ok(r.placed >= 25, `the 1965 city is placed on the map (${r.placed} buildings)`);
  ok(r.masked === r.placed && r.onLand === r.masked, `every landmark sits on land (${r.onLand}/${r.masked})`);
  ok(r.blocked === r.masked, `heritage cells are unbuildable (${r.blocked}/${r.masked})`);
  ok(r.named >= 15, `landmarks carry names for inspection (${r.named} named cells)`);
  ok(r.gridFilled === 0, 'heritage is a backdrop — the player\'s economy still starts from scratch');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
