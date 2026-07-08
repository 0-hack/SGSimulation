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
export const CUSTOM_RAILWAYS = [[[0.45,0.363],[0.446,0.366],[0.445,0.368]], [[0.448,0.365],[0.444,0.369]], [[0.45,0.363],[0.447,0.362],[0.447,0.358],[0.44,0.353],[0.436,0.351],[0.433,0.351]], [[0.427,0.351],[0.423,0.352],[0.42,0.354],[0.417,0.356]], [[0.445,0.361],[0.445,0.367]], [[0.444,0.365],[0.443,0.37]], [[0.452,0.37],[0.448,0.369]], [[0.45,0.37],[0.447,0.369],[0.443,0.37]], [[0.448,0.368],[0.444,0.369]], [[0.447,0.367],[0.444,0.369]], [[0.445,0.368],[0.442,0.371],[0.435,0.377],[0.431,0.378],[0.427,0.378],[0.413,0.385],[0.407,0.387],[0.39,0.387],[0.386,0.39],[0.385,0.405],[0.383,0.408],[0.379,0.413],[0.378,0.417],[0.372,0.43],[0.369,0.439],[0.367,0.442],[0.363,0.445],[0.358,0.451],[0.357,0.455],[0.354,0.46],[0.352,0.463],[0.351,0.489],[0.35,0.492],[0.336,0.509],[0.334,0.513],[0.328,0.524],[0.325,0.528],[0.323,0.53],[0.324,0.539],[0.323,0.542],[0.318,0.55],[0.315,0.559],[0.31,0.569],[0.306,0.578],[0.305,0.58],[0.302,0.583],[0.299,0.589],[0.297,0.605],[0.297,0.608],[0.302,0.624],[0.302,0.628],[0.3,0.641],[0.301,0.655],[0.301,0.659],[0.327,0.688],[0.329,0.692],[0.331,0.696],[0.326,0.717],[0.317,0.73]], [[0.351,0.477],[0.351,0.473],[0.346,0.468],[0.343,0.467],[0.339,0.467],[0.333,0.465],[0.326,0.46],[0.323,0.459],[0.317,0.461],[0.306,0.458],[0.301,0.457],[0.288,0.462],[0.281,0.46],[0.278,0.46],[0.267,0.467],[0.264,0.468],[0.252,0.465],[0.246,0.463],[0.227,0.454],[0.221,0.45],[0.214,0.441],[0.211,0.44],[0.206,0.44],[0.187,0.433]], [[0.432,0.351],[0.427,0.351]], [[0.451,0.358],[0.461,0.358],[0.462,0.361],[0.45,0.362]], [[0.451,0.357],[0.461,0.357]], [[0.452,0.356],[0.462,0.356]], [[0.451,0.356],[0.462,0.356],[0.465,0.355]], [[0.46,0.363],[0.464,0.361],[0.467,0.361],[0.471,0.359]], [[0.461,0.364],[0.449,0.363]]];
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
  // ---- The dense commercial heart at the river mouth & Raffles Place. In 1966
  //      this was a tight grid of SHOPHOUSES, godowns, banks and trading houses —
  //      mostly 2–5 storeys, with only a handful of taller blocks (the Asia
  //      Insurance and Bank of China buildings, ~18 storeys); the high-rise office
  //      CBD only rose in the 1970s–80s. Packed into the blocks between the streets ----
  { key: 'godown',       cx: 0.448, cy: 0.356, n: 2, spread: 0.010, name: 'Singapore River godowns' },
  { key: 'shophouse',    cx: 0.434, cy: 0.373, n: 6, spread: 0.010, name: 'Chinatown (Kreta Ayer)' },
  { key: 'shophouse',    cx: 0.450, cy: 0.377, n: 5, spread: 0.010, name: 'Raffles Place & Boat Quay' },
  { key: 'shophouse',    cx: 0.462, cy: 0.372, n: 3, spread: 0.009, name: 'Collyer Quay' },
  { key: 'shophouse',    cx: 0.423, cy: 0.367, n: 3, spread: 0.010, name: 'Tanjong Pagar' },
  { key: 'lau_pa_sat',   cx: 0.460, cy: 0.362, name: 'Lau Pa Sat (Telok Ayer Market)' },
  // The pioneer skyscrapers already standing over Raffles Place / Collyer Quay by 1965 —
  // a handful of tall bank, insurance and shipping offices poking above the low-rise mass
  // (the dense high-rise CBD only rose from the 1970s). Buildable & demolishable (Heritage).
  // Sited on the Collyer Quay waterfront, north-east of Tanjong Pagar station (where Raffles
  // Place actually sits — well clear of the railway terminus), spaced so none overlap.
  { key: 'finlayson_house',  cx: 0.463, cy: 0.359, name: 'Finlayson House' },
  { key: 'asia_insurance',   cx: 0.470, cy: 0.359, name: 'Asia Insurance Building' },
  { key: 'ocean_building',   cx: 0.476, cy: 0.359, name: 'Ocean Building' },
  { key: 'bank_of_china',    cx: 0.466, cy: 0.362, name: 'Bank of China Building' },
  { key: 'maritime_building',cx: 0.473, cy: 0.362, name: 'Maritime Building' },
  // The Malayan Railway's grand southern terminus at Keppel Road, at the end of the KTM
  // line (it snaps to solid ground right beside the terminal throat, not onto the track).
  { key: 'tanjong_pagar_station', cx: 0.444, cy: 0.363, name: 'Tanjong Pagar Railway Station' },
  // ---- Port & dockyards lining Keppel Harbour, plus the coastal power stations ----
  { key: 'port',         cx: 0.414, cy: 0.332, name: 'Keppel Harbour' },
  { key: 'diesel',       cx: 0.432, cy: 0.338, name: 'St James Power Station' },
  { key: 'power_station', cx: 0.314, cy: 0.300, name: 'Pasir Panjang Power Station' },
  { key: 'power_station', cx: 0.298, cy: 0.330, name: 'Pasir Panjang ‘B’ Station' },
  { key: 'sewage',       cx: 0.430, cy: 0.358, name: 'Singapore River sewerage works' },
  // ---- Civic & administrative core, just behind the quays (City Hall / Padang) ----
  { key: 'colonial',     cx: 0.464, cy: 0.380, name: 'Parliament House & City Hall' },
  { key: 'police',       cx: 0.456, cy: 0.382, name: 'Hill Street Police Station' },
  { key: 'fire_station', cx: 0.460, cy: 0.388, name: 'Central Fire Station' },
  { key: 'cinema',       cx: 0.450, cy: 0.392, name: 'Cathay Cinema' },
  { key: 'hospital',     cx: 0.418, cy: 0.378, name: 'Singapore General Hospital' },
  // ---- Named heritage landmarks of the central area, standing at independence and
  //      modelled close to their real 1950s–60s exteriors. Buildable & demolishable
  //      from the build menu (Heritage), so the player can keep or reshape the old
  //      district. Placed at their real sites; they snap to the nearest free cell if a
  //      street or shophouse already sits on the exact spot ----
  { key: 'fullerton',        cx: 0.457, cy: 0.381, name: 'Fullerton Building' },
  { key: 'victoria_theatre', cx: 0.461, cy: 0.389, name: 'Victoria Theatre & Concert Hall' },
  { key: 'raffles_hotel',    cx: 0.470, cy: 0.405, name: 'Raffles Hotel' },
  { key: 'sri_mariamman',    cx: 0.437, cy: 0.374, name: 'Sri Mariamman Temple' },
  { key: 'sultan_mosque',    cx: 0.482, cy: 0.417, name: 'Sultan Mosque' },
  // ---- The most crowded part of 1966: from City Hall the built-up town runs
  //      NORTH-EAST and EAST in an almost-unbroken mass of shophouses — Beach Road,
  //      Bugis, Kampong Glam, Rochor, Jalan Besar, Lavender, Kallang, Geylang and
  //      Katong. This is the real dense belt, weighted east of the civic core ----
  { key: 'shophouse',    cx: 0.476, cy: 0.396, n: 7, spread: 0.011, name: 'Beach Road & Bugis' },
  { key: 'community_centre', cx: 0.470, cy: 0.392, name: 'People’s Association centre' },
  { key: 'shophouse',    cx: 0.488, cy: 0.410, n: 6, spread: 0.011, name: 'Kampong Glam & Rochor' },
  { key: 'clinic',       cx: 0.481, cy: 0.404, name: 'Kandang Kerbau Hospital' },
  { key: 'shophouse',    cx: 0.498, cy: 0.424, n: 6, spread: 0.011, name: 'Jalan Besar & Lavender' },
  { key: 'stadium',      cx: 0.487, cy: 0.416, name: 'Jalan Besar Stadium' },
  { key: 'shophouse',    cx: 0.518, cy: 0.432, n: 7, spread: 0.012, name: 'Kallang' },
  { key: 'shophouse',    cx: 0.546, cy: 0.442, n: 7, spread: 0.012, name: 'Geylang' },
  { key: 'shophouse',    cx: 0.582, cy: 0.452, n: 5, spread: 0.012, name: 'Katong / Joo Chiat' },
  { key: 'kampong',      cx: 0.562, cy: 0.466, n: 2, spread: 0.03, name: 'Geylang Serai kampong' },
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
  { key: 'standpipe',    cx: 0.515, cy: 0.438, name: 'Kallang water mains' },
  { key: 'standpipe',    cx: 0.556, cy: 0.450, name: 'Geylang water mains' },
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
