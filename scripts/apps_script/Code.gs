// Macro Desk feeder — Google Apps Script that runs inside your own Google account.
// Every 10 minutes it asks the dashboard which emails to collect (MACRO TAKEAWAYS, YouTube,
// Podcast, Grok and Email digests), sends any new ones, sends updated trade_book_current docs,
// then refreshes marks. New tabs only change the server-side list, never this script.
// Setup: paste into a project at script.google.com, set TOKEN, run `setup` once.
// TOKEN is dash.config.ingest_token in Supabase (kept out of this public repo).

const ENDPOINT = 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-ingest';
const MARK = 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-mark';
const TOKEN = 'PASTE_INGEST_TOKEN_HERE';
const BOOK_FOLDERS = { fable: '13xLuNZTYrt4AJ5HZXqZbL3n2JU-c7xKZ', opus: '1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm' };
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // stop early; the next 10-minute run carries on

function post_(url, body) {
  const r = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ token: TOKEN }, body)),
  });
  return { code: r.getResponseCode(), text: r.getContentText() };
}

function syncMacroDesk() {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  let changed = false;

  // 1. Trade books: post whenever the newest trade_book_current doc changes.
  Object.keys(BOOK_FOLDERS).forEach(function (model) {
    const it = DriveApp.getFolderById(BOOK_FOLDERS[model]).getFilesByName('trade_book_current');
    let best = null;
    while (it.hasNext()) { const f = it.next(); if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f; }
    if (!best) return;
    const stamp = best.getId() + '|' + best.getLastUpdated().getTime();
    if (props.getProperty('book_' + model) === stamp) return;
    const text = DocumentApp.openById(best.getId()).getBody().getText();
    const res = post_(ENDPOINT, { kind: 'trade_book', fileId: best.getId(), data: { fileContent: text } });
    console.log('book ' + model + ' → ' + res.code + ' ' + res.text.slice(0, 200));
    if (res.code === 200) { props.setProperty('book_' + model, stamp); changed = true; }
  });

  // 2. Emails: the list of searches comes from the dashboard.
  const cr = post_(ENDPOINT, { kind: 'config' });
  let cfg = {};
  try { cfg = JSON.parse(cr.text); } catch (e) { console.log('config → ' + cr.code + ' ' + cr.text.slice(0, 200)); }
  const since = cfg.backfill_since || '2026/09/23';
  let outOfTime = false;
  (cfg.feeds || []).forEach(function (spec) {
    if (outOfTime) return;
    const done = props.getProperty('backfilled_' + spec.key);
    const query = spec.query + ' ' + (done ? 'newer_than:3d' : 'after:' + since);
    const re = new RegExp(spec.match, 'i');
    let allOk = true;
    GmailApp.search(query, 0, 200).forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (outOfTime) return;
        if (Date.now() - started > TIME_BUDGET_MS) { outOfTime = true; return; }
        const subject = m.getSubject();
        // Replies and forwards quote the digest but are not digests.
        if (/^\s*(re|fwd?|fw)\s*:/i.test(subject) || !re.test(subject) || props.getProperty('s:' + m.getId())) return;
        const res = post_(ENDPOINT, { kind: 'gmail_thread', data: { messages: [{
          id: m.getId(), subject: subject, date: m.getDate().toISOString(), htmlBody: m.getBody() }] } });
        console.log(spec.key + ' ' + subject.slice(0, 70) + ' → ' + res.code + ' ' + res.text.slice(0, 120));
        if (res.code === 200) { props.setProperty('s:' + m.getId(), String(Date.now())); changed = true; } else { allOk = false; }
      });
    });
    if (allOk && !outOfTime) props.setProperty('backfilled_' + spec.key, '1');
  });

  // Forget message ids older than 10 days (the 3-day window never revisits them).
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('s:') === 0 && Date.now() - Number(all[k]) > 10 * 86400000) props.deleteProperty(k);
  });

  if (changed) console.log('marks → ' + post_(MARK, {}).text.slice(0, 200));
  if (outOfTime) console.log('Time budget reached — the next run continues where this one stopped.');
}

// Run once (again after pasting a new version): re-installs the 10-minute trigger and syncs.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMacroDesk') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncMacroDesk').timeBased().everyMinutes(10).create();
  syncMacroDesk();
}
