#!/usr/bin/env python3
"""fxopt: FX option pricer for the Macro Takeaways digests. Python standard library only.

Prices vanillas, European digitals, one-touch / no-touch and single knock-out / knock-in barriers
under Garman-Kohlhagen, plus a vanna-volga smile when ATM / 25-delta RR / 25-delta BF are given.
The formulas are the textbook closed forms (Garman-Kohlhagen, Reiner-Rubinstein barriers,
Rubinstein-Reiner touches, vanna-volga smile, and QuantLib's
VannaVolgaBarrierEngine recipe for barriers). test_fxopt.py checks every number against
QuantLib-Python (BSD-3; https://github.com/lballabio/QuantLib); no QuantLib code is copied here.

Usage: python3 fxopt.py '<json>'   (or the JSON on stdin; a JSON list prices several legs)
  pair        "USDJPY" (base then terms; prices are in terms currency per 1 unit of base; price_pips in pips)
  type        call | put | digital_call | digital_put | one_touch | no_touch | double_no_touch |
              double_one_touch | strike (strike from delta)
  spot        spot rate
  days        calendar days to expiry (or "expiry": "YYYY-MM-DD" with optional "today")
  rates       either rd and rf (terms and base ccy rates, PERCENT, continuous), or fwd (outright
              for the expiry) plus rd; fwd alone assumes rd = 0 and says so
  vol         PERCENT (9.5 = 9.5%); or atm, rr25, bf25 in percent for the smile (rr25 > 0 = calls
              over; how bf25 is read: bf_type)
  bf_type     market (default: bf25 is a broker market strangle, as quoted;
              the smile strangle is solved so the market-strangle strikes reprice; Clark / Reiswich-Wystup)
              | smile (bf25 is already the smile strangle: 25d call vol = atm + bf25 + rr25/2)
  lower, upper  double touches (paid at expiry; pay terms | base)
  strike      for vanillas and digitals; barrier for touches; barrier + barrier_type
              (up_out | up_in | down_out | down_in) turns a call / put into a barrier option
  delta       with type "strike": 0.25 (call) or -0.25 (put); delta_type spot | fwd | spot_pa | fwd_pa
  pay         digitals and touches: "terms" (default) or "base" currency; touches: "expiry" (default) or "hit"
  notional    in base currency (default 1,000,000)
  delta_type  convention for the 25-delta pillars and printed deltas (default: spot for <= 1y,
              premium-adjusted when the pair's premium currency is the base: USD-based pairs
              such as USDJPY, USDKRW quote premium in USD, so spot_pa)
  atm_type    dns (delta-neutral straddle, default) | fwd
Output: one JSON object per leg (price in pips and % of notional, premium, deltas, vega, gamma,
risk-neutral touch / exercise probability, the vol used and its source, model).
"""
import json, math, sys
from datetime import date
from statistics import NormalDist

_N = NormalDist()
N = _N.cdf
n = _N.pdf
Ninv = _N.inv_cdf


def log_ncdf(z):
    """log N(z), accurate far into the left tail (N itself underflows to 0 below about -38)."""
    if z > -30:
        return math.log(0.5 * math.erfc(-z / math.sqrt(2)))
    u = 1.0 / (z * z)  # Mills-ratio asymptotic series
    return -0.5 * z * z - math.log(-z) - 0.5 * math.log(2 * math.pi) + math.log1p(-u + 3 * u ** 2 - 15 * u ** 3 + 105 * u ** 4)


def _wN(logw, z):
    """exp(logw) * N(z) without overflow or underflow (A14 EX02: a huge reflection weight times a far-left N)."""
    return math.exp(logw + log_ncdf(z))


def _pct(v):
    """Rates and vols come in percent (9.5 = 9.5%, 0.8 = 0.8%); returned as decimals."""
    return None if v is None else float(v) / 100.0


def black(phi, F, K, sd, df):
    """Undiscounted Black price times df. phi = +1 call, -1 put. sd = sigma * sqrt(T)."""
    if sd <= 0:
        return df * max(phi * (F - K), 0.0)
    d1 = (math.log(F / K) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    return df * phi * (F * N(phi * d1) - K * N(phi * d2))


class Mkt:
    def __init__(self, S, T, rd, rf):
        self.S, self.T, self.rd, self.rf = S, T, rd, rf
        self.dfd = math.exp(-rd * T)
        self.dff = math.exp(-rf * T)
        self.F = S * self.dff / self.dfd

    # ---- Garman-Kohlhagen vanilla
    def vanilla(self, phi, K, vol):
        return black(phi, self.F, K, vol * math.sqrt(self.T), self.dfd)

    def delta(self, phi, K, vol, kind):
        sd = vol * math.sqrt(self.T)
        d1 = (math.log(self.F / K) + 0.5 * sd * sd) / sd
        d2 = d1 - sd
        if kind == 'spot':
            return phi * self.dff * N(phi * d1)
        if kind == 'fwd':
            return phi * N(phi * d1)
        if kind == 'spot_pa':
            return phi * self.dff * (K / self.F) * N(phi * d2)
        if kind == 'fwd_pa':
            return phi * (K / self.F) * N(phi * d2)
        raise ValueError('delta_type ' + kind)

    def strike_from_delta(self, phi, delta, vol, kind):
        sd = vol * math.sqrt(self.T)
        if kind in ('spot', 'fwd'):
            dfx = self.dff if kind == 'spot' else 1.0
            return self.F * math.exp(-phi * sd * Ninv(phi * delta / dfx) + 0.5 * sd * sd)
        # premium-adjusted: bisection on the branch where |delta| falls as the strike moves away
        k_npa = self.strike_from_delta(phi, delta, vol, 'spot' if kind == 'spot_pa' else 'fwd')
        f = lambda k: self.delta(phi, k, vol, kind) - delta
        if phi < 0:  # put: PA delta is monotone, the PA strike sits below the non-PA one
            lo, hi = k_npa * math.exp(-10 * sd), k_npa
        else:  # call: PA delta peaks at k_max; the 25d strike lies in [k_max, k_npa]
            lo, hi = self.F * math.exp(-10 * sd), k_npa
            for _ in range(200):  # golden-section search for the peak
                a, b = lo + 0.382 * (hi - lo), lo + 0.618 * (hi - lo)
                if self.delta(1, a, vol, kind) < self.delta(1, b, vol, kind):
                    lo = a
                else:
                    hi = b
            lo, hi = lo, k_npa
            if f(lo) < 0:
                raise ValueError('no premium-adjusted strike for this delta')
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if f(mid) > 0:  # delta above target: strike too low (call and put alike)
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def atm_strike(self, vol, atm_type, pa):
        sd = vol * math.sqrt(self.T)
        if atm_type == 'fwd':
            return self.F
        return self.F * math.exp((-0.5 if pa else 0.5) * sd * sd)

    # ---- European digitals (share of payout x discount, in the payout currency)
    def digital(self, phi, K, vol, pay):
        sd = vol * math.sqrt(self.T)
        d1 = (math.log(self.F / K) + 0.5 * sd * sd) / sd
        if pay == 'base':
            return self.dff * N(phi * d1)
        return self.dfd * N(phi * (d1 - sd))

    # ---- touches
    def touch_prob(self, H, vol, measure='terms', up=None):
        """Probability of touching H before expiry under the terms (domestic) or base measure. `up` fixes the
        barrier's side (A14 EX06: a spot bump through H must read as touched, not as a barrier on the other side)."""
        S, T = self.S, self.T
        if up is None:
            up = H > S
        if H == S or (up and S >= H) or (not up and S <= H):
            return 1.0
        mu = self.rd - self.rf + (0.5 if measure == 'base' else -0.5) * vol * vol
        sd = vol * math.sqrt(T)
        h = math.log(H / S)
        lw = 2 * mu * h / (vol * vol)
        if up:
            return min(1.0, N((-h + mu * T) / sd) + _wN(lw, (-h - mu * T) / sd))
        return min(1.0, N((h - mu * T) / sd) + _wN(lw, (h + mu * T) / sd))

    def one_touch(self, H, vol, pay='terms', when='expiry', up=None):
        if up is None:
            up = H > self.S
        if H == self.S or (up and self.S >= H) or (not up and self.S <= H):
            # touched: paid now at hit (A14 EX03: not discounted to expiry), else at expiry
            if when == 'hit':
                return 1.0
            return self.dfd if pay == 'terms' else self.dff
        if when == 'expiry':
            if pay == 'base':
                return self.dff * self.touch_prob(H, vol, 'base', up)
            return self.dfd * self.touch_prob(H, vol, 'terms', up)
        # paid at hit (Rubinstein-Reiner); base-currency pay at hit is worth H units of terms
        S, T = self.S, self.T
        b = self.rd - self.rf
        mu = (b - 0.5 * vol * vol) / (vol * vol)
        rad = mu * mu + 2 * self.rd / (vol * vol)
        if rad < 0:
            # A14 EX04: a negative terms rate below -mu^2 vol^2 / 2 has no real Laplace exponent; integrate
            # E[exp(-rd tau) 1(tau <= T)] by parts on the hitting-time CDF: dfd P(T) + rd * int_0^T e^{-rd t} P(t) dt.
            def P(t):
                return Mkt(S, t, self.rd, self.rf).touch_prob(H, vol, 'terms', up) if t > 0 else 0.0
            k = 400  # Simpson on t = T x^2 (the CDF rises like sqrt-of-time near 0)
            acc = 0.0
            for i in range(k + 1):
                x = i / k
                w = 1 if i in (0, k) else (4 if i % 2 else 2)
                t = T * x * x
                acc += w * 2 * T * x * math.exp(-self.rd * t) * P(t)
            v = self.dfd * P(T) + self.rd * acc / (3 * k)
            return v * (H / S if pay == 'base' else 1.0)
        lam = math.sqrt(rad)
        z = math.log(H / S) / (vol * math.sqrt(T)) + lam * vol * math.sqrt(T)
        eta = 1.0 if H < S else -1.0
        lr = math.log(H / S)  # A16 FX16-01: weights in log space (a huge weight times a tail rounded to 0)
        v = _wN((mu + lam) * lr, eta * z) + _wN((mu - lam) * lr, eta * (z - 2 * lam * vol * math.sqrt(T)))
        return v * (H / S if pay == 'base' else 1.0)

    # ---- double touches (Hui 1996 series, as in Haug's Complete Guide), paid at expiry
    def double_no_touch(self, L, U, vol, pay='terms', method=None):
        """Value, per unit of payout in the pay currency, of a payout at expiry if spot stays inside (L, U)."""
        S, T = self.S, self.T
        if not L < S < U:
            return 0.0
        # terms pay: domestic measure, discount rd; base pay: base measure (drift + vol^2), discount rf
        b = self.rd - self.rf + (vol * vol if pay == 'base' else 0.0)
        r = self.rf if pay == 'base' else self.rd
        s2, Z = vol * vol, math.log(U / L)
        sd = vol * math.sqrt(T)
        if method == 'images' or (method is None and sd / Z < 0.5):
            # A14 EX01: for a corridor wide against the remaining diffusion, the sine series cancels to nothing
            # (the 3%-vol, 30-day 0.7/1.4 corridor priced 0). Method of images instead: for X = log(S_T/S) with
            # drift m and killing at a = log(L/S) < 0 < c = log(U/S), the surviving mass is
            # sum_n [M(2nZ) - M(2a + 2nZ)], M(k) = exp(m k / s2) [N((c - k - mT)/sd) - N((a - k - mT)/sd)].
            m_, lo_, hi_ = b - 0.5 * s2, math.log(L / S), math.log(U / S)

            def M(k):
                x, y = (lo_ - k - m_ * T) / sd, (hi_ - k - m_ * T) / sd
                if x > 0:  # use the upper tail: N(y) - N(x) = N(-x) - N(-y)
                    x, y = -y, -x
                lx, ly = log_ncdf(x), log_ncdf(y)
                if lx >= ly:
                    return 0.0
                return math.exp(m_ * k / s2 + ly + math.log(-math.expm1(lx - ly)))

            terms = []
            for j in range(-12, 13):
                terms += [M(2 * j * Z), -M(2 * lo_ + 2 * j * Z)]
            return math.exp(-r * T) * min(1.0, max(0.0, math.fsum(terms)))
        a = -0.5 * (2 * b / s2 - 1)
        be = -0.25 * (2 * b / s2 - 1) ** 2 - 2 * r / s2
        xl, xu, lsl = (S / L) ** a, (S / U) ** a, math.log(S / L)
        v = 0.0
        for i in range(1, 100001):
            w = i * math.pi / Z
            t = 2 * math.pi * i / (Z * Z) * (xl - (-1) ** i * xu) / (a * a + w * w) \
                * math.sin(w * lsl) * math.exp(-0.5 * (w * w - be) * s2 * T)
            v += t
            if 0.5 * w * w * s2 * T > 40 and abs(t) < 1e-16:
                break
        return min(max(v, 0.0), self.dff if pay == 'base' else self.dfd)

    # ---- single barriers, no rebate (Reiner-Rubinstein, as in Haug's Complete Guide)
    def barrier(self, phi, K, H, btype, vol):
        if btype not in BARRIER_TYPES:  # A14 EX07: up_otu was priced as up_in
            raise ValueError('barrier_type must be one of ' + ', '.join(BARRIER_TYPES))
        S, T, r, b = self.S, self.T, self.rd, self.rd - self.rf
        up = btype.startswith('up')
        out = btype.endswith('out')
        if (up and S >= H) or (not up and S <= H):  # already beyond the barrier
            return 0.0 if out else self.vanilla(phi, K, vol)
        sd = vol * math.sqrt(T)
        mu = (b - 0.5 * vol * vol) / (vol * vol)
        x1 = math.log(S / K) / sd + (1 + mu) * sd
        x2 = math.log(S / H) / sd + (1 + mu) * sd
        y1 = math.log(H * H / (S * K)) / sd + (1 + mu) * sd
        y2 = math.log(H / S) / sd + (1 + mu) * sd
        eta = -1.0 if up else 1.0
        ef, ed = math.exp((b - r) * T), math.exp(-r * T)
        A = phi * S * ef * N(phi * x1) - phi * K * ed * N(phi * x1 - phi * sd)
        B = phi * S * ef * N(phi * x2) - phi * K * ed * N(phi * x2 - phi * sd)
        lr = math.log(H / S)  # A16 FX16-01: reflection weights in log space
        C = phi * (S * ef * _wN(2 * (mu + 1) * lr, eta * y1) - K * ed * _wN(2 * mu * lr, eta * (y1 - sd)))
        D = phi * (S * ef * _wN(2 * (mu + 1) * lr, eta * y2) - K * ed * _wN(2 * mu * lr, eta * (y2 - sd)))
        call = phi > 0
        if not up:  # down barriers
            if call:
                vin = C if K > H else A - B + D
                vout = A - C if K > H else B - D
            else:
                vin = B - C + D if K > H else A
                vout = A - B + C - D if K > H else 0.0
        else:
            if call:
                vin = A if K > H else B - C + D
                vout = 0.0 if K > H else A - B + C - D
            else:
                vin = A - B + D if K > H else C
                vout = B - D if K > H else A - C
        return max(vout if out else vin, 0.0)


BARRIER_TYPES = ('up_out', 'up_in', 'down_out', 'down_in')


# ---- vanna-volga smile
class Smile:
    """Three pillars (25d put, ATM, 25d call) and the vanna-volga smile between and beyond them."""

    def __init__(self, m, atm, rr25, bf25, delta_type, atm_type):
        self.m = m
        self.atm = atm
        self.bf = bf25
        self.vc = atm + bf25 + 0.5 * rr25
        self.vp = atm + bf25 - 0.5 * rr25
        pa = delta_type.endswith('_pa')
        self.k_atm = m.atm_strike(atm, atm_type, pa)
        self.k_c = m.strike_from_delta(1, 0.25, self.vc, delta_type)
        self.k_p = m.strike_from_delta(-1, -0.25, self.vp, delta_type)

    def vol(self, K):
        """Vanna-volga vol at strike K: the vanna-volga call price (ATM-vol Black price plus the
        vega-weighted market-minus-model premia of the three pillars), inverted to a Black vol."""
        if self.vc == self.atm == self.vp:  # A14 VAN-004: a flat surface is flat everywhere (no deep-wing re-inversion)
            return self.atm
        m, s2 = self.m, self.atm
        ks = (self.k_p, self.k_atm, self.k_c)
        vs = (self.vp, self.atm, self.vc)
        sq = math.sqrt(m.T)
        L = math.log
        vega = lambda k: n((L(m.F / k) + 0.5 * s2 * s2 * m.T) / (s2 * sq))
        K1, K2, K3 = ks
        x = (vega(K) / vega(K1) * L(K2 / K) * L(K3 / K) / (L(K2 / K1) * L(K3 / K1)),
             vega(K) / vega(K2) * L(K / K1) * L(K3 / K) / (L(K2 / K1) * L(K3 / K2)),
             vega(K) / vega(K3) * L(K / K1) * L(K / K2) / (L(K3 / K1) * L(K3 / K2)))
        c = black(1, m.F, K, s2 * sq, m.dfd)
        for xi, ki, vi in zip(x, ks, vs):
            c += xi * (black(1, m.F, ki, vi * sq, m.dfd) - black(1, m.F, ki, s2 * sq, m.dfd))
        return implied_vol(m, K, c)

    def vv_barrier(self, phi, K, H, btype, vanilla_smile):
        """QuantLib VannaVolgaBarrierEngine recipe (adaptVanDelta = False)."""
        m, atm = self.m, self.atm
        S, T = m.S, m.T
        up = btype.startswith('up')
        out_type = ('up' if up else 'down') + '_out'
        if (up and S >= H) or (not up and S <= H):
            return 0.0 if btype.endswith('out') else vanilla_smile
        def bs(vol, spot=S):
            mm = Mkt(spot, T, m.rd, m.rf)
            return mm.barrier(phi, K, H, out_type, vol)
        p0 = bs(atm)
        e = 1e-4
        vega = (bs(atm + e) - p0) / e
        volga = ((bs(atm + 2 * e) - bs(atm + e)) / e - vega) / e
        dS = 1e-4 * S
        d1_ = (bs(atm, S + dS) - bs(atm, S - dS)) / (2 * dS)
        d2_ = (bs(atm + e, S + dS) - bs(atm + e, S - dS)) / (2 * dS)
        vanna = (d2_ - d1_) / e
        def greeks(k):
            d = (math.log(m.F / k) + 0.5 * atm * atm * T) / (atm * math.sqrt(T))
            vg = S * n(d) * math.sqrt(T) * m.dff
            return vg, vg / S * (1 - d / (atm * math.sqrt(T))), vg * d * (d - atm * math.sqrt(T)) / atm
        cols = [greeks(self.k_atm), greeks(self.k_c), greeks(self.k_p)]
        A = [[cols[j][i] for j in range(3)] for i in range(3)]
        q = _solve3(A, [vega, vanna, volga])
        sq = math.sqrt(T)
        adj = q[1] * (black(1, m.F, self.k_c, self.vc * sq, m.dfd) - black(1, m.F, self.k_c, atm * sq, m.dfd)) \
            + q[2] * (black(-1, m.F, self.k_p, self.vp * sq, m.dfd) - black(-1, m.F, self.k_p, atm * sq, m.dfd))
        mu = m.rd - m.rf - 0.5 * atm * atm
        h2 = (math.log(H / S) + mu * T) / (atm * sq)
        h2p = (math.log(S / H) + mu * T) / (atm * sq)
        lw = 2 * mu * math.log(H / S) / (atm * atm)
        p_touch = N(h2p) + _wN(lw, -h2) if up else N(-h2p) + _wN(lw, h2)
        outp = max(0.0, min(vanilla_smile, p0 + (1 - p_touch) * adj))
        return outp if btype.endswith('out') else vanilla_smile - outp


def market_strangle_smile(m, atm, rr25, bf_ms, delta_type, atm_type):
    """Smile whose 25d strangle, struck at the market-strangle strikes (25d strikes at the single vol
    atm + bf_ms) and priced on the smile, is worth the same as both legs at atm + bf_ms: the broker
    (market) strangle convention. Returns the vanna-volga Smile with the solved smile strangle."""
    if atm > 0 and rr25 == 0 and bf_ms == 0:  # A16 FX16-04: a flat quote is the flat smile (bisection left a residual)
        return Smile(m, atm, 0.0, 0.0, delta_type, atm_type)
    v = atm + bf_ms
    kc = m.strike_from_delta(1, 0.25, v, delta_type)
    kp = m.strike_from_delta(-1, -0.25, v, delta_type)
    target = m.vanilla(1, kc, v) + m.vanilla(-1, kp, v)
    def f(bf):
        sm = Smile(m, atm, rr25, bf, delta_type, atm_type)
        return m.vanilla(1, kc, sm.vol(kc)) + m.vanilla(-1, kp, sm.vol(kp)) - target, sm
    # A14 VAN-003: the bracket keeps both wing vols positive (atm + bf - |rr|/2 > 0), starts at the quote and is bounded.
    if atm <= 0 or v <= 0:
        raise ValueError('ATM and market strangle vols must be positive')
    floor = abs(rr25) / 2 - atm + 1e-6
    width = min(0.002, atm / 10)
    for _ in range(40):
        lo, hi = max(floor, bf_ms - width), bf_ms + width
        if f(lo)[0] <= 0 <= f(hi)[0]:
            break
        width *= 1.6
    else:
        raise ValueError('no market strangle calibration with positive wing vols')
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if f(mid)[0] > 0:
            hi = mid
        else:
            lo = mid
    return f(0.5 * (lo + hi))[1]


def implied_vol(m, K, c):
    """Black vol for an undiscounted-by-dfd call price c (bisection, 1e-12)."""
    lo, hi = 1e-6, 5.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if black(1, m.F, K, mid * math.sqrt(m.T), m.dfd) > c:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


def _solve3(A, b):
    import copy
    M = copy.deepcopy(A)
    v = list(b)
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(M[r][i]))
        M[i], M[p] = M[p], M[i]
        v[i], v[p] = v[p], v[i]
        for r in range(i + 1, 3):
            f = M[r][i] / M[i][i]
            for c in range(i, 3):
                M[r][c] -= f * M[i][c]
            v[r] -= f * v[i]
    x = [0.0] * 3
    for i in (2, 1, 0):
        x[i] = (v[i] - sum(M[i][c] * x[c] for c in range(i + 1, 3))) / M[i][i]
    return x


PA_BASES = ('USD',)  # premium in the base currency for USD-based pairs (USDJPY, USDKRW, ...)


def price(leg):
    notes = []
    pair = leg.get('pair', 'XXXYYY').upper()
    base, terms = pair[:3], pair[3:6]
    S = float(leg['spot'])
    if 'days' in leg:
        days = float(leg['days'])
    else:
        t0 = date.fromisoformat(leg['today']) if leg.get('today') else date.today()
        days = (date.fromisoformat(leg['expiry']) - t0).days
    if days <= 0:
        raise ValueError('expiry must be after today')
    T = days / 365.0
    rd = _pct(leg.get('rd'))
    rf = _pct(leg.get('rf'))
    fwd = leg.get('fwd')
    if rd is not None and rf is not None:
        pass
    elif fwd is not None:
        if rd is None:
            rd = 0.0
            notes.append('rd not given: discounting at 0, carry from the forward')
        rf = rd - math.log(float(fwd) / S) / T
    else:
        # one rate or none: zero carry, so the other rate equals it (A14 VAN-005: rf alone used to set rd = 0)
        rd = rd if rd is not None else (rf if rf is not None else 0.0)
        rf = rf if rf is not None else rd
        notes.append('no forward or both rates: zero carry assumed')
    m = Mkt(S, T, rd, rf)
    dtype = leg.get('delta_type') or ('spot_pa' if base in PA_BASES else 'spot')
    if T > 1.0 and not leg.get('delta_type'):
        dtype = dtype.replace('spot', 'fwd')
    atm_type = leg.get('atm_type', 'dns')
    smile = None
    if leg.get('atm') is not None:
        args = (m, _pct(leg['atm']), _pct(leg.get('rr25', 0)), _pct(leg.get('bf25', 0)), dtype, atm_type)
        if leg.get('bf_type', 'market') == 'market':
            smile = market_strangle_smile(*args)
            notes.append('bf25 read as a market (broker) strangle; smile strangle %.4f%%' % (100 * smile.bf))
        else:
            smile = Smile(*args)
    vol_in = _pct(leg.get('vol'))
    if vol_in is None and smile is None:
        raise ValueError('give vol, or atm/rr25/bf25')
    vsrc = leg.get('vol_source', 'given')
    typ = leg['type']
    out = {'pair': pair, 'type': typ, 'spot': S, 'days': days, 'fwd': m.F, 'rd': rd, 'rf': rf,
           'delta_type': dtype}
    if typ == 'strike':
        d = float(leg['delta'])
        phi = 1 if d > 0 else -1
        vol = smile.vc if (smile and phi > 0) else smile.vp if smile else vol_in
        k = m.strike_from_delta(phi, d, vol, dtype)
        if smile:
            # A14 VAN-001: the vol is the smile's at the returned strike (the 25d wing vol was used for every delta)
            for _ in range(200):
                vol = smile.vol(k)
                if abs(m.delta(phi, k, vol, dtype) - d) < 1e-10:
                    break
                k = math.sqrt(k * m.strike_from_delta(phi, d, vol, dtype))
            else:
                raise ValueError('no strike on this smile has that delta')
        out.update(strike=k, vol=vol)
        out['notes'] = notes
        return out
    notional = float(leg.get('notional', 1e6))
    phi = -1 if typ in ('put', 'digital_put') else 1
    if typ in ('call', 'put'):
        K = float(leg['strike'])
        vol = smile.vol(K) if smile else vol_in
        van = m.vanilla(phi, K, vol)
        if leg.get('barrier') is not None:
            H, bt = float(leg['barrier']), leg.get('barrier_type')
            if bt not in BARRIER_TYPES:
                raise ValueError('barrier_type must be one of ' + ', '.join(BARRIER_TYPES))
            if float(leg.get('rebate') or 0) != 0:  # A14 EX08: never price a rebate as zero without saying so
                raise ValueError('single barriers are priced without a rebate; rebate must be 0')
            up_b = bt.startswith('up')
            if smile:
                px = smile.vv_barrier(phi, K, H, bt, van)
                out['bs_atm'] = m.barrier(phi, K, H, bt, smile.atm)
            else:
                px = m.barrier(phi, K, H, bt, vol)
            out.update(barrier=H, barrier_type=bt, vanilla=van)
            def reprice(s, v):
                return Mkt(s, T, rd, rf).barrier(phi, K, H, bt, v)
            # A14 EX05: a barrier already through its trigger has touched (p = 1)
            out['p_touch'] = Mkt(S, T, rd, rf).touch_prob(H, smile.atm if smile else vol, 'terms', up_b)
        else:
            px = van
            def reprice(s, v):
                return Mkt(s, T, rd, rf).vanilla(phi, K, v)
            out['delta_' + dtype] = m.delta(phi, K, vol, dtype)
            if smile:  # A14 VAN-002: the smile's own exercise probability, -dC/dK with the smile slope, undiscounted
                h = K * max(1e-8, min(1e-4, 1e-3 * vol * math.sqrt(T)))  # A16 FX16-02: inside the diffusion
                c = lambda k: m.vanilla(phi, k, smile.vol(k))
                out['p_exercise'] = min(1.0, max(0.0, -phi * (c(K + h) - c(K - h)) / (2 * h * m.dfd)))
            else:
                out['p_exercise'] = N(phi * ((math.log(m.F / K) - 0.5 * vol * vol * T) / (vol * math.sqrt(T))))
        out.update(strike=K, vol=vol)
    elif typ in ('digital_call', 'digital_put'):
        K = float(leg['strike'])
        pay = leg.get('pay', 'terms')
        vol = smile.vol(K) if smile else vol_in
        px = m.digital(phi, K, vol, pay)
        if smile:  # skew term: -dC/dK including the smile slope (terms pay)
            h = K * max(1e-8, min(1e-4, 1e-3 * vol * math.sqrt(T)))  # A16 FX16-02
            c = lambda k: m.vanilla(phi, k, smile.vol(k))
            px_t = -phi * (c(K + h) - c(K - h)) / (2 * h)
            out['bs_strike_vol'] = px
            # base pay: asset-or-nothing = phi * vanilla + K * terms digital, per unit of base
            px = px_t if pay == 'terms' else (phi * c(K) + K * px_t) / S
        def reprice(s, v):
            return Mkt(s, T, rd, rf).digital(phi, K, v, pay)
        out.update(strike=K, vol=vol, pay=pay, payout=notional)
    elif typ in ('double_no_touch', 'double_one_touch'):
        L, U = float(leg['lower']), float(leg['upper'])
        pay = leg.get('pay', 'terms')
        vol = smile.atm if smile else vol_in
        dfp = m.dfd if pay == 'terms' else m.dff
        dnt = m.double_no_touch(L, U, vol, pay)
        px = dnt if typ == 'double_no_touch' else dfp - dnt
        if smile:
            notes.append('double touch priced at ATM vol; smile not applied to touches')
        def reprice(s, v):
            mm = Mkt(s, T, rd, rf)
            d = mm.double_no_touch(L, U, v, pay)
            return d if typ == 'double_no_touch' else (mm.dfd if pay == 'terms' else mm.dff) - d
        out.update(lower=L, upper=U, vol=vol, pay=pay, when='expiry', payout=notional,
                   p_stay_inside=m.double_no_touch(L, U, vol, 'terms') / m.dfd)
    elif typ in ('one_touch', 'no_touch'):
        H = float(leg['barrier'])
        pay, when = leg.get('pay', 'terms'), leg.get('when', 'expiry')
        vol = smile.atm if smile else vol_in
        up_t = H > S  # fixed for the bumps (A14 EX06)
        ot = m.one_touch(H, vol, pay, when if typ == 'one_touch' else 'expiry', up_t)
        dfp = m.dfd if pay == 'terms' else m.dff
        px = ot if typ == 'one_touch' else dfp - ot
        if smile:
            notes.append('touch priced at ATM vol; smile not applied to touches (no QuantLib cross-check)')
        def reprice(s, v):
            if H == S:  # A16 FX16-03: touched at inception; a bump cannot undo the event
                return px
            mm = Mkt(s, T, rd, rf)
            o = mm.one_touch(H, v, pay, when if typ == 'one_touch' else 'expiry', up_t)
            return o if typ == 'one_touch' else (mm.dfd if pay == 'terms' else mm.dff) - o
        out.update(barrier=H, vol=vol, pay=pay, when=when, payout=notional,
                   p_touch=m.touch_prob(H, vol, 'terms' if pay == 'terms' else 'base', up_t))
    else:
        raise ValueError('unknown type ' + typ)
    # greeks by bump on the flat vol used (sticky strike), in base-notional terms
    v0 = out['vol']
    e = 1e-4
    # A14 EX09: the spot bump is kept well inside the remaining diffusion width (a fixed 1 bp smoothed ATM digital
    # and short-dated deltas), and never reaches a touch barrier.
    dS = S * max(1e-9, min(1e-4, 1e-3 * v0 * math.sqrt(T)))
    if typ in ('one_touch', 'no_touch') and H != S:
        dS = min(dS, abs(H - S) / 4)
    up_, dn_ = reprice(S + dS, v0), reprice(S - dS, v0)
    if typ in ('call', 'put'):
        # A14 FX-UNIT-01: price_pips is pips (1e-4 of terms, 1e-2 for JPY terms); price_terms is terms per unit of base
        out['price_terms'] = px
        out['price_pips'] = px / (0.01 if terms == 'JPY' else 1e-4)
        out['price_pct_base'] = 100 * px / S
        out['premium_terms'] = px * notional
        out['premium_base'] = px * notional / S
        out['delta_spot_pct'] = 100 * (up_ - dn_) / (2 * dS)
        out['vega_per_volpt_terms'] = (reprice(S, v0 + e) - reprice(S, v0 - e)) / (2 * e) * 0.01 * notional
        if leg.get('barrier') is None:  # A14 VAN-006: exact Black gamma for a vanilla (a bump smooths the kink)
            sd0 = v0 * math.sqrt(T)
            out['gamma_per_1pct_pct'] = m.dff * n(math.log(m.F / K) / sd0 + 0.5 * sd0) / sd0
        else:
            out['gamma_per_1pct_pct'] = 100 * (up_ - 2 * reprice(S, v0) + dn_) / (dS * dS) * S * 0.01
    else:  # binaries: price as a share of the payout
        out['price_share'] = px
        out['premium_payccy'] = px * notional
        out['rr_if_bought'] = (1 / px - 1) if px > 0 else None
        out['delta_payccy_per_1pct'] = (up_ - dn_) / (2 * dS) * S * 0.01 * notional
        out['vega_per_volpt_payccy'] = (reprice(S, v0 + e) - reprice(S, v0 - e)) / (2 * e) * 0.01 * notional
    out['price'] = px
    touch = typ in ('one_touch', 'no_touch', 'double_no_touch', 'double_one_touch')
    out['model'] = 'vanna-volga' if smile and not touch else 'Garman-Kohlhagen'
    out['vol_source'] = vsrc if not smile else 'smile ATM/RR25/BF25 (' + vsrc + ')'
    out['notes'] = notes
    return out


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    legs = json.loads(raw)
    res = [price(l) for l in legs] if isinstance(legs, list) else price(legs)
    print(json.dumps(res, indent=1, default=lambda x: round(x, 10)))


if __name__ == '__main__':
    main()
