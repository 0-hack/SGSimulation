// Render land (inside SG_OUTLINE, minus... ) vs water over the survey map, to SEE
// how the coastline carves. env BOX=x0,z0,x1,z1  OUT=file.png
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const sh = await import('../../public/js/shape.js?u='+Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url),'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const [x0,z0,x1,z1]=(process.env.BOX||'-90,-200,60,-90').split(',').map(Number);
const outline = sh.SG_OUTLINE, islands = sh.SG_ISLANDS||[];
const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
const p = await browser.newPage(); const S=1400; await p.setViewport({width:S,height:S});
await p.setContent(`<canvas id=c width=${S} height=${S}></canvas>`);
const b64 = await p.evaluate(async ({S,bg,mapB64,outline,islands,x0,z0,x1,z1})=>{
  const cv=document.getElementById('c'),ctx=cv.getContext('2d');
  const img=new Image(); img.src='data:image/jpeg;base64,'+mapB64; await new Promise(r=>{img.onload=r;});
  const nx0=x0/1600+0.5,nx1=x1/1600+0.5, nyT=0.5-z1/1600, nyB=0.5-z0/1600;
  const sx=S/(nx1-nx0), sy=S/(nyB-nyT);
  const X=nx=>(nx-nx0)*sx, Y=ny=>(ny-nyT)*sy;
  ctx.fillStyle='#12324a'; ctx.fillRect(0,0,S,S); // water base
  // draw map faded
  ctx.globalAlpha=0.35; ctx.drawImage(img, X(bg.gxL), Y(1-bg.gyT), (bg.gxR-bg.gxL)*sx, (bg.gyT-bg.gyB)*sy); ctx.globalAlpha=1;
  // fill land (mainland) green, then islands green, with a semi-transparent overlay
  ctx.globalAlpha=0.5; ctx.fillStyle='#2f7d32';
  const fill=(poly)=>{ctx.beginPath(); poly.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny); i?ctx.lineTo(px,py):ctx.moveTo(px,py);}); ctx.closePath(); ctx.fill();};
  fill(outline); for(const is of islands) fill(is);
  ctx.globalAlpha=1;
  // outline the coast crisply
  ctx.strokeStyle='#7CFC8A'; ctx.lineWidth=2;
  const stroke=(poly)=>{ctx.beginPath(); poly.forEach(([nx,ny],i)=>{const px=X(nx),py=Y(ny); i?ctx.lineTo(px,py):ctx.moveTo(px,py);}); ctx.closePath(); ctx.stroke();};
  stroke(outline); ctx.strokeStyle='#ffcf40'; for(const is of islands) stroke(is);
  return cv.toDataURL('image/jpeg',0.9);
},{S,bg,mapB64,outline,islands,x0,z0,x1,z1});
writeFileSync(process.env.OUT, Buffer.from(b64.split(',')[1],'base64'));
console.log('saved', process.env.OUT);
await browser.close();
