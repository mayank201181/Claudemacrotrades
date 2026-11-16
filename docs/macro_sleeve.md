# MACRO sleeve: a three-month paper book (16 Nov 2026)

Owner's ask (voice note, 16 Nov 2026): the Macro Takeaways trade list runs on the morning's incremental information
with a horizon of two weeks to a month; add a second category of roughly three-month macro trades on a cross-country
fundamentals base, and see how they do. He said "go for all eight" to the design below the same evening.

## What the record said first

- The book's THEMATIC class is a catalyst class, not a horizon class (spec v8: no time stop, held while the view
  holds, review at the dated catalyst or every 10 sessions). Realised holds on the Fable book: 22 closed thematic cards
  since 5 Oct, 6 days on average when stopped, 10 when the target printed, 10 when closed as view changed; 9 of the
  22 ended at the 10-session review. The horizon is set by the review cadence, the stop width and the morning-news
  origination, not by the class.
- Replay (`scripts/macro_sleeve/replay.sql`, read-only): every view the Fable trade test considered since 5 Oct, as a
  (proxy, direction) arrival after 15 quiet days, held as a three-month trade with a 3 ATR(20) stop on a daily close
  and a 6 ATR target on a touch. Over 125 arrivals the mark-to-market is a small loss, with far more stops than
  targets and nothing matured on the full horizon yet. Counts and R are in the private project file
  `notes/macro_sleeve_replay_16nov2026.md`, never here. The lesson: a three-month book cannot be the daily views held
  longer; it has to originate from the fundamentals base.
- No point-in-time fundamentals backtest: the fundamentals pack exists only since 7 Nov 2026 and most of its sources
  publish no vintages, so a real test would be a long run outside the current phase. The replay above is the cheap,
  honest version; re-run it when the October arrivals reach 63 bars (early January 2027).

## The eight decisions (all yes, 16 Nov 2026)

1. A separate MACRO sleeve, class `macro`, its own scorecard, never in the daily book's cum R.
2. Originated weekly, not daily: the scheduled task "Macro sleeve weekly (Sun 19:31 SGT)"
   (`trig_01KqhJzihoFqnGDo7tWb2qi4`, a fresh session each week, prompt in `scripts/macro_sleeve/task_prompt.txt`),
   after the fundamentals pack (Sun 18:41). The daily Takeaways may confirm, weaken or flag a signpost, never
   originate (rule R24, `supabase/rules/R24_macro_sleeve.sql`, proposed 16 Nov, applies Sun 22 Nov 20:00 SGT).
3. Base: the regime scorecard, section 1b of the fundamentals pack (`scripts/fundpack/fundpack.py`, `scorecard()`):
   per economy growth, inflation, policy, external and credit scores from -2 to +2, and `lean` = inflation + growth -
   policy (pressure on the next central-bank move). Cross-country differences in lean, growth and external are the
   candidates. Descriptive and untested, like the rest of the pack.
4. Inputs: what is already wired (fundamentals pack, market pack sections A, C, D and H, prediction-market odds,
   attention table, trend monitor, event library, the daily book for conflicts). Fiscal, balance of payments, exchange
   flow data beyond KRW and EIA/OPEC data are added only when a card shows the need; no paid flows feed.
5. Card mechanics: a universe asset as the proxy; stop 3 ATR(20) (estimated from closes as 1.25 x the 20-day mean
   absolute daily change, highs and lows not being available) or a nearer named fundamental level; target at least two
   stops away; horizon 60 to 90 sessions with an expiry date; review every four weeks or at a signpost; two falsifiable
   SIGNPOSTS on every card; gate EV > 0 with p0 printed; one direction per asset inside the sleeve; a card opposite to a
   daily card is allowed and says so.
6. Universe: the 38 assets of the trend monitor (`dash.trend_state`, `dash.trend_px`).
7. Paper from the start, at most six open, at most three new a week; decision at 20 closed cards or 31 Aug 2027
   (fold into the book as a class, keep as paper, or stop). With three-month holds that is about a year.
8. Backtest: no fundamentals backtest; the replay above instead.

## How it runs

- Sunday 19:31 SGT: the task reads the Drive files (`fund_pack_latest`, `market_pack_latest`, `predmkt_latest`,
  `gdelt_attention_latest`, last week's `macro_sleeve_current`) and four read-only queries (trend state, 130 days of
  trend closes, `dash.event_brief()`, the open daily cards), marks last week's cards on daily closes (stop and target
  on a close, closes only), reviews fired signposts, tests candidates and writes a new `macro_sleeve_current` to the
  pipeline folder `1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm` (Drive cannot replace content, so one copy per week under the
  same title; readers take the latest modifiedTime). Pending cards fill at Monday's close.
- Monday to Saturday: under R24 the Takeaways reads the latest file at the evidence step and prints a MACRO SLEEVE
  block after the trade book: one line per card with today's mark and a verdict (CONFIRMED, UNCHANGED, WEAKENED,
  SIGNPOST FIRED). It never writes, closes or scores a sleeve card.
- The sleeve is not in `dash.trades`, so `dash-mark` and the dashboard do not see it. If the 20-card decision folds
  it into the book, the cards move into the trade book file as a class and the ingest, mark and site code follow.
- The task stores no connectors of its own; a run uses the project's settings (the same route as the weekly review).
  Its model is the project default. It posts nothing; check Drive for the file's date.

## Files

| File | What |
|---|---|
| `scripts/macro_sleeve/task_prompt.txt` | the task's prompt, as stored (no keys) |
| `scripts/macro_sleeve/replay.sql` | the three-month replay of tested views (read-only, counts and R only) |
| `scripts/fundpack/fundpack.py` | section 1b regime scorecard (`scorecard()`), HOW TO USE item 6 |
| `supabase/rules/R24_macro_sleeve.sql` | the daily run's read-and-print rule |
| project files `notes/macro_sleeve_proposal_16nov2026.md`, `notes/macro_sleeve_replay_16nov2026.md` | the proposal and the private replay result |
