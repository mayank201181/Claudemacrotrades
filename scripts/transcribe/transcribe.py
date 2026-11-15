#!/usr/bin/env python3
"""Macro Desk transcriber: podcast and YouTube transcripts without Podwise.

Runs in the cloud (never on the owner's Mac). Set up 15 Nov 2026 by the thread "Build podcast and YouTube
transcription service". It runs beside Podwise, which stays untouched; the digests can read its output once the
owner says so.

    python3 -I transcribe.py run [--hours 26] [--max-podcasts 12] [--max-youtube 20] [--upload-dir DIR] [--dry]
    python3 -I transcribe.py one <rss enclosure url or local audio file> [--title T]   # transcribe one audio file
    python3 -I transcribe.py status

Podcasts: the shows in shows.tsv (Apple show id, name: the Podcast digest's SHOW MAP) are resolved to their RSS feeds
through the iTunes lookup API (cached in shows_cache.json). Episodes published inside the window and not yet done
are downloaded from the RSS enclosure, cut into 10-minute parts with ffmpeg and transcribed in parallel on
DeepInfra's hosted NVIDIA Nemotron 3.5 Transcribe (US$0.002 per audio minute; env deepinfra_api_key or
DEEPINFRA_API_KEY). The top-level text of each part is kept (segment text is unreliable on this host); each part
starts with its [h:mm:ss] offset.

YouTube: cloud addresses cannot fetch YouTube audio or captions (yt-dlp and caption fetches both get YouTube's
bot check from this container, 15 Nov 2026), so YouTube goes through a transcript provider. New uploads of the
400 channels in youtube_channels.tsv (tier|uploads_playlist|name|category, the YouTube digest's universe) come from
YouTube's public Atom feeds
(no key); with env SUPADATA_API_KEY each one is transcribed through Supadata (one credit a video). Without the key
the YouTube step prints what it skipped.

Output, under the data root (default /mnt/project-files/transcribe/):
  transcripts/<SGT date>/<show>__<slug>.md     one file per episode (header, then the text with offsets)
  transcripts/podcast_transcripts_<SGT date>.md the day's bundle, and podcast_transcripts_latest.md (same bytes)
  state.json                                   episodes done (guid -> file), so a rerun does nothing twice
  status.csv                                   one line per run: utc, date, episodes, minutes, usd, note
With --upload (or --upload-dir) the run prints a CREATE_FILE block for an exact Google Drive upload of the bundle
under the fixed title podcast_transcripts_latest (file reference, see feeders/README.md): the model that runs it never reads or retypes a transcript.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("TRANSCRIBE_ROOT", HERE)
DRIVE_FOLDER = "1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm"  # "Daily Digest Handoff", where the feeders upload
DEEPINFRA_URL = "https://api.deepinfra.com/v1/inference/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B"
PART_SECONDS = 600
PARALLEL = 6            # parts of one episode sent to DeepInfra at once
EPISODES_AT_ONCE = 3    # episodes handled at once (up to 18 requests in flight)
UA = "macro-desk-transcriber/0.1"
SGT = dt.timezone(dt.timedelta(hours=8))


def log(msg):
    print(f"[{dt.datetime.now(dt.timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def rpath(*parts):
    return os.path.join(ROOT, *parts)


def key(*names):
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return None


def http_get(url, timeout=60, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def slug(s, n=60):
    s = re.sub(r"[^A-Za-z0-9]+", "-", html.unescape(s)).strip("-").lower()
    return s[:n].rstrip("-") or "untitled"


def sgt_date(ts=None):
    return (ts or dt.datetime.now(dt.timezone.utc)).astimezone(SGT).strftime("%Y-%m-%d")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def record(date, episodes, minutes, usd, note):
    path = rpath("status.csv")
    new = not os.path.exists(path)
    with open(path, "a", encoding="utf-8") as f:
        if new:
            f.write("utc,date,episodes,minutes,usd,note\n")
        note = note.replace('"', "'").replace("\n", " ")
        f.write(f"{dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},{date},{episodes},{minutes:.0f},"
                f"{usd:.3f},\"{note[:400]}\"\n")


# ----------------------------------------------------------------------------------------------------- podcasts

def read_shows():
    shows = []
    with open(rpath("shows.tsv"), encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            apple_id, name = ln.split("\t", 1)
            shows.append((apple_id.strip(), name.strip()))
    return shows


def feed_url(apple_id, cache):
    ent = cache.get(apple_id)
    if ent and ent.get("feedUrl") and time.time() - ent.get("at", 0) < 14 * 86400:
        return ent["feedUrl"]
    try:
        j = json.loads(http_get(f"https://itunes.apple.com/lookup?id={apple_id}", timeout=30))
        res = j.get("results") or []
        url = res[0].get("feedUrl") if res else None
    except Exception as e:  # noqa: BLE001
        log(f"iTunes lookup failed for {apple_id}: {e}")
        url = ent.get("feedUrl") if ent else None
    if url:
        cache[apple_id] = {"feedUrl": url, "at": time.time()}
    return url


def parse_rss(xml_bytes):
    """Episodes from an RSS feed: list of dicts (guid, title, published (aware datetime), url, duration_s, link)."""
    ns = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
    try:
        root = ET.fromstring(xml_bytes)
        items = list(root.iter("item"))
    except ET.ParseError:
        # a truncated or ill-formed feed (We Study Billionaires, 15 Nov 2026): parse each complete <item> on its own
        text = xml_bytes.decode("utf-8", "replace")
        head = text[:text.find("<item")]
        nsdecl = " ".join(re.findall(r'xmlns:[A-Za-z0-9]+="[^"]+"', head))
        items = []
        for block in re.findall(r"<item\b.*?</item>", text, flags=re.S):
            try:
                items.append(ET.fromstring(f"<wrap {nsdecl}>{block}</wrap>")[0])
            except ET.ParseError:
                continue
    out = []
    for it in items:
        enc = it.find("enclosure")
        if enc is None or not enc.get("url"):
            continue
        pub = it.findtext("pubDate") or ""
        try:
            when = email.utils.parsedate_to_datetime(pub)
            if when.tzinfo is None:
                when = when.replace(tzinfo=dt.timezone.utc)
        except (TypeError, ValueError):
            continue
        dur = (it.findtext("itunes:duration", namespaces=ns) or "").strip()
        secs = None
        if dur:
            try:
                parts = [int(float(x)) for x in dur.split(":")]
                secs = parts[0] if len(parts) == 1 else sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
            except ValueError:
                secs = None
        ep_type = (it.findtext("itunes:episodeType", namespaces=ns) or "full").strip().lower()
        out.append({
            "guid": (it.findtext("guid") or enc.get("url")).strip(),
            "title": html.unescape((it.findtext("title") or "").strip()),
            "published": when,
            "url": enc.get("url"),
            "duration_s": secs,
            "link": (it.findtext("link") or "").strip(),
            "type": ep_type,
        })
    return out


def discover_podcasts(hours, state, cache):
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    found, problems = [], []
    for apple_id, name in read_shows():
        url = feed_url(apple_id, cache)
        if not url:
            problems.append(f"{name}: no feed url")
            continue
        try:
            eps = parse_rss(http_get(url, timeout=45))
        except Exception as e:  # noqa: BLE001
            problems.append(f"{name}: feed failed ({str(e)[:80]})")
            continue
        for ep in eps:
            if ep["published"] < since:
                continue
            if ep["guid"] in state["done"]:
                continue
            if ep["type"] in ("trailer", "bonus") and (ep["duration_s"] or 0) < 300:
                continue
            if ep["duration_s"] is not None and ep["duration_s"] < 300:
                continue
            ep["show"] = name
            ep["apple_id"] = apple_id
            found.append(ep)
    found.sort(key=lambda e: e["published"], reverse=True)
    return found, problems


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    return os.path.getsize(dest)


def audio_seconds(path):
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return float(p.stdout.strip())
    except ValueError:
        return 0.0


def split_audio(src, workdir):
    """16 kHz mono mp3 parts of PART_SECONDS each; returns [(start_s, path)]."""
    pattern = os.path.join(workdir, "part_%03d.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
                    "-f", "segment", "-segment_time", str(PART_SECONDS), "-reset_timestamps", "1", pattern], check=True)
    parts = sorted(p for p in os.listdir(workdir) if p.startswith("part_") and p.endswith(".mp3"))
    out = [(i * PART_SECONDS, os.path.join(workdir, p)) for i, p in enumerate(parts)]
    # an episode a hair over a multiple of 10 minutes leaves a tail of a fraction of a second, which DeepInfra rejects
    # ("no audio decoded") and which failed the whole episode (backtest 15 Nov 2026): drop tails under 2 seconds
    return [(t, p) for n, (t, p) in enumerate(out) if n == 0 or audio_seconds(p) >= 2.0]


def deepinfra(path, api_key, tries=3):
    last = ""
    for attempt in range(1, tries + 1):
        p = subprocess.run(["curl", "-sS", "--max-time", "600", "-X", "POST", DEEPINFRA_URL,
                            "-H", f"Authorization: bearer {api_key}", "-F", f"audio=@{path}", "-F", "language=en"],
                           capture_output=True, text=True)
        try:
            d = json.loads(p.stdout)
            if d.get("text") is not None and d.get("inference_status", {}).get("status", "succeeded") == "succeeded":
                return d
            last = json.dumps(d)[:200]
        except ValueError:
            last = (p.stdout or p.stderr)[:200]
        time.sleep(5 * attempt)
    raise RuntimeError(f"DeepInfra failed after {tries} tries: {last}")


def hms(s):
    s = int(s)
    return f"{s // 3600}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def transcribe_file(audio_path, api_key, workdir):
    """Returns (text with offsets, audio minutes, usd, parts)."""
    os.makedirs(workdir, exist_ok=True)
    parts = split_audio(audio_path, workdir)
    results = [None] * len(parts)
    usd = 0.0
    with cf.ThreadPoolExecutor(max_workers=PARALLEL) as ex:
        futs = {ex.submit(deepinfra, p, api_key): i for i, (_, p) in enumerate(parts)}
        for fut in cf.as_completed(futs):
            i = futs[fut]
            d = fut.result()
            results[i] = d
            usd += float(d.get("inference_status", {}).get("cost", 0) or 0)
    minutes = sum(float(d.get("duration") or d.get("input_length_ms", 0) / 1000) for d in results) / 60
    blocks = []
    for (start, _), d in zip(parts, results):
        txt = (d.get("text") or "").strip()
        blocks.append(f"[{hms(start)}] {txt}")
    return "\n\n".join(blocks), minutes, usd, len(parts)


def write_episode(ep, text, minutes, usd, parts, date):
    day_dir = rpath("transcripts", date)
    os.makedirs(day_dir, exist_ok=True)
    name = f"{slug(ep['show'], 30)}__{slug(ep['title'])}.md"
    path = os.path.join(day_dir, name)
    words = len(text.split())
    head = [
        f"# {ep['title']}",
        "",
        f"- Show: {ep['show']}",
        f"- Published: {ep['published'].astimezone(SGT).strftime('%Y-%m-%d %H:%M SGT')} "
        f"({ep['published'].astimezone(dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')})",
        f"- Audio: {minutes:.0f} min · {parts} parts · {words} words · transcription cost US${usd:.3f}",
        f"- Source: {ep.get('source', 'rss')} · {ep['url']}",
        f"- Show page: https://podcasts.apple.com/podcast/id{ep['apple_id']}" if ep.get("apple_id") else
        f"- Link: {ep.get('link', '')}",
        ("- Transcript: YouTube captions through Supadata; a speaker change is marked \">>\"; no offsets." +
         (" SHORT CLIP (under 150 words)." if words < 150 else ""))
        if ep.get("source") == "youtube" else
        f"- Transcriber: NVIDIA Nemotron 3.5 Transcribe (DeepInfra), no speaker labels; numbers are spelled out as "
        f"spoken; each block starts with its offset in the audio.",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(head) + "\n" + text + "\n")
    return path, words


def day_items(state, date):
    """Every transcript written on this SGT date (this run and earlier runs), newest publication first."""
    items = []
    for guid, ent in state["done"].items():
        if ent.get("date") != date or not os.path.exists(rpath(ent["file"])):
            continue
        pub = ent.get("published")
        when = dt.datetime.fromisoformat(pub) if pub else dt.datetime.now(dt.timezone.utc)
        items.append({"ep": {"show": ent.get("show", ""), "title": ent.get("title", ""), "published": when},
                      "path": rpath(ent["file"]), "minutes": ent.get("minutes", 0), "words": ent.get("words", 0)})
    items.sort(key=lambda it: it["ep"]["published"], reverse=True)
    return items


def bundle(date, items, problems, skipped_note):
    out = rpath("transcripts", f"podcast_transcripts_{date}.md")
    lines = [f"# Transcripts for {date} (SGT) · {len(items)} episodes", "",
             "Written by the Macro Desk transcriber (scripts/transcribe/transcribe.py), independent of Podwise. Each "
             "episode's full transcript follows the contents; no speaker labels, offsets in [h:mm:ss].", "",
             "## Contents", ""]
    for i, it in enumerate(items, 1):
        ep = it["ep"]
        lines.append(f"{i}. {ep['show']} — {ep['title']} · {ep['published'].astimezone(SGT).strftime('%d %b %H:%M SGT')} "
                     f"· {it['minutes']:.0f} min · {it['words']} words")
    if skipped_note:
        lines += ["", f"Notes: {skipped_note[:1500]}"]
    if problems:
        lines += ["", "Feeds with problems: " + "; ".join(problems)]
    lines += ["", "---", ""]
    for it in items:
        with open(it["path"], encoding="utf-8") as f:
            lines.append(f.read().strip())
        lines += ["", "---", ""]
    data = "\n".join(lines) + "\n"
    with open(out, "w", encoding="utf-8") as f:
        f.write(data)
    latest = rpath("transcripts", "podcast_transcripts_latest.md")
    shutil.copyfile(out, latest)
    return out, latest


# ------------------------------------------------------------------------------------------------------ youtube

def read_channels():
    rows = []
    path = rpath("youtube_channels.tsv")
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#"):
                continue
            p = ln.split("|")
            if len(p) >= 3 and p[1].startswith("UU"):
                rows.append({"tier": p[0], "playlist": p[1], "name": p[2], "cat": p[3] if len(p) > 3 else ""})
    return rows


def channel_feed(ch):
    """New videos of one channel from YouTube's public Atom feed (no key; reachable from the cloud, 15 Nov 2026).
    The uploads playlist UU<id> is the channel UC<id>."""
    cid = "UC" + ch["playlist"][2:]
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    root = ET.fromstring(http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", timeout=30))
    out = []
    for e in root.findall("a:entry", ns):
        vid = e.findtext("yt:videoId", namespaces=ns)
        pub = e.findtext("a:published", namespaces=ns)
        if vid and pub:
            out.append((vid, e.findtext("a:title", namespaces=ns) or "", dt.datetime.fromisoformat(pub)))
    return out


def discover_youtube(hours, state):
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)
    found, problems = [], []
    chans = read_channels()
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda ch: (ch, _safe(channel_feed, ch)), chans))
    for ch, res in results:
        if isinstance(res, Exception):
            problems.append(f"{ch['name']}: {str(res)[:60]}")
            continue
        for vid, title, when in res:
            if when < since or f"yt:{vid}" in state["done"]:
                continue
            found.append({"guid": f"yt:{vid}", "video_id": vid, "title": html.unescape(title), "published": when,
                          "show": ch["name"], "url": f"https://www.youtube.com/watch?v={vid}", "source": "youtube",
                          "link": f"https://www.youtube.com/watch?v={vid}"})
    rank = {"MKT": 0, "VOL": 0, "ENERGY": 0, "GEO": 1, "APAC": 1, "IND": 1, "BUS": 2, "AI": 2}
    tier = {"A": 0, "B": 1, "F": 2}
    meta = {ch["name"]: ch for ch in chans}
    found.sort(key=lambda e: (tier.get(meta[e["show"]]["tier"], 3), rank.get(meta[e["show"]]["cat"], 3),
                              -e["published"].timestamp()))
    return found, problems


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        return e


def supadata_transcript(video_id, api_key):
    q = urllib.parse.urlencode({"videoId": video_id, "text": "true", "lang": "en"})
    data = http_get("https://api.supadata.ai/v1/youtube/transcript?" + q, timeout=120, headers={"x-api-key": api_key})
    j = json.loads(data)
    content = j.get("content")
    if isinstance(content, list):
        content = " ".join(c.get("text", "") for c in content)
    return (content or "").strip(), j.get("lang")


def find_upload_dir():
    """<scratchpad>/upload of the session this container belongs to (same rule as feeders/feeder.py)."""
    import glob
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if sid:
        for base in sorted(glob.glob(f"/tmp/claude-*/*/{sid}")):
            if os.path.isdir(base) and os.access(base, os.W_OK):
                return os.path.join(base, "scratchpad", "upload")
    found = [d for d in glob.glob("/tmp/claude-*/*/*/scratchpad") if os.path.isdir(d) and os.access(d, os.W_OK)]
    if found:
        return os.path.join(max(found, key=os.path.getmtime), "upload")
    return None


# ---------------------------------------------------------------------------------------------------------- run

def cmd_run(a):
    api_key = key("deepinfra_api_key", "DEEPINFRA_API_KEY")
    if not api_key:
        print("FAILED: no DeepInfra key in the environment (deepinfra_api_key)")
        return 1
    date = sgt_date()
    state = load_json(rpath("state.json"), {"done": {}})
    cache = load_json(rpath("shows_cache.json"), {})
    work = rpath("work")
    os.makedirs(work, exist_ok=True)
    t0 = time.time()
    items, notes = [], []
    total_min = total_usd = 0.0

    eps, problems = discover_podcasts(a.hours, state, cache)
    save_json(rpath("shows_cache.json"), cache)
    log(f"podcasts: {len(eps)} new episodes in the last {a.hours}h" + (f"; {len(problems)} feed problems" if problems else ""))
    todo, deferred = eps[:a.max_podcasts], eps[a.max_podcasts:]
    if deferred:
        notes.append(f"{len(deferred)} podcast episodes over the cap of {a.max_podcasts}, left for the next run")
    if a.dry:
        for ep in todo:
            print(f"  would do: {ep['show']} — {ep['title']} ({(ep['duration_s'] or 0) // 60} min)")
    def do_episode(ep):
        tag = f"{ep['show']} — {ep['title'][:70]}"
        wd = os.path.join(work, hashlib.sha1(ep["guid"].encode()).hexdigest()[:12])
        os.makedirs(wd, exist_ok=True)
        src = os.path.join(wd, "audio")
        size = download(ep["url"], src)
        secs = audio_seconds(src)
        log(f"{tag}: {size / 1e6:.1f} MB, {secs / 60:.0f} min, transcribing")
        text, minutes, usd, parts = transcribe_file(src, api_key, wd)
        path, words = write_episode(ep, text, minutes, usd, parts, date)
        shutil.rmtree(wd, ignore_errors=True)
        log(f"{tag}: done, {words} words, US${usd:.3f}")
        return {"ep": ep, "path": path, "minutes": minutes, "words": words, "usd": usd}

    with cf.ThreadPoolExecutor(max_workers=EPISODES_AT_ONCE) as ex:
        futs = {}
        for ep in ([] if a.dry else todo):
            if time.time() - t0 > a.cap_minutes * 60:
                notes.append("time cap reached, remaining episodes left for the next run")
                break
            futs[ex.submit(do_episode, ep)] = ep
        for fut in cf.as_completed(futs):
            ep = futs[fut]
            tag = f"{ep['show']} — {ep['title'][:70]}"
            try:
                it = fut.result()
            except Exception as e:  # noqa: BLE001
                notes.append(f"{tag}: {str(e)[:120]}")
                log(f"{tag}: FAILED {e}")
                continue
            items.append(it)
            total_min += it["minutes"]
            total_usd += it["usd"]
            state["done"][ep["guid"]] = {"file": os.path.relpath(it["path"], ROOT), "date": date, "title": ep["title"],
                                         "show": ep["show"], "minutes": round(it["minutes"]), "words": it["words"],
                                         "published": ep["published"].isoformat()}
            save_json(rpath("state.json"), state)

    # YouTube
    sd_key = key("SUPADATA_API_KEY")
    vids, yproblems = discover_youtube(a.hours, state)
    problems += yproblems
    log(f"youtube: {len(vids)} new videos across {len(read_channels())} channels" + (f"; {len(yproblems)} feed problems" if yproblems else ""))
    if a.dry:
        for v in vids:
            print(f"  youtube: {v['show']} — {v['title']} ({v['published'].astimezone(SGT).strftime('%d %b %H:%M SGT')})")
    if not sd_key:
        notes.append(f"YouTube skipped: {len(vids)} new videos, no SUPADATA_API_KEY in the environment")
    elif not a.dry:
        if len(vids) > a.max_youtube:
            notes.append(f"{len(vids) - a.max_youtube} YouTube videos over the cap of {a.max_youtube}, left for the next run")
        def do_video(v):
            text, lang = supadata_transcript(v["video_id"], sd_key)
            if not text:
                raise RuntimeError("empty transcript")
            v["apple_id"] = None
            path, words = write_episode(v, text, 0, 0, 1, date)
            return path, words

        done_yt = 0
        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            futs = {}
            for v in vids[:a.max_youtube]:
                if time.time() - t0 > a.cap_minutes * 60:
                    notes.append("time cap reached, remaining videos left for the next run")
                    break
                futs[ex.submit(do_video, v)] = v
            for fut in cf.as_completed(futs):
                v = futs[fut]
                tag = f"{v['show']} — {v['title'][:70]}"
                try:
                    path, words = fut.result()
                except Exception as e:  # noqa: BLE001
                    notes.append(f"{tag}: {str(e)[:120]}")
                    log(f"{tag}: FAILED {e}")
                    continue
                items.append({"ep": v, "path": path, "minutes": 0, "words": words, "usd": 0})
                state["done"][v["guid"]] = {"file": os.path.relpath(path, ROOT), "date": date, "title": v["title"],
                                            "show": v["show"], "minutes": 0, "words": words,
                                            "published": v["published"].isoformat()}
                save_json(rpath("state.json"), state)
                done_yt += 1
        log(f"youtube: {done_yt} transcripts written")

    if a.dry:
        for n in notes + problems:
            print("  note: " + n)
        return 0
    out, latest = bundle(date, day_items(state, date), problems, "; ".join(notes))
    record(date, len(items), total_min, total_usd, "; ".join(notes) or "ok")
    secs = time.time() - t0
    print()
    print(f"ok: {len(items)} transcripts, {total_min:.0f} audio minutes, US${total_usd:.2f}, {secs / 60:.1f} min wall; "
          f"bundle {os.path.getsize(out)} bytes at {out}")
    for n in notes:
        print("  note: " + n)
    upload_dir = a.upload_dir or (find_upload_dir() if a.upload else None)
    if upload_dir and items:
        os.makedirs(upload_dir, exist_ok=True)
        staged = os.path.join(os.path.abspath(upload_dir), "podcast_transcripts_latest.md")
        shutil.copyfile(out, staged)
        with open(staged, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        print()
        print("CREATE_FILE (call Google Drive create_file with exactly these five arguments, nothing else):")
        print("title = podcast_transcripts_latest")
        print(f"parentId = {DRIVE_FOLDER}")
        print("contentMimeType = text/plain")
        print("disableConversionToGoogleType = true")
        print(f"base64Content = sha256:{digest}:{staged}")
        print(f"EXPECT fileSize = {os.path.getsize(staged)}")
    return 0


def cmd_one(a):
    api_key = key("deepinfra_api_key", "DEEPINFRA_API_KEY")
    wd = rpath("work", "one")
    os.makedirs(wd, exist_ok=True)
    src = a.source
    if src.startswith("http"):
        src = os.path.join(wd, "audio")
        download(a.source, src)
    text, minutes, usd, parts = transcribe_file(src, api_key, wd)
    ep = {"title": a.title or os.path.basename(a.source), "show": "adhoc", "published": dt.datetime.now(dt.timezone.utc),
          "url": a.source, "apple_id": None, "link": a.source}
    path, words = write_episode(ep, text, minutes, usd, parts, sgt_date())
    print(f"ok: {path} · {minutes:.0f} min · {words} words · US${usd:.3f}")
    return 0


def cmd_status(_a):
    path = rpath("status.csv")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            print("".join(f.readlines()[-8:]))
    state = load_json(rpath("state.json"), {"done": {}})
    print(f"{len(state['done'])} episodes done in state.json")
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--hours", type=float, default=26)
    r.add_argument("--max-podcasts", type=int, default=12)
    r.add_argument("--max-youtube", type=int, default=600, help="a day; A-tier first, then B, then firehose, markets first within a tier (the owner's Supadata Mega plan is 30,000 credits a month; 600 a day leaves headroom for his other uses)")
    r.add_argument("--cap-minutes", type=float, default=50, help="stop starting new episodes after this long")
    r.add_argument("--upload-dir", default=None, help="stage the bundle here for a Drive upload")
    r.add_argument("--upload", action="store_true", help="stage it in this session's scratchpad upload folder")
    r.add_argument("--dry", action="store_true")
    r.set_defaults(fn=cmd_run)
    o = sub.add_parser("one")
    o.add_argument("source")
    o.add_argument("--title", default=None)
    o.set_defaults(fn=cmd_one)
    s = sub.add_parser("status")
    s.set_defaults(fn=cmd_status)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
