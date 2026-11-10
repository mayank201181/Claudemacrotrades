with b as (
  select t.pid, t.status, coalesce(t.asset_class, '?') asset_class, coalesce(t.tclass, '?') tclass, t.direction, t.entry, t.stop, t.p, t.ev, t.result_r, t.meta, t.first_seen, l.r live_r,
    case when lower(coalesce(t.meta->>'crowd', '')) like 'with%' then 'with' when lower(coalesce(t.meta->>'crowd', '')) like 'against%' then 'against' else 'none' end crowd,
    (t.ref + f.cr * t.stop) / (1 + f.cr) fref
  from dash.trades t left join dash.live_marks l using (model, pid)
  cross join lateral (select case when abs(x.v) < 0.9 then x.v else 0 end cr
                      from (select coalesce(substring(t.meta->>'carry' from '=\s*([+-]?[0-9]*\.?[0-9]+)\s*R')::numeric, 0) v) x) f
  where t.model = 'fable' and t.tclass is distinct from 'convexity'),
t as (
  select b.*,
    case when entry is not null and stop is not null and fref <> stop then direction * (fref - entry) / abs(fref - stop) end used,
    case when result_r is null or meta ? 'risk' or entry is null or stop is null or fref = stop then result_r
         else result_r * abs(entry - stop) / abs(fref - stop) end r_plan
  from b),
c as (select * from t where status like 'closed%' and result_r is not null),
cut as (
  select 'asset class' cut, asset_class k, result_r, r_plan, p, status from c
  union all select 'crowd side', crowd, result_r, r_plan, p, status from c
  union all select 'class', tclass, result_r, r_plan, p, status from c
  union all select 'side', case when direction > 0 then 'long' else 'short' end, result_r, r_plan, p, status from c
  union all select 'edge', case when ev is null then '?' when ev < 0.3 then 'thin (EV under +0.3R)' else 'full (EV +0.3R or more)' end, result_r, r_plan, p, status from c
  union all select 'p at gate', coalesce(meta->>'pgate', '-'), result_r, r_plan, p, status from c
  union all select 'fill vs REF', case when used is null then '?' when used > 0.5 then '4 over half the stop distance gone'
      when used > 0.1 then '3 toward the stop, 10-50%' when used >= -0.1 then '2 within 10% of REF' else '1 moved toward the target' end, result_r, r_plan, p, status from c),
alt as (
  select substring(s.reason from '^alt (P[0-9]+)') pid, s.status, s.result_r from shadow.trades s where s.pipeline = 'fable' and s.reason like 'alt P%'),
altc as (
  select pid, count(*) n_alt, count(*) filter (where status like 'closed%') n_closed,
         avg(result_r) filter (where status like 'closed%') alt_avg, max(result_r) filter (where status like 'closed%') alt_best
  from alt where pid is not null group by 1),
tw as (select t.*, (meta->>'twin_state') ts, case when meta->>'twin_r' ~ '^[+-]?[0-9.]+$' then (meta->>'twin_r')::numeric end twin_r from t where meta ? 'twin')
select jsonb_build_object(
  'as_of', now(),
  'rule_status', (select jsonb_object_agg(rid, status) from dash.rules where rid in ('R17', 'R18', 'R19')),
  'cuts', (select jsonb_agg(jsonb_build_object('cut', cut, 'bucket', k, 'closed', n, 'wins', w, 'targets', tg, 'cum_r', cum, 'avg_r', av, 'cum_r_planned', cump, 'avg_p_stated', says) order by cut, k)
           from (select cut, k, count(*) n, count(*) filter (where result_r >= 0.1) w, count(*) filter (where status = 'closed-target') tg, round(sum(result_r), 2) cum, round(avg(result_r), 2) av,
                        round(sum(r_plan), 2) cump, round(avg(p)) says from cut group by 1, 2) g),
  'book', (select jsonb_build_object('cards', count(*), 'closed', count(*) filter (where status like 'closed%'), 'open', count(*) filter (where status = 'open'),
           'pending', count(*) filter (where status = 'pending'), 'missed', count(*) filter (where status = 'missed'), 'void', count(*) filter (where status = 'void'),
           'missed_or_void_last_28d', count(*) filter (where status in ('missed', 'void') and first_seen >= current_date - 28),
           'cards_last_28d', count(*) filter (where first_seen >= current_date - 28),
           'wins', count(*) filter (where status like 'closed%' and result_r >= 0.1), 'targets', count(*) filter (where status = 'closed-target'),
           'cum_r', round(sum(result_r) filter (where status like 'closed%'), 2), 'cum_r_planned', round(sum(r_plan) filter (where status like 'closed%'), 2)) from t),
  'thin_edge', (select jsonb_build_object('closed', count(*), 'wins', count(*) filter (where result_r >= 0.1), 'targets', count(*) filter (where status = 'closed-target'),
      'cum_r', round(sum(result_r), 2), 'cum_r_planned', round(sum(r_plan), 2)) from c where ev < 0.3),
  'card_vs_alternates', (select jsonb_build_object(
      'cards_with_alternates', count(*),
      'pairs_closed', count(*) filter (where t.status like 'closed%' and a.n_closed > 0),
      'card_cum_r', round(sum(t.result_r) filter (where t.status like 'closed%' and a.n_closed > 0), 2),
      'alternates_cum_avg_r', round(sum(a.alt_avg) filter (where t.status like 'closed%' and a.n_closed > 0), 2),
      'card_beat_alternates', count(*) filter (where t.status like 'closed%' and a.n_closed > 0 and t.result_r > a.alt_avg),
      'rows', coalesce(jsonb_agg(jsonb_build_object('pid', t.pid, 'status', t.status, 'card_r', round(coalesce(t.result_r, t.live_r), 2), 'alts', a.n_alt,
              'alts_closed', a.n_closed, 'alt_avg_r', round(a.alt_avg, 2), 'alt_best_r', round(a.alt_best, 2)) order by t.pid), '[]'))
    from altc a join t using (pid)),
  'views_with_no_card', (select jsonb_build_object('rows', count(*), 'closed', count(*) filter (where status like 'closed%'),
      'cum_r', round(sum(result_r) filter (where status like 'closed%'), 2)) from shadow.trades where pipeline = 'fable' and reason like 'alt none:%'),
  'twins', (select jsonb_build_object(
      'written', count(*), 'skipped', count(*) filter (where ts like 'skipped%'), 'running', count(*) filter (where ts = 'open'),
      'finished_pairs', count(*) filter (where status like 'closed%' and ts in ('touch', 'expiry', 'view')),
      'card_cum_r', round(sum(result_r) filter (where status like 'closed%' and ts in ('touch', 'expiry', 'view')), 2),
      'twin_cum_r', round(sum(twin_r) filter (where status like 'closed%' and ts in ('touch', 'expiry', 'view')), 2),
      'twin_beat_card', count(*) filter (where status like 'closed%' and ts in ('touch', 'expiry', 'view') and twin_r > result_r),
      'rows', coalesce(jsonb_agg(jsonb_build_object('pid', pid, 'card', status, 'card_r', round(coalesce(result_r, live_r), 2), 'twin', meta->>'twin_terms',
              'twin_state', ts, 'twin_r', twin_r, 'premium_pct', meta->>'twin_p0') order by pid), '[]')) from tw),
  'landings', (select jsonb_agg(jsonb_build_object('d', g.d::date, 'built_sgt', x.built, 'sent_sgt', to_char(x.sent_at at time zone 'Asia/Singapore', 'HH24:MI'),
      'late', x.sent_at is null or (x.sent_at at time zone 'Asia/Singapore')::time > time '08:15') order by g.d)
    from generate_series(current_date - 7, current_date, interval '1 day') g(d) left join dash.digests x on x.model = 'fable' and x.d = g.d::date)
) as cuts;
