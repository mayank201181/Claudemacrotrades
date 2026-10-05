// Macro Desk feeder — Google Apps Script that runs inside your own Google account.
// Every 10 minutes it sends any new "MACRO TAKEAWAYS [Fable 5.1]/[Opus 5.5]" email and any
// updated trade_book_current doc to the dashboard's ingest function, then refreshes marks.
// Setup: paste into a new project at script.google.com, set TOKEN, run `setup` once.
// TOKEN is dash.config.ingest_token in Supabase (kept out of this public repo).

const ENDPOINT = 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-ingest';
const MARK = 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-mark';
const TOKEN = 'PASTE_INGEST_TOKEN_HERE';
const BACKFILL_SINCE = '2026/09/23';
const BOOK_FOLDERS = { fable: '13xLuNZTYrt4AJ5HZXqZbL3n2JU-c7xKZ', opus: '1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm' };

function post_(url, body) {
  const r = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ token: TOKEN }, body)),
  });
  return { code: r.getResponseCode(), text: r.getContentText().slice(0, 400) };
}

function syncMacroDesk() {
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty('seen') || '{}');
  const now = Date.now();
  let changed = false;

  // 1. Trade books: post whenever the newest trade_book_current doc changes.
  Object.keys(BOOK_FOLDERS).forEach(function (model) {
    const it = DriveApp.getFolderById(BOOK_FOLDERS[model]).getFilesByName('trade_book_current');
    let best = null;
    while (it.hasNext()) { const f = it.next(); if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f; }
    if (!best) return;
    const stamp = best.getId() + '|' + best.getLastUpdated().getTime();
    if (seen['book_' + model] === stamp) return;
    const text = DocumentApp.openById(best.getId()).getBody().getText();
    const res = post_(ENDPOINT, { kind: 'trade_book', fileId: best.getId(), data: { fileContent: text } });
    console.log('book ' + model + ' → ' + res.code + ' ' + res.text);
    if (res.code === 200) { seen['book_' + model] = stamp; changed = true; }
  });

  // 2. Digests: first run backfills from BACKFILL_SINCE, later runs look at the last 3 days.
  const query = 'subject:"MACRO TAKEAWAYS" ' + (props.getProperty('backfilled') ? 'newer_than:3d' : 'after:' + BACKFILL_SINCE);
  let allOk = true;
  GmailApp.search(query, 0, 100).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      const subject = m.getSubject();
      if (!/^MACRO TAKEAWAYS \[(Fable|Opus)/.test(subject)) return;
      if (seen[m.getId()]) return;
      const res = post_(ENDPOINT, { kind: 'gmail_thread', data: { messages: [{
        id: m.getId(), subject: subject, date: m.getDate().toISOString(), htmlBody: m.getBody() }] } });
      console.log('digest ' + subject.slice(0, 60) + ' → ' + res.code + ' ' + res.text);
      if (res.code === 200) { seen[m.getId()] = now; changed = true; } else { allOk = false; }
    });
  });
  if (allOk) props.setProperty('backfilled', '1');

  // Forget message ids older than 10 days (the 3-day window never revisits them).
  Object.keys(seen).forEach(function (k) { if (k.indexOf('book_') !== 0 && now - seen[k] > 10 * 86400000) delete seen[k]; });
  props.setProperty('seen', JSON.stringify(seen));

  if (changed) console.log('marks → ' + post_(MARK, {}).text);
}

// Run once: authorises the script, does the first sync (backfill) and installs the 10-minute trigger.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMacroDesk') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncMacroDesk').timeBased().everyMinutes(10).create();
  syncMacroDesk();
}
