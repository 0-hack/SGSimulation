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
export const CUSTOM_RAILWAYS = [[[0.4502,0.3626],[0.4481,0.364],[0.4464,0.3656],[0.4445,0.3683]], [[0.448,0.3648],[0.4444,0.3686]], [[0.4502,0.3625],[0.4478,0.3625],[0.4469,0.362],[0.4466,0.3613],[0.4465,0.3575],[0.4463,0.3567],[0.4459,0.3562],[0.4404,0.3532],[0.4364,0.3514],[0.4311,0.3514],[0.4255,0.3507],[0.4234,0.3516],[0.4198,0.354],[0.418,0.3547],[0.4168,0.3555]], [[0.4447,0.3613],[0.4449,0.3636],[0.4448,0.3668],[0.4443,0.3683],[0.4437,0.3691]], [[0.4437,0.3653],[0.4442,0.3678],[0.4434,0.3695]], [[0.4521,0.3701],[0.4477,0.3692]], [[0.4504,0.3703],[0.4484,0.3698],[0.4474,0.369],[0.4455,0.3686],[0.4445,0.3686],[0.4433,0.3695]], [[0.4476,0.3682],[0.4459,0.3682],[0.4437,0.3689]], [[0.447,0.3673],[0.4436,0.3691],[0.4433,0.3695]], [[0.4447,0.368],[0.4443,0.3686],[0.4419,0.3708],[0.4348,0.3767],[0.4324,0.378],[0.4307,0.3784],[0.429,0.3784],[0.4268,0.3779],[0.4251,0.3781],[0.4132,0.385],[0.4113,0.3858],[0.4066,0.3867],[0.3896,0.3874],[0.3881,0.3879],[0.3861,0.3898],[0.3853,0.3919],[0.3846,0.4054],[0.384,0.4072],[0.3834,0.4082],[0.3815,0.41],[0.3792,0.413],[0.3785,0.4146],[0.3781,0.4171],[0.3715,0.4296],[0.369,0.4386],[0.3686,0.4395],[0.3665,0.442],[0.3629,0.4446],[0.3581,0.4508],[0.3574,0.452],[0.3565,0.4552],[0.3559,0.4565],[0.3535,0.4595],[0.3523,0.4615],[0.3519,0.4634],[0.3509,0.4887],[0.3506,0.4901],[0.3496,0.4918],[0.3359,0.5093],[0.3335,0.5128],[0.3321,0.5151],[0.3281,0.5238],[0.3247,0.5277],[0.324,0.529],[0.3233,0.5304],[0.3232,0.5321],[0.324,0.5391],[0.3236,0.5407],[0.3228,0.5422],[0.3176,0.5502],[0.3169,0.5516],[0.3151,0.5591],[0.3144,0.5608],[0.3098,0.5694],[0.3062,0.5776],[0.3045,0.5803],[0.3022,0.5828],[0.299,0.5893],[0.2965,0.6048],[0.2971,0.6081],[0.3024,0.6243],[0.3022,0.6278],[0.2996,0.6406],[0.3005,0.6554],[0.3008,0.6577],[0.3014,0.6592],[0.303,0.6617],[0.3269,0.688],[0.3282,0.6898],[0.3292,0.6915],[0.3308,0.696],[0.3311,0.6976],[0.3255,0.7165],[0.3171,0.7297]], [[0.3511,0.4766],[0.3512,0.4738],[0.3508,0.4725],[0.3495,0.4708],[0.3462,0.4683],[0.3443,0.4673],[0.343,0.4668],[0.3385,0.4665],[0.3329,0.4648],[0.3263,0.4602],[0.3247,0.4594],[0.3233,0.4592],[0.3209,0.4595],[0.3171,0.4612],[0.3161,0.4611],[0.3057,0.4579],[0.3007,0.4572],[0.2998,0.4573],[0.2883,0.4624],[0.2873,0.4624],[0.2813,0.4604],[0.2783,0.4601],[0.2772,0.4604],[0.2674,0.4668],[0.2651,0.4677],[0.2639,0.4676],[0.2519,0.4649],[0.2462,0.4631],[0.2269,0.4535],[0.2208,0.4502],[0.2187,0.4482],[0.2141,0.4414],[0.2123,0.44],[0.2109,0.4396],[0.2059,0.4397],[0.2035,0.4394],[0.1868,0.433]], [[0.6277,0.457],[0.6313,0.4488],[0.6335,0.4486]]];
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
