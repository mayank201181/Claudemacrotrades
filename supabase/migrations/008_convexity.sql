-- Convexity cards (rule R01): extra live-mark columns written by dash-mark. Additive and nullable;
-- linear rows leave them null. dash_trades returns them through to_jsonb(live_marks).
--   v           model value at the latest live hourly close, as a share of the maximum payout
--   daily_v     the same at the latest complete daily close (the book's daily mark basis)
--   left_n      sessions left to the cut at the hourly mark (FX: Mon–Fri UTC hours ÷ 24)
--   touched_at  first live hourly bar (its start) or complete daily close that reached the barrier
--   touched_px  the high, low or close that touched
--   settled_px  the settlement price once the cut has passed
--   paid        share of the maximum payout received once touched or settled (1 / 0, or f for a spread);
--               dash-mark keeps a row with paid set after the card closes, for the scorecard's paid
alter table dash.live_marks
  add column if not exists v numeric,
  add column if not exists daily_v numeric,
  add column if not exists left_n numeric,
  add column if not exists touched_at timestamptz,
  add column if not exists touched_px numeric,
  add column if not exists settled_px numeric,
  add column if not exists paid numeric;
