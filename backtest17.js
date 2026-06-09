// backtest17.js — Verification run across ALL 14 instruments
// Confirms displacement-filter finding with larger sample. Same leak-free methodology as bt15/16.

const IST = 5.5 * 3600;
const fs = require('fs');

const ALL_INSTRUMENTS = ['NQ','ES','GC','CL','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','GBPJPY','EURJPY','RTY','SI','YM'];
// Focus 6: Siddh's traded instruments
const FOCUS = ['NQ','ES','GC','CL','EURUSD','GBPUSD'];

function load(name) {
  const p = `C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t:x.t, day:d.toISOString().slice(0,10), min:d.getUTCHours()*60+d.getUTCMinutes(), o:x.o, h:x.h, l:x.l, c:x.c };
  });
}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rsC(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return[...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c}));}
function zones(TS){const z=[],n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:'sup',lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:'res',lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:'sup',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:'res',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});}return z;}
function emaSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({end:b.end,v:e[i]}));}
function trendAt(s,te,price){let v=null;for(const x of s){if(x.end<=te)v=x.v;else break;}return v==null?null:(price>=v?'bull':'bear');}

function mgmtTiered(E,k,dir,entry,sl,tp1,tp2,tp3){
  const risk=Math.abs(entry-sl),parts=[{f:1/3,r:tp1},{f:1/3,r:tp2},{f:1/3,r:tp3}],done=[false,false,false];
  let rem=1,real=0,stop=sl,be=false;
  for(let i=k+1;i<E.length&&i<k+72;i++){const b=E[i];if(dir==='long'?b.l<=stop:b.h>=stop){real+=rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk);rem=0;break;}for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==='long'?entry+parts[ti].r*risk:entry-parts[ti].r*risk;if(dir==='long'?b.h>=tp:b.l<=tp){real+=parts[ti].f*parts[ti].r;rem-=parts[ti].f;done[ti]=true;if(!be){stop=entry;be=true;}}}if(rem<=1e-9)break;}
  if(rem>1e-9){const last=E[Math.min(k+71,E.length-1)];real+=rem*Math.max(-1,Math.min(tp3,(dir==='long'?(last.c-entry):(entry-last.c))/risk));}
  return real;
}
function mgmtSingle(E,k,dir,entry,sl,rr){const risk=Math.abs(entry-sl),tp=dir==='long'?entry+rr*risk:entry-rr*risk;for(let i=k+1;i<E.length&&i<k+72;i++){const b=E[i];if(dir==='long'?b.l<=sl:b.h>=sl)return -1;if(dir==='long'?b.h>=tp:b.l<=tp)return rr;}const last=E[Math.min(k+71,E.length-1)];return Math.max(-1,Math.min(rr,(dir==='long'?(last.c-entry):(entry-last.c))/risk));}

function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){const n=a.length,win=a.filter(s=>s.R>0).length,tot=a.reduce((x,s)=>x+s.R,0),ci=wilson(win,n);const ts=a.map(x=>x.t),mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;const tr=a.filter(x=>x.t<mid),te=a.filter(x=>x.t>=mid);return{n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,tot,eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0};}

// Preload cache
const CACHE={};
function inst(name){
  if(!CACHE[name]){const B=load(name);if(!B)return null;const Dc=rsC(B,86400),H4c=rsC(B,14400),H2c=rsC(B,7200),H1c=rsC(B,3600);CACHE[name]={B,Dc,Z:{D:zones(Dc),'4H':zones(H4c),'2H':zones(H2c),'1H':zones(H1c)},Da:emaSer(Dc),H4a:emaSer(H4c),H1a:emaSer(H1c)};}
  return CACHE[name];
}
ALL_INSTRUMENTS.forEach(inst);

function run(name, cfg){
  const d=inst(name);if(!d)return[];
  const{B,Dc,Z,Da,H4a,H1a}=d;
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,price,te)=>{let n=0;for(const tf of['D','4H','2H','1H'])if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;return n;};
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
  const kzOK=m=>cfg.kz==='ny-am'?nyam(m):cfg.kz==='london'?london(m):nyam(m)||london(m);
  const out=[],seen=new Set();
  for(let k=50;k<B.length-5;k++){
    const b=B[k];if(!kzOK(b.min)||seen.has(b.day))continue;
    const A=atr(B,k);if(A<=0)continue;
    const dailies=Dc.filter(x=>x.end<=b.t);if(dailies.length<5)continue;
    const dr=dailies.slice(-5),drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l)),rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));
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
    // Displacement filter
    if(cfg.disp&&k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      if(dir==='long'){if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
      else{if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
    }
    // Deep sweep filter
    if(cfg.deepSweep){if(dir==='long'&&rl-b.l<0.3*A)continue;if(dir==='short'&&b.h-rh<0.3*A)continue;}
    const R=mgmtTiered(B,k,dir,entry,sl,1,1.7,2.56);
    out.push({t:b.t,R,dir,inst:name});seen.add(b.day);
  }
  return out;
}

function runSet(names,cfg){let o=[];names.forEach(n=>o=o.concat(run(n,cfg)));return o;}
function pr(lbl,trades,cols=55){
  const s=st(trades);const gen=(s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(lbl.padEnd(cols),`n=${String(s.n).padStart(4)} wr=${s.wr.toFixed(1).padStart(5)}% [${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}] exp=${s.exp.toFixed(3).padStart(7)}R tot=${s.tot.toFixed(0).padStart(6)}R Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`);
}

const BASE={trend:'h4h1',stack:2,kz:'ny-am',wick:0.5};
const DISP={...BASE,disp:true};
const DS={...DISP,deepSweep:true};
const A3={...BASE,trend:'all3'};
const A3D={...DISP,trend:'all3'};

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('backtest17 — ALL 14 INSTRUMENTS, leak-free, causal, tiered 1/3@1R+1/3@1.7R+1/3@2.56R');
console.log('════════════════════════════════════════════════════════════════════════════════\n');

console.log('── AGGREGATE (14 instruments, NY-AM, h4h1, stack2, halfPD, wick0.5) ──\n');
pr('BASELINE (6 instruments Siddh trades)',     runSet(FOCUS,BASE));
pr('BASELINE (all 14 instruments)',             runSet(ALL_INSTRUMENTS,BASE));
pr('+ Displacement (6 focus insts)',            runSet(FOCUS,DISP));
pr('+ Displacement (all 14 insts)',             runSet(ALL_INSTRUMENTS,DISP));
pr('+ Displacement + DeepSweep (14)',           runSet(ALL_INSTRUMENTS,DS));
pr('all3 baseline (14)',                        runSet(ALL_INSTRUMENTS,A3));
pr('all3 + Displacement (14)',                  runSet(ALL_INSTRUMENTS,A3D));
pr('h4h1 + stack>=3 (14)',                      runSet(ALL_INSTRUMENTS,{...BASE,stack:3}));
pr('h4h1 + wick0.65 (14)',                      runSet(ALL_INSTRUMENTS,{...BASE,wick:0.65}));
pr('disp + wick0.65 (14)',                       runSet(ALL_INSTRUMENTS,{...DISP,wick:0.65}));
pr('disp + stack>=3 (14)',                       runSet(ALL_INSTRUMENTS,{...DISP,stack:3}));
pr('London baseline (14)',                       runSet(ALL_INSTRUMENTS,{...BASE,kz:'london'}));
pr('London + displacement (14)',                 runSet(ALL_INSTRUMENTS,{...DISP,kz:'london'}));
pr('NY-AM + London combined (14)',               runSet(ALL_INSTRUMENTS,{...BASE,kz:'both'}));
pr('disp + NY-AM+London (14)',                   runSet(ALL_INSTRUMENTS,{...DISP,kz:'both'}));

console.log('\n── PER-INSTRUMENT BREAKDOWN — BASELINE vs DISPLACEMENT (NY-AM) ──\n');
console.log('Instrument  BASELINE: n  wr    exp          DISPLACEMENT: n  wr    exp           gen');
console.log('─'.repeat(90));
for(const name of ALL_INSTRUMENTS){
  const b=run(name,BASE),w=run(name,DISP);
  const sb=st(b),sw=st(w);
  const gen=(sw.eTr>0&&sw.eTe>0)?'✓BOTH':(sw.eTr>0||sw.eTe>0)?'~ONE':'✗NEG';
  console.log(
    name.padEnd(12),
    `base: n=${String(sb.n).padStart(3)} wr=${sb.wr.toFixed(0).padStart(3)}% exp=${sb.exp.toFixed(3)}`.padEnd(36),
    `disp: n=${String(sw.n).padStart(3)} wr=${sw.wr.toFixed(0).padStart(3)}% exp=${sw.exp.toFixed(3)} [${sw.ci[0].toFixed(0)}-${sw.ci[1].toFixed(0)}]`.padEnd(38),
    gen
  );
}

console.log('\n── BEST-INSTRUMENT SUBSETS (displacement filter, NY-AM, tiered) ──\n');
// Which instruments are individually positive with displacement?
const posInsts = ALL_INSTRUMENTS.filter(n => { const s=st(run(n,DISP)); return s.exp>0&&s.n>=3; });
console.log(`Positive instruments (exp>0, n>=3): ${posInsts.join(', ')}`);
pr('Portfolio of positive instruments (disp)', runSet(posInsts, DISP));
pr('Portfolio of positive + wick0.65',          runSet(posInsts, {...DISP, wick:0.65}));
pr('Portfolio of positive + deepSweep',         runSet(posInsts, {...DISP, deepSweep:true}));

// Also check quarterly — does displacement hold in different market regimes?
console.log('\n── TEMPORAL STABILITY — displacement filter quarterly (all 14 insts) ──\n');
const dispTrades = runSet(ALL_INSTRUMENTS, DISP).sort((a,b)=>a.t-b.t);
const quarters = {};
dispTrades.forEach(t => {
  const d=new Date(t.t*1000), q=`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;
  if(!quarters[q]) quarters[q]=[];
  quarters[q].push(t);
});
for(const [q,ts] of Object.entries(quarters).sort()) {
  const s=st(ts);
  console.log(q.padEnd(10), `n=${String(s.n).padStart(3)} wr=${s.wr.toFixed(0).padStart(3)}% exp=${s.exp.toFixed(3)}`);
}
