// Fidelity review: run Siddh's real trades through the codified engine gates,
// then compare ENGINE verdict (TAKE/SKIP) vs what he actually did + the outcome.
// Where they diverge = a rule for him to confirm/correct.
const T=require("C:/Users/DESKTOP/Desktop/Claude Code/trades_text.json");
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const u=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(u<=0||u>100)return null;const rem=100-u;const pr=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let rR=0;if(t.remainderOutcome==="TP")rR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="SL")rR=-1;else if(t.remainderOutcome==="manual")rR=parseFloat(t.remainderR||0);return +(pr+rem/100*rR).toFixed(2);}
function R(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
const has=(t,c)=>(t.confluences||[]).includes(c);
// selection: spread of wins + the instructive losses
const IDS=[1779447831951,1779691625958,1779778584448,1779963514129,1779876769233, /*wins*/
           1779857731634,1779535099609,1779541520703,1779966437541,1780083612435 /*losses*/];
for(const id of IDS){
  const t=T.find(x=>x.id===id);if(!t)continue;
  const dir=t.direction, want=dir==="Long"?"Bull":"Bear", b=t.htfBias||{};
  const aligned=[b.D1,b.H4,b.H1].filter(Boolean);
  const htfFull=aligned.length===3&&aligned.every(x=>x===want);
  const htfMin=(b.H4===want&&b.H1===want); // CONFIRMED rule: H4+H1 aligned is enough (D1=context); all-3=A+
  const inKZ=(t.session||"").includes("KZ");
  const sweep=has(t,"Liquidity Sweep"), pd=has(t,"Premium/Discount");
  const ifvg=has(t,"IFVG"), obfvg=has(t,"OB/FVG/BPR"), rb=has(t,"Rejection Block");
  const stack=(ifvg?1:0)+(obfvg?1:0)+(rb?1:0); // multi-POI proxy
  const maeR=(parseFloat(t.slPips)>0&&t.maePips!==""&&t.maePips!=null)?parseFloat(t.maePips)/parseFloat(t.slPips)*100:null;
  // ENGINE rule (CORRECTED): take if H4+H1 aligned + KZ + sweep + premium/discount + POI stack>=2. all-3 aligned = A+ tier.
  const take = htfMin && inKZ && sweep && pd && stack>=2;
  const tier = htfFull?"A+ (all 3 synced)":"A (H4+H1)";
  const r=R(t), agree = (take && t.outcome!=="Loss") || (!take && t.outcome==="Loss");
  console.log(`\n#${id}  ${t.pair} ${dir}  [${t.session}]  -> ACTUAL: ${t.outcome} ${r>=0?'+':''}${r}R`);
  console.log(`   HTF D1/H4/H1=${b.D1||'-'}/${b.H4||'-'}/${b.H1||'-'}  H4+H1=${htfMin} all3=${htfFull}  | KZ=${inKZ} sweep=${sweep} P/D=${pd} | IFVG=${ifvg} OB=${obfvg} RB=${rb} (stack ${stack}) | MAE=${maeR!=null?maeR.toFixed(0)+'%ofSL':'n/a'}`);
  console.log(`   ENGINE: ${take?'✅ TAKE ['+tier+']':'⛔ SKIP'}   ${agree?'✓ agrees':'✗ DIVERGES'}   ${t.mistake&&t.mistake!=="None"?'[your tag: '+(Array.isArray(t.mistake)?t.mistake.join(','):t.mistake)+']':''}`);
}
