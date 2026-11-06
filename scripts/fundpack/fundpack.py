#!/usr/bin/env python3
"""Weekly FUNDAMENTALS PACK for the Macro Takeaways (stdlib only, public APIs, no keys).

A slow-moving anchor for the top-down view per product: level, 3-month and 6-month momentum and a
5-year percentile for inflation, business surveys, trade, reserves, credit and real policy rates across
G10 and Asia. Levels only: no consensus, so nothing here is a surprise or a trade trigger.

Sources (official, free, no key)
  IMF SDMX 3 (api.imf.org)   CPI y/y (CPI), goods exports and imports (IMTS), reserves (IL)
  OECD SDMX (sdmx.oecd.org)  core CPI y/y (PRICES_ALL), CLI and business confidence (STES, the PMI stand-in)
  Eurostat                   euro-area HICP headline, core and services (prc_hicp_minr)
  BIS (stats.bis.org)        policy rates (WS_CBPOL), private credit % GDP (WS_TC), credit-to-GDP gap
  FRED (fredgraph.csv)       US weekly and monthly block (claims, NFCI, payrolls, core CPI/PCE, 5y5y, HY OAS)

Usage: python3 -I fundpack.py --out /mnt/project-files/fundpack/
Writes fund_pack_latest.md (and .json) in --out. Every source fails soft: a failed pull prints a line.
"""
import argparse, csv, datetime as dt, io, json, os, statistics, sys, time, urllib.parse, urllib.request

SGT = dt.timezone(dt.timedelta(hours=8))
NOW = dt.datetime.now(dt.timezone.utc)
UA = {"User-Agent": "macro-desk-fundpack/1.0"}
START = f"{NOW.year - 6}-01"
ERR = []

# code, label, IMF iso3, BIS iso2, OECD area, IMTS country (EA uses Germany), group
C = [
    ("US", "US", "USA", "US", "USA", "USA", "G10"), ("EA", "Euro area", "G163", "XM", "EA20", "DEU", "G10"),
    ("JP", "Japan", "JPN", "JP", "JPN", "JPN", "G10"), ("GB", "UK", "GBR", "GB", "GBR", "GBR", "G10"),
    ("CA", "Canada", "CAN", "CA", "CAN", "CAN", "G10"), ("AU", "Australia", "AUS", "AU", "AUS", "AUS", "G10"),
    ("NZ", "New Zealand", "NZL", "NZ", "NZL", "NZL", "G10"), ("CH", "Switzerland", "CHE", "CH", "CHE", "CHE", "G10"),
    ("SE", "Sweden", "SWE", "SE", "SWE", "SWE", "G10"), ("NO", "Norway", "NOR", "NO", "NOR", "NOR", "G10"),
    ("CN", "China", "CHN", "CN", "CHN", "CHN", "Asia"), ("KR", "Korea", "KOR", "KR", "KOR", "KOR", "Asia"),
    ("TW", "Taiwan", "TWN", "TW", "TWN", "TWN", "Asia"), ("IN", "India", "IND", "IN", "IND", "IND", "Asia"),
    ("ID", "Indonesia", "IDN", "ID", "IDN", "IDN", "Asia"), ("MY", "Malaysia", "MYS", "MY", "MYS", "MYS", "Asia"),
    ("TH", "Thailand", "THA", "TH", "THA", "THA", "Asia"), ("PH", "Philippines", "PHL", "PH", "PHL", "PHL", "Asia"),
    ("SG", "Singapore", "SGP", "SG", "SGP", "SGP", "Asia"), ("HK", "Hong Kong", "HKG", "HK", "HKG", "HKG", "Asia"),
]
BY = {c[0]: c for c in C}


def get(url, headers=None, timeout=90, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise last


def soft(name, fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001
        ERR.append(f"{name}: {type(e).__name__} {str(e)[:120]}")
        return {}


def norm_period(p):
    """2026-M09 / 2026-09 / 2026-Q1 -> sortable '2026-09' or '2026-Q1'."""
    p = p.strip().replace("-M", "-")
    return p


# ---------------------------------------------------------------- source pulls: each returns {(country, key): [(period, value)]}
def _rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def _collect(rows, ckey, skey, cmap, pkey="TIME_PERIOD", vkey="OBS_VALUE"):
    out = {}
    for r in rows:
        v, p = r.get(vkey), r.get(pkey)
        if not v or not p or r.get(ckey) not in cmap:
            continue
        try:
            out.setdefault((cmap[r[ckey]], skey(r)), []).append((norm_period(p), float(v)))
        except ValueError:
            pass
    for k in out:
        out[k] = sorted(set(out[k]))
    return out


IMF = "https://api.imf.org/external/sdmx/2.1/data/"
IMF_H = {"Accept": "application/vnd.sdmx.data+csv;version=1.0.0"}


def imf_cpi():
    m = {c[2]: c[0] for c in C}
    t = get(IMF + "IMF.STA,CPI/" + "+".join(m) + f".CPI._T.YOY_PCH_PA_PT.M?startPeriod={START}", IMF_H)
    return _collect(_rows(t), "COUNTRY", lambda r: "cpi", m)


def imf_trade():
    m = {c[5]: c[0] for c in C}
    t = get(IMF + "IMF.STA,IMTS/" + "+".join(m) + f".XG_FOB_USD+MG_CIF_USD.G001.M?startPeriod={START}", IMF_H)
    return _collect(_rows(t), "COUNTRY", lambda r: "x" if r["INDICATOR"].startswith("XG") else "m", m)


def imf_reserves():
    m = {c[2]: c[0] for c in C}
    t = get(IMF + "IMF.STA,IL/" + "+".join(m) + f".TRGMV_REVS+RXF11FX_REVS.USD.M?startPeriod={START}", IMF_H)
    return _collect(_rows(t), "COUNTRY", lambda r: "res" if r["INDICATOR"].startswith("TRG") else "fxres", m)


OECD = "https://sdmx.oecd.org/public/rest/data/"


def oecd_core():
    m = {c[4]: c[0] for c in C}
    t = get(OECD + "OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/" + "+".join(m) +
            f".M+Q.N.CPI.PA._T+_TXCP01_NRG.N.GY?startPeriod={START}&dimensionAtObservation=AllDimensions&format=csvfile")
    out = _collect(_rows(t), "REF_AREA", lambda r: ("core" if r["EXPENDITURE"] != "_T" else "cpi_oecd") + "_" + r["FREQ"], m)
    res = {}
    for (cc, k), v in out.items():  # monthly where it exists, quarterly (AU, NZ) otherwise
        base, fq = k.rsplit("_", 1)
        if fq == "M" or (cc, base + "_M") not in out:
            res[(cc, base)] = v
    return res


def oecd_cli():
    m = {c[4]: c[0] for c in C}
    t = get(OECD + "OECD.SDD.STES,DSD_STES@DF_CLI,4.1/" + "+".join(m) +
            f".M.LI+BCICP...AA...H+_Z?startPeriod={START}&dimensionAtObservation=AllDimensions&format=csvfile")
    return _collect(_rows(t), "REF_AREA", lambda r: "cli" if r["MEASURE"] == "LI" else "bci", m)


def eurostat_hicp():
    url = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?geo=EA&unit=RCH_A"
           "&coicop18=TOTAL&coicop18=TOT_X_NRG_FOOD&coicop18=SERV&lastTimePeriod=80")
    d = json.loads(get(url))
    dims, size = d["id"], d["size"]
    idx = {k: {v: i for i, v in enumerate(d["dimension"][k]["category"]["index"])} for k in dims}
    inv = {k: {i: v for v, i in idx[k].items()} for k in dims}
    out = {}
    for flat, v in d["value"].items():
        flat, pos = int(flat), {}
        for k, s in zip(reversed(dims), reversed(size)):
            pos[k] = flat % s
            flat //= s
        code, per = inv["coicop18"][pos["coicop18"]], inv["time"][pos["time"]]
        key = {"TOTAL": "cpi", "TOT_X_NRG_FOOD": "core", "SERV": "serv"}[code]
        out.setdefault(("EA", key), []).append((per, float(v)))
    return {k: sorted(v) for k, v in out.items()}


BIS = "https://stats.bis.org/api/v2/data/dataflow/BIS/"


def bis_policy():
    m = {c[3]: c[0] for c in C}
    t = get(BIS + "WS_CBPOL/1.0/M." + "+".join(m) + f"?startPeriod={START}&format=csv")
    return _collect(_rows(t), "REF_AREA", lambda r: "pol", m)


def bis_credit():
    m = {c[3]: c[0] for c in C}
    t = get(BIS + "WS_TC/2.0/Q." + "+".join(m) + f".P.A.M.770.A?startPeriod={NOW.year - 6}&format=csv")
    out = _collect(_rows(t), "BORROWERS_CTY", lambda r: "credit", m)
    t = get(BIS + "WS_CREDIT_GAP/1.0/Q." + "+".join(m) + f".P.A.C?startPeriod={NOW.year - 6}&format=csv")
    out.update(_collect(_rows(t), "BORROWERS_CTY", lambda r: "gap", m))
    return out


FRED = [  # id, label, transform, unit
    ("ICSA", "Initial claims, 4w avg", "ma4", "k"), ("CCSA", "Continuing claims", "lvl", "k"),
    ("NFCI", "Chicago Fed NFCI (+ = tighter)", "lvl", ""), ("UNRATE", "Unemployment rate", "lvl", "%"),
    ("PAYEMS", "Payrolls, 3m avg change", "d3avg", "k"), ("CPILFESL", "Core CPI, 3m annualised", "saar3", "%"),
    ("PCEPILFE", "Core PCE y/y", "yoy", "%"), ("T5YIFR", "5y5y breakeven", "lvl", "%"),
    ("BAMLH0A0HYM2", "HY OAS", "lvl", "%"),
]


def fred():
    out = {}
    for sid, _, _, _ in FRED:
        try:
            t = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={NOW.year - 6}-01-01", timeout=60)
            rows = []
            for r in _rows(t):
                v = r.get(sid)
                if v and v != ".":
                    rows.append((r["observation_date"], float(v)))
            out[("US", "fred_" + sid)] = rows
        except Exception as e:  # noqa: BLE001
            ERR.append(f"FRED {sid}: {type(e).__name__}")
        time.sleep(0.5)
    return out


# ---------------------------------------------------------------- maths
def yoy_3mma(lv):
    """3-month sum y/y % from a monthly level series."""
    d = dict(lv)
    ps = [p for p, _ in lv]
    out = []
    for i in range(14, len(ps)):
        cur = ps[i - 2:i + 1]
        y, mth = int(ps[i][:4]), int(ps[i][5:7])
        prev = [f"{y - 1}-{int(p[5:7]):02d}" for p in cur]
        if all(p in d for p in prev) and len(cur) == 3:
            a, b = sum(d[p] for p in cur), sum(d[p] for p in prev)
            if b:
                out.append((ps[i], 100 * (a / b - 1)))
    return out


def pct_rank(xs, x):
    if len(xs) < 12:
        return None
    return round(100 * sum(1 for v in xs if v <= x) / len(xs))


def stats(series, lag3=3, lag6=6, window=60, pct_change=False):  # lags in observations
    if not series:
        return None
    vals = [v for _, v in series]
    p, v = series[-1]
    def ago(k):
        return vals[-1 - k] if len(vals) > k else None
    a3, a6 = ago(lag3), ago(lag6)
    if pct_change:
        d3 = 100 * (v / a3 - 1) if a3 else None
        d6 = 100 * (v / a6 - 1) if a6 else None
    else:
        d3 = v - a3 if a3 is not None else None
        d6 = v - a6 if a6 is not None else None
    return {"p": p, "v": v, "d3": d3, "d6": d6, "pct": pct_rank(vals[-window:], v)}


def arrow(d, thr):
    if d is None:
        return "·"
    return "↑" if d > thr else "↓" if d < -thr else "→"


def f(x, d=1, sign=False):
    if x is None:
        return "n/a"
    return f"{x:+.{d}f}" if sign else f"{x:.{d}f}"


def months_old(p):
    try:
        if "Q" in p:
            y, q = int(p[:4]), int(p[-1])
            y_m = (y, q * 3)
        else:
            y_m = (int(p[:4]), int(p[5:7]))
        return (NOW.year - y_m[0]) * 12 + NOW.month - y_m[1]
    except Exception:  # noqa: BLE001
        return 99


# ---------------------------------------------------------------- build
def build():
    data = {}
    for name, fn in [("IMF CPI", imf_cpi), ("IMF IMTS", imf_trade), ("IMF IL", imf_reserves), ("OECD prices", oecd_core),
                     ("OECD CLI/BCI", oecd_cli), ("Eurostat HICP", eurostat_hicp), ("BIS policy", bis_policy),
                     ("BIS credit", bis_credit), ("FRED", fred)]:
        got = soft(name, fn)
        data.update(got)
        print(f"  {name}: {len(got)} series", file=sys.stderr)
    S = lambda c, k: data.get((c, k), [])  # noqa: E731

    rows = {}
    for c in C:
        cc = c[0]
        cpi = S(cc, "cpi")
        oc = S(cc, "cpi_oecd")
        if oc and (not cpi or oc[-1][0] > cpi[-1][0]):
            cpi = oc
        x = yoy_3mma(S(cc, "x"))
        bal = []
        xs, ms = dict(S(cc, "x")), dict(S(cc, "m"))
        ps = sorted(set(xs) & set(ms))
        for i in range(2, len(ps)):
            bal.append((ps[i], sum(xs[p] - ms[p] for p in ps[i - 2:i + 1]) / 1e9))
        res = S(cc, "fxres") or S(cc, "res")
        pol = S(cc, "pol")
        core = S(cc, "core")
        if cc == "US":  # OECD's US core differs from BLS core; use BLS core CPI y/y from FRED
            lv = S("US", "fred_CPILFESL")
            core = [(lv[i][0][:7], 100 * (lv[i][1] / lv[i - 12][1] - 1)) for i in range(12, len(lv))]
        q = lambda s: 1 if s and "Q" in s[-1][0] else 3  # noqa: E731  quarterly series: 1 obs = 3 months
        cs = stats(cpi, lag3=q(cpi), lag6=2 * q(cpi), window=20 * q(cpi)) if cpi else None
        ks = stats(core, lag3=q(core), lag6=2 * q(core), window=20 * q(core)) if core else None
        if ks and months_old(ks["p"]) > 12:
            ks = None  # discontinued in the source
        r = {
            "cpi": cs, "core": ks, "serv": stats(S(cc, "serv")),
            "cli": stats(S(cc, "cli")), "bci": stats(S(cc, "bci")),
            "x": stats(x), "bal": stats(bal, lag3=12, lag6=12),
            "res": stats(res, pct_change=True), "res_kind": "FX" if S(cc, "fxres") else "total",
            "pol": stats(pol), "credit": stats(S(cc, "credit"), lag3=4, lag6=8, window=20),
            "gap": stats(S(cc, "gap"), lag3=4, lag6=8, window=20),
        }
        if r["pol"] and r["cpi"]:
            real = r["pol"]["v"] - r["cpi"]["v"]
            # real rate 6 months ago from the two series' own history
            p6 = pol[-7][1] if len(pol) > 6 else None
            c6 = cpi[-7][1] if len(cpi) > 6 else None
            r["real"] = {"v": real, "d6": (real - (p6 - c6)) if p6 is not None and c6 is not None else None}
        rows[cc] = r
    return rows, data


def regime(r):
    """One word per block, from momentum only (descriptive, untested)."""
    out = []
    if r["cpi"]:
        out.append("infl " + {"↑": "rising", "↓": "falling", "→": "flat", "·": "?"}[arrow(r["cpi"]["d3"], 0.2)])
    if r["cli"]:
        lv, d = r["cli"]["v"], r["cli"]["d3"]
        phase = ("expansion" if d > 0 else "slowdown") if lv >= 100 else ("recovery" if d > 0 else "downturn")
        out.append(f"cycle {phase}")
    if r["x"]:
        out.append("exports " + {"↑": "accelerating", "↓": "decelerating", "→": "steady", "·": "?"}[arrow(r["x"]["d3"], 2)])
    if r["res"]:
        out.append("reserves " + {"↑": "building", "↓": "drawing", "→": "flat", "·": "?"}[arrow(r["res"]["d3"], 1)])
    if r["credit"]:
        out.append("credit/GDP " + {"↑": "rising", "↓": "falling", "→": "flat", "·": "?"}[arrow(r["credit"]["d3"], 1)])
    return ", ".join(out)


def cell(s, d=1, thr=0.2, show_pct=True, unit="", spans=("3m", "6m")):
    if not s:
        return "n/a"
    stale = " STALE" if months_old(s["p"]) > (9 if "Q" in s["p"] else 4) else ""
    pc = f" p{s['pct']}" if show_pct and s.get("pct") is not None else ""
    return f"{f(s['v'], d)}{unit} {arrow(s['d3'], thr)} {spans[0]} {f(s['d3'], d, True)} {spans[1]} {f(s['d6'], d, True)}{pc} ({s['p']}){stale}"


HOW_TO = """HOW TO USE (Macro Takeaways; weekly anchor added 6 Nov 2026 at Mayank's request; data from official free APIs, built by a script)
1. This is the slow-moving FUNDAMENTAL ANCHOR for the top-down view per product: the direction of inflation, the cycle, trade, reserves, credit and real policy rates. Use it in a theme's macro view when the theme's thesis is fundamental (e.g. "disinflation lets X cut", "exports rolling over", "reserves drawing"): one clause, e.g. "fund pack: KR exports 3mma y/y +8.1 ↓ (2026-07), CLI 102.5 slowdown".
2. Never a trade trigger and never a reason to raise p by itself: levels carry no consensus, so no surprise; markets price the surprise. Dated catalysts still come from the event library and the calendar.
3. Data lag: every cell prints its period. Monthly data 2-4 months old and BIS credit about two quarters old is normal; a cell marked STALE is context only. Do not quote a number here as the latest print if a feed or the web has a newer one.
4. Where a theme's thesis contradicts the anchor (e.g. "inflation re-accelerating" while CPI and core are ↓ on 3m and 6m), say so in the theme's risks line. That is the main use.
5. Footer: the market pack footer's G field carries this pack's build date; "stale" there means skip it."""


def render(rows):
    built = NOW.astimezone(SGT)
    L = [f"FUNDAMENTALS PACK — built {built:%a %d %b %Y %H:%M} SGT (weekly)",
         "Sources: IMF (CPI, IMTS trade, IL reserves), OECD (core CPI, CLI, business confidence), Eurostat (euro-area HICP), "
         "BIS (policy rates, private credit, credit gap), FRED (US block). Built by scripts/fundpack/fundpack.py in "
         "mayank201181/Claudemacrotrades.", "", HOW_TO, "",
         "Cell = latest, arrow on the 3-month change (quarterly series: 1 quarter; credit: 4 quarters), 3m and 6m change, pNN = 5-year percentile, (period). "
         "Inflation and rates in %, changes in pp. Exports = goods exports in USD, 3-month sum y/y %. "
         "Trade balance = 3-month sum USD bn, changes vs 12 months earlier. Reserves = USD level in bn, changes in %, "
         "include FX valuation. CLI/BCI: OECD amplitude-adjusted, 100 = trend; BCI is the free stand-in for "
         "manufacturing PMIs (S&P/Caixin/ISM PMIs are not free). Credit = BIS private non-financial credit % GDP, "
         "quarterly, changes over 4q and 8q.", ""]

    L.append("## 1. Regime by country (momentum only, descriptive, untested)")
    for c in C:
        L.append(f"{c[0]}{'' if c[1] == c[0] else ' ' + c[1]}: {regime(rows[c[0]]) or 'n/a'}")

    L += ["", "## 2. Inflation"]
    for c in C:
        r = rows[c[0]]
        extra = f" | services {cell(r['serv'])}" if r["serv"] else ""
        L.append(f"{c[0]}: CPI {cell(r['cpi'])} | core {cell(r['core'])}{extra}")

    L += ["", "## 3. Policy and real rates (real = policy rate minus headline CPI y/y)"]
    rr = []
    for c in C:
        r = rows[c[0]]
        real = r.get("real")
        rs = f" | real {f(real['v'], 2, True)} (6m {f(real['d6'], 2, True)})" if real else ""
        L.append(f"{c[0]}: policy {cell(r['pol'], 2, 0.05, False)}{rs}")
        if real:
            rr.append((real["v"], c[0]))
    if rr:
        L.append("Real-rate rank, high to low: " + " > ".join(f"{k} {v:+.1f}" for v, k in sorted(rr, reverse=True)))

    L += ["", "## 4. Cycle (OECD CLI and business confidence)"]
    mom = []
    for c in C:
        r = rows[c[0]]
        if r["cli"] or r["bci"]:
            L.append(f"{c[0]}: CLI {cell(r['cli'], 2, 0.1)} | BCI {cell(r['bci'], 2, 0.1)}")
            if r["cli"] and r["cli"]["d3"] is not None:
                mom.append((r["cli"]["d3"], c[0]))
    if mom:
        L.append("CLI 3m momentum rank: " + " > ".join(f"{k} {v:+.2f}" for v, k in sorted(mom, reverse=True)))

    L += ["", "## 5. Trade (goods, USD)"]
    for c in C:
        r = rows[c[0]]
        if r["x"] or r["bal"]:
            b = r["bal"]
            bs = f"{f(b['v'], 1)}bn (vs 12m ago {f(b['d3'], 1, True)}) ({b['p']})" if b else "n/a"
            L.append(f"{c[0]}{' (DE)' if c[0] == 'EA' else ''}: exports {cell(r['x'], 1, 2)} | balance 3m {bs}")

    L += ["", "## 6. Reserves (IMF IL, USD; FX = foreign-currency reserves, total = incl. gold)"]
    for c in C:
        r = rows[c[0]]
        s = r["res"]
        if s:
            stale = " STALE" if months_old(s["p"]) > 4 else ""
            L.append(f"{c[0]}: {r['res_kind']} {s['v'] / 1e9:,.0f}bn {arrow(s['d3'], 1)} 3m {f(s['d3'], 1, True)}% "
                     f"6m {f(s['d6'], 1, True)}% ({s['p']}){stale}")

    L += ["", "## 7. Credit (BIS, quarterly)"]
    for c in C:
        r = rows[c[0]]
        if r["credit"]:
            g = r["gap"]
            gs = f" | credit-to-GDP gap {f(g['v'], 1, True)} (4q {f(g['d3'], 1, True)})" if g else ""
            L.append(f"{c[0]}: private credit {cell(r['credit'], 1, 1, False, spans=("4q", "8q"))} %GDP{gs}")

    L += ["", "## 8. US block (FRED; weekly series are the freshest numbers in this pack)"]
    for sid, label, tr, unit in FRED:
        s = data_us.get(sid)
        if s:
            L.append(f"{label}: {s}")
    if ERR:
        L += ["", "Fetch errors: " + "; ".join(ERR)]
    return "\n".join(L) + "\n"


data_us = {}


def us_block(data):
    for sid, label, tr, unit in FRED:
        rows = data.get(("US", "fred_" + sid), [])
        if not rows:
            continue
        p, v = rows[-1]
        try:
            if tr == "lvl":
                ago = rows[-14][1] if sid in ("CCSA", "NFCI") and len(rows) > 13 else (rows[-4][1] if len(rows) > 3 else None)
                txt = f"{v / 1000:,.0f}{unit}" if unit == "k" else f"{v:.2f}{unit}"
                dd = (v - ago) if ago is not None else None
                dtxt = (f"{dd / 1000:+,.0f}{unit}" if unit == "k" else f"{dd:+.2f}") if dd is not None else "n/a"
                span = "13w" if sid in ("CCSA", "NFCI") else "3 obs"
                data_us[sid] = f"{txt} (chg {span} {dtxt}) ({p})"
            elif tr == "ma4":
                ma = statistics.mean(x for _, x in rows[-4:])
                ma13 = statistics.mean(x for _, x in rows[-17:-13])
                data_us[sid] = f"{ma / 1000:,.0f}k (vs 13w ago {(ma - ma13) / 1000:+,.0f}k) ({p})"
            elif tr == "d3avg":
                d3 = (rows[-1][1] - rows[-4][1]) / 3
                d3p = (rows[-4][1] - rows[-7][1]) / 3
                data_us[sid] = f"{d3:+,.0f}k (prior 3m {d3p:+,.0f}k) ({p})"
            elif tr == "saar3":
                a = 100 * ((rows[-1][1] / rows[-4][1]) ** 4 - 1)
                b = 100 * ((rows[-4][1] / rows[-7][1]) ** 4 - 1)
                y = 100 * (rows[-1][1] / rows[-13][1] - 1)
                data_us[sid] = f"{a:.1f}% (prior 3m {b:.1f}%, y/y {y:.1f}%) ({p})"
            elif tr == "yoy":
                y = 100 * (rows[-1][1] / rows[-13][1] - 1)
                y3 = 100 * (rows[-4][1] / rows[-16][1] - 1)
                data_us[sid] = f"{y:.2f}% (3m ago {y3:.2f}%) ({p})"
        except Exception as e:  # noqa: BLE001
            ERR.append(f"US {sid}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rows, data = build()
    us_block(data)
    text = render(rows)
    path = os.path.join(a.out, "fund_pack_latest.md")
    with open(path, "w") as fh:
        fh.write(text)
    with open(os.path.join(a.out, "fund_pack_latest.json"), "w") as fh:
        json.dump({"built": NOW.isoformat(), "rows": rows, "us": data_us, "errors": ERR}, fh, default=str)
    n = sum(1 for r in rows.values() for k, v in r.items() if isinstance(v, dict))
    print(f"ok: {path} {len(text.encode())} bytes · {n} cells · errors {len(ERR)}")


if __name__ == "__main__":
    main()
