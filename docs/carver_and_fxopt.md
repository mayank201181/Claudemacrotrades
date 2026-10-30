# Carver forecasts and the FX option pricer (25 Oct 2026)

Owner's ask: take openly licensed quant code and put it to work in the book. From a shortlist he said
"do both" to the two below. No vendor or proprietary code is used; both are written from published
methods and checked against the reference library.

## 1. FX option pricer — `scripts/fxopt/`

`fxopt.py` is Python standard library only, so a digest run can execute it without installing anything.
It prices, in Garman-Kohlhagen:

- vanillas with greeks; strike from delta and delta from strike in the four FX conventions (spot, forward,
  premium-adjusted spot, premium-adjusted forward); ATM delta-neutral strike;
- European digitals paid in the terms or the base currency;
- one-touch (paid at expiry or at hit) and no-touch;
- single knock-out and knock-in barriers (no rebate);
- a vanna-volga smile from ATM / 25d RR / 25d BF (vanillas, digitals including the skew term, and barriers
  with QuantLib's `VannaVolgaBarrierEngine` recipe). Touches stay at ATM vol and say so.

Rates and vols are in percent. Run `python3 -I fxopt.py '{"pair":"USDJPY","type":"call",...}'`; the usage is
at the top of the file. `test_fxopt.py` cross-checks everything against QuantLib-Python (`pip install
QuantLib`): worst differences are below 3e-11 of spot, and 3.3e-7 of spot for vanna-volga barriers
(finite-difference bumps on both sides). The same harness found the dashboard's R01 digital, one-touch and
spread formulas (`_shared/convexity.ts`) equal to QuantLib to 4e-15.

Added 26 Oct 2026 (review of the 17 @pyquantnews libraries): double no-touch / double one-touch paid at expiry
(Hui series; QuantLib `AnalyticDoubleBarrierBinaryEngine` to 5e-16), and `bf_type` (default `market`): a quoted
25d butterfly is read as a broker market strangle and the smile strangle is solved so the market-strangle strikes
reprice; `smile` keeps the old reading. `test_fxopt_financepy.py` checks that smile against FinancePy's
`FXVolSurface` (GPL-3, test only; 25d vols agree to 0.004 vol). Of the other libraries none added anything
QuantLib and fxopt do not already cover (verdicts in the project note `notes/quant_libraries_review_26oct2026.md`).

What it does not have: a market vol surface. A digest passes an implied vol it found (with source), or the
trend monitor's realised rv20 labelled as such.

## 2. Carver forecasts — `supabase/functions/_shared/forecast.ts`

After the Trend Monitor computes its run, `dash-trend` appends a `CARVER FORECASTS` block to the stored
report, after `END_TREND_MONITOR` (the monitor's machine block and self-check are untouched; any failure only
drops the block). Per asset, on Carver's -20..+20 scale (|10| = average conviction):

- EWMAC 8/32, 16/64, 32/128, 64/256: (fast EWMA - slow EWMA) / robust vol (EW std of daily price changes,
  span 35, 5th-percentile floor), times the published scalars 5.3 / 3.75 / 2.65 / 1.87, capped at 20;
- trend: the four speeds equally weighted times the FDM, computed each run from the pooled correlation of
  the speeds over the last five years (1.13 on 25 Oct 2026);
- carry, FX only: the base-minus-terms policy-rate gap (BIS WS_CBPOL, fetched each run) over annualised
  vol, times 30. SGD and TWD have no BIS policy rate (NA); for CNH, INR, IDR and KRW a policy rate is a proxy
  for NDF-implied carry;
- combined: 60/40 trend/carry times 1.39, capped; trend alone where carry is NA.

Rates use -100 x yield as the price, so + means long bonds. With Carver's scalars the average |forecast| on
this universe is about 7.8 rather than 10, so a 10 here is a stronger-than-average signal.

Machine lines: `FORECAST|run_date|asset|last_date|f8|f16|f32|f64|trend|carry|combined` between
`BEGIN_FORECASTS|v1` and `END_FORECASTS`. Tests: `npx -y tsx --test supabase/functions/_shared/forecast.test.ts`.

## 3. How the digests use them — rule R10 (`supabase/rules/R10_carver_and_fxopt.sql`)

A CARVER line on every card and tested line on a monitor asset (evidence, never a gate), and a PRICER line
for every R01 card and named option expression, run from the Drive copy of `fxopt.py`. R01's MARK SCRIPT
premium stays the card's p0; the pricer is a cross-check. Model probabilities are never printed as market
odds.

## Live (25 Oct 2026)

On the owner's yes: `dash-trend` v7 is a one-line stub that imports `supabase/functions/dash-trend/index.ts` from
this public repo at commit 64d1f84, so the running code is exactly the reviewed files (re-pin the stub after any
change; rollback = pin to 2e5fd87). `fxopt.py` is on Drive in the Opus folder (byte size checked against this
file). R10 was proposed through `dash.propose_rule` and applies at the Sun 1 Nov 20:00 SGT window.
