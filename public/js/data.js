// Game content: buildings, policies, and historical events.
// All tuning lives here so the simulation in engine.js stays generic.
import { CUSTOM_LANDMARKS } from './custom1966.js';

export const START_YEAR = 1965;
export const START_DATE = { y: 1965, m: 8, d: 9 }; // National Day: 9 Aug 1965
export const GRID_SIZE = 160;  // a much larger island so roads & buildings sit at a realistic, small human scale

// Each "citizen" in state represents ~10 real people; display multiplies by 10.
export const POP_SCALE = 10;

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
  { id: 'green', name: 'Environment', icon: '🌳' },
  { id: 'leisure', name: 'Coast & Leisure', icon: '⛱️' },
  { id: 'roads', name: 'Roads', icon: '🛣️' },
  { id: 'land', name: 'Reclaim', icon: '🏝️' },
];

// Freeform road types the player can draw.
export const ROAD_TYPES = {
  street:  { name: 'Street',  lanes: 2, width: 2.4, speed: 9,  cost: 6,  asphalt: '#3a3e45' },
  avenue:  { name: 'Avenue',  lanes: 4, width: 4.0, speed: 13, cost: 14, asphalt: '#34373d' },
  highway: { name: 'Highway', lanes: 6, width: 5.6, speed: 20, cost: 26, asphalt: '#2e3137' },
  railway: { name: 'Railway', lanes: 1, width: 2.6, speed: 0,  cost: 30, asphalt: '#5b5040', rail: true },
};

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

export const BUILDINGS = {
  // ---- Housing ----
  kampong: {
    name: 'Kampong', cat: 'residential', icon: '🛖', color: '#8d6e4f',
    cost: 5, upkeep: 0.2, year: 1965, homes: 1200, jobs: 0,
    power: -1, water: -2, pollution: 1, happiness: 2,
    desc: 'A cluster of attap-roofed village huts on stilts. Cheap, but cramped and prone to fire & flooding.',
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
    desc: 'Public housing block from the Housing & Development Board. Affordable homes for the masses.',
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

  // ---- Water ----
  reservoir: {
    name: 'Reservoir', cat: 'water', icon: '🦆', color: '#4f93c4',
    cost: 30, upkeep: 0.5, year: 1965, homes: 0, jobs: 10,
    power: -2, water: 80, pollution: -2, happiness: 3,
    desc: 'Catches rainwater. Cheap and clean, but limited by the weather.',
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
    desc: 'Light manufacturing in industrial estates like Jurong. Jobs and exports, with pollution.',
  },
  port: {
    name: 'Container Port', cat: 'industry', icon: '🚢', color: '#5a7a8c',
    cost: 220, upkeep: 5.0, year: 1965, homes: 0, jobs: 5000,
    power: -40, water: -10, pollution: 8, happiness: -1, income: 22,
    desc: 'A world-class transhipment hub. Enormous revenue and jobs — Singapore\'s lifeline.',
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
    desc: 'A grand British colonial civic hall with columns and a clock tower — the administrative seat inherited from the empire.',
  },
  mrt: {
    name: 'MRT Station', cat: 'civic', icon: '🚇', color: '#5db85d',
    cost: 100, upkeep: 2.0, year: 1987, homes: 0, jobs: 200,
    power: -20, water: -4, pollution: -3, happiness: 8, education: 0,
    desc: 'Mass Rapid Transit. Cuts congestion and pollution, and boosts happiness citywide.',
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
    desc: 'Higher taxes fill the treasury but anger citizens and slow growth.',
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
    desc: 'Compulsory savings for housing, health and retirement.',
    options: [
      { id: 'off', label: 'Disabled', fx: {} },
      { id: 'mod', label: 'Moderate', fx: { housingAfford: 0.12, approval: 3, growth: 0.02 } },
      { id: 'high', label: 'High Contribution', fx: { housingAfford: 0.22, approval: -2, growth: 0.03, taxMult: 0.1 } },
    ],
    default: 'off',
  },
  national_service: {
    name: 'National Service', type: 'toggle', year: 1967, icon: '🎖️',
    desc: 'Compulsory military service. Essential defence & stability; mild unpopularity.',
    fx: { stability: 12, approval: -3, upkeep: 3 },
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
    name: 'Anti-Corruption (CPIB)', type: 'toggle', year: 1965, icon: '🕵️',
    desc: 'Ruthless graft-busting builds trust and attracts investment.',
    fx: { productivity: 0.1, approval: 5, stability: 8, incomeMult: 0.08 },
  },
  edb_incentives: {
    name: 'Foreign Investment (EDB)', type: 'toggle', year: 1965, icon: '📈',
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
};

// ---------------------------------------------------------------------------
// HISTORICAL & RANDOM EVENTS
// `year/month` scheduled events fire once. Random events draw from the pool.
// effects: flat deltas; choices: optional player decisions.
// ---------------------------------------------------------------------------
export const HISTORICAL_EVENTS = [
  {
    id: 'separation', y: 1965, m: 8, title: 'A Nation Is Born',
    body: 'On 9 August 1965, Singapore separates from Malaysia. With no natural resources and a tiny domestic market, survival is not guaranteed. The nation is in your hands.',
    effects: { approval: 2 },
  },
  {
    id: 'british_withdrawal', y: 1968, m: 1, title: 'British Forces Withdraw',
    body: 'Britain announces it will pull its military out "East of Suez". Their bases were ~20% of the economy. You must create jobs fast.',
    effects: { treasury: -40, approval: -6 },
    choice: {
      prompt: 'How do you respond?',
      options: [
        { label: 'Convert bases to industry (Jurong)', fx: { treasury: -20, jobsBoost: 0.08, approval: 4 } },
        { label: 'Austerity & caution', fx: { treasury: 20, approval: -4 } },
      ],
    },
  },
  {
    id: 'oil_crisis', y: 1973, m: 10, title: '1973 Oil Crisis',
    body: 'OPEC quadruples oil prices. Power and fuel costs surge worldwide.',
    effects: { treasury: -60, approval: -5, pollutionSpike: 0 },
  },
  {
    id: 'mrt_debate', y: 1982, m: 5, title: 'The Great MRT Debate',
    body: 'Should Singapore spend billions on a Mass Rapid Transit system, or stick with buses?',
    choice: {
      prompt: 'Approve the MRT?',
      options: [
        { label: 'Build the MRT (-$200M)', fx: { treasury: -200, unlock: 'mrt', approval: 6, growth: 0.03 } },
        { label: 'Buses are enough', fx: { approval: -3 } },
      ],
    },
  },
  {
    id: 'recession_85', y: 1985, m: 1, title: '1985 Recession',
    body: 'Singapore enters its first post-independence recession. Output shrinks for the first time.',
    effects: { treasury: -90, approval: -7, growthShock: -0.06 },
  },
  {
    id: 'afc', y: 1997, m: 7, title: 'Asian Financial Crisis',
    body: 'Currencies collapse across the region. Capital flees and trade slumps.',
    effects: { treasury: -150, approval: -8, growthShock: -0.08 },
  },
  {
    id: 'sars', y: 2003, m: 3, title: 'SARS Outbreak',
    body: 'A deadly respiratory virus spreads through the region. Hospitals are overwhelmed.',
    effects: { treasury: -80, approval: -6, healthShock: -25 },
  },
  {
    id: 'gfc', y: 2008, m: 9, title: 'Global Financial Crisis',
    body: 'Lehman Brothers collapses. Global trade and finance seize up.',
    effects: { treasury: -160, approval: -7, growthShock: -0.07 },
  },
  {
    id: 'covid', y: 2020, m: 2, title: 'COVID-19 Pandemic',
    body: 'A global pandemic forces a "Circuit Breaker" lockdown. The economy and borders shut.',
    effects: { treasury: -220, approval: -9, growthShock: -0.1, healthShock: -20 },
  },
];

export const RANDOM_EVENTS = [
  {
    id: 'flood', title: 'Flash Floods', minYear: 1965,
    body: 'Monsoon rains overwhelm the drains. Low-lying areas are flooded.',
    effects: { treasury: -25, approval: -4 },
  },
  {
    id: 'dengue', title: 'Dengue Outbreak', minYear: 1966,
    body: 'A surge in dengue cases strains clinics and worries residents.',
    effects: { approval: -3, healthShock: -8 },
  },
  {
    id: 'fdi', title: 'Multinational Comes Knocking', minYear: 1968,
    body: 'A major electronics multinational is scouting for a regional base.',
    choice: {
      prompt: 'Offer them a deal?',
      options: [
        { label: 'Generous tax holiday', fx: { treasury: -30, jobsBoost: 0.06, incomeMult: 0.05, approval: 3 } },
        { label: 'Decline', fx: {} },
      ],
    },
  },
  {
    id: 'boom', title: 'Export Boom', minYear: 1970,
    body: 'Global demand for your exports surges this quarter.',
    effects: { treasury: 60, approval: 3 },
  },
  {
    id: 'haze', title: 'Transboundary Haze', minYear: 1991,
    body: 'Smoke from regional fires blankets the island. Air quality plummets.',
    effects: { approval: -5, pollutionSpike: 14, healthShock: -6 },
  },
  {
    id: 'water_dispute', title: 'Water Price Dispute', minYear: 1965,
    body: 'A dispute over imported water reminds everyone how vulnerable supply is.',
    effects: { approval: -4 },
  },
  {
    id: 'grant', title: 'Budget Surplus Windfall', minYear: 1972,
    body: 'Prudent reserves and strong revenue deliver an unexpected surplus.',
    effects: { treasury: 80, approval: 4 },
  },
];
