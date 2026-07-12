// Preview: score every road by red-casing presence along it (perpendicular band),
// then render the box with roads GREEN (would flip dirt->2way: on a printed road)
// vs RED (stays: no casing = genuine track) vs GREY (already 2-way/1-way).
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
const rd = await import('../../public/js/roads1966.js?u=' + Date.now());
const bg = JSON.parse(readFileSync(new URL('../../public/trace-data.json', import.meta.url), 'utf8')).bg;
const mapB64 = readFileSync(new URL('../../public/trace-map.jpg', import.meta.url)).toString('base64');
const N = rd.ROAD_NODES_1966, E = rd.ROAD_EDGES_1966;
const [bx0,bz0,bx1,bz1] = (process.env.BOX || '-115,-205,-10,-120').split(',').map(Number);
const out = await (async () => {
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'], protocolTimeout: 600000 });
  const p = await browser.newPage();
  const r = await p.evaluate(async ({ mapB64, bg, N, E, box }) => {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + mapB64;
    await new Promise((r)=>{ img.onload=r; });
    const WF=img.naturalWidth, HF=img.naturalHeight;
    const toPixG=(nx,ny)=>[(nx-bg.gxL)/(bg.gxR-bg.gxL)*WF,(ny-(1-bg.gyT))/(bg.gyT-bg.gyB)*HF];
    const nb=(wx,wz)=>[wx/1600+0.5,0.5-wz/1600];
    const [gx0,gy1]=toPixG(...nb(box[0],box[1])),[gx1,gy0]=toPixG(...nb(box[2],box[3]));
    const cx0=Math.max(0,Math.floor(gx0)),cy0=Math.max(0,Math.floor(gy0));
    const W=Math.min(WF,Math.ceil(gx1))-cx0,H=Math.min(HF,Math.ceil(gy1))-cy0;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx=cv.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,cx0,cy0,W,H,0,0,W,H);
    const d=ctx.getImageData(0,0,W,H).data;
    const isRed=(x,y)=>{ if(x<0||y<0||x>=W||y>=H)return false; const i=(y*W+x)*4,r=d[i],g=d[i+1],b=d[i+2];
      return r>=95&&r<=215&&g<100&&b<120&&r-g>=40&&r-b>=35; };
    const P=(nx,ny)=>{ const [gx,gy]=toPixG(nx,ny); return [gx-cx0,gy-cy0]; };
    // full-res score for an edge: fraction of along-samples with red within +-9px perpendicular
    const score=(A,B)=>{ const [ax,ay]=P(...A),[bx,by]=P(...B); const L=Math.hypot(bx-ax,by-ay); if(L<1)return 0;
      const ux=(bx-ax)/L,uy=(by-ay)/L, nx=-uy,ny=ux; const steps=Math.max(2,Math.ceil(L/3)); let hit=0,tot=0;
      for(let s=0;s<=steps;s++){ const t=s/steps, x=ax+(bx-ax)*t, y=ay+(by-ay)*t; tot++;
        let f=false; for(let o=-9;o<=9;o++){ if(isRed(Math.round(x+nx*o),Math.round(y+ny*o))){ f=true; break; } } if(f)hit++; }
      return hit/tot; };
    // dim map
    ctx.globalAlpha=0.4; ctx.fillStyle='#0e1118'; ctx.fillRect(0,0,W,H); ctx.globalAlpha=1;
    ctx.lineCap='round'; ctx.lineWidth=2.4;
    let flip=0, stay=0;
    const scores=[];
    for(const e of E){ const A=N[e[0]],B=N[e[1]]; const An=[A[0]/1600+0.5,0.5-A[1]/1600],Bn=[B[0]/1600+0.5,0.5-B[1]/1600];
      const mx=(A[0]+B[0])/2,mz=(A[1]+B[1])/2; if(mx<box[0]-5||mx>box[2]+5||mz<box[1]-5||mz>box[3]+5) continue;
      const dirt=!!e[4], twoway=!e[2]&&!e[4];
      let col;
      if(!dirt){ col='rgba(120,120,140,0.55)'; }
      else { const sc=score(An,Bn); scores.push(sc);
        if(sc>=0.75){ col='#22dd44'; flip++; } else { col='#ff3040'; stay++; } }
      const [px0,py0]=P(...An),[px1,py1]=P(...Bn);
      ctx.strokeStyle=col; ctx.beginPath(); ctx.moveTo(px0,py0); ctx.lineTo(px1,py1); ctx.stroke();
    }
    const sc2=scores.sort((a,b)=>a-b);
    const scale=Math.min(1,1500/W); const o2=document.createElement('canvas'); o2.width=Math.round(W*scale); o2.height=Math.round(H*scale);
    o2.getContext('2d').drawImage(cv,0,0,o2.width,o2.height);
    return { png:o2.toDataURL('image/jpeg',0.85), flip, stay, p10:sc2[Math.floor(sc2.length*0.1)]||0, p50:sc2[Math.floor(sc2.length*0.5)]||0, p90:sc2[Math.floor(sc2.length*0.9)]||0 };
  }, { mapB64, bg, N, E, box:[bx0,bz0,bx1,bz1] });
  await browser.close(); return r;
})();
writeFileSync(process.env.OUT || '/tmp/reflag.png', Buffer.from(out.png.split(',')[1],'base64'));
console.log('saved', process.env.OUT, '| dirt flip(green)', out.flip, 'stay(red)', out.stay, '| dirt score p10/p50/p90', out.p10.toFixed(2), out.p50.toFixed(2), out.p90.toFixed(2));
