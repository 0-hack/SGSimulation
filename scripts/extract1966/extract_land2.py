import tifffile, numpy as np, json, sys
sys.path.insert(0,'/tmp/trace')
from geo import *
from scipy import ndimage as ndi
from skimage import measure
from skimage.measure import approximate_polygon

LEVEL=4
lvl = tifffile.TiffFile('/tmp/1966.tif').series[0].levels[LEVEL]
img = lvl.asarray(); H,W = img.shape[:2]
r,g,b = img[:,:,0].astype(np.int16),img[:,:,1].astype(np.int16),img[:,:,2].astype(np.int16)
alpha = img[:,:,3]
onsheet = alpha > 0
teal  = (b-r>3)&(g-r>1)&(b>105)&(g>110)
cream = (r>195)&(r-b>28)&(r-g<38)            # pale sea/paper, but NOT the orange foreshore
blank = (r>225)&(g>215)&(b>205)
cand = ndi.binary_closing((teal|cream|blank)&onsheet, structure=np.ones((3,3)), iterations=1)
lblS,nS = ndi.label(cand)
szS = ndi.sum(np.ones_like(lblS),lblS,range(1,nS+1))
tealfrac = ndi.mean(teal.astype(np.float32), lblS, range(1,nS+1))
# sea = big components that actually contain open teal water (cleared/developed
# land prints cream too, but has no teal — keep it as land)
sea_ids = np.where((szS>0.002*H*W) & (tealfrac>0.22))[0]+1
sea = np.isin(lblS, sea_ids)
cols=np.arange(W); lon_of_col=(X0+cols*PX*(2**LEVEL))/20037508.342789244*180
rows=np.arange(H); lat_of_row=np.degrees(np.arctan(np.sinh((Y0-rows*PX*(2**LEVEL))/R)))
sea_d = ndi.binary_dilation(sea, iterations=3)
land = onsheet & ~sea_d
land[:, lon_of_col>104.105]=False; land[:, lon_of_col<103.595]=False
land = ndi.binary_opening(land, iterations=2)
lbl,n = ndi.label(land)
sizes = ndi.sum(np.ones_like(lbl),lbl,range(1,n+1))
cents = ndi.center_of_mass(np.ones_like(lbl),lbl,range(1,n+1))

# Johor Strait centreline (lon,lat) — SG is SOUTH of this line; plus an east cap.
BND = np.array([
 [103.560,1.262],[103.600,1.290],[103.620,1.310],[103.640,1.330],[103.660,1.392],[103.680,1.430],
 [103.720,1.447],[103.755,1.452],[103.800,1.458],[103.850,1.448],[103.900,1.428],
 [103.945,1.422],[103.985,1.432],[104.020,1.443],[104.050,1.450],[104.080,1.435],[104.110,1.420]])
def is_foreign(lon,lat):
    if lon>104.062: return True
    return lat > np.interp(lon, BND[:,0], BND[:,1])

mainland_k, best = -1, 0
for k in range(n):
    py,px = cents[k]; s=sizes[k]
    lon=float(np.interp(px,cols,lon_of_col)); lat=float(np.interp(py,rows,lat_of_row))
    if s>best and not is_foreign(lon,lat) and 1.25<lat<1.43: best,mainland_k=s,k+1
johor,isles=[],[]
for k in range(n):
    py,px=cents[k]; s=sizes[k]
    if k+1==mainland_k: continue
    lon=float(np.interp(px,cols,lon_of_col)); lat=float(np.interp(py,rows,lat_of_row))
    if is_foreign(lon,lat):
        if s>800: johor.append(k+1)
    elif s>=200: isles.append(k+1)

def poly_of(mask, tol, min_len=20):
    mask=ndi.binary_fill_holes(mask); out=[]
    for c in measure.find_contours(mask.astype(float),0.5):
        if len(c)<min_len: continue
        p=approximate_polygon(c,tolerance=tol)
        Xm,Ym=px_to_merc(p[:,1],p[:,0],LEVEL)
        out.append(np.column_stack([Xm,Ym]))
    out.sort(key=len,reverse=True); return out
mainland=poly_of(lbl==mainland_k,1.3)[0]
isl_polys=[poly_of(lbl==k,1.3,min_len=12)[0] for k in isles]
johor_polys=poly_of(ndi.binary_closing(np.isin(lbl,johor),iterations=4),3.0,min_len=50)

# drop "islands" whose centroid is inside the mainland (classification holes)
from matplotlib.path import Path
allpts=np.vstack([mainland]+isl_polys)
mx0,my0=allpts.min(0); mx1,my1=allpts.max(0)
SPAN=(mx1-mx0)/0.86; GX0=(mx0+mx1)/2-SPAN*.5; GY0=(my0+my1)/2-SPAN*.5
def to_game(P): return np.column_stack([(P[:,0]-GX0)/SPAN,(P[:,1]-GY0)/SPAN])
mpath=Path(to_game(mainland))
isl_polys=[p for p in isl_polys if not mpath.contains_point(to_game(p).mean(0))]
json.dump(dict(GX0=GX0,GY0=GY0,SPAN=SPAN,LEVEL=LEVEL),open('game_xform.json','w'))
def ser(P,nd=4): return [[round(float(x),nd),round(float(y),nd)] for x,y in to_game(P)]
out=dict(mainland=ser(mainland),islands=[ser(p) for p in isl_polys if len(p)>=6],
         johor=[ser(p) for p in johor_polys[:18] if len(p)>=10])
json.dump(out,open('land1966.json','w'))
ng=to_game(mainland)
print('m/unit',round(SPAN/1600,2),'| mainland pts',len(out['mainland']),'| islands',len(out['islands']),'| johor',len(out['johor']))
print('mainland x',round(ng[:,0].min(),3),round(ng[:,0].max(),3),'y',round(ng[:,1].min(),3),round(ng[:,1].max(),3))
