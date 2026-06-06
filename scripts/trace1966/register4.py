import numpy as np, pickle, json
from scipy.spatial import cKDTree
from scipy.optimize import minimize
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

G=pickle.load(open('graph.pkl','rb')); H,W=G['H'],G['W']
kept=[]
for a,b,pts in G['edges']:
    E=np.column_stack([pts[:,1]/W,1-pts[:,0]/H]); cen=E.mean(0)
    if not (0.0<=cen[0]<=0.70 and 0.14<=cen[1]<=0.66): continue
    chord=np.hypot(*(E[-1]-E[0])); path=np.hypot(np.diff(E[:,0]),np.diff(E[:,1])).sum()
    if chord>0.06 and path>0 and chord/path>0.97:
        ang=np.arctan2(abs(E[-1,1]-E[0,1]),abs(E[-1,0]-E[0,0]))
        if ang<0.09 or ang>np.pi/2-0.09: continue
    kept.append(E)
Mc=np.vstack(kept)
old=json.load(open('old_roads.json'))
ONx=np.array([n[0] for n in old['nodes']])/1600.0+0.5; ONy=0.5-np.array([n[1] for n in old['nodes']])/1600.0
ept=[((ONx[a]+ONx[b])/2,(ONy[a]+ONy[b])/2) for a,b,*_ in old['edges']]
OG=np.column_stack([np.concatenate([ONx,[p[0] for p in ept]]),np.concatenate([ONy,[p[1] for p in ept]])])
treeO=cKDTree(OG)
rng=np.random.default_rng(0); Ms=Mc[rng.choice(len(Mc),min(20000,len(Mc)),replace=False)]
def pc(a,l,h): return np.percentile(a,l),np.percentile(a,h)
mxl,mxh=pc(Mc[:,0],1,99); myl,myh=pc(Mc[:,1],1,99); gxl,gxh=pc(OG[:,0],1,99); gyl,gyh=pc(OG[:,1],1,99)
sx0=(gxh-gxl)/(mxh-mxl); tx0=gxl-sx0*mxl; sy0=(gyh-gyl)/(myh-myl); ty0=gyl-sy0*myl
print('init',round(sx0,3),round(tx0,3),round(sy0,3),round(ty0,3))
def chamfer(p):
    sx,tx,sy,ty=p
    T=np.column_stack([sx*Ms[:,0]+tx,sy*Ms[:,1]+ty])
    dNO,_=treeO.query(T)
    treeN=cKDTree(T); dON,_=treeN.query(OG)
    rob=lambda d:np.clip(d,0,0.05).mean()
    return rob(dNO)+rob(dON)
r=minimize(chamfer,[sx0,tx0,sy0,ty0],method='Nelder-Mead',options=dict(xatol=1e-5,fatol=1e-7,maxiter=8000))
sx,tx,sy,ty=r.x; print('opt',round(sx,3),round(tx,3),round(sy,3),round(ty,3),'cost',round(r.fun,4))
for tag,P in [('init',[sx0,tx0,sy0,ty0]),('opt',r.x)]:
    sx,tx,sy,ty=P; gx=sx*Mc[:,0]+tx; gy=sy*Mc[:,1]+ty
    plt.figure(figsize=(11,10))
    og2=np.array(json.load(open('sg_outline.json'))['outline']); plt.plot(og2[:,0],og2[:,1],'k-',lw=1.2)
    plt.scatter(OG[:,0],OG[:,1],s=1.2,c='red',alpha=0.5); plt.scatter(gx,gy,s=0.25,c='blue',alpha=0.25)
    plt.gca().set_aspect('equal'); plt.title(tag); plt.savefig(f'reg_{tag}.png',dpi=80,bbox_inches='tight')
np.save('xform.npy',r.x); print('saved reg_init.png reg_opt.png')
