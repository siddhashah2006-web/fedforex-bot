// Liq Grab v7 — TWO-BRANCH engine (Siddh's confirmed archetypes).
//  CONTINUATION: dir == D1 == H4 == H1 trend (with-trend). Needs FULL stack (D+4H+2H+1H+30m). Wick optional.
//  REVERSAL:     dir == H4 == H1 trend but != D1 (against daily). Needs 4H+1H+30m stack + MANDATORY rejection wick.
//  Common: 30m entry, liquidity sweep, premium(short)/discount(long), kill zone, managed 3.6R.
//  Trend per TF = close vs EMA10 of that TF. (Proxy for his discretionary D1/H4/H1 read.)

const IST=5.5*3600, RR=3.6;
const STACK=[["D",86400],["4H",14400],["2H",7200],["1H",3600],["30m",1800]];
function load(name){const j=require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/"+name+".json");const r=j.chart.result[0],q=r.indicators.quote[0];const b=[];for(let i=0;i<r.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((r.timestamp[i]+IST)*1000);b.push({t:r.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function resampleTF(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,day:b.day,min:b.min,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({dir:"res",lo,hi,t:TS[j].t});break;}}}if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({dir:"sup",lo,hi,t:TS[j].t});break;}}}}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSeries(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,trend:b.c>=e[i]?"bull":"bear"}));}
function trendAt(ser,te){let r="bull";for(const s of ser){if(s.t<=te)r=s.trend;else break;}return r;}
function resolveManaged(E,k,dir,entry,sl,tp,maxBars){const risk=Math.abs(entry-sl),oneR=dir==="short"?entry-risk:entry+risk;const hz=[];for(let i=k+1;i<E.length&&hz.length<maxBars;i++)hz.push(E[i]);let banked=false;for(const b of hz){if(!banked){if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=oneR:b.h>=oneR){banked=true;continue;}}else{if(dir==="short"?b.h>=entry:b.l<=entry)return 0.5;if(dir==="short"?b.l<=tp:b.h>=tp)return 0.5+0.5*RR;}}return banked?0.5:-1;}

function run(name){
  const B=load(name);
  const Z={},TF={}; for(const[tf,secs] of STACK){const ts=secs===86400?resampleTF(B,86400):resampleTF(B,secs);Z[tf]=zones(ts);}
  const Dser=trendSeries(resampleTF(B,86400)), H4ser=trendSeries(resampleTF(B,14400)), H1ser=trendSeries(resampleTF(B,3600));
  const M30=resampleTF(B,1800), D=resampleTF(B,86400);
  const tol=z=>0.25*(z.hi-z.lo);
  const out=[];const seen=new Set();
  for(let k=6;k<M30.length;k++){
    const b=M30[k];const inKZ=(b.min>=735&&b.min<915)||(b.min>=1020&&b.min<1260);if(!inKZ||seen.has(b.day))continue;
    const A=atr(M30,k);if(A<=0)continue;
    const dr=D.slice(-5);if(dr.length<2)continue;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    // trigger: sweep recent 6-bar swing + rejection wick + close back, in premium/discount
    let dir=null,entry,sl,wick=false;
    const rl=Math.min(M30[k-1].l,M30[k-2].l,M30[k-3].l,M30[k-4].l,M30[k-5].l,M30[k-6].l);
    const rh=Math.max(M30[k-1].h,M30[k-2].h,M30[k-3].h,M30[k-4].h,M30[k-5].h,M30[k-6].h);
    if(b.l<rl&&b.c>rl&&b.c<eq){dir="long";entry=b.c;sl=b.l;wick=(Math.min(b.o,b.c)-b.l)/((b.h-b.l)||1)>=0.5;}
    else if(b.h>rh&&b.c<rh&&b.c>eq){dir="short";entry=b.c;sl=b.h;wick=(b.h-Math.max(b.o,b.c))/((b.h-b.l)||1)>=0.5;}
    if(!dir)continue;const risk=Math.abs(entry-sl);if(risk<=0||risk<0.2*A)continue;
    const te=b.t,pe=entry,want=dir==="long"?"bull":"bear",poi=dir==="long"?"sup":"res";
    const d1=trendAt(Dser,te),h4=trendAt(H4ser,te),h1=trendAt(H1ser,te);
    // stack presence per TF
    const present={};for(const[tf] of STACK)present[tf]=Z[tf].some(z=>z.dir===poi&&z.t<te&&pe>=z.lo-tol(z)&&pe<=z.hi+tol(z));
    const fullStack=STACK.every(([tf])=>present[tf]);
    const revStack=present["4H"]&&present["1H"]&&present["30m"];
    // classify (CONT = with-trend full stack; REV = wick-rejection sweep in prem/disc at a stack, per his charts)
    let type=null;
    if(d1===want&&h4===want&&h1===want&&fullStack) type="CONT";
    else if(wick&&revStack) type="REV";  // strong rejection wick through the swept level at 4H+1H+30m stack
    if(!type)continue;
    const R=resolveManaged(M30,k,dir,entry,sl,dir==="long"?entry+RR*risk:entry-RR*risk,96);
    out.push({name,day:b.day,type,dir,wick,R});seen.add(b.day);
  }
  return out;
}
const INSTR=["NQ","ES","GC","CL","EURUSD","GBPUSD"];
let ALL=[];for(const n of INSTR)ALL=ALL.concat(run(n));
function S(a){const w=a.filter(s=>s.R>0.01).length,l=a.filter(s=>s.R<=-0.999).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}
function row(lbl,a){const s=S(a);console.log(lbl.padEnd(26),String(s.n).padStart(4),(s.wr.toFixed(0)+"%").padStart(6),(s.w+"W/"+s.l+"L").padStart(8),(s.t.toFixed(1)+"R").padStart(7),(s.e.toFixed(3)+"R").padStart(9));}
console.log("TWO-BRANCH ENGINE (continuation = all-TF stack | reversal = H4+H1 + wick)\n");
console.log("BRANCH".padEnd(26),"Trades".padStart(4),"Win%".padStart(6),"W/L".padStart(8),"TotR".padStart(7),"Exp/tr".padStart(9));
row("CONTINUATION (all-TF)",ALL.filter(s=>s.type==="CONT"));
row("REVERSAL (H4+H1 + wick)",ALL.filter(s=>s.type==="REV"));
console.log("-".repeat(62));
row("COMBINED (two-branch)",ALL);
console.log("\nby instrument (combined):");
for(const n of INSTR){const a=ALL.filter(s=>s.name===n);if(a.length)row("  "+n,a);}
