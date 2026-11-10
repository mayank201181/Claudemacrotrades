-- 018: housekeeping from the 10 Nov 2026 project audit (applied to the database the same day).

-- (a) Email Digest subject lines can carry personal admin items, and the Substack tab prints the
-- subject in its header. Store a neutral subject for that family instead, now and on every ingest.
create or replace function dash.feeds_neutral_subject() returns trigger
language plpgsql set search_path = dash, public as $$
begin
  if new.family = 'substack' then new.subject := 'Email Digest — ' || to_char(new.d, 'DD Mon YYYY'); end if;
  return new;
end $$;
drop trigger if exists feeds_neutral_subject on dash.feeds;
create trigger feeds_neutral_subject before insert or update on dash.feeds
  for each row execute function dash.feeds_neutral_subject();
update dash.feeds set subject = subject where family = 'substack';

-- (b) pg_cron keeps every run in cron.job_run_details and never prunes it (64,000 rows by 10 Nov,
-- mostly the once-a-minute msd-dr-pump). Keep 14 days; prune weekly, Monday 03:17 SGT.
select cron.schedule('cron-run-log-prune', '17 19 * * 0',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);

-- (c) The TM1.1 trend shadow is retired: since 10 Nov 2026 the main run takes FX closes at 17:00 New
-- York itself (see supabase/functions/dash-trend/index.ts). dash.trend_shadow keeps its 25 runs.
select cron.unschedule('dash-trend-shadow-daily');
