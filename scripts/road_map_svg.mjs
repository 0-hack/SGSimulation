// Emit a clean top-down SVG of the traced road network the game uses, with the
// coastline + reservoirs for reference (north up, east right).
import { ROAD_NODES_1966, ROAD_EDGES_1966, RESERVOIRS_1966 } from '../public/js/roads1966.js';
import { SG_OUTLINE, SG_ISLANDS } from '../public/js/shape.js';
import { writeFileSync } from 'node:fs';

const WORLD = 1600;
const nw = (nx, ny) => [ (nx - 0.5) * WORLD, (0.5 - ny) * WORLD ];   // -> [X, Y] north-up
const polyPath = (poly) => poly.map(([nx, ny], i) => { const [x, y] = nw(nx, ny); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ') + ' Z';

// bounds from the land outline (+ a margin)
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
for (const [nx, ny] of SG_OUTLINE) { const [x, y] = nw(nx, ny); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const pad = 40; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
const W = maxX - minX, H = maxY - minY;

const land = `<path d="${polyPath(SG_OUTLINE)}" fill="#e9e4d3" stroke="#cbb98c" stroke-width="2"/>`
  + SG_ISLANDS.map((p) => `<path d="${polyPath(p)}" fill="#e9e4d3" stroke="#cbb98c" stroke-width="1.5"/>`).join('');
const water = RESERVOIRS_1966.map((p) => `<path d="${polyPath(p)}" fill="#a9d3ea" stroke="#7fb6d6" stroke-width="1"/>`).join('');

// airport runway reference (from scene3d AIRPORT endpoints)
const [ax0, ay0] = nw(0.565, 0.413), [ax1, ay1] = nw(0.597, 0.525);
const runway = `<line x1="${ax0.toFixed(1)}" y1="${ay0.toFixed(1)}" x2="${ax1.toFixed(1)}" y2="${ay1.toFixed(1)}" stroke="#888" stroke-width="6" stroke-linecap="round" opacity="0.7"/>`;

let roads = '';
for (const [a, b] of ROAD_EDGES_1966) {
  const A = ROAD_NODES_1966[a], B = ROAD_NODES_1966[b];
  if (!A || !B) continue;
  roads += `M${A[0].toFixed(1)} ${A[1].toFixed(1)}L${B[0].toFixed(1)} ${B[1].toFixed(1)}`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${W.toFixed(1)} ${H.toFixed(1)}" width="${Math.round(W)}" height="${Math.round(H)}">
<rect x="${minX.toFixed(1)}" y="${minY.toFixed(1)}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#cfe6f2"/>
${land}
${water}
${runway}
<path d="${roads}" fill="none" stroke="#1c1c22" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${(minX+10).toFixed(1)}" y="${(minY+26).toFixed(1)}" font-family="sans-serif" font-size="22" fill="#333">1966 traced road network — ${ROAD_EDGES_1966.length} edges / ${ROAD_NODES_1966.length} nodes (grey = airport runway)</text>
</svg>`;
writeFileSync(new URL('../scripts/road_map.svg', import.meta.url), svg);
console.log('wrote scripts/road_map.svg', Math.round(W) + 'x' + Math.round(H), 'edges', ROAD_EDGES_1966.length);
