// Remove stray road chains that lie over OPEN WATER (a displaced legacy sketch left
// chains sprawling across the harbour and the western straits). Conservative:
//  - a chain is deleted only if >=90% of its nodes sit on open-sea map colour, AND
//  - it is NOT a land-to-land span (both endpoints on land => a bridge/causeway kept)
// Real coastal and island roads run on land (their nodes sample land, not water), so
// they score low and are kept. No geometry moves; only whole stray chains are removed.
// --write rewrites roads1966.js (with a heal pass so nothing is left dangling).
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { reconnectGraph, mergeComponents } from '../../scripts/reconnect_roads.mjs';
const roadsURL = new URL('../../public/js/roads1966.js', import.meta.url);
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
let N = rd.ROAD_NODES_1966.map((q) => q.slice()), E = rd.ROAD_EDGES_1966.map((e) => [e[0], e[1], e[2] ? 1 : 0, e[3] || 2, e[4] ? 1 : 0]);
const toN = ([x, z]) => [x / 1600 + 0.5, 0.5 - z / 1600];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'], protocolTimeout: 600000 });
const p = await browser.newPage();
// per-node "water" flag: majority of a small disc is open-sea colour (not just the
// exact pixel, so a road drawn 1px into the hatching still reads as its true surface)
const waterOf = await p.evaluate(async ({ mapB64, bg, pts }) => {
  const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
  await new Promise((r) => { img.onload = r; });
  const W = img.naturalWidth >> 1, H = img.naturalHeight >> 1;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const wet = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    return r >= 110 && r <= 195 && g - r >= 12 && b - r >= 12; };
  const toPix = (nx, ny) => [Math.round((nx - bg.gxL) / (bg.gxR - bg.gxL) * W), Math.round((ny - (1 - bg.gyT)) / (bg.gyT - bg.gyB) * H)];
  return pts.map(([nx, ny]) => { const [x, y] = toPix(nx, ny); let n = 0, t = 0;
    for (let dy = -3; dy <= 3; dy += 2) for (let dx = -3; dx <= 3; dx += 2) { t++; if (wet(x + dx, y + dy)) n++; } return n / t >= 0.6 ? 1 : 0; });
}, { mapB64, bg, pts: N.map(toN) });
await browser.close();

// walk chains
const adj = new Map();
E.forEach((e, i) => { (adj.get(e[0]) || adj.set(e[0], []).get(e[0])).push({ n: e[1], i }); (adj.get(e[1]) || adj.set(e[1], []).get(e[1])).push({ n: e[0], i }); });
const deg = (n) => (adj.get(n) || []).length;
const usedC = new Set(), flagsOf = (i) => E[i][2] * 2 + E[i][4];
const walk = (from, first) => { const segs = [first.i], nodes = [from, first.n]; let cur = first.n; usedC.add(first.i);
  while (deg(cur) === 2) { const nb = (adj.get(cur) || []).find((x) => !usedC.has(x.i) && flagsOf(x.i) === flagsOf(first.i)); if (!nb) break; usedC.add(nb.i); segs.push(nb.i); nodes.push(nb.n); cur = nb.n; } return { segs, nodes }; };
const chainsE = [];
for (const [n, list] of adj) { if (deg(n) === 2) continue; for (const l of list) { if (usedC.has(l.i)) continue; chainsE.push(walk(n, l)); } }
for (let i = 0; i < E.length; i++) if (!usedC.has(i)) chainsE.push(walk(E[i][0], { n: E[i][1], i }));

const dropEdge = new Set();
let seaChains = 0, seaLen = 0;
for (const ch of chainsE) {
  const nn = ch.nodes.length; if (nn < 2) continue;
  const wet = ch.nodes.filter((id) => waterOf[id]).length;
  const endsOnLand = !waterOf[ch.nodes[0]] && !waterOf[ch.nodes[nn - 1]];
  if (wet / nn >= 0.9 && !endsOnLand) {
    seaChains++; for (const i of ch.segs) { dropEdge.add(i); const e = E[i]; seaLen += Math.hypot(N[e[0]][0] - N[e[1]][0], N[e[0]][1] - N[e[1]][1]); }
  }
}
console.log('stray sea chains:', seaChains, '| edges', dropEdge.size, '| total length', seaLen.toFixed(0) + 'u');

if (process.argv.includes('--write')) {
  E = E.filter((_, i) => !dropEdge.has(i));
  const usedN = new Set(); for (const e of E) { usedN.add(e[0]); usedN.add(e[1]); }
  const remap = new Map(), NN = [];
  for (const id of usedN) { remap.set(id, NN.length); NN.push(N[id]); }
  N = NN; E = E.map((e) => [remap.get(e[0]), remap.get(e[1]), e[2], e[3], e[4]]);
  const healed = reconnectGraph(N, E); N = healed.nodes; E = healed.edges;
  mergeComponents(N, E);
  const r1 = (v) => Math.round(v * 10) / 10;
  const emitN = 'export const ROAD_NODES_1966 = [' + N.map((q) => `[${r1(q[0])},${r1(q[1])}]`).join(', ') + '];';
  const emitE = 'export const ROAD_EDGES_1966 = [' + E.map((e) => e[4] ? `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2},1]` : (e[2] || (e[3] && e[3] !== 2)) ? `[${e[0]},${e[1]},${e[2] ? 1 : 0},${e[3] || 2}]` : `[${e[0]},${e[1]}]`).join(',') + '];';
  let s = readFileSync(roadsURL, 'utf8')
    .replace(/export const ROAD_NODES_1966 = \[[\s\S]*?\];/, () => emitN)
    .replace(/export const ROAD_EDGES_1966 = \[[\s\S]*?\];/, () => emitE);
  writeFileSync(roadsURL, s);
  console.log('rewrote roads1966.js: nodes', N.length, 'edges', E.length);
}
