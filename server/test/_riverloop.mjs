// Chain the owner's drawn river coast arcs into a closed loop and render it over the
// survey map (cyan fill = would-be water), so we can confirm it's the river shape.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const nt = JSON.parse(readFileSync(process.env.NEW, 'utf8'));
const sh = await import('../../public/js/shape.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url),'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const cur = [sh.SG_OUTLINE, ...(sh.SG_ISLANDS||[])];
const R=0.6/1600, k=(p)=>Math.round(p[0]/R)+','+Math.round(p[1]/R);
const curKey=new Set(cur.map(p=>k(p[0])+'|'+k(p[p.length-1])+'|'+p.length));
let drawn=(nt.mainland||[]).filter(p=>!curKey.has(k(p[0])+'|'+k(p[p.length-1])+'|'+p.length));
// greedy chain arcs into loops by endpoint proximity (<=3u)
const TOL=3/1600;
const arcs=drawn.map(p=>p.slice());
const loops=[]; const usedA=new Set();
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
for(let i=0;i<arcs.length;i++){ if(usedA.has(i))continue; let loop=arcs[i].slice(); usedA.add(i);
  let extended=true;
  while(extended){ extended=false; const tail=loop[loop.length-1];
    for(let j=0;j<arcs.length;j++){ if(usedA.has(j))continue; const a=arcs[j];
      if(dist(tail,a[0])<=TOL){ loop=loop.concat(a.slice(1)); usedA.add(j); extended=true; break; }
      if(dist(tail,a[a.length-1])<=TOL){ loop=loop.concat(a.slice().reverse().slice(1)); usedA.add(j); extended=true; break; } } }
  loops.push(loop); }
loops.sort((a,b)=>b.length-a.length);
const W=([nx,ny])=>[((nx-0.5)*1600),((0.5-ny)*1600)];
for(const L of loops){ const closed=dist(L[0],L[L.length-1])*1600;
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9; for(const p of L){const [x,z]=W(p);x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
  console.log('loop pts',L.length,'| closed-gap',closed.toFixed(1)+'u | bbox', (x1-x0).toFixed(0)+'x'+(z1-z0).toFixed(0)+'u at ['+((x0+x1)/2).toFixed(0)+','+((z0+z1)/2).toFixed(0)+']'); }
// render biggest loop over map
const river=loops[0];
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
const p=await browser.newPage(); const S=1300; await p.setViewport({width:S,height:S});
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const b64=await p.evaluate(async({S,bg,mapB64,river,cur})=>{
  const cv=document.getElementById('c'),ctx=cv.getContext('2d');
  const img=new Image();img.src='data:image/jpeg;base64,'+mapB64;await new Promise(r=>{img.onload=r;});
  // fit view to river bbox +pad
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for(const p of river){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const pad=0.03; x0-=pad;x1+=pad;y0-=pad;y1+=pad;
  const sx=S/(x1-x0), sy=S/(y1-y0);
  const X=nx=>(nx-x0)*sx, Y=ny=>((1-ny)-(1-y1))*sy;
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,S,S);
  ctx.globalAlpha=0.55; ctx.drawImage(img, X(bg.gxL), Y(bg.gyT), (bg.gxR-bg.gxL)*sx, (bg.gyB-bg.gyT)*sy*-1); ctx.globalAlpha=1;
  ctx.strokeStyle='#7CFC8A';ctx.lineWidth=1.5;
  for(const poly of cur){ctx.beginPath();poly.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}
  ctx.beginPath();river.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
  ctx.fillStyle='rgba(55,150,255,0.45)';ctx.fill(); ctx.strokeStyle='#37d0ff';ctx.lineWidth=2;ctx.stroke();
  return cv.toDataURL('image/jpeg',0.9);
},{S,bg,mapB64,river,cur});
writeFileSync(process.env.OUT, Buffer.from(b64.split(',')[1],'base64'));
console.log('loops:',loops.length,'| saved',process.env.OUT);
await browser.close();
