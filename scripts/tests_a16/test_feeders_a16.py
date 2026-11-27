"""Our own checks for the Astra A16 feeder findings (run: python3 test_feeders_a16.py [scripts_root]).
Each check failed on main at 20ada43 and passes after the fix. No network (Yahoo is faked)."""
import datetime as dt, importlib.util, json, math, os, sys, tempfile

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


sc = load("scanner/scanner.py")


# PY01: a report in a holiday week is published a business day late; its forward move starts after that.
def cftc_holiday_week():
    first = dt.date(2021, 1, 5)
    last = first + dt.timedelta(weeks=156)              # Tue 2 Jan 2024; New Year's Day Mon 1 Jan -> out Mon 8 Jan
    cache = {"t:F:g": {(first + dt.timedelta(weeks=i)).isoformat(): (i, 10) for i in range(157)}}
    days = [last + dt.timedelta(days=i) for i in range(40)]
    days = [d for d in days if d.weekday() < 5]
    closes = [100 * math.exp(0.01 * i * i / 10) for i in range(len(days))]  # convex, so each start gives its own move
    series = {"px": {"kind": "px", "rows": [(d.isoformat(), c, c, c) for d, c in zip(days, closes)]}}
    old = sc.CFTC
    try:
        sc.CFTC = [("fixture", "t", "F", "g", "px", 1)]
        b = sc.cftc_scan(cache, series)[0]["br"][1][5]
    finally:
        sc.CFTC = old
    j = [d.isoformat() for d in days].index("2024-01-09")  # first session after Monday's publication
    want = sc.fwd("px", closes, j, 5)
    return b["n"] == 1 and abs(b["med"] - want) < 1e-12
check("PY01 CFTC move starts after the holiday-delayed release (old: Monday, the publication day)", cftc_holiday_week)
check("PY01 release dates: plain week Fri, Thanksgiving week Mon, shutdown window unknown",
      lambda: sc.cftc_release("2026-11-17") == dt.date(2026, 11, 20) and sc.cftc_release("2026-11-24") == dt.date(2026, 11, 30)
      and sc.cftc_release("2025-10-07") is None)


# PY02: Yahoo stamps a Tokyo bar at 00:00 JST (15:00 UTC the day before); its session date is the Tokyo date.
def tokyo_dates():
    ts = [int(dt.datetime(2026, 11, d, 15, 0, tzinfo=dt.timezone.utc).timestamp()) for d in (18, 19)]  # Thu 19, Fri 20 JST
    body = {"chart": {"result": [{"meta": {"exchangeTimezoneName": "Asia/Tokyo", "currentTradingPeriod": {"regular": {}}},
                                  "timestamp": ts, "indicators": {"quote": [{"close": [1.0, 2.0], "high": [1.0, 2.0], "low": [1.0, 2.0]}]}}]}}
    real = sc.get
    sc.get = lambda url, **k: json.dumps(body)
    try:
        rows = sc.yahoo_bars("^N225", "3mo")
    finally:
        sc.get = real
    return [r[0] for r in rows] == ["2026-11-19", "2026-11-20"]
check("PY02 Tokyo bars carry the Tokyo session date (old: the UTC date, a day early)", tokyo_dates)


def rebuild_once():
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "history"))
        sc.write_cache(sc.cache_path(d, sc.ASSETS[0][0]), [("2026-01-01", 1.0, 1.0, 1.0)] * 600)
        seen = []
        real_y, real_f, real_s = sc.yahoo_bars, sc.fred_bars, sc.time.sleep
        rows = [((dt.date(2026, 11, 1) - dt.timedelta(days=i)).isoformat(), 1.0, 1.0, 1.0) for i in range(700)]
        sc.yahoo_bars = sc.fred_bars = lambda sym, rng: seen.append(rng) or rows
        sc.time.sleep = lambda s: None
        real_n, sc.note = sc.note, lambda s: None
        try:
            sc.load_history(d, fetch=True)
            first = seen[0]
            seen.clear()
            sc.load_history(d, fetch=True)
            return first == "15y" and seen[0] == "3mo" and os.path.exists(os.path.join(d, "history", sc.VENUE_DATES_MARK))
        finally:
            sc.yahoo_bars, sc.fred_bars, sc.time.sleep, sc.note = real_y, real_f, real_s, real_n
check("PY02 caches written with UTC dates are rebuilt once in full", rebuild_once)

mp = load("marketpack/marketpack.py")


# PY03: a tenor thin on the previous report day has no 1d change (it read the change from two days back).
def swap_same_days():
    days = ["2026-11-23", "2026-11-24", "2026-11-25"]
    sr = {"2026-11-23": (2.00, "DTCC n=5"), "2026-11-25": (2.00, "DTCC n=5")}  # 24th thin, removed by the 3+ filter
    return mp._sess_chg(days, sr, "2026-11-25", 1) is None and mp._sess_chg(days, sr, "2026-11-25", 2) == 0.0
check("PY03 swap 1d change uses the index's previous report day", swap_same_days)


# PY05: a backfilled print is discounted at the bill yield known before its day, not the run's.
def usd_rate_dated():
    mp.USD_RATE[:] = [0.09]
    mp.IRX_HIST = {"2026-01-05": 0.03, "2026-01-06": 0.031, "2026-11-26": 0.09}
    a = mp.usd_rate_before("2026-01-07")
    mp.IRX_HIST["2026-11-27"] = 0.12  # a later quote changes nothing for January
    return a == 0.031 and mp.usd_rate_before("2026-01-07") == 0.031
check("PY05 IV backfill discounts at the prior day's bill yield", usd_rate_dated)

bt = load("transcribe/backtest.py")
check("PY04 '.37' does not confirm a claimed 37 (1.37 and 37 behave as before)",
      lambda: not bt.found(["37"], "rates rose .37 today") and not bt.found(["37"], "up 1.37") and bt.found(["37"], "up 37 bp"))

print(f"\n{len(fails)} failed" if fails else "\nall passed")
sys.exit(1 if fails else 0)
