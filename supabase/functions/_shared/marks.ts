// Price-reference rules for grading ideas, kept apart from dash-mark so they can be tested.

// A daily bar may carry its exchange-local session date `sd` and the time its session closes `ce` (ms UTC),
// both set by yahooDaily from the venue's own time zone; bars built without them (tests, hourly bars) keep
// the old +12h rule for the date.
export type Bar = { ts: number; o: number; h: number; l: number; c: number; live?: boolean; sd?: string; ce?: number };

export const HOUR = 3600000;

// ---------- session dates of daily bars ----------

// Offset of a time zone from UTC at instant t, in ms (Intl carries the IANA rules, so DST is exact).
// Formatters are cached per zone (building one costs far more than using it; the edge worker has a 2 s CPU cap).
const FMT = new Map<string, Intl.DateTimeFormat>();
// Offsets are cached per zone and UTC month: when a month starts and ends on the same offset (no DST change
// inside it), every instant in it has that offset.
const MONTH_OFF = new Map<string, number | null>();
export function tzOffset(t: number, tz: string): number {
  const d = new Date(t), y = d.getUTCFullYear(), mo = d.getUTCMonth(), key = `${tz}|${y}|${mo}`;
  let m = MONTH_OFF.get(key);
  if (m === undefined) {
    const a = exactOffset(Date.UTC(y, mo, 1), tz), b = exactOffset(Date.UTC(y, mo + 1, 1) - 1000, tz);
    m = a === b ? a : null;
    MONTH_OFF.set(key, m);
  }
  return m ?? exactOffset(t, tz);
}
function exactOffset(t: number, tz: string): number {
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    FMT.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
// The local calendar date of instant t in a time zone.
export const localDate = (t: number, tz: string) => new Date(t + tzOffset(t, tz)).toISOString().slice(0, 10);
// The instant of a local wall-clock time on a date in a time zone.
export function zonedTime(date: string, hh: number, mm: number, tz: string): number {
  const guess = Date.parse(date + 'T00:00:00Z') + (hh * 60 + mm) * 60000;
  const t = guess - tzOffset(guess, tz);
  return guess - tzOffset(t, tz);
}
// Regular cash closes of the Asia-Pacific venues, as in trend.ts TM1_ASSETS (A16 VENUE: a flat 17:00 local put
// the TWSE close 3.5 h and the Nikkei 1.5 h late, so a fill after the close could take that day's close as a
// post-fill price).
export const VENUE_CLOSE: Record<string, [number, number]> = {
  'Asia/Tokyo': [15, 30], 'Asia/Hong_Kong': [16, 10], 'Asia/Seoul': [15, 30], 'Asia/Taipei': [13, 30],
  'Australia/Sydney': [16, 10], 'Asia/Kolkata': [15, 30], 'Asia/Calcutta': [15, 30], 'Asia/Shanghai': [15, 0], 'Asia/Singapore': [17, 0],
};
// When a venue's daily session is over, in ms UTC. FX ('=X') closes at the 17:00 New York cut (22:00 UTC in
// winter, 21:00 UTC in summer; A16 FXCLOSE: it was a fixed 21:00 UTC); US venues close at 16:00 New York (17:00
// for futures, '=F'); Europe at 17:30 local; Asia-Pacific at its regular close (VENUE_CLOSE), the rest 17:00 local.
// Yahoo's own FX daily bar ends at London midnight, so its close is NOT the 17:00 New York price: dash-mark builds
// FX daily bars from hourly bars instead (fxNySessions).
export function sessionClose(date: string, tz: string, symbol: string): number {
  if (/=X$/i.test(symbol)) return zonedTime(date, 17, 0, 'America/New_York');
  if (tz.startsWith('America/')) return zonedTime(date, /=F$/i.test(symbol) ? 17 : 16, 0, 'America/New_York');
  if (tz.startsWith('Europe/')) return zonedTime(date, 17, 30, tz);
  const v = VENUE_CLOSE[tz];
  return zonedTime(date, v ? v[0] : 17, v ? v[1] : 0, tz);
}

// FX daily bars on the 17:00 New York cut, built from hourly bars (A16 EDGE-05: Yahoo's daily FX bar is a London-
// midnight bar, so relabelling it cannot give the cut price). The session dated D runs from 17:00 New York on the
// previous weekday to 17:00 New York on D. A session is complete when the hour ending at its cut is present and it
// has at least 18 hourly bars (Monday's starts when Yahoo reopens about two hours into the Sunday session); its close
// is the close of the hour ending at the cut. Weekend dates (the stray Friday-evening hour) are dropped.
export function fxNySessions(hourly: Bar[]): Bar[] {
  const out: Bar[] = [];
  let sd = '', ce = -Infinity, n = 0, o = 0, h = -Infinity, l = Infinity, atCut: Bar | null = null;
  const flush = () => {
    const wd = new Date(Date.parse(sd + 'T00:00:00Z')).getUTCDay();
    if (sd && atCut && n >= 18 && wd !== 0 && wd !== 6) out.push({ ts: atCut.ts + HOUR - 24 * HOUR, o, h, l, c: atCut.c, sd, ce });
  };
  for (const b of hourly) {
    const end = b.ts + HOUR;
    if (end > ce) {
      flush();
      // the New York date of the instant 7 h after the hour's end (17:00 New York + 7 h is midnight)
      sd = new Date(end + tzOffset(end, 'America/New_York') + 7 * HOUR - 1).toISOString().slice(0, 10);
      ce = zonedTime(sd, 17, 0, 'America/New_York');
      n = 0; o = b.o; h = -Infinity; l = Infinity; atCut = null;
    }
    n++; h = Math.max(h, b.h); l = Math.min(l, b.l);
    if (end === ce) atCut = b;
  }
  flush();
  return out;
}
// Yahoo stamps a daily bar at the venue's local midnight or at its open (US stocks 09:30 New York = 14:30 UTC,
// ^TNX 07:20 Chicago, DAX 09:00 Berlin), so the session date is the stamp's date in the venue's own time zone
// (the old +12h rule moved every US stock and ETF bar to the next day: EDGE-001). A second bar on a date already
// seen is Yahoo's in-progress bar of the next futures session, stamped with the current time; it is dropped.
// A last bar stamped at another local time of day than the bar before it is that running bar too (CL=F on
// Thanksgiving: Wed 05:00 UTC, then Fri 01:01 UTC, which is Thursday evening in New York): it is never complete.
export function stampDaily(bars: Bar[], tz: string | null | undefined, symbol: string): Bar[] {
  if (!tz) return bars;
  const out: Bar[] = [];
  const fx = /=X$/i.test(symbol), us = tz.startsWith('America/'), eu = tz.startsWith('Europe/');
  const closeTz = us ? 'America/New_York' : tz;
  const vc = VENUE_CLOSE[tz];
  const closeMin = fx ? 0 : us ? (/=F$/i.test(symbol) ? 17 : 16) * 60 : eu ? 17 * 60 + 30 : vc ? vc[0] * 60 + vc[1] : 17 * 60;
  let prevTod: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const off = tzOffset(b.ts, tz);
    const sd = new Date(b.ts + off).toISOString().slice(0, 10);
    const tod = (b.ts + off) % (24 * HOUR);
    const running = i === bars.length - 1 && prevTod != null && tod !== prevTod;
    prevTod = tod;
    if (out.length && out[out.length - 1].sd! >= sd) continue;
    // the stamp and the close fall on the same local day, and DST never changes inside a trading day
    const day = Date.parse(sd + 'T00:00:00Z');
    const ce = fx ? sessionClose(sd, tz, symbol) : day + closeMin * 60000 - tzOffset(b.ts, closeTz);
    out.push({ ...b, sd, ce: running ? Infinity : ce });
  }
  return out;
}
// The session date of a daily bar.
export const barDate = (b: Bar) => b.sd ?? new Date(b.ts + 12 * HOUR).toISOString().slice(0, 10);
// When a daily bar's close is known: its session close, or 21h after the stamp for bars without one.
export const barCloseTime = (b: Bar) => b.ce ?? b.ts + 21 * HOUR;

// A requote while the market is shut is not a trade: Yahoo prints flat bars, or bars with two
// prices only (BRL=X on Monday 5 Oct: o = h = 5.2277, l = c = 5.2223, Friday's levels). A live bar
// has at least three distinct prices among o/h/l/c and a range of at least 15% of the series'
// median hourly range. markLive stamps each bar; synthetic spread bars take `live` from their
// legs, since their own highs and lows are unknowable.
// The median is taken over the bars up to and including each bar (TS-16: a later volatile spell must not turn
// an earlier quiet bar dead and move a reference already dealt), and for an even count it is the mean of the two
// middle ranges (TS-15).
export function markLive(bars: Bar[]): Bar[] {
  const sorted: number[] = [];
  for (const b of [...bars].sort((x, y) => x.ts - y.ts)) {
    const range = b.h - b.l;
    if (!(range > 0)) { b.live = false; continue; }
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid] < range) lo = mid + 1; else hi = mid; }
    sorted.splice(lo, 0, range);
    b.live = range >= 0.15 * median(sorted) && new Set([b.o, b.h, b.l, b.c]).size >= 3;
  }
  return bars;
}
// Median of an ascending array (mean of the two middle values for an even count); 0 when empty.
export function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return 0;
  const i = Math.floor(n / 2);
  return n % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
export const isLive = (b: Bar) => b.live ?? b.h > b.l;

// A gap longer than this between live bars means the market was shut (weekend, holiday, the
// overnight break of an onshore market such as BRL or a cash index such as ^TNX).
const CLOSURE = 12 * HOUR;

// The reference an idea is graded from: the price a reader could have dealt at once the digest
// landed (`cut`). If the market was trading, that is the last live hourly close before the cut.
// If it was shut, it is the open of the first live bar after the cut, and the gap is not credited
// to the idea; `null` means that bar has not printed yet. Hourly bars are stamped at their start.
export function ideaRef(h: Bar[], cut: number, now: number): { ts: number; px: number } | null {
  let lastBefore: Bar | undefined, firstAfter: Bar | undefined;
  for (const b of h) {
    if (!isLive(b)) continue;
    if (b.ts + HOUR <= cut) lastBefore = b;
    else if (b.ts >= cut && !firstAfter) firstAfter = b;
  }
  if (lastBefore) {
    const end = lastBefore.ts + HOUR;
    // TS-03: the last bar ended before the cut and nothing has printed since. Whether the market is shut (a
    // Friday close before a Saturday digest, a US stock overnight) is known only once the next bar prints, so
    // the reference waits for it rather than freezing the stale close.
    const spansCut = h.some((b) => isLive(b) && b.ts <= cut && cut < b.ts + HOUR);
    if (!firstAfter && !spansCut && end < cut) return null;
    if ((firstAfter ? firstAfter.ts : now) - end <= CLOSURE) return { ts: end, px: lastBefore.c };
  }
  return firstAfter ? { ts: firstAfter.ts, px: firstAfter.o } : null;
}

// Rule R17: one R is the risk the card planned (META "risk" = |REF - stop| when the card was written), never the
// distance left between a gapped fill and the stop. Cards filled before the rule carry no risk key and keep
// |entry - stop|, which is how the book scored them.
export function oneR(entry: number, stop: number, metaRisk: unknown): number {
  const m = String(metaRisk ?? '').replace(/[−–]/g, '-').replace(/,/g, '').match(NUM_RE); // TS-07: '.0025' is 0.0025
  const risk = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(risk) && risk > 0 ? risk : Math.abs(entry - stop);
}

// A signed decimal, with or without a leading digit ('.0025', '-.5', '1,240' once commas are stripped).
export const NUM_RE = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/;

// ---------- linear marks (dash.live_marks for a card with a stop) ----------

export interface LinearMark {
  as_of: number; price: number; r: number;
  hi_since_fill: number | null; lo_since_fill: number | null; stop_touched: boolean | null; target_touched: boolean | null;
  daily_close: number | null; daily_close_d: string | null; daily_r: number | null; stop_closed: boolean | null; target_closed: boolean | null;
  stop_closed_h: boolean | null; stop_closed_h_px: number | null; stop_closed_h_at: number | null;
}

// `h`: hourly bars (stamped at their start), `d`: complete daily bars. Touches count only bars that started at or
// after the fill (a bar the fill sits inside also traded before it). The hourly-close stop (spec v15) counts every
// complete bar whose close came after the fill, including the bar the fill sits inside (EDGE-002).
export function markLinear(
  h: Bar[], d: Bar[], t: { dir: number; entry: number; stop: number; target: number | null; oneR: number; fillTs: number | null }, now: number,
): LinearMark | null {
  const { dir, entry, stop, target, oneR, fillTs } = t;
  if (!h.length || !oneR) return null;
  const last = h[h.length - 1];
  const since = fillTs != null ? h.filter((b) => b.ts >= fillTs) : [];
  const hi = since.length ? Math.max(...since.map((b) => b.h)) : null;
  const lo = since.length ? Math.min(...since.map((b) => b.l)) : null;
  const closedH = fillTs != null ? h.filter((b) => b.ts + HOUR > fillTs && now - b.ts >= HOUR) : [];
  const stopBarH = closedH.find((b) => (dir > 0 ? b.c <= stop : b.c >= stop)) ?? null;
  const dSince = fillTs != null ? d.filter((b) => barCloseTime(b) > fillTs) : [];
  const dl = d[d.length - 1];
  // A16 EDGE-01: when the fetched history starts after the fill, a breach before it is unseen. Positive evidence
  // (a touch or close seen) stands; "not touched" and the extremes since the fill become unknown (null).
  const cutH = fillTs != null && h[0].ts > fillTs, cutD = fillTs != null && (!d.length || barCloseTime(d[0]) > fillTs);
  const known = (v: boolean | null, cut: boolean) => (cut && v === false ? null : v);
  const out: LinearMark = {
    as_of: last.ts, price: last.c, r: (dir * (last.c - entry)) / oneR,
    hi_since_fill: hi, lo_since_fill: lo,
    stop_touched: since.length ? (dir > 0 ? lo! <= stop : hi! >= stop) : null,
    target_touched: since.length && target != null ? (dir > 0 ? hi! >= target : lo! <= target) : null,
    daily_close: dl?.c ?? null, daily_close_d: dl ? barDate(dl) : null, daily_r: dl ? (dir * (dl.c - entry)) / oneR : null,
    stop_closed: dSince.length ? dSince.some((b) => (dir > 0 ? b.c <= stop : b.c >= stop)) : null,
    target_closed: dSince.length && target != null ? dSince.some((b) => (dir > 0 ? b.c >= target : b.c <= target)) : null,
    stop_closed_h: closedH.length ? stopBarH != null : null, stop_closed_h_px: stopBarH?.c ?? null,
    stop_closed_h_at: stopBarH ? stopBarH.ts + HOUR : null,
  };
  if (cutH) {
    out.hi_since_fill = out.lo_since_fill = null;
    out.stop_touched = known(out.stop_touched, true); out.target_touched = known(out.target_touched, true);
    out.stop_closed_h = known(out.stop_closed_h, true); // a breach seen keeps its hour: the exit still fires
  }
  if (cutD) { out.stop_closed = known(out.stop_closed, true); out.target_closed = known(out.target_closed, true); }
  return out;
}

// A daily bar is final once its session close has passed by an hour (bars without a close time: 22h after the
// stamp, as before), and Saturday/Sunday session dates are never sessions.
export const completeDaily = (bars: Bar[], now: number) =>
  bars.filter((b) => (b.ce != null ? now >= b.ce + HOUR : now - b.ts > 22 * HOUR) && new Date(barDate(b) + 'T12:00:00Z').getUTCDay() % 6 !== 0);
