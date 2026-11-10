#!/usr/bin/env python3
"""Run one morning data feeder and stage its file for an exact Google Drive upload.

  python3 -I feeder.py <gdelt|odds|marketpack|fundpack> [upload_dir]
  python3 -I feeder.py confirm <feed> <fileSize that create_file returned>
  python3 -I feeder.py status

The first form builds the file (one retry), copies it into the upload folder under its Drive title and prints the five
arguments of a Google Drive create_file call. base64Content is a file reference ("sha256:<hex>:<absolute path>"): the
harness sends the file's own bytes, so nothing is read into the model or retyped. The upload folder must be one the
harness will read, which for a thread is its scratchpad; left out, the runner finds the scratchpad of the session
whose container it runs in.

The second form records what Drive stored, and says so when the size differs from the file that was built.

Every run appends one line to feeders/status.csv under the root, so a missing or failed morning is visible later
without reading a thread. Stdlib only, no credentials. The builds themselves live in gdelt/, predmkt/, marketpack/
and fundpack/ under the root (default /mnt/project-files, override with FEEDER_ROOT for tests).
"""
import csv
import datetime as dt
import glob
import hashlib
import os
import shutil
import subprocess
import sys
import time

ROOT = os.environ.get("FEEDER_ROOT", "/mnt/project-files").rstrip("/")
DRIVE_FOLDER = "1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm"      # the digests' shared data folder
SGT = dt.timezone(dt.timedelta(hours=8))
HARD_CAP = 540          # seconds for one feed, inside the 10 minute limit of a foreground shell command
PY = sys.executable or "python3"

FEEDS = {
    "gdelt": {"title": "gdelt_attention_latest", "out": "gdelt/attention_latest.md", "min_bytes": 3000},
    "odds": {"title": "predmkt_latest", "out": "predmkt/predmkt_latest.md", "min_bytes": 2000,
             "cmd": ["predmkt/predmkt.py", "--out", "predmkt/"]},
    "marketpack": {"title": "market_pack_latest", "out": "marketpack/market_pack_latest.md", "min_bytes": 15000,
                   "cmd": ["marketpack/marketpack.py", "--out", "marketpack/"]},
    "fundpack": {"title": "fund_pack_latest", "out": "fundpack/fund_pack_latest.md", "min_bytes": 3000,
                 "cmd": ["fundpack/fundpack.py", "--out", "fundpack/"]},
}


def root(rel):
    return os.path.join(ROOT, rel)


def run(args, timeout, log_path=None):
    """Run one script from the root with -I. Returns (exit code or None on timeout, seconds, last lines of output)."""
    t0 = time.time()
    cmd = [PY, "-I", root(args[0])] + [root(a) if a.endswith("/") else a for a in args[1:]]
    try:
        p = subprocess.run(cmd, cwd="/tmp", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=max(5, timeout), text=True,
                           errors="replace")
        code, out = p.returncode, p.stdout or ""
    except subprocess.TimeoutExpired as e:
        out = e.stdout or ""
        out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
        code = None
    if log_path:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"\n$ {' '.join(cmd)}\n{out}")
    tail = [ln for ln in out.strip().splitlines() if ln.strip()][-4:]
    return code, time.time() - t0, tail


def build_plain(feed, deadline):
    code, secs, tail = run(FEEDS[feed]["cmd"], deadline - time.time())
    return code == 0, tail, ("timed out" if code is None else f"exit {code}")


def build_gdelt(feed, deadline):
    """The media day first, then the second sources inside what time is left, then the table. Only a failed media day
    or a failed table fails the feed: Wikipedia and the DOC API are refused often and are extras."""
    out = root("gdelt/")
    log_path = root("gdelt/refresh_last.log")
    open(log_path, "w").close()
    reserve = 170                                           # the table takes about 90 seconds to write
    code, _, tail = run(["gdelt/attention.py", "gkg", "--out", "gdelt/"], min(240, deadline - time.time() - reserve), log_path)
    if code != 0:
        return False, tail, "media day fetch " + ("timed out" if code is None else f"exit {code}")
    notes = []
    left = deadline - time.time() - reserve
    if left > 60:
        budget = round(min(4.0, (left - 35) / 60), 2)       # the 35 seconds cover a request already under way
        start = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=60)).isoformat()
        code, _, t = run(["gdelt/attention.py", "wiki", "--out", "gdelt/", "--start", start, "--missing-only", "--budget-min", str(budget)],
                         left, log_path)
        notes += [ln for ln in t if "wiki done" in ln or "left for the next run" in ln] or [f"wiki step {'timed out' if code is None else 'exit ' + str(code)}"]
    left = deadline - time.time() - reserve
    if left > 110:
        budget = round(min(1.5, (left - 80) / 60), 2)
        code, _, t = run(["gdelt/attention.py", "doc", "--out", "gdelt/", "--refresh-days", "21", "--missing-only", "--budget-min", str(budget)],
                         left, log_path)
        notes += [ln for ln in t if "doc done" in ln] or [f"doc step {'timed out' if code is None else 'exit ' + str(code)}"]
    code, _, tail = run(["gdelt/attention.py", "compute", "--out", "gdelt/"], deadline - time.time() + 30, log_path)
    done = [ln for ln in open(log_path, encoding="utf-8", errors="replace").read().splitlines() if "compute done" in ln][-1:]
    return code == 0, notes + done, "table " + ("timed out" if code is None else f"exit {code}")


def status_path():
    return root("feeders/status.csv")


def record(feed, event, nbytes="", secs="", note=""):
    os.makedirs(os.path.dirname(status_path()), exist_ok=True)
    new = not os.path.exists(status_path())
    now = dt.datetime.now(dt.timezone.utc)
    with open(status_path(), "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["utc", "sgt_date", "feed", "event", "bytes", "seconds", "note"])
        w.writerow([now.strftime("%Y-%m-%dT%H:%M:%SZ"), now.astimezone(SGT).date().isoformat(), feed, event, nbytes,
                    f"{secs:.0f}" if isinstance(secs, float) else secs, note[:300]])


def rows(feed=None):
    if not os.path.exists(status_path()):
        return []
    with open(status_path(), newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if feed is None or r["feed"] == feed]


def failed_on_previous_day(feed):
    """True when the last day with any build before today ended without a good build."""
    today = dt.datetime.now(SGT).date().isoformat()
    earlier = [r for r in rows(feed) if r["sgt_date"] < today and r["event"].startswith("build")]
    if not earlier:
        return False
    last_day = earlier[-1]["sgt_date"]
    return not any(r["event"] == "build_ok" for r in earlier if r["sgt_date"] == last_day)


def stamp(path):
    """(mtime, size) of a file, or None. Compared before and after a build, so the check does not depend on the
    clocks of the container and the file server agreeing."""
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def find_upload_dir():
    """<scratchpad>/upload of the session this container belongs to. The harness names the session in
    CLAUDE_CODE_SESSION_ID and keeps its scratchpad at /tmp/claude-<uid>/<cwd>/<session>/scratchpad."""
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if sid:
        for base in sorted(glob.glob(f"/tmp/claude-*/*/{sid}")):
            if os.path.isdir(base) and os.access(base, os.W_OK):
                return os.path.join(base, "scratchpad", "upload")
    found = [d for d in glob.glob("/tmp/claude-*/*/*/scratchpad") if os.path.isdir(d) and os.access(d, os.W_OK)]
    if found:
        return os.path.join(max(found, key=os.path.getmtime), "upload")
    if sid:
        return f"/tmp/claude-{os.getuid()}/-home-user/{sid}/scratchpad/upload"
    return None


def cmd_build(feed, upload_dir):
    spec = FEEDS[feed]
    upload_dir = upload_dir or find_upload_dir()
    if not upload_dir:
        print("FAILED: no scratchpad folder found for the upload copy. Run again with the folder as a second argument: "
              "<your scratchpad directory>/upload")
        print("TELL OWNER: no")
        return 1
    builder = build_gdelt if feed == "gdelt" else build_plain
    out_path = root(spec["out"])
    t0 = time.time()
    deadline = t0 + HARD_CAP
    problems = []
    ok, tail = False, []
    for attempt in (1, 2):
        if deadline - time.time() < 60:
            problems.append(f"attempt {attempt}: no time left")
            break
        before = stamp(out_path)
        ok, tail, why = builder(feed, deadline)
        after = stamp(out_path)
        fresh = after is not None and after != before
        size = after[1] if after else 0
        if ok and fresh and size >= spec["min_bytes"]:
            break
        problems.append(f"attempt {attempt}: " + (why if not ok else "the output file was not rewritten" if not fresh
                                                   else f"the output is only {size} bytes"))
        ok = False
        if attempt == 1:
            time.sleep(float(os.environ.get("FEEDER_RETRY_WAIT", "20")))
    secs = time.time() - t0
    if not ok:
        note = "; ".join(problems)
        tell = failed_on_previous_day(feed)
        record(feed, "build_failed", "", secs, note)
        print(f"FAILED: {feed} did not build ({note})")
        for ln in tail:
            print("  " + ln[:200])
        print(f"TELL OWNER: {'yes' if tell else 'no'}")
        return 1
    os.makedirs(upload_dir, exist_ok=True)
    staged = os.path.join(os.path.abspath(upload_dir), spec["title"] + ".md")
    shutil.copyfile(out_path, staged)
    with open(staged, "rb") as f:
        data = f.read()
    digest = hashlib.sha256(data).hexdigest()
    record(feed, "build_ok", len(data), secs, " | ".join(tail)[:300])
    print(f"ok: {spec['title']} built in {secs:.0f}s, {len(data)} bytes")
    for ln in tail:
        print("  " + ln[:200])
    print()
    print("CREATE_FILE (call Google Drive create_file with exactly these five arguments, nothing else):")
    print(f"title = {spec['title']}")
    print(f"parentId = {DRIVE_FOLDER}")
    print("contentMimeType = text/plain")
    print("disableConversionToGoogleType = true")
    print(f"base64Content = sha256:{digest}:{staged}")
    print(f"EXPECT fileSize = {len(data)}")
    print(f"THEN run: {PY} -I {os.path.abspath(__file__)} confirm {feed} <the fileSize that create_file returned>")
    return 0


def cmd_confirm(feed, size):
    built = [r for r in rows(feed) if r["event"] == "build_ok"]
    want = built[-1]["bytes"] if built else ""
    if str(size).strip() == str(want):
        record(feed, "uploaded", size)
        print(f"ok: Drive holds {FEEDS[feed]['title']} at {size} bytes, equal to the file that was built. Done.")
        return 0
    record(feed, "upload_mismatch", size, "", f"built {want}")
    print(f"MISMATCH: Drive reports {size} bytes, the built file has {want}. Call create_file once more with the same "
          f"five arguments, then run confirm again. If it still differs, stop and say so in one line.")
    return 1


def cmd_status():
    for r in rows()[-16:]:
        print(",".join(r[k] for k in ("utc", "sgt_date", "feed", "event", "bytes", "seconds", "note")))
    return 0


def main(argv):
    if len(argv) == 2 and argv[1] == "status":
        return cmd_status()
    if len(argv) == 4 and argv[1] == "confirm" and argv[2] in FEEDS:
        return cmd_confirm(argv[2], argv[3])
    if len(argv) in (2, 3) and argv[1] in FEEDS:
        return cmd_build(argv[1], argv[2] if len(argv) == 3 else None)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
