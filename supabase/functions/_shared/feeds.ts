// Parsers for the companion digests shown on the YouTube / Podcast / Grok / Substack tabs.
// Each email is kept as its own sections (sanitised HTML), so format changes in the
// digests never break the page. The Substack tab is the newsletter part of the Email
// Digest only: personal, admin, trash and spam sections are dropped here, before storage.
import { sanitize, stripTags, decodeEntities, scrubPersonal, privacy } from './parse.ts';

export type Family = 'youtube' | 'podcast' | 'grok' | 'substack';
export interface FeedSection { title: string; html: string; }
export interface Feed {
  family: Family; source: string; d: string; gmail_id: string; subject: string; sent_at: string;
  intro: string; sections: FeedSection[]; stances: string | null;
}

export function feedFamily(subject: string): Family | null {
  if (/^MACRO TAKEAWAYS/i.test(subject)) return null;
  if (/YouTube Digest/i.test(subject)) return 'youtube';
  if (/Podcast Digest/i.test(subject)) return 'podcast';
  if (/GROK FULL CONSOLIDATED|GROK CROWDING CHECK/i.test(subject)) return 'grok';
  if (/Email Digest/i.test(subject) && !/source alert/i.test(subject)) return 'substack';
  return null;
}

export function feedSource(subject: string): string {
  if (/GROK CROWDING CHECK/i.test(subject)) return 'crowding'; // Grok Bot weekly routine (docs/grok_crowding_routine.md)
  if (/Grok Bot/i.test(subject)) return 'grokbot'; // console built by Grok Bot instead of ChatGPT (docs/grok_console_routine.md)
  if (/\[Fable[^\]]*\]/i.test(subject)) return 'fable';
  if (/\[Opus[^\]]*\]/i.test(subject)) return 'opus';
  if (/ChatGPT/i.test(subject)) return 'chatgpt';
  return 'claude'; // untagged Claude copies from before the 24 Sep A/B split
}

const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export function feedDate(subject: string): string | null {
  const iso = subject.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = subject.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  return m ? `${m[3]}-${MON[m[2].toLowerCase().slice(0, 3)]}-${m[1].padStart(2, '0')}` : null;
}

// Newsletter sections of the Email Digest; everything else (action items, family, trash, spam, noise) is personal.
const SUBSTACK_KEEP = /market|research|science|\bai\b|leadership|philosophy|macro/i;
// Personal lines that the digests sometimes fold into the newsletter sections: privacy.drop (see parse.ts).

// Drop every block (paragraph or list item) whose text is personal.
function dropPersonal(html: string): string {
  const blocks = html.replace(/<div\b/gi, '<p').replace(/<\/div>/gi, '</p>').split(/(?<=<\/(?:p|li)>)/i);
  return blocks.filter((b) => !privacy.drop.test(stripTags(b))).join('');
}

function splitSections(body: string): { intro: string; parts: FeedSection[] } {
  // 1) h2-delimited (YouTube, Podcast, Email Digest)
  const h2 = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (h2.length) {
    const parts: FeedSection[] = [];
    h2.forEach((m, i) => {
      const end = i + 1 < h2.length ? h2[i + 1].index! : body.length;
      parts.push({ title: stripTags(m[1]), html: body.slice(m.index! + m[0].length, end) });
    });
    return { intro: body.slice(0, h2[0].index!), parts };
  }
  // 2) <section> blocks whose first large-font div is the title (Grok consolidated)
  const secs = [...body.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)];
  if (secs.length) {
    const parts = secs.map((s) => {
      const t = s[1].match(/<(div|p|h3|h4)[^>]*font-size:\s*(?:1[6-9]|2\d)px[^>]*>([\s\S]*?)<\/\1>/i);
      const title = t ? stripTags(t[2]) : stripTags(s[1]).slice(0, 60);
      return { title, html: t ? s[1].replace(t[0], '') : s[1] };
    });
    return { intro: body.slice(0, secs[0].index!), parts };
  }
  return { intro: '', parts: [{ title: '', html: body }] };
}

export function parseFeed(msg: { id: string; subject: string; date: string; htmlBody?: string; html?: string }): Feed | null {
  const subject = decodeEntities(msg.subject || '');
  const family = feedFamily(subject);
  const d = feedDate(subject);
  if (!family || !d) return null;
  let body = (msg.htmlBody ?? msg.html ?? '').replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  // Machine-readable STANCES block (YouTube/Podcast) is kept apart: it feeds the speaker scoreboard.
  let stances: string | null = null;
  body = body.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, inner: string) => {
    if (/STANCES\s+\d{4}-\d{2}-\d{2}/.test(inner)) { stances = stripTags(inner); return ''; }
    return m;
  });
  const { intro, parts } = splitSections(body);
  const f = privacyFilter(family, parts.map((p) => ({ title: p.title, html: sanitize(p.html) })),
    sanitize(intro.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '')));
  let { sections, intro: introHtml } = f;
  // Some layouts put the whole take before the first heading: show it as its own section.
  if (stripTags(introHtml).length > 1500) { sections = [{ title: 'Overview', html: introHtml }, ...sections]; introHtml = ''; }
  return {
    family, source: feedSource(subject), d, gmail_id: msg.id, subject, sent_at: msg.date,
    intro: introHtml, sections, stances,
  };
}

// The privacy pass on already-sanitised sections. It only ever removes content, so running it
// again over stored rows (dash-ingest {kind:'refilter'}) after the terms change is safe.
export function privacyFilter(family: Family, sections: FeedSection[], intro: string): { sections: FeedSection[]; intro: string } {
  const clean = (h: string) => scrubPersonal(family === 'substack' ? dropPersonal(h) : h);
  let out = sections.map((p) => ({ title: p.title, html: clean(p.html) })).filter((p) => stripTags(p.html).length > 0 || p.title);
  let introHtml = clean(intro);
  if (family === 'substack') {
    out = out.filter((s) => SUBSTACK_KEEP.test(s.title) && !/personal|family|action|trash|spam|noise|important check/i.test(s.title));
    introHtml = ''; // the intro line summarises personal to-dos
  }
  return { sections: out, intro: introHtml };
}
