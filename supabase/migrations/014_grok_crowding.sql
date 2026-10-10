-- Grok Bot weekly crowding check (docs/grok_crowding_routine.md) → Grok tab, source 'crowding'.
-- Copies the deployed grok query so it keeps the from:<owner> prefix that stays out of this repo.
update dash.config c set value = c.value || jsonb_build_array(jsonb_build_object(
  'key', 'grok_crowding',
  'query', replace(g->>'query', 'subject:"GROK FULL CONSOLIDATED"', 'subject:"GROK CROWDING CHECK"'),
  'match', 'GROK CROWDING CHECK'))
from (select e as g from dash.config, jsonb_array_elements(value) e where key = 'feeds' and e->>'key' = 'grok') s
where c.key = 'feeds'
  and not exists (select 1 from jsonb_array_elements(c.value) e where e->>'key' = 'grok_crowding');
