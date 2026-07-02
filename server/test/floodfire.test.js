// Physics/chemistry: water snuffs fire. A flood raises a water plane over the land;
// any flame the rising water reaches is doused — and the building is SAVED (it does
// NOT burn down), just as heavy rain saves it. Dry weather alone lets fire keep going.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width:900, height:700 });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base,{waitUntil:'networkidle0'});
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r=>setTimeout(r,1500));
  const res = await p.evaluate(async () => {
    const v = window.__sgview;
    let destroyed = 0; v.onDisaster = () => { destroyed++; };   // a fire that DESTROYS a building calls this
    v._igniteTimer = 99999;                                     // no random new ignitions during the test
    v.weather = { type:'sunny', cloud:0.05, rain:0, wind:0.2, windDir:0.5 }; v._wTarget = { cloud:0.05, rain:0, wind:0.2 };
    const f1 = v._igniteFire(30, 30, 'building', 'a', { label:'Fire A', why:'test' });
    const f2 = v._igniteFire(-30, -30, 'building', 'b', { label:'Fire B', why:'test' });
    f1.gx = 5; f1.gy = 5; f2.gx = 6; f2.gy = 6;                 // grid cells so a destroy WOULD call onDisaster
    f1.baseY = -50; f2.baseY = -50;                            // low ground → a flood submerges them
    const before = v._fires.length;
    for (let i=0;i<20;i++) v._updateFire(0.1);                  // 2s of dry weather — they keep burning
    const dryBurning = v._fires.length;
    v.playDisaster('flood');                                    // water rises over the land
    let submergedSeen = false;
    for (let i=0;i<140;i++){ v._updateDisaster(0.1); v._updateFire(0.1); if (v.floodPlane.visible && v.floodPlane.position.y > -50) submergedSeen = true; }
    return { before, dryBurning, after: v._fires.length, destroyed, submergedSeen };
  });
  ok(res.before === 2, `two fires ignite (${res.before})`);
  ok(res.dryBurning === 2, 'dry weather alone does NOT put them out (they keep burning)');
  ok(res.submergedSeen, 'a flood raises the water over the fires');
  ok(res.after === 0, 'the flood douses every fire it reaches');
  ok(res.destroyed === 0, 'the doused buildings are SAVED (they do not burn down)');
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
