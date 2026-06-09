'use strict';

// Fed Forex — Multi-Strategy Backtest v2
// A = 30m Sweep (all 9 pairs)
// B = Silver Bullet 2-stage (FVG + displacement confirm)
// C = ODR Sweep (Asia range + wick filter)
// D = OTE Fib 62-79% (1H, zone-gated)
// E = Breaker Block (1H, tightened)

const IST      = 5.5 * 3600;
const WICK_MIN = 0.55;
const EMA_P    = 10;

const PAIRS = [
  ["AUDUSD","AUDUSD=X"],
  ["BTCUSD","BTC-USD"],
  ["ETHUSD","ETH-USD"],
  ["GBPJPY","GBPJPY=X"],
  ["GBPUSD","GBPUSD=X"],
  ["USDJPY","JPY=X"],
  ["EURUSD","EURUSD=X"],
  ["EURJPY","EURJPY=X"],
  ["GOLD",  "GC=F"],
];

// ─── Yahoo Finance ───────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function yf(sym, range, interval) {
  for (let t=0;t<3;t++) {
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
        {headers:{"User-Agent":"Mozilla/5.0"}}
      );
      if (r.status===429){await sleep(5000*(t+1));continue;}
      const j = await r.json();
      const res = j.chart?.result?.[0]; if(!res)return null;
      const q = res.indicators.quote[0];
      const bars=[];
      for(let i=0;i<res.timestamp.length;i++){
        if([q.open[i],q.high[i],q.low[i],q.close[i]].some(x=>x==null||isNaN(x)))continue;
        const d=new Date((res.timestamp[i]+IST)*1000);
        bars.push({t:res.timestamp[i],day:d.toISOString().slice(0,10),
          min:d.getUTCHours()*60+d.getUTCMinutes(),dow:d.getUTCDay(),
          o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});
      }
      return bars;
    } catch(e){await sleep(2000);}
  }
  return null;
}

function resample(B,secs){
  const m=new Map();
  for(const b of B){
    const k=Math.floor((b.t+IST)/secs);
    if(!m.has(k))m.set(k,{t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,min:b.min,dow:b.dow,day:b.day});
    else{const x=m.get(k);x.h=Math.max(x.h,b.h);x.l=Math.min(x.l,b.l);x.c=b.c;}
  }
  return[...m.values()].sort((a,b)=>a.t-b.t);
}
function emaArr(c,p){const k=2/(p+1);const o=[c[0]];for(let i=1;i<c.length;i++)o.push(c[i]*k+o[i-1]*(1-k));return o;}
function atrRolling(B,n=20){
  const out=[];
  for(let i=0;i<B.length;i++){
    if(i===0){out.push(B[i].h-B[i].l);continue;}
    const s=Math.max(0,i-n);
    let sum=0,cnt=0;
    for(let j=s+1;j<=i;j++){sum+=Math.max(B[j].h-B[j].l,Math.abs(B[j].h-B[j-1].c),Math.abs(B[j].l-B[j-1].c));cnt++;}
    out.push(cnt?sum/cnt:B[i].h-B[i].l);
  }
  return out;
}

// Precompute trends for every 1H bar (O(n) pointer walking)
function precomputeTrends(B1h){
  const h4B=resample(B1h,14400),d1B=resample(B1h,86400),wkB=resample(B1h,604800);
  const h4E=emaArr(h4B.map(b=>b.c),EMA_P);
  const h1E=emaArr(B1h.map(b=>b.c),EMA_P);
  const d1E=emaArr(d1B.map(b=>b.c),EMA_P);
  const wkE=emaArr(wkB.map(b=>b.c),EMA_P);
  const out=[];let h4p=0,d1p=0,wkp=0;
  for(let i=0;i<B1h.length;i++){
    const t=B1h[i].t;
    while(h4p+1<h4B.length&&h4B[h4p+1].t<=t)h4p++;
    while(d1p+1<d1B.length&&d1B[d1p+1].t<=t)d1p++;
    while(wkp+1<wkB.length&&wkB[wkp+1].t<=t)wkp++;
    out.push({t,
      h4:h4B[h4p].c>=h4E[h4p]?'bull':'bear',
      h1:B1h[i].c>=h1E[i]?'bull':'bear',
      d1:d1B[d1p].c>=d1E[d1p]?'bull':'bear',
      wk:wkB[wkp].c>=wkE[wkp]?'bull':'bear',
    });
  }
  return out;
}
function getTrend(trends,t){
  let lo=0,hi=trends.length-1,res=trends[0];
  while(lo<=hi){const m=(lo+hi)>>1;if(trends[m].t<=t){res=trends[m];lo=m+1;}else hi=m-1;}
  return res;
}

// Trade simulator
function simulate(bars,idx,dir,entry,sl,maxBars=60){
  const risk=Math.abs(entry-sl);
  if(risk<=0||risk>entry*0.15)return{outcome:'Invalid',R:0};
  const tp1=dir==='long'?entry+risk:entry-risk;
  const tp2=dir==='long'?entry+1.7*risk:entry-1.7*risk;
  const tp3=dir==='long'?entry+2.56*risk:entry-2.56*risk;
  for(let i=idx+1;i<Math.min(idx+maxBars,bars.length);i++){
    const b=bars[i];
    if(dir==='long'){
      if(b.l<=sl) return{outcome:'Loss',R:-1};
      if(b.h>=tp3)return{outcome:'Win', R:2.56};
      if(b.h>=tp2)return{outcome:'Win', R:1.7};
      if(b.h>=tp1)return{outcome:'Win', R:1.0};
    }else{
      if(b.h>=sl) return{outcome:'Loss',R:-1};
      if(b.l<=tp3)return{outcome:'Win', R:2.56};
      if(b.l<=tp2)return{outcome:'Win', R:1.7};
      if(b.l<=tp1)return{outcome:'Win', R:1.0};
    }
  }
  return{outcome:'Timeout',R:0};
}

function calcStats(trades,label){
  const dec=trades.filter(t=>t.outcome==='Win'||t.outcome==='Loss');
  const w=dec.filter(t=>t.outcome==='Win');
  const wr=dec.length?Math.round(w.length/dec.length*100):0;
  const avgR=dec.length?+(dec.reduce((s,t)=>s+t.R,0)/dec.length).toFixed(2):0;
  return{label,n:trades.length,decided:dec.length,wr,avgR};
}

// ═══════════════════════════════════════════════════════════════════════
// A) 30m Sweep + Displacement  — all 9 pairs
// ═══════════════════════════════════════════════════════════════════════
function strat_30m(B15m,B1h,trends){
  const B30m=resample(B15m,1800);
  const D1=resample(B1h,86400);
  const LOOK=4;const trades=[];
  for(let i=LOOK+1;i<B30m.length-1;i++){
    const b=B30m[i];
    const inL=b.min>=720&&b.min<930,inN=b.min>=1020&&b.min<1260;
    if(!inL&&!inN)continue;
    if(b.dow===0||b.dow===6)continue;
    const tr=getTrend(trends,b.t);
    if(!tr||tr.h4!==tr.h1)continue;
    const recent=B30m.slice(i-LOOK,i);
    const rl=Math.min(...recent.map(x=>x.l)),rh=Math.max(...recent.map(x=>x.h));
    const range=(b.h-b.l)||1;
    const d1s=D1.filter(x=>x.t<=b.t).slice(-5);
    const eq=d1s.length>=2?(Math.max(...d1s.map(x=>x.h))+Math.min(...d1s.map(x=>x.l)))/2:b.c;
    let dir=null,sl;
    if(b.l<rl&&b.c>rl&&b.c<eq){
      const wp=(Math.min(b.o,b.c)-b.l)/range;
      if(wp>=WICK_MIN&&tr.h4==='bull'){dir='long';sl=b.l;}
    }else if(b.h>rh&&b.c<rh&&b.c>eq){
      const wp=(b.h-Math.max(b.o,b.c))/range;
      if(wp>=WICK_MIN&&tr.h4==='bear'){dir='short';sl=b.h;}
    }
    if(!dir)continue;
    const nb=B30m[i+1];const bR=(nb.h-nb.l)||1;
    const ok=dir==='long'
      ?((nb.c-nb.l)/bR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*bR)
      :((nb.h-nb.c)/bR>=0.55&&Math.abs(nb.c-nb.o)>=0.3*bR);
    if(!ok)continue;
    trades.push(simulate(B30m,i+1,dir,nb.c,sl));
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════
// B) Silver Bullet 2-Stage — FVG touch + displacement confirm
//    Stage 1: FVG forms in window, price touches it → fire
//    Stage 2: next bar displaces in direction → entry
//    Filters: FVG size >= 0.15×ATR20 | HTF H4+H1 aligned
// ═══════════════════════════════════════════════════════════════════════
function strat_SB2(B15m,trends){
  const trades=[];
  const inWin=min=>(min>=450&&min<=570)||(min>=930&&min<=990)||(min>=1170&&min<=1230);
  const atr15=atrRolling(B15m,20);
  const fvgs=[];const pend=[];

  for(let i=2;i<B15m.length;i++){
    const b=B15m[i];
    if(b.dow===0||b.dow===6)continue;
    const tr=getTrend(trends,b.t);
    if(!tr||tr.h4!==tr.h1)continue;
    const atr=atr15[i]||b.c*0.001;

    // Expire FVGs older than 10 bars
    while(fvgs.length&&i-fvgs[0].fi>10)fvgs.shift();

    // Stage 2: check pending stage-1 signals
    for(let pi=pend.length-1;pi>=0;pi--){
      const p=pend[pi];
      if(i-p.touchI>2){pend.splice(pi,1);continue;}// expire after 2 bars
      if(i===p.touchI+1){
        const bR=(b.h-b.l)||1;
        const dispOK=p.dir==='long'
          ?((b.c-b.l)/bR>=0.55&&Math.abs(b.c-b.o)>=0.25*atr)
          :((b.h-b.c)/bR>=0.55&&Math.abs(b.c-b.o)>=0.25*atr);
        if(dispOK){
          pend.splice(pi,1);
          trades.push({...simulate(B15m,i,p.dir,b.c,p.sl),dir:p.dir});
        }
      }
    }

    if(inWin(b.min)){
      const p2=B15m[i-2];
      const fgUp=b.l-p2.h;  // bullish FVG size
      const fgDn=p2.l-b.h;  // bearish FVG size

      // Form new FVGs (must be >= 0.15×ATR20 in size)
      if(fgUp>atr*0.15&&tr.h4==='bull')
        fvgs.push({dir:'long', lo:p2.h,hi:b.l, fi:i,used:false});
      if(fgDn>atr*0.15&&tr.h4==='bear')
        fvgs.push({dir:'short',lo:b.h, hi:p2.l,fi:i,used:false});

      // Stage 1: price touches FVG zone → queue for stage 2
      for(const fvg of fvgs){
        if(fvg.used||i<=fvg.fi)continue;
        const touched=fvg.dir==='long'
          ?(b.l<=fvg.hi&&b.c>=fvg.lo)
          :(b.h>=fvg.lo&&b.c<=fvg.hi);
        if(touched){
          fvg.used=true;
          const gap=fvg.hi-fvg.lo;
          const sl=fvg.dir==='long'?fvg.lo-gap*0.5:fvg.hi+gap*0.5;
          pend.push({dir:fvg.dir,sl,touchI:i});
          break;
        }
      }
    }
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════
// C) ODR — Asia range sweep, tightened
//    Filter: Asia range must be <= 0.8×ATR20d (clean tight range)
//    Wick >= 0.45, H4 aligned
// ═══════════════════════════════════════════════════════════════════════
function strat_ODR(B15m,B1h,trends){
  const trades=[];
  // Daily ATR from 1H data
  const D1=resample(B1h,86400);
  const d1atr=atrRolling(D1,20);
  const d1atrMap=new Map(D1.map((b,i)=>[b.day,d1atr[i]]));

  const days=[...new Set(B15m.map(b=>b.day))];
  for(const day of days){
    const db=B15m.filter(b=>b.day===day);
    // Asia: 00:30–05:30 IST (30–330 min)
    const asia=db.filter(b=>b.min>=30&&b.min<=330);
    if(asia.length<4)continue;
    const aHi=Math.max(...asia.map(b=>b.h));
    const aLo=Math.min(...asia.map(b=>b.l));
    const aRange=aHi-aLo;if(aRange<=0)continue;
    // Asia range must be tight (< 0.8×daily ATR) — avoids ranging days
    const dAtr=d1atrMap.get(day)||aRange*2;
    if(aRange>dAtr*0.8)continue;
    // London: 05:30–08:30 IST (330–510 min)
    const lon=db.filter(b=>b.min>330&&b.min<=510);
    for(let j=0;j<lon.length;j++){
      const b=lon[j];
      const tr=getTrend(trends,b.t);if(!tr)continue;
      const range=(b.h-b.l)||1;
      const gi=B15m.indexOf(b);if(gi<0)continue;
      if(b.l<aLo&&b.c>aLo&&tr.h4==='bull'){
        const wp=(Math.min(b.o,b.c)-b.l)/range;
        if(wp>=0.45)trades.push({...simulate(B15m,gi,'long', b.c,b.l),dir:'long'});
      }
      if(b.h>aHi&&b.c<aHi&&tr.h4==='bear'){
        const wp=(b.h-Math.max(b.o,b.c))/range;
        if(wp>=0.45)trades.push({...simulate(B15m,gi,'short',b.c,b.h),dir:'short'});
      }
    }
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════
// D) OTE — Optimal Trade Entry 62–79% Fib (1H)
//    Added: require price near HTF OB/FVG zone for confluence
//    H4+H1 aligned, kill zone only
// ═══════════════════════════════════════════════════════════════════════
function zones(TS){
  const z=[];const n=TS.length;
  for(let i=2;i<n;i++){
    if(TS[i].l>TS[i-2].h)z.push({type:"FVG",dir:"sup",lo:TS[i-2].h,hi:TS[i].l});
    if(TS[i].h<TS[i-2].l)z.push({type:"FVG",dir:"res",lo:TS[i].h,  hi:TS[i-2].l});
  }
  for(let i=0;i<n-1;i++){
    if(TS[i].c<TS[i].o&&TS[i+1].c>TS[i].h)z.push({type:"OB",dir:"sup",lo:TS[i].l,hi:TS[i].h});
    if(TS[i].c>TS[i].o&&TS[i+1].c<TS[i].l)z.push({type:"OB",dir:"res",lo:TS[i].l,hi:TS[i].h});
  }
  return z;
}
function nearZone(B1h,price,t,dir){
  for(const secs of[14400,86400]){
    const TS=resample(B1h.filter(b=>b.t<=t),secs).slice(-30);
    const poi=dir==='long'?'sup':'res';
    const zs=zones(TS).filter(z=>z.dir===poi);
    if(zs.some(z=>{const tol=0.3*(z.hi-z.lo);return price>=z.lo-tol&&price<=z.hi+tol;}))return true;
  }
  return false;
}
function strat_OTE(B1h,trends){
  const trades=[];const LOOK=12;
  const inKZ=min=>(min>=450&&min<=570)||(min>=930&&min<=1260);
  for(let i=LOOK+2;i<B1h.length-1;i++){
    const b=B1h[i];
    if(!inKZ(b.min)||b.dow===0||b.dow===6)continue;
    const tr=getTrend(trends,b.t);
    if(!tr||tr.h4!==tr.h1)continue;
    const sl_=B1h.slice(i-LOOK,i);
    const swHi=Math.max(...sl_.map(x=>x.h)),swLo=Math.min(...sl_.map(x=>x.l));
    const swR=swHi-swLo;if(swR<=0)continue;
    if(tr.h4==='bull'){
      const ote62=swHi-0.62*swR,ote79=swHi-0.79*swR;
      if(b.l<=ote62&&b.c>=ote79){
        if(!nearZone(B1h,b.c,b.t,'long'))continue;
        trades.push(simulate(B1h,i,'long', b.c,swLo-swR*0.05));
      }
    }
    if(tr.h4==='bear'){
      const ote62=swLo+0.62*swR,ote79=swLo+0.79*swR;
      if(b.h>=ote62&&b.c<=ote79){
        if(!nearZone(B1h,b.c,b.t,'short'))continue;
        trades.push(simulate(B1h,i,'short',b.c,swHi+swR*0.05));
      }
    }
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════
// E) Breaker Block (1H) — tightened: require HTF H4+H1, KZ, max age 10
// ═══════════════════════════════════════════════════════════════════════
function strat_Breaker(B1h,trends){
  const trades=[];const OBS=[];
  const inKZ=min=>(min>=450&&min<=570)||(min>=930&&min<=1260);
  for(let i=1;i<B1h.length;i++){
    const b=B1h[i],prev=B1h[i-1];
    if(prev.c<prev.o&&b.c>prev.h)
      OBS.push({dir:'bull',lo:prev.l,hi:prev.h,fi:i-1,failed:false,failI:-1,used:false});
    if(prev.c>prev.o&&b.c<prev.l)
      OBS.push({dir:'bear',lo:prev.l,hi:prev.h,fi:i-1,failed:false,failI:-1,used:false});
    const tr=getTrend(trends,b.t);
    for(const ob of OBS){
      if(ob.used||ob.fi>=i)continue;
      if(!ob.failed){
        if(ob.dir==='bull'&&b.c<ob.lo){ob.failed=true;ob.failI=i;}
        if(ob.dir==='bear'&&b.c>ob.hi){ob.failed=true;ob.failI=i;}
      }else{
        if(i-ob.failI>10){ob.used=true;continue;}
        if(!inKZ(b.min)||!tr||tr.h4!==tr.h1)continue;
        if(ob.dir==='bull'&&tr.h4==='bear'&&b.h>=ob.lo&&b.c<=ob.hi){
          ob.used=true;
          trades.push(simulate(B1h,i,'short',b.c,ob.hi+(ob.hi-ob.lo)*0.25));
        }
        if(ob.dir==='bear'&&tr.h4==='bull'&&b.l<=ob.hi&&b.c>=ob.lo){
          ob.used=true;
          trades.push(simulate(B1h,i,'long', b.c,ob.lo-(ob.hi-ob.lo)*0.25));
        }
      }
    }
    if(OBS.length>300)OBS.splice(0,OBS.length-150);
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN — run all 5 strategies on all pairs, full table
// ═══════════════════════════════════════════════════════════════════════
async function main(){
  console.log('\n🔬  Fed Forex — Multi-Strategy Backtest v2\n'+
    '     A=30m Sweep | B=Silver Bullet 2-stage | C=ODR | D=OTE Fib | E=Breaker\n'+
    '     15m data ≈ 60d window  |  1H data ≈ 730d window\n');
  console.log('═'.repeat(78));

  const pool={A:[],B:[],C:[],D:[],E:[]};
  const rows=[];

  for(const[name,sym]of PAIRS){
    process.stdout.write(`\nFetching ${name}...`);
    const[B15m,B1h]=await Promise.all([yf(sym,'60d','15m'),yf(sym,'730d','1h')]);
    if(!B15m||!B1h||B15m.length<100||B1h.length<200){console.log(' ⚠  skip');continue;}
    console.log(` ${B15m.length}×15m | ${B1h.length}×1H`);

    const trends=precomputeTrends(B1h);

    const rA=strat_30m(B15m,B1h,trends);
    const rB=strat_SB2(B15m,trends);
    const rC=strat_ODR(B15m,B1h,trends);
    const rD=strat_OTE(B1h,trends);
    const rE=strat_Breaker(B1h,trends);

    const sA=calcStats(rA,'A:30m');
    const sB=calcStats(rB,'B:SB2');
    const sC=calcStats(rC,'C:ODR');
    const sD=calcStats(rD,'D:OTE');
    const sE=calcStats(rE,'E:Brk');

    // per-pair detail
    const line=(s,p)=>{
      const e=s.wr>=68?'✅':s.wr>=55?'⚠️':'❌';
      return `  ${e} ${s.label} [${p}] n=${String(s.n).padStart(3)} dec=${String(s.decided).padStart(3)} `+
             `WR=${String(s.wr).padStart(3)}% avgR=${s.avgR>=0?'+':''}${s.avgR}`;
    };
    console.log(`\n  ── ${name} ──`);
    console.log(line(sA,'60d')+line(sB,'60d'));
    console.log(line(sC,'60d')+line(sD,'730d'));
    console.log(line(sE,'730d'));

    pool.A.push(...rA);pool.B.push(...rB);pool.C.push(...rC);
    pool.D.push(...rD);pool.E.push(...rE);
    rows.push({name,sA,sB,sC,sD,sE});
    await sleep(900);
  }

  // ── Full WR Table ────────────────────────────────────────────────────
  console.log('\n\n'+'═'.repeat(78));
  console.log('📊  COMPLETE WIN-RATE TABLE\n');
  const H='Pair      | A:30mSwp(60d) | B:SilverBullet(60d) | C:ODR(60d) | D:OTE(730d) | E:Breaker(730d)';
  console.log(H);
  console.log('─'.repeat(H.length));
  for(const r of rows){
    const f=(s)=>{
      if(s.decided<3)return'  —  ';
      const e=s.wr>=68?'✅':s.wr>=55?'⚠️':'❌';
      return`${e}${String(s.wr).padStart(3)}%(${s.decided})`;
    };
    console.log(
      r.name.padEnd(10)+'| '+
      f(r.sA).padEnd(15)+'| '+
      f(r.sB).padEnd(21)+'| '+
      f(r.sC).padEnd(12)+'| '+
      f(r.sD).padEnd(13)+'| '+
      f(r.sE)
    );
  }

  // ── Aggregate ────────────────────────────────────────────────────────
  console.log('\n\n'+'═'.repeat(78));
  console.log('📈  AGGREGATE — All pairs combined\n');
  const labs={A:'30m Sweep (60d)',B:'Silver Bullet 2-stage (60d)',C:'ODR Sweep (60d)',D:'OTE Fib (730d)',E:'Breaker Block (730d)'};
  for(const k of['A','B','C','D','E']){
    const s=calcStats(pool[k],labs[k]);
    const eWR=s.wr>=68?'✅':s.wr>=55?'⚠️':'❌';
    const eR =s.avgR>=0.5?'✅':s.avgR>=0?'⚠️':'❌';
    const spw=+(s.n/PAIRS.length/(60/7)).toFixed(1);
    console.log(`  ${eWR} ${s.label.padEnd(30)} | n=${String(s.n).padStart(5)} | `+
      `~${spw}/wk per pair | ${String(s.wr).padStart(3)}% WR | `+
      `${eR} ${s.avgR>=0?'+':''}${s.avgR}R avg | decided=${s.decided}`);
  }
  console.log('\n✅  Done\n');
}

main().catch(e=>{console.error('\nFatal:',e.message,e.stack);process.exit(1);});
