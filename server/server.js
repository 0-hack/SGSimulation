// Centralized world server for SGSimulation.
// Serves the static game client and exposes a small REST API for saving,
// loading, browsing, and visiting other players' worlds.
import express from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { dbApi } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '8mb' })); // city states can get large

// ---- helpers ---------------------------------------------------------------

const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const newToken = () => randomBytes(24).toString('hex');

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

// Create a new world. Returns the world id + a secret edit token.
api.post('/worlds', (req, res) => {
  const { name, owner, state, isPublic } = req.body || {};
  if (!validState(state)) return res.status(400).json({ error: 'Invalid game state.' });

  const id = randomUUID();
  const token = newToken();
  const world = dbApi.create({
    id,
    name: clampName(name, 'New Singapore'),
    owner: clampName(owner, 'Anonymous'),
    token: hash(token),
    state,
    isPublic: isPublic !== false,
  });
  res.json({ ...world, token }); // token returned once, only to the creator
});

// Update an existing world. Requires the matching edit token.
api.put('/worlds/:id', (req, res) => {
  const row = dbApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'World not found.' });

  const token = req.get('x-world-token') || req.body?.token;
  if (!token || hash(token) !== row.token) {
    return res.status(403).json({ error: 'Invalid edit token for this world.' });
  }
  const { name, owner, state, isPublic } = req.body || {};
  if (!validState(state)) return res.status(400).json({ error: 'Invalid game state.' });

  const world = dbApi.update(req.params.id, {
    name: clampName(name, row.name),
    owner: clampName(owner, row.owner),
    state,
    isPublic: isPublic !== false,
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
api.delete('/worlds/:id', (req, res) => {
  const row = dbApi.getRaw(req.params.id);
  if (!row) return res.status(404).json({ error: 'World not found.' });
  const token = req.get('x-world-token') || req.body?.token;
  if (!token || hash(token) !== row.token) {
    return res.status(403).json({ error: 'Invalid edit token for this world.' });
  }
  dbApi.delete(req.params.id);
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
app.get('/api/trace/mapsig', async (_req, res) => {
  try {
    const u = '?u=' + Date.now();
    const sh = await import('../public/js/shape.js' + u);
    const cu = await import('../public/js/custom1966.js' + u);
    const rd = await import('../public/js/roads1966.js' + u);
    res.json({ sig: hash(JSON.stringify([sh.SG_OUTLINE, sh.SG_ISLANDS, sh.SG_SANDS, cu.CUSTOM_SANDS, cu.CUSTOM_RAILWAYS, rd.RESERVOIRS_1966])) });
  } catch (e) { res.json({ sig: '' }); }
});

// NOTE: 3D-designed landmarks are now PER-PLAYER (stored in the player's browser
// and inside their saved game) — see public/js/landmarks.js. No server write is
// involved, so there's nothing to gate and nothing shared between players.

if (process.env.TRACE_EDIT !== '0') {
  // POST a trace -> write it into the BASE 1966 map (shared by everyone). This is
  // a creator/dev action, so it stays gated — set TRACE_EDIT=0 on public sites.
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
}

// ---- static client ---------------------------------------------------------
// no-cache on HTML/JS/JSON so players always get the latest after an update
// (these are small; the browser still revalidates with ETag).
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
