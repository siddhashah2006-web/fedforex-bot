# SIDDH — TRADING DNA (faithful strategy spec, v1)

> Goal: encode Siddh's exact ICT method so a machine makes the same calls he does.
> Source: 63 replay trades (whyTrade/postNotes + before/after charts) + measured stats.
> Tags: **[C]** = confirmed from his data · **[I]** = inferred, NEEDS HIS CONFIRMATION.

## 0. Identity
Brand "Fed Forex". Pure ICT. India (IST, UTC+5:30). Replay/backtesting now; "would-take-live" flagged per trade.

## 1. The model in one line
**ERL → IRL → ERL liquidity delivery.** Price reaches for *external range liquidity* (a swept high/low, "s"), Siddh enters at the *internal range liquidity* (FVG/OB/IFVG inefficiency) in premium/discount, and targets the *next external liquidity pool*. He calls the trade itself a **"Liq Grab."** [C]

## 2. Workflow — TOP-DOWN [C]
Daily → 4H → 1H → execute on **30m** (preferred) or 15m. Start HTF, define bias + draw the POI/dealing range, then drill down for the entry. (Validated: 30m entries beat 15m.)

## 3. Bias [C — confirmed]
Daily bias from: the **previous days' underlying trend**, the **liquidity draws** (where price is being pulled), and **reactions off key areas** (e.g., a Daily OB that price rejected from). A discretionary read of trend + draw-on-liquidity + HTF OB/level reactions.
- **HTF alignment depends on SETUP TYPE [C, confirmed by Siddh]:**
  - **CONTINUATION** (with-trend, entry at INTERNAL liquidity = FVG/OB pullback): require **D1 + H4 + H1 ALL aligned**. (n=26, 75%.)
  - **REVERSAL** (against D1, entry at EXTERNAL liquidity = sweep then turn): require **H4 + H1 aligned** + **candlestick/wick/rejection confirmation** at the swept POI. D1 may be against. The wick rejection is MANDATORY here. (n=11, 73%.)
  - All 3 synced = his **A+/best**. Engine gate: TAKE if (continuation: all-3) OR (reversal: H4+H1 + rejection wick). Fidelity: H4+H1 rule lifted sample agreement 5/10 → 7/10.

## 4. Liquidity map [C]
- Marks **ERL** (external range liquidity = range highs/lows, the draw/target) and **IRL** (internal liquidity = FVG/OB inside the range = entry).
- Tags every swept level "**s**". Session model: **Asian swept by London; London swept by NY.**
- Entry only *after* a sweep of the relevant pool (sellside under Asian/London lows for longs; buyside above highs for shorts). Liquidity Sweep present in **100%** of trades.

## 5. Point of interest (entry zone) [C]
Enter from an **OB + FVG + IFVG** confluence, refined by **Fib OTE (61.8 / 70.5 / 78.6 "golden zone")**, in the correct **premium (shorts) / discount (longs)** half.
- **Multi-timeframe stacking is the quality filter** [C, confirmed by him]: a zone is strong only if it stacks across timeframes; HTF stack > LTF stack; he wants **4H stack + 30m stack** at minimum, ideally Daily too. A 1H/2H-only zone = weak/skip.
- Rejection Block & Mean Threshold (of the FVG/OB) used as refinements (~24-52%).

## 6. Entry trigger [C — confirmed by Siddh]
**A wick rejection AFTER sweeping a zone**, where the rejection wick lands on **stacked confluence — OB + FVG + IFVG across multiple timeframes**. The candle's rejection wick does the confirming. Execute on the **30m**.

## 7. Stop loss [C — corrected]
SL placed **beyond the swept extreme / far side of the OB-FVG**. Stops are CONSISTENT, not tight (median ticks/pips: EURUSD ~13, GBPUSD ~21, GC ~28, ES ~20-40, CL ~50, NQ ~58). 
- NOTE: trade #1779966437541 logged slPips=2 — a **data-entry typo** (only outlier in 63 trades); it created a fake 17R "Farfetched TP". Not a real decision. Do NOT treat tiny SL values as intentional.
- The few "Wrong SL"/"got wicked out" losses = stop tight *for that structure's volatility*, his own tag — not absolute micro-stops. Rule: SL at the structural extreme, never tightened to inflate R.

## 8. Targets [C]
TP = the **next external liquidity pool / opposing ERL** (Asian highs/lows, prior session H/L, swing liquidity). Planned R:R averages **3.6** (range ~2 to ~9).
- **Leak:** "Farfetched TP" — when a tiny stop inflates R into a 9-17R moonshot that won't complete. Rule: target a *real* liquidity pool; don't manufacture huge R from a micro-stop. [C]

## 9. Trade management [C]
Scales out in **partials** (25/25 or 30/30/30), then **trails remainder to breakeven** — he literally annotates **"Book 50% and BE"** on charts. Banks at intermediate liquidity/rejection levels along the way.

## 10. Timing [C]
Kill zones (IST): **Asian 06:00–09:00 · London 12:15–15:15 · NY AM 17:00–21:00 · NY PM 23:00–00:30.** Kill Zone present in 89% of trades. (Backtest flagged NY-open as highest-probability; he reports London & NY-PM strong too — to reconcile.)

## 11. Confluence checklist (his 13)
Kill Zone · HTF Aligned · Liquidity Sweep · MSS/BOS · OB/FVG/BPR · Premium/Discount · IFVG · Fractal S/R · Fib · Rejection Block · Mean Threshold · Clear Invalidation · R:R ≥ 2.

## 12. Disqualifiers / mistakes to avoid (from his tagged losses) [C]
Wrong Bias (fading HTF) · tight/Wrong SL · Farfetched TP · No Partials Taken · EOD Entry Timing (new-day open kills trades) · Entry Timing (too early, no confirmation) · Heavy Momentum (chasing).

## 13. Instruments [C]
Strong: GC/gold, CL, ES, NQ, GBPUSD. **Weak: EURUSD** (17% live WR; weakest in every backtest). Futures > FX majors for him.

## 14. MINIMUM STACK TO TAKE A TRADE [C — confirmed]
**Full ladder: Daily + 4H + 2H + 1H + 30m** must all show the POI/zone stacking at the entry price. This is his A+ gate — rare, high-conviction. Entry trigger fires on the 30m wick rejection within that stack.

## 15. STILL OPEN (minor — to refine later)
- **Target** rule when multiple liquidity pools exist — nearest opposing ERL, or the major draw?
- **Max trades/day** and re-entry rules?
