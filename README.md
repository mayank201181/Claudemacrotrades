# Claudemacrotrades — Macro Desk

Private dashboard for the daily Macro Takeaways digests (Fable 5.1 and Opus 5.5): themes by date,
the trade books (entered trades with live marks; tested-but-not-entered ideas with shadow outcomes),
and the YouTube, Podcast, Grok and Substack digests by date and source.

- `site/` — static dashboard (Vercel project `macro-desk`), Supabase email login, reads only the `dash_*` RPCs.
- `supabase/functions/_shared/parse.ts` — deterministic parsers for the digest HTML and the `trade_book_current` ledger,
  plus the allow-list HTML sanitizer and the personal-admin scrub applied to everything shown.
- `supabase/functions/_shared/feeds.ts` — parser for the YouTube / Podcast / Grok digests and the market sections of
  the Email Digest (the Substack tab; personal sections are dropped and the raw email is never stored).
- `supabase/functions/dash-ingest` — stores raw payloads in `dash.raw` and parses them into the `dash` tables.
- `supabase/functions/dash-mark` — hourly (pg_cron `dash-mark-hourly`): Yahoo bars, live R per open trade,
  forward outcomes of every tested idea in ATR(20) units.
- `supabase/migrations/` — the `dash` schema (in `macro-state-db`; never touches the routines' own tables).
- `scripts/apps_script/Code.gs` — feeder that runs in the owner's Google account every 10 minutes and posts new
  emails and trade books to `dash-ingest`. The Gmail searches come from `dash.config.feeds`, so a new tab is a
  config change, not a script change (set `TOKEN`, run `setup` once after pasting a new version).

No trade or theme data lives in this repository (it is public); it all sits in Supabase behind the login.
