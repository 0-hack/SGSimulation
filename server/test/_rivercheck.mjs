// Chain ALL of the owner's mainland arcs into loops (greedy, tolerant), then render
// land(green)/water(blue) at the river to confirm the river becomes a WATER NOTCH in
// the coastline (not a flood, not islands). No files written.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const nt = JSON.parse(readFileSync(process.env.NEW,'utf8'));
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url),'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const TOL=4/1600;
function chain(polys){ const closed=[],open=[];
  for(const p of polys){ (p.length>=3 && dist(p[0],p[p.length-1])<2/1600 ? closed:open).push(p.slice()); }
  const used=new Array(open.length).fill(false), loops=[...closed];
  for(let i=0;i<open.length;i++){ if(used[i])continue; let ch=open[i].slice(); used[i]=true;
    for(let g=0;g<=open.length;g++){ const end=ch[ch.length-1]; let best=-1,bd=TOL,rev=false;
      for(let j=0;j<open.length;j++){ if(used[j])continue; const ds=dist(end,open[j][0]),de=dist(end,open[j][open[j].length-1]);
        if(ds<bd){bd=ds;best=j;rev=false;} if(de<bd){bd=de;best=j;rev=true;} }
      if(best<0)break; const seg=rev?open[best].slice().reverse():open[best]; ch.push(...seg.slice(1)); used[best]=true; }
    loops.push(ch); }
  return loops;
}
const polyArea=(p)=>{let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2);};
const loops=chain(nt.mainland||[]).filter(p=>p.length>=3).sort((a,b)=>polyArea(b)-polyArea(a));
console.log('mainland pieces',(nt.mainland||[]).length,'-> loops', loops.length, '| largest pts', loops[0].length, '| areas top5', loops.slice(0,5).map(l=>(polyArea(l)*1600*1600|0)).join(','));
const outline=loops[0], islands=loops.slice(1);
// render coastfill at river region
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
const p=await browser.newPage(); const S=1300; await p.setViewport({width:S,height:S});
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const [x0,z0,x1,z1]=(process.env.BOX||'-90,-200,60,-90').split(',').map(Number);
const b64=await p.evaluate(async({S,bg,mapB64,outline,islands,x0,z0,x1,z1})=>{
  const cv=document.getElementById('c'),ctx=cv.getContext('2d');
  const img=new Image();img.src='data:image/jpeg;base64,'+mapB64;await new Promise(r=>{img.onload=r;});
  const nx0=x0/1600+0.5,nx1=x1/1600+0.5,nyT=0.5-z1/1600,nyB=0.5-z0/1600;
  const sx=S/(nx1-nx0),sy=S/(nyB-nyT); const X=nx=>(nx-nx0)*sx,Y=ny=>(ny-nyT)*sy;
  ctx.fillStyle='#12324a';ctx.fillRect(0,0,S,S);
  ctx.globalAlpha=0.35;ctx.drawImage(img,X(bg.gxL),Y(1-bg.gyT),(bg.gxR-bg.gxL)*sx,(bg.gyT-bg.gyB)*sy);ctx.globalAlpha=1;
  ctx.globalAlpha=0.55;ctx.fillStyle='#2f7d32';
  const fill=(poly)=>{ctx.beginPath();poly.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();ctx.fill();};
  fill(outline);for(const is of islands)fill(is); ctx.globalAlpha=1;
  ctx.strokeStyle='#7CFC8A';ctx.lineWidth=2;
  const stroke=(poly)=>{ctx.beginPath();poly.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();ctx.stroke();};
  stroke(outline);ctx.strokeStyle='#ffcf40';for(const is of islands)stroke(is);
  return cv.toDataURL('image/jpeg',0.9);
},{S,bg,mapB64,outline,islands,x0,z0,x1,z1});
writeFileSync(process.env.OUT, Buffer.from(b64.split(',')[1],'base64'));
console.log('saved',process.env.OUT);
await browser.close();
