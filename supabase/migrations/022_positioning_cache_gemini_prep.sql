-- 022 (28 Nov 2026)
-- (1) Positioning tab stuck on "Loading...": dash.pos_board() now takes ~10.6 s over msd.observations (518k rows)
--     and the app's role has an 8 s statement timeout, so dash_positioning() is cancelled. Fix: build the board
--     once an hour into dash.board_cache (pg_cron, no 8 s limit) and serve the cached copy; a live build only when
--     no cached copy exists yet.
-- (2) Gemini in the app: the Gemini Takeaways editions (Carbon, Neon, Pipeline Neon) are stored as feed family
--     'takeaways'; dash.enable_gemini_takeaways() adds the Gmail search for them to dash.config feeds (called by a
--     thread once the parser is deployed, so no email is collected before it can be read); dash.put_gemini_trades()
--     loads the Gemini book's closed history once (model 'gemini' only, existing rows never overwritten).

create table if not exists dash.board_cache (key text primary key, body jsonb not null, at timestamptz not null default now());
alter table dash.board_cache enable row level security;
revoke all on dash.board_cache from anon, authenticated;

create or replace function dash.refresh_pos_cache()
 returns text
 language plpgsql
 security definer
 set search_path to 'dash', 'public'
as $function$
declare b jsonb;
begin
  b := dash.pos_board();
  insert into dash.board_cache (key, body, at) values ('positioning', b, now())
    on conflict (key) do update set body = excluded.body, at = excluded.at;
  return 'positioning cached: ' || jsonb_array_length(b->'rows') || ' rows';
end $function$;
revoke all on function dash.refresh_pos_cache() from public, anon, authenticated;

create or replace function public.dash_positioning()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'dash', 'public'
as $function$
declare c jsonb;
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  select body into c from dash.board_cache where key = 'positioning';
  return coalesce(c, dash.pos_board());
end $function$;

select cron.unschedule('dash-pos-cache') where exists (select 1 from cron.job where jobname = 'dash-pos-cache');
select cron.schedule('dash-pos-cache', '25 * * * *', $$ select dash.refresh_pos_cache(); $$);
select dash.refresh_pos_cache();

alter table dash.feeds drop constraint if exists feeds_family_check;
alter table dash.feeds add constraint feeds_family_check
  check (family = any (array['youtube', 'podcast', 'grok', 'substack', 'takeaways']));

create or replace function dash.enable_gemini_takeaways()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'dash', 'public'
as $function$
declare v jsonb;
begin
  update dash.config c
     set value = c.value || jsonb_build_array(jsonb_build_object(
           'key', 'gemini_macro',
           'match', '^MACRO TAKEAWAYS \[(Gemini|Pipeline)',
           'query', (select e->>'query' from jsonb_array_elements(c.value) e where e->>'key' = 'macro')))
   where c.key = 'feeds' and not c.value @> '[{"key": "gemini_macro"}]'::jsonb;
  select value into v from dash.config where key = 'feeds';
  return v;
end $function$;
revoke all on function dash.enable_gemini_takeaways() from public, anon, authenticated;

create or replace function dash.put_gemini_trades(p jsonb)
 returns int
 language plpgsql
 security definer
 set search_path to 'dash', 'public'
as $function$
declare n int := 0; k int; r jsonb;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into dash.trades
      select (jsonb_populate_record(null::dash.trades, r || jsonb_build_object(
        'model', 'gemini', 'meta', coalesce(r->'meta', '{}'::jsonb),
        'first_seen', current_date, 'last_seen', current_date, 'updated_at', now()))).*
      on conflict (model, pid) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $function$;
revoke all on function dash.put_gemini_trades(jsonb) from public, anon, authenticated;
