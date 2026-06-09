// fetch_extended.js — Pull max available historical data from all free sources
// Sources: Yahoo Finance (2y 1h, hard cap), FOREX.com CIAPI (8mo 1h forex only)
// Saves to bt_data_1h/ in the same format used by all backtest scripts

const https = require('https');
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';

// ─── FOREX.com CIAPI ──────────────────────────────────────────────────────────
const CREDS = JSON.parse(fs.readFileSync('C:/Users/DESKTOP/Desktop/Claude Code/forex_creds.json'));

async function getSession() {
  const body = JSON.stringify({ UserName: CREDS.username, Password: CREDS.password, AppKey: CREDS.appkey });
  return new Promise((res, rej) => {
    const opts = { hostname: 'ciapi.cityindex.com', path: '/TradingAPI/session', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d).Session);}catch(e){rej(e);} }); });
    req.on('error', rej); req.write(body); req.end();
  });
}

async function fetchForex(marketId, session) {
  return new Promise((res, rej) => {
    const opts = {
      hostname: 'ciapi.cityindex.com',
      path: `/TradingAPI/market/${marketId}/barhistory?interval=HOUR&span=1&maxResults=4000`,
      headers: { UserName: CREDS.username, Session: session }
    };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch(e){rej(e);} }); });
    req.on('error', rej); req.end();
  });
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────
// Hard cap: 730 days for 1h. Fetches 2 years for each symbol.
const YF_SYMS = {
  NQ:     'NQ=F',
  ES:     'ES=F',
  GC:     'GC=F',
  CL:     'CL=F',
  EURUSD: 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  USDJPY: 'JPY=X',
  AUDUSD: 'AUDUSD=X',
};

async function fetchYF(sym, interval='1h', range='730d') {
  return new Promise((res, rej) => {
    const p = `/v8/finance/chart/${sym}?interval=${interval}&range=${range}&events=dividends`;
    const opts = { hostname: 'query1.finance.yahoo.com', path: p,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch(e){rej(e);} }); });
    req.on('error', rej); req.end();
  });
}

function parseYF(data, name) {
  try {
    const r = data.chart.result[0];
    const ts = r.timestamp;
    const q = r.indicators.quote[0];
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (!q.open[i] || !q.high[i] || !q.low[i] || !q.close[i]) continue;
      bars.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
    }
    return bars;
  } catch (e) {
    console.error(`  Parse error for ${name}: ${e.message}`);
    return [];
  }
}

// Parse FOREX.com bars — BarDate is /Date(ms)/ format
function parseFC(data, name) {
  if (!data.PriceBars || !data.PriceBars.length) return [];
  return data.PriceBars.map(b => {
    const ms = parseInt(String(b.BarDate).replace(/[^0-9]/g, ''));
    return { t: Math.round(ms / 1000), o: b.Open, h: b.High, l: b.Low, c: b.Close };
  }).filter(b => b.t > 0 && b.o > 0).sort((a, b) => a.t - b.t);
}

// Merge two sorted bar arrays (dedup by timestamp)
function merge(a, b) {
  const seen = new Set(a.map(x => x.t));
  const merged = [...a, ...b.filter(x => !seen.has(x.t))];
  return merged.sort((x, y) => x.t - y.t);
}

function fmt(d) {
  const dt = new Date(d.t * 1000);
  return dt.toISOString().slice(0, 10);
}

function save(name, bars) {
  const out = path.join(OUT, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(bars, null, 0));
  const first = fmt(bars[0]), last = fmt(bars[bars.length - 1]);
  console.log(`  Saved ${name}: ${bars.length} bars (${first} → ${last})`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== fetch_extended.js — max free historical data ===\n');

  // ── Yahoo Finance 1h ──
  console.log('Fetching Yahoo Finance 1h (730-day max per symbol)...');
  for (const [name, sym] of Object.entries(YF_SYMS)) {
    try {
      process.stdout.write(`  ${name}...`);
      const data = await fetchYF(sym);
      const bars = parseYF(data, name);
      if (!bars.length) { console.log(' NO DATA'); continue; }

      // Check if we already have data; merge if so
      const outPath = path.join(OUT, `${name}.json`);
      let existing = [];
      if (fs.existsSync(outPath)) {
        existing = JSON.parse(fs.readFileSync(outPath));
      }
      const merged = merge(existing, bars);
      save(name, merged);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800)); // avoid rate limit
  }

  // ── FOREX.com (EUR/USD, GBP/USD) ──
  console.log('\nFetching FOREX.com 1h (forex pairs, ~8 months)...');
  const FC_MARKETS = { EURUSD: 401484347, GBPUSD: 401484392 };

  let session;
  try {
    session = await getSession();
    console.log(`  Session: ${session}`);
  } catch (e) {
    console.log(`  Auth failed: ${e.message}`);
    return;
  }

  for (const [name, id] of Object.entries(FC_MARKETS)) {
    try {
      process.stdout.write(`  ${name} (FOREX.com)...`);
      const data = await fetchForex(id, session);
      const bars = parseFC(data, name);
      if (!bars.length) { console.log(' NO DATA'); continue; }

      // Load existing YF data and merge — FOREX.com is more recent/accurate for forex
      const outPath = path.join(OUT, `${name}.json`);
      let existing = [];
      if (fs.existsSync(outPath)) existing = JSON.parse(fs.readFileSync(outPath));
      const merged = merge(existing, bars);
      save(name, merged);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Yahoo Finance DAILY (5 years, for extended zone reference) ──
  console.log('\nFetching Yahoo Finance DAILY 5y (for long-term zone reference)...');
  const DAILY_OUT = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_daily/';
  if (!fs.existsSync(DAILY_OUT)) fs.mkdirSync(DAILY_OUT);

  for (const [name, sym] of Object.entries(YF_SYMS)) {
    try {
      process.stdout.write(`  ${name}...`);
      const data = await fetchYF(sym, '1d', '5y');
      const bars = parseYF(data, name);
      if (!bars.length) { console.log(' NO DATA'); continue; }
      const outPath = path.join(DAILY_OUT, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(bars, null, 0));
      const first = fmt(bars[0]), last = fmt(bars[bars.length - 1]);
      console.log(` ${bars.length} bars (${first} → ${last})`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\nDone. Summary:');
  console.log('  bt_data_1h/  — 1h bars (up to 2y) for all instruments (used by all backtests)');
  console.log('  bt_data_daily/ — daily bars (5y) for extended HTF zone analysis');
  console.log('\nNote: Free sources cap:');
  console.log('  Yahoo Finance 1h: 730 days MAX per symbol (cannot be extended for free)');
  console.log('  FOREX.com 1h: ~8 months, forex pairs only (no futures)');
  console.log('  Yahoo Finance 1d: 5 years available for daily data');
  console.log('  For more: Barchart/Quandl require paid plans; TradingView has no data export API');
})();
