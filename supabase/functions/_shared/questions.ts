// The odds engine as the digest prints it: yellow tags (an open question's odds moved, or it
// resolved), the footer QUESTION LIST (new, retired, resolved, open), red NEW SCENARIO blocks,
// CROWD EXTREME notes and the SCORECARD line. The brief_state Drive doc is parsed too, to seed
// what the emails never printed (rules and opening dates of questions older than the first email).
// Formats are fixed by the Macro Takeaways prompt (STEP 3B, B2–B10); nothing here re-judges a call.
import { decodeEntities, stripTags, unescapeDoc, type Model } from './parse.ts';

export interface Evidence { val: number; text: string; type: string | null; access: string | null; links: string[]; echo?: boolean }
export interface QMove {
  qid: string; tag_n: number | null; net: string; net_val: number; question: string | null;
  resolves: string | null; resolves_text: string | null; implied: string | null; priced: string | null; evidence: Evidence[];
}
export interface QEvent { qid: string; kind: 'new' | 'resolved' | 'retired' | 'open' | 'theme' | 'crowd'; body: Record<string, unknown> }
export interface DigestQuestions { moves: QMove[]; events: QEvent[]; scorecard: Record<string, number> | null }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ARROW_VAL: Record<string, number> = { '↑↑': 2, '↑': 1, '↓': -1, '↓↓': -2 };
const NET_CODE: Record<string, [string, number]> = { '↑↑': ['UU', 2], '↑': ['U', 1], '↔': ['N', 0], '↓': ['D', -1], '↓↓': ['DD', -2] };

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// "10 Oct", "Fri 9 Oct", "tonight", "tomorrow" → ISO date, relative to the digest date.
export function dateNear(s: string | null | undefined, ref: string): string | null {
  if (!s) return null;
  if (/\b(today|tonight)\b/i.test(s)) return ref;
  if (/\btomorrow\b/i.test(s)) return addDays(ref, 1);
  const m = s.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b(?:\s+(\d{4}))?/i);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
  const ry = Number(ref.slice(0, 4)), rm = Number(ref.slice(5, 7));
  let y = m[3] ? Number(m[3]) : ry;
  if (!m[3] && mo < rm - 6) y += 1;           // "5 Jan" read in December
  if (!m[3] && mo > rm + 6) y -= 1;           // "28 Dec" read in January
  return iso(y, mo, Number(m[1]));
}

// Every element whose opening tag matches `open`, with its balanced inner HTML (nested same-name tags included).
export function balanced(html: string, tag: 'span' | 'div', open: RegExp): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!open.test(m[0])) continue;
    const tok = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, 'gi');
    tok.lastIndex = m.index + m[0].length;
    let depth = 1, t: RegExpExecArray | null, end = -1;
    while ((t = tok.exec(html))) {
      depth += t[0][1] === '/' ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    if (end < 0) continue;
    out.push(html.slice(m.index + m[0].length, end));
    re.lastIndex = end;
  }
  return out;
}

const text = (h: string) => stripTags(h).replace(/\s+/g, ' ').trim();
const hrefs = (h: string) => [...h.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
const YELLOW = /background-color\s*:\s*#fff0a0/i;
const RED = /background-color\s*:\s*#f9c9c9/i;
// "(data · flow desk)", "(policy)", "(policy — Reuters)", "(data/policy · official)", "(policy action · policy)".
const TYPE_ACCESS = /\(\s*(data|policy|mind-change|argument|physical)\b[a-z /-]*?(?:\s*(·|—)\s*([^()]+?))?\s*\)/gi;

function parseEvidence(segment: string): Evidence[] {
  // "↓ A; ↓ B (data · policy) link" holds two arrows: split them, the second's class covers both.
  const parts = segment.split(/;\s*(?=(?:<[^>]+>\s*)*(?:↑↑|↓↓|↑|↓)\s)/);
  const ev: Evidence[] = [];
  for (const p of parts) {
    const t = text(p);
    const am = t.match(/^(↑↑|↓↓|↑|↓)\s*/);
    if (!am) continue;
    const tas = [...t.matchAll(TYPE_ACCESS)];
    const ta = tas.length ? tas[tas.length - 1] : null;
    const type = ta ? (ta[1].toLowerCase() === 'physical' ? 'data' : ta[1].toLowerCase()) : null;
    ev.push({
      val: ARROW_VAL[am[1]], text: t.slice(am[0].length).slice(0, 400),
      type, access: ta && ta[2] === '·' ? ta[3].toLowerCase().trim() : null, links: hrefs(p),
    });
  }
  for (let i = ev.length - 2; i >= 0; i--) {
    if (!ev[i].type && ev[i + 1].type) { ev[i].type = ev[i + 1].type; ev[i].access = ev[i + 1].access; }
  }
  return ev;
}

// Inline resolution tags: "[11] Q05 resolved NO (source) → HIT" — several can share one yellow span.
const RESOLVED_TAG = /\[(\d+)\]\s*(Q\d{2,})\s*(?:\([^()]*\)\s*)?resolved\s+(YES|NO)\b\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*(?:→|->)\s*(HIT|MISS|FLAT)/gi;
export function resolvedTags(t: string): QEvent[] {
  return [...t.matchAll(RESOLVED_TAG)].map((m) => ({
    qid: m[2].toUpperCase(), kind: 'resolved' as const,
    body: { tag_n: Number(m[1]), outcome: m[3].toUpperCase(), source: m[4] ?? null, verdict: m[5].toUpperCase() },
  }));
}

// One yellow tag → a move (the question's odds moved today), or null for a resolution tag.
export function parseYellowTag(inner: string, d: string): { move?: QMove } | null {
  const h = inner.replace(/&middot;|&#183;|&#xb7;/gi, '·');
  const t = text(h);
  const hm = t.match(/^\[(\d+)\]\s*(Q\d{2,})\s+NET\s*(↑↑|↓↓|↑|↓|↔)/i);
  if (!hm) return null;
  const [net, net_val] = NET_CODE[hm[3]];
  const segs = h.split(/\s·\s(?=(?:<[^>]+>\s*)*(?:↑↑|↓↓|↑|↓|Echo\s*:|Priced\s*:))/);
  const head = text(segs[0]).replace(/^\[\d+\]\s*Q\d{2,}\s+NET\s*(?:↑↑|↓↓|↑|↓|↔)\s*(?:\(?two-way\)?)?\s*/i, '');
  const hp = head.split(/\s·\s/);
  const q0 = hp[0]?.trim() || '';
  const question = (q0.includes('?') ? q0.slice(0, q0.indexOf('?') + 1) : q0) || null;
  const resPart = hp.find((p) => /^resolves\b/i.test(p.trim())) ?? null;
  const impIdx = hp.findIndex((p) => /^Implied\s*:/i.test(p.trim()));
  const implied = impIdx >= 0 ? hp.slice(impIdx).join(' · ').replace(/^Implied\s*:\s*/i, '').trim() : null;
  const evidence: Evidence[] = [];
  let priced: string | null = null;
  for (const s of segs.slice(1)) {
    const st = text(s);
    if (/^Priced\s*:/i.test(st)) { priced = st.replace(/^Priced\s*:\s*/i, '').slice(0, 300); continue; }
    if (/^Echo\s*:/i.test(st)) { evidence.push({ val: 0, text: st.replace(/^Echo\s*:\s*/i, '').slice(0, 400), type: null, access: null, links: hrefs(s), echo: true }); continue; }
    evidence.push(...parseEvidence(s));
  }
  const resolves_text = resPart ? resPart.replace(/^resolves\s*/i, '').trim() : null;
  return {
    move: {
      qid: hm[2].toUpperCase(), tag_n: Number(hm[1]), net, net_val, question,
      // Tags without a "resolves" field still carry the deadline in the question ("… by 9 Oct?").
      resolves: dateNear(resolves_text, d) ?? dateNear(question?.match(/\b(?:by|through|before)\s+(?:[A-Z][a-z]{2}\s+)?(\d{1,2}\s+[A-Z][a-z]{2,8})/)?.[1], d),
      resolves_text, implied, priced, evidence,
    },
  };
}

function footerEvents(t: string, d: string): { events: QEvent[]; scorecard: Record<string, number> | null } {
  const events: QEvent[] = [];
  for (const m of t.matchAll(/New:\s*(Q\d{2,})\s*·\s*(.+?)\s*·\s*resolves\s+(.+?)\s*·\s*RULE:\s*(.+?)\s*[—–-]\s*reply\s*['‘’"]?drop/gi)) {
    const rest = m[4];
    const cut = rest.lastIndexOf(' · ');
    events.push({ qid: m[1].toUpperCase(), kind: 'new', body: {
      question: m[2].trim(), resolves: dateNear(m[3], d), resolves_text: m[3].trim(),
      rule: (cut > 0 ? rest.slice(0, cut) : rest).trim(), why: cut > 0 ? rest.slice(cut + 3).trim() : null,
    } });
  }
  for (const m of t.matchAll(/(Q\d{2,})\s*(?:\([^()]*\)\s*)?resolved\s+(YES|NO)\b\s*(?:\(((?:[^()]|\([^()]*\))*)\))?\s*[—–-]\s*arrows\s+net\s*([+\-−]?\s*\d+)\s*over\s*(\d+)\s*days?\s*(?:→|->)\s*(HIT|MISS|FLAT)(?:\s*·\s*opened at implied\s*(.+?)\s*,\s*last implied\s*(.+?)(?=\s*(?:·|\.\s|SCORECARD|Q\d{2,}\s*(?:\([^()]*\)\s*)?resolved|$)))?/gi)) {
    events.push({ qid: m[1].toUpperCase(), kind: 'resolved', body: {
      outcome: m[2].toUpperCase(), source: m[3] ?? null, net: Number(m[4].replace(/[−\s]/g, (c) => (c === '−' ? '-' : ''))),
      days: Number(m[5]), verdict: m[6].toUpperCase(), open_implied: m[7]?.trim() ?? null, last_implied: m[8]?.trim() ?? null,
    } });
  }
  // Case-sensitive: "not retired:" in prose is not the list line.
  for (const ret of t.matchAll(/\bRetired:\s*(.{0,300}?)(?=\s*(?:·\s*Added at your request|·\s*New:|New:|Stances|stance ledger|SCORECARD|Open, no move|$))/g)) {
    for (const m of ret[1].matchAll(/(Q\d{2,})\s*\(([^)]*)\)/g)) events.push({ qid: m[1].toUpperCase(), kind: 'retired', body: { why: m[2].trim() } });
  }
  const open = t.match(/Open,?\s*no move today:\s*(.+?)(?=\.\s+(?:No |Nothing|New:|Retired|Resolved|Moved|All |Q\d{2,}\b|Stances|SCORECARD)|\s+Stances\b|$)/i);
  if (open) {
    for (const item of open[1].split(/\s·\s(?=Q\d{2,}\b)/)) {
      const m = item.match(/^(Q\d{2,})\s+(.*)$/);
      if (m) events.push({ qid: m[1].toUpperCase(), kind: 'open', body: { label: m[2].replace(/\.$/, '').trim() } });
    }
  }
  const sc = t.match(/SCORECARD:\s*resolved\s+(\d+)\s*·\s*hit\s+(\d+)\s*·\s*miss\s+(\d+)\s*·\s*flat\s+(\d+)(?:\s*·\s*against-market:\s*(\d+)\s*calls?\s*·\s*(\d+)\s*hit)?/i);
  const scorecard = sc ? { resolved: +sc[1], hit: +sc[2], miss: +sc[3], flat: +sc[4], against_calls: sc[5] ? +sc[5] : 0, against_hit: sc[6] ? +sc[6] : 0 } : null;
  return { events, scorecard };
}

// The 24 Sep 2026 layout printed the odds as a numbered BRIEF list instead of yellow tags:
// <p>2. <b>Q04 · USDJPY >158.50 by 2 Oct · resolves 3 Oct</b><br>Implied: …<br>↑↑ … (data · flow desk) link<br>Echo: …<br>NET ↑↑ · Priced: …</p>
export function legacyBrief(body: string, d: string): QMove[] {
  const out: QMove[] = [];
  for (const pm of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const lines = pm[1].replace(/&middot;|&#183;/gi, '·').split(/<br\s*\/?>/i);
    const hm = text(lines[0]).match(/^\d+\.\s*(Q\d{2,})\s*·\s*(.+?)(?:\s*·\s*resolves\s+(.+))?$/);
    const netLine = lines.map(text).find((l) => /^NET\s*(↑↑|↓↓|↑|↓|↔)/.test(l));
    if (!hm || !netLine) continue;
    const [net, net_val] = NET_CODE[netLine.match(/^NET\s*(↑↑|↓↓|↑|↓|↔)/)![1]];
    const evidence: Evidence[] = [];
    let implied: string | null = null;
    for (const l of lines.slice(1)) {
      const lt = text(l);
      if (/^Implied\s*:/i.test(lt)) implied = lt.replace(/^Implied\s*:\s*/i, '');
      else if (/^Echo\s*:/i.test(lt)) evidence.push({ val: 0, text: lt.replace(/^Echo\s*:\s*/i, '').slice(0, 400), type: null, access: null, links: hrefs(l), echo: true });
      else if (/^(↑↑|↓↓|↑|↓)\s/.test(lt)) evidence.push(...parseEvidence(l));
    }
    out.push({
      qid: hm[1].toUpperCase(), tag_n: null, net, net_val, question: hm[2].trim(), resolves: dateNear(hm[3], d), resolves_text: hm[3]?.trim() ?? null,
      implied, priced: (netLine.match(/Priced\s*:\s*(.+)$/i) || [])[1]?.slice(0, 300) ?? null, evidence,
    });
  }
  return out;
}

export function extractQuestions(html: string, d: string): DigestQuestions {
  const body = html.replace(/<h2[^>]*>\s*(?:<[^>]+>\s*)*ADMIN FLAGS[\s\S]*?(?=<h2\b|$)/i, '');
  const moves = new Map<string, QMove>();
  const events: QEvent[] = [];
  for (const inner of balanced(body, 'span', YELLOW)) {
    const r = parseYellowTag(inner, d);
    if (r?.move && !moves.has(r.move.qid)) moves.set(r.move.qid, r.move);
    events.push(...resolvedTags(text(inner.replace(/&middot;|&#183;/gi, '·'))));
  }
  for (const mv of legacyBrief(body, d)) if (!moves.has(mv.qid)) moves.set(mv.qid, mv);
  for (const inner of balanced(body, 'div', RED)) {
    const t = text(inner.replace(/&middot;|&#183;/gi, '·'));
    const m = t.match(/^\[(\d+)\]\s*NEW SCENARIO\s+(T\d{2,})\s*(?:·\s*)?(Update:\s*)?(.*?)\s*(?:[—–]\s|$)/i);
    if (!m) continue;
    const indep = t.match(/independent sources(?: to date)?\s*:?\s*(\d+)/i);
    const becomes = t.match(/Becomes a live question if\s*:?\s*(.+)$/i);
    events.push({ qid: m[2].toUpperCase(), kind: 'theme', body: {
      tag_n: Number(m[1]), label: m[4].trim().slice(0, 200), update: !!m[3], indep: indep ? Number(indep[1]) : null,
      becomes_if: becomes ? becomes[1].slice(0, 300) : null, text: t.slice(0, 900),
    } });
  }
  const all = text(body.replace(/&middot;|&#183;/gi, '·'));
  for (const m of all.matchAll(/\[(\d+)\]\s*CROWD EXTREME\s*:\s*(.+?)(?=\s\[\d+\]\s|$)/gi)) {
    events.push({ qid: `C${m[1]}`, kind: 'crowd', body: { tag_n: Number(m[1]), text: m[2].slice(0, 600) } });
  }
  const f = footerEvents(all, d);
  // A resolution printed both as a tag and in the footer is one event; the footer line has more fields.
  for (const e of events) {
    const fe = e.kind === 'resolved' ? f.events.find((x) => x.kind === 'resolved' && x.qid === e.qid) : undefined;
    if (!fe) f.events.push(e);
    else { fe.body.tag_n = fe.body.tag_n ?? e.body.tag_n; fe.body.source = fe.body.source ?? e.body.source; }
  }
  return { moves: [...moves.values()], events: f.events, scorecard: f.scorecard };
}

// ---------- brief_state_current (Drive) ----------

export interface StateQuestion {
  qid: string; question: string; rule: string | null; status: string | null; opened: string | null; resolves: string | null;
  closed: string | null; bucket: string | null; net_to_date: number | null; last_moved: string | null; flagged: number | null;
  open_implied: string | null; last_implied: string | null; entries: { d: string; implied: string; net: string; evidence: string; priced: string; link: string }[];
}
export interface BriefState { updated: string | null; scorecard: string | null; questions: StateQuestion[] }

const dOnly = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s.trim()) ? s.trim().slice(0, 10) : null);

export function parseBriefState(docText: string): BriefState {
  const t = unescapeDoc(docText).replace(/\r/g, '');
  const updated = (t.match(/Last updated:\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)/i) || [])[1] ?? null;
  const scorecard = (t.match(/^\s*SCORECARD:\s*(.+)$/im) || [])[1]?.trim() ?? null;
  const qsec = t.split(/^\s*SECTION QUESTIONS\s*$/im)[1]?.split(/^\s*SECTION (?:THEMES|FEEDBACK LOG|ITEMS)\s*$/im)[0] ?? '';
  const questions: StateQuestion[] = [];
  for (const block of qsec.split(/^\s*##\s+/m).slice(1)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const hm = lines[0]?.match(/^(Q\d{2,})\s*[—–-]\s*(.+)$/);
    if (!hm) continue;
    const metaLine = lines.find((l) => /^META:/i.test(l)) ?? '';
    const parts = metaLine.replace(/^META:\s*/i, '').split(/\s·\s/).map((p) => p.trim());
    const field = (k: string) => parts.find((p) => p.toLowerCase().startsWith(`${k} `))?.slice(k.length + 1).trim();
    const net = field('net-to-date');
    const entries = lines.filter((l) => /^[-*•]?\s*20\d{2}-\d{2}-\d{2}\s·/.test(l)).map((l) => {
      const f = l.replace(/^[-*•]\s*/, '').split(/\s·\s/);
      return { d: f[0], implied: (f[1] ?? '').replace(/^implied\s*/i, ''), net: (f[2] ?? '').replace(/^net\s*/i, ''), evidence: f[3] ?? '', priced: (f[4] ?? '').replace(/^priced\s*/i, ''), link: f.slice(5).join(' · ') };
    });
    const bucket = parts.find((p) => /^(G10 FX|Asia FX|G3 rates|Asia rates|energy|commodities ex-energy|equities\/credit|equities|geopolitics\/policy)$/i.test(p)) ?? null;
    questions.push({
      qid: hm[1].toUpperCase(), question: hm[2].trim(), rule: (lines.find((l) => /^RULE:/i.test(l)) ?? '').replace(/^RULE:\s*/i, '') || null,
      status: parts[0] || null, opened: dOnly(field('opened')), resolves: dOnly(field('resolves')), closed: dOnly(field('closed')),
      bucket, net_to_date: net && /^[+\-−]?\d+$/.test(net) ? Number(net.replace('−', '-')) : null, last_moved: dOnly(field('last-moved')),
      flagged: field('flagged') ? Number(field('flagged')) : null, open_implied: field('open-implied') ?? null, last_implied: field('last-implied') ?? null,
      entries,
    });
  }
  return { updated, scorecard, questions };
}

export const modelOfState = (s: string): Model | null => (/opus/i.test(s) ? 'opus' : /fable/i.test(s) ? 'fable' : null);
