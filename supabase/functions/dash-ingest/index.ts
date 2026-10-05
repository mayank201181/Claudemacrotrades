// dash-ingest: receives raw digest emails (Gmail get_thread JSON) and trade_book_current
// Drive docs, stores them verbatim in dash.raw, and parses them into the dash tables.
// Auth: body.token must equal dash.config.ingest_token. {kind:'reparse'} replays dash.raw.
import postgres from 'npm:postgres@3.4.4';
import { parseDigest, parseEmailTested, parseTradeBook, setPrivateTerms, type Tested } from '../_shared/parse.ts';
import { parseFeed, privacyFilter, type Family, type FeedSection } from '../_shared/feeds.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });

type Json = Record<string, unknown>;

// Raw copies keep only what re-parsing needs: no plain-text body, no ADMIN FLAGS section.
function rawCopy(m: Json): Json {
  const html = String(m.htmlBody ?? m.html ?? '').replace(/<h2[^>]*>\s*(?:<[^>]+>\s*)*ADMIN FLAGS[\s\S]*?(?=<h2\b|$)/i, '');
  return { id: m.id, subject: m.subject, date: m.date, htmlBody: html };
}

async function upsertTested(rows: Tested[]) {
  for (const t of rows) {
    await sql`insert into dash.tested ${sql({ ...t, idea: t.idea.slice(0, 500) } as Json)}
      on conflict (model, d, idea) do update set seq = excluded.seq, proxy = excluded.proxy, direction = excluded.direction,
        verdict = excluded.verdict, fail_code = excluded.fail_code, covered_by = excluded.covered_by, rr = excluded.rr,
        p = excluded.p, p0 = excluded.p0, ev = excluded.ev, reason = excluded.reason, source = excluded.source`;
  }
}

async function ingestThread(data: Json): Promise<string[]> {
  const out: string[] = [];
  const msgs = (data.messages as Json[] | undefined) ?? [data];
  for (const m of msgs) {
    const msg = m as { id: string; subject: string; date: string; htmlBody?: string };
    const dg = parseDigest(msg);
    if (!dg) {
      const fd = parseFeed(msg);
      if (!fd) continue;
      // The Email Digest is mostly personal: only its parsed newsletter sections are kept, never the raw email.
      if (fd.family !== 'substack') {
        await sql`insert into dash.raw (kind, model, d, source_id, payload)
          values ('gmail_thread', ${fd.source}, ${fd.d}, ${msg.id}, ${sql.json(rawCopy(m as Json))})
          on conflict (kind, source_id) do update set payload = excluded.payload, received_at = now()`;
      }
      await sql`insert into dash.feeds (gmail_id, family, source, d, subject, sent_at, intro, sections, stances, parsed_at)
        values (${fd.gmail_id}, ${fd.family}, ${fd.source}, ${fd.d}, ${fd.subject}, ${fd.sent_at}, ${fd.intro},
          ${sql.json(fd.sections as unknown as Json)}, ${fd.stances}, now())
        on conflict (gmail_id) do update set family = excluded.family, source = excluded.source, d = excluded.d,
          subject = excluded.subject, sent_at = excluded.sent_at, intro = excluded.intro, sections = excluded.sections,
          stances = excluded.stances, parsed_at = now()`;
      out.push(`feed ${fd.family}/${fd.source} ${fd.d}: ${fd.sections.length} sections`);
      continue;
    }
    await sql`insert into dash.raw (kind, model, d, source_id, payload)
      values ('gmail_thread', ${dg.model}, ${dg.d}, ${msg.id}, ${sql.json(rawCopy(m as Json))})
      on conflict (kind, source_id) do update set payload = excluded.payload, received_at = now()`;
    await sql`insert into dash.digests (model, d, subject, gmail_id, sent_at, built, header, sixty, themes, sections, trade_block, parsed_at)
      values (${dg.model}, ${dg.d}, ${dg.subject}, ${dg.gmail_id}, ${dg.sent_at}, ${dg.built}, ${dg.header},
        ${sql.json(dg.sixty)}, ${sql.json(dg.themes as unknown as Json)}, ${sql.json(dg.sections as unknown as Json)}, ${dg.trade_block}, now())
      on conflict (model, d) do update set subject = excluded.subject, gmail_id = excluded.gmail_id, sent_at = excluded.sent_at,
        built = excluded.built, header = excluded.header, sixty = excluded.sixty, themes = excluded.themes,
        sections = excluded.sections, trade_block = excluded.trade_block, parsed_at = now()
      where excluded.sent_at >= dash.digests.sent_at or dash.digests.gmail_id = excluded.gmail_id`;
    // The email prints the top tested lines; the ledger has all of them and wins when present.
    const [{ n }] = await sql`select count(*)::int n from dash.tested where model = ${dg.model} and d = ${dg.d} and source = 'ledger'`;
    if (n === 0 && dg.trade_block) {
      await sql`delete from dash.tested where model = ${dg.model} and d = ${dg.d} and source = 'email'`;
      await upsertTested(parseEmailTested(dg.trade_block, dg.model, dg.d));
    }
    out.push(`digest ${dg.model} ${dg.d}: ${dg.themes.length} themes, ${dg.sixty.length} bullets`);
  }
  return out;
}

async function ingestBook(data: Json | string, fileId?: string): Promise<string[]> {
  const text = typeof data === 'string' ? data : String((data as Json).fileContent ?? '');
  const tb = parseTradeBook(text);
  const today = new Date().toISOString().slice(0, 10);
  await sql`insert into dash.raw (kind, model, d, source_id, payload)
    values ('trade_book', ${tb.model}, ${today}, ${`${fileId ?? tb.model}|${tb.updated ?? today}`}, ${sql.json({ text, fileId: fileId ?? null })})
    on conflict (kind, source_id) do update set payload = excluded.payload, received_at = now()`;
  await sql`insert into dash.book_state (model, updated, scorecard, rules, ingested_at)
    values (${tb.model}, ${tb.updated}, ${tb.scorecard}, ${tb.rules}, now())
    on conflict (model) do update set updated = excluded.updated, scorecard = excluded.scorecard, rules = excluded.rules, ingested_at = now()`;
  for (const t of tb.trades) {
    const row = {
      model: t.model, pid: t.pid, title: t.title, status: t.status, asset_class: t.asset_class, direction: t.direction,
      tclass: t.tclass, proxy: t.proxy, opened: t.opened, filled: t.filled, closed: t.closed, ref: t.ref, entry: t.entry,
      stop: t.stop, target: t.target, rr: t.rr, p: t.p, p0: t.p0, ev: t.ev, result_r: t.result_r, exit_reason: t.exit_reason,
      review: t.review, thesis: t.thesis, invalidation: t.invalidation, structure: t.structure,
    };
    // A compressed block (closed trade older than 7 days) can lose thesis lines: never overwrite text with null.
    await sql`insert into dash.trades ${sql({ ...row, meta: sql.json(t.meta), first_seen: today, last_seen: today } as Json)}
      on conflict (model, pid) do update set title = excluded.title, status = excluded.status,
        asset_class = coalesce(excluded.asset_class, dash.trades.asset_class), direction = coalesce(excluded.direction, dash.trades.direction),
        tclass = coalesce(excluded.tclass, dash.trades.tclass), proxy = coalesce(excluded.proxy, dash.trades.proxy),
        opened = coalesce(excluded.opened, dash.trades.opened), filled = coalesce(excluded.filled, dash.trades.filled),
        closed = coalesce(excluded.closed, dash.trades.closed), ref = coalesce(excluded.ref, dash.trades.ref),
        entry = coalesce(excluded.entry, dash.trades.entry), stop = coalesce(excluded.stop, dash.trades.stop),
        target = coalesce(excluded.target, dash.trades.target), rr = coalesce(excluded.rr, dash.trades.rr),
        p = coalesce(excluded.p, dash.trades.p), p0 = coalesce(excluded.p0, dash.trades.p0), ev = coalesce(excluded.ev, dash.trades.ev),
        result_r = coalesce(excluded.result_r, dash.trades.result_r), exit_reason = coalesce(excluded.exit_reason, dash.trades.exit_reason),
        review = excluded.review, thesis = coalesce(excluded.thesis, dash.trades.thesis),
        invalidation = coalesce(excluded.invalidation, dash.trades.invalidation), structure = coalesce(excluded.structure, dash.trades.structure),
        meta = dash.trades.meta || excluded.meta, last_seen = excluded.last_seen, updated_at = now()`;
  }
  for (const m of tb.marks) {
    await sql`insert into dash.trade_marks ${sql(m as unknown as Json)}
      on conflict (model, pid, d) do update set mark = excluded.mark, chg = excluded.chg, r = excluded.r, note = excluded.note`;
  }
  for (const l of tb.log) {
    await sql`insert into dash.trade_log (model, d, ref, text) values (${l.model}, ${l.d}, ${l.ref}, ${l.text}) on conflict do nothing`;
  }
  const days = [...new Set(tb.tested.map((t) => t.d))];
  // The ledger's list for a day is complete: it replaces whatever was stored for that day.
  for (const d of days) await sql`delete from dash.tested where model = ${tb.model} and d = ${d}`;
  await upsertTested(tb.tested);
  return [`book ${tb.model} (${tb.updated}): ${tb.trades.length} trades, ${tb.marks.length} marks, ${tb.tested.length} tested over ${days.length} days`];
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const [{ value }] = await sql`select value from dash.config where key = 'ingest_token'`;
    if (!body?.token || body.token !== value) return new Response('forbidden', { status: 403 });
    let out: string[] = [];
    // Names and institutions for the personal scrub live only in the database (the repo is public).
    const [pt] = await sql`select value from dash.config where key = 'private_terms'`;
    setPrivateTerms(pt?.value);
    if (body.kind === 'config') {
      const rows = await sql`select key, value from dash.config where key in ('feeds', 'backfill_since')`;
      const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      return new Response(JSON.stringify({ ok: true, feeds: cfg.feeds ?? [], backfill_since: cfg.backfill_since ?? null }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (body.kind === 'purge_test') {
      // One-off removal of the rows created while testing the pipeline on 5 Oct (owner-approved).
      await sql`delete from dash.trades where pid = 'P99'`;
      await sql`delete from dash.trade_marks where pid = 'P99'`;
      await sql`delete from dash.live_marks where pid = 'P99'`;
      await sql`delete from dash.tested where idea = 'long test idea'`;
      await sql`delete from dash.idea_outcomes where idea = 'long test idea'`;
      await sql`delete from dash.raw where source_id = 'test|TEST'`;
      out = ['test rows purged'];
    } else if (body.kind === 'refilter') {
      // Re-applies the current privacy terms to every stored feed row (the Email Digest is never kept raw).
      const rows = await sql`select gmail_id, family, intro, sections from dash.feeds`;
      for (const r of rows) {
        const f = privacyFilter(r.family as Family, r.sections as FeedSection[], r.intro ?? '');
        await sql`update dash.feeds set intro = ${f.intro}, sections = ${sql.json(f.sections as unknown as Json)}, parsed_at = now() where gmail_id = ${r.gmail_id}`;
      }
      out = [`refiltered ${rows.length} feed rows`];
    } else if (body.kind === 'gmail_thread') out = await ingestThread(body.data);
    else if (body.kind === 'trade_book') out = await ingestBook(body.data, body.fileId);
    else if (body.kind === 'reparse') {
      const rows = await sql`select kind, payload from dash.raw order by kind desc, received_at`;
      for (const r of rows) {
        if (r.kind === 'gmail_thread') out.push(...await ingestThread(r.payload));
        else out.push(...await ingestBook(r.payload.text, r.payload.fileId ?? undefined));
      }
    } else return new Response('unknown kind', { status: 400 });
    return new Response(JSON.stringify({ ok: true, out }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
