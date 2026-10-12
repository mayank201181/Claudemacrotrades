-- 016: Event library. The event-day move multipliers built on 12 Oct 2026 (plain pipeline, run
-- evlib_plain_20261012T0448Z; the human lookup is LIBRARY.md in the project files, event_library/) loaded as
-- plain tables that the Macro Takeaways digests read through dash.event_brief() and dash.event_lookup()
-- with execute_sql, like dash.drivers_brief. scripts/event_library/to_sql.py turns the library CSVs into the
-- compact text the two loaders take (one line per cell or calendar row); the data itself stays out of this repo.
--
--   event_type   the scored release types with a plain name and the shorthands the lookup accepts
--   event_asset  the 26 assets with a short label, the unit of the vol add-on and the shorthands
--   event_cell   one row per release type x asset x period x window x sample; loaded: period ALL, clean sample,
--                1d and 2d windows, every relevant cell plus the significant spillover cells and the
--                pre-registered no-effect pairs
--   event_cal    the library's calendar from July 2026 on, including the future dates it knows (to Jan 2027;
--                is_proxy = rule-derived date, to be verified)
-- No policies: the owner's loader writes, the digests read as the database owner. Nothing here is a view.

create table if not exists dash.event_type (
  event_type text primary key,
  name text not null,
  country text,
  kind text not null default 'data' check (kind in ('cb', 'data', 'other')),
  aliases text                      -- pipe-separated shorthands, upper case, letters and digits only
);

create table if not exists dash.event_asset (
  asset text primary key,           -- the library's series id, e.g. FX_USDJPY.CLOSE
  label text not null unique,       -- USDJPY
  unit text not null check (unit in ('vol_pts', 'bp_normal_vol')),   -- unit of the vol add-on
  aliases text,
  note text
);

create table if not exists dash.event_cell (
  event_type text not null references dash.event_type,
  asset text not null references dash.event_asset,
  period text not null,             -- ALL | 2010s | 2020s | VOL_LO/MID/HI | VIX_LT15/15_25/GT25 | IS | OOS
  win text not null,                -- 1d | 2d
  sample text not null,             -- clean | all
  n int, n_control int,
  multiplier numeric, ci_lo numeric, ci_hi numeric, multiplier_shrunk numeric,
  p_value numeric, q_value_bh numeric,
  is_relevant boolean not null default true,
  placebo_strict boolean not null default false,
  mean_abs_event numeric, mean_abs_control numeric,
  var_ratio numeric, excess_var_days numeric,
  base_vol_ann numeric, base_vol_now numeric,
  addon_vol_1w numeric, addon_vol_1m numeric, addon_vol_1w_now numeric, addon_vol_1m_now numeric,
  flag text,
  run_id text,
  loaded_at timestamptz not null default now(),
  primary key (event_type, asset, period, win, sample)
);

create table if not exists dash.event_cal (
  event_id text primary key,
  event_type text not null references dash.event_type,
  local_date date not null,
  ts_utc timestamptz,
  ts_quality text,                  -- exact | standard_time | date_only
  scheduled boolean not null default true,
  is_proxy boolean not null default false,
  notes text,
  run_id text
);
create index if not exists event_cal_type_date on dash.event_cal (event_type, local_date);

alter table dash.event_type enable row level security;
alter table dash.event_asset enable row level security;
alter table dash.event_cell enable row level security;
alter table dash.event_cal enable row level security;

insert into dash.event_type (event_type, name, country, kind, aliases) values
  ('US_FOMC_DECISION', 'FOMC decision', 'US', 'cb', 'FOMC|FED|FEDDECISION|FOMCDECISION|FEDMEETING|FOMCMEETING|FEDERALRESERVE'),
  ('US_FOMC_MINUTES', 'FOMC minutes', 'US', 'cb', 'MINUTES|FOMCMINUTES|FEDMINUTES'),
  ('US_CPI', 'US CPI', 'US', 'data', 'USCPI|USINFLATION'),
  ('US_PPI', 'US PPI', 'US', 'data', 'PPI|USPPI'),
  ('US_PCE', 'US PCE / personal income', 'US', 'data', 'PCE|COREPCE|USPCE'),
  ('US_NFP', 'US payrolls', 'US', 'data', 'NFP|PAYROLLS|NONFARM|NONFARMPAYROLLS|USJOBS|USEMPLOYMENT|JOBSREPORT'),
  ('US_JOLTS', 'US JOLTS', 'US', 'data', 'JOLTS'),
  ('US_ISM_MFG', 'US ISM manufacturing', 'US', 'data', 'ISM|ISMMFG|ISMMANUFACTURING|ISMPMI|USPMI'),
  ('US_RETAIL_SALES', 'US retail sales', 'US', 'data', 'RETAILSALES|USRETAIL|USRETAILSALES'),
  ('US_GDP_ADV', 'US GDP advance', 'US', 'data', 'USGDP|GDPADVANCE|USGDPADVANCE'),
  ('US_EIA_CRUDE', 'EIA weekly crude stocks', 'US', 'data', 'EIA|EIACRUDE|CRUDESTOCKS|CRUDEINVENTORIES|DOE|EIAWEEKLY'),
  ('US_REFUNDING_FINANCING', 'Treasury refunding financing estimate', 'US', 'other', 'REFUNDINGFINANCING|FINANCINGESTIMATE'),
  ('US_REFUNDING_STATEMENT', 'Treasury quarterly refunding statement', 'US', 'other', 'REFUNDING|QRA|REFUNDINGSTATEMENT|QUARTERLYREFUNDING'),
  ('EZ_ECB', 'ECB decision', 'EZ', 'cb', 'ECB'),
  ('EZ_HICP_FLASH', 'Euro area flash HICP', 'EZ', 'data', 'HICP|FLASHHICP|EUROZONECPI|EUROAREACPI|EZCPI|EACPI'),
  ('UK_BOE', 'BoE decision', 'UK', 'cb', 'BOE|MPC|BANKOFENGLAND'),
  ('UK_CPI', 'UK CPI', 'UK', 'data', 'UKCPI|UKINFLATION'),
  ('JP_BOJ', 'BoJ decision', 'JP', 'cb', 'BOJ|BANKOFJAPAN'),
  ('JP_CPI', 'Japan CPI', 'JP', 'data', 'JAPANCPI|JPCPI|JAPANINFLATION'),
  ('JP_GDP', 'Japan GDP (preliminary)', 'JP', 'data', 'JAPANGDP|JPGDP'),
  ('JP_TANKAN', 'BoJ Tankan', 'JP', 'data', 'TANKAN'),
  ('CH_SNB', 'SNB decision', 'CH', 'cb', 'SNB'),
  ('SE_RIKSBANK', 'Riksbank decision', 'SE', 'cb', 'RIKSBANK'),
  ('NO_NORGES', 'Norges Bank decision', 'NO', 'cb', 'NORGES|NORGESBANK'),
  ('CA_BOC', 'BoC decision', 'CA', 'cb', 'BOC|BANKOFCANADA'),
  ('CA_LFS', 'Canada labour force survey', 'CA', 'data', 'LFS|CANADAJOBS|CANADAEMPLOYMENT|CANADALFS|CANADALABOUR'),
  ('AU_RBA', 'RBA decision', 'AU', 'cb', 'RBA'),
  ('AU_CPI', 'Australia CPI', 'AU', 'data', 'AUCPI|AUSTRALIACPI|AUSSIECPI'),
  ('AU_EMPLOYMENT', 'Australia employment', 'AU', 'data', 'AUJOBS|AUSTRALIAJOBS|AUSTRALIAEMPLOYMENT|AUEMPLOYMENT|AULABOUR'),
  ('NZ_RBNZ', 'RBNZ decision', 'NZ', 'cb', 'RBNZ'),
  ('CN_CPI', 'China CPI', 'CN', 'data', 'CHINACPI|CNCPI'),
  ('CN_GDP', 'China GDP', 'CN', 'data', 'CHINAGDP|CNGDP'),
  ('CN_LPR', 'China loan prime rate', 'CN', 'cb', 'LPR|LOANPRIMERATE'),
  ('CN_PMI_NBS', 'China NBS PMI', 'CN', 'data', 'NBSPMI|CHINAPMI|CNPMI|PMI'),
  ('CN_TRADE', 'China trade', 'CN', 'data', 'CHINATRADE|CNTRADE|CHINAEXPORTS'),
  ('KR_BOK', 'BoK decision', 'KR', 'cb', 'BOK|BANKOFKOREA'),
  ('KR_CPI', 'Korea CPI', 'KR', 'data', 'KOREACPI|KRCPI'),
  ('KR_GDP', 'Korea GDP (advance)', 'KR', 'data', 'KOREAGDP|KRGDP'),
  ('TW_CBC', 'CBC (Taiwan) decision', 'TW', 'cb', 'CBC|TAIWANCBC'),
  ('TW_CPI', 'Taiwan CPI', 'TW', 'data', 'TAIWANCPI|TWCPI'),
  ('TW_GDP', 'Taiwan GDP', 'TW', 'data', 'TAIWANGDP|TWGDP'),
  ('IN_RBI', 'RBI decision', 'IN', 'cb', 'RBI'),
  ('ID_BI', 'Bank Indonesia decision', 'ID', 'cb', 'BI|BANKINDONESIA'),
  ('MY_BNM', 'BNM decision', 'MY', 'cb', 'BNM|BANKNEGARA'),
  ('PH_BSP', 'BSP decision', 'PH', 'cb', 'BSP'),
  ('TH_BOT', 'BoT decision', 'TH', 'cb', 'BOT|BANKOFTHAILAND'),
  ('SG_MAS', 'MAS policy statement', 'SG', 'cb', 'MAS|MASMPS'),
  ('OPEC_MEETING', 'OPEC / OPEC+ meeting', 'XX', 'other', 'OPEC|OPECPLUS')
on conflict (event_type) do update set name = excluded.name, country = excluded.country, kind = excluded.kind, aliases = excluded.aliases;

insert into dash.event_asset (asset, label, unit, aliases, note) values
  ('FX_EURUSD.CLOSE', 'EURUSD', 'vol_pts', 'EUR|EURO', 'Fed H.10 noon NY'),
  ('FX_USDJPY.CLOSE', 'USDJPY', 'vol_pts', 'JPY|YEN', 'Fed H.10 noon NY'),
  ('FX_GBPUSD.CLOSE', 'GBPUSD', 'vol_pts', 'GBP|CABLE|STERLING', 'Fed H.10 noon NY'),
  ('FX_AUDUSD.CLOSE', 'AUDUSD', 'vol_pts', 'AUD|AUSSIE', 'Fed H.10 noon NY'),
  ('FX_NZDUSD.CLOSE', 'NZDUSD', 'vol_pts', 'NZD|KIWI', 'Fed H.10 noon NY'),
  ('FX_USDCAD.CLOSE', 'USDCAD', 'vol_pts', 'CAD|LOONIE', 'Fed H.10 noon NY'),
  ('FX_USDCHF.CLOSE', 'USDCHF', 'vol_pts', 'CHF|SWISSIE', 'Fed H.10 noon NY'),
  ('FX_USDSEK.CLOSE', 'USDSEK', 'vol_pts', 'SEK', 'Fed H.10 noon NY'),
  ('FX_USDNOK.CLOSE', 'USDNOK', 'vol_pts', 'NOK', 'Fed H.10 noon NY'),
  ('FX_USDCNH.CLOSE', 'USDCNH', 'vol_pts', 'CNH|CNY|RMB|YUAN|USDCNY', 'onshore CNY proxy, Fed H.10 noon NY'),
  ('FX_USDKRW.CLOSE', 'USDKRW', 'vol_pts', 'KRW|WON', 'Fed H.10 noon NY'),
  ('FX_USDTWD.CLOSE', 'USDTWD', 'vol_pts', 'TWD', 'Fed H.10 noon NY'),
  ('FX_USDINR.CLOSE', 'USDINR', 'vol_pts', 'INR|RUPEE', 'Fed H.10 noon NY'),
  ('FX_USDSGD.CLOSE', 'USDSGD', 'vol_pts', 'SGD', 'Fed H.10 noon NY'),
  ('FX_USDTHB.CLOSE', 'USDTHB', 'vol_pts', 'THB|BAHT', 'Fed H.10 noon NY'),
  ('FX_USDMYR.CLOSE', 'USDMYR', 'vol_pts', 'MYR|RINGGIT', 'Fed H.10 noon NY'),
  ('FX_USD.CLOSE', 'DXY', 'vol_pts', 'USD|DOLLAR|DOLLARINDEX|USDINDEX|BBDXY|DX', 'synthetic ICE-weight index from Fed H.10 noon NY rates'),
  ('FX_USDIDR.CLOSE', 'USDIDR', 'vol_pts', 'IDR|RUPIAH', 'ECB 14:15 CET reference'),
  ('FX_USDPHP.CLOSE', 'USDPHP', 'vol_pts', 'PHP|PESO', 'ECB 14:15 CET reference'),
  ('RT_UST2.CLOSE', 'UST2', 'bp_normal_vol', '2Y|UST2Y|2YR|2S|TU|USD2Y|TREASURY2Y', 'Treasury CMT 2y, 15:30 NY, moves in bp'),
  ('RT_UST10.CLOSE', 'UST10', 'bp_normal_vol', '10Y|UST10Y|10YR|10S|TY|USD10Y|TREASURY10Y', 'Treasury CMT 10y, 15:30 NY, moves in bp'),
  ('EQ_SPX.CLOSE', 'SPX', 'vol_pts', 'SP500|SANDP|ES|SPY|US500|SPX500', 'cash close 16:00 NY'),
  ('EQ_N225.CLOSE', 'N225', 'vol_pts', 'NIKKEI|NKY|JP225|NIKKEI225', 'Tokyo close'),
  ('EQ_KOSPI.CLOSE', 'KOSPI', 'vol_pts', 'KS11|KOREA|KOSPI200', 'Seoul close'),
  ('CM_GOLD.CLOSE', 'GOLD', 'vol_pts', 'XAU|XAUUSD|GC', 'COMEX front month, 13:30 NY'),
  ('CM_BRENT.CLOSE', 'BRENT', 'vol_pts', 'OIL|CRUDE|BRT|CO|BRENTCRUDE', 'ICE front month, 19:30 London')
on conflict (asset) do update set label = excluded.label, unit = excluded.unit, aliases = excluded.aliases, note = excluded.note;

-- ---------- loaders (compact CSV text, one row per line, no header; '#' lines ignored) ----------
create or replace function dash.event_num(p text) returns numeric
language sql immutable as $$ select nullif(btrim(coalesce(p, '')), '')::numeric $$;

-- event_type,asset label,win,n,multiplier,ci_lo,ci_hi,q,relevant(1/0),placebo(1/0),mean_abs_event,mean_abs_control,
-- var_ratio,addon_1w,addon_1m,addon_1w_now,addon_1m_now,shrunk   (one period and sample per call)
create or replace function dash.put_event_cells(p_csv text, p_run_id text default null, p_period text default 'ALL', p_sample text default 'clean') returns int
language plpgsql security definer set search_path = dash, public as $$
declare v int;
begin
  insert into dash.event_cell (event_type, asset, period, win, sample, n, multiplier, ci_lo, ci_hi, q_value_bh, is_relevant, placebo_strict,
    mean_abs_event, mean_abs_control, var_ratio, excess_var_days, addon_vol_1w, addon_vol_1m, addon_vol_1w_now, addon_vol_1m_now,
    multiplier_shrunk, flag, run_id)
  select f[1], a.asset, p_period, f[3], p_sample, dash.event_num(f[4])::int, dash.event_num(f[5]), dash.event_num(f[6]), dash.event_num(f[7]),
    dash.event_num(f[8]), f[9] = '1', f[10] = '1', dash.event_num(f[11]), dash.event_num(f[12]), dash.event_num(f[13]), dash.event_num(f[13]) - 1,
    dash.event_num(f[14]), dash.event_num(f[15]), dash.event_num(f[16]), dash.event_num(f[17]), dash.event_num(f[18]),
    case when dash.event_num(f[4]) < 15 then 'n<15' end, p_run_id
  from regexp_split_to_table(p_csv, E'\n') as t(line)
  cross join lateral (select string_to_array(btrim(t.line, E' \r'), ',') as f) as x
  join dash.event_asset a on a.label = f[2]
  where btrim(t.line) <> '' and left(btrim(t.line), 1) <> '#'
  on conflict (event_type, asset, period, win, sample) do update set
    n = excluded.n, multiplier = excluded.multiplier, ci_lo = excluded.ci_lo, ci_hi = excluded.ci_hi, q_value_bh = excluded.q_value_bh,
    is_relevant = excluded.is_relevant, placebo_strict = excluded.placebo_strict, mean_abs_event = excluded.mean_abs_event,
    mean_abs_control = excluded.mean_abs_control, var_ratio = excluded.var_ratio, excess_var_days = excluded.excess_var_days,
    addon_vol_1w = excluded.addon_vol_1w, addon_vol_1m = excluded.addon_vol_1m, addon_vol_1w_now = excluded.addon_vol_1w_now,
    addon_vol_1m_now = excluded.addon_vol_1m_now, multiplier_shrunk = excluded.multiplier_shrunk, flag = excluded.flag,
    run_id = excluded.run_id, loaded_at = now();
  get diagnostics v = row_count;
  return v;
end $$;

-- event_type,local_date,ts_utc as YYYY-MM-DDTHH:MM (blank = date only),is_proxy(1/0)
create or replace function dash.put_event_cal(p_csv text, p_run_id text default null) returns int
language plpgsql security definer set search_path = dash, public as $$
declare v int;
begin
  insert into dash.event_cal (event_id, event_type, local_date, ts_utc, ts_quality, scheduled, is_proxy, run_id)
  select f[1] || '_' || replace(f[2], '-', ''), f[1], f[2]::date,
    case when nullif(f[3], '') is not null then (f[3] || ':00Z')::timestamptz end,
    case when nullif(f[3], '') is not null then 'standard_time' else 'date_only' end, true, f[4] = '1', p_run_id
  from regexp_split_to_table(p_csv, E'\n') as t(line)
  cross join lateral (select string_to_array(btrim(t.line, E' \r'), ',') as f) as x
  where btrim(t.line) <> '' and left(btrim(t.line), 1) <> '#'
  on conflict (event_id) do update set event_type = excluded.event_type, local_date = excluded.local_date, ts_utc = excluded.ts_utc,
    ts_quality = excluded.ts_quality, scheduled = excluded.scheduled, is_proxy = excluded.is_proxy, run_id = excluded.run_id;
  get diagnostics v = row_count;
  return v;
end $$;

-- ---------- text helpers ----------
create or replace function dash.event_sgn(p numeric, p_dp int default 1) returns text
language sql immutable as $$
  select case when p is null then '?' when round(p, p_dp) >= 0 then '+' || round(p, p_dp)::text else round(p, p_dp)::text end
$$;

-- a type (or several) from any wording: code, shorthand, or a word of the name
create or replace function dash.event_match_type(p text) returns text[]
language sql stable as $$
  with q as (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) k, btrim(coalesce(p, '')) raw)
  select coalesce(
    (select array_agg(t.event_type order by t.event_type) from dash.event_type t, q
      where q.k <> '' and (replace(t.event_type, '_', '') = q.k or q.k = any(string_to_array(upper(coalesce(t.aliases, '')), '|')))),
    (select array_agg(t.event_type order by t.event_type) from dash.event_type t, q
      where q.raw <> '' and (t.name ilike '%' || q.raw || '%' or t.event_type ilike '%' || q.raw || '%' or replace(t.event_type, '_', '') like '%' || q.k || '%')),
    '{}'::text[])
$$;

create or replace function dash.event_match_asset(p text) returns text[]
language sql stable as $$
  with q as (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) k, btrim(coalesce(p, '')) raw)
  select coalesce(
    (select array_agg(a.asset order by a.asset) from dash.event_asset a, q
      where q.k <> '' and (upper(a.label) = q.k or upper(a.asset) = upper(q.raw) or q.k = any(string_to_array(upper(coalesce(a.aliases, '')), '|')))),
    (select array_agg(a.asset order by a.asset) from dash.event_asset a, q
      where q.k <> '' and (a.label like '%' || q.k || '%' or replace(a.asset, '.CLOSE', '') like '%' || q.k || '%')),
    '{}'::text[])
$$;

-- one cell, in full: "USDJPY x1.66 [1.26-2.15]* n50, |move| 1.31 vs 0.79 sigma, var x2.4, add-on 1w +1.1 / 1m +0.3 vol pts (now +1.3 / +0.3)"
create or replace function dash.event_cell_line(c dash.event_cell, p_label text, p_unit text) returns text
language sql immutable as $$
  select format('%s x%s [%s-%s]%s n%s, |move| %s vs %s sigma, var x%s, add-on 1w %s / 1m %s %s (now %s / %s)%s%s%s%s',
    p_label, round(c.multiplier, 2), round(c.ci_lo, 2), round(c.ci_hi, 2),
    case when c.q_value_bh < 0.10 and c.n >= 15 then '*' else '' end, c.n,
    round(c.mean_abs_event, 2), round(c.mean_abs_control, 2), round(c.var_ratio, 1),
    dash.event_sgn(c.addon_vol_1w, 2), dash.event_sgn(c.addon_vol_1m, 2), case when p_unit = 'bp_normal_vol' then 'bp' else 'vol pts' end,
    dash.event_sgn(c.addon_vol_1w_now, 2), dash.event_sgn(c.addon_vol_1m_now, 2),
    case when c.n < 15 then ' (n<15, untested)' when c.n < 30 and c.multiplier_shrunk is not null then format(' (shrunk x%s)', round(c.multiplier_shrunk, 2)) else '' end,
    case when c.placebo_strict then ' (pre-registered no-effect pair)' else '' end,
    case when not c.is_relevant and not c.placebo_strict then ' (spillover)' else '' end,
    case when c.win <> '1d' then ' [' || c.win || ' window]' else '' end)
$$;

-- the type's significant 1-day cells in short form, for the brief
create or replace function dash.event_cells_short(p_type text, p_max int default 8) returns text
language plpgsql stable as $$
declare v_sig text; v_more text; v_rest int;
begin
  with s as (
    select c.*, a.label, a.unit, row_number() over (order by c.multiplier desc) rn
    from dash.event_cell c join dash.event_asset a using (asset)
    where c.event_type = p_type and c.period = 'ALL' and c.win = '1d' and c.sample = 'clean' and c.q_value_bh < 0.10 and c.n >= 15)
  select string_agg(format('%s x%s (%s sigma; vol %s/%s%s)%s', label, round(multiplier, 2), round(mean_abs_event, 1),
           dash.event_sgn(addon_vol_1w, 1), dash.event_sgn(addon_vol_1m, 1), case when unit = 'bp_normal_vol' then ' bp' else '' end,
           case when not is_relevant then ' spill' else '' end), '; ' order by multiplier desc) filter (where rn <= p_max),
         string_agg(label, ', ' order by multiplier desc) filter (where rn > p_max)
  into v_sig, v_more from s;
  select count(*) into v_rest from dash.event_cell c
  where c.event_type = p_type and c.period = 'ALL' and c.win = '1d' and c.sample = 'clean' and c.is_relevant
    and not (c.q_value_bh < 0.10 and c.n >= 15);
  return concat_ws('; ', coalesce(v_sig, 'no significant cell'),
    case when v_more is not null then 'also significant: ' || v_more end,
    case when v_rest > 0 then v_rest || ' relevant assets not significant' end);
end $$;

-- For the digests: how to read the library, the types and assets it covers, and the releases due in the next
-- p_days days (the library's own calendar) each with its significant cells. Called through execute_sql, like
-- dash.drivers_brief.
create or replace function dash.event_brief(p_days int default 21, p_max_cells int default 8) returns text
language plpgsql stable security definer set search_path = dash, public as $$
declare v_today date := (now() at time zone 'Asia/Singapore')::date; v_run text; v_loaded timestamptz; v_n int; v_head text; v_up text;
begin
  select run_id, max(loaded_at), count(*) into v_run, v_loaded, v_n from dash.event_cell group by run_id order by max(loaded_at) desc limit 1;
  if v_run is null then return 'EVENT LIBRARY: nothing loaded yet.'; end if;
  v_head := format('EVENT LIBRARY (event-day move multipliers; run %s, loaded %s SGT; %s release types x %s assets, daily closes 2015-2026: FX at noon NY, UST 2y/10y 15:30 NY in bp, equities, gold and Brent at their local closes).',
    v_run, to_char(v_loaded at time zone 'Asia/Singapore', 'DD Mon YYYY'), (select count(distinct event_type) from dash.event_cell), (select count(distinct asset) from dash.event_cell))
    || E'\nRead: xM = the asset''s absolute move on the release day averaged M times its move on matched ordinary days, both in units of its own trailing 60-session daily sigma (sigma = annualised realised vol / 16); * = significant (BH q<0.10, n>=15); "a sigma" = mean absolute event-day move in sigma units (an ordinary day is about 0.8); vol +w/+m = annualised vol points (bp/yr normal vol for UST) to add to a 1-week / 1-month implied vol whose life holds one such release, at the asset''s median sigma. Cells with n<15 are untested; "spill" = the release is not pre-registered as relevant to that asset but the effect is significant anyway. Full cell (CI, n, variance ratio, add-on at the latest sigma, 2-day window): select dash.event_lookup(''<release>'', ''<asset>''); plain words work (''BoJ'', ''USDJPY''; ''FOMC'' alone lists every asset).'
    || E'\nTypes: ' || (select string_agg(event_type || ' = ' || name, ', ' order by country, event_type) from dash.event_type where event_type in (select event_type from dash.event_cell))
    || E'\nAssets: ' || (select string_agg(label, ', ' order by asset) from dash.event_asset where asset in (select asset from dash.event_cell)) || '.';
  select string_agg(line, E'\n' order by first_date, event_type) into v_up from (
    select u.event_type, min(u.local_date) first_date,
      format('%s %s (%s)%s: %s',
        string_agg(case when u.ts_utc is not null and coalesce(u.ts_quality, '') <> 'date_only'
                        then to_char(u.ts_utc at time zone 'UTC', 'Dy DD Mon HH24:MI') || 'Z' else to_char(u.local_date, 'Dy DD Mon') end, ', ' order by u.local_date),
        u.event_type, t.name, case when bool_or(u.is_proxy) then ' [date rule-derived, verify]' else '' end,
        dash.event_cells_short(u.event_type, p_max_cells)) line
    from dash.event_cal u join dash.event_type t using (event_type)
    where u.scheduled and u.local_date >= v_today and u.local_date <= v_today + p_days
    group by u.event_type, t.name) s;
  return v_head || format(E'\nLibrary releases due in the next %s days (from the library''s own calendar, which runs to Jan 2027 and can miss dates; when you know of a release it lacks, use the lookup):\n%s',
    p_days, coalesce(v_up, 'none in the library''s calendar'));
end $$;

-- For the digests: every cell of a release type (p_asset null), or the cells for one release type x asset
-- (both windows), with the type's last and next dates. Any wording for both arguments.
create or replace function dash.event_lookup(p_type text, p_asset text default null, p_win text default '1d') returns text
language plpgsql stable security definer set search_path = dash, public as $$
declare v_types text[]; v_assets text[]; v_t text; v_a text; v_out text := ''; v_dates text; v_lines text; v_missing text; v_name text;
        v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  if not exists (select 1 from dash.event_cell) then return 'EVENT LIBRARY: nothing loaded yet.'; end if;
  v_types := dash.event_match_type(p_type);
  if coalesce(array_length(v_types, 1), 0) = 0 then
    return format('event library: no release type matches "%s". Types: %s.', p_type,
      (select string_agg(event_type || ' = ' || name, ', ' order by event_type) from dash.event_type where event_type in (select event_type from dash.event_cell)));
  end if;
  if p_asset is not null then
    v_assets := dash.event_match_asset(p_asset);
    if coalesce(array_length(v_assets, 1), 0) = 0 then
      return format('event library: no asset matches "%s". Assets: %s.', p_asset, (select string_agg(label, ', ' order by asset) from dash.event_asset));
    end if;
  end if;
  if array_length(v_types, 1) > 4 then
    v_out := format(E'%s release types match "%s" (%s); showing the first 4, name the country for one.\n', array_length(v_types, 1), p_type, array_to_string(v_types, ', '));
    v_types := v_types[1:4];
  end if;
  foreach v_t in array v_types loop
    select name into v_name from dash.event_type where event_type = v_t;
    select concat_ws('; ',
      (select 'last ' || to_char(max(local_date), 'DD Mon YYYY') from dash.event_cal where event_type = v_t and local_date < v_today and scheduled),
      (select 'next ' || string_agg(to_char(local_date, 'DD Mon YYYY') || case when is_proxy then '?' else '' end, ', ' order by local_date)
         from (select local_date, is_proxy from dash.event_cal where event_type = v_t and local_date >= v_today and scheduled order by local_date limit 3) d))
    into v_dates;
    v_out := v_out || format(E'%s (%s%s)\n', v_t, v_name, coalesce('; ' || nullif(v_dates, ''), ''));
    if p_asset is null then
      select string_agg(dash.event_cell_line(c, a.label, a.unit), E'\n' order by (c.q_value_bh < 0.10 and c.n >= 15) desc, c.multiplier desc)
      into v_lines from dash.event_cell c join dash.event_asset a using (asset)
      where c.event_type = v_t and c.period = 'ALL' and c.win = coalesce(p_win, '1d') and c.sample = 'clean';
      select string_agg(a.label, ', ' order by a.asset) into v_missing from dash.event_asset a
      where not exists (select 1 from dash.event_cell c where c.event_type = v_t and c.asset = a.asset and c.period = 'ALL' and c.win = coalesce(p_win, '1d') and c.sample = 'clean');
      v_out := v_out || coalesce(v_lines, 'no cells') || coalesce(E'\nno tested cell (not pre-registered as relevant, no significant spillover): ' || v_missing, '') || E'\n';
    else
      foreach v_a in array v_assets loop
        select string_agg(dash.event_cell_line(c, a.label, a.unit), E'\n' order by c.win)
        into v_lines from dash.event_cell c join dash.event_asset a using (asset)
        where c.event_type = v_t and c.asset = v_a and c.period = 'ALL' and c.sample = 'clean';
        v_out := v_out || coalesce(v_lines, format('%s: no tested cell for %s (not pre-registered as relevant and no significant spillover): event library has no read.',
          (select label from dash.event_asset where asset = v_a), v_name)) || E'\n';
      end loop;
    end if;
  end loop;
  return rtrim(v_out, E'\n');
end $$;

revoke all on function dash.event_num(text) from public, anon, authenticated;
revoke all on function dash.put_event_cells(text, text, text, text) from public, anon, authenticated;
revoke all on function dash.put_event_cal(text, text) from public, anon, authenticated;
revoke all on function dash.event_sgn(numeric, int) from public, anon, authenticated;
revoke all on function dash.event_match_type(text) from public, anon, authenticated;
revoke all on function dash.event_match_asset(text) from public, anon, authenticated;
revoke all on function dash.event_cell_line(dash.event_cell, text, text) from public, anon, authenticated;
revoke all on function dash.event_cells_short(text, int) from public, anon, authenticated;
revoke all on function dash.event_brief(int, int) from public, anon, authenticated;
revoke all on function dash.event_lookup(text, text, text) from public, anon, authenticated;
