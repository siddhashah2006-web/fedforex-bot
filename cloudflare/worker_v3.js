// Fed Forex — V3 Alert Worker (Cloudflare) — 2026-06-09
// ═══════════════════════════════════════════════════════
// V3 changes vs V2:
//   • PRIMARY timeframe upgraded M15 → 30-MIN (+10% WR proven: 76.6% vs 66.2%)
//   • Weekly-bias filter added to 30m scan (price below/above weekly open)
//   • Portfolio optimised: EURJPY + EURUSD removed from 30m scan (consistent underperformers)
//   • Cron upgraded */15 → */30 to match 30-min bar closes
//   • Stage-1/Stage-2 timing: 30-min gap (was 15-min for M15)
//   • 1H scan unchanged (still V2 with weekly-bias gate)
//   • All V2 helpers reused (zones, trendOf, zoneStackCount, entryMsg, etc.)
//
// Backtest evidence (backtest20.js, 8 instruments):
//   C18  30m base:          76.6% WR  n=205  +0.661R/trade  ✓BOTH halves
//   C20  30m+weekly:        77.4% WR  n=146  +0.689R/trade  ✓BOTH halves
//   Per-instrument (C18): AUDUSD 83.3% | GBPJPY 83.8% | GBPUSD 81.3% | ETHUSD 80.8%
//                          USDJPY 78.6% | BTCUSD 76.9% | EURJPY 58.8%* | EURUSD 50%*
//   * EURJPY and EURUSD EXCLUDED from 30m alerts — consistent underperformers
//
// Bindings: KV "STATE" | Secrets: TG_TOKEN TG_CHAT SUPABASE_URL SUPABASE_KEY TV_SECRET
// Crons (to set in Cloudflare dashboard — UTC times):
//   "*/5  * * * *"          — HTF zone/stack level alerts
//   "*/30 * * * *"          — 30m two-stage scan (NEW — was */15 for M15)
//   "43 5 * * *"            — London 1H scan
//   "27 10 * * *"           — NY-AM 1H scan
//   "47 7,15,20 * * *"      — Supabase replay-journal sync

'use strict';

const IST          = 5.5 * 3600;
const WICK         = 0.55;           // wick ratio threshold (proven +2.4% WR vs 0.50)
const WEEKLY_BIAS  = true;           // require price below/above weekly open (C20 proven)
const DOW_FILTER   = false;          // set true to only alert Tue-Thu (marginal gain; off by default)

// ── 30m instrument list — EURJPY and EURUSD excluded (backtest: 58.8% and 50% WR) ──
const INSTR_30M = [
  ["AUDUSD", "AUDUSD=X"],
  ["BTCUSD", "BTC-USD"],
  ["ETHUSD", "ETH-USD"],
  ["GBPJPY", "GBPJPY=X"],
  ["GBPUSD", "GBPUSD=X"],
  ["USDJPY", "JPY=X"],
];

// ── Full instrument list for 1H scan ──
const INSTR = [
  ["GOLD","GC=F"],["NQ","NQ=F"],["ES","ES=F"],["CL","CL=F"],
  ["EURUSD","EURUSD=X"],["GBPUSD","GBPUSD=X"],["USDJPY","JPY=X"],
  ["AUDUSD","AUDUSD=X"],["GBPJPY","GBPJPY=X"],["EURJPY","EURJPY=X"],
];

// ── Silver Bullet 2-stage — 4 pairs with proven edge (backtest v2: 67-83% WR) ──
const INSTR_SB2 = [
  ["GBPJPY","GBPJPY=X"],  // 83% WR n=6
  ["EURUSD","EURUSD=X"],  // 75% WR n=20
  ["ETHUSD","ETH-USD"],   // 71% WR n=7
  ["EURJPY","EURJPY=X"],  // 67% WR n=6
];

// ── ODR (Asia range sweep) — 3 pairs with proven edge (backtest v2: 69-89% WR) ──
const INSTR_ODR = [
  ["ETHUSD","ETH-USD"],   // 89% WR n=9
  ["EURUSD","EURUSD=X"],  // 80% WR n=5
  ["GBPUSD","GBPUSD=X"],  // 69% WR n=13
];

// ── FOMC/NFP blackout (Seg 12) ──
// Scans are silently suppressed 60 min before and 90 min after each event.
// /forcescan via Telegram notifies the user if blacked out (safe — no false alerts near news).
// To update annually: add/remove entries from BLACKOUT_EVENTS below.
//
// NFP = first Friday of the month @ 08:30 ET:
//   EST months (Jan/Feb/Mar/Nov/Dec): 08:30 EST = 13:30 UTC
//   EDT months (Apr–Oct):             08:30 EDT = 12:30 UTC
// FOMC rate decision @ 14:00 ET:
//   EST: 14:00 EST = 19:00 UTC  |  EDT: 14:00 EDT = 18:00 UTC
const BLACKOUT_BEFORE = 60 * 60;   // 60 min before event
const BLACKOUT_AFTER  = 90 * 60;   // 90 min after  event
const BLACKOUT_EVENTS = [
  // ── NFP 2026 ──────────────────────────────────────────────────────
  '2026-01-09T13:30:00Z','2026-02-06T13:30:00Z','2026-03-06T13:30:00Z',
  '2026-04-03T12:30:00Z','2026-05-01T12:30:00Z','2026-06-05T12:30:00Z',
  '2026-07-03T12:30:00Z','2026-08-07T12:30:00Z','2026-09-04T12:30:00Z',
  '2026-10-02T12:30:00Z','2026-11-06T13:30:00Z','2026-12-04T13:30:00Z',
  // ── FOMC 2026 ─────────────────────────────────────────────────────
  '2026-01-28T19:00:00Z','2026-03-18T18:00:00Z','2026-04-29T18:00:00Z',
  '2026-06-17T18:00:00Z','2026-07-29T18:00:00Z','2026-09-16T18:00:00Z',
  '2026-10-28T18:00:00Z','2026-12-09T19:00:00Z',
].map(s=>Math.floor(new Date(s).getTime()/1000)).sort((a,b)=>a-b);

// Returns a human-readable reason if now is in a blackout window, else null.
function blackoutInfo(now){
  for(const t of BLACKOUT_EVENTS){
    if(now>=t-BLACKOUT_BEFORE&&now<=t+BLACKOUT_AFTER){
      const mins=Math.round((t-now)/60);
      return mins>0 ? `high-impact event in ${mins}min` : `high-impact event ${-mins}min ago`;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// ── SHARED HELPERS (identical to V2) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
async function yf(sym,range,interval){
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
    {headers:{"User-Agent":"Mozilla/5.0"},cf:{cacheTtl:60}});
  const j=await r.json(); const res=j.chart?.result?.[0]; if(!res)return null;
  const q=res.indicators.quote[0]; const b=[];
  for(let i=0;i<res.timestamp.length;i++){
    if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null))continue;
    const d=new Date((res.timestamp[i]+IST)*1000);
    b.push({t:res.timestamp[i],day:d.toISOString().slice(0,10),
      min:d.getUTCHours()*60+d.getUTCMinutes(),dow:d.getUTCDay(),
      o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});
  }
  return b;
}
function resample(B,secs){
  const m=new Map();
  for(const b of B){
    const k=Math.floor((b.t+IST)/secs);
    if(!m.has(k))m.set(k,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c});
    else{const x=m.get(k);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}
  }
  return [...m.values()].sort((a,b)=>a.t-b.t);
}
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function dailyATR(B){ const D=resample(B,86400); let s=0,c=0; for(let i=1;i<D.length;i++){s+=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));c++;} return c?s/c:0; }
function atrOf(B){ let s=0,c=0; for(let i=1;i<B.length;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
function zones(TS){
  const z=[],n=TS.length;
  for(let i=2;i<n;i++){
    if(TS[i].l>TS[i-2].h){const lo=TS[i-2].h,hi=TS[i].l;z.push({type:"FVG",dir:"sup",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c<lo){z.push({type:"IFVG",dir:"res",lo,hi,t:TS[j].t});break;}}}
    if(TS[i].h<TS[i-2].l){const lo=TS[i].h,hi=TS[i-2].l;z.push({type:"FVG",dir:"res",lo,hi,t:TS[i].t});for(let j=i+1;j<Math.min(i+40,n);j++){if(TS[j].c>hi){z.push({type:"IFVG",dir:"sup",lo,hi,t:TS[j].t});break;}}}
  }
  for(let i=0;i<n-1;i++){
    if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});
    if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h,t:TS[i+1].t});
  }
  return z;
}
function trendOf(B,secs){ const TS=resample(B,secs); const c=TS.map(x=>x.c); const e=ema(c,10); return c[c.length-1]>=e[e.length-1]?"bull":"bear"; }
function fnum(n){ return n>50?n.toFixed(2):n.toFixed(5); }
async function tg(env,text){
  if(!env.TG_TOKEN||!env.TG_CHAT)return;
  try{
    await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:env.TG_CHAT,text,parse_mode:"Markdown",disable_web_page_preview:true})
    });
  }catch(e){}
}
const getJSON=async(env,k)=>{ const v=await env.STATE.get(k); return v?JSON.parse(v):null; };
const putJSON=(env,k,o,ttl)=>env.STATE.put(k,JSON.stringify(o),ttl?{expirationTtl:ttl}:undefined);

// ── Live alert logging → Supabase live_alerts table (Seg 11) ──
// SQL to create table (run once in Supabase SQL editor):
//   create table live_alerts (
//     id         bigint generated always as identity primary key,
//     created_at timestamptz default now(),
//     pair       text not null, direction text not null, timeframe text not null,
//     entry      float8, sl float8, t1 float8, t2 float8, t3 float8,
//     kz         text, note text, alert_ts bigint
//   );
//   alter table live_alerts enable row level security;
//   create policy "anon_select" on live_alerts for select using (true);
async function logAlert(env,{pair,direction,timeframe,entry,sl,kz,note}){
  if(!env.SUPABASE_URL||!env.SUPABASE_KEY)return;
  const risk=Math.abs(entry-sl);
  const t1=direction==='long'?entry+risk:entry-risk;
  const t2=direction==='long'?entry+1.7*risk:entry-1.7*risk;
  const t3=direction==='long'?entry+2.56*risk:entry-2.56*risk;
  try{
    await fetch(env.SUPABASE_URL+'/rest/v1/live_alerts',{
      method:'POST',
      headers:{apikey:env.SUPABASE_KEY,Authorization:'Bearer '+env.SUPABASE_KEY,
               'Content-Type':'application/json',Prefer:'return=minimal'},
      body:JSON.stringify({pair,direction,timeframe,entry,sl,t1,t2,t3,
                           kz:kz||null,note:note||null,alert_ts:Math.floor(Date.now()/1000)})
    });
  }catch(e){} // non-blocking — alert is already sent even if logging fails
}

// Zone stack count (same logic as backtest)
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

// HTF POI stacks for zone-approach alerts (V2 unchanged)
function htfStacks(B1h,atr){
  const out=[];
  const uniq=s=>{ if(!out.some(o=>o.tf===s.tf&&Math.abs((o.lo+o.hi)/2-(s.lo+s.hi)/2)<0.1*atr))out.push(s); };
  for(const[tf,secs]of[["4H",14400],["Daily",86400]]){
    const TS=resample(B1h,secs); if(TS.length<5)continue;
    const lastT=TS[TS.length-1].t;
    const zs=zones(TS).filter(z=>z.t>=lastT-20*secs);
    for(let i=0;i<zs.length;i++)for(let j=i+1;j<zs.length;j++){
      const a=zs[i],b=zs[j]; if(a.type===b.type)continue;
      const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi); if(lo>hi)continue;
      const inv=zs.filter(z=>!(z.lo>hi||z.hi<lo));
      const types=[...new Set(inv.map(z=>z.type))]; if(types.length<2)continue;
      const clo=Math.max(...inv.map(z=>z.lo)),chi=Math.min(...inv.map(z=>z.hi));
      const flo=clo<=chi?clo:lo,fhi=clo<=chi?chi:hi;
      if((fhi-flo)>0.75*atr)continue;
      uniq({lo:flo,hi:fhi,types,tf});
    }
    if(tf==="Daily")for(const z of zs.filter(z=>z.type==="OB"&&(z.hi-z.lo)<=0.6*atr))uniq({lo:z.lo,hi:z.hi,types:["OB"],tf:"Daily"});
  }
  return out;
}

// ── Entry alert message with T1/T2/T3 levels ──
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

// ═══════════════════════════════════════════════════════════════════════
// ── HTF ZONE-ENTRY ALERTS (every 5 min) ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
// Fires ONLY when price physically enters a 4H or Daily OB / FVG / IFVG.
// De-dup: once a zone fires, it is suppressed until price LEAVES and re-enters.
//   → EURUSD enters Daily OB → alert fires.
//   → EURUSD stays inside → silence.
//   → EURUSD exits → key cleared.
//   → EURUSD re-enters → fires again.
async function runLevels(env){
  const istH=new Date((Date.now()/1000+IST)*1000).getUTCHours();
  if(istH<6||istH>=22)return;

  // "levels_inside" tracks which zone keys price is currently inside.
  // When price exits a zone the key is absent → re-entry fires fresh.
  const prevInside=(await getJSON(env,"levels_inside"))||{};
  const currInside={};
  const events=[];

  for(const [name,sym] of INSTR){
    // Fresh price from 15m (lightweight)
    let Bm; try{Bm=await yf(sym,"2d","15m");}catch(e){continue;}
    if(!Bm||!Bm.length)continue;
    const price=Bm[Bm.length-1].c;

    // Zones: computed from 1H data, cached 45 min to avoid repeated heavy fetches
    let cached=await getJSON(env,"htfz_"+name);
    if(!cached){
      try{
        const B1h=await yf(sym,"60d","1h");
        if(B1h&&B1h.length>50){
          const atr=dailyATR(B1h)||price*0.01;
          const pairZ={};
          for(const[tf,secs]of[["4H",14400],["Daily",86400]]){
            const TS=resample(B1h,secs);
            if(TS.length<5)continue;
            const cutoff=TS[TS.length-1].t-30*secs; // last 30 candles of this TF
            pairZ[tf]=zones(TS).filter(z=>z.t>=cutoff);
          }
          cached={zones:pairZ,atr};
          await putJSON(env,"htfz_"+name,cached,2700); // 45 min
        }
      }catch(e){}
    }
    if(!cached)continue;

    // Check every individual OB / FVG / IFVG on 4H and Daily
    for(const [tf,zs] of Object.entries(cached.zones||{})){
      for(const z of zs){
        const inside=price>=z.lo&&price<=z.hi;
        // Stable zone ID: TF + type + direction + midpoint
        const mid=((z.lo+z.hi)/2).toPrecision(6);
        const zKey=`${name}|${tf}|${z.type}|${z.dir}|${mid}`;

        if(inside){
          currInside[zKey]=true; // mark currently inside
          if(!prevInside[zKey]){
            // Price just entered — fire once
            const bias=z.dir==='sup'?'Bullish ↗️':'Bearish ↘️';
            const emoji=z.type==='OB'?'🟦':z.type==='IFVG'?'🟣':'🟧';
            events.push(
              `${emoji} *${name}* entered ${tf} ${z.type} (${bias})\n`+
              `   \`${fnum(z.lo)}\` – \`${fnum(z.hi)}\` | Price: \`${fnum(price)}\``
            );
          }
          // Already inside → suppress (no repeated alert)
        }
        // If outside: NOT added to currInside → key clears → next entry fires fresh
      }
    }
  }

  if(events.length){
    const shown=events.slice(0,6);
    const more=events.length>6?`\n\n_+${events.length-6} more zones_`:'';
    await tg(env,
      `🎯 *Fed Forex — HTF zone entry*\n\n`+
      shown.join("\n\n")+more+
      `\n\n_Price entered a key zone — watch for kill zone setup._`
    );
  }

  // Persist "currently inside" (12h TTL — auto-clears overnight)
  await putJSON(env,"levels_inside",currInside,43200);
}

// ═══════════════════════════════════════════════════════════════════════
// ── SILVER BULLET 2-STAGE (every 5 min, 3 windows) ──────────────────────
// Proven pairs only: GBPJPY 83% | EURUSD 75% | ETHUSD 71% | EURJPY 67%
// Stage 1: FVG (≥0.15×ATR) forms in window + price touches it → alert + save
// Stage 2: next 15m bar shows displacement → entry fires
// ═══════════════════════════════════════════════════════════════════════
async function runSilverBullet(env){
  const now=Math.floor(Date.now()/1000);
  const pu=await env.STATE.get('pause_until'); if(pu&&now<Number(pu))return;
  if(blackoutInfo(now))return;
  const ist=new Date((now+IST)*1000);
  const istMin=ist.getUTCHours()*60+ist.getUTCMinutes();
  const inWin=m=>(m>=450&&m<=570)||(m>=930&&m<=990)||(m>=1170&&m<=1230);
  const winLabel=m=>m>=450&&m<=570?'London W1':m>=930&&m<=990?'NY-AM W2':'NY-PM W3';
  const inSBNow=inWin(istMin);

  for(const [name,sym] of INSTR_SB2){
    const pendKey=`sb2_${name}`;
    let B15m; try{B15m=await yf(sym,"3d","15m");}catch(e){continue;}
    if(!B15m||B15m.length<12)continue;
    let B1h; try{B1h=await yf(sym,"60d","1h");}catch(e){continue;}
    if(!B1h||B1h.length<50)continue;

    const atr=atrOf(B15m.slice(-20))||B15m[B15m.length-1].c*0.001;
    const h4=trendOf(B1h,14400), h1=trendOf(B1h,3600);
    if(h4!==h1)continue;

    const prev=B15m[B15m.length-2]; // last fully closed 15m bar
    const pend=await getJSON(env,pendKey);

    // ── Stage-2: displacement on bar AFTER the touch ──
    if(pend&&prev.t>pend.touchT&&prev.t!==pend.lastChecked){
      const bR=(prev.h-prev.l)||1;
      const dispOK=pend.dir==='long'
        ?((prev.c-prev.l)/bR>=0.55&&Math.abs(prev.c-prev.o)>=0.25*atr)
        :((prev.h-prev.c)/bR>=0.55&&Math.abs(prev.c-prev.o)>=0.25*atr);
      if(dispOK){
        const note=`SB ${pend.win} | FVG ${fnum(pend.fvgLo)}–${fnum(pend.fvgHi)}`;
        await tg(env,entryMsg(name,pend.dir,'15m',prev.c,pend.sl,pend.win,note));
        await logAlert(env,{pair:name,direction:pend.dir,timeframe:'15m',entry:prev.c,sl:pend.sl,kz:pend.win,note:'SilverBullet2'});
        await env.STATE.delete(pendKey);
        continue;
      }
      // Invalidate if price closed beyond the FVG zone
      const broken=pend.dir==='long'?prev.c<pend.fvgLo:prev.c>pend.fvgHi;
      if(broken){ await env.STATE.delete(pendKey); }
      else{ pend.lastChecked=prev.t; await putJSON(env,pendKey,pend,1800); }
    }

    if(pend)continue;          // already watching
    if(!inSBNow)continue;      // not in a window right now

    // ── Stage-1: scan last 12 15m bars for FVG → price touching it ──
    const lastBar=B15m[B15m.length-1]; // live/forming bar (use for price check)
    const n=B15m.length;
    for(let i=Math.max(2,n-13);i<n-1;i++){
      const bar=B15m[i];
      if(!inWin(bar.min))continue; // FVG must have formed inside a window
      const p2=B15m[i-2];
      const gUp=bar.l-p2.h;  // bullish FVG gap size
      const gDn=p2.l-bar.h;  // bearish FVG gap size

      // Bullish FVG
      if(gUp>atr*0.15&&h4==='bull'){
        const fvgLo=p2.h, fvgHi=bar.l;
        if(lastBar.l<=fvgHi&&lastBar.c>=fvgLo){
          const sl=fvgLo-(fvgHi-fvgLo)*0.5;
          const next15=new Date((lastBar.t+900+IST)*1000);
          const nextStr=`${String(next15.getUTCHours()).padStart(2,'0')}:${String(next15.getUTCMinutes()).padStart(2,'0')} IST`;
          await tg(env,
            `🟣 *SB SETUP FORMING — ${name} LONG* (15m)\n`+
            `Silver Bullet ${winLabel(istMin)}\n`+
            `FVG zone: \`${fnum(fvgLo)}\` – \`${fnum(fvgHi)}\` | Price: \`${fnum(lastBar.c)}\`\n`+
            `H4+H1: ${h4.toUpperCase()} | SL: \`${fnum(sl)}\`\n`+
            `_Displacement closes ~${nextStr} → ENTRY_`
          );
          await putJSON(env,pendKey,{dir:'long',sl,fvgLo,fvgHi,touchT:lastBar.t,win:winLabel(istMin),lastChecked:0},1800);
          break;
        }
      }
      // Bearish FVG
      if(gDn>atr*0.15&&h4==='bear'){
        const fvgLo=bar.h, fvgHi=p2.l;
        if(lastBar.h>=fvgLo&&lastBar.c<=fvgHi){
          const sl=fvgHi+(fvgHi-fvgLo)*0.5;
          const next15=new Date((lastBar.t+900+IST)*1000);
          const nextStr=`${String(next15.getUTCHours()).padStart(2,'0')}:${String(next15.getUTCMinutes()).padStart(2,'0')} IST`;
          await tg(env,
            `🟣 *SB SETUP FORMING — ${name} SHORT* (15m)\n`+
            `Silver Bullet ${winLabel(istMin)}\n`+
            `FVG zone: \`${fnum(fvgLo)}\` – \`${fnum(fvgHi)}\` | Price: \`${fnum(lastBar.c)}\`\n`+
            `H4+H1: ${h4.toUpperCase()} | SL: \`${fnum(sl)}\`\n`+
            `_Displacement closes ~${nextStr} → ENTRY_`
          );
          await putJSON(env,pendKey,{dir:'short',sl,fvgLo,fvgHi,touchT:lastBar.t,win:winLabel(istMin),lastChecked:0},1800);
          break;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── ODR — ASIA RANGE SWEEP (every 5 min during London KZ) ───────────────
// Proven pairs only: ETHUSD 89% | EURUSD 80% | GBPUSD 69%
// Lock Asia range (00:30–05:30 IST) then fire when London sweeps it with
// wick ≥ 0.45, H4 aligned, Asia range tight (< 0.8×daily ATR)
// ═══════════════════════════════════════════════════════════════════════
async function runODR(env){
  const now=Math.floor(Date.now()/1000);
  const pu=await env.STATE.get('pause_until'); if(pu&&now<Number(pu))return;
  if(blackoutInfo(now))return;
  const ist=new Date((now+IST)*1000);
  const istMin=ist.getUTCHours()*60+ist.getUTCMinutes();
  const istH=ist.getUTCHours();
  // Only run during London session: 06:00–10:30 IST
  if(istH<6||istH>=11)return;

  for(const [name,sym] of INSTR_ODR){
    const odrKey=`odr_${name}`;
    // Prevent double-firing on same day
    const fired=await env.STATE.get(odrKey);
    if(fired===ist.toISOString().slice(0,10))continue;

    let B15m; try{B15m=await yf(sym,"3d","15m");}catch(e){continue;}
    if(!B15m||B15m.length<20)continue;
    let B1h; try{B1h=await yf(sym,"60d","1h");}catch(e){continue;}
    if(!B1h||B1h.length<50)continue;

    const h4=trendOf(B1h,14400);
    const dAtr=dailyATR(B1h)||B15m[B15m.length-1].c*0.01;

    // Get today's date string (IST)
    const todayIST=ist.toISOString().slice(0,10);

    // Asia bars: 00:30–05:30 IST (min 30–330)
    const asiaBars=B15m.filter(b=>b.day===todayIST&&b.min>=30&&b.min<=330);
    if(asiaBars.length<4)continue;
    const asiaHi=Math.max(...asiaBars.map(b=>b.h));
    const asiaLo=Math.min(...asiaBars.map(b=>b.l));
    const asiaRange=asiaHi-asiaLo;
    if(asiaRange<=0)continue;
    // Filter: Asia range must be tight (consolidation, not already trending)
    if(asiaRange>dAtr*0.8)continue;

    // London bars: 06:00–10:30 IST (min 360–630)
    const lonBars=B15m.filter(b=>b.day===todayIST&&b.min>=360&&b.min<=630);
    if(!lonBars.length)continue;

    // Check each London bar for Asia sweep
    for(const b of lonBars){
      const range=(b.h-b.l)||1;
      if(b.l<asiaLo&&b.c>asiaLo&&h4==='bull'){
        const wp=(Math.min(b.o,b.c)-b.l)/range;
        if(wp>=0.45){
          const note=`ODR — swept Asia low ${fnum(asiaLo)} | Asia range ${fnum(asiaRange)}`;
          await tg(env,entryMsg(name,'long','15m',b.c,b.l,'London ODR',note));
          await logAlert(env,{pair:name,direction:'long',timeframe:'15m',entry:b.c,sl:b.l,kz:'London ODR',note:'ODR'});
          await env.STATE.put(odrKey,todayIST,{expirationTtl:86400});
          break;
        }
      }
      if(b.h>asiaHi&&b.c<asiaHi&&h4==='bear'){
        const wp=(b.h-Math.max(b.o,b.c))/range;
        if(wp>=0.45){
          const note=`ODR — swept Asia high ${fnum(asiaHi)} | Asia range ${fnum(asiaRange)}`;
          await tg(env,entryMsg(name,'short','15m',b.c,b.h,'London ODR',note));
          await logAlert(env,{pair:name,direction:'short',timeframe:'15m',entry:b.c,sl:b.h,kz:'London ODR',note:'ODR'});
          await env.STATE.put(odrKey,todayIST,{expirationTtl:86400});
          break;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── 30-MIN TWO-STAGE SCAN (every 30 min during KZ hours) — V3 NEW ──────
// ═══════════════════════════════════════════════════════════════════════
// Backtest-proven: 76.6% WR base, 77.4% WR with weekly bias
// LOOK=4 bars (2-hour swing structure) vs LOOK=6 for M15 (1.5h)
// KZ adjusted for 30-min slot boundaries: London 720-930, NY-AM 1020-1260 IST
async function run30mScan(env, force=false){
  const now=Math.floor(Date.now()/1000);
  const ist=new Date((now+IST)*1000);
  const istMin=ist.getUTCHours()*60+ist.getUTCMinutes();

  // Guard: only run during London (720–930) or NY-AM (1010–1280) with buffer
  const inLondon=istMin>=710&&istMin<=940;
  const inNYAM  =istMin>=1010&&istMin<=1285;
  if(!force&&(!inLondon&&!inNYAM)) return;
  // Pause check — force=true (from /forcescan command) bypasses pause + time guard
  if(!force){ const pu=await env.STATE.get('pause_until'); if(pu&&now<Number(pu))return; }
  // Blackout check — FOMC/NFP: always respected, even for force scans (safety-first)
  if(blackoutInfo(now)) return;
  const kzLabel=inLondon?"London":"NY-AM";
  const kzKey=inLondon?'london':'ny-am'; // normalised for learned_config lookup

  // KZ functions for the 30m bar's min value
  const london30 = m => m>=720  && m<930;
  const nyam30   = m => m>=1020 && m<1260;
  const inKZ     = m => london30(m) || nyam30(m);

  // Load learned_config ONCE — applied per-instrument inside the loop
  const learnedCfg=await getJSON(env,'learned_config')||{};

  for(const [name,sym] of INSTR_30M){
    // ── Fetch data ──
    let Bm30; try{Bm30=await yf(sym,"5d","30m");}catch(e){continue;}
    if(!Bm30||Bm30.length<12) continue;

    let B1h; try{B1h=await yf(sym,"60d","1h");}catch(e){continue;}
    if(!B1h||B1h.length<50) continue;

    const A1h  = dailyATR(B1h) || Bm30[Bm30.length-1].c * 0.005;
    const A30m = atrOf(Bm30.slice(-20)) || A1h * 0.5;

    // Skip Mon/Fri if DOW filter active
    if(DOW_FILTER){ const dow=Bm30[Bm30.length-1].dow; if(dow===1||dow===5)continue; }

    // ── Weekly open bias ──
    // Use second-to-last weekly bar = last COMPLETED week (same as backtest Wc[-1])
    let weekOpen = null;
    if(WEEKLY_BIAS){
      const Wbars = resample(B1h, 604800); // weekly bars from 1H data
      if(Wbars.length >= 2) weekOpen = Wbars[Wbars.length-2].o;
      else if(Wbars.length === 1) weekOpen = Wbars[0].o;
    }

    // ── Stage-2: did pending 30m setup get displacement on the just-closed bar? ──
    const pendKey = `s2m30_${name}`;
    const pend    = await getJSON(env, pendKey);
    if(pend){
      // lastClosed = the bar that just fully closed (second-to-last in array)
      const lastClosed = Bm30[Bm30.length-2];
      if(lastClosed && lastClosed.t > pend.sweepT && lastClosed.t !== pend.lastChecked){
        const bR = (lastClosed.h-lastClosed.l) || 1;
        const dispOK = pend.dir==='long'
          ? ((lastClosed.c-lastClosed.l)/bR >= 0.55 && Math.abs(lastClosed.c-lastClosed.o) >= 0.3*A30m)
          : ((lastClosed.h-lastClosed.c)/bR >= 0.55 && Math.abs(lastClosed.c-lastClosed.o) >= 0.3*A30m);
        if(dispOK){
          const weekNote = weekOpen ? `weekly open ${fnum(weekOpen)}` : '';
          const note30=`wick ${(pend.wickPct*100).toFixed(0)}%${weekNote?' | '+weekNote:''}`;
          await tg(env, entryMsg(name, pend.dir, '30m', lastClosed.c, pend.sl, kzLabel, note30));
          await logAlert(env,{pair:name,direction:pend.dir,timeframe:'30m',entry:lastClosed.c,sl:pend.sl,kz:kzLabel,note:note30});
          await env.STATE.delete(pendKey);
        } else {
          pend.lastChecked = lastClosed.t;
          await putJSON(env, pendKey, pend, 1800); // refresh TTL
        }
      }
    }

    // ── Stage-1: check if the just-closed 30m bar is a valid sweep ──
    const barsLen = Bm30.length;
    if(barsLen < 10) continue;
    const sweepBar = Bm30[barsLen-2]; // fully closed bar

    // Must be in a kill zone
    if(!inKZ(sweepBar.min)) continue;

    // Skip if we already have a pending setup from this sweep
    if(pend && Math.abs(pend.sweepT - sweepBar.t) < 1800) continue;

    // ── Swing structure: last LOOK=4 bars before the sweep bar ──
    const LOOK = 4;
    const recent = Bm30.slice(Math.max(0, barsLen-2-LOOK), barsLen-2);
    if(recent.length < 3) continue;
    const rl = Math.min(...recent.map(b=>b.l));
    const rh = Math.max(...recent.map(b=>b.h));

    // ── 5-day dealing range from 1H data ──
    const dr5 = resample(B1h, 86400).slice(-5);
    if(dr5.length < 2) continue;
    const drHi=Math.max(...dr5.map(x=>x.h)), drLo=Math.min(...dr5.map(x=>x.l)), eq=(drHi+drLo)/2;

    // ── HTF trend: H4+H1 must agree ──
    const h4=trendOf(B1h,14400), h1=trendOf(B1h,3600);
    if(h4 !== h1) continue;

    // D1 alignment — silently enforced when replay data proves it adds edge (+9% WR)
    // learnedCfg._global.d1Required is set by deriveConfig when pattern reaches threshold
    const d1=trendOf(B1h,86400);
    if(learnedCfg._global?.d1Required && d1!==h4) continue;

    // Minimum zone stack — raised from 1→2 by deriveConfig when data supports it
    const minStk=learnedCfg._global?.minZoneStack||1;

    const price = sweepBar.c;
    const range = (sweepBar.h-sweepBar.l) || 1;
    let dir=null, sl, wickPct;

    // ── Bull sweep → long ──
    if(sweepBar.l < rl && sweepBar.c > rl && sweepBar.c < eq){
      wickPct = (Math.min(sweepBar.o,sweepBar.c)-sweepBar.l) / range;
      if(wickPct >= WICK && h4==='bull'){
        // Weekly bias: price must be BELOW weekly open for longs (discount)
        if(weekOpen && sweepBar.c >= weekOpen) continue;
        const stk = zoneStackCount(B1h, price, sweepBar.t);
        if(stk >= minStk){ dir='long'; sl=sweepBar.l; }
      }
    }
    // ── Bear sweep → short ──
    else if(sweepBar.h > rh && sweepBar.c < rh && sweepBar.c > eq){
      wickPct = (sweepBar.h-Math.max(sweepBar.o,sweepBar.c)) / range;
      if(wickPct >= WICK && h4==='bear'){
        // Weekly bias: price must be ABOVE weekly open for shorts (premium)
        if(weekOpen && sweepBar.c <= weekOpen) continue;
        const stk = zoneStackCount(B1h, price, sweepBar.t);
        if(stk >= minStk){ dir='short'; sl=sweepBar.h; }
      }
    }
    if(!dir) continue;

    // ── Adapt-and-grow gate ──
    // applyRule() checks learned rules from replay journal:
    //   • direction skip (e.g. "your shorts on GBPUSD: 31% WR — blocked")
    //   • kill zone skip (e.g. "NY-AM weak for USDJPY — blocked")
    //   • day-of-week skip (e.g. "Mon weak for BTCUSD — blocked")
    //   • overall pair edge too low (≥10 trades, WR < 40%)
    const sweepDow=sweepBar.dow??new Date(sweepBar.t*1000).getDay();
    const ar=applyRule(learnedCfg, name, dir, kzKey, sweepDow);
    if(ar.skip) continue; // hard skip — data says edge isn't there

    // ── Stage-1 alert ──
    const risk       = Math.abs(price-sl);
    const entryGuide = dir==='long' ? price+0.2*risk : price-0.2*risk;
    // Next 30m bar close time in IST
    const next30IST  = new Date((sweepBar.t + 1800 + IST)*1000);
    const nextStr    = `${String(next30IST.getUTCHours()).padStart(2,'0')}:${String(next30IST.getUTCMinutes()).padStart(2,'0')} IST`;
    const weekNote   = weekOpen ? ` | weekly open: ${fnum(weekOpen)}` : '';
    const arrow      = dir==='long' ? '📈' : '📉';
    const perfNote   = ar.note; // most specific stat: KZ WR > direction WR > overall WR

    await tg(env,
      `⚡ *SETUP FORMING — ${name} ${dir.toUpperCase()}* (30m)${perfNote}\n`+
      `Sweep wick: ${(wickPct*100).toFixed(0)}% of bar @ ${fnum(price)}\n`+
      `Bias: ${h4.toUpperCase()} H4+H1${weekNote}\n`+
      `SL zone: ${fnum(sl)}\n`+
      `_Displacement bar closes ~${nextStr} — if it closes in upper/lower 55% of range AND body ≥ 0.3×ATR → ENTRY near ${fnum(entryGuide)}_\n`+
      `_${kzLabel} kill zone — watch next 30 min_`
    );

    // Store Stage-1 in KV with 1-hour TTL (displacement must happen within 1 bar = 30 min;
    // using 3600s for safety in case cron is slightly delayed)
    await putJSON(env, pendKey, {dir, sl, sweepT:sweepBar.t, wickPct, kz:kzLabel, lastChecked:0}, 3600);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── 1H TWO-STAGE SCAN (unchanged from V2, weekly bias added) ────────────
// ═══════════════════════════════════════════════════════════════════════
async function runScan1H(env,kzLabel){
  const now=Math.floor(Date.now()/1000);
  const pu=await env.STATE.get('pause_until'); if(pu&&now<Number(pu))return;
  if(blackoutInfo(now))return;
  const kzKey1h=kzLabel.toLowerCase().replace(' ','-'); // 'london' | 'ny-am'
  // Load learned rules once — applied per instrument
  const learnedCfg1h=await getJSON(env,'learned_config')||{};
  const armed=[];
  for(const [name,sym] of INSTR){
    let B; try{B=await yf(sym,"60d","1h");}catch(e){continue;}
    if(!B||B.length<200) continue;
    const last=B[B.length-1], price=last.c, day=last.day;

    if(DOW_FILTER&&[1,5].includes(last.dow)) continue;

    const A=dailyATR(B)||price*0.01;
    const d1=trendOf(B,86400), h4=trendOf(B,14400), h1=trendOf(B,3600);
    if(h4!==h1) continue;
    const dir=h4, poi=dir==='bull'?'sup':'res';

    // Dealing range
    const D=resample(B,86400).slice(-5); if(D.length<2)continue;
    const drHi=Math.max(...D.map(x=>x.h)), drLo=Math.min(...D.map(x=>x.l)), eq=(drHi+drLo)/2;
    const pd=dir==='bull'?price<eq:price>eq;

    // Zone stack
    let stack=0;
    for(const secs of [86400,14400,7200,3600]){
      const zs=zones(resample(B,secs)).filter(z=>z.dir===poi&&z.t<last.t&&price>=z.lo-0.25*(z.hi-z.lo)&&price<=z.hi+0.25*(z.hi-z.lo));
      if(zs.length)stack++;
    }
    if(stack<2) continue;

    // Weekly bias (same logic as backtest)
    let weekOpen=null;
    if(WEEKLY_BIAS){
      const Wbars=resample(B,604800);
      if(Wbars.length>=2) weekOpen=Wbars[Wbars.length-2].o;
      else if(Wbars.length===1) weekOpen=Wbars[0].o;
    }
    if(weekOpen){
      if(dir==='bull'&&price>=weekOpen) continue; // not in discount
      if(dir==='bear'&&price<=weekOpen) continue; // not in premium
    }

    // 6-bar swing structure
    const rl=Math.min(...B.slice(-7,-1).map(b=>b.l));
    const rh=Math.max(...B.slice(-7,-1).map(b=>b.h));
    const range=(last.h-last.l)||1;

    // Stage-1: current bar is sweep?
    let sweepDir=null, sl, wickPct;
    if(dir==='bull'&&last.l<rl&&last.c>rl&&pd){
      wickPct=(Math.min(last.o,last.c)-last.l)/range;
      if(wickPct>=WICK){sweepDir='long';sl=last.l;}
    } else if(dir==='bear'&&last.h>rh&&last.c<rh&&pd){
      wickPct=(last.h-Math.max(last.o,last.c))/range;
      if(wickPct>=WICK){sweepDir='short';sl=last.h;}
    }

    if(sweepDir){
      // ── Adapt-and-grow gate (1H) ──
      const lastDow=last.dow??new Date(last.t*1000).getDay();
      const ar1h=applyRule(learnedCfg1h, name, sweepDir, kzKey1h, lastDow);
      if(!ar1h.skip){
        const pendKey=`s2_1h_${name}`;
        const existing=await getJSON(env,pendKey);
        if(!existing||Math.abs(existing.sweepT-last.t)>3600){
          const nextHourIST=new Date((last.t+3600+IST)*1000);
          const nextStr=`${String(nextHourIST.getUTCHours()).padStart(2,'0')}:${String(nextHourIST.getUTCMinutes()).padStart(2,'0')} IST`;
          const weekNote=weekOpen?` | wk open: ${fnum(weekOpen)}`:'';
          await tg(env,
            `⚡ *SETUP FORMING — ${name} ${sweepDir.toUpperCase()}* (1H)${ar1h.note}\n`+
            `Sweep wick: ${(wickPct*100).toFixed(0)}% @ ${fnum(price)} — ${kzLabel}\n`+
            `HTF bias: ${d1.toUpperCase()} D1 + ${h4.toUpperCase()} H4+H1${weekNote}\n`+
            `Zone stack: ${stack}/4 TFs aligned\n`+
            `SL: ${fnum(sl)}\n`+
            `_Displacement bar closes ~${nextStr}. Entry on NEXT 1H close if confirmed._`
          );
          await putJSON(env,pendKey,{dir:sweepDir,sl,sweepT:last.t,wickPct,kz:kzLabel,d1},3600+900);
        }
      }
    }

    // Stage-2: pending 1H setup got displacement?
    const pendKey=`s2_1h_${name}`;
    const pend=await getJSON(env,pendKey);
    if(pend&&pend.sweepT<last.t){
      const mbR=(last.h-last.l)||1;
      const dispOK=pend.dir==='long'
        ?((last.c-last.l)/mbR>=0.55&&Math.abs(last.c-last.o)>=0.3*A)
        :((last.h-last.c)/mbR>=0.55&&Math.abs(last.c-last.o)>=0.3*A);
      if(dispOK){
        const note1h=`D1 ${pend.d1?.toUpperCase()} | wick ${(pend.wickPct*100).toFixed(0)}%`;
        await tg(env,entryMsg(name,pend.dir,'1H',last.c,pend.sl,kzLabel,note1h));
        await logAlert(env,{pair:name,direction:pend.dir,timeframe:'1H',entry:last.c,sl:pend.sl,kz:kzLabel,note:note1h});
        await env.STATE.delete(pendKey);
      }
    }

    // "Potential setup" list (Asian sweep + zone stack ≥2)
    const td=B.filter(b=>b.day===day);
    const aB=td.filter(x=>x.min>=390&&x.min<=615); if(!aB.length)continue;
    const aHi=Math.max(...aB.map(x=>x.h)), aLo=Math.min(...aB.map(x=>x.l));
    const swept=dir==='bull'?(Math.min(...td.map(x=>x.l))<=aLo):(Math.max(...td.map(x=>x.h))>=aHi);
    if(swept&&pd&&stack>=2)
      armed.push({name,dir:dir==='bull'?"LONG":"SHORT",price,tier:(d1===dir)?"A+":"A"});
  }
  if(armed.length){
    // Filter potential setups through learned rules
    // (learnedCfg1h already loaded at top of function — reuse it)
    const nowDow=new Date().getDay();
    const filteredArmed=armed.reduce((acc,a)=>{
      const aDir=a.dir==='LONG'?'long':'short';
      const arPot=applyRule(learnedCfg1h, a.name, aDir, kzKey1h, nowDow);
      if(arPot.skip) return acc;
      return [...acc,{...a,perfNote:arPot.note}];
    },[]);
    if(!filteredArmed.length) return;
    await tg(env,`🔴 *Fed Forex — potential setups* (${kzLabel} KZ, 1H)\n`+
      filteredArmed.map(a=>
        `• ${a.name} — ${a.dir==='LONG'?'Bullish':'Bearish'}${a.perfNote}`
      ).join("\n")+
      `\n_Confirmed edge: wait for wick ≥ 0.55 + displacement before entry_`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ── SUPABASE SYNC (unchanged from V2) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const u=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(u<=0||u>100)return null;const rem=100-u;const pr=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let rR=0;if(t.remainderOutcome==="TP")rR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="SL")rR=-1;else if(t.remainderOutcome==="manual")rR=parseFloat(t.remainderR||0);return+(pr+rem/100*rR).toFixed(2);}
function Rof(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
// ═══════════════════════════════════════════════════════════════════════
// ── ADAPT-AND-GROW ENGINE ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
//
// The loop:
//   1. Journal a trade in the replay app
//   2. runSync() (3× daily) fetches ALL trades from Supabase
//   3. extractInsights() analyses: pair × direction × kill zone × day of week
//   4. deriveConfig() converts patterns → operational rules
//   5. Rules stored in KV as 'learned_config' → scans apply them immediately
//   6. New trade data → smarter rules → better signal quality → repeat
//
// Conservative thresholds: rules only fire when pattern is clear.
// Siddh gets ONE Telegram message whenever a rule changes, explaining why.
// ═══════════════════════════════════════════════════════════════════════

// ── STEP 1: Extract raw insights per pair + global patterns ──
// Uses ACTUAL structured fields from the replay journal:
//   t.session     = "London KZ" | "NY AM KZ" | "NY PM KZ" | "ODR"
//   t.confluences = ["Kill Zone","IFVG","OB/FVG/BPR",...] (structured array)
//   t.htfBias     = {D1:"Bear"|"Bull", H4:"Bear"|"Bull", H1:"Bear"|"Bull"}
//   t.quality     = "A+" | "A" | "B"
//   t.direction   = "Long" | "Short"
function extractInsights(trades){
  const pairRaw={}, confRaw={}, htfRaw={all3:{n:0,w:0},h4h1:{n:0,w:0},other:{n:0,w:0}};
  const sessRaw={}, qualRaw={}, countRaw={};

  for(const t of trades){
    const p=t.pair; if(!p)continue;
    const d=(t.direction||'').toLowerCase(); // 'long'|'short'
    const isWin=t.outcome==='Win';
    const isDecided=t.outcome==='Win'||t.outcome==='Loss';
    const r=Rof(t);

    // Session from structured field: "London KZ"→'london', "NY AM KZ"→'ny-am', etc.
    const rawSess=(t.session||'').toLowerCase().trim();
    const sessKey=rawSess.includes('london')?'london'
      :rawSess.includes('ny am')||rawSess.includes('nyam')?'ny-am'
      :rawSess.includes('ny pm')?'ny-pm'
      :rawSess.includes('odr')||rawSess.includes('asia')?'odr'
      :rawSess||null;

    // DOW from t.date: "2026-05-22" → 1=Mon…5=Fri
    let dow=null;
    if(t.date){try{const day=new Date(t.date).getDay();if(day>=1&&day<=5)dow=day;}catch(_){}}

    // ── Per-pair stats ──
    if(!pairRaw[p])pairRaw[p]={n:0,w:0,sumR:0,byDir:{},byKZ:{},byDow:{}};
    const x=pairRaw[p];
    x.n++; if(isWin)x.w++; if(isDecided)x.sumR+=r;
    if(d){if(!x.byDir[d])x.byDir[d]={n:0,w:0}; x.byDir[d].n++; if(isWin)x.byDir[d].w++;}
    if(sessKey){if(!x.byKZ[sessKey])x.byKZ[sessKey]={n:0,w:0}; x.byKZ[sessKey].n++; if(isWin)x.byKZ[sessKey].w++;}
    if(dow!==null){if(!x.byDow[dow])x.byDow[dow]={n:0,w:0}; x.byDow[dow].n++; if(isWin)x.byDow[dow].w++;}

    // ── Global: confluence analysis — use t.confluences array directly ──
    const confs=Array.isArray(t.confluences)?t.confluences:[];
    for(const c of confs){
      if(!c)continue;
      if(!confRaw[c])confRaw[c]={n_with:0,w_with:0};
      confRaw[c].n_with++; if(isWin)confRaw[c].w_with++;
    }
    if(!confRaw.__total__)confRaw.__total__={n:0,w:0};
    confRaw.__total__.n++; if(isWin)confRaw.__total__.w++;

    // ── Global: confluence count (how many confluences on winning trades) ──
    const cnt=confs.length;
    if(!countRaw[cnt])countRaw[cnt]={n:0,w:0};
    countRaw[cnt].n++; if(isWin)countRaw[cnt].w++;

    // ── Global: HTF alignment (D1+H4+H1 vs H4+H1 only) ──
    if(t.htfBias){
      const{D1,H4,H1}=t.htfBias;
      if(D1&&H4&&H1&&D1===H4&&H4===H1){htfRaw.all3.n++; if(isWin)htfRaw.all3.w++;}
      else if(H4&&H1&&H4===H1){htfRaw.h4h1.n++; if(isWin)htfRaw.h4h1.w++;}
      else{htfRaw.other.n++; if(isWin)htfRaw.other.w++;}
    }

    // ── Global: session WR ──
    if(sessKey){
      if(!sessRaw[sessKey])sessRaw[sessKey]={n:0,w:0,sumR:0};
      sessRaw[sessKey].n++; if(isWin)sessRaw[sessKey].w++; if(isDecided)sessRaw[sessKey].sumR+=r;
    }

    // ── Global: quality tier ──
    if(t.quality){
      if(!qualRaw[t.quality])qualRaw[t.quality]={n:0,w:0};
      qualRaw[t.quality].n++; if(isWin)qualRaw[t.quality].w++;
    }
  }

  const wr=(n,w)=>n>=2?Math.round(w/n*100):null;
  const cvt=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,{n:v.n,wr:wr(v.n,v.w)}]));

  // Format per-pair
  const pairs={};
  for(const[p,x]of Object.entries(pairRaw)){
    pairs[p]={n:x.n,wr:x.n>0?Math.round(x.w/x.n*100):0,avgR:x.n>0?+(x.sumR/x.n).toFixed(2):0,
              byDir:cvt(x.byDir),byKZ:cvt(x.byKZ),byDow:cvt(x.byDow)};
  }

  // Confluence WR: with vs without each confluence
  const totalN=confRaw.__total__?.n||0, totalW=confRaw.__total__?.w||0;
  const confluences={};
  for(const[c,v]of Object.entries(confRaw)){
    if(c==='__total__')continue;
    if(v.n_with<3)continue;
    const n_out=totalN-v.n_with, w_out=totalW-v.w_with;
    confluences[c]={withN:v.n_with,withWR:wr(v.n_with,v.w_with),
                    withoutN:n_out,withoutWR:wr(n_out,w_out)};
  }

  // HTF alignment breakdown
  const htf={
    all3:{n:htfRaw.all3.n,wr:wr(htfRaw.all3.n,htfRaw.all3.w)},
    h4h1:{n:htfRaw.h4h1.n,wr:wr(htfRaw.h4h1.n,htfRaw.h4h1.w)},
  };

  // Session breakdown
  const sessions={};
  for(const[k,v]of Object.entries(sessRaw)){
    sessions[k]={n:v.n,wr:wr(v.n,v.w),avgR:v.n>0?+(v.sumR/v.n).toFixed(2):0};
  }

  // Quality tier breakdown
  const quality={};
  for(const[k,v]of Object.entries(qualRaw)){quality[k]={n:v.n,wr:wr(v.n,v.w)};}

  return{pairs,confluences,htf,sessions,quality,countStats:countRaw,total:trades.length};
}

// ── STEP 2: Convert insights → operational rules ──
// Rules activate only when pattern is statistically clear (conservative thresholds).
// Per-pair rules + _global rules stored in 'learned_config' KV.
const MIN_N_DIR=5;  // min trades in a direction before gating on it
const MIN_N_KZ=4;   // min trades in a KZ before preferring/skipping
const MIN_N_DOW=3;  // min trades on a day before skipping it
const KZ_GAP=18;    // min % WR gap to enforce a KZ preference
function deriveConfig(insights){
  const cfg={};

  // ── Per-pair rules ──
  for(const[p,ins]of Object.entries(insights.pairs)){
    if(ins.n<4)continue; // need at least 4 trades to say anything meaningful
    const rule={
      n:ins.n, wr:ins.wr, avgR:ins.avgR,
      byDir:ins.byDir, byKZ:ins.byKZ, byDow:ins.byDow,
      skipDirs:[],
      preferredKZ:null,
      skipKZ:[],
      skipDows:[],
      confidence:ins.n>=15?'high':ins.n>=8?'medium':'low',
    };

    // Direction gate: skip if WR < 35% AND enough data
    for(const[dir,dv]of Object.entries(ins.byDir)){
      if(dv.n>=MIN_N_DIR&&dv.wr!==null&&dv.wr<35) rule.skipDirs.push(dir);
    }

    // Kill zone: prefer the stronger session if gap is large
    const kzArr=Object.entries(ins.byKZ)
      .filter(([,v])=>v.n>=MIN_N_KZ&&v.wr!==null)
      .sort((a,b)=>b[1].wr-a[1].wr);
    if(kzArr.length>=2){
      const[bestK,bestV]=kzArr[0],[,worstV]=kzArr[kzArr.length-1];
      if(bestV.wr-worstV.wr>=KZ_GAP){
        rule.preferredKZ=bestK;
        rule.skipKZ=kzArr.filter(([,v])=>v.wr<45).map(([k])=>k);
      }
    }

    // Day of week: skip days where edge consistently disappears
    for(const[dow,dv]of Object.entries(ins.byDow)){
      if(dv.n>=MIN_N_DOW&&dv.wr!==null&&dv.wr<40) rule.skipDows.push(Number(dow));
    }

    cfg[p]=rule;
  }

  // ── Global rules — derived from cross-pair patterns ──
  // Stored as _global in learned_config, read by run30mScan each cron tick.
  // These silently tighten or relax scanner parameters as data accumulates.
  const g={d1Required:false, minZoneStack:1, avoidMT:false, ifvgBoosts:false};

  // D1 alignment: proven +9% WR in data → activate when pattern holds
  // Requires: ≥8 trades with all3 aligned, ≥5 with h4h1 only, gap ≥8%
  const htf=insights.htf||{};
  if(htf.all3?.n>=8&&htf.h4h1?.n>=5&&
     htf.all3.wr!==null&&htf.h4h1.wr!==null&&
     htf.all3.wr-htf.h4h1.wr>=8){
    g.d1Required=true;
  }

  // Mean Threshold drag: proven −15% WR in data → flag for avoidance
  const mt=insights.confluences?.['Mean Threshold'];
  if(mt?.withN>=5&&mt.withWR!==null&&mt.withoutWR!==null&&
     mt.withoutWR-mt.withWR>=10){
    g.avoidMT=true;
  }

  // IFVG boost: proven +23% WR in data → flag for priority alert annotation
  const ifvg=insights.confluences?.['IFVG'];
  if(ifvg?.withN>=8&&ifvg.withWR!==null&&ifvg.withoutWR!==null&&
     ifvg.withWR-ifvg.withoutWR>=15){
    g.ifvgBoosts=true;
  }

  // Minimum zone stack: if trades with ≥5 confluences win ≥10% more than <5 → raise bar to 2
  const cs=insights.countStats||{};
  const hi=Object.entries(cs).filter(([k])=>Number(k)>=5)
    .reduce((a,[,v])=>({n:a.n+v.n,w:a.w+v.w}),{n:0,w:0});
  const lo=Object.entries(cs).filter(([k])=>{const n=Number(k);return n>=2&&n<5;})
    .reduce((a,[,v])=>({n:a.n+v.n,w:a.w+v.w}),{n:0,w:0});
  if(hi.n>=10&&lo.n>=10){
    const hiWR=Math.round(hi.w/hi.n*100), loWR=Math.round(lo.w/lo.n*100);
    if(hiWR-loWR>=10) g.minZoneStack=2;
  }

  cfg._global=g;
  return cfg;
}

// ── STEP 3: Apply a pair's learned rules to one candidate setup ──
// Returns {skip:bool, note:string}
// kzKey  = 'london' | 'ny-am'  (normalised from kzLabel)
// dow    = 1–5 (the sweep bar's day of week)
const DOW_NAME=['','Mon','Tue','Wed','Thu','Fri'];
function applyRule(cfg, name, dir, kzKey, dow){
  const r=cfg?.[name];
  if(!r) return {skip:false,note:''}; // no data yet — let it through

  // Hard skip: overall pair edge broken (≥10 trades, WR < 40%)
  if(r.n>=10&&r.wr<40) return {skip:true,note:''};
  // Hard skip: this direction proven weak
  if(r.skipDirs.includes(dir)) return {skip:true,note:''};
  // Hard skip: this KZ historically weak for this pair
  if(kzKey&&r.skipKZ.includes(kzKey)) return {skip:true,note:''};
  // Hard skip: this day of week historically weak
  if(dow&&r.skipDows.includes(dow)) return {skip:true,note:''};

  // ── Annotation: most specific stat available (KZ > direction > overall) ──
  const kzD=kzKey?r.byKZ?.[kzKey]:null;
  const dirD=dir?r.byDir?.[dir]:null;
  let note='';
  if(kzD&&kzD.n>=3&&kzD.wr!==null){
    note=kzD.wr>=70?` ✅ ${kzD.wr}% WR in ${kzKey} (${kzD.n})`
        :kzD.wr<50?` ⚠️ ${kzD.wr}% WR in ${kzKey} (${kzD.n})`
        :` 📊 ${kzD.wr}% WR in ${kzKey} (${kzD.n})`;
  } else if(dirD&&dirD.n>=3&&dirD.wr!==null){
    note=dirD.wr>=70?` ✅ ${dirD.wr}% WR ${dir}s (${dirD.n})`
        :dirD.wr<50?` ⚠️ ${dirD.wr}% WR ${dir}s (${dirD.n})`
        :` 📊 ${dirD.wr}% WR ${dir}s (${dirD.n})`;
  } else if(r.n>=3){
    note=r.wr>=70?` ✅ ${r.wr}% WR (${r.n})`
        :r.wr<50?` ⚠️ ${r.wr}% WR (${r.n})`
        :` 📊 ${r.wr}% WR (${r.n})`;
  }
  return{skip:false,note};
}

// ── STEP 4: Diff old vs new rules → human-readable change log ──
// Called by runSync to decide whether to send Telegram notification.
function diffConfig(prev,next){
  const msgs=[];
  for(const[p,r]of Object.entries(next)){
    const old=prev?.[p];
    if(!old){
      // First time we have enough data for this pair
      if(r.n>=5) msgs.push(`📊 *${p}* — ${r.n} trades logged. First rules active: ${r.wr}% WR, +${r.avgR}R avg.`);
      continue;
    }
    // Direction gate changes
    for(const dir of['long','short']){
      const nowSkip=r.skipDirs.includes(dir), wasSkip=(old.skipDirs||[]).includes(dir);
      if(nowSkip&&!wasSkip) msgs.push(`⛔ *${p} ${dir}s* auto-skipped — ${r.byDir?.[dir]?.wr}% WR on ${r.byDir?.[dir]?.n} trades. No ${dir} alerts until it recovers.`);
      if(!nowSkip&&wasSkip) msgs.push(`✅ *${p} ${dir}s* recovered — ${r.byDir?.[dir]?.wr}% WR now. Re-enabled.`);
    }
    // KZ preference changes
    if(r.preferredKZ!==old.preferredKZ){
      if(r.preferredKZ){
        const kzD=r.byKZ?.[r.preferredKZ];
        msgs.push(`🕐 *${p}* — ${r.preferredKZ.toUpperCase()} is your stronger session (${kzD?.wr}% WR, ${kzD?.n} trades). Other KZs skipped for this pair.`);
      } else {
        msgs.push(`🕐 *${p}* — KZ filter lifted. Both sessions active again.`);
      }
    }
    // New KZ skips
    for(const kz of(r.skipKZ||[])){
      if(!(old.skipKZ||[]).includes(kz)){
        const kzD=r.byKZ?.[kz];
        msgs.push(`⛔ *${p} ${kz.toUpperCase()}* session skipped — ${kzD?.wr}% WR (${kzD?.n} trades).`);
      }
    }
    // DOW changes
    for(const d of(r.skipDows||[])){
      if(!(old.skipDows||[]).includes(d)){
        const dv=r.byDow?.[d];
        msgs.push(`📅 *${p} ${DOW_NAME[d]}* skipped — ${dv?.wr}% WR on ${DOW_NAME[d]}s (${dv?.n} trades).`);
      }
    }
    for(const d of(old.skipDows||[])){
      if(!(r.skipDows||[]).includes(d)) msgs.push(`📅 *${p} ${DOW_NAME[d]}* re-enabled.`);
    }
    // Significant overall drift (3+ new trades AND WR moved 8%+)
    if(r.n>old.n+2&&Math.abs(r.wr-old.wr)>=8){
      msgs.push(`📈 *${p}* overall: ${old.wr}% → *${r.wr}%* WR (${r.n} trades, ${r.avgR}R avg)`);
    }
  }
  return msgs;
}

// ═══════════════════════════════════════════════════════════════════════
// ── STEP 5: CONFLUENCE ANALYSIS (for /stats command) ────────────────────
// ═══════════════════════════════════════════════════════════════════════
// Uses t.confluences (structured array) directly — no keyword parsing.
// These functions are called by /stats on demand. Never auto-sent to Telegram.
// ═══════════════════════════════════════════════════════════════════════

// WR for trades WITH vs WITHOUT a specific confluence name
function confWR(trades, confName){
  const has=trades.filter(t=>Array.isArray(t.confluences)&&t.confluences.includes(confName));
  const hasnt=trades.filter(t=>!Array.isArray(t.confluences)||!t.confluences.includes(confName));
  const wr=arr=>{const d=arr.filter(t=>t.outcome==='Win'||t.outcome==='Loss');return d.length?Math.round(d.filter(t=>t.outcome==='Win').length/d.length*100):null;};
  const avgR=arr=>{const d=arr.filter(t=>t.outcome==='Win'||t.outcome==='Loss');return d.length?+(d.reduce((s,t)=>s+Rof(t),0)/d.length).toFixed(2):null;};
  return{key:confName,withN:has.length,withWR:wr(has),withAvgR:avgR(has),withoutN:hasnt.length,withoutWR:wr(hasnt)};
}

// Detect strategy drift: confluences appearing significantly more in recent wins
function detectDrift(trades){
  if(trades.length<15) return [];
  const recent=trades.slice(-15), older=trades.slice(0,-15);
  if(older.length<5) return [];
  const freq=arr=>{const c={};for(const t of arr)for(const k of(Array.isArray(t.confluences)?t.confluences:[]))c[k]=(c[k]||0)+1;return c;};
  const rF=freq(recent.filter(t=>t.outcome==='Win'));
  const oF=freq(older.filter(t=>t.outcome==='Win'));
  const rl=Math.max(1,recent.length), ol=Math.max(1,older.length);
  const drifts=[];
  for(const[k,cnt]of Object.entries(rF)){
    const rRate=cnt/rl, oRate=(oF[k]||0)/ol;
    if(rRate-oRate>=0.20&&cnt>=3) drifts.push({key:k,rRate,oRate,gain:rRate-oRate,count:cnt});
  }
  return drifts.sort((a,b)=>b.gain-a.gain);
}

// Full confluence analysis: which confluences boost or drag WR
function analyzeConfluences(trades){
  const allKeys=[...new Set(trades.flatMap(t=>Array.isArray(t.confluences)?t.confluences:[]))];
  if(!allKeys.length) return {overall:[],pairBest:{}};
  const overall=allKeys.map(k=>confWR(trades,k))
    .filter(v=>v.withN>=4&&v.withWR!==null&&v.withoutWR!==null);
  const pairNames=[...new Set(trades.map(t=>t.pair).filter(Boolean))];
  const pairBest={};
  for(const p of pairNames){
    const pt=trades.filter(t=>t.pair===p);
    if(pt.length<5) continue;
    const pv=allKeys.map(k=>confWR(pt,k))
      .filter(v=>v.withN>=3&&v.withWR!==null&&v.withoutWR!==null&&v.withWR-v.withoutWR>=5)
      .sort((a,b)=>(b.withWR-b.withoutWR)-(a.withWR-a.withoutWR));
    if(pv.length) pairBest[p]=pv[0];
  }
  return{overall,pairBest};
}

// Strategy analysis text — used by /stats command only, never auto-sent
function buildStrategyReport(trades, confAnalysis, drift){
  const decided=trades.filter(t=>t.outcome==='Win'||t.outcome==='Loss');
  const oWR=decided.length?Math.round(decided.filter(t=>t.outcome==='Win').length/decided.length*100):0;
  const oR=decided.length?+(decided.reduce((s,t)=>s+Rof(t),0)/decided.length).toFixed(2):0;
  const lines=[`📊 *${trades.length} trades | ${oWR}% WR | ${oR>=0?'+':''}${oR}R avg*`];
  if(drift.length){
    lines.push('\n*📈 Strategy shift in last 15 trades:*');
    for(const d of drift.slice(0,3)){
      const v=confWR(trades,d.key);
      const imp=v.withWR!==null&&v.withoutWR!==null?v.withWR-v.withoutWR:null;
      lines.push(`*${d.key}* — ${Math.round(d.rRate*100)}% of recent wins (was ${Math.round(d.oRate*100)}%)\n`+
        (imp!==null
          ?(imp>=5?`  ✅ ${v.withWR}% WR (${v.withN}) vs ${v.withoutWR}% without → *+${imp}% edge*`
            :imp<=-5?`  ⚠️ ${v.withWR}% WR (${v.withN}) vs ${v.withoutWR}% without → *${imp}% drag*`
            :`  📊 ${v.withWR}% WR (${v.withN}) vs ${v.withoutWR}% without — neutral`)
          :`  📊 Not enough data yet`));
    }
  }
  const boosters=confAnalysis.overall.filter(v=>v.withWR-v.withoutWR>=5)
    .sort((a,b)=>(b.withWR-b.withoutWR)-(a.withWR-a.withoutWR));
  if(boosters.length){
    lines.push('\n*✅ Confluences that boost WR:*');
    for(const v of boosters.slice(0,4))
      lines.push(`  • *${v.key}*: ${v.withWR}% (${v.withN}) vs ${v.withoutWR}% without — *+${v.withWR-v.withoutWR}%*`);
  }
  const draggers=confAnalysis.overall.filter(v=>v.withN>=5&&v.withoutWR-v.withWR>=8)
    .sort((a,b)=>(b.withoutWR-b.withWR)-(a.withoutWR-a.withWR));
  if(draggers.length){
    lines.push('\n*⚠️ Confluences that hurt WR:*');
    for(const v of draggers.slice(0,2))
      lines.push(`  • *${v.key}*: ${v.withWR}% (${v.withN}) vs ${v.withoutWR}% without — *${v.withWR-v.withoutWR}%*`);
  }
  const pairLines=Object.entries(confAnalysis.pairBest).map(([p,v])=>
    `  • *${p}*: ${v.key} → ${v.withWR}% (${v.withN}) vs ${v.withoutWR}% without — *+${v.withWR-v.withoutWR}%*`);
  if(pairLines.length){lines.push('\n*📍 Per-pair strongest confluence:*');lines.push(...pairLines);}
  return lines.join('\n');
}

// ── STEP 6: runSync — learning tick + before/after review ──
// Runs 3× daily (cron: "47 7,15,20 * * *").
// Reads all replay trades → analyses patterns → updates scanner rules.
// Every 10 new trades → sends a before/after Telegram review.
// Loop: more trades → smarter rules → better signals → repeat.

// Backtest baseline WR (from Yahoo Finance backtest v2, proven pairs only)
const BT_WR={
  GBPJPY:{SB2:83,Sweep:77},
  EURUSD:{SB2:75,ODR:80,Sweep:77},
  ETHUSD:{SB2:71,ODR:89},
  EURJPY:{SB2:67,Sweep:77},
  GBPUSD:{ODR:69,Sweep:77},
  USDJPY:{Sweep:77},
  BTCUSD:{Sweep:77},
  AUDUSD:{Sweep:77},
  GOLD:  {Sweep:77},
};

async function runSync(env){
  const H={apikey:env.SUPABASE_KEY,Authorization:"Bearer "+env.SUPABASE_KEY};
  let idRows;
  try{idRows=await(await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id&order=id",{method:"GET",headers:H})).json();}catch(e){return;}
  const liveIds=idRows.map(r=>r.id);
  const state=(await getJSON(env,"sync_state"))||{ids:[]};
  const known=new Set(state.ids||[]);
  if(!liveIds.filter(id=>!known.has(id)).length&&state.count===liveIds.length)return; // nothing new

  const rows=await(await fetch(env.SUPABASE_URL+"/rest/v1/replay_trades?select=id,data&order=id",{method:"GET",headers:H})).json();
  const T=rows.map(r=>r.data); if(!T.length)return;

  // Load PREVIOUS config before overwriting (needed for before/after diff)
  const prevCfg=await getJSON(env,"learned_config")||{};

  // Layer 1: WR + confluence + HTF + session + quality analysis
  const insights=extractInsights(T);
  // Layer 2: Convert patterns → hard operational rules (per-pair + global)
  const newCfg=deriveConfig(insights);

  // Persist — scanner picks up new rules on the very next cron tick
  await putJSON(env,"learned_config",newCfg);
  await putJSON(env,"perf_state",{
    pairs:insights.pairs,
    confluences:insights.confluences,
    htf:insights.htf,
    sessions:insights.sessions,
    quality:insights.quality,
    updatedAt:Math.floor(Date.now()/1000),
    total:T.length
  });
  await putJSON(env,"sync_state",{ids:liveIds,count:liveIds.length});

  // ── Before/After review: fires every 10 new trades ──
  const lastReviewTotal=Number((await env.STATE.get("last_review_total"))||0);
  const newSinceReview=T.length-lastReviewTotal;
  if(newSinceReview<10)return; // not enough new trades yet

  await env.STATE.put("last_review_total",String(T.length));

  // ── Build the before/after WR table ──
  const lines=[];
  lines.push(`📊 *Strategy Review — ${newSinceReview} new trades (${T.length} total)*\n`);
  lines.push(`*Actual WR (your trades) vs Backtest baseline:*`);

  const pairsSorted=Object.keys(insights.pairs).sort();
  for(const p of pairsSorted){
    const actual=insights.pairs[p];
    if(actual.n<3)continue;
    const bt=BT_WR[p]||{};
    const btBest=Math.max(...Object.values(bt),0);
    const arrow=actual.wr>btBest?'▲':actual.wr<btBest-5?'▼':'→';
    const btStr=btBest?`BT ${btBest}%`:'BT —';
    lines.push(`• \`${p}\`  ${btStr} → *${actual.wr}%* actual  ${arrow}  _(${actual.n} trades, ${actual.avgR>0?'+':''}${actual.avgR}R avg)_`);
  }

  // ── Session breakdown ──
  if(Object.keys(insights.sessions).length){
    lines.push(`\n*By session:*`);
    for(const[k,v]of Object.entries(insights.sessions)){
      if(v.n<3)continue;
      lines.push(`• ${k.toUpperCase()}  ${v.wr}% WR  (${v.n} trades, ${v.avgR>0?'+':''}${v.avgR}R avg)`);
    }
  }

  // ── HTF alignment impact ──
  const htf=insights.htf;
  if(htf.all3?.n>=5&&htf.h4h1?.n>=3){
    lines.push(`\n*HTF alignment:*`);
    lines.push(`• D1+H4+H1 aligned: *${htf.all3.wr}%* WR (${htf.all3.n} trades)`);
    lines.push(`• H4+H1 only: *${htf.h4h1.wr}%* WR (${htf.h4h1.n} trades)`);
  }

  // ── Rule changes (what the scanner will do differently) ──
  const changes=diffConfig(prevCfg,newCfg);
  if(changes.length){
    lines.push(`\n*Scanner rule changes:*`);
    for(const c of changes) lines.push(c);
  } else {
    lines.push(`\n_No rule changes — scanner settings unchanged._`);
  }

  lines.push(`\n_Rules applied immediately. Next scan uses updated config._`);
  await tg(env,lines.join('\n'));
}

// ═══════════════════════════════════════════════════════════════════════
// ── TELEGRAM BOT COMMANDS (Seg 10) ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
// Setup: after deploy, visit ?run=setwh once to register the webhook with Telegram.
// Commands: /help  /status  /pause [h]  /unpause  /forcescan  /stats
async function handleTgUpdate(req, env){
  let upd;
  try{ upd=await req.json(); }catch(e){ return new Response('ok'); }

  const msg=upd.message||upd.edited_message;
  if(!msg?.text) return new Response('ok');

  // Security: only respond to the configured chat (prevents abuse from strangers)
  if(env.TG_CHAT && String(msg.chat?.id)!==String(env.TG_CHAT)) return new Response('ok');

  const full=msg.text.trim();
  const cmd=full.split(' ')[0].split('@')[0].toLowerCase(); // strip @BotName suffix
  const args=full.split(' ').slice(1);

  // ── /help ──
  if(cmd==='/help'||cmd==='/start'){
    await tg(env,
      `*Fed Forex V3 — Bot Commands*\n\n`+
      `/status — list pending Stage-1 setups\n`+
      `/pause [h] — mute alerts (default: 4h)\n`+
      `/unpause — resume alerts now\n`+
      `/forcescan — run 30m scan immediately\n`+
      `/stats — backtest summary\n`+
      `/help — show this menu`
    );
  }

  // ── /status ──
  else if(cmd==='/status'){
    const lines=[];
    // 30m pending setups
    for(const [name] of INSTR_30M){
      const p=await getJSON(env,`s2m30_${name}`);
      if(p){
        const d=new Date((p.sweepT+IST)*1000);
        const t=`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} IST`;
        lines.push(`• \`${name}\` ${p.dir.toUpperCase()} (30m) — wick ${(p.wickPct*100).toFixed(0)}% @ ${t} · ${p.kz}`);
      }
    }
    // 1H pending setups
    for(const [name] of INSTR){
      const p=await getJSON(env,`s2_1h_${name}`);
      if(p){
        const d=new Date((p.sweepT+IST)*1000);
        const t=`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} IST`;
        lines.push(`• \`${name}\` ${p.dir.toUpperCase()} (1H) — wick ${(p.wickPct*100).toFixed(0)}% @ ${t} · ${p.kz}`);
      }
    }
    // SB2 pending setups (Stage-1 FVG touch, awaiting displacement)
    for(const [name] of INSTR_SB2){
      const p=await getJSON(env,`sb2_${name}`);
      if(p) lines.push(`• \`${name}\` ${p.dir.toUpperCase()} (SB2) — FVG ${fnum(p.fvgLo)}–${fnum(p.fvgHi)} · ${p.win}`);
    }
    const pu=await env.STATE.get('pause_until');
    const pauseNote=(pu&&Date.now()/1000<Number(pu))? '\n\n⏸ _Alerts are currently paused._':'';
    await tg(env, lines.length
      ? `📊 *Pending setups* (Stage-1, awaiting displacement):\n${lines.join('\n')}${pauseNote}`
      : `📊 *No pending setups* right now — clean slate.${pauseNote}`
    );
  }

  // ── /pause ──
  else if(cmd==='/pause'){
    const hours=Math.max(0.25, Math.min(72, parseFloat(args[0])||4));
    const until=Math.floor(Date.now()/1000)+hours*3600;
    await env.STATE.put('pause_until',String(until),{expirationTtl:Math.ceil(hours*3600)+120});
    const d=new Date((until+IST)*1000);
    const untilStr=`${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} IST`;
    await tg(env,`⏸ *Alerts paused* for ${hours}h (until ${untilStr})\nUse /unpause to resume early.`);
  }

  // ── /unpause ──
  else if(cmd==='/unpause'){
    await env.STATE.delete('pause_until');
    await tg(env,'▶️ *Alerts resumed.* Next scan fires at next 30-min mark.');
  }

  // ── /forcescan ──
  else if(cmd==='/forcescan'){
    const bo=blackoutInfo(Math.floor(Date.now()/1000));
    if(bo){
      await tg(env,
        `🚫 *Scan blocked — FOMC/NFP blackout*\n`+
        `_${bo}_\n\n`+
        `No entry alerts are sent within 60 min before or 90 min after high-impact US events.\n`+
        `Alerts will resume automatically when the window clears.`
      );
    } else {
      await tg(env,'⚡ *Force scan triggered* — checking 6 instruments on 30m...');
      try{ await run30mScan(env,true); }    // force=true: bypass KZ guard + pause
      catch(e){ await tg(env,'⚠️ Scan error: '+(e.message||e)); }
    }
  }

  // ── /stats ──
  else if(cmd==='/stats'){
    const sync=await getJSON(env,'sync_state');
    const cfg=await getJSON(env,'learned_config')||{};
    const perf=await getJSON(env,'perf_state');
    const total=perf?.total||sync?.count||0;

    // ── Global learned rules (what the scanner has silently applied) ──
    const g=cfg._global;
    const gLines=[];
    if(g?.d1Required)    gLines.push('🔒 D1 alignment required');
    if(g?.avoidMT)       gLines.push('⛔ Mean Threshold setups filtered');
    if(g?.ifvgBoosts)    gLines.push('⭐ IFVG setups flagged as high-edge');
    if(g?.minZoneStack>1)gLines.push(`📚 Zone stack ≥${g.minZoneStack} required`);
    const globalBlock=gLines.length
      ? `\n*Scanner rules (learned):*\n${gLines.map(l=>`  ${l}`).join('\n')}`
      : '';

    // ── Session breakdown ──
    const sessLines=Object.entries(perf?.sessions||{})
      .filter(([,v])=>v.n>=3)
      .sort((a,b)=>(b[1].wr??0)-(a[1].wr??0))
      .map(([k,v])=>`  ${k}: ${v.wr??'?'}% WR · ${v.avgR>=0?'+':''}${v.avgR}R (${v.n})`);
    const sessBlock=sessLines.length
      ? `\n*Sessions:*\n${sessLines.join('\n')}`
      : '';

    // ── HTF alignment ──
    const htf=perf?.htf;
    const htfBlock=(htf?.all3?.n>=5||htf?.h4h1?.n>=5)
      ? `\n*HTF alignment:*\n  D1+H4+H1: ${htf.all3?.wr??'?'}% WR (${htf.all3?.n||0}) | H4+H1: ${htf.h4h1?.wr??'?'}% WR (${htf.h4h1?.n||0})`
      : '';

    // ── Per-pair breakdown ──
    const allPairs=[...new Set([...INSTR_30M.map(x=>x[0]),...INSTR.map(x=>x[0])])];
    const pairLines=[];
    for(const p of allPairs){
      const ins=perf?.pairs?.[p]; const rule=cfg?.[p];
      if(!ins||ins.n<3) continue;
      const emoji=ins.n>=10&&ins.wr<40?'⛔':ins.wr>=70?'✅':ins.wr<50?'⚠️':'📊';
      let line=`${emoji} *${p}:* ${ins.wr}% WR · ${ins.avgR>=0?'+':''}${ins.avgR}R · ${ins.n} trades`;
      const dirs=Object.entries(ins.byDir||{}).filter(([,v])=>v.n>=2).map(([d,v])=>`${d}s:${v.wr??'?'}%(${v.n})`);
      if(dirs.length) line+=`\n    ${dirs.join(' | ')}`;
      const kzs=Object.entries(ins.byKZ||{}).filter(([,v])=>v.n>=2).map(([k,v])=>`${k}:${v.wr??'?'}%(${v.n})`);
      if(kzs.length) line+=`\n    ${kzs.join(' | ')}`;
      const ruleNotes=[];
      if(rule?.skipDirs?.length) ruleNotes.push(`⛔ skip ${rule.skipDirs.join('+')}`);
      if(rule?.preferredKZ) ruleNotes.push(`🕐 prefer ${rule.preferredKZ}`);
      if(rule?.skipKZ?.length) ruleNotes.push(`⛔ skip ${rule.skipKZ.join('+')} KZ`);
      if(rule?.skipDows?.length) ruleNotes.push(`📅 skip ${rule.skipDows.map(d=>DOW_NAME[d]).join('/')}`);
      if(!ruleNotes.length) ruleNotes.push(ins.n>=8?'✅ no restrictions':'📈 learning…');
      line+=`\n    _${ruleNotes.join(' · ')}_`;
      pairLines.push(line);
    }
    const pairBlock=pairLines.length?'\n\n'+pairLines.join('\n\n'):'\n\n_No trades synced yet._';

    await tg(env,
      `📈 *Fed Forex — Live Edge* (${total} trades)`+
      globalBlock+sessBlock+htfBlock+
      pairBlock+
      `\n\n_Syncs 3×/day silently. Journal more trades → smarter rules._`
    );
  }
  // Unknown command — ignore silently (no reply to avoid spam)

  return new Response('ok');
}

// ═══════════════════════════════════════════════════════════════════════
// ── ROUTER ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
export default {
  async scheduled(event,env,ctx){
    const c=event.cron;
    try{
      if(c==="*/5 * * * *")           await Promise.allSettled([runLevels(env),runSilverBullet(env),runODR(env)]);
      else if(c==="*/30 * * * *")     await run30mScan(env);      // V3: 30m replaces M15
      else if(c==="43 5 * * *")       await runScan1H(env,"London");
      else if(c==="27 10 * * *")      await runScan1H(env,"NY-AM");
      else if(c==="47 7,15,20 * * *") await runSync(env);
    }catch(e){ await tg(env,"⚠️ Worker error: "+(e.message||e)); }
  },
  async fetch(req,env,ctx){
    const u=new URL(req.url);

    // ── Telegram webhook (POST /tg) ──
    if(u.pathname==="/tg") return handleTgUpdate(req,env);

    // ── TradingView webhook (POST /tv) ──
    if(u.pathname==="/tv"){
      if(env.TV_SECRET&&u.searchParams.get("k")!==env.TV_SECRET)return new Response("forbidden",{status:403});
      let body=""; try{body=(await req.text())||"";}catch(e){}
      if(body.trim())await tg(env,"📺 *TradingView alert*\n"+body.trim());
      return new Response("ok");
    }

    const run=u.searchParams.get("run");

    // Register Telegram webhook (one-time setup after deploy)
    if(run==="setwh"){
      if(!env.TG_TOKEN)return new Response("TG_TOKEN not set",{status:500});
      const wh=u.origin+"/tg";
      const r=await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/setWebhook`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({url:wh,allowed_updates:["message"]})
      });
      return Response.json(await r.json());
    }

    if(run==="levels"){ await runLevels(env); return new Response("levels ran"); }
    if(run==="30m"){    await run30mScan(env,true); return new Response("30m scan ran"); }
    if(run==="sb2"){    await runSilverBullet(env); return new Response("SilverBullet scan ran"); }
    if(run==="odr"){    await runODR(env); return new Response("ODR scan ran"); }
    if(run==="scan"){   await runScan1H(env,"manual"); return new Response("1H scan ran"); }
    if(run==="sync"){   await runSync(env); return new Response("sync ran"); }
    return new Response(
      "Fed Forex V3 worker — alive.\n"+
      "?run=levels | 30m | sb2 | odr | scan | sync | setwh\n"+
      "POST /tg — Telegram webhook  |  POST /tv — TradingView webhook\n"+
      "Bot commands: /status /pause /unpause /forcescan /stats /help\n\n"+
      "── Strategies ──\n"+
      "30m Sweep (77% WR): "+INSTR_30M.map(x=>x[0]).join(", ")+"\n"+
      "Silver Bullet 2-stage (67-83% WR): "+INSTR_SB2.map(x=>x[0]).join(", ")+"\n"+
      "ODR Asia Sweep (69-89% WR): "+INSTR_ODR.map(x=>x[0]).join(", ")+"\n\n"+
      "WEEKLY_BIAS="+WEEKLY_BIAS+" | WICK="+WICK+" | DOW_FILTER="+DOW_FILTER
    );
  }
};
