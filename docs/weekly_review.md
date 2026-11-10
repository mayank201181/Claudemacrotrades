# Weekly review (rewritten 10 Nov 2026)

What it is: the scheduled task "Macro Desk weekly review" (Sat 09:53 SGT, a fresh session each week, connectors Gmail
and Supabase). It reads the scored record of the Macro Takeaways trade book and questions, runs a fixed set of cuts,
writes the week's lessons to `dash.lessons`, and emails the owner. Since 10 Nov 2026 it must end with **up to two rule
proposals or the line "none, because …"**. A proposal goes in force the next Sunday 20:00 SGT unless he replies
"oppose Rnn" ("Macro Desk apply rules", Sun 20:10 SGT, reads the replies).

The prompt is not stored in this repo as text. It is built by `scripts/weekly_review/build_prompt.py` from the prose in
that file and the query in `scripts/weekly_review/cuts.sql`:

```
python3 -I scripts/weekly_review/build_prompt.py --to <owner address> > prompt.txt   # store this on the task
python3 -I scripts/weekly_review/build_prompt.py                                     # placeholder copy, for reading
```

The builder prints the byte count and md5 on stderr. After storing a new prompt, read the task back and compare both.

## What changed on 10 Nov 2026, and why

Before the rewrite the review could propose a rule but nothing made it: the five reviews from 5 Oct to 2 Nov 2026
produced lessons and not one proposal, and findings could end in "worth checking". The rewrite makes three things
mandatory.

- **Standing cuts.** One query (`cuts.sql`) run every week exactly as written: closed cards by asset class, crowd
  side, class, side, edge, p at gate and fill against REF; the book counts; the thin-edge line; cards against their
  shadowed alternates (R19); card against option twin (R18); and the digest's landing times.
- **Check it yourself.** A finding may not end in "worth checking". The review writes the select that settles the
  point and reports the answer in the same email.
- **Propose or say why not.** Up to two proposals, or "none, because" with the candidate that came closest, the number
  it is short of and the week it should be decidable. A candidate carried by both of the last two reviews is proposed
  or dropped, never carried a third time.

It also carries three standing decisions as one line each, every week, until each is made: the thin-edge test at 30
closed cards, the option twin trial (R18, ten finished pairs or 12 Dec 2026) and the expression table (R19, 15 cards or
six weeks).

## Definitions the prompt fixes

- **Book of record** is R as booked (`cum_r`): what the scorecard prints and what every standing decision and revert
  condition is judged on. `cum_r_planned` is a lens only: each card's R on the risk it planned, |REF − stop|, which
  takes the fill gap out of a comparison between buckets. A card filled before R17 keeps its booked R (R17 item 5); a
  card filled under R17 carries a `risk` key and the two numbers are the same.
- **Wins and targets.** A win is a card closed at +0.1R or better, as the scorecard counts wins (a close inside
  ±0.1R is flat). A target is a card closed at its target (`status = 'closed-target'`). The scorecard's "hits" are
  targets too, so a scorecard hit count that differs from the cuts' targets is a data problem, not a second
  definition.
- **Rule status.** A rule with status `proposed` is described as pending and never used to judge the book. Its part of
  the cuts (twins, alternates, the risk key) is empty until its first run.
- **Fill against REF.** The last bucket holds cards filled after more than half the planned stop distance had gone.
  A card filled there after R17's first run is void. One filled before it keeps its booked R; R17 item 5 restates
  one card only.
- **Landings.** Late means sent after 08:15 SGT or not sent. The deadline dates from 6 Nov 2026, when the run moved to
  a 06:33 SGT start. A day with no digest, or one built hours late, is an operations failure and is reported as that;
  it counts against a rule's revert condition only when no such failure explains it and the delay is under an hour.
- **What a proposal may change.** It may tighten the gate, a fill, an exit or the scoring, add a check, or add a line
  the digest must write or carry. It may never loosen the gate or weaken the accuracy, verification or privacy rules.
- **Data problems** (scorecard against database, daily against hourly bars, a mark against its log line, a malformed
  row, a feed with a missing day) get their own heading in the email and a `data_problems` key in the lessons row.
  They are not lessons and not proposals; they exist so the code gets fixed.

## Testing a change

Fire the task by hand with a note appended (the note is not stored):

> DRY RUN … send NO email, do NOT call dash.propose_rule, do NOT call dash.record_lessons, run only select statements …
> print the JSON you would have passed and the email body, then a PROMPT TEST section listing anything unclear or
> failed.

Two dry runs were made on 10 Nov 2026 (about 8 minutes each, on the task's own model). The first found the points the
definitions above settle. The second ran the cuts query unchanged at the first attempt and ended with two drafted
proposals, which is the behaviour the rewrite is for; its remaining notes (how a saved result is wrapped, the
scorecard's flat band, the label of the last fill bucket) went into the prompt as stored. Both left no email, no
lessons row and no rule, checked in the database and the mailbox afterwards.

## Limits

- `dash.review_inputs(7)` returns over 200,000 characters. The harness saves a result of that size to a file and the
  prompt tells the review how to load it; the function itself is unchanged. In that file the opening
  `<untrusted-data-…>` tag appears three times (in the sentence before the rows, before the rows, and in the sentence
  after them) and the closing tag once, so the rows are the text between the closing tag and the last opening tag
  before it.
- Some revert conditions turn on things the database does not hold (a mis-cited figure, a missing Drive file). The
  review tests what the data can show, whether the rule's line appears in each day's digest, and labels the check as
  that.
- The cuts cover the Fable book's linear cards. Convexity cards (R01) are few and are read from `review_inputs`.
- An alternate whose proxy and side already had an open shadow row keeps the older row's reason, so the
  card-against-alternates counts are a floor.
- `first_seen` is a UTC date, so a card written before 08:00 SGT counts on the day before in the 28-day counts.
