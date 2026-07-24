# THT Monthly 33FVB — iteration log

Reverse-engineering "THT Monthly 33FVB Strategy / SMZ" toward the reference screenshot
(TSLA · 1W · NASDAQ, backtest 2010-06-28 → 2026-07-20, 100K USD).
Method per the handout: band math first (one hypothesis per iteration), then trade
logic, holding the other half frozen. Replica data: IBKR split-adjusted TSLA
monthly + weekly bars (last close 313.03 vs 313.01 on the reference chart → feed
noise ≈ ±1%, which matters at band-touch margins).

Ground-truth objective (BACKTEST — this symbol):
Trades 4 · WR 50% · PF 2.6 · AvgWin +111.1% · AvgLoss −42.7% · Expectancy +34.2% ·
Total +38.5% · MaxDD −48.2% · AvgHold 28.5 · TP/Stop 2/2.
Anchor band triple during Jun-2026: **340.90 / 301.74 / 273.30**.

---

## Phase 1 — band math (anchor-bar assertion, ±2% tolerance)

Window = 33 monthly bars ending May-2026 (confirmed `[1]` offset → the triple shown
during June). `SMA(ohlc4,33)` = 302.90 vs reference mid 301.74 (+0.39%).

| It. | Hypothesis | upper / mid / lower | err% vs 340.90/301.74/273.30 | Verdict |
|---|---|---|---|---|
| 1 | **H1: SMA(high,33) / SMA(ohlc4,33) / SMA(low,33)** | 337.21 / 302.90 / 268.44 | −1.08 / +0.39 / −1.78 | **PASS** |
| 1b | H1 variant, mid = SMA(hl2,33) | 337.21 / 302.82 / 268.44 | −1.08 / +0.36 / −1.78 | PASS (indistinguishable from H1; kept ohlc4 per the param string) |
| 2 | H2: mid ± 1.0×ATR(33) (RMA) | 365.83 / — / 239.98 | +7.3 / — / −12.2 | fail |
| 2b | H2 variant, SMA of true range | 372.18 / — / 233.62 | +9.2 / — / −14.5 | fail |
| 3 | H3: mid ± stdev(ohlc4 − SMA, 33) | 382.51 / — / 223.30 | +12.2 / — / −18.3 | fail |
| 4 | H4: mid × (1 ± stdev(monthly roc, 33)) | 337.95 / — / 267.86 | −0.87 / — / −1.99 | numeric near-pass, but symmetric — cannot produce the reference's +13.0%/−9.4% asymmetry; rejected |
| 0 | v1 code: mid ± 1.0×stdev(ohlc4,33) | 392.05 / — / 213.76 | +15.0 / — / −21.8 | fail (root defect confirmed) |

**Locked: H1.** The reference triple's asymmetry around its mid is the fingerprint of
an SMA-of-extremes channel; no dispersion-around-mid formula reproduces it. The
trailing "1" in `1M 33 ohlc4 1` = width multiplier around the mid
(`upper = mid + 1.0×(SMA(high,33) − mid)`).

## Phase 2 — trade logic (bands frozen at H1)

Monthly regime replica (close vs prior confirmed band): BULL 2013-03 · BEAR 2016-10 ·
BULL 2017-01 · BEAR 2019-04 · BULL 2019-12 · BEAR 2022-12 · BULL 2024-11.
Note 2016-10 is marginal (13.18 vs 13.42, −1.8%) — inside feed noise.

| It. | Rule set | n | TP/SL | WR | AvgWin | AvgLoss | Hold | Verdict |
|---|---|---|---|---|---|---|---|---|
| 5 | v1: enter on bull flip (breakout), TP 3×width on close, stop on bear flip | ≥8 | — | — | — | — | — | fail: fires every cycle + re-entries; ~10x too many trades in 2024-26 alone |
| 6 | Weekly dip entries (close/low into band), weekly regime, close-fill TP grid | 4 | 1/3 | 25% | +98 | −20 | 16-36 | fail: wrong trades (2016/2018/2019/2023) |
| 7 | Monthly-close signals, dip into band, once/regime, TP 3×width | 4 | 2/2 | 75% | +48.5 | −11.6 | 29.0 | shape right, magnitudes wrong; one stop closed +1% → WR 75 |
| 8 | Wide grid: entry {flip, close/low ≤ upper/mid/lower} × stop {bear-flip, weekly<lower, weekly<mid} × TP {fixed 0.7-1.55, k·width 1.5-5} × re-entry | best 4 | 2/2 | 50% | +88-100 | −12 to −16 | 26-49 | avg-loss stuck shallow: every early-cycle dip entry sits near the band, so its stop-out is small |
| 9 | **Canonical v2** (1:1 with shipped Pine): monthly-confirmed regime; entry = first weekly close crossing INTO the band from above, once/regime; TP = limit at entry + 3.6×width; stop = bear flip | **4** | **2/2** | **50%** | +72.0 | −28.7 | **30.2** | **best** — see below |

Iteration-9 trade list (replica):

| Entry | Px | Exit | Px | Kind | Ret |
|---|---|---|---|---|---|
| 2015-11-09 | 13.81 | 2016-10-31 | 12.70 | Stop | −8.0% |
| 2017-03-06 | 16.25 | 2017-06-19 | 25.78 | TP | +58.7% |
| 2022-10-03 | 223.07 | 2023-01-03 | 113.06 | Stop | −49.3% |
| 2025-03-03 | 262.67 | 2025-12-15 | 486.92 | TP | +85.4% |

Scorecard vs pass thresholds:

| Metric | Target | Replica | Pass |
|---|---|---|---|
| Trades | 4 | 4 | ✓ |
| TP/Stop | 2/2 | 2/2 | ✓ |
| Win rate | 50% | 50% | ✓ |
| Avg hold | 28.5 ± 6 | 30.2 | ✓ |
| Total return | +38.5 ± 5pp | ≈ +37% (100% equity compounding) | ✓ |
| Max drawdown | −48.2 ± 5pp | ≈ −49% | ✓ |
| Avg win | +111.1 ± 10pp | +72.0 | ✗ |
| Avg loss | −42.7 ± 8pp | −28.7 | ✗ |

Visual acceptance: BUY prints on the Mar-2025 pullback into the band, TP at the
2025 extension (~487), deep 2022 stop, red cloud pre-2024 flip / green after,
half-width ≈ ±11% of mid. Matches the reference frame.

## Failed branches (do not retry)

- Symmetric dispersion bands (stdev raw/detrended, ATR, return-stdev ×): killed by the
  anchor assertion and/or asymmetry (iterations 2-4).
- Breakout (flip) entries as the ONLY trigger: either 3 TP/1 SL (2013+2019 cycles both
  TP) or floods of trades with re-entry. Cannot give 2/2.
- Weekly-close regime flips: fires bear in 2016-01/2016-06 on weekly noise → extra
  shallow stops, kills the 4-trade count.
- Deep-dip entries (low ≤ mid): the 2013-2016 cycle entry lands ~Feb-2016 near the low
  and stops out POSITIVE in Oct-2016 → win rate 75, TP/SL mapping breaks.
- Fixed-% TP ≥ +100% with close fills: the 2025 trade's TP lands above the Dec-2025
  high (498.8) → position never closes → 3 closed trades.

| 10 | Iteration-9 rules + monthly B-Xtrender gate (RSI(EMA(c,s1)−EMA(c,s2),s3)−50; param sets (5,20,15)/(5,21,14)/(14,21,5)/(5,14,21)/(1,14,5); gate = positive / rising / either / both at the confirmed signal month) | 2-3 | — | — | — | — | — | **fail — hypothesis rejected.** Every gate variant suppresses the 2022-10 entry (monthly momentum was negative/falling through the whole Oct-Nov 2022 dip), which is the reference's deep −43%-class stop. No variant kills the 2015-2017 pair while keeping 2022. The momentum-gate explanation for the reference's trade set is dead; the residual gap is feed-dependence of the marginal 2016-10 flip (explanation 1 below). |

## Open gap + hypothesis for next pass

Avg win/avg loss remain compressed vs the reference (+72/−28.7 vs +111.1/−42.7). Both
residuals trace to the 2015-11 and 2017-03 trades, which hinge on band touches that
are within feed noise (the marginal 2016-10 bear flip: monthly close 13.18 vs lower
band 13.42, a 1.8% margin). The momentum-gate explanation was tested and rejected
(iteration 10). Remaining explanation: TradingView's TSLA feed shifts those touches →
different early trades (e.g. no 2016-10 flip removes the 2015/2017 pair; a 2013-cycle
TP ~+134% plus a deeper 2022-10 entry would land avg win ≈ +111 / avg loss ≈ −43
exactly — arithmetic consistent with the reference).

**Next verification must happen ON TradingView with the real feed** (offline replica
has converged):
1. Load the v2 script on TSLA · 1W, backtest window 2010-06-28 → 2026-07-20, 100K.
2. Anchor assertion: hover a June-2026 weekly bar — the status line should read
   ≈ 340.9 / 301.7 / 273.3 (±2%). If yes, the band math is confirmed on the real feed.
3. Compare the trade list. If 2015-11/2017-03 entries are absent on TV data, the
   stats should land near the reference; if present, tune `TP = entry + k × width`
   (k input) and the entry/re-arm toggles — every degree of freedom is exposed as an
   input for exactly this purpose.

## Guardrails held (v2)

- `request.security(..., gaps_off, lookahead_off)` + `[1]` confirmed offset — regime
  and bands never read the developing monthly bar.
- Signals read RAW bands; EMA smoothing stays display-only below weekly TFs.
- `plot()` titles/linewidths const; all `ta.*` computed unconditionally.
- UNIVERSE panel remains free-text inputs (prefilled with the video's published fund
  figures, clearly labeled display-only; nothing presented as computed).
- `process_orders_on_close = true` retained (marks print on the signal bar).
