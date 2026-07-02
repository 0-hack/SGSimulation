// Street furniture (lamps, signals) are PROPS: free-placed at an exact world spot,
// NOT grid-bound, so they can sit right at the kerb — even over a road, where a
// normal building is blocked. They render, persist across a reload, and clear at
// once when demolished.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:1000, height:760 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r=>setTimeout(r,1500));
  const res = await p.evaluate(async () => {
    const v = window.__sgview, S = window.__sg, N = v.land.length;
    let road=null, clear=null;
    for (let y=Math.round(N*0.38); y<Math.round(N*0.62) && !(road&&clear); y++) for (let x=Math.round(N*0.38); x<Math.round(N*0.62); x++){
      if (!v.isLand(x,y)) continue;
      if (!road && v.isRoadAt(x,y)) road={x,y};
      if (!clear && !v.isRoadAt(x,y) && !v.state.grid[y][x] && !(v.heritageMask&&v.heritageMask[y][x])) clear={x,y};
      if (road&&clear) break;
    }
    const place=(key,cell)=>{ const w=v.worldOfCell(cell.x,cell.y); S.selectBuilding(key); S.onTileTap(cell.x,cell.y,{x:w.x,z:w.z}); S.commitAdjust(); };
    const before = v.state.props.length;
    if (road) place('traffic_light', road);
    if (clear) place('street_lamp', clear);
    const afterPlace = v.state.props.length, meshes = (v.propMeshes||[]).length;
    const onRoad = road ? v.isRoadAt(road.x, road.y) : false;
    v.setState(v.state);
    const afterReload = (v.propMeshes||[]).length;
    S.setBulldoze(true);
    S.onTileTap(-1,-1,{ x: v.state.props[0].x, z: v.state.props[0].z },{kind:'prop', i:0});
    const sel = S.demoSel.size; S.commitDemolish(); S.setBulldoze(false);
    return { road:!!road, clear:!!clear, onRoad, before, afterPlace, meshes, afterReload, sel, afterDemo: v.state.props.length };
  });
  ok(res.road && res.clear, 'found a road cell and a clear cell to test');
  ok(res.before === 0 && res.afterPlace === 2, `two props are placed (${res.before} → ${res.afterPlace})`);
  ok(res.onRoad, 'a signal drops right ON a road cell — where a normal building is blocked');
  ok(res.meshes === 2, 'both props render in the scene');
  ok(res.afterReload === 2, 'props persist & re-render after a state reload');
  ok(res.sel === 1 && res.afterDemo === 1, `demolishing a prop clears just it (${res.afterPlace} → ${res.afterDemo})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
