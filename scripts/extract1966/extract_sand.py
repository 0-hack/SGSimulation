import tifffile, numpy as np, json, sys
sys.path.insert(0,'/tmp/trace'); from geo import *
from scipy import ndimage as ndi
from skimage import measure
from skimage.measure import approximate_polygon
from matplotlib.path import Path
LEVEL=4
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
land=json.load(open('land1966.json'))
lvl=tifffile.TiffFile('/tmp/1966.tif').series[0].levels[LEVEL]
img=lvl.asarray(); H,W=img.shape[:2]
r,g,b=img[:,:,0].astype(int),img[:,:,1].astype(int),img[:,:,2].astype(int)
orange=(r>175)&(r-g>14)&(g-b>22)&(g-b<70)&(g>120)
orange=ndi.binary_closing(orange, structure=np.ones((3,3)), iterations=2)
orange=ndi.binary_opening(orange, iterations=1)
orange=ndi.binary_dilation(orange, iterations=3)   # widen the foreshore band so beaches read chunkier in 3D
orange=ndi.binary_closing(orange, iterations=2)
lbl,n=ndi.label(orange)
sizes=ndi.sum(np.ones_like(lbl),lbl,range(1,n+1))
def to_game_px(rows,cols):
    X,Y=px_to_merc(cols,rows,LEVEL); return np.column_stack([(X-GX0)/SPAN,(Y-GY0)/SPAN])
# only keep foreshore near our island/islands (within bbox + margin)
allP=[np.array(land['mainland'])]+[np.array(p) for p in land['islands'] if len(p)>=6]
import numpy as np
minx=min(p[:,0].min() for p in allP)-0.02; maxx=max(p[:,0].max() for p in allP)+0.02
miny=min(p[:,1].min() for p in allP)-0.02; maxy=max(p[:,1].max() for p in allP)+0.02
polys=[]
for k in range(n):
    if sizes[k]<120: continue
    mk=ndi.binary_fill_holes(lbl==k+1)
    cs=measure.find_contours(mk.astype(float),0.5); cs.sort(key=len,reverse=True)
    c=cs[0]
    if len(c)<14: continue
    p=approximate_polygon(c,2.2)
    gp=to_game_px(p[:,0],p[:,1])
    cen=gp.mean(0)
    if not (minx<cen[0]<maxx and miny<cen[1]<maxy): continue
    # keep only foreshore hugging the coast (drop inland orange: quarries/cleared land)
    dmin=1e9
    for poly in allP:
        d=np.hypot(poly[:,0]-cen[0], poly[:,1]-cen[1]).min()
        if d<dmin: dmin=d
    if dmin>0.012: continue
    polys.append([[round(float(x),4),round(float(y),4)] for x,y in gp])
polys.sort(key=len,reverse=True)
json.dump(polys, open('sand1966.json','w'))
print('sand polygons',len(polys),'pts total',sum(len(p) for p in polys))
# overlay
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(16,9))
P=np.array(land['mainland']); ax.fill(P[:,0],P[:,1],color='#cdebc0')
for p in land['islands']:
    Q=np.array(p); ax.fill(Q[:,0],Q[:,1],color='#cdebc0')
for p in polys:
    Q=np.array(p); ax.fill(Q[:,0],Q[:,1],color='#e0c070')
ax.set_aspect('equal'); ax.axis('off'); plt.savefig('sand_check.png',dpi=75,bbox_inches='tight'); print('plotted')
