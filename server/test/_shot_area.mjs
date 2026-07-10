// Diagnostic (not a test): boot the game and photograph a world-space area.
// env: OUT (png path), X/Z world target, R camera radius.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT = process.env.OUT || '/tmp/shot.png';
const X = parseFloat(process.env.X || '0'), Z = parseFloat(process.env.Z || '0'), R = parseFloat(process.env.R || '55');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1100, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise(r => setTimeout(r, 2500));                     // let the scene build
  await p.evaluate(({ X, Z, R }) => {
    const v = window.__sgview;
    v.target.x = X; v.target.z = Z;
    v.cam.radius = R; v.cam.phi = 0.5;                             // fairly top-down, like a player screenshot
    v.gameDays = Math.floor(v.gameDays) + 0.5;                     // noon, so the shot is readable
    if (v.state?.weather) { v.state.weather.rain = 0; v.state.weather.cloud = 0.1; }
  }, { X, Z, R });
  await new Promise(r => setTimeout(r, 1200));
  const tod = await p.evaluate(() => { const v = window.__sgview;
    setInterval(() => { v.gameDays = Math.floor(v.gameDays) + 0.5;                    // pin noon
      if (v.state?.weather) Object.assign(v.state.weather, { rain: 0, cloud: 0, wet: 0 }); }, 100);
    return new Promise((res) => setTimeout(() => res({ tod: v.timeOfDay, nf: v.nightFactor }), 4000)); });
  console.log('timeOfDay', tod.tod?.toFixed(3), 'nightFactor', tod.nf?.toFixed(3));
  await p.screenshot({ path: OUT });
  console.log('saved', OUT, 'errors:', errs.length ? errs.slice(0, 3) : 'none');
} finally { await browser.close(); server.close(); }
