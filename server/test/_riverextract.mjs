// Extract the owner's traced Singapore River (the coastline indentation) at full
// resolution, derive a faithful centreline, and render banks(cyan)+centreline(magenta)
// over the survey map so we can confirm it matches the drawn/printed river.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const nt = JSON.parse(readFileSync(process.env.NEW,'utf8'));
const before = await import('/tmp/claude-0/-home-user-SGSimulation/cadd2c3e-e5c3-5c88-a489-860c34f300b0/scratchpad/shape-pre-river.js');
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url),'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const TOL=4/1600;
function chain(polys){const closed=[],open=[];for(const p of polys){(p.length>=3&&dist(p[0],p[p.length-1])<2/1600?closed:open).push(p.slice());}
  const used=new Array(open.length).fill(false),loops=[...closed];
  for(let i=0;i<open.length;i++){if(used[i])continue;let ch=open[i].slice();used[i]=true;
    for(let g=0;g<=open.length;g++){const end=ch[ch.length-1];let best=-1,bd=TOL,rev=false;
      for(let j=0;j<open.length;j++){if(used[j])continue;const ds=dist(end,open[j][0]),de=dist(end,open[j][open[j].length-1]);
        if(ds<bd){bd=ds;best=j;rev=false;}if(de<bd){bd=de;best=j;rev=true;}}
      if(best<0)break;const seg=rev?open[best].slice().reverse():open[best];ch.push(...seg.slice(1));used[best]=true;}
    loops.push(ch);}return loops;}
const polyArea=(p)=>{let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2);};
const outline=chain(nt.mainland||[]).filter(p=>p.length>=3).sort((a,b)=>polyArea(b)-polyArea(a))[0];
// nearest original-coast lookup
const cell=6/1600,grid=new Map(),gk=(x,y)=>Math.floor(x/cell)+','+Math.floor(y/cell);
for(const v of before.SG_OUTLINE){const k=gk(v[0],v[1]);(grid.get(k)||grid.set(k,[]).get(k)).push(v);}
const near=(p)=>{let b=1e9;const cx=Math.floor(p[0]/cell),cy=Math.floor(p[1]/cell);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const arr=grid.get((cx+dx)+','+(cy+dy));if(arr)for(const v of arr){const d=dist(p,v);if(d<b)b=d;}}return b;};
const n=outline.length, dev=outline.map(p=>near(p)>4/1600), idx=k=>((k%n)+n)%n;
let s=dev.indexOf(false); if(s<0)s=0;
const runs=[]; let k=s; while(k<s+n){if(dev[idx(k)]){let j=k;while(j<s+n&&dev[idx(j)])j++;runs.push([k,j-1]);k=j;}else k++;}
runs.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));
const [a,b]=runs[0]; const run=[]; for(let m=a;m<=b;m++)run.push(outline[idx(m)]);
// split at head, pair banks -> dense centreline
const mouth=run[0]; let hi=0,hd=0; run.forEach((p,i)=>{const d=dist(p,mouth);if(d>hd){hd=d;hi=i;}});
const A=run.slice(0,hi+1), B=run.slice(hi).reverse();
const center=[]; for(const p of A){let best=1e9,bp=null;for(const q of B){const d=dist(p,q);if(d<best){best=d;bp=q;}}center.push([(p[0]+bp[0])/2,(p[1]+bp[1])/2,best/2]);}
// light smoothing + moderate simplify (keep the shape)
function simp(pts,eps){if(pts.length<3)return pts;const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;const st=[[0,pts.length-1]];
  while(st.length){const[s,e]=st.pop(),a=pts[s],b=pts[e];const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1e-9;let md=-1,mi=-1;
    for(let i=s+1;i<e;i++){const dd=Math.abs((pts[i][0]-a[0])*dy-(pts[i][1]-a[1])*dx)/L;if(dd>md){md=dd;mi=i;}}if(md>eps&&mi>0){keep[mi]=1;st.push([s,mi],[mi,e]);}}
  return pts.filter((_,i)=>keep[i]);}
const cs=simp(center,0.0006);
console.log('river run pts',run.length,'| centreline',center.length,'-> kept',cs.length);
writeFileSync(process.env.OUT_JSON, JSON.stringify({run,center:cs}));
// render banks + centreline over map, zoomed to river bbox
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
const p=await browser.newPage(); const S=1300; await p.setViewport({width:S,height:S});
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const b64=await p.evaluate(async({S,bg,mapB64,run,cs})=>{
  const cv=document.getElementById('c'),ctx=cv.getContext('2d');
  const img=new Image();img.src='data:image/jpeg;base64,'+mapB64;await new Promise(r=>{img.onload=r;});
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const p of run){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const pad=0.02;x0-=pad;x1+=pad;y0-=pad;y1+=pad; const sx=S/(x1-x0),sy=S/(y1-y0);
  const X=nx=>(nx-x0)*sx,Y=ny=>((1-ny)-(1-y1))*sy;
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,S,S);
  ctx.globalAlpha=0.6;ctx.drawImage(img,X(bg.gxL),Y(bg.gyT),(bg.gxR-bg.gxL)*sx,(bg.gyB-bg.gyT)*sy*-1);ctx.globalAlpha=1;
  ctx.strokeStyle='#37d0ff';ctx.lineWidth=2.5;ctx.beginPath();run.forEach((p,i)=>{const px=X(p[0]),py=Y(p[1]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
  ctx.strokeStyle='#ff2bd6';ctx.lineWidth=2.5;ctx.beginPath();cs.forEach((p,i)=>{const px=X(p[0]),py=Y(p[1]);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
  for(const p of cs){ctx.fillStyle='#ffee00';ctx.beginPath();ctx.arc(X(p[0]),Y(p[1]),3,0,7);ctx.fill();}
  return cv.toDataURL('image/jpeg',0.9);
},{S,bg,mapB64,run,cs});
writeFileSync(process.env.OUT, Buffer.from(b64.split(',')[1],'base64'));
console.log('saved',process.env.OUT);
await browser.close();
