// Liq Grab v8 — refined TWO-BRANCH + long-horizon trial.
//  CONTINUATION: D1=H4=H1 trend aligned + FULL stack + pullback sweep + premium/discount(half).
//  REVERSAL (per his charts): sweep the ASIAN session high/low + strong rejection WICK closing back +
//            DEEP premium/discount (outer third of dealing range) + >=4-TF stack. SL beyond the wick.
//  Managed 3.6R. Modes: test60 (cached 15m -> 30m entry) | full2y (fetch 1h, 2y -> 1h entry).

const IST=5.5*3600, RR=3.6;
const SYM={NQ:"NQ=F",ES:"ES=F",GC:"GC=F",CL:"CL=F",EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X"};
const INSTR=Object.keys(SYM);
function mk(ts){const b=[];for(const x of ts){const d=new Date((x.t+IST)*1000);b.push({t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c});}return b;}
function loadCached(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const ts=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;ts.push({t:r.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return mk(ts);}
async function fetchBars(sym,interval,range){const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const ts=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;ts.push({t:res.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return mk(ts);}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function resampleTF(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,day:b.day,min:b.min,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({dir:"res",lo,hi,t:TS[j].t});break;}}}if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({dir:"sup",lo,hi,t:TS[j].t});break;}}}}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,tr:b.c>=e[i]?"bull":"bear"}));}
function trendAt(s,te){let r="bull";for(const x of s){if(x.t<=te)r=x.tr;else break;}return r;}
function resolve(E,k,dir,entry,sl,tp,maxBars){const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;const hz=[];for(let i=k+1;i<E.length&&hz.length<maxBars;i++)hz.push(E[i]);let bk=false;for(const b of hz){if(!bk){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){bk=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}return bk?0.5:-1;}

function engine(base, entrySecs){
  const E = entrySecs===null ? base : resampleTF(base, entrySecs);
  const ladder=[["D",86400],["4H",14400],["2H",7200],["1H",3600],["E",entrySecs||3600]].filter((x,i,a)=>a.findIndex(y=>y[1]===x[1])===i);
  const Z={}; for(const[tf,secs] of ladder) Z[tf]=zones(secs===(entrySecs||3600)?E:resampleTF(base,secs));
  const Dser=trendSer(resampleTF(base,86400)),H4ser=trendSer(resampleTF(base,14400)),H1ser=trendSer(resampleTF(base,3600));
  const D=resampleTF(base,86400);
  const tol=z=>0.25*(z.hi-z.lo); const maxBars=Math.round(2*86400/(entrySecs||3600));
  // per-day asian extremes (IST 00:00-09:00)
  const aH={},aL={}; for(const b of E){if(b.min<540){aH[b.day]=Math.max(aH[b.day]??-1e18,b.h);aL[b.day]=Math.min(aL[b.day]??1e18,b.l);}}
  const out=[];const seen=new Set();
  for(let k=6;k<E.length;k++){
    const b=E[k];const inKZ=(b.min>=735&&b.min<915)||(b.min>=1020&&b.min<1260);if(!inKZ||seen.has(b.day))continue;
    const A=atr(E,k);if(A<=0)continue;
    const dr=D.slice(-5);if(dr.length<2)continue;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),rng=drHi-drLo||1,eq=(drHi+drLo)/2;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>E[k-o].l)), rh=Math.max(...[1,2,3,4,5,6].map(o=>E[k-o].h));
    const range=(b.h-b.l)||1, wickUp=(b.h-Math.max(b.o,b.c))/range, wickDn=(Math.min(b.o,b.c)-b.l)/range;
    const te=b.t; const d1=trendAt(Dser,te),h4=trendAt(H4ser,te),h1=trendAt(H1ser,te);
    const presentFor=poi=>{const set=new Set();for(const[tf] of ladder)if(Z[tf].some(z=>z.dir===poi&&z.t<te&&b.c>=z.lo-tol(z)&&b.c<=z.hi+tol(z)))set.add(tf);return set;};
    let dir=null,entry,sl,type=null;
    // CONTINUATION: trend aligned + full stack + pullback sweep + prem/disc half
    for(const D2 of ["bull","bear"]){
      if(!(d1===D2&&h4===D2&&h1===D2))continue;
      const poi=D2==="bull"?"sup":"res"; const st=presentFor(poi); if(st.size!==ladder.length)continue;
      if(D2==="bull"&&b.l<rl&&b.c>rl&&b.c<eq){dir="long";entry=b.c;sl=b.l;type="CONT";}
      if(D2==="bear"&&b.h>rh&&b.c<rh&&b.c>eq){dir="short";entry=b.c;sl=b.h;type="CONT";}
    }
    // REVERSAL: sweep ASIAN extreme + strong wick + deep prem/disc + >=ladder-1 stack
    if(!type){
      const aHi=aH[b.day],aLo=aL[b.day];
      const stShort=presentFor("res"),stLong=presentFor("sup");
      if(aHi!=null&&b.h>aHi&&b.c<aHi&&wickUp>=0.55&&b.c>=drLo+0.66*rng&&stShort.size>=ladder.length-1){dir="short";entry=b.c;sl=b.h;type="REV";}
      else if(aLo!=null&&b.l<aLo&&b.c>aLo&&wickDn>=0.55&&b.c<=drLo+0.34*rng&&stLong.size>=ladder.length-1){dir="long";entry=b.c;sl=b.l;type="REV";}
    }
    if(!type)continue;const risk=Math.abs(entry-sl);if(risk<=0||risk<0.2*A)continue;
    const R=resolve(E,k,dir,entry,sl,dir==="long"?entry+RR*risk:entry-RR*risk,maxBars);
    out.push({type,dir,R});seen.add(b.day);
  }
  return out;
}
function S(a){const w=a.filter(s=>s.R>0.01).length,l=a.filter(s=>s.R<=-0.999).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}
function row(lbl,a){const s=S(a);console.log(lbl.padEnd(24),String(s.n).padStart(4),(s.wr.toFixed(0)+"%").padStart(6),(s.w+"W/"+s.l+"L").padStart(9),(s.t.toFixed(1)+"R").padStart(8),(s.e.toFixed(3)+"R").padStart(9));}
function report(title,all){console.log(`\n===== ${title} =====`);console.log("BRANCH".padEnd(24),"Trades".padStart(4),"Win%".padStart(6),"W/L".padStart(9),"TotR".padStart(8),"Exp/tr".padStart(9));row("CONTINUATION",all.filter(s=>s.type==="CONT"));row("REVERSAL",all.filter(s=>s.type==="REV"));console.log("-".repeat(64));row("COMBINED",all);}

(async()=>{
  // 1) TEST RUN — cached 15m, 30m entry, ~60 days
  let test=[];for(const n of INSTR)test=test.concat(engine(loadCached(n),1800));
  report("TEST RUN  (60 days, 30m entry)",test);

  // 2) FULL TRIAL — fetch ~2y of 1h, 1h entry
  console.log("\nFetching ~2y of 1h data for full trial...");
  let full=[],ok=0;
  for(const n of INSTR){let b=null;try{b=await fetchBars(SYM[n],"1h","2y");}catch(e){}
    if(b&&b.length>2000){ok++;full=full.concat(engine(b,null));}else console.log("  ! "+n+" fetch failed/short");}
  console.log(`fetched ${ok}/${INSTR.length} instruments`);
  report("FULL TRIAL  (~2 years, 1h entry)",full);
})();
