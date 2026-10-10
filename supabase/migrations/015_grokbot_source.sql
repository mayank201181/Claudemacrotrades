-- Grok Bot console go-live (10 Oct 2026): a "Grok Bot — GROK FULL CONSOLIDATED — …" email is the Grok Bot
-- routine's console (docs/grok_console_routine.md), shown on the Grok tab as source 'grokbot' beside the
-- ChatGPT one while both run. Same rule as feedSource() in _shared/feeds.ts (PR #14), applied in the database
-- so it holds whichever dash-ingest version is deployed.
create or replace function dash.feeds_grokbot_source() returns trigger
language plpgsql as $$
begin
  if new.family = 'grok' and new.subject ~* 'Grok Bot' and new.subject !~* 'GROK CROWDING CHECK' then
    new.source := 'grokbot';
  end if;
  return new;
end $$;

drop trigger if exists feeds_grokbot_source on dash.feeds;
create trigger feeds_grokbot_source before insert or update on dash.feeds
  for each row execute function dash.feeds_grokbot_source();
