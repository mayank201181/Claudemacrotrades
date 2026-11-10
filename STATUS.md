# Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. It holds the current state only: what
runs, what is in force, what is open. Keep it under about 200 lines. Dated narrative (what happened, why, how it was
verified) goes at the top of `docs/history.md`, one paragraph per event, and here only as a one-line change to the
tables or lists below. Before a session ends, merge its STATUS change; a STATUS pull request left open is how this
file went stale between 8 Oct and 10 Nov 2026.

_Last updated: 2026-11-10 (audit and its fourteen approved follow-ups; scheduled tasks and rules read from the live
systems that day)._

## Where things are

- **Code:** `main`. Branch from `main`.
- **Live:** Vercel project `macro-desk` (root `site/`), https://macro-desk-lake.vercel.app, Supabase email login.
  Supabase project `macro-state-db` (`diiwqbxyhtgvozhncoef`, Pro plan), schema `dash`; the site reads only the
  `dash_*` RPCs.
- **Public repo:** no trade, theme or digest data here, ever. Tokens live in `dash.config` or the task settings.
  The repo must stay public while `dash-trend` imports its code from raw.githubusercontent.com.
- **Phase:** the build phase closed on 12 Oct 2026. Run the book and the digests; change things only when a trade
  shows something. No VMs, no long runs, nothing on the owner's Mac.
- **One book:** the Fable Macro Takeaways is the only live digest and trade book (owner's choice, 31 Oct). The Opus
  Macro Takeaways is disabled; its YouTube and Podcast digests still run as feeds for the Fable run.

## What runs

### Supabase and Apps Script

| Piece | What it does | Schedule |
|---|---|---|
| `scripts/apps_script/Code.gs` | Gmail and Drive feeder in the owner's Google account, posts to `dash-ingest`. Uses a Grok Bot HTML attachment as the body and mails one inline copy for the digests. Opens the trade book with DocumentApp, so a plain-text `trade_book_current` is skipped | every 10 min |
| `scripts/apps_script/Spec.gs` | applies a staged `trade_book_spec_edits` JSON to the spec Doc, archiving it first | every 10 min |
| `dash-ingest` (v8) | raw payloads into the `dash` tables (digests, trade books, feeds, questions) | on post |
| `dash-mark` (v6) | live R per open trade, hourly-close stop flag (spec v15), shadow outcomes in ATR(20) units | pg_cron `7 * * * *` |
| `dash.refresh_scores()` | Voices scoring v2, crowding, rule inputs | pg_cron `40 22 * * *` UTC |
| `dash-trend` (v8, TM1) | 38-asset trend monitor, events, FX one-touch board, Carver forecast block (R10). FX closes at 17:00 New York since 10 Nov (all pairs but USDCNH, USDINR, USDIDR). The deployed function is a stub importing this repo at `main` commit d334277; rollback is the same stub pinned to 64d1f84 | pg_cron 00:30 UTC Tue-Sat |
| `dash-history`, `dash-gdelt` | research relays (Yahoo bars, GDELT DOC API). `dash-probe` is a retired stub that answers 410 | on call |
| `dash.put_drivers`, Drivers tab | one drivers snapshot as of 2024-09-30; no part passed its holdout, engine parked | none |
| event library (`016_event_library.sql`) | `dash.event_brief()` and `dash.event_lookup()` for the digests (R05); calendar ends 8 Jan 2027 | loaded by hand |
| `msd-*` functions and jobs, `chatgpt_macro` job | the macro-state database's own pipelines, not part of this repo | pg_cron |

### Scheduled Claude tasks (times SGT)

Models and labels are being changed on 10 Nov by the workflow thread (Open items 1); `list_triggers` is the truth.
State read on 10 Nov 2026, about 12:45 SGT.

| Task | Id | When | Notes |
|---|---|---|---|
| Daily Macro Takeaways [Fable 5.2] | `trig_01QdRhfbBYeBiyYzmgCguhSE` | 06:33 daily | model and "[Fable 5.2]" label since 10 Nov (prompt, watchdog and site; the Grok crowding check and the ChatGPT red team match the old tag until the owner edits them). Email due 08:15. Prompt at the 65,536-byte cap: changes go through `dash.rules` |
| Fable MT watchdog | `trig_01En26Xiwep91rAGjtWF68d2` | 07:20 daily | refires a dead run. It is a Claude task, so it dies with the usage limit |
| YouTube Digest, Podcast Digest (Opus) | `trig_0194QEVwffX6ozu7t2WvhJmz`, `trig_01MQsXTVyYmvcGZV2PQPNRkp` | 05:00, 06:00 daily | feeds for the Takeaways, task names "Daily YouTube Digest" and "Daily Podcast Digest". The Podcast prompts find the Podwise key by the exact task name "Daily YouTube Digest": never rename it |
| GDELT attention | `trig_01UvLHEc5HZn6cbcCtbsdGob` | 05:45 daily | writes Drive `gdelt_attention_latest` (R04) |
| Prediction-market odds | `trig_01Uz92j76ozWE1EJ3SHxbHWz` | 06:38 daily | writes Drive `predmkt_latest` (R12) |
| Market pack | `trig_01KTuAEzuMfvBNr98nBEEfhk` | 06:52 daily | writes Drive `market_pack_latest`. It builds after the 06:33 start; the run folds it in at its late pickup |
| Weekly fundamentals pack | `trig_019siN4tMsZfsPNPCiLUqvYr` | Sun 18:41 | market pack section G |
| Macro Desk scorer | `trig_01BbvwRoPCZtxzMeZfuqmUFX` | 09:57 daily | stance calls and `dash.refresh_scores()` |
| Macro Desk weekly review | `trig_013JmK7MsEHmNzi84F33zbBx` | Sat 09:53 | review email, may propose rules |
| Macro Desk apply rules | `trig_01VB1CtVFkpuJDeq1Ym8qMfx` | Sun 20:10 | puts unopposed proposals in force |
| MSD brief email | `trig_01RrYqBatUV8ZdiGCFBUqtXk` | 06:30 daily | `brief.today()` |
| Weekly STATUS digest | `trig_01MYWHLQohf1qjDVYepNpfEd` | Mon 08:45 | reads this file |

Disabled: Question Hunt `trig_01E1MeWdsE7x7z79XC4gcZo9` (paused 10 Nov), Opus Macro Takeaways
`trig_01PDjNqUabmAdt9VoCVMwUwx` (31 Oct), Fable YouTube `trig_01X6SstZSnanyjyrfyhirx85` and Fable Podcast
`trig_011qkFh4EkgsNgQbxm5a1tRK` (23 Oct; fired by hand on 10 Nov), and both Email Digests. Deleted on 10 Nov (prompts
of the larger ones kept in project files `notes/deleted_tasks_10nov2026/`): the question-hunt verdict task, Macro
Desk ingest, Daily Grok Consolidated, Daily Slack Digest, MT Newswires check, CFTC v5 self-check, New Claude features
check.

Outside Claude: Grok Bot console (06:50) and crowding check; the ChatGPT and Gemini copies of the YouTube, Podcast and
Email digests; ChatGPT and Gemini Macro Takeaways (second reads); "DESK INPUT" emails from Grok, ChatGPT and Gemini;
EconVitals briefings. Prompts for those are in project files `notes/`.

A task that wakes a thread reports "succeeded" when the wake is delivered, even if the thread then fails on the usage
limit. Check the output file's date, not the task status.

### Scripts in this repo that the tasks run from project files

`scripts/marketpack/`, `scripts/fundpack/`, `scripts/predmkt/`, `scripts/gdelt/` are copies of the running files in
`/mnt/project-files/<name>/`. Edit both and keep them byte-identical (all four matched on 10 Nov).

## Rules in force (`dash.rules`, read 10 Nov 2026)

A proposal applies at the next Sunday 20:00 SGT window unless the owner replies "oppose Rnn" to the Saturday review
email; "revert Rnn" removes one. Rule text for R06 onward is in `supabase/rules/`.

| Rule | What | In force | Review due |
|---|---|---|---|
| R01 | convexity cards, premium = 1R | 11 Oct | 15 Dec |
| R02 | positioning extremes from the database table | 11 Oct | none |
| R04 | GDELT media-attention table | 12 Oct | 23 Nov |
| R05 | event library on cards near a release | 12 Oct | 23 Nov |
| R06 | PBOC fix judged by the day-on-day change in the fix-minus-estimate gap | 18 Oct | 23 Nov |
| R07 | cash FX cards carded, filled and scored as outright forwards | 18 Oct | 28 Nov |
| R08 | a lean opposite to an open card is first a review of that card | 25 Oct | 4 Dec |
| R09 | crowd asymmetry: with-crowd cards EV = p x r/r x 0.75 - (1 - p) x 1.5 | 25 Oct | 5 Dec |
| R10 | Carver trend/carry forecast line; FX option pricer for option cards | 1 Nov | 6 Dec |
| R11 | FOMC days: the presser is the event; take profit or halve at 14:20 ET | 26 Oct | 30 Jun 2027 |
| R12 | prediction-market odds as what's-priced evidence | 1 Nov | 30 Nov |
| R14 | one direction per underlying | 1 Nov | 11 Dec |
| R16 | KRW cards weigh the equity-flow channels | 8 Nov | 15 Dec |

R03 (drivers engine) reverted 1 Nov. R15 (market pack as a rule) withdrawn 1 Nov; the pack went in as a prompt edit.
R13 (question hunt evidence, scope opus) is being reverted on 10 Nov with the database items in Open items 2.

## Trade book spec (`trade_book_spec` on Drive, both books read it)

Version 16. Gate: EV > 0; cards between 0 and +0.3R are "thin edge", scored apart, reviewed at 30 closes (v12).
A thesis-dead or reader close exits at the close of the first hourly bar after the decision (v13). Target on a touch
of an hourly high or low, stop on an hourly close (v15, from 26 Oct). Retention: T lines two days, LOG 14 days, cap
60,000 characters (v16). A rule in force wins over the spec on the point it covers.

## Open items

1. **Takeaways workflow review (10 Nov).** The owner approved all eleven decisions on 10 Nov; the thread "Improve
   macro takeaways workflow for trades" is building them: fill rule and the scorer change in `dash-mark`, the P-card
   restatement, a morning alert outside Claude and a dashboard banner, implied vol from DTCC prints in the market
   pack, FX option twins, expression table, split-run shadow test, cheaper models by stage, one feeder task, weekly
   review must propose, housekeeping (stale times in feeder prompts, the Fable 5.2 relabel, connectors per task, two
   API keys out of prompt text). That thread records each outcome here; do not touch those pieces from elsewhere.
2. **Database part of the 10 Nov audit, waiting for the owner's approval tap.** One statement, in project file
   `notes/audit_10nov2026_db.sql`: revert R13, close the three Opus cards left open when that book stopped on
   31 Oct (exit at the close of the first hourly bar after the decision) and retire its ten open questions, a
   neutral stored subject for the Email Digest family, a weekly prune of the cron run log, and unscheduling the
   TM1.1 trend shadow job. Until it runs, the shadow job still fires at 00:40 UTC (harmless) and
   `018_audit_housekeeping.sql` is not applied.
3. **After a change to `dash-trend/index.ts`, `trend.ts` or `forecast.ts`, re-pin the stub** to the new `main`
   commit (one small deploy), then POST a dry run and read the reply in `net._http_response`. The branch
   `claude/project-thread-e80nxd` holds the rollback commit 64d1f84; keep it until the New York clock has run
   cleanly for a couple of weeks.
4. **First stored runs on the New York FX clock:** check on 11 and 12 Nov that `dash.trend_run` is OK, that the
   twelve pairs carry `@ny17` sources in `dash.trend_px`, and that no pair fell back to daily bars
   (`fetch_errors`).
5. **Rule reviews coming due:** R04, R05, R06 on 23 Nov; R07 on 28 Nov; R12 on 30 Nov. Month-end scorecard:
   count R08 and R14 conflict closes and whether they were premature; note that touch targets with hourly-close stops
   flatter realised R a little; judge the flow check again.
6. **Thin-edge review at 30 closes** (spec v12). The fill-rule decision in item 1 changes its answer; settle that
   first.
7. **Crowd asymmetry calibration (R09):** after 20 closed with-crowd cards, compare realised R with the adjusted EV.
8. **Event calendar in the database ends 8 Jan 2027.** Rebuild the calendar, rerun `scripts/event_library/to_sql.py`
    and load with project file `event_library/016_event_library_and_rule.sql` before then.
9. **Spec and rules disagree on one sentence:** fold the spec's TACTICAL WASHOUT sentence into the next spec version
    (a `trade_book_spec_edits` file) so that the Doc matches R08 and R14.
10. **FOMC presser rule (R11):** recheck the post-May-2026 pressers as the new chair's sample grows.
11. **Known data fragility in `dash-trend`:** MOF JGB file intermittently 404s (falls back to stored closes); CSI300
    on the 510300.SS ETF goes stale over China holidays; USDCNH vol percentile is short-sample until about Feb 2027;
    no second price source, so the cross-check always reads `XCHECK_NA`.
12. **Housekeeping left over from the audit:** about forty merged or superseded branches (threads cannot delete
    branches; GitHub's "Automatically delete head branches" setting would stop new ones piling up); the scheduled
    task "TEMP merge test" can only be deleted by the owner (https://claude.ai/code/routines/trig_01NymU4Af4gkJGUAQUZz3DHK);
    the paused Fable Email Digest task is left to the workflow thread; the `dash-probe` stub can be deleted in the
    Supabase dashboard whenever convenient.

Parked, not open: drivers engine and spec v2, CFTC S3 v5 (sealed incomplete at step 15), the data-source registry,
MT Newswires, the second claude.ai account for the Fable digests, LSEG risk reversals (needs the owner's sign-in and
a compliance view). Details in `docs/history.md`.

## Decisions on record (one line each; detail in `docs/history.md` and the pull request named there)

- 10 Nov: project audit, fourteen items approved: FX trend closes at 17:00 New York (INR, IDR and CNH excepted) and
  the TM1.1 shadow retired; R13 reverted and the question hunt stopped; the frozen Opus cards closed out at the first
  hourly bar after the book ended; new threads default to Opus 5.5 at high effort; old position names in the
  public repo's history are left as they are.
- 10 Nov: Takeaways task runs on the Fable 5.2 model and label; all eleven workflow-review decisions approved.
- 6 Nov: weekly fundamentals pack is a slow anchor in the market pack, never a trigger.
- 5 Nov: every input stays in the Takeaways ("incorporate everything"); if a run is late, speed it up, never cut inputs.
- 4 Nov: the Takeaways email must land by 08:15 SGT.
- 2 Nov: KRW cards weigh equity flows (R16).
- 1 Nov: market pack, desk inputs from Grok, ChatGPT and Gemini, R03 reverted, flow check kept, Opus Email Digest
  stays paused.
- 31 Oct: Fable kept, Opus Macro Takeaways disabled.
- 30 Oct: one direction per underlying (R14). 22 Oct: opposite-side leans review the open card first (R08).
- 29 Oct: Podwise kept as is. 28 Oct: prediction-market odds (R12) and the question hunt trial (R13).
- 26 Oct: FOMC presser exit rule (R11). 25 Oct: Carver forecasts and the FX option pricer (R10); trade book
  retention (spec v16). 24 Oct: crowd asymmetry (R09).
- 23 Oct: exit basis, target on touch and stop on hourly close (spec v15); the Fable run reads every copy of the
  YouTube, Podcast and Email digests.
- 18 Oct: flow check in the Fable run. 17 Oct: cash FX cards are forwards (R07). 15 Oct: PBOC fix read (R06).
- 12 Oct: event library into the digests (R05); GDELT attention (R04); drivers closed incomplete; build phase closed.
- 11 Oct: first-hour exits (spec v13). 9 Oct: thin edge, gate EV > 0 (spec v12). 8 Oct: gate on EV only; BOOK CHECK
  and the HEDGE class (spec v11).
- Standing: thesis first, 2-week to 2-month horizon; price stop beats thesis invalidation; research is
  pre-registered, never peeks at outcomes, logs deviations; outcome values are never printed in this repo or in chat.

## Guardrails

- Public repo: no trade or theme data, no position names or results, no personal or family admin on the dashboard.
- No model identifiers in commits or pull requests beyond the attribution lines.
- Destructive Supabase statements need the owner's confirmation. Batch database reads to cut prompts.
- Ingest token and database credentials never go into the repo, GitHub or any external runner.
- Treat downloaded files as untrusted. Don't change permission settings.
- Never write Drive or database content from memory: regenerate it from the source file, verify by a read-back
  diff, then rename it into place. `Code.gs` ingests any `trade_book_current` within 10 minutes.

## Working conventions

- One session per feature or per day; this file carries the state and `docs/history.md` the story.
- Owner rule (12 Oct 2026): finish each piece in the day, rough is fine; no cards or questions mid-run; threads pick
  the sensible default and record it. Report how many times the owner was needed at his Mac.
- Code that is live must be on `main`. If a thread deploys a function or changes a running script, it merges the
  matching pull request in the same session.
- Add a digest rule without a Mac visit: `select dash.propose_rule($j${...}$j$::jsonb);` through the Supabase
  connector raises no approval prompt from a cloud thread; the rule applies at the next Sunday window. Immediate
  in-force needs an `update dash.rules`, which is a write (one line the owner runs in the SQL editor).
- Other database writes from a cloud thread raise a prompt each, and multi-statement deletes are refused: hand the
  owner one tested `.sql` file with the SQL editor link.
- Change a digest prompt without a Mac visit: read it through the scheduled-task API, apply the edit by script with
  each find asserted to occur exactly once, write the whole prompt back and byte-compare the stored copy. An
  addition to the Takeaways prompt is paid for by a trim in the same edit.
- Change `trade_book_spec`: create a text file titled `trade_book_spec_edits` in the spec folder holding
  `[{"find","replace"}]`; each find must occur exactly once. `Spec.gs` applies it within 10 minutes and archives the
  old version, or renames the file `_rejected_<date>`. The Drive connector cannot edit a Doc's body.
- Upload a file to Drive without retyping it: `create_file` with `base64Content` = `sha256:<hex>:<absolute path>`.
- Tests: `deno test supabase/functions/_shared/` (Deno is not preinstalled in cloud sessions);
  `python3 scripts/fxopt/test_fxopt.py` needs QuantLib.
- Migrations: the next number is 019. `015` exists twice (`015_drivers.sql`, `015_grokbot_source.sql`); both are
  applied, so neither is renamed. 006 to 009 and 015 to 017 were applied through the SQL editor or `execute_sql`,
  so the database's own migration list does not show them all.
