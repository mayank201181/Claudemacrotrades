# Claudemacrotrades — Macro Desk

Private dashboard for the daily Macro Takeaways digests (Fable 5.1 and Opus 5.5): themes by date,
and the trade books (entered trades with live marks; tested-but-not-entered ideas with shadow outcomes).

- `site/` — static dashboard (Vercel project `macro-desk`), Supabase email login, reads only the `dash_*` RPCs.
- `supabase/functions/_shared/parse.ts` — deterministic parsers for the digest HTML and the `trade_book_current` ledger.
- `supabase/functions/dash-ingest` — stores raw payloads in `dash.raw` and parses them into the `dash` tables.
- `supabase/functions/dash-mark` — hourly (pg_cron `dash-mark-hourly`): Yahoo bars, live R per open trade,
  forward outcomes of every tested idea in ATR(20) units.
- `supabase/migrations/` — the `dash` schema (in `macro-state-db`; never touches the routines' own tables).
- `docs/ingest_routine.md` — the daily ingest routine (09:20 and 12:20 SGT).

No trade or theme data lives in this repository (it is public); it all sits in Supabase behind the login.
