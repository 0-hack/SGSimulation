# 1966 road re-trace pipeline (high fidelity)

Regenerates `public/js/roads1966.js` from the NUS Libmaps 1966 survey-map
GeoTIFF at pyramid level 3. Requires Python with: tifffile, imagecodecs, numpy,
scipy, scikit-image, sknw, networkx, matplotlib.

1. Download the source GeoTIFF:
   `curl -o /tmp/1966.tif https://d39hmjnw8fb16p.cloudfront.net/1966.tif`
2. Export the registration target + reservoirs from the current build:
   - `old_roads.json`  = current ROAD_NODES_1966 / ROAD_EDGES_1966 (coast-aligned)
   - `reservoirs.json` = current RESERVOIRS_1966
   - `sg_outline.json` = SG_OUTLINE (+ islands) from public/js/shape.js
3. `extract_graph.py` — red-road mask (saturated red; g≈b excludes orange
   contours), gap-bridging close, skeletonize, sknw graph -> graph.pkl
4. `register4.py` — bidirectional-chamfer fit of an axis-aligned affine that
   maps the new (map-space) network onto the old coast-aligned roads -> xform.npy
5. `finalize.py` — transform to game space, clip to the coastline (drops the
   map frame/legend/Johor), exclude the central terrain ellipse + airport box,
   bridge fragmented endpoints, prune spurs, Taubin-smooth, write roads1966.js.
