// Gemini editions through dash-ingest against a throwaway local PostgreSQL (made-up levels). Skipped unless PG_TEST_URL is set.
// Run: PG_TEST_URL=postgres://postgres@localhost:5433/postgres deno test -A --no-check supabase/functions/dash-ingest/gemini_db.test.ts
import postgres from 'npm:postgres@3.4.4';

const url = Deno.env.get('PG_TEST_URL');
const SCHEMA = `drop schema if exists dash cascade; create schema dash;
create table dash.config (key text primary key, value jsonb not null);
create table dash.raw (id bigserial primary key, kind text not null, model text, d date, source_id text, received_at timestamptz not null default now(), payload jsonb not null, unique (kind, source_id));
create table dash.feeds (gmail_id text primary key, family text not null check (family in ('youtube','podcast','grok','substack','takeaways')), source text, d date, subject text,
  sent_at timestamptz, intro text, sections jsonb, stances text, parsed_at timestamptz);
create table dash.trades (model text not null, pid text not null, title text, status text, asset_class text, direction smallint, tclass text, proxy text, opened text,
  filled text, closed text, ref numeric, entry numeric, stop numeric, target numeric, rr numeric, p numeric, p0 numeric, ev numeric, result_r numeric, exit_reason text,
  review text, thesis text, invalidation text, structure text, meta jsonb not null default '{}', first_seen date, last_seen date, updated_at timestamptz default now(), primary key (model, pid));
create table dash.live_marks (model text, pid text, r numeric, primary key (model, pid));
create table dash.book_state (model text primary key, updated text, scorecard text, rules text, ingested_at timestamptz not null default now());
insert into dash.config values ('ingest_token', '"t0k"'), ('private_terms', '{"scrub": "zzqqnomatch", "drop": "zzqqnomatch"}');`;

const H = (t: string) => `<div style="font-weight:800">${t}</div>`;
const edition = (lines: string) => `${H('1. TRADE BOOK [Gemini]')}<div>${lines}</div>${H('2. THE LAST 24H IN 60 SECONDS')}<div>x</div>${H('3. THEMES')}<div>y</div>`;
const msg = (id: string, day: string, date: string, lines: string, tag = 'Carbon') =>
  ({ id, subject: `MACRO TAKEAWAYS [Gemini] — ${day} Nov 2026 [${tag}]`, date, htmlBody: edition(lines) });
const P1 = 'P51: Short ABC Size: 1.0R | Opened: 2026-11-20 | Entry: $50.00 | Stop: $51.00 | Target: $47.00 | OPEN — HOLD';
const S1 = 'S21: Long USD/XYZ 3M NDF (0.5R, opened 2026-11-21) Entry: 100.00 (Spot ref 99.00) | Fri wStop: 96.00 | Target: 110.00 | HOLD';

Deno.test({ name: 'gemini editions against local PostgreSQL', ignore: !url, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const db = postgres(url!, { max: 1, onnotice: () => {} });
  await db.unsafe(SCHEMA);
  Deno.env.set('SUPABASE_DB_URL', url!);
  let handler: ((r: Request) => Promise<Response>) | null = null;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: (r: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
  await import('./index.ts');
  const post = async (body: unknown) => (await handler!(new Request('http://x', { method: 'POST', body: JSON.stringify({ token: 't0k', ...body as object }) }))).json();
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  const trade = async (pid: string) => (await db`select * from dash.trades where model = 'gemini' and pid = ${pid}`)[0];

  let r = await post({ kind: 'gmail_thread', data: { messages: [msg('c25', '25', '2026-11-24T23:40:00Z', `${P1} ${S1}`)] } });
  ok(r.ok, JSON.stringify(r));
  ok((await db`select count(*)::int n from dash.feeds where family = 'takeaways' and source = 'carbon'`)[0].n === 1, 'feed row stored');
  const s = await trade('S21');
  ok(Number(s.entry) === 99 && Number(s.stop) === 95 && Number(s.target) === 109 && s.proxy === 'XYZ=X' && s.status === 'open', `S21 shifted to spot: ${JSON.stringify(s)}`);
  ok((await db`select updated from dash.book_state where model = 'gemini'`)[0].updated === '2026-11-25 07:40 SGT', 'book stamp in SGT');

  // Neon and Pipeline Neon never write the book.
  r = await post({ kind: 'gmail_thread', data: { messages: [msg('n26', '26', '2026-11-25T23:05:00Z', 'P52: Long DEF Entry: 1.00 | Stop: 0.90 | Target: 1.20', 'Neon')] } });
  ok(r.ok && !(await trade('P52')), 'Neon wrote no trade');

  // A newer Carbon closes P51; an older copy cannot reopen it; a trade unlisted for 3+ days closes as dropped at our mark.
  await db`insert into dash.live_marks values ('gemini', 'S21', 0.4)`;
  r = await post({ kind: 'gmail_thread', data: { messages: [msg('c26', '26', '2026-11-25T23:40:00Z', P1.replace('OPEN — HOLD', 'CLOSED — TARGET HIT'))] } });
  ok((await trade('P51')).status === 'closed-view', 'P51 closed');
  r = await post({ kind: 'gmail_thread', data: { messages: [msg('c25b', '25', '2026-11-24T23:50:00Z', `${P1} P53: Long GHI Entry: 2.00 | Stop: 1.80 | Target: 2.40`)] } });
  ok((await trade('P51')).status === 'closed-view', 'older copy did not reopen P51');
  ok((await trade('P53'))?.status === 'open', 'older copy may add a trade not yet known');
  ok((await trade('S21')).status === 'open', 'S21 listed 25 Nov, not yet dropped');
  r = await post({ kind: 'gmail_thread', data: { messages: [msg('c29', '29', '2026-11-28T23:40:00Z', P1)] } });
  const s2 = await trade('S21');
  ok(s2.status === 'closed-view' && Number(s2.result_r) === 0.4 && s2.closed === '2026-11-29', `S21 dropped at our mark: ${JSON.stringify(s2)}`);
  ok((await trade('P51')).status === 'closed-view', 'a closed trade stays closed when printed again');
  await db.end();
} });
