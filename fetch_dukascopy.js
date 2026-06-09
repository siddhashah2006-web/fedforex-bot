// fetch_dukascopy.js — Download Dukascopy 1-min bi5 data → resample to 1H → save bt_data_1h format
// FREE, NO ACCOUNT NEEDED. Data back to 2003 for major forex pairs and metals.
// Uses xz (in Windows PATH) for LZMA decompression.
//
// Dukascopy instruments verified working:
//   Forex:   EURUSD GBPUSD USDJPY AUDUSD USDCAD GBPJPY EURJPY EURGBP NZDUSD USDCHF
//   Metals:  XAUUSD (gold spot) XAGUSD (silver spot)
//   Indices: USATECHIDXUSD (Nasdaq 100 proxy — close to NQ)
//
// Usage:
//   node fetch_dukascopy.js                      → last 5 years, all instruments
//   node fetch_dukascopy.js EURUSD 2020 2024     → EURUSD, 2020-2024
//   node fetch_dukascopy.js XAUUSD 2018 2023     → Gold, 2018-2023

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { execFileSync, spawnSync } = require('child_process');

const OUT_DIR     = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_1h/';
const OUT_DIR_M15 = 'C:/Users/DESKTOP/Desktop/Claude Code/bt_data_m15/';
const IST         = 5.5 * 3600;   // seconds ahead of UTC

// Price decimal factors per instrument (raw integer ÷ factor = real price)
const FACTORS = {
  EURUSD: 1e5, GBPUSD: 1e5, AUDUSD: 1e5, USDCAD: 1e5, EURGBP: 1e5,
  NZDUSD: 1e5, USDCHF: 1e5, XAGUSD: 1e5,
  USDJPY: 1e3, GBPJPY: 1e3, EURJPY: 1e3,
  XAUUSD: 1e3,
  USATECHIDXUSD: 1e1,   // Nasdaq ~15000-20000, factor=10 → raw ~150000-200000
  // Crypto — Dukascopy encodes BTC/ETH with factor 10 (1 decimal place)
  // Note: strategy is fully scale-invariant so stored values work even with wrong factor
  BTCUSD: 1e1,           // BTC ~$17k-$68k → raw ~170k-680k
  ETHUSD: 1e1,           // ETH ~$900-$4k → raw ~9k-40k
  XRPUSD: 1e5,           // XRP ~$0.30-$1.50 → raw ~30k-150k
};

// Name mapping for bt_data_1h output (Dukascopy symbol → our file name)
const OUT_NAMES = {
  EURUSD: 'EURUSD', GBPUSD: 'GBPUSD', USDJPY: 'USDJPY', AUDUSD: 'AUDUSD',
  USDCAD: 'USDCAD', GBPJPY: 'GBPJPY', EURJPY: 'EURJPY', EURGBP: 'EURGBP',
  NZDUSD: 'NZDUSD', USDCHF: 'USDCHF', XAUUSD: 'GC_SPOT', XAGUSD: 'SI_SPOT',
  USATECHIDXUSD: 'NQ_PROXY',
  BTCUSD: 'BTCUSD', ETHUSD: 'ETHUSD', XRPUSD: 'XRPUSD',
};

// Default instruments to fetch
const DEFAULT_INSTRUMENTS = ['EURUSD','GBPUSD','USDJPY','AUDUSD','XAUUSD','GBPJPY','EURJPY','USATECHIDXUSD'];

// ── Download raw bi5 bytes ────────────────────────────────────────────────────
function fetchBi5(symbol, year, month0, day) {
  const mm  = String(month0).padStart(2,'0');   // 0-indexed month
  const dd  = String(day).padStart(2,'0');
  const url = `https://datafeed.dukascopy.com/datafeed/${symbol}/${year}/${mm}/${dd}/BID_candles_min_1.bi5`;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent':'Mozilla/5.0', 'Referer':'https://www.dukascopy.com/' }
    }, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }  // market closed day
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));    // ECONNRESET etc. → treat as no data
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
  });
}

// ── Decompress LZMA bi5 with xz ──────────────────────────────────────────────
function decompress(bi5Buf) {
  const tmp = path.join(require('os').tmpdir(), `duk_${Date.now()}.bi5`);
  fs.writeFileSync(tmp, bi5Buf);
  const result = spawnSync('xz', ['--decompress','--keep','--format=lzma','--stdout', tmp], { maxBuffer: 200*1024 });
  try { fs.unlinkSync(tmp); } catch(e) {}
  if (result.status !== 0) return null;
  return result.stdout;  // Buffer with raw binary
}

// ── Parse decompressed binary → 1-min bars ───────────────────────────────────
// bi5 record layout (24 bytes): [uint32 t_sec][uint32 o][uint32 h][uint32 l][uint32 c][float32 vol]
// t_sec = seconds from start of day (NOT milliseconds)
function parse1min(buf, dayUtcMs, factor) {
  const n = Math.floor(buf.length / 24);
  const dayStartSec = Math.floor(dayUtcMs / 1000);
  const bars = [];
  for (let i = 0; i < n; i++) {
    const off = i * 24;
    const t   = buf.readUInt32BE(off);           // seconds from start of day
    const o   = buf.readUInt32BE(off + 4);
    const h   = buf.readUInt32BE(off + 8);
    const l   = buf.readUInt32BE(off + 12);
    const c   = buf.readUInt32BE(off + 16);
    if (o === 0 && h === 0 && l === 0 && c === 0) continue;  // gap/inactive
    bars.push({
      t: dayStartSec + t,                          // unix seconds (t is already in seconds)
      o: o / factor, h: h / factor, l: l / factor, c: c / factor
    });
  }
  return bars;
}

// ── Resample 1-min bars → arbitrary period (e.g. 3600=1H, 900=15m) ──────────
function resamplePeriod(bars1m, periodSecs) {
  const buckets = new Map();
  for (const b of bars1m) {
    const key = Math.floor(b.t / periodSecs) * periodSecs;
    if (!buckets.has(key)) {
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c });
    } else {
      const x = buckets.get(key);
      x.h = Math.max(x.h, b.h);
      x.l = Math.min(x.l, b.l);
      x.c = b.c;
    }
  }
  return [...buckets.values()].sort((a,b) => a.t - b.t);
}

function resample1H(bars1m)  { return resamplePeriod(bars1m, 3600); }
function resampleM15(bars1m) { return resamplePeriod(bars1m, 900);  }  // 15-min bars

// ── Utility ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateRange(startYear, endYear) {
  const days = [];
  const now = new Date();
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(y, m+1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(Date.UTC(y, m, d));
        if (dt > now) break;
        const dow = dt.getUTCDay();
        if (dow === 0 || dow === 6) continue;  // skip weekends
        days.push({ y, m, d, ms: dt.getTime() });
      }
    }
  }
  return days;
}

function loadExisting(name, dir=OUT_DIR) {
  const fp = path.join(dir, `${name}.json`);
  if (!fs.existsSync(fp)) return new Map();
  const arr = JSON.parse(fs.readFileSync(fp));
  return new Map(arr.map(b => [b.t, b]));
}

function saveData(name, map, dir=OUT_DIR) {
  const arr = [...map.values()].sort((a,b) => a.t - b.t);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(arr));
  return arr.length;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let instruments, startYear, endYear;
  if (args.length >= 3) {
    instruments = [args[0].toUpperCase()];
    startYear   = parseInt(args[1]);
    endYear     = parseInt(args[2]);
  } else if (args.length === 1) {
    instruments = [args[0].toUpperCase()];
    startYear   = currentYear - 5;
    endYear     = currentYear;
  } else {
    instruments = DEFAULT_INSTRUMENTS;
    startYear   = currentYear - 5;
    endYear     = currentYear;
  }

  console.log(`\n=== fetch_dukascopy.js ===`);
  console.log(`Instruments: ${instruments.join(', ')}`);
  console.log(`Date range: ${startYear}–${endYear}`);
  console.log(`Output: ${OUT_DIR}\n`);

  // Verify xz is available
  const xzCheck = spawnSync('xz', ['--version']);
  if (xzCheck.status !== 0) {
    console.error('ERROR: xz not found in PATH. Install XZ Utils first.');
    process.exit(1);
  }

  // Ensure both output directories exist
  if (!fs.existsSync(OUT_DIR))     fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(OUT_DIR_M15)) fs.mkdirSync(OUT_DIR_M15, { recursive: true });

  const days = dateRange(startYear, endYear);
  console.log(`Trading days to check: ${days.length} per instrument`);
  console.log(`Outputs: bt_data_1h/ (1H bars) + bt_data_m15/ (15-min bars)\n`);

  for (const sym of instruments) {
    const factor   = FACTORS[sym] || 1e5;
    const outName  = OUT_NAMES[sym] || sym;
    const existing1h  = loadExisting(outName, OUT_DIR);
    const existingM15 = loadExisting(outName, OUT_DIR_M15);
    const before1h = existing1h.size;
    let downloaded = 0, skipped = 0, errors = 0;

    process.stdout.write(`\n[${sym}] fetching ${days.length} days (1H + M15)... `);

    for (const { y, m, d, ms } of days) {
      const hourStart  = Math.floor(ms / 1000 / 3600) * 3600;
      const hourEnd    = hourStart + 86400;
      // Skip only if BOTH 1H and M15 are fully covered for this day
      const covered1h  = [...existing1h.keys()].filter(t => t >= hourStart && t < hourEnd).length;
      const covered15m = [...existingM15.keys()].filter(t => t >= hourStart && t < hourEnd).length;
      // ~20 1H bars = fully covered day; ~80 M15 bars = fully covered day (4× as many)
      if (covered1h >= 20 && covered15m >= 60) { skipped++; continue; }

      const bi5 = await fetchBi5(sym, y, m, d);
      if (!bi5 || bi5.length < 100) { await sleep(150); continue; }

      const raw = decompress(bi5);
      if (!raw) { errors++; await sleep(150); continue; }

      const min1  = parse1min(raw, ms, factor);
      const h1    = resample1H(min1);
      const m15   = resampleM15(min1);

      for (const b of h1)  existing1h.set(b.t, b);
      for (const b of m15) existingM15.set(b.t, b);
      downloaded++;

      // Incremental save every 50 days — survive crashes
      if (downloaded % 50 === 0) {
        saveData(outName, existing1h,  OUT_DIR);
        saveData(outName, existingM15, OUT_DIR_M15);
        process.stdout.write(` [saved ${downloaded}]`);
      }

      await sleep(200);   // polite rate limit
    }

    const total1h  = saveData(outName, existing1h,  OUT_DIR);
    const totalM15 = saveData(outName, existingM15, OUT_DIR_M15);
    const added1h  = total1h - before1h;
    const firstDate = [...existing1h.values()].sort((a,b)=>a.t-b.t)[0];
    const lastDate  = [...existing1h.values()].sort((a,b)=>b.t-a.t)[0];
    const fmtDate   = t => new Date(t*1000).toISOString().slice(0,10);
    console.log(`done. downloaded=${downloaded} skipped=${skipped} errors=${errors}`);
    console.log(`  → 1H:  ${outName}.json: ${total1h} bars  (${fmtDate(firstDate.t)} → ${fmtDate(lastDate.t)}) [+${added1h} new]`);
    console.log(`  → M15: ${outName}.json: ${totalM15} bars`);
  }

  console.log('\n=== Complete ===');
  console.log('New files are in bt_data_1h/ and ready for backtest16/17.');
})();
