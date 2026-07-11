// Contact sheet: the survey map under the baked roads at each ROUNDABOUTS_1966 site.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { graphToTrace } from '../../scripts/apply_trace.mjs';
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const baked = graphToTrace(rd.ROAD_NODES_1966, rd.ROAD_EDGES_1966).roads.map(r => ({ pts: r.pts, ow: r.ow }));
const rounds = rd.ROUNDABOUTS_1966;
const traceData = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8'));
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const TILE = 420, COLS = 4, ROWS = Math.ceil(rounds.length / COLS), S = TILE * COLS, H = TILE * ROWS;
const HALF = 16;   // world units half-box per tile
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const p = await browser.newPage(); await p.setViewport({ width: S, height: H });
await p.setContent(`<canvas id=c width=${S} height=${H}></canvas>`);
const b64 = await p.evaluate(async ({ S, H, TILE, COLS, HALF, bg, mapB64, baked, rounds }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, H);
  rounds.forEach(([wx, wz, wr], i) => {
    const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
    const nx0 = (wx - HALF) / 1600 + 0.5, nx1 = (wx + HALF) / 1600 + 0.5;
    const nyT = 0.5 - (wz + HALF) / 1600, nyB = 0.5 - (wz - HALF) / 1600;   // ny grows south
    const sx = TILE / (nx1 - nx0), sy = TILE / (nyB - nyT);
    const X = (nx) => ox + (nx - nx0) * sx, Y = (ny) => oy + (ny - nyT) * sy;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, TILE, TILE); ctx.clip();
    // survey map: bg gives the image's placement in tracer coords (y-up)
    const gx0 = X(bg.gxL), gy0 = Y(1 - bg.gyT);
    ctx.drawImage(img, gx0, gy0, (bg.gxR - bg.gxL) * sx, (bg.gyT - bg.gyB) * sy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.85;
    for (const r of baked) { ctx.strokeStyle = r.ow ? '#08c' : '#0a0'; ctx.lineWidth = 2;
      ctx.beginPath(); r.pts.forEach(([nx, ny], k) => { const px = X(nx), py = Y(ny); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // the ring circle marker
    ctx.strokeStyle = '#f0f'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(X(wx / 1600 + 0.5), Y(0.5 - wz / 1600), wr / 1600 * sx, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif';
    ctx.fillText('#' + i + ' [' + wx + ',' + wz + ']', ox + 8, oy + 20);
    ctx.restore();
    ctx.strokeStyle = '#444'; ctx.strokeRect(ox, oy, TILE, TILE);
  });
  return cv.toDataURL('image/png');
}, { S, H, TILE, COLS, HALF, bg: traceData.bg, mapB64, baked, rounds });
writeFileSync(process.env.OUT || '/tmp/ringaudit.png', Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', process.env.OUT, rounds.length, 'sites');
await browser.close();
