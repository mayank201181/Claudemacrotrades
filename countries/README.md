# Countries page data (28 Nov 2026)

Twenty economies, free official sources only, for the app's Countries page (top-down view, not a trade signal).
Source map, parsers and fetch program are from the Astra A29 study (ChatGPT, 28 Nov 2026), checked by us:
22 endpoints re-fetched by hand and the full fetch re-run from the cloud matched Astra's snapshot on all 526 lines
both runs returned.

- `source_map.csv`: 809 requested lines, 567 PASS (the fetch reads PASS rows only).
- `fetch_all.py`: refreshes every PASS row; a failed line keeps its last good value (`retained`).
  Our changes: FRED limited to two requests at a time and sent the default User-Agent (its CSV endpoint stalls
  any other); modules live in `mod/`.
- `slim.py`: cuts the snapshot to `countries.json` for the page.
- `seed_snapshot.json`: the first `--previous` when the data branch does not exist yet.
- Schedule: `.github/workflows/countries.yml`, 05:40 SGT daily and on demand; output on branch `countries-data`.

Local run: `python3 countries/fetch_all.py --out /tmp/snap.json --previous countries/seed_snapshot.json`
(about 80 s from a cloud container; RBNZ, the Philippine statistics site, StatCan's advance GDP page and CBO answer 403 there).

Added 28 Nov 2026 evening (owner's ask): block `credit` (Credit and housing), 7 BIS quarterly lines per economy
(private and household credit % GDP, private credit growth y/y, credit-to-GDP gap, debt service ratio, real and nominal
house prices y/y; 125 PASS, Taiwan and some others not published by BIS), module `mod/bis_credit.py`. Percentiles for
1, 2, 5 and 10 years (`percentile` in the snapshot, `pcts` in countries.json); the page has a window switch.
