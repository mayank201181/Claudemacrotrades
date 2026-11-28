// The Gemini Macro Takeaways editions (Carbon, Neon, Pipeline Neon) in the app (28 Nov 2026).
// Each edition is stored whole as a 'takeaways' feed row (sections split on its numbered headings), and the
// Gemini book's open trades (Pxx tactical, Sxx structural) are lifted from the Carbon and Pipeline Neon
// trade-book lines so dash-mark can mark them with our own prices. Gemini's own marks and R are kept in meta
// only: its levels are often wrong, so the app's R for an open Gemini trade is ours.
import { stripTags } from './parse.ts';

export interface GeminiTrade {
  pid: string; title: string; status: string; direction: number; tclass: string; asset_class: string | null;
  proxy: string | null; opened: string | null; filled: string | null; entry: number | null; ref: number | null;
  stop: number | null; target: number | null; structure: string; meta: Record<string, unknown>;
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = Number(s.replace(/[$,]/g, ''));
  return Number.isFinite(v) ? v : null;
};

// Yahoo symbol for the instrument as Gemini names it; null when we cannot mark it (a pair trade, an unknown name).
export function geminiProxy(instrument: string): { proxy: string | null; asset_class: string | null } {
  const s = instrument.trim();
  const fut = s.match(/\(([A-Z0-9]{2,6}[FGHJKMNQUVXZ]\d{2}\.(?:NYM|CMX|CBT|CME|NYB))\)/);
  if (fut) return { proxy: fut[1], asset_class: /CMX|NYM/.test(fut[1]) ? 'commodities' : /CBT/.test(fut[1]) ? 'rates' : 'equities' };
  const yh = s.match(/\(([A-Z]{3,6}=X|\^[A-Z0-9]+|[A-Z]{2,5})\)/);
  if (yh) return { proxy: yh[1], asset_class: /=X$/.test(yh[1]) ? 'FX' : 'equities' };
  if (/\/.*\b(?:LONG|SHORT)\b|\bvs\b/i.test(s)) return { proxy: null, asset_class: null };
  const fx = s.match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
  if (fx) {
    const asia = /CNH|CNY|KRW|TWD|INR|IDR|SGD|MYR|PHP|THB|HKD/.test(fx[1] + fx[2]);
    return { proxy: fx[1] === 'USD' ? `${fx[2]}=X` : `${fx[1]}${fx[2]}=X`, asset_class: asia ? 'Asia FX' : 'G10 FX' };
  }
  const tk = s.match(/^([A-Z]{2,5})\b/);
  if (tk && !/^(USD|EUR|JPY|GBP|AUD|NZD|CAD|CHF|UST|JGB|OIS|NDF)$/.test(tk[1])) return { proxy: tk[1], asset_class: 'equities' };
  return { proxy: null, asset_class: null };
}

// One trade per Pxx/Sxx in the book section text. The three editions lay it out differently and Gemini changes the
// layout from day to day, so this reads tokens, not a table: the id and side ("P19: Short HYG", "S02SHORTAUD/USD Spot"),
// then either labelled levels ("Entry: $77.28 | ... Stop: $78.35 | Target: $75.20", "Entry 0.6779 · wStop 0.6990 · Tgt
// 0.6420") or the Neon triple "0.6779 / 0.6990 / 0.6420 (1R=0.0211)". A mention without levels is skipped; the first
// mention with levels wins.
const N = String.raw`\$?([\d,]+(?:\.\d+)?)`;
const EXTRA: Record<string, string> = { middot: '·', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ge: '≥', le: '≤' };
// Table cells and inline tags glue words together once stripped ("callEntry:", "P19SHORTHYG"): space every tag first.
export const cleanText = (html: string) => stripTags(html.replace(/</g, ' <')).replace(/&([a-z]+);/gi, (m, n) => EXTRA[n.toLowerCase()] ?? m).replace(/\s+/g, ' ');

export function parseGeminiTrades(sectionHtml: string): GeminiTrade[] {
  const text = cleanText(sectionHtml);
  const starts = [...text.matchAll(/\b([PS]\d{2})\s*:?\s*(LONG|SHORT)\s*([A-Za-z][A-Za-z0-9/ .&-]{0,50}?)(?=\s*(?:\(|Size\b|Entry\b|\||\$|\d[\d,]*\.\d))/gi)];
  const out = new Map<string, GeminiTrade>();
  starts.forEach((m, i) => {
    const pid = m[1].toUpperCase();
    if (out.has(pid)) return;
    const seg = text.slice(m.index!, Math.min(i + 1 < starts.length ? starts[i + 1].index! : text.length, m.index! + 900));
    let entry = num(seg.match(new RegExp(String.raw`\bEntry:?\s*` + N, 'i'))?.[1]);
    let stop = num(seg.match(new RegExp(String.raw`\b(?:wStop|Hard Stop|Stop)(?:\s*\(1R[^)]*\))?:?\s*` + N, 'i'))?.[1]);
    let target = num(seg.match(new RegExp(String.raw`\b(?:Target|Tgt)(?:\s*\(\+?[\d.]+R\))?:?\s*` + N, 'i'))?.[1]);
    const tri = seg.match(new RegExp(N + String.raw`\s*/\s*` + N + String.raw`\s*/\s*` + N + String.raw`\s*\(1R`, 'i'));
    if ((entry == null || stop == null) && tri) [entry, stop, target] = [num(tri[1]), num(tri[2]), num(tri[3])];
    if (entry == null || stop == null || entry === stop) return; // a mention in prose, not the trade line
    const instrument = m[3].trim().replace(/[\s:|-]+$/, '');
    const dir = m[2].toUpperCase() === 'LONG' ? 1 : -1;
    const size = num(seg.match(/(?:Size:?\s*|\(|·\s*)(\d(?:\.\d+)?)R\b(?!\s*=)/)?.[1]);
    const opened = seg.match(/opened:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
    const spotRef = num(seg.match(new RegExp(String.raw`Spot ref:?\s*` + N, 'i'))?.[1]);
    const closed = /\bCLOSED\b|TIME-STOP EXECUTED|STOPPED OUT|TARGET HIT/i.test(seg) && !/\bHOLD\b/i.test(seg);
    const { proxy, asset_class } = geminiProxy(instrument);
    // A forward or NDF entry is marked on spot: shift entry, stop and target by the card's own spot-minus-forward basis.
    const basis = spotRef != null && /NDF|Forward|Fwd/i.test(instrument) ? spotRef - entry : 0;
    const sh = (v: number | null) => (v == null ? null : Math.round((v + basis) * 1e6) / 1e6);
    out.set(pid, {
      pid, title: `${dir > 0 ? 'long' : 'short'} ${instrument}${proxy ? ` via ${proxy}` : ''}`,
      status: closed ? 'closed-view' : 'open', direction: dir, tclass: pid.startsWith('S') ? 'structural' : 'tactical', asset_class,
      proxy, opened, filled: opened, entry: sh(entry), ref: sh(entry), stop: sh(stop), target: sh(target),
      structure: `${instrument}${size != null ? ` · ${size}R` : ''}${basis ? ` · Gemini levels ${entry} / ${stop} / ${target} are on the forward, shifted by its spot ref ${spotRef} to mark on spot` : ''} · levels as printed by Gemini; R in the app is marked with our prices`,
      meta: { source: 'gemini', size_r: size, gemini_entry: entry, gemini_stop: stop, gemini_target: target, spot_ref: spotRef,
        gemini_mark: num(seg.match(new RegExp(String.raw`\bMark:?\s*` + N, 'i'))?.[1]) },
    });
  });
  return [...out.values()];
}

// The section that carries the book in each edition.
export const isBookSection = (title: string) => /TRADE BOOK|POSITIONS|PORTFOLIO/i.test(title);
