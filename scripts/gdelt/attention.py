#!/usr/bin/env python3
"""Media attention signal from GDELT (plus Wikipedia pageviews) for the Macro Desk.

Three free sources, no credentials:
  gkg   GDELT 2.0 Global Knowledge Graph 15-minute files (English edition), sampled hourly (the :00 file of each
        hour, falling back to :15/:30/:45 when a file is missing). Days are Singapore calendar days (16:00Z to
        15:59Z). An article counts for a topic when any of the topic's patterns occurs in a ';'-joined, lower-cased
        bag of its GKG themes, location country codes ('loc:' + FIPS code), names and organisations.
  doc   GDELT DOC 2.0 API, mode timelinevolraw: daily article count for a full-text query and the day's total
        (UTC days, all languages). Throttled (one request per 5 s, shared cloud addresses) and its index has gaps.
  wiki  Wikimedia pageviews API: daily user views of an English Wikipedia article (UTC days).

Score per topic and source: share = count / total * 10,000 (views for wiki); x = log(1 + share);
z90 = (x - mean of x over the previous 90 valid days) / std (floor 0.15); ratio90 = share / median share over
those days; trend = mean share of the last 7 days / mean of the 28 days before that.
Flags: SPIKE z >= 2 and ratio >= 1.5; ELEVATED z >= 1; QUIET z <= -1; else NORMAL; NA when no baseline.

Usage (DIR holds topics.json and all outputs):
  attention.py gkg     --out DIR [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--include-today] [--workers 8]
  attention.py doc     --out DIR [--start YYYY-MM-DD] [--refresh-days N] [--only key,key] [--budget-min M] [--missing-only]
  attention.py wiki    --out DIR [--start YYYY-MM-DD] [--budget-min M] [--missing-only]
  attention.py compute --out DIR
  attention.py refresh --out DIR [--wiki-min 10] [--doc-min 20]   # gkg last 3 days, compute, wiki, doc 21 days, compute
"""
import argparse
import csv
import datetime as dt
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

UA = {"User-Agent": "MacroDeskAttention/0.1 (https://github.com/mayank201181/Claudemacrotrades; research use)"}
SGT = dt.timezone(dt.timedelta(hours=8))
GKG_BASE = "https://data.gdeltproject.org/gdeltv2/"
DOC_BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
WIKI_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
BASE_DAYS = 90          # baseline window (valid days)
MIN_BASE = 30           # minimum valid days before a z-score is printed
STD_FLOOR = 0.15
GKG_MIN_FILES = 12      # a day needs at least this many hourly files to count as valid
GKG_MIN_ARTICLES = 3000
DOC_MIN_NORM = 40000    # a DOC API day with fewer monitored articles is treated as an index gap
MIN_SPIKE_COUNT = 5     # a SPIKE needs at least this many matching articles that day (not applied to Wikipedia views)


def log(msg):
    print(dt.datetime.now(dt.timezone.utc).strftime("%H:%M:%SZ"), msg, flush=True)


def http_get(url, timeout=90, tries=6, backoff=(10, 20, 40, 60, 60), headers=UA):
    """GET with retries on 429, 5xx, network errors and GDELT's 'please limit requests' body. Returns (status, bytes)."""
    last = (0, b"")
    for i in range(tries):
        if i:
            time.sleep(backoff[min(i - 1, len(backoff) - 1)])
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            status, body = e.code, b""
            if status == 404:
                return 404, b""
        except Exception as e:  # network error, timeout
            status, body = 0, str(e).encode()
        last = (status, body)
        if status == 200 and not body.lstrip()[:20].lower().startswith(b"please limit"):
            return status, body
        if status == 200:
            status = 429
        log(f"  retry {i + 1} status {status} for {url[:120]}")
    return last


def load_topics(out):
    with open(os.path.join(out, "topics.json"), encoding="utf-8") as f:
        return json.load(f)["topics"]


# ----------------------------------------------------------------------------------------------------------- GKG
def parse_gkg(raw, matchers):
    """Count articles per topic in one GKG file. matchers: list of (key, [patterns])."""
    counts = {k: 0 for k, _ in matchers}
    n = 0
    for line in raw.split("\n"):
        f = line.split("\t")
        if len(f) < 27:
            continue
        n += 1
        toks = [t.split(",")[0] for t in f[8].split(";") if t]                      # themes
        toks += ["loc:" + x.split("#")[2] for x in f[10].split(";") if x.count("#") >= 2]   # country codes
        toks += [x.split(",")[0] for x in f[23].split(";") if x]                     # names
        toks += [x.split(",")[0] for x in f[14].split(";") if x]                     # organisations
        hay = (";" + ";".join(toks) + ";").lower().replace("'", "").replace("’", "")
        for key, pats in matchers:
            for p in pats:
                if p in hay:
                    counts[key] += 1
                    break
    return n, counts


def gkg_file_urls(day):
    """Hourly sample for a Singapore day: 16:00Z..23:00Z of the previous UTC day and 00:00Z..15:00Z of the day."""
    d = dt.datetime.strptime(day, "%Y-%m-%d")
    prev = d - dt.timedelta(days=1)
    stamps = [prev.strftime("%Y%m%d") + f"{h:02d}" for h in range(16, 24)] + [d.strftime("%Y%m%d") + f"{h:02d}" for h in range(0, 16)]
    return stamps


def fetch_gkg_hour(stamp):
    for mm in ("00", "15", "30", "45"):
        status, body = http_get(f"{GKG_BASE}{stamp}{mm}00.gkg.csv.zip", timeout=120, tries=3, backoff=(5, 10))
        if status == 200 and body:
            try:
                z = zipfile.ZipFile(BytesIO(body))
                return stamp, z.read(z.namelist()[0]).decode("utf-8", "replace")
            except Exception as e:
                log(f"  bad zip {stamp}{mm}: {e}")
        if status not in (404, 200):
            break
    return stamp, None


def gkg_day(day, matchers, workers=8):
    stamps = gkg_file_urls(day)
    ok, missing = 0, []
    articles = 0
    counts = {k: 0 for k, _ in matchers}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for stamp, raw in ex.map(fetch_gkg_hour, stamps):
            if raw is None:
                missing.append(stamp)
                continue
            ok += 1
            n, c = parse_gkg(raw, matchers)
            articles += n
            for k, v in c.items():
                counts[k] += v
    return {"date": day, "files_ok": ok, "files_missing": missing, "articles": articles, "counts": counts}


def cmd_gkg(a):
    topics = load_topics(a.out)
    matchers = [(t["key"], t["gkg"]) for t in topics if t.get("gkg")]
    ddir = os.path.join(a.out, "gkg_days")
    os.makedirs(ddir, exist_ok=True)
    today_sgt = dt.datetime.now(SGT).date()
    start = dt.date.fromisoformat(a.start) if a.start else today_sgt - dt.timedelta(days=3)
    end = dt.date.fromisoformat(a.end) if a.end else (today_sgt if a.include_today else today_sgt - dt.timedelta(days=1))
    day = start
    t0 = time.time()
    done = 0
    while day <= end:
        path = os.path.join(ddir, f"{day.isoformat()}.json")
        rerun = True
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            rerun = old.get("partial") or old.get("files_ok", 0) < 24 and (today_sgt - day).days <= 3
            rerun = bool(rerun) and old.get("files_ok", 0) < 24
        if rerun:
            rec = gkg_day(day.isoformat(), matchers, a.workers)
            rec["partial"] = day == today_sgt
            rec["fetched_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(rec, f)
            done += 1
            log(f"gkg {day} files {rec['files_ok']}/24 articles {rec['articles']} ({done} days, {time.time() - t0:.0f}s)")
        day += dt.timedelta(days=1)
    log(f"gkg done: {done} days processed")


# ----------------------------------------------------------------------------------------------------------- DOC API
def cmd_doc(a):
    topics = [t for t in load_topics(a.out) if t.get("doc")]
    if a.only:
        only = set(a.only.split(","))
        topics = [t for t in topics if t["key"] in only]
    rdir = os.path.join(a.out, "doc_raw")
    os.makedirs(rdir, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    if a.refresh_days:
        start = (now - dt.timedelta(days=a.refresh_days)).strftime("%Y%m%d")
    else:
        start = (a.start or "2024-01-01").replace("-", "")
    last_start = 0.0
    t0 = time.time()

    def fetched_at(t):
        p = os.path.join(rdir, f"{t['key']}.json")
        if not os.path.exists(p):
            return ""
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("fetched_at", "")

    topics.sort(key=fetched_at)  # least recently fetched first, so a time budget spreads over days
    for i, t in enumerate(topics):
        if a.budget_min and time.time() - t0 > a.budget_min * 60:
            log(f"doc: time budget of {a.budget_min} min used, {len(topics) - i} topics left for the next run")
            break
        path = os.path.join(rdir, f"{t['key']}.json")
        rec = {"key": t["key"], "query": t["doc"], "days": {}}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                rec = json.load(f)
            if rec.get("query") != t["doc"]:
                rec = {"key": t["key"], "query": t["doc"], "days": {}}  # query changed: refetch everything
                start = (a.start or "2024-01-01").replace("-", "") if not a.refresh_days else start
        if a.missing_only and rec.get("fetched_at", "")[:10] == now.strftime("%Y-%m-%d"):
            continue
        q = urllib.parse.quote(f"({t['doc']})" if " OR " in t["doc"] else t["doc"], safe="")
        url = (f"{DOC_BASE}?query={q}&mode=timelinevolraw&format=json&startdatetime={start}000000"
               f"&enddatetime={now.strftime('%Y%m%d%H%M%S')}")
        wait = max(0.0, a.spacing - (time.time() - last_start))
        time.sleep(wait)
        last_start = time.time()
        status, body = http_get(url)
        if status != 200:
            log(f"doc {t['key']}: FAILED status {status} {body[:80]!r}")
            continue
        try:
            data = json.loads(body.decode("utf-8", "replace"))
            series = data.get("timeline", [{}])[0].get("data", [])
        except Exception as e:
            log(f"doc {t['key']}: bad JSON ({e}) {body[:100]!r}")
            continue
        for p in series:
            rec["days"][p["date"][:8]] = [int(p.get("value", 0)), int(p.get("norm", 0))]
        rec["fetched_at"] = now.isoformat(timespec="seconds")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f)
        log(f"doc {t['key']}: {len(series)} days ({i + 1}/{len(topics)})")
    log("doc done")


# ----------------------------------------------------------------------------------------------------------- Wikipedia
def cmd_wiki(a):
    topics = [t for t in load_topics(a.out) if t.get("wiki")]
    rdir = os.path.join(a.out, "wiki_raw")
    os.makedirs(rdir, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).date()
    start = (a.start or "2024-01-01").replace("-", "")
    end = today.strftime("%Y%m%d")
    t0 = time.time()

    def fetched_at(t):
        p = os.path.join(rdir, f"{t['key']}.json")
        if not os.path.exists(p):
            return ""
        with open(p, encoding="utf-8") as f:
            return json.load(f).get("fetched_at", "")

    topics.sort(key=fetched_at)
    for i, t in enumerate(topics):
        if a.budget_min and time.time() - t0 > a.budget_min * 60:
            log(f"wiki: time budget of {a.budget_min} min used, {len(topics) - i} topics left for the next run")
            break
        path = os.path.join(rdir, f"{t['key']}.json")
        rec = {"key": t["key"], "article": t["wiki"], "days": {}}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            if old.get("article") == t["wiki"]:
                rec = old
        if a.missing_only and rec.get("fetched_at", "")[:10] == today.isoformat():
            continue
        art = t["wiki"] if "%" in t["wiki"] else urllib.parse.quote(t["wiki"], safe="")
        url = f"{WIKI_BASE}{art}/daily/{start}00/{end}00"
        time.sleep(a.spacing)
        status, body = http_get(url, timeout=60, backoff=(5, 10, 20, 40, 60))
        if status != 200:
            log(f"wiki {t['key']}: FAILED status {status} {body[:80]!r}")
            continue
        try:
            items = json.loads(body.decode("utf-8", "replace")).get("items", [])
        except Exception as e:
            log(f"wiki {t['key']}: bad JSON {e}")
            continue
        for it in items:
            rec["days"][it["timestamp"][:8]] = int(it.get("views", 0))
        rec["fetched_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(rec, f)
        log(f"wiki {t['key']}: {len(items)} days ({i + 1}/{len(topics)})")
    log("wiki done")


# ----------------------------------------------------------------------------------------------------------- scoring
def score_series(days):
    """days: sorted list of (date, count, total, valid). Returns rows with share, z90, ratio90, trend, flag."""
    rows = []
    hist = []   # (date, x, share) for valid days, in order
    for date, count, total, valid in days:
        if not valid:
            rows.append({"date": date, "count": count, "total": total, "share": None, "z90": None, "ratio90": None,
                         "trend": None, "flag": "NA"})
            continue
        share = count / total * 10000 if total else float(count)
        x = math.log1p(share)
        base = hist[-BASE_DAYS:]
        z = ratio = trend = None
        flag = "NA"
        if len(base) >= MIN_BASE:
            xs = [b[1] for b in base]
            mean = statistics.fmean(xs)
            std = max(statistics.pstdev(xs), STD_FLOOR)
            z = (x - mean) / std
            med = statistics.median(b[2] for b in base)
            if med <= 0:  # sparse topic: most baseline days are zero, compare with the mean instead
                med = statistics.fmean(b[2] for b in base)
            ratio = share / med if med > 0 else None
            last7 = [share] + [b[2] for b in hist[-6:]]
            prev28 = [b[2] for b in hist[-34:-6]] if len(hist) >= 34 else [b[2] for b in hist[:-6]]
            if prev28 and statistics.fmean(prev28) > 0:
                trend = statistics.fmean(last7) / statistics.fmean(prev28)
            if z >= 2 and (ratio or 0) >= 1.5 and (total is None or count >= MIN_SPIKE_COUNT):
                flag = "SPIKE"
            elif z >= 1:
                flag = "ELEVATED"
            elif z <= -1:
                flag = "QUIET"
            else:
                flag = "NORMAL"
        rows.append({"date": date, "count": count, "total": total, "share": share, "z90": z, "ratio90": ratio,
                     "trend": trend, "flag": flag})
        hist.append((date, x, share))
    return rows


def load_source_days(out, topics):
    """Returns {source: {key: [(date, count, total, valid), ...]}} and per-source notes."""
    res = {"gkg": {}, "doc": {}, "wiki": {}}
    notes = {}
    # GKG
    ddir = os.path.join(out, "gkg_days")
    gdays = []
    if os.path.isdir(ddir):
        for fn in sorted(os.listdir(ddir)):
            if fn.endswith(".json"):
                with open(os.path.join(ddir, fn), encoding="utf-8") as f:
                    gdays.append(json.load(f))
    for t in topics:
        if not t.get("gkg"):
            continue
        res["gkg"][t["key"]] = [(d["date"], d["counts"].get(t["key"], 0), d["articles"],
                                 d["files_ok"] >= GKG_MIN_FILES and d["articles"] >= GKG_MIN_ARTICLES) for d in gdays]
    if gdays:
        last = gdays[-1]
        notes["gkg"] = (f"GDELT GKG English edition, hourly sample, Singapore days; latest day {last['date']} "
                        f"({last['files_ok']}/24 files, {last['articles']:,} articles{', partial day' if last.get('partial') else ''})")
    # DOC
    rdir = os.path.join(out, "doc_raw")
    last_valid = None
    for t in topics:
        p = os.path.join(rdir, f"{t['key']}.json")
        if not t.get("doc") or not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            rec = json.load(f)
        days = []
        for d in sorted(rec["days"]):
            c, n = rec["days"][d]
            valid = n >= DOC_MIN_NORM
            days.append((f"{d[:4]}-{d[4:6]}-{d[6:]}", c, n, valid))
            if valid and (last_valid is None or days[-1][0] > last_valid):
                last_valid = days[-1][0]
        res["doc"][t["key"]] = days
    if last_valid:
        notes["doc"] = f"GDELT DOC API (all languages, UTC days); last day with a full index {last_valid}"
    # Wikipedia
    rdir = os.path.join(out, "wiki_raw")
    wlast = None
    for t in topics:
        p = os.path.join(rdir, f"{t['key']}.json")
        if not t.get("wiki") or not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            rec = json.load(f)
        days = [(f"{d[:4]}-{d[4:6]}-{d[6:]}", v, None, True) for d, v in sorted(rec["days"].items())]
        res["wiki"][t["key"]] = days
        if days and (wlast is None or days[-1][0] > wlast):
            wlast = days[-1][0]
    if wlast:
        notes["wiki"] = f"English Wikipedia daily pageviews (UTC days); latest day {wlast}"
    return res, notes


def fmt(v, nd=1, suffix=""):
    return "" if v is None else f"{v:.{nd}f}{suffix}"


def trend_word(r):
    if r is None:
        return ""
    return "rising" if r >= 1.3 else "falling" if r <= 0.77 else "flat"


def cmd_compute(a):
    topics = load_topics(a.out)
    src, notes = load_source_days(a.out, topics)
    scored = {s: {} for s in src}
    for s in src:
        for key, days in src[s].items():
            scored[s][key] = score_series(days)
    # daily CSV (all sources)
    csv_path = os.path.join(a.out, "attention_daily.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "source", "key", "group", "label", "count", "total", "share_per10k", "z90", "ratio90", "trend7v28", "flag"])
        for t in topics:
            for s in ("gkg", "doc", "wiki"):
                for r in scored[s].get(t["key"], []):
                    w.writerow([r["date"], s, t["key"], t["group"], t["label"], r["count"], r["total"] if r["total"] is not None else "",
                                fmt(r["share"], 3), fmt(r["z90"], 2), fmt(r["ratio90"], 2), fmt(r["trend"], 2), r["flag"]])
    # latest per topic
    latest = []
    for t in topics:
        item = {"key": t["key"], "group": t["group"], "label": t["label"]}
        for s in ("gkg", "doc", "wiki"):
            rows = [r for r in scored[s].get(t["key"], []) if r["flag"] != "NA"]
            if rows:
                r = rows[-1]
                item[s] = {"date": r["date"], "count": r["count"], "total": r["total"], "share": r["share"], "z90": r["z90"],
                           "ratio90": r["ratio90"], "trend": r["trend"], "flag": r["flag"]}
        latest.append(item)
    as_of = dt.datetime.now(SGT).strftime("%Y-%m-%d %H:%M SGT")
    with open(os.path.join(a.out, "attention_latest.json"), "w", encoding="utf-8") as f:
        json.dump({"as_of": as_of, "sources": notes, "topics": latest}, f, indent=1)
    # markdown
    gkg_date = max((i["gkg"]["date"] for i in latest if "gkg" in i), default="n/a")
    lines = [f"# Media attention, {as_of}", ""]
    for s in ("gkg", "wiki", "doc"):
        if s in notes:
            lines.append(f"- {notes[s]}")
    lines += ["", "z90 = today's log coverage share against its previous 90 days (standard deviations); x90 = share divided "
              "by the 90-day median; trend = last 7 days against the 28 before; n = matching articles in the day's sample. "
              "Media = GDELT GKG; Wiki = Wikipedia views. SPIKE: z >= 2, x90 >= 1.5 and n >= 5. ELEVATED: z >= 1. QUIET: z <= -1.", ""]

    def row(i, s="gkg"):
        g = i.get(s, {})
        n = "" if g.get("count") is None else f"{g['count']:,}"
        return (f"| {i['label']} | {i['group']} | {fmt(g.get('z90'))} | {fmt(g.get('ratio90'), 1, 'x')} | {trend_word(g.get('trend'))} | {n} "
                f"| {fmt(i.get('wiki', {}).get('z90'))} | {fmt(i.get('doc', {}).get('z90'))} | {g.get('flag', '')} |")

    hdr = ["| Topic | Group | Media z90 | x90 | Trend | n | Wiki z90 | DOC z90 | Flag |", "|---|---|---|---|---|---|---|---|---|"]
    have = [i for i in latest if "gkg" in i and i["gkg"]["date"] == gkg_date]
    spikes = sorted([i for i in have if i["gkg"]["flag"] == "SPIKE"], key=lambda i: -i["gkg"]["z90"])
    elev = sorted([i for i in have if i["gkg"]["flag"] == "ELEVATED"], key=lambda i: -i["gkg"]["z90"])
    quiet = sorted([i for i in have if i["gkg"]["flag"] == "QUIET"], key=lambda i: i["gkg"]["z90"])
    lines += [f"## Media spikes (GKG day {gkg_date})", ""] + hdr + [row(i) for i in spikes] + ([] if spikes else ["| none | | | | | | | | |"]) + [""]
    lines += ["## Elevated", ""] + hdr + [row(i) for i in elev] + ([] if elev else ["| none | | | | | | | | |"]) + [""]
    lines += ["## Quiet (coverage well below its norm)", ""] + hdr + [row(i) for i in quiet] + ([] if quiet else ["| none | | | | | | | | |"]) + [""]
    wsp = sorted([i for i in latest if "wiki" in i and i["wiki"]["flag"] in ("SPIKE", "ELEVATED")], key=lambda i: -i["wiki"]["z90"])[:12]
    lines += ["## Public attention (Wikipedia views) spikes and elevated, latest day", "", "| Topic | Group | Wiki z90 | x90 | Trend | Views | Date |", "|---|---|---|---|---|---|---|"]
    lines += [f"| {i['label']} | {i['group']} | {fmt(i['wiki']['z90'])} | {fmt(i['wiki']['ratio90'], 1, 'x')} | {trend_word(i['wiki']['trend'])} | {i['wiki']['count']:,} | {i['wiki']['date']} |" for i in wsp] or ["| none | | | | | | |"]
    lines += ["", "## All topics (sorted by media z90)", ""] + hdr
    lines += [row(i) for i in sorted(latest, key=lambda i: -(i.get("gkg", {}).get("z90") if i.get("gkg", {}).get("z90") is not None else -99))]
    with open(os.path.join(a.out, "attention_latest.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log(f"compute done: {len(spikes)} spikes, {len(elev)} elevated, {len(quiet)} quiet on GKG day {gkg_date}; "
        f"{sum(len(v) for v in scored['doc'].values())} doc rows, {sum(len(v) for v in scored['wiki'].values())} wiki rows")
    print("\n".join(lines[:60]))


def cmd_refresh(a):
    """GKG first (fast, the primary gauge), table written, then Wikipedia and the DOC API within time budgets, table again."""
    cmd_gkg(argparse.Namespace(out=a.out, start=None, end=None, include_today=False, workers=8))
    cmd_compute(argparse.Namespace(out=a.out))
    cmd_wiki(argparse.Namespace(out=a.out, start=(dt.date.today() - dt.timedelta(days=60)).isoformat(), spacing=2.0,
                                budget_min=a.wiki_min, missing_only=True))
    cmd_doc(argparse.Namespace(out=a.out, start=None, refresh_days=21, only=None, spacing=8.0, budget_min=a.doc_min,
                               missing_only=True))
    cmd_compute(argparse.Namespace(out=a.out))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("gkg"); p.add_argument("--out", required=True); p.add_argument("--start"); p.add_argument("--end")
    p.add_argument("--include-today", action="store_true"); p.add_argument("--workers", type=int, default=8); p.set_defaults(fn=cmd_gkg)
    p = sub.add_parser("doc"); p.add_argument("--out", required=True); p.add_argument("--start"); p.add_argument("--refresh-days", type=int)
    p.add_argument("--only"); p.add_argument("--spacing", type=float, default=8.0); p.add_argument("--budget-min", type=float)
    p.add_argument("--missing-only", action="store_true", help="skip topics already fetched today"); p.set_defaults(fn=cmd_doc)
    p = sub.add_parser("wiki"); p.add_argument("--out", required=True); p.add_argument("--start"); p.add_argument("--spacing", type=float, default=2.0)
    p.add_argument("--budget-min", type=float); p.add_argument("--missing-only", action="store_true"); p.set_defaults(fn=cmd_wiki)
    p = sub.add_parser("compute"); p.add_argument("--out", required=True); p.set_defaults(fn=cmd_compute)
    p = sub.add_parser("refresh"); p.add_argument("--out", required=True); p.add_argument("--wiki-min", type=float, default=10)
    p.add_argument("--doc-min", type=float, default=20); p.set_defaults(fn=cmd_refresh)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
