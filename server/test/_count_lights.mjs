import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 700 });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r => setTimeout(r, 2500));
  const n = await p.evaluate(() => { const v = window.__sgview;
    return { junctions: v.lights?.length ?? -1, posts: (v.lights || []).reduce((a, l) => a + l.posts.length, 0), lamps: v._lampGroup ? v._lampGroup.children.length : -1 }; });
  console.log('signalised junctions:', n.junctions, '| signal posts:', n.posts, '| lamp meshes:', n.lamps);
} finally { await browser.close(); server.close(); }
