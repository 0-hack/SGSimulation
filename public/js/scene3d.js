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

// grid cell (gx,gy) -> world centre
function cellToWorld(gx, gy) {
  const nx = (gx + 0.5) / N, ny = (gy + 0.5) / N;
  return { x: (nx - 0.5) * WORLD, z: (0.5 - ny) * WORLD };
}

export class Scene3D {
  constructor(canvas, { onTileTap } = {}) {
    this.canvas = canvas;
    this.onTileTap = onTileTap;
    this.state = null;
    this.land = landMask(N);
    this.buildings = new Map();   // "x,y" -> { group, key }
    this.anims = [];              // active construction/demolition tweens
    this.cars = [];
    this.dust = [];
    this.previewKey = null;
    this.bulldoze = false;
    this.shortages = { power: false, water: false };
    this.ghost = null;
    this.hoverCell = null;
    this.disaster = null;
    this.people = [];            // pedestrians (shown when zoomed in)
    this.peopleOn = false;
    this.timeOfDay = 0.36;       // 0=midnight, .25=sunrise, .5=noon, .75=sunset
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
    this.fog = new THREE.FogExp2(0x9fc6e0, 0.0009);
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
    const seaMat = new THREE.MeshStandardMaterial({
      color: 0x1e6fa0, transparent: true, opacity: 0.92, roughness: 0.25, metalness: 0.1,
    });
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    sea.receiveShadow = false;
    this.sea = sea;
    scene.add(sea);

    this._buildIsland();
    this._buildRoads();

    // Flood plane (hidden until a flood event)
    const flood = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4),
      new THREE.MeshStandardMaterial({ color: 0x2a86c4, transparent: true, opacity: 0.55, roughness: 0.2 }),
    );
    flood.rotation.x = -Math.PI / 2;
    flood.position.y = SEA_Y;
    flood.visible = false;
    this.floodPlane = flood;
    scene.add(flood);

    this.rain = null;
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
    geo.translate(0, -depth, 0); // top surface at y = 0
    const mat = new THREE.MeshStandardMaterial({ color: 0x6ab04c, roughness: 0.95, metalness: 0 });
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
    beachGeo.translate(0, -0.4, 0);
    const beach = new THREE.Mesh(beachGeo, new THREE.MeshStandardMaterial({ color: 0xdcc89a, roughness: 1 }));
    beach.scale.set(1.04, 1, 1.04);
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

  // Faint road grid over land cells; cars drive along these lines.
  _buildRoads() {
    const pos = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        if (!this.land[gy][gx]) continue;
        const c = cellToWorld(gx, gy);
        const h = 0.06;
        // short cross of road at each land cell, connecting to neighbours
        if (gx + 1 < N && this.land[gy][gx + 1]) {
          const c2 = cellToWorld(gx + 1, gy);
          pos.push(c.x, h, c.z, c2.x, h, c2.z);
        }
        if (gy + 1 < N && this.land[gy + 1][gx]) {
          const c2 = cellToWorld(gx, gy + 1);
          pos.push(c.x, h, c.z, c2.x, h, c2.z);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const roads = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3a3f45, transparent: true, opacity: 0.5 }));
    this.scene.add(roads);
  }

  // ---- camera controls (orbit / pan / pinch) --------------------------------
  _initControls() {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    this.target = new THREE.Vector3(0, 0, 0);
    this.cam = { radius: 190, theta: -0.7, phi: 0.92 };
    this.MIN_R = 28;             // street-level zoom
    this.MAX_R = 560;
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
      this.cam.phi = THREE.MathUtils.clamp(this.cam.phi - dy * 0.005, 0.15, 1.45);
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
    const lim = WORLD * 0.7;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -lim, lim);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -lim, lim);
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
  setPreview(key) {
    this.previewKey = key; this.bulldoze = false;
    this._makeGhost(key);
  }
  setBulldoze(on) {
    this.bulldoze = on; this.previewKey = null;
    this._makeGhost(null);
  }

  _makeGhost(key) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (!key) return;
    const g = makeBuilding(key);
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
        if (cell) this._addMesh(x, y, cell.k, false);
      }
    }
  }

  _addMesh(x, y, key, animate) {
    const id = `${x},${y}`;
    if (this.buildings.has(id)) this.removeBuilding(x, y, false);
    const b = BUILDINGS[key];
    const group = makeBuilding(key);
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
  onBuilt(x, y, key) { this._addMesh(x, y, key, true); }

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

  // ---- traffic --------------------------------------------------------------
  _ensureCars(target) {
    while (this.cars.length < target) this._addCar();
    while (this.cars.length > target) { const c = this.cars.pop(); this.scene.remove(c.mesh); }
  }
  _landCellsList() {
    if (this._landList) return this._landList;
    const list = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (this.land[y][x]) list.push([x, y]);
    this._landList = list;
    return list;
  }
  _addCar() {
    const colors = [0xff5252, 0xffffff, 0x42a5f5, 0xffca28, 0x66bb6a];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.4, 4.2),
      new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.5 }),
    );
    mesh.castShadow = true;
    const list = this._landCellsList();
    const [sx, sy] = list[Math.floor(Math.random() * list.length)];
    this.scene.add(mesh);
    const car = { mesh, cell: [sx, sy], next: null, p: 0, speed: 7 + Math.random() * 5, lane: (Math.random() - 0.5) * 3 };
    this._pickNext(car);
    this.cars.push(car);
  }
  _pickNext(car) {
    const [x, y] = car.cell;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.isLand(x + dx, y + dy));
    if (!dirs.length) { car.next = null; return; }
    // prefer continuing straight
    let choice = dirs[Math.floor(Math.random() * dirs.length)];
    if (car.dir && Math.random() < 0.7) {
      const straight = dirs.find(([dx, dy]) => dx === car.dir[0] && dy === car.dir[1]);
      if (straight) choice = straight;
    }
    car.dir = choice;
    car.next = [x + choice[0], y + choice[1]];
    car.p = 0;
  }
  _updateCars(dt) {
    for (const car of this.cars) {
      if (!car.next) { this._pickNext(car); continue; }
      car.p += dt * car.speed / TILE;
      const a = cellToWorld(car.cell[0], car.cell[1]);
      const b = cellToWorld(car.next[0], car.next[1]);
      if (car.p >= 1) { car.cell = car.next; this._pickNext(car); continue; }
      const px = a.x + (b.x - a.x) * car.p;
      const pz = a.z + (b.z - a.z) * car.p;
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      // offset to the right lane
      car.mesh.position.set(px + Math.cos(ang) * car.lane, 1.0, pz - Math.sin(ang) * car.lane);
      car.mesh.rotation.y = ang;
    }
  }

  // ---- disasters ------------------------------------------------------------
  playDisaster(type) {
    if (type === 'flood' || type === 'storm') {
      this.disaster = { type: 'flood', t: 0, dur: 10, peak: type === 'flood' ? 5 : 2.5 };
      this.floodPlane.visible = true;
      this._startRain();
    } else if (type === 'haze') {
      this.disaster = { type: 'haze', t: 0, dur: 12 };
    } else if (type === 'quake') {
      this.disaster = { type: 'quake', t: 0, dur: 2.2 };
    }
  }
  _startRain() {
    if (this.rain) return;
    const count = 1400;
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * WORLD * 1.3;
      p[i * 3 + 1] = Math.random() * 160;
      p[i * 3 + 2] = (Math.random() - 0.5) * WORLD * 1.3;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaaccee, size: 1.3, transparent: true, opacity: 0.7 }));
    this.scene.add(this.rain);
  }
  _stopRain() { if (this.rain) { this.scene.remove(this.rain); this.rain = null; } }

  _updateDisaster(dt) {
    const d = this.disaster;
    if (!d) return;
    d.t += dt;
    const k = d.t / d.dur;
    if (d.type === 'flood') {
      // rise then recede
      const lvl = Math.sin(Math.min(k, 1) * Math.PI);
      this.floodPlane.position.y = SEA_Y + lvl * d.peak;
      this.floodPlane.material.opacity = 0.35 + lvl * 0.3;
      if (this.rain) {
        const arr = this.rain.geometry.attributes.position.array;
        for (let i = 1; i < arr.length; i += 3) { arr[i] -= dt * 140; if (arr[i] < 0) arr[i] = 160; }
        this.rain.geometry.attributes.position.needsUpdate = true;
        this.rain.material.opacity = 0.7 * (1 - Math.max(0, k - 0.7) / 0.3);
      }
      if (k >= 1) { this.floodPlane.visible = false; this._stopRain(); this.disaster = null; }
    } else if (d.type === 'haze') {
      const intensity = Math.sin(Math.min(k, 1) * Math.PI);
      this.fog.density = 0.0009 + intensity * 0.006;
      const haze = new THREE.Color(0x9fc6e0).lerp(new THREE.Color(0xb59b6a), intensity);
      this.scene.background = haze; this.fog.color = haze;
      if (k >= 1) { this.fog.density = 0.0009; this.scene.background = this.skyColor.clone(); this.fog.color.set(0x9fc6e0); this.disaster = null; }
    } else if (d.type === 'quake') {
      const a = (1 - k) * 1.4;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (k >= 1) this.disaster = null;
    }
  }

  // ---- day / night cycle ----------------------------------------------------
  _updateDayNight(dt) {
    if (!this.disaster || this.disaster.type !== 'haze') {
      this.timeOfDay = (this.timeOfDay + dt / 120) % 1; // ~2 min per full day
    }
    const elev = Math.sin(2 * Math.PI * (this.timeOfDay - 0.25)); // -1..1
    const dayness = THREE.MathUtils.clamp((elev + 0.18) / 0.5, 0, 1);
    const horizon = THREE.MathUtils.clamp(1 - Math.abs(elev) / 0.28, 0, 1);
    this.nightFactor = 1 - dayness;

    // Sun position along an arc; keep a little fill at night for moonlight.
    const a = 2 * Math.PI * (this.timeOfDay - 0.25);
    this.sun.position.set(Math.cos(a) * 200, Math.max(12, elev * 260), 90 + Math.sin(a) * 60);
    this.sun.intensity = 0.18 + dayness * 1.15;
    const sunCol = new THREE.Color(0xfff4e0).lerp(new THREE.Color(0xff8a3c), horizon * (1 - dayness * 0.5));
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0x9fb6ff), this.nightFactor * 0.6);
    this.hemi.intensity = 0.22 + dayness * 0.7;

    // Sky + fog colour: night → day, with a sunrise/sunset glow at the horizon.
    const night = new THREE.Color(0x0c1830), day = new THREE.Color(0x8ec5e8);
    const sky = night.clone().lerp(day, dayness).lerp(new THREE.Color(0xf2935a), horizon * 0.6 * (1 - dayness * 0.3));
    if (!(this.disaster && this.disaster.type === 'haze')) {
      this.scene.background = sky; this.fog.color.copy(sky);
    }
    this.skyColor = sky.clone();

    // City lights: buildings glow warm at night.
    const glow = this.nightFactor;
    for (const m of MAT.values()) {
      if (!m.__glow) { m.emissive = new THREE.Color(0xffca6a); m.__glow = true; }
      m.emissiveIntensity = glow * 0.55;
    }
  }

  // ---- development: skyline grows taller & denser as the nation matures ----
  _updateDevelopment(dt) {
    if (!this.state) return;
    const pop = this.state.population || 0;
    const edu = this.state.education || 20;
    const target = 1
      + THREE.MathUtils.clamp((pop - 80000) / 1_600_000, 0, 1) * 0.5   // size of nation
      + THREE.MathUtils.clamp((edu - 20) / 80, 0, 1) * 0.28;           // sophistication
    this.devFactor += (target - this.devFactor) * Math.min(1, dt * 0.5);

    // Ease each "tall" building toward the current development height.
    for (const entry of this.buildings.values()) {
      if (entry.anim) continue;                 // don't fight build/demolish tweens
      const want = entry.tall ? this.devFactor : 1;
      const s = entry.group.scale;
      s.y += (want - s.y) * Math.min(1, dt * 0.8);
    }
  }

  // ---- pedestrians (level-of-detail: only when zoomed in) ------------------
  _updatePeople(dt) {
    const near = this.cam.radius < 150;
    if (near && !this.peopleOn) this._spawnPeople();
    if (!near && this.peopleOn) this._clearPeople();
    if (!this.peopleOn) return;

    const reach = this.cam.radius * 0.9;
    for (const pr of this.people) {
      if (!pr.next) { this._pickPersonStep(pr, reach); continue; }
      pr.p += dt * pr.speed / TILE;
      const a = cellToWorld(pr.cell[0], pr.cell[1]);
      const b = cellToWorld(pr.next[0], pr.next[1]);
      if (pr.p >= 1) { pr.cell = pr.next; this._pickPersonStep(pr, reach); continue; }
      const ang = Math.atan2(b.x - a.x, b.z - a.z);
      const px = a.x + (b.x - a.x) * pr.p + Math.cos(ang) * pr.lane;
      const pz = a.z + (b.z - a.z) * pr.p - Math.sin(ang) * pr.lane;
      pr.mesh.position.set(px, 0, pz);
      pr.mesh.rotation.y = ang;
      pr.mesh.children[0].position.y = 1.2 + Math.abs(Math.sin(pr.p * Math.PI * 8)) * 0.2; // walking bob
    }
  }
  _spawnPeople() {
    this.peopleOn = true;
    const cells = this._cellsNearTarget(this.cam.radius);
    if (!cells.length) return;
    const count = Math.min(60, Math.max(12, Math.floor((this.state?.population || 0) / 9000)));
    while (this.people.length < count) {
      const [x, y] = cells[Math.floor(Math.random() * cells.length)];
      this.people.push(this._makePerson(x, y));
    }
    for (const pr of this.people) { pr.mesh.visible = true; }
  }
  _clearPeople() {
    this.peopleOn = false;
    for (const pr of this.people) pr.mesh.visible = false;
  }
  _makePerson(x, y) {
    const g = new THREE.Group();
    const shirts = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xffffff, 0xe67e22];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.4, 3, 6), mat(shirts[Math.floor(Math.random() * shirts.length)]));
    body.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(0xf0c9a0));
    head.position.y = 2.4;
    g.add(body); g.add(head);
    const c = cellToWorld(x, y);
    g.position.set(c.x, 0, c.z);
    this.scene.add(g);
    const pr = { mesh: g, cell: [x, y], next: null, p: 0, speed: 2.2 + Math.random() * 1.6, lane: (Math.random() - 0.5) * 4, dir: null };
    this._pickPersonStep(pr, this.cam.radius);
    return pr;
  }
  _pickPersonStep(pr, reach) {
    const [x, y] = pr.cell;
    // wander back toward the camera target if they've strayed too far
    const c = cellToWorld(x, y);
    if (Math.hypot(c.x - this.target.x, c.z - this.target.z) > reach * 1.4) {
      const cells = this._cellsNearTarget(this.cam.radius);
      if (cells.length) { const [nx, ny] = cells[Math.floor(Math.random() * cells.length)]; pr.cell = [nx, ny]; }
    }
    let dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this._walkable(pr.cell[0] + dx, pr.cell[1] + dy));
    if (!dirs.length) dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => this.isLand(pr.cell[0] + dx, pr.cell[1] + dy));
    if (!dirs.length) { pr.next = null; return; }
    let ch = dirs[Math.floor(Math.random() * dirs.length)];
    if (pr.dir && Math.random() < 0.6) { const s = dirs.find(([dx, dy]) => dx === pr.dir[0] && dy === pr.dir[1]); if (s) ch = s; }
    pr.dir = ch; pr.next = [pr.cell[0] + ch[0], pr.cell[1] + ch[1]]; pr.p = 0;
  }
  _cellsNearTarget(radius) {
    const walk = [], anyLand = [];
    const R = Math.max(radius, 60);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!this.land[y][x]) continue;
      const c = cellToWorld(x, y);
      if (Math.hypot(c.x - this.target.x, c.z - this.target.z) > R) continue;
      anyLand.push([x, y]);
      if (this._walkable(x, y)) walk.push([x, y]);
    }
    return walk.length ? walk : anyLand;
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
      const target = THREE.MathUtils.clamp(Math.floor(this.state.population / 2500), 4, 70);
      this._ensureCars(target);
      this._updateCars(dt);
    }

    // sea shimmer
    if (this.sea) this.sea.material.opacity = 0.9 + Math.sin(this.clock.elapsedTime * 1.5) * 0.03;

    this._updateDayNight(dt);
    this._updateDevelopment(dt);
    this._updatePeople(dt);
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
// Building meshes — stylised primitives per type.
// Each returned Group sits on the ground (y=0) and grows upward.
// ===========================================================================
const MAT = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!MAT.has(key)) MAT.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...opts }));
  return MAT.get(key);
}
function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.y = h / 2; m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(r, h, color, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color));
  m.position.y = h / 2; m.castShadow = true;
  return m;
}

export function makeBuilding(key) {
  const b = BUILDINGS[key];
  const g = new THREE.Group();
  const col = parseInt((b.color || '#888888').slice(1), 16);
  const cat = b.cat;

  if (cat === 'residential') {
    if (key === 'kampong') {
      g.add(box(6, 2.4, 6, 0x9c7a4d));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5, 2.6, 4), mat(0x6b4f2a));
      roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    } else {
      const h = key === 'hdb_newtown' ? 24 : key === 'condo' ? 20 : 16;
      const w = key === 'hdb_newtown' ? 7 : 6;
      g.add(box(w, h, w, col, key === 'condo' ? { metalness: 0.4, roughness: 0.3 } : {}));
      const cap = box(w + 0.6, 1, w + 0.6, 0xffffff); cap.position.y = h; g.add(cap);
    }
  } else if (cat === 'power') {
    if (key === 'solar_farm') {
      g.add(box(8, 0.6, 8, 0x335a2f));
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.8), mat(0x16263b, { metalness: 0.6, roughness: 0.2 }));
        p.position.set(i * 2.6, 1.4, j * 2.8); p.rotation.x = -0.5; p.castShadow = true; g.add(p);
      }
    } else {
      g.add(box(8, 5, 8, col));
      const chimneys = key === 'power_station' ? 2 : 1;
      for (let i = 0; i < chimneys; i++) {
        const ch = cyl(1, 10, 0xbcbcbc); ch.position.set(i * 3 - (chimneys - 1) * 1.5, 5 + 5, i * 2 - 1); g.add(ch);
        const cap = cyl(1.2, 1, 0x884422); cap.position.set(ch.position.x, 15.2, ch.position.z); g.add(cap);
      }
    }
  } else if (cat === 'water') {
    if (key === 'reservoir') {
      const water = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.6, 20), mat(0x3a86c8, { metalness: 0.3, roughness: 0.2 }));
      water.position.y = 0.4; g.add(water);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(5, 0.5, 8, 24), mat(0x6a8a4a));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.5; g.add(rim);
    } else {
      g.add(box(8, 3, 8, 0x9aa6ad));
      const tanks = key === 'desal' ? 3 : 2;
      for (let i = 0; i < tanks; i++) { const t = cyl(1.8, 6, col); t.position.set(i * 4 - (tanks - 1) * 2, 0, 1.5); g.add(t); }
    }
  } else if (cat === 'industry') {
    if (key === 'office') {
      g.add(box(7, 26, 7, col, { metalness: 0.5, roughness: 0.2 }));
      const top = box(7.2, 1, 7.2, 0x88ccff, { metalness: 0.6 }); top.position.y = 26; g.add(top);
    } else if (key === 'port') {
      g.add(box(9, 1.2, 9, 0x6b7a86));
      for (const cx of [-2.5, 2.5]) {
        const crane = box(0.6, 14, 0.6, 0xffb300); crane.position.set(cx, 0, -2); g.add(crane);
        const arm = box(0.6, 0.6, 8, 0xffb300); arm.position.set(cx, 13.5, 1); g.add(arm);
      }
      const cont = [0xd84141, 0x3f7fd8, 0x4caf50, 0xffb300];
      for (let i = 0; i < 5; i++) { const cb = box(2, 1.6, 4, cont[i % 4]); cb.position.set(2 + (i % 2) * 2.2, (Math.floor(i / 2)) * 1.6, 3); g.add(cb); }
    } else if (key === 'tourism') {
      g.add(box(9, 6, 9, col));
      for (const dx of [-3, 0, 3]) { const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe6b3d8, { metalness: 0.4 })); dome.position.set(dx, 6, 0); dome.castShadow = true; g.add(dome); }
    } else { // factory
      g.add(box(8, 5, 8, col));
      const ch = cyl(1, 8, 0xb0b0b0); ch.position.set(2.5, 5, 2.5); g.add(ch);
      const saw = box(8, 1.4, 8, 0x8a6f55); saw.position.y = 5; g.add(saw);
    }
  } else if (cat === 'civic') {
    if (key === 'hospital') {
      g.add(box(8, 8, 8, 0xf2f2f2));
      const v = box(1.4, 4, 0.6, 0xe53935); v.position.y = 8 - 2 + 0.3 + 4; v.position.set(0, 6, 4.1); g.add(v);
      const hbar = box(4, 1.4, 0.6, 0xe53935); hbar.position.set(0, 6, 4.1); g.add(hbar);
    } else if (key === 'mrt') {
      for (const px of [-3, 3]) { const pil = box(1, 5, 1, 0xbdbdbd); pil.position.set(px, 0, 0); g.add(pil); }
      const deck = box(9, 1, 4, 0x9e9e9e); deck.position.y = 5.5; g.add(deck);
      const train = box(8, 2.2, 3, col); train.position.y = 7.1; g.add(train);
    } else if (key === 'school') {
      g.add(box(9, 4, 7, col));
      const pole = cyl(0.2, 7, 0xcccccc); pole.position.set(4, 4, 3); g.add(pole);
      const flag = box(2, 1.2, 0.1, 0xe53935); flag.position.set(5, 9.5, 3); g.add(flag);
    } else { // police
      g.add(box(7, 5, 7, col));
      const light = box(1, 0.8, 1, 0x2244ff); light.position.y = 5; g.add(light);
    }
  } else if (cat === 'green') {
    if (key === 'gardens') {
      g.add(new THREE.Mesh(new THREE.CircleGeometry(6, 18), mat(0x4f9e3a)).rotateX(-Math.PI / 2));
      for (const [dx, dz, h, c] of [[-2, -1, 14, 0xa64ca6], [2, 1, 18, 0x6a3d9a], [0, 3, 12, 0xc06cc0]]) {
        const trunk = cyl(0.8, h, 0x6b4f2a); trunk.position.set(dx, 0, dz); g.add(trunk);
        const top = new THREE.Mesh(new THREE.ConeGeometry(3, 5, 8), mat(c)); top.position.set(dx, h, dz); top.castShadow = true; g.add(top);
      }
    } else { // park
      const ground = new THREE.Mesh(new THREE.CircleGeometry(5, 16), mat(0x5bbf6a)); ground.rotation.x = -Math.PI / 2; ground.position.y = 0.05; g.add(ground);
      for (const [dx, dz] of [[-2, -1], [2, 1], [0, 2.5], [-2.5, 2]]) {
        const trunk = cyl(0.4, 2.2, 0x6b4f2a); trunk.position.set(dx, 0, dz); g.add(trunk);
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.4, 8), mat(0x3f9e3a)); leaf.position.set(dx, 2.4, dz); leaf.castShadow = true; g.add(leaf);
      }
    }
  } else {
    g.add(box(6, 6, 6, col));
  }
  return g;
}
