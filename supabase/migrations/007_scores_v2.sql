-- Voices scoring, version 2 (replaces the grading, crowding and rules functions of 006, which were
-- never put in production). Changes, each from an adversarial review tested on a copy of the real data:
--   - one person, one voice: a curated alias table joins the two pipelines' spellings of a speaker;
--   - market calls and forecasts are graded apart: conviction-1 calls (a central-bank action forecast
--     scored on the 2y yield, or a market move implied by a stated mechanism) are "forecasts" and never
--     enter the market-call leaderboard or the crowd;
--   - conditional calls ("if X, then Y") and same-day two-sided views are kept for display but never
--     start an episode, never reach the leaderboard and never count in the crowd;
--   - episodes: a held view is graded at most once per 15 days (2-week grade) and once per 60 days
--     (2-month grade), counted from its first mention, so coverage cadence no longer decides the sample;
--   - horizons: days/weeks views are graded at 2 weeks, months/long views at 2 months, unstated at both;
--   - trend baseline and contrarian flag use only prices known before the view;
--   - the reference close must come within 14 days of the view; a change across a feed gap of more than
--     10 days is not a daily move; a feed silent for more than 6 days is "stale" and its calls are not "live";
--   - the crowd counts each voice once per market at its latest day in the window (net of same-day views),
--     its participation is a share of all active voices, ranked only against the market's own trailing
--     year once 60 such days exist; before that a one-sided crowd is flagged as one-sided, not extreme;
--   - entries logged more than 3 days after the view (or before the live ledger began on 16 Sep 2026)
--     are flagged "backfilled"; the leaderboard can include or exclude them;
--   - correlated calls (one view expressed on 2y and 10y yields the same day) count once on the
--     leaderboard, through series groups; every tie is broken by (date, entry, seq).

-- ---------- reference tables ----------
create table if not exists dash.voice_alias (
  speaker_id bigint primary key,
  voice_key text not null check (voice_key = lower(regexp_replace(btrim(voice_key), '\s+', ' ', 'g'))),
  note text
);
create table if not exists dash.series_meta (
  series_id text primary key,
  grp text,                       -- correlated series share a group and count once per voice-day-direction
  up_lbl text not null default 'up',
  dn_lbl text not null default 'down'
);
alter table dash.voice_alias enable row level security;
alter table dash.series_meta enable row level security;

-- The same person as spelled by the two pipelines (checked by hand; surname matches are NOT merged:
-- Barclays India is not Barclays commodities, joint pieces are not their lead author).
insert into dash.voice_alias (speaker_id, voice_key, note) values
  (774, 'barclays (commodities research)', 'opus "Barclays", affiliation commodities research'),
  (789, 'barclays (commodities research)', null),
  (512, 'christian, jeffrey', 'fable "Christian, Jeff"'),
  (485, 'christian, jeffrey', null),
  (424, 'dcp', null),
  (224, 'dcp', 'fable "DCP (rates trader)"'),
  (594, 'epb research', null),
  (231, 'epb research', 'fable "EPB Research (Eric Basmajian)"'),
  (580, 'intrator, michael', null),
  (619, 'intrator, michael', 'fable "Intrator, Mike"'),
  (821, 'jaishankar, subrahmanyam', 'fable "Jaishankar, S."'),
  (487, 'jaishankar, subrahmanyam', null),
  (592, 'karol', null),
  (637, 'karol', 'fable "Karol (Stray Reflections forum)"')
on conflict (speaker_id) do nothing;

-- Up/down wording per series (dir follows the quoted number: a higher yield, VIX or USDJPY is "up"), and
-- correlated series that count once per voice, day and direction on the leaderboard.
insert into dash.series_meta (series_id, grp, up_lbl, dn_lbl) values
  ('CM_BRENT.CLOSE', 'OIL', 'up', 'down'),
  ('CM_COPPER.CLOSE', null, 'up', 'down'),
  ('CM_DUBAI.CLOSE', 'OIL', 'up', 'down'),
  ('CM_GOLD.CLOSE', 'PM', 'up', 'down'),
  ('CM_GOLD.GVZ', null, 'vol ↑', 'vol ↓'),
  ('CM_HH.CLOSE', null, 'up', 'down'),
  ('CM_IRONORE.CLOSE', null, 'up', 'down'),
  ('CM_JKM.CLOSE', null, 'up', 'down'),
  ('CM_NEWCASTLE.CLOSE', null, 'up', 'down'),
  ('CM_SILVER.CLOSE', 'PM', 'up', 'down'),
  ('CM_TTF.CLOSE', null, 'up', 'down'),
  ('CM_WTI.CLOSE', 'OIL', 'up', 'down'),
  ('CM_WTI.OVX', null, 'vol ↑', 'vol ↓'),
  ('EQ_ASX200.CLOSE', null, 'up', 'down'),
  ('EQ_CSI300.CLOSE', 'CNEQ', 'up', 'down'),
  ('EQ_DAX.CLOSE', null, 'up', 'down'),
  ('EQ_FTSE.CLOSE', null, 'up', 'down'),
  ('EQ_HSI.CLOSE', 'CNEQ', 'up', 'down'),
  ('EQ_JCI.CLOSE', null, 'up', 'down'),
  ('EQ_KLCI.CLOSE', null, 'up', 'down'),
  ('EQ_KOSPI.CLOSE', null, 'up', 'down'),
  ('EQ_N225.CLOSE', 'JPEQ', 'up', 'down'),
  ('EQ_NDX.CLOSE', 'USEQ', 'up', 'down'),
  ('EQ_NIFTY.CLOSE', null, 'up', 'down'),
  ('EQ_PSEI.CLOSE', null, 'up', 'down'),
  ('EQ_SET.CLOSE', null, 'up', 'down'),
  ('EQ_SMI.CLOSE', null, 'up', 'down'),
  ('EQ_SPX.CLOSE', 'USEQ', 'up', 'down'),
  ('EQ_SPX.SOX', 'USEQ', 'up', 'down'),
  ('EQ_SPX.VIX', null, 'vol ↑', 'vol ↓'),
  ('EQ_STI.CLOSE', null, 'up', 'down'),
  ('EQ_SX5E.CLOSE', null, 'up', 'down'),
  ('EQ_TAIEX.CLOSE', null, 'up', 'down'),
  ('EQ_TOPIX.CLOSE', 'JPEQ', 'up', 'down'),
  ('EQ_TSX.CLOSE', null, 'up', 'down'),
  ('EQ_VNI.CLOSE', null, 'up', 'down'),
  ('FX_AUDUSD.CLOSE', null, 'AUD ↑', 'AUD ↓'),
  ('FX_EURUSD.CLOSE', null, 'EUR ↑', 'EUR ↓'),
  ('FX_GBPUSD.CLOSE', null, 'GBP ↑', 'GBP ↓'),
  ('FX_NZDUSD.CLOSE', null, 'NZD ↑', 'NZD ↓'),
  ('FX_USD.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDBRL.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDCAD.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDCHF.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDCNH.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDCNH.USDCNY', null, 'USD ↑', 'USD ↓'),
  ('FX_USDHKD.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDIDR.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDINR.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDJPY.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDKRW.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDMXN.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDMYR.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDNOK.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDPHP.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDSEK.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDSGD.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDTHB.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDTWD.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDVND.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('FX_USDZAR.CLOSE', null, 'USD ↑', 'USD ↓'),
  ('IT.BTP10', null, 'yields ↑', 'yields ↓'),
  ('RT_ACGB10.CLOSE', 'ACGB', 'yields ↑', 'yields ↓'),
  ('RT_ACGB3.CLOSE', 'ACGB', 'yields ↑', 'yields ↓'),
  ('RT_BTPBUND10.CLOSE', null, 'wider', 'tighter'),
  ('RT_BUND10.CLOSE', 'BUND', 'yields ↑', 'yields ↓'),
  ('RT_BUND10.S2S10', null, 'steeper', 'flatter'),
  ('RT_BUND2.CLOSE', 'BUND', 'yields ↑', 'yields ↓'),
  ('RT_CAN10.CLOSE', 'CAN', 'yields ↑', 'yields ↓'),
  ('RT_CAN2.CLOSE', 'CAN', 'yields ↑', 'yields ↓'),
  ('RT_CGB10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_GILT10.CLOSE', 'GILT', 'yields ↑', 'yields ↓'),
  ('RT_GILT2.CLOSE', 'GILT', 'yields ↑', 'yields ↓'),
  ('RT_IGB10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_INDOGB10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_JGB10.CLOSE', 'JGB', 'yields ↑', 'yields ↓'),
  ('RT_JGB10.S2S10', null, 'steeper', 'flatter'),
  ('RT_JGB2.CLOSE', 'JGB', 'yields ↑', 'yields ↓'),
  ('RT_JGB30.CLOSE', 'JGB', 'yields ↑', 'yields ↓'),
  ('RT_KTB10.CLOSE', 'KTB', 'yields ↑', 'yields ↓'),
  ('RT_KTB3.CLOSE', 'KTB', 'yields ↑', 'yields ↓'),
  ('RT_NORW10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_NZGB10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_SGS10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_SWED10.CLOSE', 'SWED', 'yields ↑', 'yields ↓'),
  ('RT_SWED2.CLOSE', 'SWED', 'yields ↑', 'yields ↓'),
  ('RT_SWISS10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_THAIGB10.CLOSE', null, 'yields ↑', 'yields ↓'),
  ('RT_UST10.ACM_TP10', null, 'term premium ↑', 'term premium ↓'),
  ('RT_UST10.BEI10', null, 'breakevens ↑', 'breakevens ↓'),
  ('RT_UST10.CLOSE', 'UST', 'yields ↑', 'yields ↓'),
  ('RT_UST10.POS_IV_1M', null, 'vol ↑', 'vol ↓'),
  ('RT_UST10.REAL10', 'UST', 'yields ↑', 'yields ↓'),
  ('RT_UST10.S2S10', null, 'steeper', 'flatter'),
  ('RT_UST2.CLOSE', 'UST', 'yields ↑', 'yields ↓'),
  ('RT_UST2.FF_STRIP', null, 'more hikes priced', 'fewer hikes priced'),
  ('RT_UST30.CLOSE', 'UST', 'yields ↑', 'yields ↓'),
  ('RT_UST5.CLOSE', 'UST', 'yields ↑', 'yields ↓')
on conflict (series_id) do nothing;

-- ---------- rebuilt output tables (both are fully rebuilt by refresh_scores) ----------
drop table if exists dash.stance_grades;
create table dash.stance_grades (
  entry_id bigint not null, seq smallint not null,
  pipeline text, voice text, name text, affiliation text, topic text, stance text, stance_date date,
  series_id text, grp text, dir smallint, conv smallint, tier text, cond boolean, hz text, instr text,
  retro boolean, conflicted boolean, episode_start boolean, episode_start42 boolean, repeats int,
  grade10 boolean, grade42 boolean,
  ref_d date, ref_v numeric, ref_lag int, sigma numeric, kind text, trend20 smallint, contrarian boolean,
  z10 numeric, z42 numeric, elapsed int, z_now numeric, last_d date, stale boolean,
  primary key (entry_id, seq)
);
create index stance_grades_series_date on dash.stance_grades (series_id, stance_date) include (voice, dir, tier, cond, conflicted);
create index stance_grades_voice on dash.stance_grades (voice);
alter table dash.stance_grades enable row level security;

drop table if exists dash.crowd_daily;
create table dash.crowd_daily (
  series_id text not null, d date not null,
  bulls int not null, bears int not null, voices int not null, one_sided numeric, voices30 int,
  tot int, share numeric, pct_hist numeric,
  one_sided_flag boolean not null default false, extreme boolean not null default false, fwd10_z numeric,
  fwd10_na boolean not null default false,   -- the 10th session has printed but the market has too little history to scale the move
  primary key (series_id, d)
);
alter table dash.crowd_daily enable row level security;

-- ---------- grading and crowding ----------
create or replace function dash.refresh_scores() returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare n_g int; n_c int; v_from date; v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  select least(coalesce(min(stance_date), v_today), v_today) - 150 into v_from from stance.entries;
  drop table if exists pg_temp._obs;
  create temp table _obs as
    select o.series_id, o.as_of d, o.value v,
           row_number() over (partition by o.series_id order by o.as_of) rn,
           case when coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') then 'diff' else 'log' end kind
    from (select distinct on (series_id, as_of) series_id, as_of, value from msd.observations
          where series_id in (select distinct series_id from dash.stance_calls where series_id is not null)
            and as_of >= v_from and value is not null
          order by series_id, as_of, vintage_date desc nulls last) o
    join msd.series s using (series_id)
    where coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') or o.value > 0;
  create index on _obs (series_id, rn);
  create index on _obs (series_id, d);
  drop table if exists pg_temp._chg;
  create temp table _chg as
    select a.series_id, a.rn, case a.kind when 'diff' then a.v - b.v else ln(a.v / b.v) end chg
    from _obs a join _obs b on b.series_id = a.series_id and b.rn = a.rn - 1
    where a.d - b.d <= 10;                 -- a jump across a feed gap is not a daily move
  create index on _chg (series_id, rn);

  delete from dash.stance_grades;
  insert into dash.stance_grades
  with calls as (
    select c.entry_id, c.seq, e.pipeline,
           coalesce(va.voice_key, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))) voice, s.name, s.affiliation,
           e.topic, e.stance, e.stance_date, c.series_id, coalesce(sm.grp, c.series_id) grp, c.dir,
           coalesce(c.conv, 2)::smallint conv, case when coalesce(c.conv, 2) >= 2 then 'market' else 'forecast' end tier,
           c.cond, coalesce(nullif(c.hz, ''), 'unstated') hz, c.instr,
           -- logged after the fact: before the live ledger (16 Sep 2026), or more than 3 days after the view
           -- (the 28 Sep migration from Drive carried real-time entries, so its own timestamp is not a lag)
           (e.stance_date < date '2026-09-16'
            or (e.created_at::date <> date '2026-09-28' and e.created_at::date - e.stance_date > 3)) retro
    from dash.stance_calls c join stance.entries e using (entry_id) join stance.speakers s on s.speaker_id = e.speaker_id
    left join dash.voice_alias va on va.speaker_id = s.speaker_id
    left join dash.series_meta sm on sm.series_id = c.series_id
    where c.series_id is not null),
  dedup as (   -- the same view logged by both pipelines (or twice in one entry) on the same day is one call
    select distinct on (voice, series_id, dir, stance_date) * from calls
    order by voice, series_id, dir, stance_date, cond, conv desc, entry_id, seq),
  conflict as (select voice, series_id, stance_date from dedup where not cond group by 1, 2, 3 having count(distinct dir) > 1),
  tagged as (
    select d.*, (not d.cond and exists (select 1 from conflict k
                 where k.voice = d.voice and k.series_id = d.series_id and k.stance_date = d.stance_date)) conflicted
    from dedup d),
  ep as (
    select t.*, lag(dir) over w prev_dir, lag(stance_date) over w prev_d
    from tagged t where not t.cond and not t.conflicted
    window w as (partition by voice, series_id, tier order by stance_date, entry_id, seq)),
  ep2 as (select *, (prev_dir is null or prev_dir <> dir or stance_date - prev_d > 14) chain_start from ep),
  ep3 as (select *, sum(chain_start::int) over (partition by voice, series_id, tier order by stance_date, entry_id, seq
                                               rows unbounded preceding) chain_no from ep2),
  ep4 as (select *, stance_date - min(stance_date) over (partition by voice, series_id, tier, chain_no) age from ep3),
  ep5 as (
    select *,
      row_number() over (partition by voice, series_id, tier, chain_no, age / 15 order by stance_date, entry_id, seq) = 1 episode_start,
      row_number() over (partition by voice, series_id, tier, chain_no, age / 60 order by stance_date, entry_id, seq) = 1 episode_start42,
      count(*) over (partition by voice, series_id, tier, chain_no, age / 15) repeats
    from ep4),
  allc as (
    select entry_id, seq, pipeline, voice, name, affiliation, topic, stance, stance_date, series_id, grp, dir, conv, tier, cond, hz, instr,
           retro, false conflicted, episode_start, episode_start42, repeats::int repeats from ep5
    union all
    select entry_id, seq, pipeline, voice, name, affiliation, topic, stance, stance_date, series_id, grp, dir, conv, tier, cond, hz, instr,
           retro, conflicted, false, false, 1 from tagged where cond or conflicted)
  select g.entry_id, g.seq, g.pipeline, g.voice, g.name, g.affiliation, g.topic, g.stance, g.stance_date,
         g.series_id, g.grp, g.dir, g.conv, g.tier, g.cond, g.hz, g.instr,
         g.retro, g.conflicted, g.episode_start, g.episode_start42, g.repeats,
         g.hz in ('days', 'weeks', 'unstated'), g.hz in ('weeks', 'months', 'long', 'unstated'),
         r.d, r.v, r.d - g.stance_date, sg.sigma, r.kind, tr.t20::smallint, (tr.t20 <> 0 and tr.t20 <> g.dir),
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f10.v - r.v else ln(f10.v / r.v) end) / (sg.sigma * sqrt(10)) end,
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f42.v - r.v else ln(f42.v / r.v) end) / (sg.sigma * sqrt(42)) end,
         (lt.rn - r.rn)::int,
         case when sg.sigma > 0 and lt.rn > r.rn then g.dir * (case r.kind when 'diff' then lt.v - r.v else ln(lt.v / r.v) end) / (sg.sigma * sqrt(lt.rn - r.rn)) end,
         lt.d, lt.d < v_today - 6
  from allc g
  -- reference: the first close after the view, if it comes within 14 days (longer means a feed gap)
  left join lateral (select * from _obs o where o.series_id = g.series_id and o.d > g.stance_date and o.d <= g.stance_date + 14
                     order by o.d limit 1) r on true
  left join lateral (select stddev_samp(chg) sigma, count(*) n from _chg c where c.series_id = g.series_id and c.rn between r.rn - 60 and r.rn - 1) sg0 on true
  left join lateral (select case when sg0.n >= 20 then sg0.sigma end sigma) sg on true
  -- prior trend: the 20-session change to the last close strictly before the view (nothing the speaker could not see)
  left join lateral (select sign(p.v - o.v) t20 from _obs p join _obs o on o.series_id = p.series_id and o.rn = p.rn - 20
                     where p.series_id = g.series_id and p.d < g.stance_date order by p.d desc limit 1) tr on true
  left join lateral (select v from _obs o where o.series_id = g.series_id and o.rn = r.rn + 10) f10 on true
  left join lateral (select v from _obs o where o.series_id = g.series_id and o.rn = r.rn + 42) f42 on true
  left join lateral (select rn, v, d from _obs o where o.series_id = g.series_id order by rn desc limit 1) lt on true;
  get diagnostics n_g = row_count;

  -- Crowd: market calls only (no forecasts, no conditional or two-sided views). Each voice counts once per
  -- market, on its latest day inside the 7-day window, netting that day's views.
  delete from dash.crowd_daily;
  insert into dash.crowd_daily (series_id, d, bulls, bears, voices, one_sided, voices30)
  with span as (select series_id, min(stance_date) a from dash.stance_grades
                where tier = 'market' and not cond and not conflicted group by 1),
  days as (select s.series_id, g::date d from span s, generate_series(s.a, v_today, interval '1 day') g)
  select dy.series_id, dy.d, x.bulls, x.bears, x.bulls + x.bears,
         case when x.bulls + x.bears > 0 then abs(x.bulls - x.bears)::numeric / (x.bulls + x.bears) end, y.v30
  from days dy
  cross join lateral (
    select count(*) filter (where nd > 0) bulls, count(*) filter (where nd < 0) bears from (
      select voice, sign(sum(dir)) nd from (
        select voice, dir, stance_date, max(stance_date) over (partition by voice) mx
        from dash.stance_grades g
        where g.series_id = dy.series_id and g.tier = 'market' and not g.cond and not g.conflicted
          and g.stance_date > dy.d - 7 and g.stance_date <= dy.d) z
      where stance_date = mx group by voice) n) x
  cross join lateral (
    select count(distinct voice) v30 from dash.stance_grades g
    where g.series_id = dy.series_id and g.tier = 'market' and not g.cond and not g.conflicted
      and g.stance_date > dy.d - 30 and g.stance_date <= dy.d) y;
  get diagnostics n_c = row_count;

  -- Participation as a share of every voice active that week (the ledger grows; raw counts would ramp),
  -- ranked against this market's own trailing year once it has 60 such days. Before that: no percentile.
  update dash.crowd_daily c set tot = t.n, share = case when t.n >= 20 then c.voices::numeric / t.n end
  from (select dy.d, (select count(distinct voice) from dash.stance_grades g
                      where g.tier = 'market' and not g.cond and not g.conflicted
                        and g.stance_date > dy.d - 7 and g.stance_date <= dy.d) n
        from (select distinct d from dash.crowd_daily) dy) t
  where t.d = c.d;
  update dash.crowd_daily c set pct_hist = x.p
  from (select s.series_id, s.d,
               (select case when count(*) >= 60 then avg((p.share < s.share)::int) end
                from dash.crowd_daily p
                where p.series_id = s.series_id and p.d < s.d and p.d >= s.d - 365 and p.share is not null) p
        from dash.crowd_daily s where s.voices > 0 and s.share is not null) x
  where c.series_id = x.series_id and c.d = x.d;
  update dash.crowd_daily set one_sided_flag = (voices >= 5 and one_sided >= 0.8),
                              extreme = coalesce(voices >= 5 and one_sided >= 0.8 and pct_hist >= 0.9, false);
  -- What followed a one-sided crowd: the next 10 sessions in its direction, in 10-session sigmas.
  update dash.crowd_daily c set fwd10_z = x.z, fwd10_na = x.z is null
  from (
    select c2.series_id, c2.d,
      case when sg.n >= 20 and sg.sigma > 0 then
        sign(c2.bulls - c2.bears) * (case r.kind when 'diff' then f.v - r.v else ln(f.v / r.v) end) / (sg.sigma * sqrt(10)) end z
    from dash.crowd_daily c2
    join lateral (select * from _obs o where o.series_id = c2.series_id and o.d > c2.d and o.d <= c2.d + 14 order by o.d limit 1) r on true
    join lateral (select v from _obs o where o.series_id = c2.series_id and o.rn = r.rn + 10) f on true
    join lateral (select stddev_samp(chg) sigma, count(*) n from _chg ch where ch.series_id = c2.series_id and ch.rn between r.rn - 60 and r.rn - 1) sg on true
    where c2.bulls <> c2.bears) x
  where c.series_id = x.series_id and c.d = x.d;
  return jsonb_build_object('grades', n_g, 'crowd_days', n_c);
end $$;

-- ---------- classifier writer ----------
-- p = {"version":"v1","by":"scorer","results":[{"id":123,"calls":[{"s":"RT_UST10.CLOSE","dir":-1,"conv":3,"cond":false,"hz":"weeks","instr":"long 10y","lvl":null}]}]}
-- One bad entry never sinks the batch: it is reported under "failed" and stays in the backlog for the next run.
create or replace function dash.put_stance_calls(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare r jsonb; c jsonb; i int; n_e int := 0; n_c int := 0; n_bad int := 0; n_skip int := 0; v_fail jsonb := '[]';
        sid text; known text[]; v_id bigint; v_dir smallint; v_conv smallint; v_cond boolean;
begin
  select array(select jsonb_array_elements_text(value)) into known from dash.config where key = 'call_series';
  if known is null or cardinality(known) = 0 then raise exception 'dash.config call_series is missing or empty'; end if;
  for r in select * from jsonb_array_elements(case jsonb_typeof(p->'results') when 'array' then p->'results' else '[]' end) loop
    begin
      if coalesce(r->>'id', '') !~ '^\d{1,18}$' then n_bad := n_bad + 1; continue; end if;
      v_id := (r->>'id')::bigint;
      if not exists (select 1 from stance.entries where entry_id = v_id) then n_bad := n_bad + 1; continue; end if;
      delete from dash.stance_calls where entry_id = v_id;
      i := 0;
      for c in select * from jsonb_array_elements(case jsonb_typeof(r->'calls') when 'array' then r->'calls' else '[]' end) loop
        v_dir := case when c->>'dir' ~ '^\s*[+-]?1(\.0+)?\s*$' then sign((c->>'dir')::numeric)::smallint end;
        if v_dir is null then
          if jsonb_typeof(c->'dir') is not null and jsonb_typeof(c->'dir') <> 'null' and c->>'dir' !~ '^\s*[+-]?0(\.0+)?\s*$' then
            raise exception 'unreadable dir %', c->'dir';   -- leave the entry unclassified so it is retried
          end if;
          n_skip := n_skip + 1; continue;
        end if;
        v_conv := case when c->>'conv' ~ '^\s*[123](\.0+)?\s*$' then round((c->>'conv')::numeric)::smallint end;
        v_cond := coalesce(lower(c->>'cond') in ('true', 't', 'yes', '1'), false);
        sid := nullif(btrim(c->>'s'), '');
        if sid is not null and not (sid = any(known)) then sid := null; end if;
        insert into dash.stance_calls (entry_id, seq, series_id, dir, conv, cond, hz, instr, lvl)
        values (v_id, i, sid, v_dir, v_conv, v_cond,
                case when lower(c->>'hz') in ('days', 'weeks', 'months', 'long', 'unstated') then lower(c->>'hz') else 'unstated' end,
                left(c->>'instr', 80),
                case when (c->>'lvl') ~ '^\s*-?\d+(\.\d+)?\s*$' then (c->>'lvl')::numeric end);
        i := i + 1; n_c := n_c + 1;
        exit when i >= 3;
      end loop;
      insert into dash.stance_class (entry_id, version, n_calls, classified_by, classified_at)
      values (v_id, coalesce(p->>'version', 'v1'), i, p->>'by', now())
      on conflict (entry_id) do update set version = excluded.version, n_calls = excluded.n_calls,
        classified_by = excluded.classified_by, classified_at = now();
      n_e := n_e + 1;
    exception when others then
      v_fail := v_fail || jsonb_build_object('id', r->'id', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('entries', n_e, 'calls', n_c, 'unknown_ids', n_bad, 'skipped_calls', n_skip, 'failed', v_fail);
end $$;

-- ---------- rules API ----------
create or replace function dash.rid_num(p_rid text) returns int language sql immutable as $$
  select (substring(p_rid from '^R(\d+)$'))::int
$$;

create or replace function dash.rules_in_force(p_pipeline text) returns text
language sql stable security definer set search_path = dash, public as $$
  select coalesce(string_agg(format(E'%s — %s (in force since %s)\n%s', rid, title,
           to_char(decided_at at time zone 'Asia/Singapore', 'DD Mon YYYY'), body), E'\n\n' order by dash.rid_num(rid) nulls last, rid), 'none')
  from dash.rules where status = 'in_force' and scope in ('both', p_pipeline);
$$;

create or replace function dash.propose_rule(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_rid text; v_n int; v_after timestamptz;
begin
  if coalesce(p->>'title', '') = '' or coalesce(p->>'body', '') = '' then raise exception 'title and body are required'; end if;
  if coalesce(p->>'scope', 'both') not in ('both', 'fable', 'opus') then raise exception 'scope must be both, fable or opus'; end if;
  if nullif(p->>'supersedes', '') is not null
     and not exists (select 1 from dash.rules where rid = upper(btrim(p->>'supersedes')) and status in ('proposed', 'in_force')) then
    raise exception 'supersedes % names no proposed or in-force rule', p->>'supersedes';
  end if;
  perform pg_advisory_xact_lock(hashtext('dash.rules.rid'));
  select coalesce(max(dash.rid_num(rid)), 0) + 1 into v_n from dash.rules;
  v_rid := 'R' || lpad(v_n::text, greatest(2, length(v_n::text)), '0');
  -- never earlier than the next Sunday 20:00 SGT that is at least 24 hours away: every proposal gets its objection window
  v_after := greatest(coalesce((p->>'apply_after')::timestamptz, dash.next_apply_window()), dash.next_apply_window());
  insert into dash.rules (rid, scope, title, body, rationale, evidence, revert_if, supersedes, review_due, apply_after, source)
  values (v_rid, coalesce(p->>'scope', 'both'), p->>'title', p->>'body', p->>'rationale', p->>'evidence', p->>'revert_if',
          upper(nullif(btrim(p->>'supersedes'), '')), (p->>'review_due')::date, v_after, coalesce(p->>'source', 'weekly-review'));
  return jsonb_build_object('rid', v_rid, 'apply_after', v_after);
end $$;

-- p = {"oppose": ["R03"], "withdraw": [], "revert": [], "note": "..."} (a single id as a string also works).
-- Records the owner's decisions, then puts every unopposed proposal whose window has passed in force.
create or replace function dash.decide_rules(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare v_applied text[]; v_opposed text[]; v_withdrawn text[]; v_reverted text[]; v_restored text[]; v_superseded text[];
        v_req text[]; v_unmatched text[];
begin
  create temp table if not exists _ids (k text, rid text) on commit drop;
  delete from _ids;
  insert into _ids
    select k, upper(btrim(x)) from unnest(array['oppose', 'withdraw', 'revert']) k,
      jsonb_array_elements_text(case jsonb_typeof(p->k) when 'array' then p->k when 'string' then jsonb_build_array(p->k) else '[]'::jsonb end) x;
  with u as (update dash.rules set status = 'opposed', decided_at = now(), decided_note = p->>'note'
    where status = 'proposed' and rid in (select rid from _ids where k = 'oppose') returning rid)
  select array_agg(rid) into v_opposed from u;
  with u as (update dash.rules set status = 'withdrawn', decided_at = now(), decided_note = p->>'note'
    where status = 'proposed' and rid in (select rid from _ids where k = 'withdraw') returning rid)
  select array_agg(rid) into v_withdrawn from u;
  with u as (update dash.rules set status = 'reverted', decided_at = now(), decided_note = p->>'note'
    where status = 'in_force' and rid in (select rid from _ids where k = 'revert') returning rid)
  select array_agg(rid) into v_reverted from u;
  -- reverting a rule that replaced another puts the one it replaced back in force
  with u as (update dash.rules o set status = 'in_force', decided_at = now(), decided_note = 'restored: ' || n.rid || ' reverted'
    from dash.rules n where n.rid = any(coalesce(v_reverted, '{}')) and n.supersedes = o.rid and o.status = 'superseded' returning o.rid)
  select array_agg(rid) into v_restored from u;
  with ap as (update dash.rules set status = 'in_force', decided_at = now()
    where status = 'proposed' and apply_after <= now() returning rid)
  select array_agg(rid) into v_applied from ap;
  with s as (update dash.rules o set status = 'superseded', decided_at = now(), decided_note = 'superseded by ' || n.rid
    from dash.rules n where n.status = 'in_force' and n.supersedes = o.rid and n.rid <> o.rid and o.status in ('in_force', 'proposed') returning o.rid)
  select array_agg(rid) into v_superseded from s;
  select array_agg(rid) into v_applied from dash.rules where rid = any(coalesce(v_applied, '{}')) and status = 'in_force';
  select array_agg(distinct rid) into v_req from _ids;
  select array_agg(x) into v_unmatched from unnest(coalesce(v_req, '{}')) x
    where x <> all(coalesce(v_opposed, '{}') || coalesce(v_withdrawn, '{}') || coalesce(v_reverted, '{}'));
  return jsonb_build_object(
    'applied', coalesce(to_jsonb(v_applied), '[]'), 'opposed', coalesce(to_jsonb(v_opposed), '[]'),
    'withdrawn', coalesce(to_jsonb(v_withdrawn), '[]'), 'reverted', coalesce(to_jsonb(v_reverted), '[]'),
    'restored', coalesce(to_jsonb(v_restored), '[]'), 'superseded', coalesce(to_jsonb(v_superseded), '[]'),
    'unmatched', coalesce(to_jsonb(v_unmatched), '[]'),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('rid', rid, 'title', title, 'apply_after', apply_after)
                order by dash.rid_num(rid) nulls last, rid), '[]') from dash.rules where status = 'proposed'));
end $$;

-- ---------- site RPCs ----------
-- p_scope: 'all' (default) or 'live' (only entries logged within 3 days of the view).
-- The 006 version took no argument; drop it so the site's no-argument call is not ambiguous.
drop function if exists public.dash_voices();
create or replace function public.dash_voices(p_scope text default 'all') returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
declare v_live boolean := coalesce(p_scope, 'all') = 'live';
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'scope', case when v_live then 'live' else 'all' end,
    'coverage', (select jsonb_build_object(
      'entries', (select count(*) from stance.entries),
      'classified', (select count(*) from dash.stance_class),
      'with_calls', (select count(*) from dash.stance_class where n_calls > 0),
      'calls', (select count(*) from dash.stance_calls),
      'scorable', (select count(*) from dash.stance_calls where series_id is not null),
      'mentions', count(*),
      'market', count(*) filter (where tier = 'market'),
      'forecasts', count(*) filter (where tier = 'forecast'),
      'conditional', count(*) filter (where cond),
      'conflicted', count(*) filter (where conflicted),
      'retro', count(*) filter (where retro),
      'episodes', count(*) filter (where tier = 'market' and episode_start and (not v_live or not retro)),
      'graded10', count(*) filter (where tier = 'market' and episode_start and grade10 and z10 is not null and (not v_live or not retro)),
      'graded42', count(*) filter (where tier = 'market' and episode_start42 and grade42 and z42 is not null and (not v_live or not retro)),
      'ungradable', count(*) filter (where episode_start and ref_d is not null and sigma is null),
      'hit10', round(avg((z10 > 0)::int) filter (where tier = 'market' and episode_start and grade10 and z10 is not null and (not v_live or not retro)), 3),
      'trend_hit10', round(avg((trend20 * dir * z10 > 0)::int) filter (where tier = 'market' and episode_start and grade10 and z10 is not null and trend20 <> 0 and (not v_live or not retro)), 3),
      'f_hit10', round(avg((z10 > 0)::int) filter (where tier = 'forecast' and episode_start and grade10 and z10 is not null and (not v_live or not retro)), 3),
      'f_graded10', count(*) filter (where tier = 'forecast' and episode_start and grade10 and z10 is not null and (not v_live or not retro)),
      'last_bar', max(last_d),
      'stale', (select coalesce(jsonb_agg(distinct series_id), '[]') from dash.stance_grades where stale))
      from dash.stance_grades),
    'leaders', (select coalesce(jsonb_agg(v), '[]') from (
        select jsonb_build_object('voice', voice, 'name', min(name), 'affiliation', min(affiliation),
          'calls', count(*) filter (where h = 10 and tier = 'market'),
          'live', count(*) filter (where h = 10 and tier = 'market' and z10 is null and z_now is not null and not stale),
          'live_z', round(avg(z_now) filter (where h = 10 and tier = 'market' and z10 is null and not stale), 2),
          'n10', count(*) filter (where h = 10 and tier = 'market' and grade10 and z10 is not null),
          'hit10', count(*) filter (where h = 10 and tier = 'market' and grade10 and z10 > 0),
          'avg_z10', round(avg(z10) filter (where h = 10 and tier = 'market' and grade10), 2),
          'trend_n10', count(*) filter (where h = 10 and tier = 'market' and grade10 and z10 is not null and trend20 <> 0),
          'trend_hit10', count(*) filter (where h = 10 and tier = 'market' and grade10 and trend20 * dir * z10 > 0),
          'clusters10', count(distinct (grp, date_trunc('week', ref_d))) filter (where h = 10 and tier = 'market' and grade10 and z10 is not null),
          'n42', count(*) filter (where h = 42 and tier = 'market' and grade42 and z42 is not null),
          'hit42', count(*) filter (where h = 42 and tier = 'market' and grade42 and z42 > 0),
          'avg_z42', round(avg(z42) filter (where h = 42 and tier = 'market' and grade42), 2),
          'contra_n', count(*) filter (where h = 10 and tier = 'market' and contrarian and grade10 and z10 is not null),
          'contra_hit', count(*) filter (where h = 10 and tier = 'market' and contrarian and grade10 and z10 > 0),
          'f_n10', count(*) filter (where h = 10 and tier = 'forecast' and grade10 and z10 is not null),
          'f_hit10', count(*) filter (where h = 10 and tier = 'forecast' and grade10 and z10 > 0),
          'retro', count(*) filter (where h = 10 and retro),
          'last', max(stance_date)) v
        from (
          -- one view expressed on several correlated series the same day counts once, separately for each horizon
          select 10 h, a.* from (
            select distinct on (g.voice, g.tier, g.grp, g.dir, g.stance_date) g.* from dash.stance_grades g
            where g.episode_start and (not v_live or not g.retro)
            order by g.voice, g.tier, g.grp, g.dir, g.stance_date, (g.z10 is null), g.entry_id, g.seq) a
          union all
          select 42 h, b.* from (
            select distinct on (g.voice, g.tier, g.grp, g.dir, g.stance_date) g.* from dash.stance_grades g
            where g.episode_start42 and (not v_live or not g.retro)
            order by g.voice, g.tier, g.grp, g.dir, g.stance_date, (g.z42 is null), g.entry_id, g.seq) b) u
        group by voice) l),
    'crowd', (select coalesce(jsonb_agg(jsonb_build_object('series', c.series_id, 'name', m.name, 'd', c.d, 'bulls', c.bulls, 'bears', c.bears,
          'voices', c.voices, 'voices30', c.voices30, 'one_sided', round(c.one_sided, 2), 'share', round(c.share, 3), 'tot', c.tot,
          'pct', round(c.pct_hist, 2), 'one_sided_flag', c.one_sided_flag, 'extreme', c.extreme,
          'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down'),
          'path', (select jsonb_agg(jsonb_build_array(gd::date, coalesce(p.bulls, 0), coalesce(p.bears, 0)) order by gd)
                   from generate_series(c.d - 29, c.d, interval '1 day') gd
                   left join dash.crowd_daily p on p.series_id = c.series_id and p.d = gd::date))
        order by c.voices desc, c.series_id), '[]')
      from dash.crowd_daily c left join msd.series m on m.series_id = c.series_id left join dash.series_meta sm on sm.series_id = c.series_id
      where c.d = (select max(d) from dash.crowd_daily) and c.voices30 > 0),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('series', e.series_id, 'name', m.name, 'd', e.d, 'bulls', e.bulls, 'bears', e.bears,
          'pct', round(e.pct_hist, 2), 'extreme', e.extreme, 'fwd10_z', round(e.fwd10_z, 2),
          'fwd_na', e.fwd10_na,
          'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down')) order by e.d desc), '[]')
      from (select c.*, lag(one_sided_flag) over (partition by series_id order by d) prev from dash.crowd_daily c) e
      left join msd.series m on m.series_id = e.series_id left join dash.series_meta sm on sm.series_id = e.series_id
      where e.one_sided_flag and e.prev is not true),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'topic', topic, 'voices', n) order by wk, topic), '[]') from (
        select date_trunc('week', e.stance_date)::date wk, e.topic,
               count(distinct coalesce(va.voice_key, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))) n
        from stance.entries e join stance.speakers s using (speaker_id) left join dash.voice_alias va on va.speaker_id = s.speaker_id
        where e.stance_date >= current_date - 70 group by 1, 2) a));
end $$;

create or replace function public.dash_voice(p_voice text) returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('d', g.stance_date, 'topic', g.topic, 'stance', g.stance, 'series', g.series_id,
            'name', m.name, 'dir', g.dir, 'conv', g.conv, 'tier', g.tier, 'cond', g.cond, 'conflicted', g.conflicted, 'retro', g.retro,
            'hz', g.hz, 'instr', g.instr, 'start', g.episode_start, 'start42', g.episode_start42, 'repeats', g.repeats,
            'grade10', g.grade10, 'grade42', g.grade42, 'ref_d', g.ref_d, 'ref_v', g.ref_v,
            'z10', round(g.z10, 2), 'z42', round(g.z42, 2), 'z_now', round(g.z_now, 2), 'elapsed', g.elapsed, 'stale', g.stale,
            'contrarian', g.contrarian, 'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down'))
            order by g.stance_date desc, g.entry_id desc, g.seq desc), '[]')
          from dash.stance_grades g left join msd.series m on m.series_id = g.series_id left join dash.series_meta sm on sm.series_id = g.series_id
          where g.voice = lower(regexp_replace(btrim(p_voice), '\s+', ' ', 'g')));
end $$;

create or replace function public.dash_review() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by dash.rid_num(r.rid) desc nulls last, r.rid desc), '[]') from dash.rules r),
    'lessons', (select coalesce(jsonb_agg(to_jsonb(l) order by l.wk desc), '[]') from dash.lessons l));
end $$;

revoke all on function public.dash_voices(text) from public, anon;
grant execute on function public.dash_voices(text) to authenticated;
revoke all on function public.dash_voice(text) from public, anon;
grant execute on function public.dash_voice(text) to authenticated;
revoke all on function public.dash_review() from public, anon;
grant execute on function public.dash_review() to authenticated;
revoke all on function dash.refresh_scores() from public, anon, authenticated;
revoke all on function dash.put_stance_calls(jsonb) from public, anon, authenticated;
revoke all on function dash.decide_rules(jsonb) from public, anon, authenticated;
revoke all on function dash.propose_rule(jsonb) from public, anon, authenticated;
revoke all on function dash.rules_in_force(text) from public, anon, authenticated;
