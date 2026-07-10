// Render a wireframe of the baked road graph in a world-box, nodes as dots.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const N = rd.ROAD_NODES_1966, E = rd.ROAD_EDGES_1966;
const [x0, z0, x1, z1] = (process.env.BOX || '-175,110,-140,145').split(',').map(Number);
const OUT = process.env.OUT || '/tmp/wire.png';
const S = 1400;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const p = await browser.newPage(); await p.setViewport({ width: S, height: S });
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const edges = [], nodes = [];
N.forEach((q, i) => { if (q[0] >= x0 - 5 && q[0] <= x1 + 5 && q[1] >= z0 - 5 && q[1] <= z1 + 5) nodes.push([q[0], q[1], i]); });
const inb = new Set(nodes.map((n) => n[2]));
for (const e of E) if (inb.has(e[0]) || inb.has(e[1])) edges.push([N[e[0]], N[e[1]], e[2], e[4]]);
const b64 = await p.evaluate(({ S, x0, z0, x1, z1, edges, nodes }) => {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  ctx.fillStyle = '#11141a'; ctx.fillRect(0, 0, S, S);
  const X = (x) => (x - x0) / (x1 - x0) * S, Y = (z) => (z1 - z) / (z1 - z0) * S;   // z up = north up
  for (const [a, b, ow, dirt] of edges) {
    ctx.strokeStyle = dirt ? '#a97' : ow ? '#7af' : '#ccc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(a[0]), Y(a[1])); ctx.lineTo(X(b[0]), Y(b[1])); ctx.stroke();
  }
  ctx.fillStyle = '#f66';
  for (const [x, z] of nodes) { ctx.beginPath(); ctx.arc(X(x), Y(z), 2.5, 0, 7); ctx.fill(); }
  return cv.toDataURL('image/png');
}, { S, x0, z0, x1, z1, edges, nodes });
writeFileSync(OUT, Buffer.from(b64.split(',')[1], 'base64'));
console.log('saved', OUT, 'nodes', nodes.length, 'edges', edges.length);
await browser.close();
