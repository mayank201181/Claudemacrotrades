// dash-mark: hourly. Pulls Yahoo bars for every open trade's proxy and every tested idea's
// proxy, writes dash.bars, then computes
//   - dash.live_marks: latest hourly mark of each open trade in R, intraday touches since fill,
//     and the latest complete daily close (the book's official exit basis) with close-breaches;
//   - dash.idea_outcomes: forward move of every tested idea in its own direction, in ATR(20) units,
//     at 1/5/10/20 sessions after the idea's date (ref = last hourly close at or before 08:00 SGT).
// Invoked by pg_cron with the ingest token; read-only towards trades.
import postgres from 'npm:postgres@3.4.4';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });

type Bar = { ts: number; o: number; h: number; l: number; c: number };

function legs(proxy: string): { legs: string[]; op: '' | '-' | '/' } {
  const m = proxy.match(/^([^\s\/]+?)([\-\/])([\^A-Z][^\s\/]*)$/);
  if (m && (m[2] === '/' || m[1].startsWith('^') || /[.=]/.test(m[1]))) return { legs: [m[1], m[3]], op: m[2] as '-' | '/' };
  return { legs: [proxy], op: '' };
}

async function yahoo(symbol: string, interval: '60m' | '1d', range: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return [];
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res?.timestamp || !q) return [];
  const out: Bar[] = [];
  res.timestamp.forEach((t: number, i: number) => {
    const c = q.close?.[i];
    if (c == null) return;
    out.push({ ts: t * 1000, o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c });
  });
  return out;
}

function combine(a: Bar[], b: Bar[], op: '-' | '/', daily: boolean): Bar[] {
  const key = (t: number) => (daily ? barDate(t) : String(Math.floor(t / HOUR)));
  const mb = new Map(b.map((x) => [key(x.ts), x]));
  const f = (x: number, y: number) => (op === '-' ? x - y : x / y);
  return a.filter((x) => mb.has(key(x.ts))).map((x) => {
    const y = mb.get(key(x.ts))!;
    const c = f(x.c, y.c);
    return { ts: x.ts, o: f(x.o, y.o), h: c, l: c, c }; // spread highs/lows are not knowable from legs
  });
}

const SGT = 8 * 3600000;
const HOUR = 3600000;
const sgtDate = (t: number) => new Date(t + SGT).toISOString().slice(0, 10);
// Yahoo stamps a daily bar at the exchange's local midnight; +12h lands inside the trading
// day for every venue (NY, London/FX, Asia), so this is the bar's own session date.
const barDate = (t: number) => new Date(t + 12 * HOUR).toISOString().slice(0, 10);
// A daily bar is final once its session is over: about 22h after its stamp (17:00 ET for NY).
const barClosed = (t: number, now: number) => now - t > 22 * HOUR;
const barCloseTime = (t: number) => t + 21 * HOUR;

function parseFill(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})\s*SGT)?/);
  if (!m) return null;
  const base = Date.parse(m[1] + 'T00:00:00Z') - SGT;
  return m[2] ? base + (Number(m[2]) * 60 + Number(m[3])) * 60000 : base + 24 * 3600000 - 1; // date-only = daily close fill
}

function atr20(bars: Bar[], spread: boolean): number | null {
  if (bars.length < 21) return null;
  const tail = bars.slice(-21);
  let s = 0;
  for (let i = 1; i < tail.length; i++) {
    const p = tail[i - 1].c, b = tail[i];
    s += spread ? Math.abs(b.c - p) : Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p));
  }
  return s / 20;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const [{ value }] = await sql`select value from dash.config where key = 'ingest_token'`;
    if (body?.token !== value) return new Response('forbidden', { status: 403 });

    const trades = await sql`select model, pid, status, proxy, direction, entry, stop, target, filled from dash.trades
      where proxy is not null and status = 'open'`;
    // Live marks only ever describe open trades.
    await sql`delete from dash.live_marks v where not exists (select 1 from dash.trades t where t.model = v.model and t.pid = v.pid and t.status = 'open')`;
    // References computed by the current method (ref_v = 2) are frozen; older ones are recomputed once.
    const known = new Map((await sql`select model, d::text d, idea, ref, ref_d::text ref_d from dash.idea_outcomes where ref_v = 2`).map((r) => [`${r.model}|${r.d}|${r.idea}`, r]));
    const ideas = await sql`select model, d::text d, idea, proxy, direction from dash.tested
      where proxy is not null and direction is not null and d >= current_date - 120`;
    const proxies = new Set<string>([...trades.map((t) => t.proxy), ...ideas.map((i) => i.proxy)]);
    const symbols = new Set<string>();
    for (const p of proxies) for (const l of legs(p).legs) symbols.add(l);

    const hourly = new Map<string, Bar[]>(), daily = new Map<string, Bar[]>();
    for (const s of symbols) {
      const [h, d] = await Promise.all([yahoo(s, '60m', '1mo'), yahoo(s, '1d', '1y')]);
      hourly.set(s, h); daily.set(s, d);
      const rows = [
        ...h.slice(-200).map((b) => ({ symbol: s, interval: '60m', ts: new Date(b.ts), o: b.o, h: b.h, l: b.l, c: b.c })),
        ...d.slice(-60).map((b) => ({ symbol: s, interval: '1d', ts: new Date(b.ts), o: b.o, h: b.h, l: b.l, c: b.c })),
      ];
      if (rows.length) await sql`insert into dash.bars ${sql(rows)} on conflict (symbol, interval, ts) do update set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c`;
    }
    const series = (proxy: string, daily_: boolean): Bar[] => {
      const { legs: ls, op } = legs(proxy);
      const src = daily_ ? daily : hourly;
      if (!op) return src.get(ls[0]) ?? [];
      return combine(src.get(ls[0]) ?? [], src.get(ls[1]) ?? [], op, daily_);
    };
    const now = Date.now();
    const completeDaily = (bars: Bar[]) => bars.filter((b) => barClosed(b.ts, now) && new Date(b.ts + 12 * HOUR).getUTCDay() % 6 !== 0);

    let nLive = 0;
    for (const t of trades) {
      if (t.entry == null || t.stop == null || t.direction == null) continue;
      const dir = Number(t.direction), entry = Number(t.entry), stop = Number(t.stop), target = t.target == null ? null : Number(t.target);
      const oneR = Math.abs(entry - stop);
      const h = series(t.proxy, false);
      if (!h.length || !oneR) continue;
      const last = h[h.length - 1];
      const fillTs = parseFill(t.filled);
      const since = fillTs ? h.filter((b) => b.ts >= fillTs) : [];
      const hi = since.length ? Math.max(...since.map((b) => b.h)) : null;
      const lo = since.length ? Math.min(...since.map((b) => b.l)) : null;
      const stopTouched = since.length ? (dir > 0 ? lo! <= stop : hi! >= stop) : null;
      const targetTouched = since.length && target != null ? (dir > 0 ? hi! >= target : lo! <= target) : null;
      const d = completeDaily(series(t.proxy, true));
      const dSince = fillTs ? d.filter((b) => barCloseTime(b.ts) > fillTs) : [];
      const dl = d[d.length - 1];
      const stopClosed = dSince.length ? dSince.some((b) => (dir > 0 ? b.c <= stop : b.c >= stop)) : null;
      const targetClosed = dSince.length && target != null ? dSince.some((b) => (dir > 0 ? b.c >= target : b.c <= target)) : null;
      const row = {
        model: t.model, pid: t.pid, as_of: new Date(last.ts), price: last.c, r: (dir * (last.c - entry)) / oneR,
        hi_since_fill: hi, lo_since_fill: lo, stop_touched: stopTouched, target_touched: targetTouched,
        daily_close: dl?.c ?? null, daily_close_d: dl ? barDate(dl.ts) : null,
        daily_r: dl ? (dir * (dl.c - entry)) / oneR : null, stop_closed: stopClosed, target_closed: targetClosed,
      };
      await sql`insert into dash.live_marks ${sql(row)} on conflict (model, pid) do update set
        as_of = excluded.as_of, price = excluded.price, r = excluded.r, hi_since_fill = excluded.hi_since_fill,
        lo_since_fill = excluded.lo_since_fill, stop_touched = excluded.stop_touched, target_touched = excluded.target_touched,
        daily_close = excluded.daily_close, daily_close_d = excluded.daily_close_d, daily_r = excluded.daily_r,
        stop_closed = excluded.stop_closed, target_closed = excluded.target_closed`;
      nLive++;
    }

    let nOut = 0;
    for (const i of ideas) {
      const spread = legs(i.proxy).op !== '';
      const d = completeDaily(series(i.proxy, true));
      const h = series(i.proxy, false);
      const cut = Date.parse(i.d + 'T00:00:00Z'); // 08:00 SGT on the idea's date
      // Hourly bars are stamped at their start: the last bar that finished by 08:00 SGT is the reference.
      const hRef = h.filter((b) => b.ts + HOUR <= cut).pop();
      const before = d.filter((b) => barDate(b.ts) < i.d);
      const after = d.filter((b) => barDate(b.ts) >= i.d);
      // Once set, the reference never moves (hourly history only reaches back a month).
      const prev = known.get(`${i.model}|${i.d}|${i.idea}`);
      const ref = prev?.ref != null ? Number(prev.ref) : hRef?.c ?? before[before.length - 1]?.c;
      const atr = atr20(before, spread);
      if (ref == null || !atr) continue;
      const dir = Number(i.direction);
      const ret = (k: number) => (after.length >= k ? (dir * (after[k - 1].c - ref)) / atr : null);
      const lastB = after[after.length - 1];
      const row = {
        model: i.model, d: i.d, idea: i.idea, proxy: i.proxy, direction: dir,
        ref_d: prev?.ref_d ?? (hRef ? sgtDate(hRef.ts) : barDate(before[before.length - 1].ts)),
        ref, atr20: atr, ret1: ret(1), ret5: ret(5), ret10: ret(10), ret20: ret(20),
        last_d: lastB ? barDate(lastB.ts) : null,
        ret_last: lastB ? (dir * (lastB.c - ref)) / atr : null, updated_at: new Date(), ref_v: 2,
      };
      await sql`insert into dash.idea_outcomes ${sql(row)} on conflict (model, d, idea) do update set
        proxy = excluded.proxy, direction = excluded.direction, ref_d = excluded.ref_d, ref = excluded.ref, atr20 = excluded.atr20,
        ret1 = excluded.ret1, ret5 = excluded.ret5, ret10 = excluded.ret10, ret20 = excluded.ret20,
        last_d = excluded.last_d, ret_last = excluded.ret_last, updated_at = excluded.updated_at, ref_v = excluded.ref_v`;
      nOut++;
    }
    return new Response(JSON.stringify({ ok: true, symbols: symbols.size, live: nLive, outcomes: nOut,
      empty: [...symbols].filter((s) => !(daily.get(s)?.length)) }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
