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
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  ok(true, 'Roads category shows the drawing toolkit');

  // pick Avenue type + Straight tool
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Avenue/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent)).click());
  await new Promise(r=>setTimeout(r,200));

  // tap two points on the canvas to lay a road
  const box = await (await p.$('#city')).boundingBox();
  await p.mouse.click(box.x + box.width*0.35, box.y + box.height*0.45);
  await new Promise(r=>setTimeout(r,150));
  await p.mouse.click(box.x + box.width*0.65, box.y + box.height*0.55);
  await new Promise(r=>setTimeout(r,300));
  const after = await p.evaluate(()=>({ edges: window.__sgview.state.roads.edges.length, type: window.__sgview.state.roads.edges[0]?.type, edgePts: window.__sgview.edgePts.length }));
  ok(after.edges >= 1, `tapping the map created ${after.edges} road edge(s)`);
  ok(after.type === 'avenue', 'road uses the selected Avenue type');
  ok(after.edgePts >= 1, 'road network rebuilt for rendering/traffic');

  // a roundabout
  await p.click('.tool[data-panel="build"]');
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Roundabout/.test(b.textContent)).click());
  await p.mouse.click(box.x + box.width*0.5, box.y + box.height*0.4);
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
  await p.waitForFunction(()=>/\/world\//.test(document.querySelector('.share-row input')?.value||''),{timeout:5000});
  const id=(await p.$eval('.share-row input',e=>e.value)).split('/world/')[1];
  const loaded = await (await fetch(`${base}/api/worlds/${id}`)).json();
  ok((loaded.state.roads?.edges?.length||0) >= 1, 'roads persist through cloud save/load');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
