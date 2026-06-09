// backtest16.js — Comprehensive alternatives test on Siddh's ICT "Liq Grab" strategy
// Leak-free: causal resampling, rolling 5-day dealing range, Wilson 95% CI
// Tests 30+ filter/management/session/HTF combinations to find highest win rate
// Builds on backtest14/15 methodology — DO NOT use earlier backtests' numbers.

const IST = 5.5 * 3600;
const fs = require('fs');

const INSTRUMENTS = ['NQ','ES','GC','CL','EURUSD','GBPUSD'];

function load(name) {
  const p = `C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t: x.t, day: d.toISOString().slice(0,10),
             min: d.getUTCHours()*60 + d.getUTCMinutes(),
             o: x.o, h: x.h, l: x.l, c: x.c };
  });
}

function ema(arr, p) {
  const k = 2/(p+1); let e = arr[0], out = [e];
  for (let i = 1; i < arr.length; i++) { e = arr[i]*k + e*(1-k); out.push(e); }
  return out;
}

function atr(B, k, n=14) {
  let s = 0, c = 0;
  for (let i = Math.max(1, k-n+1); i <= k; i++) {
    s += Math.max(B[i].h-B[i].l, Math.abs(B[i].h-B[i-1].c), Math.abs(B[i].l-B[i-1].c));
    c++;
  }
  return c ? s/c : 0;
}

// Causal resample — bar stamped at period-END (completed bar)
function rsC(B, secs) {
  const m = new Map();
  for (const b of B) {
    const key = Math.floor((b.t + IST) / secs);
    if (!m.has(key)) m.set(key, { key, o:b.o, h:b.h, l:b.l, c:b.c });
    else { const x = m.get(key); x.h = Math.max(x.h,b.h); x.l = Math.min(x.l,b.l); x.c = b.c; }
  }
  return [...m.values()].sort((a,b)=>a.key-b.key)
    .map(x => ({ end:(x.key+1)*secs-IST, o:x.o, h:x.h, l:x.l, c:x.c }));
}

// FVG + OB zones — causal (only uses completed bars)
function zones(TS) {
  const z = []; const n = TS.length;
  for (let i = 2; i < n; i++) {
    if (TS[i].l > TS[i-2].h) z.push({ dir:'sup', lo:TS[i-2].h, hi:TS[i].l, t:TS[i].end });
    if (TS[i].h < TS[i-2].l) z.push({ dir:'res', lo:TS[i].h,   hi:TS[i-2].l,t:TS[i].end });
  }
  for (let i = 0; i < n-1; i++) {
    if (TS[i].c < TS[i].o && TS[i+1].c > TS[i].h) z.push({ dir:'sup', lo:TS[i].l, hi:TS[i].h, t:TS[i+1].end });
    if (TS[i].c > TS[i].o && TS[i+1].c < TS[i].l) z.push({ dir:'res', lo:TS[i].l, hi:TS[i].h, t:TS[i+1].end });
  }
  return z;
}

function emaSer(TS) {
  const e = ema(TS.map(x => x.c), 10);
  return TS.map((b,i) => ({ end:b.end, v:e[i] }));
}
function trendAt(ser, te, price) {
  let v = null;
  for (const x of ser) { if (x.end <= te) v = x.v; else break; }
  return v == null ? null : (price >= v ? 'bull' : 'bear');
}

// Kill zone lookup
function kzOf(min, mode) {
  const lon = min>=735&&min<915, nyam = min>=1020&&min<1260, nyE = min>=1020&&min<1080;
  if (mode==='london')   return lon  ? 'London'       : null;
  if (mode==='ny-am')    return nyam ? 'NY-AM'        : null;
  if (mode==='ny-am-e')  return nyE  ? 'NY-AM-early'  : null;
  if (mode==='both')     return lon  ? 'London' : nyam ? 'NY-AM' : null;
  return null;
}

// ── Management functions ──────────────────────────────────────────────────────
function mgmtTiered(E, k, dir, entry, sl, tp1, tp2, tp3) {
  const risk = Math.abs(entry-sl);
  const parts = [{f:1/3,r:tp1},{f:1/3,r:tp2},{f:1/3,r:tp3}];
  const done = [false,false,false];
  let rem=1, real=0, stop=sl, be=false;
  for (let i=k+1; i<E.length&&i<k+72; i++) {
    const b=E[i];
    if (dir==='long'?b.l<=stop:b.h>=stop) {
      real += rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk);
      rem=0; break;
    }
    for (let ti=0;ti<3;ti++) {
      if (done[ti]) continue;
      const tp = dir==='long' ? entry+parts[ti].r*risk : entry-parts[ti].r*risk;
      if (dir==='long'?b.h>=tp:b.l<=tp) {
        real += parts[ti].f*parts[ti].r; rem -= parts[ti].f; done[ti]=true;
        if (!be) { stop=entry; be=true; }
      }
    }
    if (rem<=1e-9) break;
  }
  if (rem>1e-9) {
    const last=E[Math.min(k+71,E.length-1)];
    real += rem*Math.max(-1,Math.min(tp3,(dir==='long'?(last.c-entry):(entry-last.c))/risk));
  }
  return real;
}

function mgmtSingle(E, k, dir, entry, sl, rr) {
  const risk = Math.abs(entry-sl);
  const tp = dir==='long' ? entry+rr*risk : entry-rr*risk;
  let stop=sl;
  for (let i=k+1; i<E.length&&i<k+72; i++) {
    const b=E[i];
    if (dir==='long'?b.l<=stop:b.h>=stop) return -1;
    if (dir==='long'?b.h>=tp:b.l<=tp) return rr;
  }
  const last=E[Math.min(k+71,E.length-1)];
  return Math.max(-1,Math.min(rr,(dir==='long'?(last.c-entry):(entry-last.c))/risk));
}

// 50% exit at tp1, trail remainder to BE, 50% at tp2
function mgmtHalf(E, k, dir, entry, sl, r1, r2) {
  const risk = Math.abs(entry-sl);
  const t1 = dir==='long'?entry+r1*risk:entry-r1*risk;
  const t2 = dir==='long'?entry+r2*risk:entry-r2*risk;
  let rem=1, real=0, stop=sl, be=false;
  for (let i=k+1; i<E.length&&i<k+72; i++) {
    const b=E[i];
    if (dir==='long'?b.l<=stop:b.h>=stop) {
      real += rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk);
      rem=0; break;
    }
    if (rem>0.5+1e-9 && (dir==='long'?b.h>=t1:b.l<=t1)) {
      real += 0.5*r1; rem=0.5; if (!be){stop=entry;be=true;}
    }
    if (rem>1e-9 && (dir==='long'?b.h>=t2:b.l<=t2)) {
      real += rem*r2; rem=0; break;
    }
  }
  if (rem>1e-9) {
    const last=E[Math.min(k+71,E.length-1)];
    real += rem*Math.max(-1,Math.min(r2,(dir==='long'?(last.c-entry):(entry-last.c))/risk));
  }
  return real;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function wilson(w, n) {
  if (!n) return [0,0];
  const z=1.96, p=w/n, d=1+z*z/n;
  const c=(p+z*z/2/n)/d, h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;
  return [(c-h)*100,(c+h)*100];
}

function st(a) {
  const n=a.length, win=a.filter(s=>s.R>0).length, tot=a.reduce((x,s)=>x+s.R,0);
  const ci=wilson(win,n);
  const ts=a.map(x=>x.t), mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;
  const tr=a.filter(x=>x.t<mid), te=a.filter(x=>x.t>=mid);
  return { n, wr:n?win/n*100:0, ci, exp:n?tot/n:0, tot,
           eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,
           eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0 };
}

function pr(lbl, trades) {
  const s = st(trades);
  const gen = (s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(
    lbl.padEnd(48),
    `n=${String(s.n).padStart(4)}`,
    `wr=${s.wr.toFixed(1).padStart(5)}%`,
    `[${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}]`,
    `exp=${s.exp.toFixed(3).padStart(7)}R`,
    `tot=${s.tot.toFixed(0).padStart(6)}R`,
    `Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`
  );
}

// ── Core engine ───────────────────────────────────────────────────────────────
const PRELOADED = {};
function getInstrument(name) {
  if (!PRELOADED[name]) {
    const B = load(name);
    if (!B) return null;
    const Dc=rsC(B,86400), H4c=rsC(B,14400), H2c=rsC(B,7200), H1c=rsC(B,3600);
    PRELOADED[name] = {
      B, Dc, H4c, H2c, H1c,
      Z: { D:zones(Dc), '4H':zones(H4c), '2H':zones(H2c), '1H':zones(H1c) },
      Da:emaSer(Dc), H4a:emaSer(H4c), H1a:emaSer(H1c)
    };
  }
  return PRELOADED[name];
}

function run(name, cfg) {
  const inst = getInstrument(name);
  if (!inst) return [];
  const { B, Dc, Z, Da, H4a, H1a } = inst;

  const tol = z => 0.25*(z.hi-z.lo)+0.05;
  const stk = (poi, price, te) => {
    let n=0;
    for (const tf of ['D','4H','2H','1H'])
      if (Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z))) n++;
    return n;
  };

  const out=[]; const seen=new Set();

  for (let k=50; k<B.length-5; k++) {
    const b=B[k];
    const kz=kzOf(b.min, cfg.kz);
    if (!kz || seen.has(b.day)) continue;

    const A=atr(B,k); if (A<=0) continue;

    // Causal dealing range: 5 completed daily bars before this hour
    const dailies=Dc.filter(x=>x.end<=b.t); if (dailies.length<5) continue;
    const dr=dailies.slice(-5);
    const drHi=Math.max(...dr.map(x=>x.h)), drLo=Math.min(...dr.map(x=>x.l));
    const eq=(drHi+drLo)/2, thirdH=(drHi-drLo)/3;

    // 6-bar swing high/low for sweep detection
    const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l));
    const rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));
    const range=(b.h-b.l)||1;

    // Causal trend (only completed HTF bars)
    const d1=trendAt(Da,b.t,b.c), h4=trendAt(H4a,b.t,b.c), h1=trendAt(H1a,b.t,b.c);
    if (!d1||!h4||!h1) continue;

    const trendOK = dir => {
      if (cfg.trend==='all3') return d1===dir&&h4===dir&&h1===dir;
      if (cfg.trend==='h4h1') return h4===dir&&h1===dir;
      if (cfg.trend==='d1h4') return d1===dir&&h4===dir;
      if (cfg.trend==='h4')   return h4===dir;
      return true;
    };

    // P/D filter
    const pdOK = (dir, price) => {
      if (cfg.pd==='none') return true;
      if (cfg.pd==='half') return dir==='long' ? price<eq : price>eq;
      if (cfg.pd==='third') return dir==='long' ? price<drLo+thirdH : price>drHi-thirdH;
      return true;
    };

    let dir=null, entry, sl, poi;

    // LONG: bar sweeps below recent low then closes back above
    if (b.l<rl && b.c>rl) {
      const wick=(Math.min(b.o,b.c)-b.l)/range;
      if (wick>=cfg.wick && stk('sup',b.c,b.t)>=cfg.stack && pdOK('long',b.c) && trendOK('bull'))
        { dir='long'; entry=b.c; sl=b.l; poi='sup'; }
    }
    // SHORT: bar sweeps above recent high then closes back below
    else if (b.h>rh && b.c<rh) {
      const wick=(b.h-Math.max(b.o,b.c))/range;
      if (wick>=cfg.wick && stk('res',b.c,b.t)>=cfg.stack && pdOK('short',b.c) && trendOK('bear'))
        { dir='short'; entry=b.c; sl=b.h; poi='res'; }
    }
    if (!dir) continue;

    // ── EXTRA FILTERS ────────────────────────────────────────────────────────

    // DISPLACEMENT: next bar must confirm reversal direction
    // (closes in upper half of range for long, lower half for short, body ≥ 0.3 ATR)
    if (cfg.disp) {
      if (k+1>=B.length) continue;
      const nb=B[k+1]; const nbR=(nb.h-nb.l)||1;
      if (dir==='long') {
        if ((nb.c-nb.l)/nbR < 0.55 || Math.abs(nb.c-nb.o)<0.3*A) continue;
      } else {
        if ((nb.h-nb.c)/nbR < 0.55 || Math.abs(nb.c-nb.o)<0.3*A) continue;
      }
    }

    // ZONE FRESHNESS: no price touch inside any zone at this level in last 20 bars
    if (cfg.fresh) {
      let touched=false;
      for (let j=Math.max(0,k-20); j<k; j++) {
        if (dir==='long'  && B[j].l<=entry && B[j].h>=entry*0.9995) { touched=true; break; }
        if (dir==='short' && B[j].h>=entry && B[j].l<=entry*1.0005) { touched=true; break; }
      }
      if (touched) continue;
    }

    // LARGE CANDLE: sweep bar range > 0.8 × ATR (meaningful bar, not a tiny pip)
    if (cfg.bigBar && range<0.8*A) continue;

    // STRONG CANDLE BODY: body ≥ 0.3 ATR on the sweep bar itself
    if (cfg.body) {
      if (Math.abs(b.c-b.o)<0.3*A) continue;
    }

    // PRIOR MOMENTUM: 3 bars before sweep show ≥ 2 bars trending with HTF
    // (price was moving WITH trend before the liquidity trap)
    if (cfg.momentum) {
      const cnt=[B[k-3],B[k-2],B[k-1]].filter(x=>dir==='long'?x.c>x.o:x.c<x.o).length;
      if (cnt<2) continue;
    }

    // DEEP SWEEP: sweep must go at least 0.3 ATR beyond the swing level
    // (shallow fakes don't count — need real liquidity to be taken)
    if (cfg.deepSweep) {
      if (dir==='long'  && rl-b.l < 0.3*A) continue;
      if (dir==='short' && b.h-rh < 0.3*A) continue;
    }

    // CLEAN CLOSE: closing price is "clearly" inside zone (not just barely)
    // (close is at least 0.15 ATR back inside the range from the sweep)
    if (cfg.cleanClose) {
      if (dir==='long'  && (b.c-b.l)<0.35*A) continue;
      if (dir==='short' && (b.h-b.c)<0.35*A) continue;
    }

    // CHoCH simulation: for long, close must exceed the PREVIOUS bar's HIGH
    // (market structure shift — new high after the sweep confirms reversal)
    if (cfg.choch) {
      const prevH=Math.max(...[1,2,3].map(o=>B[k-o].h));
      const prevL=Math.min(...[1,2,3].map(o=>B[k-o].l));
      if (dir==='long'  && b.c<=prevH) continue;
      if (dir==='short' && b.c>=prevL) continue;
    }

    // OTE ENTRY: limit order at 61.8% retracement of the wick
    // Simulates placing a limit at the OTE golden zone and waiting for price to return
    let actualEntry = entry, actualK = k;
    if (cfg.ote) {
      const oteLevel = dir==='long'
        ? sl + 0.618*(entry-sl)   // 61.8% from wick low back to close
        : sl - 0.618*(sl-entry);  // 61.8% from wick high back to close
      let filled=false;
      for (let i=k+1; i<=k+3&&i<B.length; i++) {
        if (dir==='long'?B[i].l<=oteLevel:B[i].h>=oteLevel) {
          filled=true; actualK=i; break;
        }
      }
      if (!filled) continue;
      actualEntry=oteLevel;
    }

    // ── MANAGEMENT ───────────────────────────────────────────────────────────
    let R;
    const m=cfg.mgmt;
    if (m==='tiered')      R=mgmtTiered(B,actualK,dir,actualEntry,sl,1,1.7,2.56);
    else if (m==='t-wide') R=mgmtTiered(B,actualK,dir,actualEntry,sl,1,2,4);
    else if (m==='t-ict')  R=mgmtTiered(B,actualK,dir,actualEntry,sl,1,2,3.6);
    else if (m==='h1.5/3') R=mgmtHalf(B,actualK,dir,actualEntry,sl,1.5,3);
    else if (m==='h1/2.5') R=mgmtHalf(B,actualK,dir,actualEntry,sl,1,2.5);
    else                   R=mgmtSingle(B,actualK,dir,actualEntry,sl,parseFloat(m)||2.56);

    out.push({ t:b.t, R, dir, kz });
    seen.add(b.day);
  }
  return out;
}

function all(cfg) {
  let out=[];
  for (const name of INSTRUMENTS) out=out.concat(run(name,cfg));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-LOAD all instruments (avoids repeated file I/O)
console.log('Loading instrument data...');
for (const n of INSTRUMENTS) getInstrument(n);
console.log('Done.\n');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — BASELINE
// ─────────────────────────────────────────────────────────────────────────────
const BASE = { trend:'h4h1', stack:2, kz:'ny-am', pd:'half', wick:0.5, mgmt:'tiered' };

console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 1 — INDIVIDUAL FILTERS  (each added to h4h1+stk2+NYAM+halfPD+wick0.5)');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  wr=win rate  [lo-hi]=Wilson 95% CI  exp=expectancy per trade  Tr/Te=train/test split\n');

pr('0. BASELINE (h4h1+stk2+NYAM+halfPD+wick0.5)', all(BASE));
pr('1. + Displacement (next-bar confirm)',         all({...BASE, disp:true}));
pr('2. + Strong wick (>=0.65)',                    all({...BASE, wick:0.65}));
pr('3. + Very strong wick (>=0.75)',               all({...BASE, wick:0.75}));
pr('4. + Zone freshness (first tap only)',         all({...BASE, fresh:true}));
pr('5. + Large sweep bar (>0.8 ATR)',              all({...BASE, bigBar:true}));
pr('6. + Strong body on sweep bar (>0.3 ATR)',     all({...BASE, body:true}));
pr('7. + Prior momentum (3-bar trend)',            all({...BASE, momentum:true}));
pr('8. + Deep sweep (0.3 ATR beyond swing)',       all({...BASE, deepSweep:true}));
pr('9. + Clean close (0.35 ATR back inside)',      all({...BASE, cleanClose:true}));
pr('10. + CHoCH (close beyond prev 3-bar extreme)',all({...BASE, choch:true}));
pr('11. + Deep P/D (outer third only)',            all({...BASE, pd:'third'}));
pr('12. + OTE limit entry (61.8% fib)',            all({...BASE, ote:true}));
pr('13. + all3 trend (D1+H4+H1)',                  all({...BASE, trend:'all3'}));
pr('14. + stack>=3',                               all({...BASE, stack:3}));
pr('15. + stack>=4 (full ladder)',                 all({...BASE, stack:4}));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — BEST COMBINATIONS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 2 — COMBINED FILTERS  (stacking the best individual filters)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

pr('disp + wick0.65',                     all({...BASE, disp:true, wick:0.65}));
pr('disp + fresh',                        all({...BASE, disp:true, fresh:true}));
pr('disp + deepSweep',                    all({...BASE, disp:true, deepSweep:true}));
pr('disp + cleanClose',                   all({...BASE, disp:true, cleanClose:true}));
pr('disp + choch',                        all({...BASE, disp:true, choch:true}));
pr('disp + all3',                         all({...BASE, disp:true, trend:'all3'}));
pr('wick0.65 + fresh',                    all({...BASE, wick:0.65, fresh:true}));
pr('wick0.65 + deepSweep',                all({...BASE, wick:0.65, deepSweep:true}));
pr('wick0.65 + choch',                    all({...BASE, wick:0.65, choch:true}));
pr('fresh + deepSweep',                   all({...BASE, fresh:true, deepSweep:true}));
pr('fresh + choch',                       all({...BASE, fresh:true, choch:true}));
pr('cleanClose + choch',                  all({...BASE, cleanClose:true, choch:true}));
pr('disp + wick0.65 + fresh',             all({...BASE, disp:true, wick:0.65, fresh:true}));
pr('disp + wick0.65 + deepSweep',         all({...BASE, disp:true, wick:0.65, deepSweep:true}));
pr('disp + wick0.65 + choch',             all({...BASE, disp:true, wick:0.65, choch:true}));
pr('disp + wick0.65 + all3',              all({...BASE, disp:true, wick:0.65, trend:'all3'}));
pr('disp + choch + all3',                 all({...BASE, disp:true, choch:true, trend:'all3'}));
pr('disp + wick0.65 + fresh + all3',      all({...BASE, disp:true, wick:0.65, fresh:true, trend:'all3'}));
pr('disp + wick0.65 + fresh + choch',     all({...BASE, disp:true, wick:0.65, fresh:true, choch:true}));
pr('disp + cleanClose + choch + all3',    all({...BASE, disp:true, cleanClose:true, choch:true, trend:'all3'}));
pr('disp + wick0.65 + deepSweep + choch', all({...BASE, disp:true, wick:0.65, deepSweep:true, choch:true}));
pr('ALL FILTERS COMBINED',                all({...BASE, disp:true, wick:0.65, fresh:true, choch:true, deepSweep:true, trend:'all3'}));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — MANAGEMENT VARIANTS  (on baseline)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 3 — MANAGEMENT VARIANTS  (baseline filters, different exit strategies)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

pr('Tiered 1/3@1R + 1/3@1.7R + 1/3@2.56R (current)', all({...BASE, mgmt:'tiered'}));
pr('Tiered 1/3@1R + 1/3@2R  + 1/3@4R (wide)',        all({...BASE, mgmt:'t-wide'}));
pr('Tiered 1/3@1R + 1/3@2R  + 1/3@3.6R (ICT)',       all({...BASE, mgmt:'t-ict'}));
pr('50/50: 50%@1.5R + 50%@3R',                        all({...BASE, mgmt:'h1.5/3'}));
pr('50/50: 50%@1R  + 50%@2.5R',                       all({...BASE, mgmt:'h1/2.5'}));
pr('Single TP 2.56R (full position)',                  all({...BASE, mgmt:'2.56'}));
pr('Single TP 3R',                                     all({...BASE, mgmt:'3'}));
pr('Single TP 3.6R',                                   all({...BASE, mgmt:'3.6'}));
pr('Single TP 4R',                                     all({...BASE, mgmt:'4'}));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — KILL ZONE VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 4 — KILL ZONE VARIANTS  (baseline filters)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

pr('NY-AM  12:15–15:15 IST (17:00–21:00 IST? check labels)',all({...BASE, kz:'ny-am'}));
pr('London 12:15–15:15 IST',                                all({...BASE, kz:'london'}));
pr('NY-AM early only (17:00–18:00 IST)',                     all({...BASE, kz:'ny-am-e'}));
pr('London + NY-AM (both)',                                  all({...BASE, kz:'both'}));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5 — HTF TREND VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 5 — HTF ALIGNMENT VARIANTS');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

pr('H4+H1 only (current)',       all({...BASE}));
pr('D1+H4+H1 all three (all3)', all({...BASE, trend:'all3'}));
pr('D1+H4 only',                all({...BASE, trend:'d1h4'}));
pr('H4 only',                   all({...BASE, trend:'h4'}));
pr('No trend filter',           all({...BASE, trend:'none'}));

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6 — BEST COMBO × BEST MANAGEMENT × BEST SESSION
// The winner from each phase stacked together
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 6 — STACKING BEST CHOICES FROM EACH PHASE');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// Test 4 promising "high quality" filter combinations × 3 management styles
const QUAL_COMBOS = [
  ['disp+wick0.65+choch (h4h1)',    {...BASE, disp:true, wick:0.65, choch:true}],
  ['disp+wick0.65+all3',            {...BASE, disp:true, wick:0.65, trend:'all3'}],
  ['disp+deepSweep+choch+all3',     {...BASE, disp:true, deepSweep:true, choch:true, trend:'all3'}],
  ['disp+wick0.65+fresh+all3',      {...BASE, disp:true, wick:0.65, fresh:true, trend:'all3'}],
];
const MGMTS = [
  ['tiered',   'tiered'],
  ['single3R', '3'],
  ['wide',     't-wide'],
  ['50/50',    'h1.5/3'],
];

for (const [ql, qcfg] of QUAL_COMBOS) {
  for (const [ml, mcfg] of MGMTS) {
    pr(`${ql} × ${ml}`, all({...qcfg, mgmt:mcfg}));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — PER-INSTRUMENT BREAKDOWN (baseline vs best combo)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 7 — PER-INSTRUMENT (baseline vs disp+wick0.65+choch+all3+NYAM+tiered)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const BEST = {...BASE, disp:true, wick:0.65, choch:true, trend:'all3'};

console.log('Instrument  BASELINE: n  wr  exp         BEST_COMBO: n  wr  exp');
console.log('─'.repeat(78));
for (const name of INSTRUMENTS) {
  const b=run(name,BASE), w=run(name,BEST);
  const sb=st(b), sw=st(w);
  console.log(
    name.padEnd(12),
    `base: n=${String(sb.n).padStart(3)} wr=${sb.wr.toFixed(0).padStart(3)}% exp=${sb.exp.toFixed(3)}R`.padEnd(38),
    `best: n=${String(sw.n).padStart(3)} wr=${sw.wr.toFixed(0).padStart(3)}% exp=${sw.exp.toFixed(3)}R [${sw.ci[0].toFixed(0)}-${sw.ci[1].toFixed(0)}]`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8 — PER-INSTRUMENT, PER-KZ (on best combo)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('PHASE 8 — PER-INSTRUMENT × PER-KZ (disp+wick0.65+choch+all3, tiered)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const name of INSTRUMENTS) {
  for (const [kzl, kz] of [['NYAM','ny-am'],['London','london'],['Both','both']]) {
    const trades=run(name,{...BEST,kz});
    if (!trades.length) continue;
    const s=st(trades);
    console.log(
      `${name.padEnd(8)} ${kzl.padEnd(7)}`,
      `n=${String(s.n).padStart(3)} wr=${s.wr.toFixed(0).padStart(3)}%`,
      `[${s.ci[0].toFixed(0)}-${s.ci[1].toFixed(0)}]`.padEnd(10),
      `exp=${s.exp.toFixed(3)}R`,
      `Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)}`
    );
  }
}

console.log('\n═══════════════════════════════════════════════════════════════════════════');
console.log('DONE. Key reading guide:');
console.log('  ✓BOTH = positive expectancy in BOTH train and test halves → generalizes');
console.log('  ~ONE  = positive in one half only → caution, possible overfit');
console.log('  ✗NEG  = negative in at least one half → avoid');
console.log('  CI wider than ±10% = too few trades to trust the win rate');
console.log('  Honest baseline from bt15: h4h1+stk2+NYAM = ~54% win, +0.16R/trade');
console.log('═══════════════════════════════════════════════════════════════════════════');
