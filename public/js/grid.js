// Top-down tile renderer for the city grid, with pan/zoom and tap-to-place.
import { BUILDINGS, GRID_SIZE } from './data.js';

const TILE = 48; // base tile size in world units

export class CityView {
  constructor(canvas, { onTileTap } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTileTap = onTileTap;
    this.state = null;

    // camera
    this.scale = 1;
    this.minScale = 0.5;
    this.maxScale = 2.4;
    this.offset = { x: 0, y: 0 };
    this.hover = null;          // {x,y} tile under cursor (for placement preview)
    this.previewKey = null;     // building key being placed
    this.bulldoze = false;
    this.shortages = { power: false, water: false };

    this._pointers = new Map();
    this._lastPinchDist = 0;
    this._dragging = false;
    this._moved = false;
    this._dragStart = null;

    this._bindEvents();
    this.resize();
    this.centerCamera();
  }

  setState(state) { this.state = state; }
  setPreview(key) { this.previewKey = key; this.bulldoze = false; }
  setBulldoze(on) { this.bulldoze = on; this.previewKey = null; }
  setShortages(s) { this.shortages = s; }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = rect.width;
    this.viewH = rect.height;
  }

  centerCamera() {
    const world = GRID_SIZE * TILE;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale,
      Math.min(this.viewW, this.viewH) / world * 1.05));
    this.offset.x = (this.viewW - world * this.scale) / 2;
    this.offset.y = (this.viewH - world * this.scale) / 2;
  }

  // ---- coordinate transforms ----
  screenToTile(sx, sy) {
    const wx = (sx - this.offset.x) / this.scale;
    const wy = (sy - this.offset.y) / this.scale;
    const x = Math.floor(wx / TILE);
    const y = Math.floor(wy / TILE);
    if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null;
    return { x, y };
  }

  _bindEvents() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, pos(e));
      this._dragging = true;
      this._moved = false;
      this._dragStart = pos(e);
    });

    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, p);

      if (this._pointers.size === 2) {
        // pinch zoom
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._lastPinchDist) {
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          this._zoomAt(mid, dist / this._lastPinchDist);
        }
        this._lastPinchDist = dist;
        this._moved = true;
        return;
      }

      if (this._dragging) {
        const dx = p.x - this._dragStart.x;
        const dy = p.y - this._dragStart.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this._moved = true;
        this.offset.x += p.x - (this._lastMove?.x ?? p.x);
        this.offset.y += p.y - (this._lastMove?.y ?? p.y);
      }
      this._lastMove = p;
      this.hover = this.screenToTile(p.x, p.y);
    });

    const end = (e) => {
      const p = pos(e);
      if (this._dragging && !this._moved && this._pointers.size <= 1) {
        const tile = this.screenToTile(p.x, p.y);
        if (tile && this.onTileTap) this.onTileTap(tile.x, tile.y);
      }
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._lastPinchDist = 0;
      if (this._pointers.size === 0) { this._dragging = false; this._lastMove = null; }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { this.hover = null; });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this._zoomAt(p, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  _zoomAt(center, factor) {
    const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const k = newScale / this.scale;
    this.offset.x = center.x - (center.x - this.offset.x) * k;
    this.offset.y = center.y - (center.y - this.offset.y) * k;
    this.scale = newScale;
  }

  // ---- rendering ----
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    // Sea / backdrop
    ctx.fillStyle = '#13314a';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (!this.state) return;
    const s = this.scale;
    const ts = TILE * s;
    const ox = this.offset.x, oy = this.offset.y;

    // Land base
    ctx.fillStyle = '#274b34';
    ctx.fillRect(ox, oy, GRID_SIZE * ts, GRID_SIZE * ts);

    // Grid + tiles
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const px = ox + x * ts, py = oy + y * ts;
        // grass checker
        ctx.fillStyle = (x + y) % 2 ? '#2c5239' : '#2a4f37';
        ctx.fillRect(px, py, ts, ts);

        const cell = this.state.grid[y]?.[x];
        if (cell) this._drawBuilding(ctx, cell.k, px, py, ts);
      }
    }

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(ox + i * ts, oy); ctx.lineTo(ox + i * ts, oy + GRID_SIZE * ts); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * ts); ctx.lineTo(ox + GRID_SIZE * ts, oy + i * ts); ctx.stroke();
    }

    // Hover / placement preview
    if (this.hover) {
      const px = ox + this.hover.x * ts, py = oy + this.hover.y * ts;
      const occupied = !!this.state.grid[this.hover.y]?.[this.hover.x];
      if (this.bulldoze) {
        ctx.fillStyle = occupied ? 'rgba(229,57,53,0.45)' : 'rgba(229,57,53,0.15)';
        ctx.fillRect(px, py, ts, ts);
      } else if (this.previewKey) {
        ctx.globalAlpha = 0.55;
        if (!occupied) this._drawBuilding(ctx, this.previewKey, px, py, ts);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = occupied ? '#e53935' : '#7CFC00';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
      }
    }
  }

  _drawBuilding(ctx, key, px, py, ts) {
    const b = BUILDINGS[key];
    if (!b) return;
    const pad = ts * 0.08;
    const r = Math.max(2, ts * 0.12);
    // body
    ctx.fillStyle = b.color || '#888';
    roundRect(ctx, px + pad, py + pad, ts - pad * 2, ts - pad * 2, r);
    ctx.fill();
    // soft top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, px + pad, py + pad, ts - pad * 2, (ts - pad * 2) * 0.4, r);
    ctx.fill();
    // icon
    if (ts > 22) {
      ctx.font = `${Math.floor(ts * 0.5)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon || '⬛', px + ts / 2, py + ts / 2 + 1);
    }
    // shortage indicators
    const dot = (color, ix) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px + ts - pad - 4 - ix * 9, py + pad + 5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    };
    let i = 0;
    if (this.shortages.power && b.power < 0) dot('#ffb300', i++);
    if (this.shortages.water && b.water < 0) dot('#29b6f6', i++);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
