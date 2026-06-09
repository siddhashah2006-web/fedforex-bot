// Liq Grab v9 — REVERSAL STYLE BAKE-OFF over ~2 years (1h).
// Encodes several distinct interpretations of Siddh's reversal and ranks them by edge.
// Common: kill zone, 1 trade/day, SL beyond swept wick, managed 3.6R, risk>=0.2*ATR.
const IST=5.5*3600, RR=3.6;
const SYM={NQ:"NQ=F",ES:"ES=F",GC:"GC=F",CL:"CL=F",EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X"};
const fs=require("fs");
function mk(ts){return ts.map(x=>{const d=new Date((x.t+IST)*1000);return{t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c};});}
async function getBars(name){const p="C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/"+name+".json";if(fs.existsSync(p)){return mk(JSON.parse(fs.readFileSync(p)));}
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${SYM[name]}?interval=1h&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const ts=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;ts.push({t:res.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}fs.mkdirSync("C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h",{recursive:true});fs.writeFileSync(p,JSON.stringify(ts));return mk(ts);}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rs(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,day:b.day,min:b.min,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h){z.push({dir:"sup",lo:TS[i-2].h,hi:TS[i].l,t:TS[i].t});}if(TS[i].h<TS[i-2].l){z.push({dir:"res",lo:TS[i].h,hi:TS[i-2].l,t:TS[i].t});}}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,tr:b.c>=e[i]?"bull":"bear"}));}
function trendAt(s,te){let r="bull";for(const x of s){if(x.t<=te)r=x.tr;else break;}return r;}
function resolve(E,k,dir,entry,sl){const tp=dir==="long"?entry+RR*Math.abs(entry-sl):entry-RR*Math.abs(entry-sl);const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;let bk=false;for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];if(!bk){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){bk=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}return bk?0.5:-1;}

// ---- reversal styles: each returns {dir,sl} or null given feature bundle F ----
const STYLES={
 "R1 Asian-sweep + wick":         F=> F.short(F.aHi,.50,F.stRes>=3,true)    || F.long(F.aLo,.50,F.stSup>=3,true),
 "R2 PrevDay HL-sweep + wick":    F=> F.short(F.pdh,.50,F.stRes>=3,true)    || F.long(F.pdl,.50,F.stSup>=3,true),
 "R3 Major 40-swing sweep":       F=> F.short(F.sw40hi,.50,F.stRes>=3,true) || F.long(F.sw40lo,.50,F.stSup>=3,true),
 "R4 OTE 62-82% + wick":          F=> F.short(F.rh6,.50,F.stRes>=2,true,F.oteS) || F.long(F.rl6,.50,F.stSup>=2,true,F.oteL),
 "R5 Strong wick >=.65":          F=> F.short(F.rh6,.65,F.stRes>=2,true)    || F.long(F.rl6,.65,F.stSup>=2,true),
 "R6 Counter-trend strict":       F=> ((F.h4==="bear"&&F.h1==="bear"&&F.d1!=="bear")?F.short(F.aHi,.50,F.stRes>=3,true):null) || ((F.h4==="bull"&&F.h1==="bull"&&F.d1!=="bull")?F.long(F.aLo,.50,F.stSup>=3,true):null),
 "R7 Deep prem/disc + wick":      F=> F.short(F.rh6,.50,F.stRes>=4,"deep")  || F.long(F.rl6,.50,F.stSup>=4,"deep"),
 "R8 A++ major+OTE+wick.6+full":  F=> F.short(F.sw40hi,.60,F.stRes>=4,"deep",F.oteS) || F.long(F.sw40lo,.60,F.stSup>=4,"deep",F.oteL),
};
const CONT = F => (F.d1==="bull"&&F.h4==="bull"&&F.h1==="bull"&&F.stSup>=4 && F.b.l<F.rl6 && F.b.c>F.rl6 && F.b.c<F.eq)?{dir:"long",sl:F.b.l}
                : (F.d1==="bear"&&F.h4==="bear"&&F.h1==="bear"&&F.stRes>=4 && F.b.h>F.rh6 && F.b.c<F.rh6 && F.b.c>F.eq)?{dir:"short",sl:F.b.h}:null;

function runStyle(insts, styleFn){
  const all=[];
  for(const {E,ctx} of insts){
    const seen=new Set();
    for(let k=42;k<E.length;k++){
      const b=E[k];const inKZ=(b.min>=735&&b.min<915)||(b.min>=1020&&b.min<1260);if(!inKZ||seen.has(b.day))continue;
      const A=atr(E,k);if(A<=0)continue;
      const F=ctx(b,k,A); if(!F)continue;
      const sig=styleFn(F); if(!sig)continue;
      const risk=Math.abs(b.c-sig.sl); if(risk<=0||risk<0.2*A)continue;
      all.push(resolve(E,k,sig.dir,b.c,sig.sl)); seen.add(b.day);
    }
  }
  return all;
}
function S(a){const w=a.filter(r=>r>0.01).length,l=a.filter(r=>r<=-0.999).length,t=a.reduce((x,y)=>x+y,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}

(async()=>{
  const insts=[];
  for(const name of Object.keys(SYM)){
    let B=null;try{B=await getBars(name);}catch(e){}
    if(!B||B.length<2000){console.log("skip "+name);continue;}
    const D=rs(B,86400),H4=rs(B,14400),H2=rs(B,7200),H1=rs(B,3600);
    const Z={D:zones(D),"4H":zones(H4),"2H":zones(H2),"1H":zones(H1)};
    const Ds=trendSer(D),H4s=trendSer(H4),H1s=trendSer(H1);
    const E=B;
    // per-day asian + prior-day H/L
    const aH={},aL={},dayHi={},dayLo={};
    for(const b of E){if(b.min<540){aH[b.day]=Math.max(aH[b.day]??-1e18,b.h);aL[b.day]=Math.min(aL[b.day]??1e18,b.l);}dayHi[b.day]=Math.max(dayHi[b.day]??-1e18,b.h);dayLo[b.day]=Math.min(dayLo[b.day]??1e18,b.l);}
    const days=[...new Set(E.map(b=>b.day))].sort();const prevHi={},prevLo={};days.forEach((d,i)=>{if(i){prevHi[d]=dayHi[days[i-1]];prevLo[d]=dayLo[days[i-1]];}});
    const tol=z=>0.25*(z.hi-z.lo)+0.05;
    const stk=(poi,price)=>{let n=0;for(const tf of ["D","4H","2H","1H"])if(Z[tf].some(z=>z.dir===poi&&z.t<price.t&&price.c>=z.lo-tol(z)&&price.c<=z.hi+tol(z)))n++;return n;};
    const ctx=(b,k,A)=>{
      const dr=D.slice(-5);if(dr.length<2)return null;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),rng=drHi-drLo||1,eq=(drHi+drLo)/2;
      const rl6=Math.min(...[1,2,3,4,5,6].map(o=>E[k-o].l)), rh6=Math.max(...[1,2,3,4,5,6].map(o=>E[k-o].h));
      const w=E.slice(k-40,k); const sw40hi=Math.max(...w.map(x=>x.h)), sw40lo=Math.min(...w.map(x=>x.l));
      const leg=E.slice(k-20,k); const lHi=Math.max(...leg.map(x=>x.h)), lLo=Math.min(...leg.map(x=>x.l)), lr=lHi-lLo||1;
      const range=(b.h-b.l)||1, wickUp=(b.h-Math.max(b.o,b.c))/range, wickDn=(Math.min(b.o,b.c)-b.l)/range;
      const stRes=stk("res",b), stSup=stk("sup",b);
      const oteS=((b.c-lLo)/lr)>=0.62&&((b.c-lLo)/lr)<=0.82; // short entering in upper retracement
      const oteL=((lHi-b.c)/lr)>=0.62&&((lHi-b.c)/lr)<=0.82;
      const F={b,eq,drHi,drLo,rng,aHi:aH[b.day],aLo:aL[b.day],pdh:prevHi[b.day],pdl:prevLo[b.day],sw40hi,sw40lo,rl6,rh6,
        d1:trendAt(Ds,b.t),h4:trendAt(H4s,b.t),h1:trendAt(H1s,b.t),stRes,stSup,wickUp,wickDn,oteS,oteL};
      // dir helpers: short/long(level, minWick, stackOK, pdMode[false|true|"deep"], ote?)
      F.short=(lvl,mw,stackOK,pd,ote)=>{ if(lvl==null||!stackOK)return null; if(!(b.h>lvl&&b.c<lvl))return null; if(F.wickUp<mw)return null;
        const pdOK = pd==="deep"? b.c>=drLo+0.66*rng : pd? b.c>eq : true; if(!pdOK)return null; if(ote===false)return null; return {dir:"short",sl:b.h}; };
      F.long=(lvl,mw,stackOK,pd,ote)=>{ if(lvl==null||!stackOK)return null; if(!(b.l<lvl&&b.c>lvl))return null; if(F.wickDn<mw)return null;
        const pdOK = pd==="deep"? b.c<=drLo+0.34*rng : pd? b.c<eq : true; if(!pdOK)return null; if(ote===false)return null; return {dir:"long",sl:b.l}; };
      return F;
    };
    insts.push({name,E,ctx});
  }
  console.log("REVERSAL STYLE BAKE-OFF  (~2y, 1h, 6 instruments, managed 3.6R)\n");
  console.log("STYLE".padEnd(32),"Trades".padStart(6),"Win%".padStart(6),"TotR".padStart(8),"Exp/tr".padStart(9));
  const results=[];
  for(const [name,fn] of Object.entries(STYLES)){const a=runStyle(insts,fn);const s=S(a);results.push({name,s});}
  results.sort((a,b)=>b.s.e-a.s.e);
  for(const {name,s} of results)console.log(name.padEnd(32),String(s.n).padStart(6),(s.wr.toFixed(0)+"%").padStart(6),(s.t.toFixed(1)+"R").padStart(8),(s.e.toFixed(3)+"R").padStart(9));
  const c=S(runStyle(insts,CONT));
  console.log("-".repeat(64));
  console.log("CONT (reference)".padEnd(32),String(c.n).padStart(6),(c.wr.toFixed(0)+"%").padStart(6),(c.t.toFixed(1)+"R").padStart(8),(c.e.toFixed(3)+"R").padStart(9));
})();
