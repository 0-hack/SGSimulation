// Smoke tests: exercise the engine for decades and the REST API end-to-end.
import assert from 'node:assert';
import { newGame, tickDay, build, snapshot, resolveEvent } from '../../public/js/engine.js';
import { fleetEra, economyAdoption } from '../../public/js/data.js';
import { app } from '../server.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

console.log('Engine simulation:');
{
  const s = newGame({ name: 'Testopia', owner: 'Tester' });
  ok(s.population > 0, 'starts with a population');
  ok(s.treasury > 0, 'starts with a treasury');

  // Build a balanced starter city.
  build(s, 5, 5, 'hdb_flat');
  build(s, 6, 5, 'hdb_flat');
  build(s, 7, 5, 'diesel');
  build(s, 8, 5, 'reservoir');
  build(s, 9, 5, 'factory');
  build(s, 5, 6, 'school');
  build(s, 6, 6, 'hospital');
  build(s, 7, 6, 'park');

  // Auto-resolve any event choices so the loop never blocks.
  let years = 0;
  for (let i = 0; i < 30 * 360; i++) { // ~30 years of days
    if (s.pendingEvent) resolveEvent(s, 0);
    tickDay(s);
    if (s.date.m === 1 && s.date.d === 1) years++;
  }
  const snap = snapshot(s);
  ok(Number.isFinite(snap.treasury), 'treasury stays finite over 30 years');
  ok(Number.isFinite(snap.population) && snap.population >= 0, 'population stays valid');
  ok(snap.approval >= 0 && snap.approval <= 100, 'approval stays within 0..100');
  ok(s.date.y >= 1994, `clock advanced to ${s.date.y}`);
  ok(s.summary && s.summary.population >= 0, 'summary is populated for the server');
  console.log(`    → ${s.date.y}: pop ${snap.population.toLocaleString()}, ` +
    `treasury $${Math.round(snap.treasury)}M, approval ${Math.round(snap.approval)}%`);
}

console.log('World-technology timeline:');
{
  // A generation only runs once it is invented AND the economy can import it.
  const poor1965 = fleetEra({ date: { y: 1965 }, education: 20, treasury: 120, approval: 55 });
  ok(poor1965.car === 'vintage' && poor1965.train === 'steam', 'a poor 1965 nation runs vintage cars & steam trains');

  const richState = { date: { y: 2015 }, education: 85, treasury: 2000, approval: 72 };
  const poorState = { date: { y: 2015 }, education: 25, treasury: 40, approval: 38 };
  const rich2015 = fleetEra(richState), poor2015 = fleetEra(poorState);
  ok(rich2015.car === 'contemporary' && rich2015.train === 'modern', 'a wealthy 2015 nation imports the newest fleet');
  ok(poor2015.car === 'modern', 'a struggling 2015 nation lags a generation behind (still modern, not contemporary)');
  ok(economyAdoption(richState) > economyAdoption(poorState), 'a stronger economy has a higher technology-adoption index');

  // The engine announces world inventions as their historical year arrives.
  const s = newGame({ name: 'Techtopia', owner: 'Tester' });
  let sawNuclear = false, sawSolar = false;
  for (let i = 0; i < 60 * 360; i++) {        // run to ~2025
    if (s.pendingEvent) resolveEvent(s, 0);
    tickDay(s);
    for (const t of (s.newTech || [])) { if (/Nuclear/.test(t)) sawNuclear = true; if (/Solar/.test(t)) sawSolar = true; }
    s.newTech = [];
  }
  ok(sawNuclear, 'nuclear power is announced to the world when its year (1968) arrives');
  ok(sawSolar, 'the solar farm is announced when its year (2008) arrives');
}

console.log('REST API:');
await new Promise((resolve) => {
  const server = app.listen(0, async () => {
    const base = `http://localhost:${server.address().port}`;
    try {
      const s = newGame({ name: 'API City', owner: 'Api Tester' });
      for (let i = 0; i < 100; i++) { if (s.pendingEvent) resolveEvent(s, 0); tickDay(s); }

      // create
      let res = await fetch(`${base}/api/worlds`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: s.name, owner: s.owner, state: s }),
      });
      let world = await res.json();
      ok(res.status === 200 && world.id && world.token, 'POST /worlds creates a world + token');

      // load full
      res = await fetch(`${base}/api/worlds/${world.id}`);
      const full = await res.json();
      ok(full.state.population === s.population, 'GET /worlds/:id returns the saved state');
      ok(full.token === undefined, 'secret token is never exposed to viewers');

      // update with token
      s.name = 'API City Renamed';
      res = await fetch(`${base}/api/worlds/${world.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-world-token': world.token },
        body: JSON.stringify({ name: s.name, owner: s.owner, state: s }),
      });
      ok(res.status === 200, 'PUT /worlds/:id with token succeeds');

      // update with wrong token rejected
      res = await fetch(`${base}/api/worlds/${world.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-world-token': 'bogus' },
        body: JSON.stringify({ name: 'hacked', owner: 'x', state: s }),
      });
      ok(res.status === 403, 'PUT with wrong token is rejected');

      // browse list
      res = await fetch(`${base}/api/worlds`);
      const list = await res.json();
      ok(Array.isArray(list.worlds) && list.total >= 1, 'GET /worlds lists public worlds');

      // delete
      res = await fetch(`${base}/api/worlds/${world.id}`, {
        method: 'DELETE', headers: { 'x-world-token': world.token },
      });
      ok(res.status === 200, 'DELETE /worlds/:id with token succeeds');
    } catch (err) {
      console.error('API test error:', err);
      process.exitCode = 1;
    } finally {
      server.close(resolve);
    }
  });
});

console.log(`\n${passed} checks passed.`);
