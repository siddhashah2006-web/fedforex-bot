// Liq Grab v10 — PER-INSTRUMENT OPTIMIZER across all pairs+futures.
// Runs 2 strategies (CONT, REV-R7) x kill zones, with Siddh-style management:
//   tiered partials (1/3 @+1R "first deflection", 1/3 @+2.5R, runner 1/3 -> +3.6R), stop->BE after 1st partial,
//   SL wide at structure (his MAE shows winners dig deep before reversing -> don't cut early; losers die at SL).
// Picks the best (strategy, kill zone) per instrument over ~2y of 1h data.
const IST=5.5*3600;
const SYM={ // futures + FX majors he trades
  NQ:"NQ=F",ES:"ES=F",YM:"YM=F",RTY:"RTY=F",GC:"GC=F",CL:"CL=F",SI:"SI=F",
  EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X",USDJPY:"JPY=X",AUDUSD:"AUDUSD=X",USDCAD:"CAD=X",GBPJPY:"GBPJPY=X",EURJPY:"EURJPY=X"};
const fs=require("fs");
function mk(ts){return ts.map(x=>{const d=new Date((x.t+IST)*1000);return{t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c};});}
async function getBars(name){const p="C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/"+name+".json";if(fs.existsSync(p))return mk(JSON.parse(fs.readFileSync(p)));
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${SYM[name]}?interval=1h&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const ts=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;ts.push({t:res.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}fs.mkdirSync("C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h",{recursive:true});fs.writeFileSync(p,JSON.stringify(ts));return mk(ts);}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rs(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:"sup",lo:TS[i-2].h,hi:TS[i].l,t:TS[i].t});if(TS[i].h<TS[i-2].l)z.push({dir:"res",lo:TS[i].h,hi:TS[i-2].l,t:TS[i].t});}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,tr:b.c>=e[i]?"bull":"bear"}));}
function trendAt(s,te){let r="bull";for(const x of s){if(x.t<=te)r=x.tr;else break;}return r;}
function kzOf(min){if(min>=735&&min<915)return"London";if(min>=1020&&min<1260)return"NY-AM";if(min>=1380||min<30)return"NY-PM";return null;}

// management: tiered partials, BE after first partial, conservative same-bar (stop first)
const TIERS=[{f:1/3,r:1},{f:1/3,r:2.5},{f:1/3,r:3.6}];
function manage(E,k,dir,entry,sl){
  const risk=Math.abs(entry-sl);if(risk<=0)return 0;
  let remaining=1,realized=0,stop=sl,beSet=false;const done=[false,false,false];
  for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];
    const hitStop=dir==="short"?b.h>=stop:b.l<=stop;
    if(hitStop){const rr=stop===entry?0:(dir==="short"?(entry-stop):(stop-entry))/risk;realized+=remaining*rr;remaining=0;break;}
    for(let ti=0;ti<TIERS.length;ti++){if(done[ti])continue;const tp=dir==="short"?entry-TIERS[ti].r*risk:entry+TIERS[ti].r*risk;const hit=dir==="short"?b.l<=tp:b.h>=tp;
      if(hit){realized+=TIERS[ti].f*TIERS[ti].r;remaining-=TIERS[ti].f;done[ti]=true;if(!beSet){stop=entry;beSet=true;}}}
    if(remaining<=1e-9)break;}
  if(remaining>1e-9){const last=E[Math.min(k+48,E.length-1)];const mtm=dir==="short"?(entry-last.c)/risk:(last.c-entry)/risk;realized+=remaining*Math.max(-1,Math.min(3.6,mtm));}
  return realized;
}

function signals(B){
  const D=rs(B,86400),H4=rs(B,14400),H2=rs(B,7200),H1=rs(B,3600);
  const Z={D:zones(D),"4H":zones(H4),"2H":zones(H2),"1H":zones(H1)};
  const Ds=trendSer(D),H4s=trendSer(H4),H1s=trendSer(H1);
  const aH={},aL={};for(const b of B){if(b.min<540){aH[b.day]=Math.max(aH[b.day]??-1e18,b.h);aL[b.day]=Math.min(aL[b.day]??1e18,b.l);}}
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,bar)=>{let n=0;for(const tf of["D","4H","2H","1H"])if(Z[tf].some(z=>z.dir===poi&&z.t<bar.t&&bar.c>=z.lo-tol(z)&&bar.c<=z.hi+tol(z)))n++;return n;};
  const out=[];const seen={CONT:new Set(),REV:new Set()};
  for(let k=42;k<B.length;k++){const b=B[k];const kz=kzOf(b.min);if(!kz)continue;
    const A=atr(B,k);if(A<=0)continue;const dr=D.slice(-5);if(dr.length<2)continue;
    const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),rng=drHi-drLo||1,eq=(drHi+drLo)/2;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l)),rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));
    const range=(b.h-b.l)||1,wU=(b.h-Math.max(b.o,b.c))/range,wD=(Math.min(b.o,b.c)-b.l)/range;
    const d1=trendAt(Ds,b.t),h4=trendAt(H4s,b.t),h1=trendAt(H1s,b.t);
    const stRes=stk("res",b),stSup=stk("sup",b);
    // CONTINUATION: all trend aligned + full stack(4) + pullback sweep + prem/disc half
    if(!seen.CONT.has(b.day)){
      if(d1==="bull"&&h4==="bull"&&h1==="bull"&&stSup>=4&&b.l<rl&&b.c>rl&&b.c<eq&&(b.c-b.l)>=0.2*A){out.push({strat:"CONT",kz,dir:"long",k,entry:b.c,sl:b.l});seen.CONT.add(b.day);}
      else if(d1==="bear"&&h4==="bear"&&h1==="bear"&&stRes>=4&&b.h>rh&&b.c<rh&&b.c>eq&&(b.h-b.c)>=0.2*A){out.push({strat:"CONT",kz,dir:"short",k,entry:b.c,sl:b.h});seen.CONT.add(b.day);}
    }
    // REV-R7: deep prem/disc + wick + stack>=4 + recent sweep
    if(!seen.REV.has(b.day)){
      if(b.h>rh&&b.c<rh&&wU>=0.5&&stRes>=4&&b.c>=drLo+0.66*rng&&(b.h-b.c)>=0.2*A){out.push({strat:"REV",kz,dir:"short",k,entry:b.c,sl:b.h});seen.REV.add(b.day);}
      else if(b.l<rl&&b.c>rl&&wD>=0.5&&stSup>=4&&b.c<=drLo+0.34*rng&&(b.c-b.l)>=0.2*A){out.push({strat:"REV",kz,dir:"long",k,entry:b.c,sl:b.l});seen.REV.add(b.day);}
    }
  }
  return out.map(s=>({...s,R:manage(B,s.k,s.dir,s.entry,s.sl)}));
}
function S(a){const w=a.filter(s=>s.R>0.05).length,l=a.filter(s=>s.R<=-0.5).length,t=a.reduce((x,s)=>x+s.R,0);return{n:a.length,w,l,wr:(w+l)?w/(w+l)*100:0,t,e:a.length?t/a.length:0};}

(async()=>{
  const data={};
  for(const name of Object.keys(SYM)){let B=null;try{B=await getBars(name);}catch(e){}if(B&&B.length>2000)data[name]=signals(B);else console.log("skip "+name+" (no/short data)");}
  const KZS=["London","NY-AM","NY-PM"];
  console.log("\n===== BEST CONFIG PER INSTRUMENT (2y, 1h, tiered partials) =====");
  console.log("INSTR".padEnd(8),"STRAT".padEnd(6),"KILLZONE".padEnd(9),"n".padStart(4),"Win%".padStart(6),"TotR".padStart(8),"Exp/tr".padStart(8));
  const portfolio=[];
  for(const name of Object.keys(data)){
    const sigs=data[name];let best=null;
    for(const strat of ["CONT","REV"])for(const kz of KZS){const a=sigs.filter(s=>s.strat===strat&&s.kz===kz);if(a.length<12)continue;const s=S(a);if(!best||s.e>best.s.e)best={strat,kz,s};}
    if(best){console.log(name.padEnd(8),best.strat.padEnd(6),best.kz.padEnd(9),String(best.s.n).padStart(4),(best.s.wr.toFixed(0)+"%").padStart(6),(best.s.t.toFixed(1)+"R").padStart(8),(best.s.e.toFixed(3)+"R").padStart(8));portfolio.push({name,...best});}
    else console.log(name.padEnd(8),"(no config with >=12 trades)");
  }
  console.log("\n===== STRATEGY x KILLZONE (all instruments combined) =====");
  console.log("COMBO".padEnd(16),"n".padStart(5),"Win%".padStart(6),"TotR".padStart(9),"Exp/tr".padStart(8));
  const allsig=Object.values(data).flat();
  for(const strat of ["CONT","REV"])for(const kz of KZS){const s=S(allsig.filter(x=>x.strat===strat&&x.kz===kz));console.log((strat+" "+kz).padEnd(16),String(s.n).padStart(5),(s.wr.toFixed(0)+"%").padStart(6),(s.t.toFixed(1)+"R").padStart(9),(s.e.toFixed(3)+"R").padStart(8));}
  // portfolio: only trade each instrument's best config
  const pf=portfolio.flatMap(p=>data[p.name].filter(s=>s.strat===p.strat&&s.kz===p.kz));
  const ps=S(pf);
  console.log("\n===== 'PLAYBOOK' PORTFOLIO (each instrument only in its best strat+KZ) =====");
  console.log(`trades ${ps.n} | win ${ps.wr.toFixed(0)}% | total ${ps.t.toFixed(1)}R | exp ${ps.e.toFixed(3)}R/trade`);
})();
