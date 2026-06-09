// backtest18m.js — M15 strategy quick test (run once bt_data_m15/ has data)
// Uses same engine as backtest18 but on 15-min bars.
// Requires: node fetch_dukascopy.js EURUSD 2020 2026 (and GBPUSD, USDJPY, etc.)

const IST = 5.5 * 3600;
const fs  = require('fs');

const DATA_M15 = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_m15/';
const DATA_1H  = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';

function load(name, dir) {
  const p = `${dir}${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t:x.t, day:d.toISOString().slice(0,10),
             min:d.getUTCHours()*60+d.getUTCMinutes(), o:x.o, h:x.h, l:x.l, c:x.c };
  });
}
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function atr(B,k,n=14){ let s=0,c=0; for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
function rsC(B,secs){ const m=new Map(); for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}} return[...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c})); }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:'sup',lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:'res',lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});} for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:'sup',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:'res',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});} return z; }
function emaSer(TS){ const e=ema(TS.map(x=>x.c),10); return TS.map((b,i)=>({end:b.end,v:e[i]})); }
function trendAt(s,te,price){ let v=null; for(const x of s){if(x.end<=te)v=x.v;else break;} return v==null?null:(price>=v?'bull':'bear'); }

function mgmtTiered(E,k,dir,entry,sl,tp1,tp2,tp3){
  const risk=Math.abs(entry-sl),parts=[{f:1/3,r:tp1},{f:1/3,r:tp2},{f:1/3,r:tp3}],done=[false,false,false];
  let rem=1,real=0,stop=sl,be=false;
  for(let i=k+1;i<E.length&&i<k+288;i++){  // 288 = 72h of M15 bars
    const b=E[i];
    if(dir==='long'?b.l<=stop:b.h>=stop){real+=rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk);rem=0;break;}
    for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==='long'?entry+parts[ti].r*risk:entry-parts[ti].r*risk;if(dir==='long'?b.h>=tp:b.l<=tp){real+=parts[ti].f*parts[ti].r;rem-=parts[ti].f;done[ti]=true;if(!be){stop=entry;be=true;}}}
    if(rem<=1e-9)break;
  }
  if(rem>1e-9){const last=E[Math.min(k+287,E.length-1)];real+=rem*Math.max(-1,Math.min(tp3,(dir==='long'?(last.c-entry):(entry-last.c))/risk));}
  return real;
}

function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){const n=a.length,win=a.filter(s=>s.R>0).length,tot=a.reduce((x,s)=>x+s.R,0),ci=wilson(win,n);const ts=a.map(x=>x.t),mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;const tr=a.filter(x=>x.t<mid),te=a.filter(x=>x.t>=mid);return{n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,tot,eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0};}

const CACHE = {};
function inst(name, dir=DATA_M15) {
  const key = `${dir}${name}`;
  if (!CACHE[key]) {
    const B = load(name, dir);
    if (!B) return null;
    // For M15 base data: compute zones from D/4H/2H/1H (same HTF anchors as 1H backtest)
    const Dc=rsC(B,86400), H4c=rsC(B,14400), H2c=rsC(B,7200), H1c=rsC(B,3600);
    CACHE[key] = { B, Dc,
      Z: { D:zones(Dc), '4H':zones(H4c), '2H':zones(H2c), '1H':zones(H1c) },
      Da:emaSer(Dc), H4a:emaSer(H4c), H1a:emaSer(H1c) };
  }
  return CACHE[key];
}

function run(name, cfg, dataDir=DATA_M15) {
  const d=inst(name,dataDir); if(!d)return[];
  const{B,Dc,Z,Da,H4a,H1a}=d;
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,price,te)=>{let n=0;for(const tf of['D','4H','2H','1H'])if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;return n;};
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
  const kzOK=m=>cfg.kz==='ny-am'?nyam(m):cfg.kz==='london'?london(m):nyam(m)||london(m);
  const out=[],seen=new Set();
  // Lookback for recent high/low uses 6 bars; at M15, 6 bars = 1.5 hours (reasonable recent structure)
  const LOOK=cfg.look||6;
  for(let k=50;k<B.length-5;k++){
    const b=B[k]; if(!kzOK(b.min)||seen.has(b.day))continue;
    const A=atr(B,k); if(A<=0)continue;
    const dailies=Dc.filter(x=>x.end<=b.t); if(dailies.length<5)continue;
    const dr=dailies.slice(-5),drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    // Recent structure: look back LOOK bars (at M15 = LOOK×15 min)
    const rl=Math.min(...Array.from({length:LOOK},(_,o)=>B[k-1-o].l));
    const rh=Math.max(...Array.from({length:LOOK},(_,o)=>B[k-1-o].h));
    const range=(b.h-b.l)||1;
    const d1=trendAt(Da,b.t,b.c),h4=trendAt(H4a,b.t,b.c),h1=trendAt(H1a,b.t,b.c);
    if(!d1||!h4||!h1)continue;
    const trendOK=dir=>cfg.trend==='all3'?(d1===dir&&h4===dir&&h1===dir):(h4===dir&&h1===dir);
    let dir=null,entry,sl;
    if(b.l<rl&&b.c>rl&&b.c<eq){
      const wick=(Math.min(b.o,b.c)-b.l)/range;
      if(wick>=cfg.wick&&stk('sup',b.c,b.t)>=cfg.stack&&trendOK('bull'))
        {dir='long';entry=b.c;sl=b.l;}
    } else if(b.h>rh&&b.c<rh&&b.c>eq){
      const wick=(b.h-Math.max(b.o,b.c))/range;
      if(wick>=cfg.wick&&stk('res',b.c,b.t)>=cfg.stack&&trendOK('bear'))
        {dir='short';entry=b.c;sl=b.h;}
    }
    if(!dir)continue;
    // Displacement filter on next M15 bar
    if(cfg.disp&&k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      if(dir==='long'){if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
      else{if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
    }
    const R=mgmtTiered(B,k,dir,entry,sl,1,1.7,2.56);
    out.push({t:b.t,R,dir,inst:name});seen.add(b.day);
  }
  return out;
}

function setRun(names,cfg,dir) { let o=[];names.forEach(n=>o=o.concat(run(n,cfg,dir)));return o; }
function pr(lbl,trades,cols=62){
  const s=st(trades);
  if(!s.n){console.log(lbl.padEnd(cols),`n=   0`);return;}
  const gen=(s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(lbl.padEnd(cols),`n=${String(s.n).padStart(4)} wr=${s.wr.toFixed(1).padStart(5)}% [${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}] exp=${s.exp.toFixed(3).padStart(7)}R Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`);
}

// Find available M15 instruments
if (!fs.existsSync(DATA_M15)) {
  console.log('ERROR: bt_data_m15/ not found. Run fetch_dukascopy.js first.');
  process.exit(1);
}
const M15_INSTS = fs.readdirSync(DATA_M15).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''));
console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`backtest18m — M15 TIMEFRAME STRATEGY`);
console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`Available M15 instruments: ${M15_INSTS.join(', ')}`);
M15_INSTS.forEach(n => {
  const d=load(n,DATA_M15); if(!d)return;
  console.log(`  ${n.padEnd(12)} ${d.length} M15 bars  ${new Date(d[0].t*1000).toISOString().slice(0,10)} → ${new Date(d[d.length-1].t*1000).toISOString().slice(0,10)}`);
});

// Also compare against 1H results for same instruments on same date range
const SHARED = M15_INSTS.filter(n => fs.existsSync(`${DATA_1H}${n}.json`));

const BASE  = {trend:'h4h1', stack:2, kz:'ny-am', wick:0.5};
const DISP  = {...BASE, disp:true};
const DISPB = {...BASE, disp:true, kz:'both'};

console.log('\n── 1H BASELINE (same instruments, for comparison) ──\n');
pr('1H OG baseline',           setRun(SHARED, BASE,  DATA_1H));
pr('1H OG + disp + both KZ',   setRun(SHARED, DISPB, DATA_1H));

console.log('\n── M15 ORIGINAL STRATEGY ──\n');
pr('M15 OG baseline (NY-AM)',  setRun(M15_INSTS, BASE,  DATA_M15));
pr('M15 OG + disp (NY-AM)',    setRun(M15_INSTS, DISP,  DATA_M15));
pr('M15 OG + disp + both KZ', setRun(M15_INSTS, DISPB, DATA_M15));
pr('M15 OG + disp + London',  setRun(M15_INSTS, {...BASE,disp:true,kz:'london'}, DATA_M15));
// With longer lookback for M15 (24 bars = 6h of recent structure)
pr('M15 OG + disp + look24',  setRun(M15_INSTS, {...DISPB, look:24}, DATA_M15));

console.log('\n── M15 KEY CONFIGS ──\n');
const M15_CONFIGS = [
  {label:'M15 OG disp+NY-AM  wick0.5 stk2', cfg:{...DISP,  look:6}},
  {label:'M15 OG disp+bothKZ wick0.5 stk2', cfg:{...DISPB, look:6}},
  {label:'M15 OG disp+London wick0.5 stk2', cfg:{...BASE,disp:true,kz:'london',look:6}},
  {label:'M15 OG disp+bothKZ wick0.55 stk2',cfg:{...DISPB, wick:0.55, look:6}},
  {label:'M15 OG disp+bothKZ wick0.6 stk2', cfg:{...DISPB, wick:0.6, look:6}},
  {label:'M15 OG disp+bothKZ wick0.5 stk3', cfg:{...DISPB, stack:3, look:6}},
  {label:'M15 OG disp+bothKZ look=12',       cfg:{...DISPB, look:12}},
  {label:'M15 OG disp+bothKZ look=24',       cfg:{...DISPB, look:24}},
  {label:'M15 OG baseline',                  cfg:{...BASE,  look:6}},
];
for(const {label,cfg} of M15_CONFIGS){
  pr(label, setRun(M15_INSTS,cfg,DATA_M15));
}

console.log('\n── SIGNAL FREQUENCY ──\n');
const yrs=M15_INSTS.length>0?(()=>{
  const d=load(M15_INSTS[0],DATA_M15);
  return d?((d[d.length-1].t-d[0].t)/86400/365.25):1;
})():1;
[
  ['M15 baseline',          setRun(M15_INSTS,BASE,DATA_M15)],
  ['M15 + disp + both KZ',  setRun(M15_INSTS,DISPB,DATA_M15)],
  ['1H + disp + both KZ',   setRun(SHARED,DISPB,DATA_1H)],
].forEach(([lbl,t])=>
  console.log(`  ${lbl.padEnd(25)} n=${String(t.length).padStart(4)} → ${(t.length/yrs).toFixed(1).padStart(5)}/year`)
);
