// 3D city renderer for SGSimulation, built on Three.js.
// Renders Singapore as an island landmass; buildings rise when constructed and
// crumble (with dust) when demolished; traffic drives the streets; and natural
// disasters (floods, haze, storms) are animated. Mirrors the small API that
// main.js expects from the old 2D view.
import * as THREE from './vendor/three.module.js';
import { BUILDINGS, GRID_SIZE, WORLD_SIZE, ROAD_TYPES, fleetEra } from './data.js';
import { smoothRoute } from './engine.js';
import { SG_OUTLINE, SG_ISLANDS, SG_FOREIGN, SG_SANDS, SG_RESERVOIRS, pointInPolygon, landMask, inReservoir, reservoirArea, inRiver, reservoirBranches, riverBranches } from './shape.js';
import { CUSTOM_HOUSES, CUSTOM_RAILWAYS, CUSTOM_SANDS, CUSTOM_LANDMARKS, SEED_1965 } from './custom1966.js';
import { ROAD_NODES_1966, ROAD_EDGES_1966 } from './roads1966.js';

// Build one part of a designed landmark (shared shape set with design.html).
function makeLandmarkPart(p, toonMat) {
  const w = p.w || 4, h = p.h || 4, d = p.d || 4; let geo, yoff = h / 2, extraRot = 0;
  switch (p.type) {
    case 'cyl': geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 20); break;
    case 'pyramid': geo = new THREE.ConeGeometry(w * 0.7, h, 4); extraRot = Math.PI / 4; break;
    case 'dome': geo = new THREE.SphereGeometry(w / 2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); yoff = 0; break;
    case 'window': case 'door': geo = new THREE.BoxGeometry(w, h, Math.max(0.3, d)); break; // thin facade panel
    default: geo = new THREE.BoxGeometry(w, h, d);
  }
  const col = typeof p.color === 'string' ? parseInt(p.color.slice(1), 16) : (p.color ?? 0xcfc9b8);
  // Parts flagged `light` (lit windows/signs) glow warm after dark via the
  // global night-glow pass; everything else uses a plain toon material.
  const m = new THREE.Mesh(geo, p.light ? litMat(col) : toonMat(col));
  m.castShadow = p.type !== 'window' && p.type !== 'door'; m.receiveShadow = true;
  m.position.set(p.x || 0, (p.y || 0) + yoff, p.z || 0); m.rotation.y = (p.rot || 0) + extraRot;
  return m;
}
import { HEIGHTS_1966 } from './heights1966.js';

// Bilinear sample of the 1966 contour-derived heightfield (world units) at a
// normalised island point (nx east, ny north). Covers the whole island.
function demHeight(nx, ny) {
  const D = HEIGHTS_1966;
  const u = (nx - D.x0) / (D.x1 - D.x0) * (D.w - 1);
  const v = (ny - D.y1) / (D.y0 - D.y1) * (D.h - 1);   // y1 = top row (north)
  if (u < 0 || v < 0 || u > D.w - 1 || v > D.h - 1) return 0;
  const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(D.w - 1, x0 + 1), y1 = Math.min(D.h - 1, y0 + 1);
  const fx = u - x0, fy = v - y0, d = D.data;
  const h00 = d[y0 * D.w + x0], h10 = d[y0 * D.w + x1], h01 = d[y1 * D.w + x0], h11 = d[y1 * D.w + x1];
  return (h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy) * D.scale;
}

const N = GRID_SIZE;
const WORLD = WORLD_SIZE;     // island bounding box in world units — FIXED regardless of grid resolution
const TILE = WORLD / N;       // size of one grid cell in world units (2.5 at a 640 grid)
// Building models are authored for the old ~10-unit cell; scale them to the live
// cell so a building sits in roughly one cell on whatever grid resolution we use.
const MODEL_SCALE = TILE / 10;
// Snap/relocate reach in CELLS for a ~110-unit world distance — so heritage seeds
// that miss land/roads search the same physical area regardless of grid resolution.
const SNAP_R = Math.max(8, Math.round(110 / TILE));
const SEA_Y = -1.2;
const SEA_COLOR = 0x3aa0d8;   // shared by the sea, river, reservoirs & coastal inlets
const DAY_CYCLE = 1;          // one full day/night cycle per in-game day (locked to the calendar)
const LIGHT_YEAR = 1965;      // junction traffic lights are present from the start (SG had them since the 1930s)
const MRT_DECK_CLEAR = 6.3 * MODEL_SCALE;            // deck clearance = the station's concourse-floor height, so the two meet
const MRT_MAX_SLOPE = Math.tan(20 * Math.PI / 180);  // viaduct never climbs/falls steeper than 20°
const MRT_TRACK_GAUGE = 0.32;                        // half-spacing of the two tracks: a train sits this far off the deck centre, so up- and down-trains pass

// reusable scratch objects for per-frame orientation maths (so trains & stations can
// be PITCHED onto the grade without allocating vectors every frame)
const _AX = new THREE.Vector3(), _AY = new THREE.Vector3(), _AZ = new THREE.Vector3();
const _BASIS = new THREE.Matrix4(), _WORLD_UP = new THREE.Vector3(0, 1, 0);

// Land mask for the grid. On fine grids (cell << 10) the 869-vertex coastline test
// is far too slow per-cell, so compute it at a ~10-unit resolution and upsample —
// the coastline detail is unchanged from the old grid, only placement gets finer.
function buildLandMask(n) {
  if (n < 320) return landMask(n);
  const step = Math.round(n / 160), C = Math.ceil(n / step);
  const cm = landMask(C);
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let y = 0; y < n; y++) { const src = cm[Math.min(C - 1, (y / step) | 0)], row = m[y]; for (let x = 0; x < n; x++) row[x] = src[Math.min(C - 1, (x / step) | 0)]; }
  return m;
}
// grid cell (gx,gy) -> world centre
function cellToWorld(gx, gy) {
  const nx = (gx + 0.5) / N, ny = (gy + 0.5) / N;
  return { x: (nx - 0.5) * WORLD, z: (0.5 - ny) * WORLD };
}
// grid corner (i,j) in 0..N -> world position (roads run along these borders)
function cornerToWorld(i, j) {
  return { x: (i / N - 0.5) * WORLD, z: (0.5 - j / N) * WORLD };
}
// shortest distance from point (px,pz) to segment (ax,az)-(bx,bz)
function segPointDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
// Hermite smoothstep; edge0 may be > edge1 (gives a falling ramp).
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Central Catchment terrain: the nature-reserve hills wrapping the reservoirs,
// traced from the 1965 topographic survey (IMG_3358). Each hill centre is in
// normalised island coords (x east, y north) with a peak height (world units)
// and a gaussian spread (normalised). Bukit Timah — Singapore's highest point —
// dominates the south-west, with the Bukit Panjang/Gombak ridges to its north
// and lower rises ringing MacRitchie, Peirce and Seletar.
// The catchment runs as a NORTH–SOUTH spine (taller than it is wide): Bukit
// Timah anchors the south, the ridges step north past MacRitchie and the Peirce
// reservoirs up toward Seletar.
const SG_HILLS = [
  { x: 0.382, y: 0.408, h: 22, s: 0.050 }, // Bukit Timah (south, highest)
  { x: 0.358, y: 0.470, h: 13, s: 0.046 }, // Bukit Gombak / Panjang (west spur)
  { x: 0.410, y: 0.445, h: 13, s: 0.050 }, // south-central ridge
  { x: 0.420, y: 0.490, h: 12, s: 0.050 }, // central ridge (Peirce / MacRitchie)
  { x: 0.432, y: 0.532, h: 11, s: 0.050 }, // central-north ridge
  { x: 0.448, y: 0.572, h: 10, s: 0.048 }, // north ridge toward Seletar
  { x: 0.452, y: 0.610, h:  8, s: 0.044 }, // far-north tail
];
const HILL_CENTER = [0.412, 0.498]; // ellipse centre (~reservoir-cluster centre)
const HILL_RX = 0.135;              // east–west half-extent (narrow)
const HILL_RY = 0.205;              // north–south half-extent (long) — N–S elongated
const HILL_MAXH = 22;               // tallest peak, for elevation colour banding

// Singapore (Paya Lebar) Airport — the long pale strip in the east of the 1965
// survey map. The runway runs roughly N–S (tilted ~16° NNE–SSW); a rectangular
// apron parks the aircraft beside it, linked by five short connector taxiways,
// with two terminal buildings set back on the inland (west) side. Centreline
// endpoints in NORMALISED island coords (south → north).
const AIRPORT = {
  south: { x: 0.581, y: 0.493 }, north: { x: 0.605, y: 0.553 }, // Paya Lebar runway centreline (georeferenced from the 1966 sheet)
  rwHalfW: 4.5,        // runway half-width (world units)
  overrun: 4,          // paved overrun past each threshold
  taxiOff: 9,          // continuous parallel taxiway offset (localX, inland of runway)
  taxiHalfW: 1.6,      // parallel-taxiway half-width
  apronOff: 15,        // apron centre offset across the runway, inland (+localX)
  apronHalfW: 8,       // apron half-width
  apronHalfL: 12,      // apron half-length (a compact parking, toward one end)
  apronCzFrac: -0.1,   // apron/building cluster offset along the runway (× runway half-length)
  apronLinks: 4,       // short links from the apron to the parallel taxiway
  linkW: 2.4,          // taxiway/link width
  pierOff: 19,         // finger-pier offset (aircraft dock against it)
  termOff: 30,         // terminal offset (rotated 90°: tower toward the apron, slab inland)
  carparkOff: 36,      // landside car park offset
  hangarOff: 33,       // maintenance hangars offset, inland
  termScale: 0.6,      // terminal/hangar shrunk toward normal building scale
  planeScale: 0.46,    // airliners ~one building-length (a touch smaller than the terminals)
  scale: 0.62,         // master shrink: the 1955/66 field was tiny next to the island, so the whole complex is scaled down
  // Hand-placed buildings (from the tracer) override the procedural cluster.
  // Each: { type, cx, cy, w, h, rot, hgt } — centre in normalised island coords,
  // w/h normalised footprint, rot radians, hgt height multiplier.
  buildings: [],
};

export class Scene3D {
  constructor(canvas, { onTileTap, onGroundTap } = {}) {
    this.canvas = canvas;
    this.onTileTap = onTileTap;
    this.onGroundTap = onGroundTap;       // freeform road drawing taps
    this.roadMode = false;
    this.edgePts = []; this.edgeLen = []; this.edgeMeta = []; this.edgeN1 = []; this.edgeN2 = []; this.edgeMid = []; this.navAdj = []; this.navNodes = [];
    this.state = null;
    this.land = buildLandMask(N);
    this.buildings = new Map();   // "x,y" -> { group, key }
    this.sites = new Map();       // "x,y" -> active construction site (rising mesh + scaffold + crane)
    this.anims = [];              // active construction/demolition tweens
    this.vehicles = [];
    this.dust = [];
    this.previewKey = null;
    this.bulldoze = false;
    this.shortages = { power: false, water: false };
    this.ghost = null;
    this.hoverCell = null;
    this.disaster = null;
    this.people = [];            // pedestrians (shown when zoomed in)
    this.peopleOn = false;
    this.clouds = [];
    this.gameDays = 0.36 * DAY_CYCLE; // drives day/night; advanced by the sim clock
    this.weather = { type: 'sunny', cloud: 0.15, rain: 0, wind: 0.3, windDir: 0.6 };
    this._wTarget = { cloud: 0.15, rain: 0, wind: 0.3 };
    this._weatherTimer = 0;
    this.devFactor = 1;          // skyline grows with national development

    this._initRenderer();
    this._initScene();
    this._initControls();
    this.clock = new THREE.Clock();
    this.resize();
    this.centerCamera();
  }

  // ---- setup ----------------------------------------------------------------
  _initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    } catch (err) {
      throw new Error('WebGL is required to render the 3D city: ' + err.message);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  _initScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    // Sky is a vertical GRADIENT (zenith -> horizon) painted into a canvas texture,
    // so dawn/dusk show realistic bands of colour instead of one flat tone.
    this.skyTop = new THREE.Color(0x3f86d8);   // zenith
    this.skyBot = new THREE.Color(0x8ec5e8);   // horizon (just above the land)
    this.skyColor = this.skyBot.clone();
    this._skyCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (this._skyCanvas) {
      this._skyCanvas.width = 2; this._skyCanvas.height = 160;
      this._skyCtx = this._skyCanvas.getContext('2d');
      this._skyTex = new THREE.CanvasTexture(this._skyCanvas);
      if ('colorSpace' in this._skyTex) this._skyTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = this._skyTex;
      this._commitSky();
    } else {
      scene.background = this.skyColor.clone();
    }
    // Linear fog fades the sea into the horizon so the world edge is never seen.
    // Pushed out so that at full zoom-out Singapore and its grey neighbours stay
    // clear, with only the undrawn sea beyond them fading away.
    this.fog = new THREE.Fog(0x9fc6e0, WORLD * 1.5, WORLD * 3.7);
    this.fogFar = WORLD * 3.7;
    scene.fog = this.fog;

    // Lighting
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a6b3a, 0.85);
    this.hemi = hemi;
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
    sun.position.set(120, 220, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = WORLD * 0.78;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: WORLD * 3.4 });
    sun.shadow.bias = -0.0004;
    this.sun = sun;
    scene.add(sun);

    // Visible sun & moon discs in the sky (positioned/faded by the day-night clock)
    this.sunSprite = this._makeCelestial('sun', 220);
    this.moonSprite = this._makeCelestial('moon', 185);
    if (this.sunSprite) scene.add(this.sunSprite);
    if (this.moonSprite) scene.add(this.moonSprite);

    // Sea
    const seaGeo = new THREE.PlaneGeometry(WORLD * 4, WORLD * 4, 1, 1);
    const seaMat = new THREE.MeshToonMaterial({ color: SEA_COLOR, transparent: true, opacity: 0.95, gradientMap: toonGradient() });
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    sea.receiveShadow = false;
    this.sea = sea;
    scene.add(sea);

    this._buildIsland();
    this._buildForeshore();  // map-accurate sandy beaches (replaces the uniform sand ring)
    this.roadEdges = [];     // 1965 Singapore had no dense road grid — players build roads
    this._buildCatchment();  // Central Catchment reservoir + nature reserve (centre of island)
    this._buildTerrain();    // the nature-reserve hills (Bukit Timah massif) around the reservoirs
    this._buildAirport();    // Singapore (Paya Lebar) Airport on the east side
    this._buildTracedRoadMask(); // mark cells the 1966 streets run through (so heritage avoids them)
    this._buildHeritage1965(SEED_1965); // the city already standing at independence (Aug 1965)
    this._fillUrbanDensity();   // pack the 1966 districts dense with decorative shophouse blocks
    this._placeStructures(CUSTOM_HOUSES, 'houseGroup'); // hand-traced houses (free-placed)
    // 3D-designed buildings/landmarks (design.html) are now placed by the PLAYER
    // from the build menu (see BUILDINGS landmark entries in data.js) rather than
    // auto-dropped at a fixed spot — so they cost money and take up land like any
    // other building. _buildLandmarks() is kept for any auto-placed world fixtures.
    this._buildSands(CUSTOM_SANDS);       // sandy coast sections (hand-traced)
    this._buildNature();     // scatter rural greenery across the undeveloped island
    this._buildRailways(CUSTOM_RAILWAYS); // railway lines (hand-traced) — after nature so the track clears its own trees
    this._buildNavGraph();   // traffic graph (freeform roads only; added on setState)
    this._initBoats();
    this._initWeather();

    // Flood plane (hidden until a flood event)
    const flood = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4),
      new THREE.MeshToonMaterial({ color: 0x2a86c4, transparent: true, opacity: 0.55, gradientMap: toonGradient() }),
    );
    flood.rotation.x = -Math.PI / 2;
    flood.position.y = SEA_Y;
    flood.visible = false;
    this.floodPlane = flood;
    scene.add(flood);
  }

  _buildIsland() {
    // Main island, then the smaller outlying islands (decorative). The beach
    // skirt is now just a thin neutral shore — the real sand is SG_SANDS.
    this._landmass(SG_OUTLINE, { depth: 8, bevel: 1.5, beachScale: 1.012, main: true });
    for (const poly of SG_ISLANDS) this._landmass(poly, { depth: 5, bevel: 1.0, beachScale: 1.025, palms: true });
    // Johor / Malaysia across the strait — grey, decorative, untouchable.
    for (const poly of (SG_FOREIGN || [])) if (poly.length >= 3) this._landmass(poly, { depth: 5, bevel: 0.8, beachScale: 1.03, foreign: true });

    // Invisible pick plane at ground level for raycasting taps.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);
    this.raycaster = new THREE.Raycaster();
  }

  // Build one landmass (grass + sandy beach skirt) from a normalised polygon.
  // `foreign` renders it as flat grey "another country" land (no beach/palms).
  _landmass(poly, { depth = 8, bevel = 1.5, beachScale = 1.05, main = false, palms = false, foreign = false } = {}) {
    const toShape = () => {
      const s = new THREE.Shape();
      poly.forEach(([nx, ny], i) => {
        const x = (nx - 0.5) * WORLD, y = (ny - 0.5) * WORLD; // +Y(north) -> -Z after rotation
        i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
      });
      return s;
    };
    const geo = new THREE.ExtrudeGeometry(toShape(), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.max.y, 0); // align the (beveled) top surface to y = 0
    const land = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: foreign ? 0x9ba29a : 0x77c25a, gradientMap: toonGradient() }));
    land.receiveShadow = true; this.scene.add(land);
    if (main) this.island = land;

    // island centroid (used by palms / the optional shore skirt)
    let cx = 0, cz = 0;
    for (const [nx, ny] of poly) { cx += (nx - 0.5) * WORLD; cz += (0.5 - ny) * WORLD; }
    cx /= poly.length; cz /= poly.length;
    // No universal sand rim: real beaches are SG_SANDS, mapped to the actual
    // foreshore. The other coasts go green straight to the water, like the map.
    // Only Johor keeps a thin grey shore skirt (decorative backdrop).
    if (foreign) {
      const beachGeo = new THREE.ExtrudeGeometry(toShape(), { depth: 0.6, bevelEnabled: false });
      beachGeo.rotateX(-Math.PI / 2); beachGeo.computeBoundingBox();
      beachGeo.translate(0, -beachGeo.boundingBox.max.y - 0.9, 0);
      const beach = new THREE.Mesh(beachGeo, new THREE.MeshToonMaterial({ color: 0x8a8f88, gradientMap: toonGradient() }));
      beach.scale.set(beachScale, 1, beachScale);
      beach.position.set((1 - beachScale) * cx, 0, (1 - beachScale) * cz);
      beach.receiveShadow = true; this.scene.add(beach);
    }

    if (palms && !foreign) {
      const gmat = new THREE.MeshToonMaterial({ color: 0x3fae57, gradientMap: toonGradient() });
      const tmat = new THREE.MeshToonMaterial({ color: 0x8a6b43, gradientMap: toonGradient() });
      for (const [dx, dz] of [[-5, -2], [4, 2], [0, 4]]) {
        // keep island trees the same small scale as the mainland's scattered trees
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 1.1, 8), tmat);
        trunk.position.set(cx + dx, 0.55, cz + dz); trunk.castShadow = true; this.scene.add(trunk);
        const fr = new THREE.Mesh(new THREE.SphereGeometry(0.72, 8, 6), gmat);
        fr.position.set(cx + dx, 1.15, cz + dz); fr.scale.y = 0.5; fr.castShadow = true; this.scene.add(fr);
      }
    }
  }

  // The sandy foreshore (SG_SANDS) — flat sand patches at the coast, only where
  // the 1966 sheet shows orange beach, matching its true location/size/shape.
  _buildForeshore() {
    if (this.foreshoreGroup) this.scene.remove(this.foreshoreGroup);
    const g = new THREE.Group(); this.scene.add(g); this.foreshoreGroup = g;
    const mat = new THREE.MeshToonMaterial({ color: 0xe6d6a6, gradientMap: toonGradient() });
    for (const poly of (SG_SANDS || [])) {
      if (poly.length < 3) continue;
      const shape = new THREE.Shape();
      poly.forEach(([nx, ny], i) => { const x = (nx - 0.5) * WORLD, y = (ny - 0.5) * WORLD; i ? shape.lineTo(x, y) : shape.moveTo(x, y); });
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.position.y = 0.06; m.receiveShadow = true; g.add(m); // sit just above the grass edge so the beach shows
    }
  }

  // Build the street network as a graph of edges running ALONG cell borders
  // (between building plots), so vehicles & people travel real streets.
  _buildRoadGraph() {
    const land = (x, y) => (x >= 0 && y >= 0 && x < N && y < N && this.land[y][x]);
    const edges = [];
    const adj = new Map();              // "i,j" -> [[i,j], ...]
    const addAdj = (a, b) => {
      const k = a.join(',');
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(b);
    };
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        // horizontal edge (i,j)-(i+1,j): borders cells (i,j-1) & (i,j)
        if (i < N && (land(i, j - 1) || land(i, j))) {
          edges.push([[i, j], [i + 1, j]]);
          addAdj([i, j], [i + 1, j]); addAdj([i + 1, j], [i, j]);
        }
        // vertical edge (i,j)-(i,j+1): borders cells (i-1,j) & (i,j)
        if (j < N && (land(i - 1, j) || land(i, j))) {
          edges.push([[i, j], [i, j + 1]]);
          addAdj([i, j], [i, j + 1]); addAdj([i, j + 1], [i, j]);
        }
      }
    }
    this.roadEdges = edges;
    this.roadAdj = adj;
    this.roadNodes = [...adj.keys()].map((k) => k.split(',').map(Number));
  }

  // Build a clearly-legible street surface: wide light PAVEMENT (footpath),
  // a darker ROAD on top with dashed lane markings, and zebra crossings at
  // intersections. Grass shows through wherever there's no road or building.
  _buildRoads() {
    const buf = { pave: [[], []], road: [[], []], mark: [[], []] };
    // push a flat quad (centre c, along dir u of length 2*hl, half-width hw)
    const quad = (key, cx, cz, ux, uz, hl, hw, y) => {
      const px = -uz * hw, pz = ux * hw;       // perpendicular
      const ex = ux * hl, ez = uz * hl;        // along
      const [verts, idx] = buf[key];
      const n = verts.length / 3;
      verts.push(cx - ex + px, y, cz - ez + pz, cx - ex - px, y, cz - ez - pz,
                 cx + ex - px, y, cz + ez - pz, cx + ex + px, y, cz + ez + pz);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    const strip = (key, ax, az, bx, bz, hw, y) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      quad(key, (ax + bx) / 2, (az + bz) / 2, dx / len, dz / len, len / 2, hw, y);
    };

    for (const [[ai, aj], [bi, bj]] of this.roadEdges) {
      const a = cornerToWorld(ai, aj), b = cornerToWorld(bi, bj);
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      strip('pave', a.x, a.z, b.x, b.z, 1.5, 0.10);   // thin footpath kerb each side
      strip('road', a.x, a.z, b.x, b.z, 1.15, 0.14);  // wide carriageway
      // dashed centre line (bright)
      const dashes = 4, span = len * 0.78, step = span / dashes;
      for (let d = 0; d < dashes; d++) {
        const t = -span / 2 + step * (d + 0.5);
        quad('mark', a.x + ux * (len / 2) + ux * t, a.z + uz * (len / 2) + uz * t, ux, uz, 0.7, 0.08, 0.18);
      }
    }

    // zebra crossings on the road approaches at real intersections
    for (const node of this.roadNodes) {
      const key = node.join(',');
      const nbrs = this.roadAdj.get(key) || [];
      if (nbrs.length < 3) continue;            // only at junctions
      const c = cornerToWorld(node[0], node[1]);
      for (const nb of nbrs) {
        const w = cornerToWorld(nb[0], nb[1]);
        const dx = w.x - c.x, dz = w.z - c.z, len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const base = 1.9;                        // how far from the junction
        for (let s = -2; s <= 2; s++) {          // 5 white stripes across the road
          const cx = c.x + ux * base, cz = c.z + uz * base;
          const ox = -uz * s * 0.42, oz = ux * s * 0.42;
          quad('mark', cx + ox, cz + oz, ux, uz, 0.55, 0.16, 0.18);
        }
      }
    }

    const mk = (key, material) => {
      const [verts, idx] = buf[key];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, material); m.receiveShadow = true; this.scene.add(m); return m;
    };
    const DS = THREE.DoubleSide;
    this.roadMeshes = [
      mk('pave', toon(0xc4bda8, { side: DS })),   // pavement (light warm grey)
      mk('road', toon(0x34373d, { side: DS })),   // asphalt (clearly dark)
      mk('mark', toon(0xfaf3d8, { side: DS })),   // lane dashes + crossings (off-white)
    ];
  }

  // The Central Catchment: a protected reservoir lake (no building) ringed by
  // dense rainforest — the centre of 1965 Singapore.
  _buildCatchment() {
    // Cell masks (grid-resolution) drive game logic — buildability, nature, etc.
    this.reserveMask = Array.from({ length: N }, () => Array(N).fill(false));
    this.riverMask = Array.from({ length: N }, () => Array(N).fill(false));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x]) continue;
      if (inReservoir(x, y, N)) this.reserveMask[y][x] = true;
      if (inRiver(x, y, N)) this.riverMask[y][x] = true;
    }
    this._computeWaterDist();   // cell distance-to-water field (carves hill valleys)
    this._computeCoastDist();   // cell distance-to-sea field (keeps hills off the coast)
    // Reservoirs are drawn as filled dendritic LAKES traced from the survey map;
    // the river is still a slim swept ribbon. One unified water colour so the
    // river, reservoirs, coastal inlets and the open sea all read as one body.
    if (this.catchGroup) this.scene.remove(this.catchGroup);
    this.catchGroup = new THREE.Group(); this.scene.add(this.catchGroup);
    const sMat = toon(0x8aa15a, { side: THREE.DoubleSide });            // muddy/grassy bank
    const wMat = new THREE.MeshToonMaterial({ color: SEA_COLOR, transparent: true, opacity: 0.95, side: THREE.DoubleSide, gradientMap: toonGradient() });
    for (const poly of SG_RESERVOIRS) this._reservoirLake(poly, sMat, wMat);
    const branches = riverBranches(N);
    for (const br of branches) this._waterRibbon(br, 2.0, 0.1, sMat);   // river banks first (lower)
    for (const br of branches) this._waterRibbon(br, 0, 0.18, wMat);    // river water on top
  }

  // Multi-source BFS distance (in cells) from every cell to the nearest water
  // (reservoir/river). Used to carve valleys so the hills slope down to the
  // lakes instead of walling them in.
  _computeWaterDist() {
    const INF = 9999;
    const dist = Array.from({ length: N }, () => Array(N).fill(INF));
    const q = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (this.reserveMask[y][x] || this.riverMask[y][x]) { dist[y][x] = 0; q.push([x, y]); }
    }
    for (let head = 0; head < q.length; head++) {
      const [x, y] = q[head], d = dist[y][x] + 1;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ax, ny = y + ay;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || dist[ny][nx] <= d) continue;
        dist[ny][nx] = d; q.push([nx, ny]);
      }
    }
    this.waterDist = dist;
  }

  // Multi-source BFS distance (in cells) from every land cell to the nearest
  // sea cell — used to taper the hills down to the coastline so the terrain
  // stays strictly within the mainland.
  _computeCoastDist() {
    const INF = 9999;
    const dist = Array.from({ length: N }, () => Array(N).fill(INF));
    const q = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x]) { dist[y][x] = 0; q.push([x, y]); }
    }
    for (let head = 0; head < q.length; head++) {
      const [x, y] = q[head], d = dist[y][x] + 1;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ax, ny = y + ay;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N || dist[ny][nx] <= d) continue;
        dist[ny][nx] = d; q.push([nx, ny]);
      }
    }
    this.coastDist = dist;
  }

  // Terrain elevation (world units) at a normalised island point. Sum of the
  // gaussian hills, faded to flat land beyond the reserve disk and carved down
  // to ~0 around the reservoirs so the lakes keep sitting in the low ground.
  _terrainHN(nx, ny) {
    let h = demHeight(nx, ny);                              // real 1966 contour heightfield
    if (h < 0.05) return 0;
    h += 0.8 * Math.sin(nx * 90) * Math.sin(ny * 85);       // gentle rolling texture
    const cx = Math.min(N - 1, Math.max(0, Math.floor(nx * N)));
    const cy = Math.min(N - 1, Math.max(0, Math.floor(ny * N)));
    const wd = this.waterDist ? this.waterDist[cy][cx] : 99;
    const valley = smoothstep(0.5, 5.0, wd);               // 0 at water, 1 a few cells away
    const cd = this.coastDist ? this.coastDist[cy][cx] : 99;
    const coast = smoothstep(0.5, 4.0, cd);                // 0 at the shoreline, 1 inland
    let H = Math.max(0, h * valley * coast);
    if (this._carves) { const wx = (nx - 0.5) * WORLD, wz = (0.5 - ny) * WORLD; H = this._applyCarves(wx, wz, H); }
    return H;
  }
  // Combine railway-cutting + airport-pad carves and re-cut the terrain mesh when
  // they change. (Railway gradings are managed by the railway builder, flat runway
  // pads by the airstrip builder; both feed this so they coexist.)
  _syncCarves() {
    const all = [...(this._railCarves || []), ...(this._airCarves || [])];
    this._carves = all.length ? all : null;
    const sig = all.map((c) => `${c.poly.length}:${c.poly[0].x.toFixed(0)},${c.poly[0].z.toFixed(0)}:${(c.floors ? c.floors[0] : c.floor).toFixed(1)}:${(c.floors ? c.floors[c.floors.length - 1] : c.floor).toFixed(1)}`).join('|');
    if (sig !== (this._carveSig ?? '')) { this._carveSig = sig; this._buildTerrain(); }
  }
  // Lower the heightfield inside carves so linear features sit IN the ground rather
  // than poking out of it. Two kinds: a tunnel-mouth ramp capsule (cut to the track
  // floor at the mouth, ramping back to natural by its inner end), and a flat runway
  // PAD that follows the centreline (cut the hill down to one level, the mountain
  // sliced away so the runway lies on the ground).
  _applyCarves(x, z, H) {
    const cs = this._carves; if (!cs || !cs.length) return H;
    let h = H;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k];
      let floor, kk;
      if (c.poly) {                                   // a pad/cutting following a centreline
        let d = Infinity, bestSeg = 0, bestT = 0;
        for (let i = 0; i < c.poly.length - 1; i++) { const pr = this._projOnSeg(x, z, c.poly[i], c.poly[i + 1]); if (pr.d < d) { d = pr.d; bestSeg = i; bestT = pr.t; } }
        if (d > c.halfW + c.blend) continue;
        // floor is one flat level (runway pad) or a per-vertex grade (railway cutting)
        floor = c.floors ? c.floors[bestSeg] + (c.floors[bestSeg + 1] - c.floors[bestSeg]) * bestT : c.floor;
        kk = d <= c.halfW ? 0 : (d - c.halfW) / c.blend;
      } else {                                        // (legacy capsule carve — unused)
        const dx = x - c.x, dz = z - c.z, u = dx * c.tx + dz * c.tz;
        if (u < -c.outset || u > c.length) continue;
        const lat = Math.abs(dx * c.nx + dz * c.nz);
        if (lat > c.halfW + c.blend) continue;
        const along = u < 0 ? 0 : u, flat = c.flatLen || 0;
        // floor stays at the cut level up to the portal (flat), then ramps to natural
        floor = along <= flat ? c.floor : c.floor + ((along - flat) / Math.max(1, c.length - flat)) * Math.max(0, H - c.floor);
        kk = lat <= c.halfW ? 0 : (lat - c.halfW) / c.blend;
      }
      const target = floor + kk * (H - floor);        // cut down to `floor`, blend back to natural
      if (target < h) h = target;
    }
    return h;
  }
  // Elevation at the centre of grid cell (cx,cy) — for placing trees & buildings.
  terrainHeight(cx, cy) { return this._terrainHN((cx + 0.5) / N, (cy + 0.5) / N); }

  // Build the central-catchment hill surface: a displaced grid over the reserve
  // disk, cel-shaded and tinted by elevation (forest green → olive → bare tan).
  _buildTerrain() {
    if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); }
    const RES = 240;                          // whole-island heightfield grid
    const x0 = HEIGHTS_1966.x0, x1 = HEIGHTS_1966.x1, y0 = HEIGHTS_1966.y0, y1 = HEIGHTS_1966.y1;
    const pos = [], col = [], idx = [], hgt = [], lnd = [];
    // Bukit Timah & the Central Catchment were rainforest in 1965/66 — forested
    // green all the way up, the canopy just deepening with altitude (never sand).
    const lo = new THREE.Color(0x77c25a), mid = new THREE.Color(0x4f8f3e),
          hi = new THREE.Color(0x3c7a34), top = new THREE.Color(0x2f6b2c), tmp = new THREE.Color();
    for (let j = 0; j <= RES; j++) {
      for (let i = 0; i <= RES; i++) {
        const nx = x0 + (x1 - x0) * i / RES, ny = y0 + (y1 - y0) * j / RES;
        const h = this._terrainHN(nx, ny);
        hgt.push(h);
        const cx = Math.min(N - 1, Math.max(0, Math.floor(nx * N)));
        const cy = Math.min(N - 1, Math.max(0, Math.floor(ny * N)));
        lnd.push(this.land[cy][cx] ? 1 : 0);
        pos.push((nx - 0.5) * WORLD, h, (0.5 - ny) * WORLD);
        const t = Math.min(1, h / HILL_MAXH);
        if (t < 0.5) tmp.copy(lo).lerp(mid, t / 0.5);
        else if (t < 0.8) tmp.copy(mid).lerp(hi, (t - 0.5) / 0.3);
        else tmp.copy(hi).lerp(top, (t - 0.8) / 0.2);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    const W1 = RES + 1;
    // Only emit quads that actually rise AND sit fully on land — the flat (h≈0)
    // skirt is left to the island's own ground/water, and nothing is drawn over
    // the sea, so the hills stay strictly within the mainland.
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const a = j * W1 + i, b = a + 1, c = a + W1, d = c + 1;
      if (Math.max(hgt[a], hgt[b], hgt[c], hgt[d]) < 0.25) continue;
      if (!(lnd[a] && lnd[b] && lnd[c] && lnd[d])) continue;
      idx.push(a, b, c, b, d, c);                          // upward-facing winding
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true; mesh.castShadow = true;
    this.terrainMesh = mesh; this.scene.add(mesh);
  }

  // A filled reservoir lake from a normalised polygon: a flat water surface with
  // a slightly wider muddy bank just beneath it (scaled about the lake centroid).
  _reservoirLake(poly, bankMat, waterMat) {
    if (!poly || poly.length < 3) return;
    const shape = new THREE.Shape();
    let cx = 0, cz = 0;
    poly.forEach(([nx, ny], i) => {
      const x = (nx - 0.5) * WORLD, y = (ny - 0.5) * WORLD;            // +Y(north) -> -Z after rotateX
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
      cx += x; cz += -y;
    });
    cx /= poly.length; cz /= poly.length;
    const mk = (yy, mat) => { const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = yy; m.receiveShadow = true; return m; };
    const bank = mk(0.08, bankMat);                                     // wider muddy rim
    const bs = 1.06; bank.scale.set(bs, 1, bs); bank.position.set((1 - bs) * cx, 0.08, (1 - bs) * cz);
    this.catchGroup.add(bank);
    this.catchGroup.add(mk(0.2, waterMat));                            // water surface on top
  }

  // Build one smooth water ribbon from a branch (polyline of {x,y,w} cell coords),
  // swept along a Catmull-Rom curve. `extra` widens it (world units) for banks;
  // the far END tapers to a sharp point (a dendritic tip).
  _waterRibbon(pts, extra, yy, mat) {
    if (!pts || pts.length < 2) return;
    const ctrl = pts.map((p) => { const c = cellToWorld(p.x, p.y); return new THREE.Vector3(c.x, 0, c.z); });
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
    const STEPS = Math.max(10, (pts.length - 1) * 14), samples = curve.getPoints(STEPS);
    const pos = [], idx = [], tipFrac = 0.2;
    for (let i = 0; i <= STEPS; i++) {
      const f = (i / STEPS) * (pts.length - 1);
      const i0 = Math.min(pts.length - 1, Math.floor(f)), i1 = Math.min(pts.length - 1, i0 + 1), tt = f - i0;
      let hw = (pts[i0].w * (1 - tt) + pts[i1].w * tt) * TILE + extra;
      const u = i / STEPS;                                   // sharpen the tip at the branch end
      if (u > 1 - tipFrac) hw *= Math.max(0, (1 - u) / tipFrac);
      const p = samples[i], a = samples[Math.max(0, i - 1)], b = samples[Math.min(STEPS, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      pos.push(p.x + nx * hw, yy, p.z + nz * hw, p.x - nx * hw, yy, p.z - nz * hw);
    }
    for (let i = 0; i < STEPS; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.catchGroup.add(m);
  }

  // Rural greenery scattered across the undeveloped island (the 1965 look),
  // denser in the Central Catchment forest ring. Hidden under any building.
  _buildNature() {
    if (this.natureGroup) this.scene.remove(this.natureGroup);
    this.natureGroup = new THREE.Group(); this.scene.add(this.natureGroup);
    this.natureCells = new Map();
    const ca = reservoirArea(N);
    // keep the absolute tree count sane as the island grows: thin out the scatter
    // for larger grids (the forest reserve stays comparatively dense).
    const forestProb = 0.78 * (48 / N), openProb = 0.32 * (48 / N) * (48 / N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x] || this.reserveMask?.[y]?.[x] || this.riverMask?.[y]?.[x] || this.airportMask?.[y]?.[x] || this.heritageMask?.[y]?.[x]) continue; // not on water / runway / heritage
      const d = Math.hypot(x - ca.cx, y - ca.cy);
      const forest = d < ca.forestR;                                  // the nature reserve ring
      if (Math.random() > (forest ? forestProb : openProb)) continue;
      const c = cellToWorld(x, y);
      const g = new THREE.Group();
      const n = forest ? 2 + Math.floor(Math.random() * 2) : 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) treeAt(g, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.8 + Math.random() * 0.9);
      g.position.set(c.x, this.terrainHeight(x, y), c.z); g.rotation.y = Math.random() * Math.PI;
      g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
      this.natureGroup.add(g);
      this.natureCells.set(x + ',' + y, g);
    }
  }
  _refreshNature() {
    if (!this.natureCells) return;
    for (const [key, g] of this.natureCells) {
      const [x, y] = key.split(',').map(Number);
      g.visible = !(this.state?.grid?.[y]?.[x]);
    }
  }

  // Singapore (Paya Lebar) Airport: a straight ~N–S runway in the east, a
  // rectangular apron parking the aircraft, five connector taxiways to the
  // runway, and two terminal buildings (the modernist terminal + control tower
  // and a hangar) set back inland. A fixed landmark, marked unbuildable so the
  // city grows around it.
  _buildAirport() {
    if (this.airportGroup) this.scene.remove(this.airportGroup);
    const nw = (p) => ({ x: (p.x - 0.5) * WORLD, z: (0.5 - p.y) * WORLD });
    const s = nw(AIRPORT.south), n = nw(AIRPORT.north);
    const cx = (s.x + n.x) / 2, cz = (s.z + n.z) / 2;
    const dx = n.x - s.x, dz = n.z - s.z, len = Math.hypot(dx, dz);
    const rot = Math.atan2(dx, dz);             // local +Z = south→north runway axis
    const SC = AIRPORT.scale;                   // uniform shrink of the whole complex
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rot; g.scale.setScalar(SC);
    this.scene.add(g); this.airportGroup = g;
    this._airportCenter = { cx, cz, rot, len: len * SC };

    // local frame: +Z = runway long axis (N), +X = inland (west) toward terminals
    const halfW = AIRPORT.rwHalfW, over = AIRPORT.overrun, halfL = len / 2 + over;
    const slab = (w, d, color, x, z, y = 0.12) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), toon(color));
      m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m;
    };
    // --- straight runway ---
    slab(halfW * 2 + 5, halfL * 2 + 4, 0x6f9e57, 0, 0, 0.10);          // grass shoulder
    slab(halfW * 2, halfL * 2, 0x35383d, 0, 0, 0.14);                  // asphalt
    const dashes = Math.floor((len) / 6);
    for (let i = 0; i < dashes; i++) slab(0.5, 3.0, 0xeae4d2, 0, -len / 2 + 3 + i * 6, 0.16);
    for (const sgn of [-1, 1]) {                                        // thresholds
      for (let k = -2; k <= 2; k++) slab(0.6, 3.4, 0xeae4d2, k * 1.3, sgn * (halfL - 3.5), 0.16);
      slab(halfW * 2 - 1, 0.7, 0xeae4d2, 0, sgn * (halfL - 1.2), 0.16);
    }
    // --- continuous parallel taxiway (the "middle road") for planes to and from the runway ---
    const txOff = AIRPORT.taxiOff, txHW = AIRPORT.taxiHalfW;
    slab(txHW * 2, halfL * 2, 0x3a3d43, txOff, 0, 0.13);              // full-length parallel taxiway
    for (let i = 0; i < Math.floor(len / 7); i++) slab(0.32, 2.0, 0xd8c463, txOff, -len / 2 + 3.5 + i * 7, 0.16); // taxi centreline
    // connector taxiways linking the runway to the parallel taxiway, spaced along its length
    const ecMid = (halfW + txOff - txHW) / 2, ecW = (txOff - txHW) - halfW, nConn = 5;
    for (let i = 0; i < nConn; i++) {
      const z = -halfL + 5 + (i / (nConn - 1)) * (halfL * 2 - 10);
      slab(ecW, AIRPORT.linkW + 0.4, 0x3a3d43, ecMid, z, 0.13);
    }
    // --- compact apron (aircraft parking) set toward one end, inboard of the taxiway ---
    const apOff = AIRPORT.apronOff, apHW = AIRPORT.apronHalfW, apHL = AIRPORT.apronHalfL;
    const apCz = AIRPORT.apronCzFrac * halfL;                          // shift the parking/building cluster toward the south end
    slab(apHW * 2 + 1.6, apHL * 2 + 1.6, 0x8f9c63, apOff, apCz, 0.10); // grass rim
    slab(apHW * 2, apHL * 2, 0xb9b4a6, apOff, apCz, 0.13);            // concrete apron
    // short links from the apron to the parallel taxiway
    const apEdge = apOff - apHW, lkMid = (txOff + txHW + apEdge) / 2, lkW = apEdge - (txOff + txHW);
    for (let i = 0; i < AIRPORT.apronLinks; i++) {
      const t = AIRPORT.apronLinks > 1 ? i / (AIRPORT.apronLinks - 1) : 0.5;
      slab(lkW, AIRPORT.linkW, 0x3a3d43, lkMid, apCz - apHL * 0.78 + t * apHL * 1.56, 0.13);
    }
    // The terminal/hangar cluster is procedural ONLY when no buildings were
    // hand-placed in the tracer; otherwise the player's layout replaces it.
    const handPlaced = AIRPORT.buildings && AIRPORT.buildings.length;
    if (!handPlaced) {
    // --- finger pier reaching into the apron; aircraft dock nose-in along it ---
    const sc = AIRPORT.termScale, faceApron = -Math.PI / 2; // model +Z -> parent -X (apron/runway side)
    const pier = makePier(); pier.scale.setScalar(sc);
    pier.position.set(AIRPORT.pierOff, 0, apCz); pier.rotation.y = faceApron; g.add(pier);
    // airliners docked at the pier, noses toward the runway (-X)
    const gates = 3;
    for (let i = 0; i < gates; i++) {
      const pl = makeAirliner(); pl.scale.setScalar(AIRPORT.planeScale);
      pl.position.set(AIRPORT.pierOff - 9, 0, apCz - apHL * 0.5 + i * (apHL / (gates - 1)));
      pl.rotation.y = faceApron; g.add(pl);
    }
    // --- terminal rotated 90°: the control tower (tallest part) points at the apron,
    //     the slab + concourse run inland ---
    const term = makeTerminal(); term.scale.setScalar(sc);
    term.position.set(AIRPORT.termOff, 0, apCz); term.rotation.y = 0; g.add(term);
    // --- car park inline on the terminal's left side (−Z) ---
    const carZ = apCz - 14;
    slab(20, 13, 0x6d6f74, AIRPORT.carparkOff, carZ, 0.12);
    addCars(g, AIRPORT.carparkOff, carZ, 18, 12);
    // --- hangar group, well clear of the car park, the whole row tilted ~30° off the grid ---
    const hg = new THREE.Group();
    hg.position.set(AIRPORT.hangarOff + 8, 0, carZ - 22); hg.rotation.y = faceApron + Math.PI / 6;
    for (let i = 0; i < 2; i++) {                       // wide open-door hangars side by side
      const h = makeHangar(); h.scale.setScalar(sc);
      h.position.set((i - 0.5) * 13, 0, 0); hg.add(h);
    }
    const beside = makeSawtoothShed(10, 5.5, 18, 3); beside.scale.setScalar(sc); // saw-tooth workshop beside (L-shape)
    beside.position.set(-12, 0, -3); hg.add(beside);
    const behind = makeAirBlock(22, 6, 9); behind.scale.setScalar(sc);   // low block set back behind the hangars
    behind.position.set(2, 0, -15); hg.add(behind);
    // apron + a couple of aircraft parked outside the hangars
    const ha = new THREE.Mesh(new THREE.BoxGeometry(30, 0.24, 12), toon(0xb9b4a6));
    ha.position.set(0, 0.12, 13); ha.receiveShadow = true; hg.add(ha);
    for (const px of [-8, 8]) {
      const pl = makeAirliner(); pl.scale.setScalar(AIRPORT.planeScale);
      pl.position.set(px, 0, 14); pl.rotation.y = 0; hg.add(pl);
    }
    g.add(hg);
    // --- on the terminal's far (+Z) side, past an open space: a long low wide hall ---
    const hall = makeLowHall(34, 5, 14); hall.scale.setScalar(sc);
    hall.position.set(24, 0, apCz + 20); hall.rotation.y = faceApron; g.add(hall);

    // --- service road running in front of the buildings, linked through to the hangars ---
    const roadX = 16, roadZ0 = apCz + 28, roadZ1 = carZ - 24;
    slab(4.2, roadZ0 - roadZ1, 0x44474d, roadX, (roadZ0 + roadZ1) / 2, 0.135);        // main frontage road
    const rdN = Math.floor((roadZ0 - roadZ1) / 6);
    for (let i = 0; i < rdN; i++) slab(0.4, 2.6, 0xe7dfca, roadX, roadZ1 + 3 + i * 6, 0.17); // dashes
    // taxi lane spur from the parallel taxiway out to the hangar apron
    slab(34 - txOff, 6, 0x3a3d43, (txOff + 34) / 2, carZ - 22, 0.125);
    // an aircraft parked on its own apron beside the low hall
    slab(11, 12, 0xb9b4a6, 14, apCz + 20, 0.12);
    const plHall = makeAirliner(); plHall.scale.setScalar(AIRPORT.planeScale);
    plHall.position.set(14, 0, apCz + 20); plHall.rotation.y = -Math.PI / 2; g.add(plHall);
    } // end procedural cluster

    if (handPlaced) this._placeStructures(AIRPORT.buildings, 'airportBuildings');

    // --- footprint mask (unbuildable) ---
    this.airportMask = Array.from({ length: N }, () => Array(N).fill(false));
    const cosr = Math.cos(rot), sinr = Math.sin(rot);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x]) continue;
      const w = cellToWorld(x, y);
      const ox = w.x - cx, oz = w.z - cz;
      // back out the group's uniform scale so thresholds stay in the model's local units
      const lx = (ox * cosr - oz * sinr) / SC, lz = (ox * sinr + oz * cosr) / SC;
      const onRunway = Math.abs(lx) < halfW + 2 && Math.abs(lz) < halfL;
      const onTaxi = Math.abs(lx - txOff) < txHW + 2 && Math.abs(lz) < halfL;
      const onComplex = !handPlaced && lx > 1 && lx < AIRPORT.termOff + 38 && lz > apCz - 62 && lz < apCz + 42;
      if (onRunway || onTaxi || onComplex) this.airportMask[y][x] = true;
    }
    if (handPlaced) this._maskAirportBuildings(AIRPORT.buildings);
  }

  // Build one hand-placed structure (airport building OR house) fitted to its
  // drawn footprint. b: { type, w, h, hgt } — w/h normalised, hgt height mult.
  _makeStructure(b) {
    const bw = Math.max(3, (b.w || 0.01) * WORLD), bd = Math.max(3, (b.h || 0.01) * WORLD), ht = b.hgt || 1;
    const fit = (m, nomW, nomD) => { m.scale.set(bw / nomW, ht, bd / nomD); return m; };
    switch (b.type) {
      case 'terminal': return fit(makeTerminal(), 38, 14);
      case 'hangar':   return fit(makeHangar(), 18, 13);
      case 'pier':     return fit(makePier(), 30, 6.5);
      case 'plane':    return fit(makeAirliner(), 22, 16);
      case 'hall':     return makeLowHall(bw, 5 * ht, bd);
      case 'block':    return makeAirBlock(bw, 6 * ht, bd);
      case 'shed':     return makeSawtoothShed(bw, 5.5 * ht, bd, Math.max(2, Math.round(bw / 6)));
      case 'carpark': {
        const m = new THREE.Group();
        const slab = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.24, bd), toon(0x6d6f74));
        slab.position.y = 0.12; slab.receiveShadow = true; m.add(slab);
        addCars(m, 0, 0, bw - 3, bd - 3);
        return m;
      }
      case 'kampong': case 'shophouse': case 'hdb_flat': case 'hdb_newtown': case 'condo': case 'condo_estate':
        return fit(makeBuilding(b.type), 9, 9);
      default:         return makeAirBlock(bw, 6 * ht, bd);
    }
  }

  // Place a list of hand-placed structures in world space, into this[prop].
  // Render the historical 1965 city (SEED_1965) as a heritage backdrop: real
  // building models at their georeferenced spots, cells marked unbuildable so the
  // player develops AROUND them. They sit outside the economy (already there).
  // Rasterise the traced 1966 street network into a per-cell mask: every grid cell
  // a road runs through is flagged, so the heritage city is placed in the BLOCKS
  // between the streets, not on top of them. Nodes/edges are world-space (the same
  // data the engine seeds), so the mask matches the rendered roads.
  _buildTracedRoadMask() {
    const mask = Array.from({ length: N }, () => new Array(N).fill(false));   // carriageway cells
    const near = Array.from({ length: N }, () => new Array(N).fill(false));   // carriageway + clearance
    const dir = Array.from({ length: N }, () => new Float32Array(N).fill(NaN)); // bearing of the nearest street
    const dist = Array.from({ length: N }, () => new Float32Array(N).fill(1e9));
    const dirC = Math.max(2, Math.ceil(14 / TILE)); // reach for orientation into the blocks
    const markR = 2.2, clearR = 2.6;                 // world-unit radii: carriageway footprint, and clearance
    const stamp = (wx, wz, ang) => {
      const cgx = Math.round(wx / TILE + N / 2), cgy = Math.round(N / 2 - wz / TILE);
      for (let oy = -dirC; oy <= dirC; oy++) for (let ox = -dirC; ox <= dirC; ox++) {
        const gx = cgx + ox, gy = cgy + oy; if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
        const cw = cellToWorld(gx, gy), dw = Math.hypot(cw.x - wx, cw.z - wz); // true world distance, so corner-crossing cells aren't missed
        if (dw < markR) mask[gy][gx] = true;          // a building here would sit on the carriageway
        if (dw < clearR) near[gy][gx] = true;
        const dc = Math.hypot(ox, oy);
        if (dc < dist[gy][gx]) { dist[gy][gx] = dc; dir[gy][gx] = ang; }
      }
    };
    for (const e of (ROAD_EDGES_1966 || [])) {
      const a = ROAD_NODES_1966[e[0]], b = ROAD_NODES_1966[e[1]]; if (!a || !b) continue;
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      const ang = Math.atan2(bx - ax, bz - az);    // bearing so a block's local +Z runs ALONG the street
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5)); // fine sampling: mark every carriageway cell
      for (let s = 0; s <= steps; s++) { const t = s / steps; stamp(ax + (bx - ax) * t, az + (bz - az) * t, ang); }
    }
    this._roadMask = mask; this._roadNear = near; this._roadDir = dir;
  }
  // Solid land — on the landmass with a one-cell margin all round, so a building
  // never sits half in the sea at the jagged coastline. Uses the raw land mask (not
  // isLand) so neighbouring buildings don't disqualify a cell — only the actual sea.
  _solidLand(x, y) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N || !this.land[yy][xx] || this.reserveMask?.[yy]?.[xx] || this.riverMask?.[yy]?.[xx]) return false;
    }
    return true;
  }
  // Is the cell free for a heritage building: on land, not already taken, not a street.
  _heritageFree(gx, gy) {
    return this.isLand(gx, gy) && !(this.heritageMask && this.heritageMask[gy][gx]) && !(this._roadMask && this._roadMask[gy][gx]);
  }
  // Angle so a building's facade (local +Z) turns to FACE the nearest road cell.
  // Returns null if no road is within reach (caller falls back to a default bearing).
  _faceRoadAngle(gx, gy) {
    if (!this._roadMask) return null;
    for (let r = 1; r <= 7; r++) {
      let bx = 0, by = 0, bd = 1e9, found = false;
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;     // ring at radius r
        const x = gx + ox, y = gy + oy;
        if (x < 0 || y < 0 || x >= N || y >= N || !this._roadMask[y][x]) continue;
        const d = ox * ox + oy * oy; if (d < bd) { bd = d; bx = ox; by = oy; found = true; }
      }
      if (found) return Math.atan2(bx, -by);   // +gx → +worldX, +gy → −worldZ
    }
    return null;
  }
  _buildHeritage1965(list) {
    if (this.heritageGroup) this.scene.remove(this.heritageGroup);
    const g = new THREE.Group(); this.scene.add(g); this.heritageGroup = g;
    this.heritageMask = Array.from({ length: N }, () => Array(N).fill(false));
    this.heritageInfo = new Map();
    this.heritagePlacements = []; // {key,gx,gy,name} — seeded into state.grid so they FUNCTION
    const place = (key, cx, cy, name) => {
      const wx = (cx - 0.5) * WORLD, wz = (0.5 - cy) * WORLD;
      let gx = Math.round(wx / TILE + N / 2), gy = Math.round(N / 2 - wz / TILE);
      if (!this._heritageFree(gx, gy)) { const s = this._nearestFreeLand(gx, gy, SNAP_R); if (!s) return; gx = s.x; gy = s.y; }
      const c = cellToWorld(gx, gy);
      const m = makeBuilding(key, null);
      // 1965 was a low-rise town of tiny shophouses: shrink the aggregate models
      // hard so the heritage city reads as the small, dense, fine-grained place the
      // 1966 survey map shows — shophouses smallest, big works (port/power/factory)
      // a touch larger — rather than looming oversized over the island.
      const sc = key === 'shophouse' ? 0.36
        : key === 'kampong' ? 0.42
        : (key === 'port' || key === 'power_station' || key === 'factory' || key === 'processing') ? 0.62
        : 0.5;
      m.scale.setScalar(sc);
      const rd = this._roadDir && this._roadDir[gy][gx];
      m.position.set(c.x, this.terrainHeight(gx, gy), c.z);
      // shophouses front the street: their facade (+Z) turns to FACE the nearest road,
      // not run alongside it; other works keep the along-street bearing.
      const faceRoad = key === 'shophouse' ? this._faceRoadAngle(gx, gy) : null;
      m.rotation.y = faceRoad != null ? faceRoad
        : (rd == null || Number.isNaN(rd)) ? Math.floor(Math.random() * 4) * Math.PI / 2 : rd;
      g.add(m);
      this.heritageMask[gy][gx] = true;
      if (name) this.heritageInfo.set(`${gx},${gy}`, name);
      this.heritagePlacements.push({ key, gx, gy, name: name || null, mesh: m });
    };
    for (const s of (list || [])) {
      const n = s.n || 1, sp = s.spread || 0.012;
      for (let i = 0; i < n; i++) {
        const a = n > 1 ? (i / n) * Math.PI * 2 + 0.6 : 0, r = n > 1 ? sp * (0.55 + 0.45 * (i % 2)) : 0;
        place(s.key, s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r, s.name);
      }
    }
  }
  // Nearest buildable (land, unoccupied) grid cell within `rad` of (gx,gy).
  _nearestFreeLand(gx, gy, rad) {
    for (let d = 1; d <= rad; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== d) continue;
      const x = gx + ox, y = gy + oy;
      if (x >= 0 && y >= 0 && x < N && y < N && this._heritageFree(x, y)) return { x, y };
    }
    return null;
  }
  // The name of the 1965 heritage building on a cell (for the inspect tooltip).
  heritageAt(x, y) { return this.heritageInfo ? this.heritageInfo.get(`${x},${y}`) : null; }
  // Fill the 1966 urban districts with a dense mass of small shophouse blocks — the
  // packed, fine-grained low-rise town the survey map shows. These are decorative
  // (rendered as two instanced meshes for the whole town, so it's just a couple of
  // draw calls) and OUTSIDE the economy; their cells are marked unbuildable so the
  // historic town stays put. The named, functional buildings (SEED_1965) already
  // carry the homes/jobs — this just makes the districts look as crowded as they were.
  // A tiny shophouse facade drawn once to a canvas and shared by every fill block
  // (tinted per-instance): two floors of shuttered windows over a ground-floor
  // shopfront and door. Cheap detail so the town isn't a field of blank boxes.
  // A small real shophouse for the dense 1966 town: a narrow-front, deep rectangular
  // body with a window band that GLOWS at night, a clay roof and a street door.
  // Shares materials so hundreds of them stay cheap, and is an individual mesh so the
  // player can DEMOLISH each one. (Built via the heritage system; not in the economy.)
  _fillUrbanDensity() {
    // [cx, cy, normalised radius] — the dense built-up areas of the 1966 town.
    const districts = [
      [0.444, 0.354, 0.034], // Chinatown / Raffles Place / the CBD river mouth
      [0.463, 0.352, 0.020], // Collyer Quay waterfront
      [0.476, 0.398, 0.030], // Beach Road & Bugis
      [0.491, 0.420, 0.028], // Kampong Glam / Rochor / Jalan Besar
      [0.518, 0.434, 0.030], // Kallang
      [0.547, 0.444, 0.032], // Geylang
      [0.583, 0.453, 0.026], // Katong / Joo Chiat
      [0.412, 0.400, 0.022], // Tiong Bahru / Bukit Ho Swee
      [0.345, 0.423, 0.026], // Queenstown surrounds
    ];
    // Lamp/heritage placement needs to know where the shophouse town is.
    this._shopMask = Array.from({ length: N }, () => new Uint8Array(N));
    const inDistrict = (wx, wz) => {
      for (const [dcx, dcy, rad] of districts) {
        if (Math.hypot(wx - (dcx - 0.5) * WORLD, wz - (0.5 - dcy) * WORLD) <= rad * WORLD) return true;
      }
      return false;
    };
    // Real shophouses LINE the street in neat terraces: the shopfront + door + the
    // upper louvered windows all face the carriageway, set back behind a five-foot-way
    // gap where people walk and cars pass. We march along each town street and tile
    // terraces end-to-end on both kerbs, fronts to the road. Each terrace reuses the
    // proper `makeBuilding('shophouse')` model, collapsed per-material so it stays a
    // single, individually-demolishable object without a swarm of meshes.
    const SC = 0.5, TW = 4 * 2.05 * SC, DEP = 4.6 * SC;   // terrace world width / depth
    const STEP = TW + 0.3, SETBACK = 2.25, MAX = 150;
    const w2c = (wx, wz) => [Math.round(wx / TILE + N / 2), Math.round(N / 2 - wz / TILE)];
    const okCell = (gx, gy) => gx >= 2 && gy >= 2 && gx < N - 2 && gy < N - 2 &&
      this._solidLand(gx, gy) && !this.heritageMask[gy][gx] && !(this._roadMask && this._roadMask[gy][gx]) &&
      !this.reserveMask?.[gy]?.[gx] && !this.riverMask?.[gy]?.[gx];
    let count = 0;
    const placeTerrace = (wx, wz, faceAng) => {
      const lenx = Math.cos(faceAng), lenz = -Math.sin(faceAng);   // local +X (terrace length) in world
      const depx = Math.sin(faceAng), depz = Math.cos(faceAng);    // local +Z (facade normal → road)
      const cells = [];
      for (let a = -TW / 2; a <= TW / 2 + 1e-3; a += TILE * 0.7) for (let b = -DEP / 2; b <= DEP / 2 + 1e-3; b += TILE * 0.7) {
        const gc = w2c(wx + lenx * a + depx * b, wz + lenz * a + depz * b);
        if (!okCell(gc[0], gc[1])) return false;
        cells.push(gc);
      }
      const ctr = w2c(wx, wz);
      const built = makeBuilding('shophouse', null);
      const m = this._mergeGroupByMaterial(built);          // ~15 meshes instead of ~60
      m.scale.setScalar(SC);
      m.position.set(wx, this.terrainHeight(ctr[0], ctr[1]), wz);
      m.rotation.y = faceAng;                                // facade (+Z) faces the road
      this.heritageGroup.add(m);
      for (const [gx, gy] of cells) { this.heritageMask[gy][gx] = true; this._shopMask[gy][gx] = 1; }
      this.heritagePlacements.push({ key: 'shophouse', gx: ctr[0], gy: ctr[1], name: null, mesh: m, decor: true, cells });
      count++;
      return true;
    };
    for (const e of (ROAD_EDGES_1966 || [])) {
      if (count >= MAX) break;
      const a = ROAD_NODES_1966[e[0]], b = ROAD_NODES_1966[e[1]]; if (!a || !b) continue;
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      if (!inDistrict((ax + bx) / 2, (az + bz) / 2)) continue;
      const L = Math.hypot(bx - ax, bz - az); if (L < STEP) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, perpx = -dz, perpz = dx;
      for (let s = STEP * 0.5; s <= L - STEP * 0.4 && count < MAX; s += STEP) {
        const cx = ax + dx * s, cz = az + dz * s;
        for (const side of [1, -1]) {
          if (count >= MAX) break;
          const wx = cx + perpx * side * SETBACK, wz = cz + perpz * side * SETBACK;
          placeTerrace(wx, wz, Math.atan2(-perpx * side, -perpz * side));   // facade back toward the road
        }
      }
    }
    this._urbanFillCount = count;
  }
  // Nearest land cell that's free for heritage AND clear of the rendered roads.
  _nearestNonRoad(gx, gy, rad) {
    for (let d = 1; d <= rad; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== d) continue;
      const x = gx + ox, y = gy + oy;
      if (x >= 0 && y >= 0 && x < N && y < N && this._heritageFree(x, y) && !this.isRoadAt(x, y)) return { x, y };
    }
    return null;
  }
  // Once the streets are actually rendered (rebuildRoadNet builds edgePts), the raw
  // road-cell mask isn't a perfect match for the carriageway+clearance the renderer
  // draws. Nudge any heritage building that ended up sitting on a street to the
  // nearest clear block, moving its model, mask and name with it. Runs once.
  _relocateHeritageOffRoads() {
    if (this._heritageRoadFixed || !this.heritagePlacements) return;
    for (const p of this.heritagePlacements) {
      if (p.decor) continue;                       // town terraces are already set back off the road
      if (!this.isRoadAt(p.gx, p.gy)) continue;
      const s = this._nearestNonRoad(p.gx, p.gy, SNAP_R); if (!s) continue;
      if (this.heritageMask) { this.heritageMask[p.gy][p.gx] = false; this.heritageMask[s.y][s.x] = true; }
      if (this.heritageInfo) { const nm = this.heritageInfo.get(`${p.gx},${p.gy}`); if (nm) { this.heritageInfo.delete(`${p.gx},${p.gy}`); this.heritageInfo.set(`${s.x},${s.y}`, nm); } }
      p.gx = s.x; p.gy = s.y;
      const c = cellToWorld(s.x, s.y); if (p.mesh) p.mesh.position.set(c.x, this.terrainHeight(s.x, s.y), c.z);
    }
    this._heritageRoadFixed = true;
  }
  // Seed the standing 1965 city into the live economy: each rendered heritage
  // building becomes a real, already-finished grid cell (so derive() counts its
  // homes/jobs/power/water/services). The heritageGroup keeps rendering the models,
  // so syncAll() SKIPS these cells to avoid drawing them twice. Idempotent and
  // one-shot per save (state.heritageSeeded) so a demolished landmark stays gone.
  applyHeritageToGrid(state) {
    if (!state || !state.grid || state.heritageSeeded) return;
    for (const p of (this.heritagePlacements || [])) {
      if (p.decor) continue;                 // decorative town shophouses — rendered, not in the economy
      const row = state.grid[p.gy];
      if (row && !row[p.gx]) row[p.gx] = { k: p.key, heritage: true, name: p.name || null };
    }
    state.heritageSeeded = true;
  }
  // Demolish a heritage building (named landmark OR decorative town shophouse): remove
  // its model, free its cell (so the player can build there), and clear the name.
  removeHeritageVisual(x, y) {
    if (!this.heritagePlacements) return false;
    // match the single cell OR any cell of a multi-cell terrace
    const i = this.heritagePlacements.findIndex((p) => (p.gx === x && p.gy === y) ||
      (p.cells && p.cells.some(([cx, cy]) => cx === x && cy === y)));
    if (i < 0) return false;
    const p = this.heritagePlacements[i];
    if (p.mesh && this.heritageGroup) this.heritageGroup.remove(p.mesh);
    const free = p.cells && p.cells.length ? p.cells : [[p.gx, p.gy]];
    for (const [cx, cy] of free) {
      if (this.heritageMask && this.heritageMask[cy]) this.heritageMask[cy][cx] = false;
      if (this._shopMask && this._shopMask[cy]) this._shopMask[cy][cx] = 0;
      if (this.heritageInfo) this.heritageInfo.delete(`${cx},${cy}`);
    }
    this.heritagePlacements.splice(i, 1);
    const c = cellToWorld(p.gx, p.gy); this._spawnDust(c.x, c.z, 0xbfb09a, 26);
    return true;
  }
  _placeStructures(list, prop) {
    if (this[prop]) this.scene.remove(this[prop]);
    const grp = new THREE.Group(); this.scene.add(grp); this[prop] = grp;
    for (const b of (list || [])) {
      const m = this._makeStructure(b);
      m.position.set((b.cx - 0.5) * WORLD, 0, (0.5 - b.cy) * WORLD); m.rotation.y = b.rot || 0;
      grp.add(m);
    }
  }

  // Render the 3D-designed landmarks (CUSTOM_LANDMARKS) on the island, each at
  // its normalised position, sitting on the terrain. Cells under them are marked
  // unbuildable so the city grows around them.
  _buildLandmarks(list) {
    if (this.landmarkGroup) this.scene.remove(this.landmarkGroup);
    const g = new THREE.Group(); this.scene.add(g); this.landmarkGroup = g;
    for (const lm of (list || [])) {
      if (!lm.parts || !lm.parts.length) continue;
      const grp = new THREE.Group();
      for (const part of lm.parts) grp.add(makeLandmarkPart(part, toon));
      grp.scale.setScalar(lm.scale || 1);
      const wx = (lm.cx - 0.5) * WORLD, wz = (0.5 - lm.cy) * WORLD;
      grp.position.set(wx, this._terrainHN(lm.cx, lm.cy) + 0.05, wz);
      grp.rotation.y = lm.rot || 0; g.add(grp);
      // footprint mask from the parts' XZ bounding box
      if (this.airportMask) {
        let r = 4; for (const p of lm.parts) r = Math.max(r, Math.hypot((p.x || 0) + (p.w || 4) / 2, (p.z || 0) + (p.d || 4) / 2));
        r *= (lm.scale || 1);
        const cx0 = Math.floor((wx / WORLD + 0.5) * N), cy0 = Math.floor((0.5 - wz / WORLD) * N), rc = Math.ceil(r / TILE);
        for (let y = cy0 - rc; y <= cy0 + rc; y++) for (let x = cx0 - rc; x <= cx0 + rc; x++)
          if (x >= 0 && y >= 0 && x < N && y < N && this.land[y][x]) {
            const w = cellToWorld(x, y); if (Math.hypot(w.x - wx, w.z - wz) <= r) this.airportMask[y][x] = true;
          }
      }
    }
  }

  // A flat ribbon mesh following a world-space polyline (used for sands/rails).
  _addRibbon(group, pts, halfW, color, yy) {
    if (pts.length < 2) return;
    const v = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz, nz = tx, p = pts[i];
      v.push(p.x + nx * halfW, (p.y || 0) + yy, p.z + nz * halfW, p.x - nx * halfW, (p.y || 0) + yy, p.z - nz * halfW);
    }
    for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, toon(color, { side: THREE.DoubleSide })); m.receiveShadow = true; group.add(m); return m;
  }

  // Sandy coast sections: a sand-coloured strip just above the beach skirt.
  _buildSands(list) {
    if (this.sandGroup) this.scene.remove(this.sandGroup);
    const g = new THREE.Group(); this.scene.add(g); this.sandGroup = g;
    const W2 = (p) => new THREE.Vector3((p[0] - 0.5) * WORLD, 0, (0.5 - p[1]) * WORLD);
    for (const poly of (list || [])) { if (poly.length < 2) continue; this._addRibbon(g, poly.map(W2), 7, 0xeadbab, 0.05); }
  }

  // Railway lines: a ballast strip with two steel rails and timber sleepers.
  _buildRailways(list) {
    if (this.railGroup) this.scene.remove(this.railGroup);
    const g = new THREE.Group(); this.scene.add(g); this.railGroup = g;
    const tracks = [];
    for (const poly of (list || [])) {
      if (!poly || poly.length < 2) continue;
      // historic lines are normalised [nx,ny]; map to world, then render with the
      // SAME terrain-following ballast/sleepers/rails as player-built railways so
      // traced and in-game track look identical.
      const world = poly.map(([nx, ny]) => ({ x: (nx - 0.5) * WORLD, z: (0.5 - ny) * WORLD }));
      const dense = this._resamplePoly(world, 1.4);
      const pts = dense.map((q) => new THREE.Vector3(q.x, this._roadY(q.x, q.z), q.z));
      this._railTrack(g, pts);
      tracks.push({ pts, kind: 'train' });
    }
    this._histTrainTracks = tracks;   // the historic KTM lines get steam/diesel trains running on them
  }

  // Mark cells under hand-placed buildings as unbuildable.
  _maskAirportBuildings(list) {
    for (const b of list) {
      const cx = (b.cx - 0.5) * WORLD, cz = (0.5 - b.cy) * WORLD;
      const hw = Math.max(3, (b.w || 0.01) * WORLD) / 2, hd = Math.max(3, (b.h || 0.01) * WORLD) / 2;
      const c = Math.cos(-(b.rot || 0)), s = Math.sin(-(b.rot || 0));
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!this.land[y][x] || this.airportMask[y][x]) continue;
        const w = cellToWorld(x, y), ox = w.x - cx, oz = w.z - cz;
        const lx = ox * c - oz * s, lz = ox * s + oz * c;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) this.airportMask[y][x] = true;
      }
    }
  }

  // A few boats drifting on the sea around the island.
  _initBoats() {
    this.boats = [];
    this._buildCoastRadius();   // so boats can hug the coast and never sail onto land
    const types = ['bumboat', 'bumboat', 'cargo', 'sampan', 'bumboat', 'cargo', 'sampan', 'bumboat'];
    for (let i = 0; i < types.length; i++) {
      const b = makeBoat(types[i]);
      const ang = Math.random() * Math.PI * 2;
      const rad = WORLD * (0.44 + Math.random() * 0.12);
      this.scene.add(b);
      // angular speed tuned so the LINEAR speed is way slower than anything on land
      const lin = 0.5 + Math.random() * 0.4;   // ~0.5–0.9 world units/sec
      this.boats.push({ mesh: b, ang, rad, angSpeed: (lin / Math.max(1, rad)) * (Math.random() < 0.5 ? 1 : -1) });
    }
  }
  // Max radius (from the map centre) reached by land at each compass bearing, so a
  // boat can stay just offshore. Covers Singapore, its islands and foreign land.
  _buildCoastRadius() {
    const BINS = 240; this._coastR = new Float32Array(BINS);
    const upd = (wx, wz) => { const a = Math.atan2(wz, wx), r = Math.hypot(wx, wz); const bin = ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS; if (r > this._coastR[bin]) this._coastR[bin] = r; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (this.land[y][x]) { const w = cellToWorld(x, y); upd(w.x, w.z); }
    for (const poly of (SG_FOREIGN || [])) for (const [nx, ny] of poly) upd((nx - 0.5) * WORLD, (0.5 - ny) * WORLD);
  }
  _coastRadiusAt(ang) {
    if (!this._coastR) return 0;
    const BINS = this._coastR.length;
    const base = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;
    let m = 0; for (let k = -3; k <= 3; k++) m = Math.max(m, this._coastR[(base + k + BINS) % BINS]); // small look-ahead margin
    return m;
  }
  _updateBoats(dt) {
    if (!this.boats) return;
    for (const bo of this.boats) {
      bo.ang += bo.angSpeed * dt;
      const rad = Math.min(WORLD * 0.78, Math.max(bo.rad, this._coastRadiusAt(bo.ang) + 24)); // stay offshore, inside the fog
      const x = Math.cos(bo.ang) * rad, z = Math.sin(bo.ang) * rad;
      if (bo._px !== undefined) {                       // face the actual direction of travel (bow = +Z)
        const vx = x - bo._px, vz = z - bo._pz;
        if (vx * vx + vz * vz > 1e-5) bo.mesh.rotation.y = Math.atan2(vx, vz);
      }
      bo._px = x; bo._pz = z;
      bo.mesh.position.set(x, SEA_Y + 0.6 + Math.sin(this.clock.elapsedTime * 1.0 + bo.ang * 4) * 0.2, z); // gentle bob
    }
  }

  // ---- camera controls (orbit / pan / pinch) --------------------------------
  _initControls() {
    // near pushed off 0.5 and far past MAX_R + island radius + fog: a tighter
    // near/far ratio gives the depth buffer enough precision that the ground
    // stops z-fighting (sand bleeding through grass) when zoomed far out.
    this.camera = new THREE.PerspectiveCamera(45, 1, 4, WORLD * 4.2);
    this.target = new THREE.Vector3(0, 0, 0);
    this.cam = { radius: WORLD * 0.85, theta: -0.7, phi: 0.92 };
    this.MIN_R = 26;             // street-level zoom (buildings unchanged)
    // Navigation limit: a generous zoom-out that still stays over drawn land
    // (Singapore + its grey neighbours) rather than an endless fogged sea.
    this.MAX_R = WORLD * 1.42;
    // How far the camera focus may roam (the playable navigation box) — Singapore
    // plus a margin of neighbouring land so you never pan into blank sea.
    this.PAN_X = WORLD * 0.66;   // east/west focus limit
    this.PAN_N = WORLD * 0.64;   // north limit (toward Johor / Malaysia)
    this.PAN_S = WORLD * 0.58;   // south limit (toward Batam / Indonesia)
    this._pointers = new Map();
    this._lastPinch = 0;
    this._moved = false;
    this._down = null;
    this._downTime = 0;

    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, pos(e));
      this._moved = false; this._down = pos(e); this._downTime = performance.now(); this._last = pos(e);
      // right / middle mouse button, or shift+left, drags to pan the view
      this._panDrag = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey));
      // draw mode: a drag traces a route (road/railway/airport) or a reclaim area
      if (this.drawMode && this.onStroke && !this._panDrag && this._pointers.size === 1) {
        const g = this._raycastGround(pos(e));
        // start from a snapped existing road end if we're hovering one (continue a road)
        const start = (this._snap && !this._drawArea) ? { x: this._snap.x, z: this._snap.z } : (g ? { x: g.x, z: g.z } : null);
        this._drawing = true; this._stroke = start ? [start] : [];
        this._lastSamplePx = pos(e);   // sample by screen distance (zoom-independent, like trace.html)
        this._clearSnapMarker(); this._hideDrawCursor();   // hide hover markers once the stroke begins
        this._renderDrawPreview(this._stroke);
      }
      // paint mode: a drag fills cells (no camera orbit). Paint the first cell now.
      if (this.paintMode && this.onPaint && !this._panDrag && this._pointers.size === 1) {
        this._painting = true; this._paintSeen = new Set(); this._paintAt(pos(e));
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault()); // free the right button for panning
    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) { this._hover(pos(e)); return; }
      const p = pos(e);
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinch) this.cam.radius = THREE.MathUtils.clamp(this.cam.radius * this._lastPinch / dist, this.MIN_R, this.MAX_R);
        // two-finger pan — moves the camera in the swipe direction (matches W/A/S/D)
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (this._lastMid) this._pan(-(mid.x - this._lastMid.x), mid.y - this._lastMid.y);
        this._lastMid = mid;
        this._lastPinch = dist; this._moved = true;
        return;
      }
      const dx = p.x - this._last.x, dy = p.y - this._last.y;
      this._last = p;
      if (Math.abs(p.x - this._down.x) > 5 || Math.abs(p.y - this._down.y) > 5) this._moved = true;
      if (this._drawing) { // trace a route in real time
        const g = this._raycastGround(p);
        if (g) {
          const lp = this._lastSamplePx;
          // commit a sample every few SCREEN pixels (zoom-independent, keeps it dense)
          if (!lp || Math.hypot(p.x - lp.x, p.y - lp.y) > 5) {
            const last = this._stroke[this._stroke.length - 1];
            if (!last || Math.hypot(g.x - last.x, g.z - last.z) > 0.3) { this._stroke.push({ x: g.x, z: g.z }); this._lastSamplePx = p; }
          }
          // ALWAYS draw the line right up to the cursor so there's zero lag/direction delay
          this._renderDrawPreview(this._stroke.concat([{ x: g.x, z: g.z }]));
        }
        return;
      }
      if (this._painting) { this._paintAt(p); return; }     // drag paints cells (reclamation)
      if (this._panDrag) { this._pan(dx, dy); this._hover(p); return; } // drag to shift the view
      this.cam.theta -= dx * 0.005;
      this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.005, 0.22, 1.28);
      this._hover(p);
    });
    const end = (e) => {
      const p = pos(e);
      if (this._drawing) { // finish a route/area stroke
        // make sure the point where the finger/mouse lifts is part of the route, and
        // SNAP that final point onto a road/rail/runway end if we're releasing on one
        // (so the new route visibly joins it — connectivity is then exact).
        const g = this._raycastGround(p);
        if (g && this._stroke) {
          const e = this._drawSnap(g.x, g.z) || g;
          const last = this._stroke[this._stroke.length - 1];
          if (!last || Math.hypot(e.x - last.x, e.z - last.z) > 0.5) this._stroke.push({ x: e.x, z: e.z });
        }
        const stroke = this._stroke;
        this._drawing = false; this._stroke = null;
        this._renderDrawPreview(stroke);   // keep the drawn shape on screen until the player commits/cancels
        this._pointers.delete(e.pointerId);
        if (this._pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
        if (this._pointers.size === 0) this._panDrag = false;
        // hand the stroke back; the game shows a commit prompt (with the cost).
        if (this.onStroke) this.onStroke(stroke || []);
        return;
      }
      if (this._painting) { // finish a paint drag; a plain tap already painted on pointerdown
        this._painting = false; this._paintSeen = null;
        this._pointers.delete(e.pointerId);
        if (this._pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
        if (this._pointers.size === 0) this._panDrag = false;
        return;
      }
      const quick = performance.now() - this._downTime < 400;
      if (!this._moved && quick && this._pointers.size <= 1) {
        if (this.pieceMode && this.onPieceChain) {           // stage a Lego piece into the pending chain
          this._piecePreview(p);                              // make sure the ghost matches the tap point
          if (this._piecePts && this._piecePts.length >= 2) {
            this._pieceChain.push(this._piecePts.map((q) => ({ x: q.x, z: q.z })));
            this._piecePreview(p);                            // re-ghost the next piece from the new chain end
            this.onPieceChain(this._mergedChain());           // update the running cost / commit bar
          }
        } else if (this.roadMode && this.onGroundTap) {
          const g = this._raycastGround(p);
          if (g) this.onGroundTap(g.x, g.z);
        } else {
          const cell = this._raycastCell(p);
          if (cell && this.onTileTap) this.onTileTap(cell.x, cell.y);
        }
      }
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
      if (this._pointers.size === 0) this._panDrag = false;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (this.ghost) this.ghost.visible = false; this._hideHoverTile(); this._clearSnapMarker(); this._hideDrawCursor(); if (this.pieceMode) this.clearRoadPreview(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.radius = THREE.MathUtils.clamp(this.cam.radius * (e.deltaY < 0 ? 0.92 : 1.08), this.MIN_R, this.MAX_R);
    }, { passive: false });
    // keyboard: arrows / WASD pan the view, Q/E rotate, R recentres
    window.addEventListener('keydown', (e) => {
      if (this.disposed) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const step = 36; // screen-pixels-equivalent nudge
      let used = true;
      switch (e.key) {
        // W/A/S/D & arrows move the camera in the key's direction (W = forward).
        case 'ArrowLeft': case 'a': case 'A': this._pan(step, 0); break;
        case 'ArrowRight': case 'd': case 'D': this._pan(-step, 0); break;
        case 'ArrowUp': case 'w': case 'W': this._pan(0, -step); break;
        case 'ArrowDown': case 's': case 'S': this._pan(0, step); break;
        case 'q': case 'Q': this.cam.theta += 0.12; break;
        case 'e': case 'E': this.cam.theta -= 0.12; break;
        case 'r': case 'R': this.centerCamera(); break;
        default: used = false;
      }
      if (used) e.preventDefault();
    });
    window.addEventListener('resize', () => this.resize());
  }

  _pan(dx, dy) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const fwd = new THREE.Vector3().crossVectors(this.camera.up, right).normalize();
    const k = this.cam.radius * 0.0016;
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(fwd, -dy * k);
    // keep focus inside the navigation box (north = -z toward Johor, south = +z)
    this.target.x = THREE.MathUtils.clamp(this.target.x, -this.PAN_X, this.PAN_X);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -this.PAN_N, this.PAN_S);
  }

  _updateCamera() {
    const { radius, theta, phi } = this.cam;
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    this.camera.lookAt(this.target);
  }

  centerCamera() { this.target.set(0, 0, 0); this.cam.radius = WORLD * 0.85; this.cam.theta = -0.7; this.cam.phi = 0.92; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- raycasting / land queries -------------------------------------------
  _ndc(p) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1);
  }
  // Terrain surface height at world (x,z) — same function the terrain mesh is built
  // from, so a ray-march against it lands exactly on the visible hill surface.
  _heightAt(x, z) {
    const nx = THREE.MathUtils.clamp(x / WORLD + 0.5, 0, 1);
    const ny = THREE.MathUtils.clamp(0.5 - z / WORLD, 0, 1);
    return this._terrainHN(nx, ny);
  }
  // Terrain stats over the corridor swept by a route of half-width `halfW`:
  // the height range and the earthwork VOLUME needed to level it flat. Used to
  // price flattening an airport runway that lands on uneven ground.
  _corridorTerrainStats(pts, halfW) {
    const heights = []; let routeLen = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const segL = Math.hypot(b.x - a.x, b.z - a.z); routeLen += segL;
      const steps = Math.max(1, Math.round(segL / 2.5));
      const ux = (b.x - a.x) / (segL || 1), uz = (b.z - a.z) / (segL || 1), nx = -uz, nz = ux;
      for (let s = 0; s <= steps; s++) { const t = s / steps, cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
        for (const w of [-halfW, -halfW / 2, 0, halfW / 2, halfW]) heights.push(this._heightAt(cx + nx * w, cz + nz * w)); }
    }
    if (!heights.length) return { level: 0, min: 0, max: 0, range: 0, volume: 0, area: 0 };
    let min = Infinity, max = -Infinity, sum = 0;
    for (const h of heights) { if (h < min) min = h; if (h > max) max = h; sum += h; }
    const level = sum / heights.length, area = routeLen * 2 * halfW, perSample = area / heights.length;
    // the runway is cut down to the LOWEST ground under it, so price the excavation
    // (rock removed) as the volume of everything above that minimum level.
    let volume = 0; for (const h of heights) volume += (h - min) * perSample;
    return { level, min, max, range: max - min, volume, area };
  }
  // The surface point under screen p. Marches the camera ray against the terrain
  // heightfield so hills are accurate (a flat y=0 plane mis-reads elevated ground,
  // making the cursor "drift" downhill). Falls back to the flat plane if needed.
  _groundPoint(p) {
    this.raycaster.setFromCamera(this._ndc(p), this.camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    if (d.y < -1e-4) {
      const HMAX = 90;                                   // above the tallest hill
      const t0 = Math.max(0, (HMAX - o.y) / d.y);        // skip the empty sky portion
      const span = Math.min(((-4) - o.y) / d.y - t0, WORLD * 3), STEP = Math.max(1.2, span / 240);
      for (let t = t0; t <= t0 + span; t += STEP) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        if (y <= this._heightAt(x, z)) {                 // crossed below the surface — refine
          let lo = Math.max(t0, t - STEP), hi = t;
          for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= this._heightAt(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
          return { x: o.x + d.x * hi, z: o.z + d.z * hi };
        }
      }
    }
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }
  _raycastGround(p) { return this._groundPoint(p); }
  _raycastCell(p) {
    const g = this._groundPoint(p);
    if (!g) return null;
    const gx = Math.floor((g.x / WORLD + 0.5) * N), gy = Math.floor((0.5 - g.z / WORLD) * N);
    if (gx < 0 || gy < 0 || gx >= N || gy >= N) return null;
    return { x: gx, y: gy };
  }
  // Paint the cell under screen point p (once per cell per drag).
  _paintAt(p) {
    const cell = this._raycastCell(p); if (!cell || !this.onPaint) return;
    // Brush: sweep a round patch of cells along the drag so reclamation feels
    // like drawing new coastline freehand, not filling one tile at a time.
    const r = this.paintRadius || 0;
    if (r <= 0) {
      const id = cell.x + ',' + cell.y;
      if (this._paintSeen && this._paintSeen.has(id)) return;
      if (this._paintSeen) this._paintSeen.add(id);
      this.onPaint(cell.x, cell.y);
      return;
    }
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r + 0.01) continue;          // round brush
      const x = cell.x + dx, y = cell.y + dy;
      if (x < 0 || y < 0) continue;
      const id = x + ',' + y;
      if (this._paintSeen && this._paintSeen.has(id)) continue;
      if (this._paintSeen) this._paintSeen.add(id);
      this.onPaint(x, y);                                       // onPaint guards sea/validity itself
    }
  }
  isLand(x, y) {
    const base = (this.land[y] && this.land[y][x]) || (this.reclaimedMask && this.reclaimedMask[y] && this.reclaimedMask[y][x]);
    return !!(base && !(this.reserveMask && this.reserveMask[y][x]) && !(this.riverMask && this.riverMask[y][x]) && !(this.airportMask && this.airportMask[y][x]) && !(this.heritageMask && this.heritageMask[y][x]));
  }
  // Can grid cell (x,y) be reclaimed? True only for OPEN SINGAPORE SEA — i.e.
  // not already (or being) reclaimed, not Singapore land, not protected water,
  // and not over the foreign (Johor) landmass.
  canReclaim(x, y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    if (this.land[y] && this.land[y][x]) return false;                 // already SG land
    if (this.reclaimedMask && this.reclaimedMask[y] && this.reclaimedMask[y][x]) return false;
    if (this.reclaimingMask && this.reclaimingMask[y] && this.reclaimingMask[y][x]) return false; // already rising
    if ((this.reserveMask && this.reserveMask[y][x]) || (this.riverMask && this.riverMask[y][x])) return false; // protected freshwater
    const nx = (x + 0.5) / N, ny = (y + 0.5) / N;
    if (SG_FOREIGN.some((poly) => pointInPolygon(nx, ny, poly))) return false; // Johor, not Singapore
    return true;
  }
  _ensureReclaimGroups() {
    if (!this.reclaimedMask) this.reclaimedMask = Array.from({ length: N }, () => Array(N).fill(false));
    if (!this.reclaimingMask) this.reclaimingMask = Array.from({ length: N }, () => Array(N).fill(false));
    if (!this.reclaimSlabs) this.reclaimSlabs = new Map();
    if (!this.reclaimSites) this.reclaimSites = new Map();
    if (!this.reclaimGroup) { this.reclaimGroup = new THREE.Group(); this.scene.add(this.reclaimGroup); }
    if (!this.reclaimSiteGroup) { this.reclaimSiteGroup = new THREE.Group(); this.scene.add(this.reclaimSiteGroup); }
  }
  // A finished block of new land filling the sea cell up to ground level.
  _reclaimSlab(x, y) {
    const c = cellToWorld(x, y), H = 1.5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(TILE, H, TILE), toon(0xc7b489)); // sandy by default
    m.position.set(c.x, 0.05 - H / 2, c.z); m.receiveShadow = true;
    return m;
  }
  // ---- land reclamation as timed construction (sea rising into land) --------
  // Reconcile rising-land sites with state.reclaiming, and finalise any that have
  // finished (now present in state.reclaimed) into permanent, buildable land.
  syncReclamation(state) {
    if (!state) return;
    this._ensureReclaimGroups();
    const active = new Set();
    for (const r of (state.reclaiming || [])) {
      const id = r.x + ',' + r.y; active.add(id);
      if (!this.reclaimSites.has(id)) this._startReclaimSite(r.x, r.y);
      this._setReclaimProgress(id, 1 - r.left / Math.max(1, r.total));
    }
    for (const id of [...this.reclaimSites.keys()]) {
      if (active.has(id)) continue;            // no longer rising -> it has finished
      const [x, y] = id.split(',').map(Number);
      this._removeReclaimSite(id);
      this._finishReclaim(x, y);
    }
    this._syncReclaimAreas(state);             // free-shaped (polygon) reclamations
  }
  // Render free-shaped reclamations: finished areas as smooth permanent land, and
  // in-progress areas as the same shape rising from the sea with works buoys.
  _syncReclaimAreas(state) {
    if (!this.reclaimedMask) return;
    if (this._reclaimAreaGroup) this.scene.remove(this._reclaimAreaGroup);
    const grp = new THREE.Group(); this.scene.add(grp); this._reclaimAreaGroup = grp;
    const markCells = (cells, mask) => { for (const [x, y] of (cells || [])) if (x >= 0 && y >= 0 && x < N && y < N) { mask[y][x] = true; const g = this.natureCells?.get(x + ',' + y); if (g) g.visible = false; } };
    for (const a of (state.reclaimedAreas || [])) {                 // finished -> permanent buildable land
      const m = this._reclaimLandMesh(a.poly); m.position.y = 0.05; grp.add(m);
      markCells(a.cells, this.reclaimedMask);
    }
    for (const a of (state.reclaimAreas || [])) {                   // rising
      const prog = Math.max(0, Math.min(1, 1 - a.left / Math.max(1, a.total)));
      const m = this._reclaimLandMesh(a.poly); m.position.y = -2.6 + prog * 2.65; grp.add(m);
      markCells(a.cells, this.reclaimingMask);
      this._addReclaimBuoys(grp, a.poly);
    }
  }
  // A smooth landmass from a world polygon: green top + sandy skirt down to the
  // seabed + a beach line, so the reclaimed coastline follows the freehand shape.
  _reclaimLandMesh(poly) {
    const grp = new THREE.Group();
    const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const topGeo = new THREE.ShapeGeometry(shape); topGeo.rotateX(-Math.PI / 2);
    const top = new THREE.Mesh(topGeo, toon(0x86a85f)); top.receiveShadow = true; grp.add(top);
    const D = 2.6, v = [], idx = [];                                 // skirt walls (solid land edge)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = v.length / 3;
      v.push(a[0], 0, a[1], b[0], 0, b[1], b[0], -D, b[1], a[0], -D, a[1]);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); sg.setIndex(idx); sg.computeVertexNormals();
    grp.add(new THREE.Mesh(sg, toon(0xb9a06f, { side: THREE.DoubleSide })));
    const loop = poly.map(([x, z]) => new THREE.Vector3(x, 0, z)); loop.push(loop[0]);
    this._addRibbon(grp, loop, 1.4, 0xded2a6, 0.07);                 // sandy beach edge
    return grp;
  }
  _addReclaimBuoys(group, poly) {
    let dist = 0, nextAt = 0; const SPACE = 14;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], segL = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.0001;
      const ux = (b[0] - a[0]) / segL, uz = (b[1] - a[1]) / segL;
      while (nextAt <= dist + segL) {
        const s = nextAt - dist, x = a[0] + ux * s, z = a[1] + uz * s;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.5, 0.32), toon(0xff7a3c)); post.position.set(x, 0.75, z); group.add(post);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true })); light.position.set(x, 1.7, z); light.userData.blink = true; group.add(light);
        nextAt += SPACE;
      }
      dist += segL;
    }
  }
  _startReclaimSite(x, y) {
    this._ensureReclaimGroups();
    const id = x + ',' + y;
    if (this.reclaimSites.has(id)) return;
    this.reclaimingMask[y][x] = true;
    const c = cellToWorld(x, y), H = 1.5;
    const m = new THREE.Mesh(new THREE.BoxGeometry(TILE, H, TILE), toon(0x8a7c54)); // wet, under-construction fill
    m.position.set(c.x, -2.15, c.z); m.receiveShadow = true; // starts submerged, rises with progress
    // a marine works buoy with a blinking light marks the reclamation zone
    const buoy = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), toon(0xff7a3c)); buoy.position.set(TILE * 0.34, H / 2 + 0.55, TILE * 0.34); m.add(buoy);
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true })); blink.position.set(TILE * 0.34, H / 2 + 1.2, TILE * 0.34); blink.userData.blink = true; m.add(blink);
    this.reclaimSiteGroup.add(m); this.reclaimSites.set(id, m);
    this._spawnDust(c.x, c.z, 0x9fb6c9, 8); // sea spray as filling begins
    const g = this.natureCells && this.natureCells.get(id); if (g) g.visible = false;
  }
  _setReclaimProgress(id, prog) {
    const m = this.reclaimSites.get(id); if (!m) return;
    const p = Math.max(0, Math.min(1, prog));
    m.position.y = -2.15 + p * 1.45; // rise from the seabed up to land level (-0.7)
  }
  _removeReclaimSite(id) {
    const m = this.reclaimSites.get(id); if (!m) return;
    this.reclaimSiteGroup.remove(m); this.reclaimSites.delete(id);
    const [x, y] = id.split(',').map(Number); if (this.reclaimingMask) this.reclaimingMask[y][x] = false;
  }
  // Turn a finished reclamation into permanent, buildable land.
  _finishReclaim(x, y) {
    this._ensureReclaimGroups();
    const id = x + ',' + y;
    if (this.reclaimSlabs.has(id)) return;
    this.reclaimedMask[y][x] = true;
    const m = this._reclaimSlab(x, y); this.reclaimGroup.add(m); this.reclaimSlabs.set(id, m);
    const c = cellToWorld(x, y); this._spawnDust(c.x, c.z, 0xd9c79a, 12); // land secured
    const g = this.natureCells && this.natureCells.get(id); if (g) g.visible = false;
    this._scheduleCoast();
  }
  // Rebuild all reclaimed-land visuals from saved state (on new game / load).
  _syncReclaimed() {
    for (const grp of ['reclaimGroup', 'reclaimSiteGroup']) if (this[grp]) { this.scene.remove(this[grp]); this[grp] = null; }
    this.reclaimSlabs = new Map(); this.reclaimSites = new Map();
    this.reclaimedMask = Array.from({ length: N }, () => Array(N).fill(false));
    this.reclaimingMask = Array.from({ length: N }, () => Array(N).fill(false));
    this._ensureReclaimGroups();
    for (const [x, y] of ((this.state && this.state.reclaimed) || [])) if (x >= 0 && y >= 0 && x < N && y < N) this._finishReclaim(x, y);
    this.syncReclamation(this.state); // spawn rising sites for anything still in progress
    this._refreshCoast();
  }
  // A reclaimed cell borders open sea (so its edge is a new beach) if any of its
  // 4-neighbours is water that is neither original land nor already reclaimed.
  _isOpenSea(x, y) {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    return !(this.land[y] && this.land[y][x]) && !(this.reclaimedMask && this.reclaimedMask[y][x]);
  }
  _scheduleCoast() { clearTimeout(this._coastT); this._coastT = setTimeout(() => this._refreshCoast(), 120); }
  // Recolour reclaimed land so the new coastline reads correctly: a sandy beach
  // on cells that still front open sea, earthy-green reclaimed land inland.
  _refreshCoast() {
    if (!this.reclaimSlabs) return;
    for (const [id, mesh] of this.reclaimSlabs) {
      const [x, y] = id.split(',').map(Number);
      const coastal = this._isOpenSea(x - 1, y) || this._isOpenSea(x + 1, y) || this._isOpenSea(x, y - 1) || this._isOpenSea(x, y + 1);
      mesh.material.color.setHex(coastal ? 0xd9c79a : 0x93a06a); // beach : reclaimed inland
    }
  }
  // Is a world point over the protected reservoir / catchment? (blocks road drawing)
  isReserveAt(wx, wz) {
    const gx = Math.floor((wx / WORLD + 0.5) * N), gy = Math.floor((0.5 - wz / WORLD) * N);
    return !!(this.reserveMask && this.reserveMask[gy] && this.reserveMask[gy][gx]);
  }
  // Is a world point over the Singapore River? (blocks road drawing — needs a bridge)
  isRiverAt(wx, wz) {
    const gx = Math.floor((wx / WORLD + 0.5) * N), gy = Math.floor((0.5 - wz / WORLD) * N);
    return !!(this.riverMask && this.riverMask[gy] && this.riverMask[gy][gx]);
  }
  // Is grid cell (gx,gy) covered by a freeform road? (blocks building on roads)
  worldOfCell(gx, gy) { return cellToWorld(gx, gy); }   // cell centre → world {x,z}
  isRoadAt(gx, gy) {
    const c = cellToWorld(gx, gy);
    for (let e = 0; e < this.edgePts.length; e++) {
      const pts = this.edgePts[e]; if (!pts || pts.length < 2) continue;
      const T = ROAD_TYPES[this.edgeMeta[e]?.type] || ROAD_TYPES.road;
      const margin = T.width / 2 + 2.6;          // carriageway + footpath clearance
      for (let i = 0; i < pts.length - 1; i++) {
        if (segPointDist(c.x, c.z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z) < margin) return true;
      }
    }
    return false;
  }
  // Walkable = on land and not occupied by a building (i.e. a street/open space).
  _walkable(x, y) { return this.isLand(x, y) && !(this.state?.grid?.[y]?.[x]); }

  // Project a grid cell to absolute viewport pixel coordinates (for tests/UX).
  cellToScreen(gx, gy) {
    const c = cellToWorld(gx, gy);
    const v = new THREE.Vector3(c.x, 1, c.z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 };
  }
  // Project a world-space point (x,y,z) to screen pixels — used by tests/tools.
  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 };
  }

  _hover(p) {
    if (this._roundaboutPreview) { this._roundaboutHover(p); this._hideHoverTile(); return; }  // show where the roundabout lands
    if (this.pieceMode) { this._lastHover = p; this._piecePreview(p); this._hideHoverTile(); return; } // placing a fixed Lego piece
    if (this.drawMode) {                                  // road/area drawing — fully free-style
      this._drawHover(p);                                 // free cursor at the exact point; snap ring only AT a road end
      this._hideHoverTile();                              // no grid tile (this isn't a per-cell placement)
      return;
    }
    if (!this.previewKey && !this.bulldoze) { if (this.ghost) this.ghost.visible = false; this._hideHoverTile(); return; }
    const cell = this._raycastCell(p);
    this.hoverCell = cell;
    this._updateGhost();
    if (cell) {
      const occupied = this.buildings.has(`${cell.x},${cell.y}`);
      const ok = this.bulldoze ? occupied : (this.isLand(cell.x, cell.y) && !occupied && !this.isRoadAt(cell.x, cell.y));
      this._updateHoverTile(cell.x, cell.y, ok);
    } else this._hideHoverTile();
  }
  // A Sims-style highlight on the grid tile under the cursor: a translucent fill
  // with a bright border, green when the action is valid, red when it isn't.
  _updateHoverTile(x, y, ok) {
    if (!this._tileHi) {
      const g = new THREE.Group();
      const geo = new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94);
      // a soft dark drop-shadow on the land grounds the highlight (Sims-style)
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 1.04, TILE * 1.04),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.04; g.add(shadow);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; g.add(fill);
      const ring = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ transparent: true, opacity: 1 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
      g.renderOrder = 4; this.scene.add(g);
      this._tileHi = g; this._tileHiFill = fill.material; this._tileHiRing = ring.material;
    }
    const c = cellToWorld(x, y);
    this._tileHi.position.set(c.x, this.terrainHeight(x, y) + 0.16, c.z);
    this._tileHiFill.color.setHex(ok ? 0x5fe05f : 0xff5a5a);
    this._tileHiRing.color.setHex(ok ? 0xbafd7a : 0xff8a7a);
    this._tileHi.visible = true;
  }
  _hideHoverTile() { if (this._tileHi) this._tileHi.visible = false; }
  // While in draw mode (and not mid-stroke), light up the nearest existing road
  // end the cursor/pencil is near, so the player knows they can start there.
  _drawHover(p) {
    if (this._drawing) { this._clearSnapMarker(); this._hideDrawCursor(); return; }
    const g = this._raycastGround(p);
    // SNAP onto an existing road end/junction (or onto a road itself for a T) — and
    // onto a railway/runway end when drawing those — so the player can continue or
    // join a route. The marker shows what was detected. Area-draw never snaps.
    const s = g ? this._drawSnap(g.x, g.z) : null;
    this._snap = s;
    if (s) { this._showSnapMarker(s.x, s.z); this._hideDrawCursor(); }
    else { this._clearSnapMarker(); this._updateDrawCursor(g); }   // free-floating marker exactly under the cursor
  }
  // The best snap target near (x,z) for the active draw tool: a road node/junction
  // or a point on a road (so a new road can tee onto it) when drawing roads, or the
  // nearest railway/runway endpoint when drawing those. Radius scales with zoom.
  _drawSnap(x, z) {
    if (this._drawArea) return null;
    const maxD = Math.min(10, Math.max(3.5, this.cam.radius * 0.05));
    if (this._drawRail) {
      // snap to an existing track end OR to a station, so an MRT line LINKS up to its
      // MRT stations (and a railway to its train stations) as you draw.
      const end = this._nearestPolyEnd((this.state && this.state.railways) || [], x, z, maxD);
      const st = this._nearestStation(x, z, maxD, this._drawType === 'mrt' ? ['mrt'] : ['rail_station']);
      return (st && (!end || st.d < end.d)) ? st : end;
    }
    if (this._drawAir) return this._nearestPolyEnd((this.state && this.state.airstrips) || [], x, z, maxD);
    let best = null;
    for (const n of (this.navNodes || [])) { const d = Math.hypot(n.x - x, n.z - z); if (d < (best ? best.d : maxD)) best = { x: n.x, z: n.z, d, kind: 'node' }; }
    for (let e = 0; e < this.edgePts.length; e++) {
      const pts = this.edgePts[e]; if (!pts) continue;
      for (let i = 0; i < pts.length - 1; i++) { const pr = this._projOnSeg(x, z, pts[i], pts[i + 1]); if (pr.d < (best ? best.d : maxD)) best = { x: pr.x, z: pr.z, d: pr.d, kind: 'edge' }; }
    }
    return best;
  }
  _nearestPolyEnd(list, x, z, maxD) {
    let best = null;
    for (const entry of list) {
      const poly = Array.isArray(entry) ? entry : (entry && entry.pts); if (!poly || poly.length < 2) continue;
      for (const idx of [0, poly.length - 1]) { const px = poly[idx][0], pz = poly[idx][1], d = Math.hypot(px - x, pz - z); if (d < (best ? best.d : maxD)) best = { x: px, z: pz, d, kind: 'end' }; }
    }
    return best;
  }
  // Nearest placed station building (by world position) of the given keys — lets a
  // drawn track snap its endpoint onto a station so the two link up.
  _nearestStation(x, z, maxD, keys) {
    let best = null;
    for (const [, e] of (this.buildings || [])) {
      if (!e || !keys.includes(e.key) || !e.group) continue;
      const p = e.group.position, d = Math.hypot(p.x - x, p.z - z);
      if (d < (best ? best.d : maxD)) best = { x: p.x, z: p.z, d, kind: 'station' };
    }
    return best;
  }
  _projOnSeg(x, z, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, pz = a.z + dz * t; return { x: px, z: pz, t, d: Math.hypot(x - px, z - pz) };
  }
  // A small free cursor that sits exactly where you point on the terrain (no grid).
  _updateDrawCursor(g) {
    if (!g) { this._hideDrawCursor(); return; }
    if (!this._drawCursor) {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.25, 28), new THREE.MeshBasicMaterial({ color: 0x2bd4c0, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false }));
      ring.rotation.x = -Math.PI / 2; grp.add(ring);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
      dot.rotation.x = -Math.PI / 2; grp.add(dot);
      grp.renderOrder = 6; this.scene.add(grp); this._drawCursor = grp;
    }
    this._drawCursor.position.set(g.x, this._roadY(g.x, g.z) + 0.12, g.z);
    this._drawCursor.visible = true;
  }
  _hideDrawCursor() { if (this._drawCursor) this._drawCursor.visible = false; }
  // ---- Lego-style fixed road/rail/runway pieces ----------------------------
  // Turn placement on/off. opts: { piece:'straight'|'curveL'|'curveR', kind, type,
  // elevated, onChain(mergedPts) }. A ghost follows the cursor and snaps to route
  // ends; tapping STAGES pieces into a pending chain (built first, committed once).
  setPieceMode(on, opts) {
    this.pieceMode = on ? (opts || {}) : null;
    this.onPieceChain = on && opts ? opts.onChain : null;
    this._pieceChain = [];
    if (this._pieceRot == null) this._pieceRot = 0;
    if (!on) { this._piecePts = null; this.clearRoadPreview(); this._clearSnapMarker(); }
  }
  // Drop the pending (un-committed) piece chain.
  clearPieceChain() { this._pieceChain = []; this._piecePts = null; this.clearRoadPreview(); this._clearSnapMarker(); }
  // Show a translucent roundabout ring under the cursor so the player can see
  // exactly where it will land before tapping.
  setRoundaboutPreview(on) { this._roundaboutPreview = !!on; if (!on && this._raGhost) this._raGhost.visible = false; }
  _roundaboutHover(p) {
    const g = this._raycastGround(p); if (!g) { if (this._raGhost) this._raGhost.visible = false; return; }
    if (!this._raGhost) {
      const grp = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.7, 8, 32), new THREE.MeshBasicMaterial({ color: 0x2bd4c0, transparent: true, opacity: 0.65, depthWrite: false, depthTest: false }));
      ring.rotation.x = -Math.PI / 2; grp.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0x2bd4c0, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2; grp.add(disc);
      grp.renderOrder = 6; this.scene.add(grp); this._raGhost = grp;
    }
    this._raGhost.position.set(g.x, this._roadY(g.x, g.z) + 0.15, g.z);
    this._raGhost.visible = true;
  }
  // The end point + heading of the pending chain (so the next piece continues it).
  _pieceChainEnd() {
    const ch = this._pieceChain; if (!ch || !ch.length) return null;
    const last = ch[ch.length - 1], a = last[last.length - 2], b = last[last.length - 1];
    return { x: b.x, z: b.z, heading: Math.atan2(b.z - a.z, b.x - a.x) };
  }
  // The pending chain merged into one polyline (shared joints de-duplicated).
  _mergedChain() {
    const out = [];
    for (const piece of (this._pieceChain || [])) for (let i = 0; i < piece.length; i++) { if (out.length && i === 0) continue; out.push({ x: piece[i].x, z: piece[i].z }); }
    return out;
  }
  // Rotate the road you're building: spin the whole staged chain about its start
  // (so you can aim it before committing); with no chain yet, spin the first ghost.
  rotatePiece(d) {
    this._pieceRot = (this._pieceRot || 0) + d;
    if (this._pieceChain && this._pieceChain.length) {
      const o = this._pieceChain[0][0], c = Math.cos(d), s = Math.sin(d);
      for (const piece of this._pieceChain) for (const pt of piece) {
        const dx = pt.x - o.x, dz = pt.z - o.z; pt.x = o.x + dx * c - dz * s; pt.z = o.z + dx * s + dz * c;
      }
      if (this._lastHover) this._piecePreview(this._lastHover); else this._renderDrawPreview(this._mergedChain());
      if (this.onPieceChain) this.onPieceChain(this._mergedChain());   // keep the commit geometry in sync
    } else if (this._lastHover) {
      this._piecePreview(this._lastHover);                              // spin the first ghost about the cursor
    }
  }
  // Build a fixed piece polyline anchored at `anchor` (an end or the cursor),
  // heading `h` (radians, dir = cos h, sin h in x/z). Fixed length / radius.
  _buildPiece(piece, anchor, h) {
    const L = 22, R = 22, ANG = Math.PI / 2, N = 12;
    const dx = Math.cos(h), dz = Math.sin(h);
    if (piece === 'straight') return [{ x: anchor.x, z: anchor.z }, { x: anchor.x + dx * L, z: anchor.z + dz * L }];
    const left = piece === 'curveL';
    const px = left ? -dz : dz, pz = left ? dx : -dx;            // toward the turn centre
    const cx = anchor.x + px * R, cz = anchor.z + pz * R;
    const phi0 = Math.atan2(anchor.z - cz, anchor.x - cx), sweep = left ? ANG : -ANG;
    const pts = [];
    for (let i = 0; i <= N; i++) { const phi = phi0 + sweep * (i / N); pts.push({ x: cx + Math.cos(phi) * R, z: cz + Math.sin(phi) * R }); }
    return pts;
  }
  // Nearest existing route END to (x,z) for the active piece kind, with the OUTWARD
  // heading there so a piece continues the line (chaining like track).
  _pieceSnap(x, z) {
    const maxD = Math.min(10, Math.max(4, this.cam.radius * 0.06)), kind = this.pieceMode.kind;
    if (kind === 'rail' || kind === 'air') {
      const list = kind === 'rail' ? ((this.state && this.state.railways) || []) : ((this.state && this.state.airstrips) || []);
      let best = null;
      for (const entry of list) {
        const poly = Array.isArray(entry) ? entry : (entry && entry.pts); if (!poly || poly.length < 2) continue;
        for (const [e, q] of [[poly[0], poly[1]], [poly[poly.length - 1], poly[poly.length - 2]]]) {
          const d = Math.hypot(e[0] - x, e[1] - z); if (d < (best ? best.d : maxD)) best = { x: e[0], z: e[1], d, heading: Math.atan2(e[1] - q[1], e[0] - q[0]) };
        }
      }
      // also chain a viaduct/railway onto a station, heading outward toward the cursor
      const st = this._nearestStation(x, z, maxD, kind === 'rail' ? ['mrt', 'rail_station'] : []);
      if (st && (!best || st.d < best.d)) best = { x: st.x, z: st.z, d: st.d, heading: Math.atan2(z - st.z, x - st.x) };
      return best;
    }
    let best = null, bi = -1;
    for (let i = 0; i < (this.navNodes || []).length; i++) { const n = this.navNodes[i]; const d = Math.hypot(n.x - x, n.z - z); if (d < (best ? best.d : maxD)) { best = { x: n.x, z: n.z, d }; bi = i; } }
    if (best) best.heading = this._nodeOutHeading(bi);
    return best;
  }
  _nodeOutHeading(ni) {
    for (let e = 0; e < this.edgePts.length; e++) {
      const pts = this.edgePts[e]; if (!pts || pts.length < 2) continue;
      if (this.edgeN1[e] === ni) return Math.atan2(pts[0].z - pts[1].z, pts[0].x - pts[1].x);
      if (this.edgeN2[e] === ni) { const m = pts.length - 1; return Math.atan2(pts[m].z - pts[m - 1].z, pts[m].x - pts[m - 1].x); }
    }
    return this._pieceRot || 0;
  }
  _piecePreview(p) {
    const g = this._raycastGround(p);
    const end = this._pieceChainEnd();
    let anchor, heading, snap = null, ringAt = null;
    if (end) { anchor = { x: end.x, z: end.z }; heading = end.heading; ringAt = end; }   // continue the pending chain
    else {
      if (!g) { this._piecePts = null; this.clearRoadPreview(); this._clearSnapMarker(); return; }
      snap = this._pieceSnap(g.x, g.z);
      anchor = snap ? { x: snap.x, z: snap.z } : { x: g.x, z: g.z };
      heading = snap ? snap.heading : (this._pieceRot || 0);
      ringAt = snap;
    }
    this._piecePts = this._buildPiece(this.pieceMode.piece, anchor, heading);
    // show the whole pending chain plus the current ghost piece at its end
    const preview = this._mergedChain();
    for (let i = preview.length ? 1 : 0; i < this._piecePts.length; i++) preview.push({ x: this._piecePts[i].x, z: this._piecePts[i].z });
    this._renderDrawPreview(preview.length >= 2 ? preview : this._piecePts.map((q) => ({ x: q.x, z: q.z })));
    if (ringAt) this._showSnapMarker(ringAt.x, ringAt.z); else this._clearSnapMarker();
  }
  _showSnapMarker(x, z) {
    if (!this._snapMarker) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.55, 8, 24), toon(0xffd24a));
      ring.rotation.x = -Math.PI / 2; this.scene.add(ring); this._snapMarker = ring;
    }
    this._snapMarker.position.set(x, this._roadY(x, z) + 0.35, z);
    this._snapMarker.visible = true;
  }
  _clearSnapMarker() { if (this._snapMarker) this._snapMarker.visible = false; this._snap = null; }
  // Live preview of what's being drawn: a road ribbon (its true width) under a
  // bright glow, or a closed outline for a reclamation area. Stays up until the
  // player commits or cancels.
  _renderDrawPreview(pts) {
    if (this._drawPreviewGroup) this.scene.remove(this._drawPreviewGroup);
    const g = new THREE.Group(); this.scene.add(g); this._drawPreviewGroup = g;
    if (!pts || !pts.length) return;
    // smooth the live stroke so the preview matches the finished road (same zoom-scaled tolerance)
    const sm = smoothRoute(pts, Math.min(7, Math.max(3, this.cam.radius * 0.035)));
    const V = sm.map((q) => new THREE.Vector3(q.x, this._roadY(q.x, q.z), q.z));
    // a terrain-FOLLOWING ribbon (per-point height) — a flat ribbon would sink
    // under the hills and vanish, which is why the preview wasn't visible before.
    const ribbon = (vp, hw, color, lift) => {
      if (vp.length < 2) return;
      const v = [], idx = [];
      for (let i = 0; i < vp.length; i++) {
        const a = vp[Math.max(0, i - 1)], b = vp[Math.min(vp.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const nx = -tz, nz = tx, p = vp[i];
        v.push(p.x + nx * hw, p.y + lift, p.z + nz * hw, p.x - nx * hw, p.y + lift, p.z - nz * hw);
      }
      for (let i = 0; i < vp.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, toon(color, { side: THREE.DoubleSide })));
    };
    if (this._drawArea) {
      if (V.length >= 2) { const loop = V.concat([V[0]]); ribbon(loop, 1.7, 0xffd23a, 0.16); ribbon(loop, 0.5, 0x2bd4c0, 0.2); }
    } else if (V.length >= 2) {
      const hw = this._drawRail ? 1.7 : this._drawAir ? 4.5 : (ROAD_TYPES[this._drawType]?.renderHW || 0.34);
      ribbon(V, Math.max(hw + 1.8, 2.2), 0xffd23a, 0.14);   // wide bright glow, hugs the ground — clearly visible at any zoom
      ribbon(V, hw, this._drawRail ? 0x5b5040 : this._drawAir ? 0x35383d : 0x2b2f35, 0.22); // the real (thin) carriageway on top
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    tip.position.copy(V[V.length - 1]); tip.position.y += 0.6; g.add(tip);
  }
  // Grid cells inside a drawn world-space loop that can be reclaimed (for area reclaim).
  _cellsInArea(pts) {
    if (!pts || pts.length < 3) return [];
    const poly = pts.map((q) => [q.x, q.z]);
    const inside = (x, z) => {
      let h = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) h = !h;
      }
      return h;
    };
    const out = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.canReclaim(x, y)) continue;
      const w = cellToWorld(x, y);
      if (inside(w.x, w.z)) out.push([x, y]);
    }
    return out;
  }

  // ---- external API (mirrors the 2D view) ----------------------------------
  setState(state) { this.state = state; this.rebuildRoadNet(); this._relocateHeritageOffRoads(); this.applyHeritageToGrid(state); this._syncReclaimed(); this.syncAll(); this._buildPlayerRailways(state); this._buildPlayerAirstrips(state); this.syncRoadworks(state); }
  setShortages(s) { this.shortages = s; }
  setPreview(key, theme) {
    this.previewKey = key; this.previewTheme = theme; this.bulldoze = false;
    this._makeGhost(key);
  }
  // The orientation (radians) the player has dialled in for the next building; the
  // ghost previews it and onTileTap stamps it onto the placed cell.
  setBuildRotation(rad) { this.buildRot = rad; if (this.ghost) this.ghost.rotation.y = rad; }
  setBulldoze(on) {
    this.bulldoze = on; this.previewKey = null;
    this._makeGhost(null);
  }

  _makeGhost(key) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (!key) return;
    const g = makeBuilding(key, this.previewTheme);
    g.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true; o.material.opacity = 0.5;
        o.castShadow = false;
      }
    });
    g.scale.setScalar(MODEL_SCALE); // match the placed-building size on the live grid
    this.ghost = g; this.ghost.visible = false;
    this.scene.add(g);
  }
  // ---- place-then-adjust: a PENDING object sits on the ground (not yet committed)
  // so the player can rotate / move / remove it and SEE it before confirming -------
  enterAdjust(x, y, key, theme, rot) {
    this.clearAdjust();
    const g = makeBuilding(key, theme); g.scale.setScalar(MODEL_SCALE);
    const c = cellToWorld(x, y), hy = this.terrainHeight(x, y);
    g.position.set(c.x, hy, c.z); g.rotation.y = rot || 0; this.scene.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(TILE * 0.55, TILE * 0.82, 28),
      new THREE.MeshBasicMaterial({ color: 0x8fe05a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, hy + 0.14, c.z); this.scene.add(ring);
    this._adjust = { x, y, key, theme, rot: rot || 0, mesh: g, ring };
    if (this.ghost) this.ghost.visible = false;
  }
  setAdjustRotation(rot) { if (this._adjust) { this._adjust.rot = rot; this._adjust.mesh.rotation.y = rot; } }
  moveAdjust(x, y) {
    if (!this._adjust) return;
    const c = cellToWorld(x, y), hy = this.terrainHeight(x, y);
    this._adjust.mesh.position.set(c.x, hy, c.z); this._adjust.ring.position.set(c.x, hy + 0.14, c.z);
    this._adjust.x = x; this._adjust.y = y;
  }
  clearAdjust() {
    if (!this._adjust) return;
    this.scene.remove(this._adjust.mesh); this.scene.remove(this._adjust.ring);
    if (this._adjust.ring.geometry) this._adjust.ring.geometry.dispose();
    this._adjust = null;
  }
  adjustActive() { return !!this._adjust; }
  // Nearest grid cell that sits on a drawn track (MRT only when mrtOnly), within
  // maxCells — used to SNAP a station onto the line the player has drawn.
  _nearestTrackCell(x, y, maxCells, mrtOnly) {
    const rails = (this.state && this.state.railways) || [];
    const c = cellToWorld(x, y); let best = null;
    for (const entry of rails) {
      if (mrtOnly && !(entry && entry.mrt)) continue;
      const poly = Array.isArray(entry) ? entry : (entry && entry.pts); if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length - 1; i++) {
        const pr = this._projOnSeg(c.x, c.z, { x: poly[i][0], z: poly[i][1] }, { x: poly[i + 1][0], z: poly[i + 1][1] });
        if (!best || pr.d < best.d) best = { x: pr.x, z: pr.z, d: pr.d };
      }
    }
    if (!best || best.d > maxCells * TILE) return null;
    return { x: Math.round(best.x / TILE + N / 2), y: Math.round(N / 2 - best.z / TILE) };
  }
  _updateGhost() {
    if (this._adjust) { if (this.ghost) this.ghost.visible = false; return; }  // pending object shown instead
    if (!this.ghost || !this.hoverCell) { if (this.ghost) this.ghost.visible = false; return; }
    const { x, y } = this.hoverCell;
    const c = cellToWorld(x, y);
    this.ghost.position.set(c.x, this.terrainHeight(x, y), c.z);
    this.ghost.rotation.y = this.buildRot || 0; // preview the player's chosen orientation
    this.ghost.visible = true;
    const ok = this.isLand(x, y) && !this.buildings.has(`${x},${y}`);
    this.ghost.traverse((o) => { if (o.material) o.material.color.set(ok ? 0x9be15d : 0xff5a5a); });
  }

  // Rebuild every building mesh from the current state (no animation).
  syncAll() {
    for (const { group } of this.buildings.values()) this.scene.remove(group);
    this.buildings.clear();
    for (const s of this.sites.values()) this.scene.remove(s.group);
    this.sites.clear();
    if (!this.state) { this._refreshNature(); return; }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cell = this.state.grid[y]?.[x];
        if (!cell) continue;
        if (cell.heritage) continue; // 1965 heritage building — drawn by heritageGroup, not here
        if (cell.build && cell.build.left > 0) continue; // shown as a construction site below
        this._addMesh(x, y, cell.k, false, cell.c);
      }
    }
    this.syncConstruction(this.state); // spawn sites for anything still building
    this._alignMrtStations();          // lift any MRT station that sits on a viaduct to meet the deck
    this._refreshNature();
  }

  // ---- construction sites ---------------------------------------------------
  // Reconcile the visible construction sites with state: spawn sites for cells
  // still building, advance their progress, and pop the finished building when a
  // site tops out. Cheap — iterates only the active-construction list.
  syncConstruction(state) {
    if (!state) return;
    const active = new Set();
    for (const [x, y] of (state.constructing || [])) {
      const c = state.grid[y] && state.grid[y][x];
      if (!c || !c.build) continue;
      const id = `${x},${y}`; active.add(id);
      if (!this.sites.has(id)) this._startSite(x, y, c.k, c.c, c.build.total);
      this._setSiteProgress(id, 1 - c.build.left / Math.max(1, c.build.total));
    }
    for (const id of [...this.sites.keys()]) {
      if (active.has(id)) continue;                 // this site has finished or been removed
      const [x, y] = id.split(',').map(Number);
      const cell = state.grid[y] && state.grid[y][x];
      this._removeSite(id);
      if (cell && cell.k && !cell.build) {                  // pop the completed building
        this._addMesh(x, y, cell.k, true, cell.c);
        if (cell.k === 'mrt') this._buildPlayerRailways(state);   // re-level the deck across the new platform, lift the station onto it, retrain
        else if (cell.k === 'rail_station') this._refreshTrainStops(); // it becomes a new STOP for the line's trains
      }
    }
  }
  _startSite(x, y, key, theme, total) {
    const id = `${x},${y}`;
    if (this.buildings.has(id)) this.removeBuilding(x, y);
    if (this.sites.has(id)) this._removeSite(id);
    const c = cellToWorld(x, y);
    const wrap = new THREE.Group();
    wrap.position.set(c.x, this.terrainHeight(x, y), c.z);
    const rcell = this.state?.grid?.[y]?.[x];
    wrap.rotation.y = (rcell && typeof rcell.r === 'number') ? rcell.r : (Math.floor(Math.random() * 4)) * Math.PI / 2;
    wrap.scale.setScalar(MODEL_SCALE); // whole site (building + crane) sized to the live cell
    this.scene.add(wrap);
    // the target building, measured then flattened so it rises with progress
    const b = makeBuilding(key, theme);
    const box = new THREE.Box3().setFromObject(b);
    const sx = Math.max(2, box.max.x - box.min.x), sz = Math.max(2, box.max.z - box.min.z);
    const H = Math.max(3, box.max.y - box.min.y);
    b.scale.set(1, 0.02, 1); wrap.add(b);
    const poleMat = toon(0xcaa94e);
    const hw = sx / 2 + 0.5, hd = sz / 2 + 0.5;
    for (const [px, pz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.18, H, 0.18), poleMat);
      pole.position.set(px, H / 2, pz); wrap.add(pole);
    }
    // translucent yellow work platform marks the part being built right now
    const plat = new THREE.Mesh(new THREE.BoxGeometry(sx + 1.0, 0.25, sz + 1.0), toon(0xffd23f, { transparent: true, opacity: 0.5 }));
    plat.position.y = 0.3; wrap.add(plat);
    // a tower crane beside the site
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.3, H + 6, 0.3), poleMat);
    mast.position.set(hw + 1.2, (H + 6) / 2, hd + 1.2); wrap.add(mast);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(sx + 3, 0.22, 0.22), poleMat);
    jib.position.set(hw + 1.2 - (sx + 3) / 2 + 0.3, H + 5.6, hd + 1.2); wrap.add(jib);
    this.sites.set(id, { group: wrap, b, plat, H });
    const dg = this.natureCells && this.natureCells.get(id); if (dg) dg.visible = false;
    this._spawnDust(c.x, c.z, 0xcab98a, 10);
  }
  _setSiteProgress(id, prog) {
    const s = this.sites.get(id); if (!s) return;
    const p = Math.max(0.02, Math.min(1, prog));
    s.b.scale.y = p;                       // building rises from its base
    s.plat.position.y = p * s.H + 0.2;     // platform rides the construction front
    s.plat.visible = p < 0.98;
  }
  _removeSite(id) {
    const s = this.sites.get(id); if (!s) return;
    this.scene.remove(s.group); this.sites.delete(id);
  }

  _addMesh(x, y, key, animate, theme) {
    const id = `${x},${y}`;
    if (this.buildings.has(id)) this.removeBuilding(x, y, false);
    const b = BUILDINGS[key];
    if (!b) return; // unknown building key (e.g. a landmark def missing) — skip
    const group = makeBuilding(key, theme);
    const c = cellToWorld(x, y);
    group.position.set(c.x, this.terrainHeight(x, y), c.z);
    const rcell = this.state?.grid?.[y]?.[x];
    group.rotation.y = (rcell && typeof rcell.r === 'number') ? rcell.r : (Math.floor(Math.random() * 4)) * Math.PI / 2;
    group.castShadow = true;
    this.scene.add(group);
    const tall = b.cat === 'residential' || b.cat === 'industry';
    const entry = { group, key, tall, anim: false };
    this.buildings.set(id, entry);
    if (animate) {
      group.scale.set(MODEL_SCALE, MODEL_SCALE * 0.001, MODEL_SCALE);
      entry.anim = true;
      this.anims.push({ group, entry, t: 0, dur: 0.9, type: 'build' });
      this._spawnDust(c.x, c.z, 0x9ad06a);
    } else {
      group.scale.set(MODEL_SCALE, MODEL_SCALE * (tall ? this.devFactor : 1), MODEL_SCALE);
    }
  }

  // called by main.js after a successful build
  onBuilt(x, y, key, theme) {
    this._addMesh(x, y, key, true, theme);
    if (key === 'mrt' && this.state) this._buildPlayerRailways(this.state);   // re-level the deck across the new platform + realign + retrain
    else if (key === 'rail_station') this._refreshTrainStops();               // a new station becomes a stop
    const g = this.natureCells?.get(x + ',' + y); if (g) g.visible = false;  // clear trees under it
  }

  // called by main.js after demolish
  onDemolished(x, y) {
    const id = `${x},${y}`;
    if (this.sites.has(id)) { // was still under construction — tear down the site
      this._removeSite(id);
      const c = cellToWorld(x, y); this._spawnDust(c.x, c.z, 0xbfb09a, 18);
      const g = this.natureCells && this.natureCells.get(id); if (g) g.visible = true;
    }
    const entry = this.buildings.get(id);
    if (!entry) return;
    this.buildings.delete(id);
    this.anims.push({ group: entry.group, t: 0, dur: 0.8, type: 'demolish', baseY: entry.group.position.y });
    const c = cellToWorld(x, y);
    this._spawnDust(c.x, c.z, 0xbfb09a, 26);
    const g = this.natureCells?.get(x + ',' + y); if (g) g.visible = true;   // greenery returns
    if (entry.key === 'mrt' && this.state) this._buildPlayerRailways(this.state);  // re-level the deck (the removed platform no longer flattens it) + realign + retrain
    else if (entry.key === 'rail_station') this._refreshTrainStops();        // a demolished station is no longer a stop
  }
  removeBuilding(x, y) {
    const id = `${x},${y}`;
    const e = this.buildings.get(id);
    if (e) { this.scene.remove(e.group); this.buildings.delete(id); }
  }

  // ---- dust particles -------------------------------------------------------
  _spawnDust(x, z, color = 0xcccccc, count = 16) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      p[i * 3] = x + (Math.random() - 0.5) * 6;
      p[i * 3 + 1] = 1 + Math.random() * 2;
      p[i * 3 + 2] = z + (Math.random() - 0.5) * 6;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 8, (Math.random() - 0.5) * 8));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 2.4, transparent: true, opacity: 0.9 }));
    this.scene.add(pts);
    this.dust.push({ pts, vel, t: 0, dur: 1.1 });
  }

  // ---- unified traffic (grid + freeform roads share ONE network) -----------
  _assignLane(a) {
    const meta = this.edgeMeta[a.edge] || { type: 'road', lanes: 2 };
    const T = ROAD_TYPES[meta.type] || ROAD_TYPES.road;
    const hw = T.width / 2;
    if (a.group === 'veh') {
      const lpd = Math.max(1, Math.round((meta.lanes || 2) / 2));
      const li = (a.laneIdx || 0) % lpd;
      a.lane = (li + 0.5) * (hw / lpd);          // keep-left; opposing dir auto-mirrors
    } else {
      a.lane = (hw + 0.7) * (a.side || 1);       // pedestrians on the pavement
    }
  }
  _edgesNear(R, walkOnly) {
    const out = []; const tx = this.target.x, tz = this.target.z;
    for (let i = 0; i < this.edgeMid.length; i++) {
      if (walkOnly && !this.edgeMeta[i].walk) continue;
      const m = this.edgeMid[i];
      if (Math.hypot(m.x - tx, m.z - tz) <= R) out.push(i);
    }
    return out;
  }
  _pickNetEdge(node, fromEdge, walkOnly, head) {
    const all = this.navAdj[node] || [];
    let pool = all.filter((l) => l.edge !== fromEdge && (!walkOnly || this.edgeMeta[l.edge].walk));
    if (!pool.length) pool = all.filter((l) => !walkOnly || this.edgeMeta[l.edge].walk);
    if (!pool.length) return null;
    if (head && Math.random() < 0.82) {            // prefer continuing roughly straight
      let best = -2, pick = null;
      for (const l of pool) {
        const pts = this.edgePts[l.edge];
        const a = l.fwd ? pts[0] : pts[pts.length - 1], b = l.fwd ? pts[1] : pts[pts.length - 2];
        const dx = b.x - a.x, dz = b.z - a.z, ln = Math.hypot(dx, dz) || 1;
        const dot = (dx / ln) * head.x + (dz / ln) * head.z;
        if (dot > best) { best = dot; pick = l; }
      }
      return pick;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  _advanceNet(list, dt) {
    const grp = new Map();
    for (const a of list) { if (!a.mesh.visible) continue; const k = a.edge + ':' + a.dir; let g = grp.get(k); if (!g) grp.set(k, g = []); g.push(a); }
    for (const g of grp.values()) { g.sort((p, q) => (p.dir > 0 ? p.t - q.t : q.t - p.t)); for (let i = 0; i < g.length; i++) g[i]._lead = g[i + 1] || null; }
    for (const a of list) {
      if (!a.mesh.visible) continue;
      if (!this.edgePts[a.edge]) continue;   // edge removed by a rebuild this frame
      const len = this.edgeLen[a.edge] || 1;
      let adv = dt * a.speed / len;
      if (a._lead) {
        const gap = (a.len * 0.5 + a._lead.len * 0.5 + (a.group === 'veh' ? 1.6 : 0.5)) / len;
        const ad = a.dir > 0 ? a._lead.t - a.t : a.t - a._lead.t;
        if (ad < gap) adv = Math.max(0, adv - (gap - ad) * 0.7);
      }
      const prevT = a.t;
      a.t += adv * a.dir; a._lead = null;
      // stop on red at the junction ahead (vehicles only)
      if (a.group === 'veh') {
        const node = a.dir > 0 ? this.edgeN2[a.edge] : this.edgeN1[a.edge];
        if (!this._greenFor(node, a.edge)) {
          const stop = 2.4 / len;
          if (a.dir > 0) a.t = Math.min(a.t, Math.max(prevT, 1 - stop));
          else a.t = Math.max(a.t, Math.min(prevT, stop));
        }
      }
      const moving = Math.abs(a.t - prevT) > 1e-5;
      if (a.t >= 1 || a.t <= 0) {
        const atEnd = a.t >= 1;
        const node = atEnd ? this.edgeN2[a.edge] : this.edgeN1[a.edge];
        const pts = this.edgePts[a.edge];
        const p0 = atEnd ? pts[pts.length - 2] : pts[1], p1 = atEnd ? pts[pts.length - 1] : pts[0];
        const head = { x: p1.x - p0.x, z: p1.z - p0.z };
        const nx = this._pickNetEdge(node, a.edge, a.group === 'ped', head);
        if (!nx) { a.dir *= -1; a.t = THREE.MathUtils.clamp(a.t, 0, 1); }
        else { a.edge = nx.edge; a.dir = nx.fwd ? 1 : -1; a.t = nx.fwd ? 0.001 : 0.999; this._assignLane(a); }
        continue;
      }
      this._placeNetAgent(a, dt, moving);
    }
  }
  _placeNetAgent(a, dt, moving) {
    const pts = this.edgePts[a.edge]; const segs = pts.length - 1;
    const f = THREE.MathUtils.clamp(a.t, 0, 1) * segs;
    const i = Math.min(segs - 1, Math.floor(f)), fr = f - i;
    const p0 = pts[i], p1 = pts[i + 1];
    const x = p0.x + (p1.x - p0.x) * fr, y = p0.y + (p1.y - p0.y) * fr, z = p0.z + (p1.z - p0.z) * fr;
    let dx = p1.x - p0.x, dz = p1.z - p0.z; if (a.dir < 0) { dx = -dx; dz = -dz; }
    const ln = Math.hypot(dx, dz) || 1; const ux = dx / ln, uz = dz / ln;
    const baseY = y + (a.group === 'veh' ? 0.0 : 0.02);
    a.mesh.position.set(x + uz * a.lane, baseY, z - ux * a.lane);
    a.mesh.rotation.y = Math.atan2(ux, uz);
    if (moving) a.phase += dt * a.speed * a.animK;
    const ud = a.mesh.userData;
    if (ud.upperLegs) {                            // pedestrian walk cycle
      const ph = a.phase, m = moving ? 1 : 0, sc = a.mesh.scale.x;
      const s = Math.sin(ph), amp = 0.5 * m + 0.02;
      ud.upperLegs[0].rotation.x = s * amp; ud.upperLegs[1].rotation.x = -s * amp;
      ud.lowerLegs[0].rotation.x = Math.max(0, Math.sin(ph - 1.1)) * 1.0 * m;
      ud.lowerLegs[1].rotation.x = Math.max(0, Math.sin(ph + Math.PI - 1.1)) * 1.0 * m;
      if (ud.umbrella.visible) {
        ud.upperArms[1].rotation.set(-2.5, 0, 0); ud.lowerArms[1].rotation.x = 0.4;
        ud.upperArms[0].rotation.x = -s * amp * 0.7; ud.lowerArms[0].rotation.x = 0.2;
      } else {
        ud.upperArms[0].rotation.x = -s * amp * 0.75; ud.upperArms[1].rotation.x = s * amp * 0.75;
        ud.lowerArms[0].rotation.x = 0.15 + Math.max(0, -s) * 0.4 * m;
        ud.lowerArms[1].rotation.x = 0.15 + Math.max(0, s) * 0.4 * m;
      }
      ud.torso.position.y = 0.95 + Math.abs(Math.sin(ph)) * 0.03 * m;
      a.mesh.position.y = baseY + Math.abs(Math.sin(ph)) * 0.04 * m * sc;
    }
  }

  // ---- vehicles (density scales with population) ----------------------------
  _ensureVehicles(target) {
    while (this.vehicles.length < target) this._addVehicle();
    while (this.vehicles.length > target) { const v = this.vehicles.pop(); this.scene.remove(v.mesh); }
  }
  _addVehicle() {
    if (!this.edgePts.length) return;
    // The on-road fleet's generation is set by the economy (fleetEra): a developed
    // nation imports the newest cars the moment the world invents them, a poorer
    // one keeps the old stock for years. Trishaws only roll in the vintage era.
    const gen = (this._fleet && this._fleet.car) || fleetEra(this.state || {}).car;
    const vintage = gen === 'vintage';
    const r = Math.random();
    const kind = vintage
      ? (r < 0.32 ? 'car' : r < 0.44 ? 'taxi' : r < 0.64 ? 'trishaw' : r < 0.8 ? 'bike' : r < 0.92 ? 'lorry' : 'bus')
      : (r < 0.46 ? 'car' : r < 0.6 ? 'taxi' : r < 0.76 ? 'bike' : r < 0.88 ? 'lorry' : 'bus');
    const { mesh, len } = makeVehicle(kind, gen);
    const VS = 0.6; mesh.scale.setScalar(VS);   // smaller vehicles relative to roads/buildings
    this.scene.add(mesh);
    const speed = { car: 6, taxi: 6, bike: 7, trishaw: 3, lorry: 4.5, bus: 4 }[kind];
    const ag = {
      mesh, len: len * VS, group: 'veh', kind, edge: Math.floor(Math.random() * this.edgePts.length),
      dir: Math.random() < 0.5 ? 1 : -1, t: Math.random(), phase: 0,
      speed: speed * (0.85 + Math.random() * 0.3), animK: 1, laneIdx: Math.floor(Math.random() * 3),
    };
    this._assignLane(ag);
    this.vehicles.push(ag);
  }

  // ---- pedestrians (level-of-detail: only when zoomed in) ------------------
  _updatePeople(dt) {
    const near = this.cam.radius < 150;
    if (near && !this.peopleOn) this._spawnPeople();
    if (!near && this.peopleOn) this._clearPeople();
    if (this.peopleOn) {
      const reach = Math.max(this.cam.radius * 1.4, 90);
      for (const ag of this.people) {
        const m = this.edgeMid[ag.edge]; if (!m) continue;
        if (Math.hypot(m.x - this.target.x, m.z - this.target.z) > reach) {
          const list = this._edgesNear(this.cam.radius, true);
          if (list.length) { ag.edge = list[Math.floor(Math.random() * list.length)]; ag.t = Math.random(); this._assignLane(ag); }
        }
      }
      this._advanceNet(this.people, dt);
      const rainy = (this.weather.rain || 0) > 0.35;
      if (rainy !== this._umbrellasOut) { this._umbrellasOut = rainy; for (const ag of this.people) ag.mesh.userData.umbrella.visible = rainy; }
    }
  }
  _spawnPeople() {
    this.peopleOn = true;
    // prefer footpaths near the camera; if it's over open country, fall back to
    // the nearest roads so the streets that DO exist still feel alive.
    let list = this._edgesNear(this.cam.radius, true);
    if (!list.length) list = this._edgesNear(Math.max(this.cam.radius * 2.6, WORLD * 0.4), true);
    if (!list.length) {                                   // nothing in range: take the nearest walkable edges
      const all = [];
      for (let i = 0; i < this.edgeMid.length; i++) {
        if (!this.edgeMeta[i].walk) continue;
        const m = this.edgeMid[i];
        all.push([Math.hypot(m.x - this.target.x, m.z - this.target.z), i]);
      }
      all.sort((a, b) => a[0] - b[0]);
      list = all.slice(0, 24).map((e) => e[1]);
    }
    if (!list.length) return;
    const count = Math.min(42, Math.max(12, Math.floor((this.state?.population || 0) / 12000)));
    while (this.people.length < count) {
      const kinds = ['man', 'woman', 'man', 'woman', 'child', 'elderly'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const { mesh, len } = makePerson(kind);
      mesh.scale.multiplyScalar(0.62);   // smaller pedestrians relative to the scene
      this.scene.add(mesh);
      const speed = { man: 1.4, woman: 1.3, child: 1.3, elderly: 0.85 }[kind]; // pedestrians clearly slower than any vehicle
      const ag = { mesh, len, group: 'ped', kind, edge: list[Math.floor(Math.random() * list.length)],
        dir: Math.random() < 0.5 ? 1 : -1, t: Math.random(), phase: Math.random() * 6, speed,
        animK: 5.5, side: Math.random() < 0.5 ? 1 : -1 };
      this._assignLane(ag);
      this.people.push(ag);
    }
    for (const ag of this.people) { ag.mesh.visible = true; ag.mesh.userData.umbrella.visible = !!this._umbrellasOut; }
  }
  _clearPeople() {
    this.peopleOn = false;
    for (const ag of this.people) ag.mesh.visible = false;
  }

  // ---- weather --------------------------------------------------------------
  _initWeather() {
    this.cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, gradientMap: toonGradient() });
    for (let i = 0; i < 16; i++) {
      const cl = new THREE.Group();
      const n = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 9, 7, 6), this.cloudMat);
        s.position.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 24);
        s.scale.y = 0.5; cl.add(s);
      }
      cl.position.set((Math.random() - 0.5) * WORLD * 2, 80 + Math.random() * 30, (Math.random() - 0.5) * WORLD * 2);
      this.scene.add(cl); this.clouds.push(cl);
    }
    const count = 1500, geo = new THREE.BufferGeometry(), p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { p[i * 3] = (Math.random() - 0.5) * 260; p[i * 3 + 1] = Math.random() * 150; p[i * 3 + 2] = (Math.random() - 0.5) * 260; }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbcd6ee, size: 1.2, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.visible = false; this.scene.add(this.rain);
    this._weatherTimer = 6 + Math.random() * 12;
    this._pickWeather();
  }
  _pickWeather() {
    const r = Math.random();
    const type = r < 0.36 ? 'sunny' : r < 0.6 ? 'cloudy' : r < 0.8 ? 'rain' : r < 0.91 ? 'windy' : 'storm';
    const W = {
      sunny: { cloud: 0.12, rain: 0, wind: 0.25 }, cloudy: { cloud: 0.6, rain: 0, wind: 0.4 },
      rain: { cloud: 0.8, rain: 0.6, wind: 0.5 }, windy: { cloud: 0.4, rain: 0, wind: 0.95 },
      storm: { cloud: 0.95, rain: 1, wind: 0.9 },
    }[type];
    this.weather.type = type; this._wTarget = { ...W };
    this.weather.windDir += (Math.random() - 0.5) * 1.6;
    this._weatherTimer = 8 + Math.random() * 22; // in-game days
  }
  _updateWeather(dt) {
    const w = this.weather, t = this._wTarget;
    this._weatherTimer -= (this._pendingDays || 0);
    this._pendingDays = 0;
    if (this._weatherTimer <= 0) this._pickWeather();
    const ap = (c, k) => c + (k - c) * Math.min(1, dt * 0.4);
    w.cloud = ap(w.cloud, t.cloud); w.rain = ap(w.rain, t.rain); w.wind = ap(w.wind, t.wind);

    this.fog.far = this.fogFar; // baseline (haze may lower it later)

    // clouds drift with the wind
    const wx = Math.cos(w.windDir), wz = Math.sin(w.windDir), sp = 6 + w.wind * 40;
    this.cloudMat.opacity = THREE.MathUtils.clamp(w.cloud * 0.85, 0, 0.85);
    for (const cl of this.clouds) {
      cl.position.x += wx * sp * dt; cl.position.z += wz * sp * dt;
      const lim = WORLD * 1.1;
      if (cl.position.x > lim) cl.position.x = -lim; if (cl.position.x < -lim) cl.position.x = lim;
      if (cl.position.z > lim) cl.position.z = -lim; if (cl.position.z < -lim) cl.position.z = lim;
    }
    // overcast dims the sun and greys the sky gradient
    this.sun.intensity *= (1 - w.cloud * 0.55);
    if (this.skyTop) {
      const grey = new THREE.Color(0xb7bdc2);
      this.skyTop.lerp(grey, w.cloud * 0.5);
      this.skyBot.lerp(grey, w.cloud * 0.5);
    }
    // rain
    const eff = Math.max(w.rain, this._floodRain ? 1 : 0);
    const vis = eff > 0.02; this.rain.visible = vis;
    if (vis) {
      this.rain.material.opacity = Math.min(0.75, eff * 0.85);
      const arr = this.rain.geometry.attributes.position.array;
      const fall = 150 * (0.6 + eff), sx = wx * w.wind * 70, sz = wz * w.wind * 70;
      const tx = this.target.x, tz = this.target.z;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += sx * dt; arr[i + 1] -= fall * dt; arr[i + 2] += sz * dt;
        if (arr[i + 1] < 0) { arr[i + 1] = 120 + Math.random() * 40; arr[i] = tx + (Math.random() - 0.5) * 260; arr[i + 2] = tz + (Math.random() - 0.5) * 260; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ---- disasters ------------------------------------------------------------
  playDisaster(type) {
    if (type === 'flood' || type === 'storm') {
      this.disaster = { type: 'flood', t: 0, dur: 10, peak: type === 'flood' ? 5 : 2.5 };
      this.floodPlane.visible = true; this._floodRain = true;
    } else if (type === 'haze') {
      this.disaster = { type: 'haze', t: 0, dur: 12 };
    } else if (type === 'quake') {
      this.disaster = { type: 'quake', t: 0, dur: 2.2 };
    }
  }
  _updateDisaster(dt) {
    const d = this.disaster;
    if (!d) return;
    d.t += dt;
    const k = d.t / d.dur;
    if (d.type === 'flood') {
      const lvl = Math.sin(Math.min(k, 1) * Math.PI);
      this.floodPlane.position.y = SEA_Y + lvl * d.peak;
      this.floodPlane.material.opacity = 0.35 + lvl * 0.3;
      if (k >= 1) { this.floodPlane.visible = false; this._floodRain = false; this.disaster = null; }
    } else if (d.type === 'haze') {
      const intensity = Math.sin(Math.min(k, 1) * Math.PI);
      this.fog.far = THREE.MathUtils.lerp(this.fogFar, 150, intensity);
      const brown = new THREE.Color(0xb59b6a);
      if (this.skyTop) { this.skyTop.lerp(brown, intensity * 0.6); this.skyBot.lerp(brown, intensity * 0.6); }
      if (k >= 1) this.disaster = null;
    } else if (d.type === 'quake') {
      const a = (1 - k) * 1.4;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (k >= 1) this.disaster = null;
    }
  }

  // Paint the current zenith->horizon colours into the sky gradient texture and
  // match the fog to the horizon. Called once per frame after all sky tints.
  _commitSky() {
    if (!this._skyCtx) { this.fog?.color.copy(this.skyBot); return; }
    const ctx = this._skyCtx, h = this._skyCanvas.height;
    const mid = this.skyTop.clone().lerp(this.skyBot, 0.62);
    const g = ctx.createLinearGradient(0, 0, 0, h);     // canvas top = screen top = zenith (flipY)
    g.addColorStop(0, '#' + this.skyTop.getHexString());
    g.addColorStop(0.6, '#' + mid.getHexString());
    g.addColorStop(1, '#' + this.skyBot.getHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, this._skyCanvas.width, h);
    this._skyTex.needsUpdate = true;
    this.fog?.color.copy(this.skyBot);   // fog is created after the sky in setup
  }
  // A sky disc (sun or moon) as a camera-facing sprite drawn behind the world.
  _makeCelestial(type, size) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d'), g = c.createRadialGradient(64, 64, 2, 64, 64, 64);
    if (type === 'sun') {
      g.addColorStop(0, 'rgba(255,255,250,1)'); g.addColorStop(0.16, 'rgba(255,243,200,1)');
      g.addColorStop(0.34, 'rgba(255,205,120,0.85)'); g.addColorStop(0.7, 'rgba(255,170,80,0.18)');
      g.addColorStop(1, 'rgba(255,160,70,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    } else {
      g.addColorStop(0, 'rgba(247,249,255,1)'); g.addColorStop(0.42, 'rgba(222,230,244,1)');
      g.addColorStop(0.5, 'rgba(206,216,234,0.95)'); g.addColorStop(0.62, 'rgba(200,210,230,0.18)');
      g.addColorStop(1, 'rgba(200,210,230,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      c.fillStyle = 'rgba(180,190,208,0.7)';           // a few soft craters
      for (const [x, y, r] of [[52, 50, 7], [74, 60, 5], [60, 74, 4], [80, 44, 3]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
    }
    const tex = new THREE.CanvasTexture(cv);
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0 });
    const sp = new THREE.Sprite(m); sp.renderOrder = -1; sp.scale.setScalar(size); sp.visible = false;
    return sp;
  }
  // ---- day / night (driven by the in-game clock) ---------------------------
  advanceClock(days) { this.gameDays += days; this._pendingDays = (this._pendingDays || 0) + days; }
  // Freeze the living world (traffic, people, boats, sea shimmer, weather) while
  // the player is editing. The camera and edit feedback stay fully responsive.
  setFrozen(on) { this.frozen = !!on; }
  _updateDayNight() {
    this.timeOfDay = ((this.gameDays / DAY_CYCLE) % 1 + 1) % 1;
    const elev = Math.sin(2 * Math.PI * (this.timeOfDay - 0.25)); // -1..1
    const dayness = THREE.MathUtils.clamp((elev + 0.18) / 0.5, 0, 1);
    const horizon = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.28, 0, 1);
    this.nightFactor = 1 - dayness;

    // Realistic arc: the sun rises in the EAST (+X), climbs over the south to its
    // noon peak, and sets in the WEST (-X); low at dawn/dusk for long shadows,
    // below the horizon at night (clamped low so the moon still lights the scene).
    const dayAngle = 2 * Math.PI * (this.timeOfDay - 0.25); // 0 at sunrise, π/2 at noon
    const cs = Math.cos(dayAngle), sn = Math.sin(dayAngle); // sn = elev (height)
    this.sun.position.set(cs * 240, Math.max(8, sn * 230 + 16), 60 - sn * 26);
    this.sun.intensity = 0.05 + dayness * 1.25;   // near-dark at night so unlit objects fall into shadow
    const sunCol = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xff8a3c), horizon * (1 - dayness * 0.5));
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0x9fb6ff), this.nightFactor * 0.6);
    this.hemi.intensity = 0.10 + dayness * 0.8;

    // Visible sun & moon discs. They sweep east->west with the clock but ride low
    // in the sky (the camera looks down at the island, so a true overhead arc would
    // sit above the frame) — this keeps them easy to spot. The directional LIGHT
    // still uses the full arc above for realistic shadows.
    const discDir = (turn, up) => {                 // turn: 0=sunrise(E) .. 0.5=noon .. 1=sunset(W)
      const az = 2 * Math.PI * (turn - 0.25);
      return new THREE.Vector3(Math.cos(az), 0.10 + 0.07 * Math.max(0, Math.sin(az)) + up, Math.sin(az)).normalize();
    };
    if (this.sunSprite) {
      this.sunSprite.position.copy(discDir(this.timeOfDay, 0)).multiplyScalar(WORLD * 1.7);
      this.sunSprite.material.color.copy(new THREE.Color(0xfff6e0).lerp(new THREE.Color(0xff7a2e), horizon));
      this.sunSprite.material.opacity = THREE.MathUtils.clamp(dayness * 1.2, 0, 1);
      this.sunSprite.visible = dayness > 0.03;
    }
    if (this.moonSprite) {                           // half-day offset: up when the sun is down
      this.moonSprite.position.copy(discDir((this.timeOfDay + 0.5) % 1, 0)).multiplyScalar(WORLD * 1.7);
      this.moonSprite.material.opacity = THREE.MathUtils.clamp(this.nightFactor * 1.1, 0, 0.96);
      this.moonSprite.visible = this.nightFactor > 0.05;
    }

    // --- sky gradient colours: zenith (top) and horizon (bottom) ---
    const C = (h) => new THREE.Color(h);
    this.skyTop = C(0x070d1e).lerp(C(0x3f86d8), dayness);   // night indigo -> day blue (zenith)
    this.skyBot = C(0x131a30).lerp(C(0xb2d6ef), dayness);   // night -> pale day blue (horizon)
    // Golden-hour / twilight wash as the sun nears the horizon: the band at the
    // horizon glows orange (sun up) shifting to red->magenta->purple as it sinks,
    // while the zenith goes pink->indigo. This paints a realistic sunrise/sunset.
    if (horizon > 0) {
      const e = THREE.MathUtils.clamp(elev / 0.28, -1, 1); // +1 just-risen(gold), 0 on horizon(orange), -1 twilight(purple)
      const horizGlow = e >= 0
        ? C(0xff6a34).lerp(C(0xffc26a), e)        // orange -> warm gold as it climbs
        : C(0xff6a34).lerp(C(0x5e376f), -e);      // orange -> deep purple as it sinks
      const zenGlow = C(0xd06ea0).lerp(C(0x36306e), Math.abs(e)); // pink -> indigo overhead
      this.skyBot.lerp(horizGlow, horizon);
      this.skyTop.lerp(zenGlow, horizon * 0.65);
    }
    this.skyColor = this.skyBot.clone();
    // (scene.background gradient + fog colour are committed at the end of render,
    //  after weather/haze have had a chance to tint skyTop/skyBot.)

    const glow = this.nightFactor;
    for (const m of ALL_MATS) {
      // After dark only lit windows / signs glow warm (facades carry a window
      // emissive map; lit designer parts have glowK >= 1). Plain bodies don't
      // self-illuminate — they just darken under the dim night lighting, instead
      // of the whole world turning yellow.
      const lit = !!m.emissiveMap || (m.userData.glowK ?? 0) >= 1;
      m.emissiveIntensity = lit ? glow * (m.userData.glowK ?? 0.3) : 0;
    }
  }

  // ---- development: skyline grows taller & denser as the nation matures ----
  _updateDevelopment(dt) {
    if (!this.state) return;
    const pop = this.state.population || 0;
    const edu = this.state.education || 20;
    const target = 1
      + THREE.MathUtils.clamp((pop - 80000) / 1_600_000, 0, 1) * 0.5
      + THREE.MathUtils.clamp((edu - 20) / 80, 0, 1) * 0.28;
    this.devFactor += (target - this.devFactor) * Math.min(1, dt * 0.5);
    for (const entry of this.buildings.values()) {
      if (entry.anim) continue;
      const want = MODEL_SCALE * (entry.tall ? this.devFactor : 1);
      entry.group.scale.y += (want - entry.group.scale.y) * Math.min(1, dt * 0.8);
    }
  }

  // ---- freeform road network (player-drawn) --------------------------------
  setRoadMode(on) { this.roadMode = on; if (!on) this.clearRoadPreview(); }
  // Paint mode (land reclamation): drag across the map to apply onPaint to each
  // cell instead of orbiting the camera.
  setPaintMode(on, onPaint, radius) { this.paintMode = !!on; this.onPaint = onPaint || null; this.paintRadius = on ? (radius || 0) : 0; if (!on) { this._painting = false; this._paintSeen = null; } }
  // Draw mode: drag across the map to trace a route (road/railway). On release,
  // onStroke([{x,z}...]) is called. `opts` sets the live-preview look.
  setDrawMode(on, onStroke, opts) { this.drawMode = !!on; this.onStroke = onStroke || null; this._drawType = (opts && opts.type) || 'road'; this._drawElevated = !!(opts && opts.elevated); this._drawRail = !!(opts && opts.rail); this._drawAir = !!(opts && opts.air); this._drawArea = !!(opts && opts.area); if (!on) { this._drawing = false; this._stroke = null; this.clearRoadPreview(); } }
  // Render finished player-drawn railways (world coords) like the historic ones.
  // Hide scattered trees/greenery within `halfW` of a polyline (so a runway or
  // railway corridor isn't speckled with trees poking through it).
  _clearNatureAlong(pts, halfW) {
    if (!this.natureCells || !pts || pts.length < 2) return;
    for (const [id, grp] of this.natureCells) {
      if (!grp.visible) continue;
      const [x, y] = id.split(',').map(Number); const c = cellToWorld(x, y);
      for (let i = 0; i < pts.length - 1; i++) {
        if (segPointDist(c.x, c.z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z) < halfW + 2) { grp.visible = false; break; }
      }
    }
  }
  // Even-spacing resample of a {x,z} polyline (clean, regular ties/edges).
  _resamplePoly(pts, step) {
    if (!pts || pts.length < 2) return (pts || []).slice();
    const out = [{ x: pts[0].x, z: pts[0].z }];
    for (let i = 1; i < pts.length; i++) {
      let a = out[out.length - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.z - a.z);
      while (d >= step) { const t = step / d; a = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; out.push(a); d = Math.hypot(b.x - a.x, b.z - a.z); }
    }
    const last = pts[pts.length - 1]; if (Math.hypot(last.x - out[out.length - 1].x, last.z - out[out.length - 1].z) > 0.3) out.push({ x: last.x, z: last.z });
    return out;
  }
  // Join railway/viaduct segments that share an endpoint into continuous CHAINS
  // (same kind only), so two viaducts drawn end-to-end render as ONE unbroken deck —
  // no gap at the join — and a single train runs the whole connected line.
  _chainRailEntries(entries) {
    const segs = [];
    for (const e of (entries || [])) {
      const poly = Array.isArray(e) ? e : (e && e.pts);
      if (!poly || poly.length < 2) continue;
      segs.push({ pts: poly.map((p) => [p[0], p[1]]), elevated: !Array.isArray(e) && !!e.elevated, mrt: !Array.isArray(e) && !!e.mrt });
    }
    const tol = TILE * 1.4, used = new Array(segs.length).fill(false);
    const near = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
    const key = (s) => (s.mrt ? 'm' : s.elevated ? 'e' : 'g');
    const chains = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let chain = segs[i].pts.slice(); const k = key(segs[i]);
      let grew = true;
      while (grew) {
        grew = false;
        const head = chain[0], tail = chain[chain.length - 1];
        for (let j = 0; j < segs.length; j++) {
          if (used[j] || key(segs[j]) !== k) continue;
          const a = segs[j].pts[0], b = segs[j].pts[segs[j].pts.length - 1];
          if (near(tail, a)) { chain = chain.concat(segs[j].pts.slice(1)); }
          else if (near(tail, b)) { chain = chain.concat(segs[j].pts.slice(0, -1).reverse()); }
          else if (near(head, b)) { chain = segs[j].pts.slice(0, -1).concat(chain); }
          else if (near(head, a)) { chain = segs[j].pts.slice(1).reverse().concat(chain); }
          else continue;
          used[j] = true; grew = true; break;
        }
      }
      chains.push({ pts: chain, elevated: segs[i].elevated, mrt: segs[i].mrt });
    }
    return chains;
  }
  _buildPlayerRailways(state) {
    if (this._pRailGroup) this.scene.remove(this._pRailGroup);
    const g = new THREE.Group(); this.scene.add(g); this._pRailGroup = g;
    this._mrtProfiles = [];   // viaduct deck heightlines, rebuilt each pass (for station alignment)
    // Like a runway, a railway is laid on a SMOOTH graded line (the straight grade
    // between its endpoints). Any hill in the way is CUT down to that line and dips
    // are filled, so the track never climbs at silly angles. Profile against the RAW
    // ground first (bypass existing carves), then carve the corridor to the grade.
    this._carves = null;
    const rails = [], viaducts = [], mrtways = [];
    for (const entry of this._chainRailEntries((state && state.railways) || [])) {  // joined into continuous chains
      const poly = entry.pts;
      const dense = this._resamplePoly(poly.map(([x, z]) => ({ x, z })), 1.4);
      if (dense.length < 2) continue;
      if (entry.mrt) mrtways.push(dense);              // MRT guideway (always elevated)
      else if (entry.elevated) viaducts.push(dense);   // heavy-rail elevated viaduct
      else rails.push(this._railProfile(poly.map(([x, z]) => ({ x, z })), 1.4)); // graded, cut hills
    }
    // full-cut half-width must exceed a terrain-mesh cell (~6.7 m) so the coarse mesh
    // is actually cut to grade right under the track (else a hill covers the rails)
    this._railCarves = rails.map((r) => ({ poly: r.dense, halfW: 7, blend: 6, floors: r.grade }));
    this._syncCarves();   // cut the hills down to each railway's grade (+ airport pads)
    const tracks = [];                       // {pts, kind} — where trains will run
    for (const r of rails) {
      const pts = r.dense.map((q, i) => new THREE.Vector3(q.x, r.grade[i], q.z));
      this._railEmbankment(g, r);            // fill embankment under the track over any dip
      this._railTrack(g, pts);               // ballast + sleepers + rails on the smooth grade
      tracks.push({ pts, kind: 'train' });
    }
    for (const dense of viaducts) {          // elevated viaduct: flat deck clearing all below, on pillars
      const n = dense.length, deckY = this._elevatedDeckY(dense, 2);
      const pts = dense.map((q, i) => { const gy = this._roadY(q.x, q.z), t = i / (n - 1), ramp = Math.min(1, Math.min(t, 1 - t) / 0.18); return new THREE.Vector3(q.x, gy + ramp * (deckY - gy), q.z); });
      this._addRibbon(g, pts, 1.9, 0x6b6f74, -0.18);   // concrete deck under the track
      this._railTrack(g, pts);
      this._addPillars(g, pts, 0.55);
      tracks.push({ pts, kind: 'train' });
    }
    for (const dense of mrtways) {           // MRT: a slim guideway on a smart, near-level height profile
      // Process the route's terrain and give the deck a smooth profile: it stays a
      // fixed clearance above the ground (so it meets the stations), but is slope-
      // limited to ≤20° and smoothed so it never jumps or roller-coasters — it climbs
      // and dips GENTLY to follow the land, and runs LEVEL across each station platform.
      const prof = this._viaductProfile(dense, MRT_DECK_CLEAR, MRT_MAX_SLOPE, this._mrtStationAnchors(dense));
      const pts = dense.map((q, i) => new THREE.Vector3(q.x, prof[i], q.z));
      this._mrtGuideway(g, pts);
      tracks.push({ pts, kind: 'mrt' });
      (this._mrtProfiles || (this._mrtProfiles = [])).push(pts);   // for snapping stations to the deck
    }
    this._playerTrainTracks = tracks;
    this._alignMrtStations();   // lift any station on a viaduct so its platform meets the deck
    this._buildTrains();
  }
  // A smooth, near-horizontal height profile for an elevated guideway: it sits
  // `clearance` above the ground, slope-limited to ≤`maxSlope`, so over rolling terrain
  // the deck climbs and falls GENTLY. Where stations sit (anchor indices), the deck is
  // LEVELLED across a short platform run — real elevated stations have a flat platform,
  // and the station stays upright (the deck follows the station, not the other way) —
  // with the approaches ramped up to meet those level platforms.
  _viaductProfile(pts, clearance, maxSlope, anchors = []) {
    const n = pts.length, h = new Array(n), pinned = new Array(n).fill(false);
    for (let i = 0; i < n; i++) h[i] = this._roadY(pts[i].x, pts[i].z) + clearance;
    const limit = () => {
      for (let i = 1; i < n; i++) { if (pinned[i]) continue; const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); if (h[i] < h[i - 1] - maxSlope * d) h[i] = h[i - 1] - maxSlope * d; }
      for (let i = n - 2; i >= 0; i--) { if (pinned[i]) continue; const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); if (h[i] < h[i + 1] - maxSlope * d) h[i] = h[i + 1] - maxSlope * d; }
    };
    limit();                                    // lowest slope-limited profile clearing the land
    for (const a of anchors) {                  // flatten a level platform run at each station
      const lo = Math.max(0, a - 1), hi = Math.min(n - 1, a + 1);
      let H = -Infinity; for (let i = lo; i <= hi; i++) H = Math.max(H, h[i]);   // sit it at the local high point (clears ground + feasible)
      for (let i = lo; i <= hi; i++) { h[i] = H; pinned[i] = true; }
    }
    if (anchors.length) limit();                // ramp the approaches up to the pinned level platforms
    return h;
  }
  // Indices on a dense MRT polyline nearest to each MRT station (within snap range), so
  // the deck can be levelled across the platform there.
  _mrtStationAnchors(dense) {
    const out = []; if (!this.buildings) return out;
    const maxD2 = (TILE * 2.6) * (TILE * 2.6);
    for (const [, e] of this.buildings) {
      if (!e || e.key !== 'mrt' || !e.group) continue;
      const bx = e._baseX != null ? e._baseX : e.group.position.x, bz = e._baseZ != null ? e._baseZ : e.group.position.z;
      let bi = -1, bd = maxD2;
      for (let i = 0; i < dense.length; i++) { const dx = dense[i].x - bx, dz = dense[i].z - bz, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      if (bi >= 0) out.push(bi);
    }
    return out;
  }
  // Deck height of the nearest MRT viaduct to (x,z) within maxD world units, or null.
  _viaductDeckAt(x, z, maxD) { const i = this._viaductInfoAt(x, z, maxD); return i ? i.y : null; }
  // Nearest viaduct: its deck height, the track BEARING there, and the longitudinal
  // SLOPE (rise per unit horizontal, in the +bearing direction) — so a station can be
  // turned AND pitched to line up with the deck, and the deck runs through it. Null if too far.
  _viaductInfoAt(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const pts of (this._mrtProfiles || [])) {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < bd) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; bd = d; const run = Math.hypot(b.x - a.x, b.z - a.z) || 1; best = { x: p.x, y: p.y, z: p.z, bearing: Math.atan2(-(b.z - a.z), b.x - a.x), slope: (b.y - a.y) / run }; }
      }
    }
    return best;
  }
  // Make on-line MRT stations meet the deck: the deck is levelled across the platform
  // (see _viaductProfile), so the station stays UPRIGHT (180° straight) — just turned to
  // the track and lifted so its concourse floor lands on the deck. Then drop plumb
  // support columns to the ground and, when the platform stands high, build a vertical
  // access core (lift + stairs) so commuters reach it from the ground. Stations off the
  // line stay level at ground height.
  _alignMrtStations() {
    if (!this.buildings) return;
    if (!this._mrtLegsGroup) { this._mrtLegsGroup = new THREE.Group(); this.scene.add(this._mrtLegsGroup); }
    for (const m of this._mrtLegsGroup.children) m.traverse((o) => o.geometry?.dispose?.());   // rebuilt below, each pass
    this._mrtLegsGroup.clear();
    const FLOOR = 6.3 * MODEL_SCALE;            // concourse-floor height above the station base
    for (const [, e] of this.buildings) {
      if (!e || e.key !== 'mrt' || !e.group) continue;
      const p = e.group.position;
      if (e._baseX == null) { e._baseX = p.x; e._baseZ = p.z; e._groundY = p.y; e._baseRot = e.group.rotation.y; } // remember placed spot once
      const info = this._viaductInfoAt(e._baseX, e._baseZ, TILE * 2.6);
      if (info == null) { p.set(e._baseX, e._groundY, e._baseZ); e.group.rotation.set(0, e._baseRot, 0); continue; } // off the line → level, as placed
      e.group.rotation.set(0, info.bearing, 0);   // level + square to the track; the deck is flat across the platform
      const targetY = info.y - FLOOR;             // concourse floor sits exactly on the (levelled) deck
      p.set(info.x, targetY, info.z);             // pull the station right ONTO the deck (no side gap)
      const cb = Math.cos(info.bearing), sb = Math.sin(info.bearing);
      // plumb support piers under the level platform, each run to the ground beneath it
      for (const d of [-0.9, 0, 0.9]) {
        const fx = info.x + d * cb, fz = info.z - d * sb, gy = this._roadY(fx, fz), h = targetY - gy;
        if (h > 0.4) this._mrtLegsGroup.add(cyl(0.34, 0.42, h, 0x9098a0, fx, (gy + targetY) / 2, fz));
      }
      if (targetY - this._roadY(info.x, info.z) > 2) this._mrtAccessCore(info, FLOOR, cb, sb); // ground→platform access
    }
  }
  // A vertical access core on the station's entrance side: a lift/stair shaft from the
  // ground up to the concourse, a glazed ground entrance, and a covered link bridge into
  // the platform — so passengers travel from the ground floor up before boarding.
  _mrtAccessCore(info, FLOOR, cb, sb) {
    const dx = sb, dz = cb;                                   // depth direction (toward the entrance side), horizontal
    const tx = info.x + dx * 1.9, tz = info.z + dz * 1.9;     // core sits beside the deck, clear of the tracks
    const floorY = info.y, gT = this._roadY(tx, tz), th = floorY - gT;
    if (th <= 1) return;
    const core = new THREE.Group(); core.position.set(tx, 0, tz); core.rotation.y = info.bearing;  // local +z = depth (outward)
    core.add(partBox(2.8, th, 2.2, mat(0xd2d6da), 0, (gT + floorY) / 2, 0));            // lift/stair shaft to platform level
    core.add(partBox(1.4, 2.2, 0.2, mat(0x2b3b48, {}, 0.8), 0, gT + 1.1, 1.12));        // glazed ground entrance (faces out)
    for (let y = gT + 2.6; y < floorY - 0.8; y += 2.6) core.add(partBox(2.86, 0.16, 2.26, mat(0x9aa6ad), 0, y, 0)); // storey bands
    core.add(partBox(1.8, 0.7, 0.5, mat(0xe5ecf0), 0, floorY + 0.35, -1.0));            // short covered link to the concourse (clear of the tracks)
    core.add(partBox(1.9, 0.16, 0.6, mat(0x9fb6c4, { metalness: 0.3 }), 0, floorY + 0.78, -1.0)); // its roof
    core.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this._mrtLegsGroup.add(core);
  }
  // A sleek MRT viaduct: a slim pale box-girder deck on thin round piers, with a thin
  // running rail down the middle. Kept narrow + low so it matches the MRT station.
  _mrtGuideway(g, pts) {
    if (!pts || pts.length < 2) return;
    this._addRibbon(g, pts, 0.62, 0xc7ccd1, 0.0);       // box-girder deck (pale concrete) — sized to the station's width, two tracks wide
    this._addRibbon(g, pts, 0.7, 0x9aa2a9, -0.4);       // shallow underside / parapet shadow
    this._addRibbon(g, pts, 0.04, 0x8a9199, 0.06);      // faint centre divider between the up/down tracks
    for (const s of [-1, 1]) this._addRibbon(g, this._offsetPoly(pts, s * MRT_TRACK_GAUGE), 0.12, 0x6a7178, 0.1); // a running beam under each track
    this._addPillars(g, pts, 0.4);                       // piers
  }
  // Shift a {Vector3} polyline sideways by `off` world units along its local normal.
  _offsetPoly(pts, off) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      return new THREE.Vector3(p.x - tz * off, p.y, p.z + tx * off);
    });
  }
  // A fill embankment under the track wherever the graded line sits above the (now
  // cut) ground — a skirt from the ballast edge down to the terrain on each side.
  _railEmbankment(g, prof) {
    const { dense, grade } = prof, HW = 1.7;
    let any = false;
    for (let i = 0; i < dense.length; i++) if (grade[i] - this._roadY(dense[i].x, dense[i].z) > 0.4) { any = true; break; }
    if (!any) return;                        // nothing to fill (level / cutting only)
    const nrm = dense.map((p, i) => { const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; });
    for (const sgn of [-1, 1]) {
      const v = [], idx = [];
      for (let i = 0; i < dense.length; i++) {
        const ex = dense[i].x + nrm[i][0] * HW * sgn, ez = dense[i].z + nrm[i][1] * HW * sgn;
        const top = grade[i] + 0.1, bot = Math.min(top - 0.02, this._roadY(ex, ez) - 0.1);
        v.push(ex, top, ez, ex, bot, ez);
      }
      for (let i = 0; i < dense.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); sg.setIndex(idx); sg.computeVertexNormals();
      const m = new THREE.Mesh(sg, toon(0x6e6457, { side: THREE.DoubleSide })); m.receiveShadow = true; g.add(m);
    }
  }
  // Lay ballast, sleepers and rails along a polyline of Vector3 points (already at
  // the desired height). Shared by surface track and the open mouths of tunnels.
  _railTrack(g, pts) {
    if (!pts || pts.length < 2) return;
    const nrm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; });
    this._addRibbon(g, pts, 1.55, 0x6e6457, 0.08);                                // grey gravel ballast bed
    // wooden cross-ties (sleepers) at even intervals across the track
    let acc = 999;
    for (let i = 0; i < pts.length; i++) {
      acc += (i ? Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) : 0);
      if (acc < 2.2) continue; acc = 0;
      const slp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 2.5), toon(0x4a3a2a));
      slp.position.set(pts[i].x, pts[i].y + 0.16, pts[i].z); slp.rotation.y = Math.atan2(nrm[i][0], nrm[i][1]); slp.castShadow = true; g.add(slp);
    }
    // two steel rails on top of the ties
    for (const sgn of [-1, 1]) {
      const rail = pts.map((p, i) => new THREE.Vector3(p.x + nrm[i][0] * 0.62 * sgn, p.y + 0.26, p.z + nrm[i][1] * 0.62 * sgn));
      this._addRibbon(g, rail, 0.09, 0xc7ccd1, 0.0);
    }
    this._clearNatureAlong(pts, 1.6);          // clear trees along the track
  }
  // Grade a railway onto the straight line between its endpoints, and measure the
  // earth that must be moved (hills cut down, dips filled) to that smooth grade.
  _railProfile(pts2d, halfW) {
    const dense = this._resamplePoly(pts2d, 1.4);
    if (dense.length < 2) return { dense, grade: [], above: [], earthVolume: 0, cutMax: 0, len: 0 };
    const arc = [0]; let len = 0;
    for (let i = 1; i < dense.length; i++) { len += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z); arc.push(len); }
    const y0 = this._roadY(dense[0].x, dense[0].z), y1 = this._roadY(dense[dense.length - 1].x, dense[dense.length - 1].z);
    const width = (halfW || 1.5) * 2;
    const grade = [], above = []; let cutMax = 0, earthVolume = 0;
    for (let i = 0; i < dense.length; i++) {
      const gY = len ? y0 + (y1 - y0) * (arc[i] / len) : y0;     // a smooth, even gradient
      grade.push(gY);
      const a = this._roadY(dense[i].x, dense[i].z) - gY; above.push(a);
      if (a > cutMax) cutMax = a;                                // tallest hill above the line
      earthVolume += Math.abs(a) * (i ? arc[i] - arc[i - 1] : 0) * width;   // cut (a>0) + fill (a<0)
    }
    return { dense, grade, above, earthVolume, cutMax, len };
  }
  // Render finished player-drawn airport runways: a wide asphalt strip with pale
  // edge lines and a dashed centreline, and an airliner that taxis & takes off.
  _buildPlayerAirstrips(state) {
    if (this._airGroup) this.scene.remove(this._airGroup);
    const g = new THREE.Group(); this.scene.add(g); this._airGroup = g;
    this._airPlanes = [];
    const RW = 4.5; // runway half-width (matches the built-in airport)
    const entries = ((state && state.airstrips) || []).map((e) => ({ poly: Array.isArray(e) ? e : (e && e.pts), elevated: !Array.isArray(e) && !!e.elevated })).filter((e) => e.poly && e.poly.length >= 2);
    this._carves = null;
    const ground = [], raised = [];
    for (const e of entries) {
      const dense = this._resamplePoly(e.poly.map(([x, z]) => ({ x, z })), 2.5);
      if (dense.length < 2) continue;
      const nrm = dense.map((p, i) => { const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; });
      if (e.elevated) { raised.push({ dense, nrm }); continue; }
      // GROUND runway: sit on the LOWEST ground under it and cut the hill flat to that
      let level = Infinity;
      for (let i = 0; i < dense.length; i++) { const nx = nrm[i][0], nz = nrm[i][1]; for (const w of [-RW, -RW / 2, 0, RW / 2, RW]) level = Math.min(level, this._roadY(dense[i].x + nx * w, dense[i].z + nz * w)); }
      ground.push({ dense, nrm, level: isFinite(level) ? level : 0 });
    }
    this._airCarves = ground.map((m) => ({ poly: m.dense, halfW: RW + 2, blend: 16, floor: m.level }));
    this._syncCarves();   // cut the hills flat under each ground runway (+ railway corridors)
    // tarmac + edge lines + dashed centreline + taxiing plane at a flat deck height
    const lay = (dense, nrm, deck) => {
      const pts = dense.map((q) => new THREE.Vector3(q.x, deck, q.z));
      this._addRibbon(g, pts, RW, 0x35383d, 0.0);                              // tarmac
      for (const sgn of [-1, 1]) this._addRibbon(g, pts.map((p, i) => new THREE.Vector3(p.x + nrm[i][0] * (RW - 0.3) * sgn, deck, p.z + nrm[i][1] * (RW - 0.3) * sgn)), 0.18, 0xeae4d2, 0.06); // edge lines
      let dash = true;
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], seg = a.distanceTo(b); let s = 0;
        while (s < seg) { const e = Math.min(s + 3.5, seg);
          if (dash) this._addRibbon(g, [new THREE.Vector3(a.x + (b.x - a.x) * s / seg, deck, a.z + (b.z - a.z) * s / seg), new THREE.Vector3(a.x + (b.x - a.x) * e / seg, deck, a.z + (b.z - a.z) * e / seg)], 0.22, 0xeae4d2, 0.07);
          dash = !dash; s = e; } }
      this._airPlanes.push({ pts, total: this._polyLen(pts), mesh: null, t: Math.random(), dir: 1 });
      return pts;
    };
    for (const m of ground) {
      const deck = m.level + 0.3;
      lay(m.dense, m.nrm, deck);
      for (const sgn of [-1, 1]) {                                             // short skirt to the cut ground
        const v = [], idx = [];
        for (let i = 0; i < m.dense.length; i++) { const ex = m.dense[i].x + m.nrm[i][0] * RW * sgn, ez = m.dense[i].z + m.nrm[i][1] * RW * sgn; v.push(ex, deck, ez, ex, Math.min(deck - 0.05, this._roadY(ex, ez) - 0.1), ez); }
        for (let i = 0; i < m.dense.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); sg.setIndex(idx); sg.computeVertexNormals();
        const mesh = new THREE.Mesh(sg, toon(0x4c4f54, { side: THREE.DoubleSide })); mesh.receiveShadow = true; g.add(mesh);
      }
      this._clearNatureAlong(m.dense, RW + 2);
    }
    for (const m of raised) {                                                  // ELEVATED runway: ONE flat level clearing all below, on pillars (no slope)
      const deck = this._elevatedDeckY(m.dense, RW + 2);
      const pts = lay(m.dense, m.nrm, deck);
      this._addRibbon(g, pts, RW + 0.5, 0x55585d, -0.3);                       // concrete deck underside
      this._addPillars(g, pts, 0.8);
    }
  }
  _polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }
  // Arc-fraction [0,1] of the point on a polyline closest to (x,z), plus that distance.
  _nearestU(pts, x, z) {
    const total = this._polyLen(pts) || 1; let acc = 0, bestU = 0, bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t, pz = a.z + dz * t, d = (px - x) * (px - x) + (pz - z) * (pz - z), segLen = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; bestU = (acc + segLen * t) / total; }
      acc += segLen;
    }
    return { u: bestU, d: Math.sqrt(bestD) };
  }
  // Point at arc-fraction u in [0,1] along a {Vector3} polyline.
  _alongPoly(pts, u) {
    const total = this._polyLen(pts); let target = Math.max(0, Math.min(1, u)) * total, acc = 0;
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); if (acc + d >= target) { const t = d ? (target - acc) / d : 0; return new THREE.Vector3(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t); } acc += d; }
    return pts[pts.length - 1].clone();
  }
  // Taxi an airliner down each runway, lift off near the end, then loop back.
  _updateAirstripPlanes(dt) {
    for (const p of (this._airPlanes || [])) {
      if (!p.mesh) { p.mesh = makeAirliner(); p.mesh.scale.setScalar(AIRPORT.planeScale); this._airGroup.add(p.mesh); }
      p.t += dt * 0.05;
      if (p.t > 1.25) p.t = 0;                                    // back to the threshold
      const u = Math.min(1, p.t);
      const pos = this._alongPoly(p.pts, u);
      const ahead = this._alongPoly(p.pts, Math.min(1, u + 0.03));
      const climb = Math.max(0, p.t - 0.82) * 80;                 // rotate/lift off after ~80% of the run
      p.mesh.position.set(pos.x, pos.y + 0.5 + climb, pos.z); // ride on the raised runway platform
      p.mesh.rotation.y = Math.atan2(ahead.x - pos.x, ahead.z - pos.z);
      p.mesh.visible = p.t <= 1.2;
    }
  }
  // ---- trains: living rolling stock on every railway & MRT line ---------------
  // Spawn rolling stock on every track: a single train on the historic KTM lines and
  // player heavy-rail, and a two-way PAIR on each MRT viaduct (one per direction, so
  // they pass on the deck). The kind/vintage follows the year, so the fleet visibly
  // modernises — steam → diesel → modern — as the country develops.
  _buildTrains() {
    if (this._trainGroup) this.scene.remove(this._trainGroup);
    const g = new THREE.Group(); this.scene.add(g); this._trainGroup = g;
    this._trains = [];
    const tracks = [...(this._histTrainTracks || []), ...(this._playerTrainTracks || [])];
    const fe = fleetEra(this.state || {});      // economy + invention-year decide the rolling stock
    this._fleet = fe; this._trainEra = fe.train;
    for (const tk of tracks) {
      const total = this._polyLen(tk.pts);
      if (total < 14) continue;                 // too short to run a train
      const mrt = tk.kind === 'mrt';
      const era = mrt ? 'mrt' : fe.train;
      const cars = mrt ? 2 : era === 'steam' ? 3 : 4;
      const stops = this._stopsForTrack(tk);        // stations on this line are stops
      const speed = mrt ? 13 : era === 'steam' ? 6 : 9;
      const rideY = mrt ? 0.12 : 0.34;
      // Put rolling stock on the line. An MRT viaduct is two-way: a train sits on
      // each track (offset to its own side) running the opposite way, so the two
      // pass each other on the deck. Ground railways stay single-track.
      const spawn = (u, dir, lateral) => {
        const train = makeTrain(era, cars);
        for (const c of train.cars) g.add(c);
        this._trains.push({ track: tk, cars: train.cars, total, carU: (train.carLen * 1.06) / total, u, dir, lateral, stops, dwell: 0, speed, rideY });
      };
      if (mrt) { spawn(Math.random() * 0.25, 1, MRT_TRACK_GAUGE); spawn(1 - Math.random() * 0.25, -1, -MRT_TRACK_GAUGE); }
      else spawn(Math.random() * 0.6, 1, 0);
    }
  }
  // Arc-fractions [0,1] where stations sit on a track — a train halts at each.
  _stopsForTrack(tk) {
    const stops = [];
    for (const [, e] of (this.buildings || [])) {
      if (!e || (e.key !== 'mrt' && e.key !== 'rail_station') || !e.group) continue;
      const nu = this._nearestU(tk.pts, e.group.position.x, e.group.position.z);
      if (nu.d < TILE * 1.6) stops.push(nu.u);
    }
    return stops.sort((a, b) => a - b);
  }
  // Re-scan the stations on each running train's line WITHOUT respawning the train
  // (so it keeps moving). Called whenever a station is built or removed, so every
  // train stops at ALL the line's stations — not just the ones that existed when it
  // first spawned.
  _refreshTrainStops() {
    for (const tr of (this._trains || [])) tr.stops = this._stopsForTrack(tr.track);
  }
  _updateTrains(dt) {
    for (const tr of (this._trains || [])) {
      if (tr.dwell > 0) { tr.dwell -= dt; }   // halted at a station — hold position
      else {
        const prev = tr.u;
        tr.u += tr.dir * dt * tr.speed / tr.total;
        for (const su of (tr.stops || [])) {  // pull up at a station as we reach it
          if ((prev < su && tr.u >= su) || (prev > su && tr.u <= su)) { tr.u = su; tr.dwell = 2.4; break; }
        }
        // shuttle: when the head reaches an end, reverse (and flip which way the cars trail)
        if (tr.u > 1) { tr.u = 1; tr.dir = -1; }
        else if (tr.u < 0) { tr.u = 0; tr.dir = 1; }
      }
      const pts = tr.track.pts, eps = 0.012, lat = tr.lateral || 0;
      for (let i = 0; i < tr.cars.length; i++) {
        const cu = tr.u - tr.dir * i * tr.carU;        // each car trails the one ahead
        const car = tr.cars[i];
        if (cu < 0 || cu > 1) { car.visible = false; continue; }
        car.visible = true;
        const pos = this._alongPoly(pts, cu);
        const a = this._alongPoly(pts, Math.max(0, cu - eps)), b = this._alongPoly(pts, Math.min(1, cu + eps));
        // lateral offset onto the train's own track (horizontal normal, dir-independent)
        let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1;
        car.position.set(pos.x - (tz / tl) * lat, pos.y + tr.rideY, pos.z + (tx / tl) * lat);
        // Orient the car to the FULL 3D travel direction, so on an elevated viaduct it
        // PITCHES with the climb/descent (nose up the grade) instead of staying level —
        // its body stays upright (no roll), like real rolling stock on a gradient.
        _AZ.set((b.x - a.x) * tr.dir, (b.y - a.y) * tr.dir, (b.z - a.z) * tr.dir);   // forward (nose, +Z)
        if (_AZ.lengthSq() < 1e-9) _AZ.set(0, 0, tr.dir);
        _AZ.normalize();
        _AX.crossVectors(_WORLD_UP, _AZ);                          // sideways — horizontal, so no banking
        if (_AX.lengthSq() < 1e-9) _AX.set(1, 0, 0);
        _AX.normalize();
        _AY.crossVectors(_AZ, _AX);                                // car's up
        _BASIS.makeBasis(_AX, _AY, _AZ);
        car.quaternion.setFromRotationMatrix(_BASIS);
      }
    }
  }
  // Render routes still under construction: the built part grows from the start,
  // with a works marker at the build front. Call each tick to animate.
  syncRoadworks(state) {
    if (this._roadworksGroup) this.scene.remove(this._roadworksGroup);
    const g = new THREE.Group(); this.scene.add(g); this._roadworksGroup = g;
    for (const w of ((state && state.roadworks) || [])) {
      const wp = w.pts; if (!wp || wp.length < 2) continue;
      const segL = []; let total = 0;
      for (let i = 1; i < wp.length; i++) { const d = Math.hypot(wp[i].x - wp[i - 1].x, wp[i].z - wp[i - 1].z); segL.push(d); total += d; }
      const prog = Math.max(0, Math.min(1, 1 - w.left / Math.max(1, w.total)));
      const builtLen = prog * total;
      const built = [{ x: wp[0].x, z: wp[0].z }]; let acc = 0;
      for (let i = 1; i < wp.length; i++) {
        const d = segL[i - 1];
        if (acc + d <= builtLen) { built.push({ x: wp[i].x, z: wp[i].z }); acc += d; }
        else { const t = d ? (builtLen - acc) / d : 0; built.push({ x: wp[i - 1].x + (wp[i].x - wp[i - 1].x) * t, z: wp[i - 1].z + (wp[i].z - wp[i - 1].z) * t }); break; }
      }
      const toV = (p) => new THREE.Vector3(p.x, this._roadY(p.x, p.z), p.z); // construction ribbon follows the terrain too
      // match the finished road's footprint so the look doesn't jump on completion
      const T = ROAD_TYPES[w.type] || ROAD_TYPES.road;
      const hw = w.kind === 'rail' ? 1.7 : w.kind === 'air' ? T.width / 2 : (T.renderHW || T.width / 2 + 0.35);
      // faint full planned route, then the solid built part on top
      this._addRibbon(g, wp.map(toV), hw, 0x8a8f6a, 0.02);
      if (built.length >= 2) this._addRibbon(g, built.map(toV), hw, (w.kind === 'rail' ? 0x5b5040 : 0x3a3e45), 0.05);
      const f = built[built.length - 1] || wp[0];
      const m = this._roadworkMarker(); m.position.set(f.x, this._roadY(f.x, f.z) + 0.1, f.z); g.add(m);
      this._addWorksFence(g, wp, hw + 0.8);   // hoarding + blinking lights ring the work zone
    }
  }
  // A construction barrier along a route: striped posts on both sides with amber
  // lights that blink (pulsed in render). Signals "works in progress — keep out".
  _addWorksFence(group, wp, off) {
    const sides = [[], []];                                  // collect post tops per side to string a rail
    const post = (x, z, side) => {
      const y = this._roadY(x, z);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 0.4), toon(0xff7a3c));      // tall orange post
      p.position.set(x, y + 0.85, z); group.add(p);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.46), toon(0xf4f4f4));  // white reflective band
      band.position.set(x, y + 1.2, z); group.add(band);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true }));
      light.position.set(x, y + 1.85, z); light.userData.blink = true; group.add(light);
      sides[side].push(new THREE.Vector3(x, y + 1.05, z));
    };
    // place posts every ~6 units of ARC LENGTH along the whole route (even spacing,
    // independent of how many points the smoothed polyline has)
    const SPACE = 6; let dist = 0, nextAt = 0;
    for (let i = 1; i < wp.length; i++) {
      const a = wp[i - 1], b = wp[i];
      const segL = Math.hypot(b.x - a.x, b.z - a.z); if (segL < 1e-4) continue;
      const ux = (b.x - a.x) / segL, uz = (b.z - a.z) / segL, nx = -uz, nz = ux;
      while (nextAt <= dist + segL) {
        const s = nextAt - dist, px = a.x + ux * s, pz = a.z + uz * s;
        post(px + nx * off, pz + nz * off, 0);
        post(px - nx * off, pz - nz * off, 1);
        nextAt += SPACE;
      }
      dist += segL;
    }
    // a continuous orange hoarding rail strung between the posts on each side (follows terrain)
    const railRibbon = (vp) => {
      if (vp.length < 2) return; const v = [], idx = [];
      for (let i = 0; i < vp.length; i++) { const a = vp[Math.max(0, i - 1)], b = vp[Math.min(vp.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const nx = -tz, nz = tx, q = vp[i];
        v.push(q.x + nx * 0.1, q.y + 0.18, q.z + nz * 0.1, q.x - nx * 0.1, q.y - 0.18, q.z - nz * 0.1); }
      for (let i = 0; i < vp.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo, toon(0xffb24d, { side: THREE.DoubleSide })));
    };
    railRibbon(sides[0]); railRibbon(sides[1]);
  }
  _roadworkMarker() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), toon(0xf6c945)); body.position.y = 0.9; grp.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.2), toon(0x444b55)); cab.position.y = 2.0; grp.add(cab);
    for (const dx of [-2.2, 2.2]) { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 7), toon(0xff7a3c)); cone.position.set(dx, 0.65, 0); grp.add(cone); }
    return grp;
  }

  // Sample an edge's centre-line into world points (with bridge elevation).
  // ground height a road sits on: follow the terrain so it doesn't sink into hills
  // Height of the RENDERED terrain mesh at a world point — bilinear over the same
  // 240-grid the mesh is built from, so roads/rails sit ON the visible surface
  // instead of floating above it (the fine analytic height overshoots the coarse
  // mesh on convex hills). Falls back to the analytic height outside the grid.
  _meshY(x, z) {
    const RES = 240, x0 = HEIGHTS_1966.x0, x1 = HEIGHTS_1966.x1, y0 = HEIGHTS_1966.y0, y1 = HEIGHTS_1966.y1;
    const nx = x / WORLD + 0.5, ny = 0.5 - z / WORLD;
    const fi = (nx - x0) / (x1 - x0) * RES, fj = (ny - y0) / (y1 - y0) * RES;
    if (fi < 0 || fi >= RES || fj < 0 || fj >= RES) return this._terrainHN(nx, ny);
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
    const hn = (gi, gj) => this._terrainHN(x0 + (x1 - x0) * gi / RES, y0 + (y1 - y0) * gj / RES);
    const h0 = hn(i, j) * (1 - tx) + hn(i + 1, j) * tx, h1 = hn(i, j + 1) * (1 - tx) + hn(i + 1, j + 1) * tx;
    return h0 * (1 - tz) + h1 * tz;
  }
  _roadY(x, z) { return this._meshY(x, z) + 0.12; }   // sit just on the rendered mesh
  // ---- elevated flyover / viaduct / raised runway shared helpers ----------
  // The highest obstacle (terrain or building top) under a corridor, so an elevated
  // deck can be set above EVERYTHING below it (no overlaps).
  _corridorTopY(pts, halfW) {
    let top = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; const nx = -tz / l, nz = tx / l;
      for (const w of [-halfW, 0, halfW]) top = Math.max(top, this._roadY(pts[i].x + nx * w, pts[i].z + nz * w));
    }
    const reach = halfW + 6;
    for (const entry of this.buildings.values()) {
      const grp = entry && entry.group; if (!grp) continue;
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) { const pr = this._projOnSeg(grp.position.x, grp.position.z, pts[i], pts[i + 1]); if (pr.d < d) d = pr.d; }
      if (d < reach) { const bb = new THREE.Box3().setFromObject(grp); if (bb.max.y > top) top = bb.max.y; }
    }
    return top;
  }
  // Flat deck height for an elevated route: clears the tallest obstacle + headroom.
  _elevatedDeckY(pts, halfW) { return this._corridorTopY(pts, halfW) + 4.5; }
  // Concrete pillars from the deck down to the ground at intervals along the route.
  _addPillars(g, pts, r) {
    let acc = 999;
    for (let i = 0; i < pts.length; i++) {
      acc += i ? Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) : 0;
      if (acc < 9) continue; acc = 0;
      const gy = this._roadY(pts[i].x, pts[i].z), h = pts[i].y - gy; if (h < 1.2) continue;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, h, 8), toon(0x9098a0));
      pil.position.set(pts[i].x, gy + h / 2, pts[i].z); pil.castShadow = true; g.add(pil);
    }
  }
  _sampleEdge(roads, e) {
    const T = ROAD_TYPES[e.type] || ROAD_TYPES.road, hw = (T.renderHW || T.width / 2 + 0.35);
    // a traced or freehand-drawn road carries its own smoothed polyline
    if (e.poly && e.poly.length >= 2) {
      const n = e.poly.length, deckY = e.elevated ? this._elevatedDeckY(e.poly, hw + 1) : 0;
      return e.poly.map((p, i) => {
        const gy = this._roadY(p.x, p.z); let y = gy;
        if (e.elevated) { const t = i / (n - 1), ramp = Math.min(1, Math.min(t, 1 - t) / 0.18); y = gy + ramp * (deckY - gy); }  // flat flyover, ramps at the ends
        return { x: p.x, y, z: p.z };
      });
    }
    const a = roads.nodes[e.a], b = roads.nodes[e.b];
    if (!a || !b) return [];
    const base = [], segs = e.ctrl ? 14 : 1;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      if (e.ctrl) { const it = 1 - t; base.push({ x: it * it * a.x + 2 * it * t * e.ctrl.x + t * t * b.x, z: it * it * a.z + 2 * it * t * e.ctrl.z + t * t * b.z }); }
      else base.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    const deckY = e.elevated ? this._elevatedDeckY(base, hw + 1) : 0;
    return base.map((p, i) => {
      const gy = this._roadY(p.x, p.z); let y = gy;
      if (e.elevated) { const t = i / segs, ramp = Math.min(1, Math.min(t, 1 - t) / 0.18); y = gy + ramp * (deckY - gy); }
      return { x: p.x, y, z: p.z };
    });
  }

  // Walk the traced-road graph into maximal polylines: chains run through degree-2
  // nodes and break at endpoints/junctions (degree ≠ 2), so each returned chain is
  // a continuous run of node indices that can be drawn as one smooth ribbon.
  _tracedChains(roads) {
    const edges = roads.edges, adj = new Map();
    const push = (n, rec) => { let a = adj.get(n); if (!a) { a = []; adj.set(n, a); } a.push(rec); };
    const tracedIdx = [];
    edges.forEach((e, i) => { if (!e.traced) return; tracedIdx.push(i); push(e.a, { e: i }); push(e.b, { e: i }); });
    const deg = (n) => (adj.get(n)?.length || 0);
    const used = new Set(), chains = [];
    const walk = (start, ei) => {
      const nodes = [start]; let cur = start, edge = ei;
      while (true) {
        used.add(edge);
        const e = edges[edge], nxt = (e.a === cur) ? e.b : e.a;
        nodes.push(nxt); cur = nxt;
        if (deg(cur) !== 2) break;                       // stop at a junction or dead end
        const nb = adj.get(cur).find((x) => !used.has(x.e));
        if (!nb) break;
        edge = nb.e;
      }
      return nodes;
    };
    for (const [node, list] of adj) {                    // start chains at endpoints/junctions
      if (deg(node) === 2) continue;
      for (const nb of list) if (!used.has(nb.e)) chains.push(walk(node, nb.e));
    }
    for (const i of tracedIdx) if (!used.has(i)) chains.push(walk(edges[i].a, i)); // leftover pure loops
    return chains;
  }
  // Render freeform road meshes (asphalt, pavement, lane markings, stop lines,
  // bridge pillars, roundabout islands) then rebuild the unified nav graph.
  rebuildRoadNet() {
    if (!this.roadGroup) { this.roadGroup = new THREE.Group(); this.scene.add(this.roadGroup); }
    while (this.roadGroup.children.length) { const c = this.roadGroup.children.pop(); c.geometry?.dispose?.(); this.roadGroup.remove(c); }
    const roads = this.state?.roads;
    const pave = [[], []], road = [[], []], mark = [[], []];
    const ribbon = (buf, pts, hw, yOff) => {
      const [v, idx] = buf;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const px = -dz / l * hw, pz = dx / l * hw, n = v.length / 3;
        v.push(a.x + px, a.y + yOff, a.z + pz, a.x - px, a.y + yOff, a.z - pz, b.x - px, b.y + yOff, b.z - pz, b.x + px, b.y + yOff, b.z + pz);
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    };
    // a CONSTANT-width ribbon that mitres each joint (offset by the averaged
    // tangent's normal), so a curvy freehand road keeps a uniform width instead
    // of pinching/bulging at every bend.
    const ribbonSmooth = (buf, pts, hw, yOff) => {
      const [v, idx] = buf, base = v.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        // unit directions of the segments meeting at this vertex
        let pdx = p.x - a.x, pdz = p.z - a.z, pl = Math.hypot(pdx, pdz);
        let ndx = b.x - p.x, ndz = b.z - p.z, nl = Math.hypot(ndx, ndz);
        if (pl < 1e-6) { pdx = ndx; pdz = ndz; pl = nl; }       // start cap: use the next segment
        if (nl < 1e-6) { ndx = pdx; ndz = pdz; nl = pl; }       // end cap: use the prev segment
        pdx /= pl || 1; pdz /= pl || 1; ndx /= nl || 1; ndz /= nl || 1;
        const n1x = -pdz, n1z = pdx, n2x = -ndz, n2z = ndx;     // the two segment normals
        let mx = n1x + n2x, mz = n1z + n2z, ml = Math.hypot(mx, mz);
        if (ml < 1e-6) { mx = n2x; mz = n2z; ml = 1; }          // ~180° reversal guard
        mx /= ml; mz /= ml;
        // miter join: offset along the bisector by hw/cos(½angle) so the road keeps
        // a CONSTANT perpendicular width through bends (clamped to avoid spikes)
        let cosv = mx * n2x + mz * n2z; if (cosv < 0.5) cosv = 0.5;
        const off = hw / cosv;
        v.push(p.x + mx * off, p.y + yOff, p.z + mz * off, p.x - mx * off, p.y + yOff, p.z - mz * off);
      }
      for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    };
    // a thin marking line running along the centre-line, shifted sideways by `off`
    const markLine = (pts, off, dashed, hw = 0.09) => {      const [v, idx] = mark; let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const ux = dx / l, uz = dz / l, ox = -uz * off, oz = ux * off, px = -uz * hw, pz = ux * hw;
        const step = dashed ? 1.5 : l;
        for (let s = 0; s < l - 0.01; s += step) {
          acc++; if (dashed && acc % 2 === 0) continue;
          const m0 = s, m1 = Math.min(s + (dashed ? 0.8 : l), l), n = v.length / 3;
          v.push(a.x + ux * m0 + ox + px, a.y + 0.06, a.z + uz * m0 + oz + pz, a.x + ux * m0 + ox - px, a.y + 0.06, a.z + uz * m0 + oz - pz,
                 a.x + ux * m1 + ox - px, a.y + 0.06, a.z + uz * m1 + oz - pz, a.x + ux * m1 + ox + px, a.y + 0.06, a.z + uz * m1 + oz + pz);
          idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
        }
      }
    };
    // a solid stop line across the approach half at one end of the road
    const stopLine = (pts, hw, atEnd) => {
      const [v, idx] = mark;
      const i = atEnd ? pts.length - 1 : 0, j = atEnd ? pts.length - 2 : 1;
      const a = pts[i], b = pts[j];
      const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1; // outward
      const ux = dx / l, uz = dz / l, px = -uz, pz = ux;
      const cx = a.x - ux * 1.3, cz = a.z - uz * 1.3;                    // set back from the node
      const s0 = 0.1, s1 = hw, d = 0.45, n = v.length / 3;              // span the keep-left half
      v.push(cx + px * s0 + ux * d, a.y + 0.07, cz + pz * s0 + uz * d, cx + px * s1 + ux * d, a.y + 0.07, cz + pz * s1 + uz * d,
             cx + px * s1 - ux * d, a.y + 0.07, cz + pz * s1 - uz * d, cx + px * s0 - ux * d, a.y + 0.07, cz + pz * s0 - uz * d);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };

    // Traced 1966 roads are a dense graph of short 2-point edges. Drawing each as
    // its own quad leaves notches on the OUTSIDE of bends (each segment mitres to
    // its own normal). Instead, chain connected traced edges into continuous
    // polylines and draw each as ONE mitred ribbon — smooth like the trace map.
    if (roads) {
      const hw = ROAD_TYPES.road.renderHW || 0.34; // uniform width — matches player-drawn roads
      for (const chain of this._tracedChains(roads)) {
        const pts = chain.map((ni) => { const nd = roads.nodes[ni]; return nd && { x: nd.x, y: this._roadY(nd.x, nd.z), z: nd.z }; }).filter(Boolean);
        if (pts.length >= 2) ribbonSmooth(road, pts, hw, 0.04);
      }
    }

    if (roads) roads.edges.forEach((e) => {
      if (e.traced) return;              // already drawn as smooth chains above
      const T = ROAD_TYPES[e.type] || ROAD_TYPES.road;
      const pts = this._sampleEdge(roads, e);
      if (pts.length < 2) return;
      if (T.renderHW) {
        // player-drawn Road: a slim carriageway matching the 1966 survey-map roads —
        // a clean dark ribbon of uniform width (mitred so bends don't pinch).
        ribbonSmooth(road, pts, T.renderHW, 0.04);
        if (e.elevated) this._addPillars(this.roadGroup, pts, 0.45);
        return;
      }
      const hw = T.width / 2, L = e.lanes || T.lanes, lw = T.width / L;
      ribbon(pave, pts, hw + 0.35, 0.0);   // slim kerb/shoulder so roads aren't oversized
      ribbon(road, pts, hw, 0.03);
      for (let k = 1; k < L; k++) {                 // lane dividers
        const off = -hw + k * lw;
        markLine(pts, off, Math.abs(off) > 0.05);   // solid only on the centre (between directions)
      }
      stopLine(pts, hw, false); stopLine(pts, hw, true);
      if (e.elevated) this._addPillars(this.roadGroup, pts, 0.55);
    });

    (roads?.islands || []).forEach((is) => {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(is.r - 1.4, 22), toon(0x66bd5a));
      disc.rotation.x = -Math.PI / 2; disc.position.set(is.x, 0.17, is.z); this.roadGroup.add(disc);
      treeAt(this.roadGroup, is.x, is.z, 1.4); this.roadGroup.children[this.roadGroup.children.length - 1].position.set(is.x, 0, is.z);
    });

    const mk = (buf, material) => {
      if (!buf[0].length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(buf[0], 3));
      // uniform up-normals: these are flat ground decals, so they shade evenly
      // (computed per-vertex normals on the terrain-following bends caused the
      // bright "speckle" where folded/overlapping quads lit up under the sun).
      const nrm = new Float32Array(buf[0].length);
      for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setIndex(buf[1]);
      const m = new THREE.Mesh(g, material); m.receiveShadow = true; this.roadGroup.add(m);
    };
    const DS = THREE.DoubleSide;
    mk(pave, toon(0xc4bda8, { side: DS })); mk(road, toon(0x33363d, { side: DS })); mk(mark, toon(0xfaf3d8, { side: DS }));

    this._buildNavGraph();
  }

  // ONE navigation network shared by all traffic: the auto street grid PLUS the
  // player's freeform roads, merged where their endpoints meet.
  _buildNavGraph() {
    this.edgePts = []; this.edgeLen = []; this.edgeMeta = []; this.edgeN1 = []; this.edgeN2 = []; this.edgeMid = [];
    const nodes = [], adj = [], MERGE = 3.6;
    const nodeAt = (x, z, y) => {
      for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (Math.abs(n.x - x) < MERGE && Math.abs(n.z - z) < MERGE && Math.abs(n.y - y) < 3) return i; }
      nodes.push({ x, z, y }); adj.push([]); return nodes.length - 1;
    };
    const add = (pts, lanes, type, elevated, walk) => {
      if (pts.length < 2) return;
      let len = 0; for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      const n1 = nodeAt(pts[0].x, pts[0].z, pts[0].y), n2 = nodeAt(pts[pts.length - 1].x, pts[pts.length - 1].z, pts[pts.length - 1].y);
      if (n1 === n2) return;
      const ei = this.edgePts.length;
      this.edgePts.push(pts); this.edgeLen.push(len); this.edgeMeta.push({ lanes, type, elevated, walk });
      this.edgeN1.push(n1); this.edgeN2.push(n2);
      const mid = pts[Math.floor(pts.length / 2)]; this.edgeMid.push({ x: mid.x, z: mid.z });
      adj[n1].push({ edge: ei, to: n2, fwd: true }); adj[n2].push({ edge: ei, to: n1, fwd: false });
    };
    if (this.roadEdges) for (const [[ai, aj], [bi, bj]] of this.roadEdges) {
      const a = cornerToWorld(ai, aj), b = cornerToWorld(bi, bj);
      add([{ x: a.x, y: 0.16, z: a.z }, { x: b.x, y: 0.16, z: b.z }], 2, 'road', false, true);
    }
    const roads = this.state?.roads;
    if (roads) roads.edges.forEach((e) => {
      const T = ROAD_TYPES[e.type] || ROAD_TYPES.road;
      add(this._sampleEdge(roads, e), e.lanes || T.lanes, e.type, e.elevated, !e.elevated);
    });
    this.navNodes = nodes; this.navAdj = adj;
    this._buildLights();
    this._buildStreetLamps();
    this._buildTurnArrows();
    this._reseatAgents();   // edge indices changed — keep live agents valid
  }

  // Painted turn-lane arrows on each approach to a junction (left / ahead / right).
  _buildTurnArrows() {
    if (this.arrowMesh) { this.scene.remove(this.arrowMesh); this.arrowMesh.geometry.dispose(); this.arrowMesh = null; }
    const v = [], idx = [];
    const tri = (x, z, hx, hz, s) => {
      const l = Math.hypot(hx, hz) || 1, ux = hx / l, uz = hz / l, px = -uz, pz = ux, n = v.length / 3, y = 0.085;
      v.push(x + ux * s, y, z + uz * s, x - ux * s * 0.5 + px * s * 0.6, y, z - uz * s * 0.5 + pz * s * 0.6, x - ux * s * 0.5 - px * s * 0.6, y, z - uz * s * 0.5 - pz * s * 0.6);
      idx.push(n, n + 1, n + 2);
    };
    const rot = (hx, hz, a) => ({ x: hx * Math.cos(a) - hz * Math.sin(a), z: hx * Math.sin(a) + hz * Math.cos(a) });
    for (let n = 0; n < this.navAdj.length; n++) {
      const links = this.navAdj[n];
      if (links.length < 3) continue;
      const node = this.navNodes[n];
      for (const L of links) {
        const pts = this.edgePts[L.edge]; if (!pts || pts.length < 2) continue;
        // a point ~5u back from the node along this approach, and heading toward the node
        const endNear = !L.fwd; // L.fwd: node is at edge start; so node side is start when fwd
        const a = endNear ? pts[pts.length - 1] : pts[0];
        const b = endNear ? pts[pts.length - 2] : pts[1];
        let hx = a.x - b.x, hz = a.z - b.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl; // toward node
        const T = ROAD_TYPES[this.edgeMeta[L.edge].type] || ROAD_TYPES.road;
        const lane = T.width / 4;
        const px = node.x - hx * 6 + hz * lane, pz = node.z - hz * 6 - hx * lane;
        // which turns exist among the other roads?
        let left = false, right = false, ahead = false;
        for (const M of links) {
          if (M.edge === L.edge) continue;
          const mp = this.edgePts[M.edge]; const ms = M.fwd ? mp[0] : mp[mp.length - 1], mt = M.fwd ? mp[1] : mp[mp.length - 2];
          let ox = mt.x - ms.x, oz = mt.z - ms.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol; // leaving node
          const dot = ox * hx + oz * hz, cross = hx * oz - hz * ox;
          if (dot > 0.6) ahead = true; else if (cross > 0.25) left = true; else if (cross < -0.25) right = true;
        }
        if (!(left || right || ahead)) continue;
        let slot = 0; const dirs = [];
        if (left) dirs.push(rot(hx, hz, -0.6));
        if (ahead) dirs.push({ x: hx, z: hz });
        if (right) dirs.push(rot(hx, hz, 0.6));
        for (const d of dirs) { const off = (slot - (dirs.length - 1) / 2) * 0.9; tri(px - hz * off, pz + hx * off, d.x, d.z, 1.1); slot++; }
      }
    }
    if (!v.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.arrowMesh = new THREE.Mesh(g, toon(0xf2ead0, { side: THREE.DoubleSide }));
    this.scene.add(this.arrowMesh);
  }

  // Traffic lights go where they belong: at CROSS junctions (4+ roads meeting), plus
  // some 3-way junctions inside the shophouse town. Incident roads are split into two
  // phases that alternate; vehicles stop on red at the stop line.
  _buildLights() {
    if (this.lightGroup) this.scene.remove(this.lightGroup);
    this.lightGroup = new THREE.Group(); this.scene.add(this.lightGroup);
    this.lights = []; this.lightByNode = new Map();
    this._lightsActive = (this.state?.date?.y || 1965) >= LIGHT_YEAR;
    if (!this._lightsActive) return;   // none at independence — they modernise in later
    for (let n = 0; n < this.navAdj.length; n++) {
      const links = this.navAdj[n];
      if (links.length < 3) continue;
      const node = this.navNodes[n];
      // cross junctions everywhere; T-junctions only where they front the shophouses
      const ngx = Math.round(node.x / TILE + N / 2), ngy = Math.round(N / 2 - node.z / TILE);
      let nearShops = false;
      if (this._shopMask) for (let oy = -3; oy <= 3 && !nearShops; oy++) for (let ox = -3; ox <= 3; ox++) {
        const gx = ngx + ox, gy = ngy + oy;
        if (gx >= 0 && gy >= 0 && gx < N && gy < N && this._shopMask[gy][gx]) { nearShops = true; break; }
      }
      if (links.length < 4 && !nearShops) continue;
      // bearing of each incident road leaving the node
      const bear = (l) => {
        const pts = this.edgePts[l.edge];
        const a = l.fwd ? pts[0] : pts[pts.length - 1], b = l.fwd ? pts[1] : pts[pts.length - 2];
        return Math.atan2(b.z - a.z, b.x - a.x);
      };
      const sorted = links.map((l) => ({ l, ang: bear(l) })).sort((p, q) => p.ang - q.ang);
      const grpByEdge = new Map();
      sorted.forEach((s, i) => grpByEdge.set(s.l.edge, i % 2));   // alternate → opposite roads pair up
      const light = { node: n, grpByEdge, period: 7 + Math.random() * 3, t: Math.random() * 5, phase: 0, head: null };
      // a little signal post with a coloured lamp
      const post = new THREE.Group();
      post.add(cyl(0.1, 0.12, 2.3, 0x3a3f45, 0, 1.15, 0));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshToonMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 0.7, gradientMap: toonGradient() }));
      head.position.set(0, 2.3, 0); post.add(head); light.head = head;
      post.position.set(node.x, node.y, node.z); this.lightGroup.add(post);
      this.lights.push(light); this.lightByNode.set(n, light);
    }
  }
  // Merge many small indexed geometries (each already transformed) into one.
  _mergeGeos(geos) {
    let vc = 0, ic = 0;
    for (const g of geos) { vc += g.attributes.position.count; ic += g.index ? g.index.count : 0; }
    const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3);
    const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
    let vo = 0, io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      nrm.set(g.attributes.normal.array, vo * 3);
      const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      vo += g.attributes.position.count; io += gi.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  // Collapse a built model (a Group of many small meshes, e.g. makeBuilding output)
  // into ONE Group with a single merged mesh per material — keeping the detailed look
  // but cutting dozens of meshes down to a handful, while staying a single removable
  // object. Source meshes' local transforms are baked in (group left at identity).
  _mergeGroupByMaterial(src) {
    src.position.set(0, 0, 0); src.rotation.set(0, 0, 0); src.scale.set(1, 1, 1);
    src.updateMatrixWorld(true);
    const buckets = new Map();
    src.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.index) { const n = g.attributes.position.count, a = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let k = 0; k < n; k++) a[k] = k; g.setIndex(new THREE.BufferAttribute(a, 1)); }
      g.applyMatrix4(o.matrixWorld);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push(g);
    });
    const out = new THREE.Group();
    for (const [mat, geos] of buckets) {
      const m = new THREE.Mesh(this._mergeGeos(geos), mat); m.castShadow = true; m.receiveShadow = true;
      out.add(m); for (const g of geos) g.dispose();
    }
    return out;
  }
  // Line the surface roads with street lamps: spaced along each road, alternating
  // sides, the lamp head reaching over the carriageway and GLOWING after dark. Built
  // from the live road network, so player roads get them automatically and they
  // vanish when a road is demolished (the whole group is rebuilt each road change).
  // Two merged meshes (dark posts, glowing heads) keep it to a couple of draw calls.
  _buildStreetLamps() {
    if (this._lampGroup) { this._lampGroup.traverse((o) => o.geometry && o.geometry.dispose()); this.scene.remove(this._lampGroup); }
    this._lampGroup = new THREE.Group(); this.scene.add(this._lampGroup);
    // cached lamp-part templates (built once, at origin: base on the ground, arm/head reaching +Z)
    if (!this._lampTpl) {
      const postG = new THREE.CylinderGeometry(0.055, 0.075, 2.5, 6).translate(0, 1.25, 0);
      const armG = new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0, 2.42, 0.25);
      const headG = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 2.38, 0.48);
      this._lampTpl = { struct: this._mergeGeos([postG, armG]), head: headG };
    }
    const STEP = 20, MAX = 520;                                     // fixed distance between lamps along a road
    const structs = [], heads = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scl = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let count = 0;
    const addLamp = (cx, cz, perpx, perpz, side, off) => {
      const lx = cx + perpx * off * side, lz = cz + perpz * off * side;
      const ry = Math.atan2(-perpx * side, -perpz * side);          // head reaches IN over the carriageway
      q.setFromAxisAngle(up, ry); pos.set(lx, this._roadY(lx, lz), lz); m4.compose(pos, q, scl);
      structs.push(this._lampTpl.struct.clone().applyMatrix4(m4));
      heads.push(this._lampTpl.head.clone().applyMatrix4(m4));
      count++;
    };
    for (let e = 0; e < this.edgePts.length && count < MAX; e++) {
      const meta = this.edgeMeta[e]; if (!meta || !meta.walk || meta.elevated) continue;   // surface roads only
      const pts = this.edgePts[e]; if (!pts || pts.length < 2) continue;
      const T = ROAD_TYPES[meta.type] || ROAD_TYPES.road;
      const off = (T.renderHW || T.width / 2 || 0.34) + 0.85;       // sit on the verge, just off the kerb
      let acc = STEP * 0.5;                                          // first pair a fixed offset in from the end
      for (let i = 0; i < pts.length - 1 && count < MAX; i++) {
        const a = pts[i], b = pts[i + 1];
        let dx = b.x - a.x, dz = b.z - a.z; const segL = Math.hypot(dx, dz); if (segL < 1e-3) continue;
        dx /= segL; dz /= segL;
        const perpx = -dz, perpz = dx;                              // unit normal to the road
        while (acc <= segL && count < MAX) {
          const cx = a.x + dx * acc, cz = a.z + dz * acc;
          addLamp(cx, cz, perpx, perpz, 1, off);                    // a matched PAIR, one on each kerb,
          if (count < MAX) addLamp(cx, cz, perpx, perpz, -1, off);  // so the spacing reads as a regular ladder
          acc += STEP;
        }
        acc -= segL;
      }
    }
    if (!count) return;
    const postMat = mat(0x3e444b);                                  // dark pole (darkens at night, no glow)
    const headMat = mat(0xfff0b8, {}, 1.9);                         // warm lamp — glows after dark (glowK ≥ 1)
    this._lampGroup.add(new THREE.Mesh(this._mergeGeos(structs), postMat));
    const headMesh = new THREE.Mesh(this._mergeGeos(heads), headMat); this._lampGroup.add(headMesh);
    for (const g of structs) g.dispose(); for (const g of heads) g.dispose();
  }
  _updateLights(dt) {
    if (!this.lights) return;
    for (const lt of this.lights) {
      lt.t += dt;
      if (lt.t >= lt.period) { lt.t -= lt.period; lt.phase ^= 1; }
      if (lt.head) { const c = lt.phase === 0 ? 0x2ecc71 : 0xe23b2e; lt.head.material.color.setHex(c); lt.head.material.emissive.setHex(c); }
    }
  }
  // green for the road `edge` arriving at junction `node`?
  _greenFor(node, edge) {
    const lt = this.lightByNode?.get(node);
    if (!lt) return true;
    const g = lt.grpByEdge.get(edge);
    return g === undefined || g === lt.phase;
  }

  // Re-seat any agent whose edge no longer exists (after a road rebuild/erase).
  _reseatAgents() {
    const ne = this.edgePts.length;
    const fix = (a, walkOnly) => {
      if (a.edge < ne && this.edgePts[a.edge]) return;
      if (!ne) { a.edge = 0; return; }
      let e = Math.floor(Math.random() * ne);
      if (walkOnly) { for (let i = 0; i < ne; i++) { if (this.edgeMeta[(e + i) % ne].walk) { e = (e + i) % ne; break; } } }
      a.edge = e; a.t = Math.random(); a.dir = Math.random() < 0.5 ? 1 : -1; this._assignLane(a);
    };
    for (const a of this.vehicles) fix(a, false);
    for (const a of this.people) fix(a, true);
  }

  // ---- drawing preview ------------------------------------------------------
  showRoadPreview(nodes, type, elevated) {
    this.clearRoadPreview();
    if (!nodes || nodes.length < 1) return;
    this._roadPreview = new THREE.Group();
    for (const nd of nodes) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), toon(0xffd24a));
      m.position.set(nd.x, 0.6, nd.z); this._roadPreview.add(m);
    }
    this.scene.add(this._roadPreview);
  }
  clearRoadPreview() {
    if (this._roadPreview) { this.scene.remove(this._roadPreview); this._roadPreview = null; }
    if (this._drawPreviewGroup) { this.scene.remove(this._drawPreviewGroup); this._drawPreviewGroup = null; }
    this._clearSnapMarker(); this._hideDrawCursor();
  }

  // ---- per-frame update + render -------------------------------------------
  render() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // construction / demolition tweens
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      if (a.type === 'build') {
        const e = MODEL_SCALE * easeOutBack(k) * (a.entry?.tall ? this.devFactor : 1);
        a.group.scale.set(MODEL_SCALE, Math.max(MODEL_SCALE * 0.001, e), MODEL_SCALE);
        if (k >= 1 && a.entry) a.entry.anim = false;
      } else {
        a.group.scale.y = MODEL_SCALE * Math.max(0.001, 1 - k);
        a.group.rotation.z = k * 0.4;
        a.group.position.y = (a.baseY || 0) - k * 2;
        if (k >= 1) this.scene.remove(a.group);
      }
      if (k >= 1) this.anims.splice(i, 1);
    }

    // dust
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.t += dt;
      const arr = d.pts.geometry.attributes.position.array;
      for (let j = 0; j < d.vel.length; j++) {
        d.vel[j].y -= 14 * dt;
        arr[j * 3] += d.vel[j].x * dt;
        arr[j * 3 + 1] = Math.max(0, arr[j * 3 + 1] + d.vel[j].y * dt);
        arr[j * 3 + 2] += d.vel[j].z * dt;
      }
      d.pts.geometry.attributes.position.needsUpdate = true;
      d.pts.material.opacity = 0.9 * (1 - d.t / d.dur);
      if (d.t >= d.dur) { this.scene.remove(d.pts); this.dust.splice(i, 1); }
    }

    // In edit mode the world holds still (time is paused), so ambient motion uses
    // a zero delta — the camera and placement tweens above keep their real dt.
    const adt = this.frozen ? 0 : dt;

    // unified traffic — density scales with population, drives grid + freeform roads
    if (!this.frozen && this.state && this.edgePts.length) {
      const target = THREE.MathUtils.clamp(Math.floor(this.state.population / 30000), 5, 60);
      // traffic lights appear once the city has modernised past LIGHT_YEAR
      const wantLights = (this.state.date?.y || 1965) >= LIGHT_YEAR;
      if (wantLights !== this._lightsActive) this._buildLights();
      this._updateLights(dt);
      // As the economy develops and the world invents newer stock, retire the old
      // fleet so freshly-spawned cars/trains show the country's current generation.
      const fe = fleetEra(this.state);
      if (!this._fleet || fe.car !== this._fleet.car) {
        this._fleet = fe;
        for (const v of this.vehicles) this.scene.remove(v.mesh);
        this.vehicles.length = 0;                // respawn at the new generation below
      }
      if (fe.train !== this._trainEra) this._buildTrains();
      this._ensureVehicles(target);
      this._advanceNet(this.vehicles, dt);
    }

    // sea shimmer (held still while editing)
    if (this.sea && !this.frozen) this.sea.material.opacity = 0.9 + Math.sin(this.clock.elapsedTime * 1.5) * 0.03;

    this._updateDayNight();
    this._updateWeather(adt);
    this._updateDevelopment(adt);
    this._updatePeople(adt);
    this._updateBoats(adt);
    if (!this.frozen) this._updateAirstripPlanes(dt);   // taxiing/landing aircraft on drawn runways
    if (!this.frozen) this._updateTrains(dt);           // trains shuttling along every railway & MRT line
    this._updateDisaster(adt);
    this._commitSky();   // paint the gradient sky after day/night + weather + haze tints
    if (this._snapMarker && this._snapMarker.visible) { const s = 1 + 0.18 * Math.sin(performance.now() / 180); this._snapMarker.scale.set(s, s, 1); } // pulse the "start here" ring
    // blink the amber construction-barrier lights (roadworks + reclamation)
    const blink = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(performance.now() / 170));
    for (const grp of [this._roadworksGroup, this.reclaimSiteGroup, this._reclaimAreaGroup]) {
      if (grp) grp.traverse((o) => { if (o.userData && o.userData.blink) o.material.opacity = blink; });
    }
    if (this._tileHi && this._tileHi.visible) { const k = 0.34 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() / 320)); this._tileHiFill.opacity = k; } // gentle tile pulse
    this._updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ===========================================================================
// Building meshes — detailed, realistically-proportioned complexes.
// Tiles are ~10 units; buildings occupy ~8 units (leaving gaps for streets) and
// are built as clusters of windowed structures rather than single blocks.
// Each returned Group sits on the ground (y=0) and grows upward.
// ===========================================================================
export const ALL_MATS = []; // every building material, for the night-glow pass

// Cel-shading gradient ramp: a few hard luminance bands give the cartoon look
// (and MeshToonMaterial is cheaper than PBR).
let GRAD = null;
export function toonGradient() {
  if (!GRAD) {
    const d = new Uint8Array([55, 150, 210, 255]); // darker shadow band so night reads as night
    GRAD = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat);
    GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
  }
  return GRAD;
}
// Only pass options MeshToonMaterial understands (avoids console warnings).
function toonOpts(opts = {}) {
  const o = { gradientMap: toonGradient() };
  if (opts.transparent) o.transparent = true;
  if (opts.opacity != null) o.opacity = opts.opacity;
  if (opts.side) o.side = opts.side;
  if (opts.map) o.map = opts.map;
  if (opts.emissiveMap) o.emissiveMap = opts.emissiveMap;
  if (opts.depthWrite != null) o.depthWrite = opts.depthWrite;
  return o;
}
// Un-registered toon material (ground/sea/markings — should not glow at night).
function toon(color, opts = {}) { return new THREE.MeshToonMaterial({ color, ...toonOpts(opts) }); }

function reg(m, glowK = 0.22) {
  m.emissive = new THREE.Color(0xffd9a0); m.emissiveIntensity = 0; m.userData.glowK = glowK;
  ALL_MATS.push(m); return m;
}
const MAT = new Map();
function mat(color, opts = {}, glowK = 0.18) {
  const key = color + JSON.stringify(opts) + glowK;
  if (!MAT.has(key)) MAT.set(key, reg(new THREE.MeshToonMaterial({ color, ...toonOpts(opts) }), glowK));
  return MAT.get(key);
}
// Strongly-glowing material for designer parts flagged "light" — a lit window
// switches on warm after dark (driven by the ALL_MATS night pass).
const LITMAT = new Map();
function litMat(color) {
  if (!LITMAT.has(color)) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    m.emissive = new THREE.Color(0xffe2a8); m.emissiveIntensity = 0; m.userData.glowK = 1.1;
    ALL_MATS.push(m); LITMAT.set(color, m);
  }
  return LITMAT.get(color);
}

// --- procedural facade textures (colour + emissive window maps) ------------
const TEX = {};
function facadeTextures(style) {
  if (TEX[style]) return TEX[style];
  const palette = {
    hdb:    { wall: '#e7ddca', win: '#8aa1ad', ledge: '#cdbfa3' },
    glass:  { wall: '#6da3c7', win: '#cdeafb', ledge: '#5b8caa' },
    office: { wall: '#7c8b97', win: '#bfe6ff', ledge: '#6a7884' },
    hotel:  { wall: '#caa977', win: '#f3e6c8', ledge: '#b6965f' },
  }[style] || { wall: '#9aa3a8', win: '#c8d2d6', ledge: '#828a8f' };
  const S = 96;
  const make = (draw) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  };
  const cols = 4, rows = 4, m = S * 0.07;
  const gw = (S - m * (cols + 1)) / cols, gh = (S - m * (rows + 1)) / rows;
  const grid = (x, fill) => {
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) fill(x, m + i * (gw + m), m + j * (gh + m), gw, gh);
  };
  const map = make((x) => {
    x.fillStyle = palette.wall; x.fillRect(0, 0, S, S);
    x.fillStyle = palette.ledge;
    for (let j = 0; j <= rows; j++) x.fillRect(0, j * (gh + m) - 1, S, 2);
    grid(x, (g, px, py, w, h) => { g.fillStyle = palette.win; g.fillRect(px, py, w, h); });
  });
  const emap = make((x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
    grid(x, (g, px, py, w, h) => { g.fillStyle = Math.random() < 0.72 ? '#ffe6b0' : '#1a1208'; g.fillRect(px, py, w, h); });
  });
  TEX[style] = { map, emap };
  return TEX[style];
}
const FMAT = new Map();
function facadeMat(style, repX, repY, opts = {}) {
  const key = `${style}|${repX}x${repY}|${JSON.stringify(opts)}`;
  if (!FMAT.has(key)) {
    const { map, emap } = facadeTextures(style);
    const cm = map.clone(); cm.repeat.set(repX, repY); cm.needsUpdate = true;
    const ce = emap.clone(); ce.repeat.set(repX, repY); ce.needsUpdate = true;
    FMAT.set(key, reg(new THREE.MeshToonMaterial({
      map: cm, emissiveMap: ce, emissive: 0xffe2a8, emissiveIntensity: 0, gradientMap: toonGradient(),
      color: opts.tint != null ? new THREE.Color(opts.tint) : 0xffffff,
    }), 1.0));
  }
  return FMAT.get(key);
}

// --- primitives ------------------------------------------------------------
function partBox(w, h, d, material, x = 0, y = h / 2, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function box(w, h, d, color, opts) { return partBox(w, h, d, mat(color, opts)); }
function cyl(rt, rb, h, color, x = 0, y = h / 2, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'object' ? color : mat(color));
  m.position.set(x, y, z); m.castShadow = true; return m;
}
function tower(w, h, d, style, x = 0, z = 0, opts) {
  const repX = Math.max(1, Math.round(w / 2.6)), repY = Math.max(1, Math.round(h / 3.4));
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMat(style, repX, repY, opts));
  m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true; return m;
}
function roofKit(g, x, z, w, d, topY) {
  g.add(partBox(w + 0.3, 0.5, d + 0.3, mat(0x9aa0a6), x, topY + 0.25, z));
  g.add(cyl(0.5, 0.5, 0.9, 0x6f757b, x - w * 0.2, topY + 0.9, z - d * 0.2));
  g.add(partBox(1.2, 0.7, 1.2, mat(0x7d848b), x + w * 0.18, topY + 0.6, z + d * 0.18));
}
function treeAt(g, x, z, s = 1) {
  s *= 0.45;   // trees kept small relative to buildings
  g.add(cyl(0.18 * s, 0.22 * s, 1.4 * s, 0x7a5836, x, 0.7 * s, z));
  const f = new THREE.Mesh(new THREE.SphereGeometry(1.0 * s, 7, 6), mat(0x4f9e3f));
  f.position.set(x, 1.9 * s, z); f.scale.y = 1.2; f.castShadow = true; g.add(f);
}
function lawn(g, w, d, color = 0x6fb15a) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, {}, 0.1));
  p.rotation.x = -Math.PI / 2; p.position.y = 0.04; p.receiveShadow = true; g.add(p);
}

// A 1950s propliner / early jet for the airport apron (silver with a red cheat
// line). Built nose-along local +Z, lying on the ground.
function makeAirliner() {
  const g = new THREE.Group();
  const skin = mat(0xe3e7ea), trim = mat(0xc6402f), dark = mat(0x2f3338), glass = mat(0x9fd0e6, { transparent: true, opacity: 0.85 });
  const yb = 1.7;
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 14, 16), skin);
  fus.rotation.x = Math.PI / 2; fus.position.set(0, yb, 0); fus.castShadow = true; g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.6, 16), skin);
  nose.rotation.x = -Math.PI / 2; nose.position.set(0, yb, 8.3); nose.castShadow = true; g.add(nose);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.4, 16), skin);
  tail.rotation.x = Math.PI / 2; tail.position.set(0, yb + 0.4, -8.0); tail.castShadow = true; g.add(tail);
  g.add(partBox(2.2, 0.5, 13, mat(0xeceef0), 0, yb + 1.02, 0));        // window-line spine highlight
  g.add(partBox(2.2, 0.45, 11, trim, 0, yb + 0.35, 0.5));             // red cheat line
  // wings (swept back) + horizontal stabilisers + tail fin
  const wing = partBox(22, 0.4, 4.2, skin, 0, yb - 0.2, -0.8); wing.rotation.y = 0.12; g.add(wing);
  g.add(partBox(9, 0.34, 2.4, skin, 0, yb + 0.5, -6.8));
  const fin = partBox(0.4, 4.2, 3.0, skin, 0, yb + 2.6, -7.2); g.add(fin);
  g.add(partBox(0.42, 2.4, 1.4, trim, 0, yb + 3.4, -7.6));            // fin flash
  // four under-wing engine nacelles
  for (const ex of [-7.5, -4, 4, 7.5]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 3.2, 12), dark);
    nac.rotation.x = Math.PI / 2; nac.position.set(ex, yb - 0.7, -0.2 + Math.abs(ex) * 0.12); nac.castShadow = true; g.add(nac);
  }
  // nose-wheel & main gear (short struts)
  for (const [gx, gz] of [[0, 6.5], [-2.2, -1.5], [2.2, -1.5]]) g.add(cyl(0.28, 0.28, 1.4, 0x26282c, gx, 0.7, gz));
  g.add(glassPanes(glass));                                          // cockpit glass
  return g;
}
function glassPanes(glassMat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.2), glassMat);
  m.position.set(0, 2.3, 6.6); return m;
}

// The 1955 Singapore (Paya Lebar) terminal, modelled to the postcard elevation
// (facing local +Z, the apron side): from left to right — the square control
// tower with its glazed cab and flat overhanging roof, the clean multi-storey
// office slab beside it, then the single-storey saw-tooth concourse hall.
function makeTerminal() {
  const g = new THREE.Group();
  const concrete = 0xc9c2b0, pale = 0xe6e1d2, grey = 0x9aa0a6, glassBlue = 0xbfe6ff;

  // (left) square control tower — shaft, corner pilasters, glazed cab, flat roof
  const tx = -11;
  g.add(tower(6.5, 26, 6.5, 'office', tx, 1));
  for (const [fxs, fzs] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    g.add(partBox(0.6, 26.4, 0.6, mat(concrete), tx + fxs * 3.3, 13.2, 1 + fzs * 3.3)); // corner frame
  g.add(partBox(8.8, 3.6, 8.8, mat(glassBlue, { transparent: true, opacity: 0.8 }), tx, 27.8, 1)); // glazed cab
  g.add(partBox(10.2, 0.7, 10.2, mat(grey), tx, 30.0, 1));           // flat overhanging roof
  g.add(cyl(0.16, 0.2, 4.4, 0xd23b32, tx, 32.5, 1));                 // radio mast
  g.add(cyl(0.09, 0.09, 1.4, 0xf2efe6, tx, 35.2, 1));               // white tip
  g.add(partBox(11, 4, 6, mat(pale), tx + 1.6, 2, 3.6));            // low entrance hall at the base

  // (centre) the clean multi-storey office slab BESIDE the tower — regular grid
  const sx0 = 4;
  g.add(tower(20, 16, 8, 'office', sx0, 0));
  g.add(partBox(20.6, 1.0, 8.6, mat(pale), sx0, 16.4, 0));           // parapet cap
  g.add(partBox(5, 2.4, 4.6, mat(pale), sx0 + 4, 17.6, 0));          // rooftop penthouse
  g.add(cyl(0.1, 0.1, 3, mat(grey), sx0 + 4, 19.6, 0));            // roof emblem pole
  g.add(partBox(20, 4, 0.4, mat(glassBlue, { transparent: true, opacity: 0.65 }), sx0, 2, 4.2)); // glazed frontage
  g.add(partBox(21.5, 0.4, 3.2, mat(pale), sx0, 4.2, 5.4));          // entrance canopy
  for (const cx of [-7, -2, 3, 8]) g.add(cyl(0.2, 0.2, 4, 0xcfcabb, sx0 + cx, 2, 6.8));

  // (right) single-storey saw-tooth concourse hall
  const baseX = 18;
  g.add(partBox(12, 6, 9, mat(pale), baseX, 3, 0));
  for (let i = 0; i < 5; i++) {
    const rx = baseX - 4.8 + i * 2.4;
    const roof = partBox(2.4, 0.3, 9, mat(concrete), rx, 7.0, 0); roof.rotation.z = 0.5; g.add(roof);
    g.add(partBox(0.3, 1.6, 9, mat(glassBlue, { transparent: true, opacity: 0.75 }), rx - 1.05, 6.7, 0)); // north-light glazing
  }

  // landside garden behind the complex
  lawn(g, 44, 8, 0x6fb15a);
  for (const tt of [-13, -4, 5, 14, 21]) treeAt(g, tt, -7.5, 1.2);
  return g;
}

// The second airport building: an aircraft hangar — a long shed with a curved
// barrel roof and big doors, facing local +Z (the apron side).
function makeHangar() {
  const g = new THREE.Group();
  g.add(partBox(18, 6, 13, mat(0xcfc9b8), 0, 3, 0));                // wide body (width X, depth Z)
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.4, 13.2, 18), mat(0x9aa0a6));
  roof.rotation.x = Math.PI / 2; roof.scale.z = 0.55; roof.position.set(0, 6, 0); roof.castShadow = true; g.add(roof); // wide shallow vault
  g.add(partBox(14.6, 5.0, 0.8, mat(0x2a2d31), 0, 2.6, 6.4));        // dark open doorway (look inside)
  for (const sx of [-7.7, 7.7]) g.add(partBox(0.7, 6, 0.8, mat(0xbdb7a6), sx, 3, 6.4)); // door jambs
  g.add(partBox(16.0, 0.7, 0.8, mat(0xbdb7a6), 0, 5.4, 6.4));        // lintel above the doors
  return g;
}

// A plain flat-roofed airport block (workshop / admin), facing local +Z.
function makeAirBlock(w, ht, d, style = 'office') {
  const g = new THREE.Group();
  g.add(tower(w, ht, d, style, 0, 0));
  g.add(partBox(w + 0.4, 0.7, d + 0.4, mat(0xe6e1d2), 0, ht + 0.35, 0)); // parapet cap
  return g;
}

// A long, low, wide single-storey hall (arrivals / transit shed) with a flat
// roof and a covered walkway on columns along its apron side. Faces local +Z.
function makeLowHall(len, ht, d) {
  const g = new THREE.Group();
  const pale = 0xe6e1d2, roofc = 0xcdc7b8;
  g.add(tower(len, ht, d, 'office', 0, 0));                          // low windowed body
  g.add(partBox(len + 0.6, 0.6, d + 0.6, mat(roofc), 0, ht + 0.3, 0)); // flat roof
  g.add(partBox(len, 0.3, 2.6, mat(pale), 0, ht * 0.72, d / 2 + 1.4)); // covered walkway canopy
  const n = Math.max(1, Math.floor(len / 6));
  for (let i = -n; i <= n; i++) g.add(cyl(0.18, 0.18, ht * 0.72, 0xcfcabb, i * (len / (2 * n)), ht * 0.36, d / 2 + 2.5));
  return g;
}

// A long low workshop with a north-light saw-tooth roof, facing local +Z.
function makeSawtoothShed(w, ht, d, bays) {
  const g = new THREE.Group();
  const pale = 0xddd8c8, roofc = 0xb7bcc0, glass = 0xbfe6ff;
  g.add(partBox(w, ht, d, mat(pale), 0, ht / 2, 0));                // body
  const bw = w / bays;
  for (let i = 0; i < bays; i++) {
    const bx = -w / 2 + bw * (i + 0.5);
    const roof = partBox(bw * 1.04, 0.3, d, mat(roofc), bx, ht + 0.35, 0); roof.rotation.z = 0.5; g.add(roof);
    g.add(partBox(0.3, bw * 0.55, d, mat(glass, { transparent: true, opacity: 0.7 }), bx - bw * 0.46, ht + bw * 0.3, 0)); // north-light glazing
  }
  return g;
}

// The departure finger pier the aircraft dock against: a long single-storey hall
// with a continuous glazed apron-side wall and a boarding canopy on columns.
// Modelled along local X (faces local +Z, the apron side).
function makePier() {
  const g = new THREE.Group();
  const pale = 0xe6e1d2, glass = 0xbfe6ff, roofc = 0xb7bcc0;
  g.add(partBox(30, 4.2, 6.5, mat(pale), 0, 2.1, 0));               // long low hall
  g.add(partBox(30.6, 0.5, 7.2, mat(roofc), 0, 4.45, 0));           // flat roof
  g.add(partBox(30, 2.4, 0.3, mat(glass, { transparent: true, opacity: 0.6 }), 0, 2.4, 3.35)); // apron-side glazing
  g.add(partBox(30, 0.3, 2.6, mat(pale), 0, 4.4, 4.9));             // boarding canopy
  for (let i = -4; i <= 4; i++) g.add(cyl(0.15, 0.15, 4.3, 0xcfcabb, i * 3.2, 2.1, 5.1)); // canopy columns
  return g;
}

// Scatter parked cars over a landside lot (local coords; added to the rotated
// airport group). Small two-tone boxes in rows.
function addCars(g, lx, lz, w, d) {
  const cols = [0x9aa0a6, 0xc9c2b4, 0x7d848b, 0xb0b4b8, 0x8a5048, 0x4f5a66, 0xcdc7b8];
  const rows = 5, perRow = 7;
  for (let r = 0; r < rows; r++) for (let c = 0; c < perRow; c++) {
    if (Math.random() < 0.3) continue;
    const cxp = lx - w / 2 + 1.4 + c * (w - 2.8) / (perRow - 1);
    const czp = lz - d / 2 + 2 + r * (d - 4) / (rows - 1);
    const col = cols[Math.floor(Math.random() * cols.length)];
    g.add(partBox(1.5, 0.7, 2.5, mat(col), cxp, 0.5, czp));
    g.add(partBox(1.1, 0.45, 1.2, mat(0x23262b), cxp, 1.05, czp - 0.1));
  }
}

export function makeBuilding(key, theme) {
  const b = BUILDINGS[key];
  const g = new THREE.Group();
  if (!b) return g; // unknown key (e.g. a landmark def not yet registered) — render nothing
  // Player-buildable 3D-designed landmark (from design.html): render its parts.
  // The landmark's scale is baked into each part so the build/grow animation
  // (which drives group.scale.y) still works.
  if (b.landmarkParts) {
    const s = b.lmScale || 1;
    for (const p of b.landmarkParts) {
      const q = s === 1 ? p : { ...p, x: (p.x || 0) * s, y: (p.y || 0) * s, z: (p.z || 0) * s, w: (p.w || 4) * s, h: (p.h || 4) * s, d: (p.d || 4) * s };
      g.add(makeLandmarkPart(q, toon));
    }
    return g;
  }
  const tint = b.customizable && theme ? (typeof theme === 'string' ? parseInt(theme.slice(1), 16) : theme) : null;
  const col = tint != null ? tint : parseInt((b.color || '#888888').slice(1), 16);
  const cat = b.cat;
  const rnd = (a, bb) => a + Math.random() * (bb - a);

  if (cat === 'residential') {
    if (key === 'kampong') {
      lawn(g, 9, 9, 0x9c8a5a);                               // packed-earth clearing
      for (const [dx, dz, rot] of [[-2.4, -1.6, 0.2], [1.9, -2.1, -0.3], [-0.2, 1.9, 0.1], [2.5, 1.7, 0.5]]) {
        const hut = new THREE.Group(); hut.position.set(dx, 0, dz); hut.rotation.y = rot;
        for (const [px, pz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]])
          hut.add(cyl(0.1, 0.12, 1.0, 0x6b4f33, px, 0.5, pz));          // stilts
        hut.add(partBox(2.3, 1.3, 2.5, mat(0xb89b6a), 0, 1.65, 0));     // raised timber house
        for (const s of [-1, 1]) {                                       // steep attap (thatch) gable
          const r = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.12, 1.75), mat(0x6e5128));
          r.position.set(0, 2.55, s * 0.62); r.rotation.x = s * 0.72; r.castShadow = true; hut.add(r);
        }
        hut.add(partBox(0.5, 0.7, 0.05, mat(0x4a3a2a), 0, 1.6, 1.27)); // doorway
        g.add(hut);
      }
      for (const [dx, dz] of [[-3.2, 2.6], [3.2, -3], [3.1, 3.2]]) {     // coconut palms
        g.add(cyl(0.12, 0.18, 3.0, 0x8a6b43, dx, 1.5, dz));
        const fr = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat(0x3fae57));
        fr.position.set(dx, 3.1, dz); fr.scale.y = 0.5; fr.castShadow = true; g.add(fr);
      }
    } else if (key === 'shophouse') {
      lawn(g, 9, 9, 0x9a9078);                                // packed-earth lane out front
      const pastels = [0xe8b04b, 0xd9694f, 0x6fae9e, 0xe2cd7a, 0xc97f9c, 0x7fa8c9, 0xe7e0cf];
      const units = 4, uw = 2.05, depth = 4.6, body = 4.2, fz = depth / 2;  // facade faces +z (the street)
      const x0 = -((units - 1) * uw) / 2;
      const signc = [0xc0392b, 0x2c3e8f, 0x2f7d3a];
      for (let i = 0; i < units; i++) {
        const ux = x0 + i * uw;
        const wallc = tint != null ? tint : pastels[(i * 3 + 1) % pastels.length];
        g.add(partBox(uw - 0.06, body, depth, mat(wallc), ux, body / 2, 0));                  // two-storey body
        g.add(partBox(uw - 0.16, 0.18, depth, mat(0xefe9da), ux, 2.05, 0));                   // floor string-course
        g.add(partBox(uw - 0.16, 0.2, 0.1, mat(0xefe9da), ux, body - 0.05, fz + 0.01));       // cornice
        // ground-floor shopfront, recessed under a five-foot-way verandah
        g.add(partBox(uw - 0.4, 1.7, 0.16, mat(0x3f3128), ux, 0.95, fz - 0.5));               // dark shopfront
        g.add(partBox(uw - 0.06, 0.16, 1.0, mat(i % 2 ? 0xb5402f : 0x35613f), ux, 1.92, fz + 0.46)); // flat awning
        for (const sx of [-1, 1])
          g.add(cyl(0.1, 0.1, 1.9, 0xe8e2d2, ux + sx * (uw / 2 - 0.16), 0.95, fz + 0.92));    // verandah columns
        // upper-floor pair of louvered, shuttered windows — the panes glow warm after dark
        for (const sx of [-0.44, 0.44]) {
          g.add(partBox(0.42, 1.0, 0.06, mat(0xd7ad5e, {}, 1.4), ux + sx, 3.0, fz + 0.02));   // window (lights up at night)
          g.add(partBox(0.13, 1.0, 0.08, mat(0xece4cf), ux + sx - 0.27, 3.0, fz + 0.05));     // shutter
          g.add(partBox(0.13, 1.0, 0.08, mat(0xece4cf), ux + sx + 0.27, 3.0, fz + 0.05));
        }
        if (i % 2 === 0)                                                                       // hanging vertical signboard
          g.add(partBox(0.14, 1.3, 0.45, mat(signc[i % 3]), ux + (uw / 2 - 0.1), 2.5, fz + 0.18));
      }
      // a single, correctly-pitched clay-tile gable across the whole terrace
      const rw = units * uw + 0.25, rh = 1.15, halfD = depth / 2 + 0.1;
      const slopeLen = Math.hypot(halfD, rh), ang = Math.atan2(rh, halfD);
      for (const s of [1, -1]) {
        const slope = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.14, slopeLen), mat(0xb15a3c));
        slope.position.set(0, body + rh / 2, s * halfD / 2); slope.rotation.x = -s * ang; slope.castShadow = true; g.add(slope);
      }
      g.add(partBox(rw, 0.2, 0.2, mat(0x8f4630), 0, body + rh, 0));                            // ridge cap
      for (const sx of [-1, 1])                                                                // gable end walls
        g.add(partBox(0.12, rh, depth, mat(0xd8cdb6), sx * rw / 2, body + rh / 2, 0));
    } else if (key === 'terrace') {
      // a short row of two-storey terrace houses — front doors, windows, pitched tile roofs
      lawn(g, 9, 9, 0x8fb060);
      const units = 3, uw = 2.4, depth = 3.6, body = 3.2, fz = depth / 2;
      const cols = [0xe7d6a8, 0xd9b58a, 0xcfd0bd, 0xe2c79a];
      const x0 = -((units - 1) * uw) / 2;
      for (let i = 0; i < units; i++) {
        const ux = x0 + i * uw, wc = tint != null ? tint : cols[i % cols.length];
        g.add(partBox(uw - 0.08, body, depth, mat(wc), ux, body / 2, 0));                 // body
        g.add(partBox(0.7, 1.4, 0.1, mat(0x5a3f2c), ux, 0.72, fz + 0.02));                // front door
        for (const fy of [1.05, 2.45]) for (const sx of [-0.6, 0.6])                       // windows, two floors
          g.add(partBox(0.5, 0.6, 0.08, mat(0x3a5a6a), ux + sx, fy + 0.2, fz + 0.02));
        const rh = 0.9, halfD = depth / 2 + 0.08, sl = Math.hypot(halfD, rh), an = Math.atan2(rh, halfD);
        for (const s of [1, -1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(uw - 0.02, 0.12, sl), mat(0xa6512f)); r.position.set(ux, body + rh / 2, s * halfD / 2); r.rotation.x = -s * an; r.castShadow = true; g.add(r); }
      }
    } else if (key === 'bungalow') {
      // a detached single-storey house with a porch and garden
      lawn(g, 9, 9, 0x73b35a);
      g.add(partBox(4.6, 2.6, 4.0, mat(tint != null ? tint : 0xeae2cc), 0, 1.3, -0.3));   // body
      const rf = new THREE.Mesh(new THREE.ConeGeometry(3.9, 1.5, 4), mat(0x9c4a36)); rf.rotation.y = Math.PI / 4; rf.position.set(0, 3.35, -0.3); rf.castShadow = true; g.add(rf); // hipped roof
      g.add(partBox(0.8, 1.4, 0.1, mat(0x5a3f2c), 0, 0.7, 1.75));                          // door
      for (const sx of [-1.5, 1.5]) g.add(partBox(0.9, 0.8, 0.08, mat(0x3a5a6a), sx, 1.4, 1.72)); // windows
      g.add(partBox(2.6, 0.12, 1.2, mat(0xcfc6b0), 0, 0.06, 2.4));                          // porch slab
      for (const sx of [-1.0, 1.0]) g.add(cyl(0.1, 0.1, 1.6, 0xd8cfb8, sx, 0.8, 2.4));      // porch posts
      treeAt(g, -3.3, 2.8, 1.0); treeAt(g, 3.2, 2.6, 0.9);
    } else if (key === 'walkup') {
      // a four-storey SIT-style walk-up flat block — rows of windows + little balconies
      lawn(g, 9, 9, 0x8aac63);
      const Wd = 7.2, D = 3.6, Ht = 7.0;
      g.add(partBox(Wd, Ht, D, mat(tint != null ? tint : 0xe3d3a6), 0, Ht / 2, 0));        // block
      for (let fl = 0; fl < 4; fl++) for (let b2 = -2; b2 <= 2; b2++) {
        g.add(partBox(0.7, 0.7, 0.08, mat(0x3c5663), b2 * 1.3, 1.1 + fl * 1.6, D / 2 + 0.02));        // window
        g.add(partBox(0.9, 0.12, 0.5, mat(0xcfc6b0), b2 * 1.3, 0.78 + fl * 1.6, D / 2 + 0.28));       // balcony slab
      }
      g.add(partBox(Wd + 0.2, 0.3, D + 0.2, mat(0xcdbfa0), 0, Ht + 0.1, 0));               // roof parapet
      g.add(partBox(1.2, 1.6, 0.1, mat(0x4a3a2a), -Wd / 2 + 0.9, 0.8, D / 2 + 0.02));       // stair entrance
    } else {
      lawn(g, 9, 9);
      const topt = tint != null ? { tint } : undefined;
      const conf = key === 'hdb_highrise'
        // modern HDB point blocks: three slim 40-storey towers with sky decks
        ? { slabs: [[-2.6, -1.6, 2.6, 34, 2.6], [2.6, -0.4, 2.6, 38, 2.6], [-0.2, 2.4, 2.6, 30, 2.6]], style: 'hdb' }
        : key === 'condo_estate'
        ? { slabs: [[-2.7, -1.7, 2.7, 20, 2.7], [0.5, -2.6, 2.5, 16, 2.5], [2.7, 1.5, 2.7, 23, 2.7], [-1.6, 2.3, 2.6, 18, 2.6]], style: 'glass' }
        : key === 'hdb_newtown'
          // a real HDB estate: a long slab block + two perpendicular slab wings (the
          // classic long-corridor layout — long and rectangular, not square towers).
          ? { slabs: [[0, -2.7, 9.0, 16, 2.3], [-3.4, 1.1, 2.3, 14, 5.4], [3.4, 1.1, 2.3, 14, 5.4]], style: 'hdb' }
          : key === 'condo'
            ? { slabs: [[-1.8, -1, 3.0, 17, 3.0], [1.8, 1.2, 2.8, 14, 2.8]], style: 'glass' }
            // hdb_flat: a single long-corridor slab with a short return wing (an L), so the
            // flats are a long rectangle (long common corridor) rather than a square block.
            : { slabs: [[0, -1.4, 8.6, 12, 2.2], [3.5, 1.3, 2.2, 12, 4.6]], style: 'hdb' };
      for (const [dx, dz, w, h, d] of conf.slabs) { g.add(tower(w, h, d, conf.style, dx, dz, topt)); roofKit(g, dx, dz, w, d, h); }
      g.add(partBox(8, 1.6, 4.4, mat(0xcdbfa3), 0, 0.8, 2.6));
      if (key === 'condo' || key === 'condo_estate') {
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(key === 'condo_estate' ? 4 : 3, 1.8), mat(0x49b6e0));
        pool.rotation.x = -Math.PI / 2; pool.position.set(-2.4, 0.06, 2.6); g.add(pool);
        if (key === 'condo_estate') g.add(partBox(2.4, 1.4, 1.6, mat(0xf0ece0), 2.6, 0.7, 2.8)); // clubhouse
      }
      treeAt(g, -3.4, 3, 0.9); treeAt(g, 3.4, -3.2, 0.9);
    }
  } else if (cat === 'power') {
    lawn(g, 9, 9, 0x9a9f7a);
    if (key === 'solar_farm') {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const p = partBox(2.3, 0.18, 1.5, mat(0x1c2c44, { metalness: 0.6, roughness: 0.2 }), i * 2.7, 1.1, j * 2.4);
        p.rotation.x = -0.5; g.add(p);
        g.add(cyl(0.08, 0.08, 1, 0x555555, i * 2.7, 0.5, j * 2.4));
      }
      g.add(partBox(1.4, 1.4, 1, mat(0xcfcabb), 3.4, 0.7, 3.4));
    } else if (key === 'nuclear') {
      // a domed reactor containment + a big hyperboloid cooling tower venting steam
      g.add(partBox(5.0, 3.0, 4.0, mat(0xd6dad6), -2.4, 1.5, -1.5));                       // reactor hall
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.0, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc6ccc8, { metalness: 0.3 }));
      dome.position.set(-2.4, 3.0, -1.5); g.add(dome);                                     // containment dome
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.0, 8.0, 24, 1, true), toon(0xcfd3d2, { side: THREE.DoubleSide }));
      tower.position.set(2.8, 4.0, 1.2); g.add(tower);                                     // cooling tower
      const steam = new THREE.Mesh(new THREE.SphereGeometry(2.0, 12, 8), mat(0xffffff, { transparent: true, opacity: 0.5 }));
      steam.position.set(2.8, 8.4, 1.2); g.add(steam);                                     // steam plume
      g.add(partBox(1.2, 0.5, 0.1, mat(0xf6c945, {}, 1.2), -2.4, 0.7, 0.55));              // ⚠ trefoil-yellow sign
    } else if (key === 'gas_power') {
      // combined-cycle: a long turbine hall, a tall HRSG exhaust stack and gas tanks
      g.add(partBox(8.5, 3.4, 4.0, mat(0xb9c2c8), -0.3, 1.7, -1.4));                        // turbine hall
      g.add(partBox(8.6, 0.5, 4.1, mat(col), -0.3, 3.55, -1.4));                            // roofline band
      g.add(cyl(0.7, 0.8, 12, 0xcfd2d4, 3.6, 6, 0.6)); g.add(cyl(0.8, 0.8, 0.7, 0xb24a2a, 3.6, 12.2, 0.6)); // stack
      for (const dx of [-2.0, 0.4]) { const t = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), mat(0xeef0f1, { metalness: 0.3 })); t.position.set(dx, 1.3, 3.0); g.add(t); } // spherical gas tanks
    } else if (key === 'waste_energy') {
      // incineration plant: a bulky refuse bunker + boiler block with one tall chimney
      g.add(partBox(6.5, 5.0, 5.0, mat(0x9aa67e), -1.0, 2.5, -1.0));                        // boiler/bunker block
      g.add(partBox(3.2, 3.0, 3.4, mat(0xb7bf9a), 3.0, 1.5, 1.4));                          // tipping hall
      g.add(cyl(0.7, 0.85, 14, 0xd8d2c2, -2.6, 7, -2.4)); g.add(cyl(0.85, 0.85, 0.7, 0x9a3f2a, -2.6, 14.2, -2.4)); // chimney
      g.add(partBox(0.9, 0.9, 0.1, mat(0x7d8a5c), 3.0, 1.6, 3.15));                          // ♻ panel
    } else {
      g.add(partBox(8, 4.5, 6, mat(col), 0, 2.25, -0.5));
      const stacks = key === 'power_station' ? 2 : 1;
      for (let i = 0; i < stacks; i++) {
        const x = i * 3 - (stacks - 1) * 1.5;
        g.add(cyl(0.9, 1.1, 11, 0xc8cacc, x, 5.5, 2.5));
        g.add(cyl(1.1, 1.1, 0.8, 0xa0531f, x, 11.2, 2.5));
      }
      if (key === 'power_station') g.add(cyl(2.4, 3.0, 6, 0xd3d6d8, 3, 3, -2.4));
    }
  } else if (cat === 'water') {
    lawn(g, 9, 9, 0x7da77a);
    if (key === 'reservoir') {
      const water = new THREE.Mesh(new THREE.CircleGeometry(4.2, 22), mat(0x2f86c4, { metalness: 0.3, roughness: 0.15 }));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.12; g.add(water);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.45, 8, 26), mat(0x6f8f55));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.4; g.add(rim);
      g.add(partBox(0.5, 0.5, 3, mat(0x8a6f4a), 4, 0.4, 0));
    } else if (key === 'reservoir_big') {
      // The big blue LAKE is the dominant, clearly-visible feature: a brim-full pool
      // on a low grassy mound (so it never sinks into the terrain), with a dam wall
      // ridge along the front edge that stays BELOW eye-line so it doesn't hide the water.
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 6.7, 1.3, 30), mat(0x7e9657));
      mound.position.y = 0.65; g.add(mound);
      const water = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32), mat(0x2f86c4, { metalness: 0.3, roughness: 0.12 }));
      water.rotation.x = -Math.PI / 2; water.position.y = 1.32; g.add(water);             // brim-full lake (the main feature)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.26, 8, 32), mat(0x8a8f6a));
      rim.rotation.x = Math.PI / 2; rim.position.y = 1.30; g.add(rim);                     // grassy retaining rim
      g.add(partBox(8.8, 1.7, 0.7, mat(0xc3bb9e), 0, 0.85, 5.7));                          // dam wall on the south edge
      g.add(partBox(8.8, 0.32, 0.95, mat(0xd8d2bc), 0, 1.86, 5.7));                        // crest road on the dam
      for (let dx = -3.8; dx <= 3.8; dx += 1.5) g.add(partBox(0.16, 0.6, 0.16, mat(0x8a8f95), dx, 2.16, 5.5)); // railings
      g.add(partBox(1.9, 2.0, 1.4, mat(0x9aa6ad), -4.3, 1.0, 5.4));                        // gatehouse / pump station
      g.add(cyl(0.85, 0.95, 2.0, 0xc9cfd2, 3.3, 1.4, 3.0));                                // outlet tower in the lake
    } else {
      g.add(partBox(6, 2.6, 4, mat(0x9aa6ad), -1.5, 1.3, -1.5));
      const tanks = key === 'desal' ? 3 : 2;
      for (let i = 0; i < tanks; i++) g.add(cyl(1.5, 1.5, 4.5, col, i * 3.2 - (tanks - 1) * 1.6, 2.25, 1.6));
      const pipe = cyl(0.25, 0.25, 6, 0x6f757b, 0, 0.6, 1.6); pipe.rotation.z = Math.PI / 2; g.add(pipe);
    }
  } else if (cat === 'industry') {
    if (key === 'office') {
      lawn(g, 9, 9, 0x86a6a0);
      g.add(tower(4.2, 24, 4.2, 'office', -1.6, -0.8));
      g.add(tower(3.4, rnd(16, 20), 3.4, 'glass', 1.8, 1.2, { metalness: 0.6 }));
      roofKit(g, -1.6, -0.8, 4.2, 4.2, 24);
      g.add(cyl(0.12, 0.12, 3, 0xdddddd, -1.6, 25.6, -0.8));
      g.add(partBox(7, 2, 4, mat(0x9fb0bd), 0, 1, 2.4));
    } else if (key === 'port') {
      g.add(partBox(9, 0.8, 9, mat(0x7a8893), 0, 0.4, 0));
      for (const cx of [-2.6, 2.6]) {
        g.add(partBox(0.5, 13, 0.5, mat(0xf2b134), cx, 6.5, -2));
        g.add(partBox(0.5, 13, 0.5, mat(0xf2b134), cx + 1.4, 6.5, -2));
        g.add(partBox(0.5, 0.6, 8, mat(0xf2b134), cx + 0.7, 12.6, 1));
        g.add(partBox(1.2, 1.4, 1.4, mat(0x33414d), cx + 0.7, 11.4, 3.8));
      }
      const cc = [0xd84141, 0x3f7fd8, 0x4caf50, 0xf2b134, 0xe06c2a];
      for (let i = 0; i < 8; i++) g.add(partBox(1.9, 1.5, 3.6, mat(cc[i % cc.length]), -3 + (i % 3) * 2, 0.8 + Math.floor(i / 3) * 1.5, 3));
    } else if (key === 'tourism') {
      lawn(g, 9, 9, 0x86a6a0);
      g.add(partBox(8, 2.4, 6, mat(0xcaa977), 0, 1.2, 0));
      for (const dx of [-2.4, 0, 2.4]) g.add(tower(2.2, rnd(12, 17), 4.2, 'hotel', dx, -0.4));
      g.add(partBox(7.5, 1.4, 2, mat(0xb6965f), 0, 17.6, -0.4));
      for (let i = -3; i <= 3; i += 1.5) treeAt(g, i, -0.4, 0.4);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), mat(0x49b6e0, { roughness: 0.15, metalness: 0.4 })); pool.rotation.x = -Math.PI / 2; pool.position.set(0, 18.4, -0.4); g.add(pool);
    } else if (key === 'mall') {
      lawn(g, 9.4, 9.4, 0x9fb0a8);
      const body = tint != null ? { tint } : undefined;
      g.add(partBox(9, 6.5, 8, mat(col), 0, 3.25, 0));                          // retail mass
      g.add(tower(8.6, 3.0, 7.6, 'glass', 0, 0.2, body));                       // glazed frontage band
      const atrium = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xbfe6f5, { opacity: 0.85, transparent: true }));
      atrium.position.set(0, 6.4, 0); g.add(atrium);                            // glass dome atrium
      g.add(partBox(5.5, 1.0, 0.4, mat(0xef5a7a), 0, 5.2, 4.05));               // signage
      g.add(partBox(3.2, 2.6, 0.6, mat(0x2b3b48), 0, 1.3, 4.0));               // entrance
      for (const x of [-2.6, 2.6]) g.add(cyl(0.7, 0.7, 0.5, 0x3a3f45, x, 6.8, 0)); // rooftop a/c
      treeAt(g, -3.6, 3.6, 0.8); treeAt(g, 3.6, 3.6, 0.8);
    } else {
      lawn(g, 9, 9, 0x9a9f7a);
      g.add(partBox(8, 4, 5.5, mat(col), 0, 2, -0.8));
      for (let i = -2.6; i <= 2.6; i += 1.7) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 5.5), mat(0x8a6f55)); s.position.set(i, 4.5, -0.8); s.rotation.z = 0.5; s.castShadow = true; g.add(s);
      }
      g.add(cyl(0.8, 1, 8, 0xb6b6b6, 2.8, 4, 2.4));
      g.add(cyl(1.4, 1.4, 3, 0xc9cfd2, -3, 1.5, 2.6));
    }
  } else if (cat === 'civic' || cat === 'roads') {   // 'roads' = Transport: MRT/train stations & viaduct spans share the civic builders
    if (key === 'colonial') {
      lawn(g, 9, 9, 0x6fb15a);
      const cream = 0xefe7d4, roofc = 0xa6553a;
      g.add(partBox(8.2, 4.6, 4.4, mat(cream), 0, 2.3, -0.7));                    // two-storey symmetric body
      const band = tower(8.0, 2.0, 4.3, 'hotel', 0, -0.7); band.position.y = 1.4; g.add(band); // arched window band
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.7, 1.4, 4), mat(roofc));
      roof.position.set(0, 5.3, -0.7); roof.rotation.y = Math.PI / 4; roof.scale.z = 0.62; roof.castShadow = true; g.add(roof);
      for (let i = -3; i <= 3; i += 1.2) g.add(cyl(0.2, 0.22, 3.4, 0xf4efe2, i, 1.7, 2.5)); // portico columns
      g.add(partBox(7.2, 0.5, 1.2, mat(0xe6ddc8), 0, 3.65, 2.5));                 // entablature
      g.add(partBox(1.8, 3.2, 1.8, mat(cream), 0, 6.7, -0.7));                    // clock tower
      g.add(partBox(1.4, 1.0, 0.08, mat(0x2b2b2b), 0, 7.5, 0.24));               // clock face
      g.add(partBox(0.9, 0.1, 0.1, mat(0xe6ddc8), 0, 7.5, 0.3));                 // clock hands
      g.add(partBox(0.1, 0.6, 0.1, mat(0xe6ddc8), 0, 7.5, 0.3));
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5a7d4a));
      dome.position.set(0, 8.2, -0.7); dome.castShadow = true; g.add(dome);
      g.add(cyl(0.04, 0.04, 1.0, 0xd8c98a, 0, 9.0, -0.7));                        // flagpole
    } else if (key === 'hospital') {
      lawn(g, 9, 9, 0x86a6a0);
      g.add(tower(6.5, 9, 4, 'glass', 0, -0.6, { color: 0xf4f6f7 }));
      g.add(partBox(3, 5, 3, mat(0xeef1f3), -3.4, 2.5, 1.6));
      g.add(partBox(3, 5, 3, mat(0xeef1f3), 3.4, 2.5, 1.6));
      g.add(partBox(1.5, 4.4, 0.4, mat(0xe23744), 0, 6.6, 1.45));
      g.add(partBox(4.4, 1.5, 0.4, mat(0xe23744), 0, 6.6, 1.45));
      const heli = new THREE.Mesh(new THREE.CircleGeometry(2.3, 18), mat(0x6a7078)); heli.rotation.x = -Math.PI / 2; heli.position.set(0, 9.1, -0.6); g.add(heli);
    } else if (key === 'mrt') {
      // an elevated MRT STATION: a ground-level entrance, piers, and an enclosed
      // concourse hall with a curved roof + signboard (clearly a station building).
      lawn(g, 9, 9);
      g.add(partBox(3.4, 2.4, 3.2, mat(0xeceee9), 0, 1.2, 3.0));                       // ground entrance pavilion
      g.add(partBox(1.6, 1.9, 0.25, mat(0x2b3b48), 0, 0.95, 4.65));                    // doorway
      for (const px of [-3.6, 0, 3.6]) g.add(cyl(0.6, 0.78, 5.6, 0xc4c8cc, px, 2.8, -1)); // piers
      const hy = 6.3;
      g.add(partBox(9.6, 2.7, 4.4, mat(0xe5ecf0), 0, hy + 1.35, -1));                  // enclosed concourse hall
      g.add(partBox(9.7, 0.7, 4.2, mat(0x35586a), 0, hy + 1.25, -1));                  // window band
      g.add(partBox(10.2, 0.45, 5.0, mat(0x9fb6c4, { metalness: 0.3 }), 0, hy + 2.95, -1)); // flat metal station roof (overhangs)
      g.add(partBox(9.0, 0.5, 0.5, mat(col), 0, hy + 3.3, -1));                        // coloured roof ridge cap
      g.add(partBox(2.8, 0.95, 0.16, mat(0xe23744), 0, hy + 0.5, 1.25));              // red "MRT" signboard
    } else if (key === 'rail_station') {
      // an old-school 1965 railway station: a cream colonial booking hall with a
      // clock tower, a long platform under a pitched canopy, and a train waiting.
      lawn(g, 9, 9, 0x9aae8a);
      g.add(partBox(4.6, 3.4, 3.4, mat(0xeae0c8), -2.0, 1.7, 1.2));              // booking hall (colonial cream)
      g.add(partBox(4.7, 0.5, 3.5, mat(0xb8624a), -2.0, 3.55, 1.2));            // cornice
      for (const wx of [-3.5, -2.0, -0.5]) g.add(partBox(0.7, 1.3, 0.12, mat(0x3a5566), wx, 1.7, 2.95)); // arched windows
      g.add(partBox(1.5, 5.4, 1.5, mat(0xe6dcc2), -4.1, 2.7, 0.4));             // clock tower shaft
      g.add(partBox(1.7, 0.6, 1.7, mat(0xb8624a), -4.1, 5.5, 0.4));             // tower cap
      g.add(partBox(0.9, 0.9, 0.1, mat(0xf7f2e2, {}, 1.2), -4.1, 4.9, 1.28));   // clock face (faint glow)
      g.add(partBox(0.9, 0.1, 0.9, mat(0x6b4a2a), -4.1, 6.0, 0.4));             // tower roof finial slab
      // long platform + pitched canopy on posts
      g.add(partBox(8.6, 0.4, 2.2, mat(0xcfc6b2), 1.0, 0.4, -2.4));             // raised platform
      for (const px of [-2.6, 0.2, 3.0]) g.add(cyl(0.12, 0.12, 2.6, 0x5a6066, px, 1.3, -3.2)); // canopy posts
      const canopy = partBox(8.8, 0.2, 2.8, mat(0x7a8085), 1.0, 2.7, -2.8); canopy.rotation.x = -0.12; g.add(canopy); // pitched canopy
      g.add(partBox(8.8, 0.3, 0.3, mat(0x5a3a22), 1.0, 2.55, -1.45));           // canopy front beam
      // a waiting train at the platform
      g.add(partBox(7.6, 1.7, 1.5, mat(0x2c5aa0), 1.2, 1.55, -2.4));            // coaches
      g.add(partBox(7.65, 0.55, 1.1, mat(0xf2e6c8, {}, 0.9), 1.2, 1.75, -2.4)); // cream window band
      g.add(partBox(7.6, 0.18, 1.55, mat(0xe8e2d2), 1.2, 2.45, -2.4));          // roof
    } else if (key === 'street_lamp') {
      // a single street lamp (sized so ×MODEL_SCALE matches the auto road lamps) —
      // a slim post with an arm and a warm head that GLOWS after dark.
      g.add(cyl(0.22, 0.3, 9.2, mat(0x3e444b), 0, 4.6, 0));                      // post
      g.add(partBox(0.24, 0.24, 2.0, mat(0x3e444b), 0, 8.9, 1.0));              // arm reaching out
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), mat(0xfff0b8, {}, 1.9));
      lamp.position.set(0, 8.8, 1.95); g.add(lamp);                            // glowing head
    } else if (key === 'traffic_light') {
      // a three-aspect signal on a post; the green aspect glows after dark
      g.add(cyl(0.3, 0.38, 8.6, mat(0x33373d), 0, 4.3, 0));                      // post
      g.add(partBox(0.5, 0.5, 1.4, mat(0x2a2e34), 0, 8.1, 0.55));               // arm bracket
      g.add(partBox(1.2, 3.3, 1.0, mat(0x20232a), 0, 8.1, 1.2));                // signal housing
      const aspects = [[0xe23b2e, 9.3, 0.3], [0xf3c41a, 8.1, 0.3], [0x2ecc71, 6.9, 1.4]]; // red, amber, green(lit)
      for (const [c, y, gk] of aspects) {
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(c, {}, gk));
        lens.position.set(0, y, 1.72); g.add(lens);
      }
    } else if (key === 'school') {
      lawn(g, 9, 9, 0x6fb15a);
      g.add(partBox(7, 3.6, 3, mat(col), 0, 1.8, -2.2));
      g.add(partBox(3, 3.4, 4.5, mat(0xf0ead8), -3.5, 1.7, 1));
      const field = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), mat(0x4f9e3f)); field.rotation.x = -Math.PI / 2; field.position.set(1.6, 0.05, 1.8); g.add(field);
      g.add(cyl(0.12, 0.12, 6, 0xcfd3d6, 3.4, 3, -2.2));
      g.add(partBox(1.8, 1.1, 0.08, mat(0xe23744), 4.25, 5.4, -2.2));
    } else {
      lawn(g, 9, 9);
      g.add(partBox(6, 4, 5, mat(col), 0, 2, 0));
      g.add(tower(2.4, 7, 2.4, 'office', 2.4, -1, { color: 0x4a5b8a }));
      g.add(cyl(0.5, 0.5, 0.8, 0x2a44dd, -1.5, 4.4, 1.8));
    }
  } else if (cat === 'green') {
    lawn(g, 9.4, 9.4, key === 'gardens' ? 0x4f9e3a : key === 'forest' ? 0x35702f : 0x66bd5a);
    if (key === 'forest') {
      const spots = [[-3, -3, 1.5], [-1, -3.4, 1.2], [1.2, -2.8, 1.6], [3.2, -3.2, 1.3], [-3.4, -0.6, 1.7],
        [-1.2, -0.4, 1.3], [1, -0.8, 1.5], [3.2, -0.4, 1.4], [-2.6, 2.4, 1.6], [-0.4, 2.8, 1.3],
        [1.8, 2.4, 1.7], [3.4, 2.6, 1.2], [0, 0.8, 1.8]];
      for (const [dx, dz, s] of spots) {
        g.add(cyl(0.22 * s, 0.3 * s, 1.6 * s, 0x6b4f2a, dx, 0.8 * s, dz));
        const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.3 * s, 2.6 * s, 8), mat(0x2f7d3a)); c1.position.set(dx, 2.4 * s, dz); c1.castShadow = true; g.add(c1);
        const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.0 * s, 1.9 * s, 8), mat(0x3c9249)); c2.position.set(dx, 3.2 * s, dz); g.add(c2);
      }
    } else if (key === 'gardens') {
      for (const [dx, dz, h, c] of [[-2.4, -1.4, 13, 0x9b4fa0], [2, 1, 17, 0x6a3d9a], [0.4, 3, 11, 0xc06cc0], [3, -2.4, 9, 0x7e4fae]]) {
        g.add(cyl(0.5, 0.8, h, 0x6b4f2a, dx, h / 2, dz));
        const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.6, 9), mat(c)); top.position.set(dx, h + 0.6, dz); top.castShadow = true; g.add(top);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xbfe6c8, { metalness: 0.3, roughness: 0.2, transparent: true, opacity: 0.85 }));
      dome.position.set(-2.6, 0.1, 2.6); g.add(dome);
    } else {
      const pond = new THREE.Mesh(new THREE.CircleGeometry(1.8, 18), mat(0x49b6e0, { roughness: 0.2 })); pond.rotation.x = -Math.PI / 2; pond.position.set(1.6, 0.06, -1.4); g.add(pond);
      for (const [dx, dz, s] of [[-2.6, -1.6, 1.2], [2.2, 1.8, 1.0], [-1, 2.4, 0.9], [-3, 1.5, 0.8], [2.8, -2.6, 1.1]]) treeAt(g, dx, dz, s);
    }
  } else if (cat === 'leisure') {
    if (key === 'cinema') {
      lawn(g, 9, 9, 0x9a9078);
      g.add(partBox(7.5, 5.5, 6, mat(col), 0, 2.75, 0));                   // movie-palace hall
      g.add(partBox(8.2, 1.4, 1.2, mat(0xf4e3b0), 0, 5.0, 3.2));           // marquee canopy
      g.add(partBox(7.6, 1.0, 0.2, mat(0xc0392b), 0, 6.0, 0));             // vertical name sign
      for (const x of [-2.4, 0, 2.4]) g.add(cyl(0.22, 0.22, 2.4, 0xe9c34a, x, 1.2, 3.3)); // lit columns
    } else if (key === 'stadium') {
      lawn(g, 9.4, 9.4, 0x4f9e3f);                                         // pitch
      for (const s of [-1, 1]) {                                           // two curved grandstands
        const stand = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.6, 2.4), mat(col));
        stand.position.set(0, 1.5, s * 3.2); stand.rotation.x = s * -0.18; g.add(stand);
        g.add(partBox(9, 0.4, 2.8, mat(0xcfd3d6), 0, 3.2, s * 3.2));       // roof
      }
      for (const x of [-4, 4]) g.add(cyl(0.12, 0.12, 6, 0xcfd3d6, x, 3, 0)); // floodlight masts
    } else if (key === 'beach') {
      // back half grass, front half sand sloping to a shallow-water strip
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 4.4), mat(0x66bd5a)); grass.rotation.x = -Math.PI / 2; grass.position.set(0, 0.05, -2.5); g.add(grass);
      g.add(partBox(9.4, 0.2, 5.4, mat(0xeacf93), 0, 0.1, 1.6));            // sand
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.8), mat(0x49b6e0, { transparent: true, opacity: 0.85 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.12, 4.2); g.add(sea);
      for (const [dx, dz] of [[-3.4, -2.6], [3.2, -3], [-2, -3.2]]) { // palms
        g.add(cyl(0.16, 0.2, 2.6, 0x8a6b43, dx, 1.3, dz));
        const fr = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6), mat(0x3fae57)); fr.position.set(dx, 2.7, dz); fr.scale.y = 0.6; g.add(fr);
      }
      const para = [0xef5a5a, 0xf2c94c, 0x4aa3df];
      for (let i = 0; i < 3; i++) { const px = -2.6 + i * 2.6;
        g.add(cyl(0.05, 0.05, 1.2, 0xcccccc, px, 0.6, 1.4));
        const u = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.5, 10), mat(para[i])); u.position.set(px, 1.3, 1.4); g.add(u);
        g.add(partBox(0.9, 0.08, 1.7, mat(0xf2efe6), px, 0.18, 2.6)); // towel
      }
    } else if (key === 'ferry_terminal') {
      g.add(partBox(9.4, 0.2, 4.4, mat(0xeacf93), 0, 0.1, -2.6));           // shore
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 5.2), mat(0x3a9fd6, { transparent: true, opacity: 0.9 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.1, 2.4); g.add(sea);
      g.add(partBox(6.5, 3.4, 3.4, mat(col), 0, 1.9, -2.4));               // terminal hall
      g.add(tower(6.2, 1.6, 3.2, 'glass', 0, -2.4)); g.children[g.children.length - 1].position.y = 1.0;
      g.add(partBox(7.2, 0.3, 0.4, mat(0xef5a7a), 0, 3.4, -0.7));          // sign
      g.add(partBox(2.6, 0.4, 5.5, mat(0x9c7a4d), 0, 0.45, 1.6));          // jetty
      for (const z of [0.2, 2.4, 4.2]) { g.add(cyl(0.12, 0.12, 1.2, 0x5b4632, -1.2, 0.3, z)); g.add(cyl(0.12, 0.12, 1.2, 0x5b4632, 1.2, 0.3, z)); }
      // docked ferry
      g.add(partBox(2.4, 1.1, 4.6, mat(0xf2f2f2), 2.9, 0.75, 3.2));
      g.add(partBox(1.9, 0.9, 2.2, mat(0x3a6ea5), 2.9, 1.5, 2.6));
    } else if (key === 'marina') {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 9.4), mat(0x3a9fd6, { transparent: true, opacity: 0.9 })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.08, 0); g.add(sea);
      g.add(partBox(9.4, 0.2, 3, mat(0xd9cdb0), 0, 0.12, -3.2));           // promenade
      g.add(partBox(2.6, 1.4, 2.2, mat(col), -3, 0.8, -3));               // yacht club
      // pontoons + yachts
      for (const bx of [-2.6, 0, 2.6]) {
        g.add(partBox(0.6, 0.25, 5.5, mat(0xb9a884), bx, 0.3, 0.6));      // pontoon
      }
      const hulls = [0xffffff, 0xf2f2f2, 0xe8eef2];
      for (let i = 0; i < 5; i++) {
        const bx = -2 + (i % 3) * 2, bz = -1.2 + Math.floor(i / 3) * 2.6;
        g.add(partBox(1.0, 0.6, 3.0, mat(hulls[i % 3]), bx, 0.5, bz));    // hull
        g.add(partBox(0.7, 0.5, 1.2, mat(0x4a6fa5), bx, 1.0, bz - 0.2));  // cabin
        const mast = cyl(0.04, 0.04, 3.2, 0xdedede, bx, 2.3, bz); g.add(mast);
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4, 1, 1), mat(0xffffff, { side: THREE.DoubleSide }));
        sail.position.set(bx + 0.5, 2.2, bz); sail.rotation.y = Math.PI / 2; g.add(sail);
      }
    } else {
      g.add(box(6, 6, 6, col));
    }
  } else {
    g.add(box(6, 6, 6, col));
  }
  return g;
}

// ===========================================================================
// Vehicles — distinct, recognisable types (car, taxi, motorbike, lorry, bus).
// ===========================================================================
function makeVehicle(kind, gen = 'modern') {
  // gen: 'vintage' (1950s/60s), 'modern' (boxy), 'contemporary' (sleek/EV)
  if (gen === true) gen = 'vintage'; else if (gen === false) gen = 'modern';   // legacy boolean callers
  const vintage = gen === 'vintage';
  const contemporary = gen === 'contemporary';
  const g = new THREE.Group();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const glass = 0x2b3b48, dark = 0x15171c;
  const wheel = (x, z, r = 0.34) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 10), mat(dark));
    w.rotation.z = Math.PI / 2; w.position.set(x, r, z); w.castShadow = true; return w;
  };
  if (kind === 'trishaw') {
    // a cycle-rickshaw: passenger sidecar with a folding hood + a cyclist alongside
    const cc = pick([0x2f7d3a, 0xc0392b, 0x2c3e8f, 0x9c6b1f]);
    g.add(partBox(0.78, 0.9, 1.5, mat(cc), -0.45, 0.62, 0.15));          // passenger cab
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.78, 10, 1, false, 0, Math.PI), mat(0x1b1b1b));
    hood.rotation.z = Math.PI / 2; hood.position.set(-0.45, 1.1, -0.25); hood.castShadow = true; g.add(hood); // folding hood
    g.add(partBox(0.16, 0.45, 1.4, mat(0x333a44), 0.42, 0.62, -0.1));    // bicycle frame
    g.add(partBox(0.3, 0.55, 0.3, mat(0x2b2f36), 0.42, 1.2, -0.55));     // rider
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(0xcaa07a)); head.position.set(0.42, 1.6, -0.55); g.add(head);
    g.add(wheel(0.42, -0.85, 0.32));                                     // front wheel
    g.add(wheel(-0.45, 0.7, 0.32)); g.add(wheel(0.42, 0.7, 0.32));       // rear axle
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return { mesh: g, len: 1.9 };
  }
  if (kind === 'bus') {
    if (vintage) {
      // 1960s single-deck bus: cream body with a coloured waistline stripe, rounded
      g.add(partBox(2.0, 1.9, 6.2, mat(0xe9e2cf), 0, 1.15, 0));
      g.add(partBox(2.04, 0.34, 6.2, mat(pick([0x2f7d3a, 0xc0392b, 0x2c5aa0])), 0, 1.62, 0)); // stripe
      g.add(partBox(2.06, 0.5, 4.8, mat(glass), 0, 1.55, -0.3));
      g.add(partBox(0.3, 0.2, 0.08, mat(0xfff6cf, {}, 1.6), 0.7, 0.7, 3.12));
      g.add(partBox(0.3, 0.2, 0.08, mat(0xfff6cf, {}, 1.6), -0.7, 0.7, 3.12));
      for (const z of [-2.2, 2.2]) { g.add(wheel(-0.96, z, 0.46)); g.add(wheel(0.96, z, 0.46)); }
      return { mesh: g, len: 6.2 };
    }
    const col = pick([0xd23b3b, 0xffffff, 0x2f9e54, 0xf0a93b]);
    g.add(partBox(2.0, 1.7, 6.6, mat(col), 0, 1.05, 0));
    g.add(partBox(2.04, 0.55, 5.4, mat(glass), 0, 1.45, 0));
    g.add(partBox(0.3, 0.2, 0.08, mat(0xfff6cf, {}, 1.6), 0.7, 0.6, 3.32));
    g.add(partBox(0.3, 0.2, 0.08, mat(0xfff6cf, {}, 1.6), -0.7, 0.6, 3.32));
    for (const z of [-2.3, 2.3]) { g.add(wheel(-0.96, z, 0.45)); g.add(wheel(0.96, z, 0.45)); }
    return { mesh: g, len: 6.6 };
  }
  if (kind === 'lorry') {
    const col = pick([0x4a6fa5, 0xc0392b, 0x6b7a86]);
    g.add(partBox(1.8, 1.5, 1.8, mat(col), 0, 0.95, 1.7));        // cab
    g.add(partBox(1.84, 0.5, 1.2, mat(glass), 0, 1.35, 2.2));
    g.add(partBox(1.9, 1.9, 3.6, mat(0xb9b2a3), 0, 1.15, -0.7));  // cargo box
    g.add(partBox(0.28, 0.18, 0.08, mat(0xfff6cf, {}, 1.6), 0.62, 0.5, 2.62));
    g.add(partBox(0.28, 0.18, 0.08, mat(0xfff6cf, {}, 1.6), -0.62, 0.5, 2.62));
    for (const z of [1.9, -0.6, -2.0]) { g.add(wheel(-0.9, z, 0.4)); g.add(wheel(0.9, z, 0.4)); }
    return { mesh: g, len: 5.6 };
  }
  if (kind === 'bike') {
    const col = pick([0xe74c3c, 0x2c3e50, 0xf0a93b]);
    g.add(partBox(0.4, 0.45, 1.5, mat(col), 0, 0.7, 0));
    g.add(wheel(0, 0.7, 0.32)); g.add(wheel(0, -0.7, 0.32));
    g.add(partBox(0.42, 0.6, 0.4, mat(0x333a44), 0, 1.3, -0.1));   // rider torso
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(0x111317)); h.position.set(0, 1.78, -0.1); g.add(h); // helmet
    return { mesh: g, len: 1.7 };
  }
  // car / taxi
  if (vintage) {
    // 1950s/60s sedan: domed cabin, running boards, rounded nose, two-tone for taxis
    const body = kind === 'taxi' ? 0x111317 : pick([0x3a3f45, 0x6b3a2f, 0x2e4636, 0x7a6f55, 0x4a4e57, 0x6e2e2e]);
    g.add(partBox(1.5, 0.62, 3.3, mat(body), 0, 0.6, 0));                              // body
    g.add(partBox(1.32, 0.66, 1.5, mat(kind === 'taxi' ? 0xe8e2d2 : body), 0, 1.14, -0.15)); // domed cabin (cream roof for taxis)
    g.add(partBox(1.35, 0.42, 1.25, mat(glass), 0, 1.2, -0.15));
    for (const sx of [-0.82, 0.82]) g.add(partBox(0.18, 0.12, 2.6, mat(0x14161a), sx, 0.4, 0)); // running boards
    g.add(partBox(0.7, 0.4, 0.5, mat(body), 0, 0.55, 1.62));                           // rounded nose
    g.add(partBox(0.5, 0.32, 0.12, mat(0x20242b), 0, 0.6, 1.86));                       // grille
    g.add(partBox(0.22, 0.2, 0.1, mat(0xfff6cf, {}, 1.8), 0.56, 0.62, 1.78));           // round headlights
    g.add(partBox(0.22, 0.2, 0.1, mat(0xfff6cf, {}, 1.8), -0.56, 0.62, 1.78));
    g.add(partBox(0.22, 0.16, 0.08, mat(0xe23b2e, {}, 1.6), 0.5, 0.6, -1.66));          // taillights
    g.add(partBox(0.22, 0.16, 0.08, mat(0xe23b2e, {}, 1.6), -0.5, 0.6, -1.66));
    for (const z of [1.15, -1.15]) { g.add(wheel(-0.78, z, 0.38)); g.add(wheel(0.78, z, 0.38)); }
    if (kind === 'taxi') g.add(partBox(0.4, 0.22, 0.28, mat(0x1d2733), 0, 1.5, -0.15));  // roof sign
    return { mesh: g, len: 3.3 };
  }
  // contemporary cars are sleeker and brighter (hatchbacks / hybrids / EVs)
  const col = kind === 'taxi' ? 0xf4c20a
    : contemporary ? pick([0xffffff, 0xeef1f4, 0x2c3742, 0x3aa0d6, 0xc0392b, 0x4a4f57])
    : pick([0xd94f4f, 0xffffff, 0x3f7fd8, 0x2e8b57, 0x6b7280, 0x8e44ad]);
  if (contemporary) {
    g.add(partBox(1.5, 0.62, 3.25, mat(col), 0, 0.5, 0));                       // low one-box body
    g.add(partBox(1.42, 0.6, 2.5, mat(col), 0, 1.0, -0.05));                    // rounded cabin (long glasshouse)
    g.add(partBox(1.45, 0.5, 2.3, mat(glass, {}, 0.6), 0, 1.0, -0.05));          // wraparound glazing
    g.add(partBox(0.5, 0.1, 0.06, mat(0xeaf2ff, {}, 1.6), 0.0, 0.62, 1.62));     // LED light bar
    g.add(partBox(0.7, 0.08, 0.05, mat(0xe23b2e, {}, 1.5), 0, 0.62, -1.6));      // full-width tail bar
  } else {
    g.add(partBox(1.55, 0.55, 3.2, mat(col), 0, 0.55, 0));
    g.add(partBox(1.4, 0.5, 1.7, mat(col), 0, 1.0, -0.1));
    g.add(partBox(1.43, 0.42, 1.5, mat(glass), 0, 1.02, -0.1));
    g.add(partBox(0.24, 0.16, 0.08, mat(0xfff6cf, {}, 1.8), 0.52, 0.5, 1.62));   // headlights (glow at night)
    g.add(partBox(0.24, 0.16, 0.08, mat(0xfff6cf, {}, 1.8), -0.52, 0.5, 1.62));
    g.add(partBox(0.24, 0.14, 0.08, mat(0xe23b2e, {}, 1.6), 0.52, 0.5, -1.62));  // taillights
    g.add(partBox(0.24, 0.14, 0.08, mat(0xe23b2e, {}, 1.6), -0.52, 0.5, -1.62));
  }
  for (const z of [1.05, -1.05]) { g.add(wheel(-0.78, z)); g.add(wheel(0.78, z)); }
  if (kind === 'taxi') g.add(partBox(0.5, 0.26, 0.32, mat(0x1d2733), 0, 1.4, -0.1)); // roof sign
  return { mesh: g, len: 3.2 };
}

// ===========================================================================
// Trains — articulated rolling stock that runs along the rails & MRT viaducts.
// Each car is an independent Group (nose toward +Z) so the renderer can place
// them one behind another along a curved track. The kind follows the era:
// steam (≤1971) → diesel (≤2004) → modern, plus the sleek silver MRT metro.
// Returns { cars:[Group…], carLen } with carLen already at world scale.
// ===========================================================================
function makeTrain(era, carCount = 3) {
  const cars = [];
  const VS = 0.6;                          // match the road-vehicle scale
  const glass = 0x2b3b48;
  const add = (build, s = VS) => { const c = new THREE.Group(); build(c); c.traverse((m) => { if (m.isMesh) m.castShadow = true; }); c.scale.setScalar(s); cars.push(c); };
  let rawLen = 4.4;
  if (era === 'mrt') {
    // A short, slim metro: cars are scaled well below the road-vehicle size so a
    // 2-car set ≈ one station platform in length, and two trains pass on the deck.
    const MS = 0.28;
    rawLen = 4.5;
    for (let i = 0; i < carCount; i++) add((c) => {
      c.add(partBox(1.7, 1.55, 4.3, mat(0xdfe4e8), 0, 0.9, 0));                  // brushed-silver body
      c.add(partBox(1.76, 0.66, 3.7, mat(0x3aa3d8, {}, 1.3), 0, 1.15, 0));       // glowing window strip
      c.add(partBox(1.66, 0.24, 4.3, mat(0x2c6fa0), 0, 1.74, 0));                // roof band
      const nose = (i === 0) ? 1 : (i === carCount - 1) ? -1 : 0;
      if (nose) { c.add(partBox(1.5, 0.7, 0.5, mat(0x20242b), 0, 0.95, 2.15 * nose)); c.add(partBox(0.5, 0.22, 0.1, mat(0xfff2c2, {}, 1.7), 0, 0.7, 2.3 * nose)); }
    }, MS);
    return { cars, carLen: rawLen * MS };
  }
  if (era === 'steam') {
    rawLen = 4.2;
    add((c) => {                                                                  // steam locomotive
      c.add(partBox(1.4, 0.42, 3.6, mat(0x1b1e23), 0, 0.45, -0.3));               // black footplate/chassis
      const boiler = cyl(0.56, 0.56, 3.0, 0x27402f, 0, 1.05, 0.35); boiler.rotation.x = Math.PI / 2; c.add(boiler); // green boiler
      c.add(partBox(1.42, 1.25, 1.3, mat(0x223428), 0, 1.15, -1.45));             // cab
      c.add(cyl(0.17, 0.24, 0.8, 0x111317, 0, 1.78, 1.45));                       // funnel
      c.add(cyl(0.16, 0.16, 0.4, 0x3a3f45, 0, 1.62, 0.2));                        // steam dome
      c.add(partBox(0.5, 0.34, 0.12, mat(0xfff2c2, {}, 1.8), 0, 0.7, 1.92));      // front lamp
    });
    for (let i = 1; i < carCount; i++) add((c) => {                               // teak-brown coaches
      c.add(partBox(1.5, 1.3, 3.8, mat(0x7a3b2a), 0, 0.9, 0));
      c.add(partBox(1.56, 0.52, 3.2, mat(0xf2e6c8, {}, 0.9), 0, 1.1, 0));         // cream window band (faint glow)
      c.add(partBox(1.52, 0.2, 3.8, mat(0x5a2c1f), 0, 1.62, 0));                  // roof
    });
    return { cars, carLen: rawLen * VS };
  }
  // diesel (≤2004) or modern multiple-unit
  const modern = era === 'modern';
  const locoCol = modern ? 0xc23b3b : 0x2c5aa0;
  rawLen = 4.4;
  add((c) => {                                                                    // power car / loco
    c.add(partBox(1.6, 1.6, 4.0, mat(locoCol), 0, 0.95, 0));
    c.add(partBox(1.66, 0.5, 1.5, mat(glass, {}, modern ? 1.0 : 0.0), 0, 1.4, 0.9)); // cab glass
    c.add(partBox(1.62, 0.22, 4.0, mat(0xe8e2d2), 0, 1.82, 0));                   // roof stripe
    c.add(partBox(0.42, 0.3, 0.12, mat(0xfff2c2, {}, 1.7), 0, 0.7, 2.05));        // headlight
  });
  for (let i = 1; i < carCount; i++) add((c) => {                                 // passenger coaches
    c.add(partBox(1.5, 1.5, 3.9, mat(modern ? 0xeceef0 : 0xcdd2d6), 0, 0.9, 0));
    c.add(partBox(1.56, 0.56, 3.3, mat(glass, {}, 0.95), 0, 1.12, 0));            // glowing window band
    c.add(partBox(1.52, 0.2, 3.9, mat(locoCol), 0, 1.62, 0));                     // roof band
  });
  return { cars, carLen: rawLen * VS };
}

// ---- street props & boats -------------------------------------------------
// (street lamps are built in bulk from the road network — see _buildStreetLamps)
function makeBench(rot) {
  const g = new THREE.Group();
  g.add(partBox(1.5, 0.12, 0.5, mat(0x9c7a4d), 0, 0.55, 0));        // seat
  g.add(partBox(1.5, 0.45, 0.1, mat(0x9c7a4d), 0, 0.8, -0.2));      // back
  for (const x of [-0.6, 0.6]) g.add(partBox(0.1, 0.55, 0.45, mat(0x5b5550), x, 0.27, 0));
  g.rotation.y = rot;
  return g;
}
function makeBoat(type) {
  const g = new THREE.Group();
  if (type === 'cargo') {
    g.add(partBox(3.0, 1.4, 9.0, mat(0x37424d), 0, 0, 0));          // hull
    g.add(partBox(2.4, 1.0, 2.0, mat(0xeceff1), 0, 1.1, -3.0));     // bridge
    const cc = [0xd84141, 0x3f7fd8, 0x4caf50, 0xf2b134];
    for (let i = 0; i < 6; i++) g.add(partBox(0.9, 0.8, 1.6, mat(cc[i % 4]), (i % 2 ? 0.7 : -0.7), 1.0, 1.6 - (i >> 1) * 1.7));
  } else if (type === 'bumboat') {
    // tongkang / bumboat: low wooden hull, a cargo-house cabin, painted "eyes" on the bow
    g.add(partBox(1.8, 0.9, 5.4, mat(0x6e4a2c), 0, 0, 0));          // wooden hull
    g.add(partBox(1.92, 0.22, 5.6, mat(0x8a6240), 0, 0.5, 0));      // gunwale rim
    g.add(partBox(1.5, 1.0, 2.2, mat(0xcf6a3a), 0, 0.95, -0.7));    // cabin / cargo house
    g.add(partBox(1.7, 0.12, 2.4, mat(0x35613f), 0, 1.5, -0.7));    // cabin roof
    for (const sx of [0.94, -0.94]) {                              // oculi (painted eyes) on the bow
      g.add(partBox(0.05, 0.34, 0.34, mat(0xffffff), sx, 0.36, 2.2));
      g.add(partBox(0.07, 0.17, 0.17, mat(0x1a1a1a), sx * 1.02, 0.36, 2.2));
    }
  } else { // sampan — a small open boat with a rattan canopy
    g.add(partBox(1.1, 0.6, 3.6, mat(0x8a6b43), 0, 0, 0));
    g.add(partBox(0.98, 0.62, 1.3, mat(0xb5402f), 0, 0.55, -0.3));  // canopy
    g.add(cyl(0.04, 0.04, 1.2, mat(0xcfd3d6), 0, 1.05, 0.4));       // pole
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

// ===========================================================================
// People — distinct silhouettes: man, woman, child, elderly.
// userData.legs are swung while walking.
// ===========================================================================
// Shared geometry (built once, reused by every person) so detail is cheap.
let PGEO = null;
function pgeo() {
  if (PGEO) return PGEO;
  const C = (r, l, rs = 8) => new THREE.CapsuleGeometry(r, l, 4, rs);
  PGEO = {
    hips: C(0.19, 0.14, 12), chest: C(0.205, 0.3, 12),
    thigh: C(0.115, 0.4), shin: C(0.095, 0.38),
    upperArm: C(0.082, 0.3), foreArm: C(0.072, 0.28),
    hand: new THREE.SphereGeometry(0.085, 8, 6),
    foot: new THREE.BoxGeometry(0.16, 0.11, 0.34),
    neck: C(0.066, 0.05, 8),
    head: new THREE.SphereGeometry(0.175, 18, 14),
    eye: new THREE.SphereGeometry(0.026, 6, 5),
    brow: new THREE.BoxGeometry(0.07, 0.018, 0.03),
    hairCap: new THREE.SphereGeometry(0.19, 16, 13, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairLong: new THREE.BoxGeometry(0.27, 0.36, 0.14),
    bun: new THREE.SphereGeometry(0.1, 10, 8),
    cap: new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    capPeak: new THREE.BoxGeometry(0.26, 0.04, 0.18),
    skirt: new THREE.ConeGeometry(0.4, 0.66, 16),
    canopy: new THREE.ConeGeometry(0.55, 0.3, 14),
    stick: new THREE.CylinderGeometry(0.02, 0.02, 0.82, 6),
    cane: new THREE.CylinderGeometry(0.024, 0.024, 1.0, 6),
  };
  return PGEO;
}
function M(geo, material, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return m; }

// A jointed, stylised human: torso → head/arms, hips → legs; limbs bend at
// knee/elbow during the walk cycle. Built at nominal size; scaled per person.
function buildPerson(o) {
  const G = pgeo();
  const g = new THREE.Group();
  const skin = mat(o.skin), shirt = mat(o.shirt), pantsM = mat(o.pants), hairM = mat(o.hairColor), shoe = mat(0x2c2f34);
  const sleeveM = o.shortSleeve ? skin : shirt;
  const hipY = 0.9;

  g.add(M(G.hips, o.dress ? mat(o.dress) : pantsM, 0, hipY, 0));

  const torso = new THREE.Group(); torso.position.y = hipY + 0.05; g.add(torso);
  const chest = M(G.chest, shirt, 0, 0.28, 0); chest.scale.set(1.04, 1, 0.74); torso.add(chest);

  // head
  const headG = new THREE.Group(); headG.position.y = 0.6; torso.add(headG);
  headG.add(M(G.neck, skin, 0, -0.02, 0));
  headG.add(M(G.head, skin, 0, 0.2, 0));
  headG.add(M(G.eye, mat(0x23272e), -0.07, 0.22, 0.155));
  headG.add(M(G.eye, mat(0x23272e), 0.07, 0.22, 0.155));
  headG.add(M(G.brow, hairM, -0.07, 0.27, 0.16));
  headG.add(M(G.brow, hairM, 0.07, 0.27, 0.16));
  if (o.hairStyle !== 'bald') {
    if (o.hairStyle === 'cap') {
      headG.add(M(G.cap, mat(o.capColor || 0xe74c3c), 0, 0.21, 0));
      headG.add(M(G.capPeak, mat(o.capColor || 0xe74c3c), 0, 0.2, 0.18));
    } else {
      headG.add(M(G.hairCap, hairM, 0, 0.22, 0));
      if (o.hairStyle === 'long') headG.add(M(G.hairLong, hairM, 0, 0.1, -0.13));
      if (o.hairStyle === 'bun') headG.add(M(G.bun, hairM, 0, 0.4, -0.04));
    }
  }

  // arms (upper pivots at shoulder, lower at elbow)
  const upperArms = [], lowerArms = [];
  for (const sx of [-1, 1]) {
    const up = new THREE.Group(); up.position.set(sx * 0.27, 0.48, 0); torso.add(up); upperArms.push(up);
    up.add(M(G.upperArm, sleeveM, 0, -0.16, 0));
    const low = new THREE.Group(); low.position.y = -0.32; up.add(low); lowerArms.push(low);
    low.add(M(G.foreArm, skin, 0, -0.15, 0));
    low.add(M(G.hand, skin, 0, -0.31, 0));
  }

  // legs (upper pivots at hip, lower at knee) with shoes
  const upperLegs = [], lowerLegs = [];
  for (const sx of [-1, 1]) {
    const up = new THREE.Group(); up.position.set(sx * 0.12, hipY - 0.04, 0); g.add(up); upperLegs.push(up);
    up.add(M(G.thigh, o.shorts ? skin : pantsM, 0, -0.21, 0));
    const low = new THREE.Group(); low.position.y = -0.42; up.add(low); lowerLegs.push(low);
    low.add(M(G.shin, o.shorts ? skin : pantsM, 0, -0.19, 0));
    low.add(M(G.foot, shoe, 0, -0.36, 0.08));
  }

  if (o.dress) { const sk = M(G.skirt, mat(o.dress), 0, hipY - 0.1, 0); sk.scale.set(0.86, 1, 0.86); g.add(sk); }
  if (o.cane) g.add(M(G.cane, mat(0x6b4f2a), 0.34, hipY - 0.5, 0.16));
  if (o.lean) torso.rotation.x = o.lean;

  const umb = new THREE.Group();
  umb.add(M(G.canopy, mat(o.umb), 0, hipY + 1.04, 0));
  umb.add(M(G.stick, mat(0x33373d), 0.1, hipY + 0.66, 0.04));
  umb.visible = false; g.add(umb);

  g.scale.setScalar(o.scale);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
  g.userData = { upperLegs, lowerLegs, upperArms, lowerArms, torso, umbrella: umb };
  return g;
}
function makePerson(kind) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const skins = [0xf6d3ab, 0xecb98c, 0xd29c6f, 0xb07a4a, 0x8a5a30, 0x6b431f];
  const shirts = [0xe74c3c, 0x2980d9, 0xf1c40f, 0x27ae60, 0x9b59b6, 0xecf0f1, 0xe67e22, 0x16a085, 0x34495e, 0xe84393, 0x00bcd4];
  const pants = [0x2b3a55, 0x394b59, 0x6b4f3a, 0x4a5560, 0x222831, 0x5d4037];
  const hairs = [0x1b1410, 0x2a1d14, 0x4a3526, 0x6b5536, 0x8d6a3f];
  const umbs = [0x2c3e50, 0xe74c3c, 0x2980d9, 0x111317, 0x16a085, 0xf1c40f];
  const o = { skin: pick(skins), umb: pick(umbs), hairColor: pick(hairs), capColor: pick(shirts) };
  if (kind === 'woman') {
    Object.assign(o, { shirt: pick([0xe84393, 0x9b59b6, 0xff7675, 0x00b894, 0xfd79a8, 0x00bcd4]),
      pants: pick(pants), hairStyle: pick(['long', 'long', 'bun']), shortSleeve: Math.random() < 0.6,
      dress: Math.random() < 0.55 ? pick([0xe84393, 0x6c5ce7, 0xfdcb6e, 0xff7675, 0x00cec9, 0xffffff]) : null,
      scale: 0.96 });
  } else if (kind === 'child') {
    Object.assign(o, { shirt: pick(shirts), pants: pick(shirts), hairStyle: Math.random() < 0.25 ? 'cap' : pick(['short', 'long']),
      shorts: true, shortSleeve: true, scale: 0.6 });
  } else if (kind === 'elderly') {
    Object.assign(o, { shirt: pick([0x95a5a6, 0x7f8c8d, 0xb2bec3, 0xa29bfe, 0xbdc3c7, 0x8d9197]),
      pants: pick([0x555a60, 0x6b6f74, 0x4a4f55]), hairColor: 0xe6e9ea, hairStyle: Math.random() < 0.4 ? 'bald' : 'short',
      scale: 0.92, lean: 0.14, cane: true });
  } else {
    Object.assign(o, { shirt: pick(shirts), pants: pick(pants), hairStyle: Math.random() < 0.18 ? 'cap' : 'short',
      shortSleeve: Math.random() < 0.5, scale: 1.0 });
  }
  return { mesh: buildPerson(o), len: 1.0 };
}
