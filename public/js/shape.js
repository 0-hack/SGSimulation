// Simplified outline of Singapore's main island, used to build the 3D landmass
// and to decide which grid cells are buildable land vs. sea.
// Coordinates are normalised: x = west→east (0..1), y = south→north (0..1).
// Traced from Singapore's real silhouette: a lozenge wider E–W than N–S, with a
// pointed western end (Tuas/Jurong), a rounded eastern point (Changi), the city
// bulging south (Marina) and the Johor-Strait coast to the north (the causeway
// at Woodlands being the northernmost point). The coast is notched by several
// estuaries/inlets where the sea slips inland (Jurong, the river mouth, Kallang,
// Serangoon, Sungei Seletar, Kranji) — narrow inward spikes in the polygon.
export const SG_OUTLINE = [
  // --- south coast, west → east (low y); inland = higher y ---
  [0.030, 0.452], [0.052, 0.405], [0.088, 0.368], [0.132, 0.346],
  [0.146, 0.352], [0.158, 0.404], [0.170, 0.356],   // Jurong inlet
  [0.182, 0.352], [0.232, 0.330], [0.292, 0.322], [0.352, 0.316],
  [0.410, 0.300],
  [0.414, 0.300], [0.423, 0.345], [0.432, 0.293],   // Singapore River mouth
  [0.456, 0.288], [0.500, 0.282], [0.546, 0.290], [0.602, 0.305],
  [0.616, 0.310], [0.628, 0.372], [0.640, 0.318],   // Kallang/Geylang inlet
  [0.662, 0.318], [0.722, 0.332], [0.786, 0.350],
  [0.850, 0.378], [0.910, 0.420], [0.955, 0.470],
  // --- north coast (Johor Strait), east → west (high y); inland = lower y ---
  [0.935, 0.520], [0.888, 0.560], [0.834, 0.586], [0.774, 0.602],
  [0.760, 0.596], [0.748, 0.545], [0.736, 0.610],   // Serangoon/Punggol inlet
  [0.714, 0.620], [0.656, 0.636],
  [0.642, 0.628], [0.630, 0.558], [0.618, 0.642],   // Sungei Seletar inlet
  [0.600, 0.658], [0.540, 0.682], [0.480, 0.700], [0.430, 0.690],
  [0.376, 0.668], [0.320, 0.648],
  [0.308, 0.640], [0.296, 0.585], [0.284, 0.628],   // Kranji inlet
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

// Branch geometries are size-independent given GRID_SIZE, so memoise them — they
// are queried once per grid cell (tens of thousands of times) at build time.
let _resCache = null, _resSize = null, _rivCache = null, _rivSize = null;

// Distance test shared by the water bodies: is (x,y) within (local width + margin)
// of any segment of any branch? Branches are polylines of {x, y, w} cell coords.
function nearBranches(x, y, branches, margin) {
  for (const br of branches) {
    for (let i = 0; i < br.length - 1; i++) {
      const a = br[i], b = br[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx, py = a.y + t * dy, w = a.w + (b.w - a.w) * t;
      if (Math.hypot(x - px, y - py) < w + margin) return true;
    }
  }
  return false;
}

// The Central Catchment reservoirs (MacRitchie / Upper & Lower Peirce / Seletar)
// — slim, dendritic water bodies north of the island centre. Each is a set of
// branches (polylines of {x, y (cells), w (half-width cells)}) that fork like
// the real reservoirs, rather than round ponds. Shared by engine + renderer.
export function reservoirArea(size) {
  return { cx: size / 2, cy: size / 2 + size * 0.055, forestR: size * 0.22 };
}
export function reservoirBranches(size) {
  if (_resCache && _resSize === size) return _resCache;
  const k = size / 48;
  const P = (x, y, w) => ({ x: x * k, y: y * k, w: w * k });
  _resCache = [
    // MacRitchie (central) — a forking dendrite
    [P(24.0, 23.5, 0.40), P(24.2, 24.8, 0.55), P(24.0, 26.0, 0.50), P(23.5, 27.0, 0.40)],
    [P(24.0, 26.0, 0.45), P(25.5, 25.8, 0.40), P(26.6, 25.2, 0.30)],
    [P(24.2, 24.8, 0.40), P(22.8, 24.6, 0.34), P(21.8, 24.1, 0.26)],
    // Peirce (north-west) — small dendrite
    [P(22.0, 27.6, 0.34), P(21.0, 28.6, 0.46), P(20.4, 29.6, 0.40), P(20.0, 30.6, 0.28)],
    [P(21.0, 28.6, 0.34), P(19.8, 28.9, 0.30), P(18.9, 29.3, 0.24)],
    // Seletar (north-east) — small dendrite
    [P(25.6, 27.6, 0.34), P(26.6, 28.6, 0.46), P(27.0, 29.9, 0.40), P(27.3, 31.0, 0.28)],
    [P(26.6, 28.6, 0.30), P(27.8, 28.3, 0.30), P(28.6, 27.9, 0.24)],
  ];
  _resSize = size;
  return _resCache;
}
export function inReservoir(x, y, size) {
  return pointInPolygon((x + 0.5) / size, (y + 0.5) / size) && nearBranches(x, y, reservoirBranches(size), 0.3);
}

// The Singapore River: a slim tidal channel winding inland from the south coast
// just west of the colonial city, with a couple of canal tributaries branching
// off. Same {x, y, w} branch format as the reservoirs.
export function riverBranches(size) {
  if (_rivCache && _rivSize === size) return _rivCache;
  const k = size / 48, c = size / 2;
  const P = (xc, y, w) => ({ x: c + xc * k, y: y * k, w: w * k }); // xc relative to centre (cells)
  _rivCache = [
    // main river — winding inland from the mouth/quay basin
    [P(-4.0, 12.2, 0.80), P(-4.4, 15.0, 0.48), P(-5.3, 18.0, 0.38), P(-6.8, 20.0, 0.32), P(-9.0, 21.0, 0.26)],
    // canal tributaries branching off
    [P(-6.8, 20.0, 0.28), P(-7.6, 19.0, 0.22), P(-8.4, 18.2, 0.18)],
    [P(-5.3, 18.0, 0.28), P(-6.1, 16.8, 0.22), P(-6.7, 15.7, 0.18)],
  ];
  _rivSize = size;
  return _rivCache;
}
export function inRiver(x, y, size) {
  return nearBranches(x, y, riverBranches(size), 0.4);
}

