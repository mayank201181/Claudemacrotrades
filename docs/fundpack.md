# Fundamentals pack (6 Nov 2026)

What it is: one stdlib Python script, `scripts/fundpack/fundpack.py` (~25 s, no keys), that builds a ~14 KB text file
of slow-moving fundamentals for G10 and Asia (US, EA, JP, GB, CA, AU, NZ, CH, SE, NO, CN, KR, TW, IN, ID, MY, TH, PH,
SG, HK). Built weekly (Sun 18:41 SGT, scheduled task "Weekly fundamentals pack", Opus thread session) into project
files `fundpack/` and Drive `fund_pack_latest`. The daily market pack copies it in as **section G** when it is under
9 days old, so the Fable Macro Takeaways read it through STEP 2 item 1 with no prompt change.

| Block | Source | Measure |
|---|---|---|
| Inflation | IMF CPI (headline), OECD PRICES_ALL (core; quarterly AU/NZ), Eurostat prc_hicp_minr (EA headline, core, services), FRED CPILFESL (US core) | y/y, 3m and 6m change, 5y percentile |
| Policy and real rates | BIS WS_CBPOL | policy rate, real = policy minus headline CPI, rank |
| Cycle | OECD CLI and business confidence (BCI) | level vs 100, 3m momentum, OECD phase (expansion/slowdown/downturn/recovery) |
| Trade | IMF IMTS (goods, USD, world) | exports 3-month sum y/y, 3-month balance vs a year earlier (EA uses Germany) |
| Reserves | IMF IL | FX reserves in USD, 3m and 6m % change (valuation included) |
| Credit | BIS WS_TC, WS_CREDIT_GAP | private non-financial credit % GDP, 4q and 8q change, credit gap |
| US block | FRED | claims, NFCI, unemployment, payrolls, core CPI 3m saar, core PCE, 5y5y, HY OAS |

Usage: `python3 -I fundpack.py --out DIR`. Prints `ok: <path> <bytes> · <n> cells · errors <n>`; each source fails soft.
The market pack takes `--fund PATH` (default `/mnt/project-files/fundpack/fund_pack_latest.md`).

## Limits and choices

- Levels only, no consensus: an anchor for the top-down view and a theme's risks line, never a trigger or a p input.
- Lags: IMF CPI and reserves 1-3 months, IMTS trade about 3 months, BIS credit about 2 quarters. Cells print their period;
  over 4 months (monthly) or 9 months (quarterly) prints STALE; core series over 12 months old are dropped.
- PMIs (S&P Global, Caixin, ISM) are not free; OECD business confidence is the stand-in.
- DBnomics was tested and dropped: its IMF IFS and NBS copies ended in mid-2025 / Feb 2026. ALFRED vintages need a key; not used.
- Gaps: Taiwan CPI and trade (not in IMF datasets), Singapore policy rate (MAS runs an FX band), OECD CLI for EA, NZ, CH, SE, NO.
- The "regime" words are momentum labels, descriptive and untested.
