// fetch_free_apis.js — Fetch forex 1H data from all free registered APIs
// Each service needs a FREE API key (sign up in ~30 seconds, no credit card).
//
// HOW TO GET KEYS (all free):
//   Alpha Vantage : https://www.alphavantage.co/support/#api-key     (instant, 25 req/day)
//   Twelve Data   : https://twelvedata.com/pricing                   (instant, 800 credits/day)
//   OANDA Practice: https://www.oanda.com/register/#/sign-up/demo    (free demo account → Manage API → token)
//   Polygon.io    : https://polygon.io/dashboard/signup              (instant, 5 req/min)
//
// Usage:
//   node fetch_free_apis.js                    → try all configured APIs
//   node fetch_free_apis.js alphavantage       → Alpha Vantage only
//   node fetch_free_apis.js twelvedata         → Twelve Data only
//   node fetch_free_apis.js oanda              → OANDA only

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── PUT YOUR FREE API KEYS HERE ───────────────────────────────────────────────
const KEYS = {
  alphavantage: '',           // from alphavantage.co — free, instant
  twelvedata:   '',           // from twelvedata.com — free, instant
  oanda:        '',           // from OANDA demo account → API token
  polygon:      '',           // from polygon.io — free, instant
};
// ─────────────────────────────────────────────────────────────────────────────

const OUT_DIR = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';

// Instruments to fetch
const FOREX_PAIRS = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','GBPJPY','EURJPY'];

function get(url, headers={}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: {'User-Agent':'Mozilla/5.0', ...headers} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve(JSON.parse(d)); } catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function loadExisting(name) {
  const fp = path.join(OUT_DIR, `${name}.json`);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp));
}

function merge(existing, newBars) {
  const seen = new Set(existing.map(b => b.t));
  const merged = [...existing, ...newBars.filter(b => !seen.has(b.t))];
  return merged.sort((a,b) => a.t - b.t);
}

function save(name, bars) {
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(bars));
  const first = new Date(bars[0].t*1000).toISOString().slice(0,10);
  const last  = new Date(bars[bars.length-1].t*1000).toISOString().slice(0,10);
  console.log(`  Saved ${name}: ${bars.length} bars (${first} → ${last})`);
}

// ── Alpha Vantage ─────────────────────────────────────────────────────────────
// FX_INTRADAY, 60min, outputsize=full → ~2 years of data, 25 req/day free
async function fetchAlphaVantage(pairs) {
  if (!KEYS.alphavantage) { console.log('  [AlphaVantage] No API key — skip'); return; }
  console.log('\n[Alpha Vantage] FX_INTRADAY 60min, outputsize=full...');

  for (const pair of pairs) {
    const from = pair.slice(0,3), to = pair.slice(3,6);
    const url  = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${from}&to_symbol=${to}&interval=60min&outputsize=full&apikey=${KEYS.alphavantage}`;
    const data = await get(url);
    if (!data || data['Error Message'] || data['Information']) {
      console.log(`  ${pair}: API error — ${JSON.stringify(data).slice(0,80)}`);
      await sleep(15000); continue;
    }
    const ts = data['Time Series FX (60min)'];
    if (!ts) { console.log(`  ${pair}: no data`); continue; }
    const bars = Object.entries(ts).map(([dt, v]) => ({
      t: Math.floor(new Date(dt + 'Z').getTime() / 1000),
      o: parseFloat(v['1. open']), h: parseFloat(v['2. high']),
      l: parseFloat(v['3. low']),  c: parseFloat(v['4. close']),
    })).filter(b => b.o > 0).sort((a,b) => a.t - b.t);
    const merged = merge(loadExisting(pair), bars);
    save(pair, merged);
    await sleep(15000);  // 25 req/day = 1 per ~3500s; for intraday use 15s between
  }
}

// ── Twelve Data ───────────────────────────────────────────────────────────────
// /time_series, 1h, outputsize=5000 → up to ~7 months per call; paginate for more
async function fetchTwelveData(pairs) {
  if (!KEYS.twelvedata) { console.log('  [TwelveData] No API key — skip'); return; }
  console.log('\n[Twelve Data] time_series 1h, up to 5000 bars per request...');

  for (const pair of pairs) {
    const sym  = pair.slice(0,3) + '/' + pair.slice(3,6);
    const url  = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1h&outputsize=5000&format=JSON&apikey=${KEYS.twelvedata}`;
    const data = await get(url);
    if (!data || data.status === 'error') {
      console.log(`  ${pair}: ${data?.message || 'error'}`);
      await sleep(5000); continue;
    }
    if (!data.values || !data.values.length) { console.log(`  ${pair}: no data`); continue; }
    const bars = data.values.map(v => ({
      t: Math.floor(new Date(v.datetime + 'Z').getTime() / 1000),
      o: parseFloat(v.open), h: parseFloat(v.high), l: parseFloat(v.low), c: parseFloat(v.close),
    })).filter(b => b.o > 0).sort((a,b) => a.t - b.t);
    const merged = merge(loadExisting(pair), bars);
    save(pair, merged);
    await sleep(8000);   // 800 credits/day; each full call ~5 credits
  }
}

// ── OANDA Practice API ────────────────────────────────────────────────────────
// /v3/instruments/{inst}/candles, H1 granularity, 5000 per request
// Can paginate from 2005 — BEST deep-history free source
async function fetchOANDA(pairs) {
  if (!KEYS.oanda) { console.log('  [OANDA] No API token — skip'); return; }
  console.log('\n[OANDA Practice] H1 candles, paginating from 2020...');

  const OANDA_SYMS = { EURUSD:'EUR_USD', GBPUSD:'GBP_USD', USDJPY:'USD_JPY',
                       AUDUSD:'AUD_USD', USDCAD:'USD_CAD', GBPJPY:'GBP_JPY', EURJPY:'EUR_JPY' };

  for (const pair of pairs) {
    const inst = OANDA_SYMS[pair];
    if (!inst) { console.log(`  ${pair}: no OANDA mapping`); continue; }

    const allBars = [];
    let from = Math.floor(new Date('2020-01-01T00:00:00Z').getTime()/1000);
    const to = Math.floor(Date.now()/1000);

    while (from < to) {
      const url = `https://api-fxpractice.oanda.com/v3/instruments/${inst}/candles?granularity=H1&count=5000&from=${from}&includeFirst=true`;
      const data = await get(url, { Authorization: `Bearer ${KEYS.oanda}` });
      if (!data || !data.candles) break;
      const candles = data.candles.filter(c => c.complete);
      if (!candles.length) break;
      for (const c of candles) {
        const t = Math.floor(new Date(c.time).getTime()/1000);
        allBars.push({ t, o: parseFloat(c.mid.o), h: parseFloat(c.mid.h),
                       l: parseFloat(c.mid.l),   c: parseFloat(c.mid.c) });
      }
      from = allBars[allBars.length-1].t + 3600;
      if (candles.length < 5000) break;
      await sleep(500);
    }
    if (!allBars.length) { console.log(`  ${pair}: no data`); continue; }
    const merged = merge(loadExisting(pair), allBars);
    save(pair, merged);
    await sleep(1000);
  }
}

// ── Polygon.io ────────────────────────────────────────────────────────────────
// /v2/aggs/ticker/C:EURUSD/range/1/hour — 2 years free, 5 req/min
async function fetchPolygon(pairs) {
  if (!KEYS.polygon) { console.log('  [Polygon] No API key — skip'); return; }
  console.log('\n[Polygon.io] forex aggregate 1h bars...');

  const from = new Date(); from.setFullYear(from.getFullYear()-2);
  const fromStr = from.toISOString().slice(0,10);
  const toStr   = new Date().toISOString().slice(0,10);

  for (const pair of pairs) {
    const ticker = `C:${pair}`;
    let url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/hour/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=50000&apiKey=${KEYS.polygon}`;
    const allBars = [];

    while (url) {
      const data = await get(url);
      if (!data || data.status === 'ERROR') { console.log(`  ${pair}: ${data?.error||'error'}`); break; }
      if (data.results) {
        data.results.forEach(r => allBars.push({ t: Math.floor(r.t/1000), o: r.o, h: r.h, l: r.l, c: r.c }));
      }
      url = data.next_url ? data.next_url + `&apiKey=${KEYS.polygon}` : null;
      await sleep(12000);  // 5 req/min free limit
    }
    if (!allBars.length) { console.log(`  ${pair}: no data`); continue; }
    const merged = merge(loadExisting(pair), allBars);
    save(pair, merged);
  }
}

// ── ECB Daily (no key needed — daily rates only) ──────────────────────────────
// Useful for long-term daily zone data (bt_data_daily/)
async function fetchECB() {
  const DAILY_OUT = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_daily/';
  if (!fs.existsSync(DAILY_OUT)) fs.mkdirSync(DAILY_OUT);

  console.log('\n[ECB API] Daily forex rates (no key, back to 1999)...');

  // ECB reports EUR as base; pairs below are all EUR-based
  const ECB_PAIRS = {
    EURUSD: 'D.USD.EUR.SP00.A',
    EURGBP: 'D.GBP.EUR.SP00.A',
    EURJPY: 'D.JPY.EUR.SP00.A',
    EURCAD: 'D.CAD.EUR.SP00.A',
    EURAUD: 'D.AUD.EUR.SP00.A',
  };

  for (const [name, key] of Object.entries(ECB_PAIRS)) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/${key}?format=jsondata&startPeriod=1999-01-01`;
    const data = await get(url);
    if (!data) { console.log(`  ${name}: no data`); continue; }

    try {
      const obs = data.dataSets[0].series['0:0:0:0:0'].observations;
      const dates = data.structure.dimensions.observation[0].values;
      const bars = dates.map((d,i) => {
        const v = obs[i];
        if (!v || v[0] == null) return null;
        const rate = parseFloat(v[0]);
        // ECB gives EUR/X rate (how many X per EUR)
        // For EURUSD: rate = USD per EUR → this IS the EURUSD price
        return { t: Math.floor(new Date(d.id).getTime()/1000), o: rate, h: rate, l: rate, c: rate };
      }).filter(Boolean).sort((a,b) => a.t - b.t);

      const fp = path.join(DAILY_OUT, `${name}.json`);
      fs.writeFileSync(fp, JSON.stringify(bars));
      const first = new Date(bars[0].t*1000).toISOString().slice(0,10);
      const last  = new Date(bars[bars.length-1].t*1000).toISOString().slice(0,10);
      console.log(`  ${name}: ${bars.length} daily bars (${first} → ${last})`);
    } catch(e) {
      console.log(`  ${name}: parse error — ${e.message}`);
    }
    await sleep(1000);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  const target = process.argv[2] || 'all';

  console.log('=== fetch_free_apis.js ===');
  console.log('Required: free API keys in the KEYS object at the top of this file');
  console.log('');

  // Show key status
  console.log('Key status:');
  for (const [svc, key] of Object.entries(KEYS)) {
    console.log(`  ${svc.padEnd(15)}: ${key ? '✓ configured' : '✗ not set (sign up free at URL above)'}`);
  }
  console.log('');

  if (target === 'all' || target === 'ecb') await fetchECB();

  if (KEYS.alphavantage && (target==='all'||target==='alphavantage'))
    await fetchAlphaVantage(FOREX_PAIRS);
  else if (!KEYS.alphavantage && target!=='ecb')
    console.log('[AlphaVantage] Key not set. Register free at https://www.alphavantage.co/support/#api-key');

  if (KEYS.twelvedata && (target==='all'||target==='twelvedata'))
    await fetchTwelveData(FOREX_PAIRS);
  else if (!KEYS.twelvedata && target!=='ecb')
    console.log('[TwelveData]  Key not set. Register free at https://twelvedata.com/pricing');

  if (KEYS.oanda && (target==='all'||target==='oanda'))
    await fetchOANDA(FOREX_PAIRS);
  else if (!KEYS.oanda && target!=='ecb')
    console.log('[OANDA]       Key not set. Create free demo at https://www.oanda.com/register/#/sign-up/demo → Manage API Access');

  if (KEYS.polygon && (target==='all'||target==='polygon'))
    await fetchPolygon(FOREX_PAIRS);
  else if (!KEYS.polygon && target!=='ecb')
    console.log('[Polygon]     Key not set. Register free at https://polygon.io/dashboard/signup');

  console.log('\nDone. Summary of data depth by source:');
  console.log('  Dukascopy    : 2003–present  1-min → 1H  NO KEY  run: node fetch_dukascopy.js');
  console.log('  OANDA        : 2005–present  1H          FREE KEY (best for deep forex history)');
  console.log('  Twelve Data  : ~2y           1H          FREE KEY 800 credits/day');
  console.log('  Alpha Vantage: ~2y           1H          FREE KEY 25 req/day');
  console.log('  Polygon.io   : 2y            1H          FREE KEY 5 req/min');
  console.log('  ECB API      : 1999–present  DAILY       NO KEY   EUR-based pairs only');
  console.log('  Yahoo Finance: 2.5y          1H          NO KEY   futures + forex (already fetched)');
})();
