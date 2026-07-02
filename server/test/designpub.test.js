// The 3D designer can PUBLISH a design to the community: choosing a functionality
// and era, then Publish, sends it to the server so it appears in the community list
// (and the delete token is kept in this browser).
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
let tokens = {};
try {
  const p = await browser.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto(base+'/design.html',{waitUntil:'networkidle0'});
  await new Promise(r=>setTimeout(r,1000));
  const uniq = 'TestPavilion_'+Math.floor(performance.now());
  await p.evaluate((name)=>{
    document.getElementById('name').value = name;
    document.getElementById('cfunc').value = 'entertainment';
    document.getElementById('cauthor').value = 'Tester';
    document.getElementById('cyear').value = '1975';
    document.querySelector('[data-add="box"]').click();
    document.querySelector('[data-add="dome"]').click();
  }, uniq);
  await new Promise(r=>setTimeout(r,250));
  await p.evaluate(()=>document.getElementById('publish').click());
  await new Promise(r=>setTimeout(r,600));
  const r = await p.evaluate(async (name)=>{
    const list = await fetch('/api/builds?sort=recent&limit=100').then(x=>x.json());
    const mine = list.builds.find(b=>b.name===name);
    const store = JSON.parse(localStorage.getItem('sg_my_builds')||'{}');
    return { found: !!mine, func: mine&&mine.func, year: mine&&mine.year, hasToken: Object.keys(store).length>0, tokens: store };
  }, uniq);
  tokens = r.tokens || {};
  ok(r.found, 'a design published from the designer appears in the community list');
  ok(r.func === 'entertainment' && r.year === 1975, 'the chosen functionality & era are stored');
  ok(r.hasToken, 'the delete token is kept in the browser');
  ok(errs.length === 0, 'no console/page errors' + (errs.length ? ': ' + errs[0] : ''));
  // clean up what we published
  await p.evaluate(async (tk)=>{ for (const [id,t] of Object.entries(tk)) await fetch('/api/builds/'+id,{method:'DELETE',headers:{'x-build-token':t}}); }, tokens);
} catch(e){ fail++; console.error('  ✗ threw:', e.message, e.stack); }
finally { await browser.close(); server.close(); }
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
