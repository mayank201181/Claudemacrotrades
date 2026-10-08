// Spec edits: lets a session update trade_book_spec without anyone pasting text.
// The Drive connector can create files but cannot edit a Doc's body. So a session drops a small
// JSON file named `trade_book_spec_edits` in the spec folder, holding [{"find": "...",
// "replace": "..."}, ...]. This script checks that every `find` occurs exactly once in the live
// doc, archives the doc, and applies all the edits, or applies none. The doc keeps its id and
// title, so the pipelines see no change but the text.
// Setup: add this file to the same Apps Script project as Code.gs, then run `setupSpec` once.

const SPEC_FOLDER = '1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm';
const SPEC_TITLE = 'trade_book_spec';
const SPEC_EDITS = 'trade_book_spec_edits';

function newest_(it) {
  let best = null;
  while (it.hasNext()) { const f = it.next(); if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f; }
  return best;
}

function count_(hay, needle) {
  let n = 0, i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function applySpecEdits() {
  const folder = DriveApp.getFolderById(SPEC_FOLDER);
  const staged = newest_(folder.getFilesByName(SPEC_EDITS));
  if (!staged) return;
  const day = Utilities.formatDate(new Date(), 'Asia/Singapore', 'yyyy-MM-dd');
  const reject = function (why) {
    staged.setName(SPEC_EDITS + '_rejected_' + day);
    console.log('spec edits rejected: ' + why);
  };

  let edits;
  try {
    const raw = staged.getMimeType() === MimeType.GOOGLE_DOCS
      ? DocumentApp.openById(staged.getId()).getBody().getText()
      : staged.getBlob().getDataAsString('UTF-8');
    edits = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (e) { return reject('not JSON: ' + e); }
  if (!Array.isArray(edits) || !edits.length) return reject('expected a non-empty list');

  const live = newest_(folder.getFilesByName(SPEC_TITLE));
  if (!live) return reject('no live ' + SPEC_TITLE + ' doc');
  const doc = DocumentApp.openById(live.getId());
  const old = doc.getBody().getText();

  // Every edit must match exactly once against the text as it stands before any edit is applied.
  for (let k = 0; k < edits.length; k++) {
    const e = edits[k];
    if (typeof e.find !== 'string' || typeof e.replace !== 'string' || !e.find) return reject('edit ' + k + ' malformed');
    const n = count_(old, e.find);
    if (n !== 1) return reject('edit ' + k + ' matches ' + n + ' times: "' + e.find.slice(0, 60) + '"');
  }
  let text = old;
  edits.forEach(function (e) { text = text.replace(e.find, function () { return e.replace; }); });
  if (text.indexOf('TRADE BOOK SPEC') !== 0) return reject('result no longer starts with the title line');

  const v = (old.slice(0, 400).match(/version (\d+),/) || [])[1] || 'x';
  live.makeCopy(SPEC_TITLE + '_archive_v' + v + '_' + day, folder);
  doc.getBody().setText(text);
  doc.saveAndClose();
  staged.setName(SPEC_EDITS + '_applied_' + day);
  staged.setTrashed(true);
  console.log('spec edits applied: ' + edits.length + ' edits, v' + v + ' archived, ' + text.length + ' chars live');
}

// Run once: installs a 10-minute trigger for applySpecEdits (Code.gs's own trigger is untouched).
function setupSpec() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'applySpecEdits') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('applySpecEdits').timeBased().everyMinutes(10).create();
  applySpecEdits();
}
