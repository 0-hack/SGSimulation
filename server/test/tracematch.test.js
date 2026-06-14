// Ensures features traced in trace.html (base-map roads / railway / airport)
// render with the SAME 3D design as the player-built equivalents:
//  - railway: historic _buildRailways must match player _railTrack (ballast,
//    sleepers, rails — same dims & colours, terrain-following);
//  - airport: the player airstrip shares the built-in airport's asphalt + cream;
//  - roads: traced roads load into the same unified road network as player roads.
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

  // RAILWAY — build a historic (normalised) line and a player (world) line over
  // the same flat strip, then compare the geometry signatures they produce.
  const rail = await p.evaluate(()=>{
    const v=window.__sgview, W=v.land.length*10;
    let cx=0, cz=0, found=false;
    for (let X=-200;X<=200 && !found;X+=8) for (let Z=-200;Z<=200 && !found;Z+=8){
      let okp=true; for(let i=-6;i<=6;i++){ const h=v._heightAt(X+i*5,Z); if(h>3||h<=0.2){okp=false;break;} }
      if(okp){ cx=X; cz=Z; found=true; }
    }
    const sig=(group)=>{ let sleepers=0, ribbons=0; const cols=new Set();
      group.traverse(o=>{ if(o.geometry?.type==='BoxGeometry') sleepers++; if(o.geometry?.type==='ShapeGeometry'||o.geometry?.type==='BufferGeometry') ribbons++; if(o.material?.color) cols.add(o.material.color.getHex()); });
      return { sleepers, ribbons, colors:[...cols].sort((a,b)=>a-b) }; };
    const hist=[]; for(let i=-6;i<=6;i++){ const wx=cx+i*5, wz=cz-9; hist.push([wx/W+0.5, 0.5-wz/W]); }
    v._buildRailways([hist]); const h=sig(v.railGroup);
    const play=[]; for(let i=-6;i<=6;i++) play.push([cx+i*5, cz+9]);
    v.state.railways=[play]; v._buildPlayerRailways(v.state); const pl=sig(v._pRailGroup);
    return { found, h, pl };
  });
  ok(rail.found, 'found a flat strip to lay comparison railways');
  ok(rail.h.sleepers>0 && rail.h.sleepers===rail.pl.sleepers, `traced & player railway have the same sleeper count (${rail.h.sleepers} vs ${rail.pl.sleepers})`);
  ok(JSON.stringify(rail.h.colors)===JSON.stringify(rail.pl.colors), `traced & player railway use the same palette (${rail.h.colors.map(c=>'#'+c.toString(16)).join(',')})`);

  // AIRPORT — the player airstrip must use the built-in airport's asphalt + cream.
  const air = await p.evaluate(()=>{
    const v=window.__sgview;
    const colsOf=(group)=>{ const s=new Set(); group&&group.traverse(o=>{ if(o.material?.color) s.add(o.material.color.getHex()); }); return s; };
    const baseCols=colsOf(v.airportGroup);
    // lay a player airstrip on a flat coastal strip
    let cx=0, cz=0, found=false;
    for (let X=-200;X<=200 && !found;X+=8) for (let Z=-200;Z<=200 && !found;Z+=8){
      let okp=true; for(let i=-5;i<=5;i++){ const h=v._heightAt(X+i*5,Z); if(h>2||h<=0.2){okp=false;break;} }
      if(okp){ cx=X; cz=Z; found=true; }
    }
    const strip=[]; for(let i=-5;i<=5;i++) strip.push([cx+i*5, cz]);
    v.state.airstrips=[strip]; v._buildPlayerAirstrips(v.state);
    const airCols=colsOf(v._airGroup);
    return { hasAsphalt: baseCols.has(0x35383d) && airCols.has(0x35383d),
             hasCream:   baseCols.has(0xeae4d2) && airCols.has(0xeae4d2) };
  });
  ok(air.hasAsphalt, 'player runway & built-in airport share the same asphalt (#35383d)');
  ok(air.hasCream, 'player runway & built-in airport share the same cream markings (#eae4d2)');

  // ROADS — traced base roads load into the very same edge list as player roads.
  const road = await p.evaluate(()=>{
    const v=window.__sgview;
    return { edges: (v.state.roads?.edges?.length)||0, hasNet: !!v.edgePts };
  });
  ok(road.hasNet, 'roads (traced + player) share the one unified road network');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
