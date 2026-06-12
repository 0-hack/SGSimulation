# 1966 survey-map extraction (georeferenced)

Builds the island, terrain, roads and reservoirs from the NUS Libmaps 1966
GeoTIFF using its embedded EPSG:3857 georeferencing (exact — no fitted warp).

Requires the GeoTIFF at /tmp/1966.tif and Python (tifffile, numpy, scipy,
scikit-image, sknw, matplotlib, Pillow).

Order:
1. geo.py            – lon/lat <-> Web-Mercator <-> pixel helpers (from the tags)
2. extract_land2.py  – land/sea split; mainland / islands / Johor; the one true
                       game transform (true metres, mainland centred). 1 unit ~ 36.7 m.
3. extract_water.py  – inland reservoirs/ponds (teal inside the mainland)
4. extract_terrain.py– 25-ft contour lines (black-hat) -> min-direction crossing
                       counts -> smoothed heightfield (dem_raw.npy)
5. (remap in bake)   – reservoirs flattened into the DEM; compact uint8 grid
6. extract_roads.py  – red-road mask -> skeleton -> sknw graph, per-edge width
7. finalize_roads.py – clip to land, bridge gaps, prune, class by width, smooth
8. bake.mjs          – writes shape.js / roads1966.js / heights1966.js / trace-data.json
