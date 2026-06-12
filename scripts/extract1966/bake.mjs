// Bake the 1966 extraction (/tmp/trace JSONs) into the game source.
import { readFileSync, writeFileSync } from 'node:fs';
const T='/tmp/trace/';
const land=JSON.parse(readFileSync(T+'land1966.json'));
const water=JSON.parse(readFileSync(T+'water_final.json'));
const roads=JSON.parse(readFileSync(T+'roads_final.json'));
const dem=JSON.parse(readFileSync(T+'dem_final.json'));
const xf=JSON.parse(readFileSync(T+'game_xform.json'));
const r3=v=>Math.round(v*1000)/1000, r4=v=>Math.round(v*10000)/10000;
const dec=(p,minD)=>{const out=[p[0]];let last=p[0];
 for(let i=1;i<p.length-1;i++){const d=Math.hypot(p[i][0]-last[0],p[i][1]-last[1]);if(d>=minD){out.push(p[i]);last=p[i];}}
 out.push(p[p.length-1]);return out.map(([x,y])=>[r4(x),r4(y)]);};
const area=p=>{let a=0;for(let i=0;i<p.length;i++){const j=(i+1)%p.length;a+=p[i][0]*p[j][1]-p[j][0]*p[i][1];}return Math.abs(a/2);};

// ---- shape.js ----
const mainland=dec(land.mainland,0.0042);
let isles=land.islands.filter(p=>p.length>=6&&area(p)>=1.2e-5).sort((a,b)=>area(b)-area(a)).slice(0,30).map(p=>dec(p,0.003));
const johor=land.johor.map(p=>dec(p,0.004)).filter(p=>p.length>=8);
let s=readFileSync('public/js/shape.js','utf8');
const repl=(txt,name,val)=>{const re=new RegExp(`export const ${name} = \\[[\\s\\S]*?\\];`);if(!re.test(txt))throw new Error(name);return txt.replace(re,()=>`export const ${name} = ${val};`);};
const arr1=p=>'['+p.map(([x,y])=>`[${x}, ${y}]`).join(', ')+']';
const arr2=ps=>'[\n  '+ps.map(arr1).join(',\n  ')+'\n]';
s=repl(s,'SG_OUTLINE',arr1(mainland));
s=repl(s,'SG_ISLANDS',arr2(isles));
s=repl(s,'SG_FOREIGN',arr2(johor));
writeFileSync('public/js/shape.js',s);
console.log('shape.js: outline',mainland.length,'isles',isles.length,'johor',johor.length);

// ---- roads1966.js (+ reservoirs) ----
const RN=roads.nodes, RE=roads.edges;
const resv=water.map(p=>dec(p,0.002));
const body=`// 1966 Singapore: road network, reservoirs — extracted from the survey-map
// GeoTIFF via its EPSG:3857 georeferencing (exact, no fitted warp).
// NODES: [x,z] world units (${(xf.SPAN/1600).toFixed(2)} m/unit). EDGES: [a,b,oneway,class]
// class: 1 first-class metalled, 2 second-class, 3 track/minor.
export const ROAD_NODES_1966 = [${RN.map(p=>`[${p[0]},${p[1]}]`).join(', ')}];

export const ROAD_EDGES_1966 = [${RE.map(([u,v,c])=>`[${u},${v},0,${c}]`).join(',')}];

export const RESERVOIRS_1966 = ${JSON.stringify(resv)};
`;
writeFileSync('public/js/roads1966.js',body);
console.log('roads1966.js: nodes',RN.length,'edges',RE.length,'resv',resv.length);

// ---- heights1966.js ----
const hb=`// 1966 terrain heightfield, built from the survey map's 25-ft contour lines
// (black-hat line extraction -> min-direction crossing counts -> smoothed).
// Heights in world units x10 (uint8). Bounds in normalised island coords.
export const HEIGHTS_1966 = {
  w: ${dem.w}, h: ${dem.h}, scale: ${dem.scale},
  x0: ${dem.x0}, y1: ${dem.y1}, x1: ${dem.x1}, y0: ${dem.y0},
  data: Uint8Array.from(atob('${Buffer.from(Uint8Array.from(dem.data)).toString('base64')}'), c => c.charCodeAt(0)),
};
`;
writeFileSync('public/js/heights1966.js',hb);
console.log('heights1966.js:',dem.w,'x',dem.h);

// ---- trace-data.json (tracer guide + bg bounds under the new transform) ----
const X0=11532818.827667393, Y0=168467.21034052968, PX=0.5971642834779467;
const SHW=109056, SHH=56320;
const gxL=(X0-xf.GX0)/xf.SPAN, gxR=(X0+SHW*PX-xf.GX0)/xf.SPAN;
const gyT=(Y0-xf.GY0)/xf.SPAN, gyB=(Y0-SHH*PX-xf.GY0)/xf.SPAN;
writeFileSync('public/trace-data.json',JSON.stringify({outline:mainland,islands:isles,
  bg:{gxL:r4(gxL),gxR:r4(gxR),gyB:r4(gyB),gyT:r4(gyT),img:'/trace-map.jpg'}}));
console.log('trace-data.json bg x',r3(gxL),r3(gxR),'y',r3(gyB),r3(gyT));
