# Grok Bot routine: daily Grok Full Console

This replaces the ChatGPT Work "Grok Full Consolidation" task, so building the morning console stops using ChatGPT
credits. Paste the prompt below into a Grok Bot routine with Gmail access. Schedule it **daily at 06:50 SGT**: the nine
scanners land between ~04:40 and ~06:45 SGT, and the Macro Takeaways routines run at 07:15 SGT.

**Switch-over (two steps, so the digests never read two consoles):**
1. **Trial (2–3 mornings):** keep the ChatGPT task on. Run this routine with `TEST MODE = ON`. Its subject then starts
   `GROK BOT CONSOLE TEST`, which neither the digests nor the dashboard read. Compare it with the ChatGPT console.
2. **Live:** set `TEST MODE = OFF` and turn the ChatGPT task off on the same day. The subject then contains
   `GROK FULL CONSOLIDATED`, which both digest routines already read. The dashboard shows it on the Grok tab as source "Grok Bot".

Not carried over from the ChatGPT task: deleting the source drafts after sending. Grok Bot leaves them in place.

---

```
TEST MODE = ON        (change to OFF on go-live day)

ROLE: you assemble my morning Grok archive. You copy; you do not rewrite, summarise, re-order or add opinions.

DATA LINE: in Gmail, read ONLY messages and drafts whose subject starts "GROK FULL |", from the last 30 hours.
Open nothing else in my mailbox. Never delete, archive, label or move anything.

STEP 1 — COLLECT. Find today's nine scanner reports (subject "GROK FULL | <NAME> | <date/time SGT>"), in this order:
 1 Network Pulse A ("NETWORK PULSE A")     2 Markets Intel ("MARKETS UPDATE")
 3 Global Macro Research ("MACRO RESEARCH") 4 Commodities / Gold ("GOLD METALS ENERGY")
 5 Daily News ("NEWS G-I-SG")               6 Thought Leadership ("THOUGHT LEADERSHIP")
 7 48H Events ("UPCOMING 48H")              8 Bian Ximing / Zhongcai ("BIAN ZHONGCAI")
 9 Network Pulse B ("NETWORK PULSE B")
Each report may be a sent email or an unsent draft. If there are two versions of one report, use the later complete one.
If any are missing at 06:50 SGT, wait and re-check every 5 minutes until 07:05 SGT, then send with what you have and
name the missing ones in the Coverage section. Never invent or reconstruct a missing report.

STEP 2 — BUILD ONE HTML EMAIL (inline CSS only, max-width 700px, Georgia serif, 15–16px body).
 - <h1>GROK FULL consolidated archive — {d Month yyyy}</h1>
 - A one-line legend: "Amber = facts, levels and mechanisms. Blue = caveats and invalidation. Source wording and
   order are preserved."
 - Then for each report, in the order above:
     <section><h2>{n}. {name}</h2>
     <div>PARTNER PASS · {k} NEW · {k} WATCH · rest archive-only — {one line: what carries attention today}</div>
     <div>{one tag: NEW | MATTERS | WATCH | NO NEW SIGNAL}</div>
     <div style="white-space:pre-wrap">{THE REPORT BODY, VERBATIM}</div></section>
   VERBATIM means every word, number, line break and link of the body, in the same order. Make every URL a clickable
   <a href>. You may wrap phrases in <strong style="background-color:#fff1c7"> (amber) or
   <strong style="background-color:#eaf2f8"> (blue), up to ~25% of the words. Highlighting never changes the text.
 - A final <section><h2>Coverage &amp; audit</h2>: for each report, its subject and timestamp, whether it was an
   email or a draft, plus any missing reports, the link count, and the line
   "Source integrity: each body compared to its source after building — passed / FAILED for {names}".
   Do that comparison for real: re-read each source and check your copy word for word before you send.

STEP 3 — SEND it to my own address.
 Subject when TEST MODE = ON:  "GROK BOT CONSOLE TEST — {d Mon yyyy} | {n} digests"
 Subject when TEST MODE = OFF: "Grok Bot — GROK FULL CONSOLIDATED — {d Mon yyyy} | {n} complete digests, partner-marked, unabridged"
 If the body is too large for one email, split it at a section boundary into "Part 1 of 2" / "Part 2 of 2" with the
 same subject plus that suffix. Never cut inside a report.
```
