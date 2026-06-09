// backtest20.js — V3 Research
// Tests: prior-day midpoint, narrow KZ (Silver Bullet), signal scoring, 30-min timeframe
// V2 champions (bt19): 1H+weekly=83.0% WR | M15+DOW=71.4% WR
// V3 goal: 73%+ WR on M15 while maintaining ≥80 signals/yr across portfolio
'use strict';
const IST = 5.5*3600, fs = require('fs');
const D1H  = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';
const DM15 = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_m15/';

// ── helpers ─────────────────────────────────────────────────────────────────
function load(name, dir) {
  const p = `${dir}${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t:x.t, day:d.toISOString().slice(0,10),
             min:d.getUTCHours()*60+d.getUTCMinutes(), dow:d.getUTCDay(),
             o:x.o, h:x.h, l:x.l, c:x.c };
  });
}
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function atr(B,k,n=14){ let s=0,c=0; for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
function rsC(B,secs){ const m=new Map(); for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}} return[...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c})); }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:'sup',lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:'res',lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});} for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:'sup',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:'res',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});} return z; }
function emaSer(TS){ const e=ema(TS.map(x=>x.c),10); return TS.map((b,i)=>({end:b.end,v:e[i]})); }
function trendAt(s,te,price){ let v=null; for(const x of s){if(x.end<=te)v=x.v;else break;} return v==null?null:(price>=v?'bull':'bear'); }

// ── tiered exit ─────────────────────────────────────────────────────────────
function mgmt(B, k, dir, entry, sl, tp1, tp2, tp3, maxBars) {
  tp1=tp1||1; tp2=tp2||1.7; tp3=tp3||2.56; maxBars=maxBars||72;
  const risk=Math.abs(entry-sl); if(risk<=0) return 0;
  const parts=[{f:1/3,r:tp1},{f:1/3,r:tp2},{f:1/3,r:tp3}];
  const done=[false,false,false]; let rem=1,real=0,stop=sl,be=false;
  for(let i=k+1; i<B.length&&i<k+maxBars; i++){
    const b=B[i];
    if(dir==='long'?b.l<=stop:b.h>=stop){ real+=rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk); rem=0; break; }
    for(let ti=0;ti<3;ti++){ if(done[ti])continue; const tp=dir==='long'?entry+parts[ti].r*risk:entry-parts[ti].r*risk;
      if(dir==='long'?b.h>=tp:b.l<=tp){ real+=parts[ti].f*parts[ti].r; rem-=parts[ti].f; done[ti]=true; if(!be){stop=entry;be=true;} } }
    if(rem<=1e-9)break;
  }
  if(rem>1e-9){ const last=B[Math.min(k+maxBars-1,B.length-1)];
    real+=rem*Math.max(-1,Math.min(tp3,(dir==='long'?(last.c-entry):(entry-last.c))/risk)); }
  return real;
}

// ── resample M15 → 30-min bars with full metadata ───────────────────────────
// Groups M15 bars into 30-min slots (IST-aligned). Produces bars with:
//   t = start of slot (UTC), end = end of slot (UTC), day/min/dow from slot start.
// KZ NOTE: due to 30-min slot boundaries, London bars have min starting at 720 (12:00 IST)
// even though London opens at 12:15 IST. Use london30/nyam30 in run30m.
function resample30m(BM15) {
  const raw = rsC(BM15, 1800);
  return raw.map(x => {
    const tStart = x.end - 1800;
    const d = new Date((tStart + IST) * 1000);
    return { t:tStart, end:x.end,
             day:d.toISOString().slice(0,10),
             min:d.getUTCHours()*60+d.getUTCMinutes(),
             dow:d.getUTCDay(),
             o:x.o, h:x.h, l:x.l, c:x.c };
  });
}

// ── instrument cache ─────────────────────────────────────────────────────────
// OPTIMIZATION: precompute per-bar lookup arrays ONCE per instrument so the
// inner strategy loop is O(1) per bar instead of O(n) for filter/trendAt scans.
const CACHE = {};
function precompute(B, Dc, H4c, H1c, Wc, Da, H4a, H1a) {
  // For each bar index k, precompute:
  //   tD1[k], tH4[k], tH1[k] — 'bull'|'bear'|null based on close vs EMA
  //   dIdx[k] — number of completed daily bars before B[k].t  (Dc[dIdx[k]-1] = last day)
  //   wIdx[k] — number of completed weekly bars before B[k].t (Wc[wIdx[k]-1] = last week)
  const n = B.length;
  const tD1 = new Array(n).fill(null);
  const tH4 = new Array(n).fill(null);
  const tH1 = new Array(n).fill(null);
  const dIdx = new Int32Array(n);
  const wIdx = new Int32Array(n);
  let di=0, h4i=0, h1i=0, dci=0, wci=0;
  for (let k=0; k<n; k++) {
    const bt=B[k].t, bc=B[k].c;
    while (di  < Da.length  && Da[di].end   <= bt) di++;
    tD1[k] = di  > 0 ? (bc >= Da[di-1].v   ? 'bull':'bear') : null;
    while (h4i < H4a.length && H4a[h4i].end <= bt) h4i++;
    tH4[k] = h4i > 0 ? (bc >= H4a[h4i-1].v ? 'bull':'bear') : null;
    while (h1i < H1a.length && H1a[h1i].end <= bt) h1i++;
    tH1[k] = h1i > 0 ? (bc >= H1a[h1i-1].v ? 'bull':'bear') : null;
    while (dci < Dc.length  && Dc[dci].end  <= bt) dci++;  dIdx[k] = dci;
    while (wci < Wc.length  && Wc[wci].end  <= bt) wci++;  wIdx[k] = wci;
  }
  return {tD1,tH4,tH1,dIdx,wIdx};
}
// Separate precompute for 30-min bars (different timestamps, same zone/EMA data)
function precompute30(B30m, Dc, Da, H4a, H1a, Wc) {
  if (!B30m||!B30m.length) return null;
  const n=B30m.length;
  const tD1=new Array(n).fill(null),tH4=new Array(n).fill(null),tH1=new Array(n).fill(null);
  const dIdx=new Int32Array(n), wIdx=new Int32Array(n);
  let di=0,h4i=0,h1i=0,dci=0,wci=0;
  for (let k=0; k<n; k++) {
    const bt=B30m[k].t, bc=B30m[k].c;
    while(di  <Da.length  &&Da[di].end  <=bt)di++;   tD1[k]=di >0?(bc>=Da[di-1].v   ?'bull':'bear'):null;
    while(h4i <H4a.length &&H4a[h4i].end<=bt)h4i++;  tH4[k]=h4i>0?(bc>=H4a[h4i-1].v ?'bull':'bear'):null;
    while(h1i <H1a.length &&H1a[h1i].end<=bt)h1i++;  tH1[k]=h1i>0?(bc>=H1a[h1i-1].v ?'bull':'bear'):null;
    while(dci <Dc.length  &&Dc[dci].end <=bt)dci++;  dIdx[k]=dci;
    while(wci <Wc.length  &&Wc[wci].end <=bt)wci++;  wIdx[k]=wci;
  }
  return {tD1,tH4,tH1,dIdx,wIdx};
}

function inst(name, dir) {
  const key = `${dir}${name}`;
  if (CACHE[key]) return CACHE[key];
  const B = load(name, dir); if (!B) return null;
  const Dc=rsC(B,86400), H4c=rsC(B,14400), H2c=rsC(B,7200), H1c=rsC(B,3600), Wc=rsC(B,604800);
  const Z = {D:zones(Dc),'4H':zones(H4c),'2H':zones(H2c),'1H':zones(H1c)};
  const Da=emaSer(Dc), H4a=emaSer(H4c), H1a=emaSer(H1c);
  const B30m = (dir === DM15) ? resample30m(B) : null;
  const pre   = precompute(B,   Dc,H4c,H1c,Wc,Da,H4a,H1a);
  const pre30 = precompute30(B30m,Dc,Da,H4a,H1a,Wc);
  CACHE[key] = { B, Dc, Z, Da, H4a, H1a, Wc, B30m, ...pre, pre30 };
  return CACHE[key];
}

// ── signal score (0–11) ──────────────────────────────────────────────────────
// Called only when cfg.minScore is set. All hard filters (wick≥cfg.wick,
// stack≥cfg.stack, disp, kzOK, trendOK) already passed before scoring.
// wick:  ≥0.70→+3, ≥0.60→+2, ≥0.55→+1
// stack: 4TF→+3, 3TF→+2, 2TF→+1
// kz:    London→+2, NY-AM→+1
// DOW:   Tue/Wed/Thu→+1
// weekly bias aligned→+1, prior-day bias aligned→+1
function scoreSetup(wick, stkN, isLondon, b, weeklyOK, priorOK) {
  let s = 0;
  s += wick >= 0.70 ? 3 : wick >= 0.60 ? 2 : 1;
  s += stkN >= 4   ? 3 : stkN >= 3     ? 2 : 1;
  s += isLondon ? 2 : 1;
  if ([2,3,4].includes(b.dow)) s += 1;
  if (weeklyOK) s += 1;
  if (priorOK)  s += 1;
  return s; // max=11 (3+3+2+1+1+1)
}

// ── universal V3 engine ──────────────────────────────────────────────────────
// cfg flags (all optional):
//   disp:bool   — require displacement bar
//   kz:str      — 'both'(default) | 'london' | 'ny-am' | 'all3'
//   kzNarrow:bool — use only first 45min of each KZ (Silver Bullet windows)
//   wick:num    — minimum wick ratio (default 0.55)
//   stack:num   — minimum zone stack (default 2)
//   d1trend:bool — require D1+H4+H1 trend alignment (vs just H4+H1)
//   dow:bool    — Tue/Wed/Thu only
//   weekly:bool — require price below/above weekly open
//   priorDay:bool — require price below/above prior day's midpoint
//   minScore:num — require setup to score ≥ minScore (0–11)
//   tp1/tp2/tp3 — target multiples (default 1/1.7/2.56)
//   look:num    — lookback bars for swing high/low (default 6)
function runV3(name, cfg, dir) {
  dir = dir || D1H;
  const d = inst(name, dir); if (!d) return [];
  const {B, Dc, Z, Wc, tD1, tH4, tH1, dIdx, wIdx} = d;
  const LOOK = cfg.look || 6;
  const maxBars = (dir === DM15) ? 288 : 72;
  const tol = z => 0.25*(z.hi-z.lo) + 0.05;
  const stkFn = (poi,price,te) => {
    let n=0;
    for(const tf of ['D','4H','2H','1H'])
      if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;
    return n;
  };

  // Kill zone window definitions
  const london   = m => m>=735 && m<915;
  const nyam     = m => m>=1020 && m<1260;
  const asian    = m => m>=390  && m<510;
  const london45 = m => m>=735  && m<780;  // Silver Bullet: first 45 min
  const nyam45   = m => m>=1020 && m<1065;
  const kzOK = m => {
    if (cfg.kzNarrow) return london45(m) || nyam45(m);
    if (cfg.kz === 'london')  return london(m);
    if (cfg.kz === 'ny-am')   return nyam(m);
    if (cfg.kz === 'all3')    return london(m)||nyam(m)||asian(m);
    return london(m) || nyam(m); // 'both' (default)
  };

  const out = [], seen = new Set();
  for (let k=50; k<B.length-5; k++) {
    const b = B[k];
    if (!kzOK(b.min) || seen.has(b.day)) continue;
    if (cfg.dow && ![2,3,4].includes(b.dow)) continue;

    // ── O(1) lookups using precomputed index arrays ──
    const di = dIdx[k]; // Dc[0..di-1] are completed daily bars before b.t
    if (di < 5) continue;

    // 5-day dealing range from Dc[di-5..di-1]
    let drHi=-Infinity, drLo=Infinity;
    for (let i=di-5; i<di; i++) { if(Dc[i].h>drHi)drHi=Dc[i].h; if(Dc[i].l<drLo)drLo=Dc[i].l; }
    const eq = (drHi+drLo)/2;

    // Trend (O(1) — precomputed)
    const d1=tD1[k], h4=tH4[k], h1=tH1[k];
    if (!d1||!h4||!h1) continue;
    const trendOK = dir2 => cfg.d1trend
      ? (d1===dir2 && h4===dir2 && h1===dir2)
      : (h4===dir2 && h1===dir2);

    // Weekly open (O(1) — precomputed wIdx)
    const wi = wIdx[k];
    const wOpen = wi>0 ? Wc[wi-1].o : null;
    const weeklyBiasOK = dir2 =>
      !wOpen ? true : (dir2==='long' ? b.c < wOpen : b.c > wOpen);

    // Prior-day midpoint (O(1) — Dc[di-1] is last completed day)
    const prevD = Dc[di-1];
    const prevMid = (prevD.h+prevD.l)/2;
    const priorDayBiasOK = dir2 =>
      dir2==='long' ? b.c < prevMid : b.c > prevMid;

    if (k < LOOK) continue;
    const A = atr(B,k); if (A<=0) continue;
    const rl = Math.min(...Array.from({length:LOOK},(_,o)=>B[k-1-o].l));
    const rh = Math.max(...Array.from({length:LOOK},(_,o)=>B[k-1-o].h));
    const range = (b.h-b.l) || 1;
    const isLondon = london(b.min);

    let dir2=null, entry, sl, wickPct;

    // ── BULL sweep (potential long) ──
    if (b.l < rl && b.c > rl && b.c < eq) {
      const wp = (Math.min(b.o,b.c)-b.l) / range;
      const stkN = stkFn('sup', b.c, b.t);
      if (wp >= cfg.wick && stkN >= cfg.stack && trendOK('bull')) {
        if (cfg.weekly   && !weeklyBiasOK('long'))  continue;
        if (cfg.priorDay && !priorDayBiasOK('long')) continue;
        if (cfg.minScore) {
          const sc = scoreSetup(wp, stkN, isLondon, b, weeklyBiasOK('long'), priorDayBiasOK('long'));
          if (sc < cfg.minScore) continue;
        }
        dir2='long'; entry=b.c; sl=b.l; wickPct=wp;
      }
    }
    // ── BEAR sweep (potential short) ──
    else if (b.h > rh && b.c < rh && b.c > eq) {
      const wp = (b.h - Math.max(b.o,b.c)) / range;
      const stkN = stkFn('res', b.c, b.t);
      if (wp >= cfg.wick && stkN >= cfg.stack && trendOK('bear')) {
        if (cfg.weekly   && !weeklyBiasOK('short'))  continue;
        if (cfg.priorDay && !priorDayBiasOK('short')) continue;
        if (cfg.minScore) {
          const sc = scoreSetup(wp, stkN, isLondon, b, weeklyBiasOK('short'), priorDayBiasOK('short'));
          if (sc < cfg.minScore) continue;
        }
        dir2='short'; entry=b.c; sl=b.h; wickPct=wp;
      }
    }
    if (!dir2) continue;

    // ── Displacement confirmation (next bar) ──
    if (cfg.disp && k+1 < B.length) {
      const nb=B[k+1], nbR=(nb.h-nb.l)||1;
      if (dir2==='long')  { if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A) continue; }
      else                { if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A) continue; }
    }

    const R = mgmt(B, k, dir2, entry, sl, cfg.tp1, cfg.tp2, cfg.tp3, maxBars);
    out.push({t:b.t, R, dir:dir2, inst:name});
    seen.add(b.day);
  }
  return out;
}

// ── 30-min timeframe engine ──────────────────────────────────────────────────
// Resamples M15 → 30-min bars. Zone stacks still from D/4H/2H/1H (M15 data).
// London KZ adjusted: 720–930 min (due to 30-min slot boundary at 12:00 IST).
// NY-AM KZ: 1020–1260 min (first 30m slot is at 1140=19:00 IST, within range).
function run30m(name, cfg) {
  const d = inst(name, DM15); if (!d) return [];
  const {Z, Dc, Wc, B30m, pre30} = d;
  if (!B30m||!B30m.length||!pre30) return [];
  const B = B30m;
  const {tD1,tH4,tH1,dIdx,wIdx} = pre30; // precomputed O(1) lookups for 30m bars
  const LOOK = cfg.look || 4;
  const maxBars = 144;
  const wick  = cfg.wick  || 0.55;
  const stack = cfg.stack || 2;
  const tol = z => 0.25*(z.hi-z.lo)+0.05;
  const stkFn = (poi,price,te) => {
    let n=0;
    for(const tf of ['D','4H','2H','1H'])
      if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;
    return n;
  };
  // 30-min KZ windows (adjusted for 30-min slot boundary alignment)
  const london30 = m => m>=720 && m<930;
  const nyam30   = m => m>=1020 && m<1260;
  const kzOK = m => cfg.kz==='london' ? london30(m)
                  : cfg.kz==='ny-am'  ? nyam30(m)
                  : london30(m) || nyam30(m);
  const out=[], seen=new Set();
  for (let k=Math.max(50,LOOK); k<B.length-5; k++) {
    const b = B[k];
    if (!kzOK(b.min) || seen.has(b.day)) continue;
    if (cfg.dow && ![2,3,4].includes(b.dow)) continue;

    // O(1) lookups
    const di = dIdx[k]; if (di<5) continue;
    let drHi=-Infinity, drLo=Infinity;
    for (let i=di-5; i<di; i++) { if(Dc[i].h>drHi)drHi=Dc[i].h; if(Dc[i].l<drLo)drLo=Dc[i].l; }
    const eq=(drHi+drLo)/2;
    const h4=tH4[k], h1=tH1[k];
    if (!h4||!h1) continue;
    const trendOK = dir2 => h4===dir2 && h1===dir2;
    const wi=wIdx[k]; const wOpen=wi>0?Wc[wi-1].o:null;
    const weeklyBiasOK = dir2 => !wOpen?true:(dir2==='long'?b.c<wOpen:b.c>wOpen);
    const prevD=Dc[di-1]; const prevMid=(prevD.h+prevD.l)/2;
    const priorDayBiasOK = dir2 => dir2==='long'?b.c<prevMid:b.c>prevMid;

    const A = atr(B,k); if (A<=0) continue;
    const rl=Math.min(...Array.from({length:LOOK},(_,o)=>B[k-1-o].l));
    const rh=Math.max(...Array.from({length:LOOK},(_,o)=>B[k-1-o].h));
    const range=(b.h-b.l)||1;

    let dir2=null, entry, sl;
    if (b.l<rl && b.c>rl && b.c<eq) {
      const wp=(Math.min(b.o,b.c)-b.l)/range;
      if (wp>=wick && stkFn('sup',b.c,b.t)>=stack && trendOK('bull')) {
        if (cfg.weekly   && !weeklyBiasOK('long'))  continue;
        if (cfg.priorDay && !priorDayBiasOK('long')) continue;
        dir2='long'; entry=b.c; sl=b.l;
      }
    } else if (b.h>rh && b.c<rh && b.c>eq) {
      const wp=(b.h-Math.max(b.o,b.c))/range;
      if (wp>=wick && stkFn('res',b.c,b.t)>=stack && trendOK('bear')) {
        if (cfg.weekly   && !weeklyBiasOK('short'))  continue;
        if (cfg.priorDay && !priorDayBiasOK('short')) continue;
        dir2='short'; entry=b.c; sl=b.h;
      }
    }
    if (!dir2) continue;
    if (cfg.disp && k+1<B.length) {
      const nb=B[k+1], nbR=(nb.h-nb.l)||1;
      if (dir2==='long')  { if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A) continue; }
      else                { if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A) continue; }
    }
    const R = mgmt(B,k,dir2,entry,sl,cfg.tp1,cfg.tp2,cfg.tp3,maxBars);
    out.push({t:b.t,R,dir:dir2,inst:name}); seen.add(b.day);
  }
  return out;
}

// ── stats & display ──────────────────────────────────────────────────────────
function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){
  const n=a.length, win=a.filter(s=>s.R>0).length, tot=a.reduce((x,s)=>x+s.R,0), ci=wilson(win,n);
  const ts=a.map(x=>x.t), mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;
  const tr=a.filter(x=>x.t<mid), te=a.filter(x=>x.t>=mid);
  return {n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,
    eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,
    eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0};
}
function pr(lbl,trades,C){C=C||68;
  const s=st(trades);
  if(!s.n){console.log(lbl.padEnd(C),'n=   0');return s;}
  const gen=(s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(lbl.padEnd(C),`n=${String(s.n).padStart(4)} wr=${s.wr.toFixed(1).padStart(5)}% [${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}] exp=${s.exp.toFixed(3).padStart(7)}R Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`);
  return s;
}

// ── instruments ─────────────────────────────────────────────────────────────
const INS14 = ['NQ','ES','GC','CL','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','GBPJPY','EURJPY','RTY','SI','YM'];
const INS5  = fs.existsSync(DM15)
  ? fs.readdirSync(DM15).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''))
  : [];
const run14 = cfg => INS14.flatMap(n => runV3(n,cfg,D1H));
const run5  = cfg => INS5.flatMap(n  => runV3(n,cfg,DM15));
const run30 = cfg => INS5.flatMap(n  => run30m(n,cfg));

// ── V2 base configs ─────────────────────────────────────────────────────────
const BASE1H  = {disp:true, kz:'both', wick:0.55, stack:2};
const BASEM15 = {disp:true, kz:'both', wick:0.55, stack:2};

// ═══════════════════════════════════════════════════════════════════════════════
console.log('═'.repeat(76));
console.log('backtest20 — V3 Research: prior-day midpoint | narrow KZ | scoring | 30m TF');
console.log(`M15 instruments: ${INS5.join(', ')} (${INS5.length} total)`);
console.log('═'.repeat(76));

// ── Pre-compute ALL results once (no redundant runs) ─────────────────────────
process.stdout.write('Computing all strategies... ');
const R = {
  // V2 references
  v2_1h:    run14(BASE1H),
  v2_wk:    run14({...BASE1H, weekly:true}),
  v2_m15:   run5(BASEM15),
  v2_dow:   run5({...BASEM15, dow:true}),
  v2_wkm15: run5({...BASEM15, weekly:true}),
  // C1-C4: Combined filters on M15
  c1:  run5({...BASEM15, dow:true, weekly:true}),
  c2:  run5({...BASEM15, dow:true, priorDay:true}),
  c3:  run5({...BASEM15, weekly:true, priorDay:true}),
  c4:  run5({...BASEM15, dow:true, weekly:true, priorDay:true}),
  // C5-C8: Silver Bullet narrow KZ
  c5:  run5({...BASEM15, kzNarrow:true}),
  c6:  run5({...BASEM15, kzNarrow:true, dow:true}),
  c7:  run5({...BASEM15, kzNarrow:true, weekly:true}),
  c8:  run5({...BASEM15, kzNarrow:true, dow:true, weekly:true}),
  // C9-C11: 1H combined filters
  c9:  run14({...BASE1H, weekly:true, priorDay:true}),
  c10: run14({...BASE1H, dow:true, weekly:true}),
  c11: run14({...BASE1H, dow:true, weekly:true, priorDay:true}),
  // C12-C17: Signal scoring (no other optional filters — score subsumes them)
  c12: run5({...BASEM15, minScore:4}),
  c13: run5({...BASEM15, minScore:5}),
  c14: run5({...BASEM15, minScore:6}),
  c15: run5({...BASEM15, minScore:7}),
  c16: run5({...BASEM15, minScore:8}),
  c17: run14({...BASE1H, minScore:6}),
  // C18-C23: 30-min timeframe (base config same concept, KZ auto-adjusted)
  c18: run30({disp:true, kz:'both', wick:0.55, stack:2}),
  c19: run30({disp:true, kz:'both', wick:0.55, stack:2, dow:true}),
  c20: run30({disp:true, kz:'both', wick:0.55, stack:2, weekly:true}),
  c21: run30({disp:true, kz:'both', wick:0.55, stack:2, dow:true, weekly:true}),
  c22: run30({disp:true, kz:'both', wick:0.55, stack:2, priorDay:true}),
  c23: run30({disp:true, kz:'both', wick:0.55, stack:2, dow:true, weekly:true, priorDay:true}),
};
console.log('done.\n');

// ── Reference benchmarks ─────────────────────────────────────────────────────
console.log('── REFERENCE BENCHMARKS (V2 champions) ──\n');
pr('V2 champ  1H+disp+bothKZ+wick0.55    [14]', R.v2_1h);
pr('V2 champ+ 1H+weekly (S3 — 83% WR)   [14]', R.v2_wk);
pr('V2 M15 champ bothKZ+wick0.55          [5]', R.v2_m15);
pr('V2 M15+DOW (S7 — best M15)            [5]', R.v2_dow);
pr('V2 M15+weekly (S8)                    [5]', R.v2_wkm15);

// ── C1-C4: Combined filter tests on M15 ─────────────────────────────────────
console.log('\n── C1–C4: COMBINED FILTERS ON M15 ──\n');
pr('C1: M15 DOW+weekly [untested combo]   [5]', R.c1);
pr('C2: M15 DOW+prior-day midpoint        [5]', R.c2);
pr('C3: M15 weekly+prior-day              [5]', R.c3);
pr('C4: M15 DOW+weekly+prior-day [all 3] [5]', R.c4);

// ── C5-C8: Silver Bullet narrow KZ ──────────────────────────────────────────
console.log('\n── C5–C8: SILVER BULLET — NARROW SESSION WINDOWS (first 45 min only) ──\n');
console.log('  London: 12:15–13:00 IST  |  NY-AM: 19:15–19:45 IST\n');
pr('C5: M15 NarrowKZ only                 [5]', R.c5);
pr('C6: M15 NarrowKZ+DOW                  [5]', R.c6);
pr('C7: M15 NarrowKZ+weekly               [5]', R.c7);
pr('C8: M15 NarrowKZ+DOW+weekly           [5]', R.c8);

// ── C9-C11: 1H combined filters ──────────────────────────────────────────────
console.log('\n── C9–C11: 1H COMBINED FILTERS ──\n');
pr('C9:  1H weekly+prior-day              [14]', R.c9);
pr('C10: 1H DOW+weekly                   [14]', R.c10);
pr('C11: 1H DOW+weekly+prior-day         [14]', R.c11);

// ── C12-C17: Signal scoring ──────────────────────────────────────────────────
console.log('\n── C12–C17: SIGNAL SCORING SYSTEM ──\n');
console.log('  Score = wick(1-3) + stack(1-3) + kz(1-2) + dow(0-1) + weekly(0-1) + priorDay(0-1)');
console.log('  max=11  |  typical clean setup≈6–7  |  minimum possible=3\n');
pr('C12: M15 score≥4                      [5]', R.c12);
pr('C13: M15 score≥5 (lenient)            [5]', R.c13);
pr('C14: M15 score≥6 (moderate)           [5]', R.c14);
pr('C15: M15 score≥7 (strict)             [5]', R.c15);
pr('C16: M15 score≥8 (very strict)        [5]', R.c16);
pr('C17: 1H  score≥6 (moderate)          [14]', R.c17);

// ── C18-C23: 30-min timeframe ────────────────────────────────────────────────
console.log('\n── C18–C23: 30-MINUTE TIMEFRAME ──\n');
console.log('  Bars resampled from M15 data (same instruments). Zones: D/4H/2H/1H.\n');
pr('C18: 30m base (disp+bothKZ+wick0.55)  [5]', R.c18);
pr('C19: 30m+DOW                          [5]', R.c19);
pr('C20: 30m+weekly                       [5]', R.c20);
pr('C21: 30m+DOW+weekly                   [5]', R.c21);
pr('C22: 30m+prior-day                    [5]', R.c22);
pr('C23: 30m+DOW+weekly+prior-day         [5]', R.c23);

// ── Signal frequency ─────────────────────────────────────────────────────────
console.log('\n── SIGNAL FREQUENCY (extrapolated to 14-instrument portfolio) ──\n');
const yrsM15 = (() => {
  if (!INS5.length) return 1;
  const sums = INS5.map(n => { const d=load(n,DM15); return d?(d[d.length-1].t-d[0].t)/86400/365.25:0; });
  return sums.reduce((a,b)=>a+b,0)/sums.length;
})();
const yrs1H = 6.5;
const freq = (n,insts,yrs) => {
  const piy = n/insts/yrs;
  return `${Math.round(piy*14)}/yr  ≈${Math.round(piy*14/12)}/mo`;
};
[
  ['V2 M15 champ',         R.v2_m15.length,   5,  yrsM15],
  ['V2 M15+DOW ref',       R.v2_dow.length,   5,  yrsM15],
  ['C1 DOW+weekly',        R.c1.length,        5,  yrsM15],
  ['C4 all3 filters',      R.c4.length,        5,  yrsM15],
  ['C5 narrow KZ',         R.c5.length,        5,  yrsM15],
  ['C8 narrow+DOW+wk',     R.c8.length,        5,  yrsM15],
  ['C12 score≥4',          R.c12.length,       5,  yrsM15],
  ['C13 score≥5',          R.c13.length,       5,  yrsM15],
  ['C14 score≥6',          R.c14.length,       5,  yrsM15],
  ['C15 score≥7',          R.c15.length,       5,  yrsM15],
  ['C18 30m base',         R.c18.length,       5,  yrsM15],
  ['C21 30m+DOW+wk',       R.c21.length,       5,  yrsM15],
  ['V2 1H champ',          R.v2_1h.length,    14,  yrs1H],
  ['V2 1H+weekly',         R.v2_wk.length,    14,  yrs1H],
  ['C9  1H wk+priorDay',   R.c9.length,       14,  yrs1H],
  ['C11 1H all3',          R.c11.length,      14,  yrs1H],
].forEach(([lbl,n,ins,yrs]) =>
  console.log(`  ${lbl.padEnd(22)} n=${String(n).padStart(4)} → ${freq(n,ins,yrs)}`));

// ── Final ranking ─────────────────────────────────────────────────────────────
console.log('\n── FINAL RANKING (✓BOTH & n≥8, sorted by WR%) ──\n');
const allRes = [
  ['V2 1H champ',      R.v2_1h],
  ['V2 1H+weekly',     R.v2_wk],
  ['V2 M15 champ',     R.v2_m15],
  ['V2 M15+DOW',       R.v2_dow],
  ['V2 M15+weekly',    R.v2_wkm15],
  ['C1  M15 D+W',      R.c1],
  ['C2  M15 D+pd',     R.c2],
  ['C3  M15 W+pd',     R.c3],
  ['C4  M15 D+W+pd',   R.c4],
  ['C5  narrow',       R.c5],
  ['C6  narrow+D',     R.c6],
  ['C7  narrow+W',     R.c7],
  ['C8  narrow+D+W',   R.c8],
  ['C9  1H W+pd',      R.c9],
  ['C10 1H D+W',       R.c10],
  ['C11 1H D+W+pd',    R.c11],
  ['C12 M15 sc≥4',     R.c12],
  ['C13 M15 sc≥5',     R.c13],
  ['C14 M15 sc≥6',     R.c14],
  ['C15 M15 sc≥7',     R.c15],
  ['C16 M15 sc≥8',     R.c16],
  ['C17 1H  sc≥6',     R.c17],
  ['C18 30m base',     R.c18],
  ['C19 30m+D',        R.c19],
  ['C20 30m+W',        R.c20],
  ['C21 30m+D+W',      R.c21],
  ['C22 30m+pd',       R.c22],
  ['C23 30m+D+W+pd',   R.c23],
].map(([lbl,trades]) => {const s=st(trades);return {lbl,s,trades};})
 .filter(x => x.s.n>=8 && x.s.eTr>0 && x.s.eTe>0)
 .sort((a,b) => b.s.wr-a.s.wr);

allRes.forEach(({lbl,trades}) => pr(lbl.padEnd(14), trades, 20));

// ── Per-instrument breakdown for top M15 strategies ─────────────────────────
console.log('\n── PER-INSTRUMENT BREAKDOWN (top M15 candidates) ──\n');
const tops = [
  ['C1  M15 DOW+weekly',       R.c1],
  ['C4  M15 DOW+wk+priorDay',  R.c4],
  ['C14 M15 score≥6',          R.c14],
].filter(([,t]) => t.length > 0);

for (const [lbl, trades] of tops) {
  console.log(`  ${lbl}:`);
  for (const ins of INS5) {
    const t = trades.filter(x => x.inst===ins);
    if (!t.length) { console.log(`    ${ins.padEnd(10)} no trades`); continue; }
    const s = st(t);
    const gen = (s.eTr>0&&s.eTe>0)?'✓':(s.eTr>0||s.eTe>0)?'~':'✗';
    console.log(`    ${ins.padEnd(10)} n=${String(s.n).padStart(3)} wr=${s.wr.toFixed(1).padStart(5)}% exp=${s.exp.toFixed(3).padStart(7)}R ${gen}`);
  }
  console.log();
}

// ── Per-instrument breakdown for 30m strategies ─────────────────────────────
console.log('\n── PER-INSTRUMENT BREAKDOWN (30m candidates) ──\n');
const tops30 = [
  ['C18 30m base',         R.c18],
  ['C20 30m+weekly',       R.c20],
  ['C22 30m+prior-day',    R.c22],
];
for (const [lbl, trades] of tops30) {
  console.log(`  ${lbl}:`);
  for (const ins of INS5) {
    const t = trades.filter(x => x.inst===ins);
    if (!t.length) { console.log(`    ${ins.padEnd(10)} no trades`); continue; }
    const s = st(t);
    const gen = (s.eTr>0&&s.eTe>0)?'✓':(s.eTr>0||s.eTe>0)?'~':'✗';
    console.log(`    ${ins.padEnd(10)} n=${String(s.n).padStart(3)} wr=${s.wr.toFixed(1).padStart(5)}% exp=${s.exp.toFixed(3).padStart(7)}R ${gen}`);
  }
  console.log();
}

// ── V3 champion summary ──────────────────────────────────────────────────────
console.log('── V3 CANDIDATE SELECTION GUIDE ──\n');
console.log('  WR ≥ 73% AND n ≥ 30 AND ✓BOTH → V3 champion candidate');
console.log('  WR ≥ 78% AND n ≥ 8  AND ✓BOTH → V3 high-precision candidate (low frequency OK for 1H)');
console.log('  Score system: deploy if BEST score-threshold outperforms C1 by ≥1.5% WR\n');
const topM15 = allRes.filter(x => R.v2_m15.length ? x.trades.some(t=>!['NQ','ES','GC','CL','RTY','SI','YM'].includes(t.inst)) : true)
  .filter(x => x.s.wr >= 70).slice(0,5);
if (topM15.length) {
  console.log('  Top M15-style results (≥70% WR, ✓BOTH):');
  topM15.forEach(({lbl,s}) => console.log(`    ${lbl.padEnd(16)} ${s.wr.toFixed(1)}% WR  n=${s.n}  exp=${s.exp.toFixed(3)}R`));
}
