// The 3D designer can IMPORT a stock game building as editable parts (buildingToParts):
// pick a built-in building, load its procedural model into the designer as boxes/cyls/
// domes/roofs, then remix & publish it. Verifies the picker is populated, an import
// fills the parts list, the serialised parts carry geometry + colour (+ roof tilt), and
// the imported design still publishes to the community.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
let pub = {};
try {
  const p = await browser.newPage();
  await p.setViewport({ width:1200, height:860 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base+'/design.html',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,700));

  // the picker is populated from the game's BUILDINGS (scene3d.js imported cleanly)
  const picker = await p.evaluate(()=>{ const s=document.getElementById('importsel'); return { opts:s?s.options.length:0, groups:s?s.querySelectorAll('optgroup').length:0 }; });
  ok(picker.opts >= 20 && picker.groups >= 5, `the designer offers stock buildings to import (${picker.opts} across ${picker.groups} groups)`);

  // buildingToParts serialises a procedural building into designer parts
  const conv = await p.evaluate(async ()=>{
    const m = await import('/js/scene3d.js');
    const shop = m.buildingToParts('shophouse');
    const types = {}; for (const q of shop.parts) types[q.type]=(types[q.type]||0)+1;
    const tilted = shop.parts.filter(q=>q.rx||q.rz).length;   // pitched roofs keep their tilt
    const coloured = shop.parts.filter(q=>typeof q.color==='string' && /^#/.test(q.color)).length;
    const lit = shop.parts.filter(q=>q.light).length;         // the upper-floor windows glow
    const mosque = m.buildingToParts('sultan_mosque');
    const hasDome = mosque.parts.some(q=>q.type==='dome');
    return { n:shop.parts.length, types, tilted, coloured, lit, name:shop.name, cat:shop.cat, hasDome };
  });
  ok(conv.n >= 10, `a shophouse imports as many editable parts (${conv.n})`);
  ok(conv.coloured === conv.n, `every part keeps its colour (${conv.coloured}/${conv.n})`);
  ok(conv.tilted >= 1, `pitched roofs keep their tilt via rx/rz (${conv.tilted} tilted parts)`);
  ok((conv.types.box||0) > 0 && (conv.types.cyl||0) > 0, `mixed primitives survive (box ${conv.types.box}, cyl ${conv.types.cyl})`);
  ok(conv.lit >= 1, `lit windows import with the glow flag set (${conv.lit})`);
  ok(conv.hasDome, 'the Sultan Mosque imports with its dome');

  // clicking Import loads it into the designer (parts list + name + auto-detected function)
  const imported = await p.evaluate(()=>{
    const s=document.getElementById('importsel'); s.value='shophouse';
    document.getElementById('importbtn').click();
    return { items: document.querySelectorAll('#parts .pitem').length, name: document.getElementById('name').value, func: document.getElementById('cfunc').value };
  });
  ok(imported.items >= 10, `Import fills the designer's parts list (${imported.items} parts)`);
  ok(/shophouse/i.test(imported.name), `the design is named after the building (${imported.name})`);
  ok(imported.func === 'house', `the community function is guessed from the building (${imported.func})`);

  // the imported design still publishes to the community
  pub = await p.evaluate(async ()=>{
    const m = await import('/js/scene3d.js');
    const { parts } = m.buildingToParts('raffles_hotel');
    const body = { name:'Remixed Raffles', author:'Tester', func:'landmark', size:1, year:1965, design:{ parts, scale:1, stats:{ happiness:6, income:4 } } };
    return fetch('/api/builds',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  });
  ok(pub && pub.id, `an imported-then-remixed building publishes to the community (id ${pub && pub.id})`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally {
  if (pub.id && pub.token) { try { await fetch(`${base}/api/builds/${pub.id}`, { method:'DELETE', headers:{'x-build-token':pub.token} }); } catch {} }
  await browser.close(); server.close();
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
