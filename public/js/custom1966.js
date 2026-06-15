// Player / hand-traced customisations applied at runtime. This is the foundation
// for the in-game tracing system: a single data module the game reads to place
// things the player has drawn, separate from the baked-in 1966 defaults.
//
// All traced via public/trace.html, applied by scripts/apply_trace.mjs.
//   CUSTOM_HOUSES   — free-placed houses. { type, cx, cy, w, h, rot, hgt }
//                     (centre normalised, w/h normalised footprint, rot radians).
//   CUSTOM_RAILWAYS — railway centre-lines. each: [[nx,ny]...] (normalised).
//   CUSTOM_SANDS    — sandy coast sections. each: [[nx,ny]...] (normalised).
export const CUSTOM_HOUSES = [];
export const CUSTOM_RAILWAYS = [];
export const CUSTOM_SANDS = [];

// CUSTOM_LANDMARKS — buildings/landmarks designed in 3D in public/design.html and
// placed on the island. Each: { name, cx, cy, rot, scale, parts:[ {type, x,y,z,
// w,h,d, rot, color} ] }. type = box | cyl | pyramid | dome. cx,cy normalised.
export const CUSTOM_LANDMARKS = [];

// SEED_1965 — the city that ALREADY stood when Singapore became independent on
// 9 Aug 1965, placed on the map as a heritage backdrop (rendered, cells made
// unbuildable, but outside the economy — the player develops AROUND them).
// Positions are normalised (cx eastward, cy southward) georeferenced to the island:
// airport ≈ (0.59,0.52) = Paya Lebar; the civic district sits south-central by the
// Singapore River, Jurong far west, Queenstown west, Toa Payoh central-north.
// `n` places a small cluster (an estate / row), `spread` its radius. Off-land seeds
// snap to the nearest land cell at runtime.
export const SEED_1965 = [
  // ---- Civic & commercial heart (City Hall / Padang / Singapore River) ----
  { key: 'colonial',     cx: 0.452, cy: 0.620, name: 'Parliament House & City Hall' },
  { key: 'police',       cx: 0.438, cy: 0.628, name: 'Hill Street Police Station' },
  { key: 'fire_station', cx: 0.459, cy: 0.613, name: 'Central Fire Station' },
  { key: 'hospital',     cx: 0.420, cy: 0.636, name: 'Singapore General Hospital' },
  { key: 'clinic',       cx: 0.452, cy: 0.596, name: 'Kandang Kerbau Hospital' },
  { key: 'cinema',       cx: 0.435, cy: 0.607, name: 'Cathay Cinema' },
  { key: 'shophouse',    cx: 0.462, cy: 0.631, n: 3, spread: 0.012, name: 'Raffles Place & Boat Quay' },
  { key: 'market',       cx: 0.430, cy: 0.621, name: 'Telok Ayer Market' },
  { key: 'godown',       cx: 0.446, cy: 0.641, name: 'Singapore River godowns' },
  { key: 'stadium',      cx: 0.482, cy: 0.594, name: 'Jalan Besar Stadium' },
  // ---- Housing ----
  { key: 'hdb_flat',     cx: 0.350, cy: 0.616, n: 4, spread: 0.02, name: 'Queenstown estate' },
  { key: 'hdb_flat',     cx: 0.448, cy: 0.556, n: 4, spread: 0.02, name: 'Toa Payoh New Town' },
  { key: 'shophouse',    cx: 0.414, cy: 0.627, n: 2, spread: 0.012, name: 'Tiong Bahru SIT flats' },
  // ---- Port, industry & power ----
  { key: 'port',         cx: 0.408, cy: 0.654, name: 'Keppel Harbour' },
  { key: 'factory',      cx: 0.150, cy: 0.578, n: 2, spread: 0.022, name: 'Jurong Industrial Estate' },
  { key: 'power_station', cx: 0.278, cy: 0.632, name: 'Pasir Panjang Power Station' },
  // ---- Education & green ----
  { key: 'tech_school',  cx: 0.372, cy: 0.582, name: 'University of Singapore (Bukit Timah)' },
  { key: 'park',         cx: 0.378, cy: 0.600, name: 'Botanic Gardens' },
  // ---- Kampongs (most Singaporeans still lived in villages) ----
  { key: 'kampong',      cx: 0.330, cy: 0.500, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.555, cy: 0.475, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.500, cy: 0.660, n: 2, spread: 0.03 },
];
