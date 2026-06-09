// Fed Forex — 24/7 alert Worker (Cloudflare). Cron-driven. State in KV. Telegram via fetch.
// Bindings required: KV namespace "STATE"; vars/secrets: TG_TOKEN, TG_CHAT, SUPABASE_URL, SUPABASE_KEY.
// Crons (UTC): "*/5 * * * *" levels | "43 5 * * *" London scan | "27 10 * * *" NY-AM scan | "47 7,15,20 * * *" sync.
const IST = 5.5 * 3600;
const INSTR = [["GOLD","GC=F"],["NQ","NQ=F"],["ES","ES=F"],["CL","CL=F"],["EURUSD","EURUSD=X"],["GBPUSD","GBPUSD=X"]];
const SESS = { Asian:[390,615], London:[735,915], NYam:[1155,1275] };

// ---------- helpers ----------
async function yf(sym, range, interval){
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`, { headers:{ "User-Agent":"Mozilla/5.0" }, cf:{ cacheTtl: 60 } });
  const j = await r.json(); const res = j.chart?.result?.[0]; if(!res) return null;
  const q = res.indicators.quote[0]; const b=[];
  for(let i=0;i<res.timestamp.length;i++){ if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null)) continue;
    const d=new Date((res.timestamp[i]+IST)*1000);
    b.push({ t:res.timestamp[i], day:d.toISOString().slice(0,10), min:d.getUTCHours()*60+d.getUTCMinutes(), o:q.open[i], h:q.high[i], l:q.low[i], c:q.close[i] }); }
  return b;
}
function resample(B,secs){ const m=new Map(); for(const b of B){ const k=Math.floor((b.t+IST)/secs); if(!m.has(k))m.set(k,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}); else{const x=m.get(k);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;} } return [...m.values()].sort((a,b)=>a.t-b.t); }
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function dailyATR(B){ const D=resample(B,86400); let s=0,c=0; for(let i=1;i<D.length;i++){s+=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));c++;} return c?s/c:0; }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){ if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}} if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}} } for(let i=0;i<n-1;i++){ if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t}); } return z; }
function swings(h1){ const hi=[],lo=[]; for(let i=2;i<h1.length-2;i++){ if(h1[i].h>=h1[i-1].h&&h1[i].h>=h1[i-2].h&&h1[i].h>=h1[i+1].h&&h1[i].h>=h1[i+2].h)hi.push(h1[i].h); if(h1[i].l<=h1[i-1].l&&h1[i].l<=h1[i-2].l&&h1[i].l<=h1[i+1].l&&h1[i].l<=h1[i+2].l)lo.push(h1[i].l); } return {hi,lo}; }
function phaseOf(min){ for(const[n,[a,b]]of Object.entries(SESS))if(min>=a&&min<=b)return n+" session"; const mids=Object.entries(SESS).map(([n,[a,b]])=>[n,(a+b)/2]); let best=mids[0],bd=1e9; for(const[n,mid]of mids){const d=Math.min(Math.abs(min-mid),1440-Math.abs(min-mid));if(d<bd){bd=d;best=[n,mid];}} return "between sessions (~"+best[0]+")"; }
function fnum(n){ return n>50?n.toFixed(1):n.toFixed(4); }
async function tg(env,text){ if(!env.TG_TOKEN||!env.TG_CHAT) return; try{ await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:env.TG_CHAT,text,parse_mode:"Markdown",disable_web_page_preview:true})}); }catch(e){} }
const getJSON=async(env,k)=>{ const v=await env.STATE.get(k); return v?JSON.parse(v):null; };
const putJSON=(env,k,o,ttl)=>env.STATE.put(k,JSON.stringify(o),ttl?{expirationTtl:ttl}:undefined);

// HTF POI stacks (4H + Daily): tight confluence of >=2 of FVG/IFVG/OB (width<=0.75x ATR) + tight daily OB
function htfStacks(B1h,atr){ const out=[]; const uniq=s=>{ if(!out.some(o=>o.tf===s.tf&&Math.abs((o.lo+o.hi)/2-(s.lo+s.hi)/2)<0.1*atr))out.push(s); };
  for(const[tf,secs]of[["4H",14400],["Daily",86400]]){ const TS=resample(B1h,secs); if(TS.length<5)continue; const lastT=TS[TS.length-1].t;
    const zs=zones(TS).filter(z=>z.t>=lastT-20*secs);
    for(let i=0;i<zs.length;i++)for(let j=i+1;j<zs.length;j++){ const a=zs[i],b=zs[j]; if(a.type===b.type)continue; const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi); if(lo>hi)continue;
      const inv=zs.filter(z=>!(z.lo>hi||z.hi<lo)); const types=[...new Set(inv.map(z=>z.type))]; if(types.length<2)continue;
      const clo=Math.max(...inv.map(z=>z.lo)),chi=Math.min(...inv.map(z=>z.hi)); const flo=clo<=chi?clo:lo,fhi=clo<=chi?chi:hi; if((fhi-flo)>0.75*atr)continue; uniq({lo:flo,hi:fhi,types,tf}); }
    if(tf==="Daily")for(const z of zs.filter(z=>z.type==="OB"&&(z.hi-z.lo)<=0.6*atr))uniq({lo:z.lo,hi:z.hi,types:["OB"],tf:"Daily"});
  } return out; }

// ---------- LEVELS (every 5 min, guarded to 06:00-22:00 IST) ----------
async function runLevels(env){
  const istH = new Date((Date.now()/1000+IST)*1000).getUTCHours();
  if(istH<6||istH>=22) return;
  const state = (await getJSON(env,"levels_state")) || {}; const newState={}; const events=[];
  const push=(key,emoji,text)=>{ newState[key]=true; if(!state[key])events.push({emoji,text}); };
  for(const [name,sym] of INSTR){
    let B; try{ B=await yf(sym,"10d","15m"); }catch(e){ continue; } if(!B||B.length<50) continue;
    const last=B[B.length-1],price=last.c,day=last.day,nowMin=last.min;
    const td=B.filter(b=>b.day===day); const atr=dailyATR(B)||price*0.01, buf=0.15*atr;
    // NO-SPAM: session-high/low + swing approach pings removed. Only alert on HTF zone/stack approaches below.
    // HTF POI stacks — cached in KV (45 min)
    let stacks = await getJSON(env,"htf_"+name);
    if(!stacks){ try{ const B1h=await yf(sym,"60d","1h"); if(B1h&&B1h.length>50){ stacks=htfStacks(B1h, dailyATR(B1h)||atr); await putJSON(env,"htf_"+name,stacks,2700); } }catch(e){} }
    if(stacks){ const near=stacks.map(c=>{const inside=price>=c.lo&&price<=c.hi;const dist=inside?0:Math.min(Math.abs(price-c.lo),Math.abs(price-c.hi));return{c,inside,dist};}).sort((a,b)=>a.dist-b.dist).slice(0,3);
      for(const{c,inside,dist}of near){ const ev=inside?"AT":dist<=0.3*atr?"approaching":dist<=1.0*atr?"potential":null; if(!ev)continue;
        const side=((c.lo+c.hi)/2)>price?"above":"below"; const key=`${name}|HTF ${c.tf} @${((c.lo+c.hi)/2).toPrecision(6)}|${day}|${ev}`;
        push(key, ev==="AT"?"🔵":ev==="approaching"?"📍":"🎯", `${ev==="potential"?"*potential today* →":ev==="approaching"?"*approaching*":"*AT*"} \`${name}\` ${c.tf} POI stack (${c.types.join("+")}) ${side} @ ${fnum(c.lo)}–${fnum(c.hi)} — now ${fnum(price)} (~${(dist/atr).toFixed(1)} ATR)`); } }
  }
  if(events.length) await tg(env, `🎯 *Fed Forex — zone / stack alert*\n`+events.map(e=>`${e.emoji} ${e.text}`).join("\n")+`\n\n_Only fires when price nears/taps a 4H-Daily POI stack. ~15m delayed; early heads-up._`);
  await putJSON(env,"levels_state",newState);
}

// ---------- CONTINUATION SCAN (2x/day, 1h base) ----------
function trendOf(B,secs){ const TS=resample(B,secs); const c=TS.map(x=>x.c); const e=ema(c,10); return c[c.length-1]>=e[e.length-1]?"bull":"bear"; }
async function runScan(env,kzLabel){
  const armed=[];
  for(const [name,sym] of INSTR){
    let B; try{ B=await yf(sym,"60d","1h"); }catch(e){ continue; } if(!B||B.length<200) continue;
    const last=B[B.length-1],price=last.c,day=last.day;
    const d1=trendOf(B,86400),h4=trendOf(B,14400),h1=trendOf(B,3600);
    if(h4!==h1) continue; const dir=h4, poi=dir==="bull"?"sup":"res";
    const td=B.filter(b=>b.day===day); const aB=td.filter(x=>x.min>=390&&x.min<=615); if(!aB.length) continue;
    const aHi=Math.max(...aB.map(x=>x.h)),aLo=Math.min(...aB.map(x=>x.l));
    const dayHi=Math.max(...td.map(x=>x.h)),dayLo=Math.min(...td.map(x=>x.l));
    const swept = dir==="bull"?(dayLo<=aLo):(dayHi>=aHi);
    const D=resample(B,86400).slice(-5); if(D.length<2) continue; const drHi=Math.max(...D.map(x=>x.h)),drLo=Math.min(...D.map(x=>x.l)),eq=(drHi+drLo)/2;
    const pd = dir==="bull"?price<eq:price>eq;
    let stack=0; for(const secs of [86400,14400,7200,3600]){ const zs=zones(resample(B,secs)).filter(z=>z.dir===poi&&z.t<last.t&&price>=z.lo-0.25*(z.hi-z.lo)&&price<=z.hi+0.25*(z.hi-z.lo)); if(zs.length)stack++; }
    if(swept && pd && stack>=2) armed.push({name,dir:dir==="bull"?"LONG":"SHORT",price,tier:(d1===dir)?"A+":"A"});
  }
  if(armed.length) await tg(env, `🔴 *Fed Forex — continuation setups* (${kzLabel} KZ ~1h)\n`+armed.map(a=>`• \`${a.name}\` ${a.dir} @ ${fnum(a.price)} [${a.tier}]`).join("\n")+`\n\n_Your method, modest measured edge (~+0.16R/tr). Confirm the rejection wick at the zone before entry._`);
}

// ---------- SUPABASE SYNC (3x/day, READ-ONLY) ----------
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const u=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(u<=0||u>100)return null;const rem=100-u;const pr=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let rR=0;if(t.remainderOutcome==="TP")rR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="SL")rR=-1;else if(t.remainderOutcome==="manual")rR=parseFloat(t.remainderR||0);return +(pr+rem/100*rR).toFixed(2);}
function Rof(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
async function runSync(env){
  const H={apikey:env.SUPABASE_KEY,Authorization:"Bearer "+env.SUPABASE_KEY};
  let idRows; try{ idRows=await (await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id&order=id",{method:"GET",headers:H})).json(); }catch(e){ return; }
  const liveIds=idRows.map(r=>r.id); const state=(await getJSON(env,"sync_state"))||{ids:[]}; const known=new Set(state.ids||[]);
  const newIds=liveIds.filter(id=>!known.has(id));
  if(!newIds.length && state.count===liveIds.length) return;
  const rows=await (await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id,data&order=id",{method:"GET",headers:H})).json();
  const T=rows.map(r=>r.data); if(!T.length) return;
  const w=T.filter(t=>t.outcome==="Win").length,l=T.filter(t=>t.outcome==="Loss").length,wr=(w+l)?Math.round(w/(w+l)*100):0;
  const exp=+(T.reduce((a,t)=>a+Rof(t),0)/T.length).toFixed(2);
  const newT=rows.filter(r=>!known.has(r.id)).map(r=>r.data);
  if(newT.length){ const nl=newT.slice(0,8).map(t=>`• ${t.pair} ${t.direction} ${t.outcome} (${Rof(t)>=0?"+":""}${Rof(t)}R)`).join("\n");
    await tg(env, `🔄 *Fed Forex — ${newT.length} new trade${newT.length>1?"s":""} synced*\n${nl}${newT.length>8?`\n…+${newT.length-8} more`:""}\n\n*Edge now:* ${T.length} trades · ${wr}% WR · ${exp}R/trade`); }
  await putJSON(env,"sync_state",{ids:liveIds,count:liveIds.length});
}

export default {
  async scheduled(event, env, ctx){
    const c = event.cron;
    try{
      if(c==="*/5 * * * *") await runLevels(env);
      else if(c==="43 5 * * *") await runScan(env,"London");
      else if(c==="27 10 * * *") await runScan(env,"NY-AM");
      else if(c==="47 7,15,20 * * *") await runSync(env);
    }catch(e){ await tg(env, "⚠️ Fed Forex worker error: "+(e.message||e)); }
  },
  // optional manual trigger for testing: visit https://<worker-url>/?run=levels|scan|sync
  async fetch(req, env){
    const u=new URL(req.url);
    // TradingView webhook receiver — real-time alerts from your live feed (POST to /tv?k=SECRET)
    if(u.pathname==="/tv"){
      if(env.TV_SECRET && u.searchParams.get("k")!==env.TV_SECRET) return new Response("forbidden",{status:403});
      let body=""; try{ body=(await req.text())||""; }catch(e){}
      if(body.trim()) await tg(env, "📺 *TradingView alert*\n"+body.trim());
      return new Response("ok");
    }
    const run=u.searchParams.get("run");
    if(run==="levels"){ await runLevels(env); return new Response("levels ran"); }
    if(run==="scan"){ await runScan(env,"manual"); return new Response("scan ran"); }
    if(run==="sync"){ await runSync(env); return new Response("sync ran"); }
    return new Response("Fed Forex alert worker is alive. Use ?run=levels|scan|sync to test.");
  }
};
