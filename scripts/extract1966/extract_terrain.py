import tifffile, numpy as np, json, sys, time
sys.path.insert(0,'/tmp/trace'); from geo import *
from scipy import ndimage as ndi
from PIL import Image, ImageDraw
t0=time.time()
LEVEL=3
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
land=json.load(open('land1966.json'))
P=np.array(land['mainland'])
Xm=GX0+P[:,0]*SPAN; Ym=GY0+P[:,1]*SPAN
cm,rm=merc_to_px(Xm,Ym,LEVEL)
pad=40
c0,c1=int(cm.min())-pad,int(cm.max())+pad; r0,r1=int(rm.min())-pad,int(rm.max())+pad
lvl=tifffile.TiffFile('/tmp/1966.tif').series[0].levels[LEVEL]
img=lvl.asarray()[r0:r1, c0:c1]
H,W=img.shape[:2]; print('crop',img.shape, int(time.time()-t0),'s')
r,g,b=img[:,:,0].astype(np.int16),img[:,:,1].astype(np.int16),img[:,:,2].astype(np.int16)
m=Image.new('1',(W,H),0); ImageDraw.Draw(m).polygon(list(zip((cm-c0).tolist(),(rm-r0).tolist())),fill=1)
mmask=np.array(m,bool)
L=((r+g+b)//3).astype(np.int16)
Lc=ndi.grey_closing(L, size=(5,5))
bh=Lc-L
contour=(bh>11)&(r-g>12)&(g-b>2)&(r>100)&(r-g<62)&mmask
# stipple dots & labels are small blobs; contour lines are long — keep lines only
from skimage import morphology as mo
contour=mo.remove_small_objects(contour, 36)
print('contour frac', round(float(contour.mean()),4), int(time.time()-t0),'s')
# entries per direction
def crossings(C, axis, flip):
    A=np.flip(C,axis=axis) if flip else C
    prev=np.roll(A,1,axis=axis)
    if axis==0: prev[0,:]=False
    else: prev[:,0]=False
    enter=A&~prev
    cum=np.cumsum(enter,axis=axis)
    return np.flip(cum,axis=axis) if flip else cum
contour=ndi.binary_dilation(contour, iterations=1)   # seal small label gaps
cW=crossings(contour,1,False); cE=crossings(contour,1,True)
cN=crossings(contour,0,False); cS=crossings(contour,0,True)
# unsigned crossings overcount across unrelated hills; the cleanest ray to the
# sea approximates true nesting depth -> take the MIN over directions
est=np.minimum(np.minimum(cW,cE),np.minimum(cN,cS)).astype(np.float32)
del cW,cE,cN,cS
est[~mmask]=0
print('raw est max', float(est.max()), int(time.time()-t0),'s')
# clean: median filter then smooth; clamp crazy values
est=np.clip(est,0,26)
est=ndi.median_filter(est, size=7)
est=ndi.gaussian_filter(est, sigma=9)
est[~mmask]=0
print('smoothed max', round(float(est.max()),2))
# downsample to DEM grid (~1 cell per 4 px) then to fixed grid 224x128 over game bbox
ds=ndi.zoom(est, 0.25, order=1)
np.save('dem_raw.npy', ds)
json.dump(dict(c0=c0,r0=r0,c1=c1,r1=r1,LEVEL=LEVEL), open('dem_box.json','w'))
print('dem', ds.shape, 'max', round(float(ds.max()),2), int(time.time()-t0),'s')
