// Unit test for road-network connectivity (spliceRoad): a freshly drawn road must
// JOIN what it touches — end-to-end at a node, a T onto the middle of a road, and
// an X where two roads cross — sharing junction nodes so vehicles can drive through.
import { spliceRoad } from '../../public/js/engine.js';
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};

// adjacency over the graph (nodes connected if an edge joins them), then BFS
function connected(roads, na, nb){
  const adj=new Map(); const link=(a,b)=>{ (adj.get(a)||adj.set(a,[]).get(a)).push(b); };
  for(const e of roads.edges){ link(e.a,e.b); link(e.b,e.a); }
  const seen=new Set([na]), q=[na];
  while(q.length){ const n=q.shift(); if(n===nb) return true; for(const m of (adj.get(n)||[])) if(!seen.has(m)){ seen.add(m); q.push(m);} }
  return false;
}
const nodeNear=(roads,x,z)=>{ let bi=-1,bd=3; roads.nodes.forEach((n,i)=>{const d=Math.hypot(n.x-x,n.z-z); if(d<bd){bd=d;bi=i;}}); return bi; };
const fresh=()=>({ nodes:[], edges:[] });
const meta={ type:'road', lanes:2, elevated:false };

// 1) END-TO-END: road B starts exactly where road A ended → one connected line.
{
  const r=fresh();
  spliceRoad(r, [{x:0,z:0},{x:20,z:0}], meta);
  spliceRoad(r, [{x:20,z:0},{x:40,z:0}], meta);
  const a=nodeNear(r,0,0), b=nodeNear(r,40,0);
  ok(a>=0&&b>=0 && connected(r,a,b), 'end-to-end: continuing from a road end links the two roads');
  ok(nodeNear(r,20,0)>=0, 'the shared end is a single node');
}

// 2) T-JUNCTION: road B's end lands on the MIDDLE of road A → A is split, connected.
{
  const r=fresh();
  spliceRoad(r, [{x:0,z:0},{x:40,z:0}], meta);          // A: horizontal
  const before=r.edges.length;
  spliceRoad(r, [{x:20,z:0},{x:20,z:30}], meta);        // B: meets A's middle, runs away
  ok(r.edges.length>before+1, `T-junction split road A into pieces (${before} → ${r.edges.length} edges)`);
  const a=nodeNear(r,0,0), tip=nodeNear(r,20,30);
  ok(connected(r,a,tip), 'T-junction: the branch reaches the far end of the through road');
  const aEnd=nodeNear(r,40,0);
  ok(connected(r,tip,aEnd), 'T-junction: branch connects to BOTH halves of the through road');
}

// 3) X-CROSSING: two roads cross mid-span → both split, all four arms connected.
{
  const r=fresh();
  spliceRoad(r, [{x:0,z:0},{x:40,z:0}], meta);          // horizontal
  spliceRoad(r, [{x:20,z:-20},{x:20,z:20}], meta);      // vertical crossing it at (20,0)
  const w=nodeNear(r,0,0), e=nodeNear(r,40,0), n=nodeNear(r,20,-20), s=nodeNear(r,20,20);
  ok([w,e,n,s].every(i=>i>=0), 'all four arm ends exist');
  ok(connected(r,w,e)&&connected(r,n,s)&&connected(r,w,n)&&connected(r,e,s), 'X-crossing: every arm reaches every other arm through the junction');
  const j=nodeNear(r,20,0);
  ok(j>=0, 'a junction node was created at the crossing point');
}

// 4) NO false junction: two roads that do NOT touch stay separate.
{
  const r=fresh();
  spliceRoad(r, [{x:0,z:0},{x:20,z:0}], meta);
  spliceRoad(r, [{x:0,z:50},{x:20,z:50}], meta);
  ok(!connected(r, nodeNear(r,0,0), nodeNear(r,0,50)), 'separate roads remain unconnected (no phantom junctions)');
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
