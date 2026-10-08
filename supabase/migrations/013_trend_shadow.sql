-- 013: the TM1.1 shadow of the Trend Monitor (D6 in supabase/functions/_shared/trend.ts). TM1 takes
-- Yahoo's daily FX bars, whose close for a date is about the 01:00 London price at the start of that
-- date, so at the 08:30 SGT run its FX spot is about a day old. TM1.1 takes each FX close at 17:00
-- New York instead (built from Yahoo's hourly bars, with Yahoo's daily bars re-dated to the previous
-- weekday before the hourly window), with TM1's rules and parameters otherwise unchanged. It runs
-- 10 minutes after TM1, for the 15 FX pairs only, and is stored here beside the TM1 run, never in
-- its tables, so the two can be compared before any switch. One row per run_date and version:
-- states, events and barriers as jsonb in the same shapes as dash.trend_state / trend_event /
-- trend_barrier.
create table if not exists dash.trend_shadow (
  run_date date not null,
  params_version text not null,
  run_utc timestamptz not null,
  status text not null check (status in ('OK', 'PARTIAL', 'NO_DATA')),
  n_assets int not null,
  n_ok int not null,
  n_stale int not null,
  n_suspect int not null,
  n_events int not null,
  last_bar_utc timestamptz,
  as_of jsonb not null default '{}',
  fetch_errors jsonb not null default '{}',
  params jsonb,
  states jsonb not null,
  events jsonb not null,
  barriers jsonb not null,
  report text not null,
  computed_at timestamptz not null default now(),
  primary key (run_date, params_version)
);
alter table dash.trend_shadow enable row level security;

-- The board now carries the shadow of the same run_date (null when there is none).
create or replace function dash.trend_board(p_run_date date)
returns jsonb
language plpgsql stable set search_path = dash, public as $$
declare r dash.trend_run;
begin
  select * into r from dash.trend_run where run_date = coalesce(p_run_date, (select max(run_date) from dash.trend_run));
  if not found then
    return jsonb_build_object('run', null, 'states', '[]'::jsonb, 'events', '[]'::jsonb, 'barriers', '[]'::jsonb,
      'hit_rates', dash.trend_hit_rates(null), 'shadow', null);
  end if;
  return jsonb_build_object(
    'run', to_jsonb(r) - 'params',
    'states', coalesce((select jsonb_agg(to_jsonb(s) - 'run_date' order by s.ord) from dash.trend_state s where s.run_date = r.run_date), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'run_date' order by e.seq) from dash.trend_event e where e.run_date = r.run_date), '[]'::jsonb),
    'barriers', coalesce((select jsonb_agg(to_jsonb(b) - 'run_date' order by s.ord, b.side desc, b.k)
      from dash.trend_barrier b join dash.trend_state s on s.run_date = b.run_date and s.asset_id = b.pair
      where b.run_date = r.run_date), '[]'::jsonb),
    'hit_rates', dash.trend_hit_rates(r.params),
    'shadow', (select to_jsonb(x) - 'params' from dash.trend_shadow x where x.run_date = r.run_date order by x.params_version desc limit 1));
end $$;
revoke all on function dash.trend_board(date) from public, anon, authenticated;

-- Daily at 00:40 UTC Tue-Sat, 10 minutes after dash-trend-daily.
select cron.schedule('dash-trend-shadow-daily', '40 0 * * 2-6', $$
  select net.http_post(
    url := 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-trend',
    body := jsonb_build_object('token', (select value #>> '{}' from dash.config where key = 'ingest_token'), 'shadow', 'TM1.1'),
    timeout_milliseconds := 400000);
$$);
