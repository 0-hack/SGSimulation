// Verifies road centre-line smoothing: a sharp hand-drawn waveform comes out with
// rounded bends (no sharp tips), while a straight line stays straight.
import { smoothRoute } from '../../public/js/engine.js';
let pass=0, fail=0; const ok=(c,m)=>{c?(pass++,console.log('  ✓',m)):(fail++,console.log('  ✗',m));};

const maxTurnDeg = (P) => {
  let mx=0;
  for(let i=1;i<P.length-1;i++){
    const ax=P[i].x-P[i-1].x, az=P[i].z-P[i-1].z, bx=P[i+1].x-P[i].x, bz=P[i+1].z-P[i].z;
    const la=Math.hypot(ax,az)||1, lb=Math.hypot(bx,bz)||1;
    let c=(ax*bx+az*bz)/(la*lb); c=Math.max(-1,Math.min(1,c));
    mx=Math.max(mx, Math.acos(c)*180/Math.PI);
  }
  return mx;
};

// a sharp sawtooth waveform (peaks every few units) — like the user's drawing
const wave=[]; for(let i=0;i<=20;i++) wave.push({x:i*6, z:(i%2)*18});
const rawTurn = maxTurnDeg(wave);
const sm = smoothRoute(wave, 4);
const smTurn = maxTurnDeg(sm);
ok(rawTurn > 90, `raw waveform has sharp tips (${rawTurn.toFixed(0)}° turns)`);
ok(smTurn < 45, `smoothed waveform rounds the tips (max turn ${smTurn.toFixed(0)}° < 45°)`);
ok(sm.length > wave.length, `smoothing densifies the line (${wave.length} → ${sm.length} pts)`);

// a straight line (with a little jitter) stays straight
const line=[]; for(let i=0;i<=15;i++) line.push({x:i*8, z:(i%2?0.4:-0.4)});
const sln = smoothRoute(line, 4);
let dev=0; for(const p of sln) dev=Math.max(dev, Math.abs(p.z));
ok(dev < 1.0, `a straight line stays straight (max deviation ${dev.toFixed(2)} m)`);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail?1:0);
