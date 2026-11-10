// The option twin of a cash FX card (rule R18): terms line, premium at the fill, marks, touch, settlement, early close.
// Run: npx -y tsx --test supabase/functions/_shared/twin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Bar, HOUR } from './marks.ts';
import { digital, earlyCloseR, liveSinceFill, oneTouch, premium, type Struct, valueAtTime } from './convexity.ts';
import {
  exitBar, fxPair, markTwin, parseTwin, scoreTwin, smileShare, type TwinCard, twinCard, twinFrozen, twinMeta, type TwinMark, twinTier, type TwinTrade, twinValue, vvCall,
} from './twin.ts';

const DAY = 24 * HOUR;
const H0 = Date.UTC(2026, 9, 1); // hourly history starts Thu 1 Oct 2026
const FILL = Date.UTC(2026, 10, 2, 1); // Mon 2 Nov 09:00 SGT
const LINE = 'TWIN: ot-dn · strike 155.50 · cut 2026-11-25 · pay USD · iv 6.7% DTCC 2026-11-09 · carry -2.90%';

function hourly(from: number, to: number, f: (t: number) => number, range = 0.1): Bar[] {
  const out: Bar[] = [];
  for (let t = from; t < to; t += HOUR) {
    const w = new Date(t).getUTCDay(); if (w === 0 || w === 6) continue;
    const c = f(t); out.push({ ts: t, o: c + range / 4, h: c + range / 2, l: c - range / 2, c });
  }
  return out;
}
const ok = <T>(x: T | string): T => { assert.notEqual(typeof x, 'string', String(x)); return x as T; };
const err = (x: unknown, re: RegExp) => { assert.equal(typeof x, 'string', JSON.stringify(x)); assert.match(x as string, re); };
const near = (got: number, want: number, tol = 1e-12) => assert.ok(Math.abs(got - want) < tol, `got ${got}, want ${want}`);

test('pairs and dealing-cost tiers', () => {
  assert.deepEqual(fxPair('EURUSD=X'), ['EUR', 'USD']);
  assert.deepEqual(fxPair('jpy=x'), ['USD', 'JPY']);
  assert.equal(fxPair('GC=F'), null);
  assert.equal(fxPair('EURUSD=X/GBPUSD=X'), null);
  for (const p of ['EURUSD=X', 'JPY=X', 'EURGBP=X', 'AUDJPY=X', 'CHF=X', 'NOK=X']) assert.equal(twinTier(p), 1, p);
  for (const p of ['KRW=X', 'SGD=X', 'CNH=X', 'EURSGD=X', 'INR=X', 'GC=F']) assert.equal(twinTier(p), 2, p);
});

test('the terms line', () => {
  assert.deepEqual(parseTwin(LINE), { struct: 'ot-dn', strike: '155.50', cut: '2026-11-25', pay: 'USD', iv: '6.7% DTCC 2026-11-09', carry: '-2.90%' });
  assert.deepEqual(parseTwin(LINE.replace('TWIN: ', '')), parseTwin(LINE));
  err(parseTwin('ot-dn · strike 155.50 · cut 2026-11-25'), /iv missing/);
  err(parseTwin('TWIN:'), /empty/);

  const c = ok<TwinCard>(twinCard('JPY=X', LINE, -1));
  assert.equal(c.struct, 'ot-dn'); assert.equal(c.k, 155.5); assert.equal(c.kf, null); assert.equal(c.fx, true);
  assert.equal(c.basePay, true); assert.equal(c.model, 'lognormal');
  near(c.carry, -0.029); near(c.vol, 0.067 / Math.sqrt(252));
  assert.equal(c.cut, Date.UTC(2026, 10, 25, 15), '10:00 New York under EST is 15:00 UTC');
  // the same cut under daylight time, and one written with its SGT time
  assert.equal(ok<TwinCard>(twinCard('JPY=X', LINE.replace('2026-11-25', '2026-10-20'), -1)).cut, Date.UTC(2026, 9, 20, 14));
  assert.equal(ok<TwinCard>(twinCard('JPY=X', LINE.replace('2026-11-25', '2026-11-25 23:00 SGT'), -1)).cut, Date.UTC(2026, 10, 25, 15));
  // terms pay unless the base currency is named; a spread ignores it
  assert.equal(ok<TwinCard>(twinCard('JPY=X', LINE.replace('pay USD', 'pay -'), -1)).basePay, false);
  assert.equal(ok<TwinCard>(twinCard('JPY=X', LINE.replace('pay USD', 'pay JPY (terms)'), -1)).basePay, false);
  assert.equal(ok<TwinCard>(twinCard('JPY=X', LINE.replace(' · pay USD', ''), -1)).basePay, false);
  // spreads: Kn is the strike nearer the spot; thousands separators and a typographic minus are read
  const ps = ok<TwinCard>(twinCard('KRW=X', 'ps · strike 1,335/1,310 · cut 2026-11-25 · pay - · iv 10.4% DTCC 2026-11-09 [5d] · carry −1.30%', -1));
  assert.equal(ps.k, 1335); assert.equal(ps.kf, 1310); near(ps.carry, -0.013);
  const cs = ok<TwinCard>(twinCard('EURUSD=X', 'cs · strike 1.1650/1.1850 · cut 2026-12-01 · pay - · iv 5.7% · carry +1.40%', 1));
  assert.equal(cs.k, 1.165); assert.equal(cs.kf, 1.185); near(cs.carry, 0.014);
  assert.equal(ok<TwinCard>(twinCard('KRW=X', 'dig-dn · strike 1,320 · cut 2026-11-25 · iv 10.4%', -1)).k, 1320);
  near(ok<TwinCard>(twinCard('JPY=X', LINE.replace(' · carry -2.90%', ''), -1)).carry, 0);

  // the smile: vol stays the at-the-money vol; a risk reversal adds the two 25-delta vols, annual per cent ÷ √252
  const ann = (x: number) => x * Math.sqrt(252) * 100;
  const wings = (line: string, proxy = 'JPY=X', dir = -1) => {
    const c = ok<TwinCard>(twinCard(proxy, line, dir));
    near(ann(c.vol), parseFloat(line.match(/iv ([\d.]+)%/)![1]), 1e-9);
    return c.wings && [ann(c.wings.c), ann(c.wings.p)];
  };
  assert.equal(c.wings, null, 'no rr on the line: flat at the at-the-money vol');
  const w = wings(LINE.replace(' · carry', ' · rr -1.95 · bf 0.23 · carry'))!; // puts over
  near(w[0], 6.7 + 0.23 - 0.975, 1e-9); near(w[1], 6.7 + 0.23 + 0.975, 1e-9);
  assert.equal(wings(LINE.replace(' · carry', ' · rr - · bf - · carry')), null);
  assert.equal(wings(LINE.replace(' · carry', ' · bf 0.23 · carry')), null, 'a butterfly alone is no smile');
  const nb = wings(LINE.replace(' · carry', ' · rr -1.95 · carry'))!;             // no butterfly printed
  near(nb[0], 6.7 - 0.975, 1e-9); near(nb[1], 6.7 + 0.975, 1e-9);
  const kw = wings('cs · strike 1,350/1,380 · cut 2026-11-25 · iv 10.4% · rr +0.75 · bf 0.30 · carry -1.30%', 'KRW=X', 1)!;
  near(kw[0], 10.4 + 0.3 + 0.375, 1e-9); near(kw[1], 10.4 + 0.3 - 0.375, 1e-9);
  const eu = wings('dig-up · strike 1.1650 · cut 2026-12-01 · iv 5.7% · rr −0.33 · bf 0.16', 'EURUSD=X', 1)!; // a typographic minus
  near(eu[0], 5.7 + 0.16 - 0.165, 1e-9); near(eu[1], 5.7 + 0.16 + 0.165, 1e-9);
  err(twinCard('JPY=X', LINE.replace(' · carry', ' · rr skewed · carry'), -1), /^rr/);
  err(twinCard('JPY=X', LINE.replace(' · carry', ' · rr -19.5 · carry'), -1), /^rr/);
  err(twinCard('JPY=X', LINE.replace(' · carry', ' · rr -1.95 · bf 23 · carry'), -1), /^bf/);
  err(twinCard('JPY=X', LINE.replace(' · carry', ' · rr +11.5 · carry'), -1), /^rr \+11.5 against iv/); // a put wing of 0.95 on a 6.7 vol

  err(twinCard('JPY=X', LINE, 1), /ot-dn on a long card/);
  err(twinCard('EURUSD=X', 'ps · strike 1.15/1.13 · cut 2026-12-01 · iv 5.7%', 1), /ps on a long card/);
  err(twinCard('KRW=X', 'ot-dn · strike 1,320 · cut 2026-11-25 · iv 10.4%', -1), /offshore touch on USDKRW/);
  err(twinCard('EURUSD=X', 'cs · strike 1.1850/1.1650 · cut 2026-12-01 · iv 5.7%', 1), /Kn is the strike nearer/);
  err(twinCard('EURUSD=X', 'ps · strike 1.15/1.15 · cut 2026-12-01 · iv 5.7%', -1), /Kn is the strike nearer/);
  err(twinCard('EURUSD=X', 'cs · strike 1.1650 · cut 2026-12-01 · iv 5.7%', 1), /^strike/);
  err(twinCard('JPY=X', LINE.replace('155.50', '157.00/155.00'), -1), /^strike/);
  err(twinCard('JPY=X', LINE.replace('2026-11-25', '2026-11-28'), -1), /^cut/); // a Saturday
  err(twinCard('JPY=X', LINE.replace('2026-11-25', 'in two weeks'), -1), /^cut/);
  err(twinCard('JPY=X', LINE.replace('6.7%', '0.067'), -1), /^iv/);
  err(twinCard('JPY=X', LINE.replace('ot-dn', 'nt-up'), -1), /^struct nt-up/);
  err(twinCard('JPY=X', LINE.replace('pay USD', 'pay EUR'), -1), /^pay/);
  err(twinCard('JPY=X', LINE.replace('-2.90%', '-290%'), -1), /^carry/);
  err(twinCard('GC=F', LINE, -1), /single FX proxy/);
  err(twinCard('EURUSD=X-GBPUSD=X', LINE, -1), /single FX proxy/);
});

test('premium at the fill, the open mark and a frozen premium', () => {
  const card = ok<TwinCard>(twinCard('JPY=X', LINE, -1));
  const now = Date.UTC(2026, 10, 6, 12);
  const bars = liveSinceFill(hourly(H0, now, () => 158), FILL, true);
  const m = ok<TwinMark>(markTwin(card, bars, FILL, now, 1));
  assert.equal(m.state, 'open');
  assert.equal(m.fill_px, 158.025, 'the open of the fill bar');
  const p0 = premium(valueAtTime(card, 158.025, FILL).v, true, 1);
  assert.equal(m.p0fill, p0);
  assert.ok(p0 > 0.2 && p0 < 0.45, `a 1.6% one-touch over 17 sessions at 6.7 vol: ${p0}`);
  const last = bars[bars.length - 1];
  const v = valueAtTime({ ...card, p0fill: p0 }, 158, last.ts + HOUR).v;
  near(m.v, v); near(m.r, v / p0 - 1); assert.equal(m.px, 158); assert.equal(m.as_of, last.ts);
  assert.ok(m.left_n > 12 && m.left_n < 14);
  // the tier-2 premium carries two points of dealing cost
  assert.equal(ok<TwinMark>(markTwin(card, bars, FILL, now, 2)).p0fill, premium(valueAtTime(card, 158.025, FILL).v, true, 2));

  // a stored premium is never recomputed, even when the bars at the fill are gone or revised
  const late = bars.filter((b) => b.ts > FILL + 2 * DAY);
  err(markTwin(card, bars.filter((b) => b.ts > FILL + 4 * DAY), FILL, now, 1), /no hourly bar at the fill/);
  const f = ok<TwinMark>(markTwin(card, late, FILL, now, 1, { frozen: { p0fill: 0.3, fill_px: 158.03, tv: 0.28 } }));
  assert.equal(f.p0fill, 0.3); assert.equal(f.fill_px, 158.03); assert.equal(f.tv, 0.28); near(f.r, v / 0.3 - 1);
  // with no smile on the line, the premium is the at-the-money-vol value plus the dealing cost
  near(m.tv, valueAtTime(card, 158.025, FILL).v); assert.equal(m.p0fill, premium(m.tv, true, 1)); near(m.vol, 6.7, 1e-9);

  // the stop of the linear card means nothing to the twin: a rally through it leaves the option open
  const up = liveSinceFill(hourly(H0, now, (t) => (t < FILL + DAY ? 158 : 161)), FILL, true);
  const u = ok<TwinMark>(markTwin(card, up, FILL, now, 1));
  assert.equal(u.state, 'open'); assert.ok(u.r < -0.5 && u.r > -1);
});

test('on the smile: calls, digitals, spreads and touches against fxopt.py', () => {
  // python3 -I scripts/fxopt/fxopt.py with USDJPY spot 158, fwd 157.75 (so rd 0), 20 days, atm 6.7, rr25 -1.95,
  // bf25 0.23, bf_type smile, delta_type fwd. fxopt discounts a base-currency payout at the base rate (fwd ÷ spot);
  // nothing is discounted here.
  const S = 158, F = 157.75, rt = Math.sqrt(20 / 365), sdA = 0.067 * rt, sdC = 0.05955 * rt, sdP = 0.07905 * rt, dff = F / S;
  const sh = (struct: Struct, k: number, kf: number | null = null, basePay = false) => {
    const v = smileShare({ struct, k, kf, basePay }, S, F, sdA, sdC, sdP);
    assert.notEqual(v, null, `${struct} ${k}`); return v!;
  };
  near(vvCall(F, 158, sdA, sdC, sdP), 0.8493157570101744, 1e-7);
  near(vvCall(F, 161, sdA, sdC, sdP), 0.02862533571062187, 1e-7);
  near(sh('dig-dn', 155), 0.13782012834577662, 5e-6);
  near(sh('dig-up', 160), 0.18056962688761669, 5e-6);
  near(sh('dig-dn', 155, null, true), 0.1332449035057468 / dff, 5e-6);
  near(sh('dig-up', 160, null, true), 0.1837942990296738 / dff, 5e-6);
  near(sh('cs', 158, 161), (0.8493157570101744 - 0.02862533571062187) / 3, 1e-7);
  near(sh('ps', 158, 155), (1.0993157570101744 - 0.30942513968738083) / 3, 1e-7);
  // a touch: its at-the-money-vol value, plus that value times the smile's effect on the digital at the barrier,
  // weighted by the chance of no touch
  const touch = (tv: number, smileDig: number, flatDig: number) => tv * (1 + (1 - tv) * (smileDig / flatDig - 1));
  near(sh('ot-dn', 155), touch(0.25223260623156385, 0.13782012834577662, 0.1327495335121215), 5e-6);
  near(sh('ot-dn', 155, null, true), touch(0.24728312081398346 / dff, 0.1332449035057468 / dff, 0.129208059322175 / dff), 5e-6);
  // with both wings at the at-the-money vol the smile is flat, and every structure reprices at its flat value
  const flat = (struct: Struct, k: number, kf: number | null = null) => smileShare({ struct, k, kf, basePay: false }, S, F, sdA, sdA, sdA)!;
  near(flat('dig-dn', 155), digital('lognormal', false, F, 155, sdA), 5e-6);
  near(flat('ot-dn', 155), oneTouch('lognormal', S, F, 155, sdA), 5e-6);
  // nothing usable: a barrier so far out that the flat digital there is nil
  assert.equal(smileShare({ struct: 'ot-dn', k: 120, kf: null, basePay: false }, S, F, sdA, sdC, sdP), null);

  // Against a vanna-volga touch (vega, vanna and volga hedged with the three pillars, the cost weighted by the
  // chance of no touch; computed with fxopt.py's own functions): within a point of payout from 15% to 45%
  // barriers, on the side the risk reversal favours and against it. The flat at-the-money value (last column)
  // misses by up to six and a half. spot, fwd, days, barrier, atm, rr25, bf25, vanna-volga, flat.
  const vv: number[][] = [
    [158, 157.75, 20, 155, 6.7, -1.95, 0.23, 0.2606, 0.2522], [158, 157.75, 20, 161, 6.7, -1.95, 0.23, 0.1573, 0.2015],
    [158, 157.6, 30, 153, 6.7, -1.95, 0.23, 0.1835, 0.1184], [158, 157.2, 60, 152, 6.8, -1.95, 0.23, 0.2334, 0.2090],
    [1450, 1449.3, 30, 1490, 10.4, 0.75, 0.32, 0.3267, 0.3512], [1.16, 1.1615, 30, 1.18, 6.5, 0.3, 0.15, 0.3594, 0.3790],
    [0.65, 0.6502, 30, 0.638, 9.0, -0.8, 0.2, 0.4454, 0.4705],
  ];
  let worst = 0, worstFlat = 0;
  for (const [s, f, days, h, atm, rr, bf, want, tv] of vv) {
    const q = Math.sqrt(days / 365) / 100;
    const got = smileShare({ struct: h > s ? 'ot-up' : 'ot-dn', k: h, kf: null, basePay: false }, s, f, atm * q, (atm + bf + rr / 2) * q, (atm + bf - rr / 2) * q)!;
    assert.ok(Math.abs(got - want) < 0.01, `touch ${h} from ${s}: ${got.toFixed(4)} against vanna-volga ${want}`);
    worst = Math.max(worst, Math.abs(got - want)); worstFlat = Math.max(worstFlat, Math.abs(tv - want));
  }
  assert.ok(worst < 0.01 && worstFlat > 0.06, `worst miss ${worst.toFixed(4)} on the smile, ${worstFlat.toFixed(4)} flat`);
});

test('a twin with a risk reversal is priced and marked on its smile', () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const bars = liveSinceFill(hourly(H0, now, () => 158), FILL, true);
  const flat = ok<TwinCard>(twinCard('JPY=X', LINE, -1));
  const smile = ok<TwinCard>(twinCard('JPY=X', LINE.replace(' · carry', ' · rr -1.95 · bf 0.23 · carry'), -1));
  const a = ok<TwinMark>(markTwin(flat, bars, FILL, now, 1)), b = ok<TwinMark>(markTwin(smile, bars, FILL, now, 1));
  near(b.tv, a.tv); near(b.vol, 6.7, 1e-9);
  // Near the money (a theoretical value near 40%) a touch on this steep a skew trades under its theoretical
  // value, by points and not by tens of points; a far barrier on the side the skew favours trades over it.
  assert.ok(b.p0fill < a.p0fill - 0.01 && b.p0fill > a.p0fill - 0.06, `${a.p0fill} flat, ${b.p0fill} on the smile`);
  const far = (line: string) => ok<TwinMark>(markTwin(ok<TwinCard>(twinCard('JPY=X', line.replace('155.50', '153.50'), -1)), bars, FILL, now, 1));
  const fa = far(LINE), fb = far(LINE.replace(' · carry', ' · rr -1.95 · bf 0.23 · carry'));
  assert.ok(fa.tv < 0.2 && fb.p0fill > fa.p0fill + 0.02 && fb.p0fill < fa.p0fill + 0.1, `far barrier: ${fa.p0fill} flat, ${fb.p0fill} on the smile`);
  const at = twinValue(smile, 158.025, FILL);
  assert.equal(b.p0fill, premium(at.v, true, 1)); near(at.tv, valueAtTime(smile, 158.025, FILL).v);
  // the running mark is on the same smile, at the last bar's end
  const last = bars[bars.length - 1];
  near(b.v, twinValue(smile, 158, last.ts + HOUR).v); near(b.r, b.v / b.p0fill - 1);
  assert.ok(b.v < a.v && b.r > -0.2 && b.r < 0, 'four quiet sessions on: a little time decay, still under the flat value');
  // an upside touch on the same smile is cheaper than its theoretical value
  const upLine = LINE.replace('ot-dn', 'ot-up').replace('155.50', '160.50').replace(' · carry', ' · rr -1.95 · bf 0.23 · carry');
  const u = ok<TwinMark>(markTwin(ok<TwinCard>(twinCard('JPY=X', upLine, 1)), bars, FILL, now, 1));
  assert.ok(u.p0fill < u.tv + 0.01, `${u.p0fill} against a theoretical value of ${u.tv}`);
  // through its barrier a touch is worth 1 on any smile; inside the last half session the flat value stands
  assert.equal(twinValue(smile, 155.4, FILL).v, 1);
  const late = twinValue(smile, 156, smile.cut - 6 * HOUR);
  near(late.v, late.tv); assert.ok(late.n < 0.5);
  // a view close is valued on the smile too
  const end = Date.UTC(2026, 10, 6, 3);
  const e = ok<TwinMark>(markTwin(smile, bars, FILL, now, 1, { early: { ts: end, px: 157.2 } }));
  near(e.v, twinValue(smile, 157.2, end).v); near(e.r, earlyCloseR(true, e.v, b.p0fill, 1));
});

test('what cannot be priced is skipped with its reason', () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const bars = liveSinceFill(hourly(H0, now, () => 158), FILL, true);
  err(markTwin(ok<TwinCard>(twinCard('JPY=X', LINE.replace('155.50', '150.00'), -1)), bars, FILL, now, 1), /under the 10% floor/);
  err(markTwin(ok<TwinCard>(twinCard('JPY=X', LINE.replace('155.50', '158.50'), -1)), bars, FILL, now, 1), /already through its level/);
  err(markTwin(ok<TwinCard>(twinCard('JPY=X', LINE.replace('2026-11-25', '2026-11-02'), -1)), bars, FILL, now, 1), /cut within a session/);
  err(markTwin(ok<TwinCard>(twinCard('JPY=X', LINE, -1)), [], FILL, now, 1), /no hourly bar at the fill/);
  const flat = hourly(H0, now, () => 158).map((b) => ({ ...b, o: 158, h: 158, l: 158 }));
  err(markTwin(ok<TwinCard>(twinCard('JPY=X', LINE, -1)), liveSinceFill(flat, FILL, true), FILL, now, 1), /no live hourly bars/);
});

test('touch, settlement at the cut, and an early close with the card', () => {
  const card = ok<TwinCard>(twinCard('JPY=X', LINE, -1));
  const p0 = premium(valueAtTime(card, 158.025, FILL).v, true, 1);
  const now = Date.UTC(2026, 10, 12, 12);
  const base = () => hourly(H0, now, () => 158);

  // a live low through the barrier pays 1 and freezes the twin
  let bars = base();
  const hit = bars.find((b) => b.ts === Date.UTC(2026, 10, 10, 3))!; hit.l = 155.4;
  const t = ok<TwinMark>(markTwin(card, liveSinceFill(bars, FILL, true), FILL, now, 1));
  assert.equal(t.state, 'touch'); assert.equal(t.v, 1); assert.equal(t.px, 155.4); assert.equal(t.as_of, hit.ts);
  near(t.r, 1 / p0 - 1); assert.equal(t.left_n, 0);

  // a view close at 11:00 SGT on 6 Nov, dealt at the book's closing mark
  const end = Date.UTC(2026, 10, 6, 3);
  const e = ok<TwinMark>(markTwin(card, liveSinceFill(base(), FILL, true), FILL, now, 1, { early: { ts: end, px: 157.2 } }));
  const cardP = { ...card, p0fill: p0 };
  assert.equal(e.state, 'view'); assert.equal(e.px, 157.2); assert.equal(e.as_of, end);
  near(e.v, valueAtTime(cardP, 157.2, end).v);
  near(e.r, earlyCloseR(true, e.v, p0, 1));
  assert.ok(e.r < e.v / p0 - 1, 'the dealing cost is paid again on the way out');
  // with no closing mark, the close of the bar that ended at the exit time is used
  const e2 = ok<TwinMark>(markTwin(card, liveSinceFill(base(), FILL, true), FILL, now, 1, { early: { ts: end, px: null } }));
  assert.equal(e2.px, 158); near(e2.v, valueAtTime(cardP, 158, end).v);
  // a touch after the early close is not seen; a touch before it wins
  bars = base(); bars.find((b) => b.ts === end)!.l = 155.4;
  assert.equal(ok<TwinMark>(markTwin(card, liveSinceFill(bars, FILL, true), FILL, now, 1, { early: { ts: end, px: 157.2 } })).state, 'view');
  bars = base(); bars.find((b) => b.ts === end - HOUR)!.l = 155.4;
  assert.equal(ok<TwinMark>(markTwin(card, liveSinceFill(bars, FILL, true), FILL, now, 1, { early: { ts: end, px: 157.2 } })).state, 'touch');
  // an exit stamped before the fill, after now or after the cut is ignored
  for (const ts of [FILL - HOUR, now + HOUR, card.cut + HOUR]) {
    assert.equal(ok<TwinMark>(markTwin(card, liveSinceFill(base(), FILL, true), FILL, now, 1, { early: { ts, px: 157.2 } })).state, 'open');
  }

  // a digital settles on the live hourly bar ending at the cut; a put spread pays its in-the-money share
  const dig = ok<TwinCard>(twinCard('JPY=X', LINE.replace('ot-dn', 'dig-dn').replace('155.50', '157.00'), -1));
  const after = card.cut + 3 * HOUR;
  const path = (t: number) => (t < card.cut - HOUR ? 158 : t === card.cut - HOUR ? 156.2 : 159);
  const d = ok<TwinMark>(markTwin(dig, liveSinceFill(hourly(H0, after, path), FILL, true), FILL, after, 1));
  assert.equal(d.state, 'expiry'); assert.equal(d.v, 1); assert.equal(d.px, 156.2); assert.equal(d.as_of, dig.cut);
  near(d.r, 1 / d.p0fill - 1);
  const lose = ok<TwinMark>(markTwin(dig, liveSinceFill(hourly(H0, after, () => 158), FILL, true), FILL, after, 1));
  assert.equal(lose.state, 'expiry'); assert.equal(lose.v, 0); assert.equal(lose.r, -1);
  const ps = ok<TwinCard>(twinCard('JPY=X', 'ps · strike 158.00/155.00 · cut 2026-11-25 · iv 6.7% · carry -2.90%', -1));
  const s = ok<TwinMark>(markTwin(ps, liveSinceFill(hourly(H0, after, path), FILL, true), FILL, after, 1));
  assert.equal(s.state, 'expiry'); near(s.v, 0.6); near(s.r, 0.6 / s.p0fill - 1);
  assert.equal(s.p0fill, premium(valueAtTime(ps, 158.025, FILL).v, false, 1));
});

test('the bar a view close was dealt on', () => {
  const bars = hourly(Date.UTC(2026, 10, 2), Date.UTC(2026, 10, 5), (t) => 1340 + ((t / HOUR) % 24));
  // closed 3 Nov SGT: bars ending 2 Nov 16:00 UTC (exclusive) to 3 Nov 16:00 UTC; the 02:00–03:00 UTC bar closes at 1342
  assert.equal(exitBar(bars, '2026-11-03', 1342), Date.UTC(2026, 10, 3, 3));
  assert.equal(exitBar(bars, '2026-11-03', 1342.3), Date.UTC(2026, 10, 3, 3), 'nearest close within 5 parts in 10,000');
  assert.equal(exitBar(bars, '2026-11-03', 1380), null);
  assert.equal(exitBar(bars, '2026-11-03', null), null);
  assert.equal(exitBar(bars, 'soon', 1342), null);
  assert.equal(exitBar([], '2026-11-03', 1342), null);
  // 1356 prints only on 2 Nov 16:00–17:00 UTC, which ends on 3 Nov SGT; 1363 (23:00 UTC) prints on both days and the earlier wins
  assert.equal(exitBar(bars, '2026-11-03', 1356), Date.UTC(2026, 10, 2, 17));
  assert.equal(exitBar(bars, '2026-11-03', 1363), Date.UTC(2026, 10, 3, 0));
});

test('what is stored on the trade and read back', () => {
  const card = ok<TwinCard>(twinCard('JPY=X', LINE, -1));
  const now = Date.UTC(2026, 10, 6, 12);
  const m = ok<TwinMark>(markTwin(card, liveSinceFill(hourly(H0, now, () => 158), FILL, true), FILL, now, 1));
  const meta = twinMeta(m, LINE);
  assert.deepEqual(Object.keys(meta).sort(), ['twin_asof', 'twin_fill', 'twin_left', 'twin_p0', 'twin_px', 'twin_r', 'twin_state', 'twin_terms', 'twin_tv', 'twin_v', 'twin_vol']);
  assert.equal(meta.twin_vol, '6.70'); assert.equal(meta.twin_tv, (m.tv * 100).toFixed(1));
  assert.equal(meta.twin_terms, LINE.replace('TWIN: ', ''));
  assert.equal(meta.twin_state, 'open'); assert.equal(meta.twin_fill, '158.025'); assert.equal(meta.twin_px, '158');
  assert.equal(meta.twin_p0, (m.p0fill * 100).toFixed(1)); assert.equal(meta.twin_r, m.r.toFixed(2));
  assert.match(meta.twin_asof, /^2026-11-06T11:00:00/);
  assert.deepEqual(twinFrozen(meta), { p0fill: m.p0fill, fill_px: 158.025, tv: Math.round(m.tv * 1000) / 1000 });
  // a mark stored before the theoretical value was kept reads its premium in that place
  assert.deepEqual(twinFrozen({ twin_p0: '30.4', twin_fill: '158.025' }), { p0fill: 0.304, fill_px: 158.025, tv: 0.304 });
  assert.equal(twinFrozen({}), null);
  assert.equal(twinFrozen({ twin_state: 'skipped: iv x' }), null);
  assert.deepEqual(twinMeta('iv x', LINE), { twin_state: 'skipped: iv x' });
  // the stored terms rebuild the same card, so a later edit of the book's line changes nothing
  assert.deepEqual(twinCard('JPY=X', meta.twin_terms, -1), card);
});

test('one trade row through to its stored keys', () => {
  const now = Date.UTC(2026, 10, 12, 12);
  const raw = hourly(H0, now, () => 158);
  const row = (o: Partial<TwinTrade> = {}): TwinTrade => ({
    proxy: 'JPY=X', direction: -1, status: 'open', filled: '2026-11-02 09:00 SGT', closed: null, meta: { twin: LINE.replace('TWIN: ', '') }, ...o,
  });
  const first = scoreTwin(row(), raw, null, now);
  assert.equal(first.skipped, null); assert.equal(first.meta!.twin_state, 'open'); assert.equal(first.meta!.twin_fill, '158.025');
  // the second run reads the stored premium and terms back; an edited book line no longer matters
  const stored = { ...row().meta!, ...first.meta! };
  const again = scoreTwin(row({ meta: { ...stored, twin: 'ot-dn · strike 150.00 · cut 2026-11-25 · iv 6.7%' } }), raw, null, now);
  assert.equal(again.meta!.twin_p0, first.meta!.twin_p0); assert.equal(again.meta!.twin_terms, first.meta!.twin_terms);
  assert.equal(again.meta!.twin_r, first.meta!.twin_r);
  // a stop, target or time exit of the card leaves the twin running
  for (const status of ['closed-stop', 'closed-target', 'closed-time', 'closed-restrike']) {
    assert.equal(scoreTwin(row({ status, closed: '2026-11-06', meta: stored }), raw, 157.2, now).meta!.twin_state, 'open', status);
  }
  // a view or reader close ends it at the book's closing mark, on the bar that mark came from
  const path = hourly(H0, now, (t) => (t === Date.UTC(2026, 10, 6, 2) ? 157.2 : 158));
  for (const status of ['closed-view', 'closed-reader']) {
    const v = scoreTwin(row({ status, closed: '2026-11-06', meta: stored }), path, 157.2, now);
    assert.equal(v.meta!.twin_state, 'view', status); assert.equal(v.meta!.twin_px, '157.2');
    assert.equal(v.meta!.twin_asof, '2026-11-06T03:00:00.000Z'); assert.equal(v.meta!.twin_left, '0.0');
  }
  // no bar matches the closing mark: 09:00 SGT on the closed date, still at the mark
  const nb = scoreTwin(row({ status: 'closed-view', closed: '2026-11-06', meta: stored }), raw, 157.2, now);
  assert.equal(nb.meta!.twin_asof, '2026-11-06T01:00:00.000Z'); assert.equal(nb.meta!.twin_px, '157.2');
  // no closing mark at all: the bar close at that time
  assert.equal(scoreTwin(row({ status: 'closed-view', closed: '2026-11-06', meta: stored }), raw, null, now).meta!.twin_px, '158');

  // failures: before any mark the reason is stored; after one the last mark stands
  const bad = scoreTwin(row({ direction: 1 }), raw, null, now);
  assert.match(bad.skipped!, /on a long card/); assert.deepEqual(bad.meta, { twin_state: 'skipped: struct ot-dn on a long card' });
  assert.match(scoreTwin(row({ filled: '2026-11-02' }), raw, null, now).skipped!, /no fill time/);
  assert.match(scoreTwin(row({ status: 'closed-view', closed: '-' }), raw, null, now).skipped!, /closed date missing/);
  const out = scoreTwin(row({ meta: stored }), [], null, now);
  assert.match(out.skipped!, /no live hourly bars/); assert.equal(out.meta, null);
  assert.match(scoreTwin(row({ meta: {} }), raw, null, now).skipped!, /empty/);
});
