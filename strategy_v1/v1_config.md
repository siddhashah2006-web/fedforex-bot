# Fed Forex — Strategy V1 Config (snapshot 2026-06-09)

## Confirmed Champion Parameters
- **Timeframe:** 1H bars
- **Wick filter:** 0.50 (50% wick ratio)
- **Zone stack:** ≥2 TFs (D/4H/2H/1H)
- **Kill zones:** Both London (IST 12:15-15:15) + NY-AM (IST 19:15-21:15)
- **Displacement:** next bar close in upper/lower 55% of range AND body ≥ 0.3×ATR
- **Trend:** H4 + H1 aligned (2-TF)
- **Dealing range:** rolling 5-day hi/lo midpoint (enter below mid for longs)
- **Exits:** 1/3@1R, 1/3@1.7R, 1/3@2.56R — BE after T1

## V1 Backtest Results
| Config | n | WR | Exp/trade |
|---|---|---|---|
| 1H OG baseline | 120 | 54.2% | +0.102R |
| **1H OG+disp+bothKZ (CHAMPION)** | **85** | **78.8%** | **+0.647R** |
| 1H OG+disp+London | 35 | 85.7% | +0.710R |
| M15 OG+disp+bothKZ | 202 | 65.8% | +0.349R |

## Signal Frequency (1H champion, 14 instruments)
- ~13 signals/year total = ~1/month across full portfolio

## Files (this directory)
- `backtest17.js` — 1H champion backtest (leak-free)
- `backtest18.js` — 7-strategy expansion (RB, crypto, M15)
- `backtest18m.js` — M15-specialist backtest
- `worker_v1.js` — live Cloudflare worker at time of V1 snapshot

## To restore V1
Copy `worker_v1.js` content to Cloudflare dashboard worker editor and deploy.
All parameters above are exact.
