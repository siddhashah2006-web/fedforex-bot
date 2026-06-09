// Liq Grab v6 — FAITHFUL to Siddh's confirmed rules.
//  Top-down, EXECUTE ON 30m. Trigger = sweep of recent swing + REJECTION WICK, in a kill zone.
//  Premium/discount correct. Stack across the FULL ladder: Daily + 4H + 2H + 1H + 30m.
//  Siddh's A+ = all 5 timeframes stacking. Managed 3.6R (bank 50% @ +1R, runner to BE).
//  [Proxy flags] bias = multi-day structure (EMA10 of daily) — his real bias read is discretionary.

const IST=5.5*3600, RR=3.6;
const STACK=[["D",86400],["4H",14400],["2H",7200],["1H",3600],["30m",1800]];
function load(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const b=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((r.timestamp[i]+IST)*1000);b.push({t:r.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function resampleTF(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,day:b.day,min:b.min,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;
  for(let i=2;i<n;i++){
    if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({dir:"res",lo,hi,t:TS[j].t});break;}}}
    if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({dir:"sup",lo,hi,t:TS[j].t});break;}}}
  }
  for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}
  return z;}
function resolveManaged(E,k,dir,entry,sl,tp,maxBars){const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;const hz=[];for(let i=k+1;i<E.length&&hz.length<maxBars;i++)hz.push(E[i]);let banked=false;for(const b of hz){if(!banked){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){banked=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}return banked?0.5:-1;}

function run(name){
  const B=load(name);
  const Z={}; for(const[tf,secs] of STACK) Z[tf]= secs===1800?zones(resampleTF(B,1800)):zones(resampleTF(B,secs));
  const M30=resampleTF(B,1800);
  const days=[...new Set(B.map(b=>b.day))].sort();const dc={};B.forEach(b=>dc[b.day]=b.c);const cl=days.map(d=>dc[d]);const e=ema(cl,10);
  const bias={};days.forEach((d,i)=>bias[d]=cl[i]>=e[i]?"bull":"bear");const prev={};days.forEach((d,i)=>prev[d]=days[i-1]);
  const D=resampleTF(B,86400);const tol=z=>0.25*(z.hi-z.lo);
  const out=[];const seen=new Set();
  for(let k=6;k<M30.length;k++){
    const b=M30[k];const inKZ=(b.min>=735&&b.min<915)||(b.min>=1020&&b.min<1260);if(!inKZ)continue;
    const pd=prev[b.day];if(!pd)continue;const bi=bias[pd];if(!bi||seen.has(b.day))continue;
    const A=atr(M30,k);if(A<=0)continue;const poi=bi==="bull"?"sup":"res";
    // dealing range premium/discount (last 5 daily)
    const dr=D.slice(-5);if(dr.length<2)continue;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    // TRIGGER: sweep recent 6-bar swing + rejection wick + close back
    let sig=null;
    if(bi==="bull"){const rl=Math.min(M30[k-1].l,M30[k-2].l,M30[k-3].l,M30[k-4].l,M30[k-5].l,M30[k-6].l);
      const wick=(Math.min(b.o,b.c)-b.l)/((b.h-b.l)||1);
      if(b.l<rl&&b.c>rl&&wick>=0.5&&b.c<eq){const entry=b.c,sl=b.l,risk=entry-sl;if(risk>0&&risk>=0.2*A)sig={dir:"long",entry,sl,tp:entry+RR*risk};}}
    if(bi==="bear"){const rh=Math.max(M30[k-1].h,M30[k-2].h,M30[k-3].h,M30[k-4].h,M30[k-5].h,M30[k-6].h);
      const wick=(b.h-Math.max(b.o,b.c))/((b.h-b.l)||1);
      if(b.h>rh&&b.c<rh&&wick>=0.5&&b.c>eq){const entry=b.c,sl=b.h,risk=sl-entry;if(risk>0&&risk>=0.2*A)sig={dir:"short",entry,sl,tp:entry-RR*risk};}}
    if(!sig)continue;
    // STACK across full ladder at entry price
    const te=b.t,pe=sig.entry;let stack=0,tfs=[];
    for(const[tf,secs] of STACK){const hit=Z[tf].some(z=>z.dir===poi&&z.t<te&&pe>=z.lo-tol(z)&&pe<=z.hi+tol(z));if(hit){stack++;tfs.push(tf);}}
    sig.R=resolveManaged(M30,k,sig.dir,sig.entry,sig.sl,sig.tp,96);
    out.push({name,day:b.day,stack,tfs:tfs.join("+"),R:sig.R});seen.add(b.day);
  }
  return out;
}
const INSTR=["NQ","ES","GC","CL","EURUSD","GBPUSD"];
let ALL=[];for(const n of INSTR)ALL=ALL.concat(run(n));
function stat(a){const w=a.filter(s=>s.R>0.01).length,l=a.filter(s=>s.R<=-0.999).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}
function row(lbl,a){const s=stat(a);console.log(lbl.padEnd(28),String(s.n).padStart(5),(s.wr.toFixed(0)+"%").padStart(7),(s.w+"W/"+s.l+"L").padStart(9),(s.t.toFixed(1)+"R").padStart(8),(s.e.toFixed(3)+"R").padStart(10));}
console.log("FAITHFUL ENGINE — Siddh's confirmed rules (30m, sweep+wick, prem/disc, top-down)\n");
console.log("Total triggers (sweep+wick+P/D, bias-aligned, in KZ):",ALL.length,"\n");
console.log("SEGMENT".padEnd(28),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
for(let s=1;s<=5;s++) row(s+"-TF stack",ALL.filter(x=>x.stack===s));
console.log("-".repeat(60));
row(">=3-TF stack",ALL.filter(x=>x.stack>=3));
row(">=4-TF stack",ALL.filter(x=>x.stack>=4));
row("FULL 5-TF stack (his A+)",ALL.filter(x=>x.stack===5));
