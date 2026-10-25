// Carver forecasts: shape checks on synthetic series and the BIS parser.
// Run: npx -y tsx --test supabase/functions/_shared/forecast.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP, computeForecasts, ewmacSeries, fdmOf, parseBisPolicy, robustVol } from './forecast.ts';
import type { AssetDef, Fetched, StateRow } from './trend.ts';

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10));
// a random walk with a set drift (deterministic LCG noise)
function walk(n: number, drift: number, seed = 1): number[] {
  let s = seed, p = 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; p *= Math.exp(drift + 0.006 * ((s / 2147483648) - 0.5) * 3.46); out.push(p); }
  return out;
}

test('EWMAC: sign follows the drift, capped at +-20', () => {
  const up = ewmacSeries(walk(1500, 0.002)), dn = ewmacSeries(walk(1500, -0.002));
  for (const s of up) { assert.ok(s.at(-1)! > 0); assert.ok(s.every((x) => !Number.isFinite(x) || Math.abs(x) <= CAP)); }
  for (const s of dn) assert.ok(s.at(-1)! < 0);
});

test('robust vol: positive and floored', () => {
  const v = robustVol(walk(800, 0));
  assert.ok(v.slice(1).every((x) => x > 0));
});

test('FDM: between 1 and 2 for four adjacent speeds', () => {
  const f = fdmOf([1, 2, 3].map((k) => ewmacSeries(walk(1500, 0, k))));
  assert.ok(f != null && f > 1 && f < 2, `fdm ${f}`);
});

test('BIS parser keeps the latest observation per area', () => {
  const r = parseBisPolicy('FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nD,US,2026-10-19,3.875\nD,US,2026-10-20,3.875\nD,JP,2026-10-20,1.25\nD,KR,2026-10-08,\n');
  assert.deepEqual(r, { US: { rate: 3.875, date: '2026-10-20' }, JP: { rate: 1.25, date: '2026-10-20' } });
});

test('carry: long USDJPY earns the USD-JPY gap; missing rate is NA with a note', () => {
  const ds = days(1500), p = walk(1500, 0);
  const mk = (id: string): [AssetDef, Fetched, StateRow] => [
    { asset_id: id, asset_class: 'fx', source: 'yahoo', symbol: id, field: 'close', px_dp: 3 },
    { asset_id: id, ok: true, bars: ds.map((date, i) => ({ date, value: p[i] })) },
    { asset_id: id, status: 'OK', last_date: ds.at(-1) } as StateRow,
  ];
  const a = mk('USDJPY'), b = mk('USDTWD');
  const fc = computeForecasts([a[0], b[0]], [a[1], b[1]], [a[2], b[2]], { US: { rate: 4, date: 'x' }, JP: { rate: 1, date: 'x' } }, '2026-10-26');
  assert.ok(fc.rows[0].carry! > 0);
  assert.equal(fc.rows[1].carry, null);
  assert.match(fc.rows[1].carry_note!, /no BIS policy rate for TWD/);
  assert.match(fc.text, /^FORECAST\|2026-10-26\|USDJPY\|/m);
});
