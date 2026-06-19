// Lego-style fixed pieces: Straight/Curve give a fixed-length ghost that snaps onto
// route ends and CHAINS. Tapping stages pieces (no charge yet); the running cost
// shows in the commit bar; ONE Build starts construction — like freeform Draw.
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

  const openRoads = async () => { await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
    await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Transport/.test(t.textContent)).click()); await p.waitForSelector('.road-tool'); };
  await openRoads();
  const labels = await p.evaluate(()=>[...document.querySelectorAll('.road-tool span:last-child')].map(s=>s.textContent.trim()));
  ok(labels.some(l=>/Straight/.test(l)) && labels.filter(l=>/Curve/.test(l)).length===1 && !labels.some(l=>/Demolish/.test(l)), `piece tools shown (Straight + one Curve, no in-tool Demolish): ${JSON.stringify(labels)}`);
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Road/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));

  // stage two straight pieces into the chain (mirrors two taps) WITHOUT committing
  const staged = await p.evaluate(()=>{
    const v=window.__sgview;
    let P=null;
    for(let X=-150;X<=150 && !P;X+=6) for(let Z=-150;Z<=150 && !P;Z+=6){
      let okp=true; for(let i=0;i<=6;i++){ const h=v._heightAt(X+i*6,Z); if(h<=0.5||h>3){okp=false;break;} }
      if(okp && !v.isReserveAt(X,Z) && !v.isRiverAt(X,Z)) P={X,Z};
    }
    if(!P) return { P:null };
    v._pieceChain=[]; v._pieceRot=0;
    const piece1=v._buildPiece('straight', {x:P.X,z:P.Z}, 0);
    v._pieceChain.push(piece1.map(q=>({x:q.x,z:q.z})));
    const end=v._pieceChainEnd();                                   // next piece continues from here
    const piece2=v._buildPiece('straight', {x:end.x,z:end.z}, end.heading);
    const chained=Math.hypot(piece2[0].x-piece1[1].x, piece2[0].z-piece1[1].z)<0.01;
    v._pieceChain.push(piece2.map(q=>({x:q.x,z:q.z})));
    const merged=v._mergedChain();
    const edges0=v.state.roads.edges.length, treas0=v.state.treasury, rw0=(v.state.roadworks||[]).length;
    v.onPieceChain(merged);                                         // shows the running-cost commit bar; nothing built/charged
    const barOpen=!document.getElementById('draw-confirm').classList.contains('hidden');
    return { P, len1:Math.round(Math.hypot(piece1[1].x-piece1[0].x,piece1[1].z-piece1[0].z)), chained,
      mergedPts:merged.length, mergedLen:Math.round(v && merged.reduce((s,_,i)=> i? s+Math.hypot(merged[i].x-merged[i-1].x, merged[i].z-merged[i-1].z):0,0)),
      barOpen, builtYet:v.state.roads.edges.length!==edges0, chargedYet:v.state.treasury!==treas0, rwYet:(v.state.roadworks||[]).length!==rw0,
      edges0, treas0, rw0 };
  });
  ok(!!staged.P, 'found a flat spot to stage pieces');
  ok(staged.len1>=18 && staged.len1<=26, `straight piece is a FIXED length (${staged.len1} m)`);
  ok(staged.chained, 'the 2nd piece continues exactly from the 1st piece\'s end (chained)');
  ok(staged.mergedPts>=3 && staged.mergedLen>=40, `two pieces form one chain (${staged.mergedPts} pts, ${staged.mergedLen} m)`);
  ok(staged.barOpen, 'a commit bar shows the running cost while chaining');
  ok(!staged.builtYet && !staged.chargedYet && !staged.rwYet, 'staging does NOT build or charge yet (chain first)');

  // ONE Build commits the whole chain to construction
  await p.click('#dc-build');
  await new Promise(r=>setTimeout(r,150));
  const built = await p.evaluate((s)=>{
    const v=window.__sgview;
    const rw=(v.state.roadworks||[]); const last=rw[rw.length-1];
    return { rwAdded:rw.length===s.rw0+1, kind:last&&last.kind, charged:v.state.treasury<s.treas0,
      chainCleared:(v._pieceChain||[]).length===0, edgesStill:v.state.roads.edges.length===s.edges0, rwPts:last&&last.pts&&last.pts.length };
  }, staged);
  ok(built.rwAdded && built.kind==='road', 'Build queues ONE road construction project for the chain');
  ok(built.charged, 'the player is charged only on Build (construction-crew flow)');
  ok(built.chainCleared, 'the staged chain is cleared once construction starts');
  ok(built.edgesStill, 'the road edge appears only after construction finishes (not instantly)');

  // railway pieces chain + commit as a railway (not a mis-typed road edge)
  await openRoads();
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Railway/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/↰ Curve/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));
  const rail = await p.evaluate(()=>{
    const v=window.__sgview;
    // a flat railway spot so no tunnel prompt (single Build)
    let P=null;
    for(let X=-150;X<=150 && !P;X+=8) for(let Z=-150;Z<=150 && !P;Z+=8){
      let okp=true; for(let i=-3;i<=3;i++){ const h=v._heightAt(X+i*6,Z); if(h<=0.5||h>2){okp=false;break;} }
      if(okp && !v.isReserveAt(X,Z) && !v.isRiverAt(X,Z)) P={X,Z};
    }
    if(!P) return { P:null };
    v._pieceChain=[]; v._pieceRot=0;
    const piece=v._buildPiece('curveL', {x:P.X,z:P.Z}, 0); v._pieceChain.push(piece.map(q=>({x:q.x,z:q.z})));
    const rw0=(v.state.roadworks||[]).length;
    v.onPieceChain(v._mergedChain());
    const acts=[...document.querySelectorAll('#dc-actions button')].filter(x=>!x.classList.contains('hidden'));
    return { P, rw0, label:acts.map(x=>x.textContent.trim()) };
  });
  ok(!!rail.P, 'found a flat railway spot');
  if(rail.P){
    await p.click('#dc-build'); await new Promise(r=>setTimeout(r,150));
    const railRW = await p.evaluate((s)=>{ const rw=(window.__sgview.state.roadworks||[]); const last=rw[rw.length-1]; return { added:rw.length===s.rw0+1, kind:last&&last.kind }; }, rail);
    ok(railRW.added && railRW.kind==='rail', 'a railway curve chain commits as a rail construction project');
  }

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
