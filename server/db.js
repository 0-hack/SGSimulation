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

export default db;
