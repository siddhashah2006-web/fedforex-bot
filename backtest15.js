// Liq Grab v15 — LEAK-FREE honest sweep. Causal trend = current price vs EMA of COMPLETED higher-TF bars.
// Dealing range = 5 completed dailies before entry day. Zones = completed-bar, stamped at period-END.
// Lead with EXPECTANCY (+ Wilson CI on profitable-fraction). No test-set selection. Small honest grid.
const IST=5.5*3600;
const SYM={NQ:"NQ=F",ES:"ES=F",YM:"YM=F",RTY:"RTY=F",GC:"GC=F",CL:"CL=F",SI:"SI=F",
  EURUSD:"EURUSD=X",GBPUSD:"GBPUSD=X",USDJPY:"JPY=X",AUDUSD:"AUDUSD=X",USDCAD:"CAD=X",GBPJPY:"GBPJPY=X",EURJPY:"EURJPY=X"};
const fs=require("fs");
function mk(ts){return ts.map(x=>{const d=new Date((x.t+IST)*1000);return{t:x.t,day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:x.o,h:x.h,l:x.l,c:x.c};});}
function load(name){const p="C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/"+name+".json";if(!fs.existsSync(p))return null;return mk(JSON.parse(fs.readFileSync(p)));}
function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function atr(B,k,n=14){let s=0,c=0;for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;}return c?s/c:0;}
function rsC(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c}));}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:"sup",lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:"res",lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});}return z;}
function emaSer(TS){const e=ema(TS.map(x=>x.c),10);return TS.map((b,i)=>({end:b.end,ema:e[i]}));}
function trendAt(arr,te,price){let v=null;for(const x of arr){if(x.end<=te)v=x.ema;else break;}return v==null?null:(price>=v?"bull":"bear");}
function kzOf(min){if(min>=735&&min<915)return"London";if(min>=1020&&min<1260)return"NY-AM";if(min>=1380||min<30)return"NY-PM";return null;}
function tiered(E,k,dir,entry,sl,rr){const risk=Math.abs(entry-sl);const T=[{f:1/3,r:1},{f:1/3,r:0.66*rr},{f:1/3,r:rr}];const done=[0,0,0];let rem=1,real=0,stop=sl,be=false;for(let i=k+1;i<E.length&&i<k+49;i++){const b=E[i];if(dir==="short"?b.h>=stop:b.l<=stop){real+=rem*(stop===entry?0:(dir==="short"?(entry-stop):(stop-entry))/risk);rem=0;break;}for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==="short"?entry-T[ti].r*risk:entry+T[ti].r*risk;if(dir==="short"?b.l<=tp:b.h>=tp){real+=T[ti].f*T[ti].r;rem-=T[ti].f;done[ti]=1;if(!be){stop=entry;be=true;}}}if(rem<=1e-9)break;}if(rem>1e-9){const last=E[Math.min(k+48,E.length-1)];real+=rem*Math.max(-1,Math.min(rr,(dir==="short"?(entry-last.c):(last.c-entry))/risk));}return real;}
const RR=2.56;
function run(name,cfg){
  const B=load(name);if(!B)return [];
  const Dc=rsC(B,86400),H4c=rsC(B,14400),H1c=rsC(B,3600);
  const Z={D:zones(Dc),"4H":zones(H4c),"2H":zones(rsC(B,7200)),"1H":zones(H1c)};
  const Da=emaSer(Dc),H4a=emaSer(H4c),H1a=emaSer(H1c);
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,price,te)=>{let n=0;for(const tf of["D","4H","2H","1H"])if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;return n;};
  const out=[];const seen=new Set();
  for(let k=42;k<B.length;k++){const b=B[k];const kz=kzOf(b.min);if(!kz||(cfg.kz!=="all"&&kz!==cfg.kz)||seen.has(b.day))continue;
    const A=atr(B,k);if(A<=0)continue;
    const dl=Dc.filter(x=>x.end<=b.t);if(dl.length<5)continue;const dr=dl.slice(-5);const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l)),rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));const range=(b.h-b.l)||1;
    const d1=trendAt(Da,b.t,b.c),h4=trendAt(H4a,b.t,b.c),h1=trendAt(H1a,b.t,b.c);
    const trendOK=dir=>cfg.trend==="none"?true:cfg.trend==="all3"?(d1===dir&&h4===dir&&h1===dir):(h4===dir&&h1===dir);
    let dir=null,entry,sl;
    if(b.l<rl&&b.c>rl&&(cfg.pd==="none"||b.c<eq)&&(b.c-b.l)>=0.2*A&&trendOK("bull")){const wick=(Math.min(b.o,b.c)-b.l)/range;if(wick>=0.5&&stk("sup",b.c,b.t)>=cfg.stack){dir="long";entry=b.c;sl=b.l;}}
    else if(b.h>rh&&b.c<rh&&(cfg.pd==="none"||b.c>eq)&&(b.h-b.c)>=0.2*A&&trendOK("bear")){const wick=(b.h-Math.max(b.o,b.c))/range;if(wick>=0.5&&stk("res",b.c,b.t)>=cfg.stack){dir="short";entry=b.c;sl=b.h;}}
    if(!dir)continue;out.push({t:b.t,R:tiered(B,k,dir,entry,sl,RR)});seen.add(b.day);}
  return out;
}
function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n;const c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){const n=a.length,win=a.filter(s=>s.R>0).length,tot=a.reduce((x,s)=>x+s.R,0),ci=wilson(win,n);return{n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,tot};}
function line(lbl,all){const s=st(all);const ts=all.map(x=>x.t),mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;const tr=st(all.filter(x=>x.t<mid)),te=st(all.filter(x=>x.t>=mid));
  console.log(lbl.padEnd(34),`n=${String(s.n).padStart(4)}  win ${s.wr.toFixed(0)}%[${s.ci[0].toFixed(0)}-${s.ci[1].toFixed(0)}]  exp ${s.exp.toFixed(3)}R  tot ${s.tot.toFixed(0)}R | TRAIN exp ${tr.exp.toFixed(2)} / TEST exp ${te.exp.toFixed(2)}`);}
console.log("LEAK-FREE HONEST SWEEP (causal trend/zones/range; expectancy-led; Wilson CI on profitable-fraction)\n");
const CFGS=[
  {trend:"all3",stack:4,kz:"NY-AM",pd:"half"},
  {trend:"all3",stack:3,kz:"NY-AM",pd:"half"},
  {trend:"all3",stack:2,kz:"NY-AM",pd:"half"},
  {trend:"all3",stack:2,kz:"all",pd:"half"},
  {trend:"h4h1",stack:2,kz:"NY-AM",pd:"half"},
  {trend:"all3",stack:1,kz:"all",pd:"none"},
  {trend:"none",stack:1,kz:"all",pd:"none"},  // raw base rate: sweep+wick only
];
for(const cfg of CFGS){let all=[];for(const n of Object.keys(SYM))all=all.concat(run(n,cfg));line(`trend:${cfg.trend} stk>=${cfg.stack} ${cfg.kz} pd:${cfg.pd}`,all);}
