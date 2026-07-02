// SQLite persistence layer for the centralized world server.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'worlds.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS worlds (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    owner        TEXT NOT NULL,
    token        TEXT NOT NULL,          -- secret edit token (kept by owner)
    state        TEXT NOT NULL,          -- full JSON game state
    is_public    INTEGER NOT NULL DEFAULT 1,
    -- denormalised summary columns for the public browse list
    year         INTEGER NOT NULL DEFAULT 1965,
    population   INTEGER NOT NULL DEFAULT 0,
    approval     INTEGER NOT NULL DEFAULT 50,
    treasury     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_worlds_public ON worlds (is_public, updated_at DESC);

  -- Community-shared custom buildings designed in the 3D designer. The design column
  -- is the JSON (parts, stats, base) the game needs to render and price the build;
  -- func is its functionality (house / economy / entertainment / power / water / ...)
  -- so the community menu can filter by it, and downloads drives the popularity sort.
  CREATE TABLE IF NOT EXISTS builds (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    author      TEXT NOT NULL,
    func        TEXT NOT NULL DEFAULT 'landmark',
    size        REAL NOT NULL DEFAULT 1,
    year        INTEGER NOT NULL DEFAULT 1965,
    design      TEXT NOT NULL,
    token       TEXT NOT NULL,
    downloads   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_builds_downloads ON builds (downloads DESC, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_builds_func ON builds (func, downloads DESC);
`);

const stmts = {
  insert: db.prepare(`
    INSERT INTO worlds (id, name, owner, token, state, is_public, year, population, approval, treasury, created_at, updated_at)
    VALUES (@id, @name, @owner, @token, @state, @is_public, @year, @population, @approval, @treasury, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE worlds
       SET name=@name, owner=@owner, state=@state, is_public=@is_public,
           year=@year, population=@population, approval=@approval, treasury=@treasury,
           updated_at=@updated_at
     WHERE id=@id
  `),
  getById: db.prepare(`SELECT * FROM worlds WHERE id = ?`),
  delete: db.prepare(`DELETE FROM worlds WHERE id = ?`),
  listPublic: db.prepare(`
    SELECT id, name, owner, is_public, year, population, approval, treasury, created_at, updated_at
      FROM worlds
     WHERE is_public = 1
     ORDER BY updated_at DESC
     LIMIT @limit OFFSET @offset
  `),
  countPublic: db.prepare(`SELECT COUNT(*) AS n FROM worlds WHERE is_public = 1`),
};

// Pull the summary fields the simulation exposes so the browse list stays cheap.
function summarize(state) {
  const s = state?.summary || {};
  return {
    year: Math.trunc(s.year ?? 1965),
    population: Math.trunc(s.population ?? 0),
    approval: Math.trunc(s.approval ?? 50),
    treasury: Math.trunc(s.treasury ?? 0),
  };
}

export const dbApi = {
  create({ id, name, owner, token, state, isPublic }) {
    const now = Date.now();
    const sum = summarize(state);
    stmts.insert.run({
      id, name, owner, token,
      state: JSON.stringify(state),
      is_public: isPublic ? 1 : 0,
      ...sum,
      created_at: now,
      updated_at: now,
    });
    return this.getPublic(id);
  },

  update(id, { name, owner, state, isPublic }) {
    const sum = summarize(state);
    stmts.update.run({
      id, name, owner,
      state: JSON.stringify(state),
      is_public: isPublic ? 1 : 0,
      ...sum,
      updated_at: Date.now(),
    });
    return this.getPublic(id);
  },

  // Full row including secret token — server-side use only.
  getRaw(id) {
    return stmts.getById.get(id);
  },

  // World with parsed state but WITHOUT the secret token (safe to send to viewers).
  getFull(id) {
    const row = stmts.getById.get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      isPublic: !!row.is_public,
      state: JSON.parse(row.state),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  // Metadata only (no full state) for the browse list.
  getPublic(id) {
    const row = stmts.getById.get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      isPublic: !!row.is_public,
      year: row.year,
      population: row.population,
      approval: row.approval,
      treasury: row.treasury,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  delete(id) {
    return stmts.delete.run(id).changes > 0;
  },

  listPublic({ limit = 24, offset = 0 } = {}) {
    const rows = stmts.listPublic.all({ limit, offset });
    const total = stmts.countPublic.get().n;
    return {
      total,
      worlds: rows.map((row) => ({
        id: row.id,
        name: row.name,
        owner: row.owner,
        isPublic: !!row.is_public,
        year: row.year,
        population: row.population,
        approval: row.approval,
        treasury: row.treasury,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  },
};

// ---- Community builds (custom buildings shared between players) --------------
const bstmts = {
  insert: db.prepare(`
    INSERT INTO builds (id, name, author, func, size, year, design, token, downloads, created_at, updated_at)
    VALUES (@id, @name, @author, @func, @size, @year, @design, @token, 0, @created_at, @updated_at)
  `),
  getById: db.prepare(`SELECT * FROM builds WHERE id = ?`),
  delete: db.prepare(`DELETE FROM builds WHERE id = ?`),
  bump: db.prepare(`UPDATE builds SET downloads = downloads + 1 WHERE id = ?`),
  countAll: db.prepare(`SELECT COUNT(*) AS n FROM builds`),
  countFunc: db.prepare(`SELECT COUNT(*) AS n FROM builds WHERE func = @func`),
  listNew: db.prepare(`SELECT * FROM builds ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`),
  listTop: db.prepare(`SELECT * FROM builds ORDER BY downloads DESC, updated_at DESC LIMIT @limit OFFSET @offset`),
  listNewFunc: db.prepare(`SELECT * FROM builds WHERE func = @func ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`),
  listTopFunc: db.prepare(`SELECT * FROM builds WHERE func = @func ORDER BY downloads DESC, updated_at DESC LIMIT @limit OFFSET @offset`),
};

// Public metadata for a build row (no secret token; design only when asked).
function buildMeta(row, withDesign = false) {
  if (!row) return null;
  const m = {
    id: row.id, name: row.name, author: row.author, func: row.func, size: row.size,
    year: row.year, downloads: row.downloads, createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (withDesign) m.design = JSON.parse(row.design);
  return m;
}

export const buildsApi = {
  create({ id, name, author, func, size, year, design, token }) {
    const now = Date.now();
    bstmts.insert.run({ id, name, author, func, size, year, design: JSON.stringify(design), token, created_at: now, updated_at: now });
    return buildMeta(bstmts.getById.get(id));
  },
  getRaw(id) { return bstmts.getById.get(id); },
  getFull(id) { return buildMeta(bstmts.getById.get(id), true); },
  getMeta(id) { return buildMeta(bstmts.getById.get(id)); },
  delete(id) { return bstmts.delete.run(id).changes > 0; },
  // Count a download AND hand back the full design so the player can construct it.
  download(id) {
    const row = bstmts.getById.get(id);
    if (!row) return null;
    bstmts.bump.run(id);
    return buildMeta(bstmts.getById.get(id), true);
  },
  list({ sort = 'downloads', func = null, limit = 24, offset = 0 } = {}) {
    const args = { limit, offset };
    let rows, total;
    if (func) {
      args.func = func;
      rows = (sort === 'recent' ? bstmts.listNewFunc : bstmts.listTopFunc).all(args);
      total = bstmts.countFunc.get({ func }).n;
    } else {
      rows = (sort === 'recent' ? bstmts.listNew : bstmts.listTop).all(args);
      total = bstmts.countAll.get().n;
    }
    return { total, builds: rows.map((r) => buildMeta(r)) };
  },
};

export default db;
