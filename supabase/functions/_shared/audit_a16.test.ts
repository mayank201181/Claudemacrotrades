// Our own tests for the Astra A16 re-audit findings in _shared (27 Nov 2026). Each was run against main at 20ada43
// first and failed there; the comment says what the old code gave.
// Run: node --experimental-strip-types --test supabase/functions/_shared/*.test.ts   (or deno test --no-check -A)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Bar, fxNySessions, HOUR, sessionClose, stampDaily } from './marks.ts';
import { cardFromMeta, type ConvexCard, liveSinceFill, markConvexity } from './convexity.ts';
import { ideaDirection } from './parse.ts';
import { fdmOf, SPEEDS } from './forecast.ts';
import { twinCard } from './twin.ts';

const U = (s: string) => Date.parse(s);
const bar = (ts: number, c: number, r = 0.1): Bar => ({ ts, o: c + r / 4, h: c + r / 2, l: c - r / 2, c });

test('A16-TS10: "Short U.S. Treasury yields" on ^TNX is a short-yield call', () => {
  assert.equal(ideaDirection('Short U.S. Treasury yields into the auction', '^TNX'), -1, 'old: +1 (long yield)');
  assert.equal(ideaDirection('Long U.S. 10y yields', '^TNX'), 1);
  assert.equal(ideaDirection('Buy U.S. Treasuries', '^TNX'), -1, 'a bond position still inverts');
});

test('A16-TS06: the pooled correlation does not depend on a speed\'s units', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const n = 900;
  const s = SPEEDS.map(() => Array.from({ length: n }, rnd));
  const a = fdmOf([s]);
  const b = fdmOf([s.map((x, j) => (j === 0 ? x.map((v) => v * 1e-8) : x))]);
  assert.ok(a != null && b != null, `old: ${a}, ${b} (the rescaled speed read as constant)`);
  assert.ok(Math.abs(a! - b!) < 1e-9, `${a} vs ${b}`);
});

test('A16-TS08: a put spread with three strikes and a digital with two are refused', () => {
  const m = { cut: '2026-12-11 23:00 SGT', vol: '0.45%', carry: '0%', p0fill: '30%' };
  assert.equal(typeof cardFromMeta('SPY', { ...m, struct: 'ps', strike: '110/100/90' }, ''), 'string', 'old: priced 110/100');
  assert.equal(typeof cardFromMeta('SPY', { ...m, struct: 'dig-up', strike: '600/610' }, ''), 'string', 'old: priced 600');
  assert.equal(typeof cardFromMeta('SPY', { ...m, struct: 'ps', strike: '100/92' }, ''), 'object');
  assert.equal(typeof cardFromMeta('SPY', { ...m, struct: 'dig-up', strike: '600' }, ''), 'object');
});

test('A16-TS09: a twin cut on an impossible date is refused', () => {
  const line = 'TWIN: ot-dn · strike 155.50 · cut 2027-02-30 · pay USD · iv 6.7% DTCC 2026-11-09 · carry -2.90%';
  const c = twinCard('JPY=X', line, -1);
  assert.equal(typeof c, 'string', 'old: cut moved to 2 March');
  assert.equal(typeof twinCard('JPY=X', line.replace('2027-02-30', '2027-02-26'), -1), 'object');
});

const USDJPY_OT = () => cardFromMeta('USDJPY=X', { struct: 'ot-dn', strike: '144', cut: '2026-11-30 23:00 SGT', pay: 'USD', vol: '0.696%', carry: '-3%', p0fill: '31%' }, '') as ConvexCard;

test('A16-TS01: in a replay of a truncated archive the last completed hour is not a running bar', () => {
  const c = USDJPY_OT();
  const bars: Bar[] = [];
  for (let t = U('2026-10-01T00:00:00Z'); t <= U('2026-11-19T10:00:00Z'); t += HOUR) if (new Date(t).getUTCDay() % 6) bars.push(bar(t, 146.5));
  const fill = U('2026-11-02T00:00:00Z');
  bars[bars.length - 1].l = 143.9; // the 10:00 hour traded through 144, but after 10:15
  const lv = liveSinceFill(bars, fill, true);
  assert.equal(markConvexity(c, lv, [], fill, U('2026-11-19T10:15:00Z'))!.touched_at, null, 'old: paid the touch at 10:15');
  assert.equal(markConvexity(c, lv, [], fill, U('2026-11-19T10:15:00Z'), true)!.touched_at, U('2026-11-19T10:00:00Z'), 'the live feed still counts it');
  assert.equal(markConvexity(c, lv, [], fill, U('2026-11-19T11:00:00Z'))!.touched_at, U('2026-11-19T10:00:00Z'));
});

test('A16-TS02: an hour straddling the fill does not set the liveness floor', () => {
  const fill = U('2026-11-20T10:30:00Z');
  const bars = [bar(U('2026-11-20T09:00:00Z'), 1, 0.1), bar(U('2026-11-20T10:00:00Z'), 1, 10), bar(U('2026-11-20T11:00:00Z'), 1, 0.2)];
  const lv = liveSinceFill(bars, fill, true);
  assert.equal(lv[2].live, true, 'old: the 10:00 spike (after the fill) lifted the floor to 0.76 and killed the 11:00 bar');
});

test('A16-FXCLOSE: FX closes at 17:00 New York, 22:00 UTC in winter and 21:00 UTC in summer', () => {
  assert.equal(sessionClose('2027-01-15', 'Europe/London', 'EURUSD=X'), U('2027-01-15T22:00:00Z'), 'old: 21:00 UTC');
  assert.equal(sessionClose('2026-07-15', 'Europe/London', 'EURUSD=X'), U('2026-07-15T21:00:00Z'));
  assert.equal(stampDaily([bar(U('2027-01-15T00:00:00Z'), 1)], 'Europe/London', 'EURUSD=X')[0].ce, U('2027-01-15T22:00:00Z'));
  // a daily bar that closed before the fill is not "since the fill": D closes 22:00 UTC, fill 22:30 UTC
  const c = USDJPY_OT();
  const fill = U('2026-11-24T22:30:00Z');
  const hourly: Bar[] = [];
  for (let t = U('2026-11-02T00:00:00Z'); t <= U('2026-11-25T03:00:00Z'); t += HOUR) if (new Date(t).getUTCDay() % 6) hourly.push(bar(t, 146.5));
  const daily: Bar[] = [{ ts: U('2026-11-23T22:00:00Z'), o: 146, h: 146, l: 143, c: 143.5, sd: '2026-11-24', ce: U('2026-11-24T22:00:00Z') }];
  const m = markConvexity(c, liveSinceFill(hourly, fill, true), daily, fill, U('2026-11-25T03:30:00Z'))!;
  assert.equal(m.touched_at, null, 'old: valued the bar at 00:00 UTC, after the fill, and paid the touch');
});

test('A16-EDGE-05: FX daily bars built from hourly bars close at the 17:00 New York hour', () => {
  // EURUSD hours as Yahoo serves them: Sunday reopen about 22:00 UTC (winter), a stray Friday 22:00 UTC hour
  const hourly: Bar[] = [];
  for (let t = U('2026-11-22T22:00:00Z'); t <= U('2026-11-28T00:00:00Z'); t += HOUR) {
    const d = new Date(t), wd = d.getUTCDay();
    if (wd === 6 || (wd === 0 && d.getUTCHours() < 22) || (wd === 5 && d.getUTCHours() > 22)) continue;
    hourly.push(bar(t, 1 + (t - U('2026-11-22T00:00:00Z')) / HOUR / 1e4));
  }
  const s = fxNySessions(hourly);
  assert.deepEqual(s.map((b) => b.sd), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'], 'Monday kept, no Saturday');
  for (const b of s) {
    assert.equal(b.ce, U(b.sd + 'T22:00:00Z'));
    const cutHour = hourly.find((x) => x.ts + HOUR === b.ce)!;
    assert.equal(b.c, cutHour.c, 'the close is the hour ending 17:00 New York, not a London-midnight print');
  }
  // summer: 21:00 UTC; a session missing the cut hour is not complete
  const sh: Bar[] = [];
  for (let t = U('2026-07-14T21:00:00Z'); t < U('2026-07-15T21:00:00Z'); t += HOUR) sh.push(bar(t, 1.1));
  assert.equal(fxNySessions(sh)[0].ce, U('2026-07-15T21:00:00Z'));
  assert.equal(fxNySessions(sh.slice(0, -1)).length, 0);
});

test('A16-VENUE: Asia-Pacific daily closes follow the venue\'s regular close', () => {
  assert.equal(sessionClose('2026-11-20', 'Asia/Taipei', '^TWII'), U('2026-11-20T05:30:00Z'), 'old: 09:00 UTC (17:00 Taipei)');
  assert.equal(stampDaily([bar(U('2026-11-19T15:00:00Z'), 1)], 'Asia/Tokyo', '^N225')[0].ce, U('2026-11-20T06:30:00Z'), 'old: 08:00 UTC');
  assert.equal(sessionClose('2026-11-20', 'Asia/Hong_Kong', '^HSI'), U('2026-11-20T08:10:00Z'));
});

import { markLinear } from './marks.ts';
test('A16-EDGE-01: a linear stop is unknown, not false, when the hourly history starts after the fill', () => {
  const fill = U('2026-05-01T01:00:00Z');
  const h: Bar[] = [];
  for (let t = U('2026-06-01T00:00:00Z'); t < U('2026-06-05T00:00:00Z'); t += HOUR) h.push(bar(t, 100, 0.2));
  const m = markLinear(h, [], { dir: 1, entry: 100, stop: 95, target: 110, oneR: 5, fillTs: fill }, U('2026-06-05T00:00:00Z'))!;
  assert.equal(m.stop_touched, null, 'old: false (a May breach is outside the history)');
  assert.equal(m.stop_closed_h, null, 'old: false');
  assert.equal(m.hi_since_fill, null, 'old: the June high, called the high since the May fill');
  // a breach that is seen still counts
  h[10].c = h[10].l = 94;
  const s = markLinear(h, [], { dir: 1, entry: 100, stop: 95, target: 110, oneR: 5, fillTs: fill }, U('2026-06-05T00:00:00Z'))!;
  assert.equal(s.stop_touched, true); assert.equal(s.stop_closed_h, true); assert.equal(s.stop_closed_h_at, h[10].ts + HOUR);
  // history that reaches back to the fill is unchanged
  const full = markLinear(h, [], { dir: 1, entry: 100, stop: 90, target: 110, oneR: 10, fillTs: h[0].ts }, U('2026-06-05T00:00:00Z'))!;
  assert.equal(full.stop_touched, false);
});

import { dailyCsv } from './history.ts';
test('A16-EDGE-06/07: dash-history leaves Adj Close blank for a stock with no adjusted series, and refuses an undated venue', () => {
  const res = (meta: Record<string, string>, adj: boolean) => ({ meta, timestamp: [1795700000, 1795786400],
    indicators: { quote: [{ open: [1, 2], high: [1, 2], low: [1, 2], close: [10, 11], volume: [5, 6] }], ...(adj ? { adjclose: [{ adjclose: [9.5, 10.5] }] } : {}) } });
  const stock = dailyCsv(res({ exchangeTimezoneName: 'America/New_York', instrumentType: 'EQUITY' }, false), 'SPY');
  assert.ok(!('error' in stock));
  assert.equal((stock as { csv: string }).csv.split('\n')[1].split(',')[5], '', 'old: the raw close 10 printed as adjusted');
  const fx = dailyCsv(res({ exchangeTimezoneName: 'Europe/London', instrumentType: 'CURRENCY' }, false), 'EURUSD=X') as { csv: string };
  assert.equal(fx.csv.split('\n')[1].split(',')[5], '10');
  const adj = dailyCsv(res({ exchangeTimezoneName: 'America/New_York', instrumentType: 'EQUITY' }, true), 'SPY') as { csv: string };
  assert.equal(adj.csv.split('\n')[1].split(',')[5], '9.5');
  assert.deepEqual(dailyCsv(res({}, false), 'SPY'), { error: 'missing venue time zone' }, 'old: dated in UTC');
});
