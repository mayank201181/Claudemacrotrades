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
| D FX options and NDFs | DTCC public swap repository (CFTC FX cumulative files) | option notional vs 20d and base-call share per pair, NDF volume, large strikes expiring within 14 days near spot; cited as "DTCC sample" |
| E headlines | Google News queries plus FT, Nikkei Asia, CNBC, WSJ, MarketWatch RSS, last 24h | leads for the completeness sweep only |

Usage: `python3 -I marketpack.py --out DIR [--sql posbuild.sql] [--skip D,E]`. Prints
`ok: <path> <bytes> · A n · B n · D <date> · E n`. Every section fails soft. History files in DIR:
`oi_history.csv` (120 days), `dtcc_daily.csv`, `dtcc_strikes.csv`.

`verify_drive.py` compares a Drive read-back with the local file after undoing Drive's markdown escapes.

## Limits

- Yahoo quotes are delayed and unofficial; a quote older than 4 days is flagged STALE QUOTE. CNH and CSI 300 fall back
  to CNY=X and the Shanghai Composite when Yahoo returns one bar.
- OI day-on-day change needs a prior stored row, so it starts from the second run.
- DTCC holds US-reported trades only, with capped notionals on block trades: totals are floors and a sample.
- Base-call share is a demand-for-calls proxy, not a risk reversal. Real 25-delta risk reversals need LSEG.
