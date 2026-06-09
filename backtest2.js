// Liq Grab backtest v2 — entry driven by FVG displacement after a sweep,
// with stacked confluence filters (FVG / OB / IFVG / Fib OTE) proxied mechanically.
// No look-ahead: every confluence uses only bars up to & including the entry bar.
// Management: bank 50% at +1R, trail runner to BE (Siddh's actual style). Target 3.6R (his planned avg).

const IST = 5.5 * 3600, RR = 3.6;
function load(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const b=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((r.timestamp[i]+IST)*1000);b.push({t:r.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}

function resolveManaged(B,k,dir,entry,sl,tp){
  const risk=Math.abs(entry-sl), oneR=dir==="short"?entry-risk:entry+risk;
  const hz=[];for(let i=k+1;i<B.length&&hz.length<2*96;i++)hz.push(B[i]);
  let banked=false;
  for(const b of hz){
    if(!banked){
      if(dir==="short"?b.h>=sl:b.l<=sl)return -1;
      if(dir==="short"?b.l<=oneR:b.h>=oneR){banked=true;continue;}
    }else{
      if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;       // runner stopped at BE
      if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;       // runner hits TP
    }
  }
  return banked?0.5:-1;
}

function signals(name){
  const B=load(name);
  const days=[...new Set(B.map(b=>b.day))].sort();
  const dc={};B.forEach(b=>dc[b.day]=b.c);const cl=days.map(d=>dc[d]);const e=ema(cl,10);
  const bias={};days.forEach((d,i)=>bias[d]=cl[i]>=e[i]?"bull":"bear");
  const idxByDay={};B.forEach((b,i)=>(idxByDay[b.day]=idxByDay[b.day]||[]).push(i));
  const out=[];
  for(let di=1;di<days.length;di++){
    const day=days[di], bi=bias[days[di-1]];
    const idxs=idxByDay[day];if(!idxs)continue;
    const asianIdx=idxs.filter(i=>B[i].min<735);
    if(asianIdx.length<4)continue;
    const aHigh=Math.max(...asianIdx.map(i=>B[i].h)), aLow=Math.min(...asianIdx.map(i=>B[i].l));
    const kz=idxs.filter(i=>(B[i].min>=735&&B[i].min<915)||(B[i].min>=1020&&B[i].min<1260));
    for(const k of kz){
      if(k<3)continue;
      const win=[k-3,k-2,k-1,k].map(i=>B[i]);
      const A=atr(B,k);if(A<=0)continue;
      // SHORT: bias bear, Asian-high swept in window, bearish FVG completes at k
      if(bi==="bear"){
        const sweptHigh=Math.max(...win.map(b=>b.h));
        const swept=win.some(b=>b.h>aHigh);
        const fvg=B[k-2].l - B[k].h; // bearish imbalance gap
        if(swept&&fvg>0){
          const entry=B[k].c, sl=sweptHigh, risk=sl-entry;
          if(risk>0&&risk>=0.2*A){
            const recentLow=Math.min(...idxs.filter(i=>i>=k-16&&i<=k).map(i=>B[i].l));
            const retr=(entry-recentLow)/(sweptHigh-recentLow);
            const C_FIB= retr>=0.5 && retr<=0.92;
            let C_OB=false;for(let i=k-4;i<k;i++){if(i>=0&&B[i].c>B[i].o&&B[i].h>=aHigh*0.9995&&B[k].c<B[i].o){C_OB=true;break;}}
            let C_IFVG=false;for(let m=k-14;m<=k-3;m++){if(m-2>=0&&B[m].l>B[m-2].h){const Lb=B[m-2].h;if(B[k].c<Lb){C_IFVG=true;break;}}}
            const R=resolveManaged(B,k,"short",entry,sl,entry-RR*risk);
            out.push({day,dir:"short",C_FIB,C_OB,C_IFVG,R});
          }
        }
      }
      // LONG: bias bull, Asian-low swept, bullish FVG completes at k
      if(bi==="bull"){
        const sweptLow=Math.min(...win.map(b=>b.l));
        const swept=win.some(b=>b.l<aLow);
        const fvg=B[k].l - B[k-2].h; // bullish imbalance gap
        if(swept&&fvg>0){
          const entry=B[k].c, sl=sweptLow, risk=entry-sl;
          if(risk>0&&risk>=0.2*A){
            const recentHigh=Math.max(...idxs.filter(i=>i>=k-16&&i<=k).map(i=>B[i].h));
            const retr=(recentHigh-entry)/(recentHigh-sweptLow);
            const C_FIB= retr>=0.5 && retr<=0.92;
            let C_OB=false;for(let i=k-4;i<k;i++){if(i>=0&&B[i].c<B[i].o&&B[i].l<=aLow*1.0005&&B[k].c>B[i].o){C_OB=true;break;}}
            let C_IFVG=false;for(let m=k-14;m<=k-3;m++){if(m-2>=0&&B[m].h<B[m-2].l){const Ub=B[m-2].l;if(B[k].c>Ub){C_IFVG=true;break;}}}
            const R=resolveManaged(B,k,"long",entry,sl,entry+RR*risk);
            out.push({day,dir:"long",C_FIB,C_OB,C_IFVG,R});
          }
        }
      }
    }
  }
  return out;
}

const INSTR=["NQ","ES","GC","CL","EURUSD","GBPUSD"];
const ALL={};INSTR.forEach(n=>ALL[n]=signals(n));

// tiers: pick first signal per day meeting predicate
const TIERS=[
  {name:"FVG (base displacement)",    pred:s=>true},
  {name:"FVG + Fib OTE",              pred:s=>s.C_FIB},
  {name:"FVG + Fib + OB",             pred:s=>s.C_FIB&&s.C_OB},
  {name:"FVG + Fib + OB + IFVG (full)",pred:s=>s.C_FIB&&s.C_OB&&s.C_IFVG},
];
function firstPerDay(sigs,pred){const seen=new Set(),o=[];for(const s of sigs){if(!pred(s))continue;if(seen.has(s.day))continue;seen.add(s.day);o.push(s);}return o;}
function stat(sigs){const w=sigs.filter(s=>s.R>0.01).length,l=sigs.filter(s=>s.R<=-0.999).length,tot=sigs.reduce((a,s)=>a+s.R,0);return{n:sigs.length,w,l,wr:(w+l)?w/(w+l)*100:0,tot,exp:sigs.length?tot/sigs.length:0};}

for(const T of TIERS){
  console.log(`\n===== ${T.name} =====`);
  console.log("INSTR    Trades   Win%   W/L      TotalR   Exp/trade");
  let all=[];
  for(const n of INSTR){const sigs=firstPerDay(ALL[n],T.pred);all=all.concat(sigs);const s=stat(sigs);
    console.log(n.padEnd(8),String(s.n).padStart(5),(s.wr.toFixed(0)+"%").padStart(7),(s.w+"W/"+s.l+"L").padStart(8),(s.tot.toFixed(1)+"R").padStart(8),(s.exp.toFixed(3)+"R").padStart(10));}
  const S=stat(all);
  console.log("-".repeat(56));
  console.log("PORTFOLIO".padEnd(8),String(S.n).padStart(5),(S.wr.toFixed(0)+"%").padStart(7),(S.w+"W/"+S.l+"L").padStart(8),(S.tot.toFixed(1)+"R").padStart(8),(S.exp.toFixed(3)+"R").padStart(10));
}
