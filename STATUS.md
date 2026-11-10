# Macro Desk — status

Hand-over file for Claude Code sessions. Read this first, then `README.md`. It holds the current state only: what
runs, what is in force, what is open. Keep it under about 200 lines. Dated narrative (what happened, why, how it was
verified) goes at the top of `docs/history.md`, one paragraph per event, and here only as a one-line change to the
tables or lists below. Before a session ends, merge its STATUS change; a STATUS pull request left open is how this
file went stale between 8 Oct and 10 Nov 2026.

_Last updated: 2026-11-10 evening (audit and its fourteen follow-ups; then the workflow review's eleven approved
changes, built the same day: Open items 1). Scheduled tasks and rules were read from the live systems that day._

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
| `scripts/apps_script/Alert.gs` | the morning check outside Claude: mails the owner when no Macro Takeaways email has arrived. **Not installed yet**: it needs the owner's one visit (Open items 1) | daily 08:15 to 08:45 SGT once installed |
| `dash-ingest` (v9) | raw payloads into the `dash` tables (digests, trade books, feeds, questions). Since 10 Nov it keeps a card's `risk` key (R17) and its TWIN line (R18). The deployed function is a stub importing this repo at `main` commit 9fcaed6; rollback is the same stub pinned to fe335fd | on post |
| `dash-mark` (v7) | live R per open trade (one R = the card's planned risk when it carries a `risk` key, R17), hourly-close stop flag (spec v15), option twins priced on the smile and marked hourly (R18, `twin_*` keys in the card's meta), shadow outcomes in ATR(20) units. Stub pinned to 9fcaed6, rollback fe335fd | pg_cron `7 * * * *` |
| dashboard banner (`site/app.js`) | a red banner on every tab when today's Fable digest row is still absent at 08:20 SGT | on page load |
| `dash.refresh_scores()` | Voices scoring v2, crowding, rule inputs | pg_cron `40 22 * * *` UTC |
| `dash-trend` (v8, TM1) | 38-asset trend monitor, events, FX one-touch board, Carver forecast block (R10). FX closes at 17:00 New York since 10 Nov (all pairs but USDCNH, USDINR, USDIDR). The deployed function is a stub importing this repo at `main` commit d334277; rollback is the same stub pinned to 64d1f84 | pg_cron 00:30 UTC Tue-Sat |
| `dash-history`, `dash-gdelt` | research relays (Yahoo bars, GDELT DOC API). `dash-probe` is a retired stub that answers 410 | on call |
| `dash.put_drivers`, Drivers tab | one drivers snapshot as of 2024-09-30; no part passed its holdout, engine parked | none |
| event library (`016_event_library.sql`) | `dash.event_brief()` and `dash.event_lookup()` for the digests (R05); calendar ends 8 Jan 2027 | loaded by hand |
| `msd-*` functions and jobs, `chatgpt_macro` job | the macro-state database's own pipelines, not part of this repo | pg_cron |

### Scheduled Claude tasks (times SGT)

`list_triggers` is the truth. State on 10 Nov 2026, about 17:00 SGT, after the workflow thread's changes.

| Task | Id | When | Notes |
|---|---|---|---|
| Daily Macro Takeaways [Fable 5.2] | `trig_01QdRhfbBYeBiyYzmgCguhSE` | 06:33 daily | model and "[Fable 5.2]" label since 10 Nov (prompt, watchdog and site; the Grok crowding check and the ChatGPT red team match the old tag until the owner edits them). Email due 08:15. Prompt at the 65,536-byte cap: changes go through `dash.rules` |
| Fable MT watchdog | `trig_01En26Xiwep91rAGjtWF68d2` | 07:20 daily | refires a dead run. It is a Claude task, so it dies with the usage limit |
| YouTube Digest, Podcast Digest (Opus) | `trig_0194QEVwffX6ozu7t2WvhJmz`, `trig_01MQsXTVyYmvcGZV2PQPNRkp` | 05:00, 06:00 daily | feeds for the Takeaways, task names "Daily YouTube Digest" and "Daily Podcast Digest". The Podcast prompts find the Podwise key by the exact task name "Daily YouTube Digest": never rename it |
| Feeder: media attention table | `trig_01LpdVu1akXy9sHddyah3j6n` | 05:45 daily | writes Drive `gdelt_attention_latest` (R04). All three feeders wake one small thread, "Run morning data feeders" (Haiku 5.5, low effort), which runs `feeders/feeder.py` and uploads by file reference: `docs/feeders.md` |
| Feeder: prediction-market odds | `trig_019jXUYgtu3beS5Zt6yxb8tH` | 06:20 daily | writes Drive `predmkt_latest` (R12); moved from 06:38 so that it lands before the 06:33 start |
| Feeder: market pack | `trig_01TLpx3Z2fHb3vxvebpFFASG` | 06:52 daily | writes Drive `market_pack_latest`. It builds after the 06:33 start; the run folds it in at its late pickup |
| Weekly fundamentals pack | `trig_019siN4tMsZfsPNPCiLUqvYr` | Sun 18:41 | market pack section G. Stays in its own Opus thread (owner, 6 Nov) |
| Macro Desk scorer | `trig_01BbvwRoPCZtxzMeZfuqmUFX` | 09:57 daily | stance calls and `dash.refresh_scores()` |
| Macro Desk weekly review | `trig_013JmK7MsEHmNzi84F33zbBx` | Sat 09:53 | review email; since 10 Nov it runs fixed cuts and must end with up to two rule proposals or "none, because" (`docs/weekly_review.md`; first such run 14 Nov) |
| Macro Desk apply rules | `trig_01VB1CtVFkpuJDeq1Ym8qMfx` | Sun 20:10 | puts unopposed proposals in force |
| MSD brief email | `trig_01RrYqBatUV8ZdiGCFBUqtXk` | 06:30 daily | `brief.today()` |
| Weekly STATUS digest | `trig_01MYWHLQohf1qjDVYepNpfEd` | Mon 08:45 | reads this file |

Disabled: Question Hunt `trig_01E1MeWdsE7x7z79XC4gcZo9` (paused 10 Nov), Opus Macro Takeaways
`trig_01PDjNqUabmAdt9VoCVMwUwx` (31 Oct), the Opus Email Digest, and the three old feeder tasks that the Haiku thread
replaced on 10 Nov (`trig_01UvLHEc5HZn6cbcCtbsdGob`, `trig_01Uz92j76ozWE1EJ3SHxbHWz`, `trig_01KTuAEzuMfvBNr98nBEEfhk`;
delete them after a clean week). The paused Fable YouTube `trig_01X6SstZSnanyjyrfyhirx85`, Fable Podcast
`trig_011qkFh4EkgsNgQbxm5a1tRK` and Fable Email `trig_01Q7JHUSc11TGiWQfhjDHwBz` tasks are test vehicles until
13 Nov: renamed "... [Sonnet 5.5 test]", model Sonnet 5.5, fired by hand with a note that redirects the output to a
Drive test folder. Fired without that note they mail a digest, so leave them alone (Open items 1). Deleted on 10 Nov (prompts
of the larger ones kept in project files `notes/deleted_tasks_10nov2026/`): the question-hunt verdict task, Macro
Desk ingest, Daily Grok Consolidated, Daily Slack Digest, MT Newswires check, CFTC v5 self-check, New Claude features
check.

Outside Claude: Grok Bot console (06:50) and crowding check; the ChatGPT and Gemini copies of the YouTube, Podcast and
Email digests; ChatGPT and Gemini Macro Takeaways (second reads); "DESK INPUT" emails from Grok, ChatGPT and Gemini;
EconVitals briefings. Prompts for those are in project files `notes/`.

A task that wakes a thread reports "succeeded" when the wake is delivered, even if the thread then fails on the usage
limit. Check the output file's date, not the task status.

### Scripts in this repo that the tasks run from project files

`scripts/marketpack/`, `scripts/fundpack/`, `scripts/predmkt/`, `scripts/gdelt/` and `scripts/feeders/` are copies of
the running files in `/mnt/project-files/<name>/`. Edit both and keep them byte-identical (all five matched on
10 Nov). `/mnt/project-files/feeders/status.csv` has one line per build and upload: read it, not a thread, to see
whether a morning ran. The weekly review's prompt is built by `scripts/weekly_review/build_prompt.py`.

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
| R17 | fills: one R is the card's planned risk, REF to stop; an adverse fill past half that distance is void; the one gapped card is restated (`risk` key in `parse.ts`, `oneR()` in `marks.ts`) | proposed, 15 Nov | with the thin-edge review |
| R18 | FX option twin beside every cash FX card; the pack's DTCC implied vol is the vol source; model-implied odds on FX level questions (`twin.ts` run by `dash-mark`) | proposed, 15 Nov | 13 Dec or ten finished pairs |
| R19 | expression table: up to four expressions of a live view, the best one carded, alternates shadowed by theme | proposed, 15 Nov | 15 cards or six weeks |

R03 (drivers engine) reverted 1 Nov. R15 (market pack as a rule) withdrawn 1 Nov; the pack went in as a prompt edit.
R13 (question hunt evidence, scope opus) reverted 10 Nov; its only reader, the Opus Macro Takeaways, stopped on 31 Oct.
R17 to R19 were proposed on 10 Nov (the owner approved all three in the workflow review) and go in force Sun 15 Nov
20:00 SGT unless opposed; each rule file carries the one line that puts it in force early.

## Trade book spec (`trade_book_spec` on Drive, both books read it)

Version 16. Gate: EV > 0; cards between 0 and +0.3R are "thin edge", scored apart, reviewed at 30 closes (v12).
A thesis-dead or reader close exits at the close of the first hourly bar after the decision (v13). Target on a touch
of an hourly high or low, stop on an hourly close (v15, from 26 Oct). Retention: T lines two days, LOG 14 days, cap
60,000 characters (v16). A rule in force wins over the spec on the point it covers.

## Open items

1. **Takeaways workflow review (10 Nov): all eleven decisions approved and built that day by the thread "Improve
   macro takeaways workflow for trades". What is left:**
   - *Waiting on the owner, one visit* (click-by-click directions are in that thread): install `Alert.gs` in the
     Apps Script project and run `setupTakeawaysAlert` once; in the ChatGPT red-team task and the Grok crowding
     check change the subject match "MACRO TAKEAWAYS [Fable 5.1]" to "MACRO TAKEAWAYS [Fable"; the two API keys in
     the YouTube digest prompts and the seven "Fable 5.1" labels in the Fable YouTube prompt (a thread cannot retype
     a prompt that holds a key); connectors per digest task cut to the four it uses. Optional: the one line in each
     rule file that puts R17 to R19 in force before Sunday.
   - *First runs to check:* the Takeaways of 11 Nov under `dash-ingest` v9; the Haiku feeder thread's first
     scheduled morning on 11 Nov (`feeders/status.csv`; delete the three disabled old feeder tasks after a clean
     week); the weekly review of 14 Nov under the new prompt; the Takeaways of 16 Nov under R17 to R19 (the `risk`
     key, TWIN lines and the expression table in the digest, `twins` above zero in the `dash-mark` reply).
   - *Sonnet 5.5 side by side* for the YouTube, Podcast and Email digests, mornings of 11 to 13 Nov: notes and
     results in project files `notes/model_tests_nov2026/`. On a pass the two Opus digest tasks move to Sonnet 5.5
     on 13 Nov and the three test tasks are restored (names, models) and left paused.
   - *Not built yet:* the five-day split-run shadow test of the Takeaways (decision 7), and the Gemini digest copies
     that are stored in `dash.feeds` under the source name `claude`.
   - *Standing decisions the weekly review carries every week until made:* thin edge at 30 closed cards, the option
     twin trial (ten finished pairs or 13 Dec), the expression table (15 cards or six weeks).
2. **After a change to a function or to `_shared`, re-pin its stub.** `dash-trend` (pinned to d334277), `dash-mark`
   and `dash-ingest` (both pinned to 9fcaed6) are one-file stubs that import this repo at a `main` commit: merge,
   deploy the stub with the new commit, POST a dry run through `pg_net` and read the reply in `net._http_response`.
   The branch `claude/project-thread-e80nxd` holds the `dash-trend` rollback commit 64d1f84; keep it until the New
   York clock has run cleanly for a couple of weeks.
3. **First stored runs on the New York FX clock:** check on 11 and 12 Nov that `dash.trend_run` is OK, that the
   twelve pairs carry `@ny17` sources in `dash.trend_px`, and that no pair fell back to daily bars
   (`fetch_errors`).
4. **Rule reviews coming due:** R04, R05, R06 on 23 Nov; R07 on 28 Nov; R12 on 30 Nov. Month-end scorecard:
   count R08 and R14 conflict closes and whether they were premature; note that touch targets with hourly-close stops
   flatter realised R a little; judge the flow check again.
5. **Thin-edge review at 30 closes** (spec v12). R17 changes how a gapped fill is scored, so judge it on the
   weekly review's cuts (`cum_r` as booked, `cum_r_planned` as the lens), not on the scorecard line alone.
6. **Crowd asymmetry calibration (R09):** after 20 closed with-crowd cards, compare realised R with the adjusted EV.
7. **Event calendar in the database ends 8 Jan 2027.** Rebuild the calendar, rerun `scripts/event_library/to_sql.py`
    and load with project file `event_library/016_event_library_and_rule.sql` before then.
8. **Spec and rules disagree on one sentence:** fold the spec's TACTICAL WASHOUT sentence into the next spec version
    (a `trade_book_spec_edits` file) so that the Doc matches R08 and R14.
9. **FOMC presser rule (R11):** recheck the post-May-2026 pressers as the new chair's sample grows.
10. **Known data fragility in `dash-trend`:** MOF JGB file intermittently 404s (falls back to stored closes); CSI300
    on the 510300.SS ETF goes stale over China holidays; USDCNH vol percentile is short-sample until about Feb 2027;
    no second price source, so the cross-check always reads `XCHECK_NA`.
11. **Housekeeping left over from the audit:** about forty merged or superseded branches (threads cannot delete
    branches; GitHub's "Automatically delete head branches" setting would stop new ones piling up); the scheduled
    task "TEMP merge test" can only be deleted by the owner (https://claude.ai/code/routines/trig_01NymU4Af4gkJGUAQUZz3DHK);
    the `dash-probe` stub can be deleted in the Supabase dashboard whenever convenient.
12. **Data problems the weekly review's dry runs found (10 Nov), none fixed yet.** For whoever next touches the
    scorer: a daily bar series that disagrees with the hourly bars and sets a stop flag in `live_marks`; a bad
    hourly tick that sets a target flag; the daily fields of `live_marks` one bar behind on US-session proxies;
    `dash.bars` at `1d` holding several rows for one date; two questions that left the digest unscored after
    26 Oct; scorecard subtotals and hit counts that differ from the database; one malformed `dash.tested` row;
    `review_inputs` counting a void card as missed; no `dash.trend_run` row for 4 or 9 Nov; `first_seen` is a UTC
    date. The review prints these under their own heading each week (`docs/weekly_review.md`).
13. **GDELT second sources from the cloud address.** Wikipedia views now arrive in two requests (action API) with
    a per-article fallback; the DOC API still refuses most requests, so its column in the table is usually blank.
    If R04's review on 23 Nov finds the DOC column is needed, route it through the `dash-gdelt` relay.

Parked, not open: drivers engine and spec v2, CFTC S3 v5 (sealed incomplete at step 15), the data-source registry,
MT Newswires, the second claude.ai account for the Fable digests, LSEG risk reversals (needs the owner's sign-in and
a compliance view). Details in `docs/history.md`.

## Decisions on record (one line each; detail in `docs/history.md` and the pull request named there)

- 10 Nov: project audit, fourteen items approved: FX trend closes at 17:00 New York (INR, IDR and CNH excepted) and
  the TM1.1 shadow retired; R13 reverted and the question hunt stopped; the frozen Opus cards closed out at the first
  hourly bar after the book ended; new threads default to Opus 5.5 at high effort; old position names in the
  public repo's history are left as they are.
- 10 Nov: Takeaways task runs on the Fable 5.2 model and label; all eleven workflow-review decisions approved.
  Models by stage: Takeaways and weekly review on Fable 5.2; YouTube, Podcast and Email digests on Sonnet 5.5 after
  three mornings side by side; feeders on Haiku 5.5; studies and builds on Opus 5.5. The fundamentals pack stays on
  Opus. One R is the card's planned risk (R17); the linear card stays the book of record during the twin trial.
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
- Upload a file to Drive without retyping it: `create_file` with `base64Content` = `sha256:<hex>:<absolute path>`,
  the file sitting in the session's scratchpad. `feeders/feeder.py` does the staging and prints the call.
- A scheduled task bound to a thread keeps that thread's model, and its prompt can be changed only from that
  thread; switching it off works from any thread. A task that starts a new thread at each run cannot be changed or
  switched back on by a thread at all (delete and create again). `create_trigger` takes no connectors here.
- Tests: `deno test supabase/functions/_shared/` (Deno is not preinstalled in cloud sessions);
  `python3 scripts/fxopt/test_fxopt.py` needs QuantLib.
- Migrations: the next number is 019. `015` exists twice (`015_drivers.sql`, `015_grokbot_source.sql`); both are
  applied, so neither is renamed. 006 to 009 and 015 to 017 were applied through the SQL editor or `execute_sql`,
  so the database's own migration list does not show them all.
