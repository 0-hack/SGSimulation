import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const X = parseFloat(process.env.X || '0'), Z = parseFloat(process.env.Z || '0');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 700 });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r => setTimeout(r, 2500));
  const info = await p.evaluate(({ X, Z }) => {
    const v = window.__sgview;
    let cnt = 0, best = 1e9;
    for (const n of v.navNodes || []) { const d = Math.hypot(n.x - X, n.z - Z); if (d < 5) cnt++; if (d < best) best = d; }
    const rounds = (v.state && v.constructor) ? undefined : undefined;
    v.target.x = X; v.target.z = Z; v.cam.radius = 18; v.cam.phi = 0.5;
    return new Promise((res) => setTimeout(() => res({
      navNear: cnt, navBest: best.toFixed(2),
      tgt: [v.target.x.toFixed(1), v.target.z.toFixed(1)],
      rounds: (window.__sgview && (v.roadGroup ? 'roadGroup ' + v.roadGroup.children.length : ''))
    }), 800));
  }, { X, Z });
  console.log(JSON.stringify(info));
  await p.screenshot({ path: process.env.OUT || '/tmp/probe.png' });
} finally { await browser.close(); server.close(); }
