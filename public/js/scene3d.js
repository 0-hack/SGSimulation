// 3D city renderer for SGSimulation, built on Three.js.
// Renders Singapore as an island landmass; buildings rise when constructed and
// crumble (with dust) when demolished; traffic drives the streets; and natural
// disasters (floods, haze, storms) are animated. Mirrors the small API that
// main.js expects from the old 2D view.
import * as THREE from './vendor/three.module.js';
import { BUILDINGS, GRID_SIZE, ROAD_TYPES } from './data.js';
import { SG_OUTLINE, SG_ISLANDS, SG_RESERVOIRS, pointInPolygon, landMask, inReservoir, reservoirArea, inRiver, reservoirBranches, riverBranches } from './shape.js';

const N = GRID_SIZE;
const WORLD = N * 10;         // world units across the bounding box (TILE stays ~10)
const TILE = WORLD / N;
const SEA_Y = -1.2;
const SEA_COLOR = 0x3aa0d8;   // shared by the sea, river, reservoirs & coastal inlets
const DAY_CYCLE = 16;         // in-game days per full day/night cycle
const LIGHT_YEAR = 1970;      // traffic lights appear as the city modernises

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

// Singapore (Paya Lebar) Airport — the long white strip in the east of the 1965
// survey map. Runway centreline given in NORMALISED island coords (SW→NE; it
// runs diagonally across the eastern land), with the terminal/apron on its
// inland (west) flank.
const AIRPORT = {
  sw: { x: 0.6267, y: 0.418 }, ne: { x: 0.6923, y: 0.476 }, // runway centreline (normalised) — ~12% of island width
  rwHalfW: 5,          // runway half-width (world units)
  overrun: 6,          // paved overrun past each threshold
  termOff: 15,         // terminal offset across the runway, toward inland (+localX)
  apronX: [3, 12],     // apron spans this localX band (between runway and terminal)
  apronHalfL: 24,      // apron/terminal half-length along the runway axis
  termScale: 0.82,     // terminal shrunk toward normal building scale
  planeScale: 0.6,     // airliners ~one building-length, not two
};

export class Scene3D {
  constructor(canvas, { onTileTap, onGroundTap } = {}) {
    this.canvas = canvas;
    this.onTileTap = onTileTap;
    this.onGroundTap = onGroundTap;       // freeform road drawing taps
    this.roadMode = false;
    this.edgePts = []; this.edgeLen = []; this.edgeMeta = []; this.edgeN1 = []; this.edgeN2 = []; this.edgeMid = []; this.navAdj = []; this.navNodes = [];
    this.state = null;
    this.land = landMask(N);
    this.buildings = new Map();   // "x,y" -> { group, key }
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
    this.skyColor = new THREE.Color(0x8ec5e8);
    scene.background = this.skyColor.clone();
    // Linear fog fades the sea into the horizon so the world edge is never seen.
    this.fog = new THREE.Fog(0x9fc6e0, WORLD * 0.68, WORLD * 2.0);
    this.fogFar = WORLD * 2.0;
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
    this.roadEdges = [];     // 1965 Singapore had no dense road grid — players build roads
    this._buildCatchment();  // Central Catchment reservoir + nature reserve (centre of island)
    this._buildTerrain();    // the nature-reserve hills (Bukit Timah massif) around the reservoirs
    this._buildAirport();    // Singapore (Paya Lebar) Airport on the east side
    this._buildNature();     // scatter rural greenery across the undeveloped island
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
    // Main island, then the smaller outlying islands (decorative).
    this._landmass(SG_OUTLINE, { depth: 8, bevel: 1.5, beachScale: 1.05, main: true });
    for (const poly of SG_ISLANDS) this._landmass(poly, { depth: 5, bevel: 1.0, beachScale: 1.08, palms: true });

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
  _landmass(poly, { depth = 8, bevel = 1.5, beachScale = 1.05, main = false, palms = false } = {}) {
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
    const land = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: 0x77c25a, gradientMap: toonGradient() }));
    land.receiveShadow = true; this.scene.add(land);
    if (main) this.island = land;

    // a thin sandy beach skirt just below the grass so roads/grass aren't covered.
    // Scale it about the island's own centroid (NOT the world origin) so offshore
    // islands get a concentric sand ring instead of an offset/oversized blob.
    let cx = 0, cz = 0;
    for (const [nx, ny] of poly) { cx += (nx - 0.5) * WORLD; cz += (0.5 - ny) * WORLD; }
    cx /= poly.length; cz /= poly.length;
    const beachGeo = new THREE.ExtrudeGeometry(toShape(), { depth: 0.6, bevelEnabled: false });
    beachGeo.rotateX(-Math.PI / 2); beachGeo.computeBoundingBox();
    beachGeo.translate(0, -beachGeo.boundingBox.max.y - 0.12, 0);
    const beach = new THREE.Mesh(beachGeo, new THREE.MeshToonMaterial({ color: 0xe6d6a6, gradientMap: toonGradient() }));
    beach.scale.set(beachScale, 1, beachScale);
    beach.position.set((1 - beachScale) * cx, 0, (1 - beachScale) * cz); // keep the scale centred on the island
    beach.receiveShadow = true; this.scene.add(beach);

    if (palms) {
      const gmat = new THREE.MeshToonMaterial({ color: 0x3fae57, gradientMap: toonGradient() });
      const tmat = new THREE.MeshToonMaterial({ color: 0x8a6b43, gradientMap: toonGradient() });
      for (const [dx, dz] of [[-5, -2], [4, 2], [0, 4]]) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 8, 8), tmat);
        trunk.position.set(cx + dx, 4, cz + dz); trunk.castShadow = true; this.scene.add(trunk);
        const fr = new THREE.Mesh(new THREE.SphereGeometry(3.6, 8, 6), gmat);
        fr.position.set(cx + dx, 8.4, cz + dz); fr.scale.y = 0.5; fr.castShadow = true; this.scene.add(fr);
      }
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
    // elliptical falloff: long N–S (RY), narrow E–W (RX)
    const dr = Math.hypot((nx - HILL_CENTER[0]) / HILL_RX, (ny - HILL_CENTER[1]) / HILL_RY);
    if (dr >= 1) return 0;
    const disk = smoothstep(1.0, 0.7, dr);                 // 1 inside, 0 at the rim
    let h = 0;
    for (const hl of SG_HILLS) {
      const d2 = (nx - hl.x) ** 2 + (ny - hl.y) ** 2;
      h += hl.h * Math.exp(-d2 / (2 * hl.s * hl.s));
    }
    h += 1.4 * Math.sin(nx * 90) * Math.sin(ny * 85);      // gentle rolling texture
    const cx = Math.min(N - 1, Math.max(0, Math.floor(nx * N)));
    const cy = Math.min(N - 1, Math.max(0, Math.floor(ny * N)));
    const wd = this.waterDist ? this.waterDist[cy][cx] : 99;
    const valley = smoothstep(0.5, 5.0, wd);               // 0 at water, 1 a few cells away
    const cd = this.coastDist ? this.coastDist[cy][cx] : 99;
    const coast = smoothstep(0.5, 4.0, cd);                // 0 at the shoreline, 1 inland
    return Math.max(0, h * disk * valley * coast);
  }
  // Elevation at the centre of grid cell (cx,cy) — for placing trees & buildings.
  terrainHeight(cx, cy) { return this._terrainHN((cx + 0.5) / N, (cy + 0.5) / N); }

  // Build the central-catchment hill surface: a displaced grid over the reserve
  // disk, cel-shaded and tinted by elevation (forest green → olive → bare tan).
  _buildTerrain() {
    if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); }
    const RES = 110;
    const x0 = HILL_CENTER[0] - HILL_RX, x1 = HILL_CENTER[0] + HILL_RX;
    const y0 = HILL_CENTER[1] - HILL_RY, y1 = HILL_CENTER[1] + HILL_RY;
    const pos = [], col = [], idx = [], hgt = [], lnd = [];
    const lo = new THREE.Color(0x77c25a), mid = new THREE.Color(0x4f8f3e),
          hi = new THREE.Color(0x9a9a5f), top = new THREE.Color(0xb3a274), tmp = new THREE.Color();
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
      if (!this.land[y][x] || this.reserveMask?.[y]?.[x] || this.riverMask?.[y]?.[x] || this.airportMask?.[y]?.[x]) continue; // not on the water / runway
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

  // Singapore (Paya Lebar) Airport: a diagonal runway in the east with a parallel
  // taxiway, an apron of parked airliners, and the 1955 modernist terminal +
  // control tower (replicated from period photographs). Built as a fixed landmark
  // and marked unbuildable so the city grows around it.
  _buildAirport() {
    if (this.airportGroup) this.scene.remove(this.airportGroup);
    const nw = (p) => ({ x: (p.x - 0.5) * WORLD, z: (0.5 - p.y) * WORLD });
    const sw = nw(AIRPORT.sw), ne = nw(AIRPORT.ne);
    const cx = (sw.x + ne.x) / 2, cz = (sw.z + ne.z) / 2;
    const dx = ne.x - sw.x, dz = ne.z - sw.z, len = Math.hypot(dx, dz);
    const rot = Math.atan2(dx, dz);             // align local +Z with the SW→NE axis
    const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rot;
    this.scene.add(g); this.airportGroup = g;
    this._airportCenter = { cx, cz, rot, len };

    // local frame: +Z = runway long axis, +X = across toward the inland terminal
    const halfL = len / 2 + AIRPORT.overrun, halfW = AIRPORT.rwHalfW;
    const slab = (w, d, color, x, z, y = 0.12, glow = 0.05) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), toon(color));
      m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m;
    };
    // runway + grass shoulders + parallel taxiway
    slab(halfW * 2 + 6, halfL * 2 + 4, 0x6f9e57, 0, 0, 0.10);        // grassy strip border
    slab(halfW * 2, halfL * 2, 0x35383d, 0, 0, 0.14);                // asphalt runway
    slab(3.6, halfL * 2 + 8, 0x3a3d43, AIRPORT.termOff - 9, 0, 0.13); // taxiway (toward terminal)
    // centreline dashes
    const dashes = Math.floor((halfL * 2) / 6);
    for (let i = 0; i < dashes; i++) {
      const z = -halfL + 3 + i * 6;
      slab(0.5, 3.2, 0xeae4d2, 0, z, 0.16);
    }
    // threshold bars + runway designators at each end
    for (const s of [-1, 1]) {
      for (let k = -2; k <= 2; k++) slab(0.7, 4, 0xeae4d2, k * 1.5, s * (halfL - 5), 0.16);
      slab(halfW * 2 - 1, 0.8, 0xeae4d2, 0, s * (halfL - 1.5), 0.16);
    }

    // apron (concrete) on the inland flank, between runway and terminal
    const apX = (AIRPORT.apronX[0] + AIRPORT.apronX[1]) / 2, apW = AIRPORT.apronX[1] - AIRPORT.apronX[0];
    slab(apW + 8, AIRPORT.apronHalfL * 2, 0xb9b4a6, apX + 1, 0, 0.13);

    // parked airliners on the apron, noses out toward the runway
    for (let i = -1; i <= 1; i++) {
      const pl = makeAirliner();
      pl.scale.setScalar(AIRPORT.planeScale);
      pl.position.set(apX, 0, i * 9);
      pl.rotation.y = -Math.PI / 2;             // fuselage along the runway, nose to -X
      g.add(pl);
    }

    // terminal complex on the inland side, front (+Z of the model) facing the apron
    const term = makeTerminal();
    term.scale.setScalar(AIRPORT.termScale);
    term.position.set(AIRPORT.termOff, 0, 0);
    term.rotation.y = -Math.PI / 2;             // model +Z -> parent -X (toward the apron)
    g.add(term);

    // mark the runway + apron/terminal footprint unbuildable
    this.airportMask = Array.from({ length: N }, () => Array(N).fill(false));
    const cosr = Math.cos(rot), sinr = Math.sin(rot);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x]) continue;
      const w = cellToWorld(x, y);
      const ox = w.x - cx, oz = w.z - cz;
      const lx = ox * cosr - oz * sinr;          // world -> local (inverse Y-rot)
      const lz = ox * sinr + oz * cosr;
      const onRunway = Math.abs(lx) < halfW + 4 && Math.abs(lz) < halfL;
      const onApron = lx > 2 && lx < AIRPORT.termOff + 6 && Math.abs(lz) < AIRPORT.apronHalfL;
      if (onRunway || onApron) this.airportMask[y][x] = true;
    }
  }

  // A few boats drifting on the sea around the island.
  _initBoats() {
    this.boats = [];
    const types = ['bumboat', 'bumboat', 'cargo', 'sampan', 'bumboat', 'cargo', 'sampan', 'bumboat'];
    for (let i = 0; i < types.length; i++) {
      const b = makeBoat(types[i]);
      const ang = Math.random() * Math.PI * 2;
      const rad = WORLD * (0.42 + Math.random() * 0.12);
      this.scene.add(b);
      this.boats.push({ mesh: b, ang, rad, speed: (0.02 + Math.random() * 0.03) * (Math.random() < 0.5 ? 1 : -1) });
    }
  }
  _updateBoats(dt) {
    if (!this.boats) return;
    for (const bo of this.boats) {
      bo.ang += bo.speed * dt;
      const x = Math.cos(bo.ang) * bo.rad, z = Math.sin(bo.ang) * bo.rad;
      bo.mesh.position.set(x, SEA_Y + 0.6, z);
      bo.mesh.rotation.y = -bo.ang + (bo.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      bo.mesh.position.y = SEA_Y + 0.6 + Math.sin(this.clock.elapsedTime * 1.2 + bo.ang * 4) * 0.25; // bob
    }
  }

  // ---- camera controls (orbit / pan / pinch) --------------------------------
  _initControls() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    this.target = new THREE.Vector3(0, 0, 0);
    this.cam = { radius: WORLD * 0.85, theta: -0.7, phi: 0.92 };
    this.MIN_R = 26;             // street-level zoom (buildings unchanged)
    this.MAX_R = WORLD * 1.5;    // capped so the fogged sea edge stays hidden
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
    });
    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) { this._hover(pos(e)); return; }
      const p = pos(e);
      this._pointers.set(e.pointerId, p);
      if (this._pointers.size === 2) {
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinch) this.cam.radius = THREE.MathUtils.clamp(this.cam.radius * this._lastPinch / dist, this.MIN_R, this.MAX_R);
        // two-finger pan
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (this._lastMid) this._pan(mid.x - this._lastMid.x, mid.y - this._lastMid.y);
        this._lastMid = mid;
        this._lastPinch = dist; this._moved = true;
        return;
      }
      const dx = p.x - this._last.x, dy = p.y - this._last.y;
      this._last = p;
      if (Math.abs(p.x - this._down.x) > 5 || Math.abs(p.y - this._down.y) > 5) this._moved = true;
      this.cam.theta -= dx * 0.005;
      this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.005, 0.22, 1.28);
      this._hover(p);
    });
    const end = (e) => {
      const p = pos(e);
      const quick = performance.now() - this._downTime < 400;
      if (!this._moved && quick && this._pointers.size <= 1) {
        if (this.roadMode && this.onGroundTap) {
          const g = this._raycastGround(p);
          if (g) this.onGroundTap(g.x, g.z);
        } else {
          const cell = this._raycastCell(p);
          if (cell && this.onTileTap) this.onTileTap(cell.x, cell.y);
        }
      }
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) { this._lastPinch = 0; this._lastMid = null; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { if (this.ghost) this.ghost.visible = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.radius = THREE.MathUtils.clamp(this.cam.radius * (e.deltaY < 0 ? 0.92 : 1.08), this.MIN_R, this.MAX_R);
    }, { passive: false });
    window.addEventListener('resize', () => this.resize());
  }

  _pan(dx, dy) {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const fwd = new THREE.Vector3().crossVectors(this.camera.up, right).normalize();
    const k = this.cam.radius * 0.0016;
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(fwd, -dy * k);
    // keep focus over the island so the player can't roam into empty sea
    this.target.x = THREE.MathUtils.clamp(this.target.x, -WORLD * 0.52, WORLD * 0.52);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -WORLD * 0.42, WORLD * 0.42);
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
  _raycastGround(p) {
    this.raycaster.setFromCamera(this._ndc(p), this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }
  _raycastCell(p) {
    this.raycaster.setFromCamera(this._ndc(p), this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    if (!hit) return null;
    const nx = hit.point.x / WORLD + 0.5;
    const ny = 0.5 - hit.point.z / WORLD;
    const gx = Math.floor(nx * N), gy = Math.floor(ny * N);
    if (gx < 0 || gy < 0 || gx >= N || gy >= N) return null;
    return { x: gx, y: gy };
  }
  isLand(x, y) {
    return !!(this.land[y] && this.land[y][x] && !(this.reserveMask && this.reserveMask[y][x]) && !(this.riverMask && this.riverMask[y][x]) && !(this.airportMask && this.airportMask[y][x]));
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
  isRoadAt(gx, gy) {
    const c = cellToWorld(gx, gy);
    for (let e = 0; e < this.edgePts.length; e++) {
      const pts = this.edgePts[e]; if (!pts || pts.length < 2) continue;
      const T = ROAD_TYPES[this.edgeMeta[e]?.type] || ROAD_TYPES.street;
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

  _hover(p) {
    if (!this.previewKey && !this.bulldoze) { if (this.ghost) this.ghost.visible = false; return; }
    const cell = this._raycastCell(p);
    this.hoverCell = cell;
    this._updateGhost();
  }

  // ---- external API (mirrors the 2D view) ----------------------------------
  setState(state) { this.state = state; this.syncAll(); this.rebuildRoadNet(); }
  setShortages(s) { this.shortages = s; }
  setPreview(key, theme) {
    this.previewKey = key; this.previewTheme = theme; this.bulldoze = false;
    this._makeGhost(key);
  }
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
    this.ghost = g; this.ghost.visible = false;
    this.scene.add(g);
  }
  _updateGhost() {
    if (!this.ghost || !this.hoverCell) { if (this.ghost) this.ghost.visible = false; return; }
    const { x, y } = this.hoverCell;
    const c = cellToWorld(x, y);
    this.ghost.position.set(c.x, this.terrainHeight(x, y), c.z);
    this.ghost.visible = true;
    const ok = this.isLand(x, y) && !this.buildings.has(`${x},${y}`);
    this.ghost.traverse((o) => { if (o.material) o.material.color.set(ok ? 0x9be15d : 0xff5a5a); });
  }

  // Rebuild every building mesh from the current state (no animation).
  syncAll() {
    for (const { group } of this.buildings.values()) this.scene.remove(group);
    this.buildings.clear();
    if (!this.state) { this._refreshNature(); return; }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cell = this.state.grid[y]?.[x];
        if (cell) this._addMesh(x, y, cell.k, false, cell.c);
      }
    }
    this._refreshNature();
  }

  _addMesh(x, y, key, animate, theme) {
    const id = `${x},${y}`;
    if (this.buildings.has(id)) this.removeBuilding(x, y, false);
    const b = BUILDINGS[key];
    const group = makeBuilding(key, theme);
    const c = cellToWorld(x, y);
    group.position.set(c.x, this.terrainHeight(x, y), c.z);
    group.rotation.y = (Math.floor(Math.random() * 4)) * Math.PI / 2;
    group.castShadow = true;
    this.scene.add(group);
    const tall = b.cat === 'residential' || b.cat === 'industry';
    const entry = { group, key, tall, anim: false };
    this.buildings.set(id, entry);
    if (animate) {
      group.scale.set(1, 0.001, 1);
      entry.anim = true;
      this.anims.push({ group, entry, t: 0, dur: 0.9, type: 'build' });
      this._spawnDust(c.x, c.z, 0x9ad06a);
    } else {
      group.scale.set(1, tall ? this.devFactor : 1, 1);
    }
  }

  // called by main.js after a successful build
  onBuilt(x, y, key, theme) {
    this._addMesh(x, y, key, true, theme);
    const g = this.natureCells?.get(x + ',' + y); if (g) g.visible = false;  // clear trees under it
  }

  // called by main.js after demolish
  onDemolished(x, y) {
    const id = `${x},${y}`;
    const entry = this.buildings.get(id);
    if (!entry) return;
    this.buildings.delete(id);
    this.anims.push({ group: entry.group, t: 0, dur: 0.8, type: 'demolish', baseY: entry.group.position.y });
    const c = cellToWorld(x, y);
    this._spawnDust(c.x, c.z, 0xbfb09a, 26);
    const g = this.natureCells?.get(x + ',' + y); if (g) g.visible = true;   // greenery returns
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
    const meta = this.edgeMeta[a.edge] || { type: 'street', lanes: 2 };
    const T = ROAD_TYPES[meta.type] || ROAD_TYPES.street;
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
    const year = this.state?.date?.y ?? 1965;
    const vintage = year < 1980;             // trishaws, vintage cars & old buses in the early decades
    const r = Math.random();
    const kind = vintage
      ? (r < 0.32 ? 'car' : r < 0.44 ? 'taxi' : r < 0.64 ? 'trishaw' : r < 0.8 ? 'bike' : r < 0.92 ? 'lorry' : 'bus')
      : (r < 0.46 ? 'car' : r < 0.6 ? 'taxi' : r < 0.76 ? 'bike' : r < 0.88 ? 'lorry' : 'bus');
    const { mesh, len } = makeVehicle(kind, vintage);
    this.scene.add(mesh);
    const speed = { car: 11, taxi: 11, bike: 14, trishaw: 5, lorry: 8, bus: 7.5 }[kind];
    const ag = {
      mesh, len, group: 'veh', kind, edge: Math.floor(Math.random() * this.edgePts.length),
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
      this.scene.add(mesh);
      const speed = { man: 2.7, woman: 2.5, child: 2.4, elderly: 1.6 }[kind];
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
    // overcast dims the sun and greys the sky
    this.sun.intensity *= (1 - w.cloud * 0.55);
    if (this.scene.background.lerp) {
      const grey = new THREE.Color(0xb7bdc2);
      this.scene.background.lerp(grey, w.cloud * 0.5);
      this.fog.color.lerp(grey, w.cloud * 0.5);
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
      this.scene.background.lerp(brown, intensity * 0.6);
      this.fog.color.lerp(brown, intensity * 0.6);
      if (k >= 1) this.disaster = null;
    } else if (d.type === 'quake') {
      const a = (1 - k) * 1.4;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (k >= 1) this.disaster = null;
    }
  }

  // ---- day / night (driven by the in-game clock) ---------------------------
  advanceClock(days) { this.gameDays += days; this._pendingDays = (this._pendingDays || 0) + days; }
  _updateDayNight() {
    this.timeOfDay = ((this.gameDays / DAY_CYCLE) % 1 + 1) % 1;
    const elev = Math.sin(2 * Math.PI * (this.timeOfDay - 0.25)); // -1..1
    const dayness = THREE.MathUtils.clamp((elev + 0.18) / 0.5, 0, 1);
    const horizon = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.28, 0, 1);
    this.nightFactor = 1 - dayness;

    const a = 2 * Math.PI * (this.timeOfDay - 0.25);
    this.sun.position.set(Math.cos(a) * 200, Math.max(12, elev * 260), 90 + Math.sin(a) * 60);
    this.sun.intensity = 0.18 + dayness * 1.15;
    const sunCol = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xff8a3c), horizon * (1 - dayness * 0.5));
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0x9fb6ff), this.nightFactor * 0.6);
    this.hemi.intensity = 0.22 + dayness * 0.7;

    const night = new THREE.Color(0x0c1830), day = new THREE.Color(0x8ec5e8);
    const sky = night.clone().lerp(day, dayness).lerp(new THREE.Color(0xf2935a), horizon * 0.6 * (1 - dayness * 0.3));
    this.scene.background = sky;          // weather/haze may tint this in place
    this.fog.color.copy(sky);
    this.skyColor = sky.clone();

    const glow = this.nightFactor;
    for (const m of ALL_MATS) m.emissiveIntensity = glow * (m.userData.glowK ?? 0.3);
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
      const want = entry.tall ? this.devFactor : 1;
      entry.group.scale.y += (want - entry.group.scale.y) * Math.min(1, dt * 0.8);
    }
  }

  // ---- freeform road network (player-drawn) --------------------------------
  setRoadMode(on) { this.roadMode = on; if (!on) this.clearRoadPreview(); }

  // Sample an edge's centre-line into world points (with bridge elevation).
  _sampleEdge(roads, e) {
    const a = roads.nodes[e.a], b = roads.nodes[e.b];
    if (!a || !b) return [];
    const pts = [];
    const segs = e.ctrl ? 14 : 1;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      let x, z;
      if (e.ctrl) { // quadratic Bézier
        const it = 1 - t;
        x = it * it * a.x + 2 * it * t * e.ctrl.x + t * t * b.x;
        z = it * it * a.z + 2 * it * t * e.ctrl.z + t * t * b.z;
      } else { x = a.x + (b.x - a.x) * t; z = a.z + (b.z - a.z) * t; }
      let y = 0.16;
      if (e.elevated) { const ramp = Math.min(1, Math.min(t, 1 - t) / 0.22); y = 0.16 + ramp * 4.2; }
      pts.push({ x, y, z });
    }
    return pts;
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
    // a thin marking line running along the centre-line, shifted sideways by `off`
    const markLine = (pts, off, dashed, hw = 0.09) => {
      const [v, idx] = mark; let acc = 0;
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

    if (roads) roads.edges.forEach((e) => {
      const T = ROAD_TYPES[e.type] || ROAD_TYPES.street;
      const pts = this._sampleEdge(roads, e);
      if (pts.length < 2) return;
      const hw = T.width / 2, L = e.lanes || T.lanes, lw = T.width / L;
      ribbon(pave, pts, hw + 0.7, 0.0);
      ribbon(road, pts, hw, 0.03);
      for (let k = 1; k < L; k++) {                 // lane dividers
        const off = -hw + k * lw;
        markLine(pts, off, Math.abs(off) > 0.05);   // solid only on the centre (between directions)
      }
      stopLine(pts, hw, false); stopLine(pts, hw, true);
      if (e.elevated) for (let i = 2; i < pts.length - 1; i += 4) {
        const pt = pts[i];
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, pt.y, 8), toon(0x9098a0));
        pil.position.set(pt.x, pt.y / 2, pt.z); this.roadGroup.add(pil);
      }
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
      g.setIndex(buf[1]); g.computeVertexNormals();
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
      add([{ x: a.x, y: 0.16, z: a.z }, { x: b.x, y: 0.16, z: b.z }], 2, 'street', false, true);
    }
    const roads = this.state?.roads;
    if (roads) roads.edges.forEach((e) => {
      const T = ROAD_TYPES[e.type] || ROAD_TYPES.street;
      add(this._sampleEdge(roads, e), e.lanes || T.lanes, e.type, e.elevated, !e.elevated);
    });
    this.navNodes = nodes; this.navAdj = adj;
    this._buildLights();
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
        const T = ROAD_TYPES[this.edgeMeta[L.edge].type] || ROAD_TYPES.street;
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

  // Traffic lights at real junctions (3+ roads): incident roads are split into
  // two phases that alternate; vehicles stop on red at the stop line.
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
      post.add(cyl(0.18, 0.2, 3.4, 0x3a3f45, 0, 1.7, 0));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshToonMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 0.7, gradientMap: toonGradient() }));
      head.position.set(0, 3.4, 0); post.add(head); light.head = head;
      post.position.set(node.x, node.y, node.z); this.lightGroup.add(post);
      this.lights.push(light); this.lightByNode.set(n, light);
    }
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
  clearRoadPreview() { if (this._roadPreview) { this.scene.remove(this._roadPreview); this._roadPreview = null; } }

  // ---- per-frame update + render -------------------------------------------
  render() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // construction / demolition tweens
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = Math.min(a.t / a.dur, 1);
      if (a.type === 'build') {
        const e = easeOutBack(k) * (a.entry?.tall ? this.devFactor : 1);
        a.group.scale.set(1, Math.max(0.001, e), 1);
        if (k >= 1 && a.entry) a.entry.anim = false;
      } else {
        a.group.scale.y = Math.max(0.001, 1 - k);
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

    // unified traffic — density scales with population, drives grid + freeform roads
    if (this.state && this.edgePts.length) {
      const target = THREE.MathUtils.clamp(Math.floor(this.state.population / 30000), 5, 60);
      // traffic lights appear once the city has modernised past LIGHT_YEAR
      const wantLights = (this.state.date?.y || 1965) >= LIGHT_YEAR;
      if (wantLights !== this._lightsActive) this._buildLights();
      this._updateLights(dt);
      this._ensureVehicles(target);
      this._advanceNet(this.vehicles, dt);
    }

    // sea shimmer
    if (this.sea) this.sea.material.opacity = 0.9 + Math.sin(this.clock.elapsedTime * 1.5) * 0.03;

    this._updateDayNight();
    this._updateWeather(dt);
    this._updateDevelopment(dt);
    this._updatePeople(dt);
    this._updateBoats(dt);
    this._updateDisaster(dt);
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
    const d = new Uint8Array([95, 160, 215, 255]);
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

// The 1955 Singapore (Paya Lebar) terminal: a long six-storey office slab, a
// tall square control tower with a glazed cab, a saw-tooth-roofed concourse
// wing, and a lattice radio mast — modelled facing local +Z (the apron side).
function makeTerminal() {
  const g = new THREE.Group();
  const concrete = 0xd8d3c4, pale = 0xe6e1d2, grey = 0x9aa0a6, glassBlue = 0xbfe6ff;
  // main six-storey slab
  g.add(tower(34, 20, 8, 'office', 0, -1));
  g.add(partBox(34.6, 1.2, 8.6, mat(pale), 0, 20.4, -1));            // parapet cap
  // glazed ground-floor entrance + cantilevered canopy on the apron side
  g.add(partBox(34, 4.4, 0.4, mat(glassBlue, { transparent: true, opacity: 0.7 }), 0, 2.2, 3.2));
  g.add(partBox(34, 0.4, 4.0, mat(pale), 0, 4.5, 5.0));
  for (const cx of [-15, -7.5, 0, 7.5, 15]) g.add(cyl(0.22, 0.22, 4.4, 0xcfcabb, cx, 2.2, 6.8));
  // control tower (right end), stepped forward of the slab
  g.add(tower(7, 33, 7, 'office', 15, 2));
  for (const fx of [-3.5, 3.5]) { g.add(partBox(0.5, 33, 0.4, mat(concrete), 15 + fx, 16.5, 5.4)); g.add(partBox(0.4, 33, 0.5, mat(concrete), 15 + fx, 16.5, 2)); } // vertical fins
  g.add(partBox(9, 3.6, 9, mat(glassBlue, { transparent: true, opacity: 0.8 }), 15, 34.8, 2)); // glazed cab
  g.add(partBox(10, 0.7, 10, mat(grey), 15, 37.0, 2));              // cab roof overhang
  g.add(cyl(0.18, 0.22, 6, 0xd23b32, 15, 40.3, 2));                 // radio mast (red)
  g.add(cyl(0.1, 0.1, 1.6, 0xf2efe6, 15, 44.0, 2));                 // white tip
  // saw-tooth concourse wing (left end), single-storey
  const baseX = -25;
  g.add(partBox(18, 6, 10, mat(pale), baseX, 3, 0));
  for (let i = 0; i < 6; i++) {
    const sx = baseX - 7.5 + i * 3.0;
    const roof = partBox(3.0, 0.3, 6.6, mat(0xc9c4b4), sx, 7.0, -1.2); roof.rotation.z = 0.5; g.add(roof);
    g.add(partBox(0.3, 1.7, 6.6, mat(glassBlue, { transparent: true, opacity: 0.75 }), sx - 1.3, 6.7, -1.2)); // north-light glazing
  }
  // lattice radio mast beside the slab
  const mast = new THREE.Group(); mast.position.set(24, 0, -5);
  for (const [mx, mz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mast.add(cyl(0.12, 0.16, 26, 0xb24a3f, mx, 13, mz));
  for (let h = 3; h < 26; h += 3.2) for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
    const ax = a[0], az = a[1], bx = b[0], bz = b[1];
    const bar = partBox(Math.hypot(bx - ax, bz - az) + 0.1, 0.12, 0.12, mat(0xb24a3f), (ax + bx) / 2, h, (az + bz) / 2);
    bar.rotation.y = Math.atan2(bz - az, bx - ax); mast.add(bar);
  }
  g.add(mast);
  // landside garden behind the slab
  lawn(g, 40, 8, 0x6fb15a);                                          // (under the slab; cheap green base)
  for (const tx of [-14, -4, 6, 16]) treeAt(g, tx, -7.5, 1.2);
  return g;
}

export function makeBuilding(key, theme) {
  const b = BUILDINGS[key];
  const g = new THREE.Group();
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
        // upper-floor pair of louvered, shuttered windows
        for (const sx of [-0.44, 0.44]) {
          g.add(partBox(0.42, 1.0, 0.06, mat(0x32584a), ux + sx, 3.0, fz + 0.02));            // window
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
    } else {
      lawn(g, 9, 9);
      const topt = tint != null ? { tint } : undefined;
      const conf = key === 'condo_estate'
        ? { slabs: [[-2.7, -1.7, 2.7, 20, 2.7], [0.5, -2.6, 2.5, 16, 2.5], [2.7, 1.5, 2.7, 23, 2.7], [-1.6, 2.3, 2.6, 18, 2.6]], style: 'glass' }
        : key === 'hdb_newtown'
          ? { slabs: [[-2.4, -1, 3.6, 16, 2.6], [1.4, -2.2, 3.4, 14, 2.4], [2.2, 1.8, 3.2, 18, 2.4]], style: 'hdb' }
          : key === 'condo'
            ? { slabs: [[-1.8, -1, 3.0, 17, 3.0], [1.8, 1.2, 2.8, 14, 2.8]], style: 'glass' }
            : { slabs: [[-2, -0.5, 3.4, 12, 3.0], [1.8, 0.6, 3.2, 14, 2.8]], style: 'hdb' };
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
  } else if (cat === 'civic') {
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
      lawn(g, 9, 9);
      for (const px of [-3.5, 0, 3.5]) g.add(partBox(1, 5, 1, mat(0xc4c8cc), px, 2.5, 0));
      g.add(partBox(9, 0.8, 4.4, mat(0x9aa0a6), 0, 5.4, 0));
      const train = tower(8, 2.4, 3, 'glass', 0, 0, { color: col }); train.position.y = 7; g.add(train);
      g.add(partBox(9.4, 0.4, 5, mat(0xbfd6e6, { metalness: 0.3 }), 0, 8.6, 0));
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
    if (key === 'beach') {
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
function makeVehicle(kind, vintage = false) {
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
  const col = kind === 'taxi' ? 0xf4c20a : pick([0xd94f4f, 0xffffff, 0x3f7fd8, 0x2e8b57, 0x6b7280, 0x8e44ad]);
  g.add(partBox(1.55, 0.55, 3.2, mat(col), 0, 0.55, 0));
  g.add(partBox(1.4, 0.5, 1.7, mat(col), 0, 1.0, -0.1));
  g.add(partBox(1.43, 0.42, 1.5, mat(glass), 0, 1.02, -0.1));
  g.add(partBox(0.24, 0.16, 0.08, mat(0xfff6cf, {}, 1.8), 0.52, 0.5, 1.62));   // headlights (glow at night)
  g.add(partBox(0.24, 0.16, 0.08, mat(0xfff6cf, {}, 1.8), -0.52, 0.5, 1.62));
  g.add(partBox(0.24, 0.14, 0.08, mat(0xe23b2e, {}, 1.6), 0.52, 0.5, -1.62));  // taillights
  g.add(partBox(0.24, 0.14, 0.08, mat(0xe23b2e, {}, 1.6), -0.52, 0.5, -1.62));
  for (const z of [1.05, -1.05]) { g.add(wheel(-0.78, z)); g.add(wheel(0.78, z)); }
  if (kind === 'taxi') g.add(partBox(0.5, 0.26, 0.32, mat(0x1d2733), 0, 1.4, -0.1)); // roof sign
  return { mesh: g, len: 3.2 };
}

// ---- street props & boats -------------------------------------------------
function makeLamppost() {
  const g = new THREE.Group();
  g.add(cyl(0.09, 0.11, 4.4, mat(0x3e444b), 0, 2.2, 0));
  g.add(partBox(0.1, 0.1, 0.9, mat(0x3e444b), 0, 4.3, 0.4));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(0xfff0b8, {}, 1.9)); // glows at night
  lamp.position.set(0, 4.22, 0.82); g.add(lamp);
  return g;
}
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
