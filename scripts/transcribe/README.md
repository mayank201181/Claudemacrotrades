# Transcriber (podcasts and YouTube without Podwise)

Set up 15 Nov 2026 by the thread "Build podcast and YouTube transcription service". The running copy is
`/mnt/project-files/transcribe/` (keep `transcribe.py`, `shows.tsv` and `youtube_channels.tsv` byte-identical with
this folder). It runs beside Podwise. Since 15 Nov (the owner's yes) the Opus Podcast and YouTube digests read these transcripts
first and send only what they lack to Podwise, which stays as the backup.

- **Podcasts (live):** `shows.tsv` holds the 30 Apple show ids of the Podcast Digest's SHOW MAP, The Macro
  Trading Floor, and since 15 Nov nine shows the digests cited that the list lacked (39 in all; the backtest found them). The iTunes lookup API gives each RSS feed; episodes published inside the window (26 h) and not in
  `state.json` are downloaded from the enclosure, cut into 10-minute parts and transcribed on DeepInfra's hosted
  NVIDIA Nemotron 3.5 Transcribe (US$0.002 an audio minute; env `deepinfra_api_key`, already in the Full access
  environment). Three episodes at once, six parts each. No speaker labels; numbers as spoken.
- **YouTube (live from 16 Nov):** cloud addresses cannot fetch YouTube audio or captions (yt-dlp and caption
  fetches both get YouTube's bot check from the container, 15 Nov 2026; never work around it), so captions come
  through Supadata (env `SUPADATA_API_KEY`; the owner's Mega plan, 30,000 credits a month, one credit a video).
  New uploads of all 400 channels of the YouTube digest's universe (`youtube_channels.tsv`: 89 A, 281 B, 30
  firehose) are found through YouTube's public Atom feeds, no key; up to 600 a day are transcribed, A-tier first,
  then B, then firehose, markets channels first within a tier (a Saturday had 336 new videos). Eight at a time; the
  `--cap-minutes` clock applies, and a rerun continues. A transcript under 150 words is marked SHORT CLIP.
- **Output:** `transcripts/<SGT date>/<show>__<slug>.md` per item (header, then text; podcasts carry `[h:mm:ss]`
  offsets). Each run rebuilds the SGT day's files from `state.json`: `podcast_transcripts_<date>.md` (Drive title
  `podcast_transcripts_latest`), `youtube_transcripts_<date>_pNN.md` (about 2.4 MB each, A-tier first; Drive title
  `youtube_transcripts_latest_pNN`) and `transcripts_index_<date>.md` (Drive title `transcripts_index_latest`: the
  date on line 1, reading notes, then one TSV row per item: kind, id, file, show or channel, tier, published SGT,
  minutes, words, title). Every item starts with `=== ITEM <id> ===` (the video id, or `pod-` and ten hex of the
  guid's sha1). `--upload` stages them and prints one CREATE_FILE block per file, the index last, for exact Drive
  uploads into folder 1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm (readers take the newest copy of each title).
  `bundle [--upload]` rebuilds and restages the day's files without transcribing.
  `status.csv` has one line per run; `state.json` is the done list.
- **Schedule:** the scheduled task "Feeder: podcast transcripts" (`trig_011ybXd1mZjsDPYWFyu7VtX6`, daily 04:20
  SGT) wakes the Haiku feeder thread with `scripts/feeders/prompts/transcripts.txt`.
- **First run, 15 Nov 2026 17:18 SGT:** 5 episodes, 225 audio minutes, US$0.45, 4.3 minutes wall.

    cd /tmp && python3 -I /mnt/project-files/transcribe/transcribe.py run --dry      # what it would do
    cd /tmp && python3 -I /mnt/project-files/transcribe/transcribe.py run --upload   # the daily run
    python3 -I /mnt/project-files/transcribe/transcribe.py one <audio url>           # one file, ad hoc
    python3 -I /mnt/project-files/transcribe/transcribe.py status

## Backtest (15 Nov 2026)

`backtest.py prepare | transcribe | score` transcribes every episode of the listed shows over a window and every
YouTube video the digests cited, then checks each digest's cited items against our transcripts (coverage, names,
numbers, against a wrong-transcript baseline). Its data stays in `/mnt/project-files/transcribe/backtest/`, never
here (digest text is private).
