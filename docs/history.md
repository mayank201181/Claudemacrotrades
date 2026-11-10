# Macro Desk — history

Dated narrative moved out of `STATUS.md` on 10 Nov 2026 so that the hand-over file stays short. Nothing was
rewritten: part 1 is `STATUS.md` exactly as it stood on `main` at commit daadf5d (5 Nov 2026); part 2 lists the
STATUS entries that sat in pull requests which were never merged. New dated entries go at the top of part 0.

## Part 0 — entries since 10 Nov 2026 (newest first)

### 10 Nov 2026: split-run shadow test set up; Gemini source name (pull requests #63 and #64)

Decision 7 of the workflow review, the last of the eleven to be built. The question: could a cheaper model read
every copy of every feed and hand the deciding model one evidence file, each claim once with the copies that carry
it, without losing anything the digest rests on? The test runs the reader beside the live Takeaways on the mornings
of 12 to 16 Nov and audits the two against each other; the owner gets one yes/no on Mon 16 Nov. Design, files and
limits are in `docs/shadow_test.md`.

How it was built. The reader is the old Opus Macro Takeaways task (switched off on 31 Oct), renamed, moved to a
cheaper model and given a new prompt, because a thread cannot give a new scheduled task the Gmail and Drive
connectors; the old prompt is kept in project files. The prompt is built from parts by
`scripts/shadow_test/build_prompt.py` and carries its own script and reader brief, which a run copies out of its own
prompt at the start. The audit runs in its own project thread, woken at 09:05 SGT on the five mornings.

Two dry runs on the evening of 10 Nov replayed that morning's inputs by landing time. The first took about 15
minutes and US$7 at list prices, read 17 inputs into 1,290 claims in a file a quarter of the inputs' size, and its
audit found no claim lost or degraded behind 29 judged items. It also found the method's own faults, the main one
being that the Takeaways email carries only its top section in the plain-text part: a reader or auditor that asks
Gmail for plain text sees a fifth of the digest and nothing says so. Version 2 of the prompt reads full content,
sweeps the inbox a fourth time at 08:10 so that a late input the live run still picks up is not counted against the
reader, and tightens the scripted checks. The second dry run, on version 2 with a six-minute wait test added by
its note, took 19.5 minutes and about US$7, read the same 17 inputs into 1,347 claims, proved the 270-second wait and
its repeat branch in the fired environment, and passed the patched audit steps: 69 claims behind 33 judged items,
none lost or degraded. Its script could check 855 claims against inputs saved to disk; the other 492 came from small
emails read in the conversation, which the figure check cannot see.

The Gemini copies of the YouTube, Podcast and Email digests had been stored in `dash.feeds` under the source
`claude` since their first day, because `feedSource()` knew no "[Gemini]" tag. It returns `gemini` now
(`feeds.test.ts`), the site shows the name, and `dash-ingest` went live as v10, a stub pinned to `main` commit
08a5516 (rollback 9fcaed6). The 86 rows stored before that keep the old name until the owner runs
`019_gemini_source.sql`.

Lessons. A scheduled task made in Cowork that starts a fresh session each run can be renamed, rescheduled, switched
back on and given another model and prompt from a thread; only its connectors cannot be changed. `fire_trigger`
takes a note that arrives after the prompt, so a prompt can define a dry run. Read digest emails with FULL_CONTENT.
Mac visits for the whole workflow build: 0, one tap on a decision card; one visit is still planned for the pieces
only the owner can do.

### 10 Nov 2026: workflow review, the eleven approved changes built (pull requests #61 and #62)

Background: the weekly Claude allowance ran out early on Sun 8 Nov with the monthly extra-usage cap already spent, so
no Macro Takeaways was sent on 8 or 9 Nov or on the morning of 10 Nov, and the watchdog and the three data feeders
died with it (their task status still read "succeeded", because a delivered wake counts as success). On the owner's
card the Takeaways task moved to the Fable 5.2 model and a catch-up ran at 11:38 SGT. The same thread ("Improve macro
takeaways workflow for trades") reviewed the whole workflow and gave him a private document with eleven yes/no
decisions; he approved all eleven at 12:25 SGT, raised the cap, and left the choice of model per stage to the thread.
What was built that day, in the order of the decisions:

1. Usage cap: raised by the owner.
2. Fill rule (R17, proposed): one R is the risk the card planned, REF to stop, written once as a `risk` key; an
   adverse fill that has used more than half of that distance is void; the one card whose gapped fill had been
   scored on a few ticks of risk is restated when the rule goes in force. `parse.ts` keeps the key, `oneR()` in
   `marks.ts` uses it, and cards filled before the rule keep the risk they were booked on. `dash-ingest` v9 and
   `dash-mark` v7 went live as stubs pinned to `main` commit 9fcaed6 and were each called once through `pg_net`
   (both replied ok).
3. Morning check outside Claude: `Alert.gs` (Gmail search for the day's "MACRO TAKEAWAYS [Fable" email, one alert
   mail if it is missing; tested with `alert_test.js`) waits for the owner to install it; the dashboard shows a red
   banner on every tab when the day's Fable digest row is still absent at 08:20 SGT.
4. Implied vol from DTCC option prints: the market pack's section D ends with a table per pair of ATM by tenor,
   25-delta risk reversal and butterfly and the forward drift, backed out of reported premiums (a US-reported sample
   at T-1, pooled over five days where a day is thin; `test_marketpack_iv.py`). Section E gained the Fed's speech
   feed and a Fed-watcher press feed. A large expiring strike more than 12% from spot is now left out of the strike
   list (a 0.01 strike had been printed as a magnet).
5. Option twin (R18, proposed): a TWIN line on each cash FX card names the option that expresses the same view;
   `twin.ts` prices it on the smile at the card's fill and `dash-mark` marks it every hour, records a touch, the
   settlement at the cut or a close with the card, and writes `twin_*` keys into the card's meta. The linear card
   stays the book of record. Trial to 13 Dec or ten finished pairs.
6. Expression table (R19, proposed): up to four expressions of a live view, the best one carded, the others
   shadowed with an "alt Pnn" tag so the weekly review can compare card and alternates. No code.
7. Split-run shadow test: not built in these two pull requests.
8. Cheaper model for the Claude digests: the three paused Fable digest tasks were renamed "[Sonnet 5.5 test]", set
   to Sonnet 5.5, and are fired by hand with a note that sends the output to a Drive test folder, on the mornings of
   11 to 13 Nov beside the production copies. Notes and the pass rule are in project files
   `notes/model_tests_nov2026/`.
9. Feeders: one runner, `scripts/feeders/feeder.py`, builds a feed (one retry, nine-minute cap), stages the file in
   the session's scratchpad and prints a Drive `create_file` call whose content is a file reference, so the model
   never reads or retypes the file; `confirm` compares the size Drive stored; every run adds a line to
   `feeders/status.csv`. A new thread on Haiku 5.5 at low effort runs it from three scheduled tasks (attention table
   05:45, odds 06:20, market pack 06:52 SGT). Each feed was built and uploaded once from the building thread and
   once by the Haiku thread; every Drive size equalled the built file; a run costs about 5 US cents against a wake
   of 250 to 320 thousand tokens in the old Fable and Opus threads. The three old tasks are switched off, not
   deleted. The fundamentals pack stays in its Opus thread.
10. Weekly review: the prompt is built by `scripts/weekly_review/build_prompt.py` from fixed prose and one cuts
    query, and must end with up to two rule proposals or "none, because". Two dry runs on 10 Nov (no email, no
    writes); the second drafted two proposals. See `docs/weekly_review.md`.
11. Housekeeping: the Takeaways subject, the watchdog and the site read "Fable 5.2"; the feeder prompts carry the
    06:33 start in place of the stale 07:15 to 07:45 times; uploads go by file reference. GDELT attention: the
    cloud address is refused by the Wikipedia per-article route and by the DOC API on most requests, so Wikipedia
    views now come 50 articles a request from the action API (85,327 day values compared with the stored
    per-article series, no difference) with a per-article fallback for an article whose newest day is still empty;
    and the table had been printing each topic's last Wikipedia or DOC reading whatever its age, so a reading now
    prints only when it is at most one day (Wikipedia) or two days (DOC) older than the media day. That changed 60
    Wikipedia cells and removed 23 stale DOC readings on the day; the media columns were identical for all 109
    topics before and after. Left for the owner: connectors per task, the two API keys in the YouTube prompts, two
    subject matches in tasks outside Claude. Not done: the Gemini source label.

Lessons for the next session. A scheduled task bound to a thread keeps that thread's model and only that thread can
change its prompt, but any thread can switch it off. A task that starts a new thread at each run cannot be changed
by a thread at all, and `create_trigger` takes no connectors in this organisation. A function stub pinned to a
commit must be re-pinned after every merge that touches it. The data problems the review's dry runs found are
listed in STATUS Open items 12. Mac visits: 0, one tap on a decision card; one visit is planned for the pieces only
the owner can do.

### 10 Nov 2026: database part of the audit applied

The owner ran the one statement (project file `notes/audit_10nov2026_db.sql`) in the Supabase SQL editor at
13:52 SGT, after the approval prompt raised by the database connector was cancelled by his app twice. Checked by
read afterwards: R13 status `reverted`; no Opus card left open (three closed as `closed-view`, exit reason "book
ended", booked on 2 Nov, the first hourly bar after the 31 Oct decision); ten Opus questions retired, none open;
all 114 stored Email Digest subjects neutral and the `feeds_neutral_subject` trigger in place; the
`cron-run-log-prune` job scheduled (Monday 03:17 SGT) and no run-log row older than 14 days; the
`dash-trend-shadow-daily` job gone. This is what `018_audit_housekeeping.sql` holds, plus the one-off data changes.
Lesson: a destructive statement sent through the connector asks the owner to confirm, and his app cannot answer
that prompt; give him the tested file for the SQL editor instead.

- **10 Nov 2026, audit follow-ups (owner: "Yes to all" on the fourteen review items; pull request #58).**
  Trend monitor: the month of TM1.1 shadow runs (25 runs from 7 Oct) was read pair by pair against TM1. For the G10
  pairs and KRW, SGD and TWD the two disagreed on 1 to 10 of 24 days and on most of those the New York clock simply
  showed TM1's next-day state a day early; USDCNH matched on every run; USDIDR went stale on 5 of 24 shadow runs and
  its level sat up to 3% from TM1's, USDINR once. So the main run now takes FX closes at 17:00 New York for twelve
  pairs, keeps USDCNH on its hourly-built series and USDINR and USDIDR on Yahoo daily bars, and falls back to daily
  bars with a note when a New York close cannot be built. Stub redeployed as v8 pinned to `main` commit d334277
  (which also ends the pin to a commit that was only on a side branch); a dry run through `pg_net` returned OK,
  38 of 38 assets, no stale, no fetch errors, both report blocks present, 48 s. Dashboard: stop flags labelled
  hourly or daily and the Grok source names, live with the merge. Scheduled tasks deleted: the question-hunt verdict
  task, Macro Desk ingest (its prompt held the ingest token), Daily Grok Consolidated, Daily Slack Digest, MT
  Newswires check, CFTC v5 self-check, New Claude features check; prompts of four kept in project files
  `notes/deleted_tasks_10nov2026/`. Thirteen superseded pull requests closed. `dash-probe` replaced by a stub that
  answers 410. Project folder `eventday_handoff/` (96 MB, rehearsal dropped 12 Oct) deleted. Not possible from a
  thread: deleting branches (the git proxy refuses it) and deleting the "TEMP merge test" task. The database part
  (R13, Opus cards and questions, Email Digest subjects, cron log prune, shadow job) is one statement that timed
  out waiting for the owner's approval; see STATUS Open items 2. Correction to the audit: the stored raw Email
  Digest emails it reported were not found on re-check, so there was nothing to delete. Mac visits: 0.
- **10 Nov 2026, project audit (thread "Audit project for broken and stale parts").** `main` had drifted from what
  runs: fifteen pull requests from 8 Oct to 10 Nov were never merged, among them code that was already live
  (dash-mark v6 with the hourly-close stop flag, the Grok feed sources in `feeds.ts`, the Grok Bot attachment
  handling in `Code.gs`, market pack section G and the fundamentals pack) and rule texts R08, R14 and R16. This
  commit brings those files onto `main` unchanged, so the repo again matches the deployed functions and the running
  scripts (checked: `marketpack.py` and `fundpack.py` byte-identical to the running copies; deployed dash-mark source
  read and matched; `feeds.ts` and `Code.gs` matched by behaviour, since `dash.feeds` holds `crowding` and `grokbot`
  rows). The two small `site/app.js` changes in those pull requests were never deployed and are left out; they wait
  for the owner. `STATUS.md` was cut to the current state. Mac visits: 0.

## Part 2 — STATUS entries from pull requests that were never merged

Summaries only; the full text is in each pull request. Position names and results are left out (public repo).

- **PR #8 and #9 (8-11 Oct):** event library dry-run history and the CFTC v4 amendment; both superseded by the
  12 Oct entries in part 1.
- **PR #14 (8 Oct):** Grok Bot routines. Console daily 06:50 SGT and a crowding check (Sundays 17:00 SGT and before
  tier-1 events), both set up by the owner in Grok Bot on 10 Oct; the Grok tab shows sources `grokbot` and `crowding`
  (`014_grok_crowding.sql`, `feeds.ts`). Docs: `docs/grok_console_routine.md`, `docs/grok_crowding_routine.md`,
  `docs/completeness_sweep_spec.md`.
- **PR #19 (10-11 Oct):** workstream audit (project file `notes/workstream_audit_10oct2026.md`). Grok Bot mails its
  report as an HTML attachment, so `Code.gs` uses the attachment as the body and mails one inline copy for the
  digests; `015_grokbot_source.sql` (run by the owner 10 Oct) labels it `grokbot`. Thesis-versus-price check, first
  read: idea titles are catalyst-led, the idea pool leans against the prior 20-day move, carded trades skew with it.
- **PR #20 (10 Oct):** news and data connectors. MT Newswires trialled then closed (19 Oct); LSEG on hold until
  compliance clears a firm licence; Bigdata.com connected with a zero balance; Daloopa skipped.
- **PR #31 (17 Oct):** moving the Fable YouTube and Podcast digests to a second claude.ai account was parked by the
  owner; the handover pack stays in project files `handover_fable_digests/`.
- **PR #33 (22 and 30 Oct):** rules R08 (a lean opposite to an open card is first a review of that card; in force
  25 Oct) and R14 (never long and short the same underlying at once; in force 1 Nov). Texts in `supabase/rules/`.
  Still to do: fold the spec's TACTICAL WASHOUT sentence into the next spec version so the Doc and the rules agree.
- **PR #34 (23 Oct):** exit basis, spec v15: target on a touch of an hourly high or low, stop on an hourly close.
  The spec had already reached v14 on 16 Oct by a direct Drive edit. `017_exit_basis.sql` run by the owner 23 Oct
  08:47Z, dash-mark v6 deployed 08:51Z. Owner visits: 1 (the SQL paste).
- **PR #37 (25 Oct):** trade book retention, spec v16: cap stays at 60,000 characters, T lines two days, LOG 14
  days, closed blocks compressed (`docs/trade_book_retention.md`). Incident the same day: a book reconstructed from
  memory after a context reset was uploaded and ingested, then replaced by the real one and cleaned up by one SQL
  the owner ran. Lesson, now a working convention: never write Drive or database content from memory.
- **PR #39 (26 Oct):** the Opus Macro Takeaways was switched off from the owner's account on 23 Oct, re-enabled on
  his choice on 26 Oct with a catch-up run; the Opus book has a 24-25 Oct gap.
- **PR #44 (29 Oct):** Podwise (about S$360 a month) against Nvidia Nemotron 3.5 Transcribe (about US$0.002 per
  audio minute, no speaker labels, cannot fetch YouTube audio from the cloud). Owner chose to leave Podwise as is.
  An unused DeepInfra key was shared in chat: rotate it if it is ever reused.
- **PR #45 (31 Oct):** Opus versus Fable month-end review. Owner chose Fable; the Opus Macro Takeaways was disabled
  31 Oct about 09:55Z (the Opus YouTube and Podcast digests keep running as feeds). Flow check stays in Fable, judged
  again at the end of November. Figures: project files `notes/opus_vs_fable_review_31oct2026.md`.
- **PR #49 (2 Nov):** rule R16, KRW cards print a KRW FLOWS line (foreign KOSPI net, hedge read, retail overseas
  buying, NPS hedge news); a card resting on exporter conversion alone against two equity channels is thin edge at
  best. In force 8 Nov. Text `supabase/rules/R16_krw_equity_flows.sql`.
- **PR #55 (6 Nov):** weekly fundamentals pack (`scripts/fundpack/`, `docs/fundpack.md`): IMF, OECD, Eurostat, BIS
  and FRED series for 20 G10 and Asia economies, built Sundays 18:41 SGT, copied into the market pack as section G.
  A slow anchor, never a trigger.
- **PR #56 (10 Nov):** no Macro Takeaways on 8 and 9 Nov or on the morning of 10 Nov (weekly Claude allowance and
  the monthly extra-usage cap both spent; the watchdog and the feeders died with it, and a feeder's task status
  still read "succeeded", so check file dates, not task status). The Takeaways task moved to the Fable 5.2 model on
  the owner's card with the prompt unchanged; the subject tag still says "[Fable 5.1]" until one coordinated
  relabel. A review of the whole Takeaways workflow went to the owner with eleven yes/no decisions.

## Part 1 — STATUS.md as it stood on 5 Nov 2026 (verbatim)

### (old title) Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. Update it at the end of
every session: what changed, what is open, what was decided. Keep it short; the code and commit
messages hold the detail.

_Last updated: 2026-11-03._

### Where things are

- **Code:** on `main` (PR #1, the full dashboard, merged 2026-10-08). Branch from `main`.
- **Live:** Vercel project `macro-desk` (root `site/`), production URL https://macro-desk-lake.vercel.app, Supabase project `macro-state-db`
  (`diiwqbxyhtgvozhncoef`), schema `dash`. Email login; the site reads only the `dash_*` RPCs.
- **Public repo:** no trade, theme or digest data here, ever. Tokens live in `dash.config`.

### Components (all live)

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
| `scripts/predmkt/predmkt.py` | prediction-market odds (Polymarket Gamma + Kalshi public APIs, no keys): macro contracts, data ladders with implied medians → project files `predmkt/` and Drive `predmkt_latest`; digests read it under R12 | daily 06:38 SGT (scheduled task "Prediction-market odds daily refresh") |
| `scripts/marketpack/marketpack.py` | MARKET PACK for the Fable Macro Takeaways (stdlib, public sources, no keys): A price action on 54 assets (sigma moves, trend vs MA50/200, ext/ATR, z10, run, rv ratio, breakout and BUILD-UP flags), B futures volume vs 20d and open interest with the price/OI read (17 roots, Yahoo), C positioning build-up SQL over the 83 msd `.POS_` series (`posbuild.sql`, run by the digest), D DTCC FX options and NDFs (notional vs 20d, base-call share, large strikes near expiry), E RSS headline leads → project files `marketpack/` and Drive `market_pack_latest`; the takeaways read it in STEP 2 item 1 | daily 06:52 SGT (scheduled task "Market pack for Fable Macro Takeaways") |
| `016_event_library.sql` | event library in the database: `dash.event_cell` / `event_cal` (plus type and asset tables), loaders `dash.put_event_cells` / `put_event_cal` (compact text from `scripts/event_library/to_sql.py`); the digests read `dash.event_brief()` and `dash.event_lookup(release, asset)` | on load (library rebuilt by hand; calendar to Jan 2027) |

Site tabs: Themes, Trades (linear + convexity cards), YouTube, Podcast, Grok, Substack, Questions,
Voices, Review, Positioning, Trend, Drivers.

### Live now (8 Oct) — waiting on the owner

- **Fable Macro Takeaways missed again 5 Nov; start moved to 06:33 SGT, second reads cut, watchdog added.** The 06:59 run's
  cloud container disconnected at 07:06 SGT (infra, not the prompt or credits); a Fable catch-up fired 08:22 and landed
  09:54. Even with no waits a run takes ~85-90 min, so 06:58 cannot make 08:15. Live from Fri 6 Nov: cron 06:33 SGT; every
  input kept (owner, 5 Nov: "incorporate everything"; a brief cut of DESK INPUT and EconVitals was reverted); LATE PICKUP
  before STEP 3 and again before B10 folds in anything that landed after the start (5 Nov: all inputs were in by 07:10
  except ChatGPT MT 07:23, Gemini MT 07:43, ChatGPT energy brief 08:04). Prompt 65,508 bytes, live copy byte-identical
  (backup `notes/fable_mt_prompt_restored_5nov2026.txt`). New daily 07:20 SGT watchdog
  (scheduled task "Fable MT watchdog 07:20") refires the run only if its session is dead. Open: check 6 Nov arrival;
  if still late, speed up the run, never cut inputs. Mac visits: 0.
- **Fable Macro Takeaways must land by 08:15 SGT (4 Nov 2026, owner).** 4 Nov run failed at 08:34 SGT on Fable usage
  credits (account cap; ~$64 a run), no email. Root cause of lateness since 1 Nov: the 07:30 start plus the wait-until-07:45
  gate (before: 07:15 start, ~08:15-08:25 landing). Fix live from Thu 5 Nov: cron 06:58 SGT, START GATE "never wait", one
  re-search for Gemini Email and the ChatGPT/Gemini takeaways before STEP 3, and the stance payload and trade book run as
  background sub-agents. Prompt 65,515 of 65,536 bytes, live copy byte-identical (backups
  `notes/fable_mt_prompt_{before,after}_gate_4nov2026.txt`). Open: today's catch-up (Opus 5.5, his pick); raise the
  extra-usage cap; if 5 Nov still misses 08:15, drop some 1 Nov second reads. Mac visits: 0.
- **Late Fable Macro Takeaways, 3 Nov 2026 (thread "Fix missing Fable takeaways email").** Not a failure: the run fired
  07:40 SGT and the email landed 10:14 SGT (5 of 5 feeds), against 08:45 on 2 Nov. Time went on: feed reads to 08:17,
  stance-ledger subagent run in the foreground 08:17-08:37, trade book from 08:51, a container restart at ~09:01-09:08
  that killed the trade-book subagent (restarted 09:10, done ~09:50), accuracy gate 09:53-10:02. The 00:02Z EconVitals
  prompt edit did not touch the running session, and the 65,506-byte prompt is under the 65,536 cap. No catch-up fired (it
  would duplicate the email). Open: if Wed 4 Nov also lands after ~09:30 SGT, trim the run (run the stance ledger in the
  background, cap red-team answers); check booked for 4 Nov 09:30 SGT. Mac visits: 0.
- **EconVitals in the Fable Macro Takeaways (3 Nov 2026, thread "Add EconVitals to macro takeaways").** The owner subscribed
  to EconVitals (Jason Furman; AI-written US macro briefings, free) at his Gmail. Senders `briefings@econvitals.org`: Daily
  Briefing after the US close (~06:00-07:00 SGT; cross-asset MARKET RECAP with 1d/1w/YTD moves, Fed-implied odds, GDP
  tracker), Morning Note (~18:00 SGT; Furman opening, research picks, day-ahead consensus), data notes on US releases (~20:30
  SGT), weekly US/Europe/China briefings (Saturdays) and occasional essays. Some land outside the inbox (a label). Fable MT
  PEER TAKEAWAYS line now reads them as second reads on DESK INPUT terms: `from:briefings@econvitals.org`, newer_than:1d
  (3d on Mondays, to catch the weeklies), any label, essays skipped, cited "(EconVitals)", MARKET RECAP used to check the TAPE
  strip and Fed odds; numbers still need STEP 2 item 7 confirmation (AI-written, unreviewed). Bytes freed by dropping the
  paused Claude Email Digest subject template and timing, and 3-space indents: prompt 65,511 -> 65,506 bytes, live copy
  byte-identical (backups `notes/fable_mt_prompt_{before,after}_econvitals_3nov2026.txt`). First run with it: Wed 4 Nov
  07:30 SGT (the 3 Nov run had already fired). Mac visits: 0.
- **Market pack in the Fable Macro Takeaways (1 Nov 2026, owner "do all six", thread "Map inputs to Fable macro takeaways", Opus).**
  Audit found the takeaways' only market data was ~13 web-searched TAPE levels; themes never saw price action, positioning
  build-up or participation. Built `scripts/marketpack/` (see `docs/marketpack.md`): one stdlib script, ~3 min, writes
  `market_pack_latest.md` (~30 KB) with a HOW TO USE block the digest follows. Live: Drive `market_pack_latest` (first copy
  1 Nov 01:54Z, read back complete; Drive shows new text files to read_file_content only after ~1-2 min), daily build
  06:52 SGT in the thread's own Opus session, and the Fable Macro Takeaways prompt STEP 2 item 1 now reads the pack
  (65,502 bytes, live prompt byte-identical to the edited file; backups in project files
  `notes/fable_mt_prompt_{before,after}_marketpack_1nov2026.txt`). First digest with it: Mon 2 Nov 07:30 SGT. Clean-up in the
  same pass: R03 reverted (drivers data as of 2024-09-30), flow check kept, the paused Opus Email Digest left off (Gemini
  copy covers the 05:30-06:45 SGT newsletter window). OI day-on-day history starts 1 Nov; DTCC is US-reported trades only
  ("DTCC sample"). LSEG 25-delta risk reversals need the owner's connector sign-in; not done. Mac visits: 0.
- **Public-apis screen and disclosed shorts JP/AU (1 Nov 2026, thread "Screen public APIs for macro desk").** Screened
  ~330 entries of github.com/public-apis (finance, currency, government, open data, news, business) for risk reversals,
  participation, positioning or Asia data: no free FX vol or risk-reversal source exists there (LSEG stays the only
  route); everything else duplicates Yahoo, RSS, DESK INPUT or prediction-market feeds. Only QuiVad was new: owner said
  "wire that in, maybe of use in future". Market pack section F (keyless `quivad.com/api/positions.jsonl.gz`): most
  shorted JP names (JFSA fund positions of 0.5% or more, summed) and ASX names (ASIC aggregate, ETFs dropped), 1-week
  build-ups from `shorts_history.csv` (first read 8 Nov). HOW TO USE item 7: cite only on single-name JP/AU cards or
  themes, never for an index or FX view. No prompt change. JP register dates are QuiVad snapshot dates, not filing
  dates. Mac visits: 0.
- **Desk inputs from Gemini, ChatGPT and Grok (1 Nov 2026, same thread; owner has spare capacity in those apps).**
  The Fable Macro Takeaways PEER TAKEAWAYS line now reads every email whose subject starts "DESK INPUT" as a second read
  (prompt 65,511 bytes, verified byte-identical; backup `notes/fable_mt_prompt_after_deskinputs_1nov2026.txt`). Scheduled in
  the owner's apps (prompts in project files `notes/desk_inputs_prompts_1nov2026.md` and `notes/gemini_extra_prompts_1nov2026.md`):
  Grok crowding check now daily 06:20 SGT (subject unchanged); ChatGPT red team on open cards daily 06:15; Gemini Fed & Asia
  wire daily ~06:40 with native-language Japanese/Chinese/Korean sources; Gemini central bank document diffs daily ~06:30,
  sends only when a listed document came out; ChatGPT flows brief Saturdays 09:00; Gemini retail crowding Sundays 10:00
  (Gemini cannot pull Google Trends on a schedule, so it uses published retail data instead). Mac visits: 0.
- **Prediction-market odds in both Macro Takeaways digests (28 Oct 2026, thread "Add prediction market odds to takeaways").**
  Owner ask after the Bloomberg/Millennium story. `scripts/predmkt/predmkt.py` (stdlib, ~40 s) pulls ~45 Polymarket macro events
  (tags fed-rates, Global-Rates, economy, inflation, oil, commodities, japan, china, geopolitics, tariffs, middle-east, ukraine,
  taiwan, europe; sports/crypto/AI/local races dropped; liquidity >= $25k) and 22 Kalshi series picked from 1,957 by open interest
  (Fed decision / funds rate / cut count, CPI, core CPI, y/y, U3, payrolls, GDP, recession, ECB/BoJ/BoC/RBA, UST and DXY ranges,
  gasoline). Output: a 13 KB table `predmkt_latest.md` (p, d1/d7 in pp, 24h volume, liquidity; 'Above X' ladders with the implied
  median), `.json`, and a daily history `predmkt_daily.csv` for a later lead/lag test. Scheduled task fires 06:38 SGT into the
  thread's own session (Opus; a fresh-session routine ran on Fable and was deleted), runs the script and writes Drive
  `predmkt_latest` in the digest folder. Rule R12 (`supabase/rules/R12_prediction_markets.sql`, proposed 28 Oct 06:3xZ, applies
  Sun 1 Nov 20:00 SGT unless "oppose R12"): cite PM odds for dated catalysts, a >=80% priced outcome fails the not-already-priced
  gate unless the card rests on the residual, 'PM gap' line when PM odds differ from rates/survey-implied by >=10pp (or ladder
  median vs consensus), d7 >=15pp moves into BOOK CHECK; never raises p by itself (R03). Review due 30 Nov. Mac visits: 0.
- **Carver forecasts + FX option pricer (25 Oct 2026, owner "do both"; thread "Find open-source code for macro workflows").**
  Code done and tested on branch `claude/project-thread-e80nxd`: `scripts/fxopt/` (stdlib FX option pricer: barriers,
  touches, digitals, delta conventions, vanna-volga smile; every formula checked against QuantLib 1.44) and
  `_shared/forecast.ts` (Carver EWMAC trend at four speeds + FX carry from BIS policy rates, appended to the dash-trend
  report). Side finding: the dashboard's R01 digital / one-touch / spread maths equals QuantLib to 4e-15. Note:
  `docs/carver_and_fxopt.md`; rule text `supabase/rules/R10_carver_and_fxopt.sql`. LIVE 25 Oct ~10:00Z (owner yes on
  the decision card 09:50Z): dash-trend v7 is a one-line stub importing `dash-trend/index.ts` from this repo at
  commit 64d1f84 (rollback = same stub pinned to 2e5fd8764d324ad662422078a6511de26dac64d3); first run with the
  CARVER block Tue 27 Oct 00:30 UTC (08:30 SGT). fxopt.py on Drive (file 10Y4KxrHX6HhEShA9h85QvU6KQ5oL4Owz, superseded 26 Oct, see below, in the
  Opus folder, 20,017 bytes = repo file). R10 proposed, applies Sun 1 Nov 20:00 SGT, digests from Mon 2 Nov unless the
  owner says "oppose R10". Checked 27 Oct 00:50Z: the 27 Oct run carries the
  block (38 FORECAST lines, no fetch errors, BIS carry filled for FX). A later change to forecast.ts needs the stub
  re-pinned to the new commit.
- **17 quant libraries (@pyquantnews list) reviewed, 26 Oct 2026 (thread "Review 17 quant Python libraries").**
  Verdict: none replaces QuantLib + fxopt.py; FinancePy kept as a test-only second reference. Two gaps found and
  closed in `scripts/fxopt/`: double no-touch / double one-touch (QuantLib-exact) and reading a quoted 25d BF as a
  broker market strangle (now the default; USDJPY 3M 25d-wing premiums about 10% higher than the old reading).
  Tests pass. LIVE 26 Oct 12:11Z (owner yes on the card): Drive "fxopt.py" is now file
  1D7aDF6fO2Ckew1hyXHUuljgzouXzMxoF (23,738 bytes, read-back byte-identical); the 25 Oct copy was renamed
  fxopt_v1_25oct_superseded.py (rollback = swap the two titles). No rule change needed. Note: project files `notes/quant_libraries_review_26oct2026.md`.
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
- **Event library into both digests: LIVE, rule R05 in force since 12 Oct 2026 14:35Z.** Owner said
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
  on a local Postgres 16; the owner ran it at 14:35Z, every check line ok: 743 cells and 219
  calendar rows loaded, R05 in force, so both digests read the brief from the 13 Oct 07:15 SGT run
  on. `revert R05` removes it later. Not in the repo: the cells and calendar. Mac visits: 1 (the
  file).
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

### Open items

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
4. **Event library follow-ups (plain build, 12 Oct):** source the release types still missing
   (EZ_HICP_FLASH, JP_CPI (too few rows to score; still used as exclusions); partial: CN_TRADE from
   2020-09, UK_CPI from 2015-04, CN_CPI from 2015-01, CN_GDP from 2015-01, CN_PMI_NBS from 2015-01);
   extend the database calendar before it runs out on 8 Jan 2027 (rebuild, rerun `to_sql.py`, load
   with the same rerun-safe file `event_library/016_event_library_and_rule.sql`). The old Stage 1 gaps
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
10. **Flow check trial (Fable, 19–31 Oct 2026):** at the month-end Opus vs Fable scorecard, read the FLOW CHECK
    lines in the Fable digests (leads chosen, how many confirmed at a primary source, tests confirmed or killed)
    and decide keep, drop, or port to Opus (which needs room in that prompt, or a rule).
11. **Multi-source copies in the Fable digest (from 24 Oct 2026):** over the first few runs check the footer's
    copies-read line and the dedupe (one item per story across copies, no double sightings in the stance ledger),
    and that a day with the Fable YouTube or Podcast digest paused still runs clean. Known: no ChatGPT YouTube
    digest since 16 Oct; a Gemini copy can arrive with an empty body.
12. **Crowd asymmetry calibration (R09, both books, from the Mon 26 Oct 2026 run):** the ×0.75 payoff and ×1.5 loss
    defaults on crowd = with cards are a judgement. Check the first runs print the crowd evidence and the two EVs
    on every card and TESTED line, and that "least long" reads and spent extremes are not treated as with. The
    weekly review reads the new SCORECARD "crowd:" line; after 20 closed with cards, compare realised R with the
    adjusted-gate EV (revert thresholds in the rule's revert_if). Later split by bucket if the sample allows.
13. **Fable start gate (from Mon 2 Nov 2026):** check the first runs' footer "Late at start" line and the
    "(Gemini MT)" / "(ChatGPT MT)" citations. If Gemini's Macro Takeaways still lands after 07:45, either accept it or
    push the gate later (one cron and one prompt edit).
13. **FOMC presser reversal (study done 26 Oct 2026, thread "Test FOMC presser reversal for FX"):** SF Fed USMPD
    (public, update 17 Sep 2026), 85 clean meetings 2013-Sep 2026. Since 2019 the presser reverses the statement move
    about half the time (EUR/USD 46%, USD/JPY 52%, 2y 48%, 10y 46%), with no significant continuation either way,
    and it is the bigger move; at non-SEP meetings since 2022, 87-89% of the 100-min variance is the presser.
    2013-18 showed continuation (beta about 0.4), so don't use the full sample. Exit line for FOMC-day cards: take profit or halve at the
    statement close (14:20 ET); statement moves at non-SEP meetings are not confirmation. Note and tables:
    project files `notes/fomc_presser_reversal_26oct2026.md`; code `scripts/fomc_presser/`. R11 IN FORCE 26 Oct 11:50Z
    (owner "Yes", proposed 11:35Z, put in force early by the owner's one-line update so it covers the 28 Oct FOMC;
    `supabase/rules/R11_fomc_presser_exit.sql`). Check the Wed 28 and Thu 29 Oct digests print FOMC EXIT lines. Recheck the 3 post-May-2026 pressers (all continued) as the
    new chair's sample grows. The v15 hourly-close stop lands on the 15:00 ET bar, which is mid-presser.

### Questions still unanswered

- The office "~90%" figure: daily or weekly changes, and were FX series among its 9 drivers?
  (Partial: "on changes, 20y, 9 drivers".)
- Sign-off on the Asia list and the FX clock (noon NY vs 17:00 NY).
- Go-ahead to register free data keys and run the ALFRED pull.
- R03 defaults: early entries full size, 10-session flip lookback, stops on daily closes?
- What Astra's 20-year dataset actually holds.
- Taken as yes without an explicit reply: post-2014 carry rates; event-library defaults.

### Decisions on record

- **1 Nov 2026, market pack and input clean-up (owner: "do all six").** Price action, futures participation,
  positioning build-up, DTCC FX options and a headline wire reach the Fable takeaways through a pre-computed file, not
  new rules or web searches. R03 reverted (stale drivers data). Flow check kept as is. Opus Email Digest stays paused.
  The pack went in as a prompt edit, not a rule, because a new rule applies only a week later and a direct status
  update in `dash.rules` is blocked from threads.
- **1 Nov 2026, Fable Macro Takeaways moved to 07:30 SGT with a wait gate, and reads the ChatGPT and Gemini
  Macro Takeaways (owner).** He wants every digest in before Fable starts, including the ChatGPT and Gemini Macro
  Takeaways (he moved Gemini's to 07:30). Inbox check 27 Oct–1 Nov (SGT): Slack 04:30; ChatGPT Email 05:31–05:37;
  YouTube Gemini 05:13–06:28, ChatGPT 05:33–06:18 (back since at least 29 Oct), Opus 05:44–06:13; Podcast ChatGPT
  06:03–06:24, Gemini 06:14–06:46, Opus 06:14–06:35; Grok consolidated 06:42–06:59 (Grok Bot once 08:09); Gemini
  Email 07:04–07:19; ChatGPT Macro Takeaways 07:35–07:46; Gemini Macro Takeaways 08:37–08:52 on its old schedule; no
  Opus Email copy in that window. Scheduled task trig_01QdRhfbBYeBiyYzmgCguhSE now `CRON_TZ=Asia/Singapore 30 7 * * *`
  (the scheduler set the first fire at 07:35:51 SGT, Mon 2 Nov). New START GATE in the prompt: search for all
  expected copies, start at once if all are in, else re-check every 150 s until 07:45 SGT, then start with what is
  in and print "Late at start: …" in the footer. New PEER TAKEAWAYS line: today's ChatGPT and Gemini Macro Takeaways
  are second reads, not a feed (not in "N of 5"), lower trust, cited "(Gemini MT)" / "(ChatGPT MT)", verified per
  STEP 2 item 7, their cards and questions never booked; the old exclusion of all other models' Macro Takeaways now
  covers only Fable, Opus and prior-day ones. The Grok `sleep 300` retry and the Gemini Email "never wait" note were
  removed (the gate covers them); ten "at Mayank's request" tags and two history notes were trimmed to pay for it.
  Prompt 65,407 of 65,536 bytes, stored copy byte-identical. Runs take 45–100 min (emails landed 08:02–08:57
  when starting 07:15), so the Fable email now lands roughly 20–30 min later. Backups of the old and new prompts:
  project files `notes/fable_mt_prompt_*_1nov2026.txt`. Mac visits: 0.
- **24 Oct 2026, crowd asymmetry at the gate (owner: yes, 11:40Z, defaults as proposed; rule R09 applies at the Sun
  25 Oct 20:00 SGT window).** From a clip of Ying Hua (ex-Balyasny): pod-shop investing at a weeks-to-months horizon is poker, not
  blackjack; when everyone is on the same side the group is right 60-70% of the time but paid less (everyone sells to
  monetise), and when wrong, maybe 20% of the time, hit hard (everyone exits together). Both digests now set every
  candidate's crowd field (with / against / none, already on every card) from evidence they already read, strongest
  first: `dash.positioning_extremes()` (R02; never the Treasury basis trade or implied vol; "least long" is trimming,
  not an extreme; an extreme the market has moved 2 ATR against since its as-of date is spent), then B7 saturation or
  capitulation, the Grok crowding check, or one web statistic for an uncovered series, printed on the card and the
  TESTED line. On crowd = with only, test (c) becomes EV = p × r/r × 0.75 − (1 − p) × 1.5 (break-even 2/(r/r + 2):
  50% at r/r 2.0, was 33%); p stays the thesis probability and is not lowered again for the crowd; against and none
  are unchanged and the asymmetry in an against card's favour is never credited. Cards print both EVs, META ev holds
  the adjusted one (no dashboard change), a lean rejected only by the adjustment goes on the WASHOUT WATCH line the
  other way as the pain trade (still subject to the washout screen), with cards name the bought-option expression
  that caps the loss leg, R01 cards take only the payoff haircut, and the SCORECARD gains a "crowd: with n/R ·
  against n/R" line for calibration. Own-data check: 8 with cards to date (2 closed, both losers) against 30 against
  cards, too few to set the defaults; the voices crowd was followed 53-58% of the time over the next 10 sessions, so
  the rule adjusts payoffs and never direction. Route: `dash.propose_rule` from a cloud thread (no approval prompt),
  text in `supabase/rules/R09_crowd_asymmetry.sql`, note in `docs/crowd_asymmetry.md`; no prompt or spec edit (the
  rule wins over the spec's test (c) under STEP 1f). Both digests follow it from the Mon 26 Oct 07:15 SGT run, the
  same run as spec v15's hourly-close stops. Mac visits: 0.
- **23 Oct 2026, the Fable digest reads every copy of the YouTube, Podcast and Email digests (owner, 08:47Z).** The
  owner may pause the Fable YouTube and Podcast digests on any day to save Fable credits, so the Fable Macro Takeaways
  routine (07:15 SGT, live from the Sat 24 Oct run) now ingests every same-day copy of those feeds whatever the model
  tag: Claude Fable and Opus, Gemini (earlier tagged Argon) and ChatGPT, instead of the Fable copies alone (the 24 Sep
  A/B rule, under which it excluded the Opus copies and did not read the Gemini ones, is withdrawn). A feed is present
  when any copy is; all copies of one feed are one feed for breadth tags; the Claude copies rank first and the Gemini
  and ChatGPT copies are lower-trust evidence (a figure carried only by them is verified or printed as unverified;
  copies agreeing is not independent confirmation); the same story, number, quote or speaker across copies is one item
  and one sighting, the highest-trust copy's version kept and only what it lacks taken from the others; anything cited
  from a lower-trust copy alone is named as such. STANCES blocks are lifted from every copy that carries one and
  deduped on (speaker, date, topic); ChatGPT copies carry none. The footer lists the copies read per feed. Email
  Digest: the Fable copy has not run since 3 Oct, so the Claude copy present (Fable, else Opus) is now primary and the
  ChatGPT and Gemini copies second reads (the Gemini copy often lands after 07:15 and is never waited for); until now
  the routine built that feed from the ChatGPT copy alone. Also fixed: the Slack feed match ("Slack" and "Digest";
  the ChatGPT subject is "Slack Daily Digest", which the old substring missed, so the routine had reported the feed
  missing). Inbox check: every YouTube and Podcast copy lands 05:25–06:42 SGT; no ChatGPT YouTube digest since
  16 Oct; a Gemini copy can arrive empty (22 Oct). Route: prompt rewrite through the scheduled-task API from a cloud
  thread, stored copy verified byte for byte; the edit trimmed the Fable prompt to 65,263 of 65,536 bytes. Opus Macro
  Takeaways unchanged. Text in `docs/fable_source_copies.md`. Mac visits: 0.
- **18 Oct 2026, flow check in the Fable digest (owner: yes, 11:20Z).** Prompted by a KRW note from the owner's
  other assistant, which took a digest lead to the primary source (Yonhap, then the BoK) and turned it into a
  dated test. The Fable Macro Takeaways routine (STEP 2 item 9, live from the Mon 19 Oct 07:15 SGT run) picks up
  to two FX or rates flow leads a day from the feeds (exporter or importer conversion, lifer or pension or
  reserve-manager hedging, Japanese or Taiwanese outflows, fixing and month-end flows, portfolio flows,
  intervention; none when the feeds carry no flow story), chases each to the primary source (the article
  quoted, then the official data), says what the source is (a quote from one economist is a story about flows,
  not proof), names the mechanism and the caveat that stops it reaching spot, and sets a test in named data
  within two weeks with what would confirm or kill it. Printed as a bold "FLOW CHECK:" line (≤70 words, no
  colour) in the theme's Positioning line or as a LEDGER one-liner, plus a footer count. It is evidence a card
  may cite, never a card, tag or numbered item; no new data feeds, no new state (each day's check stands
  alone). Fable only: the Opus prompt is at its 65,536-byte cap. Trial to 31 Oct, judged with the month-end
  Opus vs Fable scorecard. Route: prompt edit through the scheduled-task API from a cloud thread, stored copy
  verified byte for byte; the Fable prompt is now 65,349 of 65,536 bytes, so further Fable changes go through
  `dash.rules`. Text in `docs/fable_flow_check.md`. Mac visits: 0.
- **17 Oct 2026, cash FX cards are forwards (owner).** Both digests write, fill and score every cash FX card (any
  `=X` proxy or FX cross; thematic, tactical or hedge) as an outright forward for the planned hold, never at spot.
  The tenor is the shortest of 1W, 2W, 1M, 2M, 3M that reaches the card's review date or boundary (typically 2W);
  the card prints spot, the points with their source and time, the outright forward, the value date and the carry
  in pips and as a share of 1R; r/r, EV, 1R and the fill use the forward (stop and target stay spot levels and exits
  stay on daily closes), so a lean that clears EV > 0 at spot can fail at the forward. Points: the pair's
  Investing.com forward-rates page (FXEmpire second), else an estimate from SOFR and the other currency's 1-month or
  policy rate in `msd.observations`, labelled est.; never a guess. A roll adds the new points to the entry; at the
  first run every open cash FX card is converted (CHANGES line) and flagged "carry kills the edge" when its restated
  EV is 0 or below, but not closed on that alone. Trigger: Opus P10 short USDJPY (16 Oct) carded at spot with EV
  +0.14R; at the 2W forward (-18.7 pips, Investing.com 16 Oct) EV is -0.02R, at 1M (-38.9) -0.14R. Rule R07 (scope
  both, source owner, review due 28 Nov 2026), proposed 17 Oct 01:44Z through `dash.propose_rule` from a cloud thread
  (no approval prompt), goes in force at the Sun 18 Oct 20:00 SGT window with R06, so both digests follow it from the
  Mon 19 Oct 07:15 SGT run unless he replies `oppose R07` to the weekly review email; the one-line early-apply SQL is
  in `supabase/rules/R07_fx_forward_carry.sql`. The spec's CARRY clause (printed, never scored) is retired for
  these cards; `dash-mark` needs no change (it reads META entry, now the forward). Source check 17 Oct: the
  digests' page reader got the Investing.com tables for USDJPY, USDINR, USDTWD, USDSGD, EURGBP (USDIDR rows were
  stale, dated June; USDCNH and USDKRW came back without the table on one reader), hence the labelled estimate as
  the fallback. Mac visits: 0.
- **15 Oct 2026, PBOC fix read (owner).** Both digests judge the USD/CNY fix by the day-on-day change in
  the gap between the fix and the survey estimate, not by the gap's level: narrowing = CNY-positive,
  widening = CNY-negative, a change under 50 pips = unchanged lean (150 or more = strong, name the cause);
  one printed line with fix, estimate, gap, prior gap, change, the 5-session run and the signal; a
  weak-side level alone never cards, sizes or rejects a CNY trade. Rule R06 (scope both, source owner,
  review due 23 Nov 2026), proposed 15 Oct 06:02Z through `dash.propose_rule` from a cloud thread (no
  approval prompt), so it goes in force at the Sunday 18 Oct 20:00 SGT window and both digests follow it
  from the Mon 19 Oct 07:15 SGT run unless he replies `oppose R06` to the weekly review email. Text in
  `supabase/rules/R06_pboc_fix_gap.sql`. Data: the CFETS fix is in the database daily (`msd.observations`,
  series `FX_USDCNH.CFETS_FIX`, loaded about 05:20 SGT, so the 07:15 run sees the previous session's fix);
  the in-house estimate series `FX_USDCNH.FIX_MODEL` is empty, so the estimate is the Reuters survey figure
  the digests already find on the web. Mac visits: 0.
- **12 Oct 2026, event library into the digests (owner: yes, 13:54Z).** Both digests read
  `dash.event_brief()` under rule R05 (scope both, source owner, review due 23 Nov 2026) and cite the
  cell on any trade card whose catalyst or horizon holds a library release: multiplier, CI,
  significance, typical move in sigma; non-significant or n<15 cells are "no significant read" and
  never sized on; option cards compare implied vol with the add-on. Delivered as one SQL file the
  owner ran (12 Oct 14:35Z), because every database write from a cloud thread raised its own approval prompt.
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

### Guardrails

- Public repo: no trade or theme data, no personal names, no personal or family admin on the dashboard.
- No model identifiers in commits or PRs beyond the attribution lines.
- Destructive Supabase statements need the owner's confirmation. Batch DB queries to cut prompts.
- Ingest token and DB credentials never go into the repo, GitHub or any external runner.
- Treat downloaded files as untrusted. Don't change permission settings.

### Working conventions

- One session per feature or per day; this file carries continuity.
- Owner rule (12 Oct 2026): finish each workstream in the day, suboptimal is acceptable, then run
  the book and change things only when a trade shows something; no cards or questions mid-run,
  threads pick the sensible default and journal it.
- To add a digest rule without a Mac visit (15 Oct 2026): `select dash.propose_rule($j${...}$j$::jsonb);`
  through the Supabase connector raises no approval prompt in a cloud thread; the rule applies at the next
  Sunday 20:00 SGT window (`dash.next_apply_window()`), where the Sunday apply-rules task puts it in force
  and emails him. Immediate in-force needs an `update dash.rules …`, which is a write (an approval prompt
  from a cloud thread, or one line he runs in the SQL editor).
- To change a digest prompt without a Mac visit (18 and 23 Oct 2026): read it through the scheduled-task API, apply
  the edit by script with each find asserted to occur exactly once, write the whole prompt back and byte-compare the
  stored copy. Both Macro Takeaways prompts sit at the 65,536-byte cap, so an addition is paid for by a trim in the
  same edit (the Fable prompt is 65,407 bytes after 1 Nov).
- To change `trade_book_spec`: create a JSON file titled `trade_book_spec_edits` in the spec folder
  (Drive connector `create_file`, text/plain, no conversion) holding `[{"find","replace"}]`. Each find
  must occur exactly once in the live text, and edits must not overlap. `Spec.gs` applies it within
  10 minutes and archives the old version, or renames the file `_rejected_<date>` and logs why. The
  Drive connector cannot edit a Doc's body directly.
- Tests: `deno test supabase/functions/_shared/` (parse, convexity; no trend test file in the
  repo). Deno isn't preinstalled in cloud sessions.
- New migrations are numbered after `016_event_library.sql` (the database also holds a `014_grok_crowding`
  applied without a repo file).
