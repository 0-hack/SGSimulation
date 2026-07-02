// Community builds API: players publish custom buildings, browse them sorted by
// downloads (or recency) and filtered by functionality, and downloading one counts
// toward its popularity and returns the design to construct.
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const J = (r) => r.json();
const post = (p, b) => fetch(base+p, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(b) }).then(J);
const del = (p, tok) => fetch(base+p, { method:'DELETE', headers:{'content-type':'application/json','x-build-token':tok} }).then(J);
const get = (p) => fetch(base+p).then(J);
const design = (n) => ({ parts: Array.from({length:n}, (_,i)=>({ t:'box', x:i, y:0, z:0, w:2, h:3, d:2, c:'#c8b088' })), stats:{ happiness:3 } });
const created = [];
try {
  // publish three builds with different functions
  const a = await post('/builds', { name:'Corner Kopitiam', author:'PM', func:'economy', size:1.2, year:1970, design:design(6) });
  const b = await post('/builds', { name:'Void-Deck Flats', author:'PM', func:'house', size:2.0, year:1972, design:design(10) });
  const c = await post('/builds', { name:'Tidal Turbine', author:'PM', func:'power', size:1.5, year:2005, design:design(8) });
  [a,b,c].forEach(x=>x.id&&created.push({id:x.id, token:x.token}));
  ok(a.id && a.token && b.id && c.id, 'publishing returns an id + a secret token');
  ok(a.func === 'economy' && b.func === 'house' && c.func === 'power', 'the chosen functionality is stored');

  // download the third build a few times → it should climb the popularity sort
  let dl;
  for (let i=0;i<3;i++) dl = await post(`/builds/${c.id}/download`, {});
  ok(dl && dl.downloads === 3 && Array.isArray(dl.design.parts), 'downloading counts toward popularity AND returns the design to build');

  const top = await get('/builds?sort=downloads&limit=100');
  const ids = top.builds.map(x=>x.id);
  ok(ids.indexOf(c.id) < ids.indexOf(a.id) && ids.indexOf(c.id) < ids.indexOf(b.id), 'the most-downloaded build sorts to the top');

  // filter by functionality
  const powerOnly = await get('/builds?func=power&limit=100');
  ok(powerOnly.builds.every(x=>x.func==='power') && powerOnly.builds.some(x=>x.id===c.id), 'filtering by functionality returns only that kind');

  // list metadata hides the design; the detail endpoint includes it
  ok(top.builds[0].design === undefined, 'the browse list is lightweight (no design payload)');
  const full = await get(`/builds/${a.id}`);
  ok(full.id === a.id && Array.isArray(full.design.parts), 'the detail endpoint returns the full design');

  // invalid design is rejected
  const bad = await post('/builds', { name:'Nope', design:{ parts:[] } });
  ok(bad.error, 'an empty design is rejected');

  // delete requires the token
  const noTok = await del(`/builds/${a.id}`, 'wrong');
  ok(noTok.error, 'deleting without the right token is refused');
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally {
  for (const c of created) { try { await del(`/builds/${c.id}`, c.token); } catch {} }   // clean up rows we made
  server.close();
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
