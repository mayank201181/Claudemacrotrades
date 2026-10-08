# Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. Update it at the end of
every session: what changed, what is open, what was decided. Keep it short; the code and commit
messages hold the detail.

_Last updated: 2026-10-08._

## Where things are

- **Code:** PR #1 (`claude/macro-dashboard` → `main`), draft, 27 commits, +8k lines, mergeable, Vercel
  preview green. Not merged yet. Work on a branch cut from `claude/macro-dashboard`, not from `main`
  (`main` holds only the initial commit).
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

## Open items

1. **TM1 vs TM1.1 decision.** Shadow began 2026-10-07; two-week side-by-side ends ~2026-10-21. Then
   decide whether TM1's FX moves to the 17:00 NY clock (D6 in `_shared/trend.ts`).
2. **Data-source fragility in `dash-trend`:**
   - MOF `jgbcme_all.csv` intermittently 404s → retried, then falls back to stored closes in
     `dash.trend_px`. Watch fetch notes on the JGB10Y row.
   - Yahoo late Adj Close on the six commodity ETFs at 00:30 UTC → patched from Close × last factor.
   - CSI300 on 510300.SS ETF; USDCNH built from CNH=X hourly bars (Yahoo gives one daily bar).
   - D2: no second price source yet, so the cross-check is always `XCHECK_NA`.
3. **Merge PR #1** once the owner is happy (merging asks first, per `.claude/settings.json`).
4. _Chat-only items from the 2026-10-05→07 session (to-dos, known bugs, design decisions not in
   commits): not yet transcribed. Paste them here._

## Decisions on record

- Trend Monitor design choices D1–D6: header of `supabase/functions/_shared/trend.ts`.
- Ingest moved from a Claude routine to Apps Script because auto-mode blocks posting email content
  to an external endpoint (`docs/ingest_routine.md`).
- Voices v2: one voice per person, market calls apart from conviction-1 forecasts, no look-ahead
  (`007_scores_v2.sql`).
- Rules proposed in Review go in force at the next Sunday 20:00 SGT unless opposed.

## Working conventions

- One session per feature or per day; this file carries continuity.
- Tests: `deno test supabase/functions/_shared/` (parse, convexity; no trend test file in the
  repo). Deno isn't preinstalled in cloud sessions.
- New migrations are numbered after `013_trend_shadow.sql`.
