// A refreshable view of the 1966 base road network.
//
// roads1966.js is a static ES import, so its arrays are fixed when the page first
// loads. That means an in-app "New Game" reuses the road data from page load — a
// base-map edit made through the tracer's "Save to map" (which rewrites
// roads1966.js on the server) would NOT show until the player manually reloaded
// the browser. refreshRoadsLive() re-fetches roads1966.js with a cache-busting
// query so the next New Game reflects the latest saved map without a reload.
//
// Consumers (engine.injectTracedRoads, scene3d road mask + heritage) read through
// ROADS_LIVE, whose initial value is the page-load network — so behaviour is
// identical until a refresh actually pulls a newer file.
import { ROAD_NODES_1966, ROAD_EDGES_1966 } from './roads1966.js';

export const ROADS_LIVE = { nodes: ROAD_NODES_1966, edges: ROAD_EDGES_1966 };

export async function refreshRoadsLive() {
  try {
    const m = await import('./roads1966.js?u=' + Date.now()); // unique URL -> bypasses the module cache
    if (Array.isArray(m.ROAD_NODES_1966) && Array.isArray(m.ROAD_EDGES_1966)) {
      ROADS_LIVE.nodes = m.ROAD_NODES_1966;
      ROADS_LIVE.edges = m.ROAD_EDGES_1966;
    }
  } catch (e) { /* offline / fetch failed — keep the last-known network */ }
  return ROADS_LIVE;
}
