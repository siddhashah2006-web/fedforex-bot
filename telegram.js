// Telegram sender — reads telegram.json {botToken, chatId}. No-ops safely if unconfigured.
const fs=require("fs");
function cfg(){try{const c=JSON.parse(fs.readFileSync("C:/Users/DESKTOP/Desktop/Claude Code/telegram.json"));
  if(c.botToken&&c.chatId&&!String(c.botToken).includes("PASTE")&&!String(c.chatId).includes("PASTE"))return c;}catch(e){}return null;}
async function send(text){const c=cfg();if(!c)return{ok:false,reason:"telegram.json not configured"};
  try{const r=await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:c.chatId,text,parse_mode:"Markdown",disable_web_page_preview:true})});
    const j=await r.json();return{ok:!!j.ok,reason:j.ok?"sent":JSON.stringify(j).slice(0,180)};}catch(e){return{ok:false,reason:e.message};}}
module.exports={send,configured:()=>!!cfg()};
