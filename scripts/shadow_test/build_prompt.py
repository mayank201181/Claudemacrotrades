#!/usr/bin/env python3
"""Build the prompt of the Takeaways evidence pass (shadow test) from its four parts.

  python3 -I build_prompt.py <out file>

head.txt (what the run is, hard limits), setup.txt (work folder, copy-out step), steps.txt (sweeps, readers, checks,
upload), then ev.py and brief.md between marker lines. The run copies ev.py and brief.md back out of its own prompt
with the script in setup.txt, so the files here are the only source. Prints the byte count and md5: after storing the
text on the scheduled task, read the task back and compare both."""
import hashlib
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))


def read(name):
    return open(os.path.join(here, name), encoding="utf-8").read().rstrip("\n")


def main(a):
    if len(a) != 2:
        print(__doc__)
        return 2
    prose = read("head.txt") + "\n\n" + read("setup.txt") + "\n\n" + read("steps.txt")
    for mark in ("#### EV.PY START", "#### EV.PY END", "#### BRIEF START", "#### BRIEF END"):
        assert mark not in prose and mark not in read("ev.py") and mark not in read("brief.md"), f"a part spells the marker {mark}"
    out = prose + "\n\n#### EV.PY START\n" + read("ev.py") + "\n#### EV.PY END\n\n#### BRIEF START\n" + read("brief.md") + "\n#### BRIEF END\n"
    assert all(ord(c) != 0xFEFF for c in out), "invisible character in the text"
    data = out.encode("utf-8")
    assert len(data) < 65536, f"{len(data)} bytes: over the 65,536 limit of a stored prompt"
    with open(a[1], "wb") as f:
        f.write(data)
    print(f"{a[1]}: {len(data)} bytes, md5 {hashlib.md5(data).hexdigest()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
