// Fed Forex — Supabase SYNC & EVOLVE engine. (hardened per audit)
// READ-ONLY on Supabase (GET only — never writes/deletes). Atomic local writes. State persisted LAST.
const fs=require("fs");
const TG=require("C:/Users/DESKTOP/Desktop/Claude Code/telegram.js");
const URL="https://hcavvfmunwjxxkwsmmaw.supabase.co";
const KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjYXZ2Zm11bndqeHhrd3NtbWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjIwMDksImV4cCI6MjA5NTE5ODAwOX0.fKOJfpP-JL1yujI55UYrYOrnrGwWkw2o8aE29rCmGH0";
const DIR="C:/Users/DESKTOP/Desktop/Claude Code/";
const H={apikey:KEY,Authorization:"Bearer "+KEY};
async function gget(path){const r=await fetch(URL+"/rest/v1/"+path,{method:"GET",headers:H});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();} // method:'GET' explicit (read-only guarantee)
function writeAtomic(file,data){const tmp=file+".tmp";fs.writeFileSync(tmp,data);fs.renameSync(tmp,file);} // atomic on same volume
function blended(t){const ps=t.partials||[];if(!ps.length)return null;const u=ps.reduce((a,p)=>a+parseFloat(p.pct||0),0);if(u<=0||u>100)return null;const rem=100-u;const pr=ps.reduce((a,p)=>a+(parseFloat(p.pct||0)/100)*parseFloat(p.atR||0),0);let rR=0;if(t.remainderOutcome==="TP")rR=parseFloat(t.plannedRR||0);else if(t.remainderOutcome==="SL")rR=-1;else if(t.remainderOutcome==="manual")rR=parseFloat(t.remainderR||0);return +(pr+rem/100*rR).toFixed(2);}
function R(t){const b=blended(t);if(b!==null)return b;if(t.eodRR!==undefined&&t.eodRR!=="")return parseFloat(t.eodRR);const rr=parseFloat(t.actualRR||0)||parseFloat(t.plannedRR||0);if(t.outcome==="Win")return rr>0?rr:1;if(t.outcome==="Loss")return rr<0?rr:-1;return 0;}
const mist=t=>Array.isArray(t.mistake)?t.mistake.filter(m=>m&&m!=="None"):(t.mistake&&t.mistake!=="None"?[t.mistake]:[]);
function WR(a){const w=a.filter(t=>t.outcome==="Win").length,l=a.filter(t=>t.outcome==="Loss").length;return{w,l,be:a.filter(t=>t.outcome==="BE").length,wr:(w+l)?+(w/(w+l)*100).toFixed(0):0};}

(async()=>{
 try{
  // load state — distinguish MISSING (fresh) from CORRUPT (abort, don't re-spam)
  let state={ids:[],count:0,stats:{},tradesSinceReopt:0};
  if(fs.existsSync(DIR+"sync_state.json")){try{state=JSON.parse(fs.readFileSync(DIR+"sync_state.json"));}catch(e){console.log("sync_state.json corrupt — aborting to avoid re-spam. Delete it to force a fresh baseline.");return;}}
  const idRows=await gget("replay_trades?select=id&order=id");
  const liveIds=idRows.map(r=>r.id), known=new Set(state.ids||[]);
  const newIds=liveIds.filter(id=>!known.has(id));
  // hash-based change detection would catch edits; id-diff catches new trades (append-only assumption)
  console.log(`Supabase: ${liveIds.length} replay trades | new since last sync: ${newIds.length}`);
  if(newIds.length===0 && state.count===liveIds.length){console.log("No changes.");return;}

  const rows=await gget("replay_trades?select=id,data&order=id");
  const T=rows.map(r=>{const t={...r.data};delete t.imgBefore;delete t.imgAfter;return {id:r.id,...t};});
  if(!T.length){console.log("Supabase returned 0 trades — skipping (no stats).");return;}
  writeAtomic(DIR+"trades_text.json",JSON.stringify(T,null,2));

  const newT=T.filter(t=>!known.has(t.id));
  const overall=WR(T), exp=+(T.reduce((a,t)=>a+R(t),0)/T.length).toFixed(2);
  const PAIRS=[...new Set(T.map(t=>t.pair))];
  const perPair={};for(const p of PAIRS){const a=T.filter(t=>t.pair===p);perPair[p]={n:a.length,...WR(a),exp:+(a.reduce((x,t)=>x+R(t),0)/a.length).toFixed(2)};}
  const cf={};T.forEach(t=>(t.confluences||[]).forEach(c=>cf[c]=(cf[c]||0)+1));
  const losses=T.filter(t=>t.outcome==="Loss"), cleanLoss=losses.filter(t=>!mist(t).length).length;

  const prev=state.stats||{};const notes=[];
  if(prev.wr!=null && overall.wr!==prev.wr)notes.push(`Win rate ${prev.wr}%→${overall.wr}%`);
  for(const p of PAIRS){const was=prev.perPair?.[p];const now=perPair[p];if(was&&Math.sign(now.exp)!==Math.sign(was.exp))notes.push(`${p} flipped ${was.exp>0?"profitable→losing":"losing→profitable"} (${now.exp}R)`);if(!was&&now.n>=2)notes.push(`new instrument: ${p}`);}
  const reoptDue=(state.tradesSinceReopt||0)+newIds.length, reoptFlag=reoptDue>=10;

  const top=Object.entries(cf).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,n])=>`${c} ${(n/T.length*100).toFixed(0)}%`).join(", ");
  const pairLines=Object.entries(perPair).sort((a,b)=>b[1].n-a[1].n).map(([p,s])=>`- ${p}: ${s.n} trades, ${s.wr}% WR, ${s.exp}R/trade`).join("\n");
  writeAtomic(DIR+"evolving_summary.md",
`# Fed Forex — Live Edge (auto-updated by sync.js)
Last sync: ${new Date().toISOString()}
Total trades: ${T.length} | Win ${overall.wr}% (${overall.w}W/${overall.l}L/${overall.be}BE) | Expectancy ${exp}R/trade
Every loss still had a tagged mistake: ${cleanLoss===0}

## Per instrument
${pairLines}

## Top confluences
${top}

## Evolution notes
${notes.length?notes.map(n=>"- "+n).join("\n"):"- (no notable shifts this sync)"}
${reoptFlag?`- ⚠️ ${reoptDue} new trades since last re-optimization — re-run backtest14/15 (LEAK-FREE) to re-measure the honest edge.`:""}
`);

  // Telegram BEFORE persisting state, so a failed send doesn't lose the notification (state only advances after)
  let tgOk=true;
  if(newT.length){
    const nl=newT.slice(0,8).map(t=>`• ${t.pair} ${t.direction} ${t.outcome} (${R(t)>=0?"+":""}${R(t)}R)`).join("\n");
    let msg=`🔄 *Fed Forex — ${newT.length} new trade${newT.length>1?"s":""} synced*\n${nl}${newT.length>8?`\n…+${newT.length-8} more`:""}\n\n*Edge now:* ${T.length} trades · ${overall.wr}% WR · ${exp}R/trade`;
    if(notes.length)msg+=`\n*Shifts:* ${notes.slice(0,4).join("; ")}`;
    if(reoptFlag)msg+=`\n⚠️ ${reoptDue} new since last re-tune — re-measure recommended.`;
    const res=await TG.send(msg);tgOk=res.ok||res.reason==="telegram.json not configured";
    console.log("TELEGRAM:",res.ok?"sent ✓":("skipped — "+res.reason));
  }
  // persist state LAST (only if Telegram sent or was intentionally skipped) — prevents re-spam without advancing past un-notified trades
  if(tgOk){writeAtomic(DIR+"sync_state.json",JSON.stringify({ids:liveIds,count:liveIds.length,stats:{wr:overall.wr,exp,perPair},tradesSinceReopt:reoptFlag?0:reoptDue},null,2));
    console.log(`Synced. ${newIds.length} new trade(s). Summary → evolving_summary.md`);}
  else console.log("Telegram failed — state NOT advanced; will retry next run.");
 }catch(e){console.log("Sync error (no state change, will retry):",e.message);}
})();
