// Liq Grab v3 — Multi-Timeframe zone stacking.
// Entry trigger = same as v2 (15m: HTF bias + Asian sweep + FVG displacement in kill zone, managed 3.6R).
// NEW: at each entry, score how the entry price stacks against OB/FVG/IFVG zones across a TF ladder.
//   TF ladder & weights (HTF weighted heavier): 15m=1, 1H=2, 2H=3, 4H=4, 1D=5
//   Each TF contributes weight x (#distinct zone-types {FVG,OB,IFVG} present at entry, matching trade direction).
//   Total MTF score = sum across TFs.  Also track breadth (#TFs hit) and highest TF hit.
// Then bucket trades by MTF score to test: more stacking + higher TF => higher win rate.

const IST = 5.5 * 3600, RR = 3.6;
const LADDER = [["15m",900,1],["1H",3600,2],["2H",7200,3],["4H",14400,4],["1D",86400,5]];

function load(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const b=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((r.timestamp[i]+IST)*1000);b.push({t:r.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}

function resample(B,secs){ // group 15m bars into higher-TF candles
  const m=new Map();
  for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}
  return [...m.values()].sort((a,b)=>a.t-b.t);
}
function zones(TS){ // detect FVG/IFVG/OB zones on a TF series
  const z=[];const n=TS.length;
  for(let i=2;i<n;i++){
    // bullish FVG -> support; if later close < lo => IFVG resistance
    if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});
      for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}}
    // bearish FVG -> resistance; if later close > hi => IFVG support
    if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});
      for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}}
  }
  for(let i=0;i<n-1;i++){
    if(TS[i].c<TS[i].o && TS[i+1].c>TS[i].h) z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); // bullish OB
    if(TS[i].c>TS[i].o && TS[i+1].c<TS[i].l) z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); // bearish OB
  }
  return z;
}
function resolveManaged(B,k,dir,entry,sl,tp){
  const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;const hz=[];for(let i=k+1;i<B.length&&hz.length<2*96;i++)hz.push(B[i]);let banked=false;
  for(const b of hz){if(!banked){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){banked=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}
  return banked?0.5:-1;
}

function run(name){
  const B=load(name);
  const TFz={}; for(const[tf,secs] of LADDER) TFz[tf]= tf==="15m"?zones(B):zones(resample(B,secs));
  const days=[...new Set(B.map(b=>b.day))].sort();
  const dc={};B.forEach(b=>dc[b.day]=b.c);const cl=days.map(d=>dc[d]);const e=ema(cl,10);
  const bias={};days.forEach((d,i)=>bias[d]=cl[i]>=e[i]?"bull":"bear");
  const idxByDay={};B.forEach((b,i)=>(idxByDay[b.day]=idxByDay[b.day]||[]).push(i));
  const sigs=[];const seen=new Set();
  for(let di=1;di<days.length;di++){
    const day=days[di],bi=bias[days[di-1]];const idxs=idxByDay[day];if(!idxs)continue;
    const asianIdx=idxs.filter(i=>B[i].min<735);if(asianIdx.length<4)continue;
    const aHigh=Math.max(...asianIdx.map(i=>B[i].h)),aLow=Math.min(...asianIdx.map(i=>B[i].l));
    const kz=idxs.filter(i=>(B[i].min>=735&&B[i].min<915)||(B[i].min>=1020&&B[i].min<1260));
    for(const k of kz){
      if(k<3||seen.has(day))continue;const win=[k-3,k-2,k-1,k].map(i=>B[i]);const A=atr(B,k);if(A<=0)continue;
      let sig=null;
      if(bi==="bear"){const sH=Math.max(...win.map(b=>b.h));if(win.some(b=>b.h>aHigh)&&B[k-2].l-B[k].h>0){const entry=B[k].c,sl=sH,risk=sl-entry;if(risk>0&&risk>=0.2*A)sig={dir:"short",entry,sl,tp:entry-RR*risk};}}
      if(bi==="bull"){const sL=Math.min(...win.map(b=>b.l));if(win.some(b=>b.l<aLow)&&B[k].l-B[k-2].h>0){const entry=B[k].c,sl=sL,risk=entry-sl;if(risk>0&&risk>=0.2*A)sig={dir:"long",entry,sl,tp:entry+RR*risk};}}
      if(!sig)continue;
      const te=B[k].t,pe=sig.entry,poi=sig.dir==="short"?"res":"sup";
      let score=0,breadth=0,topTF=0,tfHits=[];
      for(const[tf,secs,w] of LADDER){
        const zs=TFz[tf].filter(z=>z.t<te && z.t>=te-7*86400 && z.dir===poi);
        const tol=z=>0.2*(z.hi-z.lo);
        const present=new Set();
        for(const z of zs){if(pe>=z.lo-tol(z)&&pe<=z.hi+tol(z))present.add(z.type);}
        if(present.size>0){score+=w*present.size;breadth++;topTF=Math.max(topTF,w);tfHits.push(tf+":"+[...present].join("+"));}
      }
      sig.R=resolveManaged(B,k,sig.dir,sig.entry,sig.sl,sig.tp);
      sigs.push({name,day,score,breadth,topTF,tfHits,R:sig.R});seen.add(day);
    }
  }
  return sigs;
}

const INSTR=["NQ","ES","GC","CL","EURUSD","GBPUSD"];
let ALL=[];for(const n of INSTR)ALL=ALL.concat(run(n));

function stat(a){const w=a.filter(s=>s.R>0.01).length,l=a.filter(s=>s.R<=-0.999).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}
function row(lbl,a){const s=stat(a);console.log(lbl.padEnd(22),String(s.n).padStart(5),(s.wr.toFixed(0)+"%").padStart(7),(s.w+"W/"+s.l+"L").padStart(9),(s.t.toFixed(1)+"R").padStart(8),(s.e.toFixed(3)+"R").padStart(10));}

console.log("Total signals:",ALL.length,"\n");
console.log("=== By MTF STACK SCORE (weighted, HTF heavier) ===");
console.log("BUCKET".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
row("0  (no HTF zone)",ALL.filter(s=>s.score===0));
row("1-4  (weak stack)",ALL.filter(s=>s.score>=1&&s.score<=4));
row("5-9  (solid stack)",ALL.filter(s=>s.score>=5&&s.score<=9));
row("10+  (heavy stack)",ALL.filter(s=>s.score>=10));
console.log("\n=== By BREADTH (# of timeframes with a matching zone) ===");
console.log("BREADTH".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
for(let b=0;b<=5;b++){const a=ALL.filter(s=>s.breadth===b);if(a.length)row(b+" timeframe(s)",a);}
console.log("\n=== By HIGHEST TF that had a zone ===");
console.log("TOP TF".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
const tfName={0:"none",1:"15m",2:"1H",3:"2H",4:"4H",5:"1D"};
for(const w of [0,1,2,3,4,5]){const a=ALL.filter(s=>s.topTF===w);if(a.length)row(tfName[w],a);}

// ===== v4 ADD-ON: timings + wick rejection + composite highest-probability filter =====
// Recompute signals carrying wick & timing, reusing run()'s zone logic by re-deriving per signal.
console.log("\n\n########  ENTRIES / TIMINGS / WICKS  ########");
function kzName(min){if(min>=735&&min<915)return"London KZ";if(min>=1020&&min<1140)return"NY AM-early";if(min>=1140&&min<1260)return"NY AM-late";return"Other";}
// rebuild with extra fields
function run2(name){
  const B=load(name);const TFz={};for(const[tf,secs] of LADDER)TFz[tf]=tf==="15m"?zones(B):zones(resample(B,secs));
  const days=[...new Set(B.map(b=>b.day))].sort();const dc={};B.forEach(b=>dc[b.day]=b.c);const cl=days.map(d=>dc[d]);const e=ema(cl,10);
  const bias={};days.forEach((d,i)=>bias[d]=cl[i]>=e[i]?"bull":"bear");const idxByDay={};B.forEach((b,i)=>(idxByDay[b.day]=idxByDay[b.day]||[]).push(i));
  const out=[];const seen=new Set();
  for(let di=1;di<days.length;di++){const day=days[di],bi=bias[days[di-1]];const idxs=idxByDay[day];if(!idxs)continue;
    const asianIdx=idxs.filter(i=>B[i].min<735);if(asianIdx.length<4)continue;
    const aHigh=Math.max(...asianIdx.map(i=>B[i].h)),aLow=Math.min(...asianIdx.map(i=>B[i].l));
    const kz=idxs.filter(i=>(B[i].min>=735&&B[i].min<915)||(B[i].min>=1020&&B[i].min<1260));
    for(const k of kz){if(k<3||seen.has(day))continue;const win=[k-3,k-2,k-1,k].map(i=>B[i]);const A=atr(B,k);if(A<=0)continue;let sig=null,wickStrong=false;
      if(bi==="bear"){const sH=Math.max(...win.map(b=>b.h));if(win.some(b=>b.h>aHigh)&&B[k-2].l-B[k].h>0){const entry=B[k].c,sl=sH,risk=sl-entry;if(risk>0&&risk>=0.2*A){sig={dir:"short",entry,sl,tp:entry-RR*risk};const sb=win.reduce((p,b)=>b.h>p.h?b:p);wickStrong=(sb.h-Math.max(sb.o,sb.c))/((sb.h-sb.l)||1)>=0.5;}}}
      if(bi==="bull"){const sL=Math.min(...win.map(b=>b.l));if(win.some(b=>b.l<aLow)&&B[k].l-B[k-2].h>0){const entry=B[k].c,sl=sL,risk=entry-sl;if(risk>0&&risk>=0.2*A){sig={dir:"long",entry,sl,tp:entry+RR*risk};const sb=win.reduce((p,b)=>b.l<p.l?b:p);wickStrong=(Math.min(sb.o,sb.c)-sb.l)/((sb.h-sb.l)||1)>=0.5;}}}
      if(!sig)continue;const te=B[k].t,pe=sig.entry,poi=sig.dir==="short"?"res":"sup";let breadth=0,topTF=0;
      for(const[tf,secs,w] of LADDER){const zs=TFz[tf].filter(z=>z.t<te&&z.t>=te-7*86400&&z.dir===poi);const tol=z=>0.2*(z.hi-z.lo);let hit=false;for(const z of zs)if(pe>=z.lo-tol(z)&&pe<=z.hi+tol(z)){hit=true;break;}if(hit){breadth++;topTF=Math.max(topTF,w);}}
      sig.R=resolveManaged(B,k,sig.dir,sig.entry,sig.sl,sig.tp);
      out.push({name,day,min:B[k].min,kz:kzName(B[k].min),wickStrong,breadth,topTF,R:sig.R});seen.add(day);}}
  return out;
}
let A2=[];for(const n of INSTR)A2=A2.concat(run2(n));
console.log("\n--- By KILL ZONE timing ---");
console.log("KZ".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
for(const z of ["London KZ","NY AM-early","NY AM-late"]) {const a=A2.filter(s=>s.kz===z);if(a.length)row(z,a);}
console.log("\n--- By WICK REJECTION on sweep candle ---");
console.log("WICK".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
row("strong rejection wick",A2.filter(s=>s.wickStrong));
row("weak / no wick",A2.filter(s=>!s.wickStrong));
console.log("\n--- COMPOSITE: HTF>=4H  +  breadth>=3  +  strong wick ---");
console.log("FILTER".padEnd(22),"Trades".padStart(5),"Win%".padStart(7),"W/L".padStart(9),"TotalR".padStart(8),"Exp/tr".padStart(10));
row("ALL signals",A2);
row("HTF>=4H & breadth>=3",A2.filter(s=>s.topTF>=4&&s.breadth>=3));
row("+ strong wick",A2.filter(s=>s.topTF>=4&&s.breadth>=3&&s.wickStrong));
row("+ strong wick + NY-early",A2.filter(s=>s.topTF>=4&&s.breadth>=3&&s.wickStrong&&s.kz==="NY AM-early"));
