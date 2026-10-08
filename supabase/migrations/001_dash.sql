-- Macro dashboard store. Lives in its own schema (not exposed through the REST API);
-- the site reads only through the security-definer RPCs at the bottom, which check
-- the signed-in user's email against dash.config.allowed_emails.

create schema if not exists dash;

create table if not exists dash.config (
  key text primary key,
  value jsonb not null
);

-- Every payload the ingest function receives, kept verbatim so any parser fix can be re-run.
create table if not exists dash.raw (
  id bigserial primary key,
  kind text not null,               -- gmail_thread | trade_book
  model text,
  d date,
  source_id text,                   -- gmail message id or drive file id + updated stamp
  received_at timestamptz not null default now(),
  payload jsonb not null,
  unique (kind, source_id)
);

create table if not exists dash.digests (
  model text not null check (model in ('fable','opus')),
  d date not null,
  subject text not null,
  gmail_id text not null,
  sent_at timestamptz,
  built text,
  header text,
  sixty jsonb not null default '[]',
  themes jsonb not null default '[]',
  sections jsonb not null default '[]',
  trade_block text,
  parsed_at timestamptz not null default now(),
  primary key (model, d)
);

create table if not exists dash.trades (
  model text not null,
  pid text not null,
  title text,
  status text,
  asset_class text,
  direction smallint,
  tclass text,
  proxy text,
  opened text, filled text, closed text,
  ref numeric, entry numeric, stop numeric, target numeric,
  rr numeric, p numeric, p0 numeric, ev numeric,
  result_r numeric, exit_reason text, review text,
  thesis text, invalidation text, structure text,
  meta jsonb not null default '{}',
  first_seen date, last_seen date,
  updated_at timestamptz not null default now(),
  primary key (model, pid)
);

create table if not exists dash.trade_marks (
  model text not null, pid text not null, d date not null,
  mark numeric, chg text, r numeric, note text,
  primary key (model, pid, d)
);

create table if not exists dash.trade_log (
  model text not null, d date not null, ref text not null, text text not null,
  primary key (model, d, ref, text)
);

create table if not exists dash.tested (
  model text not null, d date not null, idea text not null,
  seq int, proxy text, direction smallint,
  verdict text, fail_code text, covered_by text,
  rr numeric, p numeric, p0 numeric, ev numeric, reason text,
  source text not null,             -- ledger (complete) | email (top-8 printed)
  primary key (model, d, idea)
);

create table if not exists dash.book_state (
  model text primary key,
  updated text, scorecard text, rules text,
  ingested_at timestamptz not null default now()
);

-- Price bars from Yahoo, written by the dash-mark edge function.
create table if not exists dash.bars (
  symbol text not null, interval text not null, ts timestamptz not null,
  o numeric, h numeric, l numeric, c numeric,
  primary key (symbol, interval, ts)
);

-- Latest live mark per open trade (hourly). Informational: the book's official exits stay
-- on daily closes per trade_book_spec; touched flags show intraday breaches.
create table if not exists dash.live_marks (
  model text not null, pid text not null,
  as_of timestamptz not null, price numeric, r numeric,
  hi_since_fill numeric, lo_since_fill numeric,
  stop_touched boolean, target_touched boolean,
  daily_close numeric, daily_close_d date, daily_r numeric,
  stop_closed boolean, target_closed boolean,
  primary key (model, pid)
);

-- Forward outcome of every tested idea (entered or not), in the idea's own direction.
create table if not exists dash.idea_outcomes (
  model text not null, d date not null, idea text not null,
  proxy text, direction smallint,
  ref_d date, ref numeric, atr20 numeric,
  ret1 numeric, ret5 numeric, ret10 numeric, ret20 numeric,     -- in ATR units, signed by direction
  last_d date, ret_last numeric,
  updated_at timestamptz not null default now(),
  primary key (model, d, idea)
);

alter table dash.config enable row level security;
alter table dash.raw enable row level security;
alter table dash.digests enable row level security;
alter table dash.trades enable row level security;
alter table dash.trade_marks enable row level security;
alter table dash.trade_log enable row level security;
alter table dash.tested enable row level security;
alter table dash.book_state enable row level security;
alter table dash.bars enable row level security;
alter table dash.live_marks enable row level security;
alter table dash.idea_outcomes enable row level security;

revoke all on schema dash from anon, authenticated;

-- ---------- access ----------

create or replace function dash.allowed() returns boolean
language sql stable security definer set search_path = dash, public as $$
  select coalesce(
    (auth.jwt() ->> 'email') is not null
    and lower(auth.jwt() ->> 'email') in (
      select lower(jsonb_array_elements_text(value)) from dash.config where key = 'allowed_emails'),
    false);
$$;

create or replace function public.dash_index() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'digests', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'd', d, 'subject', subject, 'built', built,
                  'themes', (select jsonb_agg(jsonb_build_object('n', t->'n', 'title', t->'title', 'breadth', t->'breadth')) from jsonb_array_elements(themes) t))
                  order by d desc, model), '[]') from dash.digests),
    'book', (select coalesce(jsonb_object_agg(model, to_jsonb(b) - 'model'), '{}') from dash.book_state b),
    'now', now());
end $$;

create or replace function public.dash_digest(p_model text, p_d date) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select to_jsonb(g) from dash.digests g where model = p_model and d = p_d);
end $$;

create or replace function public.dash_trades(p_model text) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
                  'marks', (select coalesce(jsonb_agg(to_jsonb(m) - 'model' - 'pid' order by m.d), '[]') from dash.trade_marks m where m.model = t.model and m.pid = t.pid),
                  'log', (select coalesce(jsonb_agg(jsonb_build_object('d', l.d, 'text', l.text) order by l.d), '[]') from dash.trade_log l where l.model = t.model and l.ref = t.pid),
                  'live', (select to_jsonb(v) - 'model' - 'pid' from dash.live_marks v where v.model = t.model and v.pid = t.pid))
                order by t.pid desc), '[]') from dash.trades t where t.model = p_model),
    'tested', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
                  'outcome', (select to_jsonb(o) - 'model' - 'd' - 'idea' from dash.idea_outcomes o where o.model = x.model and o.d = x.d and o.idea = x.idea))
                order by x.d desc, x.seq), '[]') from dash.tested x where x.model = p_model),
    'book', (select to_jsonb(b) from dash.book_state b where b.model = p_model));
end $$;

revoke all on function public.dash_index() from public, anon;
revoke all on function public.dash_digest(text, date) from public, anon;
revoke all on function public.dash_trades(text) from public, anon;
grant execute on function public.dash_index() to authenticated;
grant execute on function public.dash_digest(text, date) to authenticated;
grant execute on function public.dash_trades(text) to authenticated;
