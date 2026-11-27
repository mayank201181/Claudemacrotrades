"""Our own checks for the Astra A16 re-audit findings in fxopt.py (27 Nov 2026). References are independent of
fxopt's code path: scipy quadrature of the first-passage density and the Reiner-Rubinstein formula in 50-digit
mpmath (no underflow). Run: python3 scripts/fxopt/test_audit_a16.py   (needs scipy, mpmath)"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mpmath as mp
from scipy.integrate import quad
from fxopt import Mkt, price, Smile

mp.mp.dps = 50
fails = []


def check(name, ok, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(detail)))
    if not ok:
        fails.append(name)


def fp_density(a, mu, sig, t):
    return abs(a) / math.sqrt(2 * math.pi * sig * sig * t ** 3) * math.exp(-(a - mu * t) ** 2 / (2 * sig * sig * t))


# FX16-01 (EX02 residual): hit-paid one-touch in the high-carry, low-vol, long-dated corner.
S, H, days, rd, rf, vol = 1.08, 1.33, 700, .117, .01, .031
T = days / 365
mu = rd - rf - vol * vol / 2
ref = quad(lambda t: math.exp(-rd * t) * fp_density(math.log(H / S), mu, vol, t), 0, T, epsabs=1e-14, limit=400)[0]
pv = price(dict(pair='EURUSD', type='one_touch', spot=S, barrier=H, vol=3.1, rd=11.7, rf=1.0, days=days, when='hit'))['price']
check('FX16-01 hit-paid touch = quadrature (repo gave 0.38403 vs 0.41656)', abs(pv - ref) < 1e-9, (pv, ref))


def rr_barrier_mp(phi, S, K, H, T, r, b, v, btype):
    """Reiner-Rubinstein (Haug) in mpmath; independent of fxopt's floating-point evaluation."""
    S, K, H, T, r, b, v = map(mp.mpf, (S, K, H, T, r, b, v))
    Nm = lambda x: mp.ncdf(x)
    sd = v * mp.sqrt(T)
    m_ = (b - v * v / 2) / (v * v)
    x1 = mp.log(S / K) / sd + (1 + m_) * sd
    x2 = mp.log(S / H) / sd + (1 + m_) * sd
    y1 = mp.log(H * H / (S * K)) / sd + (1 + m_) * sd
    y2 = mp.log(H / S) / sd + (1 + m_) * sd
    up = btype.startswith('up')
    eta = -1 if up else 1
    ef, ed = mp.e ** ((b - r) * T), mp.e ** (-r * T)
    A = phi * S * ef * Nm(phi * x1) - phi * K * ed * Nm(phi * x1 - phi * sd)
    B = phi * S * ef * Nm(phi * x2) - phi * K * ed * Nm(phi * x2 - phi * sd)
    C = phi * S * ef * (H / S) ** (2 * (m_ + 1)) * Nm(eta * y1) - phi * K * ed * (H / S) ** (2 * m_) * Nm(eta * y1 - eta * sd)
    D = phi * S * ef * (H / S) ** (2 * (m_ + 1)) * Nm(eta * y2) - phi * K * ed * (H / S) ** (2 * m_) * Nm(eta * y2 - eta * sd)
    assert up and phi > 0 and K < H
    return float(B - C + D) if btype == 'up_in' else float(A - B + C - D)


for bt in ('up_out', 'up_in'):
    r = price(dict(pair='EURUSD', type='call', spot=S, strike=1.0, barrier=H, barrier_type=bt, vol=3.1, rd=11.7, rf=1.0, days=days))
    ref = rr_barrier_mp(1, S, 1.0, H, T, rd, rd - rf, vol, bt)
    check(f'FX16-01 {bt} call = 50-digit closed form (missed by ~1% of notional)', abs(r['price'] - ref) / S < 1e-10, (r['price'], ref))

# FX16-02 (VAN-002 residual): 86.4 s to expiry the smile digital and exercise odds equal the smile's -dC/dK.
leg = dict(pair='EURUSD', type='put', spot=.95, strike=.95001, days=.001, rd=2.1, rf=1.9, atm=7, rr25=1.1, bf25=.3, bf_type='smile')
m = Mkt(.95, .001 / 365, .021, .019)
sm = Smile(m, .07, .011, .003, 'spot', 'dns')
K = .95001
with mp.workdps(40):
    c = lambda k: mp.mpf(m.vanilla(-1, float(k), sm.vol(float(k))))
    # Richardson from three small symmetric steps of the same smile (the stencil the finding questions is 1e-4 K)
    d = lambda h: (c(K + h) - c(K - h)) / (2 * h)
    h0 = K * 2e-7
    ref = float((4 * d(h0 / 2) - d(h0)) / 3)
pd = price(dict(leg, type='digital_put'))['price']
pe = price(leg)['p_exercise'] * m.dfd
check('FX16-02 86 s put digital = smile -dC/dK (was 56.35% vs 58.36%)', abs(pd - ref) < 2e-4, (pd, ref))
check('FX16-02 86 s discounted exercise odds = the same', abs(pe - ref) < 2e-4, (pe, ref))

# FX16-03 (EX06 residual): spot exactly at the barrier: the touch has happened, so no spot or vol sensitivity.
for typ in ('one_touch', 'no_touch'):
    for pay in ('terms', 'base'):
        for when in ('expiry', 'hit'):
            if typ == 'no_touch' and when == 'hit':
                continue
            r = price(dict(pair='EURUSD', type=typ, spot=.897, barrier=.897, days=64, rd=1.9, rf=3.1, vol=8.2, notional=1, pay=pay, when=when))
            check(f'FX16-03 {typ} {pay} {when} at the barrier: delta 0, vega 0',
                  r['delta_payccy_per_1pct'] == 0 and r['vega_per_volpt_payccy'] == 0, (r['delta_payccy_per_1pct'], r['vega_per_volpt_payccy']))

# FX16-04 (VAN-004 residual): a flat 5% quote read as a broker strangle stays 5% in the deep wing.
r = price(dict(pair='EURUSD', type='call', spot=1., strike=1.47, days=31, rd=1.6, rf=.4, atm=5., rr25=0., bf25=0.))
check('FX16-04 flat broker quote, deep wing vol = 5% (was 16.79%)', abs(r['vol'] - .05) < 1e-12, r['vol'])

print('fxopt A16 checks: ' + ('PASS' if not fails else 'FAIL ' + ', '.join(fails)))
sys.exit(1 if fails else 0)
