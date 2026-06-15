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
// them). Positions are normalised and georeferenced to the rendered island, where
// cx runs WEST→EAST (0→1) and cy runs SOUTH→NORTH (0→1): the south coast / city
// waterfront is LOW cy, the Johor side is HIGH cy. Anchor: airport ≈ (0.59,0.52) =
// Paya Lebar (east, just north of the city). The civic & commercial heart and the
// port sit on the SOUTH coast by the Singapore River; Jurong is far west, Queenstown
// the south-west, Toa Payoh/Kallang to the north. `n` places a small cluster (an
// estate / row), `spread` its radius — the cluster counts set each district's
// real-life FOOTPRINT. Off-land seeds snap to the nearest land cell at runtime.
export const SEED_1965 = [
  // ---- The dense commercial town crammed onto the south WATERFRONT: Collyer
  //      Quay, Raffles Place, Boat Quay, Telok Ayer & Chinatown were a tight black
  //      mass of shophouses, trading firms and hawkers right at the shoreline
  //      (the coast here is cy≈0.31–0.36). Packed tight & small, hugging the sea. ----
  { key: 'godown',       cx: 0.450, cy: 0.335, n: 2, spread: 0.009, name: 'Singapore River godowns' },
  { key: 'shophouse',    cx: 0.462, cy: 0.350, n: 5, spread: 0.009, name: 'Collyer Quay' },
  { key: 'shophouse',    cx: 0.450, cy: 0.356, n: 5, spread: 0.009, name: 'Raffles Place & Boat Quay' },
  { key: 'shophouse',    cx: 0.434, cy: 0.354, n: 6, spread: 0.011, name: 'Chinatown (Kreta Ayer)' },
  { key: 'shophouse',    cx: 0.421, cy: 0.348, n: 3, spread: 0.010, name: 'Tanjong Pagar' },
  { key: 'market',       cx: 0.446, cy: 0.348, name: 'Telok Ayer Market' },
  // ---- Port & dockyards lining Keppel Harbour, plus the coastal power stations ----
  { key: 'port',         cx: 0.414, cy: 0.332, name: 'Keppel Harbour' },
  { key: 'diesel',       cx: 0.432, cy: 0.337, name: 'St James Power Station' },
  { key: 'power_station', cx: 0.314, cy: 0.300, name: 'Pasir Panjang Power Station' },
  { key: 'power_station', cx: 0.298, cy: 0.330, name: 'Pasir Panjang ‘B’ Station' },
  { key: 'sewage',       cx: 0.430, cy: 0.340, name: 'Singapore River sewerage works' },
  // ---- Civic & administrative core, just behind the quays (City Hall / Padang) ----
  { key: 'colonial',     cx: 0.462, cy: 0.378, name: 'Parliament House & City Hall' },
  { key: 'police',       cx: 0.454, cy: 0.380, name: 'Hill Street Police Station' },
  { key: 'fire_station', cx: 0.458, cy: 0.386, name: 'Central Fire Station' },
  { key: 'cinema',       cx: 0.447, cy: 0.390, name: 'Cathay Cinema' },
  { key: 'community_centre', cx: 0.470, cy: 0.392, name: 'People’s Association centre' },
  { key: 'hospital',     cx: 0.418, cy: 0.378, name: 'Singapore General Hospital' },
  { key: 'clinic',       cx: 0.452, cy: 0.408, name: 'Kandang Kerbau Hospital' },
  { key: 'stadium',      cx: 0.480, cy: 0.410, name: 'Jalan Besar Stadium' },
  // ---- The urban density runs EAST along the coast: Geylang, Kallang & Katong ----
  { key: 'shophouse',    cx: 0.520, cy: 0.430, n: 4, spread: 0.012, name: 'Geylang' },
  { key: 'shophouse',    cx: 0.585, cy: 0.444, n: 3, spread: 0.012, name: 'Katong / Joo Chiat' },
  { key: 'kampong',      cx: 0.558, cy: 0.460, n: 2, spread: 0.03, name: 'Geylang Serai kampong' },
  // ---- Public housing: the real early HDB/SIT estates standing by 1965
  //      (~54,000 flats built). They sit a little INLAND, north of the old town;
  //      most of the rest of the island still lived in kampongs ----
  { key: 'hdb_flat',     cx: 0.340, cy: 0.428, n: 4, spread: 0.020, name: 'Queenstown (incl. Tanglin Halt)' },
  { key: 'hdb_flat',     cx: 0.420, cy: 0.408, n: 2, spread: 0.013, name: 'Bukit Ho Swee estate' },
  { key: 'hdb_flat',     cx: 0.476, cy: 0.442, n: 2, spread: 0.015, name: 'St Michael’s / Kallang estate' },
  { key: 'hdb_flat',     cx: 0.533, cy: 0.475, n: 2, spread: 0.015, name: 'MacPherson estate' },
  { key: 'hdb_flat',     cx: 0.452, cy: 0.490, n: 2, spread: 0.018, name: 'Toa Payoh New Town (rising)' },
  { key: 'shophouse',    cx: 0.408, cy: 0.392, n: 2, spread: 0.011, name: 'Tiong Bahru SIT flats' },
  { key: 'school',       cx: 0.350, cy: 0.440, name: 'Queenstown Secondary School' },
  // ---- Industry: the new Jurong estate, far west ----
  { key: 'factory',      cx: 0.142, cy: 0.460, n: 2, spread: 0.022, name: 'Jurong Industrial Estate' },
  { key: 'processing',   cx: 0.168, cy: 0.472, name: 'Jurong rubber & tin works' },
  // ---- Water & sanitation (the young republic's public works) ----
  { key: 'standpipe',    cx: 0.440, cy: 0.398, name: 'City water mains' },
  { key: 'standpipe',    cx: 0.345, cy: 0.430, name: 'Queenstown water mains' },
  { key: 'standpipe',    cx: 0.452, cy: 0.486, name: 'Toa Payoh water mains' },
  { key: 'standpipe',    cx: 0.520, cy: 0.440, name: 'Kallang water mains' },
  { key: 'reservoir',    cx: 0.475, cy: 0.545, name: 'Seletar Reservoir' },
  // ---- Education & green ----
  { key: 'tech_school',  cx: 0.360, cy: 0.470, name: 'University of Singapore (Bukit Timah)' },
  { key: 'park',         cx: 0.375, cy: 0.455, name: 'Botanic Gardens' },
  // ---- Kampongs (in 1965 about a third of Singaporeans still lived in villages) ----
  { key: 'kampong',      cx: 0.362, cy: 0.388, n: 2, spread: 0.03, name: 'Telok Blangah kampong' },
  { key: 'kampong',      cx: 0.330, cy: 0.545, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.560, cy: 0.560, n: 3, spread: 0.04 },
  { key: 'kampong',      cx: 0.255, cy: 0.485, n: 2, spread: 0.035 },
  { key: 'kampong',      cx: 0.620, cy: 0.505, n: 2, spread: 0.035 },
];
