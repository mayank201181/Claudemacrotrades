#!/usr/bin/env python3
"""ev.py: the scripted steps of the Takeaways evidence pass (shadow test). Standard library only.
  ev.py selftest
  ev.py read <saved get_thread result> <out.txt>     one saved Gmail result -> text with short lines; when the HTML part
                                                     holds more than the plain part, the HTML part is the text
  ev.py wait <HH:MM>                                 sleep until that Singapore time, at most 270 seconds a call
  ev.py check <part file>                            count blocks and claims, list lines that do not parse (the part
                                                     files of the same or an earlier sweep in its folder give the context)
  ev.py finish <W> <TODAY> "<note>"                  stance rows, figure check, evidence file, upload arguments
"""
import collections
import datetime as dt
import glob
import hashlib
import html
import json
import os
import re
import sys
import tempfile
import textwrap
import time
import urllib.parse

GROUPS = [("Y", "YOUTUBE"), ("P", "PODCAST"), ("E", "EMAIL"), ("S", "SLACK"), ("G", "GROK"), ("C", "CROWDING"),
          ("D", "DESK INPUT"), ("V", "ECONVITALS"), ("M", "PEER TAKEAWAYS")]
HEAD = re.compile(r"^### ([A-Z]\d+)\b\s*\|?\s*(.*)$")
CLAIM = re.compile(r"^- \[([A-Z]\d+\.\d+)\] \[([^\]]+)\] \[([^\]]+)\] (.+?) \| in: (.+)$")
ALSO = re.compile(r"^- also: ([A-Z]\d+\.\d+) \| (.+)$")
STANCE = re.compile(r"^\d{4}-\d{2}-\d{2} \|")
GLINK = re.compile(r"https?://www\.google\.com/url\?q=([^&\s)>\]]+)(?:&(?:amp;)?[a-z]+=[^&\s)>\]]*)*")
FIGURE = re.compile(r"(?<![\w.])\d(?:[\d,]*\d)?(?:\.\d+)?")
SAVE = re.compile(r"^[A-Za-z_]+__(.+?)__\d+\.(?:txt|stances)$")
SWEEP = re.compile(r"_s(\d+)\.md$")
ITEM = re.compile(r"(?:[?&]v=|youtu\.be/)([\w-]{11})(?![\w-])|[?&]i=(\d{6,})")
SGT = dt.timezone(dt.timedelta(hours=8))


def unwrap(o):
    """A saved result is the JSON itself, or a list of {type, text} parts whose text is that JSON."""
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


def messages(o):
    if isinstance(o, dict):
        if "plaintextBody" in o or "htmlBody" in o:
            yield o
        for v in o.values():
            yield from messages(v)
    elif isinstance(o, list):
        for v in o:
            yield from messages(v)


def html_text(h):
    """An HTML body as text: a link keeps its address in brackets, table cells are set apart by pipes."""
    h = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", h)
    h = re.sub(r"""(?is)<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""",
               lambda g: g.group(2) + (f" ({g.group(1)})" if g.group(1).startswith("http") and g.group(1) not in g.group(2) else ""), h)
    h = re.sub(r"(?i)</t[dh]>", " | ", h)
    h = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>|</h[1-6]>|</pre>|</blockquote>", "\n", h)
    t = re.sub(r"[ \t\xa0]+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
    return "\n".join(ln.strip() for ln in t.split("\n"))


def squeeze(t):
    """The length of a body without links and markup, to compare the plain part of an email with its HTML part."""
    return len(re.sub(r"\s+", " ", re.sub(r"[*_#=\[\]()|>`-]", "", re.sub(r"https?://\S+", "", t))))


def body_of(m):
    """Some senders put only the first section into the plain part and the whole email into the HTML part."""
    p, h = m.get("plaintextBody") or "", html_text(m.get("htmlBody") or "")
    use_html = bool(h.strip()) and (not p.strip() or squeeze(h) > 1.10 * squeeze(p) + 300)
    m["_body"] = f"body used: {'HTML part' if use_html else 'plain part'} (text without links and markup: plain part {squeeze(p)} characters, HTML part {squeeze(h)})"
    b = GLINK.sub(lambda g: urllib.parse.unquote(g.group(1)), h if use_html else p)
    out = []
    for ln in b.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        ln = ln.rstrip()
        keep = len(ln) <= 500 or (STANCE.match(ln) and ln.count(" | ") >= 5)      # a stance row stays on one line
        out += [ln] if keep else (textwrap.wrap(ln, 500, break_long_words=False, break_on_hyphens=False) or [ln])
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def cmd_read(src, dst):
    raw = open(src, encoding="utf-8", errors="replace").read().lstrip(chr(0xFEFF))
    o = unwrap(raw)
    parts = []
    if not isinstance(o, str):
        for m in messages(o):
            parts.append(f"=== subject: {m.get('subject', '')} | date: {m.get('date', '')} | message id: {m.get('id', '')}\n" + body_of(m))
    text = "\n\n".join(parts) if parts else raw
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    print(f"{len(text)} characters, {len(text.splitlines())} lines, {len(parts)} message(s) -> {dst}")
    if not isinstance(o, str):
        for m in messages(o):
            print("  " + m.get("_body", ""))
    if not parts:
        print("WARNING: no message body found; the raw text was written instead")
    return 0


def cmd_wait(hhmm):
    now = dt.datetime.now(SGT)
    h, m = (int(x) for x in hhmm.split(":"))
    left = (now.replace(hour=h, minute=m, second=0, microsecond=0) - now).total_seconds()
    if left > 0:
        time.sleep(min(left, 270))
    now = dt.datetime.now(SGT)
    print(f"now {now:%H:%M} SGT; " + ("reached" if left <= 270 else "not yet, run the same command again"))
    return 0


def canon(name):
    """The copy name; a save name such as DESK_INPUT__Desk-RedTeam__5.txt is cut down to Desk-RedTeam."""
    m = SAVE.match(name.strip())
    return m.group(1) if m else name.strip()


def parse_parts(paths):
    """Blocks and claims from part files, in file order. A header that repeats an id continues that block."""
    blocks, claims, bad, left_out = collections.OrderedDict(), collections.OrderedDict(), [], []
    cur, in_left = None, False
    for p in paths:
        for n, ln in enumerate(open(p, encoding="utf-8", errors="replace").read().splitlines(), 1):
            ln = ln.rstrip()
            if ln.startswith("## "):
                in_left, cur = ln.upper().startswith("## LEFT OUT"), None
                continue
            h, c, a = HEAD.match(ln), CLAIM.match(ln), ALSO.match(ln)
            if h:
                cur, in_left = h.group(1), False
                blocks.setdefault(cur, {"head": h.group(2).strip(), "heads": "", "claims": []})["heads"] += " " + h.group(2)
            elif c:
                cid = c.group(1)
                names = []
                for x in c.group(5).split(","):
                    if x.strip() and canon(x) not in names:
                        names.append(canon(x))
                if cid in claims or cid.split(".")[0] not in blocks:
                    bad.append(f"{os.path.basename(p)}:{n}: " + ("claim id used twice" if cid in claims else "claim before its ### block") + f": {ln[:90]}")
                    continue
                claims[cid] = {"topic": c.group(2).strip().upper(), "type": c.group(3).strip().lower(), "text": c.group(4).strip(), "in": names}
                blocks[cid.split(".")[0]]["claims"].append(cid)
            elif a:
                if a.group(1) in claims:
                    for x in a.group(2).split(","):
                        if x.strip() and canon(x) not in claims[a.group(1)]["in"]:
                            claims[a.group(1)]["in"].append(canon(x))
                else:
                    bad.append(f"{os.path.basename(p)}:{n}: also-line for an unknown claim: {ln[:90]}")
            elif in_left and ln.startswith("- "):
                left_out.append(ln)
            elif ln.startswith("- ") or ln.startswith("###"):
                bad.append(f"{os.path.basename(p)}:{n}: does not parse: {ln[:90]}")
    return blocks, claims, bad, left_out


def cmd_check(path):
    """The part file is read after the other part files of its folder that belong to the same or an earlier sweep,
    so that an also-line or a continued block that points at one of them parses."""
    own = SWEEP.search(path)
    ctx = [p for p in sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(path)), "*.md")))
           if os.path.abspath(p) != os.path.abspath(path) and own and SWEEP.search(p) and int(SWEEP.search(p).group(1)) <= int(own.group(1))]
    b0, c0, _, l0 = parse_parts(ctx)
    blocks, claims, bad, left_out = parse_parts(ctx + [path])
    bad = [b for b in bad if b.startswith(os.path.basename(path) + ":")]
    also = sum(1 for ln in open(path, encoding="utf-8", errors="replace").read().splitlines() if ALSO.match(ln.rstrip()))
    print(f"{os.path.basename(path)}: new items {len(blocks) - len(b0)} | new claims {len(claims) - len(c0)} | also lines {also} | "
          f"left out {len(left_out) - len(l0)} | lines that do not parse {len(bad)}")
    for b in bad[:40]:
        print("  " + b)
    empty = [k for k, v in blocks.items() if k not in b0 and not v["claims"]]
    if empty:
        print("  items with no claim line (fine only when the item continues an earlier block): " + ", ".join(empty[:30]))
    return 1 if bad else 0


def norm(t):
    return re.sub(r"(?<=\d),(?=\d)", "", t)


def figure_check(W, blocks, claims):
    texts = collections.defaultdict(dict)                 # group name -> copy -> text
    for p in glob.glob(os.path.join(W, "in", "*.txt")):
        bits = os.path.basename(p)[:-4].split("__")
        if len(bits) >= 2:
            texts[bits[0].upper()][bits[1]] = texts[bits[0].upper()].get(bits[1], "") + norm(open(p, encoding="utf-8", errors="replace").read().replace("*", ""))
    names = dict(GROUPS)
    checked = unchecked = 0
    misses = []
    for cid, c in claims.items():
        group = texts.get(names.get(cid[0], "").replace(" ", "_"), {})
        src = [t for copy, t in group.items() if copy in c["in"] or c["type"] == "conflict"]
        figs = [f for f in (norm(x) for x in FIGURE.findall(c["text"])) if len(f) > 1]
        if not src or not figs:
            unchecked += 1
            continue
        checked += 1
        for f in figs:
            if not any(re.search(r"(?<![\d.])" + re.escape(f) + r"(?!\d)", t) for t in src):
                misses.append(f"{cid} | {f} | {c['text'][:200]}")
    return checked, unchecked, misses


def coverage(W, blocks, claims, left_out):
    """For each saved YouTube or podcast copy: is every video or episode it links in a block that names this copy,
    or in a LEFT OUT line that names it?"""
    rows, missing = [], []
    for p in sorted(glob.glob(os.path.join(W, "in", "*.txt"))):
        bits = os.path.basename(p)[:-4].split("__")
        letter = next((le for le, n in GROUPS if n.replace(" ", "_") == bits[0].upper()), None)
        ids = []
        for m in ITEM.finditer(open(p, encoding="utf-8", errors="replace").read()):
            if (m.group(1) or m.group(2)) not in ids:
                ids.append(m.group(1) or m.group(2))
        if letter is None or len(bits) < 2 or not ids:
            continue
        have = {i for i in ids for ln in left_out if i in ln and bits[1] in ln}
        for k, v in blocks.items():
            if k[0] == letter and any(bits[1] in claims[cid]["in"] for cid in v["claims"]):
                have.update(i for i in ids if i in v["heads"])
        rows.append(f"{bits[0]}__{bits[1]}: {len(ids)} item links, {len(have)} covered")
        missing += [f"{bits[0]}__{bits[1]} | {i}" for i in ids if i not in have]
    return rows, missing


def cmd_finish(W, today, note):
    paths = sorted(glob.glob(os.path.join(W, "parts", "*.md")), key=lambda p: (re.sub(r"_s\d+\.md$", "", os.path.basename(p)), p))
    order = [g[1].replace(" ", "_") for g in GROUPS]
    paths.sort(key=lambda p: ([i for i, g in enumerate(order) if os.path.basename(p).upper().startswith(g.split("_")[0])] or [99])[0])
    blocks, claims, bad, left_out = parse_parts(paths)
    stances = []
    for p in sorted(glob.glob(os.path.join(W, "in", "*.txt")) + glob.glob(os.path.join(W, "in", "*.stances"))):
        copy = "__".join(os.path.basename(p).rsplit(".", 1)[0].split("__")[:2]) + (" (typed by the reader)" if p.endswith(".stances") else "")
        for ln in open(p, encoding="utf-8", errors="replace").read().splitlines():
            if STANCE.match(ln.strip()) and ln.count(" | ") >= 5:
                stances.append(f"{copy} | {ln.strip()}")
    checked, unchecked, misses = figure_check(W, blocks, claims)
    with open(os.path.join(W, "numcheck.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(misses) + "\n")
    cover, missing = coverage(W, blocks, claims, left_out)
    with open(os.path.join(W, "missing_items.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(missing) + "\n")
    body, tally, topics = [], [], collections.defaultdict(list)
    for letter, name in GROUPS:
        mine = [(k, v) for k, v in blocks.items() if k[0] == letter]
        if not mine:
            continue
        body.append(f"\n## {name}")
        per = collections.defaultdict(lambda: [0, 0, 0])
        for k, v in mine:
            copies = []
            for cid in v["claims"]:
                for x in claims[cid]["in"]:
                    if x not in copies:
                        copies.append(x)
            body.append(f"\n### {k} | {v['head']}\ncopies: {', '.join(copies) or '-'}")
            for cid in v["claims"]:
                c = claims[cid]
                body.append(f"- [{cid}] [{c['topic']}] [{c['type']}] {c['text']} | in: {', '.join(c['in'])}")
                topics[c["topic"]].append(cid)
                for x in c["in"]:
                    per[x][0] += 1
                if len(c["in"]) == 1:
                    per[c["in"][0]][1] += 1
            if len(copies) == 1:
                per[copies[0]][2] += 1
        tally += [f"{name} | {x} | {a} | {b} | {c}" for x, (a, b, c) in per.items()]
    inputs = open(os.path.join(W, "inputs.tsv"), encoding="utf-8").read().strip().splitlines() if os.path.exists(os.path.join(W, "inputs.tsv")) else []
    claims_part = "\n".join(body)
    head = [f"EVIDENCE FILE — Macro Takeaways shadow test — {today} (SGT)", note,
            "Claims are copied from the inputs listed below: figures as written, nothing checked, nothing ranked. \"in:\" names the copies that carry a claim.",
            f"TOTALS: inputs listed {max(0, len(inputs) - 1)} | items {len(blocks)} | claims {len(claims)} | conflicts {sum(1 for c in claims.values() if c['type'] == 'conflict')} | "
            f"stance rows {len(stances)} | characters: claims {len(claims_part)}, stance rows {sum(len(s) + 1 for s in stances)}",
            f"FIGURE CHECK (by script, against the saved text of the copies named): claims checked {checked}, not checkable {unchecked}, figures not found {len(misses)}",
            "ITEM COVERAGE (by script; a video or episode link counts when a block or a LEFT OUT line names that copy): " + ("; ".join(cover) or "no item links found")
            + f" | links not covered {len(missing)}",
            f"PART FILE LINES THAT DID NOT PARSE: {len(bad)}", "", "## INPUTS"] + [ln.replace("\t", " | ") for ln in inputs]
    head += ["", "## COPY TALLY (by script, from the \"in:\" lists)", "group | copy | claims carried | claims only this copy carries | items only this copy carries"] + tally
    head += ["", "## TOPIC INDEX"] + [f"{t}: {', '.join(v)}" for t, v in sorted(topics.items())]
    tail = ["", "## LEFT OUT"] + left_out + ["", "## STANCES (rows lifted by script, as written, not de-duplicated)"] + stances
    out = os.path.join(W, f"evidence_{today}.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(head) + "\n" + claims_part + "\n" + "\n".join(tail) + "\n")
    data = open(out, "rb").read()
    print("\n".join(head[3:7]))
    for m in missing[:60]:
        print("  item link not covered: " + m)
    for b in bad[:20]:
        print("  does not parse: " + b)
    for m in misses[:40]:
        print("  figure not found: " + m)
    print(f"\nwrote {out}, {len(data)} bytes; figure misses are listed in {os.path.join(W, 'numcheck.txt')}")
    print("CREATE_FILE (call Google Drive create_file with exactly these five arguments):")
    print(f"title = <the title STEP 5 gives>\nparentId = <the folder STEP 5 gives>\ncontentMimeType = text/plain\ndisableConversionToGoogleType = true")
    print(f"base64Content = sha256:{hashlib.sha256(data).hexdigest()}:{os.path.abspath(out)}")
    print(f"EXPECT fileSize = {len(data)}")
    return 0


def cmd_selftest():
    """Every name and number below is made up."""
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "in"))
    os.makedirs(os.path.join(d, "parts"))
    msg = {"messages": [{"id": "m1", "subject": "YouTube Digest [Gemini] — 2026-01-01", "date": "2025-12-31T22:17:37Z",
                         "plaintextBody": "Index X closed at **1,234**.56 (+0.7%), (https://www.google.com/url?q=https://a.b/c?v%3D1&source=gmail&ust=1&sa=E)\n"
                                          "1. https://www.youtube.com/watch?v=abcdefghijk and 2. https://youtu.be/ZYXWVUTSRQP\n"
                                          "2026-01-01 | youtube | A Speaker | Fed | Hawkish | two hikes | abc123"}]}
    json.dump([{"type": "text", "text": json.dumps(msg)}], open(os.path.join(d, "saved.json"), "w"))
    cmd_read(os.path.join(d, "saved.json"), os.path.join(d, "in", "YOUTUBE__Gemini__01.txt"))
    t = open(os.path.join(d, "in", "YOUTUBE__Gemini__01.txt"), encoding="utf-8").read()
    assert "https://a.b/c?v=1)" in t and "google.com/url" not in t and t.startswith("=== subject: YouTube Digest [Gemini]"), "read"
    cut = {"messages": [{"id": "m2", "subject": "Cut plain part", "plaintextBody": "Top line only.",
                         "htmlBody": "<html><head><style>p{}</style></head><body><p>Top line only.</p>"
                                     + "<p>A later section with a <a href=\"https://a.b/x\">link</a> and words the plain part lacks.</p>" * 12
                                     + "<table><tr><td>Cell A</td><td>Cell B</td></tr></table></body></html>"}]}
    json.dump(cut, open(os.path.join(d, "saved2.json"), "w"))
    cmd_read(os.path.join(d, "saved2.json"), os.path.join(d, "cut.txt"))
    t2 = open(os.path.join(d, "cut.txt"), encoding="utf-8").read()
    assert "link (https://a.b/x)" in t2 and "Cell A | Cell B" in t2 and "p{}" not in t2 and t2.count("later section") == 12, "html body"
    open(os.path.join(d, "in", "YOUTUBE__ChatGPT__02.txt"), "w", encoding="utf-8").write("Index X closed at 1,243.56. December move priced 61%.\n")
    open(os.path.join(d, "parts", "YOUTUBE_s1.md"), "w", encoding="utf-8").write(
        "## YOUTUBE\n### Y1001 | video | Title | A Speaker (Firm) | https://www.youtube.com/watch?v=abcdefghijk\n"
        "- [Y1001.1] [US-EQ] [move] Index X closed at 1,234.56, up 0.7% | in: YOUTUBE__Gemini__01.txt\n"
        "- [Y1001.2] [FED] [view] A Speaker expects 3 hikes of 25 bp | in: Gemini\n## LEFT OUT\n- A cooking video | Gemini | non-market\n")
    open(os.path.join(d, "parts", "YOUTUBE_s2.md"), "w", encoding="utf-8").write(
        "### Y1001 | video | Title | A Speaker (Firm) | -\n- also: Y1001.1 | ChatGPT\n- [Y1001.3] [FED] [odds] December move priced 61% | in: ChatGPT\n"
        "- [Y1001.4] [US-EQ] [conflict] Gemini: Index X 1,234.56; ChatGPT: 1,243.56 | in: Gemini\nstray line\n- broken claim\n")
    peer = os.path.join(d, "parts", "PEER_s2.md")
    open(peer, "w", encoding="utf-8").write("## PEER TAKEAWAYS\n### Y1001 | video | Title | A Speaker (Firm) | -\n- also: Y1001.2 | Gemini-MT\n")
    assert cmd_check(peer) == 0 and cmd_check(os.path.join(d, "parts", "YOUTUBE_s2.md")) == 1 and cmd_check(os.path.join(d, "parts", "YOUTUBE_s1.md")) == 0, "check"
    os.remove(peer)
    blocks, claims, bad, left = parse_parts(sorted(glob.glob(os.path.join(d, "parts", "*.md"))))
    assert len(blocks) == 1 and len(claims) == 4 and claims["Y1001.1"]["in"] == ["Gemini", "ChatGPT"] and len(bad) == 1 and len(left) == 1, "parse"
    checked, unchecked, misses = figure_check(d, blocks, claims)
    assert checked == 4 and unchecked == 0 and [m.split(" | ")[1] for m in misses] == ["25"], f"figures {checked} {unchecked} {misses}"
    open(os.path.join(d, "inputs.tsv"), "w").write("n\tsweep\tgroup\n1\t1\tYOUTUBE\n")
    open(os.path.join(d, "in", "PODCAST__ChatGPT__03.stances"), "w").write("2026-01-01 | podcast | B Speaker | Oil | Bearish | glut | ep9\n")
    cmd_finish(d, "2026-01-01", "selftest")
    e = open(os.path.join(d, "evidence_2026-01-01.txt"), encoding="utf-8").read()
    assert "PODCAST__ChatGPT (typed by the reader) | 2026-01-01 | podcast | B Speaker" in e, "typed stance rows"
    assert coverage(d, blocks, claims, left) == (["YOUTUBE__Gemini: 2 item links, 1 covered"], ["YOUTUBE__Gemini | ZYXWVUTSRQP"]), "coverage"
    assert "YOUTUBE | Gemini | 3 | 2 | 0" in e and "YOUTUBE | ChatGPT | 2 | 1 | 0" in e and "FED: Y1001.2, Y1001.3" in e and "YOUTUBE__Gemini | 2026-01-01 | youtube" in e, "finish"
    print("selftest ok")
    return 0


def main(a):
    if a[1:] == ["selftest"]:
        return cmd_selftest()
    if len(a) == 4 and a[1] == "read":
        return cmd_read(a[2], a[3])
    if len(a) == 3 and a[1] == "wait":
        return cmd_wait(a[2])
    if len(a) == 3 and a[1] == "check":
        return cmd_check(a[2])
    if len(a) == 5 and a[1] == "finish":
        return cmd_finish(a[2], a[3], a[4])
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
