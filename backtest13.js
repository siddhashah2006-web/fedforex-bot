// Per-instrument KILL-ZONE selection with the VALIDATED CHAMPION params fixed.
// Champion: trend=all3, stack>=4 (fallback >=3 if sample tiny), wick>=0.5, pd=half, RR2.56, tiered.
// For each instrument, evaluate each KZ on TRAIN(yr1)/TEST(yr2)/FULL and pick the best CONSISTENT KZ.
const IST=5.5*3600;
const SYM={NQ:"NQ=F",ES:"ES=F",YM:"YM=F",RTY:"RTY=F",GC:"GC=F",CL:"CL=F",SI:"SI=F",
  EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X",USDJPY:"JPY=X",AUDUSD:"AUDUSD=X",USDCAD:"CAD=X",GBPJPY:"GBPJPY=X",EURJPY:"EURJPY=X"};
const fs=require("fs");
function mk(ts){return ts.map(x=>{const d=new Date((x.t+IST)*1000);return{t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c};});}
function load(name){const p="C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/"+name+".json";if(!fs.existsSync(p))return null;return mk(JSON.parse(fs.readFileSync(p)));}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rsamp(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:"sup",lo:TS[i-2].h,hi:TS[i].l,t:TS[i].t});if(TS[i].h<TS[i-2].l)z.push({dir:"res",lo:TS[i].h,hi:TS[i-2].l,t:TS[i].t});}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,tr:b.c>=e[i]?"bull":"bear"}));}
function trendAt(s,te){let r="bull";for(const x of s){if(x.t<=te)r=x.tr;else break;}return r;}
function kzOf(min){if(min>=735&&min<915)return"London";if(min>=1020&&min<1260)return"NY-AM";if(min>=1380||min<30)return"NY-PM";return null;}
function tiered(E,k,dir,entry,sl,rr){const risk=Math.abs(entry-sl);const T=[{f:1/3,r:1},{f:1/3,r:0.66*rr},{f:1/3,r:rr}];const done=[0,0,0];let rem=1,real=0,stop=sl,be=false;for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];if(dir==="short"?b.h>=stop:b.l<=stop){real+=rem*(stop===entry?0:(dir==="short"?(entry-stop):(stop-entry))/risk);rem=0;break;}for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==="short"?entry-T[ti].r*risk:entry+T[ti].r*risk;if(dir==="short"?b.l<=tp:b.h>=tp){real+=T[ti].f*T[ti].r;rem-=T[ti].f;done[ti]=1;if(!be){stop=entry;be=true;}}}if(rem<=1e-9)break;}if(rem>1e-9){const last=E[Math.min(k+48,E.length-1)];real+=rem*Math.max(-1,Math.min(rr,(dir==="short"?(entry-last.c):(last.c-entry))/risk));}return real;}
const RR=2.56;
function sigs(B,stackMin){
  const D=rsamp(B,86400),H4=rsamp(B,14400),H2=rsamp(B,7200),H1=rsamp(B,3600);
  const Z={D:zones(D),"4H":zones(H4),"2H":zones(H2),"1H":zones(H1)};const Ds=trendSer(D),H4s=trendSer(H4),H1s=trendSer(H1);
  const tol=z=>0.25*(z.hi-z.lo)+0.05;const stk=(poi,bar)=>{let n=0;for(const tf of["D","4H","2H","1H"])if(Z[tf].some(z=>z.dir===poi&&z.t<bar.t&&bar.c>=z.lo-tol(z)&&bar.c<=z.hi+tol(z)))n++;return n;};
  const out=[];const seen=new Set();
  for(let k=42;k<B.length;k++){const b=B[k];const kz=kzOf(b.min);if(!kz||seen.has(b.day))continue;const A=atr(B,k);if(A<=0)continue;
    const dr=D.slice(-5);if(dr.length<2)continue;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),rng=drHi-drLo||1,eq=(drHi+drLo)/2;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l)),rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));const range=(b.h-b.l)||1;
    const d1=trendAt(Ds,b.t),h4=trendAt(H4s,b.t),h1=trendAt(H1s,b.t);
    // CONT champion: all3 aligned + stack + wick>=0.5 + pd half + pullback sweep
    if(d1==="bull"&&h4==="bull"&&h1==="bull"&&b.l<rl&&b.c>rl&&b.c<eq&&(b.c-b.l)>=0.2*A){
      const wick=(Math.min(b.o,b.c)-b.l)/range;if(wick>=0.5&&stk("sup",b)>=stackMin){out.push({t:b.t,kz,R:tiered(B,k,"long",b.c,b.l,RR)});seen.add(b.day);continue;}}
    if(d1==="bear"&&h4==="bear"&&h1==="bear"&&b.h>rh&&b.c<rh&&b.c>eq&&(b.h-b.c)>=0.2*A){
      const wick=(b.h-Math.max(b.o,b.c))/range;if(wick>=0.5&&stk("res",b)>=stackMin){out.push({t:b.t,kz,R:tiered(B,k,"short",b.c,b.h,RR)});seen.add(b.day);}}
  }
  return out;
}
function S(a){const w=a.filter(s=>s.R>0.05).length,l=a.filter(s=>s.R<=-0.5).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,wr:(w+l)?w/(w+l)*100:0,e:a.length?t/a.length:0};}
const KZS=["London","NY-AM","NY-PM"];
console.log("PER-INSTRUMENT KILL ZONE (champion params; pick best CONSISTENT KZ)\n");
const MAP={};
for(const name of Object.keys(SYM)){const B=load(name);if(!B){console.log(name,"(no data)");continue;}
  let all=sigs(B,4); if(all.length<20) all=sigs(B,3); // fallback to stack>=3 if too few
  if(!all.length){console.log(name.padEnd(8),"(no signals)");continue;}
  const ts=all.map(s=>s.t),mid=(Math.max(...ts)+Math.min(...ts))/2;
  let best=null,line=name.padEnd(8);
  for(const kz of KZS){const a=all.filter(s=>s.kz===kz);if(!a.length)continue;const f=S(a),tr=S(a.filter(s=>s.t<mid)),te=S(a.filter(s=>s.t>=mid));
    line+=` | ${kz}: ${f.n}t ${f.wr.toFixed(0)}%(tr${tr.wr.toFixed(0)}/te${te.wr.toFixed(0)}) ${f.e.toFixed(2)}R`;
    const consistent = f.n>=12 && tr.wr>=50 && te.wr>=50; // both halves win => robust
    if(consistent && (!best||f.wr>best.wr))best={kz,wr:f.wr,e:f.e,n:f.n};}
  MAP[name]=best?best.kz:"NY-AM";
  console.log(line);
}
console.log("\n>>> PER-INSTRUMENT KZ MAP (robust, both-halves-positive):");
console.log(JSON.stringify(MAP));
