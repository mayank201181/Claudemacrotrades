-- Hourly marks: pg_cron calls dash-mark through pg_net with the ingest token.
select cron.schedule('dash-mark-hourly', '7 * * * *', $$
  select net.http_post(
    url := 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-mark',
    body := jsonb_build_object('token', (select value #>> '{}' from dash.config where key = 'ingest_token')),
    timeout_milliseconds := 120000);
$$);
