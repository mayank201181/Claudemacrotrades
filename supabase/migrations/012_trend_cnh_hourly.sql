-- 012: USDCNH from Yahoo's hourly CNH=X bars, replacing 011's onshore proxy. Yahoo's daily CNH=X
-- series is a single bar, but its hourly bars reach back to Dec 2023; dash-trend builds the daily
-- series from them on the clock of the other 14 pairs (a symbol ending '@1h', see parseYahooHourly)
-- and extends it backwards with the closes earlier runs stored in dash.trend_px. Checked on USDJPY
-- and EURUSD, run both ways on 6 Oct 2026: the same state, age and all 11 signals, dist200 and rv
-- within rounding. The onshore CNY=X (011) froze through Golden Week (USDCNH read STALE), and a
-- CNY fallback would splice two series, so there is none: a failed CNH download is STALE.
-- Until the history covers 3 years of rv20 (about Feb 2027), USDCNH's rv20_pct3y ranks against the rv20
-- values available (from Dec 2023) rather than a full 756.
insert into dash.config (key, value) values ('trend_symbols', '{"USDCNH": ["CNH=X@1h"], "CSI300": ["510300.SS"]}'::jsonb)
on conflict (key) do update set value = excluded.value;
