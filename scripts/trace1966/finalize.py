import numpy as np, pickle, json
from matplotlib.path import Path

WORLD=1600.0
G=pickle.load(open('graph.pkl','rb')); H,W=G['H'],G['W']
sx,tx,sy,ty=np.load('xform.npy')
def to_world(E):  # E: map-space (mx,my) -> world (x,z)
    gx=sx*E[:,0]+tx; gy=sy*E[:,1]+ty
    return np.column_stack([(gx-0.5)*WORLD,(0.5-gy)*WORLD]), gx, gy

# --- same crop + frame filter as registration; keep sknw endpoints (a,b) ---
kept=[]   # (a,b, world_pts)
for a,b,pts in G['edges']:
    E=np.column_stack([pts[:,1]/W,1-pts[:,0]/H]); cen=E.mean(0)
    if not (0.0<=cen[0]<=0.70 and 0.14<=cen[1]<=0.66): continue
    chord=np.hypot(*(E[-1]-E[0])); path=np.hypot(np.diff(E[:,0]),np.diff(E[:,1])).sum()
    if chord>0.06 and path>0 and chord/path>0.97:
        ang=np.arctan2(abs(E[-1,1]-E[0,1]),abs(E[-1,0]-E[0,0]))
        if ang<0.09 or ang>np.pi/2-0.09: continue
    Wp,_,_=to_world(E)
    kept.append((a,b,Wp))

# --- build node/edge graph: junctions keep sknw id; interiors decimated ---
STEP=11.0
nodes=[]; nid={}; edges=[]
def jnode(jid, xy):
    key=('j',int(jid))
    if key not in nid: nid[key]=len(nodes); nodes.append([xy[0],xy[1]])
    return nid[key]
def newnode(xy):
    nodes.append([xy[0],xy[1]]); return len(nodes)-1
for a,b,Wp in kept:
    ia=jnode(a,Wp[0]); ib=jnode(b,Wp[-1])
    # decimate interior by arc length
    chain=[ia]; last=Wp[0]
    for k in range(1,len(Wp)-1):
        if np.hypot(*(Wp[k]-last))>=STEP:
            chain.append(newnode(Wp[k])); last=Wp[k]
    chain.append(ib)
    for u,v in zip(chain[:-1],chain[1:]):
        if u!=v: edges.append((u,v))
nodes=np.array(nodes,float)
print('raw nodes',len(nodes),'edges',len(edges))

# --- exclusions in normalized coords ---
nx=nodes[:,0]/WORLD+0.5; ny=0.5-nodes[:,1]/WORLD
outline=np.array(json.load(open('sg_outline.json'))['outline'])
inside=Path(outline).contains_points(np.column_stack([nx,ny]), radius=0.012) | \
       Path(outline).contains_points(np.column_stack([nx,ny]), radius=-0.0)
terr=((nx-0.412)/0.105)**2+((ny-0.498)/0.168)**2 < 1.0
airport=(nx>0.548)&(nx<0.623)&(ny>0.398)&(ny<0.540)
ok = inside & ~terr & ~airport
print('nodes inside',int(inside.sum()),'after excl',int(ok.sum()))

# remap kept nodes, drop edges touching removed
remap=-np.ones(len(nodes),int); keptidx=np.where(ok)[0]
for i,k in enumerate(keptidx): remap[k]=i
N2=nodes[keptidx]
E2=[(remap[u],remap[v]) for u,v in edges if ok[u] and ok[v] and remap[u]!=remap[v]]
E2=list({(min(u,v),max(u,v)) for u,v in E2})
print('after clip: nodes',len(N2),'edges',len(E2))

# --- bridge fragmented road endpoints (snap degree-1 nodes to nearby graph) ---
from scipy.spatial import cKDTree
def adjacency0(n,E):
    A=[set() for _ in range(n)]
    for u,v in E: A[u].add(v); A[v].add(u)
    return A
for _ in range(3):
    A=adjacency0(len(N2),E2)
    tree=cKDTree(N2)
    add=set()
    for i in range(len(N2)):
        if len(A[i])!=1: continue                 # only dead-ends
        dd,ii=tree.query(N2[i],k=8)
        for d,j in zip(dd,ii):
            if j==i or j in A[i]: continue
            if d<=18.0:                            # gap to bridge (world units)
                add.add((min(i,j),max(i,j))); break
    if not add: break
    E2=list(set(E2)|add)
print('after bridging edges',len(E2))

# --- drop tiny components + prune short spurs ---
def adjacency(n,E):
    A=[set() for _ in range(n)]
    for u,v in E: A[u].add(v); A[v].add(u)
    return A
A=adjacency(len(N2),E2)
comp=-np.ones(len(N2),int); c=0
for s in range(len(N2)):
    if comp[s]!=-1 or not A[s]: continue
    st=[s]; comp[s]=c; members=[s]
    while st:
        u=st.pop()
        for w in A[u]:
            if comp[w]==-1: comp[w]=c; members.append(w); st.append(w)
    c+=1
# component sizes
from collections import Counter
cnt=Counter(comp[comp>=0])
keepc={k for k,v in cnt.items() if v>=10}
E2=[(u,v) for u,v in E2 if comp[u] in keepc and comp[v] in keepc]
# prune spurs
for _ in range(4):
    A=adjacency(len(N2),E2); before=len(E2)
    E2=[(u,v) for u,v in E2 if not(((len(A[u])==1)or(len(A[v])==1)) and np.hypot(*(N2[u]-N2[v]))<6.0)]
    if len(E2)==before: break
# compact
used=sorted({u for e in E2 for u in e}); rm={u:i for i,u in enumerate(used)}
N3=N2[used]; E3=[(rm[u],rm[v]) for u,v in E2]
print('pruned: nodes',len(N3),'edges',len(E3))

# --- Taubin smoothing (topology preserved) ---
def smooth(N,E,w):
    A=adjacency(len(N),E); out=N.copy()
    for i in range(len(N)):
        if not A[i]: continue
        m=np.mean([N[j] for j in A[i]],axis=0); out[i]=N[i]+w*(m-N[i])
    return out
for _ in range(6):
    N3=smooth(N3,E3,0.55); N3=smooth(N3,E3,-0.54)

rd=lambda v:round(float(v),1)
onodes=[[rd(x),rd(z)] for x,z in N3]
oedges=[f'[{u},{v},0]' for u,v in E3]
res=json.load(open('reservoirs.json'))
body=("// 1966 Singapore road network + reservoirs, traced from the 1966 survey map\n"
"// (NUS Libmaps GeoTIFF) at high resolution (pyramid level 3), georeferenced\n"
"// onto the game island and smoothed. NODES: [x,z] world. EDGES: [a,b,oneway].\n"
"export const ROAD_NODES_1966 = ["+", ".join(f'[{x},{z}]' for x,z in onodes)+"];\n\n"
"export const ROAD_EDGES_1966 = ["+",".join(oedges)+"];\n\n"
"export const RESERVOIRS_1966 = "+json.dumps(res)+";\n")
open('/home/user/SGSimulation/public/js/roads1966.js','w').write(body)
print('WROTE roads1966.js  nodes',len(onodes),'edges',len(oedges))
