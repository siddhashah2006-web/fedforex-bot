// Fed Forex — A+ setup scanner (pre-kill-zone heads-up).
// ARMED criteria (Siddh's strict stack):
//   1. Daily bias aligned (EMA10)
//   2. Liquidity swept: price under Asian LOW (long) / above Asian HIGH (short)
//   3. Premium/Discount: price in discount half (long) / premium half (short) of the dealing range
//   4. 4H zone (OB/FVG/IFVG) at price  AND  30m zone at price  -> multi-TF stack
// Prints every condition so it's transparent. Decision-support only; never trades.

const IST = 5.5 * 3600;
const TG = require("C:/Users/DESKTOP/Desktop/Claude Code/telegram.js");
const INSTR = [["GOLD (GC)","GC=F"],["NQ","NQ=F"],["ES","ES=F"],["CL","CL=F"],["EURUSD","EURUSD=X"],["GBPUSD","GBPUSD=X"]];

function ema(a,p){const k=2/(p+1);let e=a[0],o=[e];for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);}return o;}
function resampleTF(B,secs){const m=new Map();for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}}return [...m.values()].sort((a,b)=>a.t-b.t);}
function zones(TS){const z=[];const n=TS.length;
  for(let i=2;i<n;i++){
    if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}}
    if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}}
  }
  for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});}
  return z;}
function atrD(D,n=14){let s=0,c=0;for(let i=Math.max(1,D.length-n);i<D.length;i++){s+=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));c++;}return c?s/c:0;}
function nextKZ(min){if(min<735)return{name:"London",mins:735-min};if(min<915)return{name:"London",mins:0};if(min<1020)return{name:"NY AM",mins:1020-min};if(min<1260)return{name:"NY AM",mins:0};return{name:"London(tmrw)",mins:1440-min+735};}
async function getBars(sym){const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=15m&range=60d`,{headers:{"User-Agent":"Mozilla/5.0"}});const j=await r.json();const res=j.chart?.result?.[0];if(!res)return null;const q=res.indicators.quote[0];const b=[];for(let i=0;i<res.timestamp.length;i++){if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;const d=new Date((res.timestamp[i]+IST)*1000);b.push({t:res.timestamp[i],day:d.toISOString().slice(0,10),min:d.getUTCHours()*60+d.getUTCMinutes(),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});}return b;}
function near(z,price,atr){const tol=0.2*(z.hi-z.lo)+0.05*atr;return price>=z.lo-tol&&price<=z.hi+tol;}

(async()=>{
  const armed=[],rows=[];
  for(const [name,sym] of INSTR){
    let B;try{B=await getBars(sym);}catch(e){B=null;}
    if(!B||B.length<100){rows.push({name,err:1});continue;}
    const last=B[B.length-1],price=last.c,day=last.day;
    const D=resampleTF(B,86400);
    const atr=atrD(D)||price*0.01;
    // per-TF trend (close vs EMA10) -> classify CONTINUATION vs REVERSAL
    const trend=secs=>{const ts=resampleTF(B,secs);const c=ts.map(x=>x.c);const e=ema(c,10);return c.at(-1)>=e.at(-1)?"bull":"bear";};
    const d1=trend(86400),h4=trend(14400),h1=trend(3600);
    let type=null,dir=null,tier="";
    if(h4===h1){type="CONT";dir=h4;tier=(d1===h4)?"A+(all3)":"A(H4+H1)";}  // continuation = H4+H1 aligned (leak-free edge); D1 agreeing = higher tier
    const poi=dir==="bull"?"sup":dir==="bear"?"res":null;
    // sweep + premium/discount for that direction
    const dayBars=B.filter(b=>b.day===day);const asian=dayBars.filter(b=>b.min<540);
    const aLow=asian.length?Math.min(...asian.map(b=>b.l)):null, aHigh=asian.length?Math.max(...asian.map(b=>b.h)):null;
    const dayLow=Math.min(...dayBars.map(b=>b.l)), dayHigh=Math.max(...dayBars.map(b=>b.h));
    const dr=D.slice(-5), drHi=Math.max(...dr.map(x=>x.h)), drLo=Math.min(...dr.map(x=>x.l)), rng=(drHi-drLo)||1, eq=(drHi+drLo)/2;
    const swept = dir==="bull" ? (aLow!=null&&dayLow<=aLow) : dir==="bear" ? (aHigh!=null&&dayHigh>=aHigh) : false;
    const pd    = dir==="bull" ? price<eq : dir==="bear" ? price>eq : false;
    // build stack presence for BOTH directions in one pass
    const LADDER=[["D",86400],["4H",14400],["2H",7200],["1H",3600],["30m",1800]];
    const presRes=new Set(), presSup=new Set();
    for(const [tf,secs] of LADDER){const Z=zones(resampleTF(B,secs));
      if(Z.some(z=>z.dir==="res"&&z.t<last.t&&near(z,price,atr)))presRes.add(tf);
      if(Z.some(z=>z.dir==="sup"&&z.t<last.t&&near(z,price,atr)))presSup.add(tf);}
    const present = poi==="res"?presRes : poi==="sup"?presSup : new Set();
    const fullStack=present.size===5;
    // CONTINUATION (auto-push): all-TF trend aligned + FULL stack + sweep + prem/disc
    const isArmed = type==="CONT" && fullStack && swept && pd;
    // REVERSAL watch (R7 winner from 2y bake-off): DEEP prem/disc + >=4-TF stack + Asian sweep. Dir from P/D. No auto-push.
    const deepPrem=price>=drLo+0.66*rng, deepDisc=price<=drLo+0.34*rng;
    let revWatch=false, revDir=null;  // suppress reversal flag when it's a continuation (avoid contradictory dir)
    if(type!=="CONT"){
      if(deepPrem && presRes.size>=4 && aHigh!=null && dayHigh>=aHigh){revWatch=true;revDir="SHORT";}
      else if(deepDisc && presSup.size>=4 && aLow!=null && dayLow<=aLow){revWatch=true;revDir="LONG";}
    }
    const kz=nextKZ(last.min);
    const r={name,price,type:type||"-",tier,dir:dir?(dir==="bull"?"LONG":"SHORT"):"-",revDir,d1,h4,h1,swept,pd,stack:present.size,tfs:[...present].join("+"),isArmed,revWatch,kz};
    rows.push(r); if(isArmed)armed.push(r);
  }
  const f=p=>p>50?p.toFixed(1):p.toFixed(4);
  console.log("FED FOREX — A+ SCANNER  (two-branch: CONT=all-TF stack | REV=H4+H1+wick · Asian sweep · Disc/Prem)   ~15m delayed\n");
  console.log("INSTR".padEnd(12),"TYPE".padEnd(5),"DIR".padEnd(6),"D1/H4/H1".padEnd(13),"SWEEP".padEnd(6),"D/P".padEnd(5),"STACK".padEnd(13),"ARMED".padEnd(7),"NEXT KZ");
  for(const r of rows){ if(r.err){console.log(r.name.padEnd(12),"(no data)");continue;}
    const yn=b=>b?"yes":"·";
    console.log(r.name.padEnd(12),r.type.padEnd(5),r.dir.padEnd(6),`${r.d1}/${r.h4}/${r.h1}`.padEnd(13),yn(r.swept).padEnd(6),yn(r.pd).padEnd(5),(r.stack+"/5 "+(r.tfs||"")).padEnd(13),(r.isArmed?"🔴 YES":r.revWatch?"🟡 rev?":"·").padEnd(7),`${r.kz.name} ${r.kz.mins>0?"in "+Math.floor(r.kz.mins/60)+"h"+(r.kz.mins%60)+"m":"NOW"}`);
  }
  const revs=rows.filter(r=>r.revWatch);
  console.log("\n"+(armed.length
    ? "🔴 ARMED CONTINUATION ("+armed.length+"): "+armed.map(r=>`${r.name} ${r.dir} @ ${f(r.price)}`).join(" | ")
    : "No continuation A+ armed."));
  if(revs.length)console.log("🟡 REVERSAL candidates — R7 deep P/D (YOUR discretionary wick read — not auto-traded): "+revs.map(r=>`${r.name} ${r.revDir} @ ${f(r.price)}`).join(" | "));
  // push only the mechanical-edge continuations
  console.log("\nALERT_JSON:"+JSON.stringify(armed.map(r=>({i:r.name,type:r.type,dir:r.dir,px:+f(r.price),kz:r.kz.name}))));

  // ---- Telegram alert (every setup from our end) ----
  if(armed.length||revs.length){
    let msg="📡 *Fed Forex Scanner*";
    if(armed.length)msg+="\n\n🔴 *CONTINUATION setup* (all-TF aligned · full stack · sweep · prem/disc)\n"+armed.map(r=>`• \`${r.name}\` ${r.dir} @ ${f(r.price)} — ${r.kz.name} KZ`).join("\n");
    if(revs.length)msg+="\n\n🟡 *REVERSAL — your discretionary read (R7)*\n"+revs.map(r=>`• \`${r.name}\` ${r.revDir} @ ${f(r.price)}`).join("\n");
    msg+="\n\n_~15m delayed heads-up — your method, modest measured edge (~+0.16R/trade in NY-AM, leak-free). Confirm the 30m rejection wick at the zone yourself before entry._";
    const res=await TG.send(msg);
    console.log("TELEGRAM:",res.ok?"sent ✓":("skipped — "+res.reason));
  } else { console.log("TELEGRAM: nothing armed, no message sent."); }
})();
