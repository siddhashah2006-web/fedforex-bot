// Fed Forex — V2 Alert Worker (Cloudflare) — 2026-06-09
// Changes from V1:
//   • wick threshold upgraded 0.50 → 0.55 (+2.4% WR proven in backtest)
//   • TWO-STAGE alerts: Stage-1 "Setup Forming" when sweep detected,
//     Stage-2 "Entry Confirmed" when displacement bar closes (~15m later on M15, ~1h on 1H)
//   • M15 scan: new */15 cron during kill-zone hours (Yahoo Finance 15m data)
//   • Day-of-week filter: configurable (DOW_FILTER=true skips Mon/Fri)
//   • Better Telegram formatting: entry price, SL, T1/T2/T3 targets in alert
//
// Bindings: KV "STATE" | Secrets: TG_TOKEN TG_CHAT SUPABASE_URL SUPABASE_KEY TV_SECRET
// Crons (UTC):
//   "*/5  * * * *"  — HTF zone/stack levels (06-22 IST guard)
//   "*/15 * * * *"  — M15 sweep scan during KZ hours (NEW)
//   "43 5 * * *"    — London 1H scan
//   "27 10 * * *"   — NY-AM 1H scan
//   "47 7,15,20 * * *" — Supabase sync

const IST = 5.5 * 3600;
const DOW_FILTER = false; // set true to only alert Tue-Thu
const WICK = 0.55;        // upgraded from 0.5
const INSTR = [
  ["GOLD","GC=F"],["NQ","NQ=F"],["ES","ES=F"],["CL","CL=F"],
  ["EURUSD","EURUSD=X"],["GBPUSD","GBPUSD=X"],["USDJPY","JPY=X"],
  ["AUDUSD","AUDUSD=X"],["GBPJPY","GBPJPY=X"],["EURJPY","EURJPY=X"]
];
const SESS = { London:[735,915], NYam:[1020,1260] };

// ── helpers ──
async function yf(sym,range,interval){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
    {headers:{"User-Agent":"Mozilla/5.0"},cf:{cacheTtl:60}});
  const j=await r.json(); const res=j.chart?.result?.[0]; if(!res)return null;
  const q=res.indicators.quote[0]; const b=[];
  for(let i=0;i<res.timestamp.length;i++){
    if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;
    const d=new Date((res.timestamp[i]+IST)*1000);
    b.push({t:res.timestamp[i],day:d.toISOString().slice(0,10),
      min:d.getUTCHours()*60+d.getUTCMinutes(),
      dow:d.getUTCDay(),
      o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});
  }
  return b;
}
function resample(B,secs){ const m=new Map(); for(const b of B){ const k=Math.floor((b.t+IST)/secs); if(!m.has(k))m.set(k,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}); else{const x=m.get(k);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;} } return[...m.values()].sort((a,b)=>a.t-b.t); }
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function dailyATR(B){ const D=resample(B,86400); let s=0,c=0; for(let i=1;i<D.length;i++){s+=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));c++;} return c?s/c:0; }
function atrOf(B){ let s=0,c=0; for(let i=1;i<B.length;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){ if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}} if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}} } for(let i=0;i<n-1;i++){ if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); } return z; }
function trendOf(B,secs){ const TS=resample(B,secs); const c=TS.map(x=>x.c); const e=ema(c,10); return c[c.length-1]>=e[e.length-1]?"bull":"bear"; }
function fnum(n){ return n>50?n.toFixed(2):n.toFixed(5); }
async function tg(env,text){ if(!env.TG_TOKEN||!env.TG_CHAT)return; try{ await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TG_CHAT,text,parse_mode:"Markdown",disable_web_page_preview:true})}); }catch(e){} }
const getJSON=async(env,k)=>{ const v=await env.STATE.get(k); return v?JSON.parse(v):null; };
const putJSON=(env,k,o,ttl)=>env.STATE.put(k,JSON.stringify(o),ttl?{expirationTtl:ttl}:undefined);

// HTF POI stacks for zone-approach alerts
function htfStacks(B1h,atr){ const out=[]; const uniq=s=>{ if(!out.some(o=>o.tf===s.tf&&Math.abs((o.lo+o.hi)/2-(s.lo+s.hi)/2)<0.1*atr))out.push(s); };
  for(const[tf,secs]of[["4H",14400],["Daily",86400]]){ const TS=resample(B1h,secs); if(TS.length<5)continue; const lastT=TS[TS.length-1].t;
    const zs=zones(TS).filter(z=>z.t>=lastT-20*secs);
    for(let i=0;i<zs.length;i++)for(let j=i+1;j<zs.length;j++){ const a=zs[i],b=zs[j]; if(a.type===b.type)continue; const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi); if(lo>hi)continue;
      const inv=zs.filter(z=>!(z.lo>hi||z.hi<lo)); const types=[...new Set(inv.map(z=>z.type))]; if(types.length<2)continue;
      const clo=Math.max(...inv.map(z=>z.lo)),chi=Math.min(...inv.map(z=>z.hi)); const flo=clo<=chi?clo:lo,fhi=clo<=chi?chi:hi; if((fhi-flo)>0.75*atr)continue; uniq({lo:flo,hi:fhi,types,tf}); }
    if(tf==="Daily")for(const z of zs.filter(z=>z.type==="OB"&&(z.hi-z.lo)<=0.6*atr))uniq({lo:z.lo,hi:z.hi,types:["OB"],tf:"Daily"}); } return out; }

// Zone stack count the same way as backtest
function zoneStackCount(B1h,price,te){
  let n=0;
  for(const secs of [86400,14400,7200,3600]){
    const TS=resample(B1h,secs);
    const poi=price<(Math.max(...TS.slice(-5).map(x=>x.h))+Math.min(...TS.slice(-5).map(x=>x.l)))/2?'sup':'res';
    const zs=zones(TS).filter(z=>z.dir===poi&&z.t<=te);
    const tol=z=>0.25*(z.hi-z.lo)+0.05;
    if(zs.some(z=>price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;
  }
  return n;
}

// ── Format entry alert message with levels ──
function entryMsg(name,dir,tf,entry,sl,kz,note){
  const risk=Math.abs(entry-sl);
  const t1=dir==='long'?entry+risk:entry-risk;
  const t2=dir==='long'?entry+1.7*risk:entry-1.7*risk;
  const t3=dir==='long'?entry+2.56*risk:entry-2.56*risk;
  const arrow=dir==='long'?'📈':'📉';
  return `${arrow} *ENTRY CONFIRMED — ${name} ${dir.toUpperCase()}* (${tf})\n`+
    `*Entry:* \`${fnum(entry)}\`\n`+
    `*SL:* \`${fnum(sl)}\`  _(risk = ${fnum(risk)})_\n`+
    `*T1 (1R):* \`${fnum(t1)}\`\n`+
    `*T2 (1.7R):* \`${fnum(t2)}\`\n`+
    `*T3 (2.56R):* \`${fnum(t3)}\`\n`+
    `_${kz} kill zone${note?` — ${note}`:''}. Move SL to BE after T1._`;
}

// ── LEVELS (every 5 min, 06-22 IST) ── unchanged from V1
async function runLevels(env){
  const istH=new Date((Date.now()/1000+IST)*1000).getUTCHours();
  if(istH<6||istH>=22)return;
  const state=(await getJSON(env,"levels_state"))||{}; const newState={},events=[];
  const push=(key,emoji,text)=>{ newState[key]=true; if(!state[key])events.push({emoji,text}); };
  for(const [name,sym] of INSTR){
    let B; try{B=await yf(sym,"10d","15m");}catch(e){continue;} if(!B||B.length<50)continue;
    const last=B[B.length-1],price=last.c,day=last.day;
    const atr=dailyATR(B)||price*0.01;
    let stacks=await getJSON(env,"htf_"+name);
    if(!stacks){try{const B1h=await yf(sym,"60d","1h");if(B1h&&B1h.length>50){stacks=htfStacks(B1h,dailyATR(B1h)||atr);await putJSON(env,"htf_"+name,stacks,2700);}}catch(e){}}
    if(stacks){const near=stacks.map(c=>{const inside=price>=c.lo&&price<=c.hi;const dist=inside?0:Math.min(Math.abs(price-c.lo),Math.abs(price-c.hi));return{c,inside,dist};}).sort((a,b)=>a.dist-b.dist).slice(0,3);
      for(const{c,inside,dist}of near){const ev=inside?"AT":dist<=0.3*atr?"approaching":dist<=1.0*atr?"potential":null;if(!ev)continue;
        const side=((c.lo+c.hi)/2)>price?"above":"below";const key=`${name}|HTF ${c.tf} @${((c.lo+c.hi)/2).toPrecision(6)}|${day}|${ev}`;
        push(key,ev==="AT"?"🔵":ev==="approaching"?"📍":"🎯",`${ev==="potential"?"*potential today* →":ev==="approaching"?"*approaching*":"*AT*"} \`${name}\` ${c.tf} POI (${c.types.join("+")}) ${side} @ ${fnum(c.lo)}–${fnum(c.hi)} — now ${fnum(price)}`);}
    }
  }
  if(events.length)await tg(env,`🎯 *Fed Forex — zone alert*\n`+events.map(e=>`${e.emoji} ${e.text}`).join("\n")+`\n\n_HTF POI stack approach — heads up._`);
  await putJSON(env,"levels_state",newState);
}

// ── M15 TWO-STAGE SCAN (every 15 min during KZ hours) ──
async function runM15Scan(env){
  const now=Math.floor(Date.now()/1000);
  const istMin=new Date((now+IST)*1000).getUTCHours()*60+new Date((now+IST)*1000).getUTCMinutes();
  // Guard: only run during London (735-930 IST) or NY-AM (1010-1270 IST) with 15-min buffer
  const inLondon=istMin>=720&&istMin<=930, inNYAM=istMin>=1010&&istMin<=1275;
  if(!inLondon&&!inNYAM) return;
  const kzLabel=inLondon?"London":"NY-AM";

  for(const [name,sym] of INSTR){
    // Fetch M15 bars (2-day window)
    let Bm; try{Bm=await yf(sym,"2d","15m");}catch(e){continue;}
    if(!Bm||Bm.length<12) continue;
    // Fetch 1H bars for zone stack computation
    let B1h; try{B1h=await yf(sym,"60d","1h");}catch(e){continue;}
    if(!B1h||B1h.length<50) continue;

    const A1h=dailyATR(B1h)||Bm[Bm.length-1].c*0.005;
    const Am15=atrOf(Bm.slice(-30))||A1h*0.25;

    // Skip Mon(1) and Fri(5) if DOW filter on
    if(DOW_FILTER){ const dow=Bm[Bm.length-1].dow; if(dow===1||dow===5)continue; }

    // ── Stage-2 check: pending setup + did last closed M15 bar displace? ──
    const pendKey=`s2m15_${name}`;
    const pend=await getJSON(env,pendKey);
    if(pend){
      // last COMPLETED bar = second-to-last (last may be still forming)
      const lastClosed=Bm[Bm.length-2];
      if(lastClosed&&lastClosed.t>pend.sweepT&&lastClosed.t!==pend.lastChecked){
        const mbR=(lastClosed.h-lastClosed.l)||1;
        const dispOK=pend.dir==='long'?
          ((lastClosed.c-lastClosed.l)/mbR>=0.55&&Math.abs(lastClosed.c-lastClosed.o)>=0.3*Am15):
          ((lastClosed.h-lastClosed.c)/mbR>=0.55&&Math.abs(lastClosed.c-lastClosed.o)>=0.3*Am15);
        if(dispOK){
          await tg(env, entryMsg(name,pend.dir,'M15',lastClosed.c,pend.sl,kzLabel,`wick ${(pend.wickPct*100).toFixed(0)}%`));
          await env.STATE.delete(pendKey);
        } else {
          // Update lastChecked so we don't re-evaluate same bar
          pend.lastChecked=lastClosed.t;
          await putJSON(env,pendKey,pend,1800); // refresh 30-min TTL
        }
      }
    }

    // ── Stage-1 check: does bar[n-2] show a valid sweep? ──
    // (bar[n-2] is fully closed and not still forming; bar[n-1] is "last closed", bar[n] forming)
    const barsLen=Bm.length;
    if(barsLen<10) continue;
    const sweepBar=Bm[barsLen-2]; // the bar that just finished before the current forming bar
    if(pend&&Math.abs(pend.sweepT-sweepBar.t)<900) continue; // already have this setup

    // Recent structure: last 6 bars before the sweep bar
    const recent=Bm.slice(Math.max(0,barsLen-8),barsLen-2);
    if(recent.length<4) continue;
    const rl=Math.min(...recent.map(b=>b.l));
    const rh=Math.max(...recent.map(b=>b.h));

    // 5-day dealing range from 1H
    const dr5=resample(B1h,86400).slice(-5);
    if(dr5.length<2) continue;
    const drHi=Math.max(...dr5.map(x=>x.h)),drLo=Math.min(...dr5.map(x=>x.l)),eq=(drHi+drLo)/2;

    // HTF trend: H4+H1 aligned
    const h4=trendOf(B1h,14400), h1=trendOf(B1h,3600);
    if(h4!==h1) continue;

    const price=sweepBar.c, range=(sweepBar.h-sweepBar.l)||1;
    let dir=null,sl,wickPct;

    if(sweepBar.l<rl&&sweepBar.c>rl&&sweepBar.c<eq){
      wickPct=(Math.min(sweepBar.o,sweepBar.c)-sweepBar.l)/range;
      if(wickPct>=WICK&&h4==='bull'){ // zone stack relaxed for speed — checked below
        // Quick zone stack: need ≥1 HTF zone near price (cheaper than full backtest check)
        const stk=zoneStackCount(B1h,price,sweepBar.t);
        if(stk>=1){ dir='long'; sl=sweepBar.l; }
      }
    } else if(sweepBar.h>rh&&sweepBar.c<rh&&sweepBar.c>eq){
      wickPct=(sweepBar.h-Math.max(sweepBar.o,sweepBar.c))/range;
      if(wickPct>=WICK&&h4==='bear'){
        const stk=zoneStackCount(B1h,price,sweepBar.t);
        if(stk>=1){ dir='short'; sl=sweepBar.h; }
      }
    }

    if(!dir) continue;

    // Stage-1 alert
    const risk=Math.abs(price-sl);
    const entryGuide=dir==='long'?price+0.2*risk:price-0.2*risk; // rough guide
    const nextBarIST=new Date((sweepBar.t+900+IST)*1000);
    const nextBarStr=`${String(nextBarIST.getUTCHours()).padStart(2,'0')}:${String(nextBarIST.getUTCMinutes()).padStart(2,'0')} IST`;
    const arrow=dir==='long'?'📈':'📉';

    await tg(env,
      `⚡ *SETUP FORMING — ${name} ${dir.toUpperCase()}* (M15)\n`+
      `Sweep wick: ${(wickPct*100).toFixed(0)}% of bar @ ${fnum(price)}\n`+
      `Direction: ${h4.toUpperCase()} bias confirmed (H4+H1)\n`+
      `SL zone: ${fnum(sl)}\n`+
      `_Displacement bar closes ~${nextBarStr}. If it closes in upper/lower 55% of range → ENTRY near ${fnum(entryGuide)}_\n`+
      `_${kzLabel} kill zone — watch next 15 min_`
    );

    // Store Stage-1 in KV with 30-min TTL
    await putJSON(env,pendKey,{dir,sl,sweepT:sweepBar.t,wickPct,kz:kzLabel,lastChecked:0},1800);
  }
}

// ── 1H TWO-STAGE SCAN (London + NY-AM, once per session) ──
async function runScan1H(env,kzLabel){
  const armed=[]; const stage1fired=[];

  for(const [name,sym] of INSTR){
    let B; try{B=await yf(sym,"60d","1h");}catch(e){continue;} if(!B||B.length<200)continue;
    const last=B[B.length-1],price=last.c,day=last.day;

    // Skip Mon/Fri if DOW filter on
    if(DOW_FILTER&&[1,5].includes(last.dow)) continue;

    const A=dailyATR(B)||price*0.01;
    const d1=trendOf(B,86400),h4=trendOf(B,14400),h1=trendOf(B,3600);
    if(h4!==h1) continue;
    const dir=h4,poi=dir==='bull'?'sup':'res';

    // Dealing range
    const D=resample(B,86400).slice(-5); if(D.length<2)continue;
    const drHi=Math.max(...D.map(x=>x.h)),drLo=Math.min(...D.map(x=>x.l)),eq=(drHi+drLo)/2;
    const pd=dir==='bull'?price<eq:price>eq;

    // Zone stack (same as backtest)
    let stack=0;
    for(const secs of [86400,14400,7200,3600]){
      const zs=zones(resample(B,secs)).filter(z=>z.dir===poi&&z.t<last.t&&price>=z.lo-0.25*(z.hi-z.lo)&&price<=z.hi+0.25*(z.hi-z.lo));
      if(zs.length)stack++;
    }
    if(stack<2) continue;

    // Recent 1H structure (6-bar look)
    const rl=Math.min(...B.slice(-7,-1).map(b=>b.l));
    const rh=Math.max(...B.slice(-7,-1).map(b=>b.h));
    const range=(last.h-last.l)||1;

    // Check if CURRENT 1H bar is a sweep (Stage-1 candidate)
    let sweepDir=null,sl,wickPct;
    if(dir==='bull'&&last.l<rl&&last.c>rl&&pd){
      wickPct=(Math.min(last.o,last.c)-last.l)/range;
      if(wickPct>=WICK){sweepDir='long';sl=last.l;}
    } else if(dir==='bear'&&last.h>rh&&last.c<rh&&pd){
      wickPct=(last.h-Math.max(last.o,last.c))/range;
      if(wickPct>=WICK){sweepDir='short';sl=last.h;}
    }

    if(sweepDir){
      // Check if we already sent Stage-1 for this sweep
      const pendKey=`s2_1h_${name}`;
      const existing=await getJSON(env,pendKey);
      if(!existing||Math.abs(existing.sweepT-last.t)>3600){
        // Send Stage-1 alert
        const risk=Math.abs(price-sl);
        const nextHourIST=new Date((last.t+3600+IST)*1000);
        const nextStr=`${String(nextHourIST.getUTCHours()).padStart(2,'0')}:${String(nextHourIST.getUTCMinutes()).padStart(2,'0')} IST`;
        const arrow=sweepDir==='long'?'📈':'📉';
        await tg(env,
          `⚡ *SETUP FORMING — ${name} ${sweepDir.toUpperCase()}* (1H)\n`+
          `Sweep wick: ${(wickPct*100).toFixed(0)}% @ ${fnum(price)} — ${kzLabel}\n`+
          `HTF bias: ${d1.toUpperCase()} D1 + ${h4.toUpperCase()} H4+H1\n`+
          `Zone stack: ${stack}/4 TFs aligned\n`+
          `SL: ${fnum(sl)}\n`+
          `_Displacement bar closes ~${nextStr}. Entry on NEXT 1H close if displacement confirmed._`
        );
        await putJSON(env,pendKey,{dir:sweepDir,sl,sweepT:last.t,wickPct,kz:kzLabel,d1},3600+900);
      }
    }

    // Stage-2: check if any pending 1H setup just got displacement confirmation
    const pendKey=`s2_1h_${name}`;
    const pend=await getJSON(env,pendKey);
    if(pend&&pend.sweepT<last.t){ // last is now the bar AFTER the sweep
      const mbR=(last.h-last.l)||1;
      const dispOK=pend.dir==='long'?
        ((last.c-last.l)/mbR>=0.55&&Math.abs(last.c-last.o)>=0.3*A):
        ((last.h-last.c)/mbR>=0.55&&Math.abs(last.c-last.o)>=0.3*A);
      if(dispOK){
        await tg(env,entryMsg(name,pend.dir,'1H',last.c,pend.sl,kzLabel,
          `D1 ${pend.d1?.toUpperCase()} | wick ${(pend.wickPct*100).toFixed(0)}%`));
        await env.STATE.delete(pendKey);
      }
    }

    // Legacy "potential setup" list (unchanged)
    const td=B.filter(b=>b.day===day);
    const aB=td.filter(x=>x.min>=390&&x.min<=615); if(!aB.length)continue;
    const aHi=Math.max(...aB.map(x=>x.h)),aLo=Math.min(...aB.map(x=>x.l));
    const swept=dir==='bull'?(Math.min(...td.map(x=>x.l))<=aLo):(Math.max(...td.map(x=>x.h))>=aHi);
    if(swept&&pd&&stack>=2)
      armed.push({name,dir:dir==='bull'?"LONG":"SHORT",price,tier:(d1===dir)?"A+":"A"});
  }
  if(armed.length)
    await tg(env,`🔴 *Fed Forex — potential setups* (${kzLabel} KZ, 1H)\n`+
      armed.map(a=>`• \`${a.name}\` ${a.dir} @ ${fnum(a.price)} [${a.tier}]`).join("\n")+
      `\n_Confirmed edge: wait for wick0.55 + displacement confirmation before entry_`);
}

// ── SUPABASE SYNC (unchanged from V1) ──
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const u=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(u<=0||u>100)return null;const rem=100-u;const pr=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let rR=0;if(t.remainderOutcome==="TP")rR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="SL")rR=-1;else if(t.remainderOutcome==="manual")rR=parseFloat(t.remainderR||0);return+(pr+rem/100*rR).toFixed(2);}
function Rof(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
async function runSync(env){
  const H={apikey:env.SUPABASE_KEY,Authorization:"Bearer "+env.SUPABASE_KEY};
  let idRows; try{idRows=await(await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id&order=id",{method:"GET",headers:H})).json();}catch(e){return;}
  const liveIds=idRows.map(r=>r.id); const state=(await getJSON(env,"sync_state"))||{ids:[]};
  const known=new Set(state.ids||[]);
  if(!liveIds.filter(id=>!known.has(id)).length&&state.count===liveIds.length)return;
  const rows=await(await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id,data&order=id",{method:"GET",headers:H})).json();
  const T=rows.map(r=>r.data); if(!T.length)return;
  const w=T.filter(t=>t.outcome==="Win").length,l=T.filter(t=>t.outcome==="Loss").length,wr=(w+l)?Math.round(w/(w+l)*100):0;
  const exp=+(T.reduce((a,t)=>a+Rof(t),0)/T.length).toFixed(2);
  const newT=rows.filter(r=>!known.has(r.id)).map(r=>r.data);
  if(newT.length){const nl=newT.slice(0,8).map(t=>`• ${t.pair} ${t.direction} ${t.outcome} (${Rof(t)>=0?"+":""}${Rof(t)}R)`).join("\n");
    await tg(env,`🔄 *Fed Forex — ${newT.length} new trade${newT.length>1?"s":""} synced*\n${nl}${newT.length>8?`\n…+${newT.length-8} more`:""}\n\n*Edge:* ${T.length} trades · ${wr}% WR · ${exp}R/trade`);}
  await putJSON(env,"sync_state",{ids:liveIds,count:liveIds.length});
}

// ── ROUTER ──
export default {
  async scheduled(event,env,ctx){
    const c=event.cron;
    try{
      if(c==="*/5 * * * *")  await runLevels(env);
      else if(c==="*/15 * * * *") await runM15Scan(env);      // NEW: M15 two-stage
      else if(c==="43 5 * * *")   await runScan1H(env,"London");
      else if(c==="27 10 * * *")  await runScan1H(env,"NY-AM");
      else if(c==="47 7,15,20 * * *") await runSync(env);
    }catch(e){ await tg(env,"⚠️ Worker error: "+(e.message||e)); }
  },
  async fetch(req,env){
    const u=new URL(req.url);
    if(u.pathname==="/tv"){
      if(env.TV_SECRET&&u.searchParams.get("k")!==env.TV_SECRET)return new Response("forbidden",{status:403});
      let body=""; try{body=(await req.text())||"";}catch(e){}
      if(body.trim())await tg(env,"📺 *TradingView alert*\n"+body.trim());
      return new Response("ok");
    }
    const run=u.searchParams.get("run");
    if(run==="levels"){ await runLevels(env); return new Response("levels ran"); }
    if(run==="m15"){    await runM15Scan(env); return new Response("M15 scan ran"); }
    if(run==="scan"){   await runScan1H(env,"manual"); return new Response("1H scan ran"); }
    if(run==="sync"){   await runSync(env); return new Response("sync ran"); }
    return new Response(
      "Fed Forex V2 worker — alive.\n"+
      "?run=levels | m15 | scan | sync\n"+
      "V2 changes: wick0.55, two-stage alerts (⚡setup → ✅entry), M15 scan every 15min"
    );
  }
};
