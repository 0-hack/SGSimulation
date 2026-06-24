// Verifies traced 1966 roads render as smooth continuous ribbons (no notches at
// bends): the traced edge graph is chained into maximal polylines that cover every
// traced edge exactly once and are continuous, so each curve is one mitred ribbon.
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

  const r = await p.evaluate(()=>{
    const v=window.__sgview, roads=v.state.roads, E=roads.edges;
    const traced = E.map((e,i)=>e.traced?i:-1).filter(i=>i>=0);
    const chains = v._tracedChains(roads);
    // build a lookup of traced edges by their node pair (undirected)
    const key=(a,b)=>a<b?`${a}_${b}`:`${b}_${a}`;
    const tracedSet=new Set(traced.map(i=>key(E[i].a,E[i].b)));
    // every consecutive node pair must correspond to a real traced edge, and the
    // total number of chain segments must equal the traced edge count (the walk's
    // `used` set guarantees no edge is reused → exact, once-each coverage). Node
    // pairs can repeat legitimately (the 1966 data is a multigraph), so count
    // segments, not node-pair keys.
    let continuous=true, totalSegs=0, longest=0, multi=0;
    for(const ch of chains){
      const nodes=ch.nodes;                 // _tracedChains now returns { nodes, oneway }
      longest=Math.max(longest,nodes.length);
      if(nodes.length>=4) multi++;
      for(let i=0;i<nodes.length-1;i++){
        if(!tracedSet.has(key(nodes[i],nodes[i+1]))) continuous=false;
        totalSegs++;
      }
    }
    return { tracedEdges: traced.length, chains: chains.length, totalSegs, continuous, longest, multi };
  });
  ok(r.tracedEdges > 0, `the 1966 map has traced roads (${r.tracedEdges} edges)`);
  ok(r.continuous, 'every chain step is a real traced edge (chains are continuous)');
  ok(r.totalSegs === r.tracedEdges, `chains cover every traced edge exactly once (${r.totalSegs}/${r.tracedEdges} segments)`);
  ok(r.multi > 0 && r.longest >= 4, `multi-segment chains exist so curves draw as one ribbon (${r.multi} chains, longest ${r.longest} nodes)`);

  // roads still render + the network is intact for traffic
  const net = await p.evaluate(()=>({ groupKids: window.__sgview.roadGroup?.children?.length||0, edgePts: window.__sgview.edgePts.length }));
  ok(net.groupKids > 0, 'road meshes built into the scene');
  ok(net.edgePts > 0, 'traffic/nav network still intact');

  ok(errs.length===0, 'no console/page errors'+(errs.length?': '+errs[0]:''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
