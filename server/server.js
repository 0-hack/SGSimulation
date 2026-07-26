// Centralized world server for SGSimulation.
// Serves the static game client and exposes a small REST API for saving,
// loading, browsing, and visiting other players' worlds.
import express from 'express';
import { randomUUID, randomBytes, createHash, timingSafeEqual, scryptSync } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';
import { dbApi, buildsApi, usersApi } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '8mb' })); // city states can get large

// ---- helpers ---------------------------------------------------------------

const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const newToken = () => randomBytes(24).toString('hex');

// Compare a presented token against the stored hash WITHOUT leaking how much of it
// matched through timing. (A 192-bit token makes guessing hopeless anyway, but a
// plain !== on the digest is the kind of thing that rots into a real leak later.)
function tokenMatches(presented, storedHash) {
  if (!presented || !storedHash) return false;
  const a = Buffer.from(hash(presented), 'utf8');
  const b = Buffer.from(String(storedHash), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Throttle world mutations per client so a stolen/guessed-at endpoint can't be
// hammered: a token can't be brute-forced at 30 tries a minute, and one client
// can't spam-create worlds. In-memory and best-effort — this is a game server, not
// a bank, but it turns "unbounded" into "bounded".
const RL_WINDOW = 60_000, RL_MAX = 30;
const rlHits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let hits = rlHits.get(ip);
  if (!hits) { hits = []; rlHits.set(ip, hits); }
  while (hits.length && now - hits[0] > RL_WINDOW) hits.shift();
  if (hits.length >= RL_MAX) return res.status(429).json({ error: 'Too many requests — slow down.' });
  hits.push(now);
  if (rlHits.size > 5000) for (const [k, v] of rlHits) if (!v.length || now - v[v.length - 1] > RL_WINDOW) rlHits.delete(k);
  next();
}

// ---- accounts ---------------------------------------------------------------
// Passwords are stored as scrypt(salt, password) — never the password itself, and
// never a bare hash (scrypt is deliberately slow + memory-hard, so a stolen table
// can't be run through a GPU dictionary). Node ships it, so no new dependency.
const SESSION_TTL = 1000 * 60 * 60 * 24 * 120;    // 120 days signed in
const SESSION_COOKIE = 'sg_sess';

function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(String(pw), salt, 64).toString('hex');
}
function passwordMatches(pw, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(String(pw), salt, a.length);
  return a.length === b.length && timingSafeEqual(a, b);
}
// Tiny cookie reader — avoids pulling in cookie-parser for one header.
function readCookie(req, name) {
  const raw = req.headers.cookie; if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  // HttpOnly: script can't read it, so an XSS can't lift the login the way it could
  // lift a token kept in localStorage. Lax: sent on normal navigation, not cross-site posts.
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}
// The signed-in user for this request, or null.
function currentUser(req) {
  const tok = readCookie(req, SESSION_COOKIE); if (!tok) return null;
  const sess = usersApi.session(hash(tok)); if (!sess) return null;
  const u = usersApi.byId(sess.user_id);
  return u ? { id: u.id, username: u.username } : null;
}
// May this request edit this world? An ACCOUNT that owns it, or — for nations made
// before accounts existed, which have no user_id — the world's original edit token.
function mayEdit(req, row) {
  const u = currentUser(req);
  if (u && row.user_id && row.user_id === u.id) return { ok: true, user: u };
  if (row.user_id) {
    // owned by an account: the legacy token alone must NOT be enough any more
    return { ok: false, user: u, reason: 'This nation belongs to an account — sign in as its owner.' };
  }
  const token = req.get('x-world-token') || req.body?.token;
  if (tokenMatches(token, row.token)) return { ok: true, user: u, viaToken: true };
  return { ok: false, user: u, reason: 'Invalid edit token for this world.' };
}
const VALID_NAME = /^[a-zA-Z0-9_.-]{3,24}$/;

function clampName(s, fallback) {
  const v = (typeof s === 'string' ? s : '').trim().slice(0, 60);
  return v || fallback;
}

// Basic sanity check that the posted state is a plausible game state object.
function validState(state) {
  return state && typeof state === 'object' && state.summary && typeof state.summary === 'object';
}

// ---- API -------------------------------------------------------------------

const api = express.Router();

// ---- auth: sign up / sign in / who am I / my nations -------------------------
const authOk = (res, user) => res.json({ user });

api.post('/auth/signup', rateLimit, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!VALID_NAME.test(username)) return res.status(400).json({ error: 'Username must be 3–24 characters: letters, numbers, . _ or -' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (usersApi.byName(username)) return res.status(409).json({ error: 'That username is taken.' });
  const user = usersApi.create({ id: randomUUID(), username, pass: hashPassword(password) });
  const tok = newToken();
  usersApi.startSession({ tokenHash: hash(tok), userId: user.id, ttlMs: SESSION_TTL });
  setSessionCookie(req, res, tok);
  authOk(res, user);
});

api.post('/auth/login', rateLimit, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const row = usersApi.byName(username);
  // Same message either way, so this can't be used to enumerate who has an account.
  if (!row || !passwordMatches(password, row.pass)) return res.status(401).json({ error: 'Wrong username or password.' });
  const tok = newToken();
  usersApi.startSession({ tokenHash: hash(tok), userId: row.id, ttlMs: SESSION_TTL });
  setSessionCookie(req, res, tok);
  authOk(res, { id: row.id, username: row.username });
});

api.post('/auth/logout', (req, res) => {
  const tok = readCookie(req, SESSION_COOKIE);
  if (tok) usersApi.endSession(hash(tok));
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get('/auth/me', (req, res) => res.json({ user: currentUser(req) }));

// Every nation on this account — this is how a player gets back into their game.
api.get('/auth/worlds', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ worlds: usersApi.worldsOf(u.id) });
});

// Adopt a pre-accounts nation into this account, proving ownership with its token.
api.post('/worlds/:id/claim', rateLimit, (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Sign in first.' });
  const row = dbApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'World not found.' });
  if (row.user_id && row.user_id !== u.id) return res.status(403).json({ error: 'That nation already belongs to another account.' });
  if (!row.user_id && !tokenMatches(req.get('x-world-token') || req.body?.token, row.token)) {
    return res.status(403).json({ error: 'Invalid edit token for this world.' });
  }
  usersApi.claimWorld(row.id, u.id);
  res.json({ ok: true, id: row.id });
});

// Create a new world. Returns the world id + a secret edit token.
api.post('/worlds', rateLimit, (req, res) => {
  const { name, owner, state, isPublic } = req.body || {};
  if (!validState(state)) return res.status(400).json({ error: 'Invalid game state.' });

  const me = currentUser(req);
  const id = randomUUID();
  const token = newToken();
  const world = dbApi.create({
    id,
    name: clampName(name, 'New Singapore'),
    owner: clampName(owner, me ? me.username : 'Anonymous'),
    token: hash(token),
    state,
    isPublic: isPublic !== false,
    userId: me ? me.id : null,
  });
  res.json({ ...world, token }); // token returned once, only to the creator
});

// Update an existing world. Requires the matching edit token.
api.put('/worlds/:id', rateLimit, (req, res) => {
  const row = dbApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'World not found.' });

  const perm = mayEdit(req, row);
  if (!perm.ok) return res.status(403).json({ error: perm.reason });
  const { name, owner, state, isPublic } = req.body || {};
  if (!validState(state)) return res.status(400).json({ error: 'Invalid game state.' });

  const world = dbApi.update(req.params.id, {
    name: clampName(name, row.name),
    owner: clampName(owner, row.owner),
    state,
    // omitting isPublic PRESERVES the world's current visibility — the old default
    // silently flipped a private world public on any save that forgot the flag.
    isPublic: isPublic === undefined ? !!row.is_public : isPublic === true,
  });
  res.json(world);
});

// Browse public worlds (summary metadata only).
api.get('/worlds', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  res.json(dbApi.listPublic({ limit, offset }));
});

// Load a full world (for resuming your own game OR visiting another player's).
api.get('/worlds/:id', (req, res) => {
  const world = dbApi.getFull(req.params.id);
  if (!world) return res.status(404).json({ error: 'World not found.' });
  res.json(world);
});

// Delete a world (requires edit token).
api.delete('/worlds/:id', rateLimit, (req, res) => {
  const row = dbApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'World not found.' });
  const perm = mayEdit(req, row);
  if (!perm.ok) return res.status(403).json({ error: perm.reason });
  dbApi.delete(req.params.id);
  res.json({ ok: true });
});

// ---- Community builds (custom buildings designed in the 3D designer & shared) --
const BUILD_FUNCS = ['house', 'economy', 'entertainment', 'power', 'water', 'civic', 'landmark'];
function validDesign(d) {
  return d && typeof d === 'object' && Array.isArray(d.parts) && d.parts.length > 0 && d.parts.length <= 400;
}
// A shared design's self-declared economy stats flow into every downloader's game,
// so clamp them to the range legit stock buildings occupy — otherwise one published
// build with homes:1e12 wrecks the simulation of everyone who downloads it.
const STAT_BOUNDS = {
  homes: [0, 12000], jobs: [0, 12000], power: [-600, 600], water: [-600, 600],
  pollution: [-40, 40], happiness: [-15, 15], income: [-60, 120], upkeep: [0, 120], safety: [-30, 30],
};
function sanitizeStats(d) {
  if (!d || typeof d.stats !== 'object' || !d.stats) return d;
  const st = {};
  for (const [k, [lo, hi]] of Object.entries(STAT_BOUNDS)) {
    const v = d.stats[k];
    if (typeof v === 'number' && isFinite(v)) st[k] = Math.min(hi, Math.max(lo, v));
  }
  return { ...d, stats: st };
}

// Publish a custom build to the community. Returns its id + a secret token (needed
// to delete it later). `design` carries the parts, chosen functionality, size etc.
api.post('/builds', (req, res) => {
  const { name, author, func, size, year, design } = req.body || {};
  if (!validDesign(design)) return res.status(400).json({ error: 'Invalid design (needs parts).' });
  const id = randomUUID();
  const token = newToken();
  const build = buildsApi.create({
    id,
    name: clampName(name, 'Custom Building'),
    author: clampName(author, 'Anonymous'),
    func: BUILD_FUNCS.includes(func) ? func : 'landmark',
    size: Math.min(Math.max(Number(size) || 1, 0.2), 6),
    year: Math.min(Math.max(parseInt(year, 10) || 1965, 1900), 2100),
    design: sanitizeStats(design),
    token: hash(token),
  });
  res.json({ ...build, token });
});

// Browse the community — sort=downloads (default) | recent, optional func filter.
api.get('/builds', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const sort = req.query.sort === 'recent' ? 'recent' : 'downloads';
  const func = BUILD_FUNCS.includes(req.query.func) ? req.query.func : null;
  res.json(buildsApi.list({ sort, func, limit, offset }));
});

// Full build (metadata + design parts) WITHOUT counting a download (for preview).
api.get('/builds/:id', (req, res) => {
  const b = buildsApi.getFull(req.params.id);
  if (!b) return res.status(404).json({ error: 'Build not found.' });
  res.json(b);
});

// Download a build to construct it in your game — counts toward its popularity.
api.post('/builds/:id/download', (req, res) => {
  const b = buildsApi.download(req.params.id);
  if (!b) return res.status(404).json({ error: 'Build not found.' });
  res.json(b);
});

// Delete a community build (requires the token returned when it was published).
api.delete('/builds/:id', rateLimit, (req, res) => {
  const row = buildsApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'Build not found.' });
  const token = req.get('x-build-token') || req.body?.token;
  if (!tokenMatches(token, row.token)) return res.status(403).json({ error: 'Invalid token.' });
  buildsApi.delete(req.params.id);
  res.json({ ok: true });
});

api.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

app.use('/api', api);

// ---- live map editing (the in-browser tracer) ------------------------------
// Lets public/trace.html apply traced corrections straight to the game's map
// data, and load the current network back for editing. Local-dev tool; disable
// with TRACE_EDIT=0 on a shared/public deployment.
// Read-only: the current game map layers, so the tracer can DISPLAY what's
// already in the game (roads/coast/reservoirs/railway/sands/airport) under each
// "show" filter. Safe — no writes — so it stays available even when live editing
// is disabled (TRACE_EDIT=0). The design list is read-only too.
app.get('/api/trace/current', async (_req, res) => {
  try {
    const { getGameLayers } = await import('../scripts/apply_trace.mjs');
    res.json(await getGameLayers());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A signature of the NON-road base map (coast, reservoir, sands, railway). The 3D
// scene builds these once at creation, so the game uses it to detect a base-map
// edit (tracer "Save to map") on New Game and reload to rebuild — roads refresh
// without a reload, so they're deliberately excluded here. Read-only, always on.
// Whether this server accepts base-map edits (TRACE_EDIT=1). The client uses this to
// HIDE the creator tooling — the Map Tracer nav link and the tracer's "Save to map"
// button — from ordinary players on servers where editing is off. Read-only, always on.
app.get('/api/trace/canedit', (_req, res) => res.json({ edit: process.env.TRACE_EDIT === '1' }));

let _mapsigCache = { key: null, sig: '' };
app.get('/api/trace/mapsig', async (_req, res) => {
  try {
    // Cache-busting imports permanently retain a fresh module copy per call, so key
    // the cached signature on the files' mtimes and only re-import after a real edit
    // (the tracer's Save-to-map rewrites these files) — not on every New Game.
    const { statSync } = await import('node:fs');
    const files = ['shape.js', 'custom1966.js', 'roads1966.js'].map((f) => new URL('../public/js/' + f, import.meta.url));
    const key = files.map((f) => { try { return statSync(f).mtimeMs; } catch { return 0; } }).join(':');
    if (key !== _mapsigCache.key) {
      const u = '?u=' + Date.now();
      const sh = await import('../public/js/shape.js' + u);
      const cu = await import('../public/js/custom1966.js' + u);
      const rd = await import('../public/js/roads1966.js' + u);
      _mapsigCache = { key, sig: hash(JSON.stringify([sh.SG_OUTLINE, sh.SG_ISLANDS, sh.SG_SANDS, cu.CUSTOM_SANDS, cu.CUSTOM_RAILWAYS, rd.RESERVOIRS_1966])) };
    }
    res.json({ sig: _mapsigCache.sig });
  } catch (e) { res.json({ sig: '' }); }
});

// NOTE: 3D-designed landmarks are now PER-PLAYER (stored in the player's browser
// and inside their saved game) — see public/js/landmarks.js. No server write is
// involved, so there's nothing to gate and nothing shared between players.

if (process.env.TRACE_EDIT === '1') {
  // POST a trace -> write it into the BASE 1966 map (shared by everyone). This is a
  // creator/dev action behind an EXPLICIT opt-in (TRACE_EDIT=1, e.g. in
  // docker-compose.yml) — the old fail-open default let any anonymous visitor of a
  // forgetfully-configured deployment rewrite the shared map.
  app.post('/api/trace/apply', async (req, res) => {
    try {
      const { applyTrace } = await import('../scripts/apply_trace.mjs');
      const body = req.body || {};
      // Apply FAITHFULLY (map exactly as drawn, no smoothing/de-jitter). When the
      // tracer sends the WHOLE map (body.full — its Export/Save now includes the
      // existing network too), REPLACE the road network with it; otherwise ADD the
      // traced roads to the existing network (incremental, non-destructive).
      const opts = body.full ? { faithful: true } : { faithful: true, mergeRoads: true };
      const did = await applyTrace(body, opts);
      res.json({ ok: true, did });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // Admin: replace the reference map image the tracer shows under the drawing
  // (served as /trace-map.jpg). Lets a future admin trace against a different or
  // updated scan. Gated with the rest of the trace-edit tooling.
  app.post('/api/trace/mapimg', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '20mb' }), (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ ok: false, error: 'No image received (send the file as the request body with an image content-type).' });
      // sanity: the payload must actually look like an image (magic bytes), not JSON/script
      const b = req.body;
      const isJpg = b[0] === 0xff && b[1] === 0xd8;
      const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
      const isWebp = b.length > 11 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
      if (!isJpg && !isPng && !isWebp) return res.status(400).json({ ok: false, error: 'Not a JPEG/PNG/WebP image.' });
      writeFileSync(join(PUBLIC_DIR, 'trace-map.jpg'), b);   // same path the tracer loads (browsers read content, not the extension)
      res.json({ ok: true, bytes: b.length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

// ---- static client ---------------------------------------------------------
// no-cache on HTML/JS/JSON so players always get the latest after an update
// (these are small; the browser still revalidates with ETag).
// The Map Tracer is creator tooling: when this server doesn't accept base-map edits
// (no TRACE_EDIT=1), the page and its assets aren't served at all — a typed URL
// lands back on the game instead of a read-only sandbox.
const TRACER_FILES = new Set(['/trace.html', '/trace-data.json', '/trace-map.jpg']);
app.use((req, res, next) => {
  if (process.env.TRACE_EDIT !== '1' && TRACER_FILES.has(req.path)) return res.redirect('/');
  next();
});
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, p) => { if (/\.(html|js|json)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); },
}));
// SPA-ish fallback for direct links like /world/<id>
app.get('*', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

// Export for tests; only listen when run directly.
export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(PORT, () => {
    console.log(`SGSimulation server running on http://localhost:${PORT}`);
  });
}
