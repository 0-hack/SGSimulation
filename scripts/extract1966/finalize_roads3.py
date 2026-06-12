import numpy as np, json, pickle, sys
sys.path.insert(0,'/tmp/trace'); from geo import *
from matplotlib.path import Path
from scipy.spatial import cKDTree
from collections import Counter
WORLD=1600.0
xf=json.load(open('game_xform.json')); GX0,GY0,SPAN=xf['GX0'],xf['GY0'],xf['SPAN']
land=json.load(open('land1966.json'))
G=pickle.load(open('roadgraph.pkl','rb')); LEVEL=G['LEVEL']
def px_to_game(pts):
    X,Y=px_to_merc(pts[:,1],pts[:,0],LEVEL); return np.column_stack([(X-GX0)/SPAN,(Y-GY0)/SPAN])
paths=[Path(np.array(land['mainland']))]+[Path(np.array(p)) for p in land['islands'] if len(p)>=6]
on_land=lambda p: any(ph.contains_point(p) for ph in paths)
STEP=11.0
nodes=[]; nid={}
def jnode(j,xy):
    k=('j',int(j))
    if k not in nid: nid[k]=len(nodes); nodes.append(xy)
    return nid[k]
def newnode(xy): nodes.append(xy); return len(nodes)-1
edges=[]
for a,b,pts,wmed in G['edges']:
    NG=px_to_game(pts)
    if not on_land(NG.mean(0)): continue
    WP=np.column_stack([(NG[:,0]-0.5)*WORLD,(0.5-NG[:,1])*WORLD])
    cls=1 if wmed>=2.7 else (2 if wmed>=1.75 else 3)
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
print('on-land nodes',len(nodes),'edges',len(edges))
# 1) prune tiny spurs first (block-outline tips / speckle) — BEFORE bridging
for _ in range(6):
    A=adj(len(nodes),edges); before=len(edges)
    edges=[(u,v,cl) for u,v,cl in edges if not(((len(A[u])==1)or(len(A[v])==1)) and np.hypot(*(nodes[u]-nodes[v]))<2.5)]
    if len(edges)==before: break
print('after spur-prune',len(edges))
# 2) bridge remaining dead-ends (real arterial breaks at labels)
for _ in range(3):
    A=adj(len(nodes),edges); tree=cKDTree(nodes); add=[]
    for i in range(len(nodes)):
        if len(A[i])!=1: continue
        dd,ii=tree.query(nodes[i],k=6)
        for d,j in zip(dd,ii):
            if j==i or j in A[i]: continue
            if 0<d<=10.0: add.append((i,int(j),3)); break
    seen={(min(u,v),max(u,v)) for u,v,_ in edges}
    new=[e for e in add if (min(e[0],e[1]),max(e[0],e[1])) not in seen]
    if not new: break
    edges+=new
print('after bridge',len(edges))
# 3) drop small components
A=adj(len(nodes),edges); comp=-np.ones(len(nodes),int); c=0
for s in range(len(nodes)):
    if comp[s]!=-1 or not A[s]: continue
    st=[s]; comp[s]=c
    while st:
        u=st.pop()
        for w in A[u]:
            if comp[w]==-1: comp[w]=c; st.append(w)
    c+=1
cnt=Counter(comp[comp>=0]); keep={k for k,v in cnt.items() if v>=16}
edges=[e for e in edges if comp[e[0]] in keep]
# 3b) remove tangled clumps: tiny closed loops + dense over-bridged knots
A=adj(len(nodes),edges)
# (a) drop short cycles (perimeter < 26u) made of <=6 nodes — block-outline / bridge loops
import itertools
def edge_len(u,v): return float(np.hypot(*(nodes[u]-nodes[v])))
eset={(min(u,v),max(u,v)) for u,v,_ in edges}
# find small loops via DFS up to length 6 from each node, cheaply
dropL=set()
deg=[len(A[i]) for i in range(len(nodes))]
for s in range(len(nodes)):
    if deg[s]<2: continue
    # BFS rings up to 6 nodes back to s
    stack=[(s,[s])]
    while stack:
        u,path=stack.pop()
        if len(path)>4: continue
        for w in A[u]:
            if w==s and len(path)>=3:
                per=sum(edge_len(path[k],path[k+1]) for k in range(len(path)-1))+edge_len(path[-1],s)
                if per<9.5 and len(path)<=4:
                    loop=list(zip(path,path[1:]+[s]))            # de-loop: drop only the shortest edge
                    su,sv=min(loop,key=lambda e:edge_len(*e))
                    dropL.add((min(su,sv),max(su,sv)))
            elif w not in path and len(path)<4:
                stack.append((w,path+[w]))
edges=[(u,v,cl) for u,v,cl in edges if (min(u,v),max(u,v)) not in dropL]
print('after loop-drop',len(edges))
# (b) thin out high-degree knots: where a node has degree>=5, keep its 3 longest spokes
A=adj(len(nodes),edges)
keepE=set()
adjE={}
for u,v,cl in edges:
    adjE.setdefault(u,[]).append((v,cl)); adjE.setdefault(v,[]).append((u,cl))
drop=set()
for i in range(len(nodes)):
    if len(A[i])>=6:
        spokes=sorted(A[i], key=lambda j:-edge_len(i,j))
        for j in spokes[4:]:
            drop.add((min(i,j),max(i,j)))
edges=[(u,v,cl) for u,v,cl in edges if (min(u,v),max(u,v)) not in drop]
print('after knot-thin',len(edges))

# 4) final spur prune + compact + smooth
for _ in range(4):
    A=adj(len(nodes),edges); before=len(edges)
    edges=[(u,v,cl) for u,v,cl in edges if not(((len(A[u])==1)or(len(A[v])==1)) and np.hypot(*(nodes[u]-nodes[v]))<4.0)]
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
for _ in range(4): N2=sm(0.5); N2=sm(-0.49)
print('FINAL nodes',len(N2),'edges',len(E2),'classes',dict(Counter(cl for _,_,cl in E2)))
json.dump(dict(nodes=[[round(float(x),1),round(float(z),1)] for x,z in N2], edges=[[u,v,cl] for u,v,cl in E2]), open('roads_final.json','w'))
