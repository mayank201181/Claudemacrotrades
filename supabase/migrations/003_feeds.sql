-- YouTube / Podcast / Grok / Substack tabs. The Apps Script feeder reads `feeds` (via dash-ingest
-- {kind:'config'}) to know which Gmail searches to run; adding a tab never changes the script.
-- The deployed config also prefixes every query with from:<owner address> (kept out of this repo).
create table if not exists dash.feeds (
  gmail_id text primary key,
  family text not null check (family in ('youtube','podcast','grok','substack')),
  source text not null,
  d date not null,
  subject text not null,
  sent_at timestamptz,
  intro text,
  sections jsonb not null default '[]',
  stances text,
  parsed_at timestamptz not null default now()
);
create index if not exists feeds_family_d on dash.feeds (family, d desc);
alter table dash.feeds enable row level security;

insert into dash.config(key, value) values ('feeds', '[
  {"key":"macro","query":"subject:\"MACRO TAKEAWAYS\"","match":"^MACRO TAKEAWAYS \\[(Fable|Opus)"},
  {"key":"youtube","query":"subject:\"YouTube Digest\"","match":"YouTube Digest"},
  {"key":"podcast","query":"subject:\"Podcast Digest\"","match":"Podcast Digest"},
  {"key":"grok","query":"subject:\"GROK FULL CONSOLIDATED\"","match":"GROK FULL CONSOLIDATED"},
  {"key":"email","query":"subject:\"Email Digest\" -subject:\"source alert\"","match":"Email Digest"}
]'::jsonb), ('backfill_since', '"2026/09/23"'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function public.dash_feed_index(p_family text) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'sources', sources) order by d desc), '[]')
          from (select d, jsonb_agg(distinct source) sources from dash.feeds where family = p_family group by d) x);
end $$;

create or replace function public.dash_feed(p_family text, p_d date) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(f) - 'stances' order by f.source, f.sent_at), '[]')
          from dash.feeds f where family = p_family and d = p_d);
end $$;

revoke all on function public.dash_feed_index(text) from public, anon;
revoke all on function public.dash_feed(text, date) from public, anon;
grant execute on function public.dash_feed_index(text) to authenticated;
grant execute on function public.dash_feed(text, date) to authenticated;
