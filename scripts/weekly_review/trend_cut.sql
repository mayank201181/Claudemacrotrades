-- R21 trend cut for the weekly review: closed fable cards by trend bucket x class.
-- Until dash-ingest stores the `trend` META key, the bucket is computed here from dash.trend_state at the latest run on
-- or before the card's first_seen date, with the R10 proxy map and the R21 sign rule (bond futures flipped, yields not).
-- A card that carries the key uses the key. Read-only; run with execute_sql or in the SQL editor. Counts and R
-- aggregates only; never paste the per-card rows into the public repo.
with c as (
  select t.pid, t.tclass, t.direction, t.status, t.result_r, t.first_seen::date d, t.meta,
    case t.proxy
      when '^KS11' then 'KOSPI' when 'EWY' then 'KOSPI' when 'EWT' then 'TWSE' when 'FXI' then 'HSCEI'
      when 'ESZ26.CME' then 'SPX' when 'ESH27.CME' then 'SPX' when 'NQZ26.CME' then 'NDX' when 'NQH27.CME' then 'NDX'
      when 'EURUSD=X' then 'EURUSD' when 'IDR=X' then 'USDIDR' when 'INR=X' then 'USDINR' when 'JPY=X' then 'USDJPY'
      when 'KRW=X' then 'USDKRW' when 'CNH=X' then 'USDCNH' when 'GBPUSD=X' then 'GBPUSD' when 'AUDUSD=X' then 'AUDUSD'
      when 'GCZ26.CMX' then 'GOLD' when 'GCG27.CMX' then 'GOLD' when 'SIZ26.CMX' then 'SILVER' when 'SIH27.CMX' then 'SILVER'
      when 'NGZ26.NYM' then 'NATGAS' when 'NGF27.NYM' then 'NATGAS' when 'BZZ26.NYM' then 'BRENT' when 'BZF27.NYM' then 'BRENT'
      when 'CLZ26.NYM' then 'WTI' when 'CLF27.NYM' then 'WTI'
      when 'ZTZ26.CBT' then 'UST2Y' when 'ZTH27.CBT' then 'UST2Y' when 'ZFZ26.CBT' then 'UST5Y' when 'ZFH27.CBT' then 'UST5Y'
      when 'ZNZ26.CBT' then 'UST10Y' when 'ZNH27.CBT' then 'UST10Y' when 'ZBZ26.CBT' then 'UST30Y' when 'ZBH27.CBT' then 'UST30Y'
      when '^FVX' then 'UST5Y' when '^TNX' then 'UST10Y' when '^TYX' then 'UST30Y'
    end asset,
    case when t.proxy ~ '^Z[TFNB]' then -1 else 1 end sgn
  from dash.trades t
  where t.model = 'fable' and t.status like 'closed%' and t.result_r is not null),
k as (
  select c.*,
    case when c.meta->>'trend' ~ '^[+-]?[0-9]*\.?[0-9]+$' then (c.meta->>'trend')::numeric
         else (select c.direction * c.sgn * s.all_ens from dash.trend_state s
               where s.asset_id = c.asset and s.run_date <= c.d order by s.run_date desc limit 1) end trend
  from c),
b as (
  select *, case when trend is null then 'untagged' when trend >= 0.33 then 'with' when trend <= -0.33 then 'against' else 'flat' end bucket from k)
select bucket, coalesce(tclass, '?') tclass, count(*) n, count(*) filter (where result_r >= 0.1) wins,
       count(*) filter (where status = 'closed-target') targets, count(*) filter (where status = 'closed-stop') stops,
       round(sum(result_r), 2) cum_r, round(avg(result_r), 2) avg_r
from b group by 1, 2 order by 1, 2;
