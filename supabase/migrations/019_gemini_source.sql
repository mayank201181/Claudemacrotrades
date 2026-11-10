-- Gemini copies of the YouTube, Podcast and Email digests were stored under source 'claude' from their first day
-- (14 Oct 2026) to 10 Nov 2026, because feedSource() in _shared/feeds.ts knew no "[Gemini]" tag and fell through to
-- the name kept for untagged Claude copies from before 24 Sep 2026. The function returns 'gemini' from 10 Nov 2026
-- (dash-ingest v10); this relabels the rows stored before that. On 10 Nov 2026 every 'claude' row was a Gemini copy
-- (86 rows, none dated before 14 Oct 2026), so the date is a guard, not a filter.
update dash.feeds set source = 'gemini' where source = 'claude' and d >= date '2026-10-14';
