# Claudemacrotrades — Macro Desk

Private dashboard for the daily Macro Takeaways digests (Fable 5.1 and Opus 5.5): themes by date,
the trade books (entered trades with live marks; tested-but-not-entered ideas with shadow outcomes),
the YouTube, Podcast, Grok and Substack digests by date and source, and three scoring tabs:
Questions (the odds engine's calls, graded with lead time and against an always-NO baseline), Voices (each
speaker's directional calls graded 2 weeks and 2 months later, plus crowding by series) and Review (rules
proposed and in force, weekly lessons).

- `site/` — static dashboard (Vercel project `macro-desk`), Supabase email login, reads only the `dash_*` RPCs.
- `supabase/functions/_shared/parse.ts` — deterministic parsers for the digest HTML and the `trade_book_current` ledger,
  plus the allow-list HTML sanitizer and the personal-admin scrub applied to everything shown.
- `supabase/functions/_shared/feeds.ts` — parser for the YouTube / Podcast / Grok digests and the market sections of
  the Email Digest (the Substack tab; personal sections are dropped and the raw email is never stored).
- `supabase/functions/_shared/questions.ts` — parser for the odds engine as printed (yellow tags, footer question
  list, NEW SCENARIO and CROWD EXTREME blocks, SCORECARD) and for the `brief_state_current` doc.
- `supabase/functions/dash-ingest` — stores raw payloads in `dash.raw` and parses them into the `dash` tables.
- `supabase/functions/dash-mark` — hourly (pg_cron `dash-mark-hourly`): Yahoo bars, live R per open trade,
  forward outcomes of every tested idea in ATR(20) units.
- `supabase/migrations/006_scores.sql` — question scoring views, the stance-call tables, and the rules/lessons store
  behind the weekly review: proposals go in force at the next Sunday 20:00 SGT window unless the owner opposes them,
  and the pipelines read them through `dash.rules_in_force()`.
- `supabase/migrations/007_scores_v2.sql` — Voices scoring as the site shows it (`dash.refresh_scores()`, daily
  pg_cron `dash-scores-daily`): one voice per person (curated aliases, near-matches listed for review), market calls
  apart from conviction-1 forecasts, a view followed per market group (2y/10y yields, S&P/Nasdaq/VIX) and direction,
  graded at 2 weeks when first seen, on a change of direction, or 15+ days after the last 2-week grade (60 days for
  2 months), each on its own clock and only for the horizons it was stated for; a "logged live" scope rebuilt
  without backfilled entries; crowding per scope with ONE-SIDED (5+ voices, 80%+ on one side) and EXTREME (also
  top-decile participation); and the rules and weekly-review inputs that read the same figures.
- `supabase/migrations/` — the `dash` schema (in `macro-state-db`; never touches the routines' own tables).
- `scripts/apps_script/Code.gs` — feeder that runs in the owner's Google account every 10 minutes and posts new
  emails and trade books to `dash-ingest`. The Gmail searches come from `dash.config.feeds`, so a new tab is a
  config change, not a script change (set `TOKEN`, run `setup` once after pasting a new version).

No trade or theme data lives in this repository (it is public); it all sits in Supabase behind the login.
