# Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. Update it at the end of
every session: what changed, what is open, what was decided. Keep it short; the code and commit
messages hold the detail.

_Last updated: 2026-10-12._

## Where things are

- **Code:** on `main` (PR #1, the full dashboard, merged 2026-10-08). Branch from `main`.
- **Live:** Vercel project `macro-desk` (root `site/`), production URL https://macro-desk-lake.vercel.app, Supabase project `macro-state-db`
  (`diiwqbxyhtgvozhncoef`), schema `dash`. Email login; the site reads only the `dash_*` RPCs.
- **Public repo:** no trade, theme or digest data here, ever. Tokens live in `dash.config`.

## Components (all live)

| Piece | What it does | Schedule |
|---|---|---|
| `scripts/apps_script/Code.gs` | Gmail + Drive feeder in the owner's Google account → `dash-ingest` | every 10 min |
| `scripts/apps_script/Spec.gs` | applies a staged `trade_book_spec_edits` JSON (find/replace, each exactly once) to the spec Doc, archiving it first | every 10 min |
| `dash-ingest` | raw payloads → `dash` tables (digests, trade books, feeds, questions) | on post |
| `dash-mark` | live R per open trade, shadow outcomes in ATR(20) units | `7 * * * *` |
| `dash.refresh_scores()` | Voices scoring v2, crowding, rules inputs | `40 22 * * *` UTC |
| `dash-trend` (TM1) | 38-asset trend monitor, events, FX one-touch board | 00:30 UTC Tue–Sat |
| `dash-trend` shadow (TM1.1) | 15 FX pairs on 17:00 NY closes, beside TM1 | 00:40 UTC Tue–Sat |
| `dash.put_drivers(jsonb)` | loads one snapshot of the FX drivers engine (`dash-ingest` kind `drivers`, or `execute_sql`); the Drivers tab reads `dash_drivers`, the digests `dash.drivers_brief()` | on post (daily refresh parked: no part passed the holdout) |
| `dash-history`, `dash-gdelt` | research relays (Yahoo daily/hourly bars, GDELT DOC API) | on call |
| `scripts/gdelt/attention.py` | media-attention table (GDELT GKG hourly sample, DOC API, Wikipedia views) → project files `gdelt/` | daily routine, before 07:15 SGT |
| `016_event_library.sql` | event library in the database: `dash.event_cell` / `event_cal` (plus type and asset tables), loaders `dash.put_event_cells` / `put_event_cal` (compact text from `scripts/event_library/to_sql.py`); the digests read `dash.event_brief()` and `dash.event_lookup(release, asset)` | on load (library rebuilt by hand; calendar to Jan 2027) |

Site tabs: Themes, Trades (linear + convexity cards), YouTube, Podcast, Grok, Substack, Questions,
Voices, Review, Positioning, Trend, Drivers.

## Live now (8 Oct) — waiting on the owner

- **S3 CFTC: v4 CLOSED (9 Oct); v5 run 3 SEALED as a STOP package at step 15 (12 Oct).** v4 (fresh run from source
  under v3's protocol, run `20261008T102913Z`): P1–P3 PASS; protocol stop at P4 on 9 Oct 17:14 SGT
  because PR-5 could not be resolved for 20 Nikkei (NKD tff) test-period rows (NKD missing from 16 of
  18 W3 files, so a 2019 delayed-report anchor reached into 2022–23). No results computed; package
  sealed in `final_package_v4`, with two fixes noted for v5 (P4 timing split, compiler legacy-identity
  bug). v5 (11 Oct, run by Claude on the Mac over Remote Control; owner ruling "go": drop NKD from the
  test period only, `chosen_ex_ante=false`): pre-run fixes DV-87..92 (compiler index, P4 split per
  contract with a chunked compile, legacy identity, acquisition reuse by hash), each proven
  output-identical on the frozen v4 P3 tree. Run 1 (`20261011T140000Z`): P1–P5 PASS, STOP at step 13
  (paired P3-vs-P5 comparison) on a comparator contract defect; repaired and re-executed (DV-93/94).
  Run 2 (`20261011T200000Z`): steps 00–12 PASS, STOP at step 13 again on four classes of unmapped
  P3→P5 differences (DV-96): two process defects (positioning-table key field, horizon key format),
  fixed; two permission gaps in the P4 predictor (Friday timing counts for four contracts, row
  presence on Brent T4 arrays), fixed generally and granted by the owner after the fact on 12 Oct
  (DV-97, declared re-execution). Codes and counts only; no outcome value was seen by anyone.
  Run 3 (`20261012T072000Z`): launched 12 Oct 07:16Z from P1 after two pre-P1 stops (DV-98 verifier
  history table, DV-99 journal numbering) and one step-02 receipt re-pin (DV-100). Steps 00–14 PASS,
  including the step 13 paired comparison at 11:44Z under the sealed comparator. Step 15 (P5
  independent checks) could not finish in the day: 4,339 bounded check calls at about 3.4 min each
  (23 s of kernel time, the rest per-call preflight that re-verifies the growing receipt chain), about
  250 h; 27 were receipted at seal time. Under the owner's 12 Oct finish-today order the run was
  sealed at 13:33Z as a STOP package (`final_package_v5`, final status INCOMPLETE, 51 deviation
  receipts DV-51..101) with the gap stated in the receipt (DV-101; the per-call preflight cost is the
  open process defect). P7 not run, gate decision absent, Phase 3 locked. No outcome value was
  computed or seen by anyone.
  Next: fix the P5-checks per-call cost (batch tasks per bounded call, verify receipts incrementally;
  DV-101), then resume at step 15 on run 3's frozen P5 outputs when the owner authorises it; nothing
  before step 15 needs re-running. The detached check loop on the Mac is to be stopped (one `kill`
  of the runner process).
- **Event library Stage 1.1b synthetic dry run (restart harness): DROPPED 12 Oct 2026 03:43Z.**
  Attempts dry_01–dry_04 failed (Part 2 controller path check in the ChatGPT sandbox; on the MacBook
  Part 5 supervisor interruption, Part 5 coverage comparator, Part 6 archive-blob comparator, the last
  two fixed as DV_CHECKPOINT_COVERAGE_BASELINE_IDENTICAL and DV_CHECKPOINT_ARCHIVE_BLOB_PROJECTION).
  dry_05 (4th restart, 11 Oct 12:07Z) passed Parts 1–4 but Part 5 crawled at one unit per 60 s slice
  on a host without SHA extensions and was recorded FAILED 12 Oct 00:03Z when a move of its workspace
  onto tmpfs tripped the harness's same-device check (DV_RESUME_DRY05_ON_FASTER_HOST). Owner raised the
  restart cap 4 → 5 (PM_20261012_owner_local_fifth_restart). Attempt 6 was staged twice in cloud
  containers (trees rebuilt from the 8 Oct zip, sha aaf6be8e, ledger 3,624 rows unchanged) but never
  launched: the cloud threads' safety check refused to execute the package. Owner then dropped the
  rehearsal (project chat, 12 Oct 03:43Z) for the plain build below. 5th allowance unused; handoff kept
  in project files `eventday_handoff/`. No freeze, no real run, no outcome values seen. Supersedes PR #8.
- **Event library (plain build, cloud): BUILT 12 Oct 2026 05:11Z.** One Python pipeline, no harness,
  run end to end on real data in a cloud thread. Results in project files `event_library/`:
  `LIBRARY.md` (the lookup: multiplier, 95% CI, significance, variance ratio, 1w/1m vol add-on per
  event type × asset), `SUMMARY.md` (coverage, counts, checks, decisions D1–D8), the 9 `event_*`
  CSVs in the Stage 1.1b schema, `README.md` (how to read and rebuild), `pipeline/`, `calendar/`,
  `data/`. Calendar: 5,395 rows, 69 types (48 scored; elections exclusion-only) from official pages:
  BLS/BEA/Census/Fed/Treasury/EIA for the US, every G10 and 9 Asian central banks, ABS, StatCan,
  ONS, Eurostat, NBS, GACC, ESRI, BoJ Tankan, KOSTAT, BoK, DGBAS for ex-US releases, OPEC and
  elections from the spec's frozen lists. Not sourced: EZ_HICP_FLASH, JP_CPI (too few rows to score;
  still used as exclusions); partial: CN_TRADE from 2020-09, UK_CPI from 2015-04, CN_CPI from
  2015-01, CN_GDP from 2015-01, CN_PMI_NBS from 2015-01. Prices: 29 series; FX = Fed H.10 noon NY
  (IDR/PHP = ECB 14:15 CET, CNH = onshore CNY proxy), UST 2y/10y = H.15 CMT,
  SPX/N225/KOSPI/gold/Brent = Yahoo, VIX/GVZ/OVX = CBOE; Yahoo FX daily closes rejected after a
  clock check (early-bar snapshot, Asian pairs unusable). Method follows the spec where it matters
  (sigma60 units, weekday-matched ±63-session controls, clean and all samples, 1d/2d windows, 11
  periods incl. vol/VIX regimes and IS/OOS, bootstrap 5,000/999, BH by family, EB shrinkage,
  placebo, fixed IS/OOS split 2022-04-01, 21 variants); departures logged as D1–D8. Counts: 268,207
  moves, 52,801 cells, 351 main-family cells, 62 significant at q<0.10. Checks: placebo_fake_cells
  ok; placebo_strict_pairs ok; oos_fixed_split ok; variants_headline warn. Nothing written to
  Supabase (CSVs are COPY-ready; owner's call). Outcome values deliberately not quoted here or in
  chat. Mac visits: 0.
- **Event library into both digests: ONE FILE FOR THE OWNER TO RUN (12 Oct 2026 14:25Z).** Owner said
  yes (13:54Z) to trade ideas near a scheduled release citing how the asset typically moves on it.
  Route: the library lives in the database, not in the prompt. `016_event_library.sql` (tables
  `dash.event_type`, `event_asset`, `event_cell`, `event_cal`; loaders; `dash.event_brief()` = how to
  read it, the types and assets covered, the releases due in 21 days with their significant cells;
  `dash.event_lookup(release, asset)` = any cell, plain words accepted) was applied from the cloud
  thread, but every further database write there raised an approval prompt, so the rest is one
  tested file, project files `event_library/016_event_library_and_rule.sql`: the migration again
  (rerun-safe), 743 cells (period ALL, clean sample, 1d and 2d windows), 219 calendar rows (Jul 2026
  to 8 Jan 2027, 10 rule-derived dates flagged), rule R05 (scope both, source owner, in force on run,
  review due 23 Nov 2026) and a final check that must print ok = true on every line. Ran clean twice
  on a local Postgres 16. Once run, both digests read the brief from the next 07:15 SGT run; until
  then `dash.event_brief()` answers "nothing loaded yet" and R05 does not exist. `revert R05` removes
  it later. Not in the repo: the cells and calendar. Mac visits: 1 (to run the file).
- **Drivers pack (local on MacBook, monitored by Claude): COMPLETE, package built 9 Oct.** Earlier history: 20-active-hour limit (pack §1.8, OF18/OF8) hit
  8 Oct 14:00 SGT; ST5 placebo 5,235/9,405 units, logged `DEV-20261008T060022225612Z-35907` plus
  pair exclusions; incomplete ST5 pairs excluded, incomplete L/T families NOT_EVALUATED, freeze
  before holdout. ST5 advanced to ST6 at 14:06; all 3 workers stopped ~14:41 SGT on an ST6
  unit-registry error. No ETA. Astra's earlier "verified all three workers running" (sent after the
  stop) was wrong. Next (8 Oct ~17:15 SGT): diagnosis only, no restart; owner approves any fix and
  restart as a logged deviation.
  17:13 SGT diagnosis: root cause = ST6 registry cached before the cutoff exclusions (crash before any
  unit was claimed). Proposed cache-only repair NOT approved yet: the cutoff excluded 21/21 pairs, so
  ST6 would calibrate on an empty cohort, and 0/12 L/T families marked NOT_EVALUATED contradicts the
  rule. Holdout caveat stands (ThaiBMA preview, `DEV-20261007T104126211568Z-29335`). Open decision:
  extend ST5 to finish placebo units as an outcome-blind logged deviation vs a fresh run with
  pair-by-pair scheduling. Earlier "don't extend ST5" assumed partial exclusions only.
  17:30 SGT: cause = draw-major scheduling across pairs (every pair also lacks 54 non-placebo units);
  ST5 10,677/15,989 units. No pre-registered all-pairs-excluded rule. Second raw preview (MAS DEV)
  also on record in `data_exposure.json`. Two shared units failed terminally. Recommended to owner:
  option (a), extend ST5 by up to 8 active h with pair-priority ordering, shift later cutoffs
  (L/T, 26/30/31 h) by the extension used, one diagnosed retry per failed shared unit, standing
  authority for process fixes as logged deviations. No defensible ST12 ETA.
  18:07 SGT: owner approved; Astra confirms amendment logged, repairs validated, 3 workers running,
  8 h ST5 cap, auto ST6–ST12, stop if no pair completes. 18:11 SGT check: pair-by-pair order yes,
  later limits shifted yes. 19:56 SGT: final diagnostic hit the date-access guard in all 21 pairs;
  guard correct (warmup dates presented as evaluation dates), diagnostic date range fixed and logged,
  guard byte-identical. 20:30 SGT: ST5 extension cap raised 8 → 24 active h (final, completion-only
  deviation, before any results); later limits shift by actual use; independent 48 h wall cap
  unchanged, so check it isn't the binding limit. Workers use no ChatGPT credits.
  ~21:00 SGT: monitoring moved from Astra to Claude (read-only on `~/drvpack`; Astra fallback only).
  9 Oct 03:58 SGT: ST5 done (all runnable units); extension closed after 9.7/24 h
  (`DEV-20261008T195758580044Z-5665`). 20/21 pairs eligible; AUDUSD excluded (7 ST5 units failed)
  per §1.8. ST6–ST7 done. 07:25 SGT: ST8 72/485, 3 workers alive, projected finish ~36.4 active h,
  inside the 48 h wall cap (18:00 SGT 9 Oct).
  9 Oct: ST8 done; ST9 closed at its pre-registered active-hour cutoff. ST12 packaging stalled three
  times on process issues, each fixed on the Mac as a packaging-only deviation: OF11 split timeout
  (`DEV-20261009T071944640666Z-84648`); non-UTF-8 raw CSVs and the csv field limit
  (`DEV-20261009T122543090708Z-11347`, `DEV-20261009T122543114953Z-11347`); Part01 over the size cap.
  For the last one the owner approved excluding snapshot copies (path and sha256 kept in the
  manifest) and limiting Part01 to the core ledgers (`DEV-20261009T132750628010Z-33237`,
  `DEV-20261009T132750652688Z-33237`). ~22:00 SGT: final package of 20 parts, hash-verified
  (target was 12 or fewer; nothing dropped). Run STOPPED cleanly. Results not yet opened.
  Next: owner decides how to review the package.
- **Attention/GDELT: live from 12 Oct 2026, no BigQuery.** The v8.1 Cloud Shell pilot was dropped (owner, 12 Oct:
  finish today, rough is fine). `scripts/gdelt/attention.py` builds a daily media-attention table for 109 topics
  (countries, central banks and currencies, rates, equity indices, energy and commodities, macro themes) from
  GDELT's free files: the GKG English edition sampled hourly since 1 Oct 2025 (Singapore days, primary gauge),
  the DOC 2.0 API since Jan 2024 (all languages, UTC days; its index has gaps since mid-Sept 2026, so only days
  with a full index count) and English Wikipedia pageviews as a public-attention check. Score: log coverage share
  against the previous 90 days (z90, x90, 7d-vs-28d trend); flags SPIKE (z >= 2 and x90 >= 1.5), ELEVATED, QUIET.
  Outputs in the project files under `gdelt/` (`attention_latest.md` / `.json`, `attention_daily.csv`, `topics.json`,
  README). A daily routine refreshes it before the 07:15 SGT digests and writes a Drive copy
  `gdelt_attention_latest` in the digest folder. Both Macro Takeaways digests read that copy through dashboard
  rule R04 (source owner, in force since 12 Oct 2026 08:45Z; `revert R04` in a reply to the weekly review email
  removes it).
  Not in the repo: topic list and data.

## Open items

1. **TM1 vs TM1.1 decision.** Shadow began 2026-10-07; two-week side-by-side ends ~2026-10-21. Then
   decide whether TM1's FX moves to the 17:00 NY clock (D6 in `_shared/trend.ts`). Before switching,
   check USDINR/USDIDR: their realised vol at the NY close is much lower (likely thin quotes).
2. **Drivers engine + Drivers tab** (21 FX pairs: what drives each pair now, rich/cheap, waking-up).
   12 Oct: holdout rerun r2 on a cloud VM. The holdout stage closed at 00:38 UTC; verdicts: what's
   driving now FAIL, waking-up FAIL, rich/cheap UNTESTED, levels and tactical DEV-only (metadata
   only in this file; the run archive and its report stay on the owner's Mac). The production-spec
   stage then stopped by itself at 11:35 UTC (its levels phase does not skip the sealed levels
   ledger). The owner closed the run as incomplete the same evening ("Close it", 12:32 UTC): the
   whole run root archived to the Mac (22.9 GB, sha256 verified), VM deleted 14:11 UTC; no sealed
   package. Drivers tab live
   (`015_drivers.sql`, `site/drivers.js`): one snapshot per as-of date, loaded as JSON through
   `dash.put_drivers`; only parts with a passing holdout verdict are shown, the rest listed with
   their verdict; the digests read `dash.drivers_brief()` under a rule in force (see Decisions).
   Loaded 12 Oct: one snapshot as of 2024-09-30 (the dev end), 20 pairs; no part passed, so the tab
   shows the verdict table and no per-pair read, and the digests get the same. Parked: the daily
   refresh (a launchd job posting to `dash-ingest` kind `drivers`, token from the Mac keychain,
   never from the repo) is moot while no part is in production. A revival means rerunning the
   production-spec and packaging stages on the Mac from the archive with the levels phase skipped
   under option B, then fixing what the holdout failed. Later: rates, APAC indices, energy.
3. **Drivers spec v2:** fold the review critiques into `spec_v1.md` (Thu–Thu noon-NY weekly windows,
   quarterly re-selected core sets with no look-ahead, R03 THEME/TACTICAL/ADD labels, a levels study
   on front-month futures, since oil ETF roll drift breaks multi-year levels). Deliver as a file.
4. **Event library follow-ups (plain build, 12 Oct):** owner to run project file
   `event_library/016_event_library_and_rule.sql` in the Supabase SQL editor (loads the cells and
   calendar, puts R05 in force; see Live now); source the release types still missing
   (EZ_HICP_FLASH, JP_CPI (too few rows to score; still used as exclusions); partial: CN_TRADE from
   2020-09, UK_CPI from 2015-04, CN_CPI from 2015-01, CN_GDP from 2015-01, CN_PMI_NBS from 2015-01);
   extend the database calendar before it runs out on 8 Jan 2027 (rebuild, rerun `to_sql.py`, load
   with the same file). The old Stage 1 gaps
   (own-CB days unscreened, 24 types unscreened, full-sample fit) are closed by the plain build:
   controls exclude every relevant event including the asset's own central bank, all 69 types
   screen, and IS/OOS cells sit beside the full-sample ones.
5. **Data-source registry:** 345 sources, mostly unverified; smoke-test from the dashboard servers.
6. **DB check (proposed, never run):** do the digest model's ideas start from a thesis or from price?
7. **Data-source fragility in `dash-trend`:**
   - MOF `jgbcme_all.csv` intermittently 404s → retried, then falls back to stored closes in
     `dash.trend_px`. Watch fetch notes on the JGB10Y row.
   - Yahoo late Adj Close on the six commodity ETFs at 00:30 UTC → patched from Close × last factor.
   - CSI300 on 510300.SS ETF (STALE over China holidays); USDCNH built from CNH=X hourly bars, history
     only from Dec 2023, so its vol percentile is short-sample until ~Feb 2027.
   - NatGas/WTI 200d stretch differs from S2: likely futures vs ETF proxies, unconfirmed.
   - D2: no second price source yet, so the cross-check is always `XCHECK_NA`.
   - FRED fetch from inside Postgres failed (HTTP/2); retest from an edge function.
8. **Digest completeness: primary-source pages (10 Oct 2026).** Both Macro Takeaways runs on Sat 10 Oct
   ran the completeness sweep (Opus footer: 14 searches, window to 07:53 SGT, "weekend: no Asia
   session") and both missed the RBI's overnight rupee package (OMC dollar window, 20% FERR, $5m
   no-underlying limit, rebooking ban). Cause: the sweep is search-only, and no outlet had written the
   story up by ~07:30 SGT (first pickups ~08:40 SGT); only rbi.org.in had it. Fix live: section A0
   of `completeness_sweep_spec` fetches 14 central-bank, ministry and regulator listing pages directly
   every day, weekends included, with a stale-page fallback and a footer count. Text is in project file
   `notes/completeness_sweep_A0_primary_sources.txt`. The Drive connector can't edit the Doc body and
   `Spec.gs` only handles `trade_book_spec`, so the owner pasted A0 into the doc above "A. CHECKLIST" (verified 10 Oct 12:35 SGT; first run Sun 11 Oct 07:15 SGT, check its "Primary pages: F/14" footer).
   No routine edit needed (Opus prompt is at 65,388 of 65,536 bytes). Note: cached readers (Exa)
   still showed the RBI page without the 10 Oct items hours later, so A0 must use a live fetch.
9. **Small fixes:** pre-existing TypeScript error in `convexity.ts`; run-notes counter off by one
   (27 vs 28 rows), fix at the next conclusions write; clean up quarantined local S3 outcome files;
   the msd-owner list and event-library retry (from ~5 Oct, details thin).

## Questions still unanswered

- The office "~90%" figure: daily or weekly changes, and were FX series among its 9 drivers?
  (Partial: "on changes, 20y, 9 drivers".)
- Sign-off on the Asia list and the FX clock (noon NY vs 17:00 NY).
- Go-ahead to register free data keys and run the ALFRED pull.
- R03 defaults: early entries full size, 10-session flip lookback, stops on daily closes?
- What Astra's 20-year dataset actually holds.
- Taken as yes without an explicit reply: post-2014 carry rates; event-library defaults.

## Decisions on record

- **12 Oct 2026, event library into the digests (owner: yes, 13:54Z).** Both digests read
  `dash.event_brief()` under rule R05 (scope both, source owner, review due 23 Nov 2026) and cite the
  cell on any trade card whose catalyst or horizon holds a library release: multiplier, CI,
  significance, typical move in sigma; non-significant or n<15 cells are "no significant read" and
  never sized on; option cards compare implied vol with the add-on. Delivered as one SQL file for
  the owner to run, because every database write from a cloud thread raised its own approval prompt.
- **12 Oct 2026, Drivers Stage 2–3 (owner: finish today, suboptimal is fine).** The Drivers tab shows
  only parts whose holdout verdict passed; "what's driving now" is the only part expected to pass
  (review of 10 Oct). The digests read the engine through one rule put in force the same day,
  revertible like any rule. The daily refresh is deferred, not dropped.
- **12 Oct 2026, Drivers close-out.** Holdout r2 passed no part and the production-spec stage failed
  on the VM. Closed incomplete on the owner's word rather than patched and rerun (no long runs after
  12 Oct). The dev-end snapshot stands as the final one; the engine stays out of production and out
  of the digests' per-pair reads until a rerun passes a part.

- Trend Monitor design choices D1–D6: header of `supabase/functions/_shared/trend.ts`.
- Ingest moved from a Claude routine to Apps Script because auto-mode blocks posting email content
  to an external endpoint (`docs/ingest_routine.md`).
- Voices v2: one voice per person, market calls apart from conviction-1 forecasts, no look-ahead
  (`007_scores_v2.sql`).
- Rules proposed in Review go in force at the next Sunday 20:00 SGT unless opposed (notify, then apply).
- **Trade-idea framework:** thesis first, 2-week to 2-month horizon; price stop beats thesis
  invalidation; spot when a stop level is clear, options otherwise; tactical trades in a separate
  shadow book until ~30 signals are positive after costs; universe of 21 pairs; levels on daily
  closes; drivers fitted on changes and tested out of sample.
- **Trade gate (8 Oct 2026):** the (c) expectancy gate is EV ≥ +0.30R only. The r/r ≥ 1.0 floor and
  the 75% cap on p are dropped (a p above 75% must name its basis and is scored apart). The same goes
  for R01 convexity cards (premium ≤ 50% and p ≤ 75% gone; the 10% premium minimum stays). Book caps
  (10 thematic, 5 tactical) and test (g), the 60-day veto block, are retired; with no meaningful stop an
  R01 option card (premium = 1R) satisfies test (b). The owner
  updates `trade_book_spec` on Drive for both books; the Trades tab labels the old floor's rejections
  as history.
- **Thin edge (9 Oct 2026, spec v12):** test (c) is EV > 0, no longer ≥ +0.3R. Cards between 0 and +0.3R
  are tagged "thin edge" and scored apart (SCORECARD, Trades tab). After 30 thin-edge closes, the weekly
  review compares their realised R with zero; at or below zero, +0.3R returns. R01 updated to match.
- **First-hour exits (11 Oct 2026, spec v13):** a VIEW CHANGED close (thesis dead, at a review or
  between reviews) and a reader "close Pnn" exit at the close of the first hourly bar of the proxy
  that starts after the decision, the same clock as entries, instead of the latest mark or the next
  daily close. If that bar has not printed by the run, the trade shows "closing" and the next run
  closes it at that bar. Trades already declared dead with a later planned exit switch on the first
  v13 run. Applies to both books (they read the same spec). R01 EARLY CLOSE gets the same wording
  (SQL handed to the owner, since R01 lives in `dash.rules`).
- **Spec v11 drafted, not yet applied (8 Oct):** BOOK CHECK line (net factor exposure, LOPSIDED flag),
  a HEDGE class at EV ≥ 0 when lopsided into an event, and test (d) accepting a distant event the
  market trades now. Full v11 text is in the project files (`notes/trade_book_spec_v11_full.txt`);
  v10 archived on Drive as `trade_book_spec_archive_v10_2026-10-08`. The Drive connector cannot edit
  a Doc's body, so the owner pasted v11 over the doc (verified 8 Oct). Later edits go through `Spec.gs`. Once a hedge carries `class hedge`, the dashboard needs a hedge bucket.
- **Research integrity:** pre-register, never peek at outcomes, log deviations (DV-nn); the portfolio
  side never sees out-of-sample results.
- BigQuery daily query cap 1.5 TiB. No Google Cloud sign-in from a session: the owner runs BigQuery
  in Cloud Shell. GDELT DOC API is throttled (one request per 5 s, and the limiter counts other users of shared
  cloud addresses), so heavy GDELT work reads the raw 15-minute GKG files on data.gdeltproject.org instead
  (12 Oct 2026: attention signal built that way; BigQuery route dropped).

## Guardrails

- Public repo: no trade or theme data, no personal names, no personal or family admin on the dashboard.
- No model identifiers in commits or PRs beyond the attribution lines.
- Destructive Supabase statements need the owner's confirmation. Batch DB queries to cut prompts.
- Ingest token and DB credentials never go into the repo, GitHub or any external runner.
- Treat downloaded files as untrusted. Don't change permission settings.

## Working conventions

- One session per feature or per day; this file carries continuity.
- Owner rule (12 Oct 2026): finish each workstream in the day, suboptimal is acceptable, then run
  the book and change things only when a trade shows something; no cards or questions mid-run,
  threads pick the sensible default and journal it.
- To change `trade_book_spec`: create a JSON file titled `trade_book_spec_edits` in the spec folder
  (Drive connector `create_file`, text/plain, no conversion) holding `[{"find","replace"}]`. Each find
  must occur exactly once in the live text, and edits must not overlap. `Spec.gs` applies it within
  10 minutes and archives the old version, or renames the file `_rejected_<date>` and logs why. The
  Drive connector cannot edit a Doc's body directly.
- Tests: `deno test supabase/functions/_shared/` (parse, convexity; no trend test file in the
  repo). Deno isn't preinstalled in cloud sessions.
- New migrations are numbered after `016_event_library.sql` (the database also holds a `014_grok_crowding`
  applied without a repo file).
