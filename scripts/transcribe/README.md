# Transcriber (podcasts and YouTube without Podwise)

Set up 15 Nov 2026 by the thread "Build podcast and YouTube transcription service". The running copy is
`/mnt/project-files/transcribe/` (keep `transcribe.py`, `shows.tsv` and `youtube_channels.tsv` byte-identical with
this folder). It runs beside Podwise; Podwise and the digest prompts are unchanged until the owner says otherwise.

- **Podcasts (live):** `shows.tsv` holds the 30 Apple show ids of the Podcast Digest's SHOW MAP (plus The Macro
  Trading Floor). The iTunes lookup API gives each RSS feed; episodes published inside the window (26 h) and not in
  `state.json` are downloaded from the enclosure, cut into 10-minute parts and transcribed on DeepInfra's hosted
  NVIDIA Nemotron 3.5 Transcribe (US$0.002 an audio minute; env `deepinfra_api_key`, already in the Full access
  environment). Three episodes at once, six parts each. No speaker labels; numbers as spoken.
- **YouTube (built, waiting on keys):** cloud addresses cannot fetch YouTube audio or captions (yt-dlp and caption
  fetches both get YouTube's bot check from the container, 15 Nov 2026; never work around it). The 89 A-tier
  channels in `youtube_channels.tsv` are scanned through YouTube's public Atom feeds (no key, reachable from the
  cloud; 44 new videos in the 26 hours to 15 Nov 17:30 SGT) and with env `SUPADATA_API_KEY` up to 30 a day are
  transcribed through Supadata, markets, vol and energy channels first (one credit a video; Pro is about US$17 a
  month for 3,000). The key went in on 15 Nov 17:56 SGT and a three-video test passed; the daily run covers YouTube from 16 Nov. A transcript under 150 words is marked SHORT CLIP (a YouTube Short still costs one credit).
- **Output:** `transcripts/<SGT date>/<show>__<slug>.md` per episode (header, then text with `[h:mm:ss]` offsets),
  the day's bundle `podcast_transcripts_<date>.md` and `podcast_transcripts_latest.md` (every transcript of the SGT
  day). `--upload` stages the bundle and prints a CREATE_FILE block for an exact Drive upload under the fixed
  title `podcast_transcripts_latest` in folder 1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm (readers take the newest copy).
  `status.csv` has one line per run; `state.json` is the done list.
- **Schedule:** the scheduled task "Feeder: podcast transcripts" (`trig_011ybXd1mZjsDPYWFyu7VtX6`, daily 04:20
  SGT) wakes the Haiku feeder thread with `scripts/feeders/prompts/transcripts.txt`.
- **First run, 15 Nov 2026 17:18 SGT:** 5 episodes, 225 audio minutes, US$0.45, 4.3 minutes wall.

    cd /tmp && python3 -I /mnt/project-files/transcribe/transcribe.py run --dry      # what it would do
    cd /tmp && python3 -I /mnt/project-files/transcribe/transcribe.py run --upload   # the daily run
    python3 -I /mnt/project-files/transcribe/transcribe.py one <audio url>           # one file, ad hoc
    python3 -I /mnt/project-files/transcribe/transcribe.py status
