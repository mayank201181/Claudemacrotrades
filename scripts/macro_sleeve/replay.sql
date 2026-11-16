-- Three-month replay of the views the Fable digest tested since 5 Oct 2026 (read-only).
with b0 as (
  select symbol, ts::date d, o, h, l, c, row_number() over (partition by symbol, ts::date order by ts desc) rn
  from dash.bars where interval = '1d' and ts >= '2026-07-01'),
b as (select symbol, d, o, h, l, c from b0 where rn = 1),
tr as (
  select *, greatest(h - l, abs(h - lag(c) over w), abs(l - lag(c) over w)) trng,
         row_number() over w bn
  from b window w as (partition by symbol order by d)),
atr as (
  select *, avg(trng) over (partition by symbol order by d rows between 20 preceding and 1 preceding) atr20,
         count(trng) over (partition by symbol order by d rows between 20 preceding and 1 preceding) natr
  from tr),
t as (
  select proxy, direction, d, verdict, idea,
         lag(d) over (partition by proxy, direction order by d, seq) prev_d
  from dash.tested where model = 'fable' and d >= '2026-10-05' and proxy is not null and direction in (-1, 1)),
ep as (  -- a view arrival: first test of (proxy, direction) after 15 quiet days
  select proxy, direction, d, min(idea) idea,
         bool_or(verdict = 'carded') carded, bool_or(verdict = 'covered') covered
  from t where prev_d is null or d - prev_d > 15 group by 1, 2, 3),
e as (
  select ep.*, a.d entry_d, a.c entry, a.atr20, a.bn entry_bn,
         a.c - ep.direction * 3 * a.atr20 stop, a.c + ep.direction * 6 * a.atr20 target
  from ep join lateral (select * from atr where symbol = ep.proxy and d >= ep.d and atr20 is not null and natr >= 15 order by d limit 1) a on true),
path as (
  select e.proxy, e.direction, e.d, p.bn - e.entry_bn k, p.d pd, p.h, p.l, p.c,
         case when (e.direction = 1 and p.h >= e.target) or (e.direction = -1 and p.l <= e.target) then 1 else 0 end tgt,
         case when (e.direction = 1 and p.c <= e.stop) or (e.direction = -1 and p.c >= e.stop) then 1 else 0 end stp,
         e.direction * (p.c - e.entry) / (3 * e.atr20) r
  from e join atr p on p.symbol = e.proxy and p.bn > e.entry_bn and p.bn <= e.entry_bn + 63),
res as (
  select e.*, 
    (select min(k) from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d and tgt = 1) k_tgt,
    (select min(k) from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d and stp = 1) k_stp,
    (select max(k) from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d) k_last,
    (select r from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d order by k desc limit 1) r_last,
    (select r from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d and k = 21) r21,
    (select r from path where path.proxy = e.proxy and path.direction = e.direction and path.d = e.d and k = 42) r42
  from e),
o as (
  select *, case when k_stp is not null and (k_tgt is null or k_stp <= k_tgt) then 'stop'
                 when k_tgt is not null then 'target'
                 when k_last >= 63 then 'expired' else 'open' end outcome,
         case when k_stp is not null and (k_tgt is null or k_stp <= k_tgt) then -1.0
              when k_tgt is not null then 2.0 else r_last end r_final,
         case when proxy ~ '=X$' then 'fx' when proxy ~ '^Z[TFNB]|^\^(TNX|TYX|FVX)|SR3|ZQ' then 'rates'
              when proxy ~ '^(GC|SI|HG|CL|BZ|NG|HO)' then 'commod' else 'equity' end ac,
         case when carded then 'carded' when covered then 'covered' else 'not carded' end tag
  from res)
select 'ALL' grp, count(*) n, count(*) filter (where outcome='target') targets, count(*) filter (where outcome='stop') stops,
       count(*) filter (where outcome='expired') expired, count(*) filter (where outcome='open') still_open,
       round(avg(r_final)::numeric, 2) avg_r, round(sum(r_final)::numeric, 1) sum_r,
       round(avg(r21)::numeric, 2) avg_r21, round(avg(r42)::numeric, 2) avg_r42,
       round(avg(k_last)::numeric, 0) avg_bars, round(100.0 * count(*) filter (where r_final > 0) / count(*), 0) pct_pos
from o
union all
select 'tag:' || tag, count(*), count(*) filter (where outcome='target'), count(*) filter (where outcome='stop'),
       count(*) filter (where outcome='expired'), count(*) filter (where outcome='open'),
       round(avg(r_final)::numeric, 2), round(sum(r_final)::numeric, 1), round(avg(r21)::numeric, 2), round(avg(r42)::numeric, 2),
       round(avg(k_last)::numeric, 0), round(100.0 * count(*) filter (where r_final > 0) / count(*), 0)
from o group by tag
union all
select 'ac:' || ac, count(*), count(*) filter (where outcome='target'), count(*) filter (where outcome='stop'),
       count(*) filter (where outcome='expired'), count(*) filter (where outcome='open'),
       round(avg(r_final)::numeric, 2), round(sum(r_final)::numeric, 1), round(avg(r21)::numeric, 2), round(avg(r42)::numeric, 2),
       round(avg(k_last)::numeric, 0), round(100.0 * count(*) filter (where r_final > 0) / count(*), 0)
from o group by ac
union all
select 'month:' || to_char(d, 'YYYY-MM'), count(*), count(*) filter (where outcome='target'), count(*) filter (where outcome='stop'),
       count(*) filter (where outcome='expired'), count(*) filter (where outcome='open'),
       round(avg(r_final)::numeric, 2), round(sum(r_final)::numeric, 1), round(avg(r21)::numeric, 2), round(avg(r42)::numeric, 2),
       round(avg(k_last)::numeric, 0), round(100.0 * count(*) filter (where r_final > 0) / count(*), 0)
from o group by to_char(d, 'YYYY-MM')
order by 1;
