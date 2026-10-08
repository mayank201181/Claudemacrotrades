-- 011: Trend Monitor symbol proxies (D4). Yahoo serves only the latest day for CNH=X, in every form
-- (date range, range=10y/max, query2, spark; USDCNH=X and CNHUSD=X too), so USDCNH is proxied by the
-- onshore USD/CNY spot, CNY=X: its 2 Oct 2026 close (6.7045) was within 0.03% of USDCNH (6.7061). The
-- CME CNH future (CNH=F) is no substitute: most recent sessions carry no close. CNY=X stops moving on
-- mainland holidays (Golden Week, Lunar New Year), when the onshore market is shut; the monitor then
-- reads USDCNH as STALE, which is the honest answer for an onshore proxy.
-- CSI300 keeps the CSI 300 ETF 510300.SS (010). Whole-key upsert: the value is the full symbol map.
insert into dash.config (key, value) values ('trend_symbols', '{"USDCNH": ["CNY=X"], "CSI300": ["510300.SS"]}'::jsonb)
on conflict (key) do update set value = excluded.value;
