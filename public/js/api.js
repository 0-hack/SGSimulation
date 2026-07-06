// Thin client for the centralized world server.
const JSON_HEADERS = { 'content-type': 'application/json' };

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // Create a new world. Returns { id, token, ... }.
  createWorld({ name, owner, state, isPublic = true }) {
    return req('/api/worlds', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ name, owner, state, isPublic }),
    });
  },

  // Update an existing world (requires the owner's edit token). Omit isPublic to
  // PRESERVE the world's current visibility (the server keeps what's stored) — a
  // default of true here used to silently republish private worlds.
  updateWorld(id, token, { name, owner, state, isPublic }) {
    return req(`/api/worlds/${id}`, {
      method: 'PUT', headers: { ...JSON_HEADERS, 'x-world-token': token },
      body: JSON.stringify({ name, owner, state, isPublic }),
    });
  },

  // Load a full world (own game or a visit).
  loadWorld(id) {
    return req(`/api/worlds/${encodeURIComponent(id)}`);
  },

  // Browse public worlds.
  listWorlds({ limit = 24, offset = 0 } = {}) {
    return req(`/api/worlds?limit=${limit}&offset=${offset}`);
  },

  deleteWorld(id, token) {
    return req(`/api/worlds/${id}`, {
      method: 'DELETE', headers: { 'x-world-token': token },
    });
  },
};
