-- 021: Trades tab stuck on "Loading..." (28 Nov 2026). dash.live_marks has a column named v (008 convexity),
-- so in dash_trades "to_jsonb(v)" resolved to that numeric column, not the row, once an option card (Fable P50,
-- first marked 27 Nov 21:00 UTC) got a non-null v: "cannot delete from scalar" and the whole RPC failed.
-- Fix: alias the row lm. Body otherwise identical to the live definition.
create or replace function public.dash_trades(p_model text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'dash', 'public'
as $function$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
                  'marks', (select coalesce(jsonb_agg(to_jsonb(m) - 'model' - 'pid' order by m.d), '[]') from dash.trade_marks m where m.model = t.model and m.pid = t.pid),
                  'log', (select coalesce(jsonb_agg(jsonb_build_object('d', l.d, 'text', l.text) order by l.d), '[]') from dash.trade_log l where l.model = t.model and l.ref = t.pid),
                  'live', (select to_jsonb(lm) - 'model' - 'pid' from dash.live_marks lm where lm.model = t.model and lm.pid = t.pid))
                order by t.pid desc), '[]') from dash.trades t where t.model = p_model),
    'tested', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
                  'outcome', (select to_jsonb(o) - 'model' - 'd' - 'idea' from dash.idea_outcomes o where o.model = x.model and o.d = x.d and o.idea = x.idea))
                order by x.d desc, x.seq), '[]') from dash.tested x where x.model = p_model),
    'book', (select to_jsonb(b) from dash.book_state b where b.model = p_model));
end $function$;
