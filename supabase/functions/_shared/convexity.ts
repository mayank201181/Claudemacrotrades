// Convexity cards (rule R01): a bought European digital, one-touch, no-touch or call/put spread,
// carded at its premium (1R) and valued as a share of its maximum payout. Pure functions only,
// kept apart from dash-mark so they can be tested. The book's own MARK SCRIPT is the official
// record; the dashboard's mark is informational.
//
// Conventions (R01 item 2). sd = σ√n: in log units under the lognormal model, in the proxy's own
// units under the normal model (yields, "A-B" differences). F is a forward value and nothing is
// discounted. For FX, a payout in the terms currency uses the N(d2)-type drift (−sd²/2) and a
// payout in the base currency (USD on USDJPY) the +sd²/2 convention; every non-FX proxy uses −sd²/2.
import { type Bar, HOUR } from './marks.ts';

export type Struct = 'dig-up' | 'dig-dn' | 'ot-up' | 'ot-dn' | 'nt-up' | 'nt-dn' | 'cs' | 'ps';
export type VolModel = 'lognormal' | 'normal';
export const STRUCTS: readonly Struct[] = ['dig-up', 'dig-dn', 'ot-up', 'ot-dn', 'nt-up', 'nt-dn', 'cs', 'ps'];

export interface ConvexCard {
  struct: Struct;
  k: number;            // K for a digital, H for a touch, Kn (the strike nearer the spot) for a spread
  kf: number | null;    // Kf for a spread, else null
  model: VolModel;
  fx: boolean;          // a single '=X' proxy: forward carry, Mon–Fri UTC hours, hourly settlement
  basePay: boolean;     // FX payout in the base currency
  carry: number;        // terms − base, decimal per year (0 off FX)
  cut: number;          // ms UTC
  vol: number;          // σ per session, fixed for the card's life
  p0: number | null;    // premium at REF, share of payout
  p0fill: number;       // premium paid at the fill (falls back to p0)
}

const DAY = 24 * HOUR;
const isTouch = (s: Struct) => s.startsWith('ot') || s.startsWith('nt');
const isSpread = (s: Struct) => s === 'cs' || s === 'ps';
export const isBinary = (s: Struct) => !isSpread(s);
// The barrier of ot-up / nt-up sits above the spot; that of ot-dn / nt-dn below.
const upperBarrier = (s: Struct) => s === 'ot-up' || s === 'nt-up';

// ---------- normal distribution ----------

// Cumulative normal, double precision (Hart 1968 as given by West 2005; |error| < 1e-14).
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871;
      n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674;
      d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else c = e / tailB(z) / 2.506628274631;
  }
  return x > 0 ? 1 - c : c;
}
// The continued fraction of the far tail (z ≥ 7.07): Φ(−z) = φ(z)·√(2π) / (b·√(2π)) = e^(−z²/2) / (b·√(2π)).
function tailB(z: number): number {
  let b = z + 0.65;
  b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
  return b;
}
export const normPdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

// ---------- value functions (share of the maximum payout) ----------

export const forward = (spot: number, carry: number, days: number) => spot * Math.exp((carry * days) / 365);

// European digital. Up = Φ(d), down = Φ(−d).
export function digital(model: VolModel, up: boolean, F: number, K: number, sd: number, basePay = false): number {
  const d = model === 'normal' ? (F - K) / sd : (Math.log(F / K) + (basePay ? 1 : -1) * (sd * sd) / 2) / sd;
  return normCdf(up ? d : -d);
}

// One-touch paid at expiry, continuously monitored barrier H (first passage with drift).
// Valid while S is on the struct's own side of H; at or beyond H it is worth 1.
export function oneTouch(model: VolModel, S: number, F: number, H: number, sd: number, basePay = false): number {
  let x: number, a: number;
  if (model === 'normal') { x = Math.abs(H - S); a = 0; }
  else {
    x = Math.abs(Math.log(H / S));
    const m = Math.log(F / S) + (basePay ? 1 : -1) * (sd * sd) / 2;
    a = H > S ? m : -m;
  }
  const t1 = normCdf((a - x) / sd);
  // The reflection term exp(2ax/sd²)·Φ(−(a+x)/sd). Deep in the tail it is taken in log space, where the
  // exponents cancel to −(a−x)²/(2sd²): exp(2ax/sd²) alone overflows when the carry is large against the vol.
  const z = (a + x) / sd;
  const t2 = z < 7.07106781186547
    ? Math.exp((2 * a * x) / (sd * sd)) * normCdf(-z)
    : Math.exp(-((a - x) * (a - x)) / (2 * sd * sd) - Math.log(tailB(z) * 2.506628274631));
  return Math.min(1, t1 + t2);
}

// Undiscounted call on the forward: Black (lognormal) or Bachelier (normal).
export function call(model: VolModel, F: number, k: number, sd: number): number {
  if (model === 'normal') { const d = (F - k) / sd; return (F - k) * normCdf(d) + sd * normPdf(d); }
  const d1 = (Math.log(F / k) + (sd * sd) / 2) / sd;
  return F * normCdf(d1) - k * normCdf(d1 - sd);
}
export const put = (model: VolModel, F: number, k: number, sd: number) => call(model, F, k, sd) - (F - k);

// Call spread Kn/Kf (Kn < Kf) or put spread Kn/Kf (Kn > Kf), ÷ the width.
export function spread(model: VolModel, isCall: boolean, F: number, kn: number, kf: number, sd: number): number {
  const leg = (k: number) => (isCall ? call(model, F, k, sd) : put(model, F, k, sd));
  return Math.abs(leg(kn) - leg(kf)) / Math.abs(kf - kn);
}

// The in-the-money share of a spread's width at price S, 0 to 1.
export const spreadShare = (S: number, kn: number, kf: number) => Math.min(1, Math.max(0, (S - kn) / (kf - kn)));

// A touch struct whose spot is at or beyond its barrier has touched.
export const beyondBarrier = (c: Pick<ConvexCard, 'struct' | 'k'>, S: number) => (upperBarrier(c.struct) ? S >= c.k : S <= c.k);

// The payoff when no time remains, with no touch recorded before (a touch is detected on bars).
// Digitals pay strictly beyond K.
export function payoff(c: Pick<ConvexCard, 'struct' | 'k' | 'kf'>, S: number): number {
  switch (c.struct) {
    case 'dig-up': return S > c.k ? 1 : 0;
    case 'dig-dn': return S < c.k ? 1 : 0;
    case 'ot-up': case 'ot-dn': return beyondBarrier(c, S) ? 1 : 0;
    case 'nt-up': case 'nt-dn': return beyondBarrier(c, S) ? 0 : 1;
    default: return spreadShare(S, c.k, c.kf!);
  }
}

// V given the spot, the forward and sd. Guards: n = 0 → payoff; a touch beyond its barrier → 1 / 0.
export function valueAt(c: ConvexCard, S: number, F: number, sd: number): number {
  if (!(sd > 0)) return payoff(c, S);
  switch (c.struct) {
    case 'dig-up': return digital(c.model, true, F, c.k, sd, c.basePay);
    case 'dig-dn': return digital(c.model, false, F, c.k, sd, c.basePay);
    case 'ot-up': case 'ot-dn': return beyondBarrier(c, S) ? 1 : oneTouch(c.model, S, F, c.k, sd, c.basePay);
    case 'nt-up': case 'nt-dn': return beyondBarrier(c, S) ? 0 : 1 - oneTouch(c.model, S, F, c.k, sd, c.basePay);
    case 'cs': return spread(c.model, true, F, c.k, c.kf!, sd);
    case 'ps': return spread(c.model, false, F, c.k, c.kf!, sd);
  }
}

// The single entry point: V at `spot` with `n` sessions left at vol `sigma`; `days` = D, the whole
// calendar days to the cut, which only an FX forward uses.
export function value(c: ConvexCard, spot: number, n: number, sigma: number, days = 0): number {
  const F = c.fx ? forward(spot, c.carry, days) : spot;
  return valueAt(c, spot, F, sigma * Math.sqrt(Math.max(0, n)));
}

// ---------- horizon ----------

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;
const weekday = (t: number) => { const w = new Date(t).getUTCDay(); return w !== 0 && w !== 6; };

// FX: the Mon–Fri UTC hours from t0 to t1, ÷ 24.
export function fxSessions(t0: number, t1: number): number {
  let ms = 0;
  for (let d = dayStart(t0); d < t1; d += DAY) {
    if (!weekday(d)) continue;
    ms += Math.max(0, Math.min(t1, d + DAY) - Math.max(t0, d));
  }
  return ms / DAY;
}

// D: the whole calendar days from the valuation time to the cut, rounded down.
export const wholeDays = (t0: number, cut: number) => Math.max(0, Math.floor((cut - t0) / DAY));

// NYSE full-day closures 2026–2027 (XNYS, the rule's map for US rates, equities, energy and metals).
// The edge function has no other exchange calendar, so cards on other venues are not marked (xnysVenue).
export const XNYS_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// 16:00 New York on a date, in ms UTC (20:00 UTC under EDT, 21:00 under EST).
export function nyClose(date: string): number {
  const t = Date.parse(date + 'T00:00:00Z');
  const y = new Date(t).getUTCFullYear();
  const nthSunday = (month: number, nth: number) => {
    const first = Date.UTC(y, month, 1);
    return first + (((7 - new Date(first).getUTCDay()) % 7) + 7 * (nth - 1)) * DAY;
  };
  const edt = t >= nthSunday(2, 2) && t < nthSunday(10, 1);
  return t + (edt ? 20 : 21) * HOUR;
}

// The session date a non-FX cut belongs to: its date in New York (a 05:00 SGT Saturday cut is Friday's close).
export const cutSessionDate = (cut: number) => ymd(cut - 5 * HOUR);

// Non-FX: the sessions whose close falls after t0, up to and including the cut's session.
export function exchangeSessions(t0: number, cut: number, holidays: Set<string> = XNYS_HOLIDAYS): number {
  const last = cutSessionDate(cut);
  let n = 0;
  for (let d = dayStart(t0) - DAY; ymd(d) <= last; d += DAY) {
    const s = ymd(d);
    if (weekday(d) && !holidays.has(s) && nyClose(s) > t0) n++;
  }
  return n;
}

// The XNYS session a bar starting at t belongs to: the first open weekday whose NY close is after t
// (a Sunday-evening futures bar is Monday's).
export function sessionOf(t: number, holidays: Set<string> = XNYS_HOLIDAYS): string {
  let d = dayStart(t);
  while (!weekday(d) || holidays.has(ymd(d)) || nyClose(ymd(d)) <= t) d += DAY;
  return ymd(d);
}

export const sessionsLeft = (c: Pick<ConvexCard, 'fx' | 'cut'>, t0: number) => (t0 >= c.cut ? 0 : c.fx ? fxSessions(t0, c.cut) : exchangeSessions(t0, c.cut));

// V at a valuation time t0 (R01 item 2 HORIZON): n and D run from t0 to the cut, σ is the card's.
export function valueAtTime(c: ConvexCard, spot: number, t0: number): { v: number; n: number; d: number } {
  const n = sessionsLeft(c, t0), d = wholeDays(t0, c.cut);
  return { v: value(c, spot, n, c.vol, d), n, d };
}

// ---------- pricing and gate arithmetic (R01 items 2–3) ----------

const tenths = (share: number) => Math.round(share * 1000); // 0.4333 → 433, the printed 0.1 point

// p0: the premium as a share of payout, printed to 0.1 point. Binary: + 1 point (TIER 1) or 2 (TIER 2);
// spread: × 1.05 or × 1.10.
export function premium(price: number, binary: boolean, tier: 1 | 2): number {
  return tenths(binary ? price + (tier === 1 ? 0.01 : 0.02) : price * (tier === 1 ? 1.05 : 1.1)) / 1000;
}
export const rrOf = (p0: number) => 1 / p0 - 1;

// A spread's p from stated whole-per-cent probabilities, printed to 0.1 point: three points (Simpson) or,
// wider than 2 sd, five quarter points.
export function spreadP(q: number[]): number {
  const s = q.length === 3 ? (q[0] + 4 * q[1] + q[2]) / 6 : (q[0] + 4 * q[1] + 2 * q[2] + 4 * q[3] + q[4]) / 12;
  return Math.round(s * 10) / 1000;
}

// EV = p/p0 − 1, printed to 2 dp rounded down, from the printed tenths so a boundary never misprints.
export function evPrint(p: number, p0: number): number {
  const pt = tenths(p), p0t = tenths(p0);
  return Math.floor((100 * (pt - p0t)) / p0t + 1e-9) / 100;
}

// The convexity gate (test (c)), decided in whole tenths of a point.
export function gate(p: number, p0: number): { pass: boolean; pgate: boolean; ev: number } {
  const pt = tenths(p), p0t = tenths(p0);
  return { pass: 10 * pt >= 13 * p0t && pt <= 750 && p0t >= 100 && p0t <= 500, pgate: 10 * pt < 14 * p0t, ev: evPrint(p, p0) };
}

// ---------- scoring (R01 item 5) ----------

export const scoreR = (paid: number, p0fill: number) => paid / p0fill - 1;

// An early close (view changed or reader) at value V: a binary pays V less its cost, a spread V ÷ 1.05 / 1.10.
export function earlyCloseR(binary: boolean, v: number, p0fill: number, tier: 1 | 2): number {
  const paid = binary ? v - (tier === 1 ? 0.01 : 0.02) : v / (tier === 1 ? 1.05 : 1.1);
  return Math.max(-1, paid / p0fill - 1);
}

// ---------- card from the trade book ----------

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const m = s.replace(/[−–]/g, '-').replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  const v = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
};
const pct = (s: string | undefined) => { const v = num(s); return v == null ? null : v / 100; };

const YIELD = /^\^(IRX|FVX|TNX|TYX)$/i;
// US indices on the XNYS calendar; any other '^' index, and any '.XX' exchange suffix, is a foreign venue.
const US_INDEX = /^\^(IRX|FVX|TNX|TYX|GSPC|SPX|DJI|DJT|DJU|IXIC|NDX|RUT|VIX|VVIX|VIX3M|NYA|SOX|XAU|OEX|MID)$/i;

// A proxy leg the card can be marked on: FX ('=X'), US futures ('=F' or a dated US contract), a US index or a US ticker.
// Other venues close at other times and keep other holidays, which the horizon here does not model.
export function xnysVenue(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (/=X$/.test(s) || /=F$/.test(s)) return true;
  if (s.startsWith('^')) return US_INDEX.test(s);
  return /^[A-Z][A-Z0-9-]*(\.(NYB|NYM|CMX|CME|CBT))?$/.test(s); // US exchange suffixes: ICE US, NYMEX, COMEX, CME, CBOT
}
const SGT = 8 * HOUR;

// "2026-11-13 23:00 SGT" → ms UTC.
export function parseSgt(s: string | undefined): number | null {
  const m = (s ?? '').match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Date.parse(m[1] + 'T00:00:00Z') - SGT + (Number(m[2]) * 60 + Number(m[3])) * 60000;
}

// The FX base currency of an '=X' symbol: EURUSD=X → EUR; a 3-letter symbol (JPY=X) is quoted against USD.
export function fxBase(proxy: string): string | null {
  const m = proxy.trim().toUpperCase().match(/^([A-Z]{3})([A-Z]{3})?=X$/);
  return m ? (m[2] ? m[1] : 'USD') : null;
}

// A card from its META (keys struct, strike, cut, pay, vol, carry, p0, p0fill). `op` is the proxy's
// synthetic operator ('-' selects the normal model, as do the yield indices) and `legs` its symbols.
// Returns an error string when the card cannot be priced; dash-mark lists it in convexity_skipped.
export function cardFromMeta(proxy: string, meta: Record<string, string>, op: '' | '-' | '/', legs: string[] = op ? proxy.split(op) : [proxy]): ConvexCard | string {
  // Marked only on FX and the XNYS calendar: one '=X' symbol, or legs that are all US venues.
  const foreign = legs.filter((l) => !xnysVenue(l) || (op && fxBase(l) != null));
  if (foreign.length) return `venue ${foreign.join(', ')}: ${op ? 'synthetic legs must be US venues' : 'not on the XNYS calendar'}`;
  const struct = (meta.struct ?? '').trim().toLowerCase() as Struct;
  if (!STRUCTS.includes(struct)) return `struct ${meta.struct ?? 'missing'}`;
  const ks = (meta.strike ?? '').replace(/[−–]/g, '-').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!ks.length || (isSpread(struct) && ks.length < 2)) return `strike ${meta.strike ?? 'missing'}`;
  const cut = parseSgt(meta.cut);
  if (cut == null) return `cut ${meta.cut ?? 'missing'}`;
  const model: VolModel = YIELD.test(proxy.trim()) || op === '-' ? 'normal' : 'lognormal';
  const vs = (meta.vol ?? '').trim();
  const v0 = num(vs);
  if (v0 == null || !(v0 > 0)) return `vol ${meta.vol ?? 'missing'}`;
  // Lognormal: "0.696%" per session. Normal: proxy units ("0.065"), or bp of a per-cent yield ("6.5 bp").
  // A lognormal vol above 0.1 without '%' is a per-cent figure missing its sign (above 10% per session
  // is not plausible), so it is refused rather than guessed.
  if (model === 'lognormal' && !/%/.test(vs) && v0 > 0.1) return `vol ${meta.vol}: lognormal vol needs '%'`;
  const vol = model === 'lognormal' ? (/%/.test(vs) ? v0 / 100 : v0) : (/bp/i.test(vs) ? v0 / 100 : v0);
  const base = op ? null : fxBase(proxy);
  const fx = base != null;
  const pay = (meta.pay ?? '').trim().toUpperCase();
  const p0 = pct(meta.p0);
  const p0fill = pct(meta.p0fill) ?? p0;
  if (p0fill == null || !(p0fill > 0)) return 'p0fill missing';
  return {
    struct, k: ks[0], kf: isSpread(struct) ? ks[1] : null, model, fx, basePay: fx && pay === base,
    carry: fx ? pct(meta.carry) ?? 0 : 0, cut, vol, p0, p0fill,
  };
}

// ---------- marking ----------

// R01 item 5: a live hourly bar has ≥ 3 distinct prices among o/h/l/c and a range of at least 15% of the
// median non-zero hourly range over the 20 sessions before the fill. A session is a Mon–Fri UTC date for
// an FX symbol (Sunday-evening bars fall outside it) and an XNYS session date otherwise. Returns stamped copies.
export function liveSinceFill(bars: Bar[], fillTs: number, fx: boolean): Bar[] {
  const sess = (t: number) => (fx ? (weekday(t) ? ymd(t) : null) : sessionOf(t));
  const before = bars.filter((b) => b.ts < fillTs);
  const dates = [...new Set(before.map((b) => sess(b.ts)).filter((d) => d != null))].slice(-20);
  const keep = new Set(dates);
  const ref = before.length ? before.filter((b) => keep.has(sess(b.ts))) : bars;
  const r = ref.map((b) => b.h - b.l).filter((x) => x > 0).sort((a, b) => a - b);
  const floor = 0.15 * (r[Math.floor(r.length / 2)] ?? 0);
  return bars.map((b) => ({ ...b, live: b.h - b.l > 0 && b.h - b.l >= floor && new Set([b.o, b.h, b.l, b.c]).size >= 3 }));
}

const barDate = (t: number) => new Date(t + 12 * HOUR).toISOString().slice(0, 10);
// When a complete daily close is valued: FX at 00:00 UTC after the bar date; otherwise the NY close.
export const dailyValTime = (c: Pick<ConvexCard, 'fx'>, date: string) => (c.fx ? Date.parse(date + 'T00:00:00Z') + DAY : nyClose(date));

export interface ConvexMark {
  as_of: number; price: number; v: number; r: number; left_n: number;
  hi_since_fill: number | null; lo_since_fill: number | null;
  daily_close: number | null; daily_close_d: string | null; daily_v: number | null; daily_r: number | null;
  stop_touched: boolean | null; target_touched: boolean | null; stop_closed: boolean | null; target_closed: boolean | null;
  touched_at: number | null; touched_px: number | null; settled_px: number | null; paid: number | null;
}

// Marks one card. `hourly` carries `live` (liveSinceFill, or legs combined); `daily` holds complete daily
// bars only. A touch freezes the card; at the cut it settles; otherwise R = V / p0fill − 1.
export function markConvexity(c: ConvexCard, hourly: Bar[], daily: Bar[], fillTs: number, now: number): ConvexMark | null {
  const live = hourly.filter((b) => b.live && b.ts >= fillTs && b.ts + HOUR <= c.cut && b.ts <= now);
  const lastLive = hourly.filter((b) => b.live && b.ts <= now).pop();
  if (!lastLive) return null;
  const hi = live.length ? Math.max(...live.map((b) => b.h)) : null;
  const lo = live.length ? Math.min(...live.map((b) => b.l)) : null;
  const cutD = cutSessionDate(c.cut);
  const dSince = daily.filter((b) => dailyValTime(c, barDate(b.ts)) > fillTs && (c.fx ? dailyValTime(c, barDate(b.ts)) <= c.cut : barDate(b.ts) <= cutD));
  const dl = daily[daily.length - 1];

  const out: ConvexMark = {
    as_of: lastLive.ts, price: lastLive.c, v: 0, r: 0, left_n: 0, hi_since_fill: hi, lo_since_fill: lo,
    daily_close: dl?.c ?? null, daily_close_d: dl ? barDate(dl.ts) : null, daily_v: null, daily_r: null,
    stop_touched: null, target_touched: null, stop_closed: null, target_closed: null,
    touched_at: null, touched_px: null, settled_px: null, paid: null,
  };
  const freeze = (paid: number) => { out.v = out.daily_v = paid; out.r = out.daily_r = scoreR(paid, c.p0fill); out.paid = paid; };

  if (isTouch(c.struct)) {
    const up = upperBarrier(c.struct);
    const hb = live.find((b) => (up ? b.h >= c.k : b.l <= c.k));
    const db = dSince.find((b) => (up ? b.c >= c.k : b.c <= c.k));
    const hTs = hb ? hb.ts : Infinity, dTs = db ? dailyValTime(c, barDate(db.ts)) : Infinity;
    if (hb || db) {
      out.touched_at = Math.min(hTs, dTs);
      out.touched_px = hTs <= dTs ? (up ? hb!.h : hb!.l) : db!.c;
      const ot = c.struct.startsWith('ot');
      freeze(ot ? 1 : 0);
      if (ot) out.target_touched = true; else out.stop_touched = true;
      return out;
    }
  }

  // Settlement once the cut has passed: FX on the live hourly bar ending at the cut (else the last live bar
  // before it, once Yahoo has had 2h to print the cut bar); otherwise the daily close dated the cut.
  if (now >= c.cut) {
    let sp: number | null = null;
    if (c.fx) {
      const before = hourly.filter((b) => b.live && b.ts + HOUR <= c.cut);
      const at = before.find((b) => b.ts === c.cut - HOUR);
      if (at) sp = at.c;
      else if (now >= c.cut + 2 * HOUR && before.length) sp = before[before.length - 1].c;
    } else {
      const on = daily.find((b) => barDate(b.ts) === cutD);
      if (on) sp = on.c;
      else if (daily.some((b) => barDate(b.ts) > cutD)) sp = daily.filter((b) => barDate(b.ts) <= cutD).pop()?.c ?? null;
    }
    if (sp != null) {
      const paid = payoff(c, sp);
      out.settled_px = sp;
      freeze(paid);
      out.target_closed = paid > 0; out.stop_closed = paid === 0;
      return out;
    }
  }

  const hv = valueAtTime(c, lastLive.c, Math.min(lastLive.ts + HOUR, c.cut));
  out.v = hv.v; out.r = scoreR(hv.v, c.p0fill); out.left_n = hv.n;
  if (dl) {
    const dv = valueAtTime(c, dl.c, dailyValTime(c, barDate(dl.ts)));
    out.daily_v = dv.v; out.daily_r = scoreR(dv.v, c.p0fill);
  }
  return out;
}
