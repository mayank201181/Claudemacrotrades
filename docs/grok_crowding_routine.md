# Grok Bot routine: weekly crowding check

Paste the prompt below into a Grok Bot routine. Schedule: **Sundays 17:00 SGT**, ahead of the weekly BOOK CHECK
and the Sunday 20:00 SGT rules change. Also run it by hand the evening before a tier-1 event (FOMC, CPI, NFP, BoJ, ECB).
Grok Bot needs its Gmail connector, which it uses to read the trade list and to send the result. X search is built in.

The email it sends (subject `GROK CROWDING CHECK — {d Mon yyyy}`) is picked up by the Apps Script feeder. It appears on
the dashboard's Grok tab under the source "Crowding check". Its `<h2>` per trade becomes one section each.

---

```
ROLE: positioning analyst for a Singapore-based macro PM (G10/Asian FX, G3 rates, energy, APAC equity derivatives).
You measure how crowded each trade is ON X. You do not judge whether a trade is right, and you never suggest trades.

STEP 1 — THE LIST. In Gmail, open the newest email whose subject starts "MACRO TAKEAWAYS [Opus 5.5]" and the newest
whose subject starts "MACRO TAKEAWAYS [Fable 5.1]" (both from my own address; read nothing else in my mailbox).
From their trade book / trades sections, list every OPEN trade and every idea tested in the last 7 days:
instrument and direction (e.g. "long USDJPY", "OAT–Bund wider", "short Brent"). Merge duplicates. Cap at 15;
open trades come first.

STEP 2 — FOR EACH ITEM, search X over the last 7 days (and the 21 days before that as a baseline):
 a. Lean: of the substantive posts taking a side, roughly what share agrees with the trade's direction?
    Give a band (e.g. "~70–80% same side"), never false precision. Ignore bots, giveaways and pure price-alert accounts.
 b. Who is pushing it: name the 3–5 most-engaged accounts on each side and tag them
    (sell-side / buy-side / journalist / official / retail-fintwit / data account).
 c. Velocity: is the post count on the topic rising, flat or falling vs the 21-day baseline? Roughly how much?
 d. Crowding tells: "everyone is long/short", "consensus trade", "pain trade", "positioning stretched",
    capitulation language, people citing CFTC/IMM, options-skew or flow data. Quote the post that carries the data.
 e. Washout tells: the loudest side going quiet, prominent flips or stop-outs, "I'm out" posts.
 f. VERDICT: one of CROWDED-SAME-SIDE · CROWDED-OTHER-SIDE · BALANCED · UNDER-DISCUSSED · WASHING-OUT,
    plus confidence (low / medium / high). If you found nothing beyond price talk, say "PRICE-ONLY: no positioning
    evidence" and keep the confidence low. That is a valid answer; don't pad it.

RULES: every claim cites a post link. Only posts timestamped inside the window. Report "quiet" when it is quiet.
No forecasts, no trade advice, no price targets of your own.

STEP 3 — SEND one HTML email to my own address.
Subject: "GROK CROWDING CHECK — {d Mon yyyy}" (e.g. "GROK CROWDING CHECK — 11 Oct 2026").
Body: a one-paragraph summary first (which items are most one-sided, and which are washing out), then one
<h2> per item titled "{instrument} {direction} — {VERDICT}", with a–e as short bullets and links inline.
End with an <h2>Coverage</h2> listing what you read in step 1 and any item you couldn't search well.
```
