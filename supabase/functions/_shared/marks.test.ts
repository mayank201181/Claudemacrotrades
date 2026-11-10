// Run: npx -y tsx --test supabase/functions/_shared/marks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneR } from './marks.ts';

test('one R is the planned risk when the card carries one (R17)', () => {
  // Illustrative numbers: planned risk 2.50, fill gapped to 0.20 above the stop.
  assert.equal(oneR(98.2, 98.0, '2.50'), 2.5);
  assert.equal(oneR(98.2, 98.0, 2.5), 2.5);
  assert.equal(oneR(1.2792, 1.2745, '0.0054'), 0.0054);
  assert.equal(oneR(18143, 17900, '1,240'), 1240);
  // A fill on the favourable side keeps the planned risk too: a stop-out then costs a little more than 1R.
  assert.equal(oneR(101.0, 98.0, '2.50'), 2.5);
});

test('cards without a risk key keep |entry - stop|', () => {
  assert.ok(Math.abs(oneR(98.2, 98.0, undefined) - 0.2) < 1e-9);
  assert.ok(Math.abs(oneR(98.2, 98.0, null) - 0.2) < 1e-9);
  assert.ok(Math.abs(oneR(98.2, 98.0, '-') - 0.2) < 1e-9);
  assert.ok(Math.abs(oneR(98.2, 98.0, '0') - 0.2) < 1e-9);
  assert.equal(oneR(158.34, 160.2, ''), Math.abs(158.34 - 160.2));
});
