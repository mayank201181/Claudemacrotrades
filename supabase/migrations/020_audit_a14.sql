-- 020 Astra A14 audit: SQL fixes confirmed against live data on 27 Nov 2026. One transaction.
-- Each function below was byte-identical on the live database (md5 of prosrc) to the repo copy before this patch.
--   SQL05 review_inputs: "closed recently" used last_seen, so 13 of 14 cards listed had closed more than 7 days ago;
--         now the card's own close date within p_days, Singapore date.
--   SQL11 review_inputs: open R summed only the marked cards; now null with open_r_missing when any open card is unmarked.
--   SQL04 review_inputs: a settled spread with no paid mark and no premium counted as paid 0; now left out.
--   SQL03 refresh_scores: the backfill cut used the database's UTC date of created_at; now the Singapore date.
--   SQL01 put_drivers: a payload with "parts" missing passed the array check and wiped the day's snapshot.
--   Ledger proxies written "long X" / "short X" were never priced: side moved to direction, word dropped.
-- Amended 27 Nov 2026 evening for the Astra A16 re-audit, before it was ever run:
--   A16 SQL-001 review_inputs: "closed recently" spans p_days Singapore dates (it took 8, so a boundary close sat in two reviews).
--   A16 SQL-002 refresh_scores: the sigma scaling a voice's or the crowd's move uses only changes published before the call
--         (it used the latest vintage, so a later revision changed an old grade).
begin;

-- dash.review_inputs: before md5 9e2ec2610d63b939d30fa06d67b44ced, after 2aedb33cad6c9fa58f679eee478394df
do $chk$ begin if (select md5(prosrc) from pg_proc where oid = 'dash.review_inputs'::regproc) <> '9e2ec2610d63b939d30fa06d67b44ced' then raise exception 'dash.review_inputs changed since the audit; stop'; end if; end $chk$;
create or replace function dash.review_inputs(p_days int default 7) returns jsonb
language plpgsql security definer set search_path = dash, public as $fn$
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
          'open_r', case when count(*) filter (where t.status = 'open' and effective.r is null) = 0
            then round(coalesce(sum(effective.r) filter (where t.status = 'open'), 0), 2) end,
          'open_r_missing', count(*) filter (where t.status = 'open' and effective.r is null),
          'missed', count(*) filter (where t.status ~ 'missed|void|vetoed')) x
        from dash.trades t left join dash.live_marks l using (model, pid)
        cross join lateral (select coalesce(l.r, (select k.r from dash.trade_marks k where k.model = t.model and k.pid = t.pid
                                                       order by k.d desc limit 1)) r) effective
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
          'open_r', case when count(*) filter (where c.status = 'open' and c.r is null) = 0
            then round(coalesce(sum(c.r) filter (where c.status = 'open'), 0), 2) end,
          'open_r_missing', count(*) filter (where c.status = 'open' and c.r is null),
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
                               when f.p0fill is not null then least(1, greatest(0, (t.result_r + 1) * f.p0fill)) end) paid
          from dash.trades t left join dash.live_marks l using (model, pid)
          cross join lateral (select coalesce(case when regexp_replace(coalesce(t.meta->>'p0fill', ''), '[^0-9.]', '', 'g') ~ '^\d+(\.\d+)?$'
                                                   then regexp_replace(t.meta->>'p0fill', '[^0-9.]', '', 'g')::numeric / 100 end,
                                              t.p0 / 100) p0fill) f
          where t.tclass = 'convexity') c
        group by c.model) y),
    'trades_closed_recently', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'pid', pid, 'title', title, 'status', status,
          'tclass', tclass, 'result_r', result_r, 'exit', exit_reason, 'p', p, 'rr', rr, 'ev', ev, 'closed', closed) order by model, pid), '[]')
        from dash.trades where status like 'closed%'
          and case when pg_input_is_valid(substring(closed from '^\d{4}-\d{2}-\d{2}'), 'date')
                   then substring(closed from '^\d{4}-\d{2}-\d{2}')::date end
              between (now() at time zone 'Asia/Singapore')::date - p_days + 1   -- A16 SQL-001: 7 dates, not 8
                  and (now() at time zone 'Asia/Singapore')::date),
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
end $fn$;

-- dash.refresh_scores: before md5 67f4298880c7b75dfe6e03fab910a4c0, after 3f64afc26026e5ce850330f7b94cf682
do $chk$ begin if (select md5(prosrc) from pg_proc where oid = 'dash.refresh_scores'::regproc) <> '67f4298880c7b75dfe6e03fab910a4c0' then raise exception 'dash.refresh_scores changed since the audit; stop'; end if; end $chk$;
create or replace function dash.refresh_scores() returns jsonb
language plpgsql security definer set search_path = dash, public as $fn$
declare n_g int; n_c int; v_from date; v_today date := (now() at time zone 'Asia/Singapore')::date;
        rw record; j int; k int; di int; el boolean; pv text; pg text; pt text;
        ld date[]; hp boolean[]; cd boolean[]; dd date[]; st boolean[]; ep int[]; epl int[]; n_ep int := 0; n_epl int := 0;
        a_e bigint[] := '{}'; a_s smallint[] := '{}'; a_ep int[] := '{}'; a_epl int[] := '{}';
        a_1 boolean[] := '{}'; a_2 boolean[] := '{}'; a_3 boolean[] := '{}'; a_4 boolean[] := '{}'; a_5 boolean[] := '{}'; a_6 boolean[] := '{}';
begin
  select least(coalesce(min(stance_date), v_today), v_today) - 150 into v_from from stance.entries;
  drop table if exists pg_temp._obs;
  create temp table _obs as
    select o.series_id, o.as_of d, o.value v, o.vintage_date vint,
           row_number() over (partition by o.series_id order by o.as_of) rn,
           case when coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') then 'diff' else 'log' end kind
    from (select distinct on (series_id, as_of) series_id, as_of, value, vintage_date from msd.observations
          where series_id in (select distinct series_id from dash.stance_calls where series_id is not null)
            and as_of >= v_from and value is not null
          order by series_id, as_of, vintage_date desc nulls last) o
    join msd.series s using (series_id)
    where coalesce(s.unit, '') in ('pct', 'bp', 'vol', 'bp_vol', 'vol_pts') or o.value > 0;
  create index on _obs (series_id, rn);
  create index on _obs (series_id, d);
  drop table if exists pg_temp._chg;
  create temp table _chg as
    -- A16 SQL-002: vint = when the later of the two values was published; a sigma uses only changes known before its call
    select a.series_id, a.rn, case a.kind when 'diff' then a.v - b.v else ln(a.v / b.v) end chg, greatest(a.vint, b.vint) vint
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
            or ((e.created_at at time zone 'Asia/Singapore')::date <> date '2026-09-28' and (e.created_at at time zone 'Asia/Singapore')::date - e.stance_date > 3)) retro
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
  left join lateral (select stddev_samp(chg) sigma, count(*) n from _chg c where c.series_id = g.series_id and c.rn between r.rn - 60 and r.rn - 1
                       and c.vint < g.stance_date) sg0 on true
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
    join lateral (select stddev_samp(chg) sigma, count(*) n from _chg ch where ch.series_id = c2.series_id and ch.rn between r.rn - 60 and r.rn - 1
                  and ch.vint < c2.d) sg on true
    where c2.bulls <> c2.bears) x
  where c.scope = x.scope and c.series_id = x.series_id and c.d = x.d;
  return jsonb_build_object('grades', n_g, 'crowd_days', n_c,
                            'unmapped_alias_candidates', (select count(*) from dash.voice_alias_candidates()));
end $fn$;

-- dash.put_drivers: before md5 5c743973998d0e12b45790d143467235, after d18574d7584788b29c0810ed32e48b2f
do $chk$ begin if (select md5(prosrc) from pg_proc where oid = 'dash.put_drivers'::regproc) <> '5c743973998d0e12b45790d143467235' then raise exception 'dash.put_drivers changed since the audit; stop'; end if; end $chk$;
create or replace function dash.put_drivers(p jsonb) returns jsonb
language plpgsql security definer set search_path = dash, public as $fn$
declare v_as_of date; v_parts int; v_pairs int; v_drivers int; v_items int;
begin
  v_as_of := (p->>'as_of')::date;
  if v_as_of is null or coalesce(p->>'run_id', '') = '' then raise exception 'as_of and run_id are required'; end if;
  if jsonb_typeof(p->'pairs') is distinct from 'array' or jsonb_typeof(p->'parts') is distinct from 'array' then raise exception 'pairs and parts must be arrays'; end if;
  delete from dash.drivers_run where as_of = v_as_of;
  insert into dash.drivers_run (as_of, run_id, version, source, n_pairs, meta)
  values (v_as_of, p->>'run_id', p->>'version', p->>'source', jsonb_array_length(p->'pairs'), coalesce(p->'meta', '{}'::jsonb));
  insert into dash.drivers_part (as_of, part, verdict, show, note)
  select v_as_of, x->>'part', coalesce(x->>'verdict', 'UNKNOWN'),
         case when x ? 'show' then dash.drivers_flag(x->'show') else upper(coalesce(x->>'verdict', '')) = 'PASS' end, x->>'note'
  from jsonb_array_elements(p->'parts') x;
  get diagnostics v_parts = row_count;
  insert into dash.drivers_pair (as_of, pair_id, ord, grey, row)
  select v_as_of, x->>'pair_id', coalesce((x->>'ord')::int, t.o::int), dash.drivers_flag(x->'grey'), x - 'ord'
  from jsonb_array_elements(p->'pairs') with ordinality t(x, o);
  get diagnostics v_pairs = row_count;
  insert into dash.drivers_driver (as_of, pair_id, source, group_id, rank, name, row)
  select v_as_of, x->>'pair_id', x->>'source', x->>'group_id', (x->>'rank')::int, x->>'name', x
  from jsonb_array_elements(coalesce(p->'drivers', '[]'::jsonb)) x
  on conflict (as_of, pair_id, source, group_id) do update set rank = excluded.rank, name = excluded.name, row = excluded.row;
  get diagnostics v_drivers = row_count;
  insert into dash.drivers_item (as_of, part, seq, row)
  select v_as_of, x->>'part', t.o::int, x - 'part'
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality t(x, o)
  where x->>'part' in ('levels', 'tactical', 'rich_cheap', 'waking_up');
  get diagnostics v_items = row_count;
  return jsonb_build_object('as_of', v_as_of, 'parts', v_parts, 'pairs', v_pairs, 'drivers', v_drivers, 'items', v_items);
end $fn$;

update dash.tested set direction = case when proxy ~* '^long\s' then 1 else -1 end,
                       proxy = regexp_replace(proxy, '^(long|short)\s+', '', 'i')
 where proxy ~* '^(long|short)\s+\S';
update dash.tested set proxy = null where proxy ~* '^(several|none|-)$';

-- read-back: closed_recent should be the cards closed in the last 7 days; ls_left 0
select (select jsonb_array_length(dash.review_inputs(7)->'trades_closed_recently')) closed_recent,
       (select count(*) from dash.tested where proxy ~* '^(long|short)\s') ls_left;
commit;
