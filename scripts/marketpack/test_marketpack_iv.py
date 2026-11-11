"""Checks the implied-vol code of marketpack.py on synthetic DTCC rows whose vol, forward and rates are known,
and the reading of the day that is ending from DTCC's intraday files (checks 6 and 7, on a made-up file server).
Standard library only, no network. Run: python3 -I test_marketpack_iv.py
The rows are priced here with Garman-Kohlhagen written on spot and two rates, which is a different form from
the forward-and-discount-factor one the pack inverts, so a mistake in its parity or discounting shows up."""
import csv, datetime as dt, io, json, math, os, re, sys, tempfile, urllib.error, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import marketpack as mp

USD = 0.04
WORLD = {  # pair: spot, base rate, quote rate
    "EURUSD": (1.1700, 0.02, USD),
    "USDJPY": (150.00, USD, 0.01),
    "EURGBP": (0.8700, 0.02, 0.045),
    "USDKRW": (1400.0, USD, 0.025),
}
GBPUSD = (1.3400, 0.045, USD)  # only its forward drift is needed, to find the sterling rate for EURGBP
mp.iv_spot = lambda pair, ts: WORLD[pair][0]
mp.USD_RATE[:] = [USD]
N = mp._ncdf
fails = []


def check(name, got, want, tol):
    ok = got is not None and abs(got - want) <= tol
    if not ok:
        fails.append(name)
    print(f"  {'ok  ' if ok else 'FAIL'} {name}: {got} (want {want} within {tol})")


def flag(name, ok):
    if not ok:
        fails.append(name)
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")


def gk(S, K, T, rb, rq, vol, call):
    """Garman-Kohlhagen premium in quote currency per unit of base."""
    d1 = (math.log(S / K) + (rq - rb + 0.5 * vol * vol) * T) / (vol * math.sqrt(T))
    d2 = d1 - vol * math.sqrt(T)
    if call:
        return S * math.exp(-rb * T) * N(d1) - K * math.exp(-rq * T) * N(d2)
    return K * math.exp(-rq * T) * N(-d2) - S * math.exp(-rb * T) * N(-d1)


def row(pair, call, K, days, vol, t_ex, size=10e6, prem_in_base=False, capped=False, rounded=False, world=None):
    """One DTCC row. Leg 2 = Leg 1 x strike exactly; the call and put amounts may be rounded, as in the real file."""
    S, rb, rq = world or WORLD[pair]
    base, quote = pair[:3], pair[3:]
    exp = (t_ex + dt.timedelta(days=days)).date()
    T = (dt.datetime(exp.year, exp.month, exp.day, 15, tzinfo=dt.timezone.utc) - t_ex).total_seconds() / (365 * 86400.0)
    prem = gk(S, K, T, rb, rq, vol, call) * size
    if prem_in_base:
        prem /= S
    amt = f"{round(size, -6):.0f}" if rounded else f"{size:.2f}"
    return {
        "Action type": "NEWT", "Event type": "TRAD", "UPI FISN": f"NA/O Van {'Call' if call else 'Put'} {base} {quote}",
        "Notional amount-Leg 1": f"{size:,.2f}" + ("+" if capped else ""), "Notional currency-Leg 1": base,
        "Notional amount-Leg 2": f"{size * K:,.4f}", "Notional currency-Leg 2": quote,
        "Call amount": amt, "Call currency": base if call else quote,
        "Put amount": amt, "Put currency": quote if call else base,
        "Option Premium Amount": f"{prem:.6f}", "Option Premium Currency": base if prem_in_base else quote,
        "Execution Timestamp": t_ex.strftime("%Y-%m-%dT%H:%M:%SZ"), "Expiration Date": exp.isoformat(),
    }, T


def strike_for_delta(S, T, rb, rq, vol, delta):
    """The strike whose forward delta is `delta` (+ for a call, - for a put)."""
    F = S * math.exp((rq - rb) * T)
    lo, hi = 0.5 * F, 2.0 * F
    for _ in range(80):
        K = 0.5 * (lo + hi)
        d1 = (math.log(F / K) + 0.5 * vol * vol * T) / (vol * math.sqrt(T))
        d = N(d1) if delta > 0 else N(d1) - 1
        if d > delta:
            lo = K
        else:
            hi = K
    return K


def prints(pair, rows):
    base, quote = pair[:3], pair[3:]
    return [p for p in (mp.iv_print(r, base, quote) for r in rows) if p]


t0 = dt.datetime(2026, 11, 9, 13, 0, tzinfo=dt.timezone.utc)
day = {}

print("1. straddles give back the vol and the forward drift, in either premium currency, at short and long tenors")
cases = {"EURUSD": (0.070, False), "USDJPY": (0.095, True), "EURGBP": (0.052, False), "USDKRW": (0.104, True)}
tenors = (7, 30, 91, 182, 365)
for pair, (vol, in_base) in cases.items():
    S, rb, rq = WORLD[pair]
    rows = []
    for i, days in enumerate(tenors):
        t = t0 + dt.timedelta(minutes=7 * i)
        K = round(S * math.exp((rq - rb) * days / 365.0), 4 if S < 10 else 2)  # near the forward
        for call, lag in ((True, 0), (False, 20)):
            rows.append(row(pair, call, K, days, vol, t + dt.timedelta(seconds=lag), prem_in_base=in_base, rounded=True)[0])
    day[pair] = prints(pair, rows)
    check(f"{pair} prints parsed", len(day[pair]), 2 * len(tenors), 0)
# the sterling rate for EURGBP comes from the GBPUSD straddles' drift
S, rb, rq = GBPUSD
day["GBPUSD"] = prints("GBPUSD", [row("GBPUSD", call, round(S * math.exp((rq - rb) * d / 365.0), 4), d, 0.06,
                                      t0 + dt.timedelta(minutes=m, seconds=lag), world=GBPUSD)[0]
                                  for m, d in enumerate((30, 60, 91)) for call, lag in ((True, 0), (False, 10))])
WORLD["GBPUSD"] = GBPUSD
obs = mp.iv_observe({"2026-11-09": day}, [])
for pair, (vol, _) in cases.items():
    S, rb, rq = WORLD[pair]
    s_rows = sorted((r for r in obs if r[1] == pair and r[3] == "S"), key=lambda r: r[2])
    f_rows = [r for r in obs if r[1] == pair and r[3] == "F"]
    check(f"{pair} straddles found", len(s_rows), len(tenors), 0)
    for r in s_rows:
        check(f"{pair} {r[2]:.0f}d straddle vol", r[5], vol, 2e-5)
    for r in f_rows:
        check(f"{pair} {r[2]:.0f}d forward drift", r[5], rq - rb, 6e-4)

print("2. single prints off the parity forward give back a smile: wing vols and deltas")
for pair, in_base in (("USDJPY", True), ("EURUSD", False)):
    S, rb, rq = WORLD[pair]
    rows, want = [], []
    for i, (delta, vol) in enumerate(((0.25, 0.085), (-0.25, 0.105), (0.50, 0.095), (0.10, 0.09), (-0.35, 0.10))):
        days = 60
        t = t0 + dt.timedelta(hours=2, minutes=11 * i)
        exp = (t + dt.timedelta(days=days)).date()
        T = (dt.datetime(exp.year, exp.month, exp.day, 15, tzinfo=dt.timezone.utc) - t).total_seconds() / (365 * 86400.0)
        K = strike_for_delta(S, T, rb, rq, vol, delta)
        rows.append(row(pair, delta > 0, K, days, vol, t, prem_in_base=in_base)[0])
        want.append((delta, vol))
    day2 = dict(day)
    day2[pair] = day[pair] + prints(pair, rows)
    got = sorted((r for r in mp.iv_observe({"2026-11-09": day2}, []) if r[1] == pair and r[3] in "CP"), key=lambda r: r[4])
    check(f"{pair} single prints found", len(got), len(want), 0)
    for (delta, vol), r in zip(sorted(want), got):
        check(f"{pair} {delta:+.2f} delta vol", r[5], vol, 3e-5)
        check(f"{pair} {delta:+.2f} delta", r[4], delta, 2e-3)

print("3. bad rows: a capped size is skipped, a trade reported twice counts once, a lone leg is not a straddle")
S, rb, rq = WORLD["EURUSD"]
a = row("EURUSD", True, 1.1719, 30, 0.07, t0)[0]
b = row("EURUSD", False, 1.1719, 30, 0.07, t0 + dt.timedelta(seconds=5))[0]
capped = row("EURUSD", True, 1.1719, 30, 0.07, t0, capped=True)[0]
far_put = row("EURUSD", False, 1.1719, 30, 0.07, t0 + dt.timedelta(seconds=500))[0]
check("capped row skipped", len(prints("EURUSD", [capped])), 0, 0)
base3 = {"EURUSD": prints("EURUSD", [a, a, b, b] + [row("EURUSD", c, 1.1719, d, 0.07, t0 + dt.timedelta(minutes=m, seconds=5 * (not c)))[0]
                                                    for m, d in ((3, 60), (6, 91)) for c in (True, False)])}
o3 = mp.iv_observe({"2026-11-09": base3}, [])
check("duplicate straddle counted once", len([r for r in o3 if r[3] == "S"]), 3, 0)
o3b = mp.iv_observe({"2026-11-09": {"EURUSD": prints("EURUSD", [a, far_put])}}, [])
check("legs 500 seconds apart are not a straddle", len([r for r in o3b if r[3] == "S"]), 0, 0)
check("and are priced as two single prints", len([r for r in o3b if r[3] in "CP"]), 2, 0)

print("4. the table: levels, the risk reversal, and a star only on a change beyond two standard errors")
hist = []
dates = [f"2026-10-{d:02d}" for d in (27, 28, 29, 30)] + [f"2026-11-{d:02d}" for d in (2, 3, 4, 5, 6, 9)]
for k, iso in enumerate(dates):
    lvl = 0.090 if k < 5 else 0.100                       # 1M ATM steps up a full vol between the two windows
    for j in range(8):
        wob = (j - 3.5) * 0.0004                          # prints scatter 0.3 vol around the level
        hist.append([iso, "USDJPY", 30, "S", 0.0, round(lvl + wob, 5)])
        hist.append([iso, "USDJPY", 60, "C", 0.25, round(0.090 + wob, 5)])
        hist.append([iso, "USDJPY", 60, "P", -0.25, round(0.110 + wob, 5)])
        hist.append([iso, "EURUSD", 30, "S", 0.0, round(0.070 + wob + (0.0002 if k >= 5 else 0.0), 5)])
        hist.append([iso, "USDKRW", 30, "S", 0.0, round(0.104 + wob, 5)])
    for j in range(4):
        hist.append([iso, "USDJPY", 30, "F", 0.0, -0.03])
    hist.append([iso, "-", 0, "D", 0, 0])
mp.RVOL.clear(); mp.RVOL["USDJPY"] = 8.0
lines = {l.split(" | ")[0]: l for l in mp.iv_table(hist)[1:]}
jpy, eur, krw = lines.get("USDJPY", ""), lines.get("EURUSD", ""), lines.get("USDKRW [5d]", "")
print("   " + jpy); print("   " + eur); print("   " + krw)
for name, ok in (
    ("USDJPY 1M level 10.0", "1M 10.0 ±" in jpy),
    ("USDJPY forward drift printed", "fwd -3.0%/y (40 straddles)" in jpy),
    ("USDJPY 5-day change starred", "5d on prior 5d +1.00*" in jpy),
    ("USDJPY risk reversal -2.00", "RR25 -2.00 ±" in jpy and "(40c/40p)" in jpy),
    ("USDJPY risk reversal change not starred", ", chg +0.00 |" in jpy or jpy.rstrip().endswith(", chg +0.00") or ", chg -0.00" in jpy),
    ("USDJPY implied less realised", "1M less 20d realised +2.0" in jpy),
    ("EURUSD small change carries no star", "5d on prior 5d +0.02" in eur and "+0.02*" not in eur),
    ("EURUSD without straddle drift says so", "fwd = spot assumed" in eur),
    ("USDKRW pooled over five days", "1M 10.4" in krw and "(40)" in krw),
    ("USDKRW prints no one-day change", "1d " not in krw),
):
    if not ok:
        fails.append(name)
    print(f"  {'ok  ' if ok else 'FAIL'} {name}")

print("5. the history file: a day is observed once, twelve days are kept")
with tempfile.TemporaryDirectory() as tmp:
    mp.iv_update(tmp, {"2026-11-09": day})
    n1 = sum(1 for _ in open(os.path.join(tmp, "dtcc_iv_obs.csv")))
    mp.iv_update(tmp, {"2026-11-09": day})
    n2 = sum(1 for _ in open(os.path.join(tmp, "dtcc_iv_obs.csv")))
    check("second run of the same day adds nothing", n2, n1, 0)
    for k in range(1, 15):
        d = (dt.date(2026, 11, 9) + dt.timedelta(days=k)).isoformat()
        mp.iv_update(tmp, {d: {"EURUSD": day["EURUSD"]}})
    kept = {l.split(",")[0] for l in list(open(os.path.join(tmp, "dtcc_iv_obs.csv")))[1:]}
    check("days kept", len(kept), mp.IV_KEEP, 0)
    check("an empty day still leaves its marker", len([1 for l in open(os.path.join(tmp, "dtcc_iv_obs.csv")) if ",D," in l]), mp.IV_KEEP, 0)


# ---------------------------------------------------------------- the intraday files
FIELDS = ["Dissemination Identifier", "Strike Price", "Strike price currency/currency pair"] + list(row("EURUSD", True, 1.17, 30, 0.07, t0)[0])
_ids = iter(range(1, 10 ** 9))


def straddles(day, n, hour=13, ident=True):
    """n EURUSD one-month straddles dealt on `day` (a date): 2n option rows, each with its own dissemination id."""
    out = []
    t = dt.datetime(day.year, day.month, day.day, hour, 0, tzinfo=dt.timezone.utc)
    for i in range(n):
        for call in (True, False):
            r = row("EURUSD", call, 1.1719, 30, 0.07, t + dt.timedelta(minutes=7 * i, seconds=5 * (not call)))[0]
            r["Dissemination Identifier"] = str(next(_ids)) if ident else ""
            out.append(r)
    return out


def zipped(rows):
    text = io.StringIO()
    w = csv.DictWriter(text, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    blob = io.BytesIO()
    with zipfile.ZipFile(blob, "w") as z:
        z.writestr("day.csv", text.getvalue())
    return blob.getvalue()


class Net:
    """Stands in for marketpack.get: full-day files in .full[iso], intraday files in .files[iso] (a list, file 1 first).
    The list of intraday files names only the newest two of a day, as when the older ones have left its 24 hours."""
    def __init__(self):
        self.full, self.files, self.broken, self.asked = {}, {}, set(), []

    def __call__(self, url, timeout=30, tries=3):
        self.asked.append(url)
        if url.endswith("/general/bucketname"):
            return b"made-up-bucket"
        if url.endswith("dashboard/Slice.json"):
            lst = [{"fileName": f"CFTC_SLICE_FOREX_{iso.replace('-', '_')}_{n}.zip", "endTs": f"{iso}T22:{40 + n:02d}:09Z"}
                   for iso, fs in self.files.items() for n in range(max(1, len(fs) - 1), len(fs) + 1)]
            return json.dumps({"CFTC_FX": lst, "CFTC_IR": [{"fileName": "CFTC_SLICE_RATES_2026_11_10_999.zip"}]}).encode()
        m = re.search(r"/report/cumulative/cftc/CFTC_CUMULATIVE_FOREX_(\d{4})_(\d\d)_(\d\d)\.zip$", url)
        if m:
            iso = "-".join(m.groups())
            if iso in self.broken:
                raise TimeoutError(iso)
            if iso not in self.full:
                raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
            return zipped(self.full[iso])
        m = re.search(r"^https://made-up-bucket\.s3\.amazonaws\.com/cftc/slices/CFTC_SLICE_FOREX_(\d{4})_(\d\d)_(\d\d)_(\d+)\.zip$", url)
        if m:
            iso, n = "-".join(m.groups()[:3]), int(m.group(4))
            if (iso, n) in self.broken:
                raise TimeoutError(url)
            return zipped(self.files[iso][n - 1])
        raise AssertionError("unexpected address " + url)


def at(y, mo, d, h, mi):
    mp.NOW = dt.datetime(y, mo, d, h, mi, tzinfo=dt.timezone.utc)


def stored(tmp, name="dtcc_daily.csv"):
    return list(csv.DictReader(open(os.path.join(tmp, name))))


def trades(tmp, iso):
    return sum(int(r["n"]) for r in stored(tmp) if r["date"] == iso and r["kind"] == "opt" and r["key"] == "EURUSD")


def marks(tmp):
    return {r["date"]: r["key"] for r in stored(tmp) if r["kind"] == "part"}


real_get, real_now = mp.get, mp.NOW
net = Net()
mp.get = net
D10, D11, D12, D13 = (dt.date(2026, 11, k) for k in (10, 11, 12, 13))
d = dt.date(2026, 10, 1)
while d < D10:  # every earlier business day has its full-day file
    if d.weekday() < 5:
        net.full[d.isoformat()] = straddles(d, 3)
    d += dt.timedelta(days=1)

print("6. the intraday files: read in order, a repeated row counted once, every file needed")
a, b, c = straddles(D10, 2, 3), straddles(D10, 3, 14), straddles(D10, 1, 21)
net.files["2026-11-10"] = [a, b + [a[0]], c, [], straddles(D10, 1, 22, ident=False) * 2]
got, cut, n_files = mp.dtcc_slices(D10)
got = list(got)
check("files read, by number from 1 though the list names only the last two", n_files, 5, 0)
flag("the end time of the newest file", cut == "22:45Z")
check("rows: twelve with an id once each, four without an id all kept", len(got), 16, 0)
flag("in the order of the files", [r["Execution Timestamp"][11:13] for r in got] == ["03"] * 4 + ["14"] * 6 + ["21"] * 2 + ["22"] * 4)
flag("the bucket named by the service is the one read", any("made-up-bucket.s3.amazonaws.com/dashboard/Slice.json" in u for u in net.asked))
net.broken.add(("2026-11-10", 3))
try:
    mp.dtcc_slices(D10); flag("a missing file stops the day", False)
except TimeoutError:
    flag("a missing file stops the day", True)
net.broken.clear()
try:
    mp.dtcc_slices(dt.date(2026, 11, 20)); flag("a day with no file listed is refused", False)
except ValueError:
    flag("a day with no file listed is refused", True)

print("7. the day that is ending comes from the intraday files; the full-day file replaces it at the next build")
with tempfile.TemporaryDirectory() as tmp:
    net.files["2026-11-10"] = [straddles(D10, 2, 3), straddles(D10, 3, 14), straddles(D10, 1, 21)]
    at(2026, 11, 10, 22, 52)
    net.asked.clear()
    out, last = mp.section_d(tmp)
    text = "\n".join(out)
    flag("first build: the latest day is the day that is ending", last == "2026-11-10")
    flag("its line says where it runs to", "Latest DTCC day: 2026-11-10 (UTC day to 22:43Z, from the intraday files" in text)
    flag("no fetch error is printed", "fetch errors" not in text)
    flag("the full-day file of an unfinished day is not asked for", not any("CUMULATIVE_FOREX_2026_11_10" in u for u in net.asked))
    check("option trades stored for the day", trades(tmp, "2026-11-10"), 12, 0)
    flag("the day is marked as read from the intraday files", marks(tmp) == {"2026-11-10": "22:43Z"})
    flag("the vol table runs to the same time", "prints to 2026-11-10 22:43Z" in text)
    obs10 = [r for r in stored(tmp, "dtcc_iv_obs.csv") if r["date"] == "2026-11-10" and r["kind"] == "S"]
    check("straddles observed on the day", len(obs10), 6, 0)

    net.full["2026-11-10"] = sum(net.files["2026-11-10"], []) + straddles(D10, 2, 23)  # two more dealt in the last hour
    net.files["2026-11-11"] = [straddles(D11, 4, 9), straddles(D11, 1, 20)]
    at(2026, 11, 11, 22, 52)
    out, last = mp.section_d(tmp)
    text = "\n".join(out)
    flag("second build: the latest day moves on", last == "2026-11-11" and "prints to 2026-11-11 22:42Z" in text)
    check("the earlier day now holds its full-day file", trades(tmp, "2026-11-10"), 16, 0)
    flag("only the new day is marked", marks(tmp) == {"2026-11-11": "22:42Z"})
    obs = stored(tmp, "dtcc_iv_obs.csv")
    check("the earlier day's straddles are replaced, not added to", len([r for r in obs if r["date"] == "2026-11-10" and r["kind"] == "S"]), 8, 0)
    check("one marker row for the earlier day", len([r for r in obs if r["date"] == "2026-11-10" and r["kind"] == "D"]), 1, 0)
    check("one day row for the earlier day", len([r for r in stored(tmp) if r["date"] == "2026-11-10" and r["kind"] == "day"]), 1, 0)

    net.full["2026-11-11"] = sum(net.files["2026-11-11"], [])
    at(2026, 11, 12, 8, 0)  # a build in the Asian afternoon: the new UTC day is young
    net.asked.clear()
    out, last = mp.section_d(tmp)
    text = "\n".join(out)
    flag("a young day is left out without an error", last == "2026-11-11" and "fetch errors" not in text and not marks(tmp))
    flag("and none of its files is asked for", not any("2026_11_12" in u for u in net.asked))
    flag("the line names the full-day file", "Latest DTCC day: 2026-11-11 (UTC day, full-day file)" in text)

    net.files["2026-11-12"] = [straddles(D12, 5, 10), straddles(D12, 1, 20)]
    net.broken.add(("2026-11-12", 1))
    at(2026, 11, 12, 22, 52)
    out, last = mp.section_d(tmp)
    text = "\n".join(out)
    flag("intraday files that fail leave the last full day, with the error printed",
         last == "2026-11-11" and "fetch errors: 2026-11-12 TimeoutError" in text and not marks(tmp))
    net.broken.clear()
    at(2026, 11, 12, 23, 5)
    out, last = mp.section_d(tmp)
    flag("a later build the same evening picks the day up", last == "2026-11-12" and marks(tmp) == {"2026-11-12": "22:42Z"})

    net.files["2026-11-13"] = [straddles(D13, 2, 10)]
    net.broken.add("2026-11-12")  # its full-day file cannot be read at the next build
    at(2026, 11, 13, 22, 52)
    out, last = mp.section_d(tmp)
    text = "\n".join(out)
    flag("a day whose full-day file fails keeps what the intraday files gave",
         trades(tmp, "2026-11-12") == 12 and marks(tmp) == {"2026-11-12": "22:42Z", "2026-11-13": "22:41Z"} and last == "2026-11-13")
    flag("and the failure is printed", "fetch errors: 2026-11-12 TimeoutError" in text)
    net.broken.clear()

    net.full["2026-11-12"] = sum(net.files["2026-11-12"], [])
    at(2026, 11, 14, 0, 5)  # Saturday, minutes after midnight UTC: Friday is over, its full-day file is not out
    out, last = mp.section_d(tmp)
    flag("just after midnight the finished day still comes from its intraday files",
         last == "2026-11-13" and marks(tmp) == {"2026-11-13": "22:41Z"} and trades(tmp, "2026-11-12") == 12)
    net.full["2026-11-13"] = sum(net.files["2026-11-13"], [])
    at(2026, 11, 15, 22, 52)  # Sunday evening UTC, the Monday morning build
    out, last = mp.section_d(tmp)
    flag("after a weekend every day is from its full-day file", last == "2026-11-13" and not marks(tmp)
         and "Latest DTCC day: 2026-11-13 (UTC day, full-day file)" in "\n".join(out))
mp.get, mp.NOW = real_get, real_now

print("FAILED: " + "; ".join(fails) if fails else "test_marketpack_iv: all checks passed")
sys.exit(1 if fails else 0)
