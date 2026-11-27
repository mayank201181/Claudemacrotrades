"""Our own checks for the Astra A14 audit findings fixed in fxopt.py (27 Nov 2026). Independent references
come from scipy quadrature of first-passage densities and from fxopt's own engines where both apply.
Run: python3 scripts/fxopt/test_audit_a14.py   (needs scipy)"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scipy.integrate import quad
from fxopt import Mkt, price

fails = []


def check(name, ok, detail=''):
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(detail)))
    if not ok:
        fails.append(name)


def fp_density(a, mu, sig, t):  # first passage of a drifted BM (drift mu, vol sig) from 0 to level a
    return abs(a) / math.sqrt(2 * math.pi * sig * sig * t ** 3) * math.exp(-(a - mu * t) ** 2 / (2 * sig * sig * t))


# EX01: a corridor far wider than the remaining diffusion pays almost surely
r = price(dict(pair='EURUSD', type='double_no_touch', spot=1., lower=.7, upper=1.4, vol=3., rd=10., rf=0., days=30))
check('EX01 wide-corridor DNT is the discounted payout (was 0)', abs(r['price'] - math.exp(-.1 * 30 / 365)) < 1e-10, r['price'])
# the image sum and the sine series agree where both are well conditioned (sd/Z just under and over 0.5)
Z = math.log(1.1 / 0.9)
for ratio in (0.3, 0.45, 0.6, 0.9):
    T = (ratio * Z / 0.08) ** 2
    for pay in ('terms', 'base'):
        m = Mkt(1.0, T, 0.03, 0.01)
        a, b = m.double_no_touch(0.9, 1.1, 0.08, pay, 'images'), m.double_no_touch(0.9, 1.1, 0.08, pay, 'series')
        check(f'EX01 images = series at sd/Z {ratio}, {pay} pay', abs(a - b) < 1e-10, (a, b))

# EX02: 2y 3%-vol one-touch with +10% carry, against quadrature of the hitting density
H, sig, T = 1.22, .03, 2.
mu = .1 - sig * sig / 2
ref = math.exp(-.1 * T) * quad(lambda t: fp_density(math.log(H), mu, sig, t), 0, T, epsabs=1e-13, limit=200)[0]
pv = price(dict(pair='EURUSD', type='one_touch', spot=1., barrier=H, vol=3., rd=10., rf=0., days=730))['price']
check('EX02 far-tail touch matches quadrature', abs(pv - ref) < 1e-9, (pv, ref))

# EX03: pay-at-hit at the barrier is paid now
r = price(dict(pair='EURUSD', type='one_touch', spot=1.1, barrier=1.1, vol=8, rd=4, rf=2, days=90, when='hit'))
check('EX03 pay-at-hit at its barrier is worth 1 (was discounted to expiry)', r['price'] == 1.0, r['price'])

# EX04: pay-at-hit under a negative terms rate, against quadrature of E[exp(-rd tau) 1(tau<T)]
for rd, rf, Hh, vol in ((-1., -1., 1.03, 12.), (-2., 1., 0.97, 5.)):
    s = vol / 100
    mu = (rd - rf) / 100 - s * s / 2
    ref = quad(lambda t: math.exp(-rd / 100 * t) * fp_density(math.log(Hh), mu, s, t), 0, 1, epsabs=1e-13, limit=200)[0]
    try:
        pv = price(dict(type='one_touch', pair='EURUSD', spot=1., barrier=Hh, vol=vol, rd=rd, rf=rf, days=365, when='hit'))['price']
    except Exception as e:
        pv = repr(e)
    check(f'EX04 pay-at-hit, rd {rd}%: no error, matches quadrature', isinstance(pv, float) and abs(pv - ref) < 2e-7, (pv, ref))

# EX05: a knock-in already through its barrier has touched
r = price(dict(pair='EURUSD', type='call', spot=1.25, strike=1.2, barrier=1.2, barrier_type='up_in', vol=8, rd=4, rf=2, days=90))
check('EX05 p_touch = 1 beyond the barrier', r['p_touch'] == 1.0, r['p_touch'])

# EX06: just inside an up one-touch barrier the hedge stays long spot
for h in (1.0001, 1.00005):
    v = price(dict(type='one_touch', spot=1., barrier=h, vol=10., rd=5., rf=2., days=365, notional=1.))['delta_payccy_per_1pct']
    check(f'EX06 one-touch delta keeps its sign with the barrier {h}', v > 0, v)

# EX07 / EX08
for bad in ('up_otu', 'down', None):
    try:
        price(dict(pair='EURUSD', type='call', spot=1.1, strike=1.1, barrier=1.2, barrier_type=bad, vol=8, rd=4, rf=2, days=90)); ok = False
    except ValueError:
        ok = True
    check(f'EX07 barrier_type {bad!r} is refused', ok)
try:
    price(dict(pair='EURUSD', type='call', spot=1.1, strike=1.1, barrier=1.2, barrier_type='up_out', rebate=0.001, vol=8, rd=4, rf=2, days=90)); ok = False
except ValueError:
    ok = True
check('EX08 a nonzero rebate is refused', ok)

# EX09: ATM digital delta with little time left, against the analytic GK digital delta
for days in (1, 0.01):
    leg = dict(type='digital_call', spot=1., strike=1., vol=10., rd=5., rf=2., days=days, notional=1., pay='terms')
    T = days / 365
    sd = .1 * math.sqrt(T)
    F = math.exp(.03 * T)
    d2 = (math.log(F) - .5 * sd * sd) / sd
    exact = math.exp(-.05 * T) * math.exp(-0.5 * d2 * d2) / math.sqrt(2 * math.pi) / sd * math.exp(-.02 * T) / math.exp(-.05 * T) * math.exp(-.05 * T) / F * F
    # d/dS of dfd N(d2): dfd n(d2) / (S sd); per 1% of spot with S = 1
    exact = math.exp(-.05 * T) * math.exp(-0.5 * d2 * d2) / math.sqrt(2 * math.pi) / sd * 0.01
    got = price(leg)['delta_payccy_per_1pct']
    check(f'EX09 ATM digital delta, {days} days', abs(got / exact - 1) < 1e-3, (got, exact))

# FX-UNIT-01
r = price(dict(pair='EURUSD', type='call', spot=1.1, strike=1.1, vol=8, rd=4, rf=2, days=90))
check('FX-UNIT-01 price_pips is pips', abs(r['price_pips'] - r['price_terms'] * 1e4) < 1e-9 and r['price_terms'] == r['price'])
r = price(dict(pair='USDJPY', type='call', spot=150, strike=150, vol=8, rd=0.5, rf=4, days=90))
check('FX-UNIT-01 JPY pips are 0.01', abs(r['price_pips'] - r['price'] * 100) < 1e-9)

# VAN-001: a 10-delta strike on the smile reprices to 10 delta on the same smile
for d in (0.10, -0.10, 0.25, -0.25, 0.40):
    leg = dict(pair='EURUSD', type='strike', spot=1.1, delta=d, atm=8, rr25=1.5, bf25=0.4, rd=4, rf=2, days=90)
    r = price(leg)
    c = price(dict(leg, type='call' if d > 0 else 'put', strike=r['strike']))
    check(f'VAN-001 {d:+.2f} delta strike reprices on the smile', abs(c['delta_spot'] - d) < 1e-8 and abs(c['vol'] - r['vol']) < 1e-12, (c['delta_spot'], c['vol'], r['vol']))
leg = dict(pair='USDJPY', type='strike', spot=150, delta=0.10, atm=9, rr25=-1.2, bf25=0.3, rd=0.5, rf=4, days=60)
r = price(leg)
c = price(dict(leg, type='call', strike=r['strike']))
check('VAN-001 premium-adjusted 10 delta on USDJPY', abs(c['delta_spot_pa'] - 0.10) < 1e-8, c['delta_spot_pa'])

# VAN-002: on a skewed smile p_exercise equals the engine's own terms digital, undiscounted
leg = dict(pair='EURUSD', spot=1.1, strike=1.1 * math.exp(.01 * .25), days=365 * .25, rd=3, rf=2, atm=10, rr25=-3, bf25=1, bf_type='smile')
for typ in ('call', 'put'):
    p = price(dict(leg, type=typ))['p_exercise']
    dig = price(dict(leg, type='digital_' + typ, pay='terms'))['price'] / math.exp(-.03 * .25)
    check(f'VAN-002 {typ} p_exercise = smile digital', abs(p - dig) < 1e-6, (p, dig))

# VAN-003: a wide risk reversal with a small fly calibrates (the bracket used to try negative wing vols)
try:
    r = price(dict(pair='USDBRL', type='call', spot=5.4, strike=5.6, days=30, rd=14, rf=4, atm=12, rr25=3.8, bf25=0.05)); ok = r['price'] > 0
except Exception as e:
    ok, r = False, repr(e)
check('VAN-003 market fly with a wide RR calibrates', ok, r)

# VAN-004: a flat surface gives the flat vol at a deep wing
r = price(dict(pair='EURUSD', type='call', spot=1., strike=0.5, days=30, rd=0, rf=0, atm=8, rr25=0, bf25=0, bf_type='smile'))
check('VAN-004 flat smile, half-spot strike: 8%', abs(r['vol'] - 0.08) < 1e-12, r['vol'])

# VAN-005: rf alone means zero carry
r = price(dict(pair='EURUSD', type='call', spot=1.1, strike=1.1, vol=8, rf=2, days=90))
check('VAN-005 rf alone: forward = spot', abs(r['fwd'] - 1.1) < 1e-12, r['fwd'])

# VAN-006: two-minute ATM vanilla gamma is the Black gamma
days = 2 / 1440
r = price(dict(type='call', pair='EURUSD', spot=1., strike=1., days=days, vol=3., rd=0., rf=0.))
sd = .03 * math.sqrt(days / 365)
exact = math.exp(-0.5 * (0.5 * sd) ** 2) / math.sqrt(2 * math.pi) / sd
check('VAN-006 short-dated ATM gamma is exact', abs(r['gamma_per_1pct_pct'] / exact - 1) < 1e-12, (r['gamma_per_1pct_pct'], exact))

print('fxopt A14 checks:', 'PASS' if not fails else 'FAIL ' + '; '.join(fails))
sys.exit(1 if fails else 0)
