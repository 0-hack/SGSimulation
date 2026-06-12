import numpy as np, json, pickle, sys
sys.path.insert(0,'/tmp/trace'); from geo import *
from matplotlib.path import Path
from scipy.spatial import cKDTree

WORLD=1600.0
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
land=json.load(open('land1966.json'))
G=pickle.load(open('roadgraph.pkl','rb')); LEVEL=G['LEVEL']
def px_to_game(pts):  # pts (row,col) -> (nx,ny)
    X,Y=px_to_merc(pts[:,1],pts[:,0],LEVEL)
    return np.column_stack([(X-GX0)/SPAN,(Y-GY0)/SPAN])
paths=[Path(np.array(land['mainland']))]+[Path(np.array(p)) for p in land['islands'] if len(p)>=6]
def on_land(p):
    for ph in paths:
        if ph.contains_point(p): return True
    return False

# build node/edge graph in WORLD coords with decimation; keep per-edge width class
STEP=10.0
nodes=[]; nid={}
def jnode(jid,xy):
    key=('j',int(jid))
    if key not in nid: nid[key]=len(nodes); nodes.append(xy)
    return nid[key]
def newnode(xy): nodes.append(xy); return len(nodes)-1
edges=[]
for a,b,pts,wmed in G['edges']:
    NG=px_to_game(pts)
    cen=NG.mean(0)
    if not on_land(cen): continue
    WP=np.column_stack([(NG[:,0]-0.5)*WORLD,(0.5-NG[:,1])*WORLD])
    cls = 1 if wmed>=2.45 else (2 if wmed>=1.55 else 3)
    ia=jnode(a,WP[0]); chain=[ia]; last=WP[0]
    for k in range(1,len(WP)-1):
        if np.hypot(*(WP[k]-last))>=STEP: chain.append(newnode(WP[k])); last=WP[k]
    chain.append(jnode(b,WP[-1]))
    for u,v in zip(chain[:-1],chain[1:]):
        if u!=v: edges.append((u,v,cls))
nodes=np.array(nodes,float)
print('raw nodes',len(nodes),'edges',len(edges))

def adjacency(n,E):
    A=[set() for _ in range(n)]
    for u,v,_ in E: A[u].add(v); A[v].add(u)
    return A
# bridge dead-ends to nearby graph (<=10 world units)
for it in range(2):
    A=adjacency(len(nodes),edges); tree=cKDTree(nodes); add=[]
    for i in range(len(nodes)):
        if len(A[i])!=1: continue
        dd,ii=tree.query(nodes[i],k=4)
        for d,j in zip(dd,ii):
            if j==i or j in A[i]: continue
            if d<=7.0: add.append((i,int(j),3)); break
    if not add: break
    seen={(min(u,v),max(u,v)) for u,v,_ in edges}
    edges+= [e for e in add if (min(e[0],e[1]),max(e[0],e[1])) not in seen]
print('after bridge',len(edges))
# drop tiny components, prune short spurs
A=adjacency(len(nodes),edges)
comp=-np.ones(len(nodes),int); c=0
for s in range(len(nodes)):
    if comp[s]!=-1 or not A[s]: continue
    st=[s]; comp[s]=c
    while st:
        u=st.pop()
        for w in A[u]:
            if comp[w]==-1: comp[w]=c; st.append(w)
    c+=1
from collections import Counter
cnt=Counter(comp[comp>=0]); keepc={k for k,v in cnt.items() if v>=8}
edges=[e for e in edges if comp[e[0]] in keepc]
for _ in range(4):
    A=adjacency(len(nodes),edges); before=len(edges)
    edges=[(u,v,cl) for u,v,cl in edges if not(((len(A[u])==1)or(len(A[v])==1)) and np.hypot(*(nodes[u]-nodes[v]))<6.0)]
    if len(edges)==before: break
used=sorted({u for e in edges for u in e[:2]}); rm={u:i for i,u in enumerate(used)}
N2=nodes[used]; E2=[(rm[u],rm[v],cl) for u,v,cl in edges]
print('pruned nodes',len(N2),'edges',len(E2))
# Taubin smooth
A=adjacency(len(N2),[(u,v,0) for u,v,_ in E2])
def sm(w):
    out=N2.copy()
    for i in range(len(N2)):
        nb=A[i]
        if not nb: continue
        m=np.mean([N2[j] for j in nb],axis=0); out[i]=N2[i]+w*(m-N2[i])
    return out
for _ in range(5): N2=sm(0.55); N2=sm(-0.54)
cnt=Counter(cl for _,_,cl in E2); print('classes',dict(cnt))
json.dump(dict(nodes=[[round(float(x),1),round(float(z),1)] for x,z in N2],
               edges=[[u,v,cl] for u,v,cl in E2]), open('roads_final.json','w'))
print('saved roads_final.json')
