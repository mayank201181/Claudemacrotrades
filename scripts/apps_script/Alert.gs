// Macro Desk morning alert: tells you when the day's Fable Takeaways email has not arrived.
// It runs inside your own Google account, so it still works when Claude is out of usage or down.
// Once a day, between 08:15 and 08:45 Singapore time, it looks through Gmail (every folder, Trash
// included) for a digest whose subject starts "MACRO TAKEAWAYS [Fable" and which was sent today.
// If there is none it mails you one short alert, at most once a day.
// It uses only what Code.gs already uses (Gmail, triggers, script properties), so adding it asks for
// no new permission and holds no address or token: the alert goes to the address the digests go to.
// Setup: add this file to the same Apps Script project as Code.gs, then run `setupTakeawaysAlert` once.

const MTA_TZ = 'Asia/Singapore';
const MTA_QUERY = 'in:anywhere subject:"MACRO TAKEAWAYS [Fable" newer_than:30d';
const MTA_DIGEST = /^\s*MACRO TAKEAWAYS \[Fable/i; // any version tag
const MTA_REPLY = /^\s*(re|fwd?|fw)\s*:/i;       // replies and forwards quote a digest but are not one

// 00:00 Singapore time on the day of `now`, as epoch milliseconds (Singapore is UTC+8 all year).
function mtaDayStart_(now) {
  const sgt = new Date(now.getTime() + 8 * 3600000);
  return Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - 8 * 3600000;
}

function mtaStamp_(d) { return Utilities.formatDate(d, MTA_TZ, 'EEE d MMM yyyy HH:mm') + ' SGT'; }

// Newest Fable digests first. Returns today's digest if there is one, the latest one seen, and its address.
function mtaScan_(now) {
  const start = mtaDayStart_(now);
  const out = { today: null, last: null, to: '' };
  GmailApp.search(MTA_QUERY, 0, 10).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      const subject = m.getSubject() || '';
      if (MTA_REPLY.test(subject) || !MTA_DIGEST.test(subject)) return;
      const at = m.getDate();
      if (!out.last || at.getTime() > out.last.at.getTime()) { out.last = { at: at, subject: subject }; out.to = m.getTo(); }
      if (at.getTime() >= start && (!out.today || at.getTime() < out.today.at.getTime())) out.today = { at: at, subject: subject };
    });
  });
  return out;
}

// The daily check. Safe to run by hand: it mails at most one alert per Singapore day.
function checkTakeaways() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(now, MTA_TZ, 'yyyy-MM-dd');
  const scan = mtaScan_(now);
  if (scan.to) props.setProperty('mta_to', scan.to);
  if (scan.today) {
    console.log('Fable Takeaways for ' + day + ' arrived ' + mtaStamp_(scan.today.at));
    return 'ok';
  }
  if (props.getProperty('mta_alerted') === day) {
    console.log('No Fable Takeaways for ' + day + '; alert already sent today.');
    return 'already';
  }
  const to = scan.to || props.getProperty('mta_to');
  if (!to) throw new Error('No Fable Takeaways today, and no digest in the last 30 days to take the address from.');
  const checked = Utilities.formatDate(now, MTA_TZ, 'HH:mm') + ' SGT';
  const subject = 'ALERT: no Fable Takeaways email yet (' + Utilities.formatDate(now, MTA_TZ, 'EEE d MMM') + ', checked ' + checked + ')';
  const body = [
    'No Fable Takeaways email sent today is in Gmail as of ' + checked + ' (every folder checked, Trash included).',
    'Latest one found: ' + (scan.last ? mtaStamp_(scan.last.at) : 'none in the last 30 days') + '.',
    '',
    'Usual causes: the Claude usage limit is spent (https://claude.ai/settings/usage), or the 06:33 run and its 07:20 retry both failed.',
    'To get today\'s edition, open the Macro Desk project in Claude and ask for today\'s Takeaways run.',
    '',
    'Sent by Alert.gs in your own Google account, at most once a day. It does not depend on Claude.',
  ].join('\n');
  GmailApp.sendEmail(to, subject, body);
  props.setProperty('mta_alerted', day);
  console.log('Alert sent: ' + subject);
  return 'alerted';
}

// Run once (again after pasting a new version): installs the daily check and mails one confirmation,
// so you can see the alert reach you. The triggers of Code.gs and Spec.gs are untouched.
function setupTakeawaysAlert() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkTakeaways') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkTakeaways').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(MTA_TZ).create();
  const now = new Date();
  const scan = mtaScan_(now);
  const props = PropertiesService.getScriptProperties();
  if (scan.to) props.setProperty('mta_to', scan.to);
  const to = scan.to || props.getProperty('mta_to');
  if (!to) throw new Error('Daily check installed, but no Fable digest was found in the last 30 days to take your address from.');
  const seen = scan.today ? 'Today\'s edition arrived ' + mtaStamp_(scan.today.at) + '.'
    : 'No edition sent today is in Gmail right now; the latest one found is ' + (scan.last ? mtaStamp_(scan.last.at) : 'none') + '.';
  GmailApp.sendEmail(to, 'Takeaways alert is on (daily check between 08:15 and 08:45 SGT)', [
    'From tomorrow this account checks once a day, between 08:15 and 08:45 Singapore time, for the day\'s Fable Takeaways email.',
    'If it is missing you get one email whose subject starts "ALERT: no Fable Takeaways email yet". If it has arrived you hear nothing.',
    '',
    'What the check sees now: ' + seen,
    '',
    'To switch it off, delete the checkTakeaways trigger in the Apps Script project (Triggers, the clock icon).',
  ].join('\n'));
  console.log('Daily check installed. ' + seen + ' Confirmation mailed.');
}
