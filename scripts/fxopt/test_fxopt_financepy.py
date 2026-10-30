"""Second reference for fxopt's market-strangle smile: FinancePy's FXVolSurface (GPL-3, test-only, never
imported by fxopt.py). pip install financepy. Run: python3 -I test_fxopt_financepy.py

Both calibrate a smile to ATM, 25d RR and a 25d market (broker) strangle; fxopt uses vanna-volga, FinancePy
Clark's polynomial in delta, so the 25d smile vols agree to under a hundredth of a vol, not to machine
precision. The market-strangle repricing condition itself is checked exactly."""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fxopt
from financepy.utils import Date, FrequencyTypes
from financepy.utils.global_types import VolFuncTypes, FXDeltaMethodTypes, FXATMMethodTypes
from financepy.market.curves.discount_curve_flat import DiscountCurveFlat
from financepy.market.volatility.fx_vol_surface import FXVolSurface

vd = Date(26, 10, 2026)
CASES = [  # pair, spot, rd (terms), rf (base), tenor, atm, rr25, ms25 (percent), delta convention
    ('EURUSD', 1.172, 4.0, 2.0, '3M', 7.0, 0.4, 0.20, 'spot'),
    ('AUDUSD', 0.658, 4.0, 3.5, '1M', 11.0, -1.2, 0.35, 'spot'),
    ('USDJPY', 150.2, 0.8, 4.0, '3M', 9.5, -1.6, 0.30, 'spot_pa'),
    ('EURJPY', 176.0, 0.8, 2.0, '2M', 8.5, -1.4, 0.28, 'spot'),  # FinancePy's optimiser raised on USDKRW PA (objective 1e-9)
]
worst_cond, worst_vol = 0.0, 0.0
for pair, S, rd, rf, tenor, atm, rr, ms, dk in CASES:
    dcrv = DiscountCurveFlat(vd, rd / 100, FrequencyTypes.CONTINUOUS)
    fcrv = DiscountCurveFlat(vd, rf / 100, FrequencyTypes.CONTINUOUS)
    pa = dk == 'spot_pa'
    fp = FXVolSurface(vd, S, pair, pair[:3], dcrv, fcrv, [tenor], [atm], [ms], [rr],
                      FXATMMethodTypes.FWD_DELTA_NEUTRAL_PREM_ADJ if pa else FXATMMethodTypes.FWD_DELTA_NEUTRAL,
                      FXDeltaMethodTypes.SPOT_DELTA_PREM_ADJ if pa else FXDeltaMethodTypes.SPOT_DELTA,
                      VolFuncTypes.CLARK)
    T = (fp.expiry_dts[0] - vd) / 365.0
    m = fxopt.Mkt(S, T, rd / 100, rf / 100)
    sm = fxopt.market_strangle_smile(m, atm / 100, rr / 100, ms / 100, dk, 'dns')
    # the condition: the market-strangle strikes reprice on the smile
    v = (atm + ms) / 100
    kc, kp = m.strike_from_delta(1, 0.25, v, dk), m.strike_from_delta(-1, -0.25, v, dk)
    lhs = m.vanilla(1, kc, sm.vol(kc)) + m.vanilla(-1, kp, sm.vol(kp))
    rhs = m.vanilla(1, kc, v) + m.vanilla(-1, kp, v)
    worst_cond = max(worst_cond, abs(lhs - rhs) / S)
    # 25d smile vols against FinancePy's at its own smile 25d strikes
    fc, fpv = fp.volatility(float(fp.k_25d_c[0]), fp.expiry_dts[0]), fp.volatility(float(fp.k_25d_p[0]), fp.expiry_dts[0])
    worst_vol = max(worst_vol, abs(sm.vc - fc), abs(sm.vp - fpv))
    print(f'{pair} {tenor}: smile bf fxopt {100*sm.bf:.4f}% vs input ms {ms:.4f}%; 25d call {100*sm.vc:.4f} / FinancePy {100*fc:.4f};'
          f' 25d put {100*sm.vp:.4f} / FinancePy {100*fpv:.4f}')
print(f'market-strangle repricing, worst |diff| / spot: {worst_cond:.1e}')
print(f'25d smile vols vs FinancePy, worst |diff|: {100*worst_vol:.3f} vol')
assert worst_cond < 1e-9 and worst_vol < 0.0001, 'FAIL'
print('PASS')
