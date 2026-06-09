// Mechanical backtest of Siddh's "Liq Grab" ICT core.
// Rules encoded (the OBJECTIVE part of his model):
//  1. HTF bias  : EMA of daily closes -> bull/bear (his "HTF Aligned").
//  2. Asian range: high/low of IST 00:00->12:15 each day (the pool London/NY hunts).
//  3. Kill zone : only enter during London KZ (12:15-15:15 IST) or NY AM KZ (17:00-21:00 IST).
//  4. Liq sweep : a bar pierces the Asian high (short) or low (long) then CLOSES back inside (rejection).
//  5. Prem/Disc : selling a swept high = premium, buying a swept low = discount (auto-satisfied).
//  6. HTF align : short only if bias bearish; long only if bias bullish.
//  Entry = rejection-bar close. SL = swept extreme +/- buffer. TP = fixed R multiple.
//  One trade/day (first valid signal). Resolve over next ~2 trading days (his hold style).
//  NOT modeled: FVG / IFVG / OB / Fib / rejection-block refinement (his discretionary edge).

const fs = require("fs");
const IST = 5.5 * 3600; // seconds offset

function load(name) {
  const j = require("C:/Users/DESKTOP/Desktop/Claude Code/bt_data/" + name + ".json");
  const r = j.chart.result[0], q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    const tIST = (r.timestamp[i] + IST) * 1000;
    const d = new Date(tIST);
    const dayKey = d.toISOString().slice(0, 10);
    const min = d.getUTCHours() * 60 + d.getUTCMinutes(); // minutes in IST clock
    bars.push({ t: r.timestamp[i], dayKey, min, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return bars;
}

function ema(arr, p) { const k = 2 / (p + 1); let e = arr[0], out = [e]; for (let i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); } return out; }

function backtest(name, RR) {
  const bars = load(name);
  // daily closes for HTF bias
  const days = [...new Set(bars.map(b => b.dayKey))].sort();
  const dayClose = {}; bars.forEach(b => dayClose[b.dayKey] = b.c); // last seen = close
  const closes = days.map(d => dayClose[d]);
  const e = ema(closes, 10);
  const biasOf = {}; days.forEach((d, i) => biasOf[d] = closes[i] >= e[i] ? "bull" : "bear");

  // index bars by day
  const byDay = {}; bars.forEach(b => (byDay[b.dayKey] = byDay[b.dayKey] || []).push(b));

  const trades = [];
  for (let di = 1; di < days.length; di++) {
    const day = days[di];
    const bias = biasOf[days[di - 1]]; // use prior-day-confirmed bias
    const dayBars = byDay[day];
    // Asian range = bars before London KZ (min < 735)
    const asian = dayBars.filter(b => b.min < 735);
    if (asian.length < 4) continue;
    const aHigh = Math.max(...asian.map(b => b.h)), aLow = Math.min(...asian.map(b => b.l));
    // kill-zone entry windows
    const inKZ = b => (b.min >= 735 && b.min < 915) || (b.min >= 1020 && b.min < 1260);
    const kz = dayBars.filter(inKZ);
    let sig = null;
    for (const b of kz) {
      if (bias === "bear" && b.h > aHigh && b.c < aHigh) { // swept Asian high, rejected
        const sl = b.h, entry = b.c, risk = sl - entry;
        if (risk > 0) { sig = { dir: "short", entry, sl, tp: entry - RR * risk, t: b.t }; break; }
      }
      if (bias === "bull" && b.l < aLow && b.c > aLow) { // swept Asian low, rejected
        const sl = b.l, entry = b.c, risk = entry - sl;
        if (risk > 0) { sig = { dir: "long", entry, sl, tp: entry + RR * risk, t: b.t }; break; }
      }
    }
    if (!sig) continue;
    // resolve over next up-to-2 trading days of bars after entry time
    const horizon = bars.filter(b => b.t > sig.t).slice(0, 2 * 96); // ~2 days of 15m bars
    const risk = Math.abs(sig.entry - sig.sl);
    const oneR = sig.dir === "short" ? sig.entry - risk : sig.entry + risk;
    let outcome = null;
    if (MANAGED) {
      // bank 50% at +1R then move stop to BE for the runner
      let banked = false;
      for (const b of horizon) {
        if (!banked) {
          if (sig.dir === "short" ? b.h >= sig.sl : b.l <= sig.sl) { outcome = -1; break; } // full SL before +1R
          if (sig.dir === "short" ? b.l <= oneR : b.h >= oneR) { banked = true; continue; } // hit +1R: bank half, stop->BE
        } else {
          if (sig.dir === "short" ? b.h >= sig.entry : b.l <= sig.entry) { outcome = 0.5 * 1 + 0.5 * 0; break; } // runner stopped at BE
          if (sig.dir === "short" ? b.l <= sig.tp : b.h >= sig.tp) { outcome = 0.5 * 1 + 0.5 * RR; break; }       // runner hits TP
        }
      }
      if (outcome === null) outcome = banked ? 0.5 : -1; // unresolved: half locked or still full risk
    } else {
      for (const b of horizon) {
        if (sig.dir === "short") {
          if (b.h >= sig.sl) { outcome = -1; break; }
          if (b.l <= sig.tp) { outcome = RR; break; }
        } else {
          if (b.l <= sig.sl) { outcome = -1; break; }
          if (b.h >= sig.tp) { outcome = RR; break; }
        }
      }
      if (outcome === null) { const last = horizon[horizon.length - 1]; if (!last) continue;
        const mtm = sig.dir === "short" ? (sig.entry - last.c) / risk : (last.c - sig.entry) / risk;
        outcome = Math.max(-1, Math.min(RR, mtm)); }
    }
    trades.push({ day, ...sig, R: parseFloat(outcome.toFixed(2)) });
  }

  const wins = trades.filter(t => t.R > 0.01).length;
  const losses = trades.filter(t => t.R <= -0.999).length;
  const decisive = wins + losses;
  const totalR = trades.reduce((a, t) => a + t.R, 0);
  return {
    name, RR, trades: trades.length, wins, losses,
    winRate: decisive ? (wins / decisive * 100) : 0,
    totalR: parseFloat(totalR.toFixed(1)),
    expectancyR: trades.length ? parseFloat((totalR / trades.length).toFixed(3)) : 0,
    _t: trades
  };
}

const INSTR = ["NQ", "ES", "GC", "CL", "EURUSD", "GBPUSD"];
let MANAGED = false;
function runSuite() {
for (const RR of [2.56, 3.6]) {
  console.log(`\n========  TARGET = ${RR}R   [${MANAGED ? "MANAGED: 50% @ +1R, runner to BE" : "RAW: full TP-or-SL"}]  ========`);
  console.log("INSTR    Trades   Win%   Wins/Loss   TotalR   Exp/trade");
  let agg = [];
  for (const n of INSTR) {
    const r = backtest(n, RR); agg.push(r);
    console.log(
      r.name.padEnd(8),
      String(r.trades).padStart(5),
      (r.winRate.toFixed(0) + "%").padStart(7),
      (r.wins + "W/" + r.losses + "L").padStart(11),
      String(r.totalR).padStart(8) + "R",
      String(r.expectancyR).padStart(9) + "R"
    );
  }
  const T = agg.reduce((a, b) => a + b.trades, 0), W = agg.reduce((a, b) => a + b.wins, 0), L = agg.reduce((a, b) => a + b.losses, 0), TR = agg.reduce((a, b) => a + b.totalR, 0);
  console.log("-".repeat(55));
  console.log("PORTFOLIO".padEnd(8), String(T).padStart(5), ((W / (W + L) * 100).toFixed(0) + "%").padStart(7), (W + "W/" + L + "L").padStart(11), (TR.toFixed(1)).padStart(8) + "R", ((TR / T).toFixed(3)).padStart(9) + "R");
}
}
MANAGED = false; runSuite();
MANAGED = true;  runSuite();
