// Deterministic parsers for the Macro Takeaways pipeline.
// Inputs are exactly what the routines produce: the digest email HTML and the
// trade_book_current Drive doc text. Nothing here interprets or re-judges a trade;
// it only lifts what was written at the time.

export type Model = 'fable' | 'opus';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

export function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|tr|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

export function modelFromText(s: string): Model | null {
  if (/\[Fable[^\]]*\]/i.test(s)) return 'fable';
  if (/\[Opus[^\]]*\]/i.test(s)) return 'opus';
  return null;
}

// ---------- HTML sanitising ----------

const KEEP_STYLE = /^(color|background|background-color|font-weight|font-style)$/i;

function unwrapGoogle(href: string): string {
  const h = decodeEntities(href);
  const m = h.match(/^https?:\/\/www\.google\.com\/url\?q=([^&]+)/);
  if (!m) return h;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export function sanitize(html: string): string {
  let out = html
    .replace(/<(script|style|head|img|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(img|meta|link|hr)[^>]*\/?>/gi, '');
  out = out.replace(/<([a-z0-9]+)((?:\s+[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/gi, (_m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!['a', 'b', 'strong', 'i', 'em', 'span', 'p', 'br', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'h3', 'h4', 'pre', 'code', 'sup', 'sub', 'u'].includes(t)) return '';
    const keep: string[] = [];
    const re = /([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let a: RegExpExecArray | null;
    while ((a = re.exec(attrs))) {
      const name = a[1].toLowerCase();
      const val = a[3] ?? a[4] ?? '';
      if (t === 'a' && name === 'href') {
        const u = unwrapGoogle(val);
        if (/^https?:\/\//i.test(u)) keep.push(`href="${u.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer"`);
      } else if (name === 'style') {
        const decls = val.split(';').map((d) => d.trim()).filter((d) => {
          const k = d.split(':')[0]?.trim();
          return k && KEEP_STYLE.test(k) && !/url\(|expression/i.test(d);
        });
        if (decls.length) keep.push(`style="${decls.join(';')}"`);
      }
    }
    return `<${t}${keep.length ? ' ' + keep.join(' ') : ''}>`;
  });
  out = out.replace(/<\/([a-z0-9]+)>/gi, (m, tag: string) =>
    ['a', 'b', 'strong', 'i', 'em', 'span', 'p', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'h3', 'h4', 'pre', 'code', 'sup', 'sub', 'u'].includes(tag.toLowerCase()) ? m.toLowerCase() : '');
  return out.trim();
}

// Personal admin items never reach the dashboard.
function dropAdmin(html: string): string {
  return html
    .replace(/<p[^>]*>\s*(<[^>]+>\s*)*Admin(?:\s+flags)?\s*:[\s\S]*?<\/p>/gi, '')
    .replace(/<li[^>]*>\s*(<[^>]+>\s*)*Admin(?:\s+flags)?\s*:[\s\S]*?<\/li>/gi, '');
}

// ---------- digest email ----------

export interface Theme { n: number; title: string; breadth: string | null; html: string; lean_html: string | null; }
export interface Section { key: string; title: string; html: string; }
export interface Digest {
  model: Model; d: string; subject: string; gmail_id: string; sent_at: string;
  built: string | null; header: string; sixty: string[]; themes: Theme[]; sections: Section[];
  trade_block: string | null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function digestDate(subject: string): string | null {
  const m = subject.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

function sectionKey(title: string): string {
  const t = title.toUpperCase();
  if (t.includes('TRADE BOOK')) return 'trade_book';
  if (t.includes('60 SECONDS')) return 'sixty';
  if (/^(THEME\s*\d|\d+\s*[·.])/.test(t)) return 'theme';
  if (/^THEMES?\b/.test(t)) return 'themes';
  if (t.startsWith('TAPE')) return 'tape';
  if (t.startsWith('RADAR')) return 'radar';
  if (t.startsWith('LEDGER')) return 'ledger';
  if (t.startsWith('ADMIN')) return 'admin';
  if (t.startsWith('CROSS-THEME') || t.startsWith('SYNTHESIS')) return 'synthesis';
  if (t.startsWith('STANCE SHIFTS')) return 'stances';
  if (t.startsWith('FOOTER')) return 'footer';
  if (t.startsWith('REFERENCE HEADER') || t.startsWith('MACRO TAKEAWAYS')) return 'header';
  return 'other';
}

function splitBy(html: string, tag: 'h2' | 'h3'): { title: string; body: string }[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const parts: { title: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  let lastIdx = -1;
  let lastTitle = '';
  const pre = { title: '', body: '' };
  while ((m = re.exec(html))) {
    if (lastIdx < 0) pre.body = html.slice(0, m.index);
    else parts.push({ title: lastTitle, body: html.slice(lastIdx, m.index) });
    lastTitle = stripTags(m[1]);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < 0) return [{ title: '', body: html }];
  parts.push({ title: lastTitle, body: html.slice(lastIdx) });
  return [pre, ...parts];
}

function makeTheme(n: number, rawTitle: string, body: string): Theme {
  const title0 = rawTitle.replace(/^(THEME\s*)?\d+\s*[·.—:-]*\s*/i, '').trim();
  // "Title — 5 of 5 feeds, mostly echo"
  const bm = title0.match(/^(.*?)\s*(?:[—–\-·]\s+|\(|\[)((?:\d+|all|five|four|three|two|one)\s+of\s+\d+\b[^)\]]*?feeds?[^)\]]*)[)\]]?\s*$/i);
  const clean = dropAdmin(sanitize(body));
  return { n, title: bm ? bm[1].trim() : title0, breadth: bm ? bm[2].trim() : null, html: clean, lean_html: extractLean(clean) };
}

// The theme's own "My read & lean" block: from its label to the next labelled block.
export function extractLean(html: string): string | null {
  const at = html.search(/My read/i);
  if (at < 0) return null;
  const starts = [...html.slice(0, at).matchAll(/<(p|h3|h4|li)\b/gi)];
  const start = starts.length ? starts[starts.length - 1].index! : at;
  const rest = html.slice(start + 4);
  const endRel = rest.search(/<(h3|h4)\b|<p[^>]*>\s*(?:<[^>]+>\s*)*(Sources|EXTREME CHECK|NEW SCENARIO|\[\d+\s*·\s*NEW SCENARIO|CROWD EXTREME)/i);
  const block = endRel < 0 ? html.slice(start) : html.slice(start, start + 4 + endRel);
  return block.length > 8000 ? block.slice(0, 8000) : block;
}

export function parseDigest(msg: { id: string; subject: string; date: string; htmlBody?: string; html?: string }): Digest | null {
  const html = msg.htmlBody ?? msg.html ?? '';
  const model = modelFromText(msg.subject);
  const d = digestDate(msg.subject);
  if (!model || !d || !/^MACRO TAKEAWAYS/i.test(msg.subject)) return null;
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  const h2s = splitBy(body, 'h2');
  const headerHtml = h2s[0]?.body ?? '';
  const hdrText = stripTags(headerHtml);
  const built = (hdrText.match(/built\s+(\d{1,2}:\d{2})\s*SGT/i) || [])[1] ?? null;

  const sections: Section[] = [];
  const themes: Theme[] = [];
  const sixty: string[] = [];
  let tradeBlock: string | null = null;
  let headerOut = dropAdmin(sanitize(headerHtml));

  for (const part of h2s.slice(1)) {
    const key = sectionKey(part.title);
    if (key === 'admin') continue;
    if (key === 'header') { headerOut += dropAdmin(sanitize(part.body)); continue; }
    if (key === 'trade_book') { tradeBlock = sanitize(part.body); continue; }
    if (key === 'theme') { themes.push(makeTheme(themes.length + 1, part.title, part.body)); continue; }
    if (key === 'themes') {
      const sub = splitBy(part.body, 'h3');
      const themed = sub.slice(1).filter((s) => /^\s*(THEME\s*)?\d+\s*[·.—:-]/i.test(s.title));
      if (themed.length) {
        for (const s of themed) themes.push(makeTheme(themes.length + 1, s.title, s.body));
      } else if (stripTags(part.body).length > 40) {
        sections.push({ key: 'themes_intro', title: part.title, html: dropAdmin(sanitize(part.body)) });
      }
      continue;
    }
    if (key === 'sixty') {
      const lis = part.body.match(/<li[^>]*>[\s\S]*?<\/li>/gi);
      if (lis && lis.length) for (const li of lis) sixty.push(sanitize(li.replace(/^<li[^>]*>|<\/li>$/gi, '')));
      else for (const p of part.body.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? []) sixty.push(sanitize(p.replace(/^<p[^>]*>|<\/p>$/gi, '')));
      continue;
    }
    sections.push({ key, title: part.title, html: dropAdmin(sanitize(part.body)) });
  }
  // Older layout: trade book printed as plain paragraphs before the first h2.
  if (!tradeBlock && /TRADE BOOK/i.test(hdrText)) tradeBlock = sanitize(headerHtml);
  return {
    model, d, subject: msg.subject, gmail_id: msg.id, sent_at: msg.date, built,
    header: headerOut, sixty, themes, sections, trade_block: tradeBlock,
  };
}

// ---------- tested (not entered) ideas ----------

export interface Tested {
  model: Model; d: string; seq: number; idea: string; proxy: string | null; direction: number | null;
  verdict: string; fail_code: string | null; covered_by: string | null;
  rr: number | null; p: number | null; p0: number | null; ev: number | null; reason: string | null; source: 'ledger' | 'email';
}

const num = (s: string | undefined | null): number | null => {
  if (s == null) return null;
  const v = parseFloat(s.replace(/[−–]/g, '-').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(v) ? v : null;
};

export function ideaDirection(idea: string): number | null {
  const s = idea.toLowerCase();
  const m = s.match(/\b(long|short|buy|sell|receive|pay|steepener|flattener|widener|tightener)\b/);
  if (!m) return null;
  return ['long', 'buy', 'receive', 'steepener', 'widener'].includes(m[1]) ? 1 : -1;
}

function verdictParts(v: string): { verdict: string; fail_code: string | null; covered_by: string | null; reason: string | null } {
  const s = v.trim();
  let m = s.match(/^covered by\s+(P\d+)\s*:?\s*(.*)$/i);
  if (m) return { verdict: 'covered', fail_code: null, covered_by: m[1].toUpperCase(), reason: m[2] || null };
  m = s.match(/^not carded\s*\(([a-z])\)\s*:?\s*(.*)$/i);
  if (m) return { verdict: 'not carded', fail_code: m[1].toLowerCase(), covered_by: null, reason: m[2] || null };
  m = s.match(/^carded(?:\s+as)?\s+(P\d+)\s*:?\s*(.*)$/i);
  if (m) return { verdict: 'carded', fail_code: null, covered_by: m[1].toUpperCase(), reason: m[2] || null };
  return { verdict: s.split(/[:(]/)[0].trim().toLowerCase(), fail_code: null, covered_by: null, reason: s };
}

// Ledger form: "- 2026-10-05 · T · idea → not carded (c) · proxy X · rr 1.91 · p 40% · p0 34% · ev +0.16R · reason"
export function parseLedgerT(line: string, model: Model, seq: number): Tested | null {
  const m = line.match(/^-?\s*(\d{4}-\d{2}-\d{2})\s*·\s*T\s*·\s*(.*)$/);
  if (!m) return null;
  const [idea, rest = ''] = m[2].split(/\s*→\s*/, 2);
  const f = rest.split(/\s+·\s+/);
  const kv: Record<string, string> = {};
  const free: string[] = [];
  for (const tok of f.slice(1)) {
    const k = tok.match(/^(proxy|rr|p|p0|ev)\s+(.*)$/i);
    if (k) kv[k[1].toLowerCase()] = k[2].trim(); else free.push(tok);
  }
  const vp = verdictParts(f[0] ?? '');
  const reason = [vp.reason, ...free].filter(Boolean).join(' · ') || null;
  const proxy = kv.proxy && kv.proxy !== 'none' && kv.proxy !== '-' ? kv.proxy : null;
  return {
    model, d: m[1], seq, idea: idea.trim(), proxy, direction: ideaDirection(idea),
    verdict: vp.verdict, fail_code: vp.fail_code, covered_by: vp.covered_by,
    rr: num(kv.rr), p: num(kv.p), p0: num(kv.p0), ev: num(kv.ev), reason, source: 'ledger',
  };
}

// Email form: "Long gold/silver ratio (...) · GCZ26.CMX/SIZ26.CMX · r/r 1.91 · p 40% vs 34% · EV +0.16R → not carded (c): reason"
export function parseEmailTested(tradeBlockHtml: string, model: Model, d: string): Tested[] {
  const text = stripTags(tradeBlockHtml);
  const out: Tested[] = [];
  let seq = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.includes('→') || /^P\d+\b/.test(line)) continue;
    const [left, right] = line.split(/\s*→\s*/, 2);
    const f = left.split(/\s+·\s+/);
    const idea = f[0].trim();
    if (!idea || /^(TESTED|NEW)\b/i.test(idea)) continue;
    let proxy: string | null = null, rr: number | null = null, p: number | null = null, p0: number | null = null, ev: number | null = null;
    for (const tok of f.slice(1)) {
      let k: RegExpMatchArray | null;
      if ((k = tok.match(/^r\/r\s+(.*)$/i))) rr = num(k[1]);
      else if ((k = tok.match(/^p\s+([\d.]+)%\s*vs\s*([\d.]+)%/i))) { p = num(k[1]); p0 = num(k[2]); }
      else if ((k = tok.match(/^EV\s+(.*)$/i))) ev = num(k[1]);
      else if (!proxy && /^[\^A-Z0-9=.\-\/]+$/.test(tok.trim()) && /[A-Z]/.test(tok)) proxy = tok.trim();
    }
    const vp = verdictParts(right ?? '');
    out.push({
      model, d, seq: seq++, idea, proxy, direction: ideaDirection(idea), verdict: vp.verdict,
      fail_code: vp.fail_code, covered_by: vp.covered_by, rr, p, p0, ev, reason: vp.reason, source: 'email',
    });
  }
  return out;
}

// ---------- trade book doc ----------

export interface Trade {
  model: Model; pid: string; title: string; status: string; meta: Record<string, string>;
  asset_class: string | null; direction: number | null; tclass: string | null; proxy: string | null;
  opened: string | null; filled: string | null; closed: string | null;
  ref: number | null; entry: number | null; stop: number | null; target: number | null;
  rr: number | null; p: number | null; p0: number | null; ev: number | null;
  result_r: number | null; exit_reason: string | null; review: string | null;
  thesis: string | null; invalidation: string | null; structure: string | null;
}
export interface Mark { model: Model; pid: string; d: string; mark: number | null; chg: string | null; r: number | null; note: string | null; }
export interface LogLine { model: Model; d: string; seq: number; ref: string; text: string; }
export interface TradeBook { model: Model; updated: string | null; scorecard: string | null; rules: string | null; trades: Trade[]; marks: Mark[]; log: LogLine[]; tested: Tested[]; }

export function unescapeDoc(s: string): string {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!&<>|~=])/g, '$1').replace(/\r/g, '');
}

const META_KEYS = new Set(['opened', 'filled', 'closed', 'class', 'boundary', 'proxy', 'expires', 'ref', 'entry', 'stop', 'target', 'horizon', 'review', 'rr', 'p', 'p0', 'ev', 'pgate', 'factor', 'linked', 'conviction', 'crowd', 'priced', 'result', 'exit']);

function dateOnly(s: string | undefined): string | null {
  const m = (s ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

export function parseTradeBook(docText: string): TradeBook {
  const text = unescapeDoc(docText);
  const model = modelFromText(text.slice(0, 300)) ?? 'opus';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const updated = (text.match(/Last updated:\s*([^·\n]+)/) || [])[1]?.trim() ?? null;
  const scorecard = (lines.find((l) => l.startsWith('SCORECARD:')) ?? '').replace(/^SCORECARD:\s*/, '') || null;
  const rules = (lines.find((l) => l.startsWith('RULES')) ?? '') || null;
  const trades: Trade[] = [];
  const marks: Mark[] = [];
  const log: LogLine[] = [];
  const tested: Tested[] = [];
  let section: 'pre' | 'trades' | 'log' = 'pre';
  let cur: Trade | null = null;
  let logSeq = 0, tSeq = 0;
  for (const l of lines) {
    if (/^SECTION TRADES/.test(l)) { section = 'trades'; continue; }
    if (/^SECTION LOG/.test(l)) { section = 'log'; cur = null; continue; }
    if (section === 'trades') {
      const h = l.match(/^##\s*(P\d+)\s*[—–-]\s*(.*)$/);
      if (h) {
        cur = {
          model, pid: h[1], title: h[2].trim(), status: '', meta: {}, asset_class: null, direction: null, tclass: null,
          proxy: null, opened: null, filled: null, closed: null, ref: null, entry: null, stop: null, target: null,
          rr: null, p: null, p0: null, ev: null, result_r: null, exit_reason: null, review: null,
          thesis: null, invalidation: null, structure: null,
        };
        trades.push(cur);
        continue;
      }
      if (!cur) continue;
      if (l.startsWith('META:')) {
        const toks = l.slice(5).split(/\s+·\s+/).map((t) => t.trim());
        cur.status = toks[0];
        const free: string[] = [];
        for (const t of toks.slice(1)) {
          const sp = t.indexOf(' ');
          const k = sp > 0 ? t.slice(0, sp) : t;
          if (META_KEYS.has(k) && sp > 0) cur.meta[k] = t.slice(sp + 1).trim();
          else free.push(t);
        }
        for (const t of free) {
          if (t === 'long' || t === 'short') cur.direction = t === 'long' ? 1 : -1;
          else if (!cur.asset_class) cur.asset_class = t;
        }
        const g = cur.meta;
        cur.tclass = g.class ?? null; cur.proxy = g.proxy ?? null;
        cur.opened = g.opened ?? null; cur.filled = g.filled && g.filled !== '-' ? g.filled : null; cur.closed = g.closed && g.closed !== '-' ? g.closed : null;
        cur.ref = num(g.ref); cur.entry = num(g.entry); cur.stop = num(g.stop); cur.target = num(g.target);
        cur.rr = num(g.rr); cur.p = num(g.p); cur.p0 = num(g.p0); cur.ev = num(g.ev);
        cur.result_r = g.result && g.result !== '-' ? num(g.result) : null;
        cur.exit_reason = g.exit && g.exit !== '-' ? g.exit : null;
        cur.review = g.review && g.review !== '-' ? g.review : null;
        continue;
      }
      if (l.startsWith('THESIS:')) { cur.thesis = l.slice(7).trim(); continue; }
      if (l.startsWith('INVALIDATION:')) { cur.invalidation = l.slice(13).trim(); continue; }
      if (l.startsWith('STRUCTURE:')) { cur.structure = l.slice(10).trim(); continue; }
      const mk = l.match(/^-\s*(\d{4}-\d{2}-\d{2})\s*·\s*mark\s+([^·]+?)\s*·\s*(.*)$/);
      if (mk) {
        const rest = mk[3].split(/\s+·\s+/);
        const rTok = rest.find((t) => /[+\-−]?\d+(\.\d+)?R$/.test(t));
        const chg = rest[0] && !/R$/.test(rest[0]) ? rest[0] : null;
        const note = rest.filter((t) => t !== rTok && t !== chg && !/^(held|left)\s+\d+$/.test(t)).join(' · ') || null;
        marks.push({ model, pid: cur.pid, d: mk[1], mark: num(mk[2]), chg, r: rTok ? num(rTok) : null, note });
      }
      continue;
    }
    if (section === 'log') {
      const t = parseLedgerT(l, model, tSeq);
      if (t) { tested.push(t); tSeq++; continue; }
      const m = l.match(/^-\s*(\d{4}-\d{2}-\d{2})\s*·\s*(P\d+)\s*·\s*(.*)$/);
      if (m) log.push({ model, d: m[1], seq: logSeq++, ref: m[2], text: m[3] });
    }
  }
  // Fill-time fallbacks so a trade always shows its planned levels.
  for (const t of trades) {
    if (!t.opened) { const l = log.find((x) => x.ref === t.pid && /opened/.test(x.text)); if (l) t.opened = l.d; }
    t.opened = t.opened ? (dateOnly(t.opened) ?? t.opened) : null;
  }
  // Number tested lines within each date.
  const perDay: Record<string, number> = {};
  for (const t of tested) { perDay[t.d] = perDay[t.d] ?? 0; t.seq = perDay[t.d]++; }
  return { model, updated, scorecard, rules, trades, marks, log, tested };
}
