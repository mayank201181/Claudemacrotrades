// Trend Monitor (monitor-v2, parameters TM1): the dashboard's own implementation of the scheduled
// trend monitor's rules, sections 2–7 (universe, final bars, cleaning, status, levels and signals,
// states, realised vol, events, FX barrier board, number formats and the text report). Pure: the
// caller fetches the bars and passes the run time; no IO and no clock, so the same bars and run
// time give the same rows and report, character for character.
//
// Agreed deviations from the spec (each is also noted where it applies):
// D1 data access: Yahoo daily bars come from our own edge function (v8 chart API, interval 1d, as in
//    dash-history), FRED / ECB / MOF as in the spec. The spec's "Python downloads" are server
//    fetches, so data_path = 'server'.
// D2 no second source yet: the move test still runs; when it fires the asset is SUSPECT with
//    xcheck_move = NA (the spec's "no second source available" branch). Never REJECTED.
// D3 holiday calendars: the expected last_date uses weekdays plus the US federal holidays (observed
//    dates) for fx, US ETFs and US indices. Non-US indices and rates are STALE only when their last
//    final bar is more than 3 weekdays older than the run's previous weekday (no local calendars).
// D4 CSI300: the Yahoo symbol (and its fallback) is configuration in the asset table, not logic here.
// D5 run identity: run_date = the Singapore calendar date of run_utc (cron 00:30 UTC Tue–Sat).
import { normCdf } from './convexity.ts';

export type AssetClass = 'fx' | 'rates' | 'commodities' | 'equities';
export type AssetDef = {
  asset_id: string; asset_class: AssetClass; source: 'yahoo' | 'fred' | 'ecb' | 'mof'; symbol: string;
  field: 'close' | 'adjclose' | 'yield'; fx_group?: 'G10_USD' | 'JPY_CROSS' | 'ASIA_MANAGED' | 'ASIA_HIGHCARRY';
  px_dp: number; exch_close?: { tz: string; hhmm: string };
};
export type Bar = { date: string /* YYYY-MM-DD */; value: number };
export type Fetched = { asset_id: string; ok: boolean; error?: string; bars: Bar[]; last_bar_utc?: string | null };
export type Params = {
  params_version: string;
  state_stats: Record<string, number | null>; // key 'class|STATE'
  touch_lookup: Record<string, number>;       // key 'GROUP|k(2dp)|side'
};
export type Run = { run_utc: string /* ISO */ };

export type TrendState = 'STRONG_UP' | 'UP' | 'NEUTRAL' | 'DOWN' | 'STRONG_DOWN';
export type AssetStatus = 'OK' | 'SUSPECT' | 'REJECTED' | 'STALE';
export type EventType =
  | 'DATA_SUSPECT' | 'DATA_STALE' | 'STATE_CHANGE' | 'MA_CROSS' | 'TS_FLIP' | 'DON_FLIP' | 'NEW_52W_HIGH'
  | 'NEW_52W_LOW' | 'VOL_HIGH' | 'VOL_JUMP' | 'STRETCH_UP' | 'STRETCH_DN' | 'STRETCH_END';
type Sig = -1 | 0 | 1;

// The STATE line's fields, typed: numbers unrounded, null for NA.
export type StateRow = {
  run_date: string; asset_id: string; asset_class: AssetClass; last_date: string | null; bar_final: 'Y' | 'N';
  status: AssetStatus; xcheck_move: number | null; level: number | null;
  ma_ens: number | null; ts_ens: number | null; don_ens: number | null; all_ens: number | null;
  state: TrendState | null; prev_state: TrendState | null; state_age: number | null;
  ma_10_50: Sig | null; ma_20_100: Sig | null; ma_50_200: Sig | null;
  ts_21: Sig | null; ts_63: Sig | null; ts_126: Sig | null; ts_252: Sig | null;
  don_20: Sig | null; don_55: Sig | null; don_120: Sig | null; don_250: Sig | null;
  dist200_sig: number | null; rv20: number | null; rv60: number | null; rv20_pct3y: number | null; rv20_pct_chg5d: number | null;
  high_52w: number | null; low_52w: number | null; new_52w_high: 0 | 1 | null; new_52w_low: 0 | 1 | null; oos_hit21: number | null;
};
// The EVENT line's fields plus seq (0-based, in event order). value / prev are numbers (unrounded),
// a date string (DATA_SUSPECT / DATA_STALE value) or null for NA.
export type EventRow = {
  seq: number; run_date: string; asset_id: string; event_type: EventType; detail: string | null;
  value: number | string | null; prev: number | string | null;
};
// The BARRIER line's fields; h is the line's fixed 21 (sessions).
export type BarrierRow = {
  run_date: string; pair: string; last_date: string | null; spot: number | null; rv60: number | null; h: 21;
  k: 1 | 2; side: 'up' | 'down'; barrier: number | null; p_model: number; vol_mult: number; lookup_hit: 'Y' | 'N';
  p_adj: number; fair_per100: number;
};
export type MonitorMeta = {
  run_date: string; run_utc: string; params_version: string; n_assets: number; n_ok: number; n_stale: number;
  n_suspect: number; n_events: number; last_bar_utc: string | null; data_path: string;
  status: 'OK' | 'PARTIAL' | 'NO_DATA'; as_of: Record<AssetClass, string | null>;
};
export type Monitor = { meta: MonitorMeta; states: StateRow[]; events: EventRow[]; barriers: BarrierRow[]; report: string };

export const CLASSES: readonly AssetClass[] = ['fx', 'rates', 'commodities', 'equities'];
export const STATES: readonly TrendState[] = ['STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN'];
// D1: every number comes from this run's server fetches.
export const DATA_PATH = 'server';

// ---------- universe and TM1 parameters ----------

const NY_TZ = 'America/New_York';
const NY = { tz: NY_TZ, hhmm: '16:00' };
const fx = (asset_id: string, symbol: string, fx_group: AssetDef['fx_group'], px_dp: number): AssetDef =>
  ({ asset_id, asset_class: 'fx', source: 'yahoo', symbol, field: 'close', fx_group, px_dp });
const rate = (asset_id: string, source: AssetDef['source'], symbol: string): AssetDef =>
  ({ asset_id, asset_class: 'rates', source, symbol, field: 'yield', px_dp: 3 });
const etf = (asset_id: string, symbol: string): AssetDef =>
  ({ asset_id, asset_class: 'commodities', source: 'yahoo', symbol, field: 'adjclose', px_dp: 2, exch_close: NY });
const index = (asset_id: string, symbol: string, tz: string, hhmm: string): AssetDef =>
  ({ asset_id, asset_class: 'equities', source: 'yahoo', symbol, field: 'close', px_dp: 2, exch_close: { tz, hhmm } });

// Section 2, in the fixed universe order. Decimals per section 7. Euro STOXX's 17:30 CET is the
// exchange's local time, so Europe/Berlin (CET / CEST). D4: CSI300's symbol is configuration.
export const TM1_ASSETS: AssetDef[] = [
  fx('USDJPY', 'JPY=X', 'G10_USD', 3), fx('EURUSD', 'EURUSD=X', 'G10_USD', 5), fx('GBPUSD', 'GBPUSD=X', 'G10_USD', 5),
  fx('AUDUSD', 'AUDUSD=X', 'G10_USD', 5), fx('NZDUSD', 'NZDUSD=X', 'G10_USD', 5), fx('USDCAD', 'CAD=X', 'G10_USD', 5),
  fx('USDCHF', 'CHF=X', 'G10_USD', 5), fx('USDCNH', 'CNH=X', 'ASIA_MANAGED', 4), fx('USDKRW', 'KRW=X', 'ASIA_MANAGED', 2),
  fx('USDINR', 'INR=X', 'ASIA_HIGHCARRY', 2), fx('USDSGD', 'SGD=X', 'ASIA_MANAGED', 4), fx('USDTWD', 'TWD=X', 'ASIA_MANAGED', 2),
  fx('USDIDR', 'IDR=X', 'ASIA_HIGHCARRY', 0), fx('EURJPY', 'EURJPY=X', 'JPY_CROSS', 3), fx('AUDJPY', 'AUDJPY=X', 'JPY_CROSS', 3),
  rate('UST2Y', 'fred', 'DGS2'), rate('UST5Y', 'fred', 'DGS5'), rate('UST10Y', 'fred', 'DGS10'), rate('UST30Y', 'fred', 'DGS30'),
  rate('EUR10Y_AAA', 'ecb', 'YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y'), rate('JGB10Y', 'mof', '10Y'),
  etf('WTI', 'USO'), etf('BRENT', 'BNO'), etf('NATGAS', 'UNG'), etf('GOLD', 'GLD'), etf('SILVER', 'SLV'), etf('COPPER', 'CPER'),
  index('SPX', '^GSPC', NY_TZ, '16:00'), index('NDX', '^NDX', NY_TZ, '16:00'), index('SX5E', '^STOXX50E', 'Europe/Berlin', '17:30'),
  index('NKY', '^N225', 'Asia/Tokyo', '15:30'), index('HSI', '^HSI', 'Asia/Hong_Kong', '16:10'),
  index('HSCEI', '^HSCE', 'Asia/Hong_Kong', '16:10'), index('KOSPI', '^KS11', 'Asia/Seoul', '15:30'),
  index('TWSE', '^TWII', 'Asia/Taipei', '13:30'), index('AS51', '^AXJO', 'Australia/Sydney', '16:10'),
  index('NIFTY', '^NSEI', 'Asia/Kolkata', '15:30'), index('CSI300', '000300.SS', 'Asia/Shanghai', '15:00'),
];

// Section 1's STATE_STATS (hit21; NEUTRAL is NA) and TOUCH_LOOKUP (recommended vol_mult) blocks.
export const TM1_PARAMS: Params = {
  params_version: 'TM1',
  state_stats: {
    'fx|STRONG_UP': 0.502, 'fx|UP': 0.503, 'fx|NEUTRAL': null, 'fx|DOWN': 0.489, 'fx|STRONG_DOWN': 0.488,
    'rates|STRONG_UP': 0.527, 'rates|UP': 0.457, 'rates|NEUTRAL': null, 'rates|DOWN': 0.522, 'rates|STRONG_DOWN': 0.571,
    'commodities|STRONG_UP': 0.52, 'commodities|UP': 0.499, 'commodities|NEUTRAL': null, 'commodities|DOWN': 0.478, 'commodities|STRONG_DOWN': 0.436,
    'equities|STRONG_UP': 0.591, 'equities|UP': 0.61, 'equities|NEUTRAL': null, 'equities|DOWN': 0.439, 'equities|STRONG_DOWN': 0.39,
  },
  touch_lookup: {
    'ASIA_HIGHCARRY|1.00|down': 1.0, 'ASIA_HIGHCARRY|1.00|up': 1.0, 'ASIA_HIGHCARRY|2.00|down': 1.0, 'ASIA_HIGHCARRY|2.00|up': 1.0,
    'ASIA_MANAGED|1.00|down': 1.0, 'ASIA_MANAGED|1.00|up': 1.0, 'ASIA_MANAGED|2.00|down': 1.0, 'ASIA_MANAGED|2.00|up': 1.15,
    'G10_USD|1.00|down': 1.0, 'G10_USD|1.00|up': 1.0, 'G10_USD|2.00|down': 1.15, 'G10_USD|2.00|up': 1.0,
    'JPY_CROSS|1.00|down': 1.0, 'JPY_CROSS|1.00|up': 1.0, 'JPY_CROSS|2.00|down': 1.2, 'JPY_CROSS|2.00|up': 1.0,
    'OTHER|1.00|down': 1.0, 'OTHER|1.00|up': 1.0, 'OTHER|2.00|down': 1.0, 'OTHER|2.00|up': 1.0,
  },
};

// ---------- number formats ----------

// Round half away from zero on the number's shortest decimal form (Python's Decimal(str(x)) with
// ROUND_HALF_UP), so 2.675 → 2.68 although its binary value is 2.67499…. NA for null / non-finite.
// A result that rounds to zero is written unsigned (0.00, not -0.00).
export function fmtNum(x: number | null | undefined, dp: number): string {
  if (x == null || !Number.isFinite(x)) return 'NA';
  const [mant, ex] = String(Math.abs(x)).split('e');
  const [ip, fp = ''] = mant.split('.');
  let digits = ip + fp;
  let point = ip.length + (ex ? Number(ex) : 0); // the decimal point sits after `point` digits
  if (point <= 0) { digits = '0'.repeat(1 - point) + digits; point = 1; }
  if (digits.length < point + dp + 1) digits += '0'.repeat(point + dp + 1 - digits.length);
  let kept = BigInt(digits.slice(0, point + dp));
  if (digits[point + dp] >= '5') kept += 1n;
  let s = kept.toString().padStart(dp + 1, '0');
  if (dp > 0) s = s.slice(0, s.length - dp) + '.' + s.slice(s.length - dp);
  return x < 0 && kept !== 0n ? '-' + s : s;
}
const fmtInt = (x: number | null | undefined) => (x == null ? 'NA' : String(x));
const orNA = (s: string | null | undefined) => s ?? 'NA';

// ---------- dates and clocks ----------

const DAY_MS = 86400000;
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const isWeekday = (n: number) => { const w = new Date(n * DAY_MS).getUTCDay(); return w !== 0 && w !== 6; };
const isoSec = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// The US federal holidays of a year, on their observed dates (Saturday → Friday, Sunday → Monday).
// New Year's Day on a Saturday is observed on 31 December of the year before, which is included here.
const holidayCache = new Map<number, Set<string>>();
export function usFederalHolidays(y: number): Set<string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const nth = (m: number, dow: number, n: number) => { // n-th weekday `dow` of month m (0-based); n = -1 for the last
    if (n > 0) { const first = Date.UTC(y, m, 1) / DAY_MS; return first + ((dow - new Date(first * DAY_MS).getUTCDay() + 7) % 7) + 7 * (n - 1); }
    const last = Date.UTC(y, m + 1, 0) / DAY_MS;
    return last - ((new Date(last * DAY_MS).getUTCDay() - dow + 7) % 7);
  };
  const observed = (yy: number, m: number, d: number) => {
    const n = Date.UTC(yy, m, d) / DAY_MS, w = new Date(n * DAY_MS).getUTCDay();
    return w === 6 ? n - 1 : w === 0 ? n + 1 : n;
  };
  const days = [
    observed(y, 0, 1), nth(0, 1, 3), nth(1, 1, 3), nth(4, 1, -1), observed(y, 6, 4), nth(8, 1, 1), nth(9, 1, 2),
    observed(y, 10, 11), nth(10, 4, 4), observed(y, 11, 25), observed(y + 1, 0, 1),
  ];
  if (y >= 2021) days.push(observed(y, 5, 19)); // Juneteenth, a federal holiday since 2021
  const set = new Set(days.map(dayStr).filter((d) => d.startsWith(String(y))));
  holidayCache.set(y, set);
  return set;
}
// Good Friday (Easter Sunday - 2, anonymous Gregorian computus): not a federal holiday, but the NYSE
// is closed, so without it the US ETFs and indices would read STALE on the Saturday run after it.
export function goodFriday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayStr(Date.UTC(y, month - 1, day) / DAY_MS - 2);
}
// D3: a New York business day is a weekday that is neither a US federal holiday nor Good Friday.
export const nyBusinessDay = (n: number) => {
  const d = dayStr(n), y = +d.slice(0, 4);
  return isWeekday(n) && !usFederalHolidays(y).has(d) && d !== goodFriday(y);
};

// The local calendar date and minutes past midnight of an instant in a time zone.
const clockFmt = new Map<string, Intl.DateTimeFormat>();
export function localClock(ms: number, tz: string): { date: string; min: number } {
  let f = clockFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockFmt.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const hhmmMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const isUsListed = (a: AssetDef) => a.asset_class !== 'fx' && a.asset_class !== 'rates' && a.exch_close?.tz === NY_TZ;

// Section 3, final bars: whether a bar dated `date` is final at the run. FX: dated before the
// current UTC date. Equities and ETFs: before the exchange's local date, or on it once the run is at
// or after the close + 30 minutes. Rates (FRED / ECB / MOF) publish closed days only. `null` = cannot
// tell (an equity or ETF without a configured close).
function finalRule(a: AssetDef, runMs: number): (date: string) => boolean | null {
  if (a.asset_class === 'fx') { const today = isoSec(runMs).slice(0, 10); return (date) => date < today; }
  if (a.asset_class === 'rates') return () => true;
  if (!a.exch_close) return () => null;
  const c = localClock(runMs, a.exch_close.tz), closed = c.min >= hhmmMin(a.exch_close.hhmm) + 30;
  return (date) => date < c.date || (date === c.date && closed);
}

// Section 3 + D3, the date check of STALE. fx, US ETFs and US indices: the most recent New York
// business day that ended before the run, where a day has ended once a bar dated on it would pass
// the final-bar rule (so the two rules never disagree). Non-US indices and rates: stale when the last
// bar is more than 3 weekdays older than the weekday before run_date.
export function staleByDate(a: AssetDef, last: string, runMs: number, runDate: string): boolean {
  if (a.asset_class === 'fx' || isUsListed(a)) {
    let d: number;
    if (a.asset_class === 'fx') d = dayNum(isoSec(runMs).slice(0, 10)) - 1;
    else {
      const c = localClock(runMs, NY_TZ);
      d = dayNum(c.date);
      if (!(nyBusinessDay(d) && c.min >= hhmmMin(a.exch_close!.hhmm) + 30)) d--;
    }
    while (!nyBusinessDay(d)) d--;
    return dayNum(last) < d;
  }
  let prev = dayNum(runDate) - 1;
  while (!isWeekday(prev)) prev--;
  let older = 0; // weekdays d with last < d <= prev
  for (let d = dayNum(last) + 1; d <= prev; d++) if (isWeekday(d)) older++;
  return older > 3;
}

// ---------- signal helpers ----------

export const sign = (x: number): Sig => (x > 0 ? 1 : x < 0 ? -1 : 0);
// Exact ties that floating-point sums blur count as ties. Yields with 2 or 3 decimals move in whole
// steps, so two SMAs, or two rv20 windows, are often equal in exact arithmetic but differ by ~1e-13
// as floats. EPS sits far below any genuine difference of the inputs and far above that noise. Used
// for sign(SMA_a - SMA_b) (absolute, in L units), rv20 <= rv20_t (relative) and VOL_JUMP's >= 25.
const EPS = 1e-9;
const signTie = (d: number): Sig => (Math.abs(d) <= EPS ? 0 : sign(d));
const mean = (xs: (number | null)[]): number | null => (xs.some((x) => x == null) ? null : (xs as number[]).reduce((s, x) => s + x, 0) / xs.length);
// Simple moving average of L over the N values ending at i. Summed as deviations from L[i], so a
// flat window gives exactly L[i] and two flat-window SMAs compare equal (sign(0) = 0).
function sma(L: number[], N: number, i: number): number | null {
  if (i < N - 1) return null;
  let s = 0;
  for (let j = i - N + 1; j <= i; j++) s += L[j] - L[i];
  return L[i] + s / N;
}
// Sample standard deviation (ddof = 1) of r[lo..hi].
function sdSample(r: number[], lo: number, hi: number): number {
  const n = hi - lo + 1;
  let m = 0;
  for (let j = lo; j <= hi; j++) m += r[j];
  m /= n;
  let s = 0;
  for (let j = lo; j <= hi; j++) s += (r[j] - m) * (r[j] - m);
  return Math.sqrt(s / (n - 1));
}
// Donchian, always in the market: +1 on a close above the prior N's max, -1 below their min, else
// the previous value; 0 before the first break. Run from the start of the history.
export function donchian(L: number[], N: number): Sig[] {
  const out: Sig[] = new Array(L.length).fill(0);
  for (let i = N; i < L.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - N; j < i; j++) { if (L[j] > hi) hi = L[j]; if (L[j] < lo) lo = L[j]; }
    out[i] = L[i] > hi ? 1 : L[i] < lo ? -1 : out[i - 1];
  }
  return out;
}
// State on the unrounded all_ens.
export function stateOf(x: number | null): TrendState | null {
  if (x == null) return null;
  if (x >= 0.67) return 'STRONG_UP';
  if (x >= 0.33) return 'UP';
  if (x > -0.33) return 'NEUTRAL';
  if (x > -0.67) return 'DOWN';
  return 'STRONG_DOWN';
}

const MA_PAIRS = [[10, 50], [20, 100], [50, 200]] as const;
const TS_N = [21, 63, 126, 252] as const;
const DON_N = [20, 55, 120, 250] as const;

// ---------- one asset ----------

type Analysis = {
  def: AssetDef; row: StateRow; dates: string[]; v: number[];
  at: (i: number) => Signals | null; t: number;
  pct: (i: number) => number | null; dist: (i: number) => number | null;
  newHigh: (i: number) => 0 | 1 | null; newLow: (i: number) => 0 | 1 | null;
  prior52: (i: number, hi: boolean) => number | null; fx_group: string;
};
type Signals = { ma: (Sig | null)[]; ts: (Sig | null)[]; don: Sig[]; ma_ens: number | null; ts_ens: number | null; don_ens: number | null; all_ens: number | null; state: TrendState | null };

function analyse(a: AssetDef, f: Fetched | undefined, params: Params, runMs: number, runDate: string): Analysis {
  // Section 3: final bars, then sort by date with the last of each duplicate date kept, then the
  // value checks (rates keep zero and negative yields). Never forward-filled.
  let finalUnknown = false;
  const isFinal = finalRule(a, runMs), kept: Bar[] = [];
  for (const b of f?.ok ? f.bars : []) {
    const fin = isFinal(b.date);
    if (fin === false) continue;
    if (fin === null) finalUnknown = true;
    kept.push(b);
  }
  kept.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)); // stable: duplicates keep their order
  const dedup: Bar[] = [];
  for (const b of kept) {
    if (dedup.length && dedup[dedup.length - 1].date === b.date) dedup[dedup.length - 1] = b;
    else dedup.push(b);
  }
  const rates = a.asset_class === 'rates';
  const bars = dedup.filter((b) => typeof b.value === 'number' && Number.isFinite(b.value) && (rates || b.value > 0));
  const dates = bars.map((b) => b.date), v = bars.map((b) => b.value);
  const n = v.length, t = n - 1;
  const lastDate = n ? dates[t] : null;
  // bar_final = N when finality cannot be confirmed: no configured close and the bar is dated on
  // the run's UTC date or later (the latest possible date).
  const barFinal: 'Y' | 'N' = n && !(finalUnknown && dates[t] >= isoSec(runMs).slice(0, 10)) ? 'Y' : 'N';

  // Section 4, levels: ln(close), or x = -100 × yield (bp) for rates, so rising x = bonds rallying.
  const L = v.map((x) => (rates ? -100 * x : Math.log(x)));
  const r = L.map((x, i) => (i ? x - L[i - 1] : NaN)); // r[0] has no change; every window starts at 1
  const don = DON_N.map((N) => donchian(L, N));

  const sigCache = new Map<number, Signals>();
  const at = (i: number): Signals | null => {
    if (i < 0 || i >= n) return null;
    const hit = sigCache.get(i);
    if (hit) return hit;
    const ma = MA_PAIRS.map(([p, q]) => { const s = sma(L, p, i), l = sma(L, q, i); return s == null || l == null ? null : signTie(s - l); });
    const ts = TS_N.map((N) => (i >= N ? sign(L[i] - L[i - N]) : null));
    const d = don.map((x) => x[i]);
    const ma_ens = mean(ma), ts_ens = mean(ts), don_ens = mean(d);
    const all_ens = mean([ma_ens, ts_ens, don_ens]);
    const s: Signals = { ma, ts, don: d, ma_ens, ts_ens, don_ens, all_ens, state: stateOf(all_ens) };
    sigCache.set(i, s);
    return s;
  };

  // Realised vol: sqrt(252 × mean(r²)) over the last N changes; percent off rates, bp/yr on rates.
  const scale = rates ? 1 : 100;
  const rvAt = (N: number, i: number): number | null => {
    if (i < N || i >= n) return null;
    let s = 0;
    for (let j = i - N + 1; j <= i; j++) s += r[j] * r[j];
    return Math.sqrt((252 * s) / N) * scale;
  };
  const rv20s: (number | null)[] = v.map((_, i) => rvAt(20, i));
  // rv20_pct3y: share (%) of the last 756 rv20 values, i included, that are <= rv20_i (ties within EPS).
  const pct = (i: number): number | null => {
    if (i < 0 || i >= n || rv20s[i] == null) return null;
    const lim = rv20s[i]! * (1 + EPS);
    let le = 0, cnt = 0;
    for (let j = Math.max(0, i - 755); j <= i; j++) {
      const x = rv20s[j];
      if (x == null) continue;
      cnt++;
      if (x <= lim) le++;
    }
    return (100 * le) / cnt;
  };
  const sub = (x: number | null, y: number | null) => (x == null || y == null ? null : x - y);
  // dist200_sig = (L − SMA200) / (sd60 × √21), sd60 the sample sd of the last 60 changes.
  const dist = (i: number): number | null => {
    if (i < 60 || i >= n) return null;
    const m = sma(L, 200, i), sd = sdSample(r, i - 59, i);
    return m == null || !(sd > 0) ? null : (L[i] - m) / (sd * Math.sqrt(21));
  };
  // 52-week breaks on L against t-252 .. t-1.
  const ext = (lo: number, hi: number, max: boolean) => { // index of the extreme of L[lo..hi]
    let k = lo;
    for (let j = lo + 1; j <= hi; j++) if (max ? L[j] > L[k] : L[j] < L[k]) k = j;
    return k;
  };
  const newHigh = (i: number): 0 | 1 | null => (i < 252 || i >= n ? null : L[i] > L[ext(i - 252, i - 1, true)] ? 1 : 0);
  const newLow = (i: number): 0 | 1 | null => (i < 252 || i >= n ? null : L[i] < L[ext(i - 252, i - 1, false)] ? 1 : 0);
  // The prior 52-week extreme of L, as a level (a price, or a yield for rates).
  const prior52 = (i: number, hi: boolean) => (i < 252 || i >= n ? null : v[ext(i - 252, i - 1, hi)]);

  // Status. STALE: failed download, no usable bar, an old last_date, or (off rates) three identical
  // last closes. Then the move test: |r_t| > 6 × sd (ddof = 1, as sd60) of the previous 60 changes. D2: no second
  // source is fetched, so a firing test gives SUSPECT with xcheck_move = NA, never REJECTED.
  let status: AssetStatus = 'OK';
  if (!f?.ok || !n || staleByDate(a, lastDate!, runMs, runDate)) status = 'STALE';
  else if (!rates && n >= 3 && v[t] === v[t - 1] && v[t] === v[t - 2]) status = 'STALE';
  else if (t >= 61 && Math.abs(r[t]) > 6 * sdSample(r, t - 60, t - 1)) status = 'SUSPECT';

  const s = at(t), sp = at(t - 1);
  let age: number | null = null;
  if (s?.state) { age = 0; for (let i = t; i >= 0 && at(i)!.state === s.state; i--) age++; }
  // high_52w / low_52w: the extremes of L over t-252 .. t-1, the window the 52-week break test
  // defines (so they equal NEW_52W_*'s prev, "the prior 52-week extreme"), reported as levels. For
  // rates they refer to x, so high_52w is the lowest yield of the window.
  const hi = prior52(t, true), lo = prior52(t, false);
  const pt = pct(t);
  const oos = s?.state && s.state !== 'NEUTRAL' ? params.state_stats[`${a.asset_class}|${s.state}`] ?? null : null;

  const row: StateRow = {
    run_date: runDate, asset_id: a.asset_id, asset_class: a.asset_class, last_date: lastDate, bar_final: barFinal,
    status, xcheck_move: null, level: n ? v[t] : null,
    ma_ens: s?.ma_ens ?? null, ts_ens: s?.ts_ens ?? null, don_ens: s?.don_ens ?? null, all_ens: s?.all_ens ?? null,
    state: s?.state ?? null, prev_state: sp?.state ?? null, state_age: age,
    ma_10_50: s?.ma[0] ?? null, ma_20_100: s?.ma[1] ?? null, ma_50_200: s?.ma[2] ?? null,
    ts_21: s?.ts[0] ?? null, ts_63: s?.ts[1] ?? null, ts_126: s?.ts[2] ?? null, ts_252: s?.ts[3] ?? null,
    don_20: s?.don[0] ?? null, don_55: s?.don[1] ?? null, don_120: s?.don[2] ?? null, don_250: s?.don[3] ?? null,
    dist200_sig: dist(t), rv20: rvAt(20, t), rv60: rvAt(60, t), rv20_pct3y: pt, rv20_pct_chg5d: sub(pt, pct(t - 5)),
    high_52w: hi, low_52w: lo, new_52w_high: newHigh(t), new_52w_low: newLow(t), oos_hit21: oos,
  };
  return { def: a, row, dates, v, at, t, pct, dist, newHigh, newLow, prior52, fx_group: a.fx_group ?? 'OTHER' };
}

// ---------- events ----------

type Ev = Omit<EventRow, 'seq' | 'run_date'>;

// Section 5, one asset's events in the spec's type order. An event fires when its condition holds
// at t and not at t-1 (NA counts as not holding), unless stated otherwise.
function eventsOf(x: Analysis): Ev[] {
  const { row, t } = x, id = row.asset_id, out: Ev[] = [];
  const ev = (event_type: EventType, detail: string | null, value: number | string | null, prev: number | string | null) =>
    out.push({ asset_id: id, event_type, detail, value, prev });
  if (row.status === 'SUSPECT' || row.status === 'REJECTED') {
    // D2: no cross-check, so always XCHECK_NA (XCHECK_AGREES / XCHECK_DISAGREES need a second source).
    ev('DATA_SUSPECT', row.xcheck_move == null ? 'XCHECK_NA' : row.status === 'REJECTED' ? 'XCHECK_DISAGREES' : 'XCHECK_AGREES', row.last_date, row.xcheck_move);
  }
  if (row.status === 'STALE') ev('DATA_STALE', null, row.last_date, null);
  if (row.status !== 'OK' && row.status !== 'SUSPECT') return out;
  const s = x.at(t), p = x.at(t - 1);
  if (s && p) {
    if (s.state && p.state && s.state !== p.state) ev('STATE_CHANGE', `${p.state}->${s.state}`, s.all_ens, p.all_ens);
    const flips = (type: EventType, names: string[], now: (Sig | null)[], was: (Sig | null)[]) => {
      for (let k = names.length - 1; k >= 0; k--) { // longest first: ma_50_200, ts_252, don_250 …
        if (now[k] != null && was[k] != null && now[k] !== was[k]) ev(type, names[k], now[k], was[k]);
      }
    };
    flips('MA_CROSS', ['ma_10_50', 'ma_20_100', 'ma_50_200'], s.ma, p.ma);
    flips('TS_FLIP', ['ts_21', 'ts_63', 'ts_126', 'ts_252'], s.ts, p.ts);
    flips('DON_FLIP', ['don_20', 'don_55', 'don_120', 'don_250'], s.don, p.don);
  }
  // NEW_52W_HIGH / LOW: a new extreme at t and none in the previous 20 sessions.
  const fresh = (f: (i: number) => 0 | 1 | null) => {
    if (f(t) !== 1) return false;
    for (let i = t - 20; i < t; i++) if (f(i) === 1) return false;
    return true;
  };
  if (fresh(x.newHigh)) ev('NEW_52W_HIGH', null, x.v[t], x.prior52(t, true));
  if (fresh(x.newLow)) ev('NEW_52W_LOW', null, x.v[t], x.prior52(t, false));
  const p0 = x.pct(t), p1 = x.pct(t - 1), p5 = x.pct(t - 5), p6 = x.pct(t - 6);
  if (p0 != null && p0 >= 90 && !(p1 != null && p1 >= 90)) ev('VOL_HIGH', null, p0, p1);
  const c0 = p0 != null && p5 != null ? p0 - p5 : null, c1 = p1 != null && p6 != null ? p1 - p6 : null;
  if (c0 != null && c0 >= 25 - EPS && !(c1 != null && c1 >= 25 - EPS)) ev('VOL_JUMP', null, p0, p5);
  const d0 = x.dist(t), d1 = x.dist(t - 1);
  if (d0 != null && d0 > 2 && !(d1 != null && d1 > 2)) ev('STRETCH_UP', null, d0, d1);
  if (d0 != null && d0 < -2 && !(d1 != null && d1 < -2)) ev('STRETCH_DN', null, d0, d1);
  if (d0 != null && d1 != null && Math.abs(d0) <= 2 && Math.abs(d1) > 2) ev('STRETCH_END', null, d0, d1);
  return out;
}

// ---------- FX barrier board ----------

// Section 6: zero-drift rv60 barriers over h = 21 sessions, k in {1, 2}, up then down.
// p_model = 2Φ(−k); p_adj = 2Φ(−k / vol_mult) with vol_mult from TOUCH_LOOKUP (1.00 and
// lookup_hit = N when no line matches on group, round(k, 2) and side).
function barriersOf(x: Analysis, params: Params): BarrierRow[] {
  const { row } = x, out: BarrierRow[] = [];
  for (const side of ['up', 'down'] as const) {
    for (const k of [1, 2] as const) {
      const key = `${x.fx_group}|${fmtNum(k, 2)}|${side}`;
      const lm = params.touch_lookup[key];
      const hit = typeof lm === 'number' && Number.isFinite(lm);
      const vol_mult = hit ? lm : 1;
      const p_adj = 2 * normCdf(-k / vol_mult);
      const barrier = row.level != null && row.rv60 != null
        ? row.level * Math.exp((side === 'up' ? 1 : -1) * k * (row.rv60 / 100) * Math.sqrt(21 / 252)) : null;
      out.push({
        run_date: row.run_date, pair: row.asset_id, last_date: row.last_date, spot: row.level, rv60: row.rv60, h: 21, k, side,
        barrier, p_model: 2 * normCdf(-k), vol_mult, lookup_hit: hit ? 'Y' : 'N', p_adj, fair_per100: 100 * p_adj,
      });
    }
  }
  return out;
}

// ---------- the run ----------

export function computeMonitor(assets: AssetDef[], data: Fetched[], params: Params, run: Run): Monitor {
  const runMs = Date.parse(run.run_utc);
  const run_utc = isoSec(runMs);
  const run_date = localClock(runMs, 'Asia/Singapore').date; // D5
  const byId = new Map(data.map((f) => [f.asset_id, f]));
  const an = assets.map((a) => analyse(a, byId.get(a.asset_id), params, runMs, run_date));
  const states = an.map((x) => x.row);
  const usable = (x: Analysis) => x.row.status === 'OK' || x.row.status === 'SUSPECT';

  const events: EventRow[] = an.flatMap(eventsOf).map((e, seq) => ({ seq, run_date, ...e }));
  const barriers = an.filter((x) => x.def.asset_class === 'fx' && usable(x)).flatMap((x) => barriersOf(x, params));

  const nUsable = an.filter(usable).length, nAssets = assets.length;
  const status: MonitorMeta['status'] = nUsable * 10 >= nAssets * 9 && nAssets > 0 ? 'OK' : nUsable * 2 >= nAssets && nAssets > 0 ? 'PARTIAL' : 'NO_DATA';
  // as_of per class: the most common last_date among the class's assets (STALE ones included, as
  // they have a last_date); a tie goes to the later date.
  const as_of = {} as Record<AssetClass, string | null>;
  for (const c of CLASSES) {
    const cnt = new Map<string, number>();
    for (const r of states) if (r.asset_class === c && r.last_date) cnt.set(r.last_date, (cnt.get(r.last_date) ?? 0) + 1);
    let best: string | null = null;
    for (const [d, k] of cnt) if (best == null || k > cnt.get(best)! || (k === cnt.get(best)! && d > best)) best = d;
    as_of[c] = best;
  }
  // last_bar_utc: the latest FX bar timestamp the successful fetches returned, or NA when none
  // carries a time.
  let lastBar: number | null = null;
  for (const x of an) {
    const f = byId.get(x.def.asset_id);
    if (x.def.asset_class !== 'fx' || !f?.ok) continue;
    const ts = Date.parse(f.last_bar_utc ?? '');
    if (Number.isFinite(ts) && (lastBar == null || ts > lastBar)) lastBar = ts;
  }
  const meta: MonitorMeta = {
    run_date, run_utc, params_version: params.params_version, n_assets: nAssets,
    n_ok: states.filter((r) => r.status === 'OK').length, n_stale: states.filter((r) => r.status === 'STALE').length,
    n_suspect: states.filter((r) => r.status === 'SUSPECT' || r.status === 'REJECTED').length, n_events: events.length,
    last_bar_utc: lastBar == null ? null : isoSec(lastBar), data_path: DATA_PATH, status, as_of,
  };
  let report = renderReport(meta, an, events, barriers, nUsable);
  // Section 7's self-check on the machine block. The report is a pure function of the rows, so a
  // recompute would fail again: go straight to the spec's FORMAT_CHECK_FAILED output.
  const pairs = new Set(barriers.map((b) => b.pair)).size;
  if (meta.status !== 'NO_DATA' && !selfCheck(report, nAssets, events.length, pairs)) {
    const lines = report.split('\n');
    meta.status = 'NO_DATA';
    report = [lines[0], 'STATUS: NO_DATA', 'BEGIN_TREND_MONITOR|v2', lines[lines.indexOf('BEGIN_TREND_MONITOR|v2') + 1],
      'ERROR|FORMAT_CHECK_FAILED', 'END_TREND_MONITOR'].join('\n');
  }
  return { meta, states, events, barriers, report };
}

// The spec's SELF-CHECK: one META line, n_assets STATE lines, n_events EVENT lines, 4 BARRIER lines
// per usable fx pair, each line with its field count (tag included), and data_path as expected.
const FIELD_COUNTS: Record<string, number> = { META: 11, STATE: 37, EVENT: 7, BARRIER: 15 };
function selfCheck(report: string, nAssets: number, nEvents: number, nPairs: number): boolean {
  const lines = report.split('\n'), b = lines.indexOf('BEGIN_TREND_MONITOR|v2'), e = lines.indexOf('END_TREND_MONITOR');
  if (b < 0 || e < b) return false;
  const count: Record<string, number> = {};
  for (const ln of lines.slice(b + 1, e)) {
    const f = ln.split('|');
    if (FIELD_COUNTS[f[0]] !== f.length) return false;
    count[f[0]] = (count[f[0]] ?? 0) + 1;
  }
  return count.META === 1 && lines[b + 1].endsWith(`|${DATA_PATH}`) && (count.STATE ?? 0) === nAssets
    && (count.EVENT ?? 0) === nEvents && (count.BARRIER ?? 0) === 4 * nPairs;
}

// ---------- the text report (section 7) ----------

// An event's value / prev in the units of its type.
function fmtEventValue(e: EventRow, a: AssetDef, which: 'value' | 'prev'): string {
  const x = e[which];
  if (typeof x === 'string') return x;
  switch (e.event_type) {
    case 'STATE_CHANGE': case 'STRETCH_UP': case 'STRETCH_DN': case 'STRETCH_END': case 'DATA_SUSPECT': return fmtNum(x, 2);
    case 'MA_CROSS': case 'TS_FLIP': case 'DON_FLIP': return fmtInt(x);
    case 'NEW_52W_HIGH': case 'NEW_52W_LOW': return fmtNum(x, a.px_dp);
    case 'VOL_HIGH': case 'VOL_JUMP': return fmtNum(x, 0);
    default: return x == null ? 'NA' : String(x);
  }
}

function stateLine(r: StateRow, a: AssetDef): string {
  const px = (x: number | null) => fmtNum(x, a.px_dp), e2 = (x: number | null) => fmtNum(x, 2);
  return [
    'STATE', r.run_date, r.asset_id, r.asset_class, orNA(r.last_date), r.bar_final, r.status, e2(r.xcheck_move), px(r.level),
    e2(r.ma_ens), e2(r.ts_ens), e2(r.don_ens), e2(r.all_ens), orNA(r.state), orNA(r.prev_state), fmtInt(r.state_age),
    fmtInt(r.ma_10_50), fmtInt(r.ma_20_100), fmtInt(r.ma_50_200), fmtInt(r.ts_21), fmtInt(r.ts_63), fmtInt(r.ts_126), fmtInt(r.ts_252),
    fmtInt(r.don_20), fmtInt(r.don_55), fmtInt(r.don_120), fmtInt(r.don_250), e2(r.dist200_sig), fmtNum(r.rv20, 1), fmtNum(r.rv60, 1),
    fmtNum(r.rv20_pct3y, 0), fmtNum(r.rv20_pct_chg5d, 0), px(r.high_52w), px(r.low_52w), fmtInt(r.new_52w_high), fmtInt(r.new_52w_low),
    fmtNum(r.oos_hit21, 3),
  ].join('|');
}

function renderReport(meta: MonitorMeta, an: Analysis[], events: EventRow[], barriers: BarrierRow[], nUsable: number): string {
  const defOf = new Map(an.map((x) => [x.def.asset_id, x.def]));
  const rowOf = new Map(an.map((x) => [x.def.asset_id, x.row]));
  const L: string[] = [];
  L.push(`ChatGPT Work — Trend Monitor — ${meta.run_date}`);
  L.push(`STATUS: ${meta.status} | as_of ${CLASSES.map((c) => `${c} ${orNA(meta.as_of[c])}`).join(' ')} | assets_usable ${nUsable}/${meta.n_assets} | params ${meta.params_version} | events ${meta.n_events}`);
  const metaLine = ['META', meta.run_date, meta.run_utc, meta.params_version, meta.n_assets, meta.n_ok, meta.n_stale, meta.n_suspect,
    meta.n_events, orNA(meta.last_bar_utc), meta.data_path].join('|');
  if (meta.status === 'NO_DATA') return [...L, 'BEGIN_TREND_MONITOR|v2', metaLine, 'ERROR|INSUFFICIENT_DATA', 'END_TREND_MONITOR'].join('\n');

  L.push('', `EVENTS (${events.length})`);
  if (!events.length) L.push('none');
  for (const e of events) {
    const a = defOf.get(e.asset_id)!, r = rowOf.get(e.asset_id)!;
    L.push(`${e.asset_id} ${e.event_type} ${orNA(e.detail)} ${fmtEventValue(e, a, 'prev')}->${fmtEventValue(e, a, 'value')} | state ${orNA(r.state)} age ${fmtInt(r.state_age)} | dist200 ${fmtNum(r.dist200_sig, 2)} | rv20pct ${fmtNum(r.rv20_pct3y, 0)} | oos_hit21 ${fmtNum(r.oos_hit21, 3)} | ${r.status}`);
  }
  L.push('', 'STATE BOARD');
  const usableRows = an.map((x) => x.row).filter((r) => r.status === 'OK' || r.status === 'SUSPECT');
  for (const c of CLASSES) {
    const parts = STATES.map((s) => `${s} ${usableRows.filter((r) => r.asset_class === c && r.state === s).map((r) => r.asset_id).join(',') || '-'}`);
    L.push(`${c}: ${parts.join(' ; ')}`);
  }
  L.push('', 'FX BARRIER BOARD (21 sessions, rv60, zero drift)');
  const pairs = [...new Set(barriers.map((b) => b.pair))];
  for (const p of pairs) {
    const a = defOf.get(p)!, bs = barriers.filter((b) => b.pair === p), b0 = bs[0];
    const cell = (side: 'up' | 'down', k: 1 | 2) => { const b = bs.find((x) => x.side === side && x.k === k)!; return `${fmtNum(b.barrier, a.px_dp)} ${fmtNum(b.fair_per100, 1)}`; };
    L.push(`${p} spot ${fmtNum(b0.spot, a.px_dp)} rv60 ${fmtNum(b0.rv60, 1)} | UP1 ${cell('up', 1)} | UP2 ${cell('up', 2)} | DN1 ${cell('down', 1)} | DN2 ${cell('down', 2)}`);
  }
  L.push('', 'BEGIN_TREND_MONITOR|v2', metaLine);
  for (const x of an) L.push(stateLine(x.row, x.def));
  for (const e of events) {
    const a = defOf.get(e.asset_id)!;
    L.push(['EVENT', e.run_date, e.asset_id, e.event_type, orNA(e.detail), fmtEventValue(e, a, 'value'), fmtEventValue(e, a, 'prev')].join('|'));
  }
  for (const b of barriers) {
    const dp = defOf.get(b.pair)!.px_dp;
    L.push(['BARRIER', b.run_date, b.pair, orNA(b.last_date), fmtNum(b.spot, dp), fmtNum(b.rv60, 1), b.h, fmtNum(b.k, 1), b.side,
      fmtNum(b.barrier, dp), fmtNum(b.p_model, 3), fmtNum(b.vol_mult, 2), b.lookup_hit, fmtNum(b.p_adj, 3), fmtNum(b.fair_per100, 1)].join('|'));
  }
  L.push('END_TREND_MONITOR');
  return L.join('\n');
}
