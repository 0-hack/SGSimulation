// Game content: buildings, policies, and historical events.
// All tuning lives here so the simulation in engine.js stays generic.
import { CUSTOM_LANDMARKS } from './custom1966.js';

export const START_YEAR = 1965;
export const START_DATE = { y: 1965, m: 8, d: 9 }; // National Day: 9 Aug 1965
export const GRID_SIZE = 640;  // a fine 2.5-unit grid (the island stays 1600 units across) so the dense 1966 town fits
export const WORLD_SIZE = 1600; // world units across the island bounding box — FIXED, independent of grid resolution

// Each "citizen" in state represents ~10 real people; display multiplies by 10.
export const POP_SCALE = 10;

// Economic weight of a STANDING 1965 heritage building. The historic residential
// city is rendered as hundreds of small models — kampong huts, two-storey shophouse
// terraces, early SIT/HDB blocks — dotted across the town. Each is a fraction of a
// modern, player-scale estate (an "HDB Flat" in the build menu is a whole 5,000-home
// project), so a heritage home counts at a reduced weight; otherwise the seeded town
// would "house" millions. Utilities, industry and civic works, by contrast, are
// genuine regional facilities (the actual Pasir Panjang power station, Keppel port,
// General Hospital…), so they count in FULL. Tuned so the 1965 start sits at a mild
// housing shortage with ~11% unemployment and a thin power/water surplus — the real,
// pressing conditions of independence — and so demolishing prebuilt housing, power
// or water plainly moves the national stats.
export const HERITAGE_RES_W = 0.095;
export function heritageWeight(key) {
  const b = BUILDINGS[key];
  return b && b.cat === 'residential' ? HERITAGE_RES_W : 1;
}

// ───────────────────────────────────────────────────────────────────────────
// SANDBOX / TEST MODE. When true: bond issuance is UNLIMITED (no debt ceiling,
// no interest) and EVERY building is unlocked and buildable from 1965 — so you can
// raise any amount of cash and review every building. Set back to `false` for the
// normal, balanced game.
// ───────────────────────────────────────────────────────────────────────────
export const SANDBOX = false;

// ---------------------------------------------------------------------------
// BUILDINGS
// Positive power/water = generates; negative = consumes.
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  { id: 'residential', name: 'Housing', icon: '🏠' },
  { id: 'power', name: 'Power', icon: '⚡' },
  { id: 'water', name: 'Water', icon: '💧' },
  { id: 'industry', name: 'Economy', icon: '🏭' },
  { id: 'civic', name: 'Services', icon: '🏥' },
  { id: 'defence', name: 'Defence', icon: '🛡️' },
  { id: 'green', name: 'Environment', icon: '🌳' },
  { id: 'plants', name: 'Plants', icon: '🌿' },
  { id: 'agriculture', name: 'Farms', icon: '🌾' },
  { id: 'leisure', name: 'Coast & Leisure', icon: '⛱️' },
  { id: 'heritage', name: 'Heritage', icon: '🏛️' },
  { id: 'community', name: 'Community', icon: '🌐' },
  { id: 'roads', name: 'Transport', icon: '🛣️' },
  { id: 'land', name: 'Reclaim', icon: '🏝️' },
];

// Icons for a custom build's functionality (community builds).
export const FUNC_ICON = { house: '🏠', economy: '🏭', entertainment: '🎡', power: '⚡', water: '💧', civic: '🏥', landmark: '🏛️' };
export const FUNC_LABEL = { house: 'Housing', economy: 'Economy', entertainment: 'Entertainment', power: 'Power', water: 'Water', civic: 'Civic', landmark: 'Landmark' };

// Routes the player can draw, by transport mode: Road (cars), Railway (trains),
// Airport (planes). `width` drives traffic/lane spacing; `renderHW` (when set) is
// the drawn carriageway half-width — Road matches the slim 1966 survey-map roads.
// `buildClear` is how close (world units, from the road centreline) a building may
// stand: a tight kerb-fronting clearance so you can pack a dense city right up to
// the street, NOT the old fat ~3.5-unit footpath buffer that sterilised ~1.4 tiles
// of land on each side of every thin road.
export const ROAD_TYPES = {
  road:    { name: 'Road',    icon: '🚗', lanes: 2, width: 1.8, renderHW: 0.34, buildClear: 1.5, speed: 12, cost: 6,  asphalt: '#807a6f' },
  railway: { name: 'Railway', icon: '🚆', lanes: 1, width: 1.6, buildClear: 1.4, speed: 0,  cost: 30, asphalt: '#5b5040', rail: true },
  mrt:     { name: 'MRT',     icon: '🚇', lanes: 1, width: 2.4, buildClear: 2.2, speed: 0,  cost: 45, asphalt: '#9aa6b0', rail: true, mrt: true, alwaysElevated: true },
  airport: { name: 'Airport', icon: '✈️', lanes: 1, width: 9,   buildClear: 8,   speed: 0,  cost: 80, asphalt: '#35383d', air: true },
};

// ---------------------------------------------------------------------------
// World technology timeline for the AMBIENT FLEET (the cars & trains that fill
// the streets and rails). Each generation is INVENTED in the world at `year`;
// the country only runs it once two things are true: it exists yet (year), AND
// the economy is developed enough to import it. A rich, educated, well-run
// nation runs the newest stock the moment it appears; a struggling one lags a
// generation behind for years — so the player's economic decisions visibly
// steer how modern the country looks. Tiers are ordered oldest → newest.
// ---------------------------------------------------------------------------
export const FLEET_TIMELINE = {
  car: [
    { id: 'vintage', year: 1900 },        // 1950s/60s sedans, trishaws, old buses
    { id: 'modern', year: 1980 },         // boxy modern cars & buses
    { id: 'contemporary', year: 2008 },   // sleek hatchbacks / hybrids / EVs
  ],
  train: [
    { id: 'steam', year: 1900 },          // steam locomotive + teak coaches
    { id: 'diesel', year: 1972 },         // diesel locomotive
    { id: 'modern', year: 2005 },         // modern multiple-unit
  ],
};
const _clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// 0..1 — how close to the world's cutting edge the economy can afford to be,
// from human capital (education), reserves (treasury) and political stability.
export function economyAdoption(state) {
  if (!state) return 0.3;
  const edu = (state.education || 20) / 100;
  const wealth = _clamp01((state.treasury || 0) / 1400);
  const approval = (state.approval || 50) / 100;
  return _clamp01(0.18 + edu * 0.5 + wealth * 0.27 + (approval - 0.5) * 0.2);
}
// Which fleet generation the country actually runs right now. A weak economy
// delays adoption of each newer generation by up to ~12 years after invention.
export function fleetEra(state) {
  const y = (state.date && state.date.y) || 1965;
  const adopt = economyAdoption(state);
  const lag = Math.round((1 - adopt) * 12);
  const pick = (list) => {
    let chosen = list[0].id;
    for (const g of list) if (y >= g.year + (g.year > 1900 ? lag : 0)) chosen = g.id;
    return chosen;
  };
  return { car: pick(FLEET_TIMELINE.car), train: pick(FLEET_TIMELINE.train), adoption: adopt, lag };
}

// Colour themes players can pick to customise a building's look.
export const THEMES = [
  { id: 'default', name: 'Classic', color: '#d8a25a' },
  { id: 'sky', name: 'Sky', color: '#6fb0d6' },
  { id: 'mint', name: 'Mint', color: '#7fc7a0' },
  { id: 'rose', name: 'Rose', color: '#e08aa0' },
  { id: 'sand', name: 'Sand', color: '#e3c879' },
  { id: 'lilac', name: 'Lilac', color: '#b3a6da' },
  { id: 'coral', name: 'Coral', color: '#ef7d62' },
  { id: 'slate', name: 'Slate', color: '#8a98a6' },
];

// Buildings the player can construct. `cost` is in $M and is pegged to documented
// 1965 Singapore figures (game $M ≈ 1965 Singapore $ millions): a 1-room HDB
// "Emergency" flat cost ~$6,000 to build and rented for about $20/month; the HDB had
// already built ~54,000 flats by 1965; the government's annual development budget ran
// to roughly $150–200M. Each entry is an AGGREGATE regional project (an "HDB Flat" =
// a ~5,000-home estate), so its cost is the whole works, not one block.
export const BUILDINGS = {
  // ---- Housing ----
  kampong: {
    name: 'Kampong', cat: 'residential', icon: '🛖', color: '#8d6e4f',
    cost: 5, upkeep: 0.2, year: 1965, homes: 1200, jobs: 0,
    power: -1, water: -2, pollution: 1, happiness: 2,
    desc: 'A cluster of attap-roofed village huts on stilts. Cheap to throw up, but cramped and prone to fire and flooding. Much of the population lives this way when nation-building begins.',
  },
  shophouse: {
    name: 'Shophouse Row', cat: 'residential', icon: '🏚️', color: '#d98f5a', customizable: true,
    cost: 14, upkeep: 0.5, year: 1965, homes: 2200, jobs: 350,
    power: -3, water: -4, pollution: 1, happiness: 4, income: 2,
    desc: 'A terrace of colourful two-storey shophouses — shops and hawker stalls below, families living above. The face of old Singapore.',
  },
  hdb_flat: {
    name: 'HDB Flat', cat: 'residential', icon: '🏢', color: '#cf9b5f', customizable: true,
    cost: 30, upkeep: 1.2, year: 1965, homes: 5000, jobs: 0,
    power: -6, water: -8, pollution: 1, happiness: 5,
    desc: 'Public housing blocks — small, decent, cheap flats put up fast to clear the kampongs and shelter families en masse. The quickest way to house a growing nation.',
  },
  terrace: {
    name: 'Terrace Houses', cat: 'residential', icon: '🏘️', color: '#d9b58a', customizable: true,
    cost: 10, upkeep: 0.4, year: 1965, homes: 1500, jobs: 80,
    power: -2, water: -3, pollution: 1, happiness: 5, income: 1,
    desc: 'A short row of two-storey terrace houses — a step up from the kampong, each with its own front door and a little garden. Modest, tidy, quintessentially old Singapore.',
  },
  bungalow: {
    name: 'Bungalow', cat: 'residential', icon: '🏡', color: '#eae2cc', customizable: true,
    cost: 12, upkeep: 0.3, year: 1965, homes: 300, jobs: 0,
    power: -2, water: -3, pollution: 0, happiness: 9, income: 2,
    desc: 'A detached single-storey house with a porch and garden — comfortable middle-class living. Houses few, but lifts land value and happiness.',
  },
  walkup: {
    name: 'Walk-up Flats', cat: 'residential', icon: '🏢', color: '#e3d3a6', customizable: true,
    cost: 20, upkeep: 0.8, year: 1965, homes: 3200, jobs: 120,
    power: -4, water: -6, pollution: 1, happiness: 5,
    desc: 'Four-storey walk-up flats — no lifts, long common corridors, but solid, affordable homes that rehouse thousands from the kampongs. A no-frills early answer to the housing shortage.',
  },
  hdb_newtown: {
    name: 'HDB New Town', cat: 'residential', icon: '🏙️', color: '#e0a85e', customizable: true,
    cost: 90, upkeep: 3.0, year: 1968, homes: 14000, jobs: 600,
    power: -16, water: -20, pollution: 2, happiness: 7,
    desc: 'A self-contained town with flats, shops and amenities. The backbone of the nation.',
  },
  condo: {
    name: 'Private Condo', cat: 'residential', icon: '🏨', color: '#7fc2e6', customizable: true,
    cost: 140, upkeep: 2.0, year: 1970, homes: 4000, jobs: 200,
    power: -10, water: -14, pollution: 1, happiness: 9, income: 1.5,
    desc: 'Premium private housing. Raises land value and tax revenue but houses fewer people.',
  },
  condo_estate: {
    name: 'Condo Estate', cat: 'residential', icon: '🏬', color: '#86c8e0', customizable: true,
    cost: 360, upkeep: 6.0, year: 1980, homes: 16000, jobs: 800,
    power: -34, water: -44, pollution: 2, happiness: 12, income: 6,
    desc: 'A gated condominium estate: several towers around a pool and clubhouse. High land value.',
  },
  hdb_highrise: {
    name: 'HDB Point Block', cat: 'residential', icon: '🏯', color: '#cfa75e', customizable: true,
    cost: 220, upkeep: 4.5, year: 2000, homes: 20000, jobs: 700,
    power: -28, water: -34, pollution: 1, happiness: 8,
    desc: 'A modern high-rise HDB point block — 40-storey towers with sky gardens, the public housing of the 2000s. Houses the most people per plot of any home.',
  },

  // ---- Power ----
  diesel: {
    name: 'Diesel Generator', cat: 'power', icon: '🔌', color: '#9e9e9e',
    cost: 20, upkeep: 1.5, year: 1965, homes: 0, jobs: 40,
    power: 60, water: -2, pollution: 8, happiness: -2,
    desc: 'Quick, dirty power for a young nation. High pollution.',
  },
  power_station: {
    name: 'Power Station', cat: 'power', icon: '🏭', color: '#616161',
    cost: 120, upkeep: 4.0, year: 1967, homes: 0, jobs: 150,
    power: 400, water: -8, pollution: 18, happiness: -5,
    desc: 'A large gas/oil power station. Powers a whole region, but pollutes heavily.',
  },
  solar_farm: {
    name: 'Solar Farm', cat: 'power', icon: '☀️', color: '#f6c945',
    cost: 180, upkeep: 1.0, year: 2008, homes: 0, jobs: 30,
    power: 220, water: 0, pollution: 0, happiness: 4,
    desc: 'Clean solar energy. Expensive up front, but no pollution and tiny upkeep.',
  },
  // World power technologies, dated to when they were INVENTED & used in the
  // world — buildable here the moment they exist (if you can afford them), even
  // the ones Singapore never actually built. The player decides whether to adopt.
  waste_energy: {
    name: 'Waste-to-Energy Plant', cat: 'power', icon: '♻️', color: '#7d8a5c',
    cost: 150, upkeep: 3.0, year: 1979, homes: 0, jobs: 110,
    power: 180, water: -4, pollution: 6, happiness: -1, health: 2,
    desc: 'An incineration plant that burns refuse to raise steam for electricity. Powers the city AND shrinks the rubbish mountain in one stroke.',
  },
  nuclear: {
    name: 'Nuclear Power Plant', cat: 'power', icon: '⚛️', color: '#8fd1c0',
    cost: 600, upkeep: 9.0, year: 1968, homes: 0, jobs: 300,
    power: 1200, water: -30, pollution: 1, happiness: -10,
    desc: 'Enormous, near-zero-carbon baseload from nuclear fission. Vast output, but a huge bill, wary residents on a crowded island, and a long shadow if it ever goes wrong.',
  },
  gas_power: {
    name: 'Combined-Cycle Gas', cat: 'power', icon: '🔥', color: '#5a8aa8',
    cost: 240, upkeep: 5.0, year: 1992, homes: 0, jobs: 140,
    power: 620, water: -10, pollution: 7, happiness: -2,
    desc: 'A high-efficiency natural-gas plant — a modern grid workhorse once piped gas is available. Cleaner than oil, far more output per dollar.',
  },

  // ---- Water ----
  reservoir: {
    name: 'Reservoir', cat: 'water', icon: '🦆', color: '#4f93c4',
    cost: 30, upkeep: 0.5, year: 1965, homes: 0, jobs: 10,
    power: -2, water: 80, pollution: -2, happiness: 3,
    desc: 'Catches rainwater. Cheap and clean, but limited by the weather.',
  },
  reservoir_big: {
    name: 'Major Reservoir', cat: 'water', icon: '🌊', color: '#3f86c4',
    cost: 90, upkeep: 1.5, year: 1965, homes: 0, jobs: 40,
    power: -4, water: 260, pollution: -3, happiness: 6, health: 4,
    desc: 'A large dammed reservoir catching and storing rainwater across a whole catchment. A strategic store of fresh water that weans the nation off imported supply.',
  },
  desal: {
    name: 'Desalination Plant', cat: 'water', icon: '🌊', color: '#2f6f9f',
    cost: 150, upkeep: 4.5, year: 1990, homes: 0, jobs: 120,
    power: -40, water: 260, pollution: 4, happiness: 1,
    desc: 'Turns seawater into drinking water. Reliable and weather-proof, but power-hungry.',
  },
  newater: {
    name: 'NEWater Plant', cat: 'water', icon: '♻️', color: '#3fa9a0',
    cost: 110, upkeep: 3.0, year: 2003, homes: 0, jobs: 90,
    power: -22, water: 200, pollution: 1, happiness: 2,
    desc: 'Recycles used water into ultra-clean NEWater. A pillar of water independence.',
  },

  // ---- Economy ----
  factory: {
    name: 'Factory', cat: 'industry', icon: '🏗️', color: '#a98c6b',
    cost: 50, upkeep: 1.5, year: 1965, homes: 0, jobs: 2500,
    power: -25, water: -15, pollution: 10, happiness: -3, income: 6,
    desc: 'Light manufacturing in purpose-built industrial estates. Jobs and exports, with a haze of pollution.',
  },
  port: {
    name: 'Container Port', cat: 'industry', icon: '🚢', color: '#5a7a8c',
    cost: 220, upkeep: 5.0, year: 1965, homes: 0, jobs: 5000,
    power: -40, water: -10, pollution: 8, happiness: -1, income: 22,
    desc: 'A world-class transhipment hub. Enormous revenue and jobs — the trading nation\'s lifeline.',
  },
  office: {
    name: 'Business District', cat: 'industry', icon: '🏦', color: '#4a6fa5',
    cost: 200, upkeep: 4.0, year: 1968, homes: 0, jobs: 8000,
    power: -35, water: -12, pollution: 2, happiness: 1, income: 18,
    desc: 'Finance and services in the CBD. High-value jobs and tax revenue.',
  },
  tourism: {
    name: 'Integrated Resort', cat: 'industry', icon: '🎡', color: '#c267a8',
    cost: 320, upkeep: 6.0, year: 2010, homes: 0, jobs: 6000,
    power: -45, water: -25, pollution: 3, happiness: 6, income: 30,
    desc: 'Casinos, hotels and attractions. Huge tourism revenue — and social debate.',
  },

  // ---- Services ----
  school: {
    name: 'School', cat: 'civic', icon: '🏫', color: '#7bb07b',
    cost: 40, upkeep: 2.5, year: 1965, homes: 0, jobs: 400,
    power: -8, water: -10, pollution: 0, happiness: 3, education: 18,
    desc: 'Builds a skilled, bilingual workforce. Higher education raises productivity.',
  },
  hospital: {
    name: 'Hospital', cat: 'civic', icon: '🏥', color: '#d97b7b',
    cost: 80, upkeep: 4.0, year: 1965, homes: 0, jobs: 1200,
    power: -18, water: -22, pollution: 1, happiness: 4, health: 20,
    desc: 'Keeps citizens healthy, lowering death rates and softening epidemics.',
  },
  police: {
    name: 'Police Post', cat: 'civic', icon: '👮', color: '#6b7fd9',
    cost: 35, upkeep: 1.8, year: 1965, homes: 0, jobs: 300,
    power: -5, water: -4, pollution: 0, happiness: 2, safety: 22,
    desc: 'Law and order. Low crime keeps investors and citizens confident.',
  },
  colonial: {
    name: 'Municipal Building', cat: 'civic', icon: '🏛️', color: '#efe7d4',
    cost: 60, upkeep: 2.0, year: 1965, homes: 0, jobs: 500,
    power: -6, water: -6, pollution: 0, happiness: 6, safety: 6, income: 2,
    desc: 'A grand colonial-era civic hall with columns and a clock tower — the administrative seat inherited from the old empire.',
  },
  mrt: {
    name: 'MRT Station', cat: 'roads', icon: '🚇', color: '#9fb6c4', customizable: true,
    cost: 100, upkeep: 2.0, year: 1987, homes: 0, jobs: 200,
    power: -20, water: -4, pollution: -3, happiness: 8, education: 0,
    desc: 'Mass Rapid Transit station. Draw the elevated line with the 🚇 MRT mode in the Transport toolkit, then drop a station on the line — the track links up to it. Cuts congestion and pollution, and boosts happiness citywide.',
  },
  rail_station: {
    name: 'Train Station', cat: 'roads', icon: '🚉', color: '#c7a05a',
    cost: 24, upkeep: 0.6, year: 1965, homes: 0, jobs: 120,
    power: -4, water: -2, pollution: 1, happiness: 4,
    desc: 'An old-school railway station in the colonial style — a long platform canopy, a clock-towered booking hall and a steam/diesel train at the platform. Put it on the railway line so trains stop in town.',
  },
  street_lamp: {
    name: 'Street Lamp', cat: 'roads', icon: '💡', color: '#d8c27a', prop: true,
    cost: 1, upkeep: 0.05, year: 1965, homes: 0, jobs: 0,
    power: -1, water: 0, pollution: 0, happiness: 1, safety: 2,
    desc: 'A single street lamp that glows after dark — drop it FREELY at the kerb, on a verge, in a square or park (it isn\'t tied to the grid, so it can sit right beside a road). Safer streets at night.',
  },
  traffic_light: {
    name: 'Traffic Light', cat: 'roads', icon: '🚦', color: '#cf6f5a', prop: true,
    cost: 3, upkeep: 0.1, year: 1965, homes: 0, jobs: 0,
    power: -1, water: 0, pollution: 0, happiness: 1, safety: 4,
    desc: 'A compact 1965 three-aspect signal you can drop FREELY at any junction or crossing kerb (not grid-locked, so it can sit right at the roadside). Smoother, safer traffic.',
  },

  // ---- Heritage: 1950s–60s central-area landmarks (Raffles, Chinatown, the civic
  // district). Modelled close to the real exteriors; buildable & demolishable so a
  // player can keep the old district or reshape it. Beloved landmarks — a happiness
  // & tourism-income lift — and available from the start (they predate independence).
  raffles_hotel: {
    name: 'Raffles Hotel', cat: 'heritage', icon: '🏨', color: '#f0e8d6', year: 1887,
    cost: 40, upkeep: 1.2, homes: 0, jobs: 120, power: -6, water: -6, pollution: 0, happiness: 9, income: 5,
    desc: 'The grand colonial hotel (1887) — white verandahs, travellers’ palms and the Long Bar. A tourism draw and a symbol of old Singapore.',
  },
  fullerton: {
    name: 'Fullerton Building', cat: 'heritage', icon: '🏛️', color: '#c7c3b6', year: 1928,
    cost: 48, upkeep: 1.4, homes: 0, jobs: 180, power: -8, water: -5, pollution: 0, happiness: 7, income: 4,
    desc: 'The 1928 General Post Office — a monumental Doric colonnade at the river mouth. Civic grandeur and a working landmark.',
  },
  victoria_theatre: {
    name: 'Victoria Theatre', cat: 'heritage', icon: '🎭', color: '#e9e2d2', year: 1905,
    cost: 34, upkeep: 1.0, homes: 0, jobs: 70, power: -5, water: -3, pollution: 0, happiness: 8, income: 3,
    desc: 'The Victoria Theatre & Concert Hall with its clock tower — the stage of the civic district and its cultural life.',
  },
  sri_mariamman: {
    name: 'Sri Mariamman Temple', cat: 'heritage', icon: '🛕', color: '#e0533a', year: 1843,
    cost: 26, upkeep: 0.6, homes: 0, jobs: 20, power: -2, water: -2, pollution: 0, happiness: 10, income: 2,
    desc: 'Singapore’s oldest Hindu temple in Chinatown — a brightly painted, tiered gopuram gateway. A place of faith and festival.',
  },
  sultan_mosque: {
    name: 'Sultan Mosque', cat: 'heritage', icon: '🕌', color: '#e6d3a3', year: 1932,
    cost: 30, upkeep: 0.7, homes: 0, jobs: 24, power: -3, water: -3, pollution: 0, happiness: 10, income: 2,
    desc: 'The golden-domed mosque of Kampong Glam — the heart of the Malay-Muslim quarter and a landmark of the old town.',
  },
  lau_pa_sat: {
    name: 'Lau Pa Sat', cat: 'heritage', icon: '🍢', color: '#b7bcbf', year: 1894,
    cost: 22, upkeep: 0.8, homes: 0, jobs: 90, power: -4, water: -4, pollution: 1, happiness: 8, income: 3,
    desc: 'The octagonal Telok Ayer cast-iron market — a bustling hawker hall under a Victorian filigree roof, with its own clock tower.',
  },
  // The handful of tall office blocks that already rose over the low-rise Raffles Place
  // by 1965 — Singapore's first skyscrapers, home to the banks, insurers and trading
  // houses. The dense high-rise CBD only came in the 1970s–80s; these are the pioneers.
  bank_of_china: {
    name: 'Bank of China Building', cat: 'heritage', icon: '🏦', color: '#bfc4bd', year: 1954,
    cost: 62, upkeep: 2.0, homes: 0, jobs: 340, power: -13, water: -6, pollution: 0, happiness: 5, income: 9,
    desc: 'The 1954 tower on Battery Road — Raffles Place’s tallest for two decades and the country’s first centrally air-conditioned building. A modernist slab of banking halls and offices.',
  },
  asia_insurance: {
    name: 'Asia Insurance Building', cat: 'heritage', icon: '🏢', color: '#dcd3bd', year: 1955,
    cost: 58, upkeep: 1.9, homes: 0, jobs: 300, power: -12, water: -5, pollution: 0, happiness: 5, income: 8,
    desc: 'The 18-storey Art Deco tower on Finlayson Green (1955) — at 270 ft the tallest building in all Singapore until 1971, crowned by its stepped lantern.',
  },
  finlayson_house: {
    name: 'Finlayson House', cat: 'heritage', icon: '🏢', color: '#d0ccc0', year: 1953,
    cost: 44, upkeep: 1.5, homes: 0, jobs: 200, power: -8, water: -4, pollution: 0, happiness: 4, income: 6,
    desc: 'One of Raffles Place’s first modernist office blocks, standing among the pioneer skyscrapers of the Green.',
  },
  ocean_building: {
    name: 'Ocean Building', cat: 'heritage', icon: '🏢', color: '#e0dccb', year: 1924,
    cost: 46, upkeep: 1.6, homes: 0, jobs: 220, power: -8, water: -5, pollution: 0, happiness: 6, income: 6,
    desc: 'The stately second Ocean Building (1924) on Collyer Quay — a waterfront landmark of trading offices, famed for its Prince’s Restaurant.',
  },
  maritime_building: {
    name: 'Maritime Building', cat: 'heritage', icon: '🏢', color: '#cfc9ba', year: 1923,
    cost: 40, upkeep: 1.4, homes: 0, jobs: 170, power: -7, water: -4, pollution: 0, happiness: 5, income: 5,
    desc: 'The old Union Building on Collyer Quay — a prominent waterfront block of shipping and mercantile offices facing the harbour.',
  },
  tanjong_pagar_station: {
    name: 'Tanjong Pagar Railway Station', cat: 'heritage', icon: '🚉', color: '#efe9da', year: 1932,
    cost: 44, upkeep: 1.4, homes: 0, jobs: 150, power: -7, water: -5, pollution: 1, happiness: 8, income: 4,
    desc: 'The grand Art Deco southern terminus of the Malayan Railway (1932) at Keppel Road — a cream stripped-classical frontage of tall arches crowned by four marble statues of the Malayan economy (agriculture, commerce, transport, industry).',
  },

  mall: {
    name: 'Shopping Mall', cat: 'industry', icon: '🛍️', color: '#d98fc0', customizable: true,
    cost: 240, upkeep: 4.5, year: 1971, homes: 0, jobs: 5000,
    power: -38, water: -20, pollution: 2, happiness: 10, income: 20,
    desc: 'A landmark retail mall. Jobs, tax revenue and a big happiness boost for shoppers.',
  },

  // ---- Environment ----
  park: {
    name: 'Park', cat: 'green', icon: '🌳', color: '#5bbf6a',
    cost: 15, upkeep: 0.4, year: 1965, homes: 0, jobs: 20,
    power: -1, water: -6, pollution: -6, happiness: 7,
    desc: 'Green space for the "Garden City". Cleans the air and lifts spirits.',
  },
  gardens: {
    name: 'Gardens by the Bay', cat: 'green', icon: '🌴', color: '#3fa85a',
    cost: 260, upkeep: 3.5, year: 2012, homes: 0, jobs: 400,
    power: -30, water: -18, pollution: -12, happiness: 14, income: 4,
    desc: 'An iconic green landmark. Huge happiness and tourism draw with a power cost.',
  },
  forest: {
    name: 'Nature Reserve', cat: 'green', icon: '🌲', color: '#2f7d3f',
    cost: 60, upkeep: 0.6, year: 1965, homes: 0, jobs: 30,
    power: 0, water: -2, pollution: -14, happiness: 8,
    desc: 'Dense secondary rainforest. Cleans the air, cools the city and shelters wildlife.',
  },

  // ---- Coast & Leisure ----
  beach: {
    name: 'Beach', cat: 'leisure', icon: '🏖️', color: '#ecd9a0',
    cost: 40, upkeep: 0.8, year: 1965, homes: 0, jobs: 120,
    power: -2, water: -2, pollution: -2, happiness: 10, income: 2,
    desc: 'A sandy public beach with palms and parasols. Best placed along the coast.',
  },
  ferry_terminal: {
    name: 'Ferry Terminal', cat: 'leisure', icon: '⛴️', color: '#5a8aa6',
    cost: 130, upkeep: 3.0, year: 1965, homes: 0, jobs: 1400,
    power: -16, water: -8, pollution: 2, happiness: 5, income: 10,
    desc: 'Passenger ferries to the islands and the region. Place on the coast for the boats to dock.',
  },
  marina: {
    name: 'Marina & Yachts', cat: 'leisure', icon: '⛵', color: '#7fb6d6',
    cost: 200, upkeep: 4.0, year: 1972, homes: 0, jobs: 900,
    power: -18, water: -10, pollution: 1, happiness: 12, income: 14,
    desc: 'A luxury marina full of yachts and sailing boats. Big tourism and land-value boost.',
  },

  // ---- 1965 public works (real projects a young Singapore was investing in) ----
  standpipe: {
    name: 'Standpipe & Mains', cat: 'water', icon: '🚰', color: '#6fa8cc',
    cost: 8, upkeep: 0.3, year: 1965, homes: 0, jobs: 40,
    power: -1, water: 120, pollution: -1, happiness: 4, health: 4,
    desc: 'Piped water mains and communal standpipes for the kampongs, where many still queue at a shared tap. Clean water cuts disease sharply. Cheap and weather-proof.',
  },
  sewage: {
    name: 'Sewerage Works', cat: 'water', icon: '🚽', color: '#7d8a6f',
    cost: 45, upkeep: 2.0, year: 1965, homes: 0, jobs: 200,
    power: -14, water: -2, pollution: -10, happiness: 4, health: 12,
    desc: 'Modern sewers and treatment to replace the night-soil bucket system of the old town. Banishes filth and disease — vital, unglamorous nation-building.',
  },
  community_centre: {
    name: 'Community Centre', cat: 'civic', icon: '🤝', color: '#d8a24e',
    cost: 10, upkeep: 0.5, year: 1965, homes: 0, jobs: 80,
    power: -3, water: -3, pollution: 0, happiness: 6, safety: 6, education: 4,
    desc: 'A neighbourhood hall — classes, clubs and grassroots events that knit a multiracial nation together, one estate at a time.',
  },
  clinic: {
    name: 'Outpatient Clinic', cat: 'civic', icon: '🩺', color: '#d99a9a',
    cost: 22, upkeep: 1.5, year: 1965, homes: 0, jobs: 300,
    power: -6, water: -8, pollution: 0, happiness: 3, health: 11,
    desc: 'A government dispensary and maternal-and-child clinic — cheap front-line care close to the kampongs, easing the load on the big hospitals.',
  },
  fire_station: {
    name: 'Fire Station', cat: 'civic', icon: '🚒', color: '#cc5a4a',
    cost: 26, upkeep: 1.6, year: 1965, homes: 0, jobs: 250,
    power: -4, water: -6, pollution: 0, happiness: 2, safety: 13,
    desc: 'Fire engines and crews. In a town of tinder-dry attap huts packed wall to wall, a single blaze can leave thousands homeless — fire protection is a matter of survival.',
  },
  market: {
    name: 'Market & Hawkers', cat: 'civic', icon: '🛒', color: '#cf9050', customizable: true,
    cost: 16, upkeep: 0.8, year: 1965, homes: 0, jobs: 900,
    power: -6, water: -8, pollution: 1, happiness: 7, income: 5,
    desc: 'A wet market and hawker stalls, getting roadside vendors off the streets and into clean, licensed premises. Affordable food, jobs and a buzzing community hub.',
  },
  tech_school: {
    name: 'Technical Institute', cat: 'civic', icon: '🔧', color: '#7fa07f',
    cost: 55, upkeep: 3.0, year: 1965, homes: 0, jobs: 500,
    power: -10, water: -10, pollution: 0, happiness: 2, education: 16,
    desc: 'Vocational and technical training — fitters, electricians, draughtsmen — to staff the new factories. A skilled workforce is the bet behind industrialisation.',
  },
  godown: {
    name: 'Godown & Wharf', cat: 'industry', icon: '📦', color: '#9c8463',
    cost: 45, upkeep: 1.5, year: 1965, homes: 0, jobs: 1800,
    power: -15, water: -6, pollution: 4, happiness: -1, income: 12,
    desc: 'Riverside warehouses and quays for the entrepôt trade — bumboats lightering cargo up the river. The age-old business of buying, storing and re-exporting the region\'s goods.',
  },
  processing: {
    name: 'Rubber & Tin Works', cat: 'industry', icon: '🛞', color: '#8a7a5a',
    cost: 48, upkeep: 1.8, year: 1965, homes: 0, jobs: 2200,
    power: -22, water: -12, pollution: 9, happiness: -3, income: 9,
    desc: 'Mills that grade and pack the region\'s rubber and smelt its tin — the commodities the port lived off before industrialisation. Steady export earnings, but smoky.',
  },
  cinema: {
    name: 'Cinema', cat: 'leisure', icon: '🎬', color: '#c9608f',
    cost: 18, upkeep: 0.8, year: 1965, homes: 0, jobs: 300,
    power: -8, water: -3, pollution: 0, happiness: 9, income: 5,
    desc: 'A grand movie palace in the golden age of cinema — Malay, Hindi, Hokkien and Hollywood films are the cheap thrill of the masses. A big happiness lift.',
  },
  stadium: {
    name: 'Sports Stadium', cat: 'leisure', icon: '🏟️', color: '#5fa86a',
    cost: 55, upkeep: 2.0, year: 1965, homes: 0, jobs: 200,
    power: -10, water: -8, pollution: 0, happiness: 11, income: 3,
    desc: 'A grandstand and playing fields for football, athletics and national-day parades. Sport built fitness, pride and a shared identity for the new republic.',
  },

  // ---- Farms & agriculture (self-sufficiency: `food` = people fed) ----------
  market_garden: {
    name: 'Market Garden', cat: 'agriculture', icon: '🥬', color: '#5fbf6a',
    cost: 8, upkeep: 0.2, year: 1965, homes: 0, jobs: 200,
    power: 0, water: -4, pollution: 0, happiness: 1, income: 2, food: 3000,
    desc: 'Vegetable plots and polytunnels of the old rural fringe — kangkong, chye sim and bayam. Cheap fresh produce, and a step toward feeding the island ourselves.',
  },
  poultry_farm: {
    name: 'Poultry Farm', cat: 'agriculture', icon: '🐔', color: '#d9b14b',
    cost: 10, upkeep: 0.3, year: 1965, homes: 0, jobs: 150,
    power: 0, water: -3, pollution: 2, happiness: 0, income: 3, food: 4000,
    desc: 'Layer sheds and runs for chickens and ducks. Eggs and poultry for the wet markets — a smelly but vital part of the kampong economy.',
  },
  fish_farm: {
    name: 'Fish Farm', cat: 'agriculture', icon: '🐟', color: '#3f86c4',
    cost: 12, upkeep: 0.3, year: 1965, homes: 0, jobs: 150,
    power: -2, water: 0, pollution: 1, happiness: 1, income: 4, food: 5000,
    desc: 'Coastal kelongs and inland ponds raising fish and prawns. Protein for a growing nation and a living for fishing families.',
  },
  hydroponic_farm: {
    name: 'Hydroponic Farm', cat: 'agriculture', icon: '🌱', color: '#57c98a',
    cost: 40, upkeep: 1.2, year: 2000, homes: 0, jobs: 120,
    power: -8, water: -6, pollution: 0, happiness: 2, income: 8, food: 12000,
    desc: 'Climate-controlled greenhouses growing leafy greens in nutrient water — high yield on little land, the modern answer to a city with no farmland to spare.',
  },
  vertical_farm: {
    name: 'Vertical Farm', cat: 'agriculture', icon: '🏢', color: '#46b06a',
    cost: 90, upkeep: 2.5, year: 2014, homes: 0, jobs: 200,
    power: -20, water: -10, pollution: 0, happiness: 3, income: 18, food: 40000,
    desc: 'Stacked rotating growing towers under LED light. Enormous food output from a tiny footprint — the modern drive for home-grown food security.',
  },

  // ---- More options, 1965 → present (priced by year + currency strength) -----
  hawker_centre: {
    name: 'Hawker Centre', cat: 'leisure', icon: '🍜', color: '#e0833f',
    cost: 14, upkeep: 0.6, year: 1971, homes: 0, jobs: 400,
    power: -6, water: -5, pollution: 1, happiness: 10, income: 6,
    desc: 'Rows of cooked-food stalls that moved the street hawkers under one roof — cheap, glorious, multicultural food and the beating social heart of every neighbourhood.',
  },
  community_garden: {
    name: 'Community Garden', cat: 'green', icon: '🌻', color: '#7fb24a',
    cost: 6, upkeep: 0.1, year: 1995, homes: 0, jobs: 20,
    power: 0, water: -2, pollution: -2, happiness: 5, income: 0, food: 800,
    desc: 'Allotment plots tended by residents — herbs, fruit and flowers that green the estate and bring neighbours together.',
  },
  wafer_fab: {
    name: 'Wafer Fab', cat: 'industry', icon: '🔬', color: '#7f8fa6',
    cost: 200, upkeep: 7, year: 1987, homes: 0, jobs: 1500,
    power: -50, water: -25, pollution: 8, happiness: -2, income: 40,
    desc: 'A semiconductor fabrication plant — clean-rooms etching silicon wafers. The high-tech manufacturing that pulls an economy up the value chain.',
  },
  biomed_park: {
    name: 'Biomedical Park', cat: 'industry', icon: '🧬', color: '#8a6fc0',
    cost: 160, upkeep: 5, year: 2000, homes: 0, jobs: 2000,
    power: -30, water: -15, pollution: 2, happiness: 2, income: 30, education: 8,
    desc: 'Pharma plants and research labs — vaccines, diagnostics and drug manufacturing. A new growth pillar built on brains, not just hands.',
  },
  data_centre: {
    name: 'Data Centre', cat: 'industry', icon: '🖥️', color: '#5b6b7a',
    cost: 180, upkeep: 6, year: 2001, homes: 0, jobs: 400,
    power: -60, water: -20, pollution: 2, happiness: 0, income: 35,
    desc: 'Halls of humming servers behind blank façades — the digital backbone of a regional finance and tech hub. Voracious for power and cooling water.',
  },
  desalination: {
    name: 'Desalination Plant', cat: 'water', icon: '🌊', color: '#2f7fa0',
    cost: 140, upkeep: 4, year: 2005, homes: 0, jobs: 150,
    power: -35, water: 140, pollution: 1, happiness: 1, income: 0,
    desc: 'Reverse-osmosis plant turning seawater into drinking water — the fourth national tap. Drought-proof, but thirsty for electricity.',
  },

  // ---- Defence — the SAF, its bases and the home-grown arms industry. `defence`
  //      is military strength that offsets external THREAT; camps & bases cost
  //      upkeep (guns vs butter), the weapons works earns arms exports, and the
  //      defence lab multiplies it all through innovation. ----------------------
  military_camp: {
    name: 'Military Camp', cat: 'defence', icon: '🎖️', color: '#6a7152',
    cost: 40, upkeep: 3, year: 1966, homes: 0, jobs: 800,
    power: -6, water: -8, pollution: 2, happiness: -1, defence: 30,
    desc: 'An army camp — barracks, a parade square and training grounds. The backbone of a citizen army raised almost from nothing after independence, when the young nation has barely a couple of battalions to its name.',
  },
  naval_base: {
    name: 'Naval Base', cat: 'defence', icon: '⚓', color: '#4a5f74',
    cost: 90, upkeep: 5, year: 1967, homes: 0, jobs: 1200,
    power: -12, water: -10, pollution: 3, happiness: -1, income: 2, defence: 52,
    desc: 'A naval station guarding the sea lanes a trading nation lives or dies by. Place it on the coast. Patrol craft, later missile corvettes and submarines, secure the Strait.',
  },
  air_base: {
    name: 'Air Base', cat: 'defence', icon: '✈️', color: '#5a6470',
    cost: 130, upkeep: 7, year: 1968, homes: 0, jobs: 1000,
    power: -16, water: -8, pollution: 5, happiness: -3, defence: 68,
    desc: 'Runways, hangars and fast jets — the sharp edge of deterrence. Air power is how a small state makes any aggressor think twice ("a poisonous shrimp"). Noisy neighbours, though.',
  },
  weapons_factory: {
    name: 'Defence Industries', cat: 'defence', icon: '🏭', color: '#77664f',
    cost: 75, upkeep: 3, year: 1967, homes: 0, jobs: 1500,
    power: -20, water: -10, pollution: 8, happiness: -2, income: 11, defence: 26,
    desc: 'Ordnance and vehicle works — rifles, munitions and armour, first to equip your own army, then a real export earner. Self-reliance you can sell.',
  },
  defence_lab: {
    name: 'Defence R&D Lab', cat: 'defence', icon: '🔬', color: '#6f7a86',
    cost: 95, upkeep: 4, year: 1972, homes: 0, jobs: 600,
    power: -14, water: -8, pollution: 1, happiness: 1, income: 6, education: 6, defence: 22,
    desc: 'A national defence laboratory — radar, electronic warfare, guided weapons and drones. Innovation that multiplies the punch of every camp, ship and jet the nation fields.',
  },
};

// ---------------------------------------------------------------------------
// REALISTIC CONSTRUCTION DURATIONS — how long each building takes to build, in
// game-MONTHS, grounded in real-world timelines: an attap hut goes up in weeks;
// a whole HDB estate takes 3–5 years; a power station, container port, hospital
// or MRT line runs to several years; a new town or nuclear plant, longest of all.
// A building gives NO homes/jobs/utilities/upkeep until it tops out, so a big
// project is a real, years-long commitment. (Anything not listed — e.g. custom
// 3D landmarks — falls back to a cost/complexity estimate in buildDays.)
// ---------------------------------------------------------------------------
export const BUILD_MONTHS = {
  // Housing
  kampong: 2, shophouse: 12, terrace: 10, bungalow: 9, walkup: 24,
  hdb_flat: 42, hdb_newtown: 66, condo: 30, condo_estate: 42, hdb_highrise: 42,
  // Power
  diesel: 4, power_station: 42, solar_farm: 12, waste_energy: 36, nuclear: 72, gas_power: 36,
  // Water
  standpipe: 3, reservoir: 24, reservoir_big: 42, sewage: 18, desal: 30, newater: 24, desalination: 36,
  // Economy / industry
  godown: 8, processing: 15, factory: 15, port: 54, office: 42, mall: 30, tourism: 36,
  wafer_fab: 30, biomed_park: 30, data_centre: 24,
  // Services / civic
  community_centre: 6, clinic: 9, market: 6, police: 6, fire_station: 9, school: 15,
  tech_school: 18, colonial: 24, hospital: 42, mrt: 30, rail_station: 12, street_lamp: 1, traffic_light: 1,
  // Environment / leisure
  park: 4, community_garden: 2, forest: 3, gardens: 30, beach: 4, ferry_terminal: 15,
  marina: 18, cinema: 9, stadium: 24, hawker_centre: 6,
  // Heritage landmarks — careful restoration-grade builds
  raffles_hotel: 30, fullerton: 30, victoria_theatre: 20, sri_mariamman: 14, sultan_mosque: 16, lau_pa_sat: 14,
  bank_of_china: 34, asia_insurance: 32, finlayson_house: 26, ocean_building: 28, maritime_building: 24,
  tanjong_pagar_station: 28,
  // Farms
  market_garden: 2, poultry_farm: 2, fish_farm: 3, hydroponic_farm: 6, vertical_farm: 12,
};
for (const [k, m] of Object.entries(BUILD_MONTHS)) if (BUILDINGS[k]) BUILDINGS[k].buildMonths = m;

// ---------------------------------------------------------------------------
// INDIVIDUAL PLANTS — placed one specimen at a time (not whole forests), free and
// instant. Tropical / humid-climate species only (no temperate 4-season flora).
// Decorative: a small happiness lift near homes, no economy/grid footprint.
// ---------------------------------------------------------------------------
export const PLANTS = {
  rain_tree:     { name: 'Rain Tree',     icon: '🌳', tip: 'Broad umbrella canopy — the iconic shade tree of Singapore\'s roads.' },
  angsana:       { name: 'Angsana',       icon: '🌳', tip: 'Fast-growing flowering roadside tree with golden blooms.' },
  palm:          { name: 'Coconut Palm',  icon: '🌴', tip: 'Tall coastal palm with feathery fronds.' },
  travellers:    { name: "Traveller's Palm", icon: '🪴', tip: 'Fan of huge banana-like leaves — a tropical signature.' },
  frangipani:    { name: 'Frangipani',    icon: '🌸', tip: 'Fragrant white-and-yellow temple flowers.' },
  bougainvillea: { name: 'Bougainvillea', icon: '🌺', tip: 'Vivid magenta bracts spilling over walls all year.' },
  heliconia:     { name: 'Heliconia',     icon: '🌷', tip: 'Upright scarlet lobster-claw flowers.' },
  banana:        { name: 'Banana Clump',  icon: '🍌', tip: 'Broad paddle leaves of a backyard banana stand.' },
  fern:          { name: 'Tree Fern',     icon: '🌿', tip: 'Lush green fronds for shady corners.' },
  orchid:        { name: 'Orchid Bed',    icon: '🪻', tip: 'A planting of the national flower, Vanda Miss Joaquim.' },
};

// ---------------------------------------------------------------------------
// GROUND SURFACES — painted over the land to change its look (not its use). As a
// country urbanises (and reclaims land), green gives way to concrete, plaza tile,
// asphalt and sand. Cosmetic only: painting never changes what you can build.
// ---------------------------------------------------------------------------
export const SURFACE_TYPES = {
  concrete:  { name: 'Concrete', icon: '⬜', color: 0xb4b1a8 },
  pavement:  { name: 'Pavement', icon: '🔲', color: 0x9aa0a6 },
  plaza:     { name: 'Plaza Tile', icon: '🟫', color: 0xcaa877 },
  brick:     { name: 'Red Brick', icon: '🟧', color: 0xb0673f },
  asphalt:   { name: 'Asphalt', icon: '⬛', color: 0x55585e },
  sand:      { name: 'Sand', icon: '🟨', color: 0xe6d6a6 },
  gravel:    { name: 'Gravel', icon: '🪨', color: 0x8f8a7e },
  grass:     { name: 'Grass', icon: '🟩', color: 0x77c25a },
};

// ---------------------------------------------------------------------------
// PLAYER-DESIGNED LANDMARKS (from public/design.html)
// Each 3D design becomes a buildable building. Its construction cost — and its
// power/water demand and jobs — are derived from the design's COMPLEXITY (number
// of parts) and VOLUME (summed part volumes × scale³), so bigger, more elaborate
// buildings cost and consume more, just as the user asked.
// ---------------------------------------------------------------------------
function partVolume(p) {
  const w = p.w || 4, h = p.h || 4, d = p.d || 4;
  switch (p.type) {
    case 'cyl': return Math.PI * (w / 2) * (w / 2) * h;
    case 'pyramid': return (1 / 3) * (1.4 * w) * (1.4 * w) * h;
    case 'dome': return (2 / 3) * Math.PI * (w / 2) ** 3;
    case 'window': case 'door': return w * h * Math.max(0.3, d);
    default: return w * h * d;
  }
}
export function landmarkToBuilding(lm, i) {
  const parts = lm.parts || [], scale = lm.scale || 1, sc3 = scale * scale * scale;
  let vol = 0; for (const p of parts) vol += partVolume(p);
  vol *= sc3;
  const complexity = parts.length;
  const lit = parts.filter((p) => p.light).length;
  // cost ($M): base + volume term + complexity term
  const cost = Math.max(5, Math.round(8 + 0.06 * vol + 2.5 * complexity));
  const upkeep = Math.max(0.1, Math.round(cost * 0.03 * 10) / 10);
  // utilities scale with size & complexity (lit windows draw a little extra power)
  const power = -Math.max(1, Math.round(0.02 * vol + 0.5 * complexity + 0.4 * lit));
  const water = -Math.max(1, Math.round(0.015 * vol + 0.4 * complexity));
  const jobs = Math.round(vol * 0.4);
  const happiness = Math.min(15, 2 + Math.round(complexity / 2));
  const slug = (lm.name || 'landmark').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'landmark';
  const key = lm.id || ('lm_' + slug + '_' + i); // stable per-design id when present
  return [key, {
    name: lm.name || ('Landmark ' + (i + 1)), cat: 'landmark', icon: '🏛️',
    color: (parts[0] && parts[0].color) || '#cfc9b8',
    cost, upkeep, year: START_YEAR, homes: 0, jobs,
    power, water, pollution: 0, happiness, income: 0,
    desc: `A custom-designed landmark — ${complexity} part${complexity !== 1 ? 's' : ''}, ~${Math.round(vol)} vol${lit ? `, ${lit} lit window${lit !== 1 ? 's' : ''} (glow at night)` : ''}. Cost & utilities scale with size and complexity.`,
    landmarkParts: parts, lmScale: scale,
  }];
}

// Turn a downloaded COMMUNITY build into a buildable definition: reuse the landmark
// cost/size model, then blend in the stats implied by its chosen FUNCTIONALITY and
// stamp its ERA (so the normal build pricing factors year & condition, like anything
// else). Rendered via landmarkParts, so it looks exactly as the author designed it.
export function communityBuildToBuilding(build) {
  const d = build.design || {};
  const parts = d.parts || [];
  const scale = d.scale || build.size || 1;
  const [, base] = landmarkToBuilding({ name: build.name, parts, scale }, build.id || 'cm');
  const st = d.stats || {};
  const num = (v, fb) => (typeof v === 'number' ? v : fb);
  const key = 'cm_' + (build.id || (build.name || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return [key, {
    ...base,
    name: build.name || 'Community Build', cat: 'community', icon: FUNC_ICON[build.func] || '🏛️',
    // available to build ANY year (a player creation, not tech-gated); its price is
    // factored by the PLAYER's current year & condition, and `era` is kept for flavour.
    year: base.year, era: build.year, community: true, func: build.func || 'landmark', author: build.author || 'Anonymous',
    homes: num(st.homes, 0), jobs: num(st.jobs, base.jobs),
    power: num(st.power, base.power), water: num(st.water, base.water),
    pollution: num(st.pollution, 0), happiness: num(st.happiness, base.happiness),
    income: num(st.income, 0), upkeep: num(st.upkeep, base.upkeep), safety: num(st.safety, 0),
    desc: `A community design${build.author ? ' by ' + build.author : ''} · ${FUNC_LABEL[build.func] || 'Landmark'} · ${build.downloads || 0} downloads. Priced for its size and the ${build.year || ''} era.`,
    landmarkParts: parts, lmScale: scale,
  }];
}
for (let i = 0; i < CUSTOM_LANDMARKS.length; i++) {
  const [key, def] = landmarkToBuilding(CUSTOM_LANDMARKS[i], i);
  BUILDINGS[key] = def;
}
if (CUSTOM_LANDMARKS.length) CATEGORIES.push({ id: 'landmark', name: 'Landmarks', icon: '🏛️' });

// ---------------------------------------------------------------------------
// POLICIES & LAWS
// Each policy adjusts modifiers applied every tick. `levels` policies pick one
// option; `toggle` policies are on/off.
// ---------------------------------------------------------------------------
export const POLICIES = {
  income_tax: {
    name: 'Income Tax Rate', type: 'level', year: 1965, icon: '💰',
    desc: 'Higher taxes fill the treasury but anger citizens and slow growth. How much a rate actually RAISES depends on the economy — a high rate on a jobless, shrinking base yields little and drives citizens to emigrate; the returns are best when work is plentiful.',
    options: [
      { id: 'low', label: 'Low (5%)', fx: { taxMult: 0.6, approval: 6, growth: 0.04 } },
      { id: 'mid', label: 'Moderate (12%)', fx: { taxMult: 1.0, approval: 0, growth: 0 } },
      { id: 'high', label: 'High (20%)', fx: { taxMult: 1.6, approval: -8, growth: -0.05 } },
    ],
    default: 'mid',
  },
  gst: {
    name: 'Goods & Services Tax', type: 'toggle', year: 1994, icon: '🧾',
    desc: 'A broad consumption tax. Steady revenue, but unpopular with the cost of living.',
    fx: { gstRevenue: 1, approval: -5 },
  },
  cpf: {
    name: 'CPF Savings Scheme', type: 'level', year: 1968, icon: '🏦',
    desc: 'Compulsory savings for housing, health and retirement. As the nation ages, CPF is what lets the elderly fund their own retirement instead of leaning on the treasury.',
    options: [
      { id: 'off', label: 'Disabled', fx: {} },
      { id: 'mod', label: 'Moderate', fx: { housingAfford: 0.12, approval: 3, growth: 0.02, cpfRetire: 0.5 } },
      { id: 'high', label: 'High Contribution', fx: { housingAfford: 0.22, approval: -2, growth: 0.03, taxMult: 0.1, cpfRetire: 0.8 } },
    ],
    default: 'off',
  },
  national_service: {
    name: 'National Service', type: 'toggle', year: 1967, icon: '🎖️',
    desc: 'Compulsory military service — every son serves. It turns a tiny population into a credible citizen army, multiplying the strength of every camp and base, and steadies the nation. Mildly unpopular; costs manpower.',
    fx: { stability: 12, approval: -3, upkeep: 3, defenceMod: 0.6 },
  },
  foreign_policy: {
    name: 'International Stance', type: 'level', year: 1965, icon: '🌐',
    desc: 'How the young republic positions itself in a dangerous region and a divided world. Alignment shapes external threat, trade & investment, and how citizens feel.',
    options: [
      { id: 'nonaligned', label: 'Non-Aligned', fx: {} },
      { id: 'regional', label: 'Regional Cooperation', fx: { threatMod: -0.22, approval: 4, incomeMult: 0.05, growth: 0.02 } },
      { id: 'western', label: 'Western-Aligned', fx: { threatMod: -0.14, incomeMult: 0.12, jobsBoost: 0.05, approval: -3, migration: 0.1 } },
      { id: 'armed_neutral', label: 'Armed Neutrality', fx: { threatMod: -0.05, defenceMod: 0.25, upkeep: 5, approval: 2, stability: 6 } },
    ],
    default: 'nonaligned',
  },
  defence_budget: {
    name: 'Defence Budget', type: 'level', year: 1965, icon: '🪖',
    desc: 'How much of the national budget goes to the armed forces — the classic "guns vs butter" choice. More spending sharpens every unit\'s strength but drains the treasury.',
    options: [
      { id: 'minimal', label: 'Minimal', fx: { defenceMod: -0.25, approval: 1 } },
      { id: 'standard', label: 'Standard', fx: {} },
      { id: 'strong', label: 'Strong (≈5% of GDP)', fx: { defenceMod: 0.3, upkeep: 8, approval: -2, incomeMult: 0.04 } },
    ],
    default: 'standard',
  },
  education_policy: {
    name: 'Education Policy', type: 'level', year: 1966, icon: '📚',
    desc: 'How the nation develops its human capital.',
    options: [
      { id: 'basic', label: 'Basic Literacy', fx: { eduMult: 1.0 } },
      { id: 'bilingual', label: 'Bilingual Policy', fx: { eduMult: 1.25, growth: 0.02, upkeep: 2 } },
      { id: 'meritocracy', label: 'Meritocracy + Tech', fx: { eduMult: 1.5, growth: 0.04, upkeep: 5, productivity: 0.15 } },
    ],
    default: 'basic',
  },
  immigration: {
    name: 'Immigration Policy', type: 'level', year: 1965, icon: '🛂',
    desc: 'Foreign talent and labour fuel growth — but strain housing and harmony.',
    options: [
      { id: 'strict', label: 'Strict', fx: { migration: -0.3, approval: 4 } },
      { id: 'balanced', label: 'Balanced', fx: { migration: 0.2, approval: 0 } },
      { id: 'open', label: 'Open Doors', fx: { migration: 0.9, approval: -6, jobsBoost: 0.1, growth: 0.03 } },
    ],
    default: 'balanced',
  },
  family_policy: {
    name: 'Family Planning', type: 'level', year: 1972, icon: '👶',
    desc: 'Population policy shapes the birth rate for decades to come.',
    options: [
      { id: 'none', label: 'None', fx: { birth: 1.0 } },
      { id: 'stop2', label: '"Stop at Two"', fx: { birth: 0.6, approval: -2 } },
      { id: 'three', label: '"Have Three or More"', fx: { birth: 1.4, upkeep: 4, approval: 3 } },
    ],
    default: 'none',
  },
  healthcare: {
    name: 'Healthcare Subsidy', type: 'level', year: 1965, icon: '⚕️',
    desc: 'How much the state subsidises medical care.',
    options: [
      { id: 'low', label: 'Minimal', fx: { healthMult: 1.0 } },
      { id: 'mid', label: 'Subsidised', fx: { healthMult: 1.2, approval: 4, upkeep: 4 } },
      { id: 'high', label: 'Universal', fx: { healthMult: 1.45, approval: 8, upkeep: 9 } },
    ],
    default: 'low',
  },
  anti_corruption: {
    name: 'Anti-Corruption Drive', type: 'toggle', year: 1965, icon: '🕵️',
    desc: 'Ruthless graft-busting builds trust and attracts investment.',
    fx: { productivity: 0.1, approval: 5, stability: 8, incomeMult: 0.08 },
  },
  edb_incentives: {
    name: 'Foreign Investment Incentives', type: 'toggle', year: 1965, icon: '📈',
    desc: 'Tax incentives lure multinationals. Jobs and revenue, at a fiscal cost.',
    fx: { incomeMult: 0.15, jobsBoost: 0.12, upkeep: 6, growth: 0.03 },
  },
  press_control: {
    name: 'Press & Media Control', type: 'toggle', year: 1971, icon: '📰',
    desc: 'Tight media control boosts stability but quietly erodes approval.',
    fx: { stability: 10, approval: -4 },
  },
  car_quota: {
    name: 'Car Quota & ERP', type: 'toggle', year: 1990, icon: '🚗',
    desc: 'COE and Electronic Road Pricing curb congestion and raise revenue.',
    fx: { pollutionMult: -0.12, approval: -3, incomeMult: 0.05 },
  },
  water_conservation: {
    name: 'Water Conservation', type: 'toggle', year: 1971, icon: '🚰',
    desc: 'Campaigns and pricing cut water demand across the island.',
    fx: { waterDemandMult: -0.15, approval: -2 },
  },

  // ---- Laws & policies practised around the world, offered for the player to
  //      adopt at ANY time. `year` is only the era the idea spread globally (shown
  //      as flavour, never a lock); what each delivers depends on the nation's
  //      condition, just like the taxes above. -------------------------------
  minimum_wage: {
    name: 'Minimum Wage', type: 'toggle', year: 1938, icon: '💵',
    desc: 'A legal wage floor lifts the lowest-paid and eases poverty — popular with workers, but it raises business costs and can slow hiring.',
    fx: { approval: 5, growth: -0.02, incomeMult: -0.02 },
  },
  labour_rights: {
    name: 'Labour Rights & Unions', type: 'toggle', year: 1948, icon: '🤝',
    desc: 'Recognise unions, collective bargaining and safe workplaces. Content, motivated workers are more productive — though militancy can bite growth.',
    fx: { approval: 4, productivity: 0.05, growth: -0.02 },
  },
  free_trade: {
    name: 'Trade Policy', type: 'level', year: 1948, icon: '🚢',
    desc: 'How open the economy is to the world. Free trade grows a trading hub fastest; protectionism shelters local jobs but costs efficiency and friends.',
    options: [
      { id: 'protectionist', label: 'Protectionist', fx: { incomeMult: -0.03, jobsBoost: 0.05, approval: 2, threatMod: 0.02 } },
      { id: 'balanced', label: 'Balanced', fx: {} },
      { id: 'free', label: 'Free Trade', fx: { incomeMult: 0.09, growth: 0.03, threatMod: -0.03 } },
    ],
    default: 'balanced',
  },
  welfare_state: {
    name: 'Social Welfare', type: 'level', year: 1942, icon: '🧺',
    desc: 'How much of a safety net the state provides — unemployment relief, public assistance, subsidies. Comfort and approval, paid for with upkeep and, at the top end, higher taxes.',
    options: [
      { id: 'minimal', label: 'Self-Reliance', fx: {} },
      { id: 'safety_net', label: 'Safety Net', fx: { approval: 5, upkeep: 6, growth: -0.01 } },
      { id: 'generous', label: 'Generous', fx: { approval: 10, upkeep: 15, growth: -0.03, taxMult: 0.2 } },
    ],
    default: 'minimal',
  },
  compulsory_education: {
    name: 'Compulsory Education', type: 'toggle', year: 1870, icon: '🎒',
    desc: 'Make schooling mandatory for every child. The surest long-run investment in human capital — a small cost now for a far more skilled workforce later.',
    fx: { eduMult: 0.15, upkeep: 3, approval: 2, growth: 0.02 },
  },
  environmental_law: {
    name: 'Environmental Protection', type: 'toggle', year: 1970, icon: '🌱',
    desc: 'Emission limits, protected reserves and clean-up rules. Clears the air and wins goodwill, at a cost in upkeep and industrial growth.',
    fx: { pollutionMult: -0.18, upkeep: 4, approval: 2, growth: -0.02 },
  },
  law_and_order: {
    name: 'Tough on Crime', type: 'toggle', year: 1900, icon: '⚖️',
    desc: 'Strict policing, stiff sentencing and firm public order. Safer streets and a steadier nation — but heavy-handedness costs some goodwill.',
    fx: { safetyMod: 12, stability: 6, approval: -2 },
  },
  carbon_tax: {
    name: 'Carbon / Pollution Tax', type: 'toggle', year: 1990, icon: '🏭',
    desc: 'Price the pollution that industry emits. Nudges the economy cleaner and raises a little revenue, but businesses grumble at the added cost.',
    fx: { pollutionMult: -0.12, incomeMult: 0.03, approval: -3 },
  },
};

// ---------------------------------------------------------------------------
// AFFAIRS OF STATE — the news the Prime Minister must answer
//
// There is NO fixed replay of real history here. Instead, FOREIGN and INTERNAL
// affairs surface as briefings, driven by the state of YOUR nation and chance,
// and each one puts a decision in your hands. Every choice pushes the country's
// path — external threat, domestic unrest, growth, alliances — so which crises
// come next, and how they land, are the product of the moves you have already
// made. Two playthroughs never share the same timeline.
//
// Fields:
//   scope        'foreign' | 'internal'  (how it's framed in the briefing)
//   icon, title, body
//   atStart      fire once at the very beginning (the founding briefing)
//   once         fire at most once per game
//   minYear/maxYear  era window it can appear in (tech/period appropriate)
//   cooldownMonths   if it can recur, months before it may fire again
//   weight       base likelihood among eligible affairs
//   when(state,d) gate/weight by the nation's condition — return a falsy value
//                to skip, or a NUMBER to scale its weight (a shaky, threatened
//                nation draws more of the crises that fit its condition)
//   effects      immediate deltas applied when the briefing opens (optional)
//   choice       { prompt, options:[{ label, fx }] } — the PM's move; `fx`
//                branches the nation via treasury/approval/threatSpike/growth/
//                growthShock/incomeMult/jobsBoost/healthShock/pollutionSpike/
//                fuelShock/unrest/flag/unlockMany/spawn/project deltas.
// ---------------------------------------------------------------------------
export const AFFAIRS = [
  // ---- The founding briefing (once, at the start) --------------------------
  {
    id: 'founding', scope: 'internal', icon: '🇸🇬', atStart: true, once: true,
    title: 'A Nation Is Born',
    body: 'A young island republic stands alone: no resources, no hinterland, a tiny home market, and no guarantee it survives the decade. The whole story is unwritten — the direction is yours to set.',
    choice: {
      prompt: 'Where do you plant the flag first?',
      options: [
        { label: 'Industrialise fast — chase factories & jobs', fx: { growth: 0.03, jobsBoost: 0.05, treasury: -15, approval: 1, flag: 'industry_first' } },
        { label: 'Build institutions — clean govt, schools, housing', fx: { approval: 4, growth: 0.01, unrest: -0.06, flag: 'institutions_first' } },
        { label: 'Stay lean — hoard reserves, take no chances', fx: { treasury: 25, approval: -3, flag: 'austerity_first' } },
      ],
    },
  },

  // ======================= FOREIGN AFFAIRS =================================
  {
    id: 'border_incident', scope: 'foreign', icon: '⚔️', minYear: 1965, cooldownMonths: 40, weight: 3,
    when: (s) => 0.5 + (s.threat || 0) * 2.2,
    title: 'Forces Mass at the Strait',
    body: 'A neighbour\'s troops and gunboats mass along the water. Saboteurs strike a landmark in town. The region is watching how the small state answers a shove.',
    choice: {
      prompt: 'Your move, Prime Minister:',
      options: [
        { label: 'Stand firm — mobilise every reservist', fx: { threatSpike: 0.10, approval: 4, unrest: -0.05 } },
        { label: 'Defuse it quietly through back channels', fx: { threatSpike: -0.15, incomeMult: 0.02, approval: 1 } },
        { label: 'Seek a great power\'s protection', fx: { threatSpike: -0.22, approval: -3, flag: 'aligned' } },
      ],
    },
  },
  {
    id: 'garrison_withdrawal', scope: 'foreign', icon: '🫡', once: true, minYear: 1967, maxYear: 1974, weight: 5,
    title: 'The Foreign Garrison Will Leave',
    body: 'The great-power garrison that has shielded the island — and whose bases are nearly a fifth of the economy — announces it is pulling out. The umbrella is closing. Jobs and security must now come from home.',
    effects: { treasury: -35, approval: -5, threatSpike: 0.16 },
    choice: {
      prompt: 'How do you fill the void?',
      options: [
        { label: 'Raise a defence of our own', fx: { treasury: -15, approval: 2,
          project: { id: 'own_defence', title: 'Stand up a national defence',
            hint: 'Build 2 Military Camps and a home Defence Industries works',
            need: [{ key: 'military_camp', count: 2 }, { key: 'weapons_factory', count: 1 }],
            reward: { threatSpike: -0.14, approval: 6, jobsBoost: 0.03 } } } },
        { label: 'Turn the bases into industry & jobs', fx: { treasury: -10,
          project: { id: 'bases_to_industry', title: 'Convert the bases to industry',
            hint: 'Build a Container Port and 2 Factories on the vacated land',
            need: [{ key: 'port', count: 1 }, { key: 'factory', count: 2 }],
            reward: { jobsBoost: 0.06, growth: 0.02, approval: 4 } } } },
        { label: 'Retrench and hoard the reserves', fx: { treasury: 20, approval: -4, threatSpike: 0.04 } },
      ],
    },
  },
  {
    id: 'bloc_invite', scope: 'foreign', icon: '🤝', once: true, minYear: 1966, weight: 2.5,
    title: 'A Regional Bloc Forms',
    body: 'Neighbouring states propose a cooperation bloc — open markets, shared security, one voice in a rough neighbourhood. They want to know if the little republic is in.',
    choice: {
      prompt: 'Do you join?',
      options: [
        { label: 'Join wholeheartedly', fx: { threatSpike: -0.18, incomeMult: 0.05, growth: 0.02, flag: 'regionalist' } },
        { label: 'Join, but guard our sovereignty', fx: { threatSpike: -0.08, incomeMult: 0.02, approval: 1 } },
        { label: 'Stay fiercely independent', fx: { approval: 2, threatSpike: 0.05, flag: 'go_it_alone' } },
      ],
    },
  },
  {
    id: 'superpower_courtship', scope: 'foreign', icon: '🌐', cooldownMonths: 90, weight: 2, minYear: 1966,
    when: (s) => (s.pathFlags && s.pathFlags.aligned ? 0.4 : 1) * (0.6 + (s.threat || 0) * 1.5),
    title: 'A Superpower Comes Courting',
    body: 'A great power dangles a security pact and a wave of investment — in return for basing rights and a tilt in its direction. Nothing is free.',
    choice: {
      prompt: 'Accept the embrace?',
      options: [
        { label: 'Sign the pact — take the money & shield', fx: { incomeMult: 0.10, jobsBoost: 0.06, threatSpike: -0.16, approval: -3, flag: 'aligned' } },
        { label: 'Take the investment, dodge the alignment', fx: { incomeMult: 0.03, approval: 1 } },
        { label: 'Politely decline — stay non-aligned', fx: { approval: 3, threatSpike: 0.03, flag: 'nonaligned_proud' } },
      ],
    },
  },
  {
    id: 'oil_shock', scope: 'foreign', icon: '🛢️', minYear: 1970, cooldownMonths: 60, weight: 2,
    title: 'Oil Shock',
    body: 'A cartel far away chokes the taps and the price of every barrel leaps. For an island that imports every drop of fuel, the energy bill detonates.',
    effects: { fuelShock: 1.3, treasury: -35, approval: -3 },
    choice: {
      prompt: 'How do you cushion the blow?',
      options: [
        { label: 'Subsidise fuel to shield households', fx: { treasury: -45, approval: 5 } },
        { label: 'Push conservation & home-grown power', fx: { growth: 0.02, approval: -1, flag: 'energy_secure' } },
        { label: 'Let prices bite, bank the savings', fx: { treasury: 15, approval: -6, unrest: 0.05 } },
      ],
    },
  },
  {
    id: 'global_downturn', scope: 'foreign', icon: '📉', minYear: 1974, cooldownMonths: 84, weight: 2.5,
    when: (s) => 0.7 + ((s.economy && s.economy.currency ? (1.4 - s.economy.currency) : 0) > 0 ? 0.6 : 0),
    title: 'The World Economy Seizes Up',
    body: 'Trade and finance freeze abroad. Order books empty, capital flees to safety, and an export economy feels the cold first.',
    effects: { growthShock: -0.07, treasury: -60, approval: -5 },
    choice: {
      prompt: 'Your response to the slump:',
      options: [
        { label: 'Stimulus — spend to save jobs', fx: { treasury: -60, growth: 0.04, approval: 3 } },
        { label: 'Austerity — protect the reserves', fx: { treasury: 30, approval: -5, growthShock: -0.02, unrest: 0.05 } },
        { label: 'Retrain & climb the value chain', fx: { growth: 0.03, approval: -1, flag: 'upskilled' } },
      ],
    },
  },
  {
    id: 'trade_dispute', scope: 'foreign', icon: '🚢', minYear: 1972, cooldownMonths: 72, weight: 1.8,
    title: 'A Big Partner Slaps On Tariffs',
    body: 'A major trading partner throws up a wall of tariffs, and a fat slice of exports is suddenly priced out. Retaliate, adapt, or swallow it?',
    effects: { growthShock: -0.03, treasury: -20 },
    choice: {
      prompt: 'How do you answer the tariffs?',
      options: [
        { label: 'Hit back with our own tariffs', fx: { approval: 2, threatSpike: 0.03, growthShock: -0.02 } },
        { label: 'Open new markets & a bigger port', fx: { growth: 0.02,
          project: { id: 'new_markets', title: 'Chase new export markets',
            hint: 'Expand the gateway: build a Container Port and a Business District',
            need: [{ key: 'port', count: 1 }, { key: 'office', count: 1 }], reward: { incomeMult: 0.06, jobsBoost: 0.04 } } } },
        { label: 'Concede to keep the peace', fx: { approval: -3, incomeMult: 0.01 } },
      ],
    },
  },
  {
    id: 'refugee_influx', scope: 'foreign', icon: '⛵', minYear: 1975, cooldownMonths: 96, weight: 1.5,
    when: (s) => 0.4 + (s.threat || 0) * 1.6,
    title: 'Refugees Reach Our Shores',
    body: 'Conflict up the coast sends boatloads of desperate people to your waters. The world is watching how a rich little state responds.',
    choice: {
      prompt: 'What do you do?',
      options: [
        { label: 'Take them in and resettle them', fx: { growth: 0.02, approval: -3, unrest: 0.05, flag: 'humanitarian' } },
        { label: 'Grant safe passage, process a few', fx: { approval: 1, incomeMult: 0.01 } },
        { label: 'Turn the boats away', fx: { approval: 2, threatSpike: 0.04, flag: 'hardline' } },
      ],
    },
  },
  {
    id: 'water_dispute', scope: 'foreign', icon: '🚰', minYear: 1965, cooldownMonths: 72, weight: 2,
    when: (s, d) => 0.6 + (d && d.waterRatio < 1 ? 1.4 : 0),
    title: 'The Water Tap Is Weaponised',
    body: 'A neighbour who sells you much of your drinking water hints it could turn off the tap in a quarrel. Nothing concentrates the mind like thirst.',
    choice: {
      prompt: 'Secure the water supply?',
      options: [
        { label: 'Race for water self-sufficiency', fx: { treasury: -15, approval: 2, unlockMany: ['reservoir_big'],
          project: { id: 'water', title: 'Achieve water self-sufficiency',
            hint: 'Build a Major Reservoir and 2 sets of Water Mains (Build › Water)',
            need: [{ key: 'reservoir_big', count: 1 }, { key: 'standpipe', count: 2 }], reward: { approval: 6, flag: 'water_secure' } } } },
        { label: 'Negotiate a long supply treaty', fx: { treasury: -10, approval: 1, incomeMult: 0.01 } },
        { label: 'Keep relying on imports', fx: { approval: -4, threatSpike: 0.03 } },
      ],
    },
  },
  {
    id: 'haze', scope: 'foreign', icon: '🌫️', minYear: 1980, cooldownMonths: 48, weight: 1.6,
    title: 'Transboundary Haze',
    body: 'Smoke from fires burning across the border blankets the island. The sky yellows, the airport dims, and every clinic fills with coughing residents.',
    effects: { pollutionSpike: 14, approval: -4, healthShock: -6 },
    choice: {
      prompt: 'How do you handle the haze?',
      options: [
        { label: 'Fund firefighting & press the neighbour', fx: { treasury: -20, approval: 3, incomeMult: 0.01 } },
        { label: 'Hand out masks and wait it out', fx: { approval: -3, healthShock: -4 } },
      ],
    },
  },
  {
    id: 'arms_order', scope: 'foreign', icon: '🎯', minYear: 1975, cooldownMonths: 54, weight: 1.6,
    when: (s, d) => (d && d.counts && d.counts.weapons_factory > 0) ? 2.5 : 0,
    title: 'An Arms Export Order',
    body: 'A foreign government wants to buy from your defence works — rifles, munitions, armoured vehicles. Good money, and a vote of confidence in home-grown technology.',
    choice: {
      prompt: 'Fill the order?',
      options: [
        { label: 'Sell freely — money talks', fx: { treasury: 70, threatSpike: 0.04, approval: -1 } },
        { label: 'Sell only to friends', fx: { treasury: 40, approval: 2, flag: 'ethical_arms' } },
        { label: 'Decline on principle', fx: { approval: 3 } },
      ],
    },
  },

  // ======================= INTERNAL AFFAIRS ===============================
  {
    id: 'labour_unrest', scope: 'internal', icon: '✊', minYear: 1965, cooldownMonths: 36, weight: 3,
    when: (s, d) => 0.4 + (d ? d.unemployment * 8 : 0) + (s.unrest || 0) * 2,
    title: 'The Unions Down Tools',
    body: 'Wildcat strikes spread from the docks to the factories. Wages have not kept up, tempers have, and the wharves fall silent.',
    choice: {
      prompt: 'How do you break the deadlock?',
      options: [
        { label: 'Face down the strike, keep order', fx: { approval: -4, unrest: -0.12, growth: 0.02, flag: 'firm_hand' } },
        { label: 'Broker a tripartite wage pact', fx: { treasury: -20, approval: 4, unrest: -0.16, growth: -0.01, flag: 'tripartite' } },
        { label: 'Concede to the workers\' demands', fx: { approval: 5, growth: -0.03, unrest: -0.10 } },
      ],
    },
  },
  {
    id: 'housing_crunch', scope: 'internal', icon: '🏚️', minYear: 1965, cooldownMonths: 48, weight: 3,
    when: (s, d) => (d && d.housingPressure > 1) ? (1 + (d.housingPressure - 1) * 4) : 0.3,
    title: 'A Housing Crisis Boils Over',
    body: 'Families are doubling up in the kampongs, squatter colonies spread, and rents bite. The overcrowding is turning into anger on the streets.',
    choice: {
      prompt: 'How do you house the people?',
      options: [
        { label: 'Launch a mass public-housing drive', fx: { treasury: -20, approval: 2, unlockMany: ['hdb_flat', 'hdb_newtown'],
          project: { id: 'housing_drive', title: 'Rehouse the nation',
            hint: 'Build 3 HDB Flats (or an HDB New Town) to clear the crunch',
            need: [{ key: 'hdb_flat', count: 3 }], reward: { approval: 8, unrest: -0.2 } } } },
        { label: 'Impose rent controls', fx: { approval: 4, growth: -0.02, unrest: -0.06 } },
        { label: 'Leave it to the market', fx: { approval: -6, unrest: 0.14 } },
      ],
    },
  },
  {
    id: 'communal_tension', scope: 'internal', icon: '🕊️', minYear: 1965, cooldownMonths: 60, weight: 2,
    when: (s) => 0.3 + (s.unrest || 0) * 3,
    title: 'Communal Tensions Flare',
    body: 'Rumours race through the neighbourhoods and scuffles break out between communities. A single spark could set the town alight; a curfew is on the table.',
    choice: {
      prompt: 'How do you keep the peace?',
      options: [
        { label: 'A drive for integration & harmony', fx: { treasury: -15, approval: 4, unrest: -0.18, flag: 'harmony' } },
        { label: 'Curfew and heavy policing', fx: { approval: -3, unrest: -0.14, flag: 'firm_hand' } },
        { label: 'Appeal for calm and hope it holds', fx: { approval: 0, unrest: -0.04 } },
      ],
    },
  },
  {
    id: 'corruption_scandal', scope: 'internal', icon: '💼', minYear: 1966, cooldownMonths: 72, weight: 1.8,
    when: (s) => (s.policies && s.policies.anti_corruption) ? 0.4 : 2,
    title: 'A Minister Is Caught',
    body: 'A senior official is exposed with his hand deep in the till. The press is circling, the public is disgusted, and every investor is watching what you do next.',
    choice: {
      prompt: 'How do you respond?',
      options: [
        { label: 'Prosecute without mercy', fx: { approval: 5, incomeMult: 0.05, unrest: -0.10, flag: 'clean_govt' } },
        { label: 'Quiet reshuffle, no headlines', fx: { approval: -2, unrest: 0.06 } },
        { label: 'Bury it and protect your own', fx: { approval: -6, incomeMult: -0.03, unrest: 0.14, flag: 'graft' } },
      ],
    },
  },
  {
    id: 'epidemic', scope: 'internal', icon: '🦠', minYear: 1966, cooldownMonths: 66, weight: 2,
    when: (s, d) => 0.6 + (d && d.healthCap < d.homes / 3000 ? 1.2 : 0),
    title: 'An Epidemic Hits the Wards',
    body: 'A fast-spreading disease overwhelms the hospitals. Beds run out, the sick queue in corridors, and fear empties the streets.',
    effects: { healthShock: -16, approval: -4 },
    choice: {
      prompt: 'How do you fight the outbreak?',
      options: [
        { label: 'Lockdown & contact-trace hard', fx: { growthShock: -0.05, healthShock: 10, approval: -1 } },
        { label: 'Rush up isolation hospitals', fx: { treasury: -40, healthShock: 6, approval: 2, spawn: [ { key: 'hospital', cx: 0.470, cy: 0.430 }, { key: 'clinic', cx: 0.488, cy: 0.446 } ] } },
        { label: 'Ride it out, keep the economy open', fx: { healthShock: -8, approval: -5, unrest: 0.06 } },
      ],
    },
  },
  {
    id: 'baby_bust', scope: 'internal', icon: '👶', minYear: 1982, cooldownMonths: 120, weight: 1.6,
    when: (s, d) => (d && (d.dependency || 0) > 0.62) ? 2 : 0.5,
    title: 'The Birth Rate Collapses',
    body: 'Couples are having fewer children, later, or none. The maths is merciless: in a generation the workforce shrinks and the old outnumber the young.',
    choice: {
      prompt: 'How do you answer the demographic squeeze?',
      options: [
        { label: 'Pro-family baby bonuses & leave', fx: { treasury: -30, approval: 2, growth: 0.01, flag: 'pronatal' } },
        { label: 'Open the doors to migrants', fx: { growth: 0.03, approval: -4, unrest: 0.06, flag: 'open_migration' } },
        { label: 'Automate & lift productivity', fx: { growth: 0.02, approval: -1, flag: 'automation' } },
      ],
    },
  },
  {
    id: 'flash_floods', scope: 'internal', icon: '🌊', minYear: 1965, cooldownMonths: 42, weight: 1.8,
    title: 'Flash Floods',
    body: 'A monsoon downpour overwhelms the drains. Low-lying streets vanish under brown water, shophouses are swamped, and the clean-up bill mounts.',
    effects: { treasury: -25, approval: -3 },
    choice: {
      prompt: 'How do you respond?',
      options: [
        { label: 'Build proper canals & drainage', fx: { treasury: -25, approval: 3, growth: 0.01, flag: 'drained' } },
        { label: 'Patch it up and hope', fx: { approval: -3, unrest: 0.05 } },
      ],
    },
  },
  {
    id: 'fdi_courtship', scope: 'internal', icon: '🏭', minYear: 1968, cooldownMonths: 54, weight: 2,
    title: 'A Multinational Comes Knocking',
    body: 'A major electronics multinational is scouting the region for a base — thousands of jobs, and a signal to every other firm watching.',
    choice: {
      prompt: 'Offer them a deal?',
      options: [
        { label: 'Roll out a generous tax holiday', fx: { treasury: -30, incomeMult: 0.05, approval: 3,
          project: { id: 'fdi', title: 'Host the multinational',
            hint: 'Build a Factory for the firm to set up in',
            need: [{ key: 'factory', count: 1 }], reward: { jobsBoost: 0.06, growth: 0.02 } } } },
        { label: 'Standard terms, no giveaways', fx: { incomeMult: 0.02, approval: 1 } },
        { label: 'Decline — keep our leverage', fx: { approval: 0 } },
      ],
    },
  },
  {
    id: 'student_unrest', scope: 'internal', icon: '📣', minYear: 1966, maxYear: 1990, cooldownMonths: 60, weight: 1.4,
    when: (s) => 0.3 + (s.unrest || 0) * 2.2,
    title: 'Students Take to the Streets',
    body: 'The campuses are in ferment — rallies, boycotts, and a list of demands. Idealism, or the thin end of something worse, depending on who you ask.',
    choice: {
      prompt: 'How do you meet the moment?',
      options: [
        { label: 'Open a dialogue and reform', fx: { approval: 3, unrest: -0.12, flag: 'reformist' } },
        { label: 'Clamp down hard', fx: { approval: -3, unrest: -0.14, flag: 'authoritarian' } },
      ],
    },
  },

  // ---- Positive fortune (no choice — just good news) -----------------------
  {
    id: 'export_boom', scope: 'internal', icon: '📈', minYear: 1970, cooldownMonths: 36, weight: 1.4,
    when: (s, d) => (d && d.unemployment < 0.06) ? 1.6 : 0.6,
    title: 'Export Boom',
    body: 'Global demand for your goods surges. Order books are full, the port runs day and night, and the treasury swells.',
    effects: { treasury: 60, approval: 3 },
  },
  {
    id: 'budget_windfall', scope: 'internal', icon: '💰', minYear: 1972, cooldownMonths: 48, weight: 1.2,
    when: (s) => (s.treasury > 300) ? 1.5 : 0.6,
    title: 'A Surplus Windfall',
    body: 'Prudent reserves and strong revenue deliver an unexpected surplus. The books are healthier than the forecasts dared hope.',
    effects: { treasury: 80, approval: 3 },
  },
];
