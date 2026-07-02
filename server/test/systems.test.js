// Systems tests for the "living nation" rework:
//  • construction is the ONLY time-gated system (future tech greys out until its year)
//  • build prices move with technology maturity and currency strength
//  • ANY policy/law may be enacted at any time; effectiveness depends on conditions
//    (a high tax rate on a jobless economy yields far less and drives emigration)
//  • news carries detailed bodies (cause + consequence), incl. fire causes & daily life
import assert from 'node:assert';
import { newGame, tickDay, resolveEvent, fireDamage, buildingCost, techMaturityFactor, isUnlocked, buildDays, demolishDays } from '../../public/js/engine.js';
import { BUILDINGS, SANDBOX } from '../../public/js/data.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }
function fresh(y) { const s = newGame({ name: 'Sys', owner: 'T' }); if (y) { s.date = { y, m: 1, d: 1 }; s.economy = { inflation: 0.02, priceIndex: 1, currency: 1 }; } return s; }
function runMonths(s, n) { for (let i = 0; i < n * 31; i++) { if (s.pendingEvent) resolveEvent(s, 0); tickDay(s); } }

console.log('Construction is the only time-gated system:');
{
  ok(SANDBOX === false, 'sandbox/test mode is OFF — real build gating and finite funds ship');
  const s = fresh();
  ok(!isUnlocked(s, 'solar_farm'), 'a 2008 technology (Solar Farm) cannot be built in 1965');
  ok(isUnlocked(s, 'hdb_flat'), 'a 1965 technology can be built in 1965');
  const s08 = fresh(2008);
  ok(isUnlocked(s08, 'solar_farm'), 'the same technology unlocks once its invention year arrives');
}

console.log('Build price moves with tech maturity & currency:');
{
  const s = fresh();
  ok(Math.abs(techMaturityFactor(s, BUILDINGS.hdb_flat) - 1) < 1e-9, 'a building costs its full base the year it is invented (undisturbed start)');
  const old = fresh(2010);
  ok(techMaturityFactor(old, BUILDINGS.hdb_flat) < 0.85, `mature technology is markedly cheaper decades on (${techMaturityFactor(old, BUILDINGS.hdb_flat).toFixed(2)}×)`);
  const strong = fresh(); strong.economy.currency = 2.0;
  ok(buildingCost(strong, 'hdb_flat') < buildingCost(s, 'hdb_flat'), `a strong currency eases the imported build price ($${buildingCost(strong, 'hdb_flat')}M vs $${buildingCost(s, 'hdb_flat')}M)`);
}

console.log('Any policy, any time — effectiveness depends on conditions:');
{
  // GST is a 1994-era tax, yet it can be enacted in 1965 and collects revenue at once.
  const g = fresh(); g.policies.gst = true; runMonths(g, 3);
  ok(g.lastFinance && g.lastFinance.gst > 0, 'a "future" policy (GST) enacted in 1965 takes effect immediately — nothing is time-locked');

  // High income tax on a jobless economy yields far less than a moderate rate.
  const jobless = fresh();
  for (let y = 0; y < jobless.grid.length; y++) for (let x = 0; x < jobless.grid[y].length; x++) { const c = jobless.grid[y][x]; if (c && BUILDINGS[c.k] && BUILDINGS[c.k].jobs > 0) jobless.grid[y][x] = null; }
  jobless.policies.income_tax = 'high'; runMonths(jobless, 2);
  const mid = fresh(); mid.policies.income_tax = 'mid'; runMonths(mid, 2);
  ok(jobless.lastTaxEfficiency < 0.7, `a high rate on a jobless economy underdelivers (efficiency ${(jobless.lastTaxEfficiency || 0).toFixed(2)})`);
  ok((mid.lastTaxEfficiency || 1) > 0.999, 'a moderate rate carries no efficiency penalty');

  // Over-taxing a jobless economy pushes the workforce to emigrate (population falls).
  const drain = fresh();
  for (let y = 0; y < drain.grid.length; y++) for (let x = 0; x < drain.grid[y].length; x++) { const c = drain.grid[y][x]; if (c && BUILDINGS[c.k] && BUILDINGS[c.k].jobs > 0) drain.grid[y][x] = null; }
  drain.policies.income_tax = 'high';
  const pop0 = drain.population; runMonths(drain, 18);
  ok(drain.population < pop0, `over-taxing a jobless economy drives emigration (pop ${Math.round(pop0)} → ${Math.round(drain.population)})`);
}

console.log('Construction & demolition take realistic, embedded time:');
{
  const Y = 360; // game-days per year
  const hdb = buildDays(BUILDINGS.hdb_flat);
  ok(hdb >= 3 * Y && hdb <= 5 * Y, `an HDB estate takes 3–5 years to build (${(hdb / Y).toFixed(1)} yr)`);
  ok(buildDays(BUILDINGS.kampong) < Y, `a kampong goes up fast, in well under a year (${(buildDays(BUILDINGS.kampong) / 30).toFixed(0)} mo)`);
  ok(buildDays(BUILDINGS.nuclear) > buildDays(BUILDINGS.hdb_flat), 'a nuclear plant takes even longer than an HDB estate');
  ok(buildDays(BUILDINGS.hdb_newtown) > buildDays(BUILDINGS.hdb_flat), 'a whole new town takes longer than a single estate');
  // demolition is a real job — weeks to a few months — but faster than building
  const dd = demolishDays(BUILDINGS.hdb_flat);
  ok(dd >= 30 && dd < hdb, `demolishing an HDB is a multi-month job (${(dd / 30).toFixed(1)} mo), not instant, but faster than building it`);
  ok(demolishDays(BUILDINGS.nuclear) <= 6 * 30, 'even the biggest teardown is capped to a sensible few months');
}

console.log('News carries detailed bodies (cause + consequence):');
{
  const f = fresh(); f.grid[100][100] = { k: 'factory' };
  const res = fireDamage(f, 100, 100, 'a cooking fire got out of hand; fire cover is thin.');
  ok(res && f.log[0].scope === 'fire' && /cooking fire/.test(f.log[0].detail || ''), 'a fire logs a detailed item explaining WHY it burned');
  ok(/Fire Stations|greenery/i.test(f.log[0].detail || ''), 'the fire item also tells the player how to prevent it');

  const n = fresh(); let withDetail = 0; const scopes = new Set();
  for (let i = 0; i < 22 * 31; i++) { if (n.pendingEvent) resolveEvent(n, 0); tickDay(n); }
  for (const e of n.log) { if (e.detail && e.detail.length > 20) withDetail++; if (e.scope) scopes.add(e.scope); }
  ok(withDetail >= 3, `news items carry fuller detail bodies, not just headlines (${withDetail} detailed items)`);
  ok(scopes.has('daily') || scopes.has('incident'), `daily-life / on-the-ground news surfaces and is scope-tagged (${[...scopes].join(', ')})`);
}

console.log(`\n${passed} checks passed.`);
