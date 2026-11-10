# Trade book retention (spec v16)

Applied 25 Oct 2026 after the Fable Macro Takeaways footer flagged the trade book at 72,822 characters against the
60,000 cap with the cap ladder exhausted (CAP FLAG; the 24 Oct run was already at 63,661). The owner asked how to
resolve it; the thread took the option that needed him least and wrote it into `trade_book_spec` (version 16) through
the hands-off edits file that `Spec.gs` applies. Both books read the same spec, so the Opus book (11.7k) follows the same
rules from the Mon 26 Oct 07:15 SGT run.

## What changes

- **Cap unchanged.** TRADE DOC CAP stays at 60,000 characters. The spec now says never to raise it: on 23 and 25 Oct the
  over-cap files the run wrote stayed plain text instead of converting to a Google Doc, and the dashboard feeder
  (`Code.gs`, which opens the book with DocumentApp) could not read them. A smaller file is the safer write.
- **T lines: two days.** The TESTED ledger in the book keeps today's and the previous run's lines (was 14 days). Every
  T line already lands in `dash.tested` on the day it is written.
- **SECTION LOG: 14 days** of Pnn lines (was 30). Every line already lands in `dash.trade_log`.
- **Closed, missed, vetoed and void blocks** are compressed on the day they close to the header, the META line, the fill
  mark and the closing mark (THESIS, INVALIDATION and STRUCTURE drop out), and dropped 14 days after the close date.
  Scorecard counts and cum R are carried forward in SCORECARD, and the full block is in that day's Drive archive and in
  `dash.trades` / `dash.trade_marks`.
- **Open trades: at most 5 mark lines** (the fill mark and the latest 4).
- **RULES line: at most 600 characters.** It had grown to 4.4k by restating rules the spec already holds; it now points
  at the spec section (STEP 3E).
- **Tighter ladder** when the file is still over the cap: (1) drop T lines older than today; (2) cut marks to 3 per
  trade; (3) cut SECTION LOG to 7 days; (4) drop closed, missed, vetoed and void blocks older than 7 days. Still over
  after that: keep the file as it stands and raise a CAP FLAG in the footer and in B8, as before.
- **First run under v16** applies the retention to the existing file and rewrites the RULES line.

## Where the 25 Oct file's size went

| Part | Characters |
|---|---|
| Trade blocks (open and closed) | 34.5k |
| SECTION LOG Pnn lines | 17.9k |
| T lines (four days) | 14.8k |
| RULES line | 4.4k |

A simulation of v16 on that file gave about 56,000 characters before the ladder and 37,460 after it.

## Where the history lives

The book is a working copy, not the record. Each run archives the previous day's file on Drive as
`trade_book_archive_<date>`, and `dash-ingest` stores every ingested book in `dash.raw`, every trade in `dash.trades`,
every mark in `dash.trade_marks`, every LOG line in `dash.trade_log` and every T line in `dash.tested`. Scoring, the
scorecard and calibration read the database, not the file, so shorter retention loses nothing.

One property of the ingest matters for any manual upload: for every day that appears among the book's T lines, the
ingest deletes that day's `dash.tested` rows and inserts the book's. A book that carries T lines for a day therefore
replaces that day's ledger set.

## The 23 and 25 Oct plain-text files

The files the Fable run wrote on 23 Oct (68k bytes) and 25 Oct (76k bytes) stayed `text/plain` instead of converting
to a Google Doc; the 24 Oct file (63,661 characters) converted. `Code.gs` picks the newest `trade_book_current` and opens
it with DocumentApp, which throws on a plain file and aborts that sync, so the dashboard missed both books until the
25 Oct one was re-uploaded as a Doc by hand. Size is not the whole explanation (a 72,822-character manual upload
converted), so the first v16 run's file should be checked for its type as well as its size.

## Incident on 25 Oct and the lesson

While restoring the 25 Oct book as a Doc, the thread first uploaded a file whose content had been reconstructed from
memory after a context reset, not read from the real file. It converted, was named `trade_book_current`, and the
feeder ingested it at 01:19Z (`dash.raw` 663) before the error was caught by a diff against the real file. The real
book was then uploaded, verified by a read-back diff (every line identical) and ingested at 01:49Z (664), which put the
22-25 Oct ledger sets, trades and book state right. The residue (marks for five trade-days the wrong file alone
carried, the 15 Oct ledger set, 99 LOG lines, 32 orphan idea outcomes and the raw copy) is cleaned by one SQL kept in
the project files, run or approved by the owner because it deletes rows.

Lesson, now in STATUS working conventions: never write Drive or database content from memory. Generate it from the
source file, verify it by a read-back diff, and only then rename it into place.
