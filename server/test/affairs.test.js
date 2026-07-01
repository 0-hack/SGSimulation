// Affairs-of-state tests: the emergent Foreign/Internal decision system that
// replaced the fixed real-history replay, plus a guard that building & policy
// descriptions no longer narrate actual Singapore history (so the game is an
// alternate-history sandbox where the player writes their own timeline).
import assert from 'node:assert';
import { newGame, tickDay, resolveEvent } from '../../public/js/engine.js';
import { AFFAIRS, BUILDINGS, POLICIES } from '../../public/js/data.js';

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

console.log('Affairs pool:');
{
  const foreign = AFFAIRS.filter((a) => a.scope === 'foreign');
  const internal = AFFAIRS.filter((a) => a.scope === 'internal');
  ok(foreign.length >= 5 && internal.length >= 5, `both scopes are well stocked (${foreign.length} foreign, ${internal.length} internal)`);

  // Every affair is well-formed and every choice option carries an fx object.
  let badChoice = null, decisionCount = 0;
  for (const a of AFFAIRS) {
    if (!a.id || !a.title || !a.body) badChoice = a.id || '(no id)';
    if (a.choice) {
      decisionCount++;
      if (!Array.isArray(a.choice.options) || a.choice.options.length < 2) badChoice = a.id;
      for (const o of (a.choice.options || [])) if (!o.label || typeof o.fx !== 'object') badChoice = a.id;
    }
  }
  ok(!badChoice, `every affair is well-formed with valid choices${badChoice ? ' (bad: ' + badChoice + ')' : ''}`);
  ok(decisionCount >= AFFAIRS.length - 3, `most affairs put a real decision in the PM's hands (${decisionCount}/${AFFAIRS.length})`);

  // No affair is pinned to a fixed real calendar date (the old y/m scheduling) —
  // they surface emergently within era windows, not as a scripted replay.
  const dated = AFFAIRS.filter((a) => a.y != null || a.m != null);
  ok(dated.length === 0, 'no affair replays a fixed historical date (emergent, not scripted)');

  const founding = AFFAIRS.find((a) => a.atStart);
  ok(founding && founding.once && founding.choice, 'a one-time founding briefing opens the game with a choice');
}

console.log('Emergent firing & branching:');
{
  // The founding briefing is the very first thing the PM faces.
  const s = newGame({ name: 'Pathalonia', owner: 'PM' });
  let first = null;
  for (let i = 0; i < 400 && !first; i++) { tickDay(s); if (s.pendingEvent) first = s.pendingEvent; }
  ok(first && first.id === 'founding' && first.scope === 'internal', 'the founding briefing is the first affair to appear');
  ok(first.kind === 'Internal Affairs', 'the briefing is tagged with its affairs scope for the UI');
  resolveEvent(s, 1); // "Build institutions" → sets a path flag
  ok(s.pathFlags && Object.keys(s.pathFlags).length > 0, 'a founding choice records a branch in the nation\'s path');

  // The SAME crisis branches differently by choice: standing firm vs seeking a
  // great power move the external threat in opposite directions.
  const border = AFFAIRS.find((a) => a.id === 'border_incident');
  function tryOption(i) {
    const g = newGame({ name: 'Branch', owner: 'PM' });
    g.threatBuf = 0; g.pathFlags = {};
    g.pendingEvent = { id: border.id, scope: border.scope, kind: 'Foreign Affairs', icon: border.icon, title: border.title, body: border.body, choice: border.choice };
    resolveEvent(g, i);
    return g;
  }
  const firm = tryOption(0);       // stand firm — raises tension
  const align = tryOption(2);      // seek a great power — lowers tension, sets 'aligned'
  ok(firm.threatBuf > align.threatBuf, `the same crisis branches by choice (threatBuf firm ${firm.threatBuf.toFixed(2)} > aligned ${align.threatBuf.toFixed(2)})`);
  ok(align.pathFlags.aligned === true, 'seeking a great power records the "aligned" path flag');

  // Over decades, both foreign and internal affairs surface and resolve cleanly.
  const g = newGame({ name: 'Longrun', owner: 'PM' });
  let foreign = 0, internal = 0;
  for (let i = 0; i < 40 * 360; i++) {
    if (g.pendingEvent) {
      if (g.pendingEvent.scope === 'foreign') foreign++; else internal++;
      resolveEvent(g, 0);
    }
    tickDay(g);
  }
  ok(foreign >= 3 && internal >= 3, `both foreign (${foreign}) and internal (${internal}) affairs surface over a full run`);
  ok(g.approval >= 0 && g.approval <= 100 && Number.isFinite(g.treasury), 'the nation stays in valid bounds across the run');
}

console.log('Descriptions carry no real-history narration:');
{
  // Tokens that would pin the game to actual Singapore history (real dated
  // events, figures, named institutions-as-fact). Generic setting flavour
  // (kampong, shophouse, hawker) is fine — this only bans history lessons.
  const BANNED = [
    'Bukit Ho Swee', 'Ulu Pandan', 'MacRitchie', 'Marina Barrage', 'Konfrontasi',
    'MacDonald House', 'Lehman', 'Circuit Breaker', 'Biopolis', '30 by 30',
    'Community in Bloom', "People's Association", 'Chartered Industries', 'ST Engineering',
    'Singapore Improvement Trust', 'East of Suez', '54,000', '16,000', 'Cathay', 'OPEC',
  ];
  const YEAR = /\b(19|20)\d\d\b/; // no specific real years narrated in a description
  const offenders = [];
  const scan = (label, text) => {
    if (!text) return;
    for (const b of BANNED) if (text.includes(b)) offenders.push(`${label}: "${b}"`);
    const y = text.match(YEAR); if (y) offenders.push(`${label}: year ${y[0]}`);
  };
  for (const [k, b] of Object.entries(BUILDINGS)) scan(`building ${k}`, b.desc);
  for (const [k, p] of Object.entries(POLICIES)) {
    scan(`policy ${k}`, p.desc);
    for (const o of (p.options || [])) scan(`policy ${k} option`, o.label);
  }
  ok(offenders.length === 0, `building & policy descriptions narrate no real history${offenders.length ? ' — ' + offenders.slice(0, 6).join('; ') : ''}`);

  // The affair briefings likewise avoid replaying specific real events by name.
  const affOff = [];
  for (const a of AFFAIRS) { for (const b of BANNED) if ((a.body || '').includes(b)) affOff.push(`${a.id}: ${b}`); }
  ok(affOff.length === 0, `affair briefings stay generic, not a scripted replay${affOff.length ? ' — ' + affOff.join('; ') : ''}`);
}

console.log(`\n${passed} checks passed.`);
