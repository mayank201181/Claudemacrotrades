"""Cross-check fxopt.py against QuantLib-Python (pip install QuantLib). Run: python3 -I test_fxopt.py"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import QuantLib as ql
import fxopt

today = ql.Date(26, 10, 2026)
ql.Settings.instance().evaluationDate = today
dc = ql.Actual365Fixed()
CASES = [  # pair, spot, rd (terms), rf (base), vol, days
    ('USDJPY', 150.2, 0.008, 0.040, 0.095, 30),
    ('EURUSD', 1.172, 0.040, 0.020, 0.070, 60),
    ('AUDUSD', 0.658, 0.040, 0.035, 0.110, 14),
    ('USDKRW', 1395.0, 0.025, 0.040, 0.080, 90),
    ('USDCNH', 7.12, 0.015, 0.040, 0.040, 180),
]
worst = {}

def rec(key, mine, ql_, scale=1.0):
    d = abs(mine - ql_) / scale
    worst[key] = max(worst.get(key, 0.0), d)

def process(S, rd, rf, vol):
    return ql.BlackScholesMertonProcess(
        ql.QuoteHandle(ql.SimpleQuote(S)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, rf, dc, ql.Continuous)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, rd, dc, ql.Continuous)),
        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), vol, dc)))

for pair, S, rd, rf, vol, days in CASES:
    T = days / 365.0
    ex = today + days
    m = fxopt.Mkt(S, T, rd, rf)
    p = process(S, rd, rf, vol)
    dfd, dff = math.exp(-rd * T), math.exp(-rf * T)
    def euro(payoff):
        o = ql.VanillaOption(payoff, ql.EuropeanExercise(ex)); o.setPricingEngine(ql.AnalyticEuropeanEngine(p)); return o.NPV()
    def amer(payoff, at_expiry):
        o = ql.VanillaOption(payoff, ql.AmericanExercise(today, ex, at_expiry)); o.setPricingEngine(ql.AnalyticDigitalAmericanEngine(p)); return o.NPV()
    for mny in (0.95, 0.98, 1.0, 1.02, 1.05):
        K = S * mny
        for phi, typ in ((1, ql.Option.Call), (-1, ql.Option.Put)):
            rec('vanilla', m.vanilla(phi, K, vol), euro(ql.PlainVanillaPayoff(typ, K)), S)
            rec('digital terms', m.digital(phi, K, vol, 'terms'), euro(ql.CashOrNothingPayoff(typ, K, 1.0)))
            rec('digital base', m.digital(phi, K, vol, 'base'), euro(ql.AssetOrNothingPayoff(typ, K)) / S)
        if mny != 1.0:
            typ = ql.Option.Call if K > S else ql.Option.Put
            rec('one-touch at expiry, terms', m.one_touch(K, vol, 'terms', 'expiry'), amer(ql.CashOrNothingPayoff(typ, K, 1.0), True))
            rec('one-touch at expiry, base', m.one_touch(K, vol, 'base', 'expiry'), amer(ql.AssetOrNothingPayoff(typ, K), True) / S)
            rec('one-touch at hit, terms', m.one_touch(K, vol, 'terms', 'hit'), amer(ql.CashOrNothingPayoff(typ, K, 1.0), False))
    # barriers
    for phi, typ in ((1, ql.Option.Call), (-1, ql.Option.Put)):
        for kk in (0.97, 1.0, 1.03):
            K = S * kk
            for H, bts in ((S * 1.04, ('up_out', 'up_in')), (S * 0.96, ('down_out', 'down_in'))):
                for bt in bts:
                    qbt = {'up_out': ql.Barrier.UpOut, 'up_in': ql.Barrier.UpIn, 'down_out': ql.Barrier.DownOut, 'down_in': ql.Barrier.DownIn}[bt]
                    o = ql.BarrierOption(qbt, H, 0.0, ql.PlainVanillaPayoff(typ, K), ql.EuropeanExercise(ex))
                    o.setPricingEngine(ql.AnalyticBarrierEngine(p))
                    rec('barrier', m.barrier(phi, K, H, bt, vol), o.NPV(), S)
    # delta conventions and strike from delta
    for kind, qk in (('spot', ql.DeltaVolQuote.Spot), ('fwd', ql.DeltaVolQuote.Fwd), ('spot_pa', ql.DeltaVolQuote.PaSpot), ('fwd_pa', ql.DeltaVolQuote.PaFwd)):
        for phi, typ, d in ((1, ql.Option.Call, 0.25), (-1, ql.Option.Put, -0.25)):
            calc = ql.BlackDeltaCalculator(typ, qk, S, dfd, dff, vol * math.sqrt(T))
            rec('strike from delta ' + kind, m.strike_from_delta(phi, d, vol, kind), calc.strikeFromDelta(d), S)
            K = S * 1.01
            rec('delta ' + kind, m.delta(phi, K, vol, kind), calc.deltaFromStrike(K))
        calc = ql.BlackDeltaCalculator(ql.Option.Call, qk, S, dfd, dff, vol * math.sqrt(T))
        rec('ATM DNS strike', m.atm_strike(vol, 'dns', kind.endswith('_pa')), calc.atmStrike(ql.DeltaVolQuote.AtmDeltaNeutral), S)
    # vanna-volga barrier vs QuantLib's VannaVolgaBarrierEngine (spot, fwd and premium-adjusted spot deltas, ATM DNS)
    atm, rr, bf = vol, -0.012, 0.003
    for kind, qk in (('spot', ql.DeltaVolQuote.Spot), ('fwd', ql.DeltaVolQuote.Fwd), ('spot_pa', ql.DeltaVolQuote.PaSpot)):
        sm = fxopt.Smile(m, atm, rr, bf, kind, 'dns')
        hq = lambda v, d: ql.DeltaVolQuoteHandle(ql.DeltaVolQuote(d, ql.QuoteHandle(ql.SimpleQuote(v)), T, qk))
        atmq = ql.DeltaVolQuoteHandle(ql.DeltaVolQuote(ql.QuoteHandle(ql.SimpleQuote(atm)), qk, T, ql.DeltaVolQuote.AtmDeltaNeutral))
        eng = ql.VannaVolgaBarrierEngine(atmq, hq(sm.vp, -0.25), hq(sm.vc, 0.25), ql.QuoteHandle(ql.SimpleQuote(S)),
            ql.YieldTermStructureHandle(ql.FlatForward(today, rd, dc, ql.Continuous)),
            ql.YieldTermStructureHandle(ql.FlatForward(today, rf, dc, ql.Continuous)))
        for phi, typ in ((1, ql.Option.Call), (-1, ql.Option.Put)):
            for kk in (0.98, 1.0, 1.02):
                K = S * kk
                for H, bts in ((S * 1.05, ('up_out', 'up_in')), (S * 0.95, ('down_out', 'down_in'))):
                    for bt in bts:
                        qbt = {'up_out': ql.Barrier.UpOut, 'up_in': ql.Barrier.UpIn, 'down_out': ql.Barrier.DownOut, 'down_in': ql.Barrier.DownIn}[bt]
                        o = ql.BarrierOption(qbt, H, 0.0, ql.PlainVanillaPayoff(typ, K), ql.EuropeanExercise(ex))
                        o.setPricingEngine(eng)
                        van = m.vanilla(phi, K, sm.vol(K))
                        rec('vanna-volga barrier', sm.vv_barrier(phi, K, H, bt, van), o.NPV(), S)

# a flat smile (rr = bf = 0) must give back plain Garman-Kohlhagen digitals in both pay currencies
for pay in ('terms', 'base'):
    for t in ('digital_call', 'digital_put'):
        a = fxopt.price(dict(pair='EURUSD', type=t, strike=1.19, spot=1.172, days=60, rd=4, rf=2, atm=7, rr25=0, bf25=0, pay=pay))['price']
        b = fxopt.price(dict(pair='EURUSD', type=t, strike=1.19, spot=1.172, days=60, rd=4, rf=2, vol=7, pay=pay))['price']
        rec('flat-smile digital = GK', a, b)

print(f'QuantLib {ql.__version__}; worst absolute difference (vanilla and barrier prices as a share of spot):')
bad = False
for k, v in worst.items():
    tol = 2e-6 if k in ('vanna-volga barrier', 'flat-smile digital = GK') else 1e-9  # finite-difference bumps
    flag = 'ok' if v <= tol else 'FAIL'
    bad |= flag == 'FAIL'
    print(f'  {k:32s} {v:.2e}  {flag}')
sys.exit(1 if bad else 0)
