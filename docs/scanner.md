# Extremes and seasonality scanner

Built 19 Nov 2026 (thread "Build extremes and seasonality scanner") on the owner's ask for a standing process that catches
seasonal and reversal-after-a-big-move setups across his markets, as candidates only: interesting at extremes that
historically reverted, or where a small opposite catalyst could turn the move, never as trades on their own.

## What it is

`scripts/scanner/scanner.py` (copy of the running file in project files `scanner/`; keep the two byte-identical; stdlib
only, no credentials). Every morning at 06:10 SGT the Haiku feeder thread runs it through `feeders/feeder.py scanner`
(scheduled task `trig_015XKVVpLccDvR4fVSdBGvaM`), and uploads `extremes_latest` to the digests' Drive folder by file
reference. The Takeaways reads it under rule R25 (proposed 19 Nov, applies Sun 22 Nov 2026 20:00 SGT unless opposed).

Data: Yahoo Finance daily bars for the market pack's price universe (50 series: G10 and Asian FX, UST yields and the
10-year future, energy, metals, US, European and APAC equity indices, VIX and MOVE), 15 years, cached under
`scanner/history/` and topped up with a 3-month pull each day; FRED `DGS2` for the 2-year yield; CFTC Traders in
Financial Futures and Disaggregated reports from the public Socrata API (`gpe5-46if`, `72hh-3qpy`), weekly since 2006,
23 contract/group pairs, cached in `scanner/history/cftc_net.json`. Yahoo answers 429 to any User-Agent fuller than
`Mozilla/5.0`, and `range=max` serves sparse bars for some indices, so the first pull uses `range=15y`.

## What the file holds

- **A. Today's extremes**: BB_STREAK (4+ closes outside the 20-day 2-sigma band), STRETCH (2.5 ATR(20) or more from the
  20-day mean), RSI (RSI(14) at 75 / 25), Z20 (20-day move at 2 sigma of the series' own 20-day moves over 3 years).
  Each flag carries the base rate from the same series: after past events of the same kind and side (first day the
  condition turns true after 10 sessions without it), how often the move reverted over 5, 10 and 20 sessions, the
  median forward move, n, the unconditional rate of a move against that side (the baseline, so drift is in the
  comparison) and a binomial p. Verdict at 20 sessions: REVERTS (hit rate 10+ points above the baseline, p < 0.05,
  n >= 20), CONTINUES (the mirror), NO EDGE, THIN (n < 20).
- **B. Seasonal windows opening now**: from today's calendar date, 20 sessions forward, one observation per year over
  10+ years; listed at a 70% hit rate or better with the median move, p, and the **placebo rate** (the share of all
  start dates in the same series that pass the same rule, which is what chance produces); CLEARS PLACEBO needs 25
  points over the placebo and p < 0.05, else WEAK.
- **C. Positioning**: CFTC net position (leveraged funds, asset managers or managed money) with its 3-year percentile;
  CROWDED at the 5th / 95th percentile; the price's record after past extremes of the same side (5 / 10 / 20 sessions,
  against the unconditional rate). This is not R02: the database read still decides HARD POSITIONING and R09's crowd.
- **D. Method and honesty**: the number of base rates computed (about 1,200 a morning) and how many pass p < 0.05 by
  chance (about 60), overlap and in-sample caveats, what is not covered.
- `scanner/flags_history.csv`: one row per flag per day, so the weekly review can score the verdicts out of sample.

## First build, 19 Nov 2026

50 series, 85 to 100 seconds. 17 extreme flags: one REVERTS (gold, stretch down: 72% reverted over 20 sessions against
52% unconditional, n=43, p=0.01), the rest NO EDGE or THIN. The DXY "five closes above the upper band" pattern from the
owner's screenshot: in EURUSD the mirror has n=12 in 15 years and a 20-day reversion rate of 50% against 47%, so no
edge. Three seasonal windows, none clearing its placebo rate (the NDX "up into December" window passes a 70% rule on
40% of all start dates). Six CFTC extremes, all with fewer than 20 past events.

## Running it by hand

    cd /tmp && python3 -I /mnt/project-files/feeders/feeder.py scanner <scratchpad>/upload
    python3 -I scripts/scanner/scanner.py --out <folder> --no-fetch     # rebuild from the cache, for tests

A first build in an empty folder fetches 15 years for every series (about 2.5 minutes); a daily build about 1.5.
