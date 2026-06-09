// Liq Grab v11 — CONTINUATION GRID SEARCH over ~2y of 1h data, all instruments.
// Precompute candidate signals + features ONCE per instrument, then sweep the full parameter grid.
// Rank configs by WIN RATE (min trades + positive expectancy enforced). Then out-of-sample split on the winner.
const IST=5.5*3600;
const SYM={NQ:"NQ=F",ES:"ES=F",YM:"YM=F",RTY:"RTY=F",GC:"GC=F",CL:"CL=F",SI:"SI=F",
  EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X",USDJPY:"JPY=X",AUDUSD:"AUDUSD=X",USDCAD:"CAD=X",GBPJPY:"GBPJPY=X",EURJPY:"EURJPY=X"};
const fs=require("fs");
function mk(ts){return ts.map(x=>{const d=new Date((x.t+IST)*1000);return{t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c};});}
async function getBars(name){const p="C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/"+name+".json";if(fs.existsSync(p))return mk(JSON.parse(fs.readFileSync(p)));
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${SYM[name]}?interval=1h&range=2y`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const ts=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;ts.push({t:res.timestamp[i],o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}fs.mkdirSync("C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h",{recursive:true});fs.writeFileSync(p,JSON.stringify(ts));return mk(ts);}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rsamp(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:"sup",lo:TS[i-2].h,hi:TS[i].l,t:TS[i].t});if(TS[i].h<TS[i-2].l)z.push({dir:"res",lo:TS[i].h,hi:TS[i-2].l,t:TS[i].t});}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function trendSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({t:b.t,tr:b.c>=e[i]?"bull":"bear"}));}
function trendAt(s,te){let r="bull";for(const x of s){if(x.t<=te)r=x.tr;else break;}return r;}
function kzOf(min){if(min>=735&&min<915)return"London";if(min>=1020&&min<1260)return"NY-AM";if(min>=1380||min<30)return"NY-PM";return null;}
// outcomes
function single(E,k,dir,entry,sl,rr){const tp=dir==="short"?entry-rr*Math.abs(entry-sl):entry+rr*Math.abs(entry-sl);for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];if(dir==="short"?b.h>=sl:b.l<=sl)return -1;if(dir==="short"?b.l<=tp:b.h>=tp)return rr;}const last=E[Math.min(k+48,E.length-1)];return Math.max(-1,Math.min(rr,(dir==="short"?(entry-last.c):(last.c-entry))/Math.abs(entry-sl)));}
function tiered(E,k,dir,entry,sl,rr){const risk=Math.abs(entry-sl);const T=[{f:1/3,r:1},{f:1/3,r:0.66*rr},{f:1/3,r:rr}];const done=[0,0,0];let rem=1,real=0,stop=sl,be=false;for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];if(dir==="short"?b.h>=stop:b.l<=stop){real+=rem*(stop===entry?0:(dir==="short"?(entry-stop):(stop-entry))/risk);rem=0;break;}for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==="short"?entry-T[ti].r*risk:entry+T[ti].r*risk;if(dir==="short"?b.l<=tp:b.h>=tp){real+=T[ti].f*T[ti].r;rem-=T[ti].f;done[ti]=1;if(!be){stop=entry;be=true;}}}if(rem<=1e-9)break;}if(rem>1e-9){const last=E[Math.min(k+48,E.length-1)];real+=rem*Math.max(-1,Math.min(rr,(dir==="short"?(entry-last.c):(last.c-entry))/risk));}return real;}

const RRS=[1.5,2,2.56,3.6];
function candidates(name,B){
  const D=rsamp(B,86400),H4=rsamp(B,14400),H2=rsamp(B,7200),H1=rsamp(B,3600);
  const Z={D:zones(D),"4H":zones(H4),"2H":zones(H2),"1H":zones(H1)};
  const Ds=trendSer(D),H4s=trendSer(H4),H1s=trendSer(H1);
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,bar)=>{let n=0;for(const tf of["D","4H","2H","1H"])if(Z[tf].some(z=>z.dir===poi&&z.t<bar.t&&bar.c>=z.lo-tol(z)&&bar.c<=z.hi+tol(z)))n++;return n;};
  const cs=[];
  for(let k=42;k<B.length;k++){const b=B[k];const kz=kzOf(b.min);if(!kz)continue;const A=atr(B,k);if(A<=0)continue;
    const dr=D.slice(-5);if(dr.length<2)continue;const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),rng=drHi-drLo||1;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l)),rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));
    const range=(b.h-b.l)||1;
    let dir=null,entry,sl,wick;
    if(b.l<rl&&b.c>rl&&(b.c-b.l)>=0.2*A){dir="long";entry=b.c;sl=b.l;wick=(Math.min(b.o,b.c)-b.l)/range;}
    else if(b.h>rh&&b.c<rh&&(b.h-b.c)>=0.2*A){dir="short";entry=b.c;sl=b.h;wick=(b.h-Math.max(b.o,b.c))/range;}
    if(!dir)continue;
    const want=dir==="long"?"bull":"bear",poi=dir==="long"?"sup":"res";
    const d1=trendAt(Ds,b.t),h4=trendAt(H4s,b.t),h1=trendAt(H1s,b.t);
    const pdPos=(b.c-drLo)/rng;
    const out=RRS.map(rr=>[single(B,k,dir,entry,sl,rr),tiered(B,k,dir,entry,sl,rr)]);
    cs.push({name,day:b.day,t:b.t,dir,want,d1,h4,h1,stack:stk(poi,b),wick,pdPos,kz,out});
  }
  return cs;
}

(async()=>{
  let CANDS=[];const meta={};
  for(const name of Object.keys(SYM)){let B=null;try{B=await getBars(name);}catch(e){}if(!B||B.length<2000){console.log("skip "+name);continue;}
    const cs=candidates(name,B);CANDS=CANDS.concat(cs);meta[name]=B.length;}
  // span (years)
  const ts=CANDS.map(c=>c.t);const yrs=((Math.max(...ts)-Math.min(...ts))/(365.25*86400)).toFixed(2);
  console.log(`Candidates: ${CANDS.length} across ${Object.keys(meta).length} instruments, ~${yrs}y span\n`);
  // group by inst|day for one-per-day
  const groups=new Map();for(let i=0;i<CANDS.length;i++){const c=CANDS[i];const key=c.name+"|"+c.day;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}
  for(const arr of groups.values())arr.sort((a,b)=>CANDS[a].t-CANDS[b].t);

  const GRID={trend:["all3","h4h1"],stack:[2,3,4],kz:["London","NY-AM","NY-PM","all"],pd:["none","half","deep"],wick:[0,0.5],rrI:[0,1,2,3],mgmt:[0,1]};
  function pass(c,g){
    if(!(g.trend==="all3"?(c.d1===c.want&&c.h4===c.want&&c.h1===c.want):(c.h4===c.want&&c.h1===c.want)))return false;
    if(c.stack<g.stack)return false;
    if(g.kz!=="all"&&c.kz!==g.kz)return false;
    if(g.pd==="half"&&!(c.dir==="long"?c.pdPos<0.5:c.pdPos>0.5))return false;
    if(g.pd==="deep"&&!(c.dir==="long"?c.pdPos<0.34:c.pdPos>0.66))return false;
    if(c.wick<g.wick)return false;
    return true;
  }
  function evalCombo(g,filterFn){ // returns {n,wr,exp,tot}
    let n=0,w=0,l=0,tot=0;
    for(const arr of groups.values()){let chosen=-1;for(const idx of arr){if(filterFn&&!filterFn(CANDS[idx]))continue;if(pass(CANDS[idx],g)){chosen=idx;break;}}if(chosen<0)continue;const R=CANDS[chosen].out[g.rrI][g.mgmt];n++;tot+=R;if(R>0.05)w++;else if(R<=-0.5)l++;}
    return {n,wr:(w+l)?w/(w+l)*100:0,exp:n?tot/n:0,tot};
  }
  const results=[];
  for(const trend of GRID.trend)for(const stack of GRID.stack)for(const kz of GRID.kz)for(const pd of GRID.pd)for(const wick of GRID.wick)for(const rrI of GRID.rrI)for(const mgmt of GRID.mgmt){
    const g={trend,stack,kz,pd,wick,rrI,mgmt};const r=evalCombo(g);results.push({g,...r});
  }
  console.log("Total configs tested:",results.length);
  const valid=results.filter(r=>r.n>=40&&r.exp>0);
  const lbl=g=>`${g.trend} stk>=${g.stack} ${g.kz} pd:${g.pd} wick>=${g.wick} RR${RRS[g.rrI]} ${g.mgmt?"tiered":"single"}`;
  console.log("\n===== TOP 15 BY WIN RATE (n>=40, expectancy>0) =====");
  console.log("WIN%".padStart(5),"n".padStart(4),"exp".padStart(7),"totR".padStart(7),"  CONFIG");
  for(const r of [...valid].sort((a,b)=>b.wr-a.wr).slice(0,15))console.log((r.wr.toFixed(1)+"%").padStart(5),String(r.n).padStart(4),r.exp.toFixed(3).padStart(7),r.tot.toFixed(0).padStart(7),"  "+lbl(r.g));
  console.log("\n===== TOP 8 BY EXPECTANCY (n>=40) =====");
  for(const r of results.filter(r=>r.n>=40).sort((a,b)=>b.exp-a.exp).slice(0,8))console.log((r.wr.toFixed(1)+"%").padStart(5),String(r.n).padStart(4),r.exp.toFixed(3).padStart(7),r.tot.toFixed(0).padStart(7),"  "+lbl(r.g));

  // OUT-OF-SAMPLE: take top-by-winrate config, split candidates by time 50/50
  const top=[...valid].sort((a,b)=>b.wr-a.wr)[0];
  const mid=(Math.max(...ts)+Math.min(...ts))/2;
  console.log("\n===== WALK-FORWARD on top-win-rate config =====\n"+lbl(top.g));
  const tr=evalCombo(top.g,c=>c.t<mid), te=evalCombo(top.g,c=>c.t>=mid);
  console.log(`  TRAIN (yr1): n=${tr.n} win ${tr.wr.toFixed(1)}% exp ${tr.exp.toFixed(3)}`);
  console.log(`  TEST  (yr2): n=${te.n} win ${te.wr.toFixed(1)}% exp ${te.exp.toFixed(3)}`);
})();
