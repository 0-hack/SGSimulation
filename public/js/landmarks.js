// Per-player landmark library — stored in THIS browser (localStorage), no server
// writes. Designs made in design.html land here; the game reads them and makes
// each one buildable. Designs also travel inside a saved game (state.landmarks)
// so anyone visiting that world can see what was built, and can be shared by
// exporting/importing the JSON file.
const LS = 'sg_landmarks_v1';

export function loadLibrary() {
  try { const v = JSON.parse(localStorage.getItem(LS)); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveLibrary(list) {
  try { localStorage.setItem(LS, JSON.stringify(list || [])); } catch {}
}
export function newId() {
  return 'lm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
// Add (or replace, by id) a landmark design in the library. Returns its id.
export function addToLibrary(lm) {
  const list = loadLibrary();
  if (!lm.id) lm.id = newId();
  const i = list.findIndex((x) => x.id === lm.id);
  if (i >= 0) list[i] = lm; else list.push(lm);
  saveLibrary(list);
  return lm.id;
}
export function removeFromLibrary(id) {
  saveLibrary(loadLibrary().filter((x) => x.id !== id));
}
