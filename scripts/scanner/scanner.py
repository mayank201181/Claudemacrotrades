#!/usr/bin/env python3
"""Extremes and seasonality scanner: conditional setups for the Macro Takeaways, with their own base rates.

  python3 -I scanner.py --out <folder>            build <folder>/extremes_latest.md (and caches under <folder>)
  python3 -I scanner.py --out <folder> --no-fetch  rebuild from the cached history only (tests)

What it does, every morning, over the market pack's price universe (Yahoo daily bars, up to 16 years, cached) and the
CFTC Traders in Financial Futures / Disaggregated reports (public Socrata API, weekly since 2006):

  1. flags today's extremes: closes outside the 20-day Bollinger band for 4+ sessions, stretch from the 20-day mean
     of 2.5 ATR or more, RSI(14) at 75/25, a 20-day move of 2 sigma or more against its own 3-year distribution,
     a cross-asset pair whose legs have diverged by 2.2 sigma while still correlated, and a CFTC net position at or
     beyond its 3-year 5th/95th percentile;
  2. gives each flag the base rate from the SAME series' own history: how often the move reverted over the next
     5, 10 and 20 sessions after the same kind of extreme, the median forward move, the sample size, what a fade
     had to sit through on the way (adverse excursion), the dates of the last three such events, and the
     unconditional rate the same series would have shown on any day (the baseline), with a binomial test;
  3. lists the seasonal windows opening now (the next 20 sessions, each past year): hit rate, median move, years,
     the asset's unconditional rate, and the placebo rate (the share of all calendar start dates in that series
     that would pass the same test, which is what chance alone produces);
  4. writes a flags history (one row per flag per day) so the weekly review can judge the flags later.

Nothing here is a signal on its own. A flag is a CONDITIONAL candidate: it matters only with a catalyst or a
mechanism, and it must pass the trade gate like any other lean. The digest rule that reads this file says how.
Stdlib only, no credentials. Yahoo and CFTC are public, delayed sources.
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
import urllib.parse
import urllib.request

SGT = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0"}   # Yahoo answers 429 to fuller browser strings and to the python default
MAX_YEARS = 16
HORIZONS = (5, 10, 20)
COOLDOWN = 10           # sessions a condition must have been false before a new event is counted
MIN_N = 20              # events below this print THIN
PASS_EDGE = 10          # points of hit rate above the baseline needed, with p < 0.05, to print REVERTS
SEAS_MIN_YEARS = 10
SEAS_HIT = 0.70

# label, yahoo symbol(s), kind (px price; yld yield in %, moves in bp), group
ASSETS = [
    ("DXY", "DX-Y.NYB", "px", "FX"), ("EURUSD", "EURUSD=X", "px", "FX"), ("USDJPY", "JPY=X", "px", "FX"),
    ("GBPUSD", "GBPUSD=X", "px", "FX"), ("AUDUSD", "AUDUSD=X", "px", "FX"), ("NZDUSD", "NZDUSD=X", "px", "FX"),
    ("USDCAD", "CAD=X", "px", "FX"), ("USDCHF", "CHF=X", "px", "FX"), ("EURJPY", "EURJPY=X", "px", "FX"),
    ("AUDJPY", "AUDJPY=X", "px", "FX"), ("GBPJPY", "GBPJPY=X", "px", "FX"),
    ("AUDNZD", "AUDNZD=X", "px", "FX"), ("EURGBP", "EURGBP=X", "px", "FX"), ("EURCHF", "EURCHF=X", "px", "FX"),
    ("USDCNH", "CNH=X|CNY=X", "px", "AsiaFX"), ("USDKRW", "KRW=X", "px", "AsiaFX"),
    ("USDTWD", "TWD=X", "px", "AsiaFX"), ("USDINR", "INR=X", "px", "AsiaFX"), ("USDSGD", "SGD=X", "px", "AsiaFX"),
    ("USDIDR", "IDR=X", "px", "AsiaFX"), ("USDPHP", "PHP=X", "px", "AsiaFX"), ("USDTHB", "THB=X", "px", "AsiaFX"),
    ("USDMYR", "MYR=X", "px", "AsiaFX"),
    ("UST2Y", "FRED:DGS2", "yld", "Rates"), ("UST5Y", "^FVX", "yld", "Rates"), ("UST10Y", "^TNX", "yld", "Rates"),
    ("UST30Y", "^TYX", "yld", "Rates"), ("UST10 fut", "ZN=F", "px", "Rates"),
    ("Brent", "BZ=F", "px", "Energy"), ("WTI", "CL=F", "px", "Energy"), ("HenryHub", "NG=F", "px", "Energy"),
    ("TTF", "TTF=F", "px", "Energy"), ("HeatOil", "HO=F", "px", "Energy"), ("Gasoline", "RB=F", "px", "Energy"),
    ("Gold", "GC=F", "px", "Metals"), ("Silver", "SI=F", "px", "Metals"), ("Copper", "HG=F", "px", "Metals"),
    ("SPX", "^GSPC", "px", "Equity"), ("NDX", "^NDX", "px", "Equity"), ("RUT", "^RUT", "px", "Equity"),
    ("SOX", "^SOX", "px", "Equity"), ("SX5E", "^STOXX50E", "px", "Equity"), ("DAX", "^GDAXI", "px", "Equity"),
    ("N225", "^N225", "px", "APAC eq"), ("KOSPI", "^KS11", "px", "APAC eq"), ("TAIEX", "^TWII", "px", "APAC eq"),
    ("HSI", "^HSI", "px", "APAC eq"), ("HSCEI", "^HSCE", "px", "APAC eq"), ("CSI300", "000300.SS|000001.SS", "px", "APAC eq"),
    ("NIFTY", "^NSEI", "px", "APAC eq"), ("ASX200", "^AXJO", "px", "APAC eq"), ("STI", "^STI", "px", "APAC eq"),
    ("VIX", "^VIX", "px", "Vol"), ("MOVE", "^MOVE", "px", "Vol"),
]

# Synthetic series built from two loaded ones: label, leg a minus leg b (yields in %), kind, group
SYNTH = [("US 2s10s", "UST10Y", "UST2Y", "yld", "Rates"), ("US 5s30s", "UST30Y", "UST5Y", "yld", "Rates")]

# Cross-asset pairs: leg a, leg b, the sign their moves normally share (+1 together, -1 opposite)
PAIRS = [("DXY", "Gold", -1), ("UST10Y", "USDJPY", 1), ("UST10Y", "Gold", -1), ("Brent", "USDCAD", -1),
         ("Copper", "AUDUSD", 1), ("USDCNH", "AUDUSD", -1), ("VIX", "SPX", -1), ("SOX", "KOSPI", 1),
         ("SOX", "TAIEX", 1), ("USDJPY", "N225", 1), ("US 2s10s", "USDJPY", -1)]
PAIR_Z = 2.2            # divergence of the two legs' 20-session moves, each in units of its own 60-session sigma
PAIR_CORR = 0.3         # the 60-session correlation must still carry the normal sign at least this strongly

# CFTC: label, dataset, contract code, group column prefix, price label whose move the position bets on,
# sign (+1 net long means the price label rises, -1 the opposite, for USDJPY-style quotes)
TFF, DIS = "gpe5-46if", "72hh-3qpy"
CFTC = [
    ("EUR (lev funds)", TFF, "099741", "lev_money", "EURUSD", 1), ("JPY (lev funds)", TFF, "097741", "lev_money", "USDJPY", -1),
    ("GBP (lev funds)", TFF, "096742", "lev_money", "GBPUSD", 1), ("AUD (lev funds)", TFF, "232741", "lev_money", "AUDUSD", 1),
    ("NZD (lev funds)", TFF, "112741", "lev_money", "NZDUSD", 1), ("CAD (lev funds)", TFF, "090741", "lev_money", "USDCAD", -1),
    ("CHF (lev funds)", TFF, "092741", "lev_money", "USDCHF", -1), ("DXY (lev funds)", TFF, "098662", "lev_money", "DXY", 1),
    ("UST 2y (lev funds)", TFF, "042601", "lev_money", "UST2Y", -1), ("UST 10y (lev funds)", TFF, "043602", "lev_money", "UST10Y", -1),
    ("UST 10y (asset mgrs)", TFF, "043602", "asset_mgr", "UST10Y", -1), ("UST bond (lev funds)", TFF, "020601", "lev_money", "UST30Y", -1),
    ("S&P 500 (lev funds)", TFF, "13874+", "lev_money", "SPX", 1), ("S&P 500 (asset mgrs)", TFF, "13874+", "asset_mgr", "SPX", 1),
    ("Nasdaq 100 (lev funds)", TFF, "20974+", "lev_money", "NDX", 1), ("Nikkei yen (lev funds)", TFF, "240743", "lev_money", "N225", 1),
    ("VIX fut (lev funds)", TFF, "1170E1", "lev_money", "VIX", 1),
    ("Gold (managed money)", DIS, "088691", "m_money", "Gold", 1), ("Silver (managed money)", DIS, "084691", "m_money", "Silver", 1),
    ("Copper (managed money)", DIS, "085692", "m_money", "Copper", 1), ("WTI (managed money)", DIS, "067651", "m_money", "WTI", 1),
    ("Brent NYMEX (managed money)", DIS, "06765T", "m_money", "Brent", 1), ("HenryHub (managed money)", DIS, "023651", "m_money", "HenryHub", 1),
]
CFTC_COLS = {"lev_money": ("lev_money_positions_long", "lev_money_positions_short"),
             "asset_mgr": ("asset_mgr_positions_long", "asset_mgr_positions_short"),
             "m_money": ("m_money_positions_long_all", "m_money_positions_short_all")}

NOTES = []


def note(s):
    NOTES.append(s)
    print(s, file=sys.stderr)


def get(url, timeout=30, tries=3, headers=UA):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:      # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


# ---------------------------------------------------------------- history cache
def yahoo_bars(sym, rng):
    path = f"/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d&includePrePost=false"
    try:
        j = json.loads(get("https://query1.finance.yahoo.com" + path))
    except Exception:
        j = json.loads(get("https://query2.finance.yahoo.com" + path))
    res = j["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    out = []
    for i, ts in enumerate(res.get("timestamp") or []):
        c = q["close"][i]
        if c is None or not (c == c) or c <= 0:
            continue
        h, l = q["high"][i], q["low"][i]
        d = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date().isoformat()
        out.append((d, float(c), float(h) if h else float(c), float(l) if l else float(c)))
    return out


def fred_bars(sid, rng):
    """FRED daily series as (date, close, high, low) with high = low = close. FRED stalls without an Accept header."""
    start = (dt.date.today() - dt.timedelta(days=366 * MAX_YEARS if rng == "15y" else 100)).isoformat()
    req = urllib.request.Request(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}",
                                 headers={"User-Agent": "curl/8.5.0", "Accept": "*/*"})
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                t = r.read().decode()
            break
        except Exception as e:      # noqa
            last = e
            time.sleep(2.0)
    else:
        raise last
    out = []
    for ln in t.splitlines()[1:]:
        d, _, v = ln.partition(",")
        try:
            v = float(v)
        except ValueError:
            continue
        out.append((d, v, v, v))
    return out


def cache_path(outdir, label):
    return os.path.join(outdir, "history", label.replace(" ", "_").replace("/", "_") + ".csv")


def read_cache(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as f:
        return [(r["date"], float(r["close"]), float(r["high"]), float(r["low"])) for r in csv.DictReader(f)]


def write_cache(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "close", "high", "low"])
        for r in rows:
            w.writerow([r[0], f"{r[1]:.6f}", f"{r[2]:.6f}", f"{r[3]:.6f}"])


def merge(old, new):
    d = {r[0]: r for r in old}
    for r in new:
        d[r[0]] = r
    rows = sorted(d.values())
    cutoff = (dt.date.today() - dt.timedelta(days=366 * MAX_YEARS)).isoformat()
    rows = [r for r in rows if r[0] >= cutoff]
    # drop the incomplete bar Yahoo serves for a session still open (its date is today in UTC)
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    return [r for r in rows if r[0] < today]


def load_history(outdir, fetch=True):
    series = {}
    for label, syms, kind, group in ASSETS:
        path = cache_path(outdir, label)
        rows = read_cache(path)
        if fetch:
            rng = "15y" if len(rows) < 500 else "3mo"   # "max" serves sparse bars for some indices
            got = []
            for sym in syms.split("|"):
                try:
                    got = fred_bars(sym[5:], rng) if sym.startswith("FRED:") else yahoo_bars(sym, rng)
                    if len(got) > (200 if rng == "15y" else 20):
                        break
                except Exception as e:      # noqa
                    note(f"{label}: {sym} {type(e).__name__}")
                time.sleep(0.7)
            if got:
                rows = merge(rows, got)
                write_cache(path, rows)
            else:
                note(f"{label}: no bars fetched, cache of {len(rows)} used")
            time.sleep(0.7)
        if len(rows) >= 300:
            series[label] = {"kind": kind, "group": group, "rows": rows}
        else:
            note(f"{label}: only {len(rows)} bars, skipped")
    for label, a, b, kind, group in SYNTH:
        if a in series and b in series:
            db = {r[0]: r[1] for r in series[b]["rows"]}
            rows = [(r[0], r[1] - db[r[0]]) for r in series[a]["rows"] if r[0] in db]
            rows = [(d, v, v, v) for d, v in rows]
            if len(rows) >= 300:
                series[label] = {"kind": kind, "group": group, "rows": rows, "signed": True}
    return series


# ---------------------------------------------------------------- indicators
def moves(kind, closes):
    """Session-to-session move: log return in % for prices, change in bp for yields."""
    if kind == "yld":
        return [None] + [(closes[i] - closes[i - 1]) * 100 for i in range(1, len(closes))]
    return [None] + [100 * math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]


def fwd(kind, closes, i, k):
    if i + k >= len(closes):
        return None
    if kind == "yld":
        return (closes[i + k] - closes[i]) * 100
    return 100 * math.log(closes[i + k] / closes[i])


def sd(xs):
    xs = [x for x in xs if x is not None]
    return statistics.pstdev(xs) if len(xs) > 2 else 0.0


def atr_series(rows, kind, n=20):
    out = [None] * len(rows)
    trs = []
    for i in range(1, len(rows)):
        _, c, h, l = rows[i]
        pc = rows[i - 1][1]
        tr = max(h - l, abs(h - pc), abs(l - pc), abs(c - pc))
        if kind == "yld":
            tr *= 100
        trs.append(tr)
        if len(trs) >= n:
            out[i] = sum(trs[-n:]) / n
    return out


def rsi_series(closes, n=14):
    out = [None] * len(closes)
    gains = losses = None
    for i in range(1, len(closes)):
        ch = closes[i] - closes[i - 1]
        g, l = max(ch, 0), max(-ch, 0)
        if i == n:
            gains = sum(max(closes[j] - closes[j - 1], 0) for j in range(1, n + 1)) / n
            losses = sum(max(closes[j - 1] - closes[j], 0) for j in range(1, n + 1)) / n
        elif i > n:
            gains = (gains * (n - 1) + g) / n
            losses = (losses * (n - 1) + l) / n
        if i >= n:
            out[i] = 100.0 if losses == 0 else 100 - 100 / (1 + gains / losses)
    return out


def conditions(label, s):
    """Per session: dict of signal -> direction (+1 extreme on the upside, -1 downside, 0 none) and a reading."""
    rows, kind = s["rows"], s["kind"]
    closes = [r[1] for r in rows]
    n = len(closes)
    mv = moves(kind, closes)
    atr = atr_series(rows, kind)
    rsi = rsi_series(closes)
    sig = {k: [0] * n for k in ("BB_STREAK", "STRETCH", "RSI", "Z20")}
    read = {k: [""] * n for k in sig}
    streak = 0
    # trailing sums for the 20-day mean and sd
    for i in range(20, n):
        win = closes[i - 19:i + 1]
        m = sum(win) / 20
        s20 = statistics.pstdev(win)
        c = closes[i]
        side = 1 if c > m + 2 * s20 else -1 if c < m - 2 * s20 else 0
        if side == 0:
            streak = 0
        elif streak * side > 0:
            streak += side
        else:
            streak = side
        if abs(streak) >= 4:
            sig["BB_STREAK"][i] = 1 if streak > 0 else -1
            read["BB_STREAK"][i] = f"{abs(streak)} closes {'above upper' if streak > 0 else 'below lower'} 20d 2-sigma band"
        if atr[i]:
            ext = (c - m) / atr[i] if kind != "yld" else (c - m) * 100 / atr[i]
            if abs(ext) >= 2.5:
                sig["STRETCH"][i] = 1 if ext > 0 else -1
                read["STRETCH"][i] = f"ext {ext:+.1f} ATR from the 20d mean"
        if rsi[i] is not None and (rsi[i] >= 75 or rsi[i] <= 25):
            sig["RSI"][i] = 1 if rsi[i] >= 75 else -1
            read["RSI"][i] = f"RSI14 {rsi[i]:.0f}"
        if i >= 20:
            r20 = fwd(kind, closes, i - 20, 20)
            hist = [fwd(kind, closes, j, 20) for j in range(max(20, i - 756), i - 20, 5)]
            sdev = sd(hist)
            if sdev > 0 and len(hist) > 60:
                z = r20 / sdev
                if abs(z) >= 2:
                    sig["Z20"][i] = 1 if z > 0 else -1
                    unit = "bp" if kind == "yld" else "%"
                    read["Z20"][i] = f"20d move {r20:+.1f}{unit} = {z:+.1f} sigma of its 3y 20d moves"
    return closes, mv, atr, sig, read


def events(flags):
    """Indices where a condition becomes true after COOLDOWN sessions without it, with its direction."""
    out = []
    last_true = -10 ** 9
    for i, d in enumerate(flags):
        if d:
            if i - last_true > COOLDOWN:
                out.append((i, d))
            last_true = i
    return out


def binom_p(hits, n, p0):
    """Two-sided normal approximation of a binomial test against p0."""
    if n == 0 or p0 <= 0 or p0 >= 1:
        return 1.0
    z = (hits - n * p0) / math.sqrt(n * p0 * (1 - p0))
    return 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))


def base_rate(kind, closes, atr, evs, direction, exclude_last=0, dates=None):
    """Reversion base rate after past events of one direction: for each horizon, hit = forward move against the
    extreme, median forward move (signed, in % or bp), n; baseline = share of all k-day moves against that direction."""
    res = {}
    n = len(closes)
    for k in HORIZONS:
        f = [fwd(kind, closes, i, k) for i, d in evs if d == direction and i < n - k - exclude_last]
        f = [x for x in f if x is not None]
        allf = [fwd(kind, closes, j, k) for j in range(20, n - k, 3)]
        allf = [x for x in allf if x is not None]
        base = sum(1 for x in allf if x * direction < 0) / len(allf) if allf else 0.5
        hits = sum(1 for x in f if x * direction < 0)
        res[k] = {"n": len(f), "hit": hits / len(f) if f else None, "med": statistics.median(f) if f else None,
                  "base": base, "p": binom_p(hits, len(f), base) if f else 1.0,
                  "med_atr": None}
    # path risk for whoever fades the extreme: the worst move in the extreme's own direction inside 20 sessions
    k = HORIZONS[-1]
    idx = [i for i, d in evs if d == direction and i < n - k - exclude_last]
    adverse = []
    for i in idx:
        worst = 0.0
        for j in range(1, k + 1):
            m = fwd(kind, closes, i, j)
            if m is not None:
                worst = max(worst, m * direction)
        adverse.append(worst)
    adverse.sort()
    res["mae95"] = adverse[min(len(adverse) - 1, int(math.ceil(0.95 * len(adverse))) - 1)] if adverse else None
    res["mae50"] = statistics.median(adverse) if adverse else None
    res["last"] = [dates[i] for i in idx[-3:]] if dates else []
    return res


def verdict(br, k=20):
    r = br[k]
    if r["n"] < MIN_N:
        return "THIN"
    if r["hit"] is not None and r["p"] < 0.05 and (r["hit"] - r["base"]) * 100 >= PASS_EDGE:
        return "REVERTS"
    if r["hit"] is not None and r["p"] < 0.05 and (r["base"] - r["hit"]) * 100 >= PASS_EDGE:
        return "CONTINUES"
    return "NO EDGE"


def unit(kind):
    return "bp" if kind == "yld" else "%"


def fmt_br(br, kind):
    u = unit(kind)
    parts = []
    for k in HORIZONS:
        r = br[k]
        if r["hit"] is None:
            parts.append(f"{k}d n=0")
        else:
            parts.append(f"{k}d {r['hit'] * 100:.0f}% vs {r['base'] * 100:.0f}% (n={r['n']}, med {r['med']:+.1f}{u}, p={r['p']:.2f})")
    if br.get("mae95") is not None:
        parts.append(f"fade path 20d: adverse median {br['mae50']:.1f}{u}, 95th pct {br['mae95']:.1f}{u}")
    if br.get("last"):
        parts.append("last " + ", ".join(br["last"]))
    return " · ".join(parts)


# ---------------------------------------------------------------- cross-asset divergence
def pair_scan(series):
    """For each pair: the gap between the legs' 20-session moves (each over its own 60-session sigma, leg b signed by
    the pair's normal relation). A gap of PAIR_Z or more while the 60-session correlation still has its normal sign is
    a divergence; the base rate is leg a's own record after past divergences of the same side."""
    out, tests = [], 0
    for a, b, sign in PAIRS:
        if a not in series or b not in series:
            continue
        sa, sb = series[a], series[b]
        db = {r[0]: r[1] for r in sb["rows"]}
        rows = [(r[0], r[1], db[r[0]]) for r in sa["rows"] if r[0] in db]
        if len(rows) < 400:
            continue
        dates = [r[0] for r in rows]
        ca, cb = [r[1] for r in rows], [r[2] for r in rows]
        ra, rb = moves(sa["kind"], ca), moves(sb["kind"], cb)
        n = len(rows)
        flags, gaps, corrs = [0] * n, [None] * n, [None] * n
        for i in range(80, n):
            xa, xb = ra[i - 59:i + 1], rb[i - 59:i + 1]
            ma, mb = sum(xa) / 60, sum(xb) / 60
            va = sum((x - ma) ** 2 for x in xa) / 60
            vb = sum((x - mb) ** 2 for x in xb) / 60
            if va <= 0 or vb <= 0:
                continue
            corr = sum((x - ma) * (y - mb) for x, y in zip(xa, xb)) / 60 / math.sqrt(va * vb)
            za = sum(ra[i - 19:i + 1]) / (math.sqrt(va) * math.sqrt(20))
            zb = sum(rb[i - 19:i + 1]) / (math.sqrt(vb) * math.sqrt(20))
            gap = za - sign * zb
            gaps[i], corrs[i] = gap, corr
            if abs(gap) >= PAIR_Z and corr * sign >= PAIR_CORR:
                flags[i] = 1 if gap > 0 else -1
        tests += 2 * len(HORIZONS)
        last = n - 1
        if flags[last]:
            d = flags[last]
            br = base_rate(sa["kind"], ca, None, events(flags), d, dates=dates)
            out.append({"asset": f"{a} vs {b}", "group": "Pairs", "signal": "PAIR_DIV", "dir": d,
                        "read": (f"{a} is {'rich' if d > 0 else 'cheap'} to {b}: 20d gap {gaps[last]:+.1f} sigma, 60d corr {corrs[last]:+.2f} "
                                 f"(normal sign {'+' if sign > 0 else '-'}); base rate is {a}'s own move after past gaps"),
                        "date": dates[last], "close": ca[last], "br": br, "kind": sa["kind"], "verdict": verdict(br),
                        "evs": 0})
    return out, tests


# ---------------------------------------------------------------- seasonality
def seasonal(label, s, today, k=20):
    """The window from today's calendar date over the next k sessions in each past year; and the placebo rate."""
    rows, kind = s["rows"], s["kind"]
    closes = [r[1] for r in rows]
    dates = [dt.date.fromisoformat(r[0]) for r in rows]
    years = sorted({d.year for d in dates})
    idx_by_date = {}
    # first session index at or after each calendar date, per year
    def first_on_or_after(target):
        lo, hi = 0, len(dates)
        while lo < hi:
            mid = (lo + hi) // 2
            if dates[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        return lo if lo < len(dates) else None

    def window_returns(month, day):
        out = []
        for y in years:
            try:
                start = dt.date(y, month, day)
            except ValueError:
                start = dt.date(y, month, 28)
            if start >= today - dt.timedelta(days=k * 2):
                continue
            i = first_on_or_after(start)
            if i is None or (dates[i] - start).days > 5 or i + k >= len(closes):
                continue
            r = fwd(kind, closes, i, k)
            if r is not None:
                out.append((y, r))
        return out

    this = window_returns(today.month, today.day)
    n = len(this)
    if n < SEAS_MIN_YEARS:
        return None
    ups = sum(1 for _, r in this if r > 0)
    hit = max(ups, n - ups) / n
    direction = 1 if ups >= n - ups else -1
    med = statistics.median(r for _, r in this)
    allf = [fwd(kind, closes, j, k) for j in range(20, len(closes) - k, 3)]
    allf = [x for x in allf if x is not None]
    base_up = sum(1 for x in allf if x > 0) / len(allf) if allf else 0.5
    base = base_up if direction > 0 else 1 - base_up
    p = binom_p(max(ups, n - ups), n, base)
    # placebo: share of all start dates in the calendar year passing the same rule
    passed = total = 0
    for doy in range(1, 366, 3):
        d0 = dt.date(2001, 1, 1) + dt.timedelta(days=doy - 1)
        w = window_returns(d0.month, d0.day)
        if len(w) >= SEAS_MIN_YEARS:
            total += 1
            u = sum(1 for _, r in w if r > 0)
            if max(u, len(w) - u) / len(w) >= SEAS_HIT:
                passed += 1
    placebo = passed / total if total else None
    last5 = ", ".join(f"{y % 100:02d}:{r:+.1f}" for y, r in this[-5:])
    return {"n": n, "hit": hit, "dir": direction, "med": med, "base": base, "p": p, "placebo": placebo, "last5": last5,
            "years": f"{this[0][0]}-{this[-1][0]}"}


# ---------------------------------------------------------------- CFTC
def cftc_fetch(outdir):
    """Weekly net positions per contract and group, cached as JSON; one request per dataset (two with a refresh)."""
    path = os.path.join(outdir, "history", "cftc_net.json")
    cache = {}
    if os.path.exists(path):
        with open(path) as f:
            cache = json.load(f)
    for ds in (TFF, DIS):
        codes = sorted({c for _, d, c, _, _, _ in CFTC if d == ds})
        groups = sorted({g for _, d, _, g, _, _ in CFTC if d == ds})
        cols = ["cftc_contract_market_code", "report_date_as_yyyy_mm_dd", "open_interest_all"]
        for g in groups:
            cols += list(CFTC_COLS[g])
        have = [k for k in cache if k.startswith(ds + ":")]
        since = "2006-01-01"
        if have:
            last = max(max(v.keys()) for k, v in cache.items() if k.startswith(ds + ":") and v)
            since = (dt.date.fromisoformat(last) - dt.timedelta(days=21)).isoformat()
        where = "cftc_contract_market_code in(" + ",".join(f"'{c}'" for c in codes) + f") and report_date_as_yyyy_mm_dd>'{since}'"
        url = (f"https://publicreporting.cftc.gov/resource/{ds}.json?$select=" + ",".join(cols) +
               "&$where=" + urllib.parse.quote(where) + "&$limit=50000")
        try:
            data = json.loads(get(url, timeout=120, tries=2))
        except Exception as e:      # noqa
            note(f"CFTC {ds}: {type(e).__name__}, cache used")
            continue
        for r in data:
            code, d = r["cftc_contract_market_code"], r["report_date_as_yyyy_mm_dd"][:10]
            for g in groups:
                lc, sc = CFTC_COLS[g]
                if r.get(lc) is None or r.get(sc) is None:
                    continue
                key = f"{ds}:{code}:{g}"
                cache.setdefault(key, {})[d] = [float(r[lc]) - float(r[sc]), float(r.get("open_interest_all") or 0)]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(cache, f)
    return cache


def pct_rank(xs, x):
    return sum(1 for v in xs if v <= x) / len(xs)


def cftc_scan(cache, series):
    out = []
    for label, ds, code, grp, px, sign in CFTC:
        d = cache.get(f"{ds}:{code}:{grp}")
        if not d:
            out.append({"label": label, "err": "no data"})
            continue
        dates = sorted(d)
        net = [d[k][0] for k in dates]
        # extremes through history on a rolling 3-year window (156 weekly reports), event = first week beyond the 5/95 pct
        flags = [0] * len(net)
        pcts = [None] * len(net)
        for i in range(156, len(net)):
            w = net[i - 156:i + 1]
            p = pct_rank(w, net[i])
            pcts[i] = p
            flags[i] = 1 if p >= 0.95 else -1 if p <= 0.05 else 0
        evs = []
        last_true = -10 ** 9
        for i, fl in enumerate(flags):
            if fl:
                if i - last_true > 8:
                    evs.append((i, fl))
                last_true = i
        s = series.get(px)
        res = {"label": label, "px": px, "asof": dates[-1], "net": net[-1], "oi": d[dates[-1]][1], "pct": pcts[-1],
               "chg4": net[-1] - net[-5] if len(net) > 5 else None, "flag": flags[-1], "evs": 0}
        if s and pcts[-1] is not None:
            closes = [r[1] for r in s["rows"]]
            pdates = [r[0] for r in s["rows"]]
            def px_index(day):
                lo, hi = 0, len(pdates)
                while lo < hi:
                    mid = (lo + hi) // 2
                    if pdates[mid] < day:
                        lo = mid + 1
                    else:
                        hi = mid
                return lo if lo < len(pdates) else None
            br = {}
            for direction in (1, -1):
                # a crowded long (direction +1) in the contract means the crowd bets on px moving sign*direction
                bet = sign * direction
                f = {k: [] for k in HORIZONS}
                for i, fl in evs:
                    if fl != direction:
                        continue
                    j = px_index(dates[i])
                    if j is None:
                        continue
                    for k in HORIZONS:
                        r = fwd(s["kind"], closes, j, k)
                        if r is not None:
                            f[k].append(r)
                allf = {k: [x for x in (fwd(s["kind"], closes, j, k) for j in range(20, len(closes) - k, 3)) if x is not None] for k in HORIZONS}
                br[direction] = {}
                for k in HORIZONS:
                    base = sum(1 for x in allf[k] if x * bet < 0) / len(allf[k]) if allf[k] else 0.5
                    hits = sum(1 for x in f[k] if x * bet < 0)
                    br[direction][k] = {"n": len(f[k]), "hit": hits / len(f[k]) if f[k] else None,
                                        "med": statistics.median(f[k]) if f[k] else None, "base": base,
                                        "p": binom_p(hits, len(f[k]), base) if f[k] else 1.0}
            res["br"] = br
            res["evs"] = len(evs)
            res["kind"] = s["kind"]
        out.append(res)
    return out


# ---------------------------------------------------------------- output
def fmt_num(x):
    return f"{x:,.0f}"


def fmt_level(x):
    a = abs(x)
    return f"{x:,.0f}" if a >= 1000 else f"{x:,.1f}" if a >= 100 else f"{x:,.2f}" if a >= 10 else f"{x:,.4f}"


def build(outdir, fetch):
    now = dt.datetime.now(SGT)
    today = now.date()
    series = load_history(outdir, fetch)
    flags, tests = [], 0
    per_asset_lines = []
    for label, s in series.items():
        closes, mv, atr, sig, read = conditions(label, s)
        last = len(closes) - 1
        for name in ("BB_STREAK", "STRETCH", "RSI", "Z20"):
            evs = events(sig[name])
            tests += 2 * len(HORIZONS)
            d = sig[name][last]
            if d:
                # the current event itself is excluded from its own base rate (no forward data anyway)
                br = base_rate(s["kind"], closes, atr, evs, d, dates=[r[0] for r in s["rows"]])
                flags.append({"asset": label, "group": s["group"], "signal": name, "dir": d, "read": read[name][last],
                              "date": s["rows"][last][0], "close": closes[last], "br": br, "kind": s["kind"],
                              "verdict": verdict(br), "evs": sum(1 for _, x in evs if x == d)})
    pair_flags, pair_tests = pair_scan(series)
    flags += pair_flags
    tests += pair_tests
    seas = []
    for label, s in series.items():
        r = seasonal(label, s, today)
        if r and r["hit"] >= SEAS_HIT:
            seas.append(dict(r, asset=label, group=s["group"], kind=s["kind"]))
    cftc = cftc_scan(cftc_fetch(outdir) if fetch else cftc_fetch_cached(outdir), series)

    order = {"REVERTS": 0, "CONTINUES": 1, "NO EDGE": 2, "THIN": 3}
    flags.sort(key=lambda f: (order[f["verdict"]], f["br"][20]["p"]))
    seas.sort(key=lambda r: r["p"])

    L = []
    L.append(f"EXTREMES AND SEASONALITY SCANNER — built {now:%a %d %b %Y %H:%M} SGT · {len(series)} series · "
             f"{len(flags)} extreme flags · {len(seas)} seasonal windows · {sum(1 for c in cftc if c.get('flag'))} positioning extremes")
    L.append("Sources: Yahoo Finance daily bars (delayed, up to 16 years, cached); CFTC Traders in Financial Futures and "
             "Disaggregated reports (public API, weekly, Tuesday as-of, released Friday). Script: scripts/scanner/scanner.py in the Macro Desk repo.")
    L.append("")
    L.append("HOW TO USE (Macro Takeaways; data from a pre-run script; read under the scanner rule)")
    L.append("1. Nothing in this file is a trade on its own. A flag is a CONDITIONAL candidate: it becomes a lean only when the run also has a "
             "catalyst or mechanism for the turn (an event inside the horizon, a positioning extreme the other way, a policy line, a level where "
             "a small opposite surprise flips the flow). A flag without a catalyst is printed and left alone.")
    L.append("2. Read the base rate before the flag. 'REVERTS' means this series' own history shows the move fading over the next 20 sessions "
             "more often than its unconditional rate, by 10 points or more, with p < 0.05 on at least 20 past events. 'NO EDGE' means the extreme "
             "did not predict a turn here; 'CONTINUES' means it predicted follow-through; 'THIN' means fewer than 20 past events. A REVERTS base rate "
             "is a prior for p on a card, not the card's p: it is overlapping, in-sample, and one of many tests (section D).")
    L.append("3. Seasonal windows are weaker evidence than extremes: compare each window's hit rate with its placebo rate (the share of all start "
             "dates in that series that would pass the same 70% rule by chance). A window whose hit rate barely clears the placebo rate is noise.")
    L.append("4. Positioning extremes here are the CFTC read at the Tuesday as-of date; R02 (database extremes) still decides HARD POSITIONING "
             "and R09's crowd field. Use this section for the base rate of what the price did after the same extreme before.")
    L.append("5. A card that uses a flag prints one SCANNER line after the TREND line: \"SCANNER: <asset> <signal> <reading>; base rate 20d "
             "<hit>% vs <base>% (n=<n>), <verdict>; catalyst: <what>\". The weekly review reads flags_history.csv beside the cards.")
    L.append("")
    L.append("## A. TODAY'S EXTREMES (one line per asset and signal; direction = side of the extreme; base rate = how often the move reverted "
             "over 5 / 10 / 20 sessions after the same extreme in this series, against the unconditional rate; med = median forward move, signed)")
    L.append("Columns: asset | signal | reading | last close (bar date) | 5d / 10d / 20d reversion rate vs baseline (n, median move, p) | verdict")
    if not flags:
        L.append("none today")
    for f in flags:
        side = "UP extreme" if f["dir"] > 0 else "DOWN extreme"
        if f["signal"] == "PAIR_DIV":
            side = "leg a rich" if f["dir"] > 0 else "leg a cheap"
        L.append(f"{f['asset']} | {f['signal']} {side} | {f['read']} | {fmt_level(f['close'])} ({f['date']}) | {fmt_br(f['br'], f['kind'])} | {f['verdict']}")
    L.append("")
    L.append("## B. SEASONAL WINDOWS OPENING NOW (the next 20 sessions from today's calendar date in each past year; only windows with a hit rate "
             "of 70% or more over 10+ years are listed; placebo = share of all start dates in this series passing the same rule)")
    L.append("Columns: asset | direction | years n | hit rate vs unconditional | median 20d move | p | placebo rate | last five years")
    if not seas:
        L.append("none today")
    for r in seas:
        d = "UP" if r["dir"] > 0 else "DOWN"
        pl = f"{r['placebo'] * 100:.0f}%" if r["placebo"] is not None else "n/a"
        strength = "CLEARS PLACEBO" if r["placebo"] is not None and r["hit"] - r["placebo"] >= 0.25 and r["p"] < 0.05 else "WEAK"
        L.append(f"{r['asset']} | {d} | {r['n']} ({r['years']}) | {r['hit'] * 100:.0f}% vs {r['base'] * 100:.0f}% | {r['med']:+.1f}{unit(r['kind'])} | "
                 f"p={r['p']:.2f} | placebo {pl} | {r['last5']} | {strength}")
    L.append("")
    L.append("## C. POSITIONING (CFTC net positions, 3-year percentile; extreme = at or beyond the 5th / 95th percentile; base rate = how often the "
             "price moved AGAINST the crowded side over 5 / 10 / 20 sessions after past extremes of the same side, vs the unconditional rate)")
    L.append("Columns: contract (group) | as-of | net contracts | 4-week change | 3y pct | state | base rate after the same extreme | verdict")
    for c in cftc:
        if c.get("err"):
            L.append(f"{c['label']} | {c['err']}")
            continue
        state = "CROWDED LONG" if c["flag"] > 0 else "CROWDED SHORT" if c["flag"] < 0 else "-"
        brs = ""
        v = ""
        if c.get("br") and c["flag"]:
            br = c["br"][c["flag"]]
            brs = fmt_br(br, c["kind"])
            v = verdict(br)
        elif c.get("br"):
            # show the nearer extreme's record for context when within 10 points of one
            near = 1 if c["pct"] >= 0.85 else -1 if c["pct"] <= 0.15 else 0
            if near:
                br = c["br"][near]
                brs = ("record after past crowded " + ("longs" if near > 0 else "shorts") + ": " + fmt_br(br, c["kind"]))
                v = verdict(br)
        chg = f"{c['chg4']:+,.0f}" if c["chg4"] is not None else "n/a"
        L.append(f"{c['label']} | {c['asof']} | {fmt_num(c['net'])} | {chg} | {c['pct'] * 100:.0f} | {state} | {brs or '-'} | {v or '-'}")
    L.append("")
    exp_fp = 0.05 * tests
    L.append("## D. METHOD AND HONESTY")
    L.append(f"- Tests run this morning: {len(series)} series x 4 signals x 2 sides x 3 horizons, plus {len(PAIRS)} pairs x 2 sides x 3 horizons = {tests} base rates, plus {len(cftc)} positioning series "
             f"and {len(series)} seasonal windows. At p < 0.05 about {exp_fp:.0f} of the {tests} base rates pass by chance alone, so a REVERTS verdict on one flag "
             f"is weak evidence; a REVERTS verdict that repeats across horizons, across related series, and agrees with a positioning extreme is stronger.")
    L.append(f"- Events: a condition counts once when it first turns true after {COOLDOWN} sessions without it; forward moves overlap across events and "
             f"are in-sample (the whole cached history, up to {MAX_YEARS} years). Baseline = the share of all k-session moves in this series that go "
             f"against the extreme's side, so drift (equities up, some Asian currencies one way) is already in the comparison.")
    L.append("- Signals: BB_STREAK = 4 or more consecutive closes outside the 20-session 2-sigma band; STRETCH = close 2.5 ATR(20) or more from the "
             "20-session mean; RSI = RSI(14) at 75 or above, 25 or below; Z20 = the 20-session move at 2 sigma or more of the series' own 20-session "
             "moves over the prior 3 years. Yields are in bp, everything else in log %.")
    L.append(f"- PAIR_DIV = the gap between two legs' 20-session moves (each over its own 60-session sigma, leg b signed by the pair's normal "
             f"relation) at {PAIR_Z} or more while their 60-session correlation still has its normal sign by {PAIR_CORR} or more; the base rate is leg a's own "
             "record after past gaps of the same side, so it says whether leg a came back, not which leg closes the gap. Asian index legs close "
             "before the US leg, which a 20-session window mostly absorbs. Thresholds are fixed in the script, never set from today's reading.")
    L.append("- Fade path: for the same past events, the worst move in the extreme's own direction inside the next 20 sessions (median and 95th "
             "percentile). It is what a fade had to sit through, a guide to stop width, not a stop. 'last' = the three most recent past events.")
    L.append("- Seasonality uses calendar start dates, 20 sessions forward, one observation per year; it says nothing about why, and the placebo rate "
             "shows how often such a window appears by chance in the same series.")
    L.append("- Not covered: intraday extremes, option skew, single stocks, anything needing a paid source. Positioning here is "
             "US futures only; the database's 83 positioning series stay under R02.")
    if NOTES:
        L.append("- Build notes: " + "; ".join(NOTES[:12]))
    L.append("")
    L.append(f"Footer line for the digest: \"Scanner: {now:%d %b %H:%M} SGT · {len(flags)} flags ({sum(1 for f in flags if f['verdict'] == 'REVERTS')} REVERTS) · "
             f"{len(seas)} seasonal · {sum(1 for c in cftc if c.get('flag'))} positioning extremes\"")
    text = "\n".join(L) + "\n"
    with open(os.path.join(outdir, "extremes_latest.md"), "w", encoding="utf-8") as f:
        f.write(text)
    # flags history
    hp = os.path.join(outdir, "flags_history.csv")
    head = ["sgt_date", "asset", "signal", "dir", "reading", "bar_date", "close", "n20", "hit20", "base20", "med20", "p20", "verdict"]
    kept = []
    if os.path.exists(hp):
        with open(hp, newline="", encoding="utf-8") as f:
            kept = [r for r in list(csv.reader(f))[1:] if r and r[0] != today.isoformat()]     # a rebuild replaces today's rows
    with open(hp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(head)
        w.writerows(kept)
        for x in flags:
            r = x["br"][20]
            w.writerow([today.isoformat(), x["asset"], x["signal"], x["dir"], x["read"], x["date"], f"{x['close']:.6g}", r["n"],
                        f"{r['hit']:.3f}" if r["hit"] is not None else "", f"{r['base']:.3f}", f"{r['med']:.3f}" if r["med"] is not None else "",
                        f"{r['p']:.3f}", x["verdict"]])
        for r in seas:
            w.writerow([today.isoformat(), r["asset"], "SEASONAL", r["dir"], f"{r['n']}y hit {r['hit']:.2f} placebo {r['placebo']}", "", "",
                        r["n"], f"{r['hit']:.3f}", f"{r['base']:.3f}", f"{r['med']:.3f}", f"{r['p']:.3f}", ""])
        for c in cftc:
            if c.get("flag"):
                br = c["br"][c["flag"]][20] if c.get("br") else {}
                w.writerow([today.isoformat(), c["px"], "CFTC " + c["label"], c["flag"], f"pct {c['pct']:.2f} net {c['net']:.0f}", c["asof"], "",
                            br.get("n", ""), f"{br['hit']:.3f}" if br.get("hit") is not None else "", f"{br.get('base', 0):.3f}",
                            f"{br['med']:.3f}" if br.get("med") is not None else "", f"{br.get('p', 1):.3f}", verdict(c["br"][c["flag"]]) if c.get("br") else ""])
    print(f"ok: {os.path.join(outdir, 'extremes_latest.md')} {len(text.encode())} bytes · {len(series)} series · {len(flags)} flags · "
          f"{len(seas)} seasonal · {sum(1 for c in cftc if c.get('flag'))} positioning extremes")
    return 0


def cftc_fetch_cached(outdir):
    path = os.path.join(outdir, "history", "cftc_net.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-fetch", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    return build(a.out.rstrip("/"), not a.no_fetch)


if __name__ == "__main__":
    sys.exit(main())
