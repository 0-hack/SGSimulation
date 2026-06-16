// Verifies the freeform road-drawing tool: select tool, tap to lay a road,
// edges persist in state, traffic spawns, and it survives a cloud save/load.
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

  // open Build → Roads category
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Transport/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  ok(true, 'Roads category shows the drawing toolkit');

  // pick Road mode + Straight tool
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Road/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent)).click());
  await new Promise(r=>setTimeout(r,200));

  // tap two land cells to STAGE straight pieces (Lego flow), then Build to start work
  const before = await p.evaluate(()=>({ edges:window.__sgview.state.roads.edges.length, rw:(window.__sgview.state.roadworks||[]).length }));
  const spots = await p.evaluate(()=>{
    const v=window.__sgview, N=v.land.length, c=Math.floor(N/2), out=[];
    // scan a column a little west of centre (avoids the seeded town) and pick
    // buildable land cells that are on land and clear of the protected reservoir
    const col = c - 6;
    for (let y=2; y<N-2 && out.length<2; y++) {
      const free = v.isLand(col, y) && !v.reserveMask?.[y]?.[col] && !(v.state?.grid?.[y]?.[col]);
      if (free) { const s=v.cellToScreen(col, y); if (s.visible) { out.push({x:s.x,y:s.y}); y+=3; } }
    }
    return out;
  });
  await p.mouse.click(spots[0].x, spots[0].y);
  await new Promise(r=>setTimeout(r,150));
  await p.mouse.click(spots[1].x, spots[1].y);
  await new Promise(r=>setTimeout(r,300));
  const stagedOpen = await p.evaluate(()=>({ bar:!document.getElementById('draw-confirm').classList.contains('hidden'), edges:window.__sgview.state.roads.edges.length }));
  ok(stagedOpen.bar, 'staging road pieces shows the cost/commit bar');
  ok(stagedOpen.edges === before.edges, 'staged pieces are NOT built yet (chain first, then confirm)');
  await p.click('#dc-build');
  await new Promise(r=>setTimeout(r,250));
  const after = await p.evaluate(()=>{ const rw=(window.__sgview.state.roadworks||[]); return { rw:rw.length, kind:rw[rw.length-1]?.kind, edgePts:window.__sgview.edgePts.length }; });
  ok(after.rw > before.rw, `Build queued a road construction project (${before.rw} → ${after.rw})`);
  ok(after.kind === 'road', 'the staged pieces build a Road');
  ok(after.edgePts >= 1, 'road network present for rendering/traffic');

  // a roundabout
  await p.click('.tool[data-panel="build"]');
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Roundabout/.test(b.textContent)).click());
  const rspot = await p.evaluate(()=>{
    const v=window.__sgview, N=v.land.length, c=Math.floor(N/2);
    const col = c + 6;
    for (let y=2; y<N-2; y++) {
      if (v.isLand(col, y) && !v.reserveMask?.[y]?.[col] && !(v.state?.grid?.[y]?.[col])) {
        const s=v.cellToScreen(col, y); if (s.visible) return { x:s.x, y:s.y };
      }
    }
    return null;
  });
  await p.mouse.click(rspot.x, rspot.y);
  await new Promise(r=>setTimeout(r,300));
  const ra = await p.evaluate(()=>window.__sgview.state.roads.islands.length);
  ok(ra >= 1, 'roundabout placed (island created)');

  // traffic drives the roads
  await p.click('.spd[data-spd="2"]'); await new Promise(r=>setTimeout(r,1200));
  const veh = await p.evaluate(()=>window.__sgview.vehicles.length);
  ok(veh >= 1, `${veh} vehicles driving the unified road network`);

  // save to cloud + reload keeps the roads
  await p.click('.spd[data-spd="0"]');
  await p.click('.tool[data-panel="cloud"]'); await p.waitForSelector('.cloud-info');
  await p.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/Save to Cloud/.test(b.textContent))?.click());
  await p.waitForFunction(()=>/\/world\//.test(document.querySelector('.share-row input')?.value||''),{timeout:30000});
  const id=(await p.$eval('.share-row input',e=>e.value)).split('/world/')[1];
  const loaded = await (await fetch(`${base}/api/worlds/${id}`)).json();
  ok((loaded.state.roads?.edges?.length||0) >= 1, 'roads persist through cloud save/load');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
