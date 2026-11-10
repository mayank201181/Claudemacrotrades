// A synthetic trade book (illustrative numbers, not a real position) holding a convexity card (R01) next to a linear one.
// Run: npx -y tsx --test supabase/functions/_shared/parse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTradeBook } from './parse.ts';
import { type ConvexCard, cardFromMeta } from './convexity.ts';
import { twinCard } from './twin.ts';

const BOOK = `TRADE BOOK — Macro Takeaways [Opus 5.5] (single writer)
Last updated: 2026-10-16 08:00 SGT · open: 2 · pending: 0 · closed: 1 · factors: 2 · next P: 10
RULES: …
SCORECARD: closed 1 · wins 1 · cum R +1.0 · convexity: settled 1 · cum +2.2R · says 45% · paid 1.00 · price 31.0% · at gate 0
SECTION TRADES
## P09 — short USDJPY 144 digital
META: open · opened 2026-10-05 20:00 SGT · filled 2026-10-06 09:00 SGT · closed - · fx · short · class convexity · boundary - · proxy JPY=X · expires - · ref 147.50 · entry 147.20 · stop - · target - · horizon cut · review 2026-10-12 · rr 2.4 · p 40% · p0 29.1% · ev +0.37R · pgate yes · factor usd · linked - · conviction - · crowd none · priced no · result - · exit - · struct dig-dn · strike 144.00 · cut 2026-11-13 23:00 SGT · pay USD · vol 0.696% · carry -3.00% · p0fill 31.0%
THESIS: The BoJ hikes into a softer US labour market.
INVALIDATION: 150.50 close: the carry trade is not unwinding.
STRUCTURE: USDJPY 144 European digital, NY cut 13 Nov, paid in USD.
- 2026-10-15 · mark 146.10 · -0.75% · +0.11R · left 20 · V 34.4%; -
- 2026-10-14 · mark 146.60 · -0.41% · -0.03R · left 21 · V 30.0%; -
## P08 — long AUDUSD 0.6650/0.6850 call spread
META: closed-expiry · opened 2026-09-01 20:00 SGT · filled 2026-09-02 09:00 SGT · closed 2026-10-09 · fx · long · class convexity · boundary - · proxy AUDUSD=X · expires - · ref 0.6580 · entry 0.6585 · stop - · target - · horizon cut · review - · rr 2.1 · p 43.3% · p0 32.5% · ev +0.33R · pgate yes · factor china · linked - · conviction - · crowd none · priced no · result +0.08R · exit expiry · struct cs · strike 0.6650/0.6850 · cut 2026-10-09 23:00 SGT · pay - · vol 0.720% · carry +0.15% · p0fill 32.5%
## P07 — long gold
META: open · opened 2026-09-20 20:00 SGT · filled 2026-09-21 09:00 SGT · closed - · metals · long · class thematic · boundary - · proxy GC=F · expires 2026-12-29 · ref 2650 · entry 2655 · stop 2580 · target 2850 · horizon open · review 2026-10-20 · rr 2.6 · p 45% · p0 28% · ev +0.62R · pgate no · factor real rates · linked - · conviction - · crowd with · priced partly · result - · exit -
- 2026-10-15 · mark 2700 · +1.7% · +0.60R · held 18
SECTION LOG
- 2026-10-05 · T · short USDJPY 144 digital exp 13 Nov → P09 · proxy JPY=X · rr 2.44 · p 40% · p0 29.1% · ev +0.37R · convexity dig-dn 144.00 cut 2026-11-13
- 2026-10-05 · P09 · opened
`;

test('a convexity card parses without corrupting the other fields', () => {
  const tb = parseTradeBook(BOOK);
  assert.equal(tb.trades.length, 3);
  const [c, s, g] = tb.trades;
  assert.equal(c.pid, 'P09'); assert.equal(c.status, 'open'); assert.equal(c.tclass, 'convexity');
  assert.equal(c.asset_class, 'fx'); assert.equal(c.direction, -1); assert.equal(c.proxy, 'JPY=X');
  assert.equal(c.stop, null); assert.equal(c.target, null);
  assert.equal(c.ref, 147.5); assert.equal(c.entry, 147.2);
  assert.equal(c.rr, 2.4); assert.equal(c.p, 40); assert.equal(c.p0, 29.1); assert.equal(c.ev, 0.37);
  assert.equal(c.filled, '2026-10-06 09:00 SGT'); assert.equal(c.closed, null); assert.equal(c.result_r, null); assert.equal(c.exit_reason, null);
  assert.equal(c.meta.horizon, 'cut'); assert.equal(c.meta.pgate, 'yes'); assert.equal(c.meta.exit, '-');
  assert.deepEqual(
    { struct: c.meta.struct, strike: c.meta.strike, cut: c.meta.cut, pay: c.meta.pay, vol: c.meta.vol, carry: c.meta.carry, p0fill: c.meta.p0fill },
    { struct: 'dig-dn', strike: '144.00', cut: '2026-11-13 23:00 SGT', pay: 'USD', vol: '0.696%', carry: '-3.00%', p0fill: '31.0%' },
  );
  assert.equal(c.structure, 'USDJPY 144 European digital, NY cut 13 Nov, paid in USD.');

  assert.equal(s.status, 'closed-expiry'); assert.equal(s.exit_reason, 'expiry'); assert.equal(s.result_r, 0.08);
  assert.equal(s.p, 43.3); assert.equal(s.p0, 32.5); assert.equal(s.meta.strike, '0.6650/0.6850'); assert.equal(s.meta.pay, '-');
  assert.equal(s.closed, '2026-10-09');

  // the linear card is unchanged by the new keys
  assert.equal(g.tclass, 'thematic'); assert.equal(g.asset_class, 'metals'); assert.equal(g.stop, 2580); assert.equal(g.target, 2850);
  assert.equal(g.meta.struct, undefined);

  // marks: "left n" is dropped from the note, V and the touch state remain
  const m = tb.marks.filter((x) => x.pid === 'P09');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { model: 'opus', pid: 'P09', d: '2026-10-15', mark: 146.1, chg: '-0.75%', r: 0.11, note: 'V 34.4%; -' });
  assert.equal(tb.marks.find((x) => x.pid === 'P07')!.note, null);

  // the LOG T line keeps the convexity terms in its reason
  assert.equal(tb.tested.length, 1);
  const t = tb.tested[0];
  assert.equal(t.verdict, 'carded'); assert.equal(t.covered_by, 'P09'); assert.equal(t.direction, -1);
  assert.equal(t.p0, 29.1); assert.equal(t.ev, 0.37); assert.match(t.reason ?? '', /convexity dig-dn 144\.00 cut 2026-11-13/);

  // and the card prices from what was parsed
  const card = cardFromMeta(c.proxy!, { ...c.meta }, '') as ConvexCard;
  assert.equal(card.struct, 'dig-dn'); assert.equal(card.basePay, true); assert.equal(card.cut, Date.UTC(2026, 10, 13, 15));
});

test('the planned-risk key (R17) is stored and a restated void card keeps its fields', () => {
  const book = `TRADE BOOK — Macro Takeaways [Fable 5.2] (single writer)
Last updated: 2026-11-16 08:00 SGT · open: 1 · pending: 0 · closed: 0 · factors: 1 · next P: 12
RULES: …
SCORECARD: closed 0
SECTION TRADES
## P11 — long sample index
META: open · opened 2026-11-16 07:40 SGT · filled 2026-11-16 09:00 SGT · closed - · equities · long · class tactical · boundary - · proxy ^KS11 · expires - · ref 100.00 · entry 99.20 · stop 97.50 · target 104.00 · horizon 2 · review - · rr 1.60 · p 45% · p0 38% · ev +0.17R · pgate no · factor sample · linked - · conviction - · crowd none · priced n/a · result - · exit - · risk 2.50
## P10 — long sample ETF
META: void · opened 2026-11-03 09:40 SGT · filled 2026-11-03 22:30 SGT · closed 2026-11-04 · equities · long · class tactical · boundary - · proxy EWT · expires - · ref 100.00 · entry 97.60 · stop 97.50 · target 104.00 · horizon 2 · review - · rr 1.60 · p 40% · p0 37% · ev +0.04R · pgate yes · factor sample · linked - · conviction - · crowd against · priced n/a · result - · exit -
SECTION LOG
`;
  const tb = parseTradeBook(book);
  const [a, b] = tb.trades;
  assert.equal(a.pid, 'P11'); assert.equal(a.meta.risk, '2.50');
  assert.equal(a.asset_class, 'equities'); assert.equal(a.direction, 1); assert.equal(a.stop, 97.5); assert.equal(a.entry, 99.2);
  assert.equal(b.pid, 'P10'); assert.equal(b.status, 'void'); assert.equal(b.result_r, null); assert.equal(b.exit_reason, null);
  assert.equal(b.meta.risk, undefined);
});

test('the option twin line (R18) is stored whole and prices as written', () => {
  const book = `TRADE BOOK — Macro Takeaways [Fable 5.2] (single writer)
Last updated: 2026-11-16 08:00 SGT · open: 2 · pending: 1 · closed: 0 · factors: 1 · next P: 15
RULES: …
SCORECARD: closed 0
SECTION TRADES
## P14 — short sample pair
META: open · opened 2026-11-16 07:40 SGT · filled 2026-11-16 09:00 SGT · closed - · fx · short · class thematic · boundary - · proxy JPY=X · expires - · ref 158.00 · entry 157.90 · stop 160.00 · target 155.50 · horizon open · review 2026-11-20 · rr 1.25 · p 50% · p0 44% · ev +0.12R · pgate no · factor sample · linked - · conviction - · crowd none · priced no · result - · exit - · carry -8.0 pips = -0.04R to 2026-11-30 · risk 2.00
THESIS: A sample thesis.
INVALIDATION: 160.00 close.
STRUCTURE: 2-week 155.50 one-touch, USD pay.
TWIN: ot-dn · strike 155.50 · cut 2026-12-01 · pay USD · iv 6.7% DTCC 2026-11-13 · carry -2.90%
- 2026-11-16 · mark 157.60 · -0.19% · +0.15R · held 1 · -
## P13 — long sample pair
META: pending · opened 2026-11-16 07:40 SGT · filled - · closed - · fx · long · class thematic · boundary - · proxy KRW=X · expires - · ref 1340.00 · entry - · stop 1325.00 · target 1370.00 · horizon open · review 2026-11-20 · rr 2.00 · p 40% · p0 33% · ev +0.20R · pgate no · factor sample · linked - · conviction - · crowd none · priced no · result - · exit - · risk 15.00
STRUCTURE: linear
TWIN: none — no implied vol printed for the pair
## P12 — long sample index
META: open · opened 2026-11-13 07:40 SGT · filled 2026-11-13 09:00 SGT · closed - · equities · long · class tactical · boundary - · proxy ^KS11 · expires - · ref 100.00 · entry 99.20 · stop 97.50 · target 104.00 · horizon 2 · review - · rr 1.60 · p 45% · p0 38% · ev +0.17R · pgate no · factor sample · linked - · conviction - · crowd none · priced n/a · result - · exit - · risk 2.50
SECTION LOG
`;
  const [a, b, c] = parseTradeBook(book).trades;
  assert.equal(a.meta.twin, 'ot-dn · strike 155.50 · cut 2026-12-01 · pay USD · iv 6.7% DTCC 2026-11-13 · carry -2.90%');
  // the R07 carry of the linear card and the twin's own carry do not collide
  assert.equal(a.meta.carry, '-8.0 pips = -0.04R to 2026-11-30');
  assert.equal(a.structure, '2-week 155.50 one-touch, USD pay.'); assert.equal(a.stop, 160); assert.equal(a.direction, -1);
  const card = twinCard(a.proxy!, a.meta.twin, a.direction!) as ConvexCard;
  assert.equal(card.struct, 'ot-dn'); assert.equal(card.k, 155.5); assert.equal(card.basePay, true); assert.equal(card.cut, Date.UTC(2026, 11, 1, 15));
  assert.equal(b.meta.twin, undefined, 'a "none" line stores nothing');
  assert.equal(b.structure, 'linear');
  assert.equal(c.meta.twin, undefined);
});
