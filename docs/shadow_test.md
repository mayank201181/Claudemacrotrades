# Split-run shadow test of the Macro Takeaways

Decision 7 of the workflow review (approved 10 Nov 2026). Set up that day by the thread "Improve macro takeaways
workflow for trades". The working copy of everything here, with the evidence files and the audits, is in project
files `shadow_test/` (its `README.md` is the hand-over). Evidence files and audits hold digest content and never
come into this repo.

## The question

One large model reads every overnight input itself and writes the Macro Takeaways. A split would let a cheaper model
read every copy of every feed and write one evidence file, each claim once with the copies that carry it, and the
large model would decide from that file, the market pack, the rules and the book. The test runs the cheaper reader
beside the live run for five mornings (Thu 12 to Mon 16 Nov 2026) and asks whether the evidence file lost anything
the live digest rested on.

Pass rule, as approved: on all five mornings no trade card, odds call or headline view in the live digest rests on a
claim that was in an input the reader had and is not in its evidence file. The same audit counts which copies stand
behind the claims the digest used, which is the measure of what each extra copy adds.

## The two halves

| Half | Who | When (SGT) | Output |
|---|---|---|---|
| Evidence pass | scheduled task "Takeaways evidence pass [shadow test, Sonnet 5.5]", `trig_01PDjNqUabmAdt9VoCVMwUwx`, a fresh session each run | 06:33 on 12 to 16 Nov, four inbox sweeps (start, 07:20, 07:50, 08:10) | Drive file `evidence_<date>` in the test folder |
| Audit | project thread "Audit the split Takeaways shadow test" (Opus 5.5), woken by `trig_01KLyghYVbzNJZL8dqhQM5dT` | 09:05 on the same mornings | `audit_<date>.md` and `.tsv`, one row in `results.csv`, in project files |

The evidence task is the old Opus Macro Takeaways task (switched off on 31 Oct by the owner's choice), reused because
a thread cannot give a new scheduled task the Gmail and Drive connectors. Its former prompt is kept in project files
`shadow_test/backup/`. The verdict goes to the owner once, on Mon 16 Nov, as one yes/no from the workflow thread;
neither half mails or messages him. After the test the task is switched off, or its schedule would fire again on the
same dates a year later.

## The evidence pass (`scripts/shadow_test/`)

The task's prompt is built from parts and holds its own script and reader brief between marker lines:

    python3 -I scripts/shadow_test/build_prompt.py <out file>     # head.txt + setup.txt + steps.txt + ev.py + brief.md

A fired session starts with nothing but its prompt, so its SETUP copies `ev.py` and `brief.md` out of its own prompt
(it finds the text in its transcript file) and runs `ev.py selftest`. Then, per sweep: three Gmail searches, the new
threads sorted into groups by subject, one reader sub-agent per group (YouTube, Podcast, Email, Slack with Grok and
the crowding check, desk inputs with EconVitals, then the peer takeaways), each writing a part file of blocks and
claim lines in a fixed shape. `ev.py check` validates a part file, `ev.py wait` sleeps to the next sweep in calls of
at most four and a half minutes, and `ev.py finish` builds the evidence file: totals, the input list, a tally of what
each copy carries, a topic index, every block and claim, what was left out, and the stance rows. It then checks every
figure in every claim against the saved text of the copies the claim names, and every video and episode link of each
saved copy against the blocks. The file goes to Drive by file reference, so the model never retypes it.

The pass never opens the Fable or Opus Macro Takeaways email and carries no personal or admin items.

To change the prompt: edit the parts, rebuild, store the built text with `update_trigger`, read it back and compare it
byte for byte with the built file. Never retype the script by hand. A dry run is `fire_trigger` on the task with a
note that starts "DRY RUN": it replays the morning by landing time and uploads under a `_dryrun` title.

## The audit (`audit.txt`, `audit.py`)

The auditor reads the live digest and the evidence file, lists the judged items (headline views, odds calls, cards),
writes down the claims each one rests on, and gives each claim a verdict: CARRIED, DEGRADED, LOST, INPUT NOT READ or
NOT A FEED CLAIM. A morning passes with no LOST and no INPUT NOT READ. `audit.py find` searches the evidence file
(a term matches at the start of a word, a short term or a number only as a whole word), `audit.py close` checks the
auditor's table, writes the day's report with the count of claims behind each copy, and adds a row to `results.csv`.

## What the dry runs showed (10 Nov 2026)

- Dry run 1, on that morning's inputs: about 15 minutes of work and about US$7 at list prices for the pass, 17 inputs
  read, 1,290 claims in a file about a quarter of the inputs' size, uploaded byte for byte. The audit took about five
  minutes and passed with no claim lost or degraded. That morning was looser than a normal one: the live digest was a
  midday catch-up, so every input had landed long before it ran.
- A digest email can carry only its top section in its plain-text part and the whole text in its HTML part, and
  nothing in the plain part says that it is cut. The Macro Takeaways email does this by design. Anything that reads a
  digest email through the Gmail connector must ask for FULL_CONTENT; `ev.py read` compares the two parts, takes the
  HTML one when it is clearly longer and prints which it used.
- An input that lands late would be read by the live run at its last pickup and missed by a reader that stopped at
  07:50, so the pass sweeps a fourth time at 08:10.
- Readers wrote file names where copy names belonged, short search terms matched inside ordinary words, and the
  figure check flagged thousands commas and bold markers. All are handled by script now (`canon`, word-start
  matching, a stricter figure pattern).

## Limits

- The reader carries no personal or admin items, so the digest's admin line is outside the test.
- A small email that comes back in the conversation is not saved, so the scripted figure and coverage checks cover
  the saved inputs only.
- The test measures loss, not timing. With four sweeps the evidence file lands after the live digest is due, so a
  production split would need the reader to start earlier or the deciding run to start later.
