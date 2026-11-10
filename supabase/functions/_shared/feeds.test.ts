// Which tab and which copy a digest email belongs to, from its subject alone (made-up subjects).
// Run: npx -y tsx --test supabase/functions/_shared/feeds.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedFamily, feedSource, feedDate } from './feeds.ts';

test('each copy of a digest gets its own source', () => {
  assert.equal(feedSource('YouTube Digest [Fable 5.2] — 2026-11-11: Macro (40 items)'), 'fable');
  assert.equal(feedSource('Podcast Digest [Opus 5.5] — 2026-11-11: 12 new episodes'), 'opus');
  assert.equal(feedSource('YouTube Digest [Gemini] — 2026-11-11: Macro (50 items)'), 'gemini');
  assert.equal(feedSource('Podcast Digest [Argon] — 2026-10-13: 9 episodes'), 'gemini');
  assert.equal(feedSource('[Gemini] Email Digest — 11 Nov 2026'), 'gemini');
  assert.equal(feedSource('ChatGPT Work — Podcast Digest — 2026-11-11: 10 new episodes'), 'chatgpt');
  assert.equal(feedSource('ChatGPT Work — GROK FULL CONSOLIDATED — 11 Nov 2026 | 9 complete digests'), 'chatgpt');
  assert.equal(feedSource('Grok Bot — GROK FULL CONSOLIDATED — 11 Nov 2026 | inline copy'), 'grokbot');
  assert.equal(feedSource('GROK CROWDING CHECK — 11 Nov 2026'), 'crowding');
  assert.equal(feedSource('YouTube Digest — 2026-09-20: Macro'), 'claude');
});

test('family and date come from the subject; the takeaways and alert stubs are not feeds', () => {
  assert.equal(feedFamily('YouTube Digest [Gemini] — 2026-11-11: Macro'), 'youtube');
  assert.equal(feedFamily('ChatGPT Work — Podcast Digest — 2026-11-11: 10 new episodes'), 'podcast');
  assert.equal(feedFamily('GROK CROWDING CHECK — 11 Nov 2026'), 'grok');
  assert.equal(feedFamily('ChatGPT Work — Email Digest — 11 Nov 2026: 140 emails'), 'substack');
  assert.equal(feedFamily('Email Digest — source alert'), null);
  assert.equal(feedFamily('MACRO TAKEAWAYS [Gemini] — Wed 11 Nov 2026'), null);
  assert.equal(feedDate('GROK CROWDING CHECK — 11 Nov 2026'), '2026-11-11');
  assert.equal(feedDate('YouTube Digest [Gemini] — 2026-11-11: Macro'), '2026-11-11');
});
