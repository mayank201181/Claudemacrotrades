-- Phase 2 and 3 of the learning loop.
--   Questions: the odds engine as printed in the digests (yellow tags, footer QUESTION LIST) plus
--     brief_state_current snapshots from Drive; scored for hit rate, lead time, base rate and by
--     evidence class.
--   Voices: stance-ledger entries mapped to directional calls on msd series (dash.stance_calls,
--     written by the scorer routine), graded at 10 and 42 sessions in units of the series' own
--     daily volatility; crowding = how many distinct voices hold a view on a market, and how one-sided.
--   Rules and lessons: the weekly review proposes rule amendments, the apply step puts them in force
--     unless the owner objects, and both pipelines read the ones in force every run.

-- ---------- questions ----------
create table if not exists dash.q_moves (
  model text not null, d date not null, qid text not null,
  tag_n int, net text, net_val smallint not null default 0,
  question text, resolves date, resolves_text text, implied text, priced text,
  evidence jsonb not null default '[]',
  primary key (model, d, qid)
);
create table if not exists dash.q_events (
  model text not null, d date not null, kind text not null, qid text not null, body jsonb not null,
  primary key (model, d, kind, qid)
);
-- One row per question per brief_state snapshot (as_of = the snapshot's "Last updated" date).
create table if not exists dash.q_state (
  model text not null, as_of date not null, qid text not null,
  question text, rule text, status text, opened date, resolves date, closed date, bucket text,
  net_to_date int, last_moved date, flagged int, open_implied text, last_implied text,
  entries jsonb not null default '[]',
  primary key (model, as_of, qid)
);
create table if not exists dash.q_scorecard (
  model text not null, d date not null, body jsonb not null, primary key (model, d)
);

-- ---------- voices ----------
create table if not exists dash.stance_class (
  entry_id bigint primary key, version text not null, n_calls smallint not null default 0,
  classified_by text, classified_at timestamptz not null default now()
);
create table if not exists dash.stance_calls (
  entry_id bigint not null, seq smallint not null,
  series_id text, dir smallint not null check (dir in (-1, 1)),
  conv smallint, cond boolean not null default false, hz text, instr text, lvl numeric,
  primary key (entry_id, seq)
);
create table if not exists dash.stance_grades (
  entry_id bigint not null, seq smallint not null,
  pipeline text, voice text, name text, affiliation text, topic text, stance text, stance_date date,
  series_id text, dir smallint, conv smallint, cond boolean, hz text, instr text,
  episode_start boolean, repeats int,
  ref_d date, ref_v numeric, sigma numeric, kind text, trend20 smallint, contrarian boolean,
  z10 numeric, z42 numeric, elapsed int, z_now numeric, last_d date,
  primary key (entry_id, seq)
);
create table if not exists dash.crowd_daily (
  series_id text not null, d date not null,
  bulls int not null, bears int not null, voices int not null, one_sided numeric,
  voices30 int, pct_hist numeric, extreme boolean not null default false, fwd10_z numeric,
  primary key (series_id, d)
);

-- ---------- rules and lessons ----------
create table if not exists dash.rules (
  rid text primary key,
  scope text not null default 'both' check (scope in ('both', 'fable', 'opus')),
  title text not null, body text not null,
  rationale text, evidence text, revert_if text,
  status text not null default 'proposed'
    check (status in ('proposed', 'in_force', 'opposed', 'withdrawn', 'superseded', 'reverted')),
  proposed_at timestamptz not null default now(), apply_after timestamptz,
  decided_at timestamptz, decided_note text, supersedes text, review_due date,
  source text not null default 'weekly-review'
);
create table if not exists dash.lessons (
  wk date primary key, title text, body text not null, metrics jsonb, proposals text[],
  created_at timestamptz not null default now()
);

alter table dash.q_moves enable row level security;
alter table dash.q_events enable row level security;
alter table dash.q_state enable row level security;
alter table dash.q_scorecard enable row level security;
alter table dash.stance_class enable row level security;
alter table dash.stance_calls enable row level security;
alter table dash.stance_grades enable row level security;
alter table dash.crowd_daily enable row level security;
alter table dash.rules enable row level security;
alter table dash.lessons enable row level security;

-- ---------- brief_state from routines ----------

-- The weekly review copies brief_state_current from Drive: the text is kept in dash.raw and parsed by
-- dash-ingest (the same parser the repo tests), called through pg_net with the ingest token.
create or replace function dash.put_brief_state(p_model text, p_text text) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_id bigint; v_upd text;
begin
  if p_model not in ('fable', 'opus') then raise exception 'model must be fable or opus'; end if;
  v_upd := (regexp_match(p_text, 'Last updated:\s*(\d{4}-\d{2}-\d{2}[^·\n]*)'))[1];
  if v_upd is null then raise exception 'not a brief state: no "Last updated" line'; end if;
  insert into dash.raw (kind, model, d, source_id, payload)
  values ('brief_state', p_model, left(v_upd, 10)::date, p_model || '|' || btrim(v_upd), jsonb_build_object('text', p_text))
  on conflict (kind, source_id) do update set payload = excluded.payload, received_at = now()
  returning id into v_id;
  perform net.http_post(
    url := 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-ingest',
    body := jsonb_build_object('token', (select value #>> '{}' from dash.config where key = 'ingest_token'), 'kind', 'brief_state', 'raw_id', v_id),
    timeout_milliseconds := 60000);
  return jsonb_build_object('raw_id', v_id, 'last_updated', v_upd);
end $$;

-- Bucket for a question the brief state has not described yet, from its wording.
create or replace function dash.q_bucket(q text) returns text language sql immutable as $$
  select case
    when q ~* '\m(USD|EUR|GBP|AUD|NZD|CAD|CHF|NOK|SEK)(USD|JPY|CHF|CAD|NOK|SEK)?\M|EURUSD|USDJPY|GBPUSD|AUDUSD|DXY|dollar index' and q !~* 'CNH|CNY|INR|KRW|TWD|IDR|MYR|PHP|THB|SGD|HKD|S\$NEER|MAS' then 'G10 FX'
    when q ~* 'CNH|CNY|INR|KRW|TWD|IDR|MYR|PHP|THB|SGD|HKD|S\$NEER|\mMAS\M|rupee|yuan|won\M' then 'Asia FX'
    when q ~* 'Fed\M|FOMC|UST|Treasur|\m(2|5|10|30)y\M|par yield|ECB|Bund|OAT|gilt|BoE|JGB|BoJ' then 'G3 rates'
    when q ~* 'RBI|RBA|BoK|KTB|ACGB|IGB|repo rate|PBoC|LPR|\mBI\M' then 'Asia rates'
    when q ~* 'Brent|WTI|crude|oil|diesel|gasoline|LNG|TTF|JKM|natural gas|OPEC' then 'energy'
    when q ~* 'gold|silver|copper|iron ore|aluminium|nickel|LME' then 'commodities ex-energy'
    when q ~* 'S&P|Nasdaq|Nikkei|KOSPI|Hang Seng|HSI|Nifty|TAIEX|CSI|VIX|equit|stocks?\M|IG |HY |CDS|spread' then 'equities/credit'
    else 'geopolitics/policy' end
$$;

-- ---------- question views ----------

-- Daily NET per question: the email's tag wins; brief_state entries fill the days before the
-- first ingested email (and any day an email was missed).
create or replace view dash.v_q_days as
select model, qid, d, net_val, 'email' src from dash.q_moves
union all
select s.model, s.qid, (e->>'d')::date, case upper(e->>'net') when 'UU' then 2 when 'U' then 1 when 'D' then -1 when 'DD' then -2 else 0 end, 'state'
from (select distinct on (model, qid, e->>'d') model, qid, e from dash.q_state, jsonb_array_elements(entries) e
      where (e->>'d') ~ '^\d{4}-\d{2}-\d{2}$' order by model, qid, e->>'d', as_of desc) s
where not exists (select 1 from dash.q_moves m where m.model = s.model and m.qid = s.qid and m.d = (s.e->>'d')::date);

create or replace function dash.pct_num(t text) returns numeric language sql immutable as $$
  select (regexp_match(coalesce(t, ''), '(\d+(?:\.\d+)?)\s*%'))[1]::numeric
$$;

create or replace function dash.verdict(net numeric, outcome text) returns text language sql immutable as $$
  select case when outcome is null or net is null then null
              when net = 0 then 'FLAT'
              when sign(net) = case outcome when 'YES' then 1 else -1 end then 'HIT' else 'MISS' end
$$;

create or replace view dash.v_questions as
with ids as (
  select model, qid from dash.q_moves
  union select model, qid from dash.q_events where kind in ('new', 'resolved', 'retired', 'open')
  union select model, qid from dash.q_state),
st as (select distinct on (model, qid) * from dash.q_state order by model, qid, as_of desc),
st0 as (select distinct on (model, qid) model, qid, opened, open_implied from dash.q_state where opened is not null order by model, qid, as_of),
nw as (select distinct on (model, qid) model, qid, d, body from dash.q_events where kind = 'new' order by model, qid, d),
rs as (select distinct on (model, qid) model, qid, d, body from dash.q_events where kind = 'resolved' order by model, qid, d desc),
rt as (select distinct on (model, qid) model, qid, d, body from dash.q_events where kind = 'retired' order by model, qid, d desc),
mv as (select model, qid, min(d) first_d, max(d) last_d,
          (array_agg(question order by d desc) filter (where question is not null))[1] question,
          (array_agg(resolves order by d desc) filter (where resolves is not null))[1] resolves,
          (array_agg(implied order by d) filter (where implied !~* '^\s*n/a'))[1] first_implied,
          (array_agg(implied order by d desc) filter (where implied !~* '^\s*n/a'))[1] last_implied
       from dash.q_moves group by 1, 2),
lbl as (select distinct on (model, qid) model, qid, body->>'label' label from dash.q_events where kind = 'open' order by model, qid, d desc),
base as (
  select i.model, i.qid,
    coalesce(nw.body->>'question', st.question, mv.question, lbl.label) question,
    coalesce(nw.body->>'rule', st.rule) rule,
    coalesce(st.bucket, dash.q_bucket(coalesce(nw.body->>'question', mv.question, lbl.label))) bucket,
    least(st0.opened, nw.d, mv.first_d) opened,
    coalesce((nw.body->>'resolves')::date, st.resolves, mv.resolves) resolves,
    coalesce(rs.body->>'outcome', case when st.status ~* '^resolved-(yes|no)' then upper(substring(st.status from 10)) end) outcome,
    rs.body->>'verdict' printed_verdict, rs.body->>'source' outcome_source,
    (rs.body->>'net')::int printed_net, (rs.body->>'days')::int printed_days,
    coalesce(rs.d, st.closed, rt.d) closed,
    case when rs.qid is not null or st.status ~* '^resolved' then 'resolved'
         when rt.qid is not null or st.status ~* '^retired' then 'retired'
         when st.status ~* 'awaiting' and st.as_of >= coalesce(mv.last_d, st.as_of) then 'awaiting'
         else 'open' end status,
    coalesce(rt.body->>'why', case when st.status ~* '^retired' then st.status end) retired_why,
    coalesce(rs.body->>'open_implied', st0.open_implied, mv.first_implied) open_implied,
    coalesce(rs.body->>'last_implied', st.last_implied, mv.last_implied) last_implied,
    st.net_to_date state_net, st.as_of state_as_of, mv.last_d last_move
  from ids i
  left join st using (model, qid) left join st0 using (model, qid) left join nw using (model, qid)
  left join rs using (model, qid) left join rt using (model, qid) left join mv using (model, qid) left join lbl using (model, qid))
select b.*,
  coalesce(b.printed_net,
           b.state_net + coalesce((select sum(net_val) from dash.v_q_days x where x.model = b.model and x.qid = b.qid and x.d > b.state_as_of), 0),
           (select sum(net_val) from dash.v_q_days x where x.model = b.model and x.qid = b.qid))::int net_total,
  (select coalesce(sum(net_val), 0) from dash.v_q_days x where x.model = b.model and x.qid = b.qid and x.d <= b.resolves - 2)::int net_lead2,
  (select coalesce(sum(net_val), 0) from dash.v_q_days x where x.model = b.model and x.qid = b.qid and x.d <= b.opened + 2)::int net_early,
  (select coalesce(sum(abs(net_val)), 0) from dash.v_q_days x where x.model = b.model and x.qid = b.qid and x.d > b.resolves - 2)::int arrows_late,
  (select coalesce(sum(abs(net_val)), 0) from dash.v_q_days x where x.model = b.model and x.qid = b.qid)::int arrows_all,
  (select count(*) from dash.v_q_days x where x.model = b.model and x.qid = b.qid)::int days_moved,
  (select min(d) from dash.v_q_days x where x.model = b.model and x.qid = b.qid) first_arrow
from base b;

-- Scored questions: the printed verdict, the same verdict re-taken on the arrows written at least
-- two days before the resolve date (late arrows often just watch the outcome arrive), and the
-- "always NO" base rate, since most level questions resolve NO.
create or replace view dash.v_q_scores as
select q.*,
  coalesce(q.printed_verdict, dash.verdict(q.net_total, q.outcome)) verdict,
  case when q.first_arrow <= q.resolves - 2 then dash.verdict(q.net_lead2, q.outcome) end verdict_lead2,
  case when q.first_arrow <= q.opened + 2 then dash.verdict(q.net_early, q.outcome) end verdict_early,
  dash.pct_num(q.open_implied) open_implied_pct,
  case when dash.pct_num(q.open_implied) is not null and dash.pct_num(q.open_implied) <> 50 and q.net_total <> 0
       then sign(q.net_total) <> sign(dash.pct_num(q.open_implied) - 50) end against_market
from dash.v_questions q where q.status = 'resolved' and q.outcome in ('YES', 'NO');

-- Every arrow on a resolved question, right or wrong, by evidence type and access class.
create or replace view dash.v_q_evidence as
select m.model, m.d, m.qid, s.outcome, s.resolves, (m.d > s.resolves - 2) late,
  (e->>'val')::int val, e->>'type' type, e->>'access' access, e->>'text' text,
  sign((e->>'val')::int) = case s.outcome when 'YES' then 1 else -1 end correct
from dash.q_moves m join dash.v_q_scores s using (model, qid), jsonb_array_elements(m.evidence) e
where coalesce((e->>'echo')::boolean, false) = false and (e->>'val')::int <> 0;

-- ---------- voices: grading and crowding ----------

create or replace function dash.refresh_scores() returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare n_g int; n_c int;
begin
  drop table if exists pg_temp._obs;
  create temp table _obs as
    select o.series_id, o.as_of d, o.value v,
           row_number() over (partition by o.series_id order by o.as_of) rn,
           case when coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') then 'diff' else 'log' end kind
    from (select distinct on (series_id, as_of) series_id, as_of, value from msd.observations
          where series_id in (select distinct series_id from dash.stance_calls where series_id is not null)
            and as_of >= date '2025-12-01' and value is not null
          order by series_id, as_of, vintage_date desc nulls last) o
    join msd.series s using (series_id)
    where coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') or o.value > 0;
  create index on _obs (series_id, rn);
  create index on _obs (series_id, d);
  drop table if exists pg_temp._chg;
  create temp table _chg as
    select a.series_id, a.rn, case a.kind when 'diff' then a.v - b.v else ln(a.v / b.v) end chg
    from _obs a join _obs b on b.series_id = a.series_id and b.rn = a.rn - 1;
  create index on _chg (series_id, rn);

  delete from dash.stance_grades;
  insert into dash.stance_grades
  with calls as (
    select c.entry_id, c.seq, e.pipeline, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')) voice, s.name, s.affiliation,
           e.topic, e.stance, e.stance_date, c.series_id, c.dir, c.conv, c.cond, c.hz, c.instr
    from dash.stance_calls c join stance.entries e using (entry_id) join stance.speakers s on s.speaker_id = e.speaker_id
    where c.series_id is not null),
  dedup as (   -- the same view logged by both pipelines on the same day is one call
    select distinct on (voice, series_id, dir, stance_date) * from calls order by voice, series_id, dir, stance_date, entry_id),
  ep as (
    select d.*, lag(dir) over w prev_dir, lag(stance_date) over w prev_d from dedup d
    window w as (partition by voice, series_id order by stance_date, entry_id)),
  ep2 as (
    select *, (prev_dir is null or prev_dir <> dir or stance_date - prev_d > 14) episode_start from ep),
  ep3 as (
    select *, sum(case when episode_start then 1 else 0 end) over (partition by voice, series_id order by stance_date, entry_id) ep_no from ep2),
  ep4 as (
    select *, count(*) over (partition by voice, series_id, ep_no) repeats from ep3)
  select g.entry_id, g.seq, g.pipeline, g.voice, g.name, g.affiliation, g.topic, g.stance, g.stance_date,
         g.series_id, g.dir, g.conv, g.cond, g.hz, g.instr, g.episode_start, g.repeats::int,
         r.d, r.v, sg.sigma, r.kind, tr.t20::smallint, (tr.t20 <> 0 and tr.t20 <> g.dir),
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f10.v - r.v else ln(f10.v / r.v) end) / (sg.sigma * sqrt(10)) end,
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f42.v - r.v else ln(f42.v / r.v) end) / (sg.sigma * sqrt(42)) end,
         (lt.rn - r.rn)::int,
         case when sg.sigma > 0 and lt.rn > r.rn then g.dir * (case r.kind when 'diff' then lt.v - r.v else ln(lt.v / r.v) end) / (sg.sigma * sqrt(lt.rn - r.rn)) end,
         lt.d
  from ep4 g
  left join lateral (select * from _obs o where o.series_id = g.series_id and o.d > g.stance_date order by o.d limit 1) r on true
  left join lateral (select stddev_samp(chg) sigma, count(*) n from _chg c where c.series_id = g.series_id and c.rn between r.rn - 60 and r.rn - 1) sg0 on true
  left join lateral (select case when sg0.n >= 20 then sg0.sigma end sigma) sg on true
  left join lateral (select sign(r.v - o.v) t20 from _obs o where o.series_id = g.series_id and o.rn = r.rn - 20) tr on true
  left join lateral (select v from _obs o where o.series_id = g.series_id and o.rn = r.rn + 10) f10 on true
  left join lateral (select v from _obs o where o.series_id = g.series_id and o.rn = r.rn + 42) f42 on true
  left join lateral (select rn, v, d from _obs o where o.series_id = g.series_id order by rn desc limit 1) lt on true;
  get diagnostics n_g = row_count;

  -- Crowding: on each day, each voice's latest call on a series inside the last 7 days counts once.
  delete from dash.crowd_daily;
  insert into dash.crowd_daily (series_id, d, bulls, bears, voices, one_sided, voices30)
  with span as (select series_id, min(stance_date) a from dash.stance_grades group by 1),
  days as (select s.series_id, g::date d from span s, generate_series(s.a, (now() at time zone 'Asia/Singapore')::date, interval '1 day') g),
  act as (
    select dy.series_id, dy.d,
      count(*) filter (where x.dir = 1) bulls, count(*) filter (where x.dir = -1) bears
    from days dy
    left join lateral (select distinct on (voice) voice, dir from dash.stance_grades g
                       where g.series_id = dy.series_id and g.stance_date > dy.d - 7 and g.stance_date <= dy.d
                       order by voice, stance_date desc, entry_id desc) x on true
    group by 1, 2),
  act30 as (
    select dy.series_id, dy.d, count(distinct g.voice) v30 from days dy
    join dash.stance_grades g on g.series_id = dy.series_id and g.stance_date > dy.d - 30 and g.stance_date <= dy.d
    group by 1, 2)
  select a.series_id, a.d, a.bulls, a.bears, a.bulls + a.bears,
         case when a.bulls + a.bears > 0 then abs(a.bulls - a.bears)::numeric / (a.bulls + a.bears) end, coalesce(b.v30, 0)
  from act a left join act30 b using (series_id, d);
  get diagnostics n_c = row_count;

  -- Participation percentile: against this series' own earlier days once it has 20 of them,
  -- else against every series-day so far (no look-ahead either way).
  update dash.crowd_daily c set pct_hist = coalesce(
    (select case when count(*) >= 20 then avg((p.voices < c.voices)::int) end from dash.crowd_daily p where p.series_id = c.series_id and p.d < c.d),
    (select avg((p.voices < c.voices)::int) from dash.crowd_daily p where p.d < c.d))
  where c.voices > 0;
  update dash.crowd_daily set extreme = (voices >= 5 and one_sided >= 0.8 and coalesce(pct_hist, 0) >= 0.9);
  -- What followed: the next 10 sessions' move in the crowd's direction, in daily-vol units.
  update dash.crowd_daily c set fwd10_z = x.z
  from (
    select c2.series_id, c2.d,
      sign(c2.bulls - c2.bears) * (case r.kind when 'diff' then f.v - r.v else ln(f.v / r.v) end) / nullif(sg.sigma * sqrt(10), 0) z
    from dash.crowd_daily c2
    join lateral (select * from _obs o where o.series_id = c2.series_id and o.d > c2.d order by o.d limit 1) r on true
    join lateral (select v from _obs o where o.series_id = c2.series_id and o.rn = r.rn + 10) f on true
    join lateral (select stddev_samp(chg) sigma from _chg ch where ch.series_id = c2.series_id and ch.rn between r.rn - 60 and r.rn - 1) sg on true
    where c2.bulls <> c2.bears) x
  where c.series_id = x.series_id and c.d = x.d;
  return jsonb_build_object('grades', n_g, 'crowd_days', n_c);
end $$;

-- ---------- scorer routine API (stance → calls) ----------

-- Entries not yet classified, oldest first, as "id | date | speaker (affiliation) | topic | stance" lines.
create or replace function dash.stance_backlog(p_limit int default 150) returns jsonb
language sql stable security definer set search_path = dash, public as $$
  select jsonb_build_object(
    'remaining', (select count(*) from stance.entries e where not exists (select 1 from dash.stance_class c where c.entry_id = e.entry_id)),
    'rules', (select value #>> '{}' from dash.config where key = 'call_rules'),
    'vocabulary', (select value #>> '{}' from dash.config where key = 'call_vocab'),
    'entries', (select coalesce(string_agg(format('%s | %s | %s (%s) | %s | %s', e.entry_id, e.stance_date, s.name, coalesce(s.affiliation, '-'),
                  e.topic, replace(e.stance, E'\n', ' ')), E'\n' order by e.entry_id), '')
                from (select * from stance.entries e where not exists (select 1 from dash.stance_class c where c.entry_id = e.entry_id)
                      order by entry_id limit p_limit) e join stance.speakers s using (speaker_id)));
$$;

-- p = {"version": "...", "by": "...", "results": [{"id": 12, "calls": [{"s": "...", "dir": 1, "conv": 2, "cond": false, "hz": "weeks", "instr": "...", "lvl": null}]}]}
-- A series id outside the vocabulary is stored as null (unscored), never guessed.
create or replace function dash.put_stance_calls(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare r jsonb; c jsonb; i int; n_e int := 0; n_c int := 0; n_bad int := 0; sid text; known text[];
begin
  select array(select jsonb_array_elements_text(value)) into known from dash.config where key = 'call_series';
  for r in select * from jsonb_array_elements(coalesce(p->'results', '[]')) loop
    if not exists (select 1 from stance.entries where entry_id = (r->>'id')::bigint) then n_bad := n_bad + 1; continue; end if;
    delete from dash.stance_calls where entry_id = (r->>'id')::bigint;
    i := 0;
    for c in select * from jsonb_array_elements(coalesce(r->'calls', '[]')) loop
      if (c->>'dir') not in ('1', '-1') then continue; end if;
      sid := nullif(c->>'s', '');
      if sid is not null and not (sid = any(known)) then sid := null; end if;
      insert into dash.stance_calls (entry_id, seq, series_id, dir, conv, cond, hz, instr, lvl)
      values ((r->>'id')::bigint, i, sid, (c->>'dir')::smallint, nullif(c->>'conv', '')::smallint,
              coalesce((c->>'cond')::boolean, false), c->>'hz', left(c->>'instr', 80),
              case when (c->>'lvl') ~ '^-?\d+(\.\d+)?$' then (c->>'lvl')::numeric end);
      i := i + 1; n_c := n_c + 1;
      exit when i >= 3;
    end loop;
    insert into dash.stance_class (entry_id, version, n_calls, classified_by, classified_at)
    values ((r->>'id')::bigint, coalesce(p->>'version', 'v1'), i, p->>'by', now())
    on conflict (entry_id) do update set version = excluded.version, n_calls = excluded.n_calls,
      classified_by = excluded.classified_by, classified_at = now();
    n_e := n_e + 1;
  end loop;
  return jsonb_build_object('entries', n_e, 'calls', n_c, 'unknown_ids', n_bad);
end $$;

-- ---------- rules API (weekly review and the pipelines) ----------

-- What both pipelines read every run (STEP 1f): the amendments in force for this pipeline.
create or replace function dash.rules_in_force(p_pipeline text) returns text
language sql stable security definer set search_path = dash, public as $$
  select coalesce(string_agg(format(E'%s — %s (in force since %s)\n%s', rid, title,
           to_char(decided_at at time zone 'Asia/Singapore', 'DD Mon YYYY'), body), E'\n\n' order by rid), 'none')
  from dash.rules where status = 'in_force' and scope in ('both', p_pipeline);
$$;

-- The first Sunday 20:00 SGT that is at least 24 hours away.
create or replace function dash.next_apply_window(p_from timestamptz default now()) returns timestamptz
language sql stable as $$
  select min(t) from (
    select ((date_trunc('day', (p_from at time zone 'Asia/Singapore')) + make_interval(days => k) + interval '20 hours') at time zone 'Asia/Singapore') t
    from generate_series(0, 14) k) x
  where extract(isodow from (t at time zone 'Asia/Singapore')) = 7 and t >= p_from + interval '24 hours';
$$;

-- p = {"title", "body", "rationale", "evidence", "revert_if", "scope", "supersedes", "review_due", "apply_after", "source"}
create or replace function dash.propose_rule(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_rid text;
begin
  if coalesce(p->>'title', '') = '' or coalesce(p->>'body', '') = '' then raise exception 'title and body are required'; end if;
  select 'R' || lpad((coalesce(max(substring(rid from 2)::int), 0) + 1)::text, 2, '0') into v_rid from dash.rules;
  insert into dash.rules (rid, scope, title, body, rationale, evidence, revert_if, supersedes, review_due, apply_after, source)
  values (v_rid, coalesce(p->>'scope', 'both'), p->>'title', p->>'body', p->>'rationale', p->>'evidence', p->>'revert_if',
          p->>'supersedes', (p->>'review_due')::date, coalesce((p->>'apply_after')::timestamptz, dash.next_apply_window()),
          coalesce(p->>'source', 'weekly-review'));
  return jsonb_build_object('rid', v_rid, 'apply_after', (select apply_after from dash.rules where rid = v_rid));
end $$;

-- p = {"oppose": ["R03"], "withdraw": [], "revert": [], "note": "..."}: records the owner's objections,
-- then puts every unopposed proposal whose window has passed in force.
create or replace function dash.decide_rules(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_applied text[]; v_opposed text[]; v_reverted text[];
begin
  with u as (update dash.rules set status = 'opposed', decided_at = now(), decided_note = p->>'note'
    where status = 'proposed' and rid in (select jsonb_array_elements_text(coalesce(p->'oppose', '[]'))) returning rid)
  select array_agg(rid) into v_opposed from u;
  update dash.rules set status = 'withdrawn', decided_at = now(), decided_note = p->>'note'
  where status = 'proposed' and rid in (select jsonb_array_elements_text(coalesce(p->'withdraw', '[]')));
  with u as (update dash.rules set status = 'reverted', decided_at = now(), decided_note = p->>'note'
    where status = 'in_force' and rid in (select jsonb_array_elements_text(coalesce(p->'revert', '[]'))) returning rid)
  select array_agg(rid) into v_reverted from u;
  -- Reverting a rule that replaced another puts the one it replaced back in force.
  update dash.rules o set status = 'in_force', decided_at = now(), decided_note = 'restored: ' || n.rid || ' reverted'
  from dash.rules n where n.rid = any(coalesce(v_reverted, '{}')) and n.supersedes = o.rid and o.status = 'superseded';
  with ap as (
    update dash.rules set status = 'in_force', decided_at = now()
    where status = 'proposed' and apply_after <= now() returning rid, supersedes)
  select array_agg(rid) into v_applied from ap;
  update dash.rules o set status = 'superseded', decided_at = now(), decided_note = 'superseded by ' || n.rid
  from dash.rules n where n.status = 'in_force' and n.supersedes = o.rid and o.status = 'in_force';
  return jsonb_build_object('applied', coalesce(to_jsonb(v_applied), '[]'), 'opposed', coalesce(to_jsonb(v_opposed), '[]'),
    'reverted', coalesce(to_jsonb(v_reverted), '[]'),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('rid', rid, 'title', title, 'apply_after', apply_after) order by rid), '[]')
                from dash.rules where status = 'proposed'));
end $$;

create or replace function dash.record_lessons(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
begin
  insert into dash.lessons (wk, title, body, metrics, proposals)
  values ((p->>'wk')::date, p->>'title', p->>'body', p->'metrics',
          array(select jsonb_array_elements_text(coalesce(p->'proposals', '[]'))))
  on conflict (wk) do update set title = excluded.title, body = excluded.body, metrics = excluded.metrics,
    proposals = excluded.proposals, created_at = now();
  return jsonb_build_object('wk', p->>'wk');
end $$;

-- Everything the weekly review reads, in one call.
create or replace function dash.review_inputs(p_days int default 7) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare shadow_f jsonb; shadow_o jsonb;
begin
  begin shadow_f := shadow.summary('fable', 14); exception when others then shadow_f := jsonb_build_object('error', sqlerrm); end;
  begin shadow_o := shadow.summary('opus', 14); exception when others then shadow_o := jsonb_build_object('error', sqlerrm); end;
  return jsonb_build_object(
    'as_of', now(),
    'trade_books', (select jsonb_object_agg(model, jsonb_build_object('updated', updated, 'scorecard', scorecard)) from dash.book_state),
    'trades_closed_recently', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'pid', pid, 'title', title, 'status', status,
          'tclass', tclass, 'result_r', result_r, 'exit', exit_reason, 'p', p, 'rr', rr, 'ev', ev, 'closed', closed) order by model, pid), '[]')
        from dash.trades where status like 'closed%' and last_seen >= current_date - p_days),
    'trades_open', (select coalesce(jsonb_agg(jsonb_build_object('model', t.model, 'pid', t.pid, 'title', t.title, 'tclass', t.tclass,
          'p', t.p, 'rr', t.rr, 'ev', t.ev, 'live_r', l.r, 'daily_r', l.daily_r) order by t.model, t.pid), '[]')
        from dash.trades t left join dash.live_marks l using (model, pid) where t.status in ('open', 'pending')),
    'gate_audit', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'fail', fail, 'ev_bucket', ev_bucket, 'n', n,
          'graded5', graded5, 'avg_ret5_atr', avg5, 'hit5', hit5, 'avg_last_atr', avg_last) order by model, fail, ev_bucket), '[]') from (
        select t.model, coalesce(t.fail_code, t.verdict) fail,
          case when t.ev is null then 'n/a' when t.ev >= 0.15 then 'EV>=0.15' when t.ev >= 0 then 'EV 0-0.15' else 'EV<0' end ev_bucket,
          count(*) n, count(o.ret5) graded5, round(avg(o.ret5), 2) avg5, round(avg((o.ret5 > 0)::int), 2) hit5, round(avg(o.ret_last), 2) avg_last
        from dash.tested t left join dash.idea_outcomes o using (model, d, idea)
        where t.verdict = 'not carded'
        group by 1, 2, 3) g),
    'shadow', jsonb_build_object('fable', shadow_f, 'opus', shadow_o),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'resolved', n, 'hit', hit, 'miss', miss, 'flat', flat,
          'always_no_hit', always_no, 'lead2_scored', l2n, 'lead2_hit', l2h, 'lead2_miss', l2m, 'late_arrow_share', late_share,
          'against_market', am, 'against_market_hit', amh)), '[]') from (
        select model, count(*) n, count(*) filter (where verdict = 'HIT') hit, count(*) filter (where verdict = 'MISS') miss,
          count(*) filter (where verdict = 'FLAT') flat, count(*) filter (where outcome = 'NO') always_no,
          count(verdict_lead2) l2n, count(*) filter (where verdict_lead2 = 'HIT') l2h, count(*) filter (where verdict_lead2 = 'MISS') l2m,
          round(sum(arrows_late)::numeric / nullif(sum(arrows_all), 0), 2) late_share,
          count(*) filter (where against_market) am, count(*) filter (where against_market and verdict = 'HIT') amh
        from dash.v_q_scores group by model) q),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'access', access, 'n', n, 'correct', c, 'n_early', ne, 'correct_early', ce)), '[]') from (
        select coalesce(type, '?') type, coalesce(access, '?') access, count(*) n, count(*) filter (where correct) c,
          count(*) filter (where not late) ne, count(*) filter (where correct and not late) ce
        from dash.v_q_evidence group by 1, 2 having count(*) >= 3) e),
    'questions_open', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'qid', qid, 'question', question, 'resolves', resolves,
          'net', net_total, 'implied', last_implied) order by model, qid), '[]') from dash.v_questions where status in ('open', 'awaiting')),
    'voices', (select coalesce(jsonb_agg(v order by (v->>'n10')::int desc), '[]') from (
        select jsonb_build_object('voice', min(name), 'n10', count(z10), 'hit10', round(avg((z10 > 0)::int), 2), 'avg_z10', round(avg(z10), 2),
          'n42', count(z42), 'hit42', round(avg((z42 > 0)::int), 2), 'contrarian_n', count(*) filter (where contrarian and z10 is not null),
          'contrarian_hit', count(*) filter (where contrarian and z10 > 0)) v
        from dash.stance_grades where episode_start group by voice having count(z10) >= 3) vv),
    'crowd_extremes', (select coalesce(jsonb_agg(jsonb_build_object('series', series_id, 'd', d, 'bulls', bulls, 'bears', bears,
          'pct', round(pct_hist, 2), 'fwd10_z', round(fwd10_z, 2)) order by d desc), '[]')
        from dash.crowd_daily where extreme and d >= current_date - 30),
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by rid), '[]') from dash.rules r),
    'previous_lessons', (select coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'title', title, 'body', body) order by wk desc), '[]')
        from (select * from dash.lessons order by wk desc limit 2) l));
end $$;

-- ---------- site RPCs ----------

create or replace function public.dash_questions() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'questions', (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
        'verdict', s.verdict, 'verdict_lead2', s.verdict_lead2, 'verdict_early', s.verdict_early, 'against_market', s.against_market,
        'days', (select coalesce(jsonb_agg(jsonb_build_object('d', m.d, 'net', m.net, 'implied', m.implied, 'priced', m.priced, 'evidence', m.evidence) order by m.d), '[]')
                 from dash.q_moves m where m.model = q.model and m.qid = q.qid),
        'state_days', (select coalesce(jsonb_agg(jsonb_build_object('d', x.d, 'net_val', x.net_val) order by x.d), '[]')
                 from dash.v_q_days x where x.model = q.model and x.qid = q.qid and x.src = 'state'))
      order by q.model, q.qid), '[]')
      from dash.v_questions q left join dash.v_q_scores s using (model, qid)),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'access', access, 'n', n, 'correct', c, 'n_early', ne, 'correct_early', ce) order by n desc), '[]') from (
        select coalesce(type, '?') type, coalesce(access, '?') access, count(*) n, count(*) filter (where correct) c,
          count(*) filter (where not late) ne, count(*) filter (where correct and not late) ce
        from dash.v_q_evidence group by 1, 2) e),
    'themes', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'tid', qid, 'first', first_d, 'last', last_d, 'printed', n,
          'label', label, 'indep', indep, 'becomes_if', becomes_if) order by last_d desc), '[]') from (
        select model, qid, min(d) first_d, max(d) last_d, count(*) n,
          (array_agg(body->>'label' order by d desc))[1] label, max((body->>'indep')::int) indep,
          (array_agg(body->>'becomes_if' order by d desc))[1] becomes_if
        from dash.q_events where kind = 'theme' group by 1, 2) t),
    'scorecards', (select coalesce(jsonb_object_agg(model, body), '{}') from (
        select distinct on (model) model, body from dash.q_scorecard order by model, d desc) sc));
end $$;

create or replace function public.dash_voices() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'coverage', jsonb_build_object(
      'entries', (select count(*) from stance.entries),
      'classified', (select count(*) from dash.stance_class),
      'with_calls', (select count(*) from dash.stance_class where n_calls > 0),
      'calls', (select count(*) from dash.stance_calls),
      'scorable', (select count(*) from dash.stance_calls where series_id is not null),
      'episodes', (select count(*) from dash.stance_grades where episode_start),
      'graded10', (select count(*) from dash.stance_grades where episode_start and z10 is not null),
      'graded42', (select count(*) from dash.stance_grades where episode_start and z42 is not null),
      'last_bar', (select max(last_d) from dash.stance_grades)),
    'leaders', (select coalesce(jsonb_agg(v), '[]') from (
        select jsonb_build_object('voice', voice, 'name', min(name), 'affiliation', min(affiliation),
          'calls', count(*), 'live', count(*) filter (where z10 is null and z_now is not null),
          'live_z', round(avg(z_now) filter (where z10 is null), 2),
          'n10', count(z10), 'hit10', count(*) filter (where z10 > 0), 'avg_z10', round(avg(z10), 2),
          'trend_hit10', count(*) filter (where trend20 * dir * z10 > 0),
          'n42', count(z42), 'hit42', count(*) filter (where z42 > 0), 'avg_z42', round(avg(z42), 2),
          'contra_n', count(*) filter (where contrarian and z10 is not null), 'contra_hit', count(*) filter (where contrarian and z10 > 0),
          'topics', (array_agg(distinct topic)), 'last', max(stance_date)) v
        from dash.stance_grades where episode_start group by voice) l),
    'crowd', (select coalesce(jsonb_agg(jsonb_build_object('series', c.series_id, 'name', m.name, 'd', c.d, 'bulls', c.bulls, 'bears', c.bears,
          'voices', c.voices, 'voices30', c.voices30, 'one_sided', round(c.one_sided, 2), 'pct', round(c.pct_hist, 2), 'extreme', c.extreme,
          'path', (select jsonb_agg(jsonb_build_array(p.d, p.bulls, p.bears) order by p.d) from dash.crowd_daily p where p.series_id = c.series_id and p.d > c.d - 30))
        order by c.voices desc, c.series_id), '[]')
      from dash.crowd_daily c left join msd.series m on m.series_id = c.series_id
      where c.d = (select max(d) from dash.crowd_daily) and c.voices30 > 0),
    'extremes', (select coalesce(jsonb_agg(jsonb_build_object('series', series_id, 'd', d, 'bulls', bulls, 'bears', bears, 'pct', round(pct_hist, 2),
          'fwd10_z', round(fwd10_z, 2)) order by d desc), '[]') from (
        select c.*, lag(extreme) over (partition by series_id order by d) prev from dash.crowd_daily c) e
      where extreme and prev is not true),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'topic', topic, 'voices', n) order by wk, topic), '[]') from (
        select date_trunc('week', stance_date)::date wk, topic, count(distinct lower(s.name)) n
        from stance.entries e join stance.speakers s using (speaker_id)
        where stance_date >= current_date - 70 group by 1, 2) a));
end $$;

create or replace function public.dash_voice(p_voice text) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('d', g.stance_date, 'topic', g.topic, 'stance', g.stance, 'series', g.series_id,
            'name', m.name, 'dir', g.dir, 'conv', g.conv, 'cond', g.cond, 'hz', g.hz, 'instr', g.instr, 'start', g.episode_start,
            'repeats', g.repeats, 'ref_d', g.ref_d, 'ref_v', g.ref_v, 'z10', round(g.z10, 2), 'z42', round(g.z42, 2),
            'z_now', round(g.z_now, 2), 'elapsed', g.elapsed, 'contrarian', g.contrarian) order by g.stance_date desc, g.entry_id desc), '[]')
          from dash.stance_grades g left join msd.series m on m.series_id = g.series_id where g.voice = lower(p_voice));
end $$;

create or replace function public.dash_review() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by r.rid desc), '[]') from dash.rules r),
    'lessons', (select coalesce(jsonb_agg(to_jsonb(l) order by l.wk desc), '[]') from dash.lessons l));
end $$;

revoke all on function public.dash_questions() from public, anon;
revoke all on function public.dash_voices() from public, anon;
revoke all on function public.dash_voice(text) from public, anon;
revoke all on function public.dash_review() from public, anon;
grant execute on function public.dash_questions() to authenticated;
grant execute on function public.dash_voices() to authenticated;
grant execute on function public.dash_voice(text) to authenticated;
grant execute on function public.dash_review() to authenticated;
revoke all on function dash.refresh_scores() from public, anon, authenticated;
revoke all on function dash.stance_backlog(int) from public, anon, authenticated;
revoke all on function dash.put_stance_calls(jsonb) from public, anon, authenticated;
revoke all on function dash.rules_in_force(text) from public, anon, authenticated;
revoke all on function dash.propose_rule(jsonb) from public, anon, authenticated;
revoke all on function dash.decide_rules(jsonb) from public, anon, authenticated;
revoke all on function dash.record_lessons(jsonb) from public, anon, authenticated;
revoke all on function dash.review_inputs(int) from public, anon, authenticated;
revoke all on function dash.put_brief_state(text, text) from public, anon, authenticated;

-- Grades and crowding refresh after the msd daily data run (21:15 UTC) has landed.
select cron.schedule('dash-scores-daily', '40 22 * * *', $$ select dash.refresh_scores(); $$);
