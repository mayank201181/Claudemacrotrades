-- 017: exit basis (trade_book_spec version 14, pending the owner's yes). Targets are hit on a touch of an
-- hourly high/low (exit at the target level, exactly +r/r); stops on an hourly CLOSE at or beyond the level.
-- dash-mark already stores the touches (stop_touched, target_touched) and the daily-close breaches
-- (stop_closed, target_closed); this adds the hourly-close stop breach the new rule turns on. The daily
-- columns stay for trades closed under versions 4-13 and as the fallback when hourly bars are missing.
alter table dash.live_marks add column if not exists stop_closed_h boolean;
alter table dash.live_marks add column if not exists stop_closed_h_px numeric;
alter table dash.live_marks add column if not exists stop_closed_h_at timestamptz;
