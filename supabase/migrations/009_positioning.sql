-- 009: Positioning tab and the digests' positioning-extremes feed.
--
-- Reads only the market database (msd.series, msd.observations, msd.markets,
-- msd.positioning_measures). Nothing is stored: every call computes from the latest
-- vintage of each observation, so the page and the digests always see the same numbers.
--
-- Design decisions
--  * dash.pos_meta() names every series shown, its group, its kind and its LEAN: +1 when a
--    higher reading means the crowd or the flow is on the market's "+" side (msd.markets
--    sign_convention: + = JPY stronger for USDJPY, + = yields lower for rates, + = price higher
--    otherwise), -1 when a higher reading is on the "-" side (Japanese retail net long USD, the
--    put/call ratio, USD/INR risk reversals, residents buying foreign bonds), 0 when it has no
--    direction (implied vol, open interest, official reserves).
--  * Kinds: spec (futures positioning of speculators / managed money / asset managers), retail,
--    flow (foreign flows; daily ones are 5-day sums), sentiment, skew, leverage (margin debt),
--    basis (leveraged funds in Treasury futures, which is mostly the cash-futures basis trade and
--    not a view on yields), vol, oi (open interest: participation, no direction), official
--    (reserves, intervention, central-bank forwards, dealer inventory), pricing (CNH-CNY spread).
--  * Basis: 'level' ranks the reading itself; 'change' ranks its change over the window (4 weeks
--    for weekly, 20 sessions for daily, 3 months for monthly), for stocks that trend for structural
--    reasons (reserves, holdings, margin debt).
--  * pct = the reading's percentile in the series' own last 3 years, including today
--    ((below + half of ties - 1/2) / (n - 1): the 3-year high is 100, the low 0), shown only with at
--    least two-thirds of a 3-year history. pct_all is the same against the full history since 2015
--    (needs 5 years). rec = the full-history high or low.
--  * ext = +1 at or above the 90th percentile, -1 at or below the 10th. In market terms the crowd is
--    at its most long the market's "+" side when lean * ext = +1.
--  * Window move: for weekly series the last 4 readings; daily 20 sessions; monthly 3 months. Flow
--    series use the cumulative flow over the window (four non-overlapping 5-day sums for daily ones).
--  * Price: the market's close series. Moves are % for FX, equities and commodities and bp for
--    yields, quoted for the instrument as it trades (USDJPY, the 10y yield); mdir is the move's sign in
--    market terms. z_win = log move (bp for yields) / (daily sigma over the last 60 sessions x
--    sqrt(sessions in the window)). move_since is from the reading's date to the latest close, so a
--    Tuesday CFTC reading shows what happened after it. A monthly (half-yearly) reading is dated at
--    the end of the month (half-year) it covers. Prices are used only when the close series has at
--    least 40 closes in the last 90 days (Dubai has not).
--  * div (divergence): a directional series whose window move is at least half its own 3-year
--    standard deviation, against a price move of at least 0.5 sigma the other way. +1 = the crowd
--    added to the "+" side while the market fell ("buying into weakness"), -1 = it cut into strength.
--  * stale: older than the series' publication lag plus one period plus 3 days.

create or replace function dash.pos_meta()
returns table(series_id text, market_id text, grp text, ord int, kind text, lean int, centred boolean,
              basis text, label text, caveat text, dup_of text)
language sql immutable set search_path = dash, public as $$
  select * from (values
  -- FX ---------------------------------------------------------------------------------
  ('FX_USD.POS_COT_NET_PCT_OI', 'FX_USD', 'FX', 100, 'spec', 1, true, 'level', 'CFTC: speculators net, USD index futures (% of open interest)', 'legacy non-commercial; a small contract (ICE DX)', null),
  ('FX_EURUSD.POS_COT_NET_PCT_OI', 'FX_EURUSD', 'FX', 110, 'spec', 1, true, 'level', 'CFTC: speculators net, EUR futures (% of open interest)', 'legacy non-commercial', null),
  ('FX_AUDUSD.POS_COT_NET_PCT_OI', 'FX_AUDUSD', 'FX', 120, 'spec', 1, true, 'level', 'CFTC: speculators net, AUD futures (% of open interest)', 'legacy non-commercial', null),
  ('FX_USDJPY.POS_COT_NET_PCT_OI', 'FX_USDJPY', 'FX', 130, 'spec', 1, true, 'level', 'CFTC: speculators net, JPY futures (% of open interest; + = long JPY)', 'legacy non-commercial', null),
  ('FX_USDJPY.POS_TFX_NET_LONG_W', 'FX_USDJPY', 'FX', 131, 'retail', -1, true, 'level', 'Japanese retail (TFX Click 365): net long USD/JPY, contracts', '+ = retail long USD, short JPY; retail tends to fade the trend; history from Nov 2022', null),
  ('FX_USDJPY.POS_MOF_FOREIGN_BOND_FLOWS_W', 'FX_USDJPY', 'FX', 132, 'flow', -1, true, 'level', 'Japanese residents: net purchases of foreign bonds, weekly (JPY 100m)', '+ = buying foreign bonds, i.e. selling JPY unless hedged', null),
  ('FX_USDJPY.POS_JPX_FOREIGN_NET_W', 'FX_USDJPY', 'FX', 133, 'flow', 1, true, 'level', 'Foreign investors: net purchases of Japanese stocks, weekly (JPY thousand)', 'often FX-hedged; same data as the Nikkei row', 'EQ_N225.POS_JPX_FOREIGN_NET_W'),
  ('FX_USDJPY.POS_TFX_OI', 'FX_USDJPY', 'FX', 134, 'oi', 0, false, 'level', 'Japanese retail (TFX Click 365): USD/JPY open interest', 'no long/short split', null),
  ('FX_USDJPY.POS_MOF_INTERVENTION_M', 'FX_USDJPY', 'FX', 135, 'official', 0, true, 'level', 'MoF intervention, monthly (JPY bn; + = JPY bought)', null, null),
  ('FX_USDJPY.POS_BOJ_CA_GAP', 'FX_USDJPY', 'FX', 136, 'official', 0, true, 'level', 'BoJ current-account forecast gap (JPY 100m)', 'a fiscal forecast error, not an intervention estimate', null),
  ('FX_USDCNH.POS_CNH_CNY_SPREAD', 'FX_USDCNH', 'FX', 140, 'pricing', -1, true, 'level', 'USDCNH minus USDCNY (offshore premium)', '+ = offshore CNH weaker than onshore', null),
  ('FX_USDCNH.POS_SAFE_BANK_SETTLEMENT_M', 'FX_USDCNH', 'FX', 141, 'flow', 1, true, 'level', 'SAFE: banks'' FX settlement minus sales, monthly (USD 100m)', '+ = clients net selling FX for CNY; about 2 months lag', null),
  ('FX_USDCNH.POS_SOUTHBOUND_NET_5D', 'FX_USDCNH', 'FX', 142, 'flow', -1, true, 'level', 'Southbound Connect: mainland net buying of Hong Kong stocks, 5 days (HKD mn)', 'money leaving the mainland; same data as the Hang Seng row; history from Mar 2026', 'EQ_HSI.POS_SOUTHBOUND_NET_5D'),
  ('FX_USDCNH.POS_SGX_CNH_FUT_OI', 'FX_USDCNH', 'FX', 143, 'oi', 0, false, 'level', 'SGX USD/CNH futures open interest', null, null),
  ('FX_USDCNH.POS_HKEX_CNH_FUT_OI', 'FX_USDCNH', 'FX', 144, 'oi', 0, false, 'level', 'HKEX USD/CNH futures open interest', 'history from Oct 2025', null),
  ('FX_USDINR.POS_INR_IV_RR25_1M_FBIL', 'FX_USDINR', 'FX', 150, 'skew', -1, true, 'level', 'USD/INR 1M 25-delta risk reversal (vol pts)', '+ = USD calls over puts: INR downside priced', null),
  ('FX_USDINR.POS_INR_IV_RR25_3M_FBIL', 'FX_USDINR', 'FX', 151, 'skew', -1, true, 'level', 'USD/INR 3M 25-delta risk reversal (vol pts)', '+ = USD calls over puts: INR downside priced', null),
  ('FX_USDINR.POS_NSDL_FPI_NET_5D', 'FX_USDINR', 'FX', 152, 'flow', 1, true, 'level', 'Foreign portfolio investors: net buying of Indian equities, 5 days (INR crore)', 'NSDL; history accrues from Oct 2026', null),
  ('FX_USDINR.POS_RBI_FX_RESERVES_W', 'FX_USDINR', 'FX', 153, 'official', 0, false, 'change', 'RBI FX reserves, 4-week change (USD mn)', 'includes valuation; a rise is RBI buying USD or revaluation', null),
  ('FX_USDINR.POS_RBI_FWD_BOOK_M', 'FX_USDINR', 'FX', 154, 'official', 0, true, 'level', 'RBI net forward book up to 1 year (USD)', 'negative = RBI net short USD forward (INR defence); 1-2 months lag', null),
  ('FX_USDINR.POS_SGX_INR_FUT_OI', 'FX_USDINR', 'FX', 155, 'oi', 0, false, 'level', 'SGX USD/INR futures open interest', null, null),
  ('FX_USDKRW.POS_KRX_FOREIGN_NET_5D', 'FX_USDKRW', 'FX', 160, 'flow', 1, true, 'level', 'Foreign investors: net buying of Korean stocks, 5 days (KRW 100m)', 'same data as the KOSPI row', 'EQ_KOSPI.POS_KRX_FOREIGN_NET_5D'),
  ('FX_USDKRW.POS_BOK_FX_RESERVES_M', 'FX_USDKRW', 'FX', 161, 'official', 0, false, 'change', 'BoK FX reserves, 3-month change (USD)', 'includes valuation', null),
  ('FX_USDKRW.POS_SGX_KRW_MINI_OI', 'FX_USDKRW', 'FX', 162, 'oi', 0, false, 'level', 'SGX KRW futures open interest', null, null),
  ('FX_USDTWD.POS_TWSE_FOREIGN_NET_5D', 'FX_USDTWD', 'FX', 170, 'flow', 1, true, 'level', 'Foreign investors: net buying of Taiwan stocks, 5 days (TWD)', 'same data as the TAIEX row', 'EQ_TAIEX.POS_TWSE_FOREIGN_NET_5D'),
  ('FX_USDTWD.POS_CBC_FX_RESERVES_M', 'FX_USDTWD', 'FX', 171, 'official', 0, false, 'change', 'CBC FX reserves, 3-month change (USD mn)', 'includes valuation', null),
  ('SG.FX_RESERVES', 'FX_USDSGD', 'FX', 180, 'official', 0, false, 'change', 'MAS official reserves, 3-month change (USD mn)', 'includes valuation', null),
  ('FX_USDSGD.POS_MAS_NET_INTERVENTION_H', 'FX_USDSGD', 'FX', 181, 'official', 0, true, 'level', 'MAS net FX purchases, half-yearly (USD bn)', '+ = MAS bought FX, leaning against SGD strength; about 9 months lag', null),
  -- Rates ------------------------------------------------------------------------------
  ('RT_UST2.POS_TFF_LEV_NET_TU', 'RT_UST2', 'Rates', 200, 'basis', 1, true, 'level', 'CFTC: leveraged funds net, 2y T-note futures (contracts)', 'mostly the cash-futures basis trade, not a view on yields', null),
  ('RT_UST5.POS_TFF_LEV_NET_FV', 'RT_UST5', 'Rates', 201, 'basis', 1, true, 'level', 'CFTC: leveraged funds net, 5y T-note futures (contracts)', 'mostly the cash-futures basis trade, not a view on yields', null),
  ('RT_UST10.POS_TFF_LEV_NET_TY', 'RT_UST10', 'Rates', 202, 'basis', 1, true, 'level', 'CFTC: leveraged funds net, 10y T-note futures (contracts)', 'mostly the cash-futures basis trade, not a view on yields', null),
  ('RT_UST30.POS_TFF_LEV_NET_US', 'RT_UST30', 'Rates', 203, 'basis', 1, true, 'level', 'CFTC: leveraged funds net, T-bond futures (contracts)', 'mostly the cash-futures basis trade, not a view on yields', null),
  ('RT_UST10.POS_PD_NET_POSITIONS', 'RT_UST10', 'Rates', 210, 'official', 0, true, 'level', 'Primary dealers: net positions in coupons (USD mn)', 'dealer inventory; high = supply not yet placed', null),
  ('US.TIC_FOREIGN_UST', 'RT_UST10', 'Rates', 211, 'flow', 1, true, 'change', 'Foreign holdings of Treasuries, 3-month change (USD bn)', 'includes valuation; about 2.5 months lag', null),
  ('RT_JGB10.POS_MOF_FOREIGN_BOND_FLOWS_W', 'RT_JGB10', 'Rates', 220, 'flow', 1, true, 'level', 'Non-residents: net purchases of Japanese bonds, weekly (JPY 100m)', 'all issuers and maturities', null),
  ('RT_JGB10.POS_JSDA_INVESTOR_NET_M', 'RT_JGB10', 'Rates', 221, 'flow', 1, true, 'level', 'Foreigners: net purchases of long-term JGBs, monthly (JPY 100m)', null, null),
  ('RT_KTB10.POS_FOREIGN_BOND_NET_M', 'RT_KTB10', 'Rates', 230, 'flow', 1, true, 'level', 'Foreigners: net buying of Korean government bonds, monthly (KRW 100m)', null, null),
  ('RT_CGB10.POS_FOREIGN_HOLDINGS_M', 'RT_CGB10', 'Rates', 240, 'flow', 1, true, 'change', 'Foreign holdings of CGBs, 3-month change (CNY 100m)', 'custody data; history from Mar 2021', null),
  ('RT_IGB10.POS_FPI_DEBT_NET_5D', 'RT_IGB10', 'Rates', 250, 'flow', 1, true, 'level', 'Foreign portfolio investors: net buying of Indian debt, 5 days (INR crore)', 'history accrues from Oct 2026', null),
  -- Equities ---------------------------------------------------------------------------
  ('EQ_SPX.POS_TFF_ASSETMGR_NET_ES', 'EQ_SPX', 'Equities', 300, 'spec', 1, true, 'level', 'CFTC: asset managers net, S&P e-mini futures (contracts)', 'real money; structurally long', null),
  ('EQ_SPX.POS_TFF_LEV_NET_ES', 'EQ_SPX', 'Equities', 301, 'spec', 1, true, 'level', 'CFTC: leveraged funds net, S&P e-mini futures (contracts)', 'includes relative-value hedges', null),
  ('EQ_NDX.POS_TFF_LEV_NET_NQ', 'EQ_NDX', 'Equities', 302, 'spec', 1, true, 'level', 'CFTC: leveraged funds net, Nasdaq e-mini futures (contracts)', null, null),
  ('EQ_SPX.POS_AAII_BULL_BEAR', 'EQ_SPX', 'Equities', 310, 'sentiment', 1, true, 'level', 'AAII survey: bulls minus bears (pts)', null, null),
  ('EQ_SPX.POS_CBOE_PUT_CALL', 'EQ_SPX', 'Equities', 311, 'sentiment', -1, false, 'level', 'Cboe equity put/call ratio', 'high = heavy hedging (a bearish crowd)', null),
  ('EQ_SPX.POS_VIX_TERM', 'EQ_SPX', 'Equities', 312, 'sentiment', -1, false, 'level', 'VIX divided by VIX3M', 'above 1 = near-term stress (inverted curve)', null),
  ('EQ_N225.POS_JPX_FOREIGN_NET_W', 'EQ_N225', 'Equities', 320, 'flow', 1, true, 'level', 'Foreign investors: net purchases of Japanese stocks, weekly (JPY thousand)', null, null),
  ('EQ_KOSPI.POS_KRX_FOREIGN_NET_5D', 'EQ_KOSPI', 'Equities', 330, 'flow', 1, true, 'level', 'Foreign investors: net buying of Korean stocks, 5 days (KRW 100m)', null, null),
  ('EQ_TAIEX.POS_TWSE_FOREIGN_NET_5D', 'EQ_TAIEX', 'Equities', 340, 'flow', 1, true, 'level', 'Foreign investors: net buying of Taiwan stocks, 5 days (TWD)', null, null),
  ('EQ_TAIEX.POS_TAIFEX_FOREIGN_NET_OI', 'EQ_TAIEX', 'Equities', 341, 'spec', 1, true, 'level', 'Foreign institutions: net TAIEX futures open interest (contracts)', 'history from Sep 2023', null),
  ('EQ_NIFTY.POS_NSE_FII_NET_5D', 'EQ_NIFTY', 'Equities', 350, 'flow', 1, true, 'level', 'FIIs: net cash-equity buying, India, 5 days (INR crore)', 'NSE; history accrues from Oct 2026', null),
  ('EQ_HSI.POS_SOUTHBOUND_NET_5D', 'EQ_HSI', 'Equities', 360, 'flow', 1, true, 'level', 'Southbound Connect: mainland net buying of Hong Kong stocks, 5 days (HKD mn)', 'history from Mar 2026', null),
  ('EQ_CSI300.POS_MARGIN_FINANCING', 'EQ_CSI300', 'Equities', 370, 'leverage', 1, true, 'change', 'A-share margin financing, 20-session change (CNY 100m)', 'Shanghai and Shenzhen', null),
  -- Commodities ------------------------------------------------------------------------
  ('CM_GOLD.POS_CFTC_MM_NET', 'CM_GOLD', 'Commodities', 400, 'spec', 1, true, 'level', 'CFTC: managed money net, gold futures (contracts)', null, null),
  ('CM_COPPER.POS_CFTC_MM_NET', 'CM_COPPER', 'Commodities', 410, 'spec', 1, true, 'level', 'CFTC: managed money net, Comex copper (contracts)', null, null),
  ('CM_WTI.POS_CFTC_MM_NET', 'CM_WTI', 'Commodities', 420, 'spec', 1, true, 'level', 'CFTC: managed money net, WTI (contracts)', null, null),
  ('CM_BRENT.POS_ICE_COT_MM_NET', 'CM_BRENT', 'Commodities', 421, 'spec', 1, true, 'level', 'ICE: managed money net, Brent (lots)', null, null),
  ('CM_DUBAI.POS_ICE_COT_MM_NET', 'CM_DUBAI', 'Commodities', 422, 'spec', 1, true, 'level', 'ICE: managed money net, Dubai 1st line (lots)', 'history from Jan 2023; no Dubai price series', null),
  ('CM_HH.POS_CFTC_MM_NET', 'CM_HH', 'Commodities', 430, 'spec', 1, true, 'level', 'CFTC: managed money net, Henry Hub (contracts)', null, null),
  ('CM_IRONORE.POS_SGX_FEF_OI', 'CM_IRONORE', 'Commodities', 440, 'oi', 0, false, 'level', 'SGX iron ore futures open interest', 'no participant split', null),
  -- Implied vol --------------------------------------------------------------------------
  ('RT_UST10.POS_IV_1M', 'RT_UST10', 'Vol', 500, 'vol', 0, false, 'level', 'MOVE: 1-month Treasury option vol (bp)', 'history from Oct 2019', null),
  ('EQ_SX5E.POS_IV_30D', 'EQ_SX5E', 'Vol', 510, 'vol', 0, false, 'level', 'VSTOXX: Euro Stoxx 50 implied vol', null, null),
  ('EQ_N225.POS_IV_30D', 'EQ_N225', 'Vol', 520, 'vol', 0, false, 'level', 'Nikkei VI: Nikkei 225 implied vol', null, null),
  ('EQ_KOSPI.POS_IV_30D', 'EQ_KOSPI', 'Vol', 521, 'vol', 0, false, 'level', 'V-KOSPI 200: KOSPI implied vol', null, null),
  ('EQ_TAIEX.POS_IV_30D', 'EQ_TAIEX', 'Vol', 522, 'vol', 0, false, 'level', 'TAIWAN VIX: TAIEX implied vol', 'history from Nov 2019', null),
  ('EQ_HSI.POS_IV_30D', 'EQ_HSI', 'Vol', 523, 'vol', 0, false, 'level', 'VHSI: Hang Seng implied vol', null, null),
  ('EQ_HSI.POS_FXI_IV_30D', 'EQ_HSI', 'Vol', 524, 'vol', 0, false, 'level', 'VXFXI: China large-cap ETF implied vol', null, null),
  ('EQ_NIFTY.POS_IV_30D', 'EQ_NIFTY', 'Vol', 525, 'vol', 0, false, 'level', 'India VIX: Nifty implied vol', null, null),
  ('EQ_ASX200.POS_IV_30D', 'EQ_ASX200', 'Vol', 526, 'vol', 0, false, 'level', 'A-VIX: ASX 200 implied vol', null, null),
  ('GL_GLOBAL.POS_EM_IV_30D', 'GL_GLOBAL', 'Vol', 530, 'vol', 0, false, 'level', 'VXEEM: emerging-market ETF implied vol', null, null),
  ('CM_GOLD.POS_IV_30D', 'CM_GOLD', 'Vol', 540, 'vol', 0, false, 'level', 'GVZ: gold implied vol', null, null),
  ('CM_WTI.POS_IV_30D', 'CM_WTI', 'Vol', 541, 'vol', 0, false, 'level', 'OVX: crude oil implied vol', null, null),
  ('FX_USDINR.POS_INR_IV_1M_FBIL', 'FX_USDINR', 'Vol', 550, 'vol', 0, false, 'level', 'USD/INR 1M ATM implied vol (FBIL)', null, null),
  ('FX_USDINR.POS_INR_IV_3M_FBIL', 'FX_USDINR', 'Vol', 551, 'vol', 0, false, 'level', 'USD/INR 3M ATM implied vol (FBIL)', null, null),
  ('FX_USDINR.POS_INR_IV_1W_1M', 'FX_USDINR', 'Vol', 552, 'vol', 0, true, 'level', 'USD/INR 1W minus 1M implied vol: event premium (vol pts)', null, null),
  ('FX_USDINR.POS_INR_IV_STR25_1M_FBIL', 'FX_USDINR', 'Vol', 553, 'vol', 0, false, 'level', 'USD/INR 1M 25-delta strangle: wings (vol pts)', null, null)
  ) v(series_id, market_id, grp, ord, kind, lean, centred, basis, label, caveat, dup_of)
$$;

-- How each market is named on the page: the side the crowd is on (asset) and the price quoted (px_lbl).
create or replace function dash.pos_market()
returns table(market_id text, asset text, px_lbl text)
language sql immutable set search_path = dash, public as $$
  select * from (values
  ('FX_USD', 'USD', 'USD index'), ('FX_EURUSD', 'EUR', 'EURUSD'), ('FX_AUDUSD', 'AUD', 'AUDUSD'), ('FX_USDJPY', 'JPY', 'USDJPY'),
  ('FX_USDCNH', 'CNH', 'USDCNH'), ('FX_USDINR', 'INR', 'USDINR'), ('FX_USDKRW', 'KRW', 'USDKRW'), ('FX_USDTWD', 'TWD', 'USDTWD'),
  ('FX_USDSGD', 'SGD', 'USDSGD'),
  ('RT_UST2', 'UST 2y', 'UST 2y yield'), ('RT_UST5', 'UST 5y', 'UST 5y yield'), ('RT_UST10', 'UST 10y', 'UST 10y yield'),
  ('RT_UST30', 'UST 30y', 'UST 30y yield'), ('RT_JGB10', 'JGBs', 'JGB 10y yield'), ('RT_KTB10', 'KTBs', 'KTB 10y yield'),
  ('RT_CGB10', 'CGBs', 'CGB 10y yield'), ('RT_IGB10', 'IGBs', 'IGB 10y yield'),
  ('EQ_SPX', 'S&P 500', 'S&P 500'), ('EQ_NDX', 'Nasdaq 100', 'Nasdaq 100'), ('EQ_N225', 'Nikkei', 'Nikkei 225'),
  ('EQ_KOSPI', 'KOSPI', 'KOSPI'), ('EQ_TAIEX', 'TAIEX', 'TAIEX'), ('EQ_NIFTY', 'Nifty', 'Nifty 50'), ('EQ_HSI', 'Hang Seng', 'Hang Seng'),
  ('EQ_CSI300', 'CSI 300', 'CSI 300'), ('EQ_ASX200', 'ASX 200', 'ASX 200'), ('EQ_SX5E', 'Euro Stoxx 50', 'Euro Stoxx 50'),
  ('CM_GOLD', 'gold', 'gold'), ('CM_COPPER', 'copper', 'copper'), ('CM_WTI', 'WTI', 'WTI'), ('CM_BRENT', 'Brent', 'Brent'),
  ('CM_DUBAI', 'Dubai', 'Dubai'), ('CM_HH', 'Henry Hub', 'Henry Hub'), ('CM_IRONORE', 'iron ore', 'iron ore'),
  ('GL_GLOBAL', 'EM', null)
  ) v(market_id, asset, px_lbl)
$$;

-- One row per series, as jsonb. Internal: no access gate, so not callable from the site.
-- jit is off: compiling this many expressions costs seconds and the query itself runs in under one.
create or replace function dash.pos_rows()
returns setof jsonb
language sql stable security definer set search_path = dash, msd, public set jit = off as $$
with m as (
  select pm.*, s.frequency::text f, s.unit, coalesce(s.expected_lag_days, 0)::int lagd,
         mk.close_series_id cs, coalesce(mk.close_sign, 1)::int csign, mk.asset_class::text = 'RATES' rates,
         pk.asset, pk.px_lbl, ms.status::text status, ms.gap_note, ms.sign_note,
         case s.frequency when 'D' then 5 else 1 end k1,
         case s.frequency when 'D' then 20 when 'W' then 4 when 'M' then 3 else 2 end k4,
         case s.frequency when 'D' then 480 when 'W' then 104 when 'M' then 24 else 4 end nmin,
         case s.frequency when 'D' then 1200 when 'W' then 260 when 'M' then 60 else 10 end nmin_all,
         case s.frequency when 'D' then 4 when 'W' then 7 when 'M' then 35 else 200 end cad,
         case s.frequency when 'M' then interval '1 month' when 'Q' then interval '6 months' else interval '0' end span
  from dash.pos_meta() pm
  join msd.series s on s.series_id = pm.series_id
  left join msd.markets mk on mk.market_id = pm.market_id
  left join dash.pos_market() pk on pk.market_id = pm.market_id
  left join msd.positioning_measures ms on ms.series_id = pm.series_id and ms.market_id = pm.market_id
),
o as (
  select distinct on (x.series_id, x.as_of) x.series_id, x.as_of d, x.value::float8 v
  from msd.observations x
  where x.series_id in (select series_id from m) and x.value is not null
  order by x.series_id, x.as_of, x.vintage_date desc
),
r1 as (
  select o.series_id, o.d, o.v,
    o.v - lag(o.v, m.k1) over w c1,
    o.v - lag(o.v, m.k4) over w c4,
    lag(o.d, m.k4) over w d4,
    case when m.f = 'D' then o.v + lag(o.v, 5) over w + lag(o.v, 10) over w + lag(o.v, 15) over w
         when m.f = 'W' then o.v + lag(o.v, 1) over w + lag(o.v, 2) over w + lag(o.v, 3) over w
         else o.v + lag(o.v, 1) over w + lag(o.v, 2) over w end cum
  from o join m using (series_id)
  window w as (partition by o.series_id order by o.d)
),
r2 as (
  select r1.*, case when m.basis = 'change' then r1.c4 else r1.v end x,
         case when m.kind = 'flow' and m.basis <> 'change' then r1.cum else r1.c4 end mv
  from r1 join m using (series_id)
),
r3 as (
  select r2.*, lag(r2.x, m.k4) over (partition by r2.series_id order by r2.d) x4
  from r2 join m using (series_id)
),
lt as (select distinct on (series_id) * from r3 order by series_id, d desc),
st as (
  select w.series_id, count(w.x) n3, avg(w.x) mu, stddev_samp(w.x) sd,
    count(*) filter (where w.x < l.x) lo, count(*) filter (where w.x = l.x) eq,
    count(*) filter (where w.x < l.x4) lo4, count(*) filter (where w.x = l.x4) eq4,
    percentile_cont(0.1) within group (order by w.x) p10,
    percentile_cont(0.5) within group (order by w.x) p50,
    percentile_cont(0.9) within group (order by w.x) p90,
    stddev_samp(w.mv) sd_mv
  from r3 w join lt l using (series_id)
  where w.d > l.d - interval '3 years'
  group by w.series_id
),
sa as (
  select w.series_id, count(w.x) n_all, count(*) filter (where w.x < l.x) lo_all, count(*) filter (where w.x = l.x) eq_all,
    max(w.x) mx_all, min(w.x) mn_all, min(w.d) first_d
  from r3 w join lt l using (series_id)
  group by w.series_id
),
-- Daily sigma of each close series over its last 60 sessions (bp for yields, log returns otherwise).
sig as (
  select q.cs, (select stddev_samp(ret) from (
      select case when q.rates then (z.c - lag(z.c) over (order by z.d)) * 100
                  when z.c > 0 and lag(z.c) over (order by z.d) > 0 then ln(z.c / lag(z.c) over (order by z.d)) end ret
      from (select distinct on (x.as_of) x.as_of d, x.value::float8 c from msd.observations x
            where x.series_id = q.cs and x.value is not null and x.as_of > current_date - 140
            order by x.as_of desc, x.vintage_date desc limit 61) z) y) sg,
    (select count(*) from (select distinct x.as_of from msd.observations x where x.series_id = q.cs and x.value is not null
                           and x.as_of > current_date - 90) z) n90
  from (select distinct cs, rates from m where cs is not null) q
),
b as (
  select m.*, l.d, l.v, l.x, l.x4, l.c1, l.c4, l.mv, l.d4,
    (l.d + m.span - case when m.span > interval '0' then interval '1 day' else interval '0' end)::date de,
    st.n3, st.mu, st.sd, st.p10, st.p50, st.p90, st.sd_mv,
    case when st.n3 >= m.nmin and st.n3 > 1 and l.x is not null then (st.lo + 0.5 * st.eq - 0.5) / (st.n3 - 1) end pct,
    case when st.n3 >= m.nmin and st.n3 > 1 and l.x4 is not null then (st.lo4 + 0.5 * st.eq4 - 0.5) / (st.n3 - 1) end pct_prev,
    case when sa.n_all >= m.nmin_all and sa.n_all > 1 and l.x is not null then (sa.lo_all + 0.5 * sa.eq_all - 0.5) / (sa.n_all - 1) end pct_all,
    case when sa.n_all >= m.nmin_all and l.x is not null then case when l.x >= sa.mx_all then 'high' when l.x <= sa.mn_all then 'low' end end rec,
    sa.first_d, sa.n_all,
    pn.d pn_d, pn.c pn_c, pa.d pa_d, pa.c pa_c, pb.d pb_d, pb.c pb_c, sig.sg,
    (select count(distinct x.as_of) from msd.observations x where x.series_id = m.cs and x.as_of > pb.d and x.as_of <= pa.d) sess
  from m
  join lt l using (series_id)
  left join st using (series_id)
  left join sa using (series_id)
  left join lateral (select x.as_of d, x.value::float8 c from msd.observations x where x.series_id = m.cs and x.value is not null
                     order by x.as_of desc, x.vintage_date desc limit 1) pn on true
  left join lateral (select x.as_of d, x.value::float8 c from msd.observations x where x.series_id = m.cs and x.value is not null
                     and x.as_of <= (l.d + m.span - case when m.span > interval '0' then interval '1 day' else interval '0' end)::date
                     and x.as_of > (l.d + m.span - case when m.span > interval '0' then interval '1 day' else interval '0' end)::date - 7
                     order by x.as_of desc, x.vintage_date desc limit 1) pa on true
  left join lateral (select x.as_of d, x.value::float8 c from msd.observations x where x.series_id = m.cs and x.value is not null
                     and x.as_of <= (l.d4 + m.span - case when m.span > interval '0' then interval '1 day' else interval '0' end)::date
                     and x.as_of > (l.d4 + m.span - case when m.span > interval '0' then interval '1 day' else interval '0' end)::date - 7
                     order by x.as_of desc, x.vintage_date desc limit 1) pb on true
  left join sig on sig.cs = m.cs and sig.n90 >= 40
),
c as (
  select b.*,
    case when pct >= 0.9 then 1 when pct <= 0.1 then -1 else 0 end ext,
    case when sg is null or pa_c is null or pb_c is null then null when rates then (pa_c - pb_c) * 100 when pb_c > 0 then (pa_c / pb_c - 1) * 100 end move_win,
    case when sg is null or pn_c is null or pa_c is null or pn_d <= pa_d then null when rates then (pn_c - pa_c) * 100 when pa_c > 0 then (pn_c / pa_c - 1) * 100 end move_since,
    case when pa_c is null or pb_c is null or sg is null or sg = 0 or sess < 1 then null
         when rates then (pa_c - pb_c) * 100 / (sg * sqrt(sess))
         when pa_c > 0 and pb_c > 0 then ln(pa_c / pb_c) / (sg * sqrt(sess)) end z_win
  from b
),
e as (
  select c.*,
    csign * sign(move_win)::int mdir,
    case when lean <> 0 and kind in ('spec', 'retail', 'flow', 'sentiment', 'skew', 'leverage')
          and mv is not null and sd_mv > 0 and abs(mv) >= 0.5 * sd_mv
          and z_win is not null and abs(z_win) >= 0.5
          and sign(lean * mv) <> csign * sign(move_win)
         then sign(lean * mv)::int else 0 end div,
    (current_date - d) > lagd + cad + 3 stale
  from c
)
select jsonb_strip_nulls(jsonb_build_object(
  'id', series_id, 'market', market_id, 'grp', grp, 'ord', ord, 'kind', kind, 'lean', lean, 'centred', centred, 'basis', basis,
  'label', label, 'caveat', caveat, 'dup_of', dup_of, 'asset', asset, 'px_lbl', px_lbl, 'rates', rates, 'f', f, 'unit', unit,
  'status', status, 'gap_note', gap_note, 'sign_note', sign_note,
  'd', d, 'age', current_date - d, 'stale', stale, 'v', v, 'x', x, 'c1', c1, 'c4', c4, 'mv', mv, 'd4', d4,
  'n3', n3, 'z', case when sd > 0 then (x - mu) / sd end, 'p10', p10, 'p50', p50, 'p90', p90,
  'pct', round(pct::numeric, 4), 'pct_prev', round(pct_prev::numeric, 4), 'pct_all', round(pct_all::numeric, 4),
  'yrs_all', round(((d - first_d) / 365.25)::numeric, 1), 'rec', rec, 'ext', ext,
  'side', case when centred and lean <> 0 and v <> 0 then lean * sign(v)::int end,
  'de', de, 'px_d', case when sg is not null then pn_d end, 'px', case when sg is not null then pn_c end, 'move_win', round(move_win::numeric, 2), 'move_since', round(move_since::numeric, 2),
  'since_d', case when move_since is not null then pn_d end, 'z_win', round(z_win::numeric, 2), 'mdir', mdir, 'div', div,
  'read', nullif(concat_ws('; ',
    case when rec is not null and kind not in ('oi', 'official') then
      case when kind = 'flow' then case when (case rec when 'high' then 1 else -1 end) * lean > 0 then 'record inflow' else 'record outflow' end
           else 'record ' || rec end || ' since ' || to_char(first_d, 'YYYY') end,
    case when coalesce(ext, 0) = 0 then null
      when kind = 'vol' then case when ext > 0 then 'implied vol in its top decile (stress priced)' else 'implied vol in its bottom decile (calm priced)' end
      when kind = 'oi' then case when ext > 0 then 'open interest in its top decile: heavy participation' else 'open interest in its bottom decile: light participation' end
      when kind = 'official' then case when basis = 'change' then case when ext > 0 then 'biggest rise in 3 years' else 'biggest fall in 3 years' end
                                       else case when ext > 0 then 'top decile of its 3-year range' else 'bottom decile of its 3-year range' end end
      when kind = 'basis' then case when ext > 0 then 'leveraged funds least short in 3 years: basis trade shrinking' else 'leveraged funds most short in 3 years: basis trade at its largest' end
      when kind = 'flow' then case when lean * ext > 0 then 'biggest inflow to ' else 'biggest outflow from ' end || asset || ' in 3 years'
      when kind = 'leverage' then case when lean * ext > 0 then 'margin debt rising fastest in 3 years' else 'margin debt falling fastest in 3 years' end
      when kind = 'sentiment' then case when lean * ext > 0 then 'most bullish on ' else 'most bearish on ' end || asset || ' in 3 years'
      when kind = 'skew' then 'options price the most ' || asset || case when lean * ext > 0 then ' upside' else ' downside' end || ' in 3 years'
      when kind = 'pricing' then 'offshore ' || asset || case when lean * ext > 0 then ' richest' else ' cheapest' end || ' to onshore in 3 years'
      -- spec / retail: the net side, and whether the extreme is toward it ("most long") or away from it ("least long")
      when not centred or v = 0 or lean * sign(v) = lean * ext then
        case when kind = 'retail' then 'retail ' else '' end || case when lean * ext > 0 then 'most long ' else 'most short ' end || asset || ' in 3 years'
      else case when kind = 'retail' then 'retail ' else '' end || case when lean * sign(v) > 0 then 'least long ' else 'least short ' end || asset || ' in 3 years' end,
    case when coalesce(div, 0) = 0 then null
      when kind = 'sentiment' then case when div > 0 then 'turning bullish on ' || asset || ' as it falls' else 'turning bearish on ' || asset || ' as it rises' end
      when kind = 'skew' then case when div > 0 then 'options leaning to ' || asset || ' upside as it falls' else 'options leaning to ' || asset || ' downside as it rises' end
      when kind = 'leverage' then case when div > 0 then 'margin debt rising as ' || asset || ' falls' else 'margin debt falling as ' || asset || ' rises' end
      else case when kind = 'retail' then 'retail ' else '' end || case when div > 0 then 'buying ' || asset || ' into weakness' else 'selling ' || asset || ' into strength' end end), '')
))
from e
order by ord;
$$;

-- The page.
create or replace function dash.pos_board()
returns jsonb
language sql stable security definer set search_path = dash, msd, public as $$
  select jsonb_build_object(
    'asof', now(),
    'rows', coalesce((select jsonb_agg(r order by (r->>'ord')::int) from dash.pos_rows() r), '[]'::jsonb),
    'blank', coalesce((select jsonb_agg(jsonb_build_object('market', pm.market_id, 'measure', pm.measure, 'note', pm.gap_note) order by pm.market_id, pm.measure)
                       from msd.positioning_measures pm where pm.status::text = 'BLANK_NO_SOURCE'), '[]'::jsonb),
    'wanted', jsonb_build_array(
      'CFTC futures for GBP, CAD, CHF, MXN, NZD and BRL (only USD index, EUR, AUD and JPY are in the database)',
      'CFTC TFF splits for FX (asset managers and leveraged funds) in place of legacy non-commercial',
      'CFTC TFF asset managers and dealers in Treasury futures: the other side of the basis trade',
      'CFTC Nikkei (CME) and SOFR futures; silver and platinum managed money',
      'FX option risk reversals beyond USD/INR (CME CVOL is blocked)')
  );
$$;

-- History for the chart: the ranked reading (x) over 3 years with today's 10th/50th/90th
-- percentile lines, and the market's close over the same dates.
create or replace function dash.pos_history(p_series text)
returns jsonb
language sql stable security definer set search_path = dash, msd, public set jit = off as $$
with m as (
  select pm.*, mk.close_series_id cs, mk.asset_class::text = 'RATES' rates, pk.px_lbl,
         case s.frequency when 'D' then 20 when 'W' then 4 when 'M' then 3 else 2 end k4
  from dash.pos_meta() pm
  join msd.series s on s.series_id = pm.series_id
  left join msd.markets mk on mk.market_id = pm.market_id
  left join dash.pos_market() pk on pk.market_id = pm.market_id
  where pm.series_id = p_series
),
o as (
  select distinct on (x.as_of) x.as_of d, x.value::float8 v
  from msd.observations x where x.series_id = p_series and x.value is not null
  order by x.as_of, x.vintage_date desc
),
r as (select o.d, case when m.basis = 'change' then o.v - lag(o.v, m.k4) over (order by o.d) else o.v end x from o cross join m),
w as (select r.* from r where r.x is not null and r.d > (select max(d) from r) - interval '3 years'),
px as (
  select distinct on (x.as_of) x.as_of d, x.value::float8 c
  from msd.observations x
  where x.series_id = (select cs from m) and x.value is not null and x.as_of >= (select min(d) from w)
  order by x.as_of, x.vintage_date desc
)
select case when not exists (select 1 from m) then null else jsonb_build_object(
  'id', p_series, 'label', (select label from m), 'basis', (select basis from m), 'px_lbl', (select px_lbl from m), 'rates', (select rates from m),
  'pts', coalesce((select jsonb_agg(jsonb_build_array(d, x) order by d) from w), '[]'::jsonb),
  'p10', (select percentile_cont(0.1) within group (order by x) from w),
  'p50', (select percentile_cont(0.5) within group (order by x) from w),
  'p90', (select percentile_cont(0.9) within group (order by x) from w),
  'px', coalesce((select jsonb_agg(jsonb_build_array(d, c) order by d) from px), '[]'::jsonb)) end;
$$;

-- For the digests (B7 HARD POSITIONING): the directional series at a 3-year extreme, a record or a
-- price divergence, plus implied-vol extremes, one line each. Called by the routines through
-- execute_sql (as the database owner), like dash.rules_in_force.
create or replace function dash.positioning_extremes()
returns jsonb
language sql stable security definer set search_path = dash, msd, public as $$
  select jsonb_build_object(
    'asof', now(),
    'method', 'pct = percentile in the series'' own last 3 years (10y = full history since 2015); extreme = pct >= 90 or <= 10; record = beyond the full history; '
              || 'divergence = positioning moved at least half a standard deviation over the last 4 weeks (20 sessions, 3 months for monthly data) while price moved at least 0.5 sigma the other way. '
              || 'UST leveraged-fund futures positions are the basis trade, never a crowd view.',
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'market', r->>'market', 'series', r->>'id', 'kind', r->>'kind', 'as_of', r->>'d', 'read', r->>'read',
        'line', concat_ws(' · ', r->>'asset', r->>'label',
                  case when r->>'basis' = 'change' then 'change ' else 'latest ' end
                    || rtrim(to_char(round((coalesce(r->>'x', r->>'v'))::numeric, 2), 'FMSG999,999,999,999,990.99'), '.') || ' (' || (r->>'d') || ')',
                  case when r ? 'pct' then '3y pct ' || round((r->>'pct')::numeric * 100) end,
                  case when r ? 'pct_all' then (r->>'yrs_all') || 'y pct ' || round((r->>'pct_all')::numeric * 100) end,
                  r->>'read',
                  case when r ? 'move_since' then (r->>'px_lbl') || ' ' || case when (r->>'rates')::boolean then to_char((r->>'move_since')::numeric, 'FMSG9990') || 'bp' else to_char((r->>'move_since')::numeric, 'FMSG9990.0') || '%' end || ' since' end))
      order by (r->>'ord')::int), '[]'::jsonb))
  from dash.pos_rows() r
  where r->>'dup_of' is null
    and not coalesce((r->>'stale')::boolean, false)
    and r->>'kind' in ('spec', 'retail', 'flow', 'sentiment', 'skew', 'leverage', 'pricing', 'vol', 'basis')
    and (coalesce((r->>'ext')::int, 0) <> 0 or (r ? 'rec' and r->>'kind' <> 'vol') or coalesce((r->>'div')::int, 0) <> 0);
$$;

-- Site RPCs (email-gated).
create or replace function public.dash_positioning()
returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return dash.pos_board();
end $$;

create or replace function public.dash_positioning_series(p_series text)
returns jsonb
language plpgsql stable security definer set search_path = dash, public as $$
begin
  if not dash.allowed() then raise exception 'not authorised'; end if;
  return dash.pos_history(p_series);
end $$;

revoke all on function public.dash_positioning() from public, anon;
grant execute on function public.dash_positioning() to authenticated;
revoke all on function public.dash_positioning_series(text) from public, anon;
grant execute on function public.dash_positioning_series(text) to authenticated;
revoke all on function dash.pos_rows() from public, anon, authenticated;
revoke all on function dash.pos_board() from public, anon, authenticated;
revoke all on function dash.pos_history(text) from public, anon, authenticated;
revoke all on function dash.positioning_extremes() from public, anon, authenticated;
