import numpy as np, json, pickle, sys
sys.path.insert(0,'/tmp/trace'); from geo import *
from matplotlib.path import Path
from scipy.spatial import cKDTree
from collections import Counter

WORLD=1600.0
WKEEP=float(sys.argv[1]) if len(sys.argv)>1 else 1.6   # min half-width px (drop footpaths/tracks)
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
land=json.load(open('land1966.json'))
G=pickle.load(open('roadgraph.pkl','rb')); LEVEL=G['LEVEL']
def px_to_game(pts):
    X,Y=px_to_merc(pts[:,1],pts[:,0],LEVEL)
    return np.column_stack([(X-GX0)/SPAN,(Y-GY0)/SPAN])
paths=[Path(np.array(land['mainland']))]+[Path(np.array(p)) for p in land['islands'] if len(p)>=6]
def on_land(p):
    return any(ph.contains_point(p) for ph in paths)

STEP=11.0
nodes=[]; nid={}
def jnode(j,xy):
    k=('j',int(j))
    if k not in nid: nid[k]=len(nodes); nodes.append(xy)
    return nid[k]
def newnode(xy): nodes.append(xy); return len(nodes)-1
edges=[]
for a,b,pts,wmed in G['edges']:
    if wmed < WKEEP: continue                        # keep metalled roads only
    NG=px_to_game(pts)
    if not on_land(NG.mean(0)): continue
    WP=np.column_stack([(NG[:,0]-0.5)*WORLD,(0.5-NG[:,1])*WORLD])
    cls = 1 if wmed>=2.45 else 2
    ia=jnode(a,WP[0]); chain=[ia]; last=WP[0]
    for k in range(1,len(WP)-1):
        if np.hypot(*(WP[k]-last))>=STEP: chain.append(newnode(WP[k])); last=WP[k]
    chain.append(jnode(b,WP[-1]))
    for u,v in zip(chain[:-1],chain[1:]):
        if u!=v: edges.append((u,v,cls))
nodes=np.array(nodes,float)
def adj(n,E):
    A=[set() for _ in range(n)]
    for u,v,_ in E: A[u].add(v); A[v].add(u)
    return A
print('after width+land filter: nodes',len(nodes),'edges',len(edges))
# minimal bridging: only very close dead-ends, one pass
for _ in range(3):
    A=adj(len(nodes),edges); tree=cKDTree(nodes); add=[]
    for i in range(len(nodes)):
        if len(A[i])!=1: continue
        dd,ii=tree.query(nodes[i],k=6)
        for d,j in zip(dd,ii):
            if j==i or j in A[i]: continue
            if d<=13.0: add.append((i,int(j))); break
    seen={(min(u,v),max(u,v)) for u,v,_ in edges}
    new=[(u,v,2) for u,v in add if (min(u,v),max(u,v)) not in seen]
    if not new: break
    edges+=new
# components: keep sizeable ones
A=adj(len(nodes),edges); comp=-np.ones(len(nodes),int); c=0
for s in range(len(nodes)):
    if comp[s]!=-1 or not A[s]: continue
    st=[s]; comp[s]=c
    while st:
        u=st.pop()
        for w in A[u]:
            if comp[w]==-1: comp[w]=c; st.append(w)
    c+=1
cnt=Counter(comp[comp>=0]); keep={k for k,v in cnt.items() if v>=20}
edges=[e for e in edges if comp[e[0]] in keep]
# prune spurs (longer threshold, more passes)
for _ in range(6):
    A=adj(len(nodes),edges); before=len(edges)
    edges=[(u,v,cl) for u,v,cl in edges if not(((len(A[u])==1)or(len(A[v])==1)) and np.hypot(*(nodes[u]-nodes[v]))<9.0)]
    if len(edges)==before: break
used=sorted({u for e in edges for u in e[:2]}); rm={u:i for i,u in enumerate(used)}
N2=nodes[used]; E2=[(rm[u],rm[v],cl) for u,v,cl in edges]
A=adj(len(N2),[(u,v,0) for u,v,_ in E2])
def sm(w):
    out=N2.copy()
    for i in range(len(N2)):
        nb=A[i]
        if nb: out[i]=N2[i]+w*(np.mean([N2[j] for j in nb],axis=0)-N2[i])
    return out
for _ in range(6): N2=sm(0.55); N2=sm(-0.54)
print('FINAL nodes',len(N2),'edges',len(E2),'classes',dict(Counter(cl for _,_,cl in E2)))
json.dump(dict(nodes=[[round(float(x),1),round(float(z),1)] for x,z in N2],
               edges=[[u,v,cl] for u,v,cl in E2]), open('roads_final.json','w'))
# plot
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(17,9))
for p in land['johor']: P=np.array(p); ax.fill((P[:,0]-0.5)*WORLD,(P[:,1]-0.5)*WORLD,color='#ccc')
P=np.array(land['mainland']); ax.fill((P[:,0]-0.5)*WORLD,(P[:,1]-0.5)*WORLD,color='#e9e4d3')
for p in land['islands']: P=np.array(p); ax.fill((P[:,0]-0.5)*WORLD,(P[:,1]-0.5)*WORLD,color='#e9e4d3')
col={1:'#b1402b',2:'#666'}; lw={1:1.7,2:0.8}
for u,v,cl in E2:
    a,b=N2[u],N2[v]; ax.plot([a[0],b[0]],[-a[1],-b[1]],color=col[cl],lw=lw[cl])
ax.set_aspect('equal'); ax.axis('off'); plt.savefig('roads_map2.png',dpi=85,bbox_inches='tight'); print('plotted')
