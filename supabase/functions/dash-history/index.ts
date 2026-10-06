// dash-history: returns one symbol's daily Yahoo history as CSV in the yfinance download
// layout (Date,Open,High,Low,Close,Adj Close,Volume), for research studies whose own sandbox
// is rate-limited by Yahoo. Dates are in the exchange's own time zone, as yfinance prints them.
// POST {token, symbol, start?: 'YYYY-MM-DD'}; the token is the ingest token. Read-only.
import postgres from 'npm:postgres@3.4.4';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

Deno.serve(async (req) => {
  let body: { token?: string; symbol?: string; start?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const [row] = await sql`select value #>> '{}' as v from dash.config where key = 'ingest_token'`;
  if (!body.token || !row?.v || body.token !== row.v) return new Response('forbidden', { status: 403 });
  const symbol = String(body.symbol ?? '');
  if (!/^[\^A-Za-z0-9=.\-]{1,24}$/.test(symbol)) return new Response('bad symbol', { status: 400 });
  const p1 = Math.floor(Date.parse(body.start ?? '1990-01-01') / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return new Response(`yahoo ${r.status}`, { status: 502 });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res?.timestamp || !q) return new Response('no data', { status: 404 });
  const adj = res.indicators?.adjclose?.[0]?.adjclose;
  const tz = res.meta?.exchangeTimezoneName || 'UTC';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const lines = ['Date,Open,High,Low,Close,Adj Close,Volume'];
  let last = '';
  res.timestamp.forEach((t: number, i: number) => {
    const c = q.close?.[i];
    if (typeof c !== 'number') return;
    const d = day.format(new Date(t * 1000));
    if (d === last) lines.pop(); // a same-day duplicate (today's live bar) replaces the earlier row
    last = d;
    lines.push([d, num(q.open?.[i]), num(q.high?.[i]), num(q.low?.[i]), num(c), num(adj?.[i] ?? c), num(q.volume?.[i] ?? 0)].join(','));
  });
  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/csv', 'x-rows': String(lines.length - 1), 'x-tz': tz },
  });
});
