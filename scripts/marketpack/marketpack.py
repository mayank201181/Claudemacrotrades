#!/usr/bin/env python3
"""Daily MARKET PACK for the Macro Takeaways digest (stdlib only, public sources, no keys).

Sections
  A  PRICE ACTION   Yahoo Finance daily bars for ~55 book assets: moves in sigma, trend vs moving
                    averages, extension in ATR, 10-day z, run, realised-vol ratio, breakouts.
  B  PARTICIPATION  Yahoo futures quotes (the most-held contract per root): volume vs 20-day average,
                    open interest and its day-on-day change, and the price/OI read.
  C  POSITIONING    the SQL the digest runs itself (build-up over the msd positioning series).
  D  FX OPTIONS     DTCC swap data repository (US-reported trades, T-1): option notional by pair vs
                    its 20-day average, base-call share, NDF volume, and large strikes expiring soon.
  E  HEADLINES      wire and newspaper RSS headlines from the last 24 hours.
  F  SHORTS JP/AU   QuiVad republication of JFSA (fund-level) and ASIC (aggregate) disclosed short positions.

Usage: python3 -I marketpack.py --out /mnt/project-files/marketpack/ [--sql posbuild.sql]
Writes market_pack_latest.md plus small history files (oi_history.csv, dtcc_daily.csv,
dtcc_strikes.csv, shorts_history.csv) in --out. Every section fails soft: a failed source prints a line, never stops the run.
"""
import argparse, csv, datetime as dt, email.utils, gzip, html, io, json, math, os, re, sys, time, zipfile
import urllib.parse, urllib.request, http.cookiejar
from xml.etree import ElementTree as ET

SGT = dt.timezone(dt.timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0"}  # Yahoo answers 429 to fuller browser strings and to curl/python defaults
NOW = dt.datetime.now(dt.timezone.utc)
SPOT = {}  # label -> last, filled by section A, used by section D for strike distance

# ---------------------------------------------------------------- http
_cj = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cj))


def get(url, timeout=30, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with _opener.open(req, timeout=timeout) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2.0 * (i + 1))
    raise last


# ---------------------------------------------------------------- A. price action
ASSETS = [
    # label, yahoo symbol, kind (px = price, yld = yield in %, changes in bp)
    ("DXY", "DX-Y.NYB", "px"), ("EURUSD", "EURUSD=X", "px"), ("USDJPY", "JPY=X", "px"),
    ("GBPUSD", "GBPUSD=X", "px"), ("AUDUSD", "AUDUSD=X", "px"), ("NZDUSD", "NZDUSD=X", "px"),
    ("USDCAD", "CAD=X", "px"), ("USDCHF", "CHF=X", "px"), ("EURJPY", "EURJPY=X", "px"),
    ("AUDJPY", "AUDJPY=X", "px"), ("USDCNH", "CNH=X|CNY=X", "px"), ("USDKRW", "KRW=X", "px"),
    ("USDTWD", "TWD=X", "px"), ("USDINR", "INR=X", "px"), ("USDSGD", "SGD=X", "px"),
    ("USDIDR", "IDR=X", "px"), ("USDPHP", "PHP=X", "px"), ("USDTHB", "THB=X", "px"),
    ("USDMYR", "MYR=X", "px"),
    ("UST5Y", "^FVX", "yld"), ("UST10Y", "^TNX", "yld"), ("UST30Y", "^TYX", "yld"),
    ("UST2 fut", "ZT=F", "px"), ("UST10 fut", "ZN=F", "px"),
    ("Brent", "BZ=F", "px"), ("WTI", "CL=F", "px"), ("HenryHub", "NG=F", "px"), ("TTF", "TTF=F", "px"),
    ("HeatOil", "HO=F", "px"), ("Gold", "GC=F", "px"), ("Silver", "SI=F", "px"), ("Copper", "HG=F", "px"),
    ("SPX", "^GSPC", "px"), ("NDX", "^NDX", "px"), ("RUT", "^RUT", "px"), ("SOX", "^SOX", "px"),
    ("SX5E", "^STOXX50E", "px"), ("DAX", "^GDAXI", "px"), ("N225", "^N225", "px"), ("KOSPI", "^KS11", "px"),
    ("TAIEX", "^TWII", "px"), ("HSI", "^HSI", "px"), ("HSCEI", "^HSCE", "px"), ("CSI300", "000300.SS|000001.SS", "px"),
    ("NIFTY", "^NSEI", "px"), ("ASX200", "^AXJO", "px"), ("STI", "^STI", "px"),
    ("VIX", "^VIX", "px"), ("VIX3M", "^VIX3M", "px"), ("VXN", "^VXN", "px"), ("MOVE", "^MOVE", "px"),
    ("OVX", "^OVX", "px"), ("GVZ", "^GVZ", "px"), ("BTC", "BTC-USD", "px"),
]


def yahoo_chart(sym, rng="1y", interval="1d"):
    path = (f"/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={interval}&includePrePost=false")
    try:
        j = json.loads(get("https://query1.finance.yahoo.com" + path))
    except Exception:  # noqa: BLE001
        j = json.loads(get("https://query2.finance.yahoo.com" + path))
    res = j["chart"]["result"][0]
    meta = res["meta"]
    q = res["indicators"]["quote"][0]
    rows = []
    for t, o, h, l, c, v in zip(res.get("timestamp", []), q["open"], q["high"], q["low"], q["close"], q["volume"]):
        if c is None:
            continue
        rows.append((t, o if o is not None else c, h if h is not None else c, l if l is not None else c, c, v or 0))
    return meta, rows


def _sd(xs):
    if len(xs) < 3:
        return float("nan")
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def price_stats(kind, rows, last_px):
    closes = [r[4] for r in rows]
    if last_px is not None and closes:
        closes[-1] = last_px  # live quote replaces the forming bar's close
    n = len(closes)
    if n < 30:
        return None
    if kind == "yld":
        ch = [(closes[i] - closes[i - 1]) * 100 for i in range(1, n)]  # bp
        def move(k):
            return (closes[-1] - closes[-1 - k]) * 100 if n > k else float("nan")
    else:
        ch = [math.log(closes[i] / closes[i - 1]) for i in range(1, n) if closes[i - 1] > 0 and closes[i] > 0]
        def move(k):
            return (closes[-1] / closes[-1 - k] - 1) * 100 if n > k else float("nan")
    # drop unchanged requotes (holidays) from the sigma estimate
    ch_nz = [x for x in ch if x != 0]
    sig = _sd(ch_nz[-60:])
    sig_pct = sig * 100 if kind == "px" else sig  # daily sigma in % (px) or bp (yld)
    def zs(k):
        mv = move(k)
        return mv / (sig_pct * math.sqrt(k)) if sig_pct and sig_pct == sig_pct and sig_pct > 0 else float("nan")
    ma = lambda k: sum(closes[-k:]) / k if n >= k else float("nan")
    ma20, ma50, ma200 = ma(20), ma(50), ma(200)
    ma50_prev = sum(closes[-60:-10]) / 50 if n >= 60 else float("nan")
    trs = []
    for i in range(max(1, n - 20), n):
        h, l, pc = rows[i][2], rows[i][3], closes[i - 1]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr = sum(trs) / len(trs) if trs else float("nan")
    # some Yahoo series carry flat or missing highs/lows; never let ATR fall below the close-to-close spread
    cc = [abs(closes[i] - closes[i - 1]) for i in range(max(1, n - 20), n)]
    if cc and atr == atr:
        atr = max(atr, sum(cc) / len(cc))
    ext = (closes[-1] - ma20) / atr if atr and atr == atr and atr > 0 else float("nan")
    # 10-day return z against the last 250 sessions' 10-day returns
    if kind == "yld":
        r10 = [closes[i] - closes[i - 10] for i in range(10, n)]
    else:
        r10 = [math.log(closes[i] / closes[i - 10]) for i in range(10, n) if closes[i - 10] > 0]
    z10 = (r10[-1] / _sd(r10[-250:])) if len(r10) > 30 and _sd(r10[-250:]) > 0 else float("nan")
    last10 = [closes[i] - closes[i - 1] for i in range(n - 10, n)]
    up, dn = sum(1 for x in last10 if x > 0), sum(1 for x in last10 if x < 0)
    run = up if up >= dn else -dn
    rv10, rv60 = _sd(ch_nz[-10:]), _sd(ch_nz[-60:])
    rvr = rv10 / rv60 if rv60 and rv60 == rv60 and rv60 > 0 else float("nan")
    prior = closes[:-1]
    hi = lambda k: max(r[2] for r in rows[-1 - k:-1]) if n > k else float("nan")
    lo = lambda k: min(r[3] for r in rows[-1 - k:-1]) if n > k else float("nan")
    flags = []
    for k, name in ((250, "52w"), (60, "60d"), (20, "20d")):
        if n > k and closes[-1] > hi(k):
            flags.append(f"{name} HIGH"); break
    for k, name in ((250, "52w"), (60, "60d"), (20, "20d")):
        if n > k and closes[-1] < lo(k):
            flags.append(f"{name} LOW"); break
    if (ext == ext and abs(ext) >= 1.5) or (z10 == z10 and abs(z10) >= 1.5) or abs(run) >= 8:
        flags.append("BUILD-UP " + ("up" if (ext if ext == ext else z10) > 0 else "down"))
    if rvr == rvr and rvr >= 1.5:
        flags.append("VOL WAKING")
    if rvr == rvr and rvr <= 0.6:
        flags.append("VOL ASLEEP")
    trend = "n/a"
    if ma50 == ma50 and ma200 == ma200:
        a50, a200 = closes[-1] > ma50, closes[-1] > ma200
        slope = "rising" if ma50 > ma50_prev else "falling"
        trend = ("above" if a50 else "below") + " 50/" + ("above" if a200 else "below") + f" 200, 50d {slope}"
    elif ma50 == ma50:
        trend = ("above" if closes[-1] > ma50 else "below") + " 50"
    return dict(last=closes[-1], d1=move(1), w1=move(5), m1=move(21), z1=zs(1), z5=zs(5), z21=zs(21),
                ext=ext, z10=z10, run=run, rvr=rvr, trend=trend, flags=flags, sig=sig_pct)


def fmt(x, d=2, sign=True):
    if x is None or x != x:
        return "n/a"
    return (f"{x:+.{d}f}" if sign else f"{x:.{d}f}")


def fmt_level(x):
    if x is None or x != x:
        return "n/a"
    a = abs(x)
    d = 6 if a < 0.1 else 4 if a < 5 else 3 if a < 50 else 2 if a < 1000 else 1 if a < 20000 else 0
    return f"{x:,.{d}f}"


def section_a():
    out, ok, bad = [], 0, []
    out.append("## A. PRICE ACTION (Yahoo Finance, delayed; daily bars, last = latest quote)")
    out.append("Columns: asset | last | quote time SGT | 1d | 1w | 1m (moves in %, yields in bp; [sigma] = move / "
               "daily sigma(60d) x sqrt(days)) | trend vs MA50/MA200 | ext = (last - MA20)/ATR20 | z10 | run "
               "(+up/-down closes of last 10) | rv10/rv60 | flags")
    for label, sym, kind in ASSETS:
        try:
            st, used = None, None
            for alt in sym.split("|"):  # Yahoo sometimes serves a single bar for a symbol; fall back
                meta, rows = yahoo_chart(alt)
                px = meta.get("regularMarketPrice")
                st = price_stats(kind, rows, px)
                if st:
                    used = alt; break
            if not st:
                bad.append(label); continue
            if used != sym.split("|")[0]:
                st["flags"].insert(0, f"bars from {used}")
            t = meta.get("regularMarketTime")
            ts = dt.datetime.fromtimestamp(t, SGT).strftime("%d %b %H:%M") if t else "n/a"
            if t and (NOW.timestamp() - t) > 4 * 86400:
                st["flags"].insert(0, "STALE QUOTE")
            u = "bp" if kind == "yld" else "%"
            d = 1 if kind == "yld" else 2
            out.append(" | ".join([
                label, fmt_level(st["last"]), ts,
                f"1d {fmt(st['d1'], d)}{u} [{fmt(st['z1'], 1)}]",
                f"1w {fmt(st['w1'], d)}{u} [{fmt(st['z5'], 1)}]",
                f"1m {fmt(st['m1'], d)}{u} [{fmt(st['z21'], 1)}]",
                st["trend"], f"ext {fmt(st['ext'], 1)}", f"z10 {fmt(st['z10'], 1)}", f"run {st['run']:+d}",
                f"rv {fmt(st['rvr'], 2, False)}", ", ".join(st["flags"]) or "-"]))
            SPOT[label] = st["last"]
            ok += 1
        except Exception as e:  # noqa: BLE001
            bad.append(f"{label} ({type(e).__name__})")
        time.sleep(0.15)
    out.append(f"A status: {ok}/{len(ASSETS)} assets" + (f" · failed: {', '.join(bad)}" if bad else ""))
    return out, ok


# ---------------------------------------------------------------- B. futures participation
MCODE = "FGHJKMNQUVXZ"
ROOTS = [
    # root, suffix, allowed months, label
    ("ES", "CME", "HMUZ", "S&P 500 e-mini"), ("NQ", "CME", "HMUZ", "Nasdaq e-mini"),
    ("NKD", "CME", "HMUZ", "Nikkei (USD)"), ("ZT", "CBT", "HMUZ", "UST 2y"), ("ZF", "CBT", "HMUZ", "UST 5y"),
    ("ZN", "CBT", "HMUZ", "UST 10y"), ("ZB", "CBT", "HMUZ", "UST bond"), ("6E", "CME", "HMUZ", "EUR"),
    ("6J", "CME", "HMUZ", "JPY"), ("6A", "CME", "HMUZ", "AUD"), ("6B", "CME", "HMUZ", "GBP"),
    ("CL", "NYM", MCODE, "WTI"), ("BZ", "NYM", MCODE, "Brent"), ("NG", "NYM", MCODE, "Henry Hub"),
    ("GC", "CMX", "GJMQVZ", "Gold"), ("SI", "CMX", "HKNUZ", "Silver"), ("HG", "CMX", "HKNUZ", "Copper"),
]


def candidates(root, suffix, months, k=3):
    out, y, m = [], NOW.year, NOW.month
    for i in range(0, 15):
        mm = (m - 1 + i) % 12 + 1
        yy = y + (m - 1 + i) // 12
        code = MCODE[mm - 1]
        if code in months:
            out.append(f"{root}{code}{str(yy)[-2:]}.{suffix}")
        if len(out) >= k:
            break
    return out


def yahoo_quotes(symbols):
    try:
        get("https://fc.yahoo.com", tries=1)
    except Exception:  # noqa: BLE001  (404 is normal; it still sets the cookie)
        pass
    crumb = get("https://query1.finance.yahoo.com/v1/test/getcrumb").decode().strip()
    out = {}
    for i in range(0, len(symbols), 40):
        chunk = symbols[i:i + 40]
        url = ("https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + urllib.parse.quote(",".join(chunk))
               + "&crumb=" + urllib.parse.quote(crumb))
        for q in json.loads(get(url))["quoteResponse"]["result"]:
            out[q["symbol"]] = q
    return out


def section_b(outdir):
    out = ["## B. FUTURES PARTICIPATION (Yahoo; the most-held contract per root; OI may lag a session)",
           "Columns: future | contract | settle/last | 1d % | volume vs 20d avg | OI | OI 1d change | read "
           "(price up + OI up = new longs; up + OI down = short covering; down + OI up = new shorts; "
           "down + OI down = long liquidation; |OI change| < 0.5% = flat)"]
    hist_path = os.path.join(outdir, "oi_history.csv")
    hist = {}
    if os.path.exists(hist_path):
        for r in csv.DictReader(open(hist_path)):
            hist.setdefault(r["symbol"], []).append(r)
    try:
        allsyms = [s for root, suf, mo, _ in ROOTS for s in candidates(root, suf, mo)]
        quotes = yahoo_quotes(allsyms)
    except Exception as e:  # noqa: BLE001
        out.append(f"B status: unavailable ({type(e).__name__}: {e})")
        return out, 0
    today = NOW.astimezone(SGT).date().isoformat()
    new_rows, ok = [], 0
    for root, suf, mo, label in ROOTS:
        cands = [quotes.get(s) for s in candidates(root, suf, mo)]
        cands = [q for q in cands if q and q.get("openInterest")]
        if not cands:
            out.append(f"{label} | no quote"); continue
        q = max(cands, key=lambda x: x.get("openInterest") or 0)
        sym, oi = q["symbol"], q.get("openInterest") or 0
        px, chg = q.get("regularMarketPrice"), q.get("regularMarketChangePercent")
        vol = q.get("regularMarketVolume") or 0
        avg = None
        try:
            _, rows = yahoo_chart(sym, rng="3mo")
            vols = [r[5] for r in rows[:-1] if r[5]]
            avg = sum(vols[-20:]) / len(vols[-20:]) if len(vols) >= 10 else None
        except Exception:  # noqa: BLE001
            pass
        qt = q.get("regularMarketTime") or 0
        qday = dt.datetime.fromtimestamp(qt, SGT).date().isoformat() if qt else today
        # compare with the latest stored print from an EARLIER trading day (weekend and re-runs repeat a print)
        prev = [r for r in hist.get(sym, []) if r["date"] < today and r.get("quote_day", "") and r["quote_day"] < qday]
        doi, read = None, "OI change n/a (history starts 1 Nov 2026)"
        if prev:
            p_oi = float(prev[-1]["oi"])
            if p_oi == oi:
                read = "OI not yet updated by Yahoo"
            elif p_oi > 0 and abs(oi - p_oi) / p_oi < 0.5:  # ignore a broken prior print
                doi = (oi - p_oi) / p_oi * 100
                read = "flat OI"
        if doi is not None and abs(doi) >= 0.5 and chg is not None:
            read = {(True, True): "new longs", (True, False): "short covering",
                    (False, True): "new shorts", (False, False): "long liquidation"}[(chg > 0, doi > 0)]
        out.append(" | ".join([label, sym, fmt_level(px), f"{fmt(chg, 2)}%",
                               f"vol {vol:,.0f}" + (f" ({vol / avg:.1f}x 20d)" if avg else ""),
                               f"OI {oi:,.0f}", "OI " + (f"{doi:+.1f}%" if doi is not None else "n/a"), read]))
        new_rows.append({"date": today, "symbol": sym, "oi": oi, "volume": vol, "price": px,
                         "quote_time": qt, "quote_day": qday})
        ok += 1
    # keep one row per symbol per date (re-runs overwrite), and 120 days of history
    rows = [r for s in hist.values() for r in s if not (r["date"] == today and r["symbol"] in {x["symbol"] for x in new_rows})]
    rows += new_rows
    cutoff = (NOW - dt.timedelta(days=120)).date().isoformat()
    rows = sorted([r for r in rows if r["date"] >= cutoff], key=lambda r: (r["symbol"], r["date"]))
    with open(hist_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "symbol", "oi", "volume", "price", "quote_time", "quote_day"], extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    out.append(f"B status: {ok}/{len(ROOTS)} futures")
    return out, ok


# ---------------------------------------------------------------- D. DTCC FX options and NDFs
PRIO = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"]
WATCH = ["EURUSD", "USDJPY", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "EURJPY", "AUDJPY", "EURGBP",
         "USDCNH", "USDCNY", "USDKRW", "USDTWD", "USDINR", "USDSGD", "USDIDR", "USDPHP", "USDTHB", "USDMYR", "USDHKD"]
APPROX_USD = {"USD": 1.0, "EUR": 1.15, "GBP": 1.33, "AUD": 0.70, "NZD": 0.57, "CHF": 1.22, "CAD": 0.72, "JPY": 0.0065}
MAX_TRADE_USD = 5e9  # larger single prints are reporting errors
NDF_CCY = ["KRW", "TWD", "INR", "IDR", "PHP", "MYR", "CNY"]


def mkt_pair(a, b):
    ra = PRIO.index(a) if a in PRIO else 99
    rb = PRIO.index(b) if b in PRIO else 99
    return (a, b) if ra <= rb else (b, a)


def num(s):
    s = (s or "").replace(",", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def dtcc_file(day):
    name = f"CFTC_CUMULATIVE_FOREX_{day:%Y_%m_%d}.zip"
    data = get(f"https://pddata.dtcc.com/ppd/api/report/cumulative/cftc/{name}", timeout=120)
    z = zipfile.ZipFile(io.BytesIO(data))
    return z.open(z.namelist()[0])


def dtcc_summarise(day):
    """One day's new trades -> per-pair option stats, NDF stats and strike buckets."""
    f = io.TextIOWrapper(dtcc_file(day), encoding="utf-8", errors="replace")
    opt, ndf, strikes = {}, {}, {}
    for r in csv.DictReader(f):
        if r.get("Action type") != "NEWT" or r.get("Event type") != "TRAD":
            continue
        fisn = r.get("UPI FISN") or ""
        parts = fisn.split()
        if len(parts) < 4:
            continue
        a, b = parts[-2], parts[-1]
        if len(a) != 3 or len(b) != 3:
            continue
        base, quote = mkt_pair(a, b)
        pair = base + quote
        usd = None
        legs = (("Notional amount-Leg 1", "Notional currency-Leg 1"), ("Notional amount-Leg 2", "Notional currency-Leg 2"),
                ("Call amount", "Call currency"), ("Put amount", "Put currency"))
        for amt, ccy in legs:
            if r.get(ccy) == "USD" and num(r.get(amt)):
                usd = num(r.get(amt)); break
        if usd is None:  # crosses: convert a G10 leg at a rough fixed rate (ranking only)
            for amt, ccy in legs:
                if r.get(ccy) in APPROX_USD and num(r.get(amt)):
                    usd = num(r.get(amt)) * APPROX_USD[r.get(ccy)]; break
        if usd is not None and usd > MAX_TRADE_USD:
            usd = None
        if "/Fwd NDF" in fisn:
            ccy = a if a != "USD" else b
            s = ndf.setdefault(ccy, [0, 0.0])
            s[0] += 1; s[1] += usd or 0
            continue
        if "/O " not in fisn:
            continue
        typ = parts[1] if len(parts) > 1 else "?"
        s = opt.setdefault(pair, {"n": 0, "usd": 0.0, "call": 0.0, "put": 0.0, "exotic": 0})
        s["n"] += 1; s["usd"] += usd or 0
        if typ in ("Bar", "Dig", "DigBar", "Targ"):
            s["exotic"] += 1
        cc, pc = r.get("Call currency"), r.get("Put currency")
        side = "call" if (cc == base or pc == quote) else "put" if (pc == base or cc == quote) else None
        if side and usd:
            s[side] += usd
        k = num(r.get("Strike Price"))
        kp = (r.get("Strike price currency/currency pair") or "").replace(" ", "")
        exp = (r.get("Expiration Date") or "")[:10]
        if k and kp and usd and typ in ("Van", "NDO") and exp:
            if kp.startswith(quote + "/") and k > 0:
                k = 1 / k
            dp = 2 if quote in ("JPY", "INR", "TWD", "PHP", "THB") else 0 if quote in ("KRW", "IDR") else 4
            key = (pair, round(k, dp), exp)
            strikes[key] = strikes.get(key, 0.0) + usd
    return opt, ndf, strikes


def section_d(outdir, backfill_days=22):
    out = ["## D. FX OPTIONS AND NDFs (DTCC swap data repository: US-reported new trades only, a sample of the "
           "market; T-1 US date; notionals capped by DTCC on block trades, so totals are floors)"]
    dpath, spath = os.path.join(outdir, "dtcc_daily.csv"), os.path.join(outdir, "dtcc_strikes.csv")
    daily = list(csv.DictReader(open(dpath))) if os.path.exists(dpath) else []
    strikes = list(csv.DictReader(open(spath))) if os.path.exists(spath) else []
    have = {r["date"] for r in daily}
    # business days back from the most recent US date
    us_today = (NOW - dt.timedelta(hours=5)).date()
    days, d = [], us_today
    while len(days) < backfill_days:
        if d.weekday() < 5:
            days.append(d)
        d -= dt.timedelta(days=1)
    latest, fetched, errors = None, 0, []
    limit = backfill_days if not daily else 6
    for day in days:  # newest first
        iso = day.isoformat()
        if iso in have:
            latest = latest or iso
            continue
        if fetched >= limit:
            break
        try:
            opt, ndf, stk = dtcc_summarise(day)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{iso} {type(e).__name__}")
            continue
        fetched += 1
        latest = latest or iso if day == days[0] else latest
        for pair, s in opt.items():
            daily.append({"date": iso, "kind": "opt", "key": pair, "n": s["n"], "usd": round(s["usd"]),
                          "call": round(s["call"]), "put": round(s["put"]), "exotic": s["exotic"]})
        for ccy, (n, usd) in ndf.items():
            daily.append({"date": iso, "kind": "ndf", "key": ccy, "n": n, "usd": round(usd), "call": 0, "put": 0, "exotic": 0})
        daily.append({"date": iso, "kind": "day", "key": "ALL", "n": sum(s["n"] for s in opt.values()),
                      "usd": 0, "call": 0, "put": 0, "exotic": 0})
        for (pair, k, exp), usd in stk.items():
            strikes.append({"date": iso, "pair": pair, "strike": k, "expiry": exp, "usd": round(usd)})
        have.add(iso)
    dates = sorted({r["date"] for r in daily if r["kind"] == "day"})
    if not dates:
        out.append("D status: unavailable (" + ", ".join(errors[:3]) + ")")
        return out, None
    cutoff = dates[-30] if len(dates) > 30 else dates[0]
    daily = [r for r in daily if r["date"] >= cutoff]
    strikes = [r for r in strikes if r["date"] >= (dates[-15] if len(dates) > 15 else dates[0])]
    for path, rows, fields in ((dpath, daily, ["date", "kind", "key", "n", "usd", "call", "put", "exotic"]),
                               (spath, strikes, ["date", "pair", "strike", "expiry", "usd"])):
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)
    last = dates[-1]
    prior = dates[-21:-1]
    def series(kind, key, field):
        m = {r["date"]: float(r[field]) for r in daily if r["kind"] == kind and r["key"] == key}
        return m
    out.append(f"Latest DTCC day: {last} (US) · history {len(dates)} days" +
               (f" · fetch errors: {', '.join(errors[:3])}" if errors else ""))
    out.append("Options by pair: pair | trades | USD notional (vs 20d avg) | base-call share of notional (20d avg) "
               "| barrier/digital trades")
    for pair in WATCH:
        usd, n, call, put, exo = (series("opt", pair, f) for f in ("usd", "n", "call", "put", "exotic"))
        if last not in usd:
            continue
        hist = [usd.get(d, 0.0) for d in prior]
        avg = sum(hist) / len(hist) if hist else 0
        cs = call[last] / (call[last] + put[last]) if (call[last] + put[last]) > 0 else None
        hc = [call.get(d, 0) for d in prior]; hp = [put.get(d, 0) for d in prior]
        cs20 = sum(hc) / (sum(hc) + sum(hp)) if (sum(hc) + sum(hp)) > 0 else None
        line = f"{pair} | {int(n[last])} | ${usd[last] / 1e9:.2f}bn" + (f" ({usd[last] / avg:.1f}x)" if avg else "")
        if cs is not None:
            line += f" | {pair[:3]} calls {cs * 100:.0f}%" + (f" (20d {cs20 * 100:.0f}%)" if cs20 is not None else "")
        line += f" | {int(exo[last])}"
        out.append(line)
    out.append("NDF volume: ccy | trades | USD notional (vs 20d avg)")
    for ccy in NDF_CCY:
        usd, n = series("ndf", ccy, "usd"), series("ndf", ccy, "n")
        if last not in usd:
            continue
        hist = [usd.get(d, 0.0) for d in prior]
        avg = sum(hist) / len(hist) if hist else 0
        out.append(f"USD{ccy} NDF | {int(n[last])} | ${usd[last] / 1e9:.2f}bn" + (f" ({usd[last] / avg:.1f}x)" if avg else ""))
    # strike magnets: vanilla strikes traded in the last 15 days, expiring in the next 14 days
    t0, t1 = NOW.date().isoformat(), (NOW + dt.timedelta(days=14)).date().isoformat()
    agg = {}
    for r in strikes:
        if t0 <= r["expiry"] <= t1 and r["pair"] in WATCH:
            key = (r["pair"], r["strike"], r["expiry"])
            agg[key] = agg.get(key, 0.0) + float(r["usd"])
    big = sorted(((v, k) for k, v in agg.items() if v >= (100e6 if k[0][:3] in PRIO and k[0][3:] in PRIO else 50e6)),
                 reverse=True)
    out.append("Large strikes expiring in the next 14 days (traded in the last 15 DTCC days; USD notional, floors):")
    if not big:
        out.append("none above $100m (G10) / $50m (Asia)")
    per_pair = {}
    for v, (pair, k, exp) in big:
        if per_pair.get(pair, 0) >= 4:
            continue
        per_pair[pair] = per_pair.get(pair, 0) + 1
        sp = SPOT.get(pair) or SPOT.get(pair.replace("CNY", "CNH"))
        away = f" · spot {fmt_level(sp)}, {(float(k) / sp - 1) * 100:+.1f}% away" if sp else ""
        out.append(f"{pair} {k} exp {exp}: ${v / 1e6:,.0f}m{away}")
        if sum(per_pair.values()) >= 24:
            break
    return out, last


# ---------------------------------------------------------------- E. headlines
def gn(q):
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q + " when:1d", "hl": "en-US", "gl": "US", "ceid": "US:en"})


MARKET_WORDS = re.compile(
    r"\b(fed|fomc|powell|warsh|rate|rates|yield|yields|treasur\w*|bond\w*|gilt\w*|jgb\w*|dollar|yen|yuan|renminbi|"
    r"rupee|rupiah|ringgit|peso|baht|korean won|currenc\w*|forex|fx|inflation|cpi|pce|payroll\w*|jobs|gdp|recession|"
    r"oil|brent|crude|opec\w*|lng|gas|gold|silver|copper|stock\w*|equit\w*|shares|market\w*|central bank|"
    r"boj|pboc|rbi|bok|ecb|boe|rba|mas|tariff\w*|intervention|kospi|nikkei|s&p|nasdaq|dow|hang seng|taiex|"
    r"economy|economic|fiscal|deficit|budget|sanction\w*|hike\w*|cut\w*|easing|tightening)\b", re.I)

FEEDS = [
    ("Fed and Fed watchers", gn('(Fed OR FOMC OR Powell OR Warsh OR Timiraos OR "Fed\'s") (rates OR inflation OR policy)'), 6),
    ("Reuters markets", gn("site:reuters.com/markets/currencies OR site:reuters.com/markets/rates-bonds OR site:reuters.com/markets/asia OR site:reuters.com/markets/us OR site:reuters.com/business/energy"), 8),
    ("Reuters business and world", gn("site:reuters.com (economy OR central bank OR tariffs OR sanctions)"), 5),
    ("Bloomberg markets", gn("site:bloomberg.com markets"), 6),
    ("Asia central banks and FX", gn('("Bank of Japan" OR BOJ OR PBOC OR "People\'s Bank of China" OR "Bank of Korea" OR "Reserve Bank of India" OR "Monetary Authority of Singapore") (rate OR currency OR yen OR yuan OR won OR rupee OR policy OR intervention)'), 6),
    ("Energy", gn("(OPEC OR Brent OR crude OR LNG) (prices OR supply OR output)"), 4),
    ("FT markets", "https://www.ft.com/markets?format=rss", 5),
    ("Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar", 5),
    ("CNBC markets", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", 5),
    ("WSJ markets", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", 5),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse", 4),
]


def section_e():
    out = ["## E. HEADLINES (RSS, last 24h; headlines are leads, not facts)"]
    seen, total, failed = set(), 0, []
    since = NOW - dt.timedelta(hours=24)
    for group, url, cap in FEEDS:
        try:
            root = ET.fromstring(get(url, timeout=25))
        except Exception as e:  # noqa: BLE001
            failed.append(f"{group} ({type(e).__name__})"); continue
        items = []
        for it in root.iter("item"):
            title = html.unescape((it.findtext("title") or "").strip())
            link = (it.findtext("link") or "").strip()
            pub = it.findtext("pubDate") or ""
            try:
                when = email.utils.parsedate_to_datetime(pub)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=dt.timezone.utc)
            except Exception:  # noqa: BLE001
                continue
            if when < since or len(title) < 25:
                continue
            if "Stock Price & Latest News" in title or not MARKET_WORDS.search(title):
                continue
            src = ""
            s = it.find("source")
            if s is not None and s.text:
                src = s.text.strip()
                title = re.sub(r"\s+-\s+" + re.escape(src) + r"$", "", title)
            key = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:80]
            if key in seen:
                continue
            seen.add(key)
            items.append((when, title, src, link))
        items.sort(reverse=True)
        if items:
            out.append(f"### {group}")
        for when, title, src, link in items[:cap]:
            out.append(f"- {when.astimezone(SGT):%d %b %H:%M} SGT · {src or group} · {title} · {link}")
            total += 1
    out.append(f"E status: {total} headlines" + (f" · failed: {', '.join(failed)}" if failed else ""))
    return out, total


# ---------------------------------------------------------------- F. disclosed shorts JP/AU
QUIVAD = "https://www.quivad.com/api/positions.jsonl.gz"  # keyless republication of regulator short registers


def section_f(outdir, top=8):
    """JFSA (Japan, fund-level, >=0.5% of shares) and ASIC (Australia, aggregate per stock) disclosed shorts."""
    out = ["## F. DISCLOSED SHORTS JP/AU (QuiVad from JFSA and ASIC registers; single-name crowding, not index positioning)"]
    try:
        raw = get(QUIVAD, timeout=60)
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        rows = [json.loads(l) for l in raw.decode().splitlines() if l.strip()]
    except Exception as e:  # noqa: BLE001
        out.append(f"F status: failed ({type(e).__name__})")
        return out, 0
    today = NOW.astimezone(SGT).date()
    wk = (today - dt.timedelta(days=7)).isoformat()
    hist_path = os.path.join(outdir, "shorts_history.csv")
    hist = {}
    if os.path.exists(hist_path):
        for r in csv.DictReader(open(hist_path)):
            hist.setdefault((r["market"], r["company"]), []).append((r["date"], float(r["pct"])))

    def prior(mkt, co):
        old = [v for d, v in sorted(hist.get((mkt, co), [])) if d <= wk]
        return old[-1] if old else None

    keep = []
    jp, au = {}, {}
    for r in rows:
        if r.get("unit") != "percent" or r.get("size") is None:
            continue
        if r["market"] == "jp":
            c = jp.setdefault(r["company"], {"pct": 0.0, "funds": 0, "last": ""})
            c["pct"] += r["size"]; c["funds"] += 1
            c["last"] = max(c["last"], r.get("disclosed_on") or "")
        elif r["market"] == "au" and r.get("aggregated") and " ETF" not in r["company"]:
            au[r["company"]] = {"pct": r["size"], "last": r.get("disclosed_on") or ""}
    n_total = len(jp) + len(au)

    def chg(mkt, co, pct):
        p = prior(mkt, co)
        return f" (1w {pct - p:+.2f})" if p is not None else ""

    def builders(mkt, book):
        moves = [(v["pct"] - prior(mkt, co), co, v["pct"]) for co, v in book.items() if prior(mkt, co) is not None]
        moves = [m for m in sorted(moves, reverse=True) if m[0] >= 0.5][:top]
        if not hist:
            return "Biggest 1w build-ups: history starts today, first read in 7 days."
        return "Biggest 1w build-ups (top-60 names): " + ("; ".join(f"{co} {d:+.2f} to {v:.2f}%" for d, co, v in moves) or "none of 0.5 points or more")

    if jp:
        latest = max(c["last"] for c in jp.values())
        out.append(f"### Japan (JFSA, fund positions of 0.5% or more, register as of {latest}): {len(jp)} names")
        ranked = sorted(jp.items(), key=lambda kv: -kv[1]["pct"])[:top]
        out.append("Most shorted (sum of disclosed fund shorts, % of shares | funds): " + "; ".join(
            f"{co} {c['pct']:.2f}%{chg('jp', co, c['pct'])} | {c['funds']}" for co, c in ranked))
        out.append(builders("jp", jp))
        keep += [("jp", co, c["pct"]) for co, c in sorted(jp.items(), key=lambda kv: -kv[1]["pct"])[:60]]
    if au:
        latest = max(c["last"] for c in au.values())
        out.append(f"### Australia (ASIC aggregate short positions, as of {latest}): {len(au)} stocks")
        ranked = sorted(au.items(), key=lambda kv: -kv[1]["pct"])[:top]
        out.append("Most shorted (% of shares): " + "; ".join(f"{co} {c['pct']:.2f}%{chg('au', co, c['pct'])}" for co, c in ranked))
        out.append(builders("au", au))
        keep += [("au", co, c["pct"]) for co, c in sorted(au.items(), key=lambda kv: -kv[1]["pct"])[:60]]
    # history: today's top 60 per market, 120 days kept
    cutoff = (today - dt.timedelta(days=120)).isoformat()
    lines = [(d, m, co, v) for (m, co), lst in hist.items() for d, v in lst if cutoff <= d < today.isoformat()]
    lines += [(today.isoformat(), m, co, round(v, 4)) for m, co, v in keep]
    with open(hist_path, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["date", "market", "company", "pct"]); w.writerows(sorted(lines))
    out.append(f"F status: {len(jp)} JP + {len(au)} AU names")
    return out, n_total


# ---------------------------------------------------------------- assemble
HOW_TO = """HOW TO USE (Macro Takeaways; part of STEP 2 item 1, added 1 Nov 2026 at Mayank's request; this file is data from a pre-run script, its numbers carry their sources)
1. TAPE: take the TAPE strip levels from section A with the quote times printed there; web-search only a level that is missing here or flagged STALE QUOTE (a closed market's last close is not stale). Reconcile source-quoted levels against A as before.
2. PRICE ACTION: every theme and every trade card names its main proxy's line from A in one clause: trend (vs MA50/MA200), the 1w move in sigma, ext, and any flag, e.g. "price: above 50/200, 1w +1.8 sigma, ext +1.9, 20d HIGH". A BUILD-UP flag is the trade_book_spec washout screen's test on the same bars; price alone is never crowding.
3. POSITIONING BUILD-UP: undo Drive's backslash escapes in the section C query (\\_ to _, \\* to *, and so on: the query itself has no backslash), then run it with execute_sql (project diiwqbxyhtgvozhncoef) in the same pass as R02. In each theme's Positioning line cite the series for its market whose 4-week change |d4| is 25 points or more, as "<series>: 3y pct <pct> (4w <d4>)". A build-up is not an extreme: R02 alone decides HARD POSITIONING and R09's crowd field.
4. PARTICIPATION: from section B cite, in the Positioning line of a theme or on a card whose proxy is one of these futures, the price/OI read and volume vs its 20-day average. A move on falling OI (short covering, long liquidation) is weaker evidence of conviction than one on rising OI.
5. FX OPTIONS: from section D cite, on FX themes and FX cards, the pair's option notional vs its 20-day average and the base-call share against its 20-day share (a demand-for-calls proxy, not a risk reversal), and any large strike expiring before the card's horizon within about 1% of spot. On an R01 convexity card name a large strike or expiry near its strike or barrier. US-reported trades only: say "DTCC sample" when you cite it.
6. HEADLINES: section E is a lead list for the COMPLETENESS SWEEP's reconcile step (completeness_sweep_spec B): a material headline the feeds missed is checked at its source and only then added with "[sweep]" and its link. A headline is never a fact, a number or an odds arrow by itself.
7. DISCLOSED SHORTS (added 1 Nov 2026, reference only): section F lists the most shorted Japanese and Australian names. Cite it only on a card or theme whose proxy is one of those names or a Nikkei/ASX single-stock expression, as "JFSA/ASIC shorts: <name> <pct>% (<funds> funds, 1w chg)". Never a reason for an index or FX view by itself.
8. Footer line: "Market pack: <build time> · A <n> assets · B <n> futures · D <DTCC date> · E <n> headlines", or "Market pack: not found / stale (<date>)" if the file is missing or built more than 20 hours before the run; then fall back to web-searched TAPE levels and skip items 2 to 7."""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--sql", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "posbuild.sql"))
    ap.add_argument("--skip", default="", help="comma list of sections to skip, e.g. D,E")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    skip = set(a.skip.upper().split(",")) if a.skip else set()
    built = NOW.astimezone(SGT)
    parts, status = [], {}
    if "A" not in skip:
        sec, status["A"] = section_a(); parts += [""] + sec
    if "B" not in skip:
        sec, status["B"] = section_b(a.out); parts += [""] + sec
    sql = open(a.sql).read().strip() if os.path.exists(a.sql) else "-- posbuild.sql missing"
    parts += ["", "## C. POSITIONING BUILD-UP (run this read-only query with execute_sql, project diiwqbxyhtgvozhncoef)",
              "Output lines: market | series | freq | as-of | pct = 3y percentile now | d1 = change vs 1 week (monthly: 1 obs) | d4 = change vs 4 weeks (monthly: 3 obs); sorted by |d4|.",
              "```sql", sql, "```"]
    if "D" not in skip:
        sec, status["D"] = section_d(a.out); parts += [""] + sec
    if "E" not in skip:
        sec, status["E"] = section_e(); parts += [""] + sec
    if "F" not in skip:
        sec, status["F"] = section_f(a.out); parts += [""] + sec
    head = [f"MARKET PACK — built {built:%a %d %b %Y %H:%M} SGT · A {status.get('A', 0)} assets · "
            f"B {status.get('B', 0)} futures · D {status.get('D') or 'n/a'} · E {status.get('E', 0)} headlines · F {status.get('F', 0)} short names",
            "Sources: Yahoo Finance (delayed quotes and daily bars), DTCC public swap data (CFTC FX), public RSS, QuiVad (JFSA/ASIC short registers). "
            "Built by scripts/marketpack/marketpack.py in mayank201181/Claudemacrotrades.", "", HOW_TO]
    text = "\n".join(head + parts) + "\n"
    path = os.path.join(a.out, "market_pack_latest.md")
    with open(path, "w") as f:
        f.write(text)
    print(f"ok: {path} {len(text.encode())} bytes · " + " · ".join(f"{k} {v}" for k, v in status.items()))


if __name__ == "__main__":
    main()
