// backtest19.js — V2 Multi-Strategy: 16 new variants
// Builds on V1 champion: 1H OG+disp+bothKZ+wick0.55 (81.2% WR, n=69)
// and M15 champion: M15+disp+bothKZ+wick0.55 (67.7% WR, n=164)
// NEW: D1-trend filter, day-of-week, weekly-bias, FVG-entry, high-RR,
//      stack≥3, Asian KZ, 1H→M15 hybrid entry, deep combo filters.
'use strict';
const IST = 5.5 * 3600, fs = require('fs');
const D1H  = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';
const DM15 = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_m15/';

// ── data helpers ──
function load(name, dir) {
  const p = `${dir}${name}.json`;
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p)).map(x => {
    const d = new Date((x.t + IST) * 1000);
    return { t:x.t, day:d.toISOString().slice(0,10),
             min:d.getUTCHours()*60+d.getUTCMinutes(),
             dow:d.getUTCDay(), // 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
             o:x.o, h:x.h, l:x.l, c:x.c };
  });
}
function ema(a,p){ const k=2/(p+1); let e=a[0],o=[e]; for(let i=1;i<a.length;i++){e=a[i]*k+e*(1-k);o.push(e);} return o; }
function atr(B,k,n=14){ let s=0,c=0; for(let i=Math.max(1,k-n+1);i<=k;i++){s+=Math.max(B[i].h-B[i].l,Math.abs(B[i].h-B[i-1].c),Math.abs(B[i].l-B[i-1].c));c++;} return c?s/c:0; }
function rsC(B,secs){ const m=new Map(); for(const b of B){const key=Math.floor((b.t+IST)/secs);if(!m.has(key))m.set(key,{key,o:b.o,h:b.h,l:b.l,c:b.c});else{const x=m.get(key);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}} return[...m.values()].sort((a,b)=>a.key-b.key).map(x=>({end:(x.key+1)*secs-IST,o:x.o,h:x.h,l:x.l,c:x.c})); }
function zones(TS){ const z=[],n=TS.length; for(let i=2;i<n;i++){if(TS[i].l>TS[i-2].h)z.push({dir:'sup',lo:TS[i-2].h,hi:TS[i].l,t:TS[i].end});if(TS[i].h<TS[i-2].l)z.push({dir:'res',lo:TS[i].h,hi:TS[i-2].l,t:TS[i].end});} for(let i=0;i<n-1;i++){if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({dir:'sup',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({dir:'res',lo:TS[i].l,hi:TS[i].h,t:TS[i+1].end});} return z; }
function emaSer(TS){ const e=ema(TS.map(x=>x.c),10); return TS.map((b,i)=>({end:b.end,v:e[i]})); }
function trendAt(s,te,price){ let v=null; for(const x of s){if(x.end<=te)v=x.v;else break;} return v==null?null:(price>=v?'bull':'bear'); }

// ── parameterized tiered exit ──
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

// ── instrument cache ──
const CACHE={};
function inst(name,dir){
  const key=`${dir}${name}`;
  if(CACHE[key]) return CACHE[key];
  const B=load(name,dir); if(!B) return null;
  const Dc=rsC(B,86400),H4c=rsC(B,14400),H2c=rsC(B,7200),H1c=rsC(B,3600),Wc=rsC(B,604800);
  CACHE[key]={ B, Dc, Z:{D:zones(Dc),'4H':zones(H4c),'2H':zones(H2c),'1H':zones(H1c)},
    Da:emaSer(Dc), H4a:emaSer(H4c), H1a:emaSer(H1c), Wc };
  return CACHE[key];
}

// ── universal V2 engine ──
// cfg flags: disp, kz('both'|'london'|'ny-am'|'all3'), wick, stack,
//            d1trend, dow(Tue-Thu), weekly, fvg, tp1/tp2/tp3, look
function runV2(name, cfg, dir) {
  dir=dir||D1H;
  const d=inst(name,dir); if(!d) return [];
  const {B,Dc,Z,Da,H4a,H1a,Wc}=d;
  const LOOK=cfg.look||6, maxBars=dir===DM15?288:72;
  const tol=z=>0.25*(z.hi-z.lo)+0.05;
  const stk=(poi,price,te)=>{ let n=0; for(const tf of ['D','4H','2H','1H']) if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++; return n; };
  const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915, asian=m=>m>=390&&m<510;
  const kzOK=m=>cfg.kz==='london'?london(m):cfg.kz==='ny-am'?nyam(m):cfg.kz==='all3'?(nyam(m)||london(m)||asian(m)):(nyam(m)||london(m));
  const out=[],seen=new Set();
  for(let k=50;k<B.length-5;k++){
    const b=B[k];
    if(!kzOK(b.min)||seen.has(b.day)) continue;
    if(cfg.dow&&![2,3,4].includes(b.dow)) continue; // Tue/Wed/Thu only
    const A=atr(B,k); if(A<=0) continue;
    const dailies=Dc.filter(x=>x.end<=b.t); if(dailies.length<5) continue;
    const dr=dailies.slice(-5);
    const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
    const rl=Math.min(...Array.from({length:LOOK},(_,o)=>B[k-1-o].l));
    const rh=Math.max(...Array.from({length:LOOK},(_,o)=>B[k-1-o].h));
    const range=(b.h-b.l)||1;
    const d1=trendAt(Da,b.t,b.c),h4=trendAt(H4a,b.t,b.c),h1=trendAt(H1a,b.t,b.c);
    if(!d1||!h4||!h1) continue;
    const trendOK=dir2=>cfg.d1trend?(d1===dir2&&h4===dir2&&h1===dir2):(h4===dir2&&h1===dir2);
    // Weekly open bias: for longs price < weekly open, for shorts price > weekly open
    const weeklyOK=dir2=>{
      if(!cfg.weekly||!Wc.length) return true;
      const wb=Wc.filter(w=>w.end<=b.t); if(!wb.length) return true;
      return dir2==='long'?b.c<wb[wb.length-1].o:b.c>wb[wb.length-1].o;
    };
    let dir2=null,entry,sl;
    if(b.l<rl&&b.c>rl&&b.c<eq){ const wick=(Math.min(b.o,b.c)-b.l)/range;
      if(wick>=cfg.wick&&stk('sup',b.c,b.t)>=cfg.stack&&trendOK('bull')&&weeklyOK('long')){dir2='long';entry=b.c;sl=b.l;} }
    else if(b.h>rh&&b.c<rh&&b.c>eq){ const wick=(b.h-Math.max(b.o,b.c))/range;
      if(wick>=cfg.wick&&stk('res',b.c,b.t)>=cfg.stack&&trendOK('bear')&&weeklyOK('short')){dir2='short';entry=b.c;sl=b.h;} }
    if(!dir2) continue;
    // Displacement confirmation
    if(cfg.disp&&k+1<B.length){
      const nb=B[k+1],nbR=(nb.h-nb.l)||1;
      if(dir2==='long'){if((nb.c-nb.l)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
      else{if((nb.h-nb.c)/nbR<0.55||Math.abs(nb.c-nb.o)<0.3*A)continue;}
    }
    // FVG entry: after displacement bar (k+1), wait for retrace into lower 50% of disp bar, close back above
    if(cfg.fvg){
      if(k+1>=B.length) continue;
      const db=B[k+1]; const dbMid=(db.h+db.l)/2;
      for(let j=k+2;j<Math.min(k+13,B.length-3);j++){
        const nb=B[j];
        if(dir2==='long'&&nb.l<=dbMid&&nb.c>=dbMid){ const R=mgmt(B,j,dir2,nb.c,sl,cfg.tp1,cfg.tp2,cfg.tp3,maxBars); out.push({t:b.t,R,dir:dir2,inst:name});seen.add(b.day);break; }
        if(dir2==='short'&&nb.h>=dbMid&&nb.c<=dbMid){ const R=mgmt(B,j,dir2,nb.c,sl,cfg.tp1,cfg.tp2,cfg.tp3,maxBars); out.push({t:b.t,R,dir:dir2,inst:name});seen.add(b.day);break; }
      }
      continue;
    }
    const R=mgmt(B,k,dir2,entry,sl,cfg.tp1,cfg.tp2,cfg.tp3,maxBars);
    out.push({t:b.t,R,dir:dir2,inst:name}); seen.add(b.day);
  }
  return out;
}

// ── Hybrid: 1H sweep detection → enter at first valid M15 displacement bar ──
// Gives 1H-quality setup with up to 45-min earlier entry than waiting for 1H displacement
function runHybrid(names) {
  const out=[];
  for(const name of names){
    const d1h=inst(name,D1H),dm15=inst(name,DM15); if(!d1h||!dm15) continue;
    const {B:B1H,Dc,Z,Da,H4a,H1a}=d1h, {B:BM15}=dm15;
    const tol=z=>0.25*(z.hi-z.lo)+0.05;
    const stk=(poi,price,te)=>{ let n=0; for(const tf of ['D','4H','2H','1H']) if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++; return n; };
    const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
    const seen=new Set();
    let m15ptr=0; // pointer into BM15 — advances monotonically (never resets)
    for(let k=50;k<B1H.length-5;k++){
      const b=B1H[k];
      if(!(nyam(b.min)||london(b.min))||seen.has(b.day)) continue;
      const A=atr(B1H,k); if(A<=0) continue;
      const dailies=Dc.filter(x=>x.end<=b.t); if(dailies.length<5) continue;
      const dr=dailies.slice(-5);
      const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
      const rl=Math.min(...Array.from({length:6},(_,o)=>B1H[k-1-o].l));
      const rh=Math.max(...Array.from({length:6},(_,o)=>B1H[k-1-o].h));
      const range=(b.h-b.l)||1;
      const d1=trendAt(Da,b.t,b.c),h4=trendAt(H4a,b.t,b.c),h1=trendAt(H1a,b.t,b.c);
      if(!d1||!h4||!h1||h4!==h1) continue;
      let dir=null,sl;
      if(b.l<rl&&b.c>rl&&b.c<eq){ const wick=(Math.min(b.o,b.c)-b.l)/range; if(wick>=0.55&&stk('sup',b.c,b.t)>=2){dir='long';sl=b.l;} }
      else if(b.h>rh&&b.c<rh&&b.c>eq){ const wick=(b.h-Math.max(b.o,b.c))/range; if(wick>=0.55&&stk('res',b.c,b.t)>=2){dir='short';sl=b.h;} }
      if(!dir) continue;
      // Advance m15ptr to sweep bar close time
      while(m15ptr<BM15.length&&BM15[m15ptr].t<b.t) m15ptr++;
      const windowEnd=b.t+3600; // search 4 M15 bars (1 hour)
      let p=m15ptr;
      if(p<5||p>=BM15.length) continue;
      const A15=atr(BM15,Math.min(p,BM15.length-1));
      while(p<BM15.length&&BM15[p].t<windowEnd){
        const mb=BM15[p],mbR=(mb.h-mb.l)||1;
        if(dir==='long'&&(mb.c-mb.l)/mbR>=0.55&&Math.abs(mb.c-mb.o)>=0.3*A15){
          const R=mgmt(BM15,p,dir,mb.c,sl,1,1.7,2.56,288); out.push({t:b.t,R,dir,inst:name});seen.add(b.day);break; }
        if(dir==='short'&&(mb.h-mb.c)/mbR>=0.55&&Math.abs(mb.c-mb.o)>=0.3*A15){
          const R=mgmt(BM15,p,dir,mb.c,sl,1,1.7,2.56,288); out.push({t:b.t,R,dir,inst:name});seen.add(b.day);break; }
        p++;
      }
    }
  }
  return out;
}

// ── Combo V2: OG-disp primary + RB body-retest fallback, wick0.55 ──
function runComboV2(names, dir) {
  dir=dir||DM15;
  const out=[];
  for(const name of names){
    const d=inst(name,dir); if(!d) continue;
    const {B,Dc,Z,Da,H4a,H1a}=d;
    const LOOK=6, maxBars=dir===DM15?288:72;
    const tol=z=>0.25*(z.hi-z.lo)+0.05;
    const stk=(poi,price,te)=>{ let n=0; for(const tf of ['D','4H','2H','1H']) if(Z[tf].some(z=>z.dir===poi&&z.t<=te&&price>=z.lo-tol(z)&&price<=z.hi+tol(z)))n++; return n; };
    const nyam=m=>m>=1020&&m<1260, london=m=>m>=735&&m<915;
    const seen=new Set();
    for(let k=50;k<B.length-5;k++){
      const b=B[k]; if(!(nyam(b.min)||london(b.min))||seen.has(b.day)) continue;
      const A=atr(B,k); if(A<=0) continue;
      const dailies=Dc.filter(x=>x.end<=b.t); if(dailies.length<5) continue;
      const dr=dailies.slice(-5);
      const drHi=Math.max(...dr.map(x=>x.h)),drLo=Math.min(...dr.map(x=>x.l)),eq=(drHi+drLo)/2;
      const rl=Math.min(...Array.from({length:LOOK},(_,o)=>B[k-1-o].l));
      const rh=Math.max(...Array.from({length:LOOK},(_,o)=>B[k-1-o].h));
      const range=(b.h-b.l)||1;
      const d1=trendAt(Da,b.t,b.c),h4=trendAt(H4a,b.t,b.c),h1=trendAt(H1a,b.t,b.c);
      if(!d1||!h4||!h1||h4!==h1) continue;
      let dir2=null,entry,sl,bLo,bHi;
      if(b.l<rl&&b.c>rl&&b.c<eq){ const wick=(Math.min(b.o,b.c)-b.l)/range;
        if(wick>=0.55&&stk('sup',b.c,b.t)>=2){dir2='long';entry=b.c;sl=b.l;bLo=Math.min(b.o,b.c);bHi=Math.max(b.o,b.c);} }
      else if(b.h>rh&&b.c<rh&&b.c>eq){ const wick=(b.h-Math.max(b.o,b.c))/range;
        if(wick>=0.55&&stk('res',b.c,b.t)>=2){dir2='short';entry=b.c;sl=b.h;bLo=Math.min(b.o,b.c);bHi=Math.max(b.o,b.c);} }
      if(!dir2) continue;
      // Primary: OG displacement
      if(k+1<B.length){ const nb=B[k+1],nbR=(nb.h-nb.l)||1; let dispOK=false;
        if(dir2==='long') dispOK=(nb.c-nb.l)/nbR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*A;
        else dispOK=(nb.h-nb.c)/nbR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*A;
        if(dispOK){ const R=mgmt(B,k,dir2,entry,sl,1,1.7,2.56,maxBars); out.push({t:b.t,R,dir:dir2,inst:name});seen.add(b.day);continue; } }
      // Fallback: RB body retest
      const bMid=(bLo+bHi)/2;
      for(let j=k+2;j<Math.min(k+13,B.length-3);j++){
        const nb=B[j];
        if(dir2==='long'&&nb.l<=bHi&&nb.c>=bMid){ const R=mgmt(B,j,dir2,nb.c,sl,1,1.7,2.56,maxBars); out.push({t:b.t,R,dir:dir2,inst:name});seen.add(b.day);break; }
        if(dir2==='short'&&nb.h>=bLo&&nb.c<=bMid){ const R=mgmt(B,j,dir2,nb.c,sl,1,1.7,2.56,maxBars); out.push({t:b.t,R,dir:dir2,inst:name});seen.add(b.day);break; }
      }
    }
  }
  return out;
}

// ── stats & display ──
function wilson(w,n){if(!n)return[0,0];const z=1.96,p=w/n,d=1+z*z/n,c=(p+z*z/2/n)/d,h=z*Math.sqrt(p*(1-p)/n+z*z/4/n/n)/d;return[(c-h)*100,(c+h)*100];}
function st(a){const n=a.length,win=a.filter(s=>s.R>0).length,tot=a.reduce((x,s)=>x+s.R,0),ci=wilson(win,n);const ts=a.map(x=>x.t),mid=ts.length?(Math.max(...ts)+Math.min(...ts))/2:0;const tr=a.filter(x=>x.t<mid),te=a.filter(x=>x.t>=mid);return{n,wr:n?win/n*100:0,ci,exp:n?tot/n:0,eTr:tr.length?tr.reduce((x,s)=>x+s.R,0)/tr.length:0,eTe:te.length?te.reduce((x,s)=>x+s.R,0)/te.length:0};}
function pr(lbl,trades,cols){cols=cols||66;
  const s=st(trades);
  if(!s.n){console.log(lbl.padEnd(cols),`n=   0`);return s;}
  const gen=(s.eTr>0&&s.eTe>0)?'✓BOTH':(s.eTr>0||s.eTe>0)?'~ONE':'✗NEG';
  console.log(lbl.padEnd(cols),`n=${String(s.n).padStart(4)} wr=${s.wr.toFixed(1).padStart(5)}% [${s.ci[0].toFixed(0).padStart(3)}-${s.ci[1].toFixed(0).padStart(3)}] exp=${s.exp.toFixed(3).padStart(7)}R Tr/Te:${s.eTr.toFixed(2)}/${s.eTe.toFixed(2)} ${gen}`);
  return s;
}

// ── instruments ──
const INS14=['NQ','ES','GC','CL','EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','GBPJPY','EURJPY','RTY','SI','YM'];
const INS5=fs.existsSync(DM15)?fs.readdirSync(DM15).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json','')):[];
const HYBRIDS=INS5.filter(n=>fs.existsSync(`${D1H}${n}.json`));
const run14=(cfg)=>INS14.flatMap(n=>runV2(n,cfg,D1H));
const run5=(cfg)=>INS5.flatMap(n=>runV2(n,cfg,DM15));

// ── champion configs ──
const V1 ={disp:true,kz:'both',wick:0.5, stack:2};
const V2 ={disp:true,kz:'both',wick:0.55,stack:2};

// ══════════════════════════════════════════════════════════════════════════════
console.log('═'.repeat(74));
console.log('backtest19 — V2 Multi-Strategy: 16 new variants + references');
console.log(`M15 instruments: ${INS5.join(', ')} | Hybrid: ${HYBRIDS.join(', ')}`);
console.log('═'.repeat(74));

// ── Reference benchmarks ──
console.log('\n── REFERENCE BENCHMARKS ──\n');
pr('V1 champ  1H+disp+bothKZ+wick0.5   [14]', run14(V1));
pr('V2 champ  1H+disp+bothKZ+wick0.55  [14]', run14(V2));
pr('M15 champ M15+disp+bothKZ+wick0.55  [5]', run5(V2));

// ── 1H new filters ──
console.log('\n── S1-S5: 1H NEW FILTERS ──\n');
const s={}; // collect all results for ranking
s.S1=pr('S1: 1H London+D1trend+wick0.55         [14]', run14({disp:true,kz:'london',wick:0.55,stack:2,d1trend:true}));
s.S2=pr('S2: 1H bothKZ+wick0.55+TuWeThu DOW     [14]', run14({disp:true,kz:'both',  wick:0.55,stack:2,dow:true}));
s.S3=pr('S3: 1H bothKZ+wick0.55+weekly-bias      [14]', run14({disp:true,kz:'both',  wick:0.55,stack:2,weekly:true}));
s.S4=pr('S4: 1H bothKZ+wick0.55+stack≥3          [14]', run14({disp:true,kz:'both',  wick:0.55,stack:3}));
s.S5=pr('S5: 1H London+D1+DOW+wick0.55+stk3     [14]', run14({disp:true,kz:'london',wick:0.55,stack:3,d1trend:true,dow:true}));

// ── M15 new filters ──
console.log('\n── S6-S11: M15 NEW FILTERS ──\n');
s.S6 =pr('S6:  M15 bothKZ+wick0.55+D1trend         [5]', run5({disp:true,kz:'both',  wick:0.55,stack:2,d1trend:true}));
s.S7 =pr('S7:  M15 bothKZ+wick0.55+TuWeThu DOW     [5]', run5({disp:true,kz:'both',  wick:0.55,stack:2,dow:true}));
s.S8 =pr('S8:  M15 bothKZ+wick0.55+weekly-bias      [5]', run5({disp:true,kz:'both',  wick:0.55,stack:2,weekly:true}));
s.S9 =pr('S9:  M15 bothKZ+wick0.55+stack≥3          [5]', run5({disp:true,kz:'both',  wick:0.55,stack:3}));
s.S10=pr('S10: M15 London+D1trend+wick0.55          [5]', run5({disp:true,kz:'london',wick:0.55,stack:2,d1trend:true}));
s.S11=pr('S11: M15 all3KZ+wick0.55 (incl. Asian)    [5]', run5({disp:true,kz:'all3', wick:0.55,stack:2}));

// ── New entry/exit approaches ──
console.log('\n── S12-S14: NEW ENTRY/EXIT APPROACHES ──\n');
s.S12=pr('S12: M15 FVG-retracement entry (better RR)[5]', run5({disp:true,kz:'both',wick:0.55,stack:2,fvg:true}));
s.S13=pr('S13: M15 HighRR targets 1.5/2.5/4R        [5]', run5({disp:true,kz:'both',wick:0.55,stack:2,tp1:1.5,tp2:2.5,tp3:4}));
s.S14=pr('S14: 1H HighRR targets 1.5/2.5/4R        [14]', run14({disp:true,kz:'both',wick:0.55,stack:2,tp1:1.5,tp2:2.5,tp3:4}));

// ── Hybrid and Combo ──
console.log('\n── S15-S16: HYBRID & COMBO ──\n');
const hybridTrades=runHybrid(HYBRIDS);
s.S15=pr('S15: Hybrid 1H-sweep→M15-entry (wick0.55)', hybridTrades);
const comboTrades=runComboV2(INS5,DM15);
s.S16=pr('S16: M15 ComboV2 OG+RB fallback wick0.55 ', comboTrades);

// ── Combined filters on M15 ──
console.log('\n── S17-S18: DEEP COMBINED FILTERS ──\n');
s.S17=pr('S17: M15 D1+DOW+wick0.55+stack3 [DEEP]    [5]', run5({disp:true,kz:'both',wick:0.55,stack:3,d1trend:true,dow:true}));
s.S18=pr('S18: M15 D1+weekly+wick0.55+stack2         [5]', run5({disp:true,kz:'both',wick:0.55,stack:2,d1trend:true,weekly:true}));

// ── Signal frequency table ──
console.log('\n── SIGNAL FREQUENCY (extrapolated to 14-instrument portfolio) ──\n');
const yrsM15=(()=>{ if(!INS5.length)return 1; const d=load(INS5[0],DM15); return d?(d[d.length-1].t-d[0].t)/86400/365.25:1; })();
const yrs1H=6.5;
const freq=(n,insts,yrs)=>{ const piy=n/insts/yrs; return `${Math.round(piy*14)}/yr (~${Math.round(piy*14/12)}/mo)`; };
[
  ['V1 champ 1H+0.5',       run14(V1).length,  14, yrs1H],
  ['V2 champ 1H+0.55',      run14(V2).length,  14, yrs1H],
  ['S2 1H+DOW',             run14({disp:true,kz:'both',wick:0.55,stack:2,dow:true}).length, 14, yrs1H],
  ['S4 1H+stack3',          run14({disp:true,kz:'both',wick:0.55,stack:3}).length, 14, yrs1H],
  ['M15 champ+0.55',        run5(V2).length,   5,  yrsM15],
  ['S7 M15+DOW',            run5({disp:true,kz:'both',wick:0.55,stack:2,dow:true}).length, 5, yrsM15],
  ['S6 M15+D1trend',        run5({disp:true,kz:'both',wick:0.55,stack:2,d1trend:true}).length, 5, yrsM15],
  ['S15 Hybrid',            hybridTrades.length, HYBRIDS.length, yrsM15],
  ['S16 ComboV2',           comboTrades.length, 5, yrsM15],
].forEach(([lbl,n,insts,yrs])=>console.log(`  ${lbl.padEnd(22)} n=${String(n).padStart(4)} → ${freq(n,insts,yrs).padStart(20)}`));

// ── Final ranking ──
console.log('\n── FINAL RANKING (✓BOTH & n≥10, sorted by WR) ──\n');
const allRes=[
  ['V1 champ 1H',      run14(V1)],
  ['V2 champ 1H',      run14(V2)],
  ['M15 champ',        run5(V2)],
  ['S1 1H London+D1',  run14({disp:true,kz:'london',wick:0.55,stack:2,d1trend:true})],
  ['S2 1H+DOW',        run14({disp:true,kz:'both',wick:0.55,stack:2,dow:true})],
  ['S3 1H+weekly',     run14({disp:true,kz:'both',wick:0.55,stack:2,weekly:true})],
  ['S4 1H+stack3',     run14({disp:true,kz:'both',wick:0.55,stack:3})],
  ['S5 1H Ldn+D1+DOW+stk3', run14({disp:true,kz:'london',wick:0.55,stack:3,d1trend:true,dow:true})],
  ['S6 M15+D1trend',   run5({disp:true,kz:'both',wick:0.55,stack:2,d1trend:true})],
  ['S7 M15+DOW',       run5({disp:true,kz:'both',wick:0.55,stack:2,dow:true})],
  ['S8 M15+weekly',    run5({disp:true,kz:'both',wick:0.55,stack:2,weekly:true})],
  ['S9 M15+stack3',    run5({disp:true,kz:'both',wick:0.55,stack:3})],
  ['S10 M15 Ldn+D1',   run5({disp:true,kz:'london',wick:0.55,stack:2,d1trend:true})],
  ['S11 M15+all3KZ',   run5({disp:true,kz:'all3', wick:0.55,stack:2})],
  ['S12 M15 FVG',      run5({disp:true,kz:'both',wick:0.55,stack:2,fvg:true})],
  ['S13 M15 HighRR',   run5({disp:true,kz:'both',wick:0.55,stack:2,tp1:1.5,tp2:2.5,tp3:4})],
  ['S14 1H HighRR',    run14({disp:true,kz:'both',wick:0.55,stack:2,tp1:1.5,tp2:2.5,tp3:4})],
  ['S15 Hybrid',       hybridTrades],
  ['S16 ComboV2',      comboTrades],
  ['S17 M15 DEEP',     run5({disp:true,kz:'both',wick:0.55,stack:3,d1trend:true,dow:true})],
  ['S18 M15 D1+wkly',  run5({disp:true,kz:'both',wick:0.55,stack:2,d1trend:true,weekly:true})],
];
allRes.map(([lbl,t])=>{const ss=st(t);const ok=ss.eTr>0&&ss.eTe>0&&ss.n>=10;return{lbl,ss,ok};})
  .filter(x=>x.ok).sort((a,b)=>b.ss.wr-a.ss.wr)
  .forEach((x,i)=>console.log(`  ${String(i+1).padStart(2)}. WR=${x.ss.wr.toFixed(1).padStart(5)}% exp=${x.ss.exp.toFixed(3).padStart(7)}R n=${String(x.ss.n).padStart(4)} — ${x.lbl}`));
console.log('\n'+'═'.repeat(74));
