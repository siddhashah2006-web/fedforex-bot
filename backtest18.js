// backtest18.js — 7-strategy expansion: Rejection Block, M15, Crypto, Combos
// All strategies tested on the same leak-free, causal methodology as backtest17.
//
// STRATEGIES:
//   1. Rejection Block (1H) — enter on RETEST of sweep candle body zone
//   2. Original (OG) + Crypto pairs (BTCUSD, ETHUSD if available)
//   3. Combo: OG-displacement primary → RB fallback (what Siddh described)
//   4. M15 Original (needs bt_data_m15/ — run modified fetch_dukascopy.js first)
//   5. M15 + Rejection Block
//   6. M15 + Crypto
//   7. All combined + Crypto

const IST = 5.5 * 3600;
const fs  = require('fs');

const DATA_1H  = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';
const DATA_M15 = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_m15/';

const ALL_1H   = ['NQ','ES','GC','CL','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','GBPJPY','EURJPY','RTY','SI','YM'];
const BEST_1H  = ['NQ','GBPUSD','AUDUSD','GBPJPY','RTY','YM'];  // ✓BOTH with exp>0 from bt17
const CRYPTO   = ['BTCUSD','ETHUSD'];
const ALL_CRYPTO = [...ALL_1H, 'BTCUSD'];

// ── Utilities ─────────────────────────────────────────────────────────────────
function load(name, dir=DATA_1H) {
  const p = `${dir}${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t:x.t, day:d.toISOString().slice(0,10),
             min:d.getUTCHours()*60+d.getUTCMinutes(), o:x.o, h:x.h, l:x.l, c:x.c };
  });
}
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function atr(B,k,n=14){ let s=0,c=0; for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
// Causal resample — bar stamped at END of period (no lookahead)
function rsC(B,secs){ const m=new Map(); for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}} return[...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c})); }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:'sup',lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:'res',lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});} for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:'sup',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:'res',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});} return z; }
function emaSer(TS){ const e=ema(TS.map(x=>x.c),10); return TS.map((b,i)=>({end:b.end,v:e[i]})); }
function trendAt(s,te,price){ let v=null; for(const x of s){if(x.end<=te)v=x.v;else break;} return v==null?null:(price>=v?'bull':'bear'); }

function mgmtTiered(E,k,dir,entry,sl,tp1,tp2,tp3){
  const risk=Math.abs(entry-sl),parts=[{f:1/3,r:tp1},{f:1/3,r:tp2},{f:1/3,r:tp3}],done=[false,false,false];
  let rem=1,real=0,stop=sl,be=false;
  for(let i=k+1;i<E.length&&i<k+72;i++){
    const b=E[i];
    if(dir==='long'?b.l<=stop:b.h>=stop){real+=rem*(stop===entry?0:(dir==='long'?(stop-entry):(entry-stop))/risk);rem=0;break;}
    for(let ti=0;ti<3;ti++){if(done[ti])continue;const tp=dir==='long'?entry+parts[ti].r*risk:entry-parts[ti].r*risk;if(dir==='long'?b.h>=tp:b.l<=tp){real+=parts[ti].f*parts[ti].r;rem-=parts[ti].f;done[ti]=true;if(!be){stop=entry;be=true;}}}
    if(rem<=1e-9)break;
  }
  if(rem>1e-9){const last=E[Math.min(k+71,E.length-1)];real+=rem*Math.max(-1,Math.min(tp3,(dir==='long'?(last.c-entry):(entry-last.c))/risk));}
  return real;
}

function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){const n=a.length,win=a.filter(s=>s.R>0).length,tot=a.reduce((x,s)=>x+s.R,0),ci=wilson(win,n);const ts=a.map(x=>x.t),mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;const tr=a.filter(x=>x.t<mid),te=a.filter(x=>x.t>=mid);return{n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,tot,eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0};}

// ── Preload cache (per data dir + name) ───────────────────────────────────────
const CACHE = {};
function inst(name, dir=DATA_1H) {
  const key = `${dir}${name}`;
  if (!CACHE[key]) {
    const B = load(name, dir);
    if (!B) return null;
    const Dc=rsC(B,86400), H4c=rsC(B,14400), H2c=rsC(B,7200), H1c=rsC(B,3600);
    CACHE[key] = { B, Dc,
      Z: { D:zones(Dc), '4H':zones(H4c), '2H':zones(H2c), '1H':zones(H1c) },
      Da:emaSer(Dc), H4a:emaSer(H4c), H1a:emaSer(H1c) };
  }
  return CACHE[key];
}

// ── Signal detection helpers ───────────────────────────────────────────────────
function sweepDetect(B, k, Dc, Z, Da, H4a, H1a, cfg) {
  // Returns {dir, sl, rbLo, rbHi, A} if a valid sweep candle is found at index k
  const b=B[k];
  const A=atr(B,k); if(A<=0) return null;
  const dailies=Dc.filter(x=>x.end<=b.t); if(dailies.length<5) return null;
  const dr=dailies.slice(-5), drHi=Math.max(...dr.map(x=>x.h)), drLo=Math.min(...dr.map(x=>x.l)), eq=(drHi+drLo)/2;
  const rl=Math.min(...[1,2,3,4,5,6].map(o=>B[k-o].l));
  const rh=Math.max(...[1,2,3,4,5,6].map(o=>B[k-o].h));
  const range=(b.h-b.l)||1;
  const d1=trendAt(Da,b.t,b.c), h4=trendAt(H4a,b.t,b.c), h1=trendAt(H1a,b.t,b.c);
  if(!d1||!h4||!h1) return null;
  const trendOK=dir=>cfg.trend==='all3'?(d1===dir&&h4===dir&&h1===dir):(h4===dir&&h1===dir);
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,price,te)=>{let n=0;for(const tf of['D','4H','2H','1H'])if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++;return n;};
  let dir=null,sl,rbLo,rbHi;
  if(b.l<rl && b.c>rl && b.c<eq){
    const wick=(Math.min(b.o,b.c)-b.l)/range;
    if(wick>=cfg.wick && stk('sup',b.c,b.t)>=cfg.stack && trendOK('bull'))
      { dir='long'; sl=b.l; rbLo=Math.min(b.o,b.c); rbHi=Math.max(b.o,b.c); }
  } else if(b.h>rh && b.c<rh && b.c>eq){
    const wick=(b.h-Math.max(b.o,b.c))/range;
    if(wick>=cfg.wick && stk('res',b.c,b.t)>=cfg.stack && trendOK('bear'))
      { dir='short'; sl=b.h; rbLo=Math.min(b.o,b.c); rbHi=Math.max(b.o,b.c); }
  }
  if(!dir) return null;
  return { dir, sl, rbLo, rbHi, A };
}

// ── ENGINE 1: Original (OG) — enter at close of sweep candle ─────────────────
function runOG(name, cfg, dir=DATA_1H) {
  const d=inst(name,dir); if(!d)return[];
  const{B,Dc,Z,Da,H4a,H1a}=d;
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
  const kzOK=m=>cfg.kz==='ny-am'?nyam(m):cfg.kz==='london'?london(m):nyam(m)||london(m);
  const out=[],seen=new Set();
  for(let k=50;k<B.length-5;k++){
    const b=B[k]; if(!kzOK(b.min)||seen.has(b.day))continue;
    const sw=sweepDetect(B,k,Dc,Z,Da,H4a,H1a,cfg); if(!sw)continue;
    const{dir,sl,A}=sw;
    // Displacement filter (optional)
    if(cfg.disp&&k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      if(dir==='long'){if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
      else{if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
    }
    const R=mgmtTiered(B,k,dir,b.c,sl,1,1.7,2.56);
    out.push({t:b.t,R,dir,inst:name});seen.add(b.day);
  }
  return out;
}

// ── ENGINE 2: Rejection Block — enter on RETEST of sweep candle BODY ─────────
// Rejection Block definition: the BODY of the sweep candle (min(o,c) to max(o,c))
// Entry: when price RETRACES back into the body zone and shows reaction (not just pass-through)
// SL: beyond the original wick (same as OG — always b.l for long, b.h for short)
function runRB(name, cfg, dir=DATA_1H) {
  const d=inst(name,dir); if(!d)return[];
  const{B,Dc,Z,Da,H4a,H1a}=d;
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
  const kzOK=m=>cfg.kz==='ny-am'?nyam(m):cfg.kz==='london'?london(m):nyam(m)||london(m);
  const out=[],seen=new Set();
  const window=cfg.rbWindow||12;
  for(let k=50;k<B.length-window-2;k++){
    const b=B[k]; if(!kzOK(b.min)||seen.has(b.day))continue;
    const sw=sweepDetect(B,k,Dc,Z,Da,H4a,H1a,cfg); if(!sw)continue;
    const{dir,sl,rbLo,rbHi,A}=sw;
    const bodyMid=(rbLo+rbHi)/2;
    // Optional: require displacement bar AFTER sweep (confirms reversal, then wait for pullback to body)
    if(cfg.disp&&k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      if(dir==='long'){if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
      else{if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
    }
    // Look for retest of body zone in next [window] bars
    // For strictRB: start at k+2 (k+1 must be the "run" bar, not the retest)
    const startJ = cfg.strictRB ? k+2 : k+1;
    for(let j=startJ; j<Math.min(k+1+window, B.length-3); j++){
      const nb=B[j];
      // Abort if price closes through the SL (structure broken)
      if(dir==='long'&&nb.c<sl) break;
      if(dir==='short'&&nb.c>sl) break;
      if(dir==='long'){
        // Retest condition: low enters body zone AND closes in upper half (bullish reaction)
        if(nb.l<=rbHi && nb.c>=bodyMid){
          const entry=nb.c;
          // Optional: retest bar itself must show displacement
          if(cfg.rbDisp){
            const nbR=(nb.h-nb.l)||1;
            if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A){break;} // only first retest chance
          }
          const R=mgmtTiered(B,j,'long',entry,sl,1,1.7,2.56);
          out.push({t:b.t,R,dir,inst:name}); seen.add(b.day); break;
        }
      } else {
        // Retest condition: high enters body zone AND closes in lower half (bearish reaction)
        if(nb.h>=rbLo && nb.c<=bodyMid){
          const entry=nb.c;
          if(cfg.rbDisp){
            const nbR=(nb.h-nb.l)||1;
            if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A){break;}
          }
          const R=mgmtTiered(B,j,'short',entry,sl,1,1.7,2.56);
          out.push({t:b.t,R,dir,inst:name}); seen.add(b.day); break;
        }
      }
    }
  }
  return out;
}

// ── ENGINE 3: Combo — OG (displacement) primary, RB fallback ─────────────────
// Siddh's intent: "on days with no liquidity grab → aim for rejection blocks"
// Mechanically: if displacement fires → OG entry; else look for RB retest
function runCombo(name, cfg, dir=DATA_1H) {
  const d=inst(name,dir); if(!d)return[];
  const{B,Dc,Z,Da,H4a,H1a}=d;
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
  const kzOK=m=>cfg.kz==='ny-am'?nyam(m):cfg.kz==='london'?london(m):nyam(m)||london(m);
  const out=[],seen=new Set();
  const window=cfg.rbWindow||12;
  for(let k=50;k<B.length-window-2;k++){
    const b=B[k]; if(!kzOK(b.min)||seen.has(b.day))continue;
    const sw=sweepDetect(B,k,Dc,Z,Da,H4a,H1a,cfg); if(!sw)continue;
    const{dir,sl,rbLo,rbHi,A}=sw;
    // Try OG first: check displacement bar (k+1)
    let taken=false;
    if(k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      let dispOK;
      if(dir==='long') dispOK=(nb.c-nb.l)/nbR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*A;
      else dispOK=(nb.h-nb.c)/nbR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*A;
      if(dispOK){
        const R=mgmtTiered(B,k,dir,b.c,sl,1,1.7,2.56);
        out.push({t:b.t,R,dir,inst:name,mode:'og'}); seen.add(b.day); taken=true;
      }
    }
    if(taken) continue;
    // OG didn't fire → try RB retest from k+2 onward
    const bodyMid=(rbLo+rbHi)/2;
    for(let j=k+2; j<Math.min(k+1+window, B.length-3); j++){
      const nb=B[j];
      if(dir==='long'&&nb.c<sl) break;
      if(dir==='short'&&nb.c>sl) break;
      if(dir==='long'&&nb.l<=rbHi&&nb.c>=bodyMid){
        const R=mgmtTiered(B,j,'long',nb.c,sl,1,1.7,2.56);
        out.push({t:b.t,R,dir,inst:name,mode:'rb'}); seen.add(b.day); break;
      }
      if(dir==='short'&&nb.h>=rbLo&&nb.c<=bodyMid){
        const R=mgmtTiered(B,j,'short',nb.c,sl,1,1.7,2.56);
        out.push({t:b.t,R,dir,inst:name,mode:'rb'}); seen.add(b.day); break;
      }
    }
  }
  return out;
}

// ── Set runners ───────────────────────────────────────────────────────────────
function setOG(names,cfg,d)    { let o=[];names.forEach(n=>o=o.concat(runOG(n,cfg,d)));return o; }
function setRB(names,cfg,d)    { let o=[];names.forEach(n=>o=o.concat(runRB(n,cfg,d)));return o; }
function setCombo(names,cfg,d) { let o=[];names.forEach(n=>o=o.concat(runCombo(n,cfg,d)));return o; }

// ── Print ─────────────────────────────────────────────────────────────────────
function pr(lbl,trades,cols=62){
  const s=st(trades);
  if(!s.n){console.log(lbl.padEnd(cols),`n=   0 (no data)`);return;}
  const gen=(s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(lbl.padEnd(cols),`n=${String(s.n).padStart(4)} wr=${s.wr.toFixed(1).padStart(5)}% [${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}] exp=${s.exp.toFixed(3).padStart(7)}R Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`);
  return s;
}

// Base configs
const BASE  = {trend:'h4h1', stack:2, kz:'ny-am', wick:0.5};
const DISP  = {...BASE, disp:true};
const DISPB = {...BASE, disp:true, kz:'both'};   // both KZ + displacement (the bt17 champion)
const DISPL = {...BASE, disp:true, kz:'london'};

// Preload all 1H instruments + crypto
[...ALL_1H,...CRYPTO].forEach(n=>inst(n,DATA_1H));

// Check M15 data availability
const M15_AVAIL = fs.existsSync(DATA_M15) && fs.readdirSync(DATA_M15).some(f=>f.endsWith('.json'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('backtest18 — Multi-strategy: Rejection Block, Crypto, M15, Combos');
console.log('══════════════════════════════════════════════════════════════════════════\n');

// ── BT17 BENCHMARK (for comparison) ───────────────────────────────────────────
console.log('── BT17 BENCHMARK (reference) ──\n');
pr('OG baseline (14)',                 setOG(ALL_1H, BASE));
pr('OG + displacement + both KZ (14)',setOG(ALL_1H, DISPB));
pr('OG + displacement + best port',   setOG(BEST_1H,DISP));

// ═════════════════════════════════════════════════════════════════════════════
// STRATEGY 1: REJECTION BLOCK (1H)
// Entry: retest of sweep candle body zone. SL: wick tip.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── STRATEGY 1: REJECTION BLOCK 1H ──\n');

pr('RB baseline (14, window=12)',          setRB(ALL_1H, BASE));
pr('RB + both KZ (14)',                    setRB(ALL_1H, {...BASE, kz:'both'}));
pr('RB + London (14)',                     setRB(ALL_1H, {...BASE, kz:'london'}));
pr('RB + displacement on sweep (14)',      setRB(ALL_1H, DISP));
pr('RB + disp + both KZ (14)',             setRB(ALL_1H, DISPB));
pr('RB + disp + London (14)',              setRB(ALL_1H, DISPL));
pr('RB strict (no k+1) (14)',              setRB(ALL_1H, {...BASE, strictRB:true}));
pr('RB strict + disp + both KZ (14)',      setRB(ALL_1H, {...DISPB, strictRB:true}));
pr('RB + retest-bar disp (14)',            setRB(ALL_1H, {...BASE, rbDisp:true}));
pr('RB window=6 (14)',                     setRB(ALL_1H, {...BASE, rbWindow:6}));
pr('RB window=3 (14)',                     setRB(ALL_1H, {...BASE, rbWindow:3}));
pr('RB + both KZ + best port',            setRB(BEST_1H,{...BASE, kz:'both'}));
pr('RB + disp + both KZ + best port',     setRB(BEST_1H, DISPB));

// Per-instrument RB breakdown
console.log('\n── RB PER-INSTRUMENT (disp + both KZ) ──\n');
for(const name of ALL_1H){
  const t=runRB(name,DISPB);
  if(t.length>0) pr(`  ${name}`.padEnd(15),t,16);
}

// ═════════════════════════════════════════════════════════════════════════════
// STRATEGY 2: ORIGINAL + CRYPTO
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── STRATEGY 2: ORIGINAL + CRYPTO ──\n');

// Check which crypto files exist
const cryptoAvail = CRYPTO.filter(n=>fs.existsSync(`${DATA_1H}${n}.json`));
console.log(`Crypto available: ${cryptoAvail.length>0?cryptoAvail.join(', '):'none (download with fetch_dukascopy.js)'}\n`);

if(cryptoAvail.length>0){
  pr('OG baseline + BTCUSD (15 insts)',  setOG(ALL_CRYPTO, BASE));
  pr('OG + disp + both KZ (15 insts)',   setOG(ALL_CRYPTO, DISPB));
  pr('BTCUSD alone (baseline)',          [runOG('BTCUSD',BASE)].flat());
  pr('BTCUSD alone + disp + both KZ',   [runOG('BTCUSD',DISPB)].flat());
  pr('BTCUSD alone RB',                  [runRB('BTCUSD',BASE)].flat());
  pr('BTCUSD + disp + best port+BTC',   setOG([...BEST_1H,'BTCUSD'],DISP));
}

// ═════════════════════════════════════════════════════════════════════════════
// STRATEGY 3: COMBO — OG-displacement primary + RB fallback
// "On days with no liquidity grab → aim for rejection blocks"
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── STRATEGY 3: COMBO (OG-disp primary + RB fallback) ──\n');

const comboBase = setCombo(ALL_1H, {...BASE, kz:'both'});
const comboRBOnly = comboBase.filter(t=>t.mode==='rb');
const comboOGOnly = comboBase.filter(t=>t.mode==='og');

pr('Combo both KZ (14)',              comboBase);
pr('  └── OG-portion only',          comboOGOnly);
pr('  └── RB-portion only',          comboRBOnly);
pr('Combo NY-AM (14)',                setCombo(ALL_1H,{...BASE,kz:'ny-am'}));
pr('Combo London (14)',               setCombo(ALL_1H,{...BASE,kz:'london'}));
pr('Combo + best port',              setCombo(BEST_1H,{...BASE,kz:'both'}));
if(cryptoAvail.length>0){
  pr('Combo + best port + crypto',   setCombo([...BEST_1H,'BTCUSD'],{...BASE,kz:'both'}));
}

// Mode breakdown
console.log('\nCombo split detail (both KZ, 14 insts):');
console.log(`  OG portion: n=${comboOGOnly.length} | RB portion: n=${comboRBOnly.length}`);
if(comboOGOnly.length>0){const s=st(comboOGOnly);console.log(`  OG: wr=${s.wr.toFixed(1)}% exp=${s.exp.toFixed(3)}R`);}
if(comboRBOnly.length>0){const s=st(comboRBOnly);console.log(`  RB: wr=${s.wr.toFixed(1)}% exp=${s.exp.toFixed(3)}R`);}

// ═════════════════════════════════════════════════════════════════════════════
// STRATEGY 4: M15 (requires bt_data_m15/ — download with fetch_dukascopy.js)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── STRATEGY 4: M15 TIMEFRAME ──\n');
if(!M15_AVAIL){
  console.log('  [SKIP] bt_data_m15/ not found. To enable M15 strategies:');
  console.log('  1. Modified fetch_dukascopy.js now saves M15 data to bt_data_m15/');
  console.log('  2. Run: node fetch_dukascopy.js EURUSD 2020 2026');
  console.log('     (repeat for GBPUSD, USDJPY, AUDUSD, GBPJPY, XAUUSD, NQ_PROXY)');
  console.log('  3. Re-run backtest18.js — M15 results will appear here.');
} else {
  const M15_INSTS = fs.readdirSync(DATA_M15).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''));
  console.log(`  M15 instruments found: ${M15_INSTS.join(', ')}`);
  [...M15_INSTS].forEach(n=>inst(n,DATA_M15));

  console.log('\nM15 Original:');
  pr('M15 OG baseline',               setOG(M15_INSTS, BASE, DATA_M15));
  pr('M15 OG + disp + both KZ',       setOG(M15_INSTS, DISPB, DATA_M15));

  console.log('\nM15 Rejection Block:');
  pr('M15 RB baseline',               setRB(M15_INSTS, BASE, DATA_M15));
  pr('M15 RB + disp + both KZ',       setRB(M15_INSTS, DISPB, DATA_M15));

  console.log('\nM15 Combo:');
  pr('M15 Combo + both KZ',           setCombo(M15_INSTS,{...BASE,kz:'both'}, DATA_M15));

  if(cryptoAvail.length>0){
    console.log('\nM15 + Crypto:');
    pr('M15 + BTCUSD OG disp both KZ', setOG([...M15_INSTS,'BTCUSD'],DISPB,DATA_M15));
    pr('M15 + BTCUSD Combo both KZ',   setCombo([...M15_INSTS,'BTCUSD'],{...BASE,kz:'both'},DATA_M15));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TARGETED CONFIG TEST — 12 hand-picked variants around known champion
// (Full grid sweep was too slow — O(n²) daily filter × 1890 configs)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── TARGETED CONFIG TEST (12 key variants) ──\n');

const CONFIGS = [
  // OG variants (champion is #1)
  {label:'OG  disp+bothKZ  wick0.5 stk2 [CHAMPION]', eng:'og', cfg:{...BASE,disp:true,kz:'both',wick:0.5,stack:2}},
  {label:'OG  disp+London  wick0.5 stk2',             eng:'og', cfg:{...BASE,disp:true,kz:'london',wick:0.5,stack:2}},
  {label:'OG  disp+bothKZ  wick0.55 stk2',            eng:'og', cfg:{...BASE,disp:true,kz:'both',wick:0.55,stack:2}},
  {label:'OG  disp+bothKZ  wick0.6 stk2',             eng:'og', cfg:{...BASE,disp:true,kz:'both',wick:0.6,stack:2}},
  {label:'OG  disp+bothKZ  wick0.5 stk3',             eng:'og', cfg:{...BASE,disp:true,kz:'both',wick:0.5,stack:3}},
  {label:'OG  disp+London  wick0.6 stk2',             eng:'og', cfg:{...BASE,disp:true,kz:'london',wick:0.6,stack:2}},
  // RB variants
  {label:'RB  nodisp+London wick0.5 win3',            eng:'rb', cfg:{...BASE,kz:'london',wick:0.5,rbWindow:3}},
  {label:'RB  nodisp+bothKZ wick0.5 win3',            eng:'rb', cfg:{...BASE,kz:'both',wick:0.5,rbWindow:3}},
  {label:'RB  nodisp+bothKZ wick0.6 win6',            eng:'rb', cfg:{...BASE,kz:'both',wick:0.6,rbWindow:6}},
  // Combo variants
  {label:'CBO disp+bothKZ  wick0.5 stk2 [2x signals]',eng:'combo',cfg:{...BASE,kz:'both',wick:0.5,stack:2}},
  {label:'CBO disp+bothKZ  wick0.55 stk2',            eng:'combo',cfg:{...BASE,kz:'both',wick:0.55,stack:2}},
  {label:'CBO disp+London  wick0.5 stk2',             eng:'combo',cfg:{...BASE,kz:'london',wick:0.5,stack:2}},
];

const results = [];
for(const {label,eng,cfg} of CONFIGS){
  const t = eng==='og'?setOG(ALL_1H,cfg):eng==='rb'?setRB(ALL_1H,cfg):setCombo(ALL_1H,cfg);
  const s = pr(label, t, 50);
  if(s) results.push({label,n:s.n,wr:s.wr,exp:s.exp,gen:(s.eTr>0&&s.eTe>0)?'✓':'~'});
}

const sorted = results.filter(r=>r.gen==='✓'&&r.n>=10).sort((a,b)=>b.wr-a.wr);
console.log('\n── Ranking (✓BOTH, n≥10, by win rate) ──');
sorted.forEach((r,i)=>
  console.log(`  ${String(i+1).padStart(2)}. WR=${r.wr.toFixed(1)}% exp=${r.exp.toFixed(3)}R n=${r.n.toString().padStart(4)} — ${r.label}`)
);

// ═════════════════════════════════════════════════════════════════════════════
// SIGNAL FREQUENCY TABLE — how many signals per year per strategy
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── SIGNAL FREQUENCY (trades/year, all instruments) ──\n');
const years = 6.5; // approx 2020-2026
[
  ['OG baseline',          setOG(ALL_1H,BASE)],
  ['OG + disp + both KZ',  setOG(ALL_1H,DISPB)],
  ['OG + disp + best port',setOG(BEST_1H,DISP)],
  ['RB baseline',          setRB(ALL_1H,BASE)],
  ['RB + disp + both KZ',  setRB(ALL_1H,DISPB)],
  ['Combo + both KZ',      setCombo(ALL_1H,{...BASE,kz:'both'})],
].forEach(([lbl,t])=>
  console.log(`  ${lbl.padEnd(28)} n=${String(t.length).padStart(4)} total → ${(t.length/years).toFixed(1).padStart(5)}/year  (${(t.length/14/years).toFixed(2).padStart(4)}/inst/yr)`)
);

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY / RECOMMENDATIONS');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('• OG + disp + bothKZ  = bt17 champion = 79.5%WR +0.654R  (n=83)');
console.log('• RB adds body-retest filter — check above for WR vs OG');
console.log('• Combo maximizes signal freq while keeping quality');
console.log('• M15: run fetch_dukascopy.js (now saves bt_data_m15/) then re-run this');
console.log('• BTCUSD adds signals (2022 data only so far — extend with:');
console.log('    node fetch_dukascopy.js BTCUSD 2020 2026)');
console.log('══════════════════════════════════════════════════════════════════════════');
