// 3D city renderer for SGSimulation, built on Three.js.
// Renders Singapore as an island landmass; buildings rise when constructed and
// crumble (with dust) when demolished; traffic drives the streets; and natural
// disasters (floods, haze, storms) are animated. Mirrors the small API that
// main.js expects from the old 2D view.
import * as THREE from './vendor/three.module.js';
import { BUILDINGS, GRID_SIZE } from './data.js';
import { SG_OUTLINE, pointInPolygon, landMask } from './shape.js';

const N = GRID_SIZE;
const WORLD = 220;            // world units across the island bounding box
const TILE = WORLD / N;
const SEA_Y = -1.2;
const DAY_CYCLE = 16;         // in-game days per full day/night cycle

// grid cell (gx,gy) -> world centre
function cellToWorld(gx, gy) {
  const nx = (gx + 0.5) / N, ny = (gy + 0.5) / N;
  return { x: (nx - 0.5) * WORLD, z: (0.5 - ny) * WORLD };
}
// grid corner (i,j) in 0..N -> world position (roads run along these borders)
function cornerToWorld(i, j) {
  return { x: (i / N - 0.5) * WORLD, z: (0.5 - j / N) * WORLD };
}

export class Scene3D {
  constructor(canvas, { onTileTap } = {}) {
    this.canvas = canvas;
    this.onTileTap = onTileTap;
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
    this.fog = new THREE.Fog(0x9fc6e0, 150, 440);
    this.fogFar = 440;
    scene.fog = this.fog;

    // Lighting
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a6b3a, 0.85);
    this.hemi = hemi;
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
    sun.position.set(120, 220, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 170;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 700 });
    sun.shadow.bias = -0.0004;
    this.sun = sun;
    scene.add(sun);

    // Sea
    const seaGeo = new THREE.PlaneGeometry(WORLD * 4, WORLD * 4, 1, 1);
    const seaMat = new THREE.MeshToonMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.95, gradientMap: toonGradient() });
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    sea.receiveShadow = false;
    this.sea = sea;
    scene.add(sea);

    this._buildIsland();
    this._buildRoadGraph();
    this._buildRoads();
    this._buildProps();
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
    // Build a THREE.Shape from the normalised outline, scaled to world units.
    const shape = new THREE.Shape();
    SG_OUTLINE.forEach(([nx, ny], i) => {
      const x = (nx - 0.5) * WORLD;
      const y = (ny - 0.5) * WORLD; // becomes -Z after rotation (north = far)
      i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
    });
    const depth = 8;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);   // lay flat; +Y(north) -> -Z
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.max.y, 0); // align the (beveled) top surface to y = 0
    const mat = new THREE.MeshToonMaterial({ color: 0x77c25a, gradientMap: toonGradient() }); // cartoon grass
    const land = new THREE.Mesh(geo, mat);
    land.receiveShadow = true;
    this.scene.add(land);
    this.island = land;

    // A thin sandy "beach" skirt just inside the coast.
    const beachShape = new THREE.Shape();
    SG_OUTLINE.forEach(([nx, ny], i) => {
      const x = (nx - 0.5) * WORLD, y = (ny - 0.5) * WORLD;
      i === 0 ? beachShape.moveTo(x, y) : beachShape.lineTo(x, y);
    });
    const beachGeo = new THREE.ExtrudeGeometry(beachShape, { depth: 0.6, bevelEnabled: false });
    beachGeo.rotateX(-Math.PI / 2);
    beachGeo.computeBoundingBox();
    // keep the sandy rim just BELOW the grass so roads/grass aren't covered
    beachGeo.translate(0, -beachGeo.boundingBox.max.y - 0.12, 0);
    const beach = new THREE.Mesh(beachGeo, new THREE.MeshToonMaterial({ color: 0xe6d6a6, gradientMap: toonGradient() }));
    beach.scale.set(1.05, 1, 1.05);
    beach.receiveShadow = true;
    this.scene.add(beach);

    // Invisible pick plane at ground level for raycasting taps.
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 2, WORLD * 2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);
    this.raycaster = new THREE.Raycaster();
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

  // Street furniture along the kerbs: lampposts (lit at night), trees, benches.
  _buildProps() {
    for (const [[ai, aj], [bi, bj]] of this.roadEdges) {
      if (Math.random() > 0.22) continue;
      const a = cornerToWorld(ai, aj), b = cornerToWorld(bi, bj);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      const px = mx + (-dz / len) * 1.45 * side, pz = mz + (dx / len) * 1.45 * side;
      const r = Math.random();
      let prop;
      if (r < 0.4) prop = makeLamppost();
      else if (r < 0.78) { prop = new THREE.Group(); treeAt(prop, 0, 0, 0.9 + Math.random() * 0.6); }
      else prop = makeBench(Math.atan2(dx, dz));
      prop.position.set(px, 0, pz);
      this.scene.add(prop);
    }
  }

  // A few boats drifting on the sea around the island.
  _initBoats() {
    this.boats = [];
    for (let i = 0; i < 6; i++) {
      const b = makeBoat(i % 3 === 0);
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
    this.cam = { radius: 190, theta: -0.7, phi: 0.92 };
    this.MIN_R = 26;             // street-level zoom
    this.MAX_R = 340;            // capped so the fogged sea edge stays hidden
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
        const cell = this._raycastCell(p);
        if (cell && this.onTileTap) this.onTileTap(cell.x, cell.y);
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

  centerCamera() { this.target.set(0, 0, 0); this.cam.radius = 190; this.cam.theta = -0.7; this.cam.phi = 0.92; }

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
  isLand(x, y) { return !!(this.land[y] && this.land[y][x]); }
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
  setState(state) { this.state = state; this.syncAll(); }
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
    this.ghost.position.set(c.x, 0, c.z);
    this.ghost.visible = true;
    const ok = this.isLand(x, y) && !this.buildings.has(`${x},${y}`);
    this.ghost.traverse((o) => { if (o.material) o.material.color.set(ok ? 0x9be15d : 0xff5a5a); });
  }

  // Rebuild every building mesh from the current state (no animation).
  syncAll() {
    for (const { group } of this.buildings.values()) this.scene.remove(group);
    this.buildings.clear();
    if (!this.state) return;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cell = this.state.grid[y]?.[x];
        if (cell) this._addMesh(x, y, cell.k, false, cell.c);
      }
    }
  }

  _addMesh(x, y, key, animate, theme) {
    const id = `${x},${y}`;
    if (this.buildings.has(id)) this.removeBuilding(x, y, false);
    const b = BUILDINGS[key];
    const group = makeBuilding(key, theme);
    const c = cellToWorld(x, y);
    group.position.set(c.x, 0, c.z);
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
  onBuilt(x, y, key, theme) { this._addMesh(x, y, key, true, theme); }

  // called by main.js after demolish
  onDemolished(x, y) {
    const id = `${x},${y}`;
    const entry = this.buildings.get(id);
    if (!entry) return;
    this.buildings.delete(id);
    this.anims.push({ group: entry.group, t: 0, dur: 0.8, type: 'demolish' });
    const c = cellToWorld(x, y);
    this._spawnDust(c.x, c.z, 0xbfb09a, 26);
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

  // ---- road-graph navigation (shared by vehicles & pedestrians) ------------
  _randomRoadNode() {
    const n = this.roadNodes;
    return n.length ? n[Math.floor(Math.random() * n.length)].slice() : [N / 2, N / 2];
  }
  _roadNodesNear(R) {
    const out = [];
    for (const nd of this.roadNodes) {
      const w = cornerToWorld(nd[0], nd[1]);
      if (Math.hypot(w.x - this.target.x, w.z - this.target.z) <= R) out.push(nd);
    }
    return out.length ? out : this.roadNodes;
  }
  _pickEdge(ag) {
    const nbrs = this.roadAdj.get(ag.node.join(',')) || [];
    if (!nbrs.length) { ag.next = null; return; }
    let opts = nbrs;
    if (ag.prev) {
      const f = opts.filter((n) => !(n[0] === ag.prev[0] && n[1] === ag.prev[1]));
      if (f.length) opts = f;
    }
    let pick;
    if (ag.dir && Math.random() < 0.82) {
      let best = -2;
      for (const n of opts) {
        const dot = (n[0] - ag.node[0]) * ag.dir[0] + (n[1] - ag.node[1]) * ag.dir[1];
        if (dot > best) { best = dot; pick = n; }
      }
    } else pick = opts[Math.floor(Math.random() * opts.length)];
    ag.prev = ag.node; ag.next = pick;
    ag.dir = [pick[0] - ag.node[0], pick[1] - ag.node[1]]; ag.p = 0;
  }
  // Advance a list of agents with lane discipline + car-following (no overlaps).
  _advanceAgents(list, dt) {
    const groups = new Map();
    for (const ag of list) {
      if (!ag.next || !ag.mesh.visible) continue;
      const k = `${ag.node[0]}_${ag.node[1]}>${ag.next[0]}_${ag.next[1]}`;
      let a = groups.get(k); if (!a) groups.set(k, a = []);
      a.push(ag);
    }
    for (const arr of groups.values()) {
      arr.sort((p, q) => p.p - q.p);
      for (let i = 0; i < arr.length; i++) arr[i]._lead = arr[i + 1] || null;
    }
    for (const ag of list) {
      if (!ag.mesh.visible) continue;
      if (!ag.next) { this._pickEdge(ag); continue; }
      let maxP = 1.2;
      if (ag._lead) maxP = ag._lead.p - ((ag.len + ag._lead.len) * 0.5 + ag.margin) / TILE;
      const prev = ag.p;
      ag.p = Math.min(ag.p + dt * ag.speed / TILE, maxP);
      if (ag.p < prev) ag.p = prev;          // blocked: hold position
      const moving = ag.p > prev + 1e-4;
      ag._lead = null;
      if (ag.p >= 1) { ag.node = ag.next; this._pickEdge(ag); }
      this._placeAgent(ag, dt, moving);
    }
  }
  _placeAgent(ag, dt, moving) {
    const A = cornerToWorld(ag.node[0], ag.node[1]);
    const B = cornerToWorld(ag.next[0], ag.next[1]);
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;          // travel dir
    const perpx = uz, perpz = -ux;               // lateral (lane offset)
    ag.mesh.position.set(A.x + dx * ag.p + perpx * ag.lane, ag.yBase, A.z + dz * ag.p + perpz * ag.lane);
    ag.mesh.rotation.y = Math.atan2(ux, uz);
    if (moving) { ag.phase += dt * ag.speed * ag.animK; }
    const ud = ag.mesh.userData;
    if (ud.upperLegs) {
      const ph = ag.phase, m = moving ? 1 : 0, sc = ag.mesh.scale.x;
      const s = Math.sin(ph), amp = 0.5 * m + 0.02;
      // legs: hips swing, knees bend on the back-swing
      ud.upperLegs[0].rotation.x = s * amp;
      ud.upperLegs[1].rotation.x = -s * amp;
      ud.lowerLegs[0].rotation.x = Math.max(0, Math.sin(ph - 1.1)) * 1.0 * m;
      ud.lowerLegs[1].rotation.x = Math.max(0, Math.sin(ph + Math.PI - 1.1)) * 1.0 * m;
      if (ud.umbrella.visible) {
        // hold the umbrella up with the right arm
        ud.upperArms[1].rotation.set(-2.5, 0, 0); ud.lowerArms[1].rotation.x = 0.4;
        ud.upperArms[0].rotation.x = -s * amp * 0.7; ud.lowerArms[0].rotation.x = 0.2;
      } else {
        ud.upperArms[0].rotation.x = -s * amp * 0.75; ud.upperArms[1].rotation.x = s * amp * 0.75;
        ud.lowerArms[0].rotation.x = 0.15 + Math.max(0, -s) * 0.4 * m;
        ud.lowerArms[1].rotation.x = 0.15 + Math.max(0, s) * 0.4 * m;
      }
      ud.torso.position.y = (0.95) + Math.abs(Math.sin(ph)) * 0.03 * m; // gentle bob (local)
      ag.mesh.position.y = ag.yBase + Math.abs(Math.sin(ph)) * 0.04 * m * sc;
    }
  }

  // ---- vehicles (always present; density scales with population) ------------
  _ensureVehicles(target) {
    while (this.vehicles.length < target) this._addVehicle();
    while (this.vehicles.length > target) { const v = this.vehicles.pop(); this.scene.remove(v.mesh); }
  }
  _addVehicle() {
    const r = Math.random();
    const kind = r < 0.46 ? 'car' : r < 0.6 ? 'taxi' : r < 0.76 ? 'bike' : r < 0.88 ? 'lorry' : 'bus';
    const { mesh, len } = makeVehicle(kind);
    this.scene.add(mesh);
    const speed = { car: 11, taxi: 11, bike: 14, lorry: 8, bus: 7.5 }[kind];
    const ag = {
      mesh, len, group: 'veh', kind, yBase: 0,
      node: this._randomRoadNode(), prev: null, next: null, dir: null,
      p: 0, phase: 0, speed: speed * (0.85 + Math.random() * 0.3),
      lane: 0.46, margin: 1.5, animK: 1,
    };
    this._pickEdge(ag);
    this.vehicles.push(ag);
  }

  // ---- pedestrians (level-of-detail: only when zoomed in) ------------------
  _updatePeople(dt) {
    const near = this.cam.radius < 150;
    if (near && !this.peopleOn) this._spawnPeople();
    if (!near && this.peopleOn) this._clearPeople();
    if (this.peopleOn) {
      // recycle anyone who wandered out of view back near the camera
      const reach = Math.max(this.cam.radius * 1.3, 90);
      for (const ag of this.people) {
        const w = cornerToWorld(ag.node[0], ag.node[1]);
        if (Math.hypot(w.x - this.target.x, w.z - this.target.z) > reach) {
          const nodes = this._roadNodesNear(this.cam.radius);
          ag.node = nodes[Math.floor(Math.random() * nodes.length)].slice();
          ag.prev = null; this._pickEdge(ag);
        }
      }
      this._advanceAgents(this.people, dt);
      // out come the umbrellas when it rains
      const rainy = (this.weather.rain || 0) > 0.35;
      if (rainy !== this._umbrellasOut) {
        this._umbrellasOut = rainy;
        for (const ag of this.people) ag.mesh.userData.umbrella.visible = rainy;
      }
    }
  }
  _spawnPeople() {
    this.peopleOn = true;
    const nodes = this._roadNodesNear(this.cam.radius);
    const count = Math.min(42, Math.max(12, Math.floor((this.state?.population || 0) / 12000)));
    while (this.people.length < count) {
      const kinds = ['man', 'woman', 'man', 'woman', 'child', 'elderly'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const { mesh, len } = makePerson(kind);
      this.scene.add(mesh);
      const speed = { man: 2.7, woman: 2.5, child: 2.4, elderly: 1.6 }[kind];
      const ag = {
        mesh, len, group: 'ped', kind, yBase: 0,
        node: nodes[Math.floor(Math.random() * nodes.length)].slice(), prev: null, next: null, dir: null,
        p: 0, phase: Math.random() * 6, speed, lane: (Math.random() < 0.5 ? 1 : -1) * 1.35,
        margin: 0.5, animK: 5.5,
      };
      this._pickEdge(ag);
      this.people.push(ag);
    }
    for (const ag of this.people) {
      ag.mesh.visible = true;
      ag.mesh.userData.umbrella.visible = !!this._umbrellasOut;
    }
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
        a.group.position.y = -k * 2;
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

    // traffic — density scales with population
    if (this.state) {
      const target = THREE.MathUtils.clamp(Math.floor(this.state.population / 30000), 5, 55);
      this._ensureVehicles(target);
      this._advanceAgents(this.vehicles, dt);
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

export function makeBuilding(key, theme) {
  const b = BUILDINGS[key];
  const g = new THREE.Group();
  const tint = b.customizable && theme ? (typeof theme === 'string' ? parseInt(theme.slice(1), 16) : theme) : null;
  const col = tint != null ? tint : parseInt((b.color || '#888888').slice(1), 16);
  const cat = b.cat;
  const rnd = (a, bb) => a + Math.random() * (bb - a);

  if (cat === 'residential') {
    if (key === 'kampong') {
      lawn(g, 9, 9, 0x8aa15a);
      for (const [dx, dz] of [[-2.2, -1.5], [1.8, -2], [0, 1.8], [2.4, 1.6]]) {
        g.add(partBox(2.4, 1.8, 2.8, mat(0xb89b6a), dx, 0.9, dz));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.3, 4), mat(0x7a5a36));
        roof.position.set(dx, 2.4, dz); roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
      }
      treeAt(g, -3, 2.6, 1.1); treeAt(g, 3, -3, 0.9);
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
    if (key === 'hospital') {
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
function makeVehicle(kind) {
  const g = new THREE.Group();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const glass = 0x2b3b48, dark = 0x15171c;
  const wheel = (x, z, r = 0.34) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.28, 10), mat(dark));
    w.rotation.z = Math.PI / 2; w.position.set(x, r, z); w.castShadow = true; return w;
  };
  if (kind === 'bus') {
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
function makeBoat(cargo) {
  const g = new THREE.Group();
  if (cargo) {
    g.add(partBox(3.0, 1.4, 9.0, mat(0x37424d), 0, 0, 0));          // hull
    g.add(partBox(2.4, 1.0, 2.0, mat(0xeceff1), 0, 1.1, -3.0));     // bridge
    const cc = [0xd84141, 0x3f7fd8, 0x4caf50, 0xf2b134];
    for (let i = 0; i < 6; i++) g.add(partBox(0.9, 0.8, 1.6, mat(cc[i % 4]), (i % 2 ? 0.7 : -0.7), 1.0, 1.6 - (i >> 1) * 1.7));
  } else {
    g.add(partBox(1.6, 0.8, 4.2, mat(0xfafafa), 0, 0, 0));
    g.add(partBox(1.2, 0.7, 1.6, mat(0x4a6fa5), 0, 0.7, -0.4));
    g.add(cyl(0.05, 0.05, 1.4, mat(0xcfd3d6), 0, 1.4, 0.2));
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
