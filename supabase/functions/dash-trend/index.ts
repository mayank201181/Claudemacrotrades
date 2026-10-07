// dash-trend: daily (pg_cron dash-trend-daily, 00:30 UTC Tue–Sat = 08:30 SGT). The Trend Monitor
// (monitor-v2, parameters TM1, rules in _shared/trend.ts): fetches 8 years of daily data for every
// asset of the universe, runs computeMonitor and stores the run in dash.trend_run / trend_state /
// trend_event / trend_barrier, keyed by run_date (a rerun for the same run_date replaces that run's
// rows in one transaction), plus the closes it used in dash.trend_px.
// POST {token, run_utc?, dry?, only?}; the token is the ingest token.
//   run_utc  replays a past run time: Yahoo is asked for bars up to it and any bar dated after its
//            UTC date is dropped (FRED / ECB / MOF serve today's files only, so a replay sees their
//            later revisions);
//   dry      computes and returns the summary and the report text without writing anything;
//   only     restricts the universe to these asset_ids, for testing a fetch; always dry, since a
//            partial universe must never replace a stored run.
// The reply streams a space every 10 s until the JSON summary, so neither the gateway nor pg_net
// drops a long run; the fetches stop at a time budget and anything left is a failed download (STALE).
// Spec deviations (all listed in _shared/trend.ts) that live here:
//   D1 every number comes from this function's own fetches: Yahoo v8 chart (interval 1d, as in
//      dash-history), FRED fredgraph.csv, ECB data-api csvdata, MOF jgbcme_all.csv + jgbcme.csv (when
//      the history file fails, the closes stored in dash.trend_px stand in for it; see fetchOther);
//   D4 the Yahoo symbol of an asset, and any fallbacks tried in order when it fails, come from
//      dash.config 'trend_symbols' ({asset_id: [symbol, fallback, …]}); without an entry, the
//      universe's own symbol. A symbol ending '@1h' (CNH=X@1h) is built from Yahoo's hourly bars,
//      for an FX symbol whose daily series Yahoo no longer serves (see parseYahooHourly).
// POST also takes symbols ({asset_id: [symbol, …]}, merged over 'trend_symbols') with only, so a
// symbol choice can be tested on a few assets; it is never used for a stored run.
// POST {token, shadow: 'TM1.1', dry?, diag?} runs the TM1.1 shadow instead (pg_cron
// dash-trend-shadow-daily, 10 minutes after the main run): the 15 FX pairs only, each close the
// 17:00 New York price (D6 in _shared/trend.ts; parseYahooHourlyNy, redateDaily), stored in
// dash.trend_shadow by run_date and params_version beside the TM1 run, never in its tables.
// diag adds the per-pair splice statistics to the reply.
import postgres from 'npm:postgres@3.4.4';
import { type AssetDef, type Bar, type Fetched, type Params, TM1_ASSETS, TM1_PARAMS, computeMonitor } from '../_shared/trend.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
type Json = Record<string, unknown>;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const FETCH_BUDGET_MS = 240_000; // fetches stop here; the writes fit in what is left of ~300 s
const TIMEOUT_MS = 30_000;       // per request
const RETRIES = 3;               // the spec's rules: a download that fails after 3 retries is STALE
const YAHOO_SPACING_MS = 1_000;  // spec section 2: one ticker at a time, 1 s apart
const MIN_BARS = 260;            // fewer daily bars than a 52-week window needs (of 8 years asked) is a failed download

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

// One download with up to 3 retries (2 s, 4 s, 8 s; 5 s, 10 s, 20 s after a rate limit), never past the budget.
// any4xx retries every 4xx too, for a host whose 404s come and go (MOF, 2026-10-07: of five fetches
// from this function, the history file 404'd on four and the current-month file on two).
async function retry<T>(fn: () => Promise<T>, deadline: number, any4xx = false): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      // A 4xx other than a rate limit (an unknown symbol) will not get better on a retry.
      if (!any4xx && e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) break;
      const wait = (e instanceof HttpError && e.status === 429 ? 5000 : 2000) * 2 ** i;
      if (i === RETRIES || Date.now() + wait > deadline) break;
      await sleep(wait);
    }
  }
  throw last;
}

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(r.status, `${new URL(url).hostname} ${r.status}`); }
  return r;
}

// ---------- parsers ----------

// Yahoo v8 chart, daily: each bar dated in the exchange's own time zone (the yfinance layout), the
// value from Close or Adj Close per the asset. last_bar_utc is the latest bar's timestamp, in UTC.
// Yahoo can publish a day's Close hours before its Adj Close (2026-10-07: at 00:30 UTC the six
// commodity ETFs had no Adj Close for 2026-10-06, which was there by 00:50, while the indices' Close
// was). Adj Close is the Close times a factor that changes only at an ex-date, so a trailing bar with
// a Close and no Adj Close yet takes its Close times the factor of the last bar that has both;
// `filled` counts them (only trailing bars: a gap inside the series stays a gap).
export function parseYahoo(j: any, field: AssetDef['field']): { bars: Bar[]; last_bar_utc: string | null; filled: number } {
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || 'yahoo: no result');
  const ts: number[] = res.timestamp ?? [];
  const q = res.indicators?.quote?.[0];
  const src: unknown[] | undefined = field === 'adjclose' ? res.indicators?.adjclose?.[0]?.adjclose : q?.close;
  if (!ts.length || !src) throw new Error(field === 'adjclose' ? 'yahoo: no adjclose' : 'yahoo: no bars');
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: res.meta?.exchangeTimezoneName || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  let lastAdj = -1;
  if (field === 'adjclose') for (let i = ts.length - 1; i >= 0; i--) if (fin(src[i]) && fin(q?.close?.[i]) && q.close[i] > 0) { lastAdj = i; break; }
  const factor = lastAdj >= 0 ? (src[lastAdj] as number) / q.close[lastAdj] : null;
  const bars: Bar[] = [];
  let filled = 0;
  ts.forEach((t, i) => {
    let v = src[i];
    if (!fin(v) && factor != null && i > lastAdj && fin(q?.close?.[i])) { v = q.close[i] * factor; filled++; }
    if (fin(v)) bars.push({ date: day.format(new Date(t * 1000)), value: v });
  });
  const last = ts[ts.length - 1];
  return { bars, last_bar_utc: Number.isFinite(last) ? new Date(last * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null, filled };
}

// Yahoo v8 chart, hourly, to the daily bars of the FX daily layout. Yahoo serves only the latest day
// of CNH=X at interval 1d (also 1wk, 1mo, any range), but its hourly bars go back to Dec 2023. A
// finished Yahoo FX daily bar dated D does not carry D's last price: its close is the price at about
// 01:00 London on D (USDJPY and EURUSD, Jan 2024 to Oct 2026: median 1.5 / 2.5 bp from the close of
// the hourly bar starting 00:00 London, against 30 bp from D's last hourly close). So, to stay on
// the clock of the other 14 pairs, the bar dated D (a London weekday) is the close of the first
// hourly bar starting at or after 00:00 London on D and before 03:00. last_bar_utc as parseYahoo.
export function parseYahooHourly(j: any): { bars: Bar[]; last_bar_utc: string | null } {
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || 'yahoo: no result');
  const ts: number[] = res.timestamp ?? [];
  const src: unknown[] | undefined = res.indicators?.quote?.[0]?.close;
  if (!ts.length || !src) throw new Error('yahoo: no bars');
  // London's UTC offset, looked up once per UTC day at 12:00 (the clocks change at 01:00 UTC on a
  // Sunday, when FX is shut, so no weekday bar sits on the wrong side of a change). The per-day cache
  // keeps the ~17,500 hourly bars inside the edge worker's CPU allowance.
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' });
  const offset = new Map<number, number>();
  const byDate = new Map<string, number>();
  ts.forEach((t, i) => {
    const v = src[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const utcDay = Math.floor(t / 86400);
    let off = offset.get(utcDay);
    if (off == null) { off = (Number(hourFmt.format(new Date((utcDay * 86400 + 43200) * 1000))) - 12 + 24) % 24; offset.set(utcDay, off); }
    const local = new Date((t + off * 3600) * 1000), wd = local.getUTCDay(), date = local.toISOString().slice(0, 10);
    if (wd === 0 || wd === 6 || local.getUTCHours() >= 3 || byDate.has(date)) return;
    byDate.set(date, v); // timestamps ascend, so the first kept is the earliest hour
  });
  const bars = [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = ts[ts.length - 1];
  return { bars, last_bar_utc: Number.isFinite(last) ? new Date(last * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null };
}

// TM1.1 (D6): Yahoo v8 chart, hourly, to daily 17:00 New York closes. The bar dated D (a New York
// weekday) is the close of the hourly bar starting 16:00 New York on D, or, when that bar has no
// close, of the latest bar starting from 12:00 New York that has one. New York's UTC offset is looked
// up once per UTC day at 12:00 UTC (the clocks change at 06:00 / 07:00 UTC on a Sunday, when FX is
// shut). last_bar_utc as parseYahoo.
export function parseYahooHourlyNy(j: any): { bars: Bar[]; last_bar_utc: string | null } {
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || 'yahoo: no result');
  const ts: number[] = res.timestamp ?? [];
  const src: unknown[] | undefined = res.indicators?.quote?.[0]?.close;
  if (!ts.length || !src) throw new Error('yahoo: no bars');
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
  const offset = new Map<number, number>();
  const best = new Map<string, { h: number; v: number }>();
  ts.forEach((t, i) => {
    const v = src[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const utcDay = Math.floor(t / 86400);
    let off = offset.get(utcDay);
    if (off == null) { off = ((Number(hourFmt.format(new Date((utcDay * 86400 + 43200) * 1000))) - 12 + 36) % 24) - 12; offset.set(utcDay, off); }
    const local = new Date((t + off * 3600) * 1000), wd = local.getUTCDay(), h = local.getUTCHours();
    if (wd === 0 || wd === 6 || h < 12 || h > 16) return;
    const date = local.toISOString().slice(0, 10), b = best.get(date);
    if (!b || h >= b.h) best.set(date, { h, v });
  });
  const bars = [...best].map(([date, b]) => ({ date, value: b.v })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = ts[ts.length - 1];
  return { bars, last_bar_utc: Number.isFinite(last) ? new Date(last * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null };
}

// TM1.1 (D6): a finished Yahoo FX daily bar dated D carries about the 01:00 London price on D, which
// is about 20:00 New York on the weekday before (see parseYahooHourly). For the history before the
// hourly window, each such bar is re-dated to that previous weekday: about three hours after its
// 17:00 New York close (spliceStats measures the gap on the overlap).
export function redateDaily(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    let t = Date.parse(b.date + 'T00:00:00Z');
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    do t -= 86400000; while ([0, 6].includes(new Date(t).getUTCDay()));
    out.push({ date: isoDate(t), value: b.value });
  }
  return out;
}

// |ln(re-dated daily / 17:00 NY close)| in basis points over the dates both series have.
export function spliceStats(re: Bar[], ny: Bar[]): { n: number; median_bp: number | null; p90_bp: number | null } {
  const m = new Map(ny.map((b) => [b.date, b.value]));
  const d = re.filter((b) => m.has(b.date)).map((b) => Math.abs(Math.log(b.value / m.get(b.date)!)) * 1e4).sort((a, b) => a - b);
  const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
  return { n: d.length, median_bp: q(0.5), p90_bp: q(0.9) };
}

// CSV rows with RFC 4180 quoting (the ECB's titles carry commas inside quotes).
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// FRED fredgraph.csv: the first column is the date whatever its name, the second the value; '.' and
// '' are NA (dropped). Any other non-numeric value fails the download (the spec's numeric assert).
export function parseFred(text: string): Bar[] {
  const rows = csvRows(text);
  if (rows.length < 2 || rows[0].length < 2) throw new Error('fred: no data');
  const bars: Bar[] = [];
  for (const r of rows.slice(1)) {
    const d = r[0].trim(), s = (r[1] ?? '').trim();
    if (!DATE_RE.test(d)) throw new Error(`fred: bad date ${d.slice(0, 20)}`);
    if (s === '.' || s === '') continue;
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`fred: non-numeric ${s.slice(0, 20)}`);
    bars.push({ date: d, value: v });
  }
  return bars;
}

// ECB data-api csvdata: TIME_PERIOD and OBS_VALUE columns, located by name.
export function parseEcb(text: string): Bar[] {
  const rows = csvRows(text);
  const h = rows[0]?.map((x) => x.trim()) ?? [];
  const di = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
  if (di < 0 || vi < 0) throw new Error('ecb: no TIME_PERIOD / OBS_VALUE');
  const bars: Bar[] = [];
  for (const r of rows.slice(1)) {
    const d = (r[di] ?? '').trim(), s = (r[vi] ?? '').trim();
    if (!DATE_RE.test(d)) throw new Error(`ecb: bad date ${d.slice(0, 20)}`);
    if (s === '' || s === 'NaN') continue;
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`ecb: non-numeric ${s.slice(0, 20)}`);
    bars.push({ date: d, value: v });
  }
  return bars;
}

// MOF dates: Gregorian (2026/10/2, 2026-10-02) or a Japanese era, by letter (H31.4.30, R1.5.7) or in
// kanji (令和元年5月7日). Era year 1 is the era's first year: Meiji 1868, Taisho 1912, Showa 1926,
// Heisei 1989, Reiwa 2019. Returns null for anything else (titles, notes).
const ERA: Record<string, number> = { M: 1867, T: 1911, S: 1925, H: 1988, R: 2018, '明治': 1867, '大正': 1911, '昭和': 1925, '平成': 1988, '令和': 2018 };
export function parseJpDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number, g: RegExpMatchArray | null;
  if ((g = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) [y, m, d] = [+g[1], +g[2], +g[3]];
  else if ((g = t.match(/^([MTSHR])\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/i))) [y, m, d] = [ERA[g[1].toUpperCase()] + +g[2], +g[3], +g[4]];
  else if ((g = t.match(/^(明治|大正|昭和|平成|令和)\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/))) [y, m, d] = [ERA[g[1]] + (g[2] === '元' ? 1 : +g[2]), +g[3], +g[4]];
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isoDate(Date.UTC(y, m - 1, d)) === iso ? iso : null; // rejects 2026/2/30
}

// One MOF file: the header row is the first whose cells include the column (10Y); the date is the
// first column; '-' (and an empty cell) means missing.
export function parseMof(text: string, col: string): Bar[] {
  const rows = csvRows(text);
  const hi = rows.findIndex((r) => r.some((x) => x.trim() === col));
  if (hi < 0) throw new Error(`mof: no ${col} column`);
  const ci = rows[hi].findIndex((x) => x.trim() === col);
  const bars: Bar[] = [];
  for (const r of rows.slice(hi + 1)) {
    const d = parseJpDate(r[0] ?? '');
    if (!d) continue;
    const s = (r[ci] ?? '').trim();
    if (s === '-' || s === '') continue;
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`mof: non-numeric ${s.slice(0, 20)} on ${d}`);
    bars.push({ date: d, value: v });
  }
  return bars;
}

// MOF files have been ASCII in English and Shift_JIS in Japanese; decode as UTF-8 unless that fails.
function decodeJp(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('shift_jis').decode(buf); } catch { return new TextDecoder().decode(buf); }
}

// ---------- fetchers ----------
// Each download is parsed inside its retry, so a 200 that is not the expected file (an HTML
// maintenance page, a truncated body) is retried like a network error.

type Got = { bars: Bar[]; last_bar_utc?: string | null; symbol: string; note?: string };

async function fetchYahoo(a: AssetDef, symbols: string[], p1: number, p2: number, deadline: number): Promise<Got> {
  const errs: string[] = [];
  for (const [i, s] of symbols.entries()) {
    if (i && Date.now() > deadline) { errs.push(`${s}: time budget spent`); break; }
    if (i) await sleep(YAHOO_SPACING_MS);
    try {
      const hourly = s.endsWith('@1h'), sym = hourly ? s.slice(0, -3) : s;
      // Yahoo serves hourly bars for a recent window only (range=730d reaches back to Dec 2023); a
      // replay drops anything after its run time in run().
      const url = hourly
        ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=730d&interval=1h`
        : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
      if (hourly && a.asset_class !== 'fx') throw new Error('hourly symbols are for fx only');
      const got = await retry(async () => { const j = await (await get(url)).json(); return hourly ? parseYahooHourly(j) : parseYahoo(j, a.field); }, deadline);
      // Yahoo answers some symbols (CNH=X, 000300.SS) with the latest day only, whatever the range asked;
      // that is a failed download, so the next symbol is tried and the error is reported.
      if (got.bars.length < MIN_BARS) throw new Error(`yahoo: only ${got.bars.length} daily bars`);
      const notes = [
        ...(errs.length ? [`used ${s} after ${errs.join('; ')}`] : []),
        ...('filled' in got && got.filled ? [`${s}: Adj Close of the latest ${got.filled} bar(s) not yet published, taken from Close`] : []),
      ];
      return { bars: got.bars, last_bar_utc: got.last_bar_utc, symbol: s, note: notes.length ? notes.join('; ') : undefined };
    } catch (e) { errs.push(`${s}: ${(e as Error).message}`); }
  }
  throw new Error(errs.join('; '));
}

async function fetchOther(a: AssetDef, start: string, deadline: number): Promise<Got> {
  if (a.source === 'fred') {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(a.symbol)}&cosd=${start}`;
    return { bars: await retry(async () => parseFred(await (await get(url)).text()), deadline), symbol: a.symbol };
  }
  if (a.source === 'ecb') {
    const url = `https://data-api.ecb.europa.eu/service/data/${a.symbol}?format=csvdata&startPeriod=${start}`;
    return { bars: await retry(async () => parseEcb(await (await get(url)).text()), deadline), symbol: a.symbol };
  }
  // MOF: the full history file, then the current month's file. MOF's server answers either with a 404
  // now and then (from 2026-10-07), so a 404 is retried like a network error. The current file is
  // required (without it the series ends last month), so its failing fails the download. When the
  // history file still fails, the closes that earlier runs stored from the same files in
  // dash.trend_px stand in for it, with a note.
  const base = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate';
  const symbol = `${a.symbol} (jgbcme)`;
  const [all, cur] = await Promise.allSettled([`${base}/historical/jgbcme_all.csv`, `${base}/jgbcme.csv`].map((u) =>
    retry(async () => parseMof(decodeJp(await (await get(u)).arrayBuffer()), a.symbol), deadline, true)));
  if (cur.status === 'rejected') throw cur.reason;
  // The current file comes last, so the monitor's keep-the-last dedup prefers it on an overlap.
  if (all.status === 'fulfilled') return { bars: [...all.value, ...cur.value].filter((b) => b.date >= start), symbol };
  const first = cur.value[0]?.date ?? '9999-12-31';
  const old = await sql`select to_char(d, 'YYYY-MM-DD') as d, value from dash.trend_px
    where asset_id = ${a.asset_id} and src = ${`${a.source}:${symbol}`} and d >= ${start} and d < ${first} order by d`;
  return {
    bars: [...old.map((r) => ({ date: r.d as string, value: Number(r.value) })), ...cur.value],
    symbol,
    note: `history file failed (${(all.reason as Error)?.message ?? all.reason}); used ${old.length} closes stored by earlier runs, to ${old.at(-1)?.d ?? 'none'}`,
  };
}

// ---------- config ----------

// dash.config 'trend_params' when it has the Params shape, else the TM1 defaults.
function readParams(v: unknown): { params: Params; note?: string } {
  const p = v as Params;
  const okMap = (m: unknown, nullable: boolean) => !!m && typeof m === 'object' && !Array.isArray(m) &&
    Object.values(m as object).every((x) => (nullable && x === null) || (typeof x === 'number' && Number.isFinite(x)));
  if (p && typeof p.params_version === 'string' && p.params_version && okMap(p.state_stats, true) && okMap(p.touch_lookup, false)) return { params: p };
  return { params: TM1_PARAMS, note: v == null ? undefined : 'trend_params malformed: TM1 defaults used' };
}

function readSymbols(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, xs] of Object.entries(v as Record<string, unknown>)) {
    const list = (Array.isArray(xs) ? xs : [xs]).filter((s): s is string => typeof s === 'string' && /^[\^A-Za-z0-9=.\-]{1,24}(@1h)?$/.test(s));
    if (list.length) out[k] = list;
  }
  return out;
}

// ---------- the run ----------

type Body = { token?: string; run_utc?: string; dry?: boolean; only?: string[]; symbols?: Record<string, unknown>; shadow?: string; diag?: boolean };

async function run(body: Body, runMs: number) {
  const t0 = Date.now(), deadline = t0 + FETCH_BUDGET_MS;
  const replay = body.run_utc != null;
  const only = Array.isArray(body.only) && body.only.length ? new Set(body.only.map(String)) : null;
  const dry = !!body.dry || !!only;
  const cfg = new Map((await sql`select key, value from dash.config where key in ('trend_params', 'trend_symbols')`).map((r) => [r.key, r.value]));
  const { params, note: paramsNote } = readParams(cfg.get('trend_params'));
  // A symbols override in the body is honoured only with only, which forces a dry run.
  const symbols = { ...readSymbols(cfg.get('trend_symbols')), ...(only ? readSymbols(body.symbols) : {}) };

  // Spec section 2: from 8 years before the run date (the Singapore date, D5).
  const sgt = isoDate(runMs + 8 * 3600_000);
  const start = `${+sgt.slice(0, 4) - 8}${sgt.slice(4)}`;
  const p1 = Math.floor(Date.parse(start) / 1000), p2 = Math.floor(runMs / 1000);
  const utcDate = isoDate(runMs);

  const universe = TM1_ASSETS.filter((a) => !only || only.has(a.asset_id));
  const errors: Record<string, string> = {};
  if (paramsNote) errors._params = paramsNote;
  const got = new Map<string, Got>();
  const fail = (a: AssetDef, e: unknown) => { errors[a.asset_id] = (e as Error)?.message ?? String(e); };

  // Yahoo one symbol at a time, 1 s apart; FRED, ECB and MOF are other hosts and run alongside.
  const yahooLoop = (async () => {
    let first = true;
    for (const a of universe.filter((x) => x.source === 'yahoo')) {
      if (Date.now() > deadline) { fail(a, new Error('time budget spent before this download')); continue; }
      if (!first) await sleep(YAHOO_SPACING_MS);
      first = false;
      try { got.set(a.asset_id, await fetchYahoo(a, symbols[a.asset_id] ?? [a.symbol], p1, p2, deadline)); } catch (e) { fail(a, e); }
    }
  })();
  const others = Promise.all(universe.filter((x) => x.source !== 'yahoo').map(async (a) => {
    try {
      const g = await fetchOther(a, start, deadline);
      if (g.bars.length < MIN_BARS) throw new Error(`${a.source}: only ${g.bars.length} daily values`);
      got.set(a.asset_id, g);
    } catch (e) { fail(a, e); }
  }));
  await Promise.all([yahooLoop, others]);

  // An hourly-built series reaches back only as far as Yahoo keeps hourly bars (a rolling window);
  // the closes that earlier runs stored from the same source and symbol extend it backwards.
  for (const a of universe) {
    const g = got.get(a.asset_id);
    if (!g?.symbol.endsWith('@1h') || !g.bars.length) continue;
    const old = await sql`select to_char(d, 'YYYY-MM-DD') as d, value from dash.trend_px
      where asset_id = ${a.asset_id} and src = ${`${a.source}:${g.symbol}`} and d >= ${start} and d < ${g.bars[0].date} order by d`;
    if (old.length) g.bars = [...old.map((r) => ({ date: r.d as string, value: Number(r.value) })), ...g.bars];
  }

  const assets: AssetDef[] = universe.map((a) => ({ ...a, symbol: got.get(a.asset_id)?.symbol ?? a.symbol }));
  const data: Fetched[] = universe.map((a) => {
    const g = got.get(a.asset_id);
    if (g?.note) errors[a.asset_id] = g.note;
    if (!g) return { asset_id: a.asset_id, ok: false, error: errors[a.asset_id], bars: [], last_bar_utc: null };
    // Nothing dated after the run's UTC date can be a final bar at the run (only a replay sees one).
    return { asset_id: a.asset_id, ok: true, bars: g.bars.filter((b) => b.date <= utcDate), last_bar_utc: g.last_bar_utc ?? null };
  });
  const fetchMs = Date.now() - t0;
  const m = computeMonitor(assets, data, params, { run_utc: new Date(runMs).toISOString() });
  const summary: Record<string, unknown> = {
    ok: true, run_date: m.meta.run_date, run_utc: m.meta.run_utc, status: m.meta.status, params_version: m.meta.params_version,
    n_assets: m.meta.n_assets, n_ok: m.meta.n_ok, n_stale: m.meta.n_stale, n_suspect: m.meta.n_suspect, n_events: m.meta.n_events,
    as_of: m.meta.as_of, fetch_errors: errors, fetch_ms: fetchMs, replay, dry, stored: false,
  };
  if (dry) return { ...summary, report: m.report, ms: Date.now() - t0 };

  // ---------- writes ----------
  const fin = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const ordOf = new Map(TM1_ASSETS.map((a, i) => [a.asset_id, i]));
  const defOf = new Map(assets.map((a) => [a.asset_id, a]));
  const runRow = {
    run_date: m.meta.run_date, run_utc: m.meta.run_utc, status: m.meta.status, params_version: m.meta.params_version,
    n_assets: m.meta.n_assets, n_ok: m.meta.n_ok, n_stale: m.meta.n_stale, n_suspect: m.meta.n_suspect, n_events: m.meta.n_events,
    last_bar_utc: m.meta.last_bar_utc, data_path: m.meta.data_path, as_of: sql.json(m.meta.as_of as unknown as Json), fetch_errors: sql.json(errors),
    params: sql.json(params as unknown as Json), report: m.report,
  };
  const states = m.states.map((s) => {
    const row: Record<string, unknown> = { ...s, ord: ordOf.get(s.asset_id), px_dp: defOf.get(s.asset_id)!.px_dp };
    for (const [k, v] of Object.entries(row)) if (typeof v === 'number') row[k] = fin(v);
    return row;
  });
  // value / prev are numbers, except DATA_SUSPECT / DATA_STALE whose value is the last_date (value_date).
  const events = m.events.map((e) => ({
    run_date: e.run_date, seq: e.seq, asset_id: e.asset_id, event_type: e.event_type, detail: e.detail,
    value: fin(e.value), value_date: typeof e.value === 'string' && DATE_RE.test(e.value) ? e.value : null, prev: fin(e.prev),
  }));
  const barriers = m.barriers.map((b) => ({
    run_date: b.run_date, pair: b.pair, k: b.k, side: b.side, last_date: b.last_date, spot: fin(b.spot), rv60: fin(b.rv60), h: b.h,
    barrier: fin(b.barrier), p_model: fin(b.p_model), vol_mult: fin(b.vol_mult), lookup_hit: b.lookup_hit, p_adj: fin(b.p_adj), fair_per100: fin(b.fair_per100),
  }));
  // The child tables cascade from dash.trend_run, so deleting the run row clears a rerun's old rows.
  await sql.begin(async (tx) => {
    await tx`delete from dash.trend_run where run_date = ${m.meta.run_date}`;
    await tx`insert into dash.trend_run ${tx(runRow as Json)}`;
    await tx`insert into dash.trend_state ${tx(states as Json[])}`;
    if (events.length) await tx`insert into dash.trend_event ${tx(events as Json[])}`;
    if (barriers.length) await tx`insert into dash.trend_barrier ${tx(barriers as Json[])}`;
  });
  summary.stored = true;

  // The closes behind each asset's state: bars up to its last_date (the latest final bar used), the last
  // of a duplicate date, finite and (off rates) positive, as the monitor cleans them. A changed value
  // (an Adj Close re-based after a dividend, a revised yield) is rewritten; an unchanged one is left.
  // One statement per asset with its ~2,000 closes as a single jsonb parameter: about 76k rows a
  // run, which as bound parameters would cost the worker far more CPU (the platform caps it at 2 s).
  const lastOf = new Map(m.states.map((s) => [s.asset_id, s.last_date]));
  let pxRows = 0;
  try {
    for (const a of assets) {
      const g = got.get(a.asset_id), last = lastOf.get(a.asset_id);
      if (!g || !last) continue;
      const byDate = new Map<string, number>();
      for (const b of g.bars) if (b.date <= last && Number.isFinite(b.value) && (a.asset_class === 'rates' || b.value > 0)) byDate.set(b.date, b.value);
      if (!byDate.size) continue;
      const rows = [...byDate].map(([d, v]) => ({ d, v }));
      await sql`insert into dash.trend_px (asset_id, d, value, src, fetched_at)
        select ${a.asset_id}, x.d, x.v, ${`${a.source}:${g.symbol}`}, now() from jsonb_to_recordset(${sql.json(rows)}) as x(d date, v double precision)
        on conflict (asset_id, d) do update set value = excluded.value, src = excluded.src, fetched_at = excluded.fetched_at
        where dash.trend_px.value is distinct from excluded.value or dash.trend_px.src is distinct from excluded.src`;
      pxRows += byDate.size;
    }
  } catch (e) { summary.px_error = (e as Error).message; }
  return { ...summary, px_rows: pxRows, ms: Date.now() - t0 };
}

// ---------- the TM1.1 shadow (D6) ----------

const NY_CLOSE = { tz: 'America/New_York', hhmm: '17:00' };

async function runShadow(body: Body, runMs: number) {
  const t0 = Date.now(), deadline = t0 + FETCH_BUDGET_MS;
  const dry = !!body.dry;
  const cfg = new Map((await sql`select key, value from dash.config where key in ('trend_params', 'trend_symbols')`).map((r) => [r.key, r.value]));
  const { params: base, note: paramsNote } = readParams(cfg.get('trend_params'));
  const params: Params = { ...base, params_version: `${base.params_version}.1` }; // TM1 -> TM1.1: same hit rates and lookup
  const symbols = readSymbols(cfg.get('trend_symbols'));
  const sgt = isoDate(runMs + 8 * 3600_000);
  const start = `${+sgt.slice(0, 4) - 8}${sgt.slice(4)}`;
  const p1 = Math.floor(Date.parse(start) / 1000), p2 = Math.floor(runMs / 1000);
  const utcDate = isoDate(runMs);

  const universe: AssetDef[] = TM1_ASSETS.filter((a) => a.asset_class === 'fx').map((a) => ({ ...a, exch_close: NY_CLOSE }));
  const errors: Record<string, string> = {};
  if (paramsNote) errors._params = paramsNote;
  const got = new Map<string, Got>();
  const splice: Record<string, unknown> = {};
  let first = true;
  for (const a of universe) {
    const conf = symbols[a.asset_id]?.[0] ?? a.symbol;
    const hourlyOnly = conf.endsWith('@1h'), sym = conf.replace(/@1h$/, '');
    if (Date.now() > deadline) { errors[a.asset_id] = 'time budget spent before this download'; continue; }
    try {
      if (!first) await sleep(YAHOO_SPACING_MS);
      first = false;
      const hUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=730d&interval=1h`;
      const h = await retry(async () => parseYahooHourlyNy(await (await get(hUrl)).json()), deadline);
      if (!h.bars.length) throw new Error('yahoo hourly: no bars');
      let bars = h.bars;
      // Before the hourly window: Yahoo's daily bars, re-dated (none for CNH, whose daily series Yahoo lacks).
      if (!hourlyOnly) {
        await sleep(YAHOO_SPACING_MS);
        const dUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
        const d = await retry(async () => parseYahoo(await (await get(dUrl)).json(), 'close'), deadline);
        const re = redateDaily(d.bars), firstH = bars[0].date;
        bars = [...re.filter((b) => b.date < firstH), ...bars];
        if (body.diag) splice[a.asset_id] = { first_hourly: firstH, ...spliceStats(re, h.bars) };
      }
      if (bars.length < MIN_BARS) throw new Error(`only ${bars.length} daily bars`);
      got.set(a.asset_id, { bars, last_bar_utc: h.last_bar_utc, symbol: `${sym}@ny17` });
    } catch (e) { errors[a.asset_id] = `${sym}: ${(e as Error)?.message ?? String(e)}`; }
  }

  const assets = universe.map((a) => ({ ...a, symbol: got.get(a.asset_id)?.symbol ?? a.symbol }));
  const data: Fetched[] = universe.map((a) => {
    const g = got.get(a.asset_id);
    if (!g) return { asset_id: a.asset_id, ok: false, error: errors[a.asset_id], bars: [], last_bar_utc: null };
    return { asset_id: a.asset_id, ok: true, bars: g.bars.filter((b) => b.date <= utcDate), last_bar_utc: g.last_bar_utc ?? null };
  });
  const fetchMs = Date.now() - t0;
  const m = computeMonitor(assets, data, params, { run_utc: new Date(runMs).toISOString() });
  const summary: Record<string, unknown> = {
    ok: true, shadow: params.params_version, run_date: m.meta.run_date, run_utc: m.meta.run_utc, status: m.meta.status,
    n_assets: m.meta.n_assets, n_ok: m.meta.n_ok, n_stale: m.meta.n_stale, n_suspect: m.meta.n_suspect, n_events: m.meta.n_events,
    as_of: m.meta.as_of, fetch_errors: errors, fetch_ms: fetchMs, dry, stored: false,
  };
  if (body.diag) summary.splice = splice;
  if (dry) return { ...summary, report: m.report, ms: Date.now() - t0 };

  const fin = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const ordOf = new Map(TM1_ASSETS.map((a, i) => [a.asset_id, i]));
  const states = m.states.map((s) => {
    const row: Record<string, unknown> = { ...s, ord: ordOf.get(s.asset_id), px_dp: assets.find((a) => a.asset_id === s.asset_id)!.px_dp };
    for (const [k, v] of Object.entries(row)) if (typeof v === 'number') row[k] = fin(v);
    return row;
  });
  const events = m.events.map((e) => ({
    seq: e.seq, asset_id: e.asset_id, event_type: e.event_type, detail: e.detail,
    value: fin(e.value), value_date: typeof e.value === 'string' && DATE_RE.test(e.value) ? e.value : null, prev: fin(e.prev),
  }));
  const barriers = m.barriers.map((b) => ({
    pair: b.pair, k: b.k, side: b.side, last_date: b.last_date, spot: fin(b.spot), rv60: fin(b.rv60), h: b.h,
    barrier: fin(b.barrier), p_model: fin(b.p_model), vol_mult: fin(b.vol_mult), lookup_hit: b.lookup_hit, p_adj: fin(b.p_adj), fair_per100: fin(b.fair_per100),
  }));
  await sql`insert into dash.trend_shadow ${sql({
    run_date: m.meta.run_date, params_version: params.params_version, run_utc: m.meta.run_utc, status: m.meta.status,
    n_assets: m.meta.n_assets, n_ok: m.meta.n_ok, n_stale: m.meta.n_stale, n_suspect: m.meta.n_suspect, n_events: m.meta.n_events,
    last_bar_utc: m.meta.last_bar_utc, as_of: sql.json(m.meta.as_of as unknown as Json), fetch_errors: sql.json(errors),
    params: sql.json(params as unknown as Json), states: sql.json(states as unknown as Json), events: sql.json(events as unknown as Json),
    barriers: sql.json(barriers as unknown as Json), report: m.report,
  } as Json)}
    on conflict (run_date, params_version) do update set run_utc = excluded.run_utc, status = excluded.status, n_assets = excluded.n_assets,
      n_ok = excluded.n_ok, n_stale = excluded.n_stale, n_suspect = excluded.n_suspect, n_events = excluded.n_events,
      last_bar_utc = excluded.last_bar_utc, as_of = excluded.as_of, fetch_errors = excluded.fetch_errors, params = excluded.params,
      states = excluded.states, events = excluded.events, barriers = excluded.barriers, report = excluded.report, computed_at = now()`;
  summary.stored = true;
  return { ...summary, ms: Date.now() - t0 };
}

Deno.serve(async (req) => {
  let body: Body = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}; // a JSON null, number or list
  const [row] = await sql`select value #>> '{}' as v from dash.config where key = 'ingest_token'`;
  if (!body.token || !row?.v || body.token !== row.v) return new Response('forbidden', { status: 403 });
  let runMs = Math.floor(Date.now() / 1000) * 1000;
  if (body.run_utc != null) {
    const t = Date.parse(String(body.run_utc));
    if (!Number.isFinite(t) || t > Date.now() + 60_000) return new Response('bad run_utc', { status: 400 });
    runMs = Math.floor(t / 1000) * 1000;
  }
  if (body.only != null && !(Array.isArray(body.only) && body.only.every((x) => TM1_ASSETS.some((a) => a.asset_id === x)))) {
    return new Response('bad only', { status: 400 });
  }
  if (body.shadow != null && body.shadow !== 'TM1.1') return new Response('bad shadow', { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const keepAlive = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch { /* closed */ } }, 10_000);
      let out: unknown;
      try { out = body.shadow ? await runShadow(body, runMs) : await run(body, runMs); } catch (e) {
        console.error('dash-trend', e);
        out = { ok: false, error: (e as Error)?.message ?? String(e) };
      }
      clearInterval(keepAlive);
      ctrl.enqueue(enc.encode(JSON.stringify(out) + '\n'));
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/json' } });
});
