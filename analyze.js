// Deep forensic analysis of Siddh's 63 real replay trades (trades_text.json).
// Per-instrument kill zones, confluence effectiveness, MAE/SL (wick) quality,
// grade, mistakes, and the runner / cut-losers-short economics.

const T = require("C:/Users/DESKTOP/Desktop/Claude Code/trades_text.json");

// ---- realized R (faithful to App.js getR/calcBlendedRR) ----
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const used=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(used<=0||used>100)return null;const rem=100-used;const partR=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let remR=0;if(t.remainderOutcome==="TP")remR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="BE")remR=0;else if(t.remainderOutcome==="SL")remR=-1;else if(t.remainderOutcome==="manual")remR=parseFloat(t.remainderR||0);return +(partR+(rem/100)*remR).toFixed(2);}
function R(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
const mist=t=>Array.isArray(t.mistake)?t.mistake.filter(m=>m&&m!=="None"):(t.mistake&&t.mistake!=="None"?[t.mistake]:[]);
function S(arr){const w=arr.filter(t=>t.outcome==="Win").length,l=arr.filter(t=>t.outcome==="Loss").length,be=arr.filter(t=>t.outcome==="BE").length;const dec=w+l;const rs=arr.map(R);const tot=rs.reduce((a,b)=>a+b,0);return{n:arr.length,w,l,be,wr:dec?w/dec*100:0,tot,exp:arr.length?tot/arr.length:0};}
function line(lbl,arr,pad=16){const s=S(arr);return `${lbl.padEnd(pad)} n=${String(s.n).padStart(2)}  WR ${(s.wr.toFixed(0)+'%').padStart(4)} (${s.w}W/${s.l}L/${s.be}BE)  totR ${s.tot.toFixed(1).padStart(6)}  exp ${s.exp.toFixed(2).padStart(5)}R`;}

const PAIRS=[...new Set(T.map(t=>t.pair))];
const SESS=[...new Set(T.map(t=>t.session))].filter(Boolean);
const CONF=[...new Set(T.flatMap(t=>t.confluences||[]))];

console.log("============ OVERALL ============");
console.log(line("ALL",T));
const wins=T.filter(t=>t.outcome==="Win"),losses=T.filter(t=>t.outcome==="Loss");
console.log(`avg WIN = +${(wins.map(R).reduce((a,b)=>a+b,0)/wins.length).toFixed(2)}R | avg LOSS = ${(losses.map(R).reduce((a,b)=>a+b,0)/losses.length).toFixed(2)}R`);
console.log(`win:loss R ratio = ${(Math.abs(wins.map(R).reduce((a,b)=>a+b,0)/wins.length)/Math.abs(losses.map(R).reduce((a,b)=>a+b,0)/losses.length||1)).toFixed(2)} : 1`);

console.log("\n============ PER INSTRUMENT ============");
for(const p of PAIRS.sort((a,b)=>T.filter(t=>t.pair===b).length-T.filter(t=>t.pair===a).length))console.log(line(p,T.filter(t=>t.pair===p)));

console.log("\n============ KILL ZONE — OVERALL ============");
for(const s of SESS.sort((a,b)=>T.filter(t=>t.session===b).length-T.filter(t=>t.session===a).length))console.log(line(s,T.filter(t=>t.session===s)));

console.log("\n============ BEST KILL ZONE *PER INSTRUMENT* (each is different) ============");
for(const p of PAIRS){const tp=T.filter(t=>t.pair===p);if(tp.length<3)continue;const bySess=SESS.map(s=>({s,arr:tp.filter(t=>t.session===s)})).filter(x=>x.arr.length>0).map(x=>({s:x.s,...S(x.arr)})).sort((a,b)=>b.exp-a.exp);
  console.log(`\n${p}:`);for(const x of bySess)console.log(`   ${x.s.padEnd(11)} n=${x.n}  WR ${x.wr.toFixed(0)}%  exp ${x.exp.toFixed(2)}R  (totR ${x.tot.toFixed(1)})`);
  console.log(`   >> BEST: ${bySess[0].s} (${bySess[0].exp.toFixed(2)}R/trade)`);}

console.log("\n============ CONFLUENCE EFFECTIVENESS (with vs without) ============");
const ce=CONF.map(c=>{const wi=T.filter(t=>(t.confluences||[]).includes(c)),wo=T.filter(t=>!(t.confluences||[]).includes(c));return{c,wi:S(wi),wo:S(wo),lift:S(wi).exp-S(wo).exp};}).sort((a,b)=>b.lift-a.lift);
console.log("CONFLUENCE          n    WR    exp/tr    (without: exp)   LIFT");
for(const x of ce)console.log(`${x.c.padEnd(18)} ${String(x.wi.n).padStart(3)}  ${(x.wi.wr.toFixed(0)+'%').padStart(4)}  ${x.wi.exp.toFixed(2).padStart(6)}R   ${x.wo.exp.toFixed(2).padStart(6)}R       ${(x.lift>=0?'+':'')+x.lift.toFixed(2)}`);

console.log("\n============ ENTRY QUALITY — MAE as % of SL (wick/heat taken) ============");
const withMAE=T.filter(t=>parseFloat(t.slPips)>0&&t.maePips!==""&&t.maePips!=null);
const buckets=[[0,15,"0-15% (near-perfect)"],[15,30,"15-30% (very clean)"],[30,50,"30-50% (clean)"],[50,75,"50-75% (heat)"],[75,1e9,"75%+ (near-miss)"]];
console.log("MAE/SL band            n   WR    exp/tr");
for(const[lo,hi,lbl] of buckets){const a=withMAE.filter(t=>{const r=parseFloat(t.maePips)/parseFloat(t.slPips)*100;return r>=lo&&r<hi;});if(a.length)console.log(`${lbl.padEnd(22)} ${String(a.length).padStart(2)}  ${(S(a).wr.toFixed(0)+'%').padStart(4)}  ${S(a).exp.toFixed(2)}R`);}
const wm=withMAE.map(t=>parseFloat(t.maePips)/parseFloat(t.slPips)*100);
console.log(`avg MAE = ${(wm.reduce((a,b)=>a+b,0)/wm.length).toFixed(0)}% of SL | near-misses (>75%): ${withMAE.filter(t=>parseFloat(t.maePips)/parseFloat(t.slPips)>=0.75).length}`);

console.log("\n============ QUALITY GRADE ============");
for(const q of ["A+","A","B","C"]){const a=T.filter(t=>t.quality===q);if(a.length)console.log(line(q,a,4));}

console.log("\n============ MISTAKES (R bleed) ============");
const allM=[...new Set(T.flatMap(mist))];
const mstats=allM.map(m=>{const a=T.filter(t=>mist(t).includes(m));return{m,n:a.length,tot:a.map(R).reduce((x,y)=>x+y,0)};}).sort((a,b)=>a.tot-b.tot);
for(const x of mstats)console.log(`${x.m.padEnd(20)} n=${x.n}  totR ${x.tot.toFixed(1)}`);
const clean=T.filter(t=>!mist(t).length),dirty=T.filter(t=>mist(t).length);
console.log(`\nCLEAN trades (no mistake): ${line("",clean,1)}`);
console.log(`WITH a mistake:           ${line("",dirty,1)}`);

console.log("\n============ RUNNERS vs CUT-LOSERS-SHORT ============");
const pk=wins.filter(t=>parseFloat(t.maxRR)>0);
const cap=pk.map(t=>Math.min(R(t)/parseFloat(t.maxRR)*100,100));
const left=pk.map(t=>parseFloat(t.maxRR)-R(t));
console.log(`Peak capture (avg of winners' actual/maxRR): ${(cap.reduce((a,b)=>a+b,0)/cap.length).toFixed(0)}%  (n=${pk.length})`);
console.log(`Avg R LEFT ON TABLE per winner: ${(left.reduce((a,b)=>a+b,0)/left.length).toFixed(2)}R`);
console.log(`Biggest runners (maxRR): ${pk.map(t=>parseFloat(t.maxRR)).sort((a,b)=>b-a).slice(0,5).map(x=>x.toFixed(1)).join(", ")}`);
const durW=wins.filter(t=>t.duration).map(t=>t.duration),durL=losses.filter(t=>t.duration).map(t=>t.duration);
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
console.log(`Avg HOLD: winners ${(avg(durW)/60).toFixed(1)}h vs losers ${(avg(durL)/60).toFixed(1)}h  ${avg(durL)>avg(durW)?"<-- holding losers LONGER (cut sooner)":"(losers cut shorter - good)"}`);
console.log(`Losers avg planned RR = ${(losses.map(t=>parseFloat(t.plannedRR||0)).reduce((a,b)=>a+b,0)/losses.length).toFixed(2)} (over-ambitious? farfetched TP)`);
