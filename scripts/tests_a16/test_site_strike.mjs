// A16 SITE-01: the dashboard reads a card's strike as dash-mark does. Run: node scripts/tests_a16/test_site_strike.mjs [repo_root]
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = process.argv[2] ?? new URL('../..', import.meta.url).pathname;
const line = readFileSync(root + '/site/app.js', 'utf8').split('\n').find((l) => l.includes('const strikeNear ='));
const strikeNear = new Function('cmeta', line.trim().replace(/^const strikeNear = /, 'return ').replace(/;$/, ''))((t) => t);
assert.equal(strikeNear({ strike: '.875' }), 0.875, 'old: 875');
assert.equal(strikeNear({ strike: '1,250/1,200' }), 1250, 'old: 1');
assert.equal(strikeNear({ strike: '100/92' }), 100);
assert.equal(strikeNear({ strike: '−0.25' }), -0.25);
assert.equal(strikeNear({}), null);
console.log('site strike: all passed');
