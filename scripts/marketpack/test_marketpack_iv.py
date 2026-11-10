"""Checks the implied-vol code of marketpack.py on synthetic DTCC rows whose vol, forward and rates are known.
Standard library only, no network. Run: python3 -I test_marketpack_iv.py
The rows are priced here with Garman-Kohlhagen written on spot and two rates, which is a different form from
the forward-and-discount-factor one the pack inverts, so a mistake in its parity or discounting shows up."""
import datetime as dt, math, os, sys, tempfile
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

print("FAILED: " + "; ".join(fails) if fails else "test_marketpack_iv: all checks passed")
sys.exit(1 if fails else 0)
