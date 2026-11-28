// Gemini Takeaways editions: sections and the book's trades (made-up levels in the three layouts seen 28 Nov 2026).
// Run: npx -y tsx --test supabase/functions/_shared/gemini.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geminiProxy, parseGeminiTrades } from './gemini.ts';
import { feedFamily, feedSource, parseFeed } from './feeds.ts';
import { setPrivateTerms } from './parse.ts';

setPrivateTerms({ scrub: 'zzqqnomatch', drop: 'zzqqnomatch' });

test('the three Gemini editions are takeaways feeds with their own source', () => {
  assert.equal(feedFamily('MACRO TAKEAWAYS [Gemini] — Sat 28 Nov 2026 [Carbon]'), 'takeaways');
  assert.equal(feedSource('MACRO TAKEAWAYS [Gemini] — Sat 28 Nov 2026 [Carbon]'), 'carbon');
  assert.equal(feedSource('MACRO TAKEAWAYS [Gemini] — Sat 28 Nov 2026 [Neon]'), 'neon');
  assert.equal(feedSource('MACRO TAKEAWAYS [Pipeline · Neon] — Sat 28 Nov 2026'), 'pipeline_neon');
  assert.equal(feedFamily('MACRO TAKEAWAYS [Fable 5.2] — Sat 28 Nov 2026'), null);
  assert.equal(feedSource('YouTube Digest [Gemini] — 2026-11-11: Macro'), 'gemini');
});

test('Carbon layout: table cells glued, forward shifted to spot by its spot ref, prose mention skipped', () => {
  const html = `<div>Banner: HOLD across P41 and S12. Tactical P41 Short ABC (+0.50R / +0.50R sized).</div>
    <table><tr><td>P41: Short ABC (Some Fund ETF) Size: 1.0R | Opened: 2026-11-02</td><td>Entry: $50.00 | Mark: $49.00</td>
    <td>Stop: $51.00 (1h close) | Target: $47.00</td><td>OPEN — HOLD</td></tr>
    <tr><td>S12: Long USD/XYZ 3M Outright Fwd (0.5R, opened 2026-11-03) thesis words</td><td>Entry: 100.00 (Spot ref 101.00) | Mark: 102.00</td>
    <td>Fri wStop: 96.00 | Target: 110.00</td><td>OPEN — HOLD</td></tr></table>`;
  const t = parseGeminiTrades(html);
  assert.deepEqual(t.map((x) => x.pid), ['P41', 'S12']);
  const [p, s] = t;
  assert.equal(p.proxy, 'ABC'); assert.equal(p.direction, -1); assert.equal(p.entry, 50); assert.equal(p.stop, 51); assert.equal(p.target, 47);
  assert.equal(p.opened, '2026-11-02'); assert.equal(p.meta.size_r, 1); assert.equal(p.status, 'open'); assert.equal(p.tclass, 'tactical');
  assert.equal(s.proxy, 'XYZ=X'); assert.equal(s.direction, 1); assert.equal(s.tclass, 'structural');
  assert.equal(s.entry, 101); assert.equal(s.stop, 97); assert.equal(s.target, 111); // +1.00 basis
  assert.equal(s.meta.gemini_entry, 100); assert.equal(s.meta.size_r, 0.5);
});

test('Neon triple and Pipeline Neon glued id, labelled with middots', () => {
  const neon = parseGeminiTrades('<tr><td>S07 Short AUD/USD</td><td>0.7000 / 0.7200 / 0.6600 (1R=0.0200)</td><td>HOLD</td></tr>');
  assert.equal(neon[0].proxy, 'AUDUSD=X'); assert.equal(neon[0].entry, 0.7); assert.equal(neon[0].stop, 0.72); assert.equal(neon[0].target, 0.66);
  assert.equal(neon[0].meta.size_r, null); // "(1R=" is the risk unit, not the size
  const pn = parseGeminiTrades('<b>P42</b><b>SHORT</b>EUR/CHF (+0.30R | +0.30R 1x) Entry 0.9300 &middot; Mark 0.9250 &middot; Stop 0.9400 &middot; Tgt 0.9100 &middot; 1.0R (long-vol) &middot; OPEN — HOLD');
  assert.equal(pn[0].pid, 'P42'); assert.equal(pn[0].proxy, 'EURCHF=X'); assert.equal(pn[0].stop, 0.94); assert.equal(pn[0].target, 0.91);
  assert.equal(pn[0].meta.size_r, 1);
});

test('a closed line is closed; a pair trade has no proxy', () => {
  const c = parseGeminiTrades('P43 Long USD/SGD (0.5R) Entry 1.3000 | Stop 1.2900 | Target 1.3200 | CLOSED — TIME-STOP EXECUTED');
  assert.equal(c[0].status, 'closed-view');
  assert.equal(geminiProxy('INDA / SHORT EWY').proxy, null);
  assert.equal(geminiProxy('Dec Gold Fut (GCZ26.CMX)').proxy, 'GCZ26.CMX');
  assert.equal(geminiProxy('USD/INR 3M NDF').proxy, 'INR=X');
});

test('an edition splits on its numbered bold headings and drops the admin block', () => {
  const html = `<div style="font-weight:700">MACRO TAKEAWAYS [Gemini] header</div><div>Top line text</div>
    <div style="font-weight:800;font-size:16px">1. TRADE BOOK [Gemini] &mdash; BOOK</div><div>P44 Long ABC Entry 1.00 Stop 0.90 Target 1.20</div>
    <div style="font-weight:800">2. THE LAST 24H IN 60 SECONDS</div><div>news</div>
    <div style="font-weight:800">7. ADMIN FLAGS</div><div>file ids</div>
    <div style="font-weight:800">9. OPEN QUESTIONS (Qxx) TRACKER</div><div>Q1 60%</div>`;
  const f = parseFeed({ id: 'x', subject: 'MACRO TAKEAWAYS [Gemini] — Sat 28 Nov 2026 [Carbon]', date: '2026-11-27T23:49:14Z', htmlBody: html })!;
  assert.equal(f.family, 'takeaways'); assert.equal(f.source, 'carbon'); assert.equal(f.d, '2026-11-28');
  assert.deepEqual(f.sections.map((s) => s.title), ['1. TRADE BOOK [Gemini] — BOOK', '2. THE LAST 24H IN 60 SECONDS', '9. OPEN QUESTIONS (Qxx) TRACKER']);
});
