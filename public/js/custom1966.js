// Player / hand-traced customisations applied at runtime. This is the foundation
// for the in-game tracing system: a single data module the game reads to place
// things the player has drawn, separate from the baked-in 1966 defaults.
//
// CUSTOM_HOUSES — free-placed houses (kampong / shophouse / HDB flat …) traced
// over the survey map. Each: { type, cx, cy, w, h, rot, hgt } — centre in
// normalised island coords, w/h normalised footprint, rot radians, hgt height.
// Hand-traced via public/trace.html, applied by scripts/apply_trace.mjs.
export const CUSTOM_HOUSES = [];
