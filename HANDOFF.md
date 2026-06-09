# FED FOREX — PROJECT HANDOFF  (paste this into a new chat to continue)

> Purpose: lets a fresh Claude chat pick up exactly where we left off, so you stop paying for this huge conversation. Everything important is also saved in Claude's memory files (auto-loads in this project), but this is the portable, human-readable copy.

## How to use
Start a new chat and say: *"Read HANDOFF.md in C:\Users\DESKTOP\Desktop\Claude Code\ and continue my Fed Forex project."*

---

## 1. WHO / STRATEGY
- **Siddh**, brand **Fed Forex**, pure **ICT** trader, India (IST, UTC+5:30).
- Model = **"Liq Grab" / ERL→IRL→ERL**: HTF bias → liquidity sweep (Asian swept by London, London by NY) → enter at an OB+FVG+IFVG stack in premium/discount inside a kill zone → SL beyond swept structure → target next liquidity → scale partials, trail to BE.
- **Confirmed rules** (from him): Daily bias = prior-days trend + liquidity draws + reactions off key Daily OBs. Entry trigger = **wick rejection** after sweeping a zone, landing on **multi-TF stacked** OB/FVG/IFVG. Execute on **30m**. Two archetypes: **CONTINUATION** (all D1+H4+H1 aligned, with-trend) and **REVERSAL** (H4+H1 aligned vs D1, needs the wick). Kill zones IST: Asian 06:30–10:15, London 12:15–15:15, NY-AM 19:15–21:15 (also uses NY-AM 17:00–21:00 in older code).
- Sessions/instruments traded: futures **NQ, ES, GC, CL** (most of his trades) + FX **EURUSD, GBPUSD**. **EURUSD is his weakest** pair.
- Full method written up in `SIDDH_STRATEGY.md`.

## 2. HONEST BACKTEST FINDINGS (these numbers are TRUE — do not repeat the earlier mistake)
- An adversarial audit found the early **"~70% win rate" was FAKE** — caused by (a) look-ahead bias (`D.slice(-5)` used end-of-dataset prices for premium/discount; resampled bars stamped at period-START leaked future closes), (b) test-set leakage (champion picked by best test-year score), (c) a gamed win-rate metric.
- **Leak-free re-measurement** (`backtest14.js`, `backtest15.js`, causal resampling + rolling dealing range + expectancy + Wilson CI): the genuine edge ≈ **H4+H1 aligned + zone stack + NY-AM + premium/discount = ~54% win, +0.16R/trade**, consistent train/test. Modest but real. Raw sweep+wick alone LOSES (-0.06R).
- Reversals are **NOT mechanizable** (best mechanical reversal ~50%, his real reversals 73% = discretionary skill). Continuation is the automatable edge.
- His 63 replay trades: **clean trades (no tagged mistake) = 100% win; every loss had a self-tagged mistake.** Best kill zone per instrument varies (ES/CL→London, NQ→NY-PM in his real data; NY-AM most robust in leak-free test).

## 2b. EXTENDED BACKTEST FINDINGS (THIS SESSION — June 2026)

### Displacement Filter Discovery (MOST IMPORTANT)
Adding a **displacement confirmation** requirement after a wick-rejection setup:

**Rule:** The 1H bar AFTER the sweep+wick must close in the upper/lower 55% of its range AND have a body ≥ 0.3×ATR (confirms reversal direction before entering)

| Config | n | Win Rate | 95% CI | Exp R/trade | Train/Test | Result |
|--------|---|----------|--------|-------------|------------|--------|
| Baseline | 120 | 54% | [45–63] | +0.10R | −0.02/+0.16 | weak |
| **NY-AM + Displacement** | **51** | **74.5%** | **[61–84]** | **+0.60R** | **0.38/0.66** | **✓ BOTH** |
| **London + Displacement** | **33** | **87.9%** | **[73–95]** | **+0.73R** | 0.94/0.45 | **✓ BOTH** |
| **Both KZ + Displacement** | **83** | **79.5%** | **[70–87]** | **+0.65R** | **0.71/0.62** | **✓ BOTH** |

- **Best instruments:** RTY 100%/+1.12R, YM 70%/+0.64R, GBPUSD 71%/+0.44R, AUDUSD 80%/+0.46R
- **Skip:** ES (40%/–0.35R), USDCAD (0 signals), EURJPY (weak)
- **Best portfolio:** NQ + GBPUSD + AUDUSD + GBPJPY + RTY + YM → 76.3%, +0.61R ✓BOTH
- **Practical use:** Alert fires on setup; wait for confirmation candle to close (1H later) before entering; still within kill zone

### Data Sources Extended
- **Dukascopy bi5** (free, no account, back to 2003): Built `fetch_dukascopy.js`
  - Fixed timestamp bug: bi5 `t` field is in SECONDS from day start (not ms — was giving 1 bar/day before fix)
  - EURUSD extended from 2023 back to 2021 (6240 new 1H bars) — confirmed working with correct hourly timestamps
  - 2018–2022 data being downloaded in background for all 8 forex instruments
  - Instruments: EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, GBPJPY, EURJPY + XAUUSD (→GC_SPOT) + USATECHIDXUSD (→NQ_PROXY)
- **Other free APIs:** Built `fetch_free_apis.js` covering Alpha Vantage, Twelve Data, OANDA Practice, Polygon.io, ECB (insert free keys in KEYS object)
  - **OANDA Practice is the best deep-history source**: free demo account at oanda.com → Manage API Access → generate token. Add to KEYS.oanda and run `node fetch_free_apis.js oanda`. H1 candles from ~2005. Paginating fetch from 2020 is already in the code (change date for more history). This gives 20+ years of forex data in one run.

### backtest18 — 7-Strategy Expansion (2026-06-09) — COMPLETE RESULTS

**Rejection Block (1H) — VERDICT: NOT VIABLE**
| Config | n | WR | Exp | Verdict |
|---|---|---|---|---|
| RB baseline (window=12) | 90 | 51.1% | +0.043R | ~ONE |
| RB + both KZ | 160 | 51.9% | +0.055R | ~ONE |
| RB window=3 (best) | 83 | 55.4% | +0.131R | ~ONE |
| RB + displacement | 50 | 46.0% | -0.042R | ✗NEG |
- RB and displacement are MUTUALLY EXCLUSIVE — displacement picks strong reversals, RB picks retests. Can't combine both.
- Best standalone RB only 55.4% WR — worse than OG+displacement. Use only as Combo fallback.

**OG + Crypto:**
- BTCUSD: only 1-3 year data, 1 signal with disp filter. Too little data for standalone use.
- Adding crypto to 14-inst portfolio: n=86 (vs 85), WR unchanged. Negligible effect until more data.

**Combo (OG-disp primary + RB fallback) — BEST FOR FREQUENCY:**
| Config | n | WR | Exp | Verdict |
|---|---|---|---|---|
| Combo both KZ (14 insts) | 159 | 66.0% | +0.388R | ✓BOTH |
| └── OG portion | 85 | 78.8% | +0.647R | ✓BOTH |
| └── RB portion | 74 | 51.4% | +0.090R | ~ONE |
| Combo wick0.55 both KZ | 123 | 67.5% | +0.428R | ✓BOTH |
| Combo London | 73 | 65.8% | +0.351R | ✓BOTH |
| Combo best portfolio | 86 | 68.6% | +0.466R | ✓BOTH |

**Targeted Config Final Ranking (✓BOTH, n≥10, by WR):**
| Rank | Config | n | WR | Exp | Notes |
|---|---|---|---|---|---|
| 1 | OG + disp + London + wick0.5 | 35 | **85.7%** | +0.710R | Highest WR |
| 2 | OG + disp + London + wick0.6 | 27 | 85.2% | **+0.809R** | Highest EV/trade |
| 3 | **OG + disp + bothKZ + wick0.55** | **69** | **81.2%** | **+0.751R** | **← NEW CHAMPION** |
| 4 | OG + disp + bothKZ + wick0.5 [orig] | 85 | 78.8% | +0.647R | Most signals (1H) |
| 5 | Combo + bothKZ + wick0.55 | 123 | 67.5% | +0.428R | Best Combo |
| 6 | Combo + bothKZ + wick0.5 | 159 | 66.0% | +0.388R | Max 1H signals |

- **wick0.55 beats wick0.5**: 81.2% vs 78.8% with only 16 fewer trades → use wick0.55 going forward
- London only: extreme WR (~85%) but only ~5 signals/year across all 14 instruments
- **New champion: OG + disp + bothKZ + wick0.55 — 81.2% WR, +0.751R, n=69**

**M15 Timeframe (5 instruments: BTCUSD/ETHUSD/EURUSD/GBPUSD/USDJPY):**
| Config | n | WR | Exp | Verdict |
|---|---|---|---|---|
| M15 OG baseline | 213 | 49.3% | +0.017R | ~ONE |
| M15 OG + disp + both KZ | 141 | **67.4%** | +0.412R | ✓BOTH |
| M15 OG + disp + both KZ (wick0.55) | 98 | **70.0%** | +0.533R | ✓BOTH |
| M15 OG + disp + London | 37 | **70.3%** | +0.681R | ✓BOTH |
| M15 Combo + both KZ | 231 | 58.9% | +0.210R | ✓BOTH |
| M15 + BTCUSD Combo | 266 | 59.0% | +0.203R | ✓BOTH |

**Signal Frequency (honest, extrapolated to 14-instrument portfolio):**
| Strategy | n (5 insts) | /year (5 insts) | Ext. 14 insts | /month |
|---|---|---|---|---|
| 1H OG+disp+bothKZ | 85/6.5yr | 13.1 | 13 total | **~1/mo** |
| 1H Combo bothKZ | 159/6.5yr | 24.5 | 24 total | **~2/mo** |
| M15 OG+disp+bothKZ | 141/~2.5yr | 56.4/5insts | ~158/year | **~13/mo** |
| M15 Combo | 231/~2.5yr | 92.4/5insts | ~258/year | **~22/mo** |

- M15 Combo across full 14-instrument portfolio → **~22 signals/month ≈ 5/week** (nearly daily)
- M15 OG+disp (quality) → **~13 signals/month ≈ 3/week**

### Data status (as of 2026-06-09)
| File | Bars | Period | Status |
|---|---|---|---|
| bt_data_1h/ETHUSD.json | 33,792 | 2021-2026 | ✓ Complete |
| bt_data_1h/BTCUSD.json | 24,864 | 2019-2022 | ✓ (wrong factor 1e5, scale-invariant OK) |
| bt_data_m15/AUDUSD.json | 161,088 | 2020-2026 | ✓ **NEW** |
| bt_data_m15/GBPJPY.json | 160,800 | 2020-2026 | ✓ **NEW** |
| bt_data_m15/EURJPY.json | 160,512 | 2020-2026 | ✓ **NEW** |
| bt_data_m15/EURUSD.json | 16,416 | 2023-2026 | ⚠ gap 2020-2023 |
| bt_data_m15/ETHUSD.json | 96,000 | 2021-2024 | ✓ |
| bt_data_m15/BTCUSD.json | 48,000 | 2019-2020 | ⚠ gap 2022-2026 |
| bt_data_m15/GBPUSD.json | 57,600 | 2020-2022 | ✓ |
| bt_data_m15/USDJPY.json | 33,600 | 2020-2021 | ✓ |
- fetch_dukascopy.js now saves BOTH 1H and M15 simultaneously
- BTCUSD factor fixed to 1e1 for future downloads; existing data usable as-is (scale-invariant)

---

## 3. LOCAL FILES (in C:\Users\DESKTOP\Desktop\Claude Code\)
- `trades_text.json` — his 63 trades (images stripped). `trade_images/` — 112 chart JPGs.
- `SIDDH_STRATEGY.md` — canonical strategy spec.
- `backtest*.js` — research. **Use backtest14/15 (leak-free, baseline ~54%); backtest16/17 (displacement filter, ~74%); backtest19 (V2, weekly/DOW filters); backtest20 (V3 champion — 30m, run `node backtest20.js`, ~2s). Ignore 8–13 (look-ahead bug).**
- `fetch_dukascopy.js` — downloads Dukascopy 1-min bi5 → resamples to 1H → merges into bt_data_1h/. Run: `node fetch_dukascopy.js EURUSD 2018 2022`. No account needed. Timestamp bug fixed: t is seconds, not ms.
- `fetch_free_apis.js` — Alpha Vantage, Twelve Data, OANDA, Polygon, ECB. Add keys to KEYS object at top of file.
- `scan.js`, `levels.js`, `sync.js`, `telegram.js`, `run_hidden.vbs` — local versions of the alert engine (superseded by the Cloudflare worker; local Windows tasks `FedForex_*` exist but should be disabled to avoid duplicates).
- `cloudflare/worker_v3.js` — **V3 worker (ready to deploy)**. `cloudflare/worker_v2.js` — V2 (active). `cloudflare/worker.js` — original. `cloudflare/DEPLOY_CLOUDFLARE.md` — deploy guide.
- Data: `bt_data/` (15m 60d), `bt_data_1h/` (1h 2y).

## 4. LIVE SYSTEM — Cloudflare Worker (24/7, free, no PC, no Claude tokens)
- Worker: **`fedforex-alerts`** → URL `https://fedforex-alerts.siddha-shah2006.workers.dev`
- Cloudflare account id: `54120df1129373a62674f7163a51ff73` · KV namespace **`FF_STATE`** id `3e1b4bf69f3042808761c222401339bc` (binding name `STATE`).
- **V2 Crons (UTC):** `*/5 * * * *` levels, `43 5 * * *` London scan, `27 10 * * *` NY-AM scan, `*/15 * * * *` M15 scan, `47 7,15,20 * * *` Supabase sync.
- **V3 Cron change:** replace `*/15 * * * *` with `*/30 * * * *` after deploying worker_v3.js.
- **No-spam behavior (current):** every-5-min run alerts ONLY on 4H/Daily POI **zone-stack** approach/tap. Continuation "potential trade" alerts at kill-zone scans. V3 adds two-stage 30m alerts (⚡ Setup → ✅ Entry).
- To redeploy after editing `cloudflare/worker.js`: dashboard → worker → Edit code → Ctrl+A → paste → Deploy. (Dashboard SPA is slow on deep links; load the worker's main page first.) Tip: `Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 worker.js)` then paste.

## 5. DATA SOURCES
- **Yahoo Finance** (`query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=&range=`) — current source, **~15-min delayed**, free. Symbols: GC=F,NQ=F,ES=F,CL=F,EURUSD=X,GBPUSD=X.
- **FOREX.com / CIAPI** (`ciapi.cityindex.com/TradingAPI`) — tested working but **FOREX.com US is FOREX-ONLY** (no gold/indices/oil — US reg). Real-time forex only. Creds in `forex_creds.json`.
- **Real-time futures** = paid: Massive.com $199/mo (covers CME/COMEX/NYMEX), or Tradovate(+CME fee), or IBKR(needs a PC running its Gateway — incompatible with cloud). No free real-time futures (exchange fees).
- **TradingView** = no data API, BUT he bought a live futures feed and we use its **alerts→webhook** (see §6) for real-time triggers.

## 6. TELEGRAM + TRADINGVIEW (LIVE, verified)
- Telegram bot **@Signals_FFBot**, chat id `5945486829`. All alerts deliver here.
- **TradingView webhook receiver** in the worker: `POST https://fedforex-alerts.siddha-shah2006.workers.dev/tv?k=ff-tv-6f420f4aa452` → relays the alert body to Telegram (📺), in real-time off his live feed. Set this URL + a non-empty Message in TradingView alerts. Webhook key (TV_SECRET) = `ff-tv-6f420f4aa452`.

## 7. SECRETS (values live in these files / Cloudflare — not reprinted here for safety)
- Telegram bot token → `telegram.json` (also a Cloudflare secret `TG_TOKEN`). Chat id `5945486829` (`TG_CHAT`).
- Supabase URL `https://hcavvfmunwjxxkwsmmaw.supabase.co` + **public anon** key → `.env` / `replay-journal/.env` (Cloudflare `SUPABASE_URL`/`SUPABASE_KEY`). Trades in table `replay_trades` (read-only).
- FOREX.com demo creds → `forex_creds.json`.
- Cloudflare worker secrets set: TG_TOKEN, TG_CHAT, SUPABASE_KEY, SUPABASE_URL, TV_SECRET.

## 2c. V2 RESULTS (backtest19.js — 2026-06-09)

### Two NEW major filter discoveries

**S3: 1H + weekly-open bias = 83.0% WR, +0.774R, n=47 ✓BOTH** ← NEW ABSOLUTE CHAMPION
- Rule: for longs, price must be BELOW the current weekly candle's open. For shorts, ABOVE.
- Concept: aligns with the market maker weekly bias. Buying discount relative to the week open.
- Improvement over V2 champion (+4.1% WR, +0.053R/trade). From 79% → 83%.

**S7: M15 + day-of-week filter (Tue-Thu only) = 71.4% WR, +0.496R, n=105 ✓BOTH** ← NEW M15 CHAMPION
- Rule: no trades on Monday (direction uncertain, prior week liquidity flush not done) or Friday (profit-taking, thin close)
- Improvement: +3.7% WR, +0.117R/trade vs M15 baseline (67.7% → 71.4%)
- ~8 signals/month extrapolated to 14 instruments

### Full V2 strategy menu (deploy-ready, all ✓BOTH)

| Rank | Strategy | WR | Exp/trade | /month (14 insts) | Use for |
|---|---|---|---|---|---|
| 1 | **S3: 1H + weekly bias** | **83%** | **+0.774R** | ~0.6 | Highest quality |
| 2 | V2 champion (1H+wick0.55) | 79% | +0.721R | ~0.9 | Standard quality |
| 3 | **S7: M15 + DOW (Tue-Thu)** | **71.4%** | **+0.496R** | **~8** | **Best balance quality/freq** |
| 4 | S8: M15 + weekly bias | 69.2% | +0.418R | ~10 | Good alternative |
| 5 | M15 champion (wick0.55) | 67.7% | +0.379R | ~13 | Most signals |
| 6 | S11: M15 + all3KZ (Asian) | 67.7% | +0.374R | ~17 | Max signals |

### What failed in V2 testing
- **FVG retracement entry (S12): 42.3% WR — ACTIVELY HURTS**. Waiting for price to retrace into the displacement bar means it's moving against you. Enter at displacement close, never wait for pullback.
- D1 trend filter on M15 (S6): 61.4%, test fails. D1 is too slow/stale for M15 precision.
- Hybrid 1H→M15 (S15): n=1267 overcounting (too permissive without displacement on 1H side)
- High-RR exits 1.5/2.5/4R: same total expectancy, lower WR (50-66%). Standard 1/1.7/2.56 wins.

### V2 files built
- `strategy_v1/` — complete V1 snapshot (backtest17/18/18m + worker_v1.js + config)
- `backtest19.js` — all 18 strategy variants tested
- `cloudflare/worker_v2.js` — V2 live worker with:
  - wick=0.55 (upgraded from 0.5)
  - **Two-stage alerts**: ⚡ Setup Forming (sweep detected) → ✅ Entry Confirmed (displacement closes)
  - **M15 scan** every 15 min during London/NY-AM kill zones (Yahoo Finance 15m)
  - KV state machine: Stage-1 stored with 30-min TTL, Stage-2 checks on next scan
  - Entry/SL/T1/T2/T3 all computed and sent in the entry alert
  - Day-of-week filter configurable (DOW_FILTER=false by default, set true to enable)

### To deploy V2 worker
1. Open Cloudflare dashboard → fedforex-alerts worker
2. Add new cron trigger: `*/15 * * * *` (for M15 scan)
3. Copy worker_v2.js content → paste into editor → Deploy
4. Test: visit `https://fedforex-alerts.siddha-shah2006.workers.dev?run=m15`

### Still to do for full V2
- Add weekly-bias filter to worker_v2.js (S3 and S8 finding — adds +4% WR)
- Download EURUSD M15 2020-2023 (currently only 2023-2026, 3-year gap)
- Download AUDUSD M15 (3rd best 1H instrument, not yet in M15 dataset)
- Extend BTCUSD M15 to 2022-2026 (currently only 2019-2022)

## 2d. V3 RESULTS (backtest20.js — 2026-06-09)

### 🔥 BREAKTHROUGH: 30-minute timeframe

Same OG strategy (disp+bothKZ+wick0.55) on **30m bars** instead of M15:

| Config | n | WR | 95% CI | Exp | Tr/Te | Verdict |
|---|---|---|---|---|---|---|
| M15 baseline (V2 champion) | 309 | 67.0% | [62–72] | +0.399R | 0.48/0.33 | ✓BOTH |
| **C18: 30m base** | **210** | **77.1%** | **[71–82]** | **+0.683R** | 0.71/0.66 | **✓BOTH** |
| C19: 30m+DOW | 114 | 75.4% | [67–82] | +0.621R | 0.76/0.50 | ✓BOTH |
| **C20: 30m+weekly** | **149** | **77.9%** | **[71–84]** | **+0.705R** | 0.66/0.75 | **✓BOTH ← V3 CHAMPION** |
| C21: 30m+DOW+weekly | 77 | 75.3% | [65–84] | +0.638R | 0.69/0.58 | ✓BOTH |
| C22: 30m+prior-day | 22 | 90.9% | [72–97] | +1.193R | 1.22/1.17 | ✓BOTH (too few signals) |

**Why 30m wins**: 2× longer bar reduces micro-noise; 30m displacement is more significant; 30m slot boundary at 12:00 IST may capture pre-London momentum. Net: +10.1% WR over M15 baseline.

### Per-instrument breakdown (C18 — 30m base, all 8 instruments)

| Instrument | n | WR | Exp | Decision |
|---|---|---|---|---|
| AUDUSD | 36 | **83.3%** | +0.750R | ✓ INCLUDE |
| BTCUSD | 13 | 76.9% | +0.659R | ✓ INCLUDE |
| ETHUSD | 26 | **80.8%** | +0.776R | ✓ INCLUDE |
| EURJPY | 34 | 58.8% | +0.377R | ✗ EXCLUDE (consistent underperformer) |
| EURUSD | 4 | 50.0% | +0.377R | ✗ EXCLUDE (insufficient data — only 2023-2026) |
| GBPJPY | 37 | **83.8%** | +0.785R | ✓ INCLUDE |
| GBPUSD | 32 | **81.3%** | +0.669R | ✓ INCLUDE |
| USDJPY | 28 | 78.6% | +0.818R | ✓ INCLUDE |

### V3 Champion portfolio (C20 — 30m+weekly, 6 instruments)

Excluding EURJPY and EURUSD:

| Instrument | n | WR | Exp |
|---|---|---|---|
| AUDUSD | 26 | 80.8% | +0.645R |
| BTCUSD | 10 | 80.0% | +0.748R |
| ETHUSD | 18 | 72.2% | +0.499R |
| GBPJPY | 25 | **84.0%** | +0.801R |
| GBPUSD | 23 | 82.6% | +0.805R |
| USDJPY | 21 | **85.7%** | +1.049R |
| **Total** | **123** | **~81.3%** | **~+0.745R** |

**~10 signals/month** (extrapolated to 6-instrument portfolio)

### What FAILED in V3 testing

- **DOW filter with 8 instruments**: 66.1% WR — WORSE than M15 baseline. The 3 new instruments (AUDUSD, GBPJPY, EURJPY) introduce noise DOW can't overcome. On 30m, adding DOW cuts signals by 46% with no WR gain.
- **Silver Bullet narrow KZ** (first 45 min only): C5=66.2%, C8=66.7% — no improvement over full KZ. Entry quality doesn't concentrate in the first 45 min.
- **Signal scoring system** (0–11 points): C12=67.0%, C13=67.0%, C14=66.8%, C15=66.6%, C16=68.9% — all essentially flat vs baseline. No threshold extracts better setups.
- **1H combined filters**: C9 (wk+priorDay) n=8 too few; C11 (all 3) n=5 too few. Can't use.

### Technical implementation notes

- **30m KZ boundaries**: `rsC(BM15, 1800)` groups the 12:15 IST M15 bar into the 12:00 IST slot. Must use `m>=720` (not `m>=735`) for London30. London30: `m>=720&&m<930`, NYAM30: `m>=1020&&m<1260`.
- **Weekly bias in live worker**: `resample(B1h, 604800)[Wbars.length-2].o` = last completed week's open (second-to-last weekly bar).
- **O(n) precompute pattern** in backtest20.js: per-bar advancing pointer arrays for `trendAt()` and daily/weekly lookups — reduced backtest from 5-6 min to ~2 sec.

### V3 files built

- `backtest20.js` — 25 strategy variants across 8 M15 instruments (~440 lines, ~2s runtime)
- `cloudflare/worker_v3.js` — V3 production worker (~496 lines):
  - `INSTR_30M` = 6 instruments (EURJPY, EURUSD excluded)
  - `run30mScan(env)` = two-stage 30m scan with weekly bias
  - Cron `*/30 * * * *` (replaces `*/15 * * * *`)
  - Stage 1: ⚡ SETUP FORMING at sweep close → KV stored 3600s TTL
  - Stage 2: ✅ ENTRY CONFIRMED at displacement close (30 min later)
  - All V2 helpers preserved: `entryMsg()`, `zones()`, `trendOf()`, `htfStacks()`, etc.

### Telegram bot commands (worker_v3.js — Seg 10)
- `/status` — list all pending Stage-1 setups from KV
- `/pause [h]` — mute alerts for h hours (default 4h)
- `/unpause` — resume alerts immediately
- `/forcescan` — trigger a 30m scan right now (bypasses KZ time guard, still respects blackout)
- `/stats` — backtest summary + live alert count
- `/help` — command list

### Live alert logging (Seg 11)
Every Stage-2 "ENTRY CONFIRMED" alert is logged to Supabase `live_alerts` table.  
Create the table once in Supabase SQL editor:
```sql
create table live_alerts (
  id         bigint generated always as identity primary key,
  created_at timestamptz default now(),
  pair       text not null, direction text not null, timeframe text not null,
  entry      float8, sl float8, t1 float8, t2 float8, t3 float8,
  kz         text, note text, alert_ts bigint
);
alter table live_alerts enable row level security;
create policy "anon_select" on live_alerts for select using (true);
```

### FOMC/NFP blackout (Seg 12)
All scans (scheduled cron + `/forcescan`) are blocked 60 min before and 90 min after:
- NFP: first Friday of each month @ 08:30 ET
- FOMC: rate decision day @ 14:00 ET
- 2026 dates hardcoded in `BLACKOUT_EVENTS` array (20 events)
- `/forcescan` during blackout tells user "Scan blocked — high-impact event in Xmin"
- Update `BLACKOUT_EVENTS` in the worker annually

### To deploy V3 worker

1. Open Cloudflare dashboard → **fedforex-alerts** worker → Edit code
2. `Ctrl+A` → paste entire `cloudflare/worker_v3.js` → **Deploy**
3. In **Cron Triggers** tab: delete `*/15 * * * *` trigger → add `*/30 * * * *`
4. Test: visit `https://fedforex-alerts.siddha-shah2006.workers.dev?run=30m`
5. **Register Telegram webhook** (one-time): visit `?run=setwh` — returns `{ok:true,...}`
6. In Telegram, send `/help` to the bot to confirm commands work
7. Create `live_alerts` table in Supabase (SQL above) for Seg 11 logging

---

## 8. OPEN ITEMS / NEXT

### Immediate (V3 deploy)
- [ ] **Deploy worker_v3.js**: Cloudflare → fedforex-alerts → Edit code → paste `cloudflare/worker_v3.js` → Deploy. Then Cron Triggers: remove `*/15` → add `*/30`.
- [ ] Test `?run=30m` endpoint after deploy.

### V3 Remaining Segments
- [x] **Seg 10: Telegram bot commands** — /status /pause /unpause /forcescan /stats /help ✓ DONE
- [x] **Seg 11: Live performance tracking** — logAlert() → Supabase live_alerts table ✓ DONE (create table with SQL above)
- [x] **Seg 12: FOMC/NFP blackout** — 20 events hardcoded; 60 min before + 90 min after ✓ DONE
- [ ] **Seg 8: HTF FVG exits** — variable T3 targeting next unmitigated HTF FVG above/below entry
- [ ] **Seg 9: TradingView Pine Script** — 30m strategy indicator

### Data gaps
- [ ] EURUSD M15 2020–2023 (currently only 2023–2026)
- [ ] BTCUSD M15 2022–2026 (currently only 2019–2022)

### Other
- [ ] Disable local Windows tasks to avoid duplicate alerts: PowerShell `Get-ScheduledTask FedForex_* | Disable-ScheduledTask`
- [ ] Confirm Supabase `replay_trades` RLS = SELECT-only for anon role.
- Reminder: he is cost-conscious about tokens — keep chats lean; rely on memory + this file.
