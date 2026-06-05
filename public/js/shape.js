// Simplified outline of Singapore's main island, used to build the 3D landmass
// and to decide which grid cells are buildable land vs. sea.
// Coordinates are normalised: x = west→east (0..1), y = south→north (0..1).
// Traced from Singapore's real silhouette: a lozenge wider E–W than N–S, with a
// pointed western end (Tuas/Jurong), a rounded eastern point (Changi), the city
// bulging south (Marina) and the Johor-Strait coast to the north (the causeway
// at Woodlands being the northernmost point).
export const SG_OUTLINE = [
  // --- south coast, west → east (low y) ---
  [0.030, 0.452], [0.052, 0.405], [0.088, 0.368], [0.132, 0.346],
  [0.182, 0.352], [0.232, 0.330], [0.292, 0.322], [0.352, 0.316],
  [0.410, 0.300], [0.456, 0.288], [0.500, 0.282], [0.546, 0.290],
  [0.602, 0.305], [0.662, 0.318], [0.722, 0.332], [0.786, 0.350],
  [0.850, 0.378], [0.910, 0.420], [0.955, 0.470],
  // --- north coast (Johor Strait), east → west (high y) ---
  [0.935, 0.520], [0.888, 0.560], [0.834, 0.586], [0.774, 0.602],
  [0.714, 0.620], [0.656, 0.636], [0.600, 0.658], [0.540, 0.682],
  [0.480, 0.700], [0.430, 0.690], [0.376, 0.668], [0.320, 0.648],
  [0.255, 0.612], [0.190, 0.564], [0.110, 0.512],
];

// Smaller outlying islands around the main island — decorative only (not
// buildable). Sentosa & the southern isles off the south coast; Ubin & Tekong
// off the north-east. Each is a small normalised polygon.
export const SG_ISLANDS = [
  // Sentosa (elongated, just south of Keppel)
  [[0.372, 0.236], [0.402, 0.246], [0.442, 0.244], [0.470, 0.234], [0.456, 0.220], [0.410, 0.215], [0.380, 0.222]],
  // St John's / Lazarus group
  [[0.452, 0.166], [0.474, 0.171], [0.483, 0.158], [0.468, 0.150], [0.452, 0.156]],
  // Kusu (tiny)
  [[0.418, 0.182], [0.432, 0.186], [0.437, 0.175], [0.423, 0.171]],
  // Pulau Ubin (north-east)
  [[0.758, 0.748], [0.808, 0.755], [0.850, 0.750], [0.836, 0.736], [0.786, 0.734]],
  // Pulau Tekong (north-east)
  [[0.878, 0.742], [0.920, 0.750], [0.946, 0.736], [0.926, 0.720], [0.888, 0.726]],
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

// The Central Catchment reservoirs (MacRitchie / Upper & Lower Peirce / Seletar)
// — a protected water body north of the island centre. Modelled as several
// overlapping lobes so it reads as a branching reservoir, not a round pond.
// Shared by engine + renderer.
export function reservoirArea(size) {
  const cx = size / 2, cy = size / 2 + size * 0.055;
  const lobes = [
    [0.000, 0.000, 0.060],   // MacRitchie (central)
    [-0.075, 0.045, 0.045],  // Upper Peirce (north-west arm)
    [0.015, 0.078, 0.050],   // Lower Peirce / Seletar (north arm)
    [0.078, 0.012, 0.042],   // eastern arm
    [-0.118, -0.004, 0.038], // western arm
    [0.046, -0.055, 0.034],  // southern finger
  ].map(([dx, dy, r]) => ({ x: cx + dx * size, y: cy + dy * size, r: r * size }));
  return { cx, cy, forestR: size * 0.22, lobes };
}
export function inReservoir(x, y, size) {
  if (!pointInPolygon((x + 0.5) / size, (y + 0.5) / size)) return false;
  for (const l of reservoirArea(size).lobes) if (Math.hypot(x - l.x, y - l.y) < l.r) return true;
  return false;
}

// The Singapore River: a tidal channel winding inland from the south coast,
// just west of the colonial city. A polyline of {x, y (cell coords), w (half-
// width in cells)} that tapers from a wide mouth/basin to a narrow inland reach.
export function riverPath(size) {
  const c = size / 2, k = size / 48;
  return [
    { x: c - 4.0 * k, y: 12.0 * k, w: 2.0 * k },   // mouth / boat quay basin (opens to the sea)
    { x: c - 4.5 * k, y: 15.0 * k, w: 1.3 * k },
    { x: c - 5.5 * k, y: 18.0 * k, w: 1.1 * k },
    { x: c - 7.0 * k, y: 20.0 * k, w: 1.0 * k },
    { x: c - 9.0 * k, y: 21.0 * k, w: 0.9 * k },    // narrow inland reach (Robertson Quay)
  ];
}
export function inRiver(x, y, size) {
  const pts = riverPath(size);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx, py = a.y + t * dy, w = a.w + (b.w - a.w) * t;
    if (Math.hypot(x - px, y - py) < w) return true;
  }
  return false;
}

