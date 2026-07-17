// Visual check for the player bridge tool: place a deck by hand at the river
// mouth, screenshot the 3D result, and screenshot the Transport panel section.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const OUT3D = process.env.OUT3D || '/tmp/bridge_3d.png';
const OUTUI = process.env.OUTUI || '/tmp/bridge_ui.png';
const X = parseFloat(process.env.X || '-18'), Z = parseFloat(process.env.Z || '171');
const ROT = parseFloat(process.env.ROT || `${Math.PI / 3}`), LEN = parseFloat(process.env.LEN || '12'), W = parseFloat(process.env.W || '2');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1100, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise((r) => setTimeout(r, 2000));

  // panel shot first: Build → Transport tab shows the River bridge section
  await p.evaluate(() => { document.querySelector('.tool[data-panel="build"]')?.click(); });
  await new Promise((r) => setTimeout(r, 300));
  await p.evaluate(() => {
    const tab = [...document.querySelectorAll('.cat-tab')].find((b) => b.textContent.includes('Transport'));
    tab?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: OUTUI });

  // place the bridge through the real tool flow, then photograph it
  await p.evaluate(({ X, Z, ROT, LEN, W }) => {
    const sg = window.__sg;
    sg.selectBridgeTool();
    sg.onTileTap(0, 0, { x: X, z: Z });
    sg.setBridgeRot(ROT); sg.setBridgeLen(LEN); sg.setBridgeW(W);
    sg.commitBridge();
    const v = window.__sgview;
    v.target.x = X; v.target.z = Z;
    v.cam.radius = 22; v.cam.phi = 0.6; v.cam.theta = 0.4;
    v.gameDays = Math.floor(v.gameDays) + 0.5;
    if (v.state?.weather) { v.state.weather.rain = 0; v.state.weather.cloud = 0.1; }
  }, { X, Z, ROT, LEN, W });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => { const v = window.__sgview;
    setInterval(() => { v.gameDays = Math.floor(v.gameDays) + 0.5;
      if (v.state?.weather) Object.assign(v.state.weather, { rain: 0, cloud: 0, wet: 0 }); }, 100);
    return new Promise((res) => setTimeout(res, 2500)); });
  await p.screenshot({ path: OUT3D });
  console.log('saved', OUT3D, OUTUI, 'errors:', errs.length ? errs.slice(0, 3) : 'none');
} finally { await browser.close(); server.close(); }
