# Morning data feeders (one runner, exact uploads)

Set up 10 Nov 2026 by the thread "Improve macro takeaways workflow for trades" (owner decisions 9 and 11 of the
workflow review, approved 10 Nov). No secrets in this folder.

## What runs

Three files feed the Macro Takeaways (starts 06:33 SGT, never waits). Each is built by a script that lives beside its
data in this shared folder, and uploaded to the Drive folder 1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm, where the Takeaways
takes the newest copy by title.

| Feed | When (SGT) | Build | Drive title | Read by |
|---|---|---|---|---|
| gdelt | 05:45 daily | gdelt/attention.py (media day, Wikipedia views, DOC API, table) | gdelt_attention_latest | rule R04 |
| odds | 06:20 daily | predmkt/predmkt.py | predmkt_latest | rule R12 |
| marketpack | 06:52 daily | marketpack/marketpack.py | market_pack_latest | Takeaways STEP 2, last item |
| fundpack | Sun 18:41 | fundpack/fundpack.py | fund_pack_latest | market pack section G (stays in its own Opus thread, the owner's wish of 6 Nov) |

`feeder.py` in this folder is the one runner (repo copy: scripts/feeders/feeder.py; keep the two identical):

    cd /tmp && python3 -I /mnt/project-files/feeders/feeder.py <gdelt|odds|marketpack|fundpack>
    python3 -I /mnt/project-files/feeders/feeder.py confirm <feed> <fileSize that create_file returned>
    python3 -I /mnt/project-files/feeders/feeder.py status

It builds the file (one retry, hard cap 9 minutes), copies it to the `upload` folder in the scratchpad of the session
it runs in (found from CLAUDE_CODE_SESSION_ID; a folder can be given as a second argument instead), and prints the
five arguments of a Google Drive create_file call whose base64Content is a file reference
(sha256:<hex>:<absolute path>). The harness sends the file's own bytes, so the model never reads or retypes the file.
`confirm` records the size Drive stored and flags a mismatch. Every run adds a line to `status.csv` here: read it,
not a thread, to see whether a morning ran.

The exact message each scheduled task sends is in `prompts/` (gdelt.txt, odds.txt, marketpack.txt, fundpack.txt).

## Who runs it

A small thread on Haiku 5.5 at low effort ("Run morning data feeders", session session_01Ps4DUcqsBktR8FWL3YZumR): the
work is one shell command, one Drive call and one confirm, so it needs no judgment. Three scheduled tasks wake it:

| Scheduled task | Id | When (SGT) |
|---|---|---|
| Feeder: media attention table | trig_01LpdVu1akXy9sHddyah3j6n | 05:45 daily |
| Feeder: prediction-market odds | trig_019jXUYgtu3beS5Zt6yxb8tH | 06:20 daily |
| Feeder: market pack | trig_01TLpx3Z2fHb3vxvebpFFASG | 06:52 daily |

A task bound to a thread keeps that thread's model, and its prompt can be changed only from that thread: to change
one, message the thread with the exact new text, or delete the task and create it again bound to the same session.
Before 10 Nov 2026 three threads on Fable and Opus woke 250 to 320 thousand tokens of context each morning to run a
script and retype up to 53 KB. A run on the Haiku thread costs about 5 US cents (measured 10 Nov: 25 cents for the first turn and three runs).

## Rules for whoever runs or changes this

- Never retype a file into Drive. Never read the built file into the conversation.
- Threads cannot trash Drive files; older copies with the same title stay, readers take the newest.
- Fix a data problem in the script, not in the prompt. After a change: copy the script here, run the feed once by
  hand through feeder.py, upload, confirm.
- One build at a time per feed: two threads building the same feed in the same minute write the same files.
- A failed build prints FAILED and uploads nothing, so the Takeaways reads yesterday's copy, which carries its own
  date. The owner is told only when a feed fails on two days running (the runner prints TELL OWNER: yes).

## GDELT notes (10 Nov 2026)

- Wikipedia views now come 50 articles a request from the action API (prop=pageviews); the counts equal the
  per-article route on all 84 articles (85,327 day values compared, no difference). That route can show the newest
  day as empty, so a topic lacking it falls back to the per-article route, where a refused request goes back in the
  queue instead of being waited on.
- The table prints a Wikipedia or DOC reading only when it is current (at most 1 and 2 days older than the media
  day). Before this it printed each topic's last reading whatever its age.
- The DOC API refuses the shared cloud address on most requests (about one success in ten minutes), so its column is
  usually blank. The data and code stay; the run gives it 90 seconds.
- Rollback: gdelt/attention.py.bak_10nov2026 is the script as it ran until 10 Nov.

## The old tasks (switched off 10 Nov 2026, not deleted)

GDELT trig_01UvLHEc5HZn6cbcCtbsdGob (thread session_01TkSFLHdxgMSjsjRYEi22dZ), odds trig_01Uz92j76ozWE1EJ3SHxbHWz
(thread session_01Ps4DUdXD3qyRdvyssX9PYB), market pack trig_01KTuAEzuMfvBNr98nBEEfhk (thread
session_01Ps4DUhAtYdAE3SRHWWbvtU). Each ran its script in its own long thread and retyped the file into Drive. To go
back: switch the three "Feeder:" tasks off and these three on (`update_trigger enabled`), never both sets at once.
Delete the old three after a clean week. The fundamentals pack was not moved; `prompts/fundpack.txt` is ready if its
thread should use the runner too.

## Tested 10 Nov 2026

Each feed was built and uploaded once from the building thread and once by the Haiku thread from its scheduled task
(fired by hand); every Drive file size equalled the built file (see `status.csv`). The failure path was tested with a
broken script path: FAILED, nothing uploaded, TELL OWNER no on the first day.
