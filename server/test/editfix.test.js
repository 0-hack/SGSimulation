// Editing-mode fixes: confirming a build exits the tool (no lingering ghost), the
// rotate button rotates the staged road, and the roundabout shows a placement ghost.
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
    await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click()); await p.waitForSelector('.road-tool'); };

  // (1) confirming a build exits the tool — no ghost left hovering
  await openRoads();
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Road/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,120));
  await p.evaluate(()=>{
    const v=window.__sgview; let P=null;
    for(let X=-120;X<=120&&!P;X+=6) for(let Z=-120;Z<=120&&!P;Z+=6){ let okp=true; for(let i=0;i<=5;i++){const h=v._heightAt(X+i*6,Z); if(h<=0.5||h>3){okp=false;break;}} if(okp&&!v.isReserveAt(X,Z)&&!v.isRiverAt(X,Z)) P={X,Z}; }
    v._pieceChain=[]; v._pieceRot=0; const pc=v._buildPiece('straight',{x:P.X,z:P.Z},0); v._pieceChain.push(pc.map(q=>({x:q.x,z:q.z}))); v.onPieceChain(v._mergedChain());
  });
  const beforeBuild = await p.evaluate(()=>!!window.__sgview.pieceMode);
  await p.click('#dc-build'); await new Promise(r=>setTimeout(r,150));
  const afterBuild = await p.evaluate(()=>({ pieceMode:!!window.__sgview.pieceMode, ghost:!!(window.__sgview._drawPreviewGroup), barHidden:document.getElementById('draw-confirm').classList.contains('hidden') }));
  ok(beforeBuild, 'piece tool active while staging');
  ok(!afterBuild.pieceMode && !afterBuild.ghost && afterBuild.barHidden, 'confirming a build exits the tool and clears the hovering ghost');

  // (2) rotate the staged road — the chain spins about its start
  await openRoads();
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,120));
  const rot = await p.evaluate(()=>{
    const v=window.__sgview;
    v._pieceChain=[]; v._pieceRot=0;
    const p1=v._buildPiece('straight', {x:0,z:0}, 0);   // start (0,0) → end (22,0)
    v._pieceChain.push(p1.map(q=>({x:q.x,z:q.z})));
    const before=v._pieceChainEnd();
    v.rotatePiece(Math.PI/2);                            // 90° about the start
    const after=v._pieceChainEnd();
    return { before:{x:Math.round(before.x),z:Math.round(before.z)}, after:{x:Math.round(after.x),z:Math.round(after.z)} };
  });
  ok(rot.before.x===22 && rot.before.z===0, 'staged chain end starts along +X');
  ok(Math.abs(rot.after.x)<=1 && Math.abs(rot.after.z-22)<=1, `rotate spins the staged road about its start (end ${JSON.stringify(rot.before)} → ${JSON.stringify(rot.after)})`);

  // (3) roundabout shows a translucent placement ghost
  await openRoads();
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Roundabout/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,120));
  const ra = await p.evaluate(()=>{
    const v=window.__sgview;
    const on = !!v._roundaboutPreview;
    // simulate a hover at the screen centre
    v._roundaboutHover({ x: window.innerWidth/2, y: window.innerHeight/2 });
    return { on, ghost: !!(v._raGhost && v._raGhost.visible) };
  });
  ok(ra.on, 'selecting Roundabout turns on the placement preview');
  ok(ra.ghost, 'a translucent roundabout ring shows where it will land');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
