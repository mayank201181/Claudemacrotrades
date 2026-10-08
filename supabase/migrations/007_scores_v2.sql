-- Voices scoring, version 2 (replaces the grading, crowding, rules and review-input functions of 006, which were
-- never put in production). Changes, each from an adversarial review tested on a copy of the real data:
--   - one person, one voice: a curated alias table joins the two pipelines' spellings of a speaker; pairs checked
--     and kept apart go in dash.voice_alias_reject, and dash.voice_alias_candidates() lists the near-matches
--     nobody has decided yet (refresh_scores returns their count, the Review tab lists them);
--   - market calls and forecasts are graded apart: conviction-1 calls (a central-bank action forecast scored on
--     the 2y yield, or a market move implied by a stated mechanism) are "forecasts" and never enter the
--     market-call leaderboard or the crowd; a call with no conviction recorded is "unrated" and is not ranked either;
--   - horizons: days/weeks views are graded at 2 weeks only, months/long views at 2 months only, unstated at both;
--   - conditional calls ("if X, then Y") and two-sided views (both directions on one market the same day, on
--     horizons that overlap) are kept for display but never start an episode, never reach the leaderboard and
--     never count in the crowd's sides;
--   - episodes follow a view per voice, tier, market group and direction: correlated series share a group, and a
--     series that moves against the group (VIX against equities) carries sign -1, so the view's direction is
--     dir x sign. Restating the view on any series of the group continues it; a grade is taken on the series of
--     the mention that starts it, one with a reference close and a scale when that day offers one. Starts are
--     chosen greedily in date order, each grade on its own clock and only among the mentions whose horizon it
--     grades: a 2-week grade when the view is first seen, when its direction changes, or 15+ days after the last
--     2-week start in that direction; a 2-month grade the same way, 60+ days after the last 2-month start (a
--     shorter silence does not restart it). A horizon-free clock (15 days) counts the calls. A day on which a voice
--     holds both directions inside one group (a curve or relative-value view) keeps the same clocks: a direction
--     the voice also held on its previous day continues, and only a direction it did not hold starts a call;
--   - "logged live" runs the same episode pass again over the entries that were not backfilled, so a backfilled
--     first mention never hides a live restatement; the crowd is built for both scopes too;
--   - trend baseline and contrarian flag use only prices known before the view;
--   - the reference close must come within 14 days of the view; a change across a feed gap of more than 10 days
--     is not a daily move; a feed silent for more than 6 days is "stale" and its calls are not "live"; a market
--     with fewer than 20 daily changes before the reference close cannot be scaled ("ungradable", short history);
--   - the crowd counts each voice once per market at its latest day in the window; a latest day holding both
--     directions (two-sided, or a short and a long view that disagree) counts on neither side. One-sided is the
--     majority share; 5+ voices with 80%+ on one side is ONE-SIDED, at any history. Participation is a share of
--     all active voices (20+ needed), ranked against the market's own trailing year once 60 such days exist;
--     EXTREME is a one-sided crowd whose participation is in that year's top decile;
--   - entries logged more than 3 days after the view (or before the live ledger began on 16 Sep 2026) are
--     "backfilled", except that the 28 Sep 2026 migration from Drive counts as live; every Voices figure except
--     attention can include or exclude them;
--   - the leaderboard and the headline count from the same sets, in which one view on several series of a group
--     the same day counts once; independent clusters (market group x week of the reference close) are shown
--     next to n and drive the site's minimum-sample filter and shrinkage. Within a day a gradable series comes
--     first, and every other tie is broken by (date, entry, seq);
--   - rules: a proposal replaced before it went in force is withdrawn, never superseded, so reverting its
--     successor restores only a rule that was in force;
--   - the weekly review reads the same voices and crowd figures, and trade aggregates split linear from convexity.

-- ---------- reference tables ----------
create table if not exists dash.voice_alias (
  speaker_id bigint primary key,
  voice_key text not null check (voice_key = lower(regexp_replace(btrim(voice_key), '\s+', ' ', 'g'))),
  note text
);
-- Cross-pipeline near-matches checked by hand and kept apart (speaker_a < speaker_b).
create table if not exists dash.voice_alias_reject (
  speaker_a bigint not null, speaker_b bigint not null, note text,
  primary key (speaker_a, speaker_b), check (speaker_a < speaker_b)
);
create table if not exists dash.series_meta (
  series_id text primary key,
  grp text,                       -- series that are the same bet share a group: one view, one call
  sign smallint not null default 1 check (sign in (-1, 1)),   -- -1: the series moves against its group
  up_lbl text not null default 'up',
  dn_lbl text not null default 'down'
);
alter table dash.series_meta add column if not exists sign smallint not null default 1 check (sign in (-1, 1));
alter table dash.voice_alias enable row level security;
alter table dash.voice_alias_reject enable row level security;
alter table dash.series_meta enable row level security;

-- The same person (or house) as spelled by the two pipelines, checked by hand against the names, affiliations
-- and pieces. Surname matches are not merged: joint pieces are not their co-authors, a house is not one analyst.
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
  (637, 'karol', 'fable "Karol (Stray Reflections forum)"'),
  (368, 'thornton, thomas', null),
  (556, 'thornton, thomas', 'fable "Hedge Fund Telemetry (Thomas Thornton)", same affiliation'),
  (116, 'kao, michael', null),
  (717, 'kao, michael', 'opus "Urban Kaoboy", his handle'),
  (497, 'wu silverman, amy', null),
  (524, 'wu silverman, amy', 'fable "Silverman, Amy Wu", same affiliation'),
  (186, 'doubleline (house)', 'house view in both pipelines (the same pieces on the same days)'),
  (227, 'doubleline (house)', null),
  (720, 'standard chartered (house)', 'house view in both pipelines (the same call on the same day)'),
  (754, 'standard chartered (house)', null)
on conflict (speaker_id) do update set voice_key = excluded.voice_key, note = excluded.note;

insert into dash.voice_alias_reject (speaker_a, speaker_b, note) values
  (89, 770, 'the podcast as a house is not one of its hosts'),
  (702, 774, 'different Barclays teams (India economics, commodities research)'),
  (100, 436, 'house-channel pieces filed under an unnamed house analyst; not clearly the founder''s own words, so kept apart'),
  (229, 422, 'joint piece, not its co-author alone'),
  (229, 423, 'joint piece, not its co-author alone'),
  (648, 673, 'agency piece with two authors, not one of them alone'),
  (128, 149, 'joint piece, not its co-author alone'),
  (67, 133, 'joint piece, not its co-author alone'),
  (133, 150, 'joint piece, not its co-author alone'),
  (134, 426, 'joint piece, not its co-author alone')
on conflict (speaker_a, speaker_b) do update set note = excluded.note;

-- Up/down wording per series (dir follows the quoted number: a higher yield, VIX or USDJPY is "up"), and the
-- groups of series that are the same bet. Only genuine equivalents are grouped: yields along one curve with the
-- Fed-funds strip, one equity market's indices (with the VIX inverted), the oil benchmarks, gold with silver,
-- offshore with onshore yuan. Ungrouped series stand alone.
insert into dash.series_meta (series_id, grp, sign, up_lbl, dn_lbl) values
  ('CM_BRENT.CLOSE', 'OIL', 1, 'up', 'down'),
  ('CM_COPPER.CLOSE', null, 1, 'up', 'down'),
  ('CM_DUBAI.CLOSE', 'OIL', 1, 'up', 'down'),
  ('CM_GOLD.CLOSE', 'PM', 1, 'up', 'down'),
  ('CM_GOLD.GVZ', null, 1, 'vol ↑', 'vol ↓'),
  ('CM_HH.CLOSE', null, 1, 'up', 'down'),
  ('CM_IRONORE.CLOSE', null, 1, 'up', 'down'),
  ('CM_JKM.CLOSE', null, 1, 'up', 'down'),
  ('CM_NEWCASTLE.CLOSE', null, 1, 'up', 'down'),
  ('CM_SILVER.CLOSE', 'PM', 1, 'up', 'down'),
  ('CM_TTF.CLOSE', null, 1, 'up', 'down'),
  ('CM_WTI.CLOSE', 'OIL', 1, 'up', 'down'),
  ('CM_WTI.OVX', null, 1, 'vol ↑', 'vol ↓'),
  ('EQ_ASX200.CLOSE', null, 1, 'up', 'down'),
  ('EQ_CSI300.CLOSE', 'CNEQ', 1, 'up', 'down'),
  ('EQ_DAX.CLOSE', null, 1, 'up', 'down'),
  ('EQ_FTSE.CLOSE', null, 1, 'up', 'down'),
  ('EQ_HSI.CLOSE', 'CNEQ', 1, 'up', 'down'),
  ('EQ_JCI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_KLCI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_KOSPI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_N225.CLOSE', 'JPEQ', 1, 'up', 'down'),
  ('EQ_NDX.CLOSE', 'USEQ', 1, 'up', 'down'),
  ('EQ_NIFTY.CLOSE', null, 1, 'up', 'down'),
  ('EQ_PSEI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_SET.CLOSE', null, 1, 'up', 'down'),
  ('EQ_SMI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_SPX.CLOSE', 'USEQ', 1, 'up', 'down'),
  ('EQ_SPX.SOX', 'USEQ', 1, 'up', 'down'),
  ('EQ_SPX.VIX', 'USEQ', -1, 'vol ↑', 'vol ↓'),
  ('EQ_STI.CLOSE', null, 1, 'up', 'down'),
  ('EQ_SX5E.CLOSE', null, 1, 'up', 'down'),
  ('EQ_TAIEX.CLOSE', null, 1, 'up', 'down'),
  ('EQ_TOPIX.CLOSE', 'JPEQ', 1, 'up', 'down'),
  ('EQ_TSX.CLOSE', null, 1, 'up', 'down'),
  ('EQ_VNI.CLOSE', null, 1, 'up', 'down'),
  ('FX_AUDUSD.CLOSE', null, 1, 'AUD ↑', 'AUD ↓'),
  ('FX_EURUSD.CLOSE', null, 1, 'EUR ↑', 'EUR ↓'),
  ('FX_GBPUSD.CLOSE', null, 1, 'GBP ↑', 'GBP ↓'),
  ('FX_NZDUSD.CLOSE', null, 1, 'NZD ↑', 'NZD ↓'),
  ('FX_USD.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDBRL.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDCAD.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDCHF.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDCNH.CLOSE', 'CNH', 1, 'USD ↑', 'USD ↓'),
  ('FX_USDCNH.USDCNY', 'CNH', 1, 'USD ↑', 'USD ↓'),
  ('FX_USDHKD.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDIDR.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDINR.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDJPY.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDKRW.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDMXN.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDMYR.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDNOK.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDPHP.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDSEK.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDSGD.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDTHB.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDTWD.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDVND.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('FX_USDZAR.CLOSE', null, 1, 'USD ↑', 'USD ↓'),
  ('IT.BTP10', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_ACGB10.CLOSE', 'ACGB', 1, 'yields ↑', 'yields ↓'),
  ('RT_ACGB3.CLOSE', 'ACGB', 1, 'yields ↑', 'yields ↓'),
  ('RT_BTPBUND10.CLOSE', null, 1, 'wider', 'tighter'),
  ('RT_BUND10.CLOSE', 'BUND', 1, 'yields ↑', 'yields ↓'),
  ('RT_BUND10.S2S10', null, 1, 'steeper', 'flatter'),
  ('RT_BUND2.CLOSE', 'BUND', 1, 'yields ↑', 'yields ↓'),
  ('RT_CAN10.CLOSE', 'CAN', 1, 'yields ↑', 'yields ↓'),
  ('RT_CAN2.CLOSE', 'CAN', 1, 'yields ↑', 'yields ↓'),
  ('RT_CGB10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_GILT10.CLOSE', 'GILT', 1, 'yields ↑', 'yields ↓'),
  ('RT_GILT2.CLOSE', 'GILT', 1, 'yields ↑', 'yields ↓'),
  ('RT_IGB10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_INDOGB10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_JGB10.CLOSE', 'JGB', 1, 'yields ↑', 'yields ↓'),
  ('RT_JGB10.S2S10', null, 1, 'steeper', 'flatter'),
  ('RT_JGB2.CLOSE', 'JGB', 1, 'yields ↑', 'yields ↓'),
  ('RT_JGB30.CLOSE', 'JGB', 1, 'yields ↑', 'yields ↓'),
  ('RT_KTB10.CLOSE', 'KTB', 1, 'yields ↑', 'yields ↓'),
  ('RT_KTB3.CLOSE', 'KTB', 1, 'yields ↑', 'yields ↓'),
  ('RT_NORW10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_NZGB10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_SGS10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_SWED10.CLOSE', 'SWED', 1, 'yields ↑', 'yields ↓'),
  ('RT_SWED2.CLOSE', 'SWED', 1, 'yields ↑', 'yields ↓'),
  ('RT_SWISS10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_THAIGB10.CLOSE', null, 1, 'yields ↑', 'yields ↓'),
  ('RT_UST10.ACM_TP10', null, 1, 'term premium ↑', 'term premium ↓'),
  ('RT_UST10.BEI10', null, 1, 'breakevens ↑', 'breakevens ↓'),
  ('RT_UST10.CLOSE', 'UST', 1, 'yields ↑', 'yields ↓'),
  ('RT_UST10.POS_IV_1M', null, 1, 'vol ↑', 'vol ↓'),
  ('RT_UST10.REAL10', 'UST', 1, 'yields ↑', 'yields ↓'),
  ('RT_UST10.S2S10', null, 1, 'steeper', 'flatter'),
  ('RT_UST2.CLOSE', 'UST', 1, 'yields ↑', 'yields ↓'),
  ('RT_UST2.FF_STRIP', 'UST', 1, 'more hikes priced', 'fewer hikes priced'),
  ('RT_UST30.CLOSE', 'UST', 1, 'yields ↑', 'yields ↓'),
  ('RT_UST5.CLOSE', 'UST', 1, 'yields ↑', 'yields ↓')
on conflict (series_id) do update set grp = excluded.grp, sign = excluded.sign, up_lbl = excluded.up_lbl, dn_lbl = excluded.dn_lbl;

-- Speakers of the two pipelines that look like one person (same affiliation and a shared surname, or one name or
-- handle inside the other) but share no voice key and have not been rejected. Each pair is for a hand decision:
-- an alias row if it is the same voice, a reject row if not.
create or replace function dash.voice_alias_candidates()
returns table (speaker_a bigint, name_a text, affiliation_a text, speaker_b bigint, name_b text, affiliation_b text)
language sql stable set search_path = dash, public as $$
  with sp as (
    select s.speaker_id, s.pipeline, s.name, s.affiliation,
           coalesce(va.voice_key, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))) vkey,
           ' ' || btrim(regexp_replace(lower(s.name), '[^a-z0-9]+', ' ', 'g')) || ' ' w,
           nullif(btrim(regexp_replace(lower(s.name), '[^a-z0-9]+', ' ', 'g')), '') full_w,
           -- the surname (before the comma) or, for a house, the name before any bracket
           nullif(btrim(regexp_replace(lower(split_part(regexp_replace(s.name, '\s*\(.*$', ''), ',', 1)), '[^a-z0-9]+', ' ', 'g')), '') sur,
           nullif(btrim(regexp_replace(lower(regexp_replace(s.name, '\s*\(.*$', '')), '[^a-z0-9]+', ' ', 'g')), '') base,
           nullif(btrim(regexp_replace(lower(substring(s.name from '\(([^)]*)\)')), '[^a-z0-9]+', ' ', 'g')), '') par,
           lower(btrim(s.affiliation)) aff
    from stance.speakers s left join dash.voice_alias va using (speaker_id)
    where exists (select 1 from stance.entries e where e.speaker_id = s.speaker_id))
  select least(a.speaker_id, b.speaker_id), case when a.speaker_id < b.speaker_id then a.name else b.name end,
         case when a.speaker_id < b.speaker_id then a.affiliation else b.affiliation end,
         greatest(a.speaker_id, b.speaker_id), case when a.speaker_id < b.speaker_id then b.name else a.name end,
         case when a.speaker_id < b.speaker_id then b.affiliation else a.affiliation end
  from sp a join sp b on a.pipeline < b.pipeline and a.vkey <> b.vkey
  where ((a.aff = b.aff and (strpos(b.w, ' ' || a.sur || ' ') > 0 or strpos(a.w, ' ' || b.sur || ' ') > 0))
         or strpos(b.w, ' ' || a.full_w || ' ') > 0 or strpos(a.w, ' ' || b.full_w || ' ') > 0
         or a.par in (b.full_w, b.base) or b.par in (a.full_w, a.base))
    and not exists (select 1 from dash.voice_alias_reject j
                    where j.speaker_a = least(a.speaker_id, b.speaker_id) and j.speaker_b = greatest(a.speaker_id, b.speaker_id))
  order by 1, 4
$$;

-- ---------- rebuilt output tables (both are fully rebuilt by refresh_scores) ----------
drop table if exists dash.stance_grades;
create table dash.stance_grades (
  entry_id bigint not null, seq smallint not null,
  pipeline text, voice text, name text, affiliation text, topic text, stance text, stance_date date,
  series_id text,
  grp text,                       -- market group (the series itself when ungrouped): what the episode follows
  gdir smallint,                  -- direction in the group's terms: dir x series_meta.sign
  dir smallint, conv smallint, tier text, cond boolean, hz text, instr text,
  retro boolean, conflicted boolean,
  episode_first boolean,          -- starts a call (15-day clock, any horizon): counts calls, marks restatements
  episode_start boolean,          -- starts a 2-week grade (15-day clock, days/weeks/unstated views)
  episode_start42 boolean,        -- starts a 2-month grade (60-day clock, months/long/unstated views)
  repeats int,                    -- mentions in this row's call
  episode_first_live boolean, episode_start_live boolean, episode_start42_live boolean, repeats_live int,  -- the same, entries logged live only
  grade10 boolean, grade42 boolean,
  ref_d date, ref_v numeric, ref_lag int, sigma numeric, kind text, trend20 smallint, contrarian boolean,
  z10 numeric, z42 numeric, elapsed int, z_now numeric, last_d date, stale boolean,
  primary key (entry_id, seq)
);
create index stance_grades_series_date on dash.stance_grades (series_id, stance_date) include (voice, dir, tier, cond, conflicted, retro);
create index stance_grades_date on dash.stance_grades (stance_date) include (voice, tier, cond, conflicted, retro);
create index stance_grades_voice on dash.stance_grades (voice);
alter table dash.stance_grades enable row level security;

drop table if exists dash.crowd_daily;
create table dash.crowd_daily (
  scope text not null check (scope in ('all', 'live')),   -- live: entries that are not backfilled (see refresh_scores)
  series_id text not null, d date not null,
  bulls int not null, bears int not null, voices int not null,
  one_sided numeric,              -- majority share: the larger side's share of the voices
  voices30 int, tot int, share numeric, pct_hist numeric,
  one_sided_flag boolean not null default false, extreme boolean not null default false, fwd10_z numeric,
  fwd10_na boolean not null default false,   -- the 10th session has printed but the market has too little history to scale the move
  primary key (scope, series_id, d)
);
alter table dash.crowd_daily enable row level security;

-- ---------- grading and crowding ----------
create or replace function dash.refresh_scores() returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare n_g int; n_c int; v_from date; v_today date := (now() at time zone 'Asia/Singapore')::date;
        rw record; j int; k int; di int; el boolean; pv text; pg text; pt text;
        ld date[]; hp boolean[]; cd boolean[]; dd date[]; st boolean[]; ep int[]; epl int[]; n_ep int := 0; n_epl int := 0;
        a_e bigint[] := '{}'; a_s smallint[] := '{}'; a_ep int[] := '{}'; a_epl int[] := '{}';
        a_1 boolean[] := '{}'; a_2 boolean[] := '{}'; a_3 boolean[] := '{}'; a_4 boolean[] := '{}'; a_5 boolean[] := '{}'; a_6 boolean[] := '{}';
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
  insert into dash.stance_grades (entry_id, seq, pipeline, voice, name, affiliation, topic, stance, stance_date,
         series_id, grp, gdir, dir, conv, tier, cond, hz, instr, retro, conflicted,
         episode_first, episode_start, episode_start42, repeats,
         episode_first_live, episode_start_live, episode_start42_live, repeats_live,
         grade10, grade42, ref_d, ref_v, ref_lag, sigma, kind, trend20, contrarian, z10, z42, elapsed, z_now, last_d, stale)
  with calls as (
    select c.entry_id, c.seq, e.pipeline,
           coalesce(va.voice_key, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))) voice, s.name, s.affiliation,
           e.topic, e.stance, e.stance_date, c.series_id, coalesce(sm.grp, c.series_id) grp,
           (c.dir * coalesce(sm.sign, 1))::smallint gdir, c.dir, c.conv,
           case when c.conv >= 2 then 'market' when c.conv = 1 then 'forecast' else 'unrated' end tier,
           c.cond, coalesce(nullif(c.hz, ''), 'unstated') hz, c.instr,
           -- logged after the fact: before the live ledger (16 Sep 2026), or more than 3 days after the view
           -- (the 28 Sep migration from Drive carried real-time entries, so its own timestamp is not a lag)
           (e.stance_date < date '2026-09-16'
            or (e.created_at::date <> date '2026-09-28' and e.created_at::date - e.stance_date > 3)) retro
    from dash.stance_calls c join stance.entries e using (entry_id) join stance.speakers s on s.speaker_id = e.speaker_id
    left join dash.voice_alias va on va.speaker_id = s.speaker_id
    left join dash.series_meta sm on sm.series_id = c.series_id
    where c.series_id is not null),
  -- the same view logged by both pipelines (or twice in one entry) on the same day is one call: an unconditional
  -- mention is kept over a conditional one, then one logged live over a backfilled one (so the live scope keeps
  -- it), then the highest conviction
  dedup as (
    select distinct on (voice, series_id, dir, stance_date) *,
           hz in ('days', 'weeks', 'unstated') g10, hz in ('months', 'long', 'unstated') g42
    from calls
    order by voice, series_id, dir, stance_date, cond, retro, conv desc nulls last, entry_id, seq),
  -- two-sided: the same voice, market and day in the other direction, on a horizon that overlaps
  conflict as (
    select distinct a.entry_id, a.seq from dedup a
    join dedup b on b.voice = a.voice and b.series_id = a.series_id and b.stance_date = a.stance_date and b.dir <> a.dir
    where not a.cond and not b.cond and ((a.g10 and b.g10) or (a.g42 and b.g42))),
  tagged as (
    select d.*, (k.entry_id is not null) conflicted from dedup d left join conflict k using (entry_id, seq))
  select g.entry_id, g.seq, g.pipeline, g.voice, g.name, g.affiliation, g.topic, g.stance, g.stance_date,
         g.series_id, g.grp, g.gdir, g.dir, g.conv, g.tier, g.cond, g.hz, g.instr, g.retro, g.conflicted,
         false, false, false, 1, false, false, false, case when not g.retro then 1 end,
         g.g10, g.g42,
         r.d, r.v, r.d - g.stance_date, sg.sigma, r.kind, tr.t20::smallint, (tr.t20 <> 0 and tr.t20 <> g.dir),
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f10.v - r.v else ln(f10.v / r.v) end) / (sg.sigma * sqrt(10)) end,
         case when sg.sigma > 0 then g.dir * (case r.kind when 'diff' then f42.v - r.v else ln(f42.v / r.v) end) / (sg.sigma * sqrt(42)) end,
         (lt.rn - r.rn)::int,
         case when sg.sigma > 0 and lt.rn > r.rn then g.dir * (case r.kind when 'diff' then lt.v - r.v else ln(lt.v / r.v) end) / (sg.sigma * sqrt(lt.rn - r.rn)) end,
         lt.d, lt.d < v_today - 6
  from tagged g
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

  -- Episodes, chosen greedily per voice, group and tier in date order. Six clocks: the call (15 days, any
  -- horizon), the 2-week grade (15 days, days/weeks/unstated) and the 2-month grade (60 days, months/long/unstated),
  -- over every entry and again over the entries logged live. Each clock keeps, per direction, its last start and
  -- whether the voice held that direction on its previous day with a mention the clock sees. A direction starts on
  -- its first mention, when the voice did not hold it on that previous day (a change of direction), or once the
  -- gap has passed; it starts at most once a day, on the first mention in (gradable, entry, seq) order, so a
  -- series with a reference close and a scale takes the grade over a sibling without them.
  for rw in select g.entry_id, g.seq, g.voice, g.grp, g.tier, g.gdir, g.stance_date d, g.grade10, g.grade42, g.retro
           from dash.stance_grades g where not g.cond and not g.conflicted
           order by g.voice, g.grp, g.tier, g.stance_date, (g.ref_d is null or g.sigma is null), g.entry_id, g.seq loop
    if (rw.voice, rw.grp, rw.tier) is distinct from (pv, pg, pt) then
      pv := rw.voice; pg := rw.grp; pt := rw.tier;
      -- per clock j and direction (up, down): index 2j-1 and 2j
      ld := array_fill(null::date, array[12]); hp := array_fill(false, array[12]); cd := array_fill(false, array[12]);
      dd := array_fill(null::date, array[6]); ep := array[null, null]::int[]; epl := array[null, null]::int[];
    end if;
    di := case when rw.gdir > 0 then 1 else 2 end;
    st := array_fill(false, array[6]);
    for j in 1..6 loop
      el := (case (j - 1) % 3 when 0 then true when 1 then rw.grade10 else rw.grade42 end) and (j <= 3 or not rw.retro);
      if el then
        if dd[j] is distinct from rw.d then   -- this clock's first mention of the day: today's directions become the previous day's
          hp[2 * j - 1] := cd[2 * j - 1]; hp[2 * j] := cd[2 * j];
          cd[2 * j - 1] := false; cd[2 * j] := false; dd[j] := rw.d;
        end if;
        k := 2 * j - 2 + di;
        if not cd[k] then
          st[j] := ld[k] is null or not hp[k] or rw.d - ld[k] >= case (j - 1) % 3 when 2 then 60 else 15 end;
          if st[j] then ld[k] := rw.d; end if;
          cd[k] := true;
        end if;
      end if;
    end loop;
    if st[1] then n_ep := n_ep + 1; ep[di] := n_ep; end if;
    if st[4] then n_epl := n_epl + 1; epl[di] := n_epl; end if;
    a_e := a_e || rw.entry_id; a_s := a_s || rw.seq;
    a_1 := a_1 || st[1]; a_2 := a_2 || st[2]; a_3 := a_3 || st[3]; a_4 := a_4 || st[4]; a_5 := a_5 || st[5]; a_6 := a_6 || st[6];
    a_ep := a_ep || ep[di]; a_epl := a_epl || case when rw.retro then null else epl[di] end;
  end loop;
  update dash.stance_grades g set episode_first = x.f1, episode_start = x.f2, episode_start42 = x.f3,
         episode_first_live = x.f4, episode_start_live = x.f5, episode_start42_live = x.f6, repeats = x.rep, repeats_live = x.repl
  from (select u.*, count(*) over (partition by u.ep) rep,
               case when u.epl is not null then count(*) over (partition by u.epl) end repl
        from unnest(a_e, a_s, a_1, a_2, a_3, a_4, a_5, a_6, a_ep, a_epl) u(entry_id, seq, f1, f2, f3, f4, f5, f6, ep, epl)) x
  where g.entry_id = x.entry_id and g.seq = x.seq;

  -- Crowd, for each scope: market calls only (no forecasts, no conditional views). Each voice counts once per
  -- market, on its latest day inside the 7-day window; a latest day that holds both directions counts on neither side.
  delete from dash.crowd_daily;
  insert into dash.crowd_daily (scope, series_id, d, bulls, bears, voices, one_sided, voices30)
  with sc(scope) as (values ('all'), ('live')),
  span as (select sc.scope, g.series_id, min(g.stance_date) a from sc join dash.stance_grades g on sc.scope = 'all' or not g.retro
           where g.tier = 'market' and not g.cond and not g.conflicted group by 1, 2),
  days as (select s.scope, s.series_id, x::date d from span s, generate_series(s.a, v_today, interval '1 day') x)
  select dy.scope, dy.series_id, dy.d, x.bulls, x.bears, x.bulls + x.bears,
         greatest(x.bulls, x.bears)::numeric / nullif(x.bulls + x.bears, 0), y.v30
  from days dy
  cross join lateral (
    select count(*) filter (where nd > 0) bulls, count(*) filter (where nd < 0) bears from (
      select voice, case when bool_or(conflicted) then 0 else sign(sum(dir)) end nd from (
        select voice, dir, conflicted, stance_date, max(stance_date) over (partition by voice) mx
        from dash.stance_grades g
        where g.series_id = dy.series_id and g.tier = 'market' and not g.cond and (dy.scope = 'all' or not g.retro)
          and g.stance_date > dy.d - 7 and g.stance_date <= dy.d) z
      where stance_date = mx group by voice) n) x
  cross join lateral (
    select count(distinct voice) v30 from dash.stance_grades g
    where g.series_id = dy.series_id and g.tier = 'market' and not g.cond and not g.conflicted and (dy.scope = 'all' or not g.retro)
      and g.stance_date > dy.d - 30 and g.stance_date <= dy.d) y;
  get diagnostics n_c = row_count;

  -- Participation as a share of every voice active that week (the ledger grows; raw counts would ramp),
  -- ranked against this market's own trailing year once it has 60 such days. Before that: no percentile.
  drop table if exists pg_temp._tot;
  create temp table _tot as
    select dy.scope, dy.d, count(distinct g.voice) n
    from (select distinct scope, d from dash.crowd_daily) dy
    left join dash.stance_grades g on g.tier = 'market' and not g.cond and not g.conflicted and (dy.scope = 'all' or not g.retro)
         and g.stance_date > dy.d - 7 and g.stance_date <= dy.d
    group by dy.scope, dy.d;
  update dash.crowd_daily c set tot = t.n, share = case when t.n >= 20 then c.voices::numeric / t.n end
  from _tot t where t.scope = c.scope and t.d = c.d;
  update dash.crowd_daily c set pct_hist = x.p
  from (select s.scope, s.series_id, s.d,
               (select case when count(*) >= 60 then avg((p.share < s.share)::int) end
                from dash.crowd_daily p
                where p.scope = s.scope and p.series_id = s.series_id and p.d < s.d and p.d >= s.d - 365 and p.share is not null) p
        from dash.crowd_daily s where s.voices > 0 and s.share is not null) x
  where c.scope = x.scope and c.series_id = x.series_id and c.d = x.d;
  update dash.crowd_daily set one_sided_flag = (voices >= 5 and one_sided >= 0.8),
                              extreme = coalesce(voices >= 5 and one_sided >= 0.8 and pct_hist >= 0.9, false);
  -- What followed a one-sided crowd: the next 10 sessions in its direction, in 10-session sigmas.
  update dash.crowd_daily c set fwd10_z = x.z, fwd10_na = x.z is null
  from (
    select c2.scope, c2.series_id, c2.d,
      case when sg.n >= 20 and sg.sigma > 0 then
        sign(c2.bulls - c2.bears) * (case r.kind when 'diff' then f.v - r.v else ln(f.v / r.v) end) / (sg.sigma * sqrt(10)) end z
    from dash.crowd_daily c2
    join lateral (select * from _obs o where o.series_id = c2.series_id and o.d > c2.d and o.d <= c2.d + 14 order by o.d limit 1) r on true
    join lateral (select v from _obs o where o.series_id = c2.series_id and o.rn = r.rn + 10) f on true
    join lateral (select stddev_samp(chg) sigma, count(*) n from _chg ch where ch.series_id = c2.series_id and ch.rn between r.rn - 60 and r.rn - 1) sg on true
    where c2.bulls <> c2.bears) x
  where c.scope = x.scope and c.series_id = x.series_id and c.d = x.d;
  return jsonb_build_object('grades', n_g, 'crowd_days', n_c,
                            'unmapped_alias_candidates', (select count(*) from dash.voice_alias_candidates()));
end $$;

-- ---------- classifier writer ----------
-- p = {"version":"v1","by":"scorer","results":[{"id":123,"calls":[{"s":"RT_UST10.CLOSE","dir":-1,"conv":3,"cond":false,"hz":"weeks","instr":"long 10y","lvl":null}]}]}
-- "calls" must be an array (empty for an entry with no call) of objects, each with a dir (+1, -1, or 0/null for
-- no directional call) and, when it has a direction, a conv of 1, 2 or 3. At most three calls are stored per
-- entry; any beyond the third are reported under "truncated". One bad entry never sinks the batch: it is
-- reported under "failed", keeps whatever calls it had, and an unclassified one stays in the backlog.
create or replace function dash.put_stance_calls(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare r jsonb; c jsonb; i int; n_dir int; n_e int := 0; n_c int := 0; n_bad int := 0; n_skip int := 0; n_cut int := 0;
        v_fail jsonb := '[]'; v_cut jsonb := '[]';
        sid text; known text[]; v_id bigint; v_dir smallint; v_conv smallint; v_cond boolean;
begin
  select array(select jsonb_array_elements_text(value)) into known from dash.config where key = 'call_series';
  if known is null or cardinality(known) = 0 then raise exception 'dash.config call_series is missing or empty'; end if;
  for r in select * from jsonb_array_elements(case jsonb_typeof(p->'results') when 'array' then p->'results' else '[]' end) loop
    begin
      if coalesce(r->>'id', '') !~ '^\d{1,18}$' then n_bad := n_bad + 1; continue; end if;
      v_id := (r->>'id')::bigint;
      if not exists (select 1 from stance.entries where entry_id = v_id) then n_bad := n_bad + 1; continue; end if;
      -- check the whole entry before its stored calls are touched
      if jsonb_typeof(r->'calls') is distinct from 'array' then
        raise exception 'calls must be an array (got %)', coalesce(jsonb_typeof(r->'calls'), 'nothing');
      end if;
      for c in select * from jsonb_array_elements(r->'calls') loop
        if jsonb_typeof(c) <> 'object' or not (c ? 'dir') then raise exception 'each call must be an object with a dir'; end if;
        if jsonb_typeof(c->'dir') <> 'null' and c->>'dir' !~ '^\s*[+-]?[01](\.0+)?\s*$' then
          raise exception 'unreadable dir %', c->'dir';
        end if;
        if c->>'dir' ~ '^\s*[+-]?1(\.0+)?\s*$' and coalesce(c->>'conv', '') !~ '^\s*[123](\.0+)?\s*$' then
          raise exception 'unreadable conv %', coalesce(c->'conv', 'null'::jsonb);
        end if;
      end loop;
      delete from dash.stance_calls where entry_id = v_id;
      i := 0; n_dir := 0;
      for c in select * from jsonb_array_elements(r->'calls') loop
        v_dir := case when c->>'dir' ~ '^\s*[+-]?1(\.0+)?\s*$' then sign((c->>'dir')::numeric)::smallint end;
        if v_dir is null then n_skip := n_skip + 1; continue; end if;   -- dir 0 or null: no directional call
        n_dir := n_dir + 1;
        if i >= 3 then continue; end if;
        v_conv := round((c->>'conv')::numeric)::smallint;
        v_cond := coalesce(lower(c->>'cond') in ('true', 't', 'yes', '1'), false);
        sid := nullif(btrim(c->>'s'), '');
        if sid is not null and not (sid = any(known)) then sid := null; end if;
        insert into dash.stance_calls (entry_id, seq, series_id, dir, conv, cond, hz, instr, lvl)
        values (v_id, i, sid, v_dir, v_conv, v_cond,
                case when lower(c->>'hz') in ('days', 'weeks', 'months', 'long', 'unstated') then lower(c->>'hz') else 'unstated' end,
                left(c->>'instr', 80),
                case when (c->>'lvl') ~ '^\s*-?\d+(\.\d+)?\s*$' then (c->>'lvl')::numeric end);
        i := i + 1; n_c := n_c + 1;
      end loop;
      if n_dir > i then
        n_cut := n_cut + n_dir - i;
        v_cut := v_cut || jsonb_build_object('id', v_id, 'calls', n_dir, 'kept', i);
      end if;
      insert into dash.stance_class (entry_id, version, n_calls, classified_by, classified_at)
      values (v_id, coalesce(p->>'version', 'v1'), i, p->>'by', now())
      on conflict (entry_id) do update set version = excluded.version, n_calls = excluded.n_calls,
        classified_by = excluded.classified_by, classified_at = now();
      n_e := n_e + 1;
    exception when others then
      v_fail := v_fail || jsonb_build_object('id', r->'id', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('entries', n_e, 'calls', n_c, 'unknown_ids', n_bad, 'skipped_calls', n_skip,
                            'truncated_calls', n_cut, 'truncated', v_cut, 'failed', v_fail);
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
        v_replaced text[]; v_req text[]; v_unmatched text[];
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
  -- reverting a rule that replaced another puts the one it replaced back in force; only rules that were in force
  -- are ever superseded (below), and the window test is a second guard
  with u as (update dash.rules o set status = 'in_force', decided_at = now(), decided_note = 'restored: ' || n.rid || ' reverted'
    from dash.rules n where n.rid = any(coalesce(v_reverted, '{}')) and n.supersedes = o.rid and o.status = 'superseded'
      and coalesce(o.apply_after, '-infinity') <= now() returning o.rid)
  select array_agg(rid) into v_restored from u;
  with ap as (update dash.rules set status = 'in_force', decided_at = now()
    where status = 'proposed' and apply_after <= now() returning rid)
  select array_agg(rid) into v_applied from ap;
  with s as (update dash.rules o set status = 'superseded', decided_at = now(), decided_note = 'superseded by ' || n.rid
    from dash.rules n where n.status = 'in_force' and n.supersedes = o.rid and n.rid <> o.rid and o.status = 'in_force' returning o.rid)
  select array_agg(rid) into v_superseded from s;
  -- a proposal replaced before it went in force is withdrawn, so it can never be restored without its own window
  with w as (update dash.rules o set status = 'withdrawn', decided_at = now(), decided_note = 'replaced by ' || n.rid || ' before it went in force'
    from dash.rules n where n.status = 'in_force' and n.supersedes = o.rid and n.rid <> o.rid and o.status = 'proposed' returning o.rid)
  select array_agg(rid) into v_replaced from w;
  select array_agg(rid) into v_applied from dash.rules where rid = any(coalesce(v_applied, '{}')) and status = 'in_force';
  select array_agg(distinct rid) into v_req from _ids;
  select array_agg(x) into v_unmatched from unnest(coalesce(v_req, '{}')) x
    where x <> all(coalesce(v_opposed, '{}') || coalesce(v_withdrawn, '{}') || coalesce(v_reverted, '{}'));
  return jsonb_build_object(
    'applied', coalesce(to_jsonb(v_applied), '[]'), 'opposed', coalesce(to_jsonb(v_opposed), '[]'),
    'withdrawn', coalesce(to_jsonb(v_withdrawn), '[]'), 'reverted', coalesce(to_jsonb(v_reverted), '[]'),
    'restored', coalesce(to_jsonb(v_restored), '[]'), 'superseded', coalesce(to_jsonb(v_superseded), '[]'),
    'replaced', coalesce(to_jsonb(v_replaced), '[]'),
    'unmatched', coalesce(to_jsonb(v_unmatched), '[]'),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('rid', rid, 'title', title, 'apply_after', apply_after)
                order by dash.rid_num(rid) nulls last, rid), '[]') from dash.rules where status = 'proposed'));
end $$;

-- ---------- shared builders (internal: the site RPCs and the weekly review both read them) ----------
-- The graded sets for one scope: h 0 = calls, 10 = 2-week grades, 42 = 2-month grades. refresh_scores starts
-- each at most once per voice, tier, group, direction and day, so one view on several series of a group the same
-- day counts once (on a series with a reference close and a scale if there is one, else the first by entry and seq).
create or replace function dash.voice_sets(p_live boolean)
returns table (h int, entry_id bigint, seq smallint)
language sql stable set search_path = dash, public as $$
  select 0, g.entry_id, g.seq from dash.stance_grades g
  where case when p_live then g.episode_first_live else g.episode_first end
  union all
  select 10, g.entry_id, g.seq from dash.stance_grades g
  where case when p_live then g.episode_start_live else g.episode_start end
  union all
  select 42, g.entry_id, g.seq from dash.stance_grades g
  where case when p_live then g.episode_start42_live else g.episode_start42 end
$$;

-- Mention counts, then the call and grade counts of the same sets the leaderboard uses. clusters10 = distinct
-- market group x week of the reference close, across all voices.
create or replace function dash.voice_coverage(p_live boolean) returns jsonb
language sql stable set search_path = dash, public as $$
  select jsonb_build_object(
      'entries', (select count(*) from stance.entries),
      'classified', (select count(*) from dash.stance_class),
      'with_calls', (select count(*) from dash.stance_class where n_calls > 0),
      'calls', (select count(*) from dash.stance_calls),
      'scorable', (select count(*) from dash.stance_calls where series_id is not null),
      'mentions', count(*) filter (where not p_live or not retro),
      'market', count(*) filter (where tier = 'market' and (not p_live or not retro)),
      'forecasts', count(*) filter (where tier = 'forecast' and (not p_live or not retro)),
      'unrated', count(*) filter (where tier = 'unrated' and (not p_live or not retro)),
      'conditional', count(*) filter (where cond and (not p_live or not retro)),
      'conflicted', count(*) filter (where conflicted and (not p_live or not retro)),
      'retro', count(*) filter (where retro),
      'retro_entries', count(distinct entry_id) filter (where retro),
      'last_bar', max(last_d),
      'stale', coalesce(jsonb_agg(distinct series_id) filter (where stale), '[]'),
      'short_hist', coalesce(jsonb_agg(distinct series_id) filter (where ref_d is not null and sigma is null), '[]'))
    || (select jsonb_build_object(
      'episodes', count(*) filter (where u.h = 0 and g.tier = 'market'),
      'f_episodes', count(*) filter (where u.h = 0 and g.tier = 'forecast'),
      'ungradable', count(*) filter (where u.h = 0 and g.tier = 'market' and g.ref_d is not null and g.sigma is null),
      'graded10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null),
      'clusters10', count(distinct (g.grp, date_trunc('week', g.ref_d))) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null),
      'hit10', round(avg((g.z10 > 0)::int) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null), 3),
      'trend_n10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null and g.trend20 <> 0),
      'trend_hit10', round(avg((g.trend20 * g.dir * g.z10 > 0)::int) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null and g.trend20 <> 0), 3),
      'graded42', count(*) filter (where u.h = 42 and g.tier = 'market' and g.z42 is not null),
      'hit42', round(avg((g.z42 > 0)::int) filter (where u.h = 42 and g.tier = 'market' and g.z42 is not null), 3),
      'f_graded10', count(*) filter (where u.h = 10 and g.tier = 'forecast' and g.z10 is not null),
      'f_hit10', round(avg((g.z10 > 0)::int) filter (where u.h = 10 and g.tier = 'forecast' and g.z10 is not null), 3))
      from dash.voice_sets(p_live) u join dash.stance_grades g using (entry_id, seq))
  from dash.stance_grades
$$;

-- One row per voice. calls = market calls; n10/n42 = graded market calls with clusters beside them;
-- f_* = forecasts (never ranked); live = 2-week calls still inside their first 10 sessions; retro = market calls
-- from backfilled entries.
create or replace function dash.voice_leaders(p_live boolean) returns jsonb
language sql stable set search_path = dash, public as $$
  select coalesce(jsonb_agg(v order by v->>'voice'), '[]') from (
    select jsonb_build_object('voice', g.voice, 'name', min(g.name), 'affiliation', min(g.affiliation),
      'calls', count(*) filter (where u.h = 0 and g.tier = 'market'),
      'ungradable', count(*) filter (where u.h = 0 and g.tier = 'market' and g.ref_d is not null and g.sigma is null),
      'live', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 is null and g.z_now is not null and not g.stale),
      'live_z', round(avg(g.z_now) filter (where u.h = 10 and g.tier = 'market' and g.z10 is null and not g.stale), 2),
      'n10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null),
      'hit10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 > 0),
      'avg_z10', round(avg(g.z10) filter (where u.h = 10 and g.tier = 'market'), 2),
      'clusters10', count(distinct (g.grp, date_trunc('week', g.ref_d))) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null),
      'trend_n10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.z10 is not null and g.trend20 <> 0),
      'trend_hit10', count(*) filter (where u.h = 10 and g.tier = 'market' and g.trend20 * g.dir * g.z10 > 0),
      'n42', count(*) filter (where u.h = 42 and g.tier = 'market' and g.z42 is not null),
      'hit42', count(*) filter (where u.h = 42 and g.tier = 'market' and g.z42 > 0),
      'avg_z42', round(avg(g.z42) filter (where u.h = 42 and g.tier = 'market'), 2),
      'clusters42', count(distinct (g.grp, date_trunc('week', g.ref_d))) filter (where u.h = 42 and g.tier = 'market' and g.z42 is not null),
      'contra_n', count(*) filter (where u.h = 10 and g.tier = 'market' and g.contrarian and g.z10 is not null),
      'contra_hit', count(*) filter (where u.h = 10 and g.tier = 'market' and g.contrarian and g.z10 > 0),
      'f_n10', count(*) filter (where u.h = 10 and g.tier = 'forecast' and g.z10 is not null),
      'f_hit10', count(*) filter (where u.h = 10 and g.tier = 'forecast' and g.z10 > 0),
      'retro', count(*) filter (where u.h = 0 and g.tier = 'market' and g.retro),
      'last', max(g.stance_date)) v
    from dash.voice_sets(p_live) u join dash.stance_grades g using (entry_id, seq)
    group by g.voice) l
$$;

-- One-sided crowd episodes for one scope: a flagged day starts one unless the same market had a flagged day in
-- the same direction in the 14 days before it.
create or replace function dash.crowd_events(p_scope text, p_since date default null) returns jsonb
language sql stable set search_path = dash, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('series', e.series_id, 'name', m.name, 'd', e.d, 'bulls', e.bulls, 'bears', e.bears,
           'voices', e.voices, 'one_sided', round(e.one_sided, 2), 'share', round(e.share, 3), 'tot', e.tot,
           'pct', round(e.pct_hist, 2), 'one_sided_flag', e.one_sided_flag, 'extreme', e.extreme,
           'fwd10_z', round(e.fwd10_z, 2), 'fwd_na', e.fwd10_na,
           'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down')) order by e.d desc, e.series_id), '[]')
  from dash.crowd_daily e left join msd.series m on m.series_id = e.series_id left join dash.series_meta sm on sm.series_id = e.series_id
  where e.scope = p_scope and e.one_sided_flag and (p_since is null or e.d >= p_since)
    and not exists (select 1 from dash.crowd_daily p
                    where p.scope = e.scope and p.series_id = e.series_id and p.one_sided_flag
                      and sign(p.bulls - p.bears) = sign(e.bulls - e.bears) and p.d < e.d and p.d >= e.d - 14)
$$;

-- ---------- site RPCs ----------
-- p_scope: 'all' (default) or 'live' (only entries from 16 Sep 2026 on that were logged within 3 days of the
-- view; the 28 Sep 2026 migration from Drive counts as live): every count, grade, crowd and flag follows it;
-- attention always counts every entry.
-- The 006 version took no argument; drop it so the site's no-argument call is not ambiguous.
drop function if exists public.dash_voices();
create or replace function public.dash_voices(p_scope text default 'all') returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
declare v_live boolean := coalesce(p_scope, 'all') = 'live';
        v_sc text := case when coalesce(p_scope, 'all') = 'live' then 'live' else 'all' end;
        v_today date := (now() at time zone 'Asia/Singapore')::date;
        v_wk0 date;
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  v_wk0 := date_trunc('week', v_today)::date;   -- this Monday, SGT
  return jsonb_build_object(
    'scope', v_sc,
    'coverage', dash.voice_coverage(v_live),
    'leaders', dash.voice_leaders(v_live),
    'crowd', (select coalesce(jsonb_agg(jsonb_build_object('series', c.series_id, 'name', m.name, 'd', c.d, 'bulls', c.bulls, 'bears', c.bears,
          'voices', c.voices, 'voices30', c.voices30, 'one_sided', round(c.one_sided, 2), 'share', round(c.share, 3), 'tot', c.tot,
          'pct', round(c.pct_hist, 2), 'one_sided_flag', c.one_sided_flag, 'extreme', c.extreme,
          'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down'),
          'path', (select jsonb_agg(jsonb_build_array(gd::date, coalesce(p.bulls, 0), coalesce(p.bears, 0)) order by gd)
                   from generate_series(c.d - 29, c.d, interval '1 day') gd
                   left join dash.crowd_daily p on p.scope = c.scope and p.series_id = c.series_id and p.d = gd::date))
        order by c.voices desc, c.series_id), '[]')
      from dash.crowd_daily c left join msd.series m on m.series_id = c.series_id left join dash.series_meta sm on sm.series_id = c.series_id
      where c.scope = v_sc and c.d = (select max(d) from dash.crowd_daily where scope = v_sc) and c.voices30 > 0),
    'flags', dash.crowd_events(v_sc),
    -- the last eight Monday weeks (SGT), the current one to date, every topic seen in them, zeros included
    'attention', (select coalesce(jsonb_agg(jsonb_build_object('wk', w.wk, 'topic', t.topic, 'voices', coalesce(a.n, 0),
          'partial', w.wk = v_wk0, 'days', least(7, v_today - w.wk + 1)) order by w.wk, t.topic), '[]')
      from (select x::date wk from generate_series(v_wk0 - 49, v_wk0, interval '7 days') x) w
      cross join (select distinct topic from stance.entries where stance_date >= v_wk0 - 49 and stance_date <= v_today) t
      left join (
        select date_trunc('week', e.stance_date)::date wk, e.topic,
               count(distinct coalesce(va.voice_key, lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g')))) n
        from stance.entries e join stance.speakers s using (speaker_id) left join dash.voice_alias va on va.speaker_id = s.speaker_id
        where e.stance_date >= v_wk0 - 49 and e.stance_date <= v_today group by 1, 2) a on a.wk = w.wk and a.topic = t.topic));
end $$;

-- One voice's mentions, newest first. first/start/start42/repeats follow the scope; counted10/counted42 mark the
-- rows the leaderboard counts at each horizon; short_hist marks a call its market cannot scale yet.
drop function if exists public.dash_voice(text);
create or replace function public.dash_voice(p_voice text, p_scope text default 'all') returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
declare v_live boolean := coalesce(p_scope, 'all') = 'live';
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('d', g.stance_date, 'topic', g.topic, 'stance', g.stance, 'series', g.series_id,
            'name', m.name, 'dir', g.dir, 'conv', g.conv, 'tier', g.tier, 'cond', g.cond, 'conflicted', g.conflicted, 'retro', g.retro,
            'hz', g.hz, 'instr', g.instr,
            'first', case when v_live then g.episode_first_live else g.episode_first end,
            'start', case when v_live then g.episode_start_live else g.episode_start end,
            'start42', case when v_live then g.episode_start42_live else g.episode_start42 end,
            'repeats', case when v_live then g.repeats_live else g.repeats end,
            'counted10', coalesce(k.c10, false), 'counted42', coalesce(k.c42, false),
            'grade10', g.grade10, 'grade42', g.grade42, 'ref_d', g.ref_d, 'ref_v', g.ref_v,
            'short_hist', g.ref_d is not null and g.sigma is null,
            'z10', round(g.z10, 2), 'z42', round(g.z42, 2), 'z_now', round(g.z_now, 2), 'elapsed', g.elapsed, 'stale', g.stale,
            'contrarian', g.contrarian, 'up_lbl', coalesce(sm.up_lbl, 'up'), 'dn_lbl', coalesce(sm.dn_lbl, 'down'))
            order by g.stance_date desc, g.entry_id desc, g.seq desc), '[]')
          from dash.stance_grades g
          left join (select u.entry_id, u.seq, bool_or(u.h = 10) c10, bool_or(u.h = 42) c42
                     from dash.voice_sets(v_live) u where u.h > 0 group by 1, 2) k using (entry_id, seq)
          left join msd.series m on m.series_id = g.series_id left join dash.series_meta sm on sm.series_id = g.series_id
          where g.voice = lower(regexp_replace(btrim(p_voice), '\s+', ' ', 'g')));
end $$;

create or replace function public.dash_review() returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by dash.rid_num(r.rid) desc nulls last, r.rid desc), '[]') from dash.rules r),
    'lessons', (select coalesce(jsonb_agg(to_jsonb(l) order by l.wk desc), '[]') from dash.lessons l),
    'alias_candidates', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from dash.voice_alias_candidates() a));
end $$;

-- ---------- weekly review input ----------
-- Everything the weekly review reads, in one call. As 006, except: voices and crowd come from the same builders
-- as the Voices tab, and trade aggregates keep convexity cards (rule R01) apart from every linear figure.
create or replace function dash.review_inputs(p_days int default 7) returns jsonb
language plpgsql security definer set search_path = dash, public as $$
declare shadow_f jsonb; shadow_o jsonb;
begin
  begin shadow_f := shadow.summary('fable', 14); exception when others then shadow_f := jsonb_build_object('error', sqlerrm); end;
  begin shadow_o := shadow.summary('opus', 14); exception when others then shadow_o := jsonb_build_object('error', sqlerrm); end;
  return jsonb_build_object(
    'as_of', now(),
    'trade_books', (select jsonb_object_agg(model, jsonb_build_object('updated', updated, 'scorecard', scorecard)) from dash.book_state),
    -- linear trades only (every card that is not tclass convexity); R from the latest live mark, else the book's
    'trades_linear', (select coalesce(jsonb_object_agg(model, x), '{}') from (
        select t.model, jsonb_build_object(
          'closed', count(*) filter (where t.status like 'closed%'),
          'wins', count(*) filter (where t.status like 'closed%' and t.result_r > 0),
          'losses', count(*) filter (where t.status like 'closed%' and t.result_r < 0),
          'cum_r', round(coalesce(sum(t.result_r) filter (where t.status like 'closed%'), 0), 2),
          'open', count(*) filter (where t.status = 'open'), 'pending', count(*) filter (where t.status = 'pending'),
          'open_r', round(coalesce(sum(coalesce(l.r, (select k.r from dash.trade_marks k where k.model = t.model and k.pid = t.pid
                                                        order by k.d desc limit 1))) filter (where t.status = 'open'), 0), 2),
          'missed', count(*) filter (where t.status ~ 'missed|void|vetoed')) x
        from dash.trades t left join dash.live_marks l using (model, pid)
        where t.tclass is distinct from 'convexity' group by t.model) y),
    -- convexity cards: 1R = the premium, never summed with linear R. says / paid / price are summed over the
    -- settled cards other than reader closes ("scored"); the averages are what the book's line 4 prints.
    -- paid = the settlement share dash-mark recorded, else 1/0 for a binary closed on a touch or at expiry,
    -- else (result + 1) x p0fill.
    'trades_convexity', (select coalesce(jsonb_object_agg(model, x), '{}') from (
        select c.model, jsonb_build_object(
          'cards', count(*), 'open', count(*) filter (where c.status = 'open'), 'pending', count(*) filter (where c.status = 'pending'),
          'settled', count(*) filter (where c.settled),
          'cum_r', round(coalesce(sum(c.result_r) filter (where c.settled), 0), 2),
          'open_r', round(coalesce(sum(c.r) filter (where c.status = 'open'), 0), 2),
          'scored', count(*) filter (where c.scored),
          'says_sum', round(sum(c.p / 100) filter (where c.scored), 3), 'says', round(avg(c.p / 100) filter (where c.scored), 3),
          'paid_sum', round(sum(c.paid) filter (where c.scored), 3), 'paid', round(avg(c.paid) filter (where c.scored), 3),
          'price_sum', round(sum(c.p0fill) filter (where c.scored), 3), 'price', round(avg(c.p0fill) filter (where c.scored), 3),
          'at_gate', count(*) filter (where c.settled and c.meta->>'pgate' = 'yes')) x
        from (
          select t.model, t.status, t.result_r, t.p, t.meta, l.r, f.p0fill,
                 t.status like 'closed%' settled, t.status like 'closed%' and t.status <> 'closed-reader' scored,
                 coalesce((to_jsonb(l)->>'paid')::numeric,
                          case when t.result_r is null then null
                               when coalesce(t.meta->>'struct', '') !~ '^(cs|ps)$' and t.status in ('closed-touch', 'closed-expiry')
                                 then (t.result_r > 0)::int
                               else least(1, greatest(0, (t.result_r + 1) * f.p0fill)) end) paid
          from dash.trades t left join dash.live_marks l using (model, pid)
          cross join lateral (select coalesce(case when regexp_replace(coalesce(t.meta->>'p0fill', ''), '[^0-9.]', '', 'g') ~ '^\d+(\.\d+)?$'
                                                   then regexp_replace(t.meta->>'p0fill', '[^0-9.]', '', 'g')::numeric / 100 end,
                                              t.p0 / 100) p0fill) f
          where t.tclass = 'convexity') c
        group by c.model) y),
    'trades_closed_recently', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'pid', pid, 'title', title, 'status', status,
          'tclass', tclass, 'result_r', result_r, 'exit', exit_reason, 'p', p, 'rr', rr, 'ev', ev, 'closed', closed) order by model, pid), '[]')
        from dash.trades where status like 'closed%' and last_seen >= current_date - p_days),
    'trades_open', (select coalesce(jsonb_agg(jsonb_build_object('model', t.model, 'pid', t.pid, 'title', t.title, 'tclass', t.tclass,
          'p', t.p, 'rr', t.rr, 'ev', t.ev, 'live_r', l.r, 'daily_r', l.daily_r) order by t.model, t.pid), '[]')
        from dash.trades t left join dash.live_marks l using (model, pid) where t.status in ('open', 'pending')),
    'gate_audit', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'fail', fail, 'ev_bucket', ev_bucket, 'n', n,
          'graded5', graded5, 'avg_ret5_atr', avg5, 'hit5', hit5, 'avg_last_atr', avg_last) order by model, fail, ev_bucket), '[]') from (
        select t.model, coalesce(t.fail_code, t.verdict) fail,
          case when t.ev is null then 'n/a' when t.ev >= 0.15 then 'EV>=0.15' when t.ev >= 0 then 'EV 0-0.15' else 'EV<0' end ev_bucket,
          count(*) n, count(o.ret5) graded5, round(avg(o.ret5), 2) avg5, round(avg((o.ret5 > 0)::int), 2) hit5, round(avg(o.ret_last), 2) avg_last
        from dash.tested t left join dash.idea_outcomes o using (model, d, idea)
        where t.verdict = 'not carded'
        group by 1, 2, 3) g),
    'shadow', jsonb_build_object('fable', shadow_f, 'opus', shadow_o),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'resolved', n, 'hit', hit, 'miss', miss, 'flat', flat,
          'always_no_hit', always_no, 'lead2_scored', l2n, 'lead2_hit', l2h, 'lead2_miss', l2m, 'late_arrow_share', late_share,
          'against_market', am, 'against_market_hit', amh)), '[]') from (
        select model, count(*) n, count(*) filter (where verdict = 'HIT') hit, count(*) filter (where verdict = 'MISS') miss,
          count(*) filter (where verdict = 'FLAT') flat, count(*) filter (where outcome = 'NO') always_no,
          count(verdict_lead2) l2n, count(*) filter (where verdict_lead2 = 'HIT') l2h, count(*) filter (where verdict_lead2 = 'MISS') l2m,
          round(sum(arrows_late)::numeric / nullif(sum(arrows_all), 0), 2) late_share,
          count(*) filter (where against_market) am, count(*) filter (where against_market and verdict = 'HIT') amh
        from dash.v_q_scores group by model) q),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'access', access, 'n', n, 'correct', c, 'n_early', ne, 'correct_early', ce)), '[]') from (
        select coalesce(type, '?') type, coalesce(access, '?') access, count(*) n, count(*) filter (where correct) c,
          count(*) filter (where not late) ne, count(*) filter (where correct and not late) ce
        from dash.v_q_evidence group by 1, 2 having count(*) >= 3) e),
    'questions_open', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'qid', qid, 'question', question, 'resolves', resolves,
          'net', net_total, 'implied', last_implied) order by model, qid), '[]') from dash.v_questions where status in ('open', 'awaiting')),
    'voices_scope', 'all entries, backfilled ones included: retro per voice counts its backfilled market calls, retro in the headline every backfilled mention',
    'voices_headline', dash.voice_coverage(false),
    -- market calls ranked as on the Voices tab (n10 = graded at 2 weeks, clusters10 = independent market-weeks);
    -- f_n10 / f_hit10 are conviction-1 forecasts, reported apart and never ranked; voices with 3+ graded either way
    'voices', (select coalesce(jsonb_agg(v order by (v->>'clusters10')::int desc, (v->>'n10')::int desc, v->>'voice'), '[]')
        from jsonb_array_elements(dash.voice_leaders(false)) v where (v->>'n10')::int >= 3 or (v->>'f_n10')::int >= 3),
    -- one-sided crowd episodes of the last 30 days (all entries); extreme marks the ones with top-decile participation
    'crowd_extremes', dash.crowd_events('all', current_date - 30),
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by dash.rid_num(r.rid) nulls last, r.rid), '[]') from dash.rules r),
    'alias_candidates', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from dash.voice_alias_candidates() a),
    'previous_lessons', (select coalesce(jsonb_agg(jsonb_build_object('wk', wk, 'title', title, 'body', body) order by wk desc), '[]')
        from (select * from dash.lessons order by wk desc limit 2) l));
end $$;

revoke all on function public.dash_voices(text) from public, anon;
grant execute on function public.dash_voices(text) to authenticated;
revoke all on function public.dash_voice(text, text) from public, anon;
grant execute on function public.dash_voice(text, text) to authenticated;
revoke all on function public.dash_review() from public, anon;
grant execute on function public.dash_review() to authenticated;
revoke all on function dash.refresh_scores() from public, anon, authenticated;
revoke all on function dash.put_stance_calls(jsonb) from public, anon, authenticated;
revoke all on function dash.decide_rules(jsonb) from public, anon, authenticated;
revoke all on function dash.propose_rule(jsonb) from public, anon, authenticated;
revoke all on function dash.rules_in_force(text) from public, anon, authenticated;
revoke all on function dash.review_inputs(int) from public, anon, authenticated;
revoke all on function dash.voice_alias_candidates() from public, anon, authenticated;
revoke all on function dash.voice_sets(boolean) from public, anon, authenticated;
revoke all on function dash.voice_coverage(boolean) from public, anon, authenticated;
revoke all on function dash.voice_leaders(boolean) from public, anon, authenticated;
revoke all on function dash.crowd_events(text, date) from public, anon, authenticated;
