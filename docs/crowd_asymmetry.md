# Crowd asymmetry at the gate (rule R09)

Proposed 24 Oct 2026 at the owner's request (defaults confirmed by him the same day), after a clip of Ying Hua (ex-Balyasny) on pod-shop investing as poker,
not blackjack: at a horizon of weeks to months everyone works from similar processes and data, so everyone ends up on
the same side of the boat; the group is right maybe 60-70% of the time but is paid less than it expects, because
everyone sells to monetise the same catalyst, and when it is wrong, maybe 20% of the time, it is hit hard, because
everyone is getting out through the same door. The lesson is about payoffs, not direction: the crowd is usually right.

## What changes

Rule R09 (`supabase/rules/R09_crowd_asymmetry.sql`, scope both, source owner) applies at THE TRADE TEST in both books.

- **Crowd side.** Every candidate's crowd field (with / against / none, already on every card) is now set from evidence
  the run already reads, strongest first: the positioning table (`dash.positioning_extremes()`, R02: a directional
  series at a 3-year extreme or record, never the Treasury basis trade or implied vol), then B7 saturation or
  capitulation, the weekly Grok crowding check, or one web statistic for a series the table does not cover. "Least
  long" is the crowd trimming, not an extreme. An extreme the market has already moved 2 ATR against since its as-of
  date is spent and counts as none. The evidence prints on the card and the TESTED line.
- **Arithmetic, crowd = with only.** EV = p × r/r × 0.75 − (1 − p) × 1.5: paid a quarter less when right, lose one and
  a half times 1R when wrong. p stays the thesis probability and is not lowered again for the crowd. Break-even moves
  from p0 = 1/(1 + r/r) to 2/(r/r + 2): 50% at r/r 2.0 (was 33%), 57% at 1.5 (was 40%), 40% at 3.0 (was 25%). The gate
  (EV > 0), the thin-edge band and "p at gate" are unchanged and read the adjusted figure. Against and none: the
  spec's formula, unchanged; the asymmetry in an against card's favour is never credited.
- **Print.** "EV +x.xxR (crowd-adjusted; +y.yyR unadjusted)"; META ev holds the adjusted figure, so the dashboard's
  gate audit, EV buckets and thin-edge tag need no change. A lean rejected only by the adjustment is logged as such and
  its market goes on the WASHOUT WATCH line the other way (the pain trade); nothing is carded on crowding alone. The
  SCORECARD gains a "crowd: with n/R · against n/R" line with says/hits, which is the calibration loop.
- **Structure.** A with card names the bought-option expression that caps the loss leg (R01 card, premium = 1R).
  R01 convexity cards on the crowded side take only the payoff haircut (the premium already caps the loss).
- **First run.** Every open and pending card has its crowd field restated with evidence; nothing is closed on that
  alone. A with card whose restated EV is 0 or below is flagged "crowd kills the edge" for its next review.

## Why these defaults, and where it can mislead

- The ×0.75 / ×1.5 defaults are a judgement. They put the crowded break-even about 15 points above p0, milder than the
  clip's own numbers (paid two-thirds, lose double), under which a 65%-right crowded trade is roughly zero EV. The
  ×1.5 loss leg is consistent with spec v15 (from the same 26 Oct run): stops exit on the hourly close beyond the
  level, so a gap through a crowded stop already scores worse than −1R.
- The book's own record cannot set them yet: to 24 Oct, 8 cards carried crowd = with (2 closed, both losers) against
  30 crowd = against. The weekly review reads the new SCORECARD line; the revert condition names the thresholds.
- Crowding measures lag (CFTC is Tuesday data out Friday; the voices and Grok checks lag price), so the rule reads the
  table's "since" move and treats a spent extreme as none.
- Crowded trades keep working in trends: a 3-year-percentile extreme is normal in a trend, and the voices crowd data
  (since 15 Sep) shows the market following a one-sided crowd 53-58% of the time over the next 10 sessions. That is why
  the rule changes payoffs only and never fades a crowd by itself; the pain trade still has to pass the washout screen.
- The clip's context is equity long/short pods with tight drawdown limits, where forced de-grossing is the exit
  mechanism. In liquid G10 FX and rates the gap-through-stop leg is weaker; in EM FX, positioning-heavy futures (JPY,
  gold, crude) and APAC equity derivatives into month- and quarter-end it is stronger. One default for all is the
  simple first version; the SCORECARD line can later split it by bucket.
- Double counting: a stated p that already "allows for positioning" plus the payoff haircut punishes the card twice.
  The rule strikes the crowd from the p reasons on a with card; p is the hand, the adjustment is the table.

## Route and timing

Proposed through `dash.propose_rule` from a cloud thread (no approval prompt); applies at the Sun 25 Oct 2026 20:00 SGT
window (with R08); the owner confirmed the defaults on 24 Oct, so both Macro Takeaways digests follow it from the
Mon 26 Oct 07:15 SGT run (`revert R09` in a reply to the weekly review email removes it later). No prompt edit (both prompts are at the
65,536-byte cap) and no spec edit: on this point the rule wins over the spec's test (c), as the prompts' STEP 1f says.
Mac visits: 0.
