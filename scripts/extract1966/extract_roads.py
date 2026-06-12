import tifffile, numpy as np, json, sys, time, pickle
sys.path.insert(0,'/tmp/trace'); from geo import *
from scipy import ndimage as ndi
from skimage import morphology as mo
import sknw
t0=time.time()
LEVEL=3
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
lvl=tifffile.TiffFile('/tmp/1966.tif').series[0].levels[LEVEL]
img=lvl.asarray(); H,W=img.shape[:2]
r,g,b=img[:,:,0].astype(np.int16),img[:,:,1].astype(np.int16),img[:,:,2].astype(np.int16)
red=(r-g>30)&(g-b<12)&(r>120)&(r-b>38)
print('red frac',round(float(red.mean()),4),int(time.time()-t0),'s')
road=ndi.binary_closing(red,iterations=2)
road=mo.remove_small_objects(road,40)
# local half-width (px) for classing
dist=ndi.distance_transform_edt(road)
skel=mo.skeletonize(road)
print('skel px',int(skel.sum()),int(time.time()-t0),'s')
G=sknw.build_sknw(skel.astype(np.uint8))
print('graph',G.number_of_nodes(),G.number_of_edges(),int(time.time()-t0),'s')
edges=[]
for a,bb in G.edges():
    pts=G[a][bb]['pts']
    wmed=float(np.median(dist[pts[:,0],pts[:,1]]))   # half-width in px
    edges.append((int(a),int(bb),pts,wmed))
npos={i:G.nodes[i]['o'] for i in G.nodes()}
pickle.dump(dict(H=H,W=W,edges=edges,npos=npos,LEVEL=LEVEL), open('roadgraph.pkl','wb'))
ws=np.array([e[3] for e in edges])
print('halfwidth px percentiles', np.percentile(ws,[25,50,75,90,97]).round(2))
