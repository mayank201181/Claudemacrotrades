# Source copies in the Fable Macro Takeaways digest

Changed 23 Oct 2026 at the owner's request, live from the Sat 24 Oct 2026 07:15 SGT run. The owner may pause the
Fable YouTube and Podcast digests on any day to save Fable credits, so the Fable Macro Takeaways routine now reads
every same-day copy of the YouTube, Podcast and Email digests whatever the model tag (Claude Fable and Opus, Gemini,
ChatGPT) instead of the Fable copies alone. The 24 Sep 2026 "MODEL A/B TEST" rule, under which it excluded the Opus
copies and did not read the Gemini ones, is withdrawn. The Opus Macro Takeaways prompt is unchanged (it is at the
65,536-byte cap). The live prompt's parentheticals name the owner.

Rules in one place: a feed is present when any copy is (an absent Fable copy is never slept for or reported missing);
all copies of one feed are one feed for breadth tags; the Claude copies (Fable, then Opus) rank first and the Gemini
and ChatGPT copies are lower-trust evidence, so a figure carried only by them is verified or printed as unverified and
copies agreeing with each other is not independent confirmation; the same story, number, quote or speaker across
copies is one item and one sighting, the highest-trust copy's version is kept and only what it lacks is taken from
the others; anything cited from a lower-trust copy alone is named as such; STANCES blocks are lifted from every copy
that carries one and deduped on (speaker, date, topic); the footer lists the copies read per feed. The same edit fixed
the Slack feed match (the ChatGPT subject is "Slack Daily Digest", which the old "Slack Digest" substring missed) and
made the Claude Email Digest copy present (Fable, else Opus) the primary Email Digest, with the ChatGPT and Gemini
copies as second reads (the Fable copy has not run since 3 Oct 2026; the Gemini copy often lands after 07:15 SGT and
is never waited for).

Inbox check behind the change (SGT arrival windows, 14 to 23 Oct 2026): Gemini YouTube 05:25 to 05:45, Opus YouTube
05:53 to 06:09, Fable YouTube 06:00 to 06:25, ChatGPT Podcast 06:04 to 06:20, Gemini Podcast 06:09 to 06:28, Opus
Podcast 06:17 to 06:31, Fable Podcast 06:30 to 06:42, ChatGPT Email 05:32 to 05:38, Opus Email 06:51 to 06:53, Gemini
Email 07:01 to 07:34, Slack 04:30. No ChatGPT YouTube digest has arrived since 16 Oct 2026. A Gemini copy can arrive
with an empty body (22 Oct 2026).

Route: prompt rewrite through the scheduled-task API from a cloud thread (read, edit by script with each find asserted
to occur exactly once, write back whole, byte-compare the stored copy). The prompt went from 65,349 to 65,263 of
65,536 bytes. Mac visits: 0.

## Exact edits (before and after, in prompt order)

### 1. SOURCE COPIES (rewritten 23 Oct 2026 at the owner's request; THIS task…

Before:

````
MODEL A/B TEST (from 24 Sep 2026): the four Claude tasks (YouTube Digest, Podcast Digest, Email Digest, Macro Takeaways) run as two parallel pipelines on different models — Opus 5.5 and Fable 5.1 — and every Claude email carries its model tag right after the family name, e.g. "YouTube Digest [Opus 5.5] — …", "Podcast Digest [Fable 5.1] — …", "Email Digest [Opus 5.5] — …", "MACRO TAKEAWAYS [Fable 5.1] — …". THIS task is the Fable 5.1 pipeline. (1) Wherever this prompt refers to the Claude YouTube, Podcast or Email Digest — feed gathering, the drafts check, any re-search, the PAUSE CHECK, STANCES/stance extraction, gap backfill, ADMIN FLAGS, footer — use ONLY Claude copies whose subject contains "[Fable 5.1]" (read "X Digest [Fable 5.1] —" wherever this prompt names the "X Digest —" prefix); for dates before 24 Sep 2026 the untagged Claude copies count as this pipeline's. (2) IGNORE completely every email or draft whose subject contains "[Opus 5.5]": it belongs to the other pipeline — never ingest, count, reconcile, or lift STANCES from it. (3) ChatGPT Work feeds (Slack Digest, GROK FULL CONSOLIDATED, "ChatGPT Work — Email Digest", the ChatGPT Podcast Digest copy) are shared by both pipelines and are handled exactly as before. (4) Feedback replies (STEP 1d): process only threads whose digest subject starts "MACRO TAKEAWAYS [Fable 5.1]", plus untagged MACRO TAKEAWAYS digests dated 23 Sep 2026 or earlier; skip "[Opus 5.5]" threads silently.
````

After:

````
SOURCE COPIES (rewritten 23 Oct 2026 at the owner's request; THIS task is the Fable 5.1 Macro Takeaways, and the 24 Sep rule that it read only "[Fable 5.1]" copies is withdrawn). The YouTube, Podcast and Email digests each arrive as up to four same-day COPIES from different models, the model tag after the family name: Claude "[Fable 5.1]" (this pipeline; its YouTube and Podcast digests may be PAUSED on any day) and "[Opus 5.5]", Gemini "[Gemini]" (earlier "[Argon]"), and ChatGPT ("ChatGPT Work — Podcast Digest — …", "ChatGPT — YouTube Digest — …", "ChatGPT Work — Email Digest — …"). READ EVERY same-day copy of all three, whatever the tag: a feed is present when any copy is, so an absent Fable copy is never slept for, never "missing" and never a pipeline pointer; the footer lists the copies read per feed (e.g. "YouTube: Opus · Gemini"). All copies of one feed type are ONE feed for breadth tags ("N of 5"), reconciled like any two sources. TRUST: the Claude copies (Fable, then Opus) come first; Gemini and ChatGPT copies are lower-trust evidence. Claude and Gemini copies carry a STANCES block, ChatGPT copies none. DEDUPE, never double-count: the same story, number, quote or speaker in several copies is one item and one sighting — the other copies are echo, not confirmation; keep the highest-trust copy's version and take from lower-trust copies only the speakers, items and links the higher ones lack. Whatever comes only from a Gemini or ChatGPT copy is named as such where it is cited ("Gemini copy") and stays a claim until STEP 2 item 7 and the STEP 3D gate have verified it. LEAN READING: read copies by script from the saved tool-result files; from the second copy of a feed on, lift the STANCES block, the item list (titles, speakers, key numbers, links) and anything the first copy lacks rather than re-reading the whole prose. Grok and Slack feeds are unchanged. Feedback replies (STEP 1d): process only threads whose digest subject starts "MACRO TAKEAWAYS [Fable 5.1]"; skip other models' MACRO TAKEAWAYS threads silently.
````

### 2. FIVE overnight digest feeds are expected, delivered as EMAILS IN THE I…

Before:

````
FIVE overnight digest feeds are expected, delivered as EMAILS IN THE INBOX. Both pipelines are live: ChatGPT Work tasks and Claude scheduled tasks. Search the inbox (newer_than:1d), today's SGT date only, and identify each feed by LOOSE subject matching — case-insensitive substring, any sender, tolerant of prefix/wording variations:
````

After:

````
FIVE overnight digest feeds are expected, delivered as EMAILS IN THE INBOX by the Claude, Gemini and ChatGPT Work tasks. Search the inbox (newer_than:1d), today's SGT date only, and identify each feed by LOOSE subject matching — case-insensitive substring, any sender, any model tag, tolerant of prefix/wording variations:
````

### 3. 3. Slack digest — subject contains "Slack" and "Digest" (currently "Ch…

Before:

````
3. Slack digest — subject contains "Slack Digest"
````

After:

````
3. Slack digest — subject contains "Slack" and "Digest" (currently "ChatGPT Work — Slack Daily Digest — {date}", ~04:30 SGT)
````

### 4. 4. Email digest — subject contains "Email Digest". Copies: Claude "Ema…

Before:

````
4. Email digest — subject contains "Email Digest". Two copies may exist on the same day and BOTH count: the Claude scheduled task's copy, subject "Email Digest [Fable 5.1] — {D Mmm YYYY}: {N} emails, {M} need action" (model-tagged since 24 Sep; an "[Opus 5.5]" copy may also exist; 06:45 SGT cutoff, restarted 6 Sep 2026, scheduled to send by 07:35 SGT), and the ChatGPT Work copy, subject "ChatGPT Work — Email Digest — {date}: …" (05:30 SGT cutoff). When both are present, treat the Claude copy as the primary Email Digest — its window closes 75 minutes later and includes the US-close newsletters that land 05:30–06:45 SGT — and the ChatGPT copy as a supplementary second read. A ChatGPT "Email Digest — {date}: source alert" stub (a few lines saying the Gmail search returned zero) carries no content and does NOT count as the feed. PAUSE CHECK (added 19 Sep 2026): if the Claude copy has not arrived when you start, first search `subject:"Email Digest" newer_than:3d -subject:"ChatGPT Work"`; if no Claude copy arrived on either of the two previous days, the task is paused — do NOT sleep, and write "Claude Email Digest: task paused" once in the footer (not as a missing feed, not under rolling-to-tomorrow); the Email Digest feed then counts as present only if a FULL ChatGPT copy arrived — a stub or a no-show is a missing feed as usual. Only when a Claude copy DID arrive on one of the two previous days: `sleep 300` once and search again before treating it as missing — it is scheduled to land only ten minutes ahead of this run and can slip; if it is still absent, use the ChatGPT copy alone and name the Claude copy as missing in the footer.
````

After:

````
4. Email digest — subject contains "Email Digest". Copies: Claude "Email Digest [Fable 5.1] — {D Mmm YYYY}: {N} emails, {M} need action" or "[Opus 5.5]" (06:45 SGT cutoff, lands ~06:55; the Fable copy has not run since 3 Oct 2026), "[Gemini]" (often lands after 07:15 — read it only if it is already in; never wait for it) and "ChatGPT Work — Email Digest — {date}: …" (05:30 SGT cutoff). The Claude copy present (Fable, else Opus) is the primary Email Digest — its window includes the US-close newsletters that land 05:30–06:45 SGT — and the other copies are supplementary second reads; with no Claude copy, build from the others and write "Claude Email Digest: no copy today" once in the footer (not as a missing feed, not under rolling-to-tomorrow). A ChatGPT "Email Digest — {date}: source alert" stub (a few lines saying the Gmail search returned zero) carries no content and does NOT count as the feed.
````

### 5. If an expected feed has no copy in the inbox, check Gmail drafts once …

Before:

````
TRANSITION (parallel pipelines are deliberate): the Claude tasks may ALSO deliver a Podcast, a YouTube and — from 6 Sep 2026 — an Email Digest for the same day. Ingest every same-day copy — different pipelines catch different things — but treat all copies of one feed type as ONE feed for breadth tags ("N of 5 feeds"), reconcile their claims like any two sources. If an expected feed is not in the inbox, check Gmail drafts once before declaring it missing.
````

After:

````
If an expected feed has no copy in the inbox, check Gmail drafts once before declaring it missing.
````

### 6. EXCLUDE, always: every "MACRO TAKEAWAYS" email of any model — Fable, O…

Before:

````
EXCLUDE, always: anything whose subject starts "MACRO TAKEAWAYS" (your own prior output — yesterday's sits in the inbox as a sent email; never ingest);
````

After:

````
EXCLUDE, always: every "MACRO TAKEAWAYS" email of any model — Fable, Opus, Gemini, ChatGPT (your own prior output and its siblings; never ingest);
````

### 7. 7. SIBLING FEEDS ARE CLAIMS (added 26 Sep 2026): numbers in any Email,…

Before:

````
7. SIBLING FEEDS ARE CLAIMS (added 26 Sep 2026): numbers in the Claude Email, Podcast and YouTube digests (either model tag) are written by the same kind of model and can be wrong. A load-bearing number taken from them needs a second, independent confirmation — a verbatim source quote in the Grok consolidated or ChatGPT copy, or your own web check against a primary source — before it carries a theme, an odds arrow or a trade. Two Claude copies agreeing is not independent confirmation; where a Grok, ChatGPT or primary-source figure disagrees, verify rather than outvote it.
````

After:

````
7. SIBLING FEEDS ARE CLAIMS (added 26 Sep 2026): numbers in any Email, Podcast or YouTube digest copy — Fable, Opus, Gemini or ChatGPT — are written by a model and can be wrong. A load-bearing number taken from them needs a second, independent confirmation — a verbatim source quote in the Grok consolidated or in a copy, or your own web check against a primary source — before it carries a theme, an odds arrow or a trade. Copies agreeing with each other is not independent confirmation (they read the same transcript); a figure carried only by a Gemini or ChatGPT copy ranks lowest — verify it or print it as "[source claim — unverified]"; where any figure disagrees with another, verify rather than outvote it.
````

### 8. When several Email Digest copies exist, merge their action items (the …

Before:

````
When two Email Digest copies exist, merge their action items (the Claude copy's ACTION NEEDED section and carried items first, then anything only the ChatGPT copy caught); if they disagree on a deadline or amount, print both with the source.
````

After:

````
When several Email Digest copies exist, merge their action items (the Claude copy's ACTION NEEDED section and carried items first, then anything only the other copies caught, naming the copy); if they disagree on a deadline or amount, print both with the source.
````

### 9. "Claude Email Digest: no copy today" when none arrived,…

Before:

````
"Claude Email Digest: task paused" when STEP 1's PAUSE CHECK found it so,
````

After:

````
"Claude Email Digest: no copy today" when none arrived,
````

### 10. 9. Footer: date, build time SGT, the feeds ingested and, per feed, the…

Before:

````
9. Footer: date, build time SGT, the feeds ingested and which pipeline delivered which,
````

After:

````
9. Footer: date, build time SGT, the feeds ingested and, per feed, the copies read (model tags),
````

### 11. (a) Lift the STANCES blocks from every "YouTube Digest" and "Podcast D…

Before:

````
(a) Lift the STANCES blocks from the Claude "YouTube Digest —" and "Podcast Digest —" emails with a script: the block starts with a line "STANCES YYYY-MM-DD (SGT) — source: …" (inside a <pre> in the HTML) and each following line is pipe-separated: date | speaker | affiliation | venue | topic | stance | Δ | link.
````

After:

````
(a) Lift the STANCES blocks from every "YouTube Digest" and "Podcast Digest" copy that carries one (Fable, Opus, Gemini) with a script: the block starts with a line "STANCES YYYY-MM-DD (SGT) — source: …" (inside a <pre> in the HTML) and each following line is pipe-separated: date | speaker | affiliation | venue | topic | stance | Δ | link. Dedupe on (speaker, date, topic) across copies: keep the highest-trust copy's row; a row only a Gemini copy carries gets " — Gemini copy" appended to its venue.
````

### 12. the ChatGPT copies carry no STANCES block, so extract from their prose…

Before:

````
the ChatGPT-pipeline copies carry no STANCES block, so extract from their prose only for speakers the Claude blocks lack.
````

After:

````
the ChatGPT copies carry no STANCES block, so extract from their prose only for speakers no lifted block has, venue suffixed " — ChatGPT copy".
````

### 13. and never the Email Digest when only its Claude copy is absent).…

Before:

````
and never the Email Digest while PAUSE CHECK finds its task paused).
````

After:

````
and never the Email Digest when only its Claude copy is absent).
````

### 14. lift their STANCES blocks (all copies, deduped as in (a)), compute Δ f…

Before:

````
lift their STANCES blocks, compute Δ for them in date order
````

After:

````
lift their STANCES blocks (all copies, deduped as in (a)), compute Δ for them in date order
````
