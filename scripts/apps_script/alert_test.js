// Tests for Alert.gs with Gmail, triggers and script properties mocked. Run: node scripts/apps_script/alert_test.js
// Code.gs, Spec.gs and Alert.gs are loaded into one scope, as Apps Script does, so a name declared twice fails here.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = __dirname;
const src = ['Code.gs', 'Spec.gs', 'Alert.gs'].map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n');

const ME = 'owner@example.com';
function sgt(s) { return new Date(s + '+08:00'); } // '2026-11-10T07:40:00'

function world(messages, now, props) {
  const sent = [];
  const triggers = [];
  const store = Object.assign({}, props || {});
  const queries = [];
  const NowDate = class extends Date {
    constructor() { if (arguments.length === 0) super(now.getTime()); else super(...arguments); }
    static now() { return now.getTime(); }
  };
  const builder = function (fn) {
    const t = { fn: fn, spec: [] };
    const b = {};
    ['timeBased', 'atHour', 'nearMinute', 'everyDays', 'everyMinutes', 'inTimezone'].forEach(function (k) {
      b[k] = function (v) { t.spec.push(k + (v === undefined ? '' : ':' + v)); return b; };
    });
    b.create = function () { triggers.push(t); return t; };
    return b;
  };
  const ctx = {
    Date: NowDate, JSON: JSON, Object: Object, String: String, Number: Number, RegExp: RegExp, Array: Array, Error: Error,
    console: { log: function () {} },
    Utilities: {
      formatDate: function (d, tz, fmt) {
        const p = {};
        new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
        const m2 = String(new Intl.DateTimeFormat('en-GB', { timeZone: tz, month: '2-digit' }).format(d));
        const d2 = String(new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit' }).format(d));
        return fmt.replace('yyyy', p.year).replace('EEE', p.weekday).replace('MMM', p.month).replace('MM', m2)
          .replace('dd', d2).replace('d', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
    },
    PropertiesService: { getScriptProperties: function () {
      return {
        getProperty: function (k) { return k in store ? store[k] : null; },
        setProperty: function (k, v) { store[k] = String(v); },
        deleteProperty: function (k) { delete store[k]; },
        getProperties: function () { return Object.assign({}, store); },
      };
    } },
    GmailApp: {
      search: function (q, start, max) {
        queries.push(q);
        return messages.slice().sort(function (a, b) { return b.at - a.at; }).slice(start, start + max).map(function (m) {
          return { getMessages: function () {
            return [{ getSubject: function () { return m.subject; }, getDate: function () { return m.at; }, getTo: function () { return m.to || ME; } }];
          } };
        });
      },
      sendEmail: function (to, subject, body) { sent.push({ to: to, subject: subject, body: body }); },
    },
    ScriptApp: {
      getProjectTriggers: function () {
        return triggers.map(function (t) { return { getHandlerFunction: function () { return t.fn; }, _t: t }; });
      },
      deleteTrigger: function (h) { triggers.splice(triggers.indexOf(h._t), 1); },
      newTrigger: builder,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'project.gs' });
  return { ctx: ctx, sent: sent, triggers: triggers, store: store, queries: queries };
}

const fable = function (at, tag) { return { subject: 'MACRO TAKEAWAYS [Fable ' + (tag || '5.2') + '] — Tue 10 Nov 2026 | sample line', at: sgt(at) }; };
const others = [
  { subject: 'MACRO TAKEAWAYS [Gemini] — Tue 10 Nov 2026', at: sgt('2026-11-10T07:36:00') },
  { subject: 'ChatGPT Work — MACRO TAKEAWAYS — 2026-11-10 | sample', at: sgt('2026-11-10T07:18:00') },
];
let w, r;

// 1. Today's digest is there: no mail. Any version tag counts.
w = world([fable('2026-11-10T07:40:00'), fable('2026-11-09T07:41:00')].concat(others), sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'ok');
assert.strictEqual(w.sent.length, 0);
assert.strictEqual(w.store.mta_to, ME);
assert.ok(/^in:anywhere /.test(w.queries[0]), 'search must include Trash');
w = world([fable('2026-11-10T07:40:00', '5.1')], sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'ok');
w = world([fable('2026-11-10T07:40:00', '6')], sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'ok');

// 2. Only yesterday's Fable digest, plus today's other models: one alert, then none for the rest of the day.
w = world([fable('2026-11-09T07:41:00')].concat(others), sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');
assert.strictEqual(w.sent.length, 1);
assert.strictEqual(w.sent[0].to, ME);
assert.strictEqual(w.sent[0].subject, 'ALERT: no Fable Takeaways email yet (Tue 10 Nov, checked 08:27 SGT)');
assert.ok(w.sent[0].body.indexOf('Latest one found: Mon 9 Nov 2026 07:41 SGT.') >= 0, w.sent[0].body);
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'already');
assert.strictEqual(w.sent.length, 1);
// The alert must not look like a digest to anything that searches for one.
[w.sent[0].subject, w.sent[0].body].forEach(function (t) { assert.ok(!/MACRO TAKEAWAYS/i.test(t), t); });
assert.ok(!/^MACRO TAKEAWAYS \[(Fable|Opus)/i.test(w.sent[0].subject));

// 3. A reply or forward dated today is not a digest.
w = world([{ subject: 'Re: MACRO TAKEAWAYS [Fable 5.2] — Mon 9 Nov 2026 | sample', at: sgt('2026-11-10T07:50:00') },
  { subject: 'Fwd: MACRO TAKEAWAYS [Fable 5.2] — Tue 10 Nov 2026', at: sgt('2026-11-10T07:55:00') }, fable('2026-11-09T07:41:00')],
  sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');

// 4. The day boundary is midnight Singapore time.
w = world([fable('2026-11-10T00:05:00')], sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'ok');
w = world([fable('2026-11-09T23:55:00')], sgt('2026-11-10T08:27:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');
w = world([fable('2026-11-10T07:40:00')], sgt('2026-11-11T08:16:00'));
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');
assert.strictEqual(vm.runInContext('mtaDayStart_(new Date())', w.ctx), sgt('2026-11-11T00:00:00').getTime());

// 5. Nothing in 30 days: use the remembered address; with none remembered, fail loudly.
w = world([], sgt('2026-11-10T08:27:00'), { mta_to: ME });
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');
assert.strictEqual(w.sent[0].to, ME);
assert.ok(w.sent[0].body.indexOf('Latest one found: none in the last 30 days.') >= 0);
w = world([], sgt('2026-11-10T08:27:00'));
assert.throws(function () { vm.runInContext('checkTakeaways()', w.ctx); }, /no digest in the last 30 days/);
assert.strictEqual(w.sent.length, 0);

// 6. An alert yesterday does not silence today.
w = world([fable('2026-11-08T07:41:00')], sgt('2026-11-10T08:27:00'), { mta_alerted: '2026-11-09' });
assert.strictEqual(vm.runInContext('checkTakeaways()', w.ctx), 'alerted');
assert.strictEqual(w.store.mta_alerted, '2026-11-10');

// 7. Setup: one daily trigger near 08:30 Singapore time, other triggers untouched, one confirmation mail; running it twice leaves one trigger.
w = world([fable('2026-11-10T12:40:00')], sgt('2026-11-10T14:00:00'));
w.triggers.push({ fn: 'syncMacroDesk', spec: [] }, { fn: 'applySpecEdits', spec: [] });
vm.runInContext('setupTakeawaysAlert(); setupTakeawaysAlert();', w.ctx);
assert.deepStrictEqual(w.triggers.map(function (t) { return t.fn; }).sort(), ['applySpecEdits', 'checkTakeaways', 'syncMacroDesk']);
assert.deepStrictEqual(w.triggers.filter(function (t) { return t.fn === 'checkTakeaways'; })[0].spec,
  ['timeBased', 'atHour:8', 'nearMinute:30', 'everyDays:1', 'inTimezone:Asia/Singapore']);
assert.strictEqual(w.sent.length, 2);
assert.ok(w.sent[0].body.indexOf("Today's edition arrived Tue 10 Nov 2026 12:40 SGT.") >= 0, w.sent[0].body);
assert.ok(!/MACRO TAKEAWAYS/i.test(w.sent[0].subject + w.sent[0].body));

// 8. Alert.gs calls only services the project already uses, so it needs no new permission.
const alertSrc = fs.readFileSync(path.join(dir, 'Alert.gs'), 'utf8').replace(/\/\/.*$/gm, '');
const used = Array.from(new Set(alertSrc.match(/\b[A-Z][A-Za-z]+(?:App|Service)\b|\bSession\b|\bUtilities\b/g) || [])).sort();
assert.deepStrictEqual(used, ['GmailApp', 'PropertiesService', 'ScriptApp', 'Utilities']);

console.log('alert_test: all checks passed');
