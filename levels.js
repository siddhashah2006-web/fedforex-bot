// Fed Forex — LIQUIDITY LEVEL + HTF POI proximity alerts (Telegram).
// Alerts when price APPROACHES / BREACHES:
//   - Asian session H/L (06:30-10:15 IST), London session H/L (12:15-15:15) — persist all day once formed
//   - nearest untested SWING H/L (1h fractals)
//   - HTF POINT-OF-INTEREST STACKS on 4H & DAILY ONLY: a cluster of FVG/IFVG/OB types overlapping in one zone
//        (Daily: >=2 types OR an OB; 4H: >=2 types). EARLY warning: "potential" within 1x dailyATR, "approaching" within 0.3x.
// Once-per-event-per-day de-dup (levels_state.json, atomic). ~15m delayed price. Decision-support only.
const fs=require("fs");
const TG=require("C:/Users/DESKTOP/Desktop/Claude Code/telegram.js");
const IST=5.5*3600, DIR="C:/Users/DESKTOP/Desktop/Claude Code/";
const INSTR=[["GOLD","GC=F"],["NQ","NQ=F"],["ES","ES=F"],["CL","CL=F"],["EURUSD","EURUSD=X"],["GBPUSD","GBPUSD=X"]];
const SESS={Asian:[390,615],London:[735,915],NYam:[1155,1275]};
const STATE=DIR+"levels_state.json";
function ld(){try{return JSON.parse(fs.readFileSync(STATE));}catch(e){return{};}}
function save(s){const t=STATE+".tmp";fs.writeFileSync(t,JSON.stringify(s));fs.renameSync(t,STATE);}
function writeAtomic(file,data){const t=file+".tmp";fs.writeFileSync(t,data);fs.renameSync(t,file);}
// cache the heavy 4H/Daily (1h/60d) feed ~45min — HTF zones barely change; keeps 5-min session checks light
async function bars1hCached(name,sym){const p=DIR+"htfcache_"+name+".json";try{const st=fs.statSync(p);if(Date.now()-st.mtimeMs<45*60*1000)return JSON.parse(fs.readFileSync(p));}catch(e){}const b=await bars(sym,"60d","1h");if(b&&b.length)writeAtomic(p,JSON.stringify(b));return b;}
async function bars(sym,range,interval){const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const b=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((res.timestamp[i]+IST)*1000);b.push({t:res.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function resample(B,secs){const m=new Map();for(const b of B){const k=Math.floor((b.t+IST)/secs);if(!m.has(k))m.set(k,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(k);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",lo,hi,t:TS[j].t});break;}}}if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",lo,hi,t:TS[j].t});break;}}}}for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}return z;}
function dailyATR(B){const D=resample(B,86400);let s=0,c=0;for(let i=1;i<D.length;i++){s+=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));c++;}return c?s/c:0;}
function swings(h1){const hi=[],lo=[];for(let i=2;i<h1.length-2;i++){if(h1[i].h>=h1[i-1].h&&h1[i].h>=h1[i-2].h&&h1[i].h>=h1[i+1].h&&h1[i].h>=h1[i+2].h)hi.push(h1[i].h);if(h1[i].l<=h1[i-1].l&&h1[i].l<=h1[i-2].l&&h1[i].l<=h1[i+1].l&&h1[i].l<=h1[i+2].l)lo.push(h1[i].l);}return{hi,lo};}
function phaseOf(min){for(const[n,[a,b]]of Object.entries(SESS))if(min>=a&&min<=b)return n+" session";const mids=Object.entries(SESS).map(([n,[a,b]])=>[n,(a+b)/2]);let best=mids[0],bd=1e9;for(const[n,mid]of mids){const d=Math.min(Math.abs(min-mid),1440-Math.abs(min-mid));if(d<bd){bd=d;best=[n,mid];}}return"between sessions (~"+best[0]+")";}
// HTF POI stacks on 4H + DAILY only — TIGHT confluence (intersection of >=2 distinct types), width <= 0.75x ATR.
// Plus standalone tight Daily order blocks. Recency: last 20 HTF bars; within 3 ATR of price.
function htfStacks(B1h,price,atr){const out=[];const addUniq=s=>{if(!out.some(o=>o.tf===s.tf&&Math.abs((o.lo+o.hi)/2-(s.lo+s.hi)/2)<0.1*atr))out.push(s);};
  for(const[tf,secs]of[["4H",14400],["Daily",86400]]){const TS=resample(B1h,secs);if(TS.length<5)continue;const lastT=TS.at(-1).t;
    const zs=zones(TS).filter(z=>z.t>=lastT-20*secs&&Math.min(Math.abs(price-z.lo),Math.abs(price-z.hi))<=3*atr);
    for(let i=0;i<zs.length;i++)for(let j=i+1;j<zs.length;j++){const a=zs[i],b=zs[j];if(a.type===b.type)continue;
      const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);if(lo>hi)continue;            // must overlap
      const inv=zs.filter(z=>!(z.lo>hi||z.hi<lo));const types=new Set(inv.map(z=>z.type));if(types.size<2)continue;
      const clo=Math.max(...inv.map(z=>z.lo)),chi=Math.min(...inv.map(z=>z.hi));const flo=clo<=chi?clo:lo,fhi=clo<=chi?chi:hi;
      if((fhi-flo)>0.75*atr)continue;                                                    // TIGHT confluence only
      addUniq({lo:flo,hi:fhi,types,tf});}
    if(tf==="Daily")for(const z of zs.filter(z=>z.type==="OB"&&(z.hi-z.lo)<=0.6*atr))addUniq({lo:z.lo,hi:z.hi,types:new Set(["OB"]),tf:"Daily"});
  }return out;}

(async()=>{
 try{
  const istH=new Date(Date.now()+IST*1000).getUTCHours();
  if(istH<6||istH>=22){console.log("outside 06:00-22:00 IST — skipping");return;}  // session hours guard
  const state=ld(); const newState={}; const events=[];
  for(const[name,sym]of INSTR){
    let B,B1h; try{B=await bars(sym,"10d","15m");B1h=await bars1hCached(name,sym);}catch(e){continue;}
    if(!B||B.length<50||!B1h||B1h.length<50)continue;
    const last=B.at(-1),price=last.c,day=last.day,nowMin=last.min;
    const td=B.filter(b=>b.day===day);
    const atr=dailyATR(B)||price*0.01, buf=0.15*atr, ph=phaseOf(nowMin);
    const f=n=>n>50?n.toFixed(1):n.toFixed(4);
    const push=(key,emoji,text)=>{newState[key]=true;if(!state[key])events.push({emoji,text});};
    // ---- session + swing single-price levels ----
    const win=(a,b)=>td.filter(x=>x.min>=a&&x.min<=b);
    const L=[];const aB=win(...SESS.Asian);if(aB.length){L.push({nm:"Asian HIGH",v:Math.max(...aB.map(x=>x.h)),k:"high"});L.push({nm:"Asian LOW",v:Math.min(...aB.map(x=>x.l)),k:"low"});}
    const lB=win(...SESS.London);if(lB.length){L.push({nm:"London HIGH",v:Math.max(...lB.map(x=>x.h)),k:"high"});L.push({nm:"London LOW",v:Math.min(...lB.map(x=>x.l)),k:"low"});}
    const sw=swings(resample(B1h,3600));const ah=sw.hi.filter(v=>v>price);if(ah.length)L.push({nm:"Swing HIGH",v:Math.min(...ah),k:"high",sw:1});const bl=sw.lo.filter(v=>v<price);if(bl.length)L.push({nm:"Swing LOW",v:Math.max(...bl),k:"low",sw:1});
    for(const lv of L){let ev=null;if(lv.k==="high"){if(price>=lv.v)ev="BREACH";else if(lv.v-price<=buf)ev="approach";}else{if(price<=lv.v)ev="BREACH";else if(price-lv.v<=buf)ev="approach";}if(!ev)continue;
      const tag=lv.sw?("@"+lv.v.toPrecision(6)):"";const key=`${name}|${lv.nm}${tag}|${day}|${ev}`;
      push(key, ev==="BREACH"?"⚡":"📍", `${ev==="BREACH"?"*BREACHED*":"approaching"} \`${name}\` ${lv.nm} @ ${f(lv.v)} (now ${f(price)})`);}
    // ---- HTF POI stacks (4H + Daily) — EARLY warning ----
    const stacks=htfStacks(B1h,price,atr).map(c=>{const inside=price>=c.lo&&price<=c.hi;const dist=inside?0:Math.min(Math.abs(price-c.lo),Math.abs(price-c.hi));return{c,inside,dist};}).sort((a,b)=>a.dist-b.dist).slice(0,3);
    for(const{c,inside,dist}of stacks){let ev=inside?"AT":dist<=0.3*atr?"approaching":dist<=1.0*atr?"potential":null;if(!ev)continue;
      const types=[...c.types].join("+");const ctr=((c.lo+c.hi)/2);const side=ctr>price?"above":"below";
      const key=`${name}|HTF ${c.tf} @${ctr.toPrecision(6)}|${day}|${ev}`;
      const emoji=ev==="AT"?"🔵":ev==="approaching"?"📍":"🎯";
      push(key,emoji,`${ev==="potential"?"*potential today* →":ev==="approaching"?"*approaching*":"*AT*"} \`${name}\` ${c.tf} POI stack (${types}) ${side} @ ${f(c.lo)}–${f(c.hi)} — now ${f(price)} (~${(dist/atr).toFixed(1)} ATR)`);}
  }
  if(events.length){
    const msg=`🌊 *Fed Forex — levels & HTF POIs*\n`+events.map(e=>`${e.emoji} ${e.text}`).join("\n")+`\n\n_Levels persist all day. HTF = 4H/Daily only. ~15m delayed; early heads-up._`;
    const res=await TG.send(msg);
    console.log(`${events.length} event(s):`);events.forEach(e=>console.log("  "+e.text.replace(/[`*]/g,"")));
    console.log("TELEGRAM:",res.ok?"sent ✓":("skipped — "+res.reason));
  } else console.log("No new level/POI events.");
  save(newState);
 }catch(e){console.log("levels error:",e.message);}
})();
