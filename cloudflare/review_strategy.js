'use strict';
// ═══════════════════════════════════════════════════════════════════════
// Fed Forex — Automated Strategy Review + Parameter Optimizer
// ───────────────────────────────────────────────────────────────────────
// Runs nightly via Windows Scheduled Task (auto-registered on first run).
// Triggers only when 10+ new replay trades are in Supabase.
//
// What it does every night:
//   1. Checks Supabase — exits silently if < 10 new trades
//   2. Fetches fresh Yahoo Finance data (current market conditions)
//   3. Re-runs full backtest with current params  ← BEFORE
//   4. Grid-searches param variations to find optimal settings
//   5. Picks best params (must improve WR ≥ 3% AND hold for ≥ 5 signals)
//   6. Re-runs backtest with best params           ← AFTER
//   7. Cross-refs actual replay trades vs backtest (spots real-vs-model gaps)
//   8. Sends Telegram before/after report
//   9. Pushes updated params to Cloudflare KV (if CF credentials set)
//  10. Saves state for next comparison
//
// First-time setup:   node review_strategy.js --setup
// Manual run:         node review_strategy.js --force
// ═══════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── CONFIG — fill in credentials once ────────────────────────────────────
const CFG = {
  supabaseUrl  : 'https://hcavvfmunwjxxkwsmmaw.supabase.co',
  supabaseKey  : process.env.SUPABASE_KEY  || '',
  tgToken      : process.env.TG_TOKEN      || '',
  tgChat       : process.env.TG_CHAT       || '5945486829',
  // Optional — Cloudflare API for auto-pushing optimized params to worker
  // Get these from: dash.cloudflare.com → Workers & Pages → your worker → Settings
  cfAccountId  : process.env.CF_ACCOUNT_ID || '',
  cfApiToken   : process.env.CF_API_TOKEN  || '',
  cfKvNsId     : process.env.CF_KV_NS_ID   || '',  // STATE namespace ID
  // Trigger
  minNewTrades : 10,
  stateFile    : path.join(__dirname, 'review_state.json'),
};

const IST = 5.5 * 3600;

// Proven pairs per strategy (backtest v2 — only run on these)
const SB2_PAIRS   = ['GBPJPY','EURUSD','ETHUSD','EURJPY'];
const ODR_PAIRS   = ['ETHUSD','EURUSD','GBPUSD'];
const SWEEP_PAIRS = ['AUDUSD','BTCUSD','ETHUSD','GBPJPY','GBPUSD','USDJPY','EURUSD','EURJPY','GOLD'];

const ALL_PAIRS = [
  ['AUDUSD','AUDUSD=X'],['BTCUSD','BTC-USD'],['ETHUSD','ETH-USD'],
  ['GBPJPY','GBPJPY=X'],['GBPUSD','GBPUSD=X'],['USDJPY','JPY=X'],
  ['EURUSD','EURUSD=X'],['EURJPY','EURJPY=X'],['GOLD','GC=F'],
];

// Original backtest baseline WR (used as the "before" on first run ever)
const ORIGINAL_BT = {
  SB2  : {GBPJPY:83, EURUSD:75, ETHUSD:71, EURJPY:67},
  ODR  : {ETHUSD:89, EURUSD:80, GBPUSD:69},
  Sweep: {overall:77},
};

// ─── PARAMETER SEARCH GRID ────────────────────────────────────────────────
// Optimizer tests every combination and picks the one with highest
// WR on proven pairs (minimum 5 signals — avoids overfitting thin data)
const GRIDS = {
  Sweep: {
    wickMin : [0.45, 0.50, 0.55, 0.60],
    dispMin : [0.25, 0.30, 0.35],
  },
  SB2: {
    fvgMult : [0.10, 0.15, 0.20, 0.25],
    dispMin : [0.45, 0.50, 0.55],
  },
  ODR: {
    wickMin      : [0.40, 0.45, 0.50, 0.55],
    rangeFilter  : [0.70, 0.80, 0.90],
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function yf(sym, range, interval) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (r.status === 429) { await sleep(5000 * (t + 1)); continue; }
      const j = await r.json();
      const res = j.chart?.result?.[0]; if (!res) return null;
      const q = res.indicators.quote[0];
      const bars = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if ([q.open[i],q.high[i],q.low[i],q.close[i]].some(x => x == null || isNaN(x))) continue;
        const d = new Date((res.timestamp[i] + IST) * 1000);
        bars.push({ t:res.timestamp[i], day:d.toISOString().slice(0,10),
          min:d.getUTCHours()*60+d.getUTCMinutes(), dow:d.getUTCDay(),
          o:q.open[i], h:q.high[i], l:q.low[i], c:q.close[i] });
      }
      return bars;
    } catch (e) { await sleep(2000); }
  }
  return null;
}

function resample(B, secs) {
  const m = new Map();
  for (const b of B) {
    const k = Math.floor((b.t + IST) / secs);
    if (!m.has(k)) m.set(k, { t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,min:b.min,dow:b.dow,day:b.day });
    else { const x = m.get(k); x.h = Math.max(x.h,b.h); x.l = Math.min(x.l,b.l); x.c = b.c; }
  }
  return [...m.values()].sort((a,b) => a.t - b.t);
}

function emaArr(c, p) {
  const k = 2/(p+1); const o = [c[0]];
  for (let i = 1; i < c.length; i++) o.push(c[i]*k + o[i-1]*(1-k));
  return o;
}

function atrRolling(B, n=20) {
  const out = [];
  for (let i = 0; i < B.length; i++) {
    if (i === 0) { out.push(B[i].h - B[i].l); continue; }
    const s = Math.max(0, i-n); let sum=0, cnt=0;
    for (let j=s+1; j<=i; j++) {
      sum += Math.max(B[j].h-B[j].l, Math.abs(B[j].h-B[j-1].c), Math.abs(B[j].l-B[j-1].c));
      cnt++;
    }
    out.push(cnt ? sum/cnt : B[i].h-B[i].l);
  }
  return out;
}

function precomputeTrends(B1h) {
  const h4B=resample(B1h,14400), d1B=resample(B1h,86400);
  const h4E=emaArr(h4B.map(b=>b.c),10), h1E=emaArr(B1h.map(b=>b.c),10), d1E=emaArr(d1B.map(b=>b.c),10);
  const out=[]; let h4p=0, d1p=0;
  for (let i=0; i<B1h.length; i++) {
    const t = B1h[i].t;
    while (h4p+1<h4B.length && h4B[h4p+1].t<=t) h4p++;
    while (d1p+1<d1B.length && d1B[d1p+1].t<=t) d1p++;
    out.push({ t,
      h4: h4B[h4p].c >= h4E[h4p] ? 'bull':'bear',
      h1: B1h[i].c  >= h1E[i]    ? 'bull':'bear',
      d1: d1B[d1p].c>= d1E[d1p]  ? 'bull':'bear',
    });
  }
  return out;
}

function getTrend(trends, t) {
  let lo=0, hi=trends.length-1, res=trends[0];
  while (lo<=hi) { const m=(lo+hi)>>1; if(trends[m].t<=t){res=trends[m];lo=m+1;}else hi=m-1; }
  return res;
}

function simulate(bars, idx, dir, entry, sl, maxBars=60) {
  const risk = Math.abs(entry - sl);
  if (risk<=0 || risk>entry*0.15) return { outcome:'Invalid', R:0 };
  const tp1=dir==='long'?entry+risk:entry-risk;
  const tp2=dir==='long'?entry+1.7*risk:entry-1.7*risk;
  const tp3=dir==='long'?entry+2.56*risk:entry-2.56*risk;
  for (let i=idx+1; i<Math.min(idx+maxBars,bars.length); i++) {
    const b = bars[i];
    if (dir==='long') {
      if (b.l<=sl)  return { outcome:'Loss', R:-1 };
      if (b.h>=tp3) return { outcome:'Win',  R:2.56 };
      if (b.h>=tp2) return { outcome:'Win',  R:1.7 };
      if (b.h>=tp1) return { outcome:'Win',  R:1.0 };
    } else {
      if (b.h>=sl)  return { outcome:'Loss', R:-1 };
      if (b.l<=tp3) return { outcome:'Win',  R:2.56 };
      if (b.l<=tp2) return { outcome:'Win',  R:1.7 };
      if (b.l<=tp1) return { outcome:'Win',  R:1.0 };
    }
  }
  return { outcome:'Timeout', R:0 };
}

function stats(trades) {
  const dec = trades.filter(t => t.outcome==='Win'||t.outcome==='Loss');
  const w   = dec.filter(t => t.outcome==='Win');
  return {
    n      : trades.length,
    decided: dec.length,
    wins   : w.length,
    wr     : dec.length ? Math.round(w.length/dec.length*100) : 0,
    avgR   : dec.length ? +(dec.reduce((s,t)=>s+t.R,0)/dec.length).toFixed(2) : 0,
  };
}

// ─── STRATEGY RUNNERS (parameterized) ─────────────────────────────────────

function run_Sweep(B15m, B1h, trends, { wickMin=0.55, dispMin=0.30 }={}) {
  const B30m = resample(B15m, 1800);
  const D1   = resample(B1h,  86400);
  const LOOK = 4; const trades = [];
  for (let i=LOOK+1; i<B30m.length-1; i++) {
    const b = B30m[i];
    const inL = b.min>=720&&b.min<930, inN = b.min>=1020&&b.min<1260;
    if (!inL&&!inN) continue;
    if (b.dow===0||b.dow===6) continue;
    const tr = getTrend(trends, b.t);
    if (!tr||tr.h4!==tr.h1) continue;
    const recent = B30m.slice(i-LOOK,i);
    const rl = Math.min(...recent.map(x=>x.l)), rh = Math.max(...recent.map(x=>x.h));
    const range = (b.h-b.l)||1;
    const d1s = D1.filter(x=>x.t<=b.t).slice(-5);
    const eq  = d1s.length>=2 ? (Math.max(...d1s.map(x=>x.h))+Math.min(...d1s.map(x=>x.l)))/2 : b.c;
    let dir=null, sl;
    if (b.l<rl && b.c>rl && b.c<eq) {
      const wp = (Math.min(b.o,b.c)-b.l)/range;
      if (wp>=wickMin && tr.h4==='bull') { dir='long'; sl=b.l; }
    } else if (b.h>rh && b.c<rh && b.c>eq) {
      const wp = (b.h-Math.max(b.o,b.c))/range;
      if (wp>=wickMin && tr.h4==='bear') { dir='short'; sl=b.h; }
    }
    if (!dir) continue;
    const nb = B30m[i+1]; const bR=(nb.h-nb.l)||1;
    const ok = dir==='long'
      ? ((nb.c-nb.l)/bR>=0.55 && Math.abs(nb.c-nb.o)>=dispMin*bR)
      : ((nb.h-nb.c)/bR>=0.55 && Math.abs(nb.c-nb.o)>=dispMin*bR);
    if (!ok) continue;
    trades.push(simulate(B30m, i+1, dir, nb.c, sl));
  }
  return trades;
}

function run_SB2(B15m, trends, { fvgMult=0.15, dispMin=0.25 }={}) {
  const trades = [];
  const inWin  = min => (min>=450&&min<=570)||(min>=930&&min<=990)||(min>=1170&&min<=1230);
  const atr15  = atrRolling(B15m, 20);
  const fvgs=[]; const pend=[];
  for (let i=2; i<B15m.length; i++) {
    const b = B15m[i];
    if (b.dow===0||b.dow===6) continue;
    const tr  = getTrend(trends, b.t);
    if (!tr||tr.h4!==tr.h1) continue;
    const atr = atr15[i]||b.c*0.001;
    while (fvgs.length && i-fvgs[0].fi>10) fvgs.shift();
    // Stage 2 check
    for (let pi=pend.length-1; pi>=0; pi--) {
      const p = pend[pi];
      if (i-p.touchI>2) { pend.splice(pi,1); continue; }
      if (i===p.touchI+1) {
        const bR=(b.h-b.l)||1;
        const ok = p.dir==='long'
          ? ((b.c-b.l)/bR>=0.55 && Math.abs(b.c-b.o)>=dispMin*atr)
          : ((b.h-b.c)/bR>=0.55 && Math.abs(b.c-b.o)>=dispMin*atr);
        if (ok) { pend.splice(pi,1); trades.push(simulate(B15m,i,p.dir,b.c,p.sl)); }
      }
    }
    if (inWin(b.min)) {
      const p2 = B15m[i-2];
      const fgUp=b.l-p2.h, fgDn=p2.l-b.h;
      if (fgUp>atr*fvgMult && tr.h4==='bull')
        fvgs.push({ dir:'long',  lo:p2.h, hi:b.l,  fi:i, used:false });
      if (fgDn>atr*fvgMult && tr.h4==='bear')
        fvgs.push({ dir:'short', lo:b.h,  hi:p2.l, fi:i, used:false });
      for (const fvg of fvgs) {
        if (fvg.used||i<=fvg.fi) continue;
        const touched = fvg.dir==='long'
          ? (b.l<=fvg.hi&&b.c>=fvg.lo) : (b.h>=fvg.lo&&b.c<=fvg.hi);
        if (touched) {
          fvg.used=true;
          const gap=fvg.hi-fvg.lo;
          pend.push({ dir:fvg.dir, sl:fvg.dir==='long'?fvg.lo-gap*0.5:fvg.hi+gap*0.5, touchI:i });
          break;
        }
      }
    }
  }
  return trades;
}

function run_ODR(B15m, B1h, trends, { wickMin=0.45, rangeFilter=0.80 }={}) {
  const trades  = [];
  const D1      = resample(B1h, 86400);
  const d1atr   = atrRolling(D1, 20);
  const d1atrMap= new Map(D1.map((b,i) => [b.day, d1atr[i]]));
  const days    = [...new Set(B15m.map(b=>b.day))];
  for (const day of days) {
    const db   = B15m.filter(b=>b.day===day);
    const asia = db.filter(b=>b.min>=30&&b.min<=330);
    if (asia.length<4) continue;
    const aHi=Math.max(...asia.map(b=>b.h)), aLo=Math.min(...asia.map(b=>b.l));
    const aRange=aHi-aLo; if(aRange<=0) continue;
    const dAtr = d1atrMap.get(day)||aRange*2;
    if (aRange>dAtr*rangeFilter) continue;
    const lon = db.filter(b=>b.min>330&&b.min<=510);
    for (let j=0; j<lon.length; j++) {
      const b  = lon[j];
      const tr = getTrend(trends, b.t); if(!tr) continue;
      const range=(b.h-b.l)||1;
      const gi = B15m.indexOf(b); if(gi<0) continue;
      if (b.l<aLo && b.c>aLo && tr.h4==='bull') {
        const wp=(Math.min(b.o,b.c)-b.l)/range;
        if (wp>=wickMin) trades.push(simulate(B15m,gi,'long', b.c,b.l));
      }
      if (b.h>aHi && b.c<aHi && tr.h4==='bear') {
        const wp=(b.h-Math.max(b.o,b.c))/range;
        if (wp>=wickMin) trades.push(simulate(B15m,gi,'short',b.c,b.h));
      }
    }
  }
  return trades;
}

// ─── OPTIMIZER ────────────────────────────────────────────────────────────
// Scores a param combo: WR × log2(n+1) — rewards high WR with enough signals
function score(wr, n) { return n>=5 ? wr * Math.log2(n+1) : 0; }

function optimizeStrategy(stratName, dataMap, currentParams) {
  const grid = GRIDS[stratName];
  const provenPairs = stratName==='SB2'?SB2_PAIRS : stratName==='ODR'?ODR_PAIRS:SWEEP_PAIRS;
  const paramKeys   = Object.keys(grid);

  // Build all combinations
  const combos = [{}];
  for (const key of paramKeys) {
    const next = [];
    for (const c of combos)
      for (const v of grid[key])
        next.push({ ...c, [key]:v });
    combos.length=0; combos.push(...next);
  }

  let bestCombo=currentParams, bestScore=-1, bestWR=0, bestN=0;

  for (const combo of combos) {
    let totalWins=0, totalDec=0;
    for (const pairName of provenPairs) {
      const d = dataMap[pairName]; if(!d) continue;
      let trades;
      if (stratName==='Sweep') trades=run_Sweep(d.b15m,d.b1h,d.trends,combo);
      else if (stratName==='SB2') trades=run_SB2(d.b15m,d.trends,combo);
      else trades=run_ODR(d.b15m,d.b1h,d.trends,combo);
      const s=stats(trades); totalWins+=s.wins; totalDec+=s.decided;
    }
    const wr  = totalDec ? Math.round(totalWins/totalDec*100) : 0;
    const sc  = score(wr, totalDec);
    if (sc>bestScore) { bestScore=sc; bestCombo=combo; bestWR=wr; bestN=totalDec; }
  }

  return { params:bestCombo, wr:bestWR, n:bestN };
}

// ─── BACKTEST — run all 3 strategies with given params ────────────────────
function runFullBacktest(dataMap, params) {
  const results = { SB2:{}, ODR:{}, Sweep:{} };

  for (const pairName of SB2_PAIRS) {
    const d = dataMap[pairName]; if(!d) continue;
    results.SB2[pairName] = stats(run_SB2(d.b15m, d.trends, params.SB2));
  }
  for (const pairName of ODR_PAIRS) {
    const d = dataMap[pairName]; if(!d) continue;
    results.ODR[pairName] = stats(run_ODR(d.b15m, d.b1h, d.trends, params.ODR));
  }
  let swpAll=[];
  for (const pairName of SWEEP_PAIRS) {
    const d = dataMap[pairName]; if(!d) continue;
    swpAll = swpAll.concat(run_Sweep(d.b15m, d.b1h, d.trends, params.Sweep));
  }
  results.Sweep.overall = stats(swpAll);
  return results;
}

// ─── STATE ────────────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(CFG.stateFile,'utf8')); } catch(_) { return null; }
}
function saveState(s) { fs.writeFileSync(CFG.stateFile, JSON.stringify(s,null,2)); }

// ─── SUPABASE ─────────────────────────────────────────────────────────────
async function fetchTrades() {
  if (!CFG.supabaseKey) { console.log('⚠️  SUPABASE_KEY not set — skipping replay cross-ref'); return []; }
  const H = { apikey:CFG.supabaseKey, Authorization:`Bearer ${CFG.supabaseKey}` };
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/replay_trades?select=id,data&order=id`, { headers:H });
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map(r=>r.data).filter(Boolean) : [];
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────
async function sendTg(msg) {
  if (!CFG.tgToken) { console.log('[TG]', msg); return; }
  try {
    await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id:CFG.tgChat, text:msg, parse_mode:'Markdown', disable_web_page_preview:true })
    });
  } catch(e) { console.error('Telegram error:', e.message); }
}

// ─── CLOUDFLARE KV PUSH ───────────────────────────────────────────────────
async function pushKV(key, value) {
  if (!CFG.cfAccountId||!CFG.cfApiToken||!CFG.cfKvNsId) return false;
  try {
    const url=`https://api.cloudflare.com/client/v4/accounts/${CFG.cfAccountId}/storage/kv/namespaces/${CFG.cfKvNsId}/values/${key}`;
    const r = await fetch(url, {
      method:'PUT',
      headers:{ Authorization:`Bearer ${CFG.cfApiToken}`, 'Content-Type':'application/json' },
      body: JSON.stringify(value)
    });
    const j = await r.json();
    return j.success===true;
  } catch(e) { return false; }
}

// ─── CROSS-REFERENCE: actual trades vs backtest ───────────────────────────
function crossRef(afterBT, replayTrades) {
  const insights = {};
  for (const t of replayTrades) {
    const p = t.pair; if(!p) continue;
    const isWin = t.outcome==='Win', isLoss = t.outcome==='Loss';
    if (!isWin&&!isLoss) continue;
    if (!insights[p]) insights[p]={n:0,w:0};
    insights[p].n++; if(isWin) insights[p].w++;
  }
  const gaps = [];
  for (const [p,v] of Object.entries(insights)) {
    if (v.n<3) continue;
    const actualWR = Math.round(v.w/v.n*100);
    // Find best backtest WR for this pair across strategies
    const btWR = Math.max(
      afterBT.SB2[p]?.wr  || 0,
      afterBT.ODR[p]?.wr  || 0,
      afterBT.Sweep.overall?.wr || 0
    );
    const gap = btWR - actualWR;
    gaps.push({ pair:p, actualWR, btWR, gap, n:v.n });
  }
  return gaps.sort((a,b) => b.gap - a.gap); // worst gaps first
}

// ─── REPORT BUILDER ───────────────────────────────────────────────────────
function buildReport(state, beforeBT, afterBT, beforeParams, afterParams, crossRefGaps, trades, newCount) {
  const lines = [];
  const reviewNum = (state?.reviewCount||0) + 1;
  lines.push(`🔬 *Strategy Review #${reviewNum} — ${newCount} new trades (${trades} total)*\n`);

  // ── Backtest before → after ──
  lines.push(`*Backtest WR — Before → After (fresh 60d data):*`);

  // SB2 per pair
  for (const p of SB2_PAIRS) {
    const b = beforeBT?.SB2?.[p]||{wr:ORIGINAL_BT.SB2[p]||0,n:0};
    const a = afterBT.SB2[p]||{wr:0,n:0};
    if (a.n<3) continue;
    const arrow = a.wr>b.wr+2?'▲':a.wr<b.wr-2?'▼':'→';
    const pChange = beforeParams?.SB2?.fvgMult!==afterParams.SB2?.fvgMult?` _(FVG ${beforeParams?.SB2?.fvgMult}→${afterParams.SB2.fvgMult})_`:'';
    lines.push(`• \`${p}\` SB2  ${b.wr}% → *${a.wr}%* ${arrow}  (${a.n} signals)${pChange}`);
  }

  // ODR per pair
  for (const p of ODR_PAIRS) {
    const b = beforeBT?.ODR?.[p]||{wr:ORIGINAL_BT.ODR[p]||0,n:0};
    const a = afterBT.ODR[p]||{wr:0,n:0};
    if (a.n<3) continue;
    const arrow = a.wr>b.wr+2?'▲':a.wr<b.wr-2?'▼':'→';
    const pChange = beforeParams?.ODR?.wickMin!==afterParams.ODR?.wickMin?` _(wick ${beforeParams?.ODR?.wickMin}→${afterParams.ODR.wickMin})_`:'';
    lines.push(`• \`${p}\` ODR  ${b.wr}% → *${a.wr}%* ${arrow}  (${a.n} signals)${pChange}`);
  }

  // 30m Sweep overall
  const bs = beforeBT?.Sweep?.overall||{wr:ORIGINAL_BT.Sweep.overall||77,n:0};
  const as = afterBT.Sweep.overall||{wr:0,n:0};
  if (as.n>=3) {
    const arrow = as.wr>bs.wr+2?'▲':as.wr<bs.wr-2?'▼':'→';
    const pChange = beforeParams?.Sweep?.wickMin!==afterParams.Sweep?.wickMin?` _(wick ${beforeParams?.Sweep?.wickMin}→${afterParams.Sweep.wickMin})_`:'';
    lines.push(`• 30m Sweep  ${bs.wr}% → *${as.wr}%* ${arrow}  (${as.n} signals)${pChange}`);
  }

  // ── Param changes ──
  const paramChanges = [];
  const stratKeys = ['Sweep','SB2','ODR'];
  for (const s of stratKeys) {
    const bp=beforeParams?.[s]||{}, ap=afterParams[s]||{};
    for (const [k,v] of Object.entries(ap)) {
      if (bp[k]!==undefined && bp[k]!==v)
        paramChanges.push(`  ${s} \`${k}\`: ${bp[k]} → *${v}*`);
    }
  }
  if (paramChanges.length) {
    lines.push(`\n*🔧 Params auto-updated (improved WR ≥ 3%):*`);
    for (const c of paramChanges) lines.push(c);
  } else {
    lines.push(`\n_Params unchanged — current settings still optimal._`);
  }

  // ── Cross-reference: actual vs backtest ──
  if (crossRefGaps.length) {
    lines.push(`\n*Your actual trades vs backtest:*`);
    for (const g of crossRefGaps.slice(0,5)) {
      const status = g.gap>15 ? '⚠️  underperforming' : g.gap<-10 ? '🌟 beating backtest' : '✅ on track';
      lines.push(`• \`${g.pair}\`  actual ${g.actualWR}% vs BT ${g.btWR}%  ${status}  (${g.n} trades)`);
    }
    // Flag pairs to investigate
    const badPairs = crossRefGaps.filter(g=>g.gap>15&&g.n>=5);
    if (badPairs.length) {
      lines.push(`\n_⚠️ ${badPairs.map(g=>g.pair).join(', ')} consistently underperforming backtest — check your execution vs the strategy rules._`);
    }
  }

  lines.push(`\n_Next review triggers at ${trades+10} total trades._`);
  return lines.join('\n');
}

// ─── WINDOWS SCHEDULED TASK SETUP ─────────────────────────────────────────
function setupWindowsTask() {
  const scriptPath = path.resolve(__filename);
  const nodeExe    = process.execPath;
  // Runs daily at 02:00 IST = 20:30 UTC previous day = 20:30 local if on IST machine
  const cmd = `schtasks /create /tn "FedForex_StrategyReview" /tr "${nodeExe} ${scriptPath}" /sc daily /st 02:00 /f`;
  try {
    execSync(cmd, { stdio:'inherit' });
    console.log('✅ Windows task "FedForex_StrategyReview" registered — runs daily at 02:00 AM IST');
  } catch(e) {
    console.error('❌ Could not register task (run as Administrator):', e.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  const args   = process.argv.slice(2);
  const force  = args.includes('--force');
  const setup  = args.includes('--setup');

  if (setup) { setupWindowsTask(); return; }

  // ── Load state ──
  const state = loadState();

  // ── Check Supabase for new trades ──
  process.stdout.write('Checking Supabase...');
  const trades = await fetchTrades();
  const lastReviewTotal = state?.lastReviewTotal || 0;
  const newSinceReview  = trades.length - lastReviewTotal;
  process.stdout.write(` ${trades.length} trades (${newSinceReview} new since last review)\n`);

  if (!force && newSinceReview < CFG.minNewTrades) {
    console.log(`⏭  Need ${CFG.minNewTrades-newSinceReview} more trades to trigger review. Exiting.`);
    return;
  }

  console.log(`\n🔬 ${force?'[FORCED] ':''}Running strategy review with ${trades.length} trades...\n`);

  // ── Fetch market data ──
  const dataMap = {};
  for (const [pairName, sym] of ALL_PAIRS) {
    process.stdout.write(`  Fetching ${pairName}...`);
    const b15m = await yf(sym,'60d','15m');
    await sleep(300);
    const b1h  = await yf(sym,'730d','1h');
    await sleep(300);
    if (!b15m||!b1h) { console.log(' ❌ failed, skipping'); continue; }
    const trends = precomputeTrends(b1h);
    dataMap[pairName] = { b15m, b1h, trends };
    console.log(` ✓  ${b15m.length}×15m  ${b1h.length}×1H`);
  }

  // ── Current params (from state or defaults) ──
  const beforeParams = state?.bestParams || {
    Sweep: { wickMin:0.55, dispMin:0.30 },
    SB2  : { fvgMult:0.15, dispMin:0.25 },
    ODR  : { wickMin:0.45, rangeFilter:0.80 },
  };

  // ── BEFORE: backtest with current params ──
  console.log('\n📊 Running BEFORE backtest (current params)...');
  const beforeBT = state?.lastBT || runFullBacktest(dataMap, beforeParams);

  // ── OPTIMIZE: find best params for each strategy ──
  console.log('🔍 Optimizing parameters...');
  const afterParams = {};
  for (const strat of ['Sweep','SB2','ODR']) {
    process.stdout.write(`  Optimizing ${strat}...`);
    const opt = optimizeStrategy(strat, dataMap, beforeParams[strat]);
    // Only apply if WR improvement >= 3% vs current
    const currentWR = strat==='Sweep'
      ? beforeBT.Sweep.overall?.wr||77
      : Object.values(beforeBT[strat]||{}).reduce((s,v)=>s+v.wr,0)/Math.max(1,Object.keys(beforeBT[strat]||{}).length);
    if (opt.wr >= currentWR+3 && opt.n>=5) {
      afterParams[strat] = opt.params;
      console.log(` ✅ ${currentWR}% → ${opt.wr}% (+${opt.wr-currentWR}%)`);
    } else {
      afterParams[strat] = beforeParams[strat];
      console.log(` → ${currentWR}% (no improvement, keeping current params)`);
    }
  }

  // ── AFTER: backtest with optimized params ──
  console.log('\n📊 Running AFTER backtest (optimized params)...');
  const afterBT = runFullBacktest(dataMap, afterParams);

  // ── Cross-reference: actual trades vs backtest ──
  console.log('\n🔀 Cross-referencing actual trades vs backtest...');
  const gaps = crossRef(afterBT, trades);

  // ── Build and send report ──
  const report = buildReport(state, beforeBT, afterBT, beforeParams, afterParams, gaps, trades.length, newSinceReview);
  console.log('\n' + '═'.repeat(70));
  console.log(report.replace(/\*/g,'').replace(/`/g,'').replace(/_/g,''));
  console.log('═'.repeat(70) + '\n');
  await sendTg(report);

  // ── Push optimized params to Cloudflare KV ──
  const cfPushed = await pushKV('opt_params', afterParams);
  if (cfPushed) {
    console.log('✅ Optimized params pushed to Cloudflare KV (opt_params)');
    await sendTg('_✅ Optimized params pushed to Cloudflare — worker updated automatically._');
  } else if (CFG.cfAccountId) {
    console.log('⚠️  Cloudflare push failed — check CF_ACCOUNT_ID / CF_API_TOKEN / CF_KV_NS_ID');
  }

  // ── Save state ──
  saveState({
    lastReviewTotal : trades.length,
    reviewCount     : (state?.reviewCount||0) + 1,
    bestParams      : afterParams,
    lastBT          : afterBT,
    lastRunAt       : new Date().toISOString(),
  });

  console.log(`✅ Done — next review after ${trades.length + CFG.minNewTrades} total trades.`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
