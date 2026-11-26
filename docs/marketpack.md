# Market pack (1 Nov 2026)

What it is: one stdlib Python script, `scripts/marketpack/marketpack.py`, that builds a ~30 KB text file of market
data for the Fable Macro Takeaways before it runs. The takeaways read the newest Drive copy titled
`market_pack_latest` in STEP 2 item 1 and follow the file's own HOW TO USE block.

## Sections

| | Source | What the digest does with it |
|---|---|---|
| A price action | Yahoo chart API, 54 assets (G10/Asia FX, UST yields and futures, energy, metals, equity indices, vol indices, BTC) | TAPE strip levels; one price clause per theme and card (trend vs MA50/200, 1w move in sigma, ext in ATR, flags) |
| B participation | Yahoo v7 quote (crumb) for the most-held contract of 17 futures roots; volume from the chart | price/OI read (new longs, short covering, new shorts, long liquidation) and volume vs 20d on themes and cards |
| C positioning build-up | `posbuild.sql`, run by the digest with `execute_sql` | cites series whose 4-week change in 3-year percentile is 25 points or more; R02 still decides extremes |
| D FX options and NDFs | DTCC public swap repository (CFTC FX files: the full-day file for finished days, the intraday files for the day that is ending) | option notional vs 20d and base-call share per pair, NDF volume, large strikes expiring within 14 days near spot, and implied vol by tenor from option premiums (10 Nov); cited as "DTCC sample" |
| E headlines | Google News queries plus FT, Nikkei Asia, CNBC, WSJ, MarketWatch RSS, last 24h | leads for the completeness sweep only |
| F disclosed shorts JP/AU | QuiVad (keyless republication of the JFSA and ASIC short registers), added 1 Nov 2026 | most shorted Japanese and ASX names and 1-week build-ups; cited only on single-name JP/AU cards or themes |
| H credit and cycle | FRED daily (`BAMLH0A0HYM2`, `DFEDTARU`, `EFFR`), Yahoo `^VIX` and fed funds futures, added 16 Nov 2026 | one CREDIT line and one CYCLE line that R22 prints on equity, USD and UST cards; evidence only |
| I dollar drivers | US Treasury daily par curve (2y), ECB AAA curve 2y, Japan MOF JGB 2y (`jgb2y_history.csv` cache), Yahoo daily closes (DXY, EURUSD, USDJPY, SPX, SOX, ^TNX, USDKRW, USDTWD), CFTC TFF leveraged funds and asset managers in seven G10 currency futures converted to USD at the weekly spot, section D's RR25, added 23 Nov 2026 | inputs of the DOLLAR DRIVERS block (R37): 2y differentials and the rate-model part of USD's 1m move, DXY per -1% SPX/SOX on down days, sell-America days, KRW/TWD residual against SOX, net USD positioning, a WINDOWS table (each driver over 1d, 3d, 1w), a mechanical TAG; one row a day in `dollar_history.csv` |
| J Asia rates | Japan MOF JGB curve, Bank of Korea ECOS (public sample key, 10 rows a call), ChinaMoney CGB curve (one month a query), Trading Economics country pages (SGS, IGB, INDOGB, MGS, ThaiGB, TGB, RPGB, HKGB), DTCC CFTC rates files (median fixed rate of outright spot or IMM-start swaps per index and tenor: JPY TONA, SGD SORA, KRW CD, TWD TAIBOR, CNY repo, THB THOR, MYR KLIBOR, HKD HIBOR, INR MIBOR), BOJ/RBI/ING Think RSS and Google News; added 26 Nov 2026 | the ASIA RATES block of rule R39: MOVERS, 1d/3d/1w bp by market, curves, swap minus govvy, a LOCAL vs GLOBAL read, a candidate expression, commentary leads. History in `asia_rates_history.csv` (400 days) |

Usage: `python3 -I marketpack.py --out DIR [--sql posbuild.sql] [--skip D,E]`. Prints
`ok: <path> <bytes> · A n · B n · D <date> · E n`. Every section fails soft. History files in DIR:
`oi_history.csv` (120 days), `dtcc_daily.csv`, `dtcc_strikes.csv`, `shorts_history.csv` (top 60 names per market, 120 days), `credit_cycle_history.csv` (one row a day: HY OAS, 6-month change, VIX z, credit state, cycle stage), `dollar_history.csv` (one row a day of the section I numbers and tag), `jgb2y_history.csv` (MOF 2y closes, about two years).

`verify_drive.py` compares a Drive read-back with the local file after undoing Drive's markdown escapes.

## Limits

- Yahoo quotes are delayed and unofficial; a quote older than 4 days is flagged STALE QUOTE. CNH and CSI 300 fall back
  to CNY=X and the Shanghai Composite when Yahoo returns one bar.
- OI day-on-day change needs a prior stored row, so it starts from the second run.
- DTCC holds US-reported trades only, with capped notionals on block trades: totals are floors and a sample.
- DTCC publishes the full-day file of a UTC day at about 00:15 UTC on the next day, after the 06:52 SGT build. Since
  11 Nov 2026 a build after 21:00 UTC reads the day that is ending from the intraday files (every file must arrive,
  sixteen at a time), prints "UTC day to HH:MMZ, from the intraday files" on the Latest line, marks those rows as a part day in
  the history files and replaces them with the full-day file at the next build. If the intraday read fails, the
  pack falls back to the last full day and says so. Checked against the full-day files of 9 and 10 Nov: same
  strikes, prints and summaries; the 06:52 build holds about 99.6% of the day's option trades.
- JFSA rows carry QuiVad's register snapshot date, not the filing date; ASIC is aggregate per stock, T+4 or so.
- Base-call share is a demand-for-calls proxy, not a risk reversal. Real 25-delta risk reversals need LSEG.
- Section J (26 Nov 2026): Trading Economics prints levels to 0.01 and only a day and month change, so for SGS, IGB,
  INDOGB, MGS, ThaiGB, TGB, RPGB and HKGB the 3d and 1w columns fill from the pack's own history (first full 1w on
  Wed 2 Dec). The official curves (MOF, ECOS, ChinaMoney) are curve yields, not benchmark bonds, so compare changes
  across sources, not levels. DTCC swaps are a US-reported sample: a row with n<3 is marked thin. A day read from the
  intraday files is re-read from the full-day file at the next build. Sites tried and not usable from the cloud:
  investing.com (403), worldgovernmentbonds (API refuses outside origins), CNBC (403), stooq (reset), ThaiBMA
  (Cloudflare), BIX Malaysia (unreachable), BNM/BOT/BSP/BI RSS (403 or none).
