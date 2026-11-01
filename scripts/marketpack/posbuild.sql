-- Positioning build-up (read-only): every msd positioning series, its 3-year percentile now and the change
-- over 1 and 4 weeks (monthly series: 1 and 3 observations). Sorted by the size of the 4-week change.
with o as (
  select distinct on (series_id, as_of) series_id, as_of, value
  from msd.observations
  where position('.POS_' in series_id) > 0 and as_of >= current_date - 1200
  order by series_id, as_of, vintage_date desc nulls last
), s as (
  select o.*, coalesce(m.frequency, 'D') freq, m.name,
         row_number() over (partition by o.series_id order by as_of desc) rn,
         max(as_of) over (partition by o.series_id) last_d
  from o join msd.series m using (series_id)
), l as (select * from s where rn = 1 and last_d >= current_date - 75),
p as (
  select l.series_id, l.name, l.freq, l.as_of, l.value,
    (select value from s b where b.series_id = l.series_id and
       case when l.freq = 'M' then b.rn = 2 else b.as_of <= l.as_of - 6 end order by b.as_of desc limit 1) v1,
    (select value from s b where b.series_id = l.series_id and
       case when l.freq = 'M' then b.rn = 4 else b.as_of <= l.as_of - 27 end order by b.as_of desc limit 1) v4
  from l
), r as (
  select p.*,
    (select round(100.0 * avg((b.value <= p.value)::int)) from s b where b.series_id = p.series_id and b.as_of > p.as_of - 1096) pct,
    (select round(100.0 * avg((b.value <= p.v1)::int)) from s b where b.series_id = p.series_id and b.as_of > p.as_of - 1096) pct1,
    (select round(100.0 * avg((b.value <= p.v4)::int)) from s b where b.series_id = p.series_id and b.as_of > p.as_of - 1096) pct4
  from p
)
select count(*) as n, string_agg(format('%s | %s | %s | %s | pct %s | d1 %s | d4 %s',
         split_part(series_id, '.', 1), left(name, 60), freq, as_of, pct,
         coalesce((pct - pct1)::text, 'n/a'), coalesce((pct - pct4)::text, 'n/a')),
       chr(10) order by abs(coalesce(pct - pct4, 0)) desc) as build_up
from r;
