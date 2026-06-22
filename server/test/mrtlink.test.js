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

  // A station placed on a drawn viaduct turns to line up with the track (deck runs
  // through it) and meets the deck; and the standard Demolish removes the viaduct.
  const c = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length, W = 1600;
    const w = (gx,gy)=>[(gx/N-0.5)*W,(0.5-gy/N)*W];
    const clear=(x,y)=>v.isLand(x,y)&&!v.isRoadAt(x,y)&&!(v.heritageMask&&v.heritageMask[y][x])&&!v.state.grid[y][x];
    let row=-1,x0=0,len=0; for(let y=20;y<N-20&&row<0;y++){let run=0,sx=0;for(let x=20;x<N-20;x++){if(clear(x,y)){if(run===0)sx=x;run++;if(run>=22){row=y;x0=sx;len=run;break;}}else run=0;}}
    const x1=x0+Math.min(len-2,24); const line=[]; for(let gx=x0;gx<=x1;gx++) line.push(w(gx,row));
    v.state.railways=[{pts:line,elevated:true,mrt:true}]; v._buildPlayerRailways(v.state);
    const sgx=Math.round((x0+x1)/2);
    S.selectBuilding('mrt'); S.onTileTap(sgx,row+3); const sx=S.adjust.x, sy=S.adjust.y; S.commitAdjust();
    v.state.grid[sy][sx].build=null; v.syncAll(); v._buildPlayerRailways(v.state);
    const e=v.buildings.get(`${sx},${sy}`); const sw=w(sx,sy);
    const info=v._viaductInfoAt(sw[0],sw[1], 2.5*2.2);
    const aligned = Math.abs(((e.group.rotation.y - info.bearing + Math.PI*3)%(Math.PI*2)) - Math.PI) < 0.02; // rotation == track bearing
    const onDeck = Math.abs((e.group.position.y + 6.3*(W/N/10)) - info.y) < 0.05;
    return { aligned, onDeck };
  });
  ok(c.aligned, 'a station on a viaduct turns to line up with the track (no gap)');
  ok(c.onDeck, 'that station sits exactly at the deck height (meets the viaduct)');

  // Two viaducts drawn end-to-end JOIN into one continuous line (no gap), a single
  // train runs the whole thing, and it stops at stations on the line.
  const j = await p.evaluate(() => {
    const v = window.__sgview, S = window.__sg, N = v.land.length, W = 1600;
    const w = (gx,gy)=>[(gx/N-0.5)*W,(0.5-gy/N)*W];
    const clear=(x,y)=>v.isLand(x,y)&&!v.isRoadAt(x,y)&&!(v.heritageMask&&v.heritageMask[y][x])&&!v.state.grid[y][x];
    let row=-1,x0=0,len=0; for(let y=20;y<N-20&&row<0;y++){let run=0,sx=0;for(let x=20;x<N-20;x++){if(clear(x,y)){if(run===0)sx=x;run++;if(run>=30){row=y;x0=sx;len=run;break;}}else run=0;}}
    const mid=x0+15, x1=x0+30;
    const A=[]; for(let gx=x0;gx<=mid;gx++) A.push(w(gx,row));
    const B=[]; for(let gx=mid;gx<=x1;gx++) B.push(w(gx,row));
    v.state.railways=[{pts:A,elevated:true,mrt:true},{pts:B,elevated:true,mrt:true}];   // two separate, connected
    const chains = v._chainRailEntries(v.state.railways);
    v._buildPlayerRailways(v.state);
    v.state.treasury = 99999;
    S.selectBuilding('mrt'); S.onTileTap(mid, row+3); const sx=S.adjust.x, sy=S.adjust.y; S.commitAdjust();
    if (!v.state.grid[sy][sx]) return { chains: chains.length, mrtTracks:(v._playerTrainTracks||[]).filter(t=>t.kind==='mrt').length, stops:0 };
    v.state.grid[sy][sx].build=null; v.syncAll(); v._buildPlayerRailways(v.state);
    const tr=(v._trains||[]).find(t=>t.track.kind==='mrt');
    return { chains: chains.length, mrtTracks: (v._playerTrainTracks||[]).filter(t=>t.kind==='mrt').length, stops: tr?tr.stops.length:0 };
  });
  ok(j.chains===1 && j.mrtTracks===1, `two connected viaducts merge into one continuous line (${j.chains} chain, ${j.mrtTracks} track)`);
  ok(j.stops>=1, `the train stops at stations on the line (${j.stops} stop)`);

  // On an ELEVATED span over a hill: the DECK levels across the platform so the station
  // stays upright (180° straight) and lifts onto it; plumb columns + a ground→platform
  // access core support it; and the train cars PITCH along the grade BETWEEN stations.
  const ev = await p.evaluate(() => {
    const v = window.__sgview, N = v.land.length, W = 1600;
    const strip=(X,Z,d)=>{const pts=[];for(let i=-7;i<=7;i++)pts.push([X+d[0]*i*5,Z+d[1]*i*5]);return pts;};
    const dirs=[[1,0],[0,1],[0.7,0.7]]; let best=null;
    for(let X=-120;X<=120;X+=8)for(let Z=-120;Z<=120;Z+=8)for(const d of dirs){const sp=strip(X,Z,d);let mx=-1e9,lo=1e9;for(const q of sp){const y=v._roadY(q[0],q[1]);mx=Math.max(mx,y);lo=Math.min(lo,y);}if(!best||(mx-lo)>best.range)best={range:mx-lo,pts:sp};}
    v.state.railways=[{pts:best.pts,elevated:true,mrt:true}]; v._buildPlayerRailways(v.state);
    const prof=v._mrtProfiles[0]; let hi=null; for(const pt of prof){const g=pt.y-v._roadY(pt.x,pt.z); if(!hi||g>hi.gap)hi={x:pt.x,z:pt.z,gap:g};}
    const gx=Math.round((hi.x/W+0.5)*N), gy=Math.round((0.5-hi.z/W)*N);
    v.state.grid[gy][gx]={k:'mrt'}; v.syncAll(); v._buildPlayerRailways(v.state);
    const e=v.buildings.get(`${gx},${gy}`);
    const V=e.group.position.constructor;                                   // THREE.Vector3 (not global in-page)
    let lift=0, tilt=1, deckSlope=1;
    if(e){
      lift = e.group.position.y - v._roadY(e.group.position.x, e.group.position.z);
      const px = new V(1,0,0).applyQuaternion(e.group.quaternion);          // platform axis in world
      tilt = Math.abs(px.y);                                                // ~0 → station is level/upright
      const info = v._viaductInfoAt(e._baseX, e._baseZ, 2.5*2.6);
      deckSlope = info ? Math.abs(info.slope) : 1;                          // deck flat across the platform
    }
    // columns (cylinders) reach the ground; the access core is a Group of boxes
    let cols=0, maxGap=0, access=false;
    for(const c of (v._mrtLegsGroup ? v._mrtLegsGroup.children : [])){
      if(c.type==='Group'){ access=true; continue; }
      if(c.geometry && c.geometry.type==='CylinderGeometry'){ cols++; const h=c.geometry.parameters.height; maxGap=Math.max(maxGap, Math.abs((c.position.y - h/2) - v._roadY(c.position.x, c.position.z))); }
    }
    // train cars pitch with the grade on the sloped approaches between stations
    v._updateTrains(0); v._trainGroup.updateMatrixWorld(true);
    let carPitch = 0;
    for(const tr of (v._trains||[])) if(tr.track.kind==='mrt') for(const c of tr.cars){ if(!c.visible) continue; const f=c.localToWorld(new V(0,0,1)); carPitch=Math.max(carPitch, Math.abs(f.y - c.position.y)); }
    return { range: best.range, lift, tilt, deckSlope, cols, maxGap, access, carPitch };
  });
  ok(ev.lift > 3, `station auto-fits the elevated deck, lifted onto it (${ev.lift.toFixed(1)} units up, ${ev.range.toFixed(0)}m relief)`);
  ok(ev.tilt < 0.03, `the station stays LEVEL / upright, not leaning with the slope (platform rise ${ev.tilt.toFixed(3)})`);
  ok(ev.deckSlope < 0.05, `the viaduct deck is LEVELLED across the platform to meet it (slope ${ev.deckSlope.toFixed(3)})`);
  ok(ev.cols >= 1 && ev.maxGap < 0.3, `${ev.cols} plumb support columns reach the ground (worst foot gap ${ev.maxGap.toFixed(2)})`);
  ok(ev.access, `a ground→platform access core (lift/stairs) is provided`);
  ok(ev.carPitch > 0.03, `train cars pitch along the grade between stations (nose rise ${ev.carPitch.toFixed(2)})`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
