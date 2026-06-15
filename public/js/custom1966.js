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
// 9 Aug 1965, placed on the map as a heritage backdrop AND wired into the economy
// (the engine seeds these into state.grid, so they house people, employ workers and
// supply power/water/services from day one — the player develops AROUND and BEYOND
// them). Positions are normalised (cx eastward, cy southward) georeferenced to the
// island: airport ≈ (0.59,0.52) = Paya Lebar; the civic district sits south-central
// by the Singapore River, Jurong far west, Queenstown west, Toa Payoh central-north.
// `n` places a small cluster (an estate / row), `spread` its radius — the cluster
// counts set each district's real-life FOOTPRINT relative to the island (a compact
// colonial core, a sprawl of kampongs, a few new HDB estates, the big Jurong/Keppel
// works). Off-land seeds snap to the nearest land cell at runtime.
export const SEED_1965 = [
  // ---- Civic & administrative heart (City Hall / Padang / Hill Street) ----
  { key: 'colonial',     cx: 0.455, cy: 0.622, name: 'Parliament House & City Hall' },
  { key: 'police',       cx: 0.448, cy: 0.623, name: 'Hill Street Police Station' },
  { key: 'fire_station', cx: 0.451, cy: 0.616, name: 'Central Fire Station' },
  { key: 'hospital',     cx: 0.421, cy: 0.636, name: 'Singapore General Hospital' },
  { key: 'clinic',       cx: 0.455, cy: 0.593, name: 'Kandang Kerbau Hospital' },
  { key: 'cinema',       cx: 0.439, cy: 0.608, name: 'Cathay Cinema' },
  { key: 'community_centre', cx: 0.470, cy: 0.602, name: 'People’s Association centre' },
  { key: 'stadium',      cx: 0.478, cy: 0.593, name: 'Jalan Besar Stadium' },
  // ---- The busy commercial town: Raffles Place, Collyer Quay, Boat Quay &
  //      Chinatown were packed with shophouses, trading firms and hawkers ----
  { key: 'shophouse',    cx: 0.458, cy: 0.629, n: 4, spread: 0.011, name: 'Raffles Place & Boat Quay' },
  { key: 'shophouse',    cx: 0.464, cy: 0.634, n: 4, spread: 0.010, name: 'Collyer Quay' },
  { key: 'shophouse',    cx: 0.442, cy: 0.633, n: 5, spread: 0.013, name: 'Chinatown (Kreta Ayer)' },
  { key: 'market',       cx: 0.450, cy: 0.633, name: 'Telok Ayer Market' },
  { key: 'godown',       cx: 0.446, cy: 0.643, n: 2, spread: 0.012, name: 'Singapore River godowns' },
  // ---- Public housing: the real early HDB/SIT estates standing by 1965
  //      (~54,000 flats had been built). Most of the rest still lived in kampongs ----
  { key: 'hdb_flat',     cx: 0.343, cy: 0.620, n: 4, spread: 0.020, name: 'Queenstown (incl. Tanglin Halt)' },
  { key: 'hdb_flat',     cx: 0.418, cy: 0.622, n: 2, spread: 0.014, name: 'Bukit Ho Swee estate' },
  { key: 'hdb_flat',     cx: 0.472, cy: 0.575, n: 2, spread: 0.016, name: 'St Michael’s / Kallang estate' },
  { key: 'hdb_flat',     cx: 0.533, cy: 0.572, n: 2, spread: 0.016, name: 'MacPherson estate' },
  { key: 'hdb_flat',     cx: 0.453, cy: 0.557, n: 2, spread: 0.018, name: 'Toa Payoh New Town (rising)' },
  { key: 'shophouse',    cx: 0.410, cy: 0.627, n: 2, spread: 0.012, name: 'Tiong Bahru SIT flats' },
  { key: 'school',       cx: 0.356, cy: 0.611, name: 'Queenstown Secondary School' },
  // ---- Port, industry & power ----
  { key: 'port',         cx: 0.410, cy: 0.651, name: 'Keppel Harbour' },
  { key: 'factory',      cx: 0.142, cy: 0.578, n: 2, spread: 0.022, name: 'Jurong Industrial Estate' },
  { key: 'processing',   cx: 0.168, cy: 0.566, name: 'Jurong rubber & tin works' },
  { key: 'power_station', cx: 0.318, cy: 0.642, name: 'Pasir Panjang Power Station' },
  { key: 'diesel',       cx: 0.430, cy: 0.648, name: 'St James Power Station' },
  // ---- Water & sanitation (the young republic's public works) ----
  { key: 'standpipe',    cx: 0.438, cy: 0.611, name: 'City water mains' },
  { key: 'standpipe',    cx: 0.349, cy: 0.616, name: 'Queenstown water mains' },
  { key: 'standpipe',    cx: 0.452, cy: 0.562, name: 'Toa Payoh water mains' },
  { key: 'reservoir',    cx: 0.470, cy: 0.500, name: 'Seletar Reservoir' },
  { key: 'sewage',       cx: 0.428, cy: 0.646, name: 'Singapore River sewerage works' },
  // ---- Education & green ----
  { key: 'tech_school',  cx: 0.365, cy: 0.580, name: 'University of Singapore (Bukit Timah)' },
  { key: 'park',         cx: 0.376, cy: 0.589, name: 'Botanic Gardens' },
  // ---- Kampongs (in 1965 about a third of Singaporeans still lived in villages) ----
  { key: 'kampong',      cx: 0.330, cy: 0.500, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.555, cy: 0.475, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.500, cy: 0.660, n: 2, spread: 0.03 },
  { key: 'kampong',      cx: 0.620, cy: 0.560, n: 2, spread: 0.035, name: 'Geylang Serai kampong' },
  { key: 'kampong',      cx: 0.255, cy: 0.560, n: 2, spread: 0.035 },
];
