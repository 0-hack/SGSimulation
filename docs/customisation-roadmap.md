# In-game tracing / customisation — architecture & roadmap

Goal: let players customise **everything** by tracing — grow the island (land
reclamation), expand roads, reconstruct land, place buildings/houses — first as
a designer tool, ultimately as an in-game editor. Time/money costs are **out of
scope for now** (we're still pinning down the 1965 baseline); the editing and
rendering pipeline comes first, economy hooks bolt on later.

## Where we are today

- **Offline tracer** (`public/trace.html`): draw layers over the 1966 map —
  roads (+one-way), mainland, islands, reservoirs, airport runway, airport
  buildings, **houses**, Malaysia. Move/resize/rotate handles for placed
  structures. Saves `sg1966-trace.json`.
- **Converter** (`scripts/apply_trace.mjs`): bakes each layer into source —
  `shape.js` (coast/islands/foreign), `roads1966.js` (roads/reservoirs),
  `scene3d.js` (`AIRPORT` runway + buildings), `custom1966.js` (houses).
- **`public/js/custom1966.js`**: the first *runtime* customisation module — the
  game reads it and places houses without any special-casing. This is the seed
  of the system below.

## Target architecture

### 1. One runtime customisation model
Promote every traced layer into a single serialisable object the game reads at
runtime (extend `custom1966.js` → a `CustomState`):

```
custom = {
  coast:   { mainland:[poly], islands:[poly], foreign:[poly] },
  water:   { reservoirs:[poly] },
  roads:   { nodes:[], edges:[] },
  airport: { runway:{south,north}, buildings:[...] },
  houses:  [...],
}
```

The baked-in 1966 data becomes the *default* `custom`; player edits override it.
Stored in the save (`state.custom`) so it persists and cloud-syncs.

### 2. A single "apply" pipeline
A `view.applyCustom(custom)` that (re)builds only what changed, reusing methods
that already exist:
- coast/islands/foreign → `_buildIsland()` + recompute the **buildable grid mask**
  (`landMask` from the new mainland polygon) → this is land reclamation.
- reservoirs → `_buildCatchment()` + reserve mask.
- roads → `rebuildRoadNet()` (already data-driven).
- airport → `_buildAirport()` (already reads `AIRPORT`).
- houses/buildings → `_placeStructures()` (already generic).

Most of these are already parameterised; the work is sourcing them from
`custom` instead of module constants, and invalidating the masks
(`landMask`/`airportMask`/reserve) when polygons change.

### 3. In-game editor (Plan mode)
Embed the tracer's drawing logic into the 3D view instead of a flat map:
- Replace the 2-D `toScreen/toGame` with the game camera's project/unproject
  (`THREE.Vector3.project`) so strokes land on the ground plane in world space.
- A "Plan" toolbar mirrors `trace.html`'s layer/handle UI.
- On commit, mutate `state.custom` and call `applyCustom` for live feedback.
- The offline `trace.html` stays as the power tool / bulk editor; both write the
  same schema.

### 4. Economy hooks (later)
Each edit op (reclaim N cells, lay M road-metres, build X) gets a cost/time in a
`costOf(op)` table and a build queue. Until then, edits are instant and free.

## Phasing
1. **(done)** Generic structure placement + `custom1966.js` + handles + houses.
2. Move coast/reservoir/road/airport defaults into `CustomState`; add
   `applyCustom()` + mask invalidation (enables reclamation/road edits at runtime).
3. Persist `state.custom` in saves; converter writes the schema directly.
4. In-game Plan mode (camera-projected drawing) reusing the tracer UI.
5. Costs, time, and build queue.
