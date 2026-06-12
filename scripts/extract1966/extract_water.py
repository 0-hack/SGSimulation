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
r,g,b=img[:,:,0].astype(np.int16),img[:,:,1].astype(np.int16),img[:,:,2].astype(np.int16)
teal=(b-r>3)&(g-r>1)&(b>105)&(g>110)
# rasterize the mainland polygon at this level
P=np.array(land['mainland'])
Xm=GX0+P[:,0]*SPAN; Ym=GY0+P[:,1]*SPAN
c,rr=merc_to_px(Xm,Ym,LEVEL)
from PIL import Image, ImageDraw
m=Image.new('1',(W,H),0); ImageDraw.Draw(m).polygon(list(zip(c.tolist(),rr.tolist())),fill=1)
mmask=np.array(m,bool)
inland = teal & ndi.binary_erosion(mmask, iterations=3)
inland = ndi.binary_opening(inland, iterations=1)          # drop thin rivers/streams
lbl,n=ndi.label(inland)
sizes=ndi.sum(np.ones_like(lbl),lbl,range(1,n+1))
keep=np.where(sizes>=70)[0]+1                              # >= ~6,400 m2
print('water bodies found:',len(keep))
res=[]
for k in keep:
    mk=ndi.binary_fill_holes(ndi.binary_dilation(lbl==k,iterations=1))
    cs=measure.find_contours(mk.astype(float),0.5); cs.sort(key=len,reverse=True)
    p=approximate_polygon(cs[0],tolerance=1.0)
    X,Y=px_to_merc(p[:,1],p[:,0],LEVEL)
    nx=(X-GX0)/SPAN; ny=(Y-GY0)/SPAN
    area_km2=sizes[k-1]*((PX*2**LEVEL)**2)/1e6
    res.append((area_km2,[[round(float(a),4),round(float(bb),4)] for a,bb in zip(nx,ny)]))
res.sort(key=lambda t:-t[0])
for a,p in res[:10]: print(' ',round(a,3),'km2, centre',round(np.mean([q[0] for q in p]),3),round(np.mean([q[1] for q in p]),3))
json.dump([p for a,p in res], open('water1966.json','w'))
print('saved', len(res))
