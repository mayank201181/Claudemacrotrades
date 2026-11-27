# Exa sweep trial (overnight official announcements)

Started 20 Nov 2026 (thread "Trial Exa for overnight announcements"). The owner connected the Exa search connector
and asked whether it would help catch new announcements across the countries and markets the desk tracks. The answer
given was: for one narrow job, unscheduled official announcements from primary sources, and only if a one-week trial
shows it finds things the Takeaways inputs miss. He said yes to the trial. Verdict due Fri 27 Nov 2026.

## What was tested first (20 Nov, about 20:30 SGT)

- **Freshness: passed.** Through Exa's page reader, same-day items were on the listing pages of the RBI (press
  releases and notifications), BoJ, MOF Japan, PBoC (Chinese news page), SAFE, Bank of Korea (Korean list), Bank
  Indonesia, HKMA, Taiwan's central bank, RBA, US Treasury, ECB (RSS), BoE (RSS), Bank of Canada and SNB. Exa's search
  returned same-day wire and official items for Korea, China, the Philippines and the Fed (a regional Fed speech from
  the previous New York evening was indexed with full text).
- **Not readable through Exa's page reader:** MAS, BSP, Bank Negara, Bank of Thailand, RBNZ, Norges Bank, Riksbank,
  OJK, Korea's finance ministry, the Bank of Korea's and PBoC's English lists, the Fed's press page (its RSS feeds come
  back without dates). The trial reaches those by search only, which is the weaker route: for them it sees what a
  wire or local paper has written up, not the regulator's own page.
- **A scheduled-task run can reach Exa: passed.** The sweep task, fired by hand at 20:31 SGT, started a new project
  thread, loaded the Exa tools, made 19 Exa calls (two answered 429 when sent in a burst and passed on one retry; the
  prompt now caps a burst at four), rendered 16 of 16 listing pages and uploaded a 7,692-byte file by file reference in
  under four minutes. The scorer, fired at 20:38, read that file, ran its one SELECT and the market pack read, and
  wrote its score file and log line in about two minutes.

## How the trial runs

Two scheduled tasks, each starting a fresh project thread per run (prompts in `scripts/exa_sweep/`, the same files as
project files `exa_sweep/`). A task of this kind runs on the project's default model with the project's connectors,
and a thread cannot edit it or switch it back on: to change a prompt, delete the task and create it again (deleting
also removes the threads it started). Sweep `trig_01RzPWAmrdbSyE8DzcJdFkyz`, score `trig_01AjMo1rkETBGEQMsaWByxu3`.

| Task | When (SGT) | What it does |
|---|---|---|
| Exa sweep trial: overnight official announcements | 05:51 daily | 2 page-reader calls (16 listing pages) and 14 searches by country group, at most 19 Exa calls; writes Drive `exa_sweep_latest` (folder `1LLeu…`) and a dated copy in project files `exa_sweep/sweeps/`. Items carry a grade: H unscheduled action or remark, M policy-relevant, L context |
| Exa sweep trial: daily score | 08:47 daily | reads the sweep file, looks each H and M item up in today's `dash.digests` and `dash.feeds` rows (one regex SELECT) and in the market pack's headlines, tags it DIGEST / INPUT ONLY / NEW / LATE, grades the misses MATERIAL or MINOR; writes Drive `exa_sweep_score_<date>`, a copy in `exa_sweep/scores/` and one line in `exa_sweep/score_log.csv`. It messages the owner only on a material miss |

The Takeaways does **not** read the sweep file during the trial. That is deliberate: the test is what the existing
inputs miss, and a digest that already reads the file cannot show that. If the verdict is keep, the file is ready
for the Takeaways to read (a rule through `dash.rules`, since the prompt is near its size cap).

## Keep or drop

Keep if, over the seven mornings, the sweep produces at least two MATERIAL items that neither the digest nor any
input carried and that were published before the 06:33 start, with no fabricated or misdated item among the H and M
items checked. Drop otherwise, and say which part (page reader, search) earned or failed it. The cost per morning
goes in the verdict.

## Verdict (Fri 27 Nov 2026)

Six mornings scored (25 Nov had no sweep: the Exa connector's sign-in was refused at that run). Totals from
`score_log.csv`, then every MATERIAL item re-read by hand against the stored digest and its feeds:

| 21 to 27 Nov | Items |
|---|---|
| Scored (H and M) | 40 |
| Already in the Fable digest | 18 |
| In an input, dropped by the digest | 6 (none material) |
| New, graded material by the scorer | 5 |
| ... of which real and material after the hand re-check | 3 |
| ... of which real but minor (outside the book) | 1 |
| ... of which misdated | 1 |
| Late (after 06:30) | 0 |

The three real misses were all Asian FX official remarks or actions published the previous afternoon (Bank Indonesia
twice, the Bank of Thailand governor once), found by search through local-language press, not by the page reader.
The misdated item was a flash from an aggregator site that re-served a weeks-old Japanese finance ministry remark
under a new date. Strictly the keep rule fails on that item (it allows no misdated H or M item); the two-item
threshold is cleared. Recommendation to the owner: keep, with a fix: the sweep never uses gmteight.com or
gmt8press.com or any flash aggregator, and an H item needs its own primary page or two independent dated sources,
else it is M marked "single source". The page reader earned little on its own (listing pages mostly carried routine
items); search earned the misses.

Cost: two short runs a day. They ran on the project's default model, Fable 5.1, on 21 Nov (about US$4.70 for the
sweep) and on Opus 5.5 from 22 Nov after the default changed.

The scorer was switched off on 27 Nov. The owner chose keep with the fix (27 Nov). The trial sweep task was switched
off and the sweep re-created as `trig_01SZVyo7MymHk7FFPX6Wd3rx` (05:51 SGT) with the fixed prompt in
`scripts/exa_sweep/sweep_prompt.txt`. Rule R40 (`supabase/rules/R40_exa_sweep.sql`) lets both Takeaways read Drive
`exa_sweep_latest` from Sun 29 Nov 20:00 SGT, as dated leads confirmed at source before they move a view; review 27 Dec.

## Known limits

- Exa's search tool takes no date filter: recency rests on the query wording and on dropping undated results.
- The scorer's lookup is by regular expression over stored text; a paraphrased mention can be missed, which would
  overstate NEW. The verdict re-reads every MATERIAL item by hand.
- No file here or in the repo holds digest or trade data. The score files (private Drive and project files) quote
  at most 15 words of a digest line and never a card.
