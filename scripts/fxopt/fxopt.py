#!/usr/bin/env python3
"""fxopt: FX option pricer for the Macro Takeaways digests. Python standard library only.

Prices vanillas, European digitals, one-touch / no-touch and single knock-out / knock-in barriers
under Garman-Kohlhagen, plus a vanna-volga smile when ATM / 25-delta RR / 25-delta BF are given.
The formulas are the textbook closed forms (Garman-Kohlhagen, Reiner-Rubinstein barriers,
Rubinstein-Reiner touches, vanna-volga smile, and QuantLib's
VannaVolgaBarrierEngine recipe for barriers). test_fxopt.py checks every number against
QuantLib-Python (BSD-3; https://github.com/lballabio/QuantLib); no QuantLib code is copied here.

Usage: python3 fxopt.py '<json>'   (or the JSON on stdin; a JSON list prices several legs)
  pair        "USDJPY" (base then terms; prices are in terms currency per 1 unit of base)
  type        call | put | digital_call | digital_put | one_touch | no_touch | strike (strike from delta)
  spot        spot rate
  days        calendar days to expiry (or "expiry": "YYYY-MM-DD" with optional "today")
  rates       either rd and rf (terms and base ccy rates, PERCENT, continuous), or fwd (outright
              for the expiry) plus rd; fwd alone assumes rd = 0 and says so
  vol         PERCENT (9.5 = 9.5%); or atm, rr25, bf25 in percent for the smile (25d call vol =
              atm + bf25 + rr25/2, put = atm + bf25 - rr25/2; rr25 > 0 = calls over)
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
    def touch_prob(self, H, vol, measure='terms'):
        """Probability of touching H before expiry under the terms (domestic) or base measure."""
        S, T = self.S, self.T
        if H == S:
            return 1.0
        mu = self.rd - self.rf + (0.5 if measure == 'base' else -0.5) * vol * vol
        sd = vol * math.sqrt(T)
        h = math.log(H / S)
        if H > S:
            return N((-h + mu * T) / sd) + math.exp(2 * mu * h / (vol * vol)) * N((-h - mu * T) / sd)
        return N((h - mu * T) / sd) + math.exp(2 * mu * h / (vol * vol)) * N((h + mu * T) / sd)

    def one_touch(self, H, vol, pay='terms', when='expiry'):
        if H == self.S:
            return self.dfd if pay == 'terms' else self.dff
        if when == 'expiry':
            if pay == 'base':
                return self.dff * self.touch_prob(H, vol, 'base')
            return self.dfd * self.touch_prob(H, vol, 'terms')
        # paid at hit (Rubinstein-Reiner); base-currency pay at hit is worth H units of terms
        S, T = self.S, self.T
        b = self.rd - self.rf
        mu = (b - 0.5 * vol * vol) / (vol * vol)
        lam = math.sqrt(mu * mu + 2 * self.rd / (vol * vol))
        z = math.log(H / S) / (vol * math.sqrt(T)) + lam * vol * math.sqrt(T)
        eta = 1.0 if H < S else -1.0
        v = (H / S) ** (mu + lam) * N(eta * z) + (H / S) ** (mu - lam) * N(eta * z - 2 * eta * lam * vol * math.sqrt(T))
        return v * (H / S if pay == 'base' else 1.0)

    # ---- single barriers, no rebate (Reiner-Rubinstein, as in Haug's Complete Guide)
    def barrier(self, phi, K, H, btype, vol):
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
        C = phi * S * ef * (H / S) ** (2 * (mu + 1)) * N(eta * y1) - phi * K * ed * (H / S) ** (2 * mu) * N(eta * y1 - eta * sd)
        D = phi * S * ef * (H / S) ** (2 * (mu + 1)) * N(eta * y2) - phi * K * ed * (H / S) ** (2 * mu) * N(eta * y2 - eta * sd)
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


# ---- vanna-volga smile
class Smile:
    """Three pillars (25d put, ATM, 25d call) and the vanna-volga smile between and beyond them."""

    def __init__(self, m, atm, rr25, bf25, delta_type, atm_type):
        self.m = m
        self.atm = atm
        self.vc = atm + bf25 + 0.5 * rr25
        self.vp = atm + bf25 - 0.5 * rr25
        pa = delta_type.endswith('_pa')
        self.k_atm = m.atm_strike(atm, atm_type, pa)
        self.k_c = m.strike_from_delta(1, 0.25, self.vc, delta_type)
        self.k_p = m.strike_from_delta(-1, -0.25, self.vp, delta_type)

    def vol(self, K):
        """Vanna-volga vol at strike K: the vanna-volga call price (ATM-vol Black price plus the
        vega-weighted market-minus-model premia of the three pillars), inverted to a Black vol."""
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
        pw = (H / S) ** (2 * mu / (atm * atm))
        p_touch = N(h2p) + pw * N(-h2) if up else N(-h2p) + pw * N(h2)
        outp = max(0.0, min(vanilla_smile, p0 + (1 - p_touch) * adj))
        return outp if btype.endswith('out') else vanilla_smile - outp


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
        rd = rd or 0.0
        rf = rf if rf is not None else rd
        notes.append('no forward or rates: zero carry assumed')
    m = Mkt(S, T, rd, rf)
    dtype = leg.get('delta_type') or ('spot_pa' if base in PA_BASES else 'spot')
    if T > 1.0 and not leg.get('delta_type'):
        dtype = dtype.replace('spot', 'fwd')
    atm_type = leg.get('atm_type', 'dns')
    smile = None
    if leg.get('atm') is not None:
        smile = Smile(m, _pct(leg['atm']), _pct(leg.get('rr25', 0)), _pct(leg.get('bf25', 0)), dtype, atm_type)
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
        out.update(strike=m.strike_from_delta(phi, d, vol, dtype), vol=vol)
        out['notes'] = notes
        return out
    notional = float(leg.get('notional', 1e6))
    phi = -1 if typ in ('put', 'digital_put') else 1
    if typ in ('call', 'put'):
        K = float(leg['strike'])
        vol = smile.vol(K) if smile else vol_in
        van = m.vanilla(phi, K, vol)
        if leg.get('barrier') is not None:
            H, bt = float(leg['barrier']), leg['barrier_type']
            if smile:
                px = smile.vv_barrier(phi, K, H, bt, van)
                out['bs_atm'] = m.barrier(phi, K, H, bt, smile.atm)
            else:
                px = m.barrier(phi, K, H, bt, vol)
            out.update(barrier=H, barrier_type=bt, vanilla=van)
            def reprice(s, v):
                return Mkt(s, T, rd, rf).barrier(phi, K, H, bt, v)
            out['p_touch'] = Mkt(S, T, rd, rf).touch_prob(H, smile.atm if smile else vol)
        else:
            px = van
            def reprice(s, v):
                return Mkt(s, T, rd, rf).vanilla(phi, K, v)
            out['delta_' + dtype] = m.delta(phi, K, vol, dtype)
            out['p_exercise'] = N(phi * ((math.log(m.F / K) - 0.5 * vol * vol * T) / (vol * math.sqrt(T))))
        out.update(strike=K, vol=vol)
    elif typ in ('digital_call', 'digital_put'):
        K = float(leg['strike'])
        pay = leg.get('pay', 'terms')
        vol = smile.vol(K) if smile else vol_in
        px = m.digital(phi, K, vol, pay)
        if smile:  # skew term: -dC/dK including the smile slope (terms pay)
            h = 1e-4 * K
            c = lambda k: m.vanilla(phi, k, smile.vol(k))
            px_t = -phi * (c(K + h) - c(K - h)) / (2 * h)
            out['bs_strike_vol'] = px
            # base pay: asset-or-nothing = phi * vanilla + K * terms digital, per unit of base
            px = px_t if pay == 'terms' else (phi * c(K) + K * px_t) / S
        def reprice(s, v):
            return Mkt(s, T, rd, rf).digital(phi, K, v, pay)
        out.update(strike=K, vol=vol, pay=pay, payout=notional)
    elif typ in ('one_touch', 'no_touch'):
        H = float(leg['barrier'])
        pay, when = leg.get('pay', 'terms'), leg.get('when', 'expiry')
        vol = smile.atm if smile else vol_in
        ot = m.one_touch(H, vol, pay, when if typ == 'one_touch' else 'expiry')
        dfp = m.dfd if pay == 'terms' else m.dff
        px = ot if typ == 'one_touch' else dfp - ot
        if smile:
            notes.append('touch priced at ATM vol; smile not applied to touches (no QuantLib cross-check)')
        def reprice(s, v):
            mm = Mkt(s, T, rd, rf)
            o = mm.one_touch(H, v, pay, when if typ == 'one_touch' else 'expiry')
            return o if typ == 'one_touch' else (mm.dfd if pay == 'terms' else mm.dff) - o
        out.update(barrier=H, vol=vol, pay=pay, when=when, payout=notional,
                   p_touch=m.touch_prob(H, vol, 'terms' if pay == 'terms' else 'base'))
    else:
        raise ValueError('unknown type ' + typ)
    # greeks by bump on the flat vol used (sticky strike), in base-notional terms
    v0 = out['vol']
    e = 1e-4
    dS = S * 1e-4
    up_, dn_ = reprice(S + dS, v0), reprice(S - dS, v0)
    if typ in ('call', 'put'):
        out['price_pips'] = px
        out['price_pct_base'] = 100 * px / S
        out['premium_terms'] = px * notional
        out['premium_base'] = px * notional / S
        out['delta_spot_pct'] = 100 * (up_ - dn_) / (2 * dS)
        out['vega_per_volpt_terms'] = (reprice(S, v0 + e) - reprice(S, v0 - e)) / (2 * e) * 0.01 * notional
        out['gamma_per_1pct_pct'] = 100 * (up_ - 2 * reprice(S, v0) + dn_) / (dS * dS) * S * 0.01
    else:  # binaries: price as a share of the payout
        out['price_share'] = px
        out['premium_payccy'] = px * notional
        out['rr_if_bought'] = (1 / px - 1) if px > 0 else None
        out['delta_payccy_per_1pct'] = (up_ - dn_) / (2 * dS) * S * 0.01 * notional
        out['vega_per_volpt_payccy'] = (reprice(S, v0 + e) - reprice(S, v0 - e)) / (2 * e) * 0.01 * notional
    out['price'] = px
    out['model'] = 'vanna-volga' if smile and typ != 'one_touch' and typ != 'no_touch' else 'Garman-Kohlhagen'
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
