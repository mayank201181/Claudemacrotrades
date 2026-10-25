// Carver forecasts beside the Trend Monitor: EWMAC trend at four speeds and, for FX, carry, on the
// -20..+20 scale where an absolute 10 is an average-conviction forecast. Written from the published
// method (Robert Carver, "Systematic Trading", 2015, and pysystemtrade's documentation:
// https://github.com/robcarver17/pysystemtrade); no pysystemtrade code is copied (it is GPL-3).
// Pure: the caller passes the bars, the monitor's states and the policy rates.
//
//   price      the close (Adj Close for the commodity ETFs); for rates -100 x yield, so a rising
//              "price" is bonds rallying, as in the monitor's levels
//   vol        Carver's robust daily vol: exponentially weighted std of daily price changes, span 35,
//              floored at the 5th percentile of its last 500 values
//   EWMAC f,s  (EWMA_f(price) - EWMA_s(price)) / vol, times the published forecast scalar
//              (8/32: 5.3, 16/64: 3.75, 32/128: 2.65, 64/256: 1.87), capped at +-20
//   trend      the four speeds equally weighted, times the forecast diversification multiplier
//              (FDM = 1 / sqrt(w'Cw), C = the speeds' correlation pooled over the universe's last
//              5 years, negatives floored at 0, computed each run), capped at +-20
//   carry (FX) (policy rate of base - policy rate of terms) / annualised vol in percent, times 30
//              (Carver's carry scalar), capped at +-20. Policy rates from the BIS (WS_CBPOL); a
//              policy-rate proxy, so the onshore-offshore gap (CNH, INR, IDR, KRW NDF yields) and
//              SGD (no BIS policy rate; MAS steers the S$NEER) are NA or approximate
//   combined   0.6 trend + 0.4 carry, times 1/sqrt(0.6^2 + 0.4^2) (trend and carry taken as
//              uncorrelated), capped at +-20; trend alone where carry is NA
import type { AssetDef, Fetched, StateRow } from './trend.ts';

export const SPEEDS = [[8, 32], [16, 64], [32, 128], [64, 256]] as const;
export const SCALARS = [5.3, 3.75, 2.65, 1.87];
export const CARRY_SCALAR = 30;
export const CAP = 20;
const VOL_SPAN = 35, FLOOR_PCT = 0.05, FLOOR_WIN = 500, CORR_WIN = 1260;
const W_TREND = 0.6, W_CARRY = 0.4;
const FDM_TC = 1 / Math.sqrt(W_TREND * W_TREND + W_CARRY * W_CARRY);

export type PolicyRate = { rate: number; date: string };
export type ForecastRow = {
  asset_id: string; last_date: string | null; ewmac: (number | null)[]; trend: number | null;
  carry: number | null; carry_note: string | null; combined: number | null;
};
export type Forecasts = { rows: ForecastRow[]; fdm: number | null; text: string };

const cap = (x: number) => Math.max(-CAP, Math.min(CAP, x));
const alphaOf = (span: number) => 2 / (span + 1);

function ewma(x: number[], span: number): number[] {
  const a = alphaOf(span), out = new Array<number>(x.length);
  let m = x[0];
  for (let i = 0; i < x.length; i++) { m = i ? a * x[i] + (1 - a) * m : x[0]; out[i] = m; }
  return out;
}

// Exponentially weighted std of the daily changes (span 35), then the 5th-percentile floor over the
// last 500 values. vol[i] uses changes up to i.
export function robustVol(p: number[]): number[] {
  const a = alphaOf(VOL_SPAN), n = p.length, raw = new Array<number>(n).fill(NaN);
  let m = 0, v = 0;
  for (let i = 1; i < n; i++) {
    const d = p[i] - p[i - 1];
    if (i === 1) { m = d; v = d * d; } else { const dm = d - m; m += a * dm; v = (1 - a) * (v + a * dm * dm); }
    raw[i] = Math.sqrt(v);
  }
  // The floor is re-sorted every 20 days and at the last day (the edge function's CPU budget is 2 s).
  const out = new Array<number>(n).fill(NaN);
  let fl = 0;
  for (let i = 1; i < n; i++) {
    if (i === 1 || i % 20 === 0 || i === n - 1) {
      const w = raw.slice(Math.max(1, i - FLOOR_WIN + 1), i + 1).sort((x, y) => x - y);
      fl = w[Math.floor(FLOOR_PCT * (w.length - 1))];
    }
    out[i] = Math.max(raw[i], fl);
  }
  return out;
}

// The four capped EWMAC forecast series (index-aligned with p; NaN before 1 change).
export function ewmacSeries(p: number[]): number[][] {
  const vol = robustVol(p);
  return SPEEDS.map(([f, s], k) => {
    const ef = ewma(p, f), es = ewma(p, s);
    return p.map((_, i) => (i && vol[i] > 0 ? cap(((ef[i] - es[i]) / vol[i]) * SCALARS[k]) : NaN));
  });
}

// Pooled correlation of the speeds over each asset's last CORR_WIN days, negatives floored at 0.
export function fdmOf(series: number[][][]): number | null {
  const k = SPEEDS.length, sx = new Array(k).fill(0), sxx = Array.from({ length: k }, () => new Array(k).fill(0));
  let cnt = 0;
  for (const s of series) {
    const n = s[0].length;
    for (let i = Math.max(300, n - CORR_WIN); i < n; i++) { // skip the slow EWMA's warm-up
      const v = s.map((x) => x[i]);
      if (v.some((x) => !Number.isFinite(x))) continue;
      cnt++;
      for (let a = 0; a < k; a++) { sx[a] += v[a]; for (let b = 0; b < k; b++) sxx[a][b] += v[a] * v[b]; }
    }
  }
  if (cnt < 500) return null;
  const mu = sx.map((x) => x / cnt), cov = sxx.map((r, a) => r.map((x, b) => x / cnt - mu[a] * mu[b]));
  let wcw = 0;
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
    const c = a === b ? 1 : Math.max(0, cov[a][b] / Math.sqrt(cov[a][a] * cov[b][b]));
    wcw += c / (k * k);
  }
  return 1 / Math.sqrt(wcw);
}

// Currency of each side for the FX carry. CNH uses CNY's policy rate.
const CCY_AREA: Record<string, string> = { USD: 'US', JPY: 'JP', EUR: 'XM', GBP: 'GB', AUD: 'AU', NZD: 'NZ', CAD: 'CA', CHF: 'CH',
  CNH: 'CN', KRW: 'KR', INR: 'IN', TWD: 'TW', IDR: 'ID', SGD: 'SG' };

export function computeForecasts(assets: AssetDef[], data: Fetched[], states: StateRow[], rates: Record<string, PolicyRate>, runDate: string): Forecasts {
  const byId = new Map(data.map((f) => [f.asset_id, f])), stOf = new Map(states.map((s) => [s.asset_id, s]));
  const per: { a: AssetDef; st: StateRow | undefined; p: number[]; s: number[][] | null }[] = [];
  for (const a of assets) {
    const st = stOf.get(a.asset_id), f = byId.get(a.asset_id);
    const usable = st && (st.status === 'OK' || st.status === 'SUSPECT') && st.last_date && f?.ok;
    if (!usable) { per.push({ a, st, p: [], s: null }); continue; }
    // the monitor's own cleaning: up to its last final bar, the last of a duplicate date, finite and
    // (off rates) positive
    const by = new Map<string, number>();
    for (const b of f!.bars) if (b.date <= st!.last_date! && Number.isFinite(b.value) && (a.asset_class === 'rates' || b.value > 0)) by.set(b.date, b.value);
    const p = [...by].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([, v]) => (a.asset_class === 'rates' ? -100 * v : v));
    per.push({ a, st, p, s: p.length > 300 ? ewmacSeries(p) : null });
  }
  const fdm = fdmOf(per.filter((x) => x.s).map((x) => x.s!));
  const rows: ForecastRow[] = per.map(({ a, st, p, s }) => {
    const last = s ? s.map((x) => x[x.length - 1]) : null;
    const ewmac = last ? last.map((x) => (Number.isFinite(x) ? x : null)) : [null, null, null, null];
    const trend = last && fdm != null && last.every(Number.isFinite) ? cap((fdm * last.reduce((t, x) => t + x, 0)) / last.length) : null;
    let carry: number | null = null, note: string | null = null;
    if (a.asset_class === 'fx' && s) {
      const base = a.asset_id.slice(0, 3), terms = a.asset_id.slice(3, 6);
      const rb = rates[CCY_AREA[base]], rt = rates[CCY_AREA[terms]];
      const vol = robustVol(p), i = p.length - 1;
      const annVolPct = (vol[i] * 16 / p[i]) * 100;
      if (rb && rt && annVolPct > 0) {
        carry = cap(((rb.rate - rt.rate) / annVolPct) * CARRY_SCALAR);
        note = `${base} ${rb.rate} ${terms} ${rt.rate}`;
      } else note = `no BIS policy rate for ${!rb ? base : terms}`;
    }
    const combined = trend == null ? null : carry == null ? trend : cap(FDM_TC * (W_TREND * trend + W_CARRY * carry));
    return { asset_id: a.asset_id, last_date: st?.last_date ?? null, ewmac, trend, carry, carry_note: note, combined };
  });
  return { rows, fdm, text: renderForecasts(rows, fdm, rates, runDate) };
}

const f1 = (x: number | null) => (x == null ? 'NA' : (x >= 0 ? '+' : '') + x.toFixed(1));

function renderForecasts(rows: ForecastRow[], fdm: number | null, rates: Record<string, PolicyRate>, runDate: string): string {
  const dates = Object.values(rates).map((r) => r.date).sort();
  const L: string[] = [
    '',
    'CARVER FORECASTS (-20..+20; |10| = average conviction; + = long the asset, for rates long bonds)',
    `trend = EWMAC 8/32 16/64 32/128 64/256, equal weights x FDM ${fdm == null ? 'NA' : fdm.toFixed(2)}; carry (FX) = policy-rate gap / vol x 30, BIS ${dates.length ? dates[0] + '..' + dates[dates.length - 1] : 'NA'}; combined = 60/40 trend/carry x 1.39`,
  ];
  for (const r of rows) {
    if (r.trend == null) { L.push(`${r.asset_id} NA (no usable bars)`); continue; }
    L.push(`${r.asset_id} trend ${f1(r.trend)} [${r.ewmac.map(f1).join(' ')}]` + (r.carry_note ? ` | carry ${f1(r.carry)} (${r.carry_note})` : '') + ` | combined ${f1(r.combined)}`);
  }
  L.push('BEGIN_FORECASTS|v1');
  for (const r of rows) L.push(['FORECAST', runDate, r.asset_id, r.last_date ?? 'NA', ...r.ewmac.map(f1), f1(r.trend), f1(r.carry), f1(r.combined)].join('|'));
  L.push('END_FORECASTS');
  return L.join('\n');
}

// BIS WS_CBPOL csv (detail=dataonly): REF_AREA, TIME_PERIOD, OBS_VALUE -> {area: {rate, date}}
export function parseBisPolicy(csv: string): Record<string, PolicyRate> {
  const lines = csv.trim().split(/\r?\n/), h = lines[0].split(',');
  const ia = h.indexOf('REF_AREA'), it = h.indexOf('TIME_PERIOD'), iv = h.indexOf('OBS_VALUE');
  const out: Record<string, PolicyRate> = {};
  for (const ln of lines.slice(1)) {
    const c = ln.split(','), v = Number(c[iv]);
    if (!c[ia] || (c[iv] ?? '').trim() === '' || !Number.isFinite(v)) continue;
    if (!out[c[ia]] || c[it] > out[c[ia]].date) out[c[ia]] = { rate: v, date: c[it] };
  }
  return out;
}
export const BIS_POLICY_URL = 'https://stats.bis.org/api/v1/data/WS_CBPOL/D.' +
  [...new Set(Object.values(CCY_AREA))].join('+') + '/all?lastNObservations=1&detail=dataonly&format=csv';
