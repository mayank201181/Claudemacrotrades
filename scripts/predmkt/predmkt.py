#!/usr/bin/env python3
"""Prediction-market odds for the Macro Takeaways digests (Polymarket + Kalshi).

Stdlib only, no keys. Pulls the macro-relevant open contracts from the public
Polymarket Gamma API and Kalshi trade API, and writes to --out:
  predmkt_latest.md    compact table the digests read (copied to Drive daily)
  predmkt_latest.json  same rows, machine-readable
  predmkt_daily.csv    one row per contract per run (history for our own changes)

Usage: python3 -I predmkt.py --out DIR
"""
import argparse, csv, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

GAMMA = "https://gamma-api.polymarket.com/events"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2/events"
UA = {"User-Agent": "macro-desk-predmkt/1.0"}

# Polymarket tags to sweep, and the bucket each lands in (first match wins on title/tags below).
PM_TAGS = ["fed-rates", "Global-Rates", "economy", "inflation", "oil", "commodities", "japan",
           "china", "geopolitics", "tariffs", "middle-east", "ukraine", "taiwan", "europe"]
PM_DROP_TAGS = {"sports", "esports", "crypto", "crypto-prices", "pop-culture", "tweets-markets",
                "mention-markets", "ai", "tech", "big-tech", "ipo", "ipos", "games", "weather",
                "science", "aliens", "culture", "movies", "music", "awards"}
PM_DROP_TITLE = re.compile(r"mayor|governor|house election winner|senate election winner|"
                           r"# tweets|eggs|gas prices on|earthquake|ai model|ai company|nobel|"
                           r"\bpope\b|largest company|turnout|# of seats|place\b|next israeli minister|who will visit|"
                           r"secretary of|internet blackout", re.I)
PM_MIN_LIQ, PM_MIN_V24, PM_BIG_LIQ = 25_000, 10_000, 250_000
BUCKET_CAP = 20  # events per bucket in the markdown, by 24h volume

# Kalshi series kept (picked 28 Oct 2026 from 1,957 Economics/Financials series by open interest).
KALSHI_SERIES = ["KXFEDDECISION", "KXFED", "KXRATECUTCOUNT", "KXFEDFUNDSYEAR", "KXFEDCOMBO",
                 "KXCPI", "KXCPICORE", "KXCPIYOY", "KXCPICOREYOY", "KXU3", "KXPAYROLLS", "KXGDP",
                 "KXRECSSNBER", "KXCBDECISIONEU", "KXCBDECISIONJAPAN", "KXCBDECISIONCANADA",
                 "KXCBDECISIONAUSTRALIA", "KX10YRDIRHM", "KX10YRDIRLM", "KX2YRDIRLM", "KXUSDX",
                 "KXAAAGASM"]

BUCKETS = [
    ("Central banks & rates", re.compile(r"\bfed\b|fomc|rate (cut|hike)|bank of|central bank|ecb|boj|"
                                         r"rba|boc|treasury|yield|interest rate|dissent|funds rate", re.I)),
    ("Data & inflation", re.compile(r"\b(cpi|pce|ppi|inflation|gdp|unemployment|payrolls?|jobs|recession)\b", re.I)),
    ("Energy & commodities", re.compile(r"oil|crude|wti|brent|gold|silver|natural gas|copper|hormuz|"
                                        r"opec|diesel|gas price", re.I)),
    ("Trade & tariffs", re.compile(r"tariff|trade deal|trade deficit|sanction", re.I)),
    ("Geopolitics", re.compile(r"ceasefire|invade|military|strike|war|blockade|iran|israel|russia|"
                               r"ukraine|china|taiwan|korea|clash|putin|xi\b", re.I)),
    ("Elections & politics", re.compile(r"election|senate|house|president|prime minister|nominee|"
                                        r"out by|out before|leader", re.I)),
]


NOW_ISO = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - network flake or 429
            if i == tries - 1:
                print(f"WARN fetch failed {url[:120]}: {e}", file=sys.stderr)
                return None
            time.sleep(4 * (i + 1))  # Kalshi answers 429 to bursts


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def bucket(text):
    for name, rx in BUCKETS:
        if rx.search(text):
            return name
    return "Other macro"


def pm_price(m):
    bid, ask = f(m.get("bestBid")), f(m.get("bestAsk"))
    if bid is not None and ask is not None and 0 < ask - bid <= 0.10:
        return (bid + ask) / 2
    lt = f(m.get("lastTradePrice"))
    if lt is not None and lt > 0:
        return lt
    try:
        return float(json.loads(m.get("outcomePrices") or "[]")[0])
    except (ValueError, IndexError, TypeError):
        return None


def polymarket():
    seen, rows = set(), []
    for tag in PM_TAGS:
        q = urllib.parse.urlencode({"closed": "false", "active": "true", "limit": 100,
                                    "tag_slug": tag, "order": "volume24hr", "ascending": "false"})
        for e in get(f"{GAMMA}?{q}") or []:
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            tags = {(t.get("slug") or "").lower() for t in e.get("tags") or []}
            if tags & PM_DROP_TAGS or PM_DROP_TITLE.search(e.get("title", "")):
                continue
            liq, v24 = f(e.get("liquidity")) or 0, f(e.get("volume24hr")) or 0
            if liq < PM_MIN_LIQ or (v24 < PM_MIN_V24 and liq < PM_BIG_LIQ):
                continue
            outs = []
            for m in e.get("markets") or []:
                if m.get("closed") or not m.get("active", True):
                    continue
                p = pm_price(m)
                if p is None:
                    continue
                label = m.get("groupItemTitle") or m.get("question") or ""
                outs.append({"label": label.strip(), "p": p, "d1": f(m.get("oneDayPriceChange")),
                             "d7": f(m.get("oneWeekPriceChange")), "end": (m.get("endDate") or "")[:10],
                             "id": f"pm:{m.get('id')}"})
            if not outs:
                continue
            outs.sort(key=lambda o: -o["p"])
            rows.append({"venue": "Polymarket", "title": e["title"].strip(),
                         "bucket": bucket(e["title"] + " " + " ".join(tags)),
                         "v24": v24, "liq": liq, "end": (e.get("endDate") or "")[:10],
                         "url": f"https://polymarket.com/event/{e.get('slug')}", "outcomes": outs})
    return rows


def kalshi():
    rows = []
    for s in KALSHI_SERIES:
        time.sleep(0.5)
        d = get(f"{KALSHI}?series_ticker={s}&status=open&with_nested_markets=true&limit=10") or {}
        evs = sorted(d.get("events") or [], key=lambda e: min((m.get("close_time") or "9")
                                                              for m in e.get("markets") or [{}]))
        for e in evs[:2]:  # nearest two events per series
            ms = e.get("markets") or []
            v24 = sum(f(m.get("volume_24h_fp")) or 0 for m in ms)
            oi = sum(f(m.get("open_interest_fp")) or 0 for m in ms)
            if oi < 20_000 and v24 < 1_000:
                continue
            outs = []
            for m in ms:
                if (m.get("close_time") or "9") < NOW_ISO:  # already past its close, not yet settled
                    continue
                bid, ask, last = f(m.get("yes_bid_dollars")), f(m.get("yes_ask_dollars")), f(m.get("last_price_dollars"))
                p = (bid + ask) / 2 if bid is not None and ask and ask - bid <= 0.10 else last
                if p is None:
                    continue
                prev = f(m.get("previous_price_dollars"))
                outs.append({"label": (m.get("yes_sub_title") or m.get("subtitle") or m["ticker"]).strip(),
                             "p": p, "d1": (p - prev) if prev is not None and last else None, "d7": None,
                             "strike": f(m.get("floor_strike")), "type": m.get("strike_type"),
                             "end": (m.get("close_time") or "")[:10], "id": f"k:{m['ticker']}"})
            if not outs:
                continue
            row = {"venue": "Kalshi", "title": f"{e.get('title', '').strip()} ({e.get('sub_title') or ''})".replace(" ()", ""),
                   "bucket": bucket(e.get("title", "") + " " + s), "v24": v24, "liq": oi,
                   "end": min(o["end"] for o in outs),
                   "url": f"https://kalshi.com/markets/{s.lower()}", "outcomes": outs}
            ladder = [o for o in outs if o.get("type") == "greater" and o.get("strike") is not None]
            if len(ladder) >= 3:  # "Above X" ladder: read off the implied median
                ladder.sort(key=lambda o: o["strike"])
                row["median"] = implied_median(ladder)
                row["ladder"] = True
                row["outcomes"] = ladder
            else:
                outs.sort(key=lambda o: -o["p"])
            rows.append(row)
    return rows


def implied_median(ladder):
    """Strike where P(above) crosses 50%, linearly interpolated; None if never crossed."""
    for a, b in zip(ladder, ladder[1:]):
        if a["p"] >= 0.5 > b["p"]:
            return a["strike"] + (a["p"] - 0.5) / max(a["p"] - b["p"], 1e-9) * (b["strike"] - a["strike"])
    return None


def pct(x):
    return "-" if x is None else f"{100 * x:.0f}%"


def chg(x):
    if x is None:
        return ""
    v = round(100 * x)
    return "" if v == 0 else f"{v:+d}"


def num(x):
    return f"{x:,.0f}" if abs(x) >= 1000 else f"{x:.2f}".rstrip("0").rstrip(".")


def moves(o):
    parts = [f"{k} {chg(o[k])}" for k in ("d1", "d7") if chg(o[k])]
    return f" ({', '.join(parts)})" if parts else ""


def render(rows, stamp):
    order = [b for b, _ in BUCKETS] + ["Other macro"]
    lines = [f"# Prediction-market odds, {stamp}",
             "Polymarket + Kalshi, public APIs. p = mid (or last) YES price = crowd-implied probability; "
             "d1/d7 = change in pp over 1 day / 7 days (Kalshi: d1 only). v24 = 24h volume $; liq = "
             "Polymarket liquidity or Kalshi open interest $. Ladders ('Above X') show P(above) per strike "
             "and the implied median. Contracts with p under 3% or over 97% are hidden unless they are the "
             "leading outcome. Evidence of what the crowd prices, not a view.", ""]
    for b in order:
        rs = [r for r in rows if r["bucket"] == b]
        if not rs:
            continue
        rs = sorted(rs, key=lambda r: -(r["v24"] or 0))[:BUCKET_CAP]
        lines.append(f"## {b}")
        for r in rs:
            head = (f"- {r['title']} [{r['venue']}; resolves {r['end'] or '?'}; v24 ${r['v24']:,.0f}; "
                    f"liq ${r['liq']:,.0f}]")
            if r.get("ladder"):
                live = [o for o in r["outcomes"] if 0.03 <= o["p"] <= 0.97]
                med = r.get("median")
                head += f" implied median {num(med)}" if med is not None else ""
                body = "; ".join(f">{num(o['strike'])} {pct(o['p'])}{(' ' + chg(o['d1'])) if chg(o['d1']) else ''}"
                                 for o in live[:8])
            else:
                live = [o for i, o in enumerate(r["outcomes"]) if i == 0 or 0.03 <= o["p"] <= 0.97][:6]
                single = len(r["outcomes"]) == 1
                body = "; ".join(("YES" if single else o['label'][:60]) + f" {pct(o['p'])}" + moves(o) for o in live)
            lines.append(head + (": " + body if body else ""))
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-events", type=int, default=45)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    now = datetime.now(timezone.utc)
    stamp = f"{now:%Y-%m-%d %H:%M}Z ({(now + timedelta(hours=8)):%a %d %b %H:%M} SGT)"
    pm, ks = polymarket(), kalshi()
    pm.sort(key=lambda r: -(r["v24"] or 0))
    rows = pm[:a.max_events] + ks
    with open(os.path.join(a.out, "predmkt_latest.md"), "w") as fh:
        fh.write(render(rows, stamp) + "\n")
    with open(os.path.join(a.out, "predmkt_latest.json"), "w") as fh:
        json.dump({"asof": now.isoformat(), "rows": rows}, fh, indent=1)
    hist = os.path.join(a.out, "predmkt_daily.csv")
    new = not os.path.exists(hist)
    with open(hist, "a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["asof", "venue", "id", "event", "outcome", "p"])
        for r in rows:
            for o in r["outcomes"]:
                w.writerow([now.strftime("%Y-%m-%dT%H:%MZ"), r["venue"], o["id"], r["title"], o["label"], f"{o['p']:.4f}"])
    print(f"ok: {len(pm)} Polymarket events ({min(len(pm), a.max_events)} kept), {len(ks)} Kalshi events; "
          f"md {os.path.getsize(os.path.join(a.out, 'predmkt_latest.md'))} bytes")


if __name__ == "__main__":
    main()
