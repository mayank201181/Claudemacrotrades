#!/usr/bin/env python3
"""audit.py: helper for the daily audit of the split-Takeaways shadow test. Standard library only, run with -I.

  audit.py selftest
  audit.py fetch <saved Drive download result, or a text file> <key>   decode the evidence file into evidence/evidence_<key>.txt
  audit.py find <key> [--any] [--part] <term> [<term> ...]             claim lines that hold all the terms (or any). A term
                                                                       matches where it starts a word (hike finds hikes), a term
                                                                       of up to three letters only as a whole word, a number only
                                                                       as a whole number; --part also matches inside words
  audit.py close <key> --digest-sent HH:MM                             check audit_<key>.tsv, write audit_<key>.md, add a results row
  audit.py close <key> --no-file | --no-digest                         record a morning that could not be audited
  audit.py table                                                       results.csv as a table

<key> is the date (2026-11-12) or the date with a label (2026-11-10_dryrun). Files live under the root, default
/mnt/project-files/shadow_test (override with SHADOW_ROOT for tests). The audit holds private digest content: nothing
this script reads or writes belongs in the repo.

audit_<key>.tsv is written by the auditor, tab separated, first row the column names:
  item  kind  label  claim  source  verdict  evidence_ids  note
kind is card, odds or headline. verdict is CARRIED, DEGRADED, LOST, INPUT NOT READ or NOT A FEED CLAIM.
evidence_ids are claim ids of the evidence file (Y1003.4), comma separated, or STANCE for a stance row.
A morning passes when no row is LOST and none is INPUT NOT READ."""
import base64
import collections
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import tempfile

ROOT = os.environ.get("SHADOW_ROOT", "/mnt/project-files/shadow_test").rstrip("/")
HEAD = re.compile(r"^### ([A-Z]\d+) \| (.*)$")
CLAIM = re.compile(r"^- \[([A-Z]\d+\.\d+)\] \[([^\]]+)\] \[([^\]]+)\] (.+?) \| in: (.+)$")
SAVE = re.compile(r"^[A-Za-z_]+__(.+?)__\d+\.(?:txt|stances)$")
VERDICTS = ("CARRIED", "DEGRADED", "LOST", "INPUT NOT READ", "NOT A FEED CLAIM")
KINDS = ("card", "odds", "headline")
COLS = ["item", "kind", "label", "claim", "source", "verdict", "evidence_ids", "note"]
RESULT_COLS = ["key", "audited_utc", "verdict", "items", "items_with_a_loss", "claims", "carried", "degraded", "lost", "input_not_read",
               "not_a_feed_claim", "pass_started", "pass_finished", "pass_minutes", "digest_sent", "evidence_bytes", "evidence_claims",
               "inputs_read", "inputs_not_read", "figures_not_found", "item_links_not_covered"]


def path(*bits):
    return os.path.join(ROOT, *bits)


def norm(t):
    return re.sub(r"(?<=\d),(?=\d)", "", t).lower()


def canon(name):
    """The copy name; a save name such as DESK_INPUT__Desk-RedTeam__5.txt is cut down to Desk-RedTeam."""
    m = SAVE.match(name.strip())
    return m.group(1) if m else name.strip()


def has(term, hay):
    """Both are already through norm(). See the usage text for what counts as a match."""
    t = re.escape(term)
    if re.fullmatch(r"[\d.]+%?", term):
        return re.search(r"(?<![\d.])" + t + r"(?!\d)", hay) is not None
    if re.fullmatch(r"[a-z]{1,3}", term):
        return re.search(r"(?<![a-z0-9])" + t + r"(?![a-z0-9])", hay) is not None
    return re.search(r"(?<![a-z0-9])" + t, hay) is not None


def unwrap(o):
    if isinstance(o, list) and o and all(isinstance(p, dict) and "text" in p and "type" in p for p in o):
        return unwrap("".join(p["text"] for p in o))
    if isinstance(o, dict) and "text" in o and set(o) <= {"type", "text"}:
        return unwrap(o["text"])
    if isinstance(o, str) and o.lstrip()[:1] in ("{", "["):
        try:
            return unwrap(json.JSONDecoder().raw_decode(o.lstrip())[0])
        except ValueError:
            return o
    return o


def cmd_fetch(src, key):
    raw = open(src, encoding="utf-8", errors="replace").read()
    o = unwrap(raw)
    how = "text file"
    if isinstance(o, dict) and isinstance(o.get("content"), str):
        data, how = base64.b64decode(o["content"]), "decoded from the saved download"
    elif isinstance(o, dict) and isinstance(o.get("fileContent"), str):
        data, how = o["fileContent"].encode("utf-8"), "read_file_content text (markdown characters may be escaped: prefer download_file_content)"
    else:
        data = raw.encode("utf-8")
    os.makedirs(path("evidence"), exist_ok=True)
    out = path("evidence", f"evidence_{key}.txt")
    with open(out, "wb") as f:
        f.write(data)
    text = data.decode("utf-8", errors="replace")
    print(f"{out}: {len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()[:16]}, {how}")
    if not text.startswith("EVIDENCE FILE"):
        print("WARNING: the file does not start with EVIDENCE FILE; check that the right Drive file was downloaded")
    print("\n".join(ln[:400] for ln in text.splitlines()[:8]))
    return 0


def load(key):
    p = path("evidence", f"evidence_{key}.txt")
    text = open(p, encoding="utf-8", errors="replace").read()
    ev = {"path": p, "bytes": os.path.getsize(p), "top": [], "inputs": [], "blocks": collections.OrderedDict(), "claims": collections.OrderedDict(),
          "left_out": [], "stances": []}
    section, cur = "TOP", None
    for ln in text.splitlines():
        if ln.startswith("## "):
            section, cur = ln[3:].strip().upper(), None
            continue
        if section == "TOP":
            ev["top"].append(ln)
        elif section == "INPUTS":
            if ln.strip():
                ev["inputs"].append(ln)
        elif section.startswith("LEFT OUT"):
            if ln.strip():
                ev["left_out"].append(ln)
        elif section.startswith("STANCES"):
            if ln.strip():
                ev["stances"].append(ln)
        elif section.startswith("COPY TALLY") or section.startswith("TOPIC INDEX"):
            continue
        else:
            h, c = HEAD.match(ln), CLAIM.match(ln)
            if h:
                cur = h.group(1)
                ev["blocks"][cur] = {"head": h.group(2), "group": section}
            elif c and cur:
                ev["claims"][c.group(1)] = {"block": cur, "group": section, "topic": c.group(2), "type": c.group(3), "text": c.group(4),
                                            "in": list(collections.OrderedDict.fromkeys(canon(x) for x in c.group(5).split(",") if x.strip()))}
    return ev


def cmd_find(key, terms, any_term, part=False):
    ev = load(key)
    want = [norm(t) for t in terms if t.strip()]
    test = any if any_term else all
    hit = (lambda t, h: t in h) if part else has
    hits = []
    for cid, c in ev["claims"].items():
        own = norm(c["text"])
        hay = own + " " + norm(ev["blocks"][c["block"]]["head"]) + " " + norm(", ".join(c["in"]))
        if test(hit(t, hay) for t in want):
            hits.append((0 if test(hit(t, own) for t in want) else 1, cid, c))
    hits.sort(key=lambda h: h[0])
    print(f"{len(hits)} claim line(s) for {' + '.join(terms) if not any_term else ' or '.join(terms)}" + (" (first 40 shown)" if len(hits) > 40 else ""))
    for _, cid, c in hits[:40]:
        print(f"  [{cid}] [{c['topic']}] [{c['type']}] {c['text']} | in: {', '.join(c['in'])}\n      item: {ev['blocks'][c['block']]['head'][:160]}")
    for name, rows in (("STANCE ROW", ev["stances"]), ("LEFT OUT", ev["left_out"])):
        got = [r for r in rows if test(hit(t, norm(r)) for t in want)]
        for r in got[:10]:
            print(f"  {name}: {r[:300]}")
    return len(hits)


def top_number(ev, pattern, default=""):
    m = re.search(pattern, "\n".join(ev["top"]))
    return m.group(1) if m else default


def minutes(a, b):
    if not (a and b):
        return ""
    (h1, m1), (h2, m2) = (int(x) for x in a.split(":")), (int(x) for x in b.split(":"))
    return str(((h2 * 60 + m2) - (h1 * 60 + m1)) % 1440)


def add_result(row):
    """One row per key: closing a morning again replaces its earlier row."""
    p = path("results.csv")
    old = list(csv.DictReader(open(p, newline="", encoding="utf-8"))) if os.path.exists(p) else []
    rows = [r for r in old if r.get("key") != row["key"]] + [row]
    with open(p + ".tmp", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RESULT_COLS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in RESULT_COLS})
    os.replace(p + ".tmp", p)


def cmd_close(key, digest_sent, missing):
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    if missing:
        add_result({"key": key, "audited_utc": now, "verdict": missing})
        print(f"recorded {key}: {missing}")
        return 0
    ev = load(key)
    tsv = path(f"audit_{key}.tsv")
    with open(tsv, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    problems = []
    if not rows or [c.strip() for c in rows[0]] != COLS:
        problems.append(f"the first row must be the column names: {' <tab> '.join(COLS)}")
    data = []
    for n, r in enumerate(rows[1:], 2):
        if not any(c.strip() for c in r):
            continue
        if len(r) != len(COLS):
            problems.append(f"row {n}: {len(r)} columns, expected {len(COLS)}")
            continue
        d = {k: v.strip() for k, v in zip(COLS, r)}
        if d["kind"] not in KINDS:
            problems.append(f"row {n}: kind must be one of {', '.join(KINDS)}")
        if d["verdict"] not in VERDICTS:
            problems.append(f"row {n}: verdict must be one of {', '.join(VERDICTS)}")
        ids = [x.strip() for x in d["evidence_ids"].split(",") if x.strip() and x.strip() != "-"]
        d["ids"] = ids
        if d["verdict"] in ("CARRIED", "DEGRADED") and not ids:
            problems.append(f"row {n}: {d['verdict']} needs the evidence id(s), or STANCE")
        for i in ids:
            if i != "STANCE" and i not in ev["claims"]:
                problems.append(f"row {n}: {i} is not a claim id of the evidence file")
        if d["verdict"] in ("LOST", "DEGRADED", "INPUT NOT READ") and not d["note"]:
            problems.append(f"row {n}: {d['verdict']} needs a note (the passage, the copy, what differs)")
        data.append(d)
    if problems:
        print("NOT CLOSED. Correct audit_%s.tsv and run close again:" % key)
        for p in problems[:40]:
            print("  " + p)
        return 1
    count = collections.Counter(d["verdict"] for d in data)
    items = collections.OrderedDict()
    for d in data:
        items.setdefault(d["item"], {"kind": d["kind"], "label": d["label"], "rows": []})["rows"].append(d)
    bad_items = [k for k, v in items.items() if any(r["verdict"] in ("LOST", "INPUT NOT READ") for r in v["rows"])]
    used = collections.defaultdict(lambda: [0, 0])               # (group, copy) -> [claims used that it carries, of which only it carries]
    seen = set()
    for d in data:
        for i in d["ids"]:
            if i in ev["claims"] and i not in seen:
                seen.add(i)
                c = ev["claims"][i]
                for copy in c["in"]:
                    used[(c["group"], copy)][0] += 1
                if len(c["in"]) == 1:
                    used[(c["group"], c["in"][0])][1] += 1
    status = [ln.rsplit(" | ", 1)[-1].strip().lower() for ln in ev["inputs"][1:]]
    note = ev["top"][1] if len(ev["top"]) > 1 else ""
    started = (re.search(r"Started (\d\d:\d\d)", note) or [None, ""])[1]
    finished = (re.search(r"finished (\d\d:\d\d)", note) or [None, ""])[1]
    verdict = "PASS" if not count["LOST"] and not count["INPUT NOT READ"] else "FAIL"
    row = {"key": key, "audited_utc": now, "verdict": verdict, "items": len(items), "items_with_a_loss": len(bad_items), "claims": len(data),
           "carried": count["CARRIED"], "degraded": count["DEGRADED"], "lost": count["LOST"], "input_not_read": count["INPUT NOT READ"],
           "not_a_feed_claim": count["NOT A FEED CLAIM"], "pass_started": started, "pass_finished": finished,
           "pass_minutes": minutes(started, finished), "digest_sent": digest_sent, "evidence_bytes": ev["bytes"], "evidence_claims": len(ev["claims"]),
           "inputs_read": sum(1 for s in status if s.startswith("read")), "inputs_not_read": sum(1 for s in status if s.startswith("not read")),
           "figures_not_found": top_number(ev, r"figures not found (\d+)"), "item_links_not_covered": top_number(ev, r"links not covered (\d+)")}
    kinds = collections.Counter(v["kind"] for v in items.values())
    md = [f"# Shadow test audit, {key}", "",
          f"**{verdict}**: {len(items)} judged items ({kinds['card']} cards, {kinds['odds']} odds calls, {kinds['headline']} headline views), "
          f"{len(data)} claims checked: {count['CARRIED']} carried, {count['DEGRADED']} degraded, {count['LOST']} lost, "
          f"{count['INPUT NOT READ']} from an input the pass did not read, {count['NOT A FEED CLAIM']} not feed claims.", "",
          f"Evidence pass: started {started or '?'}, finished {finished or '?'} SGT ({row['pass_minutes'] or '?'} minutes); live digest sent {digest_sent} SGT. "
          f"Evidence file {ev['bytes']:,} bytes, {len(ev['claims'])} claims in {len(ev['blocks'])} items, {len(ev['stances'])} stance rows; "
          f"inputs read {row['inputs_read']}, not read {row['inputs_not_read']}; figures not found by the pass's own check {row['figures_not_found'] or '?'}, "
          f"item links not covered {row['item_links_not_covered'] or '?'}.", ""]
    if bad_items:
        md += ["## Items resting on a lost claim", ""] + [f"- {k} ({items[k]['kind']}): {items[k]['label']}" for k in bad_items] + [""]
    md += ["## Copies behind the claims the digest used", "", "| feed | copy | used claims it carries | of which only this copy carries |", "|---|---|---|---|"]
    md += [f"| {g} | {c} | {a} | {b} |" for (g, c), (a, b) in sorted(used.items())] + [""]
    md += ["## Claims", "", "| item | kind | label | claim | source | verdict | evidence | note |", "|---|---|---|---|---|---|---|---|"]
    md += ["| " + " | ".join(d[k].replace("|", "/") for k in COLS) + " |" for d in data] + ["", "## Auditor's notes", ""]
    with open(path(f"audit_{key}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    add_result(row)
    print("\n".join(md[2:5]))
    print(f"wrote {path(f'audit_{key}.md')} and added a row to {path('results.csv')}")
    return 0


def cmd_table():
    p = path("results.csv")
    if not os.path.exists(p):
        print("no results yet")
        return 0
    rows = list(csv.DictReader(open(p, newline="", encoding="utf-8")))
    cols = ["key", "verdict", "items", "claims", "carried", "degraded", "lost", "input_not_read", "pass_minutes", "pass_finished", "digest_sent", "evidence_claims"]
    print("| " + " | ".join(cols) + " |\n|" + "---|" * len(cols))
    for r in rows:
        print("| " + " | ".join(r.get(c, "") for c in cols) + " |")
    return 0


def cmd_selftest():
    global ROOT
    ROOT = tempfile.mkdtemp()
    text = ("EVIDENCE FILE — Macro Takeaways shadow test — 2026-01-01 (SGT)\n"
            "Built by the Takeaways evidence pass (Sonnet 5.5, shadow test). Started 06:33, sweeps 06:34 / 07:20 / 07:50, finished 07:58 SGT.\n"
            "Claims are copied.\nTOTALS: inputs listed 2\nFIGURE CHECK (by script): claims checked 2, not checkable 0, figures not found 3\n"
            "ITEM COVERAGE: x | links not covered 1\n\n## INPUTS\nn | sweep | status\n1 | 1 | Some | subject | abc | 100 | read\n2 | 1 | x | def | 5 | not read: reader failed\n\n"
            "## COPY TALLY (by script)\ngroup | copy\n\n## TOPIC INDEX\nFED: Y1001.1\n\n## YOUTUBE\n\n### Y1001 | video | Title | A Speaker (Firm) | https://x\ncopies: Gemini, ChatGPT\n"
            "- [Y1001.1] [US-EQ] [move] Index X closed at 1,234.56 (+0.7%), terms unchanged | in: YOUTUBE__Gemini__01.txt, ChatGPT\n- [Y1001.2] [FED] [view] A Speaker of MS expects 3 hikes | in: ChatGPT\n\n"
            "## LEFT OUT\n- A cooking video | Gemini | non-market\n\n## STANCES (rows lifted by script)\nYOUTUBE__Gemini | 2026-01-01 | youtube | A Speaker | Fed | Hawkish | x | y\n")
    src = os.path.join(ROOT, "saved.json")
    json.dump([{"type": "text", "text": json.dumps({"content": base64.b64encode(text.encode()).decode(), "title": "evidence_2026-01-01"})}], open(src, "w"))
    cmd_fetch(src, "2026-01-01")
    ev = load("2026-01-01")
    assert len(ev["claims"]) == 2 and ev["claims"]["Y1001.1"]["in"] == ["Gemini", "ChatGPT"] and len(ev["stances"]) == 1 and len(ev["inputs"]) == 3, "load"
    assert cmd_find("2026-01-01", ["1234.56", "speaker"], False) == 1 and cmd_find("2026-01-01", ["ms"], False) == 1, "find: a number, initials as a whole word"
    assert cmd_find("2026-01-01", ["hike"], False) == 1 and cmd_find("2026-01-01", ["234.56"], False) == 0 and cmd_find("2026-01-01", ["ms"], False, True) == 2, "find: word start, whole number, --part"
    open(path("audit_2026-01-01.tsv"), "w", encoding="utf-8").write(
        "\t".join(COLS) + "\nH1\theadline\tTop line\tIndex X closed 1,234.56\tGemini YouTube\tCARRIED\tY1001.1\t\n"
        "O1\todds\tQ07 up\tSpeaker expects 3 hikes\tChatGPT YouTube\tCARRIED\tY1001.2\t\n"
        "C1\tcard\tP50\tDealer short gamma\tGrok\tLOST\t\tGrok copy: 'dealers short gamma into Friday'\n")
    assert cmd_close("2026-01-01", "07:41", None) == 0, "close"
    md = open(path("audit_2026-01-01.md"), encoding="utf-8").read()
    assert "**FAIL**: 3 judged items (1 cards, 1 odds calls, 1 headline views), 3 claims checked: 2 carried, 0 degraded, 1 lost" in md, "summary"
    assert "| YOUTUBE | ChatGPT | 2 | 1 |" in md and "| YOUTUBE | Gemini | 1 | 0 |" in md and "(85 minutes)" in md, "copies"
    r = list(csv.DictReader(open(path("results.csv"), newline="", encoding="utf-8")))[0]
    assert r["verdict"] == "FAIL" and r["inputs_read"] == "1" and r["inputs_not_read"] == "1" and r["figures_not_found"] == "3" and r["item_links_not_covered"] == "1", f"row {r}"
    open(path("audit_2026-01-01.tsv"), "a", encoding="utf-8").write("C2\tcard\tP51\tx\ty\tCARRIED\tY9.9\t\n")
    assert cmd_close("2026-01-01", "07:41", None) == 1, "bad id must not close"
    cmd_close("2026-01-02", "", "NO FILE")
    cmd_close("2026-01-02", "", "NO DIGEST")
    assert [x["verdict"] for x in csv.DictReader(open(path("results.csv"), newline="", encoding="utf-8"))] == ["FAIL", "NO DIGEST"], "one row per key"
    cmd_table()
    print("selftest ok")
    return 0


def main(a):
    if a[1:] == ["selftest"]:
        return cmd_selftest()
    if len(a) == 4 and a[1] == "fetch":
        return cmd_fetch(a[2], a[3])
    if len(a) >= 4 and a[1] == "find":
        terms = [t for t in a[3:] if t not in ("--any", "--part")]
        cmd_find(a[2], terms, "--any" in a[3:], "--part" in a[3:])
        return 0
    if len(a) == 5 and a[1] == "close" and a[3] == "--digest-sent":
        return cmd_close(a[2], a[4], None)
    if len(a) == 4 and a[1] == "close" and a[3] in ("--no-file", "--no-digest"):
        return cmd_close(a[2], "", "NO FILE" if a[3] == "--no-file" else "NO DIGEST")
    if a[1:] == ["table"]:
        return cmd_table()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
