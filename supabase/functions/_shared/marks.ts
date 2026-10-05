// Price-reference rules for grading ideas, kept apart from dash-mark so they can be tested.

export type Bar = { ts: number; o: number; h: number; l: number; c: number; live?: boolean };

export const HOUR = 3600000;

// A requote while the market is shut is not a trade: Yahoo prints flat bars, or bars with two
// prices only (BRL=X on Monday 5 Oct: o = h = 5.2277, l = c = 5.2223, Friday's levels). A live bar
// has at least three distinct prices among o/h/l/c and a range of at least 15% of the series'
// median hourly range. markLive stamps each bar; synthetic spread bars take `live` from their
// legs, since their own highs and lows are unknowable.
export function markLive(bars: Bar[]): Bar[] {
  const r = bars.map((b) => b.h - b.l).filter((x) => x > 0).sort((a, b) => a - b);
  const floor = 0.15 * (r[Math.floor(r.length / 2)] ?? 0);
  for (const b of bars) b.live = b.h - b.l > 0 && b.h - b.l >= floor && new Set([b.o, b.h, b.l, b.c]).size >= 3;
  return bars;
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
    if ((firstAfter ? firstAfter.ts : now) - end <= CLOSURE) return { ts: end, px: lastBefore.c };
  }
  return firstAfter ? { ts: firstAfter.ts, px: firstAfter.o } : null;
}
