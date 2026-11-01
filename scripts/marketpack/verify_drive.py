#!/usr/bin/env python3
"""Compare a Drive read-back of the market pack with the local file.

Usage: python3 -I verify_drive.py <drive read-back file> <local market_pack_latest.md>
The read-back may be the raw tool-result JSON ({"fileContent": ...}) or plain text. Drive adds markdown
backslash escapes and may change blank lines and trailing spaces; those differences are ignored.
Prints PASS or FAIL with the first differing line.
"""
import json, re, sys

raw = open(sys.argv[1], encoding="utf-8").read()
try:
    raw = json.loads(raw)["fileContent"]
except Exception:  # noqa: BLE001
    pass


def norm(s):
    s = re.sub(r"\\([!-/:-@\[-`{-~])", r"\1", s)  # undo markdown escapes before punctuation
    return [ln.rstrip() for ln in s.splitlines() if ln.strip()]


a, b = norm(raw), norm(open(sys.argv[2], encoding="utf-8").read())
if a == b:
    print(f"PASS {len(b)} lines")
    sys.exit(0)
for i, (x, y) in enumerate(zip(a, b)):
    if x != y:
        print(f"FAIL at line {i + 1}: drive={x[:120]!r} local={y[:120]!r}")
        break
else:
    print(f"FAIL line count drive={len(a)} local={len(b)}")
sys.exit(1)
