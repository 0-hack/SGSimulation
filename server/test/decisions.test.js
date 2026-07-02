// Foreign/internal decisions are NON-blocking: they appear in a panel on the RIGHT
// (not a centre modal), the game clock keeps running while they sit there, and the
// PM answers each one whenever they like — resolving one drops just that card.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:1200, height:820 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r=>setTimeout(r,1500));
  await p.evaluate(() => document.querySelector('[data-spd="3"]')?.click());   // hyper-speed so a day ticks quickly

  // inject a foreign + an internal decision, as the engine's affairs would
  await p.evaluate(() => {
    window.__sg.state.pendingDecisions = [
      { id:'t_f', scope:'foreign', kind:'Foreign Affairs', icon:'🌏', title:'Border tested', body:'A neighbour probes the strait.', choice:{ options:[{label:'Stand firm', fx:{approval:2}},{label:'Seek talks', fx:{approval:-1}}] }, uid: 901 },
      { id:'t_i', scope:'internal', kind:'Internal Affairs', icon:'🏘️', title:'Kampong fire', body:'Overcrowding sparks a blaze.', choice:{ options:[{label:'Emergency flats', fx:{treasury:-20}},{label:'Hold the line', fx:{}}] }, uid: 902 },
    ];
  });
  await new Promise(r=>setTimeout(r,500));
  const shown = await p.evaluate(() => {
    const panel = document.getElementById('decisions');
    const rect = panel.getBoundingClientRect();
    return { visible: !panel.classList.contains('hidden'), cards: panel.querySelectorAll('.dec-card').length,
      onRight: rect.left > window.innerWidth * 0.55, foreign: !!panel.querySelector('.dec-card.foreign'),
      internal: !!panel.querySelector('.dec-card.internal'), day: window.__sg.state.daysElapsed };
  });
  ok(shown.visible && shown.cards === 2, `both briefings show in the panel (${shown.cards} cards)`);
  ok(shown.onRight, 'the panel sits on the RIGHT of the screen, not the centre');
  ok(shown.foreign && shown.internal, 'foreign & internal briefings are colour-tagged');

  // the clock keeps running while the decisions sit unanswered (non-blocking)
  await new Promise(r=>setTimeout(r,2500));
  const later = await p.evaluate(() => ({ day: window.__sg.state.daysElapsed, pending: window.__sg.state.pendingDecisions.length }));
  ok(later.day > shown.day, `the country runs on while decisions wait (day ${shown.day} → ${later.day})`);

  // answering ONE resolves just that one
  await p.evaluate(() => document.querySelector('[data-spd="0"]')?.click());   // pause so the count is stable
  await new Promise(r=>setTimeout(r,200));
  const pre = await p.evaluate(() => window.__sg.state.pendingDecisions.length);
  await p.evaluate(() => document.querySelector('#decisions .dec-card .btn').click());
  await new Promise(r=>setTimeout(r,300));
  const post = await p.evaluate(() => window.__sg.state.pendingDecisions.length);
  ok(post === pre - 1, `answering a briefing clears just that one (${pre} → ${post})`);
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
