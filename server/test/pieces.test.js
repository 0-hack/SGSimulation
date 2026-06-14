// Lego-style fixed pieces: selecting Straight/Curve gives a fixed-length ghost that
// snaps onto route ends so pieces click together, and roads auto-connect for traffic.
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

  // open Build → Roads, pick Road + Straight piece
  await p.click('.tool[data-panel="build"]'); await p.waitForSelector('.cat-tab');
  await p.evaluate(()=>[...document.querySelectorAll('.cat-tab')].find(t=>/Roads/.test(t.textContent)).click());
  await p.waitForSelector('.road-tool');
  const labels = await p.evaluate(()=>[...document.querySelectorAll('.road-tool span:last-child')].map(s=>s.textContent.trim()));
  ok(labels.some(l=>/Straight/.test(l)) && labels.filter(l=>/Curve/.test(l)).length===2, `piece tools shown (Straight + two Curves): ${JSON.stringify(labels)}`);
  await p.evaluate(()=>[...document.querySelectorAll('.road-types .opt')].find(b=>/Road/.test(b.textContent))?.click());
  await p.evaluate(()=>[...document.querySelectorAll('.road-tool')].find(b=>/Straight/.test(b.textContent))?.click());
  await new Promise(r=>setTimeout(r,150));

  // place two straight pieces end-to-end on a flat spot, the 2nd snapping onto the 1st.
  const res = await p.evaluate(()=>{
    const v=window.__sgview;
    // a flat land spot (clear of reserve/river) — pieces may also tie into nearby roads
    let P=null;
    for(let X=-150;X<=150 && !P;X+=6) for(let Z=-150;Z<=150 && !P;Z+=6){
      let okp=true; for(let i=0;i<=6;i++){ const h=v._heightAt(X+i*6,Z); if(h<=0.5||h>3){okp=false;break;} }
      if(okp && !v.isReserveAt(X,Z) && !v.isRiverAt(X,Z)) P={X,Z};
    }
    if(!P) return { P:null };
    const nodeIdxNear=(x,z)=>{ let bi=-1,bd=4; v.navNodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.z-z);if(d<bd){bd=d;bi=i;}}); return bi; };
    const edges0=v.state.roads.edges.length;
    v._pieceRot=0;                                   // default heading +X
    // smoke-check the hover→ghost path produces a fixed-length ghost
    const ghost=v._buildPiece('straight', {x:P.X,z:P.Z}, 0);
    // place piece 1 (free placement at the cursor)
    const p1=ghost; v.onPiecePlace(p1);
    // piece 1's actual END node (may have merged into a nearby existing node)
    const eIdx=nodeIdxNear(p1[p1.length-1].x, p1[p1.length-1].z);
    const eNode=v.navNodes[eIdx];
    // hovering ON that end must snap the 2nd piece's start onto it (continue heading)
    const snap=v._pieceSnap(eNode.x, eNode.z);
    const snapped=!!snap && Math.hypot(snap.x-eNode.x, snap.z-eNode.z)<0.5;
    const p2=v._buildPiece('straight', {x:snap.x, z:snap.z}, snap.heading);  // chained piece from the snapped end
    v.onPiecePlace(p2);
    // connectivity over roads.edges: piece-1 start node reaches piece-2 end node
    const adj=new Map(); const link=(a,b)=>{(adj.get(a)||adj.set(a,[]).get(a)).push(b);};
    for(const e of v.state.roads.edges){ link(e.a,e.b); link(e.b,e.a); }
    const nodeNear=(x,z)=>{ let bi=-1,bd=4; v.state.roads.nodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.z-z);if(d<bd){bd=d;bi=i;}}); return bi; };
    const a=nodeNear(p1[0].x,p1[0].z), b=nodeNear(p2[p2.length-1].x, p2[p2.length-1].z);
    const seen=new Set([a]),q=[a]; let conn=a>=0&&b>=0; if(conn){ conn=false; while(q.length){const n=q.shift(); if(n===b){conn=true;break;} for(const m of (adj.get(n)||[])) if(!seen.has(m)){seen.add(m);q.push(m);} } }
    return { P, edges0, edgesNow:v.state.roads.edges.length, len1:Math.round(Math.hypot(p1[1].x-p1[0].x,p1[1].z-p1[0].z)),
      ghostLen:Math.round(Math.hypot(ghost[1].x-ghost[0].x, ghost[1].z-ghost[0].z)), snapped, conn };
  });
  ok(!!res.P, 'found a flat empty spot to drop pieces');
  if(!res.P){ console.log('  (no empty spot found — skipping piece assertions)'); }
  ok(res.P && res.len1>=18 && res.len1<=26, `straight piece is a FIXED length (${res.len1} m)`);
  ok(res.edgesNow >= res.edges0+2, `two pieces added two road edges (${res.edges0} → ${res.edgesNow})`);
  ok(res.snapped, 'the 2nd piece snapped its start onto the 1st piece\'s end');
  ok(res.conn, 'chained pieces auto-connect into one drivable road');

  // railway pieces store as a railway (not a mis-typed road edge)
  const rail = await p.evaluate(()=>{
    const v=window.__sgview;
    v.setPieceMode(true, { piece:'curveL', kind:'rail', type:'railway', onPlace:(pts)=>{ (v.state.railways||(v.state.railways=[])).push({pts:pts.map(p=>[p.x,p.z]),tunnel:false}); v._buildPlayerRailways(v.state); } });
    const before=(v.state.railways||[]).length;
    const pts=v._buildPiece('curveL', {x:-60,z:60}, 0); v.onPiecePlace(pts);
    return { before, after:(v.state.railways||[]).length, isObj:typeof (v.state.railways||[]).slice(-1)[0]==='object' };
  });
  ok(rail.after===rail.before+1 && rail.isObj, 'a railway curve piece is stored as a real railway');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
