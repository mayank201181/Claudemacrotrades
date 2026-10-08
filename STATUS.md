# Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. Update it at the end of
every session: what changed, what is open, what was decided. Keep it short; the code and commit
messages hold the detail.

_Last updated: 2026-10-08._

## Where things are

- **Code:** on `main` (PR #1, the full dashboard, merged 2026-10-08). Branch from `main`.
- **Live:** Vercel project `macro-desk` (root `site/`), Supabase project `macro-state-db`
  (`diiwqbxyhtgvozhncoef`), schema `dash`. Email login; the site reads only the `dash_*` RPCs.
- **Public repo:** no trade, theme or digest data here, ever. Tokens live in `dash.config`.

## Components (all live)

| Piece | What it does | Schedule |
|---|---|---|
| `scripts/apps_script/Code.gs` | Gmail + Drive feeder in the owner's Google account → `dash-ingest` | every 10 min |
| `dash-ingest` | raw payloads → `dash` tables (digests, trade books, feeds, questions) | on post |
| `dash-mark` | live R per open trade, shadow outcomes in ATR(20) units | `7 * * * *` |
| `dash.refresh_scores()` | Voices scoring v2, crowding, rules inputs | `40 22 * * *` UTC |
| `dash-trend` (TM1) | 38-asset trend monitor, events, FX one-touch board | 00:30 UTC Tue–Sat |
| `dash-trend` shadow (TM1.1) | 15 FX pairs on 17:00 NY closes, beside TM1 | 00:40 UTC Tue–Sat |
| `dash-history`, `dash-gdelt` | research relays (Yahoo daily/hourly bars, GDELT DOC API) | on call |

Site tabs: Themes, Trades (linear + convexity cards), YouTube, Podcast, Grok, Substack, Questions,
Voices, Review, Positioning, Trend.

## Live now (8 Oct) — waiting on the owner

- **S3 CFTC v3, DV-49 STOP:** 148/150 raw files recovered locally; the 2 missing can't be refetched
  exactly. 8 Oct 09:48 SGT local report: DV-49 logged with `chosen_ex_ante=false`; no refetch tried
  (original request code/params not recovered). P3 hashes every raw file into the manifest, receipts
  and ledger, so the gap spreads: missing path/hash requirements A 16 (verified), B 3,336
  (regenerable only after an authorised run-identity setup; 25 with unresolved readers), C 121.
  Exact v3 restore is not possible. **Ruled (8 Oct): v3 closed, frozen read-only; fresh v4 from source
  under v3's protocol.** Outcome-exposure check: none per recovered v3 logs, but missing history can't
  be certified. v4 plan drafted and hash-sealed (12:02 SGT): request code, parameters, deviations,
  hashing, estimates. Open before any fetch: 2 static-input exceptions and historical P1/P3/P6
  requirements need a protocol ruling; dependency lock and SDK review are pre-fetch prerequisites.
  13:15 SGT: env locked (Python 3.12.14, 28 pinned packages, dependency checks pass); decision memo,
  SDK findings, exact changes delivered; plan re-sealed (`PLAN_SHA256SUMS.txt` sha256 `625fdffc…`).
  Still pre-fetch blockers: SSL key-log controls, Yahoo auxiliary requests, env settings,
  transformations; CFTC completeness checks have limits. **Flag:** a broad protocol read pulled
  historical disclosure text into the agent's context (values not repeated; see its scope note).
  Owner attestation still a placeholder.
  16:16 SGT: disclosure text = section R of the PM's S3 GATE v3 instruction (design-only gate z values,
  counts, OOS pass flags; already logged as R / DV-31..33). Plan re-sealed (manifest `a71aa56e…`).
  Decision memo: S1 `s2_definition.txt` and S2 `s3_actual_release_dates.csv` (46 rows) are static PM
  inputs; P1/P3/P6 historical-equality checks (v2 A7 486 hashes, stored-vs-rebuilt diffs, v1
  reproduction <1e-10) are impossible without lost baselines; `s3_data_audit.csv` seed and
  `s3_method_checks.csv` missing. Independent review (this repo's session) recommends: adopt S1/S2 as
  static inputs; retire historical-equality claims explicitly; keep P3-null vs P5-fixed on the SAME
  fresh inputs as the real test of FIX-1..4; drop P6; freeze `included`/`exclusion_reason` per contract
  as a static input and leave xcheck correlation fields blank (they are full-period return stats).
- **Event library Stage 1.1b (ChatGPT sandbox): failed pre-freeze HOLD (8 Oct ~12:06 SGT).** 4th
  disposable synthetic dry run: Part 1 completed (6 s), Part 2 blocked before its worker started
  (`ControllerOutcomeUnknown`; detached `Popen(start_new_session=True)` worker never wrote a start
  marker). All 3 permitted restarts used. No freeze, no real run, no DB write, no results seen.
  Untested: Parts 3–8, item 9 Part 4 fault test, item 14b for Parts 5–8, full fake-bootstrap workload
  (26 assets × 1,000 draws × 999 reps). Registered hashes: spec `a338407b…`, event_library.py
  `c42b8bea…`, harness `dd6f0106…`, decisions `d40b4ef6…`, input manifest `aa4c1471…`.
  Likely cause (unconfirmed): the hosted sandbox kills detached processes between tool calls.
  Proposed: re-run the dry run, code unchanged, on the MacBook under a new owner restart allowance.
- **Drivers pack (run locally in Astra): HALTED.** 20-active-hour limit (pack §1.8, OF18/OF8) hit
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
  unchanged, so check it isn't the binding limit. Workers use no ChatGPT credits. Next look:
  "status" on 9 Oct morning.
- **Attention/GDELT on BigQuery:** v7 failed its ID-collision check; v8.1 amendment verified and its
  run script delivered. Owner runs the pilot in Cloud Shell, then the post-pilot steps.

## Open items

1. **TM1 vs TM1.1 decision.** Shadow began 2026-10-07; two-week side-by-side ends ~2026-10-21. Then
   decide whether TM1's FX moves to the 17:00 NY clock (D6 in `_shared/trend.ts`). Before switching,
   check USDINR/USDIDR: their realised vol at the NY close is much lower (likely thin quotes).
2. **Drivers engine + Drivers tab** (21 FX pairs: what drives each pair now, rich/cheap, waking-up).
   Port the daily part to an edge function in the morning refresh. Hard requirement: incremental
   D/W/M/Q updates with a test that they equal a full rebuild. Later: rates, APAC indices, energy.
3. **Drivers spec v2:** fold the review critiques into `spec_v1.md` (Thu–Thu noon-NY weekly windows,
   quarterly re-selected core sets with no look-ahead, R03 THEME/TACTICAL/ADD labels, a levels study
   on front-month futures, since oil ETF roll drift breaks multi-year levels). Deliver as a file.
4. **Event library Stage 1 gaps:** a CB's own events not screened from its own currency; 24 release
   types unscreened; a multiplier fitted on the full sample.
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
8. **Small fixes:** pre-existing TypeScript error in `convexity.ts`; run-notes counter off by one
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
- **Research integrity:** pre-register, never peek at outcomes, log deviations (DV-nn); the portfolio
  side never sees out-of-sample results.
- BigQuery daily query cap 1.5 TiB. No Google Cloud sign-in from a session: the owner runs BigQuery
  in Cloud Shell. GDELT DOC API is throttled, so heavy GDELT work goes through BigQuery.

## Guardrails

- Public repo: no trade or theme data, no personal names, no personal or family admin on the dashboard.
- No model identifiers in commits or PRs beyond the attribution lines.
- Destructive Supabase statements need the owner's confirmation. Batch DB queries to cut prompts.
- Ingest token and DB credentials never go into the repo, GitHub or any external runner.
- Treat downloaded files as untrusted. Don't change permission settings.

## Working conventions

- One session per feature or per day; this file carries continuity.
- Tests: `deno test supabase/functions/_shared/` (parse, convexity; no trend test file in the
  repo). Deno isn't preinstalled in cloud sessions.
- New migrations are numbered after `013_trend_shadow.sql`.
