-- 010: Trend Monitor (monitor-v2, parameters TM1), written daily by the dash-trend edge function.
--
-- dash-trend fetches 8 years of daily data for the monitor's 38 assets, computes the run with
-- supabase/functions/_shared/trend.ts (the spec's sections 2-7 and the agreed deviations D1-D5
-- listed there) and stores it here, keyed by run_date (the Singapore date of the run, D5). A rerun
-- for the same run_date deletes the run row, whose children cascade, and inserts the new rows in one
-- transaction. Every computed number is stored unrounded (double precision); the spec's number
-- formats apply only to the text report kept in trend_run.report. NA is null.
--
--   trend_run      one row per run: the META line, as_of per class, per-asset fetch errors (failed
--                  downloads, fallback symbols used), the Params the run used, and the report text
--   trend_state    the STATE line per asset, plus ord (universe order) and px_dp (the asset's level decimals)
--   trend_event    the EVENT lines in event order (seq from 0); value and prev are numbers, except the
--                  value of DATA_SUSPECT / DATA_STALE, which is a date (value_date)
--   trend_barrier  the BARRIER lines of the FX barrier board (usable pairs only)
--   trend_px       the closes behind the states (Close, Adj Close for the commodity ETFs, or the yield in
--                  percent), up to each asset's last final bar; src = source:symbol
-- No policies: the service role writes, and the site reads only through public.dash_trend.

create table if not exists dash.trend_run (
  run_date date primary key,
  run_utc timestamptz not null,
  status text not null check (status in ('OK', 'PARTIAL', 'NO_DATA')),
  params_version text not null,
  n_assets int not null,
  n_ok int not null,
  n_stale int not null,
  n_suspect int not null,        -- SUSPECT plus REJECTED
  n_events int not null,
  last_bar_utc timestamptz,      -- the latest FX bar timestamp fetched; null = NA
  data_path text not null,       -- 'server' (D1)
  as_of jsonb not null default '{}',
  fetch_errors jsonb not null default '{}',
  params jsonb,
  report text not null,
  computed_at timestamptz not null default now()
);

create table if not exists dash.trend_state (
  run_date date not null references dash.trend_run on delete cascade,
  asset_id text not null,
  ord smallint not null,
  asset_class text not null check (asset_class in ('fx', 'rates', 'commodities', 'equities')),
  px_dp smallint not null,
  last_date date,
  bar_final text not null check (bar_final in ('Y', 'N')),
  status text not null check (status in ('OK', 'SUSPECT', 'REJECTED', 'STALE')),
  xcheck_move double precision,
  level double precision,        -- close, or the yield in percent for rates
  ma_ens double precision,
  ts_ens double precision,
  don_ens double precision,
  all_ens double precision,
  state text check (state in ('STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN')),
  prev_state text check (prev_state in ('STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN')),
  state_age int,
  ma_10_50 smallint, ma_20_100 smallint, ma_50_200 smallint,
  ts_21 smallint, ts_63 smallint, ts_126 smallint, ts_252 smallint,
  don_20 smallint, don_55 smallint, don_120 smallint, don_250 smallint,
  dist200_sig double precision,
  rv20 double precision,         -- percent a year; bp a year for rates
  rv60 double precision,
  rv20_pct3y double precision,
  rv20_pct_chg5d double precision,
  high_52w double precision,     -- levels; for rates they refer to the bond price, so high_52w is the lowest yield
  low_52w double precision,
  new_52w_high smallint,
  new_52w_low smallint,
  oos_hit21 double precision,
  primary key (run_date, asset_id)
);

create table if not exists dash.trend_event (
  run_date date not null references dash.trend_run on delete cascade,
  seq int not null,
  asset_id text not null,
  event_type text not null check (event_type in ('DATA_SUSPECT', 'DATA_STALE', 'STATE_CHANGE', 'MA_CROSS', 'TS_FLIP', 'DON_FLIP',
    'NEW_52W_HIGH', 'NEW_52W_LOW', 'VOL_HIGH', 'VOL_JUMP', 'STRETCH_UP', 'STRETCH_DN', 'STRETCH_END')),
  detail text,
  value double precision,
  value_date date,
  prev double precision,
  primary key (run_date, seq)
);

create table if not exists dash.trend_barrier (
  run_date date not null references dash.trend_run on delete cascade,
  pair text not null,
  k numeric not null,
  side text not null check (side in ('up', 'down')),
  last_date date,
  spot double precision,
  rv60 double precision,
  h smallint not null,
  barrier double precision,
  p_model double precision,
  vol_mult double precision,
  lookup_hit text not null check (lookup_hit in ('Y', 'N')),
  p_adj double precision,
  fair_per100 double precision,
  primary key (run_date, pair, k, side)
);

create table if not exists dash.trend_px (
  asset_id text not null,
  d date not null,
  value double precision not null,
  src text not null,
  fetched_at timestamptz not null default now(),
  primary key (asset_id, d)
);

alter table dash.trend_run enable row level security;
alter table dash.trend_state enable row level security;
alter table dash.trend_event enable row level security;
alter table dash.trend_barrier enable row level security;
alter table dash.trend_px enable row level security;

-- STATE_STATS as rows ({asset_class, state, hit21}) in class and state order.
create or replace function dash.trend_hit_rates(p_params jsonb)
returns jsonb
language sql stable set search_path = dash, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('asset_class', split_part(e.key, '|', 1), 'state', split_part(e.key, '|', 2), 'hit21', e.value)
    order by array_position(array['fx', 'rates', 'commodities', 'equities'], split_part(e.key, '|', 1)),
             array_position(array['STRONG_UP', 'UP', 'NEUTRAL', 'DOWN', 'STRONG_DOWN'], split_part(e.key, '|', 2))), '[]'::jsonb)
  from jsonb_each(coalesce(p_params, (select value from dash.config where key = 'trend_params')) -> 'state_stats') e
$$;

-- The latest run (or the given run_date): {run, states, events, barriers, hit_rates}. run is null and
-- the lists empty when there is no such run. hit_rates are the STATE_STATS the run used.
create or replace function dash.trend_board(p_run_date date)
returns jsonb
language plpgsql stable set search_path = dash, public as $$
declare r dash.trend_run;
begin
  select * into r from dash.trend_run where run_date = coalesce(p_run_date, (select max(run_date) from dash.trend_run));
  if not found then
    return jsonb_build_object('run', null, 'states', '[]'::jsonb, 'events', '[]'::jsonb, 'barriers', '[]'::jsonb,
      'hit_rates', dash.trend_hit_rates(null));
  end if;
  return jsonb_build_object(
    'run', to_jsonb(r) - 'params',
    'states', coalesce((select jsonb_agg(to_jsonb(s) - 'run_date' order by s.ord) from dash.trend_state s where s.run_date = r.run_date), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'run_date' order by e.seq) from dash.trend_event e where e.run_date = r.run_date), '[]'::jsonb),
    'barriers', coalesce((select jsonb_agg(to_jsonb(b) - 'run_date' order by s.ord, b.side desc, b.k)
      from dash.trend_barrier b join dash.trend_state s on s.run_date = b.run_date and s.asset_id = b.pair
      where b.run_date = r.run_date), '[]'::jsonb),
    'hit_rates', dash.trend_hit_rates(r.params));
end $$;

create or replace function public.dash_trend(p_run_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return dash.trend_board(p_run_date);
end $$;

revoke all on function public.dash_trend(date) from public, anon;
grant execute on function public.dash_trend(date) to authenticated;
revoke all on function dash.trend_board(date) from public, anon, authenticated;
revoke all on function dash.trend_hit_rates(jsonb) from public, anon, authenticated;

-- The TM1 parameters (section 1: STATE_STATS hit21 per class and state, NEUTRAL = NA; TOUCH_LOOKUP
-- vol_mult per group, k (2 dp) and side). dash-trend reads this key and falls back to the same
-- defaults in _shared/trend.ts; a new parameter set is a config change, kept here unless replaced.
insert into dash.config (key, value) values ('trend_params', $json$
{
  "params_version": "TM1",
  "state_stats": {
    "fx|STRONG_UP": 0.502,
    "fx|UP": 0.503,
    "fx|NEUTRAL": null,
    "fx|DOWN": 0.489,
    "fx|STRONG_DOWN": 0.488,
    "rates|STRONG_UP": 0.527,
    "rates|UP": 0.457,
    "rates|NEUTRAL": null,
    "rates|DOWN": 0.522,
    "rates|STRONG_DOWN": 0.571,
    "commodities|STRONG_UP": 0.520,
    "commodities|UP": 0.499,
    "commodities|NEUTRAL": null,
    "commodities|DOWN": 0.478,
    "commodities|STRONG_DOWN": 0.436,
    "equities|STRONG_UP": 0.591,
    "equities|UP": 0.610,
    "equities|NEUTRAL": null,
    "equities|DOWN": 0.439,
    "equities|STRONG_DOWN": 0.390
  },
  "touch_lookup": {
    "ASIA_HIGHCARRY|1.00|down": 1.00,
    "ASIA_HIGHCARRY|1.00|up": 1.00,
    "ASIA_HIGHCARRY|2.00|down": 1.00,
    "ASIA_HIGHCARRY|2.00|up": 1.00,
    "ASIA_MANAGED|1.00|down": 1.00,
    "ASIA_MANAGED|1.00|up": 1.00,
    "ASIA_MANAGED|2.00|down": 1.00,
    "ASIA_MANAGED|2.00|up": 1.15,
    "G10_USD|1.00|down": 1.00,
    "G10_USD|1.00|up": 1.00,
    "G10_USD|2.00|down": 1.15,
    "G10_USD|2.00|up": 1.00,
    "JPY_CROSS|1.00|down": 1.00,
    "JPY_CROSS|1.00|up": 1.00,
    "JPY_CROSS|2.00|down": 1.20,
    "JPY_CROSS|2.00|up": 1.00,
    "OTHER|1.00|down": 1.00,
    "OTHER|1.00|up": 1.00,
    "OTHER|2.00|down": 1.00,
    "OTHER|2.00|up": 1.00
  }
}
$json$::jsonb) on conflict (key) do nothing;

-- D4: Yahoo symbols tried in order per asset. Yahoo serves only the latest day for the CSI 300 index
-- (000300.SS and 399300.SZ both return one bar), so CSI300 is proxied by the largest CSI 300 ETF,
-- 510300.SS (Shanghai, same session and close). An asset without an entry uses the universe's own symbol.
insert into dash.config (key, value) values ('trend_symbols', '{"CSI300": ["510300.SS"]}'::jsonb)
on conflict (key) do nothing;

-- Daily at 00:30 UTC Tue-Sat (08:30 SGT, after the New York close of Mon-Fri; D5). The run takes a
-- few minutes; the function streams keep-alives, so pg_net waits up to 400 s.
select cron.schedule('dash-trend-daily', '30 0 * * 2-6', $$
  select net.http_post(
    url := 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-trend',
    body := jsonb_build_object('token', (select value #>> '{}' from dash.config where key = 'ingest_token')),
    timeout_milliseconds := 400000);
$$);
