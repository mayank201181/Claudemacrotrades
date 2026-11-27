// A16 EDGE-02/03/04: dash-ingest against a throwaway local PostgreSQL. Skipped unless PG_TEST_URL is set.
// Run: PG_TEST_URL=postgres://postgres@localhost:5433/postgres deno test -A --no-check supabase/functions/dash-ingest/
import postgres from 'npm:postgres@3.4.4';

const url = Deno.env.get('PG_TEST_URL');
const SCHEMA = `drop schema if exists dash cascade; create schema dash;
create table dash.config (key text primary key, value jsonb not null);
create table dash.raw (id bigserial primary key, kind text not null, model text, d date, source_id text, received_at timestamptz not null default now(), payload jsonb not null, unique (kind, source_id));
create table dash.digests (model text not null, d date not null, subject text not null, gmail_id text not null, sent_at timestamptz, built text, header text,
  sixty jsonb not null default '[]', themes jsonb not null default '[]', sections jsonb not null default '[]', trade_block text, parsed_at timestamptz not null default now(), primary key (model, d));
create table dash.tested (model text not null, d date not null, idea text not null, seq int, proxy text, direction smallint, verdict text, fail_code text, covered_by text,
  rr numeric, p numeric, p0 numeric, ev numeric, reason text, source text not null, primary key (model, d, idea));
create table dash.q_moves (model text not null, d date not null, qid text not null, tag_n int, net text, net_val smallint not null default 0, question text, resolves date,
  resolves_text text, implied text, priced text, evidence jsonb not null default '[]', primary key (model, d, qid));
create table dash.q_events (model text not null, d date not null, kind text not null, qid text not null, body jsonb not null, primary key (model, d, kind, qid));
create table dash.q_scorecard (model text not null, d date not null, body jsonb not null, primary key (model, d));
create table dash.book_state (model text primary key, updated text, scorecard text, rules text, ingested_at timestamptz not null default now());
insert into dash.config values ('ingest_token', '"t0k"'), ('private_terms', '{"scrub": "zzqqnomatch", "drop": "zzqqnomatch"}');`;

const html = (lines: string[]) => `<html><body><h2>MACRO TAKEAWAYS</h2><p>built 06:40 SGT</p><h2>TRADE BOOK</h2>${lines.map((l) => `<p>${l}</p>`).join('')}</body></html>`;
const msg = (id: string, date: string, lines: string[] | null) => ({ id, subject: 'MACRO TAKEAWAYS [Fable 5.2] 27 Nov 2026', date,
  htmlBody: lines ? html(lines) : '<html><body><h2>MACRO TAKEAWAYS</h2><p>built 06:40 SGT</p></body></html>' });

Deno.test({ name: 'dash-ingest against local PostgreSQL', ignore: !url, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const db = postgres(url!, { max: 1, onnotice: () => {} });
  await db.unsafe(SCHEMA);
  Deno.env.set('SUPABASE_DB_URL', url!);
  let handler: ((r: Request) => Promise<Response>) | null = null;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: (r: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
  await import('./index.ts');
  const post = async (body: unknown) => (await handler!(new Request('http://x', { method: 'POST', body: JSON.stringify({ token: 't0k', ...body as object }) }))).json();
  const ok = (c: boolean, m: string) => { if (!c) throw new Error(m); };

  const first = await post({ kind: 'gmail_thread', data: msg('g1', 'Thu, 26 Nov 2026 22:40:00 +0000', ['long AUDJPY · AUDJPY=X → not carded: thin'])});
  ok(first.ok, JSON.stringify(first));
  ok((await db`select count(*)::int n from dash.tested where source = 'email'`)[0].n === 1, 'first copy tested row');

  // EDGE-03: a child write fails part-way: the new parent must not persist with the old children.
  await db.unsafe(`create function dash.boom() returns trigger language plpgsql as $$ begin if new.idea like '%BOOM%' then raise exception 'injected'; end if; return new; end $$;
    create trigger boom before insert on dash.tested for each row execute function dash.boom();`);
  const bad = await post({ kind: 'gmail_thread', data: msg('g2', 'Thu, 26 Nov 2026 23:10:00 +0000', ['long BOOM · EURUSD=X → not carded: thin'])});
  ok(bad.ok === false, 'the injected failure surfaces');
  const [p] = await db`select gmail_id from dash.digests`;
  ok(p.gmail_id === 'g1', `parent rolled back to g1, got ${p.gmail_id} (old code: g2 with g1's children deleted)`);
  ok((await db`select count(*)::int n from dash.tested where source = 'email'`)[0].n === 1, 'old children intact');
  await db.unsafe('drop trigger boom on dash.tested');

  // EDGE-02: a later copy with no trade block clears the superseded copy's email-tested lines
  const empty = await post({ kind: 'gmail_thread', data: msg('g3', 'Thu, 26 Nov 2026 23:30:00 +0000', null) });
  ok(empty.ok, JSON.stringify(empty));
  ok((await db`select gmail_id from dash.digests`)[0].gmail_id === 'g3', 'g3 is current');
  ok((await db`select count(*)::int n from dash.tested where source = 'email'`)[0].n === 0, 'old code left g1\'s line under g3');
  await db.end();
} });
