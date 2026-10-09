// R01 TEST VALUES, reproduced to 4 dp, plus a Monte Carlo cross-check and the marking path.
// Run: npx -y tsx --test supabase/functions/_shared/convexity.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Bar, HOUR } from './marks.ts';
import {
  type ConvexCard, type Struct, call, cardFromMeta, dailyValTime, digital, earlyCloseR, evPrint, exchangeSessions, forward,
  fxSessions, gate, liveSinceFill, markConvexity, normCdf, oneTouch, premium, rrOf, scoreR, sessionOf, spread, spreadP, spreadShare,
  value, valueAt, wholeDays, xnysVenue,
} from './convexity.ts';

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const eq4 = (got: number, want: number, what: string) => assert.equal(r4(got), want, `${what}: got ${got}`);
const near = (got: number | null, want: number) => assert.ok(got != null && Math.abs(got - want) < 1e-12, `got ${got}, want ${want}`);

const card = (o: Partial<ConvexCard> & { struct: Struct; k: number }): ConvexCard => ({
  kf: null, model: 'lognormal', fx: false, basePay: false, carry: 0, cut: 0, vol: 0, p0: null, p0fill: 1, ...o,
});

test('value function (body item 2), items 1–9', () => {
  eq4(digital('lognormal', false, 147.04, 144, 0.03721, true), 0.2809, '1 down digital, base pay');
  const ot2 = oneTouch('lognormal', 1.172, 1.1753, 1.215, 0.03327, false);
  eq4(ot2, 0.2997, '2 upper one-touch, terms pay');
  eq4(1 - ot2, 0.7003, '2 matching no-touch');
  eq4(spread('lognormal', true, 0.6582, 0.665, 0.685, 0.0527), 0.3095, '3 call spread');
  eq4(oneTouch('lognormal', 147.5, 147.04, 144, 0.03721, true), 0.5406, '4 lower one-touch, base pay');
  eq4(oneTouch('lognormal', 147.5, 147.04, 144, 0.03721, false), 0.553, '4 lower one-touch, terms pay');
  eq4(digital('lognormal', false, 147.04, 144, 0.03721, false), 0.2936, '5 down digital, terms pay');
  eq4(spread('lognormal', false, 0.6582, 0.65, 0.63, 0.0527), 0.3088, '6 put spread');
  eq4(digital('normal', true, 4.1, 4.3, 0.356), 0.2871, '7 normal up digital');
  eq4(oneTouch('normal', 4.1, 4.1, 4.4, 0.356), 0.3994, '8 normal one-touch');
  eq4(spread('normal', true, 4.1, 4.2, 4.5, 0.356), 0.2476, '9 normal call spread');
  eq4(spread('normal', false, 4.1, 4.0, 3.7, 0.356), 0.2476, '9 normal put spread by symmetry');
});

test('the same values through value(card, spot, n, sigma)', () => {
  // value() takes σ per session and n; n = 1 makes sd = σ.
  eq4(value(card({ struct: 'dig-dn', k: 144, basePay: true }), 147.04, 1, 0.03721), 0.2809, 'dig-dn');
  eq4(valueAt(card({ struct: 'nt-up', k: 1.215 }), 1.172, 1.1753, 0.03327), 0.7003, 'nt-up via valueAt');
  // a forward through the card's carry: F = S·exp(carry·D/365)
  eq4(valueAt(card({ struct: 'ot-up', k: 1.215 }), 1.172, 1.1753, 0.03327), 0.2997, 'ot-up via valueAt');
  eq4(value(card({ struct: 'cs', k: 0.665, kf: 0.685 }), 0.6582, 1, 0.0527), 0.3095, 'cs');
  eq4(value(card({ struct: 'ps', k: 0.65, kf: 0.63 }), 0.6582, 1, 0.0527), 0.3088, 'ps');
  eq4(value(card({ struct: 'ot-dn', k: 144, basePay: true }), 147.5, 1, 0.03721), r4(oneTouch('lognormal', 147.5, 147.5, 144, 0.03721, true)), 'ot-dn, F = S off FX');
  eq4(value(card({ struct: 'dig-up', k: 4.3, model: 'normal' }), 4.1, 1, 0.356), 0.2871, 'normal dig-up');
  eq4(value(card({ struct: 'ot-up', k: 4.4, model: 'normal' }), 4.1, 1, 0.356), 0.3994, 'normal ot-up');
  eq4(value(card({ struct: 'cs', k: 4.2, kf: 4.5, model: 'normal' }), 4.1, 1, 0.356), 0.2476, 'normal cs');
});

test('one-touch reflection term where exp(2ax/sd²) overflows', () => {
  // F at the barrier with a small sd: the second term is finite although its exponential is not.
  eq4(oneTouch('lognormal', 100, 110, 110, 0.004), 0.5076, 'F = H, sd 0.004'); // 50-digit reference 0.507570
  eq4(oneTouch('lognormal', 100, 110.5, 110, 0.004, true), 0.8763, 'F beyond H'); // reference 0.876266
  // where the plain product is finite, the log-space form agrees with it
  for (const [S, F, H, sd] of [[100, 104, 110, 0.012], [100, 108, 110, 0.006], [100, 93, 90, 0.008]]) {
    const x = Math.abs(Math.log(H / S)), m = Math.log(F / S) - (sd * sd) / 2, a = H > S ? m : -m;
    assert.ok((a + x) / sd > 7.08, 'the case reaches the tail branch');
    const plain = normCdf((a - x) / sd) + Math.exp((2 * a * x) / (sd * sd)) * normCdf((-a - x) / sd);
    assert.ok(Math.abs(oneTouch('lognormal', S, F, H, sd) - Math.min(1, plain)) < 1e-12, `${S} ${F} ${H} ${sd}`);
  }
});

test('guards, items 10–11', () => {
  assert.equal(value(card({ struct: 'ot-up', k: 1.215 }), 1.215, 20, 0.005), 1);
  assert.equal(value(card({ struct: 'ot-up', k: 1.215 }), 1.22, 20, 0.005), 1);
  assert.equal(value(card({ struct: 'nt-up', k: 1.215 }), 1.22, 20, 0.005), 0);
  assert.equal(value(card({ struct: 'ot-dn', k: 144 }), 143.9, 20, 0.005), 1);
  assert.equal(value(card({ struct: 'nt-dn', k: 144 }), 144, 20, 0.005), 0);
  // n = 0: the payoff at that price; digitals pay strictly beyond K.
  assert.equal(value(card({ struct: 'dig-dn', k: 144 }), 143.99, 0, 0.007), 1);
  assert.equal(value(card({ struct: 'dig-dn', k: 144 }), 144, 0, 0.007), 0);
  assert.equal(value(card({ struct: 'dig-up', k: 4.3, model: 'normal' }), 4.31, 0, 0.065), 1);
  assert.equal(value(card({ struct: 'ot-up', k: 1.215 }), 1.2, 0, 0.005), 0);
  assert.equal(value(card({ struct: 'nt-up', k: 1.215 }), 1.2, 0, 0.005), 1);
  eq4(value(card({ struct: 'cs', k: 0.665, kf: 0.685 }), 0.672, 0, 0.0072), 0.35, 'cs f');
  eq4(value(card({ struct: 'ps', k: 0.65, kf: 0.63 }), 0.645, 0, 0.0072), 0.25, 'ps f');
  assert.equal(value(card({ struct: 'cs', k: 0.665, kf: 0.685 }), 0.69, 0, 0.0072), 1);
});

const T0 = Date.UTC(2026, 9, 6, 1); // 01:00 UTC Tue 6 Oct, the expected fill
const fxCard = (o: Partial<ConvexCard> & { struct: Struct; k: number }) => card({ fx: true, ...o });

test('end-to-end example A (items 12–14)', () => {
  const cut = Date.UTC(2026, 10, 13, 15);
  const n = fxSessions(T0, cut), D = wholeDays(T0, cut);
  assert.equal(D, 38);
  eq4(n, 28.5833, 'n');
  const c = fxCard({ struct: 'dig-dn', k: 144, basePay: true, carry: -0.03, cut, vol: 0.00696 });
  eq4(forward(147.5, -0.03, D), 147.04, 'F');
  assert.equal(Math.round(0.00696 * Math.sqrt(n) * 1e6) / 1e6, 0.037211);
  const vHi = value(c, 147.5, n, 0.00696, D);
  eq4(vHi, 0.2809, 'V at σ_hi');
  eq4(value(c, 147.5, n, 0.0052, D), 0.222, 'V at σ_lo');
  assert.equal(Math.round(0.0052 * Math.sqrt(n) * 1e6) / 1e6, 0.027801);
  const p0 = premium(Math.max(vHi, value(c, 147.5, n, 0.0052, D)), true, 1);
  assert.equal(p0, 0.291);
  eq4(rrOf(p0), 2.4364, 'rr');
  eq4(0.4 / p0 - 1, 0.3746, 'EV at p 0.40');
  assert.equal(evPrint(0.4, p0), 0.37);

  // 13: the fill recomputes F, n, D and V at the fill price with the card's σ.
  eq4(forward(147.2, -0.03, D), 146.741, 'F at fill');
  const vF = value(c, 147.2, n, 0.00696, D);
  eq4(vF, 0.2997, 'V at fill 147.20');
  const p0fill = premium(vF, true, 1);
  assert.equal(p0fill, 0.31);
  eq4(rrOf(p0fill), 2.2258, 'rr_fill');
  const vM = value(c, 145.8, n, 0.00696, D);
  eq4(vM, 0.3942, 'V at fill 145.80');
  assert.equal(premium(vM, true, 1), 0.404);
  assert.ok(Math.round(0.4 * 1000) < Math.round(premium(vM, true, 1) * 1000), 'MISSED: p < p0fill in tenths');

  // 14: the 15 Oct daily bar is valued at 00:00 UTC 16 Oct.
  const t14 = dailyValTime(c, '2026-10-15');
  assert.equal(t14, Date.UTC(2026, 9, 16));
  const n14 = fxSessions(t14, cut), D14 = wholeDays(t14, cut);
  assert.equal(n14, 20.625);
  assert.equal(D14, 28);
  eq4(forward(146.1, -0.03, D14), 145.7642, 'F 14');
  assert.equal(Math.round(0.00696 * Math.sqrt(n14) * 1e6) / 1e6, 0.031609);
  const v14 = value(c, 146.1, n14, 0.00696, D14);
  eq4(v14, 0.3442, 'V 14');
  eq4(value(c, 146.1, n14, 0.00696, 29), 0.3452, 'V 14 with D from the bar date (wrong)');
  eq4(scoreR(v14, 0.291), 0.1828, 'R at 0.291');
  eq4(earlyCloseR(true, v14, 0.291, 1), 0.1484, 'early close at 0.291');
  eq4(scoreR(v14, 0.31), 0.1103, 'R at 0.310');
  eq4(earlyCloseR(true, v14, 0.31, 1), 0.0781, 'early close at 0.310');
});

test('example B (item 15)', () => {
  const cut = Date.UTC(2026, 11, 4, 15);
  const n = fxSessions(T0, cut), D = wholeDays(T0, cut);
  assert.equal(D, 59);
  eq4(n, 43.5833, 'n');
  eq4(forward(1.172, 0.0175, D), 1.1753, 'F');
  const c = fxCard({ struct: 'ot-up', k: 1.215, carry: 0.0175, cut });
  assert.equal(Math.round(0.00504 * Math.sqrt(n) * 1e6) / 1e6, 0.033273);
  eq4(value(c, 1.172, n, 0.00504, D), 0.2999, 'V at σ_hi');
  assert.equal(Math.round(0.0038 * Math.sqrt(n) * 1e6) / 1e6, 0.025087);
  eq4(value(c, 1.172, n, 0.0038, D), 0.1737, 'V at σ_lo');
  eq4(value({ ...c, struct: 'nt-up' }, 1.172, n, 0.0038, D), 0.8263, 'no-touch at σ_lo');
  const F = forward(1.172, 0.0175, D), sd = 0.00504 * Math.sqrt(n);
  eq4(2 * digital('lognormal', true, F, 1.215, sd), 0.3103, "R01's 2 × terminal");
});

test('example C (item 16)', () => {
  const cut = Date.UTC(2026, 11, 18, 15);
  const n = fxSessions(T0, cut), D = wholeDays(T0, cut);
  assert.equal(D, 73);
  eq4(n, 53.5833, 'n');
  const F = forward(0.658, 0.0015, D);
  eq4(F, 0.6582, 'F');
  const c = fxCard({ struct: 'cs', k: 0.665, kf: 0.685, carry: 0.0015, cut });
  assert.equal(Math.round(0.0072 * Math.sqrt(n) * 1e6) / 1e6, 0.052704);
  const v = value(c, 0.658, n, 0.0072, D);
  eq4(v, 0.3095, 'V at σ_hi');
  assert.equal(Math.round(0.0055 * Math.sqrt(n) * 1e6) / 1e6, 0.04026);
  eq4(value(c, 0.658, n, 0.0055, D), 0.264, 'V at σ_lo');
  assert.equal(premium(v, false, 1), 0.325);
  eq4(rrOf(0.325), 2.0769, 'rr');
  assert.equal((v * 100).toFixed(2), '30.95');
  const sd = 0.0072 * Math.sqrt(n);
  const q = [0.665, 0.675, 0.685].map((k) => digital('lognormal', true, F, k, sd));
  assert.deepEqual(q.map(r4), [0.4124, 0.3069, 0.2166]);
  eq4((q[0] + 4 * q[1] + q[2]) / 6, 0.3094, 'Simpson');
  assert.equal(Math.round((Math.log(0.685 / 0.665) / sd) * 100) / 100, 0.56);
});

test('gate arithmetic (items 17–18)', () => {
  const p = spreadP([57, 43, 31]);
  assert.equal(p, 0.433);
  eq4(p / 0.325 - 1, 0.3323, 'EV');
  assert.deepEqual(gate(p, 0.325), { pass: true, pgate: false, thin: false, ev: 0.33 });
  const p2 = spreadP([55, 42, 30]);
  assert.equal(p2, 0.422);
  eq4(p2 / 0.325 - 1, 0.2985, 'EV thin');
  assert.deepEqual(gate(p2, 0.325), { pass: true, pgate: false, thin: true, ev: 0.29 });
  // the +0.30R boundary is full edge and prints +0.30R; the naive floors print 0.29
  assert.deepEqual(gate(0.143, 0.11), { pass: true, pgate: false, thin: false, ev: 0.3 });
  assert.equal(Math.floor((0.143 / 0.11 - 1) * 100) / 100, 0.29);
  assert.deepEqual(gate(0.13, 0.1), { pass: true, pgate: false, thin: false, ev: 0.3 });
  const rr = 1 / 0.1 - 1;
  assert.equal(Math.floor((0.13 * rr - (1 - 0.13)) * 100) / 100, 0.29);
  // the premium floor stays; the p ≤ 75% cap and the premium ≤ 50% limit are gone (8 Oct 2026)
  assert.equal(gate(0.13, 0.099).pass, false);
  assert.equal(gate(0.76, 0.5).pass, true);
  assert.equal(gate(0.7, 0.501).pass, true);
  // EV > 0 since 9 Oct 2026: p must beat p0, and under 1.3 × p0 the card is thin edge
  assert.equal(gate(0.5, 0.5).pass, false);
  assert.deepEqual(gate(0.51, 0.5), { pass: true, pgate: true, thin: true, ev: 0.02 });
  assert.equal(spreadP([60, 50, 40, 30, 20]), 0.4); // five-point rule: (60 + 200 + 80 + 120 + 20)/12
});

test('settlement and paid (items 19–20)', () => {
  const kn = 0.665, kf = 0.685;
  eq4(scoreR(spreadShare(0.66, kn, kf), 0.325), -1, 'f 0');
  eq4(spreadShare(0.672, kn, kf), 0.35, 'f');
  eq4(scoreR(spreadShare(0.672, kn, kf), 0.325), 0.0769, 'f 0.35');
  eq4(scoreR(spreadShare(0.69, kn, kf), 0.325), 2.0769, 'f 1');
});

// ---------- Monte Carlo ----------

function rng(seed: number) {
  let s = seed >>> 0;
  const uniform = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare: number | null = null;
  const normal = () => {
    if (spare != null) { const z = spare; spare = null; return z; }
    let a = 0; while (a === 0) a = uniform();
    const r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * uniform();
    spare = r * Math.sin(th); return r * Math.cos(th);
  };
  return { uniform, normal };
}

// x = log price (lognormal) or price (normal), total drift m over the horizon. With a barrier, the path
// is simulated in `steps` and a crossing between steps is drawn from the Brownian bridge,
// P = exp(−2 (b − x)(b − y) / s²), so monitoring is continuous; otherwise `terminal` is the payoff of x_T.
function mc(o: { x0: number; m: number; sd: number; paths: number; steps: number; seed: number; barrier?: number; terminal?: (xT: number) => number }) {
  const g = rng(o.seed);
  const s = o.sd / Math.sqrt(o.steps), mu = o.m / o.steps;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < o.paths; i++) {
    let v: number;
    if (o.barrier != null) {
      const b = o.barrier, up = b > o.x0;
      let x = o.x0, hit = false;
      for (let k = 0; k < o.steps && !hit; k++) {
        const y = x + mu + s * g.normal();
        hit = (up ? y >= b : y <= b) || g.uniform() < Math.exp((-2 * (b - x) * (b - y)) / (s * s));
        x = y;
      }
      v = hit ? 1 : 0;
    } else v = o.terminal!(o.x0 + o.m + o.sd * g.normal());
    sum += v; sum2 += v * v;
  }
  const mean = sum / o.paths;
  return { mean, se: Math.sqrt(Math.max(0, sum2 / o.paths - mean * mean) / o.paths) };
}

const close = (got: { mean: number; se: number }, want: number, what: string) =>
  assert.ok(Math.abs(got.mean - want) < 4 * got.se + 1e-3, `${what}: MC ${got.mean.toFixed(4)} ± ${got.se.toFixed(4)} vs ${want.toFixed(4)}`);

test('Monte Carlo cross-check of the closed forms', () => {
  const P = 200000;
  // digital, base pay: log S_T = ln F + sd²/2 + sd·Z under the base-currency measure
  {
    const F = 147.04, K = 144, sd = 0.03721;
    close(mc({ x0: Math.log(F), m: sd * sd / 2, sd, paths: P, steps: 1, seed: 1, terminal: (x) => (x < Math.log(K) ? 1 : 0) }),
      digital('lognormal', false, F, K, sd, true), 'dig-dn base');
    close(mc({ x0: Math.log(F), m: -sd * sd / 2, sd, paths: P, steps: 1, seed: 2, terminal: (x) => (x < Math.log(K) ? 1 : 0) }),
      digital('lognormal', false, F, K, sd, false), 'dig-dn terms');
  }
  // call spread on the forward: E[(S − k)+] with E[S] = F
  {
    const F = 0.6582, sd = 0.0527, kn = 0.665, kf = 0.685;
    close(mc({ x0: Math.log(F), m: -sd * sd / 2, sd, paths: P, steps: 1, seed: 3, terminal: (x) => spreadShare(Math.exp(x), kn, kf) }),
      spread('lognormal', true, F, kn, kf, sd), 'cs');
    close(mc({ x0: Math.log(F), m: -sd * sd / 2, sd, paths: P, steps: 1, seed: 4, terminal: (x) => spreadShare(Math.exp(x), 0.65, 0.63) }),
      spread('lognormal', false, F, 0.65, 0.63, sd), 'ps');
  }
  // normal model
  {
    const F = 4.1, sd = 0.356;
    close(mc({ x0: F, m: 0, sd, paths: P, steps: 1, seed: 5, terminal: (x) => (x > 4.3 ? 1 : 0) }), digital('normal', true, F, 4.3, sd), 'normal dig-up');
    close(mc({ x0: F, m: 0, sd, paths: P, steps: 1, seed: 6, terminal: (x) => spreadShare(x, 4.2, 4.5) }), spread('normal', true, F, 4.2, 4.5, sd), 'normal cs');
    assert.ok(Math.abs(call('normal', F, 4.2, sd) - mc({ x0: F, m: 0, sd, paths: P, steps: 1, seed: 7, terminal: (x) => Math.max(0, x - 4.2) }).mean) < 3e-3);
    close(mc({ x0: F, m: 0, sd, paths: 100000, steps: 50, seed: 8, barrier: 4.4 }), oneTouch('normal', F, F, 4.4, sd), 'normal ot');
  }
  // one-touch with drift (both payout conventions), continuous monitoring by Brownian bridge
  {
    const S = 1.172, F = 1.1753, H = 1.215, sd = 0.03327;
    const m1 = mc({ x0: Math.log(S), m: Math.log(F / S) - sd * sd / 2, sd, paths: 100000, steps: 50, seed: 9, barrier: Math.log(H) });
    close(m1, oneTouch('lognormal', S, F, H, sd, false), 'ot-up terms');
    // the check discriminates: the other payout convention lies outside its band
    assert.ok(Math.abs(m1.mean - oneTouch('lognormal', S, F, H, sd, true)) > 4 * m1.se + 1e-3);
    const S2 = 147.5, F2 = 147.04, H2 = 144, sd2 = 0.03721;
    close(mc({ x0: Math.log(S2), m: Math.log(F2 / S2) + sd2 * sd2 / 2, sd: sd2, paths: 100000, steps: 50, seed: 10, barrier: Math.log(H2) }),
      oneTouch('lognormal', S2, F2, H2, sd2, true), 'ot-dn base');
  }
  assert.ok(Math.abs(normCdf(1.959963984540054) - 0.975) < 1e-12);
});

// ---------- card parsing and marking ----------

test('cardFromMeta', () => {
  const meta = { struct: 'dig-dn', strike: '144.00', cut: '2026-11-13 23:00 SGT', pay: 'USD', vol: '0.696%', carry: '-3.00% (terms − base)', p0: '29.1%', p0fill: '31.0%' };
  const c = cardFromMeta('JPY=X', meta, '') as ConvexCard;
  assert.equal(typeof c, 'object');
  assert.equal(c.cut, Date.UTC(2026, 10, 13, 15));
  assert.equal(c.fx, true); assert.equal(c.basePay, true); assert.equal(c.model, 'lognormal');
  near(c.vol, 0.00696); near(c.carry, -0.03); near(c.p0fill, 0.31); near(c.p0, 0.291);
  const e = cardFromMeta('EURUSD=X', { ...meta, struct: 'ot-up', strike: '1.2150', pay: 'USD', carry: '+1.75%' }, '') as ConvexCard;
  assert.equal(e.basePay, false); near(e.carry, 0.0175);
  const s = cardFromMeta('AUDUSD=X', { ...meta, struct: 'cs', strike: '0.6650/0.6850', pay: '-', p0fill: '-' }, '') as ConvexCard;
  assert.equal(s.k, 0.665); assert.equal(s.kf, 0.685); near(s.p0fill, 0.291); // p0fill falls back to p0
  const y = cardFromMeta('^TNX', { ...meta, struct: 'ot-up', strike: '4.40', vol: '0.065', carry: '0', pay: '-' }, '') as ConvexCard;
  assert.equal(y.model, 'normal'); assert.equal(y.fx, false); near(y.vol, 0.065); assert.equal(y.carry, 0);
  near((cardFromMeta('^TNX', { ...meta, vol: '6.5 bp' }, '') as ConvexCard).vol, 0.065);
  assert.equal((cardFromMeta('ES=F-NQ=F', meta, '-') as ConvexCard).model, 'normal');
  assert.equal((cardFromMeta('GC=F/SI=F', meta, '/') as ConvexCard).model, 'lognormal');
  assert.equal(cardFromMeta('JPY=X', { ...meta, struct: 'straddle' }, ''), 'struct straddle');
  assert.equal(cardFromMeta('JPY=X', { ...meta, struct: 'cs' }, ''), 'strike 144.00');
  // a lognormal vol above 0.1 without '%' is refused, not read as 69.6% per session
  assert.equal(cardFromMeta('JPY=X', { ...meta, vol: '0.696' }, ''), "vol 0.696: lognormal vol needs '%'");
  near((cardFromMeta('JPY=X', { ...meta, vol: '0.00696' }, '') as ConvexCard).vol, 0.00696);
  near((cardFromMeta('^TNX', { ...meta, vol: '0.65' }, '') as ConvexCard).vol, 0.65); // normal model: proxy units
});

test('cards are marked only on FX and the XNYS calendar', () => {
  const meta = { struct: 'dig-up', strike: '100', cut: '2026-11-13 23:00 SGT', vol: '1.2%', p0fill: '30%' };
  for (const s of ['JPY=X', 'EURUSD=X', '^TNX', '^GSPC', 'ES=F', 'GC=F', 'SPY', 'BRK-B', 'DX-Y.NYB', 'BZZ26.NYM']) {
    assert.ok(xnysVenue(s), s);
    assert.equal(typeof cardFromMeta(s, meta, ''), 'object', s);
  }
  assert.equal(cardFromMeta('^N225', meta, ''), 'venue ^N225: not on the XNYS calendar');
  assert.equal(cardFromMeta('7203.T', meta, ''), 'venue 7203.T: not on the XNYS calendar');
  assert.equal(cardFromMeta('^STOXX50E', meta, ''), 'venue ^STOXX50E: not on the XNYS calendar');
  assert.equal(cardFromMeta('BHP.AX', meta, ''), 'venue BHP.AX: not on the XNYS calendar');
  assert.equal(typeof cardFromMeta('^TYX-^FVX', meta, '-', ['^TYX', '^FVX']), 'object');
  assert.equal(cardFromMeta('^N225-^GSPC', meta, '-', ['^N225', '^GSPC']), 'venue ^N225: synthetic legs must be US venues');
  // a synthetic of FX legs has no single calendar either
  assert.equal(cardFromMeta('EURUSD=X/GBPUSD=X', meta, '/', ['EURUSD=X', 'GBPUSD=X']), 'venue EURUSD=X, GBPUSD=X: synthetic legs must be US venues');
});

test('exchange sessions skip weekends and NYSE holidays', () => {
  // Fri 20 Nov 2026 close → Fri 27 Nov close (Thanksgiving 26 Nov): Mon, Tue, Wed, Fri = 4
  assert.equal(exchangeSessions(Date.UTC(2026, 10, 20, 21, 30), Date.UTC(2026, 10, 27, 21)), 4);
  // a fill before Monday's close counts Monday; cut stated as 05:00 SGT Sat 28 Nov (Fri NY close, EST)
  assert.equal(exchangeSessions(Date.UTC(2026, 10, 23, 15), Date.UTC(2026, 10, 27, 21)), 4);
  // EDT close (20:00 UTC) on the cut date counts
  assert.equal(exchangeSessions(Date.UTC(2026, 9, 5, 21), Date.UTC(2026, 9, 9, 20)), 4);
});

test('XNYS session of an hourly bar', () => {
  assert.equal(sessionOf(Date.UTC(2026, 9, 4, 22)), '2026-10-05'); // Sunday-evening futures bar → Monday
  assert.equal(sessionOf(Date.UTC(2026, 9, 5, 19)), '2026-10-05'); // before the 20:00 UTC EDT close
  assert.equal(sessionOf(Date.UTC(2026, 9, 9, 20)), '2026-10-12'); // Friday after the close → Monday
  assert.equal(sessionOf(Date.UTC(2026, 10, 25, 22)), '2026-11-27'); // Wed after the close, Thanksgiving skipped
});

const H0 = Date.UTC(2026, 9, 1); // hourly history starts 1 Oct

// 20 weekday sessions before a Monday fill: the latest 10 with a 0.1 range, the 10 before with 1.0, plus
// Sunday-evening FX bars (21:00–23:00 UTC, range 0.1). The median range of the 20 sessions is 1.0; counting
// the Sundays as dates would pull in fewer large days and drop it to 0.1.
test('liveSinceFill: the 20 sessions of an FX symbol are Mon–Fri UTC dates', () => {
  const fill = Date.UTC(2026, 9, 12); // Mon 12 Oct 00:00 UTC
  const bars: Bar[] = [];
  let k = 0;
  for (let d = fill - 24 * HOUR; k < 20; d -= 24 * HOUR) {
    const w = new Date(d).getUTCDay();
    if (w === 6) continue;
    if (w === 0) { for (let h = 21; h < 24; h++) bars.push({ ts: d + h * HOUR, o: 1.02, h: 1.05, l: 0.95, c: 1 }); continue; }
    const r = k < 10 ? 0.1 : 1;
    for (let h = 0; h < 24; h++) bars.push({ ts: d + h * HOUR, o: 1 + r / 4, h: 1 + r / 2, l: 1 - r / 2, c: 1 });
    k++;
  }
  bars.sort((a, b) => a.ts - b.ts);
  const probe: Bar = { ts: fill + 2 * HOUR, o: 1.01, h: 1.05, l: 0.95, c: 1 }; // range 0.1, 4 prices
  const fx = liveSinceFill([...bars, probe], fill, true);
  assert.equal(fx[fx.length - 1].live, false, 'floor 0.15 from the 20 weekdays');
  // the old count (any UTC date) reached only 16–17 weekdays and set the floor at 0.015
  const anyDate = [...new Set(bars.map((b) => new Date(b.ts).toISOString().slice(0, 10)))].slice(-20);
  const old = bars.filter((b) => anyDate.includes(new Date(b.ts).toISOString().slice(0, 10))).map((b) => b.h - b.l).sort((a, b) => a - b);
  assert.ok(old[Math.floor(old.length / 2)] < 0.2);
});

test('liveSinceFill: off FX the 20 sessions are XNYS session dates', () => {
  // Futures-style bars 22:00–20:00 UTC: the evening bars belong to the next session, holidays add none.
  // Sessions before the fill: the latest 10 with a 0.1 range, the 10 before with 1.0 → floor 0.15.
  const fill = Date.UTC(2026, 10, 30, 14); // Mon 30 Nov, after Thanksgiving week
  const sess: string[] = [];
  for (let d = Date.UTC(2026, 10, 27); sess.length < 20; d -= 24 * HOUR) {
    const s = new Date(d).toISOString().slice(0, 10), w = new Date(d).getUTCDay();
    if (w !== 0 && w !== 6 && s !== '2026-11-26') sess.unshift(s);
  }
  const bars: Bar[] = [];
  sess.forEach((s, i) => {
    const r = i >= 10 ? 0.1 : 1, close = Date.parse(s + 'T21:00:00Z');
    // 23 bars ending at the close, the first ones on the evening before (a Sunday for Monday's session)
    for (let t = close - 23 * HOUR; t < close; t += HOUR) bars.push({ ts: t, o: 1 + r / 4, h: 1 + r / 2, l: 1 - r / 2, c: 1 });
  });
  assert.equal(new Set(bars.map((b) => sessionOf(b.ts))).size, 20);
  const probe: Bar = { ts: fill, o: 1.01, h: 1.05, l: 0.95, c: 1 };
  const lv = liveSinceFill([...bars, probe], fill, false);
  assert.equal(lv[lv.length - 1].live, false, 'floor 0.15 from the 20 sessions');
  // counted as UTC dates the evening bars add dates of their own and the window loses large days
  const anyDate = [...new Set(bars.map((b) => new Date(b.ts).toISOString().slice(0, 10)))].slice(-20);
  const old = bars.filter((b) => anyDate.includes(new Date(b.ts).toISOString().slice(0, 10))).map((b) => b.h - b.l).sort((a, b) => a - b);
  assert.ok(old[Math.floor(old.length / 2)] < 0.2);
});
function hourly(from: number, to: number, f: (t: number) => number, range = 0.1): Bar[] {
  const out: Bar[] = [];
  for (let t = from; t < to; t += HOUR) {
    const w = new Date(t).getUTCDay(); if (w === 0 || w === 6) continue;
    const c = f(t); out.push({ ts: t, o: c + range / 4, h: c + range / 2, l: c - range / 2, c });
  }
  return out;
}

test('markConvexity: model mark, touch on live bars only, settlement', () => {
  const cut = Date.UTC(2026, 10, 13, 15);
  const c = fxCard({ struct: 'ot-dn', k: 144, basePay: true, carry: -0.03, cut, vol: 0.00696, p0fill: 0.31 });
  const fill = T0;
  let bars = hourly(H0, Date.UTC(2026, 9, 15, 12), () => 146.5);
  // a pre-fill spike and a flat requote below the barrier after the fill: neither counts
  bars.find((b) => b.ts === Date.UTC(2026, 9, 5, 10))!.l = 143;
  const rq = bars.find((b) => b.ts === Date.UTC(2026, 9, 9, 22))!; rq.o = rq.h = 146.5; rq.l = rq.c = 143.5;
  const lv = liveSinceFill(bars, fill, true);
  assert.equal(lv.find((b) => b.ts === rq.ts)!.live, false);
  const now = Date.UTC(2026, 9, 15, 12);
  const m = markConvexity(c, lv, [], fill, now)!;
  assert.equal(m.touched_at, null);
  assert.equal(m.price, 146.5);
  const want = value(c, 146.5, fxSessions(Date.UTC(2026, 9, 15, 12), cut), 0.00696, wholeDays(Date.UTC(2026, 9, 15, 12), cut));
  eq4(m.v, r4(want), 'V');
  eq4(m.r, r4(want / 0.31 - 1), 'R');
  assert.equal(m.stop_touched, null); assert.equal(m.target_touched, null);

  // a live hourly low through the barrier touches and freezes the card at +rr_fill
  bars = hourly(H0, Date.UTC(2026, 9, 20, 12), () => 146.5);
  const hit = bars.find((b) => b.ts === Date.UTC(2026, 9, 16, 3))!; hit.l = 143.95; hit.o = 146.4;
  const t = markConvexity(c, liveSinceFill(bars, fill, true), [], fill, Date.UTC(2026, 9, 20, 12))!;
  assert.equal(t.touched_at, hit.ts); assert.equal(t.touched_px, 143.95);
  assert.equal(t.paid, 1, 'item 20: paid = 1 exactly');
  eq4(t.r, 2.2258, 'touched one-touch R'); assert.equal(t.daily_r, t.r); assert.equal(t.target_touched, true);
  // the same path for a no-touch: −1R, stop_touched
  const nt = markConvexity({ ...c, struct: 'nt-dn' }, liveSinceFill(bars, fill, true), [], fill, Date.UTC(2026, 9, 20, 12))!;
  assert.equal(nt.r, -1); assert.equal(nt.stop_touched, true);

  // a complete daily close beyond H also touches, timed at that close
  const daily: Bar[] = [{ ts: Date.UTC(2026, 9, 14), o: 145, h: 145, l: 143.9, c: 143.9 }];
  const dt = markConvexity(c, liveSinceFill(hourly(H0, Date.UTC(2026, 9, 15), () => 146.5), fill, true), daily, fill, Date.UTC(2026, 9, 15))!;
  assert.equal(dt.touched_at, Date.UTC(2026, 9, 15)); assert.equal(dt.touched_px, 143.9);

  // settlement of a digital on the live hourly bar ending at the cut (14:00–15:00 UTC, EST)
  const d = fxCard({ struct: 'dig-dn', k: 144, basePay: true, carry: -0.03, cut, vol: 0.00696, p0fill: 0.31 });
  const sb = hourly(H0, Date.UTC(2026, 10, 13, 20), (x) => (x < cut - HOUR ? 145 : x === cut - HOUR ? 143.8 : 146));
  const st = markConvexity(d, liveSinceFill(sb, fill, true), [], fill, Date.UTC(2026, 10, 13, 20))!;
  assert.equal(st.settled_px, 143.8); assert.equal(st.paid, 1); eq4(st.r, 2.2258, 'settled win'); assert.equal(st.target_closed, true);
  const sl = markConvexity({ ...d, k: 143 }, liveSinceFill(sb, fill, true), [], fill, Date.UTC(2026, 10, 13, 20))!;
  assert.equal(sl.paid, 0); assert.equal(sl.r, -1); assert.equal(sl.stop_closed, true);
  // an untouched no-touch at the cut pays
  const ntS = markConvexity({ ...d, struct: 'nt-dn', k: 140 }, liveSinceFill(sb, fill, true), [], fill, Date.UTC(2026, 10, 13, 20))!;
  assert.equal(ntS.paid, 1);

  // a non-FX spread settles on the daily close dated the cut
  const y = card({ struct: 'cs', k: 4.2, kf: 4.5, model: 'normal', cut: Date.UTC(2026, 10, 13, 21), vol: 0.065, p0fill: 0.26 });
  const yd: Bar[] = [{ ts: Date.UTC(2026, 10, 12, 5), o: 4.3, h: 4.3, l: 4.3, c: 4.3 }, { ts: Date.UTC(2026, 10, 13, 5), o: 4.3, h: 4.3, l: 4.3, c: 4.35 }];
  const yh = hourly(H0, Date.UTC(2026, 10, 13, 21), () => 4.33, 0.02);
  const ys = markConvexity(y, liveSinceFill(yh, fill, false), yd, fill, Date.UTC(2026, 10, 14, 2))!;
  assert.equal(ys.settled_px, 4.35); eq4(ys.paid!, 0.5, 'f'); eq4(ys.r, r4(0.5 / 0.26 - 1), 'spread R');

  // no live hourly bar at all: no mark (dash-mark lists the card as 'no live hourly bars')
  assert.equal(markConvexity(c, [], [], fill, now), null);
  const flat = hourly(H0, Date.UTC(2026, 9, 15, 12), () => 146.5).map((b) => ({ ...b, o: 146.5, h: 146.5, l: 146.5 }));
  assert.equal(markConvexity(c, liveSinceFill(flat, fill, true), [], fill, now), null);
});
