// Outline of Singapore's main island, traced from the historical survey map by
// land/sea pixel classification + contour tracing (Johor across the strait and
// the legend removed). Used to build the 3D landmass and decide buildable cells.
// Normalised: x = west→east (0..1), y = south→north (0..1).
// SG_ISLANDS are the surrounding islands (Sentosa & the southern isles, Pulau
// Ubin, Pulau Tekong, the western/Jurong isles) — decorative only.
export const SG_OUTLINE = [
  [0.404, 0.706], [0.418, 0.704], [0.424, 0.692], [0.43, 0.698], [0.454, 0.692], [0.481, 0.674], 
  [0.489, 0.658], [0.489, 0.648], [0.506, 0.632], [0.506, 0.624], [0.496, 0.613], [0.503, 0.617], 
  [0.526, 0.613], [0.535, 0.599], [0.567, 0.591], [0.564, 0.577], [0.577, 0.576], [0.581, 0.599], 
  [0.592, 0.607], [0.6, 0.607], [0.609, 0.583], [0.623, 0.565], [0.623, 0.553], [0.647, 0.547], 
  [0.648, 0.542], [0.657, 0.542], [0.69, 0.525], [0.701, 0.525], [0.731, 0.549], [0.758, 0.551], 
  [0.775, 0.546], [0.78, 0.537], [0.78, 0.514], [0.765, 0.513], [0.752, 0.438], [0.737, 0.426], 
  [0.734, 0.409], [0.722, 0.404], [0.718, 0.397], [0.693, 0.394], [0.668, 0.383], [0.589, 0.366], 
  [0.567, 0.352], [0.526, 0.355], [0.518, 0.369], [0.507, 0.366], [0.5, 0.358], [0.49, 0.357], 
  [0.489, 0.341], [0.485, 0.333], [0.478, 0.331], [0.48, 0.312], [0.475, 0.302], [0.47, 0.301], 
  [0.47, 0.29], [0.458, 0.291], [0.456, 0.297], [0.441, 0.297], [0.432, 0.289], [0.404, 0.289], 
  [0.403, 0.293], [0.383, 0.29], [0.342, 0.316], [0.33, 0.333], [0.308, 0.343], [0.29, 0.363], 
  [0.25, 0.364], [0.233, 0.378], [0.232, 0.388], [0.226, 0.371], [0.201, 0.38], [0.192, 0.365], 
  [0.182, 0.365], [0.176, 0.373], [0.165, 0.372], [0.163, 0.364], [0.144, 0.367], [0.142, 0.362], 
  [0.133, 0.362], [0.129, 0.365], [0.119, 0.355], [0.1, 0.354], [0.091, 0.368], [0.09, 0.388], 
  [0.079, 0.396], [0.062, 0.397], [0.052, 0.413], [0.05, 0.438], [0.058, 0.44], [0.053, 0.456], 
  [0.064, 0.457], [0.057, 0.465], [0.058, 0.478], [0.075, 0.496], [0.076, 0.512], [0.085, 0.513], 
  [0.086, 0.522], [0.105, 0.521], [0.111, 0.512], [0.117, 0.513], [0.117, 0.52], [0.137, 0.519], 
  [0.134, 0.526], [0.124, 0.525], [0.12, 0.531], [0.111, 0.531], [0.11, 0.525], [0.093, 0.527], 
  [0.097, 0.546], [0.101, 0.547], [0.101, 0.574], [0.106, 0.581], [0.118, 0.583], [0.125, 0.613], 
  [0.132, 0.622], [0.15, 0.617], [0.151, 0.627], [0.172, 0.637], [0.179, 0.637], [0.182, 0.633], 
  [0.188, 0.654], [0.2, 0.661], [0.22, 0.663], [0.226, 0.647], [0.244, 0.652], [0.245, 0.641], 
  [0.25, 0.637], [0.246, 0.626], [0.258, 0.622], [0.258, 0.614], [0.239, 0.614], [0.238, 0.606], 
  [0.219, 0.609], [0.215, 0.606], [0.215, 0.594], [0.206, 0.594], [0.204, 0.588], [0.211, 0.587], 
  [0.214, 0.582], [0.229, 0.583], [0.228, 0.563], [0.241, 0.562], [0.243, 0.536], [0.248, 0.535], 
  [0.249, 0.558], [0.235, 0.576], [0.235, 0.586], [0.248, 0.595], [0.26, 0.596], [0.266, 0.619], 
  [0.277, 0.622], [0.27, 0.625], [0.27, 0.64], [0.293, 0.645], [0.311, 0.655], [0.315, 0.663], 
  [0.336, 0.671], [0.379, 0.702]
];

export const SG_ISLANDS = [
  [
    [0.86, 0.628], [0.87, 0.623], [0.889, 0.624], [0.892, 0.627], [0.9, 0.625], [0.921, 0.616], 
    [0.942, 0.599], [0.95, 0.583], [0.948, 0.563], [0.943, 0.548], [0.936, 0.549], [0.934, 0.547], 
    [0.93, 0.547], [0.924, 0.554], [0.919, 0.554], [0.908, 0.548], [0.895, 0.549], [0.882, 0.538], 
    [0.878, 0.538], [0.876, 0.53], [0.872, 0.529], [0.858, 0.55], [0.854, 0.552], [0.848, 0.56], 
    [0.835, 0.566], [0.831, 0.577], [0.836, 0.586], [0.834, 0.588], [0.829, 0.586], [0.821, 0.573], 
    [0.814, 0.574], [0.813, 0.581], [0.807, 0.593], [0.807, 0.599], [0.811, 0.609], [0.818, 0.612], 
    [0.821, 0.607], [0.828, 0.604], [0.832, 0.597], [0.832, 0.589], [0.834, 0.588], [0.838, 0.592], 
    [0.833, 0.608], [0.833, 0.615], [0.845, 0.615], [0.846, 0.618], [0.852, 0.618]
  ],
  [
    [0.644, 0.62], [0.666, 0.613], [0.686, 0.601], [0.689, 0.603], [0.694, 0.6], [0.708, 0.601], 
    [0.722, 0.604], [0.724, 0.601], [0.756, 0.601], [0.757, 0.599], [0.759, 0.601], [0.771, 0.589], 
    [0.771, 0.586], [0.766, 0.585], [0.764, 0.576], [0.753, 0.575], [0.759, 0.574], [0.759, 0.568], 
    [0.748, 0.568], [0.748, 0.572], [0.754, 0.569], [0.757, 0.571], [0.75, 0.575], [0.742, 0.574], 
    [0.734, 0.576], [0.734, 0.574], [0.729, 0.574], [0.728, 0.57], [0.721, 0.565], [0.689, 0.561], 
    [0.692, 0.564], [0.685, 0.572], [0.679, 0.574], [0.687, 0.561], [0.684, 0.559], [0.662, 0.574], 
    [0.661, 0.581], [0.672, 0.578], [0.673, 0.582], [0.639, 0.596], [0.629, 0.607], [0.627, 0.611]
  ],
  [
    [0.448, 0.296], [0.452, 0.296], [0.458, 0.29], [0.452, 0.29], [0.455, 0.287], [0.452, 0.287], 
    [0.452, 0.282], [0.456, 0.281], [0.453, 0.279], [0.455, 0.274], [0.452, 0.273], [0.456, 0.272], 
    [0.445, 0.272], [0.447, 0.273], [0.443, 0.276], [0.439, 0.275], [0.443, 0.272], [0.398, 0.272], 
    [0.389, 0.281], [0.391, 0.285], [0.405, 0.281], [0.426, 0.282], [0.435, 0.29], [0.443, 0.29], 
    [0.451, 0.283], [0.452, 0.288], [0.451, 0.293], [0.438, 0.292]
  ],
  [
    [0.762, 0.308], [0.765, 0.308], [0.764, 0.304], [0.752, 0.301], [0.733, 0.298], [0.716, 0.299], 
    [0.702, 0.29], [0.677, 0.287], [0.648, 0.273], [0.632, 0.272], [0.654, 0.277], [0.672, 0.288], 
    [0.695, 0.29], [0.714, 0.3], [0.747, 0.302]
  ],
  [
    [0.128, 0.342], [0.142, 0.349], [0.155, 0.346], [0.152, 0.336], [0.138, 0.334]
  ],
  [
    [0.165, 0.348], [0.182, 0.35], [0.192, 0.344], [0.186, 0.336], [0.17, 0.338]
  ],
  [
    [0.198, 0.336], [0.22, 0.34], [0.236, 0.333], [0.23, 0.325], [0.21, 0.326], [0.196, 0.328]
  ],
  [
    [0.244, 0.33], [0.257, 0.333], [0.262, 0.325], [0.25, 0.322]
  ],
  [
    [0.162, 0.296], [0.184, 0.3], [0.197, 0.292], [0.188, 0.283], [0.168, 0.285]
  ],
  [
    [0.128, 0.286], [0.143, 0.29], [0.149, 0.282], [0.136, 0.279]
  ],
  [
    [0.22, 0.292], [0.235, 0.295], [0.24, 0.287], [0.226, 0.284]
  ],
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
    // main river — mouth sits AT the south coast (north of Sentosa) and winds
    // inland, so it flows from the sea instead of floating over the island
    [P(-4.2, 14.8, 0.55), P(-4.6, 16.6, 0.45), P(-5.4, 18.6, 0.38), P(-6.8, 20.2, 0.32), P(-9.0, 21.2, 0.26)],
    // canal tributaries branching off
    [P(-6.8, 20.2, 0.28), P(-7.6, 19.2, 0.22), P(-8.4, 18.4, 0.18)],
    [P(-5.4, 18.6, 0.28), P(-6.2, 17.4, 0.22), P(-6.8, 16.3, 0.18)],
  ];
  _rivSize = size;
  return _rivCache;
}
export function inRiver(x, y, size) {
  return nearBranches(x, y, riverBranches(size), 0.4);
}

