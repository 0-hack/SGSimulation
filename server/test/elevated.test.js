// Verifies the elevated option for ALL modes: a flyover road, a railway viaduct and
// a raised runway are lifted to a flat deck that clears everything below them, on
// pillars — and the elevated runway deck is FLAT (no slope).
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

  // the elevated toggle is offered for road, railway AND airport
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Transport/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  const toggles = await p.evaluate(()=>{
    const out={};
    for(const m of ['Road','Railway','Airport']){
      [...document.querySelectorAll('.road-types .opt')].find(b=>new RegExp(m).test(b.textContent))?.click();
      out[m] = [...document.querySelectorAll('.checkbox')].some(c=>/Elevated/.test(c.textContent));
    }
    return out;
  });
  ok(toggles.Road && toggles.Railway && toggles.Airport, `elevated toggle shown for all modes: ${JSON.stringify(toggles)}`);

  // build an elevated flyover over a hill and check the deck clears the ground
  const res = await p.evaluate(()=>{
    const v=window.__sgview;
    // hilliest strip
    const dirs=[[1,0],[0,1],[0.7,0.7]];
    const strip=(X,Z,d)=>{ const pts=[]; for(let i=-7;i<=7;i++) pts.push([X+d[0]*i*5, Z+d[1]*i*5]); return pts; };
    let best=null;
    for(let X=-120;X<=120;X+=8) for(let Z=-120;Z<=120;Z+=8) for(const d of dirs){
      const sp=strip(X,Z,d); let mx=-1e9; for(const q of sp) mx=Math.max(mx,v._roadY(q[0],q[1])); let lo=1e9; for(const q of sp) lo=Math.min(lo,v._roadY(q[0],q[1]));
      if(!best||(mx-lo)>best.range) best={X,Z,d,range:mx-lo,pts:sp};
    }
    const out={};
    // ELEVATED railway viaduct
    v.state.railways=[{pts:best.pts, elevated:true}];
    v._buildPlayerRailways(v.state);
    let pillars=0; v._pRailGroup.traverse(o=>{ if(o.geometry&&o.geometry.type==='CylinderGeometry') pillars++; });
    // measure deck Y vs ground at the midpoint (deck should clear the ground)
    const dense=v._resamplePoly(best.pts.map(q=>({x:q[0],z:q[1]})),1.4);
    const deckY=v._elevatedDeckY(dense,2); const midGround=v._roadY(best.X,best.Z);
    out.railPillars=pillars; out.railDeckClears = deckY - v._corridorTopY(dense,2);
    // ELEVATED runway — flat deck (constant), on pillars
    v.state.airstrips=[{pts:best.pts, elevated:true}];
    v._buildPlayerAirstrips(v.state);
    let airPillars=0; v._airGroup.traverse(o=>{ if(o.geometry&&o.geometry.type==='CylinderGeometry') airPillars++; });
    let ymin=1e9,ymax=-1e9; for(const pt of v._airPlanes[0].pts){ ymin=Math.min(ymin,pt.y); ymax=Math.max(ymax,pt.y); }
    out.airPillars=airPillars; out.deckVar = ymax-ymin; out.deckAboveGround = ymin - v._roadY(best.X,best.Z); out.range=best.range;
    return out;
  });
  ok(res.range > 4, `found a hill to bridge over (${res.range.toFixed(1)} m relief)`);
  ok(res.railPillars >= 2, `elevated railway viaduct stands on pillars (${res.railPillars})`);
  ok(res.railDeckClears >= 4 && res.railDeckClears < 6, `viaduct deck clears everything below it (+${res.railDeckClears.toFixed(1)} m headroom)`);
  ok(res.airPillars >= 2, `elevated runway stands on pillars (${res.airPillars})`);
  ok(res.deckVar < 0.01, `elevated runway deck is FLAT — no slope (varies ${res.deckVar.toFixed(3)} m)`);
  ok(res.deckAboveGround > 4, `elevated runway sits well above the ground (+${res.deckAboveGround.toFixed(1)} m)`);

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
