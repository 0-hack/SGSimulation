import numpy as np, tifffile, time
from scipy import ndimage as ndi
from skimage import morphology as mo
import sknw
t0=time.time()
LEVEL=3
lvl = tifffile.TiffFile('/tmp/1966.tif').series[0].levels[LEVEL]
H,W = lvl.shape[:2]
img = lvl.asarray()
r,g,b = img[:,:,0].astype(np.int16),img[:,:,1].astype(np.int16),img[:,:,2].astype(np.int16)
del img
road = (r-g>30)&(g-b<12)&(r>120)&(r-b>38)
del r,g,b
print('mask', round(road.mean(),4), 'load+mask', int(time.time()-t0),'s')
road = ndi.binary_closing(road, iterations=2)           # bridge small gaps
road = mo.remove_small_objects(road, 40)                # drop specks
print('after clean', round(road.mean(),4), int(time.time()-t0),'s')
skel = mo.skeletonize(road)
del road
print('skeleton px', int(skel.sum()), int(time.time()-t0),'s')
G = sknw.build_sknw(skel.astype(np.uint8))
print('graph nodes', G.number_of_nodes(), 'edges', G.number_of_edges(), int(time.time()-t0),'s')
# export nodes (pixel coords) and edges with their polyline pts
nodes = G.nodes()
npos = np.array([nodes[i]['o'] for i in nodes])   # (row,col)
import json, pickle
# store edges as lists of (row,col) pts to preserve curve
edges=[]
for (a,bb) in G.edges():
    pts = G[a][bb]['pts']                          # (row,col) array along edge
    edges.append((int(a),int(bb),pts))
with open('graph.pkl','wb') as f:
    pickle.dump({'H':H,'W':W,'npos':npos,'edges':edges,'node_ids':list(nodes)}, f)
print('saved graph.pkl  total', int(time.time()-t0),'s')
