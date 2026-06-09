// Liq Grab v5 — TOP-DOWN (Daily -> 4H -> down -> entry on 30m vs 15m).
// Sequence (the proper ICT way):
//   1. DAILY: bias (EMA10) + find a daily POI zone (OB/FVG/IFVG) in the discount/premium direction.
//   2. Gate: price must be trading INSIDE that daily zone (the anchor). No daily zone -> no trade.
//   3. 4H / 1H: bonus confirmation if a same-direction zone also stacks at the entry price.
//   4. ENTRY: drill to the execution TF (30m OR 15m) -> LTF sweep of recent swing + FVG displacement, in bias dir.
//   SL beyond the swept extreme, TP fixed 3.6R, managed (bank 50% @ +1R, runner to BE).
// Compares 30m vs 15m execution to see which is better.

const IST = 5.5 * 3600, RR = 3.6;
function load(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const b=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((r.timestamp[i]+IST)*1000);b.push({t:r.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function resampleTF(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,day:b.day,min:b.min,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;
  for(let i=2;i<n;i++){
    if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}}
    if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}}
  }
  for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}
  return z;}
function resolveManaged(E,k,dir,entry,sl,tp,maxBars){const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;const hz=[];for(let i=k+1;i<E.length&&hz.length<maxBars;i++)hz.push(E[i]);let banked=false;for(const b of hz){if(!banked){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){banked=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}return banked?0.5:-1;}

function runTD(name, entrySecs){
  const B=load(name);
  const Dz=zones(resampleTF(B,86400)), H4z=zones(resampleTF(B,14400)), H1z=zones(resampleTF(B,3600));
  const E = entrySecs===900 ? B : resampleTF(B,entrySecs);
  const maxBars = Math.round(2*86400/entrySecs); // ~2 days of resolution
  const days=[...new Set(B.map(b=>b.day))].sort();const dc={};B.forEach(b=>dc[b.day]=b.c);const cl=days.map(d=>dc[d]);const e=ema(cl,10);
  const bias={};days.forEach((d,i)=>bias[d]=cl[i]>=e[i]?"bull":"bear");const prev={};days.forEach((d,i)=>prev[d]=days[i-1]);
  const tol=z=>0.3*(z.hi-z.lo);
  const out=[];const seen=new Set();
  for(let k=6;k<E.length;k++){
    const b=E[k];const inKZ=(b.min>=735&&b.min<915)||(b.min>=1020&&b.min<1260);if(!inKZ)continue;
    const pd=prev[b.day];if(!pd)continue;const bi=bias[pd];if(!bi||seen.has(b.day))continue;
    const A=atr(E,k);if(A<=0)continue;const te=b.t,poi=bi==="bull"?"sup":"res";
    // DAILY ANCHOR GATE: price inside a daily zone of the right direction
    const dHit=Dz.filter(z=>z.dir===poi&&z.t<te&&z.t>=te-30*86400&&b.l<=z.hi+tol(z)&&b.h>=z.lo-tol(z));
    if(!dHit.length)continue;
    // LTF trigger on execution TF: sweep of recent swing + rejection close back inside (HTF zone is the POI)
    let sig=null,wick=false;
    if(bi==="bull"){const rl=Math.min(E[k-1].l,E[k-2].l,E[k-3].l,E[k-4].l,E[k-5].l,E[k-6].l);if(b.l<rl&&b.c>rl){const entry=b.c,sl=b.l,risk=entry-sl;if(risk>0&&risk>=0.2*A){sig={dir:"long",entry,sl,tp:entry+RR*risk};wick=(Math.min(b.o,b.c)-b.l)/((b.h-b.l)||1)>=0.5;}}}
    if(bi==="bear"){const rh=Math.max(E[k-1].h,E[k-2].h,E[k-3].h,E[k-4].h,E[k-5].h,E[k-6].h);if(b.h>rh&&b.c<rh){const entry=b.c,sl=b.h,risk=sl-entry;if(risk>0&&risk>=0.2*A){sig={dir:"short",entry,sl,tp:entry-RR*risk};wick=(b.h-Math.max(b.o,b.c))/((b.h-b.l)||1)>=0.5;}}}
    if(!sig)continue;const pe=sig.entry;
    const stack4=H4z.some(z=>z.dir===poi&&z.t<te&&z.t>=te-15*86400&&pe>=z.lo-tol(z)&&pe<=z.hi+tol(z));
    const stack1=H1z.some(z=>z.dir===poi&&z.t<te&&z.t>=te-7*86400&&pe>=z.lo-tol(z)&&pe<=z.hi+tol(z));
    sig.R=resolveManaged(E,k,sig.dir,sig.entry,sig.sl,sig.tp,maxBars);
    out.push({name,day:b.day,wick,stack4,stack1,R:sig.R});seen.add(b.day);
  }
  return out;
}

const INSTR=["NQ","ES","GC","CL","EURUSD","GBPUSD"];
function stat(a){const w=a.filter(s=>s.R>0.01).length,l=a.filter(s=>s.R<=-0.999).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}
function row(lbl,a){const s=stat(a);console.log(lbl.padEnd(26),String(s.n).padStart(5),(s.wr.toFixed(0)+"%").padStart(7),(s.w+"W/"+s.l+"L").padStart(9),(s.t.toFixed(1)+"R").padStart(8),(s.e.toFixed(3)+"R").padStart(10));}

for(const [tfLabel,secs] of [["15m",900],["30m",1800]]){
  let ALL=[];for(const n of INSTR)ALL=ALL.concat(runTD(n,secs));
  console.log(`\n================  TOP-DOWN, entry = ${tfLabel}  ================`);
  console.log("SEGMENT".padEnd(26),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
  row("ALL (Daily-anchored)",ALL);
  row("  + 4H stack",ALL.filter(s=>s.stack4));
  row("  + 4H + 1H stack",ALL.filter(s=>s.stack4&&s.stack1));
  row("  + 4H stack + wick",ALL.filter(s=>s.stack4&&s.wick));
  console.log("  -- per instrument --");
  for(const n of INSTR){const a=ALL.filter(s=>s.name===n);if(a.length)row("   "+n,a);}
}
