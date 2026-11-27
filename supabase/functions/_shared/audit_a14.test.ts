// Our own tests for the Astra A14 audit findings fixed in _shared and dash-mark (27 Nov 2026). Each test states
// the case, and where it matters the result the old code gave.
// Run: deno test --no-check -A supabase/functions/_shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Bar, barDate, completeDaily, HOUR, ideaRef, markLinear, markLive, median, oneR, sessionClose, stampDaily } from './marks.ts';
import { cardFromMeta, type ConvexCard, cutSessionDate, liveSinceFill, markConvexity, parseSgt } from './convexity.ts';

const U = (s: string) => Date.parse(s);
const bar = (ts: number, c: number, r = 0.1): Bar => ({ ts, o: c + r / 4, h: c + r / 2, l: c - r / 2, c });

test('EDGE-001: US stock daily bars keep their own session date (Yahoo stamps them 14:30 UTC)', () => {
  // SPY as served on 27 Nov 2026: Thu 19 to Wed 25 Nov, each stamped 14:30 UTC (09:30 New York).
  const stamps = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25'].map((d) => U(d + 'T14:30:00Z'));
  const raw = stamps.map((t, i) => ({ ts: t, o: 600 + i, h: 601 + i, l: 599 + i, c: 600 + i }));
  // the old rule (+12h) moved every bar a day on, and Friday's to a Saturday that completeDaily then dropped
  assert.deepEqual(raw.map((b) => barDate(b)), ['2026-11-20', '2026-11-21', '2026-11-24', '2026-11-25', '2026-11-26']);
  const d = stampDaily(raw, 'America/New_York', 'SPY');
  assert.deepEqual(d.map(barDate), ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25']);
  const done = completeDaily(d, U('2026-11-27T01:00:00Z'));
  assert.equal(done.length, 5, 'Friday is kept');
  // ^TNX stamps 13:20 UTC (07:20 Chicago), DAX 08:00 UTC, FX and Asia at 00:00 UTC (or 23:00 UTC under BST)
  assert.equal(barDate(stampDaily([bar(U('2026-11-20T13:20:00Z'), 4)], 'America/Chicago', '^TNX')[0]), '2026-11-20');
  assert.equal(barDate(stampDaily([bar(U('2026-11-20T08:00:00Z'), 4)], 'Europe/Berlin', '^GDAXI')[0]), '2026-11-20');
  assert.equal(barDate(stampDaily([bar(U('2026-07-01T23:00:00Z'), 1)], 'Europe/London', 'EURUSD=X')[0]), '2026-07-02');
  assert.equal(barDate(stampDaily([bar(U('2026-11-27T00:00:00Z'), 1)], 'Asia/Tokyo', '^N225')[0]), '2026-11-27');
});

test('EDGE-001: a second bar on a date (Yahoo\'s running futures bar) is dropped', () => {
  // CL=F: Wed 25 stamped 05:00 UTC (00:00 New York), the running bar stamped Fri 27 01:01 UTC (Thu 20:01 New York)
  const d = stampDaily([bar(U('2026-11-25T05:00:00Z'), 60), bar(U('2026-11-26T05:00:00Z'), 61), bar(U('2026-11-27T01:01:00Z'), 62)], 'America/New_York', 'CL=F');
  assert.deepEqual(d.map(barDate), ['2026-11-25', '2026-11-26']);
  // Thanksgiving: no Thursday bar, so the running Friday bar (01:01 UTC = Thu 20:01 New York) is never complete
  const tg = stampDaily([bar(U('2026-11-24T05:00:00Z'), 60), bar(U('2026-11-25T05:00:00Z'), 61), bar(U('2026-11-27T01:01:00Z'), 62)], 'America/New_York', 'CL=F');
  assert.deepEqual(completeDaily(tg, U('2026-11-27T01:20:00Z')).map(barDate), ['2026-11-24', '2026-11-25']);
});

test('EDGE-001: session close times follow the venue and its DST', () => {
  assert.equal(sessionClose('2026-11-20', 'America/New_York', 'SPY'), U('2026-11-20T21:00:00Z'));
  assert.equal(sessionClose('2026-07-01', 'America/New_York', 'SPY'), U('2026-07-01T20:00:00Z'));
  assert.equal(sessionClose('2026-11-20', 'America/New_York', 'CL=F'), U('2026-11-20T22:00:00Z'));
  assert.equal(sessionClose('2026-11-20', 'Europe/Berlin', '^GDAXI'), U('2026-11-20T16:30:00Z'));
  assert.equal(sessionClose('2026-11-20', 'Asia/Tokyo', '^N225'), U('2026-11-20T08:00:00Z'));
  assert.equal(sessionClose('2026-11-20', 'Europe/London', 'EURUSD=X'), U('2026-11-20T21:00:00Z'));
  // a US close at 21:00 UTC is before a 08:30 SGT fill the next morning, so that bar is not "since the fill"
  const d = stampDaily([bar(U('2026-11-19T14:30:00Z'), 100), bar(U('2026-11-20T14:30:00Z'), 95)], 'America/New_York', 'SPY');
  const h = [bar(U('2026-11-20T00:00:00Z'), 100)];
  const m = markLinear(h, d, { dir: 1, entry: 100, stop: 97, target: null, oneR: 3, fillTs: U('2026-11-20T00:30:00Z') }, U('2026-11-21T03:00:00Z'))!;
  assert.equal(m.stop_closed, true, 'Friday 20 Nov closed at 95 after the fill');
  const early = markLinear(h, d.slice(0, 1), { dir: 1, entry: 100, stop: 97, target: null, oneR: 3, fillTs: U('2026-11-20T00:30:00Z') }, U('2026-11-21T03:00:00Z'))!;
  assert.equal(early.stop_closed, null, 'Thursday 19 Nov closed before the fill');
});

test('EDGE-002: the hourly bar a fill sits inside counts for the hourly-close stop', () => {
  // fill 10:30 UTC inside the 10:00 bar, which closes at 98.9 under a 99 stop (long)
  const h = [bar(U('2026-11-20T09:00:00Z'), 100), { ts: U('2026-11-20T10:00:00Z'), o: 100, h: 100.2, l: 98.8, c: 98.9 }, bar(U('2026-11-20T11:00:00Z'), 99.5)];
  const m = markLinear(h, [], { dir: 1, entry: 100, stop: 99, target: 102, oneR: 1, fillTs: U('2026-11-20T10:30:00Z') }, U('2026-11-20T12:30:00Z'))!;
  assert.equal(m.stop_closed_h, true);
  assert.equal(m.stop_closed_h_at, U('2026-11-20T11:00:00Z'));
  // touches still count only bars that started after the fill (the 10:00 bar also traded before it)
  assert.equal(m.lo_since_fill, 99.45);
  assert.equal(m.stop_touched, false);
});

test('TS-03: no frozen stale close before the market has printed again', () => {
  // US stock hourly bars 14:30-20:30 UTC; a Saturday 08:00 SGT digest (Sat 00:00 UTC)
  const h: Bar[] = [];
  for (const d of ['2026-11-19', '2026-11-20']) for (let k = 0; k < 7; k++) h.push(bar(U(d + 'T14:30:00Z') + k * HOUR, 100 + k));
  const cut = U('2026-11-21T00:00:00Z');
  assert.equal(ideaRef(h, cut, U('2026-11-21T01:07:00Z')), null, 'the old code returned Friday\'s close here');
  // once Monday prints, the reference is Monday's open and the weekend gap is not credited
  const mon = { ts: U('2026-11-23T14:30:00Z'), o: 110, h: 111, l: 109, c: 110.5 };
  assert.deepEqual(ideaRef([...h, mon], cut, U('2026-11-23T15:07:00Z')), { ts: mon.ts, px: 110 });
  // a weekday US idea: the 08:00 SGT cut is outside the session too; the next open is the reference
  const tue = U('2026-11-24T00:00:00Z');
  assert.equal(ideaRef([...h, mon], tue, U('2026-11-24T01:07:00Z')), null);
  // FX trading through the cut: the bar ending at the cut is the reference, as before
  const fx: Bar[] = [];
  for (let t = U('2026-11-23T00:00:00Z'); t < tue; t += HOUR) fx.push(bar(t, 1.15));
  fx[fx.length - 1].c = 1.1512;
  assert.deepEqual(ideaRef(fx, tue, U('2026-11-24T01:07:00Z')), { ts: tue, px: 1.1512 });
});

test('TS-07: a leading-dot planned risk is not read as a whole number', () => {
  assert.equal(oneR(1.1, 1.095, '.0025'), 0.0025); // the old regex read 25
  assert.equal(oneR(1.1, 1.095, '0.0025'), 0.0025);
  assert.ok(Math.abs(oneR(1.1, 1.095, '-.0025') - 0.005) < 1e-12, 'a negative risk falls back to |entry - stop|');
  const c = cardFromMeta('EURUSD=X', { struct: 'dig-up', strike: '1.2', cut: '2026-12-11 23:00 SGT', vol: '.45%', carry: '-.5%', p0fill: '30%' }, '') as ConvexCard;
  assert.ok(Math.abs(c.vol - 0.0045) < 1e-12);
  assert.ok(Math.abs(c.carry + 0.005) < 1e-12);
  const s = cardFromMeta('AUDUSD=X', { struct: 'cs', strike: '.6650/.6850', cut: '2026-12-11 23:00 SGT', vol: '.45%', p0fill: '30%' }, '') as ConvexCard;
  assert.equal(s.k, 0.665); assert.equal(s.kf, 0.685);
});

test('TS-15 and TS-16: liveness uses the conventional median of the bars up to each bar', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, 2, 3]), 2);
  // a quiet bar (range 0.02) after a month of 0.1 ranges is live; a later spell of 1.0 ranges must not kill it
  const base: Bar[] = [];
  for (let k = 0; k < 100; k++) base.push(bar(U('2026-11-02T00:00:00Z') + k * HOUR, 1, 0.1));
  const quiet = { ts: base[99].ts + HOUR, o: 1.001, h: 1.01, l: 0.99, c: 1.0 };
  const later: Bar[] = [];
  for (let k = 0; k < 300; k++) later.push(bar(quiet.ts + (k + 1) * HOUR, 1, 1.0));
  const a = markLive([...base, { ...quiet }]);
  assert.equal(a[a.length - 1].live, true);
  const b = markLive([...base.map((x) => ({ ...x })), { ...quiet }, ...later]);
  assert.equal(b[100].live, true, 'the whole-window median (1.0) made it dead');
});

test('TS-01: a replay as of an earlier time does not see the high and low of the bar still running', () => {
  const c = cardFromMeta('USDJPY=X', { struct: 'ot-dn', strike: '144', cut: '2026-11-30 23:00 SGT', pay: 'USD', vol: '0.696%', carry: '-3%', p0fill: '31%' }, '') as ConvexCard;
  const bars: Bar[] = [];
  for (let t = U('2026-10-01T00:00:00Z'); t < U('2026-11-20T12:00:00Z'); t += HOUR) if (new Date(t).getUTCDay() % 6) bars.push(bar(t, 146.5));
  const fill = U('2026-11-02T00:00:00Z');
  const hit = bars.find((b) => b.ts === U('2026-11-19T10:00:00Z'))!; hit.l = 143.9; hit.o = 146.4;
  const lv = liveSinceFill(bars, fill, true);
  // as of 10:30 the 10:00 bar is running and later bars exist: its low (traded after 10:30 in this replay) is unseen
  assert.equal(markConvexity(c, lv, [], fill, U('2026-11-19T10:30:00Z'))!.touched_at, null);
  assert.equal(markConvexity(c, lv, [], fill, U('2026-11-19T11:00:00Z'))!.touched_at, hit.ts);
  // in the live feed the running bar is the latest one, and its traded low counts at once
  const feed = lv.filter((b) => b.ts <= hit.ts);
  assert.equal(markConvexity(c, feed, [], fill, U('2026-11-19T10:07:00Z'))!.touched_at, hit.ts);
  // ... also with Yahoo's flat tick at the current time appended after it
  const tick = { ts: U('2026-11-19T10:06:30Z'), o: 146.4, h: 146.4, l: 146.4, c: 146.4, live: false };
  assert.equal(markConvexity(c, [...feed, tick], [], fill, U('2026-11-19T10:07:00Z'))!.touched_at, hit.ts);
});

test('TS-02: with no bars before the fill nothing is live (post-fill bars never set their own floor)', () => {
  const fill = U('2026-11-20T00:00:00Z');
  const bars = [bar(fill, 1, 0.1), bar(fill + HOUR, 1, 0.01), bar(fill + 2 * HOUR, 1, 5)];
  assert.ok(liveSinceFill(bars, fill, true).every((b) => b.live === false));
});

test('DATE-01, TS-08, TS-09: New York dates, spread strike order, impossible dates', () => {
  assert.equal(cutSessionDate(U('2026-07-01T04:30:00Z')), '2026-07-01', '00:30 EDT is the 1st (UTC-5 gave the 30th)');
  assert.equal(cutSessionDate(U('2026-11-21T21:00:00Z')), '2026-11-21');
  assert.equal(parseSgt('2026-02-30 10:00 SGT'), null);
  assert.equal(parseSgt('2026-11-30 24:10 SGT'), null);
  assert.equal(parseSgt('2026-11-30 23:00 SGT'), U('2026-11-30T15:00:00Z'));
  const m = { cut: '2026-12-11 23:00 SGT', vol: '0.45%', carry: '0%', p0fill: '30%' };
  assert.equal(typeof cardFromMeta('AUDUSD=X', { ...m, struct: 'cs', strike: '0.6850/0.6650' }, ''), 'string');
  assert.equal(typeof cardFromMeta('AUDUSD=X', { ...m, struct: 'cs', strike: '0.6650/0.6650' }, ''), 'string');
  assert.equal(typeof cardFromMeta('AUDUSD=X', { ...m, struct: 'ps', strike: '0.6650/0.6450' }, ''), 'object');
  assert.equal(typeof cardFromMeta('AUDUSD=X', { ...m, struct: 'ps', strike: '0.6450/0.6650' }, ''), 'string');
});

test('EDGE-014: an older trade book snapshot is recognised', async () => {
  const { isOlderBook } = await import('./parse.ts');
  assert.equal(isOlderBook('2026-11-26 07:45 SGT', '2026-11-27 07:45 SGT'), true);
  assert.equal(isOlderBook('2026-11-27 7:05 SGT', '2026-11-27 07:45 SGT'), true);
  assert.equal(isOlderBook('2026-11-27 07:45 SGT', '2026-11-27 07:45 SGT'), false, 'the same snapshot re-posted is ingested');
  assert.equal(isOlderBook('2026-11-27 08:10 SGT', '2026-11-27 07:45 SGT'), false);
  assert.equal(isOlderBook(null, '2026-11-27 07:45 SGT'), false);
  assert.equal(isOlderBook('2026-11-27', '2026-11-27 07:45 SGT'), true);
});
