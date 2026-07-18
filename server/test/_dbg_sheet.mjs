// What is the translucent blue sheet at the river mouth? Raycast + list hits.
import puppeteer from 'puppeteer';
import { app } from '../server.js';
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 480, height: 860 });
  await p.goto(base, { waitUntil: 'networkidle0' });
  await p.click('#btn-new'); await p.waitForSelector('#game:not(.hidden)');
  await new Promise((r) => setTimeout(r, 1500));
  const out = await p.evaluate(() => {
    const v = window.__sgview, ray = v.raycaster;
    const res = {};
    const spots = { sheet: [-12.3, 177.5], sheet2: [-16, 175], onDeckN: [-18.5, 174.5] };
    for (const [k, [x, z]] of Object.entries(spots)) {
      ray.ray.origin.set(x, 60, z); ray.ray.direction.set(0, -1, 0); ray.near = 0; ray.far = 200;
      const meshes = [];
      v.scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry) meshes.push(o); });
      res[k] = ray.intersectObjects(meshes, false).slice(0, 6).map((h) => ({
        y: +h.point.y.toFixed(2),
        col: h.object.material && h.object.material.color ? '#' + h.object.material.color.getHexString() : 'vertex',
        op: h.object.material ? (h.object.material.opacity ?? 1) : 1,
        parent: (h.object.parent && (h.object.parent.name || h.object.parent.type)) || '',
      }));
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close(); server.close(); }
