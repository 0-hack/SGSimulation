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

// ---- static client ---------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
// SPA-ish fallback for direct links like /world/<id>
app.get('*', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

// Export for tests; only listen when run directly.
export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(PORT, () => {
    console.log(`SGSimulation server running on http://localhost:${PORT}`);
  });
}
