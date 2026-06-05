// Simplified outline of Singapore's main island, used to build the 3D landmass
// and to decide which grid cells are buildable land vs. sea.
// Coordinates are normalised: x = west→east (0..1), y = south→north (0..1).
export const SG_OUTLINE = [
  // --- north coast (Johor Strait side), west → east ---
  [0.030, 0.500], [0.085, 0.590], [0.150, 0.640], [0.210, 0.628],
  [0.275, 0.690], [0.340, 0.700], [0.405, 0.735], [0.470, 0.720],
  [0.535, 0.742], [0.605, 0.712], [0.675, 0.735], [0.745, 0.700],
  [0.815, 0.672], [0.885, 0.605], [0.955, 0.520],
  // --- east tip (Changi) wraps to south coast, east → west ---
  [0.930, 0.452], [0.860, 0.420], [0.788, 0.438], [0.712, 0.398],
  [0.640, 0.360], [0.560, 0.318], [0.498, 0.292], [0.452, 0.300],
  [0.400, 0.340], [0.330, 0.352], [0.255, 0.372], [0.175, 0.402],
  [0.095, 0.452],
];

// Ray-casting point-in-polygon test.
export function pointInPolygon(x, y, poly = SG_OUTLINE) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance (normalised) from a point to the nearest polygon edge — used to
// give the coastline a softer beach/shallows band.
export function distanceToEdge(x, y, poly = SG_OUTLINE) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < min) min = d;
  }
  return min;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Precompute, for a square grid of `size`, which cells fall on land.
export function landMask(size) {
  const mask = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      row.push(pointInPolygon(nx, ny));
    }
    mask.push(row);
  }
  return mask;
}
