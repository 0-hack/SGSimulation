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
export const CUSTOM_RAILWAYS = [[[0.4502,0.3626],[0.4482,0.3641],[0.4464,0.366],[0.4445,0.3683]], [[0.448,0.3648],[0.4444,0.3686]], [[0.4502,0.3625],[0.4484,0.3623],[0.4472,0.3617],[0.4467,0.3603],[0.4465,0.3585],[0.4459,0.3568],[0.4441,0.3554],[0.4409,0.3536],[0.4379,0.3522],[0.4365,0.3515],[0.4358,0.3514],[0.4351,0.3514],[0.4345,0.3514],[0.4338,0.3514],[0.4332,0.3514],[0.4325,0.3514],[0.4321,0.3514]], [[0.4274,0.3509],[0.4268,0.3509],[0.4261,0.3508],[0.4255,0.3508],[0.4247,0.3511],[0.4228,0.3521],[0.4204,0.3535],[0.4183,0.3546],[0.4168,0.3555]], [[0.4447,0.3613],[0.4448,0.3638],[0.4446,0.3662],[0.4442,0.3679],[0.4437,0.3691]], [[0.4437,0.3653],[0.4437,0.3675],[0.4434,0.3695]], [[0.4521,0.3701],[0.4477,0.3692]], [[0.4504,0.3703],[0.4487,0.3697],[0.4472,0.3692],[0.4458,0.3688],[0.4445,0.369],[0.4433,0.3695]], [[0.4476,0.3682],[0.4457,0.3685],[0.4437,0.3689]], [[0.447,0.3673],[0.4448,0.3686],[0.4433,0.3695]], [[0.4447,0.368],[0.4433,0.3694],[0.4403,0.372],[0.4363,0.3752],[0.433,0.3773],[0.4307,0.3782],[0.4288,0.3782],[0.4263,0.3786],[0.4219,0.3803],[0.4161,0.3831],[0.4101,0.3854],[0.4028,0.3866],[0.3946,0.3874],[0.389,0.3884],[0.3865,0.3907],[0.3854,0.3955],[0.3846,0.4017],[0.3839,0.4062],[0.3829,0.4085],[0.3814,0.4104],[0.3798,0.4126],[0.3783,0.4155],[0.3761,0.4207],[0.3728,0.4284],[0.3699,0.4354],[0.368,0.4396],[0.3658,0.4424],[0.3626,0.4456],[0.3595,0.4493],[0.3576,0.4523],[0.3565,0.4547],[0.3553,0.457],[0.3539,0.4592],[0.3526,0.4629],[0.3518,0.4707],[0.3511,0.4812],[0.3496,0.4897],[0.3455,0.4969],[0.3394,0.505],[0.3344,0.5119],[0.3312,0.5171],[0.3283,0.5222],[0.3258,0.5264],[0.3242,0.5289],[0.3236,0.5309],[0.3235,0.5338],[0.3236,0.5374],[0.3231,0.5407],[0.3214,0.5442],[0.3189,0.5485],[0.3168,0.5531],[0.3152,0.5577],[0.3131,0.563],[0.3101,0.5693],[0.3069,0.5755],[0.3043,0.5801],[0.3019,0.5849],[0.2994,0.5922],[0.298,0.6016],[0.2987,0.6114],[0.3005,0.6209],[0.3012,0.6306],[0.3007,0.6412],[0.3005,0.6508],[0.3009,0.6567],[0.3032,0.661],[0.31,0.6692],[0.3198,0.6803],[0.3267,0.6884],[0.3293,0.6924],[0.33,0.6962],[0.3286,0.7036],[0.3241,0.7154],[0.3171,0.7297]], [[0.3511,0.4766],[0.351,0.4743],[0.3503,0.4724],[0.3488,0.4706],[0.3466,0.4688],[0.3444,0.4676],[0.3418,0.4668],[0.3378,0.4658],[0.3328,0.4639],[0.3281,0.4615],[0.325,0.4599],[0.3228,0.4595],[0.3205,0.4599],[0.3175,0.4604],[0.3131,0.46],[0.3074,0.4587],[0.3019,0.458],[0.2967,0.4589],[0.2913,0.4607],[0.2863,0.4614],[0.2822,0.461],[0.2787,0.4608],[0.2745,0.4624],[0.2697,0.4651],[0.2653,0.4668],[0.2603,0.4666],[0.2527,0.4646],[0.2423,0.4606],[0.2313,0.4555],[0.223,0.4508],[0.2182,0.4468],[0.215,0.4432],[0.2124,0.4407],[0.2097,0.4398],[0.2058,0.4392],[0.1983,0.4371],[0.1868,0.433]], [[0.4322,0.3513],[0.4303,0.3512],[0.4273,0.3509]], [[0.4506,0.3575],[0.4573,0.358],[0.4611,0.3587],[0.4621,0.3596],[0.4618,0.3607],[0.4605,0.3618],[0.4567,0.3624],[0.45,0.3624]], [[0.4513,0.357],[0.4576,0.3574],[0.4611,0.3578],[0.4621,0.3584],[0.4623,0.359],[0.4624,0.3596]], [[0.452,0.3563],[0.4592,0.3561],[0.4647,0.3557]], [[0.4513,0.3559],[0.4587,0.3557],[0.4632,0.3553],[0.4651,0.3547],[0.4661,0.3542]], [[0.4603,0.3627],[0.4618,0.3622],[0.4638,0.3617],[0.4662,0.3611],[0.4684,0.3602],[0.4705,0.3588]], [[0.4606,0.3637],[0.449,0.3634]]];
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
