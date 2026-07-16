// Variation shots: photograph the mouth bridge with window.__mouthBridgeShift preset.
// env: OUT, SHIFT (world units north), X/Z/R/PHI/THETA as in _shot_area.mjs
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT = process.env.OUT || '/tmp/shot.png';
const SHIFT = parseFloat(process.env.SHIFT || '0');
const X = parseFloat(process.env.X || '-21'), Z = parseFloat(process.env.Z || '174'), R = parseFloat(process.env.R || '18'), PHI = parseFloat(process.env.PHI || '0.55'), THETA = parseFloat(process.env.THETA || '0.3');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1100, height: 900 });
  await p.evaluateOnNewDocument((s) => { window.__mouthBridgeShift = s; }, SHIFT);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(({ X, Z, R, PHI, THETA }) => {
    const v = window.__sgview;
    v.target.x = X; v.target.z = Z;
    v.cam.radius = R; v.cam.phi = PHI; v.cam.theta = THETA;
    v.gameDays = Math.floor(v.gameDays) + 0.5;
    if (v.state?.weather) { v.state.weather.rain = 0; v.state.weather.cloud = 0.1; }
  }, { X, Z, R, PHI, THETA });
  await new Promise((r) => setTimeout(r, 1200));
  await p.evaluate(() => { const v = window.__sgview;
    setInterval(() => { v.gameDays = Math.floor(v.gameDays) + 0.5;
      if (v.state?.weather) Object.assign(v.state.weather, { rain: 0, cloud: 0, wet: 0 }); }, 100);
    return new Promise((res) => setTimeout(res, 3000)); });
  await p.screenshot({ path: OUT });
  console.log('saved', OUT, 'shift', SHIFT, 'errors:', errs.length ? errs.slice(0, 2) : 'none');
} finally { await browser.close(); server.close(); }
