// The option twin of a cash FX card (rule R18, a four-week trial from November 2026): the R01 structure that
// expresses the same view, bought at the card's own fill, with the premium as 1R. The digest writes one terms
// line in the card's block and nothing else; the premium at the fill, every mark, a touch, the settlement at
// the cut and an early close are all computed here from hourly bars with the convexity code, so no arithmetic
// of record is done by a model. A twin never touches the book, its caps or its scorecard.
//
//   TWIN: <struct> · strike <K, H or Kn/Kf> · cut <YYYY-MM-DD> · pay <ccy or -> · iv <x.x%> <source> · carry <±x.xx%>
//
// struct is dig-up, dig-dn, ot-up, ot-dn, cs or ps (a twin is a directional view, so no no-touch). A cut given
// as a date is the 10:00 New York cut of that day; "YYYY-MM-DD HH:MM SGT" is taken as written. iv is an annual
// at-the-money implied vol, which R01 turns into a per-session vol as iv ÷ √252 and keeps for the twin's life.
// carry is the terms-currency rate less the base-currency rate, a year (the forward drift the market pack prints).
import { type Bar, HOUR } from './marks.ts';
import { type ConvexCard, earlyCloseR, isBinary, liveSinceFill, markConvexity, nyClose, parseSgt, premium, type Struct, valueAtTime } from './convexity.ts';

export const TWIN_STRUCTS: readonly Struct[] = ['dig-up', 'dig-dn', 'ot-up', 'ot-dn', 'cs', 'ps'];
// R01's floor: a premium under 10% of the payout is not carded, and a flat-vol price is least reliable there.
export const TWIN_MIN_PREMIUM = 0.1;
const UP = new Set<string>(['dig-up', 'ot-up', 'cs']);
const G10 = new Set(['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK']);
// Rule R07's non-deliverable currencies, and onshore CNY: Yahoo's bars do not see their offshore hours, so a
// touch there would go unrecorded. A twin on them is a digital or a spread, which settle on one price at the cut.
const NDF = new Set(['INR', 'KRW', 'TWD', 'IDR', 'PHP', 'MYR', 'CNY']);
const DAY = 24 * HOUR;
const SGT = 8 * HOUR;

const num = (s: string | undefined | null): number | null => {
  const m = (s ?? '').replace(/[−–]/g, '-').replace(/(\d),(?=\d{3}(?!\d))/g, '$1').match(/[+-]?\d+(?:\.\d+)?/);
  const v = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
};

// [base, terms] of an '=X' symbol: EURUSD=X → EUR, USD; a 3-letter symbol (JPY=X) is quoted against USD.
export function fxPair(proxy: string): [string, string] | null {
  const m = (proxy ?? '').trim().toUpperCase().match(/^([A-Z]{3})([A-Z]{3})?=X$/);
  return m ? (m[2] ? [m[1], m[2]] : ['USD', m[1]]) : null;
}

// R01's dealing-cost tier: 1 when both currencies are G10, else 2 (Asia and EM).
export function twinTier(proxy: string): 1 | 2 {
  const p = fxPair(proxy);
  return p && G10.has(p[0]) && G10.has(p[1]) ? 1 : 2;
}

// The terms line as a key/value record (its "TWIN:" label is optional); an error string when it cannot be read.
export function parseTwin(line: string): Record<string, string> | string {
  const toks = (line ?? '').replace(/^\s*TWIN:\s*/i, '').split(/\s+·\s+/).map((t) => t.trim()).filter(Boolean);
  if (!toks.length) return 'empty';
  const out: Record<string, string> = { struct: toks[0].toLowerCase() };
  for (const t of toks.slice(1)) {
    const sp = t.indexOf(' ');
    if (sp > 0) out[t.slice(0, sp).toLowerCase()] = t.slice(sp + 1).trim();
  }
  for (const k of ['strike', 'cut', 'iv']) if (!out[k]) return `${k} missing`;
  return out;
}

// 10:00 New York on a weekday date, in ms UTC.
function nyCut(s: string): number | null {
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  const t = m ? Date.parse(m[0] + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(t) || new Date(t).getUTCDay() % 6 === 0) return null;
  return nyClose(m![0]) - 6 * HOUR;
}

// The twin as a convexity card, before its premium is known (markTwin sets p0fill from the fill).
// `direction` is the linear card's: +1 long the proxy's own number, −1 short.
export function twinCard(proxy: string, line: string, direction: number): ConvexCard | string {
  const pair = fxPair(proxy);
  if (!pair) return 'a twin needs a single FX proxy';
  const kv = parseTwin(line);
  if (typeof kv === 'string') return kv;
  const struct = kv.struct as Struct;
  if (!TWIN_STRUCTS.includes(struct)) return `struct ${kv.struct}`;
  if (direction !== 0 && UP.has(struct) !== direction > 0) return `struct ${struct} on a ${direction > 0 ? 'long' : 'short'} card`;
  if (struct.startsWith('ot') && pair.some((c) => NDF.has(c))) return `struct ${struct}: the bars cannot see an offshore touch on ${pair.join('')}`;
  const spread = struct === 'cs' || struct === 'ps';
  const ks = kv.strike.split('/').map((x) => num(x));
  if (ks.length !== (spread ? 2 : 1) || ks.some((x) => x == null || !(x > 0))) return `strike ${kv.strike}`;
  const [k, kf] = ks as number[];
  if (spread && (struct === 'cs' ? !(k < kf) : !(k > kf))) return `strike ${kv.strike}: Kn is the strike nearer the spot`;
  const cut = /\d{1,2}:\d{2}/.test(kv.cut) ? parseSgt(kv.cut) : nyCut(kv.cut);
  if (cut == null) return `cut ${kv.cut}`;
  const iv = num((kv.iv.match(/[\d.,]+\s*%/) ?? [kv.iv])[0]);
  if (iv == null || !(iv >= 0.5 && iv <= 80)) return `iv ${kv.iv}`;
  const cy = kv.carry == null || kv.carry === '-' ? 0 : num(kv.carry);
  if (cy == null || !(Math.abs(cy) <= 25)) return `carry ${kv.carry}`;
  const pay = ((kv.pay ?? '-').toUpperCase().match(/[A-Z]{3}|-/) ?? ['?'])[0];
  if (pay !== '-' && !pair.includes(pay)) return `pay ${kv.pay}`;
  return {
    struct, k, kf: spread ? kf : null, model: 'lognormal', fx: true, basePay: pay === pair[0], carry: cy / 100, cut,
    vol: iv / 100 / Math.sqrt(252), p0: null, p0fill: 0,
  };
}

// The end of the hourly bar a view or reader close was dealt on: among the bars ending on the closed SGT date,
// the one whose close is nearest the book's closing mark, when it is within 5 parts in 10,000; else null.
export function exitBar(hourly: Bar[], closedDate: string, px: number | null): number | null {
  const d0 = Date.parse(closedDate + 'T00:00:00Z') - SGT;
  if (px == null || !(px > 0) || !Number.isFinite(d0)) return null;
  let best: Bar | null = null;
  for (const b of hourly) {
    const end = b.ts + HOUR;
    if (end <= d0 || end > d0 + DAY) continue;
    if (!best || Math.abs(b.c - px) < Math.abs(best.c - px)) best = b;
  }
  return best && Math.abs(best.c / px - 1) <= 5e-4 ? best.ts + HOUR : null;
}

export interface TwinMark {
  state: 'open' | 'touch' | 'expiry' | 'view';
  r: number;            // R on the premium: V ÷ p0fill − 1 while open, the settled or early-close figure once closed
  v: number;            // value as a share of the maximum payout
  p0fill: number;       // premium paid at the fill, share of the payout (R01 price plus dealing cost)
  fill_px: number;      // spot at the fill: the open of the first hourly bar at or after the card's fill time
  as_of: number;        // ms UTC of the mark, touch, settlement or early close
  px: number | null;    // the price behind it
  left_n: number;       // sessions left to the cut (0 once closed)
}

export interface TwinOpts {
  // The linear card's own exit when it closed on a changed view or a reader's close: the twin closes with it
  // (R01 EARLY CLOSE). A stop, target or time exit is not passed, so the twin runs on to a touch or its cut.
  early?: { ts: number; px: number | null } | null;
  // The premium and fill price stored at the first mark; given, they are not recomputed (Yahoo revises old bars).
  frozen?: { p0fill: number; fill_px: number } | null;
}

// Marks one twin. `hourly` carries `live` (liveSinceFill) and reaches back to the fill. Touches are judged on
// live hourly bars only: Yahoo's daily FX closes are too often stale to settle anything on.
// Returns an error string when the twin cannot be priced.
export function markTwin(card0: ConvexCard, hourly: Bar[], fillTs: number, now: number, tier: 1 | 2, opts: TwinOpts = {}): TwinMark | string {
  let p0fill: number, fillPx: number;
  if (opts.frozen && opts.frozen.p0fill > 0) ({ p0fill, fill_px: fillPx } = opts.frozen);
  else {
    const fb = hourly.find((b) => b.ts >= fillTs);
    if (!fb || fb.ts - fillTs > 3 * DAY) return 'no hourly bar at the fill';
    const at = valueAtTime(card0, fb.o, fb.ts);
    if (!(at.n >= 1)) return 'cut within a session of the fill';
    p0fill = premium(at.v, isBinary(card0.struct), tier);
    fillPx = fb.o;
    if (!(p0fill >= TWIN_MIN_PREMIUM)) return `premium ${(p0fill * 100).toFixed(1)}% of payout at the fill, under the 10% floor`;
    if (!(p0fill <= 0.9)) return `premium ${(p0fill * 100).toFixed(1)}% of payout at the fill: already through its level`;
  }
  const card: ConvexCard = { ...card0, p0fill };
  const e = opts.early;
  const end = e && e.ts > fillTs && e.ts < card.cut && e.ts <= now ? e.ts : null;
  // An early close at `end` sees only the bars that had ended by then; the last of them prices it.
  const m = markConvexity(card, hourly, [], fillTs, end != null ? end - 1 : now);
  if (!m) return 'no live hourly bars';
  const base = { p0fill, fill_px: fillPx };
  if (m.paid != null) {
    const touch = m.touched_at != null;
    return { ...base, state: touch ? 'touch' : 'expiry', r: m.r, v: m.paid, as_of: touch ? m.touched_at! : card.cut, px: touch ? m.touched_px : m.settled_px, left_n: 0 };
  }
  if (end != null) {
    const px = e!.px ?? m.price;
    const v = valueAtTime(card, px, end).v;
    return { ...base, state: 'view', r: earlyCloseR(isBinary(card.struct), v, p0fill, tier), v, as_of: end, px, left_n: 0 };
  }
  return { ...base, state: 'open', r: m.r, v: m.v, as_of: m.as_of, px: m.price, left_n: m.left_n };
}

// What dash-mark stores in the trade's meta (strings, like every other meta value). `line` is the terms line
// the mark was made from: it is kept as twin_terms, so a later edit of the book's line cannot re-strike the twin.
export function twinMeta(m: TwinMark | string, line: string): Record<string, string> {
  if (typeof m === 'string') return { twin_state: `skipped: ${m}` };
  return {
    twin_terms: line.replace(/^\s*TWIN:\s*/i, '').trim(), twin_state: m.state, twin_r: m.r.toFixed(2), twin_v: (m.v * 100).toFixed(1),
    twin_p0: (m.p0fill * 100).toFixed(1), twin_fill: String(+m.fill_px.toPrecision(8)),
    twin_px: m.px == null ? '-' : String(+m.px.toPrecision(8)), twin_asof: new Date(m.as_of).toISOString(), twin_left: m.left_n.toFixed(1),
  };
}

// The premium and fill price of an earlier mark, read back from the meta; null before the first mark.
export function twinFrozen(meta: Record<string, string>): { p0fill: number; fill_px: number } | null {
  const p0 = num(meta.twin_p0), px = num(meta.twin_fill);
  return p0 != null && p0 > 0 && px != null && px > 0 ? { p0fill: Math.round(p0 * 10) / 1000, fill_px: px } : null; // tenths of a point, as premium() prints
}

// One card's twin, from the trade row to what dash-mark stores. `raw` is the proxy's hourly history (6 months),
// `closing` the book's closing mark when the card closed on a changed view or a reader's close (a spot price).
// A twin that already holds a mark keeps it through a failure (a Yahoo outage, say): `meta` is then null.
export interface TwinTrade { proxy: string; direction: number | string | null; status: string; filled: string | null; closed: string | null; meta: Record<string, string> | null }
export function scoreTwin(t: TwinTrade, raw: Bar[], closing: number | null, now: number): { meta: Record<string, string> | null; skipped: string | null } {
  const meta = t.meta ?? {};
  const line = meta.twin_terms ?? meta.twin ?? '';
  const frozen = twinFrozen(meta);
  const fail = (why: string) => ({ meta: frozen ? null : twinMeta(why, line), skipped: why });
  const card = twinCard(t.proxy, line, Number(t.direction ?? 0));
  if (typeof card === 'string') return fail(card);
  const fillTs = parseSgt(t.filled ?? undefined);
  if (fillTs == null) return fail('no fill time');
  const h = liveSinceFill(raw, fillTs, true);
  let early: TwinOpts['early'] = null;
  if (t.status === 'closed-view' || t.status === 'closed-reader') {
    const d = (t.closed ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!d) return fail('closed date missing');
    // With no bar matching the closing mark, 09:00 SGT: the close of the first hour after a morning run.
    early = { ts: exitBar(h, d, closing) ?? Date.parse(d + 'T01:00:00Z'), px: closing };
  }
  const m = markTwin(card, h, fillTs, now, twinTier(t.proxy), { early, frozen });
  return typeof m === 'string' ? fail(m) : { meta: twinMeta(m, line), skipped: null };
}
