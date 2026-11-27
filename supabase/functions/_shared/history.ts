// dash-history's daily CSV, kept apart from the handler so it can be tested.
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

// Instruments whose raw close is already the total-return basis (no dividends or splits to adjust for).
// A16 EDGE-06: with no adjusted series at all, a stock, ETF or fund (or an instrument of unknown type) leaves
// Adj Close blank; a raw close there would mix price bases in a multi-period return.
export function rawIsAdjusted(meta: { instrumentType?: string } | undefined, symbol: string): boolean {
  const t = meta?.instrumentType;
  if (t) return ['CURRENCY', 'INDEX', 'FUTURE', 'CRYPTOCURRENCY'].includes(t);
  return /=X$|=F$/i.test(symbol) || symbol.startsWith('^');
}

// deno-lint-ignore no-explicit-any
export function dailyCsv(res: any, symbol: string): { csv: string; rows: number; tz: string } | { error: string } {
  const q = res?.indicators?.quote?.[0];
  const tz = res?.meta?.exchangeTimezoneName;
  // A16 EDGE-07: a daily series with no venue time zone cannot be dated (UTC dates put US bars a day late).
  if (!tz) return { error: 'missing venue time zone' };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const adj = res.indicators?.adjclose?.[0]?.adjclose;
  const raw = rawIsAdjusted(res.meta, symbol);
  const lines = ['Date,Open,High,Low,Close,Adj Close,Volume'];
  let last = '';
  res.timestamp.forEach((t: number, i: number) => {
    const c = q.close?.[i];
    if (typeof c !== 'number') return;
    const d = day.format(new Date(t * 1000));
    if (d === last) lines.pop(); // a same-day duplicate (today's live bar) replaces the earlier row
    last = d;
    // A14 EDGE-006: with an adjusted series, a missing point stays blank. EDGE-005: a missing volume stays blank.
    lines.push([d, num(q.open?.[i]), num(q.high?.[i]), num(q.low?.[i]), num(c), num(adj ? adj[i] : raw ? c : undefined), num(q.volume?.[i])].join(','));
  });
  return { csv: lines.join('\n') + '\n', rows: lines.length - 1, tz };
}
