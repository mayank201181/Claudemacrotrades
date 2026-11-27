#!/usr/bin/env python3
"""Backtest the transcriber against what the Podwise-fed digests cited (owner's ask, 15 Nov 2026).

    python3 -I backtest.py prepare <digests.json> <out dir>       # build the episode universe and the targets
    python3 -I backtest.py transcribe <out dir> [--parallel 6]     # transcribe every target (resumable)
    python3 -I backtest.py score <digests.json> <out dir>          # coverage and content checks -> report.md

digests.json: rows of dash.feeds (family, source, d, subject, body) for the YouTube and Podcast digests, exported by
the thread. Nothing here reads or writes Podwise; data stays in the out dir (project files), never in the repo.

Podcasts: the episode universe is the iTunes episode list (last 200 per show) of every show in shows.tsv, published
in the window; an Opus digest cites episodes by Apple episode id, the ChatGPT and Gemini copies by title. Every
universe episode is transcribed (what the digests missed counts too). YouTube: every video id any digest cites is
looked up on YouTube oEmbed (title, channel, or "does not exist") and transcribed through Supadata.
Content check: for each cited item, the names (capitalised words) and numbers in the digest text within 1,500
characters after the citation are searched for in our transcript; numbers also match when spelled out.
"""
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import transcribe as T  # noqa: E402

UA = {"User-Agent": "macro-desk-transcriber/0.1"}


def get_json(url, timeout=40, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def norm(s):
    s = html.unescape(s or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(w for w in s.split() if len(w) > 2)


def overlap(a, b):
    a, b = set(norm(a).split()), set(norm(b).split())
    return len(a & b) / max(1, min(len(a), len(b)))


# ---------------------------------------------------------------------------------------------------- prepare

def cmd_prepare(digests_path, out):
    rows = json.load(open(digests_path))
    days = sorted({r["d"] for r in rows})
    start = dt.datetime.fromisoformat(days[0]).replace(tzinfo=T.SGT) - dt.timedelta(days=2)
    end = dt.datetime.fromisoformat(days[-1]).replace(tzinfo=T.SGT) + dt.timedelta(days=1)
    shows = T.read_shows()

    cache = T.load_json(T.rpath("shows_cache.json"), {})

    def show_eps(sh):
        # the same RSS feeds and filters the daily run uses (iTunes episode lookups proved incomplete)
        apple_id, name = sh
        try:
            url = T.feed_url(apple_id, cache)
            eps = T.parse_rss(T.http_get(url, timeout=60))
        except Exception as e:  # noqa: BLE001
            return name, [], str(e)[:80]
        out = []
        for x in eps:
            if not (start <= x["published"] <= end):
                continue
            if x["duration_s"] is not None and x["duration_s"] < 300:
                continue
            out.append({"id": T.slug(name, 20) + "__" + re.sub(r"[^A-Za-z0-9]", "", x["guid"])[-24:],
                        "show": name, "apple_id": apple_id, "title": x["title"],
                        "published": x["published"].isoformat(), "url": x["url"],
                        "minutes": round((x["duration_s"] or 0) / 60)})
        return name, out, ""

    universe, problems = [], []
    with cf.ThreadPoolExecutor(8) as ex:
        for name, eps, err in ex.map(show_eps, shows):
            universe += eps
            if err:
                problems.append(f"{name}: {err}")
    T.save_json(T.rpath("shows_cache.json"), cache)
    print(f"podcast universe: {len(universe)} episodes, {sum(e['minutes'] for e in universe)} minutes, "
          f"{start:%d %b} to {end:%d %b}; problems: {problems or 'none'}")

    yt = sorted({v for r in rows for v in re.findall(r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})", r["body"])})

    def oembed(v):
        try:
            j = get_json(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={v}&format=json", 20)
            return v, {"title": j.get("title"), "channel": j.get("author_name"), "exists": True}
        except urllib.error.HTTPError as e:
            return v, {"exists": False if e.code in (400, 404) else None, "error": e.code}
        except Exception as e:  # noqa: BLE001
            return v, {"exists": None, "error": str(e)[:60]}

    videos = {}
    with cf.ThreadPoolExecutor(12) as ex:
        for v, meta in ex.map(oembed, yt):
            videos[v] = meta
    n_ok = sum(1 for m in videos.values() if m["exists"])
    n_bad = sum(1 for m in videos.values() if m["exists"] is False)
    print(f"cited YouTube ids: {len(yt)}; exist {n_ok}; do not exist {n_bad}; unknown {len(yt) - n_ok - n_bad}")
    os.makedirs(out, exist_ok=True)
    json.dump({"podcasts": universe, "videos": videos, "problems": problems,
               "window": [start.isoformat(), end.isoformat()]}, open(os.path.join(out, "targets.json"), "w"), indent=1)
    return 0


# ------------------------------------------------------------------------------------------------- transcribe

def cmd_transcribe(out, parallel=6):
    tg = json.load(open(os.path.join(out, "targets.json")))
    pdir, ydir = os.path.join(out, "podcasts"), os.path.join(out, "youtube")
    os.makedirs(pdir, exist_ok=True)
    os.makedirs(ydir, exist_ok=True)
    api = T.key("deepinfra_api_key", "DEEPINFRA_API_KEY")
    sd = T.key("SUPADATA_API_KEY")
    t0 = time.time()
    usd = [0.0]

    def pod(e):
        path = os.path.join(pdir, e["id"] + ".txt")
        if os.path.exists(path):
            return "skip"
        wd = os.path.join(out, "work", e["id"])
        os.makedirs(wd, exist_ok=True)
        src = os.path.join(wd, "audio")
        T.download(e["url"], src)
        text, minutes, cost, parts = T.transcribe_file(src, api, wd)
        with open(path, "w") as f:
            f.write(text)
        usd[0] += cost
        import shutil
        shutil.rmtree(wd, ignore_errors=True)
        return f"{minutes:.0f} min"

    def vid(v):
        path = os.path.join(ydir, v + ".txt")
        if os.path.exists(path) or os.path.exists(path + ".err"):
            return "skip"
        try:
            text, _ = T.supadata_transcript(v, sd)
            with open(path, "w") as f:
                f.write(text)
            return "ok"
        except Exception as e:  # noqa: BLE001
            with open(path + ".err", "w") as f:
                f.write(str(e)[:300])
            return "err"

    vids = [v for v, m in tg["videos"].items() if m.get("exists") is not False]
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(vid, vids))
    print(f"youtube: {res.count('ok')} new, {res.count('err')} errors, {res.count('skip')} already done "
          f"({time.time() - t0:.0f}s)", flush=True)
    done = fail = 0
    with cf.ThreadPoolExecutor(parallel) as ex:
        futs = {ex.submit(pod, e): e for e in tg["podcasts"]}
        for f in cf.as_completed(futs):
            e = futs[f]
            try:
                r = f.result()
                done += 1
            except Exception as err:  # noqa: BLE001
                fail += 1
                r = f"FAILED {str(err)[:100]}"
            print(f"[{time.time() - t0:5.0f}s] {e['show'][:28]} — {e['title'][:60]}: {r}", flush=True)
    print(f"podcasts: {done} done, {fail} failed, US${usd[0]:.2f} this run, {(time.time() - t0) / 60:.1f} min")
    return 0


# ------------------------------------------------------------------------------------------------------ score

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
       "seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def words(n):
    n = int(n)
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + words(n % 100))
    if n < 1000000:
        return words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + words(n % 1000))
    return str(n)


def number_forms(tok):
    t = tok.replace(",", "")
    forms = {t}
    if re.fullmatch(r"\d+(\.\d+)?", t):
        a, _, b = t.partition(".")
        if len(a) <= 6:
            w = words(a)
            if b:
                forms.add(w + " point " + " ".join(ONES[int(c)] for c in b))
                if len(b) <= 2:
                    forms.add(w + " point " + words(b))
            else:
                forms.add(w)
        if b and len(b) == 2 and len(a) <= 2:      # rates and prices as spoken: 5.15 -> "five fifteen"
            forms.add(words(a) + " " + ("oh " + ONES[int(b[1])] if b[0] == "0" else words(b)))
        if not b and len(a) == 4 and a[2:] == "00" and a[:2] not in ("10", "20"):   # 3600 -> "thirty six hundred"
            forms.add(words(a[:2]) + " hundred")
        if a.startswith("20") and len(a) == 4 and not b:   # years: twenty twenty six
            forms.add(words(a[:2]) + " " + words(a[2:]))
        if b.rstrip("0") != b:                              # 0.30 -> 0.3 -> "point three"
            forms |= number_forms(a + ("." + b.rstrip("0") if b.rstrip("0") else ""))
        frac = {"5": "and a half", "25": "and a quarter", "75": "and three quarters"}.get(b.rstrip("0") if b else "")
        if frac and len(a) <= 3:                            # 4.5 -> "four and a half"
            forms.add(words(a) + " " + frac)
        for f in list(forms):
            if f.startswith("zero point "):
                forms.add(f[5:])
            if " hundred " in f:
                forms.add(f.replace(" hundred ", " hundred and "))
    return forms


STOP = set("The This That These Those What When Where Why How And But For With From Into Over Under About After Before "
           "Bottom Views Key Counterpoints Skip Ledger Primary Model Trade Theme Tape Stance Part Watch Today Yesterday "
           "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August "
           "September October November December SGT UTC GMT Listen Transcript Summary Chapters Processing Condensed "
           "Full Headline Read New Episode Video Show Host Guest Speaker Lean Flip Signal Invalidation Structure Direction "
           "Risk Reward Bold Synthesis Positioning Map Footer Accuracy Gate Numbers Source".split())


def claims(snippet):
    txt = re.sub(r"<[^>]+>", " ", html.unescape(snippet))
    txt = re.sub(r"https?://\S+", " ", txt)
    names = {w for w in re.findall(r"\b[A-Z][a-z]{3,}(?:\s[A-Z][a-z]{3,})?\b", txt) if w.split()[0] not in STOP}
    nums = {n for n in re.findall(r"(?<![\w.])\d+(?:[.,]\d+)?(?![\w])", txt)
            if not re.fullmatch(r"(19|20)\d\d|0?\d|1[0-2]", n.replace(",", ""))}   # skip years, small counters
    return names, nums


def found(tok_forms, text_l):
    for form in tok_forms:
        pattern = re.escape(form.lower())
        if form[0].isdigit():
            pattern = r"(?<!\d[.,])" + pattern + r"(?![.,]\d)"
        if re.search(r"(?<!\w)" + pattern + r"(?!\w)", text_l):
            return True
    return False


def cmd_score(digests_path, out):
    rows = json.load(open(digests_path))
    tg = json.load(open(os.path.join(out, "targets.json")))
    pods = {e["id"]: e for e in tg["podcasts"]}
    ptext = {}
    for i in pods:
        p = os.path.join(out, "podcasts", i + ".txt")
        if os.path.exists(p):
            ptext[i] = open(p).read()
    ytext = {}
    for v in tg["videos"]:
        p = os.path.join(out, "youtube", v + ".txt")
        if os.path.exists(p):
            ytext[v] = open(p).read()
    lines, stat = [], {}
    cited_pods = set()

    def snippet_after(body, pos):
        return body[pos:pos + 1500]

    per_digest = []
    for r in rows:
        key = (r["family"], r["source"])
        s = stat.setdefault(key, {"digests": 0, "cited": 0, "covered": 0, "no_such_video": 0, "names": 0, "names_hit": 0,
                                   "nums": 0, "nums_hit": 0})
        s["digests"] += 1
        body = r["body"]
        items = []
        for m in re.finditer(r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})", body):
            items.append(("yt", m.group(1), m.end()))
        for m in re.finditer(r"podcasts\.apple\.com/[a-z]{2}/podcast/([^/\s\"')\]]+)/id(\d+)[^\s\"')\]]*?[?&]i=(\d+)", body):
            words_ = m.group(1).replace("-", " ")
            cands = [e for e in pods.values() if e["apple_id"] == m.group(2)] or list(pods.values())
            best = max(cands, key=lambda e: overlap(words_, e["title"]), default=None)
            if best and overlap(words_, best["title"]) >= 0.6:
                items.append(("ap", best["id"], m.end()))
            else:
                items.append(("ap", "unmatched:" + m.group(3), m.end()))
        if r["family"] == "podcast":   # titles in anchors, for copies that link elsewhere
            for m in re.finditer(r"<a [^>]*href=\\?\"([^\"\\]+)\\?\"[^>]*>(.*?)</a>", body):
                href, title = m.group(1), re.sub(r"<[^>]+>", "", m.group(2))
                if "apple.com" in href or "youtube" in href or len(norm(title).split()) < 3:
                    continue
                best = max(pods.values(), key=lambda e: overlap(title, e["show"] + " " + e["title"]), default=None)
                if best and overlap(title, best["title"]) >= 0.6:
                    items.append(("ap", best["id"], m.end()))
        items.sort(key=lambda x: x[2])
        firsts, seen = [], set()
        for kind, ident, pos in items:
            if (kind, ident) not in seen:
                seen.add((kind, ident))
                firsts.append((kind, ident, pos))
        # a digest names the item, then makes its points: the claim text runs to the next item (at most 1,500 chars)
        starts = [p for _, _, p in firsts]
        texts = []
        for n, (kind, ident, pos) in enumerate(firsts):
            end = min([q for q in starts if q > pos] + [pos + 1500, len(body)])
            s["cited"] += 1
            if kind == "yt":
                meta = tg["videos"].get(ident, {})
                if meta.get("exists") is False:
                    s["no_such_video"] += 1
                    continue
                text = ytext.get(ident)
            else:
                cited_pods.add(ident)
                text = ptext.get(ident)
            if not text:
                continue
            s["covered"] += 1
            texts.append((text.lower(), claims(body[pos:end])))
        # baseline: the same claims checked against the next item's transcript, to show what chance matching gives
        for n, (tl, (names, nums)) in enumerate(texts):
            other = texts[(n + 1) % len(texts)][0] if len(texts) > 1 else ""
            s["names"] += len(names)
            s["nums"] += len(nums)
            s["names_hit"] += sum(1 for x in names if found({x}, tl))
            s["nums_hit"] += sum(1 for x in nums if found(number_forms(x), tl))
            s["names_base"] = s.get("names_base", 0) + sum(1 for x in names if found({x}, other))
            s["nums_base"] = s.get("nums_base", 0) + sum(1 for x in nums if found(number_forms(x), other))
        per_digest.append((r["family"], r["source"], r["d"], len(firsts)))

    lines.append("# Transcriber backtest against the Podwise-fed digests")
    lines.append("")
    lines.append(f"Window {tg['window'][0][:10]} to {tg['window'][1][:10]} (SGT). Problems: {tg['problems'] or 'none'}.")
    lines.append("")
    lines.append("| Digest | Copies | Items cited | Video does not exist | We have a transcript | Names found | Numbers found | "
                 "Names / numbers in a wrong transcript (chance) |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for (fam, src), s in sorted(stat.items()):
        real = s["cited"] - s["no_such_video"]
        lines.append(f"| {fam} / {src} | {s['digests']} | {s['cited']} | {s['no_such_video']} | "
                     f"{s['covered']} of {real} ({100 * s['covered'] / max(1, real):.0f}%) | "
                     f"{s['names_hit']} of {s['names']} ({100 * s['names_hit'] / max(1, s['names']):.0f}%) | "
                     f"{s['nums_hit']} of {s['nums']} ({100 * s['nums_hit'] / max(1, s['nums']):.0f}%) | "
                     f"{100 * s.get('names_base', 0) / max(1, s['names']):.0f}% / {100 * s.get('nums_base', 0) / max(1, s['nums']):.0f}% |")
    uncited = [e for i, e in pods.items() if i not in cited_pods and i in ptext and not e.get("outside_show_list")]
    lines.append("")
    lines.append(f"Podcast universe: {len(pods)} episodes, {len(ptext)} transcribed. Transcribed but cited by no podcast "
                 f"digest: {len(uncited)} (the digests' caps and filters, or Podwise never surfaced them).")
    for e in sorted(uncited, key=lambda e: e["published"])[:60]:
        lines.append(f"- {e['published'][:10]} · {e['show']} — {e['title']} ({e['minutes']} min)")
    lines.append("")
    no_tx = [(v, m) for v, m in tg["videos"].items() if m.get("exists") and v not in ytext]
    lines.append(f"YouTube videos that exist but got no transcript from Supadata: {len(no_tx)}")
    for v, m in no_tx[:40]:
        err = ""
        p = os.path.join(out, "youtube", v + ".txt.err")
        if os.path.exists(p):
            err = open(p).read()[:80]
        lines.append(f"- {v} · {m.get('channel')} — {m.get('title')} · {err}")
    missing_pods = sorted(i for i in cited_pods if i not in ptext)
    lines.append("")
    lines.append(f"Cited podcast episodes we could not transcribe: {len(missing_pods)}")
    for i in missing_pods[:40]:
        e = pods.get(i, {})
        lines.append(f"- {i} · {e.get('show')} — {e.get('title')}")
    open(os.path.join(out, "report.md"), "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:16]))
    return 0


def main(a):
    if a[0] == "prepare":
        return cmd_prepare(a[1], a[2])
    if a[0] == "transcribe":
        return cmd_transcribe(a[1], int(a[3]) if len(a) > 3 else 6)
    if a[0] == "score":
        return cmd_score(a[1], a[2])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
