-- 015: Drivers tab. The FX drivers engine (the drivers pack: 21 USD pairs against up to 20 macro driver
-- groups each; run AST-DRV-20261007T1000Z, holdout rerun r2) runs off-site on the owner's Mac (the
-- holdout on a cloud VM). A snapshot of its PM-facing outputs is loaded here per as-of date as one JSON,
-- through dash.put_drivers (the dash-ingest 'drivers' kind, or execute_sql). The site reads only
-- public.dash_drivers; the digests read dash.drivers_brief through execute_sql, like
-- dash.positioning_extremes. Every number is stored as the engine produced it (jsonb, unrounded).
--
--   drivers_run     one row per as-of date: run id, version, where it came from, metadata (never outcome values)
--   drivers_part    the pack's five parts with the holdout verdict each; show = the tab displays the part
--                   (only passing parts are shown, decided 10 Oct 2026); the others stay stored but hidden
--   drivers_pair    the PM-facing row per pair (drv_tab_daily: top drivers, fit statistics, 20/60-day move,
--                   alert state, grey flag with reasons, digest line)
--   drivers_driver  the "what's driving now" rows per pair, window (3m, 1y) and driver group (drv_driving_now)
--   drivers_item    rows of the other parts when they are shown (levels map, tactical rules): part, seq, row
-- No policies: the owner's loader writes, and the site reads only through public.dash_drivers.

create table if not exists dash.drivers_run (
  as_of date primary key,          -- the engine's last data date (drv_tab_daily.date)
  run_id text not null,
  version text,                    -- asof_pub | final
  source text,                     -- e.g. 'r2 package', 'mac daily'
  n_pairs int not null,
  meta jsonb not null default '{}',
  loaded_at timestamptz not null default now()
);

create table if not exists dash.drivers_part (
  as_of date not null references dash.drivers_run on delete cascade,
  part text not null check (part in ('driving_now', 'rich_cheap', 'waking_up', 'levels', 'tactical')),
  verdict text not null,           -- PASS | FAIL | UNTESTED | DEV_ONLY | INCOMPLETE (as the pack states it)
  show boolean not null default false,
  note text,
  primary key (as_of, part)
);

create table if not exists dash.drivers_pair (
  as_of date not null references dash.drivers_run on delete cascade,
  pair_id text not null,
  ord smallint not null,
  grey boolean not null default false,
  row jsonb not null,
  primary key (as_of, pair_id)
);

create table if not exists dash.drivers_driver (
  as_of date not null references dash.drivers_run on delete cascade,
  pair_id text not null,
  source text not null check (source in ('3m', '1y')),
  group_id text not null,
  rank smallint,
  name text,
  row jsonb not null,
  primary key (as_of, pair_id, source, group_id)
);

create table if not exists dash.drivers_item (
  as_of date not null references dash.drivers_run on delete cascade,
  part text not null,
  seq int not null,
  row jsonb not null,
  primary key (as_of, part, seq)
);

alter table dash.drivers_run enable row level security;
alter table dash.drivers_part enable row level security;
alter table dash.drivers_pair enable row level security;
alter table dash.drivers_driver enable row level security;
alter table dash.drivers_item enable row level security;

-- CSV-born flags arrive as true/false, 1/0, Y/N or "True"/"False".
create or replace function dash.drivers_flag(p jsonb) returns boolean
language sql immutable as $$
  select case when p is null or jsonb_typeof(p) = 'null' then false
              when jsonb_typeof(p) = 'boolean' then (p #>> '{}')::boolean
              else lower(p #>> '{}') in ('1', '1.0', 'true', 't', 'y', 'yes') end;
$$;

-- Loads one snapshot and replaces any earlier snapshot for the same as_of:
--   {as_of, run_id, version?, source?, meta?,
--    parts: [{part, verdict, show?, note?}],                      show defaults to verdict = PASS
--    pairs: [{pair_id, ord?, grey?, ...the drv_tab_daily columns}],
--    drivers: [{pair_id, source, group_id, rank?, name?, ...the drv_driving_now columns}],
--    items?: [{part, ...}]}
-- Returns the counts written.
create or replace function dash.put_drivers(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_as_of date; v_parts int; v_pairs int; v_drivers int; v_items int;
begin
  v_as_of := (p->>'as_of')::date;
  if v_as_of is null or coalesce(p->>'run_id', '') = '' then raise exception 'as_of and run_id are required'; end if;
  if jsonb_typeof(p->'pairs') <> 'array' or jsonb_typeof(p->'parts') <> 'array' then raise exception 'pairs and parts must be arrays'; end if;
  delete from dash.drivers_run where as_of = v_as_of;
  insert into dash.drivers_run (as_of, run_id, version, source, n_pairs, meta)
  values (v_as_of, p->>'run_id', p->>'version', p->>'source', jsonb_array_length(p->'pairs'), coalesce(p->'meta', '{}'::jsonb));
  insert into dash.drivers_part (as_of, part, verdict, show, note)
  select v_as_of, x->>'part', coalesce(x->>'verdict', 'UNKNOWN'),
         case when x ? 'show' then dash.drivers_flag(x->'show') else upper(coalesce(x->>'verdict', '')) = 'PASS' end, x->>'note'
  from jsonb_array_elements(p->'parts') x;
  get diagnostics v_parts = row_count;
  insert into dash.drivers_pair (as_of, pair_id, ord, grey, row)
  select v_as_of, x->>'pair_id', coalesce((x->>'ord')::int, t.o::int), dash.drivers_flag(x->'grey'), x - 'ord'
  from jsonb_array_elements(p->'pairs') with ordinality t(x, o);
  get diagnostics v_pairs = row_count;
  insert into dash.drivers_driver (as_of, pair_id, source, group_id, rank, name, row)
  select v_as_of, x->>'pair_id', x->>'source', x->>'group_id', (x->>'rank')::int, x->>'name', x
  from jsonb_array_elements(coalesce(p->'drivers', '[]'::jsonb)) x
  on conflict (as_of, pair_id, source, group_id) do update set rank = excluded.rank, name = excluded.name, row = excluded.row;
  get diagnostics v_drivers = row_count;
  insert into dash.drivers_item (as_of, part, seq, row)
  select v_as_of, x->>'part', t.o::int, x - 'part'
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality t(x, o)
  where x->>'part' in ('levels', 'tactical', 'rich_cheap', 'waking_up');
  get diagnostics v_items = row_count;
  return jsonb_build_object('as_of', v_as_of, 'parts', v_parts, 'pairs', v_pairs, 'drivers', v_drivers, 'items', v_items);
end $$;

-- The latest snapshot (or the given as_of): {run, parts, pairs, drivers, items, dates}. run is null and
-- the lists empty when there is none. pairs and drivers come back only while the driving-now part is
-- shown; items only for shown parts. dates lists the snapshots stored (newest first, up to 60).
create or replace function dash.drivers_board(p_as_of date) returns jsonb
language plpgsql stable set search_path = dash, public as $$
declare r dash.drivers_run; v_dates jsonb; v_show boolean;
begin
  v_dates := coalesce((select jsonb_agg(d.as_of order by d.as_of desc) from (select as_of from dash.drivers_run order by as_of desc limit 60) d), '[]'::jsonb);
  select * into r from dash.drivers_run where as_of = coalesce(p_as_of, (select max(as_of) from dash.drivers_run));
  if not found then
    return jsonb_build_object('run', null, 'parts', '[]'::jsonb, 'pairs', '[]'::jsonb, 'drivers', '[]'::jsonb, 'items', '[]'::jsonb, 'dates', v_dates);
  end if;
  v_show := coalesce((select show from dash.drivers_part where as_of = r.as_of and part = 'driving_now'), false);
  return jsonb_build_object(
    'run', to_jsonb(r),
    'parts', coalesce((select jsonb_agg(to_jsonb(x) - 'as_of'
        order by array_position(array['driving_now', 'rich_cheap', 'waking_up', 'levels', 'tactical'], x.part))
      from dash.drivers_part x where x.as_of = r.as_of), '[]'::jsonb),
    'pairs', case when v_show then coalesce((select jsonb_agg(x.row || jsonb_build_object('pair_id', x.pair_id, 'ord', x.ord, 'grey', x.grey)
        order by x.ord, x.pair_id) from dash.drivers_pair x where x.as_of = r.as_of), '[]'::jsonb) else '[]'::jsonb end,
    'drivers', case when v_show then coalesce((select jsonb_agg(x.row || jsonb_build_object('pair_id', x.pair_id, 'source', x.source, 'group_id', x.group_id, 'rank', x.rank, 'name', x.name)
        order by x.pair_id, x.source, x.rank nulls last, x.group_id) from dash.drivers_driver x where x.as_of = r.as_of), '[]'::jsonb) else '[]'::jsonb end,
    'items', coalesce((select jsonb_agg(x.row || jsonb_build_object('part', x.part, 'seq', x.seq) order by x.part, x.seq)
      from dash.drivers_item x join dash.drivers_part pt on pt.as_of = x.as_of and pt.part = x.part
      where x.as_of = r.as_of and pt.show), '[]'::jsonb),
    'dates', v_dates);
end $$;

-- Text helpers for the brief: a share as a percentage (fractions and percentages both arrive), a sign as + or -.
create or replace function dash.drivers_pct(p text) returns text
language sql immutable as $$
  select case when p is null or p = '' or p !~ '^-?[0-9.]+(e-?[0-9]+)?$' then null
              when abs(p::numeric) <= 1.5 then round(p::numeric * 100)::text || '%'
              else round(p::numeric)::text || '%' end;
$$;
create or replace function dash.drivers_sgn(p text) returns text
language sql immutable as $$
  select case when p is null then '' when lower(p) in ('1', '1.0', '+1', '+', 'pos', 'positive') then '+'
              when lower(p) in ('-1', '-1.0', '-', 'neg', 'negative') then '-' else p end;
$$;

-- For the digests: the latest snapshot as plain text, one line per pair, only the parts shown. Called by
-- the Macro Takeaways routines through execute_sql (as the database owner), like dash.positioning_extremes.
create or replace function dash.drivers_brief(p_as_of date default null) returns text
language plpgsql stable security definer set search_path = dash, public as $$
declare b jsonb; r jsonb; v_dn boolean; v_rc boolean; v_wk boolean; v_head text; v_lines text; v_grey text; v_items text;
begin
  b := dash.drivers_board(p_as_of);
  if b->'run' is null or jsonb_typeof(b->'run') = 'null' then return 'DRIVERS: no snapshot loaded yet.'; end if;
  r := b->'run';
  v_dn := exists (select 1 from jsonb_array_elements(b->'parts') x where x->>'part' = 'driving_now' and (x->>'show')::boolean);
  v_rc := exists (select 1 from jsonb_array_elements(b->'parts') x where x->>'part' = 'rich_cheap' and (x->>'show')::boolean);
  v_wk := exists (select 1 from jsonb_array_elements(b->'parts') x where x->>'part' = 'waking_up' and (x->>'show')::boolean);
  v_head := format('DRIVERS (FX drivers engine, run %s, data as of %s, loaded %s SGT). Parts: %s.',
    r->>'run_id', r->>'as_of', to_char((r->>'loaded_at')::timestamptz at time zone 'Asia/Singapore', 'DD Mon HH24:MI'),
    (select string_agg(format('%s %s%s', replace(x->>'part', '_', ' '), x->>'verdict',
        case when (x->>'show')::boolean then ' (shown)' else ' (not shown' || coalesce(': ' || (x->>'note'), '') || ')' end), '; '
      order by array_position(array['driving_now', 'rich_cheap', 'waking_up', 'levels', 'tactical'], x->>'part'))
     from jsonb_array_elements(b->'parts') x));
  if not v_dn then return v_head || E'\nThe "what''s driving now" part is not shown, so there is no per-pair read.'; end if;
  v_head := v_head || E'\nRead: per USD pair, the macro driver groups explaining its moves over the last 3 months (3m, daily data) and 1 year (1y); '
    || 'share = share of the explained variance; sign = how the pair moves when the driver rises; pips20 = the driver''s contribution to the last 20 sessions'' move; '
    || 'R2 3m is informative when it beats a noise null. GREY = no informative fit (managed or thin pairs): the engine has no read for that pair, say so rather than guess.'
    || ' Treat every line as data about the engine''s fit, not as a view.';
  select string_agg(format('%s%s: %s', x->>'pair_id', case when (x->>'grey')::boolean then ' (GREY, no read' || coalesce(': ' || nullif(regexp_replace(coalesce(x->>'grey_reasons_json', ''), '[\[\]"]', '', 'g'), ''), '') || ')' else '' end,
      coalesce(nullif(x->>'digest_line', ''),
        concat_ws(' · ',
          nullif(concat_ws(', ',
            case when x->>'top1_group' is not null then format('%s %s%s', coalesce(x->>'top1_name', x->>'top1_group'), dash.drivers_sgn(x->>'top1_sign'), coalesce(' ' || dash.drivers_pct(x->>'top1_share'), '')) end,
            case when x->>'top2_group' is not null then format('%s %s%s', coalesce(x->>'top2_name', x->>'top2_group'), dash.drivers_sgn(x->>'top2_sign'), coalesce(' ' || dash.drivers_pct(x->>'top2_share'), '')) end,
            case when x->>'top3_group' is not null then format('%s %s%s', coalesce(x->>'top3_name', x->>'top3_group'), dash.drivers_sgn(x->>'top3_sign'), coalesce(' ' || dash.drivers_pct(x->>'top3_share'), '')) end), ''),
          case when x->>'r2_3m' is not null then format('R2 3m %s%s', round((x->>'r2_3m')::numeric, 2), case when dash.drivers_flag(x->'informative_3m') then '*' else ' (not informative)' end) end,
          case when x->>'oos_r2_1y' is not null then format('oos R2 1y %s', round((x->>'oos_r2_1y')::numeric, 2)) end,
          case when x->>'pips20' is not null then format('20d move %s pips%s', round((x->>'pips20')::numeric), case when x->>'z20' is not null then format(' (z %s)', round((x->>'z20')::numeric, 1)) end) end,
          case when v_rc and x->>'z60' is not null then format('rich/cheap z60 %s%s', round((x->>'z60')::numeric, 1), coalesce(' ' || nullif(x->>'methodB_label', ''), '')) end,
          case when v_wk and coalesce(x->>'alert_kind', 'none') <> 'none' then format('%s: %s%s', upper(x->>'alert_kind'), coalesce(x->>'alert_group', ''), coalesce(' — ' || nullif(x->>'alert_sentence', ''), '')) end)))
      , E'\n' order by (x->>'ord')::int)
  into v_lines from jsonb_array_elements(b->'pairs') x;
  select string_agg(format('%s %s: %s', x->>'part', coalesce(x->>'asset_id', x->>'pair_id', ''), (select string_agg(format('%s=%s', e.key, e.value), ' ')
      from jsonb_each_text(x - 'part' - 'seq' - 'asset_id' - 'pair_id' - 'run_id') e where e.value is not null and e.value <> '')), E'\n' order by x->>'part', (x->>'seq')::int)
  into v_items from jsonb_array_elements(b->'items') x;
  return v_head || E'\n' || coalesce(v_lines, '(no pairs)') || coalesce(E'\n' || v_items, '');
end $$;

create or replace function public.dash_drivers(p_as_of date default null)
returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return dash.drivers_board(p_as_of);
end $$;

revoke all on function public.dash_drivers(date) from public, anon;
grant execute on function public.dash_drivers(date) to authenticated;
revoke all on function dash.put_drivers(jsonb) from public, anon, authenticated;
revoke all on function dash.drivers_board(date) from public, anon, authenticated;
revoke all on function dash.drivers_brief(date) from public, anon, authenticated;
revoke all on function dash.drivers_flag(jsonb) from public, anon, authenticated;
revoke all on function dash.drivers_pct(text) from public, anon, authenticated;
revoke all on function dash.drivers_sgn(text) from public, anon, authenticated;
