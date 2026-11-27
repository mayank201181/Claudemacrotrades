"""Our own checks for the Astra A14 feeder findings (run: python3 test_feeders_a14.py [scripts_root]).

Each check fails on the code before the fix and passes after it. Pure functions only, no network.
"""
import datetime as dt, importlib.util, math, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(rel):
    spec = importlib.util.spec_from_file_location(rel.replace("/", "_")[:-3], os.path.join(ROOT, rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


fails = []


def check(name, fn):
    try:
        ok = fn()
    except Exception as e:  # noqa: BLE001
        ok, why = False, f"{type(e).__name__}: {e}"
    else:
        why = ""
    print(("PASS " if ok else "FAIL ") + name + (f"  ({why})" if why else ""))
    if not ok:
        fails.append(name)


fp = load("fundpack/fundpack.py")
pm = load("predmkt/predmkt.py")
sc = load("scanner/scanner.py")
bt = load("transcribe/backtest.py")
mp = load("marketpack/marketpack.py")

# PY04 yoy_3mma: January needs Nov/Dec of the previous year, and a gap month must not be bridged.
lv = [(f"{y}-{m:02d}", 100 + i) for i, (y, m) in enumerate((y, m) for y in (2024, 2025) for m in range(1, 13))]
out = dict(fp.yoy_3mma(lv))
check("PY04 yoy_3mma Jan 2025 present", lambda: "2025-03" in out and abs(out["2025-03"] - 100 * ((114 + 113 + 112) / (102 + 101 + 100) - 1)) < 1e-9)
gap = [p for p in lv if p[0] != "2025-05"]
g = dict(fp.yoy_3mma(gap))
check("PY04 yoy_3mma does not bridge a missing month", lambda: "2025-06" not in g and "2025-07" not in g and "2025-08" in g)

# PY06 implied_median: a ladder that ends exactly at 50% has its median at that strike.
check("PY06 implied_median at an exact 50% last rung", lambda: pm.implied_median([{"strike": 4.0, "p": 0.9}, {"strike": 4.25, "p": 0.5}]) == 4.25)

# PY13 rsi_series: a flat series has no gains and no losses, RSI 50, not 100.
r = sc.rsi_series([100.0] * 30)
check("PY13 rsi flat series = 50", lambda: r[-1] == 50.0)

# PY21 merge: a cached bar dated today (an incomplete session saved earlier) is dropped unless the new fetch supplies it.
today = dt.datetime.now(dt.timezone.utc).date().isoformat()
yday = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)).isoformat()
check("PY21 merge keeps a session-checked bar for today", lambda: [x[0] for x in sc.merge([(yday, 1, 1, 1)], [(today, 2, 2, 2)])] == [yday, today])
check("PY21 merge drops a stale cached bar for today", lambda: [x[0] for x in sc.merge([(yday, 1, 1, 1), (today, 2, 2, 2)], [(yday, 1, 1, 1)])] == [yday])

# PY26 found: "25" must not match inside "25.75" or "2.25".
check("PY26 found ignores a number inside a decimal", lambda: not bt.found(["25"], "the rate is 25.75 now") and not bt.found(["25"], "cut to 2.25") and bt.found(["25"], "a 25 bp cut"))

# PY10 credit_state: NaN inputs read n/a, never "calm".
check("PY10 credit_state NaN = n/a", lambda: mp.credit_state(float("nan"), 10.0) == "n/a" and mp.credit_state(2.5, float("nan")) == "n/a")

# PY11 _rr25: emerging pairs print " [5d]" after the name, and CNY prints as USDCNH/CNY.
lines = ["USDKRW [5d] | fwd +1.0%/y (5 straddles) | ATM 1w 9.0 | RR25 -0.40 ±0.20 | BF25 0.10",
         "USDCNH/CNY [5d] | fwd = spot assumed | ATM 1w 4.0 | RR25 +0.30 ±0.10",
         "EURUSD | fwd +2.0%/y (6 straddles) | ATM 1w 7.0 | RR25 +0.20 ±0.05"]
rr = mp._rr25(lines)
check("PY11 _rr25 reads [5d] pairs", lambda: rr.get("USDKRW") == (-0.40, 0.20) and rr.get("USDCNY") == (0.30, 0.10) and rr.get("EURUSD") == (0.20, 0.05))

# PY24 seasonal tie: zero returns count as neither up nor down (checked through the source, the function needs a long series).
import inspect
src = inspect.getsource(sc.seasonal)
check("PY24 seasonal counts downs as r < 0", lambda: "r < 0" in src)

# PY03 CFTC base rate starts at the Friday release, not the Tuesday position date.
src = inspect.getsource(sc.cftc_scan)
check("PY03 cftc forward move starts after the Friday release (A16 PY01: cftc_release)",
      lambda: "cftc_release(dates[i])" in src and sc.cftc_release("2026-11-17") == dt.date(2026, 11, 20))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
