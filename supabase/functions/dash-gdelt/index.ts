// dash-gdelt: relays GDELT 2.0 DOC API requests for research studies whose own sandbox cannot reach
// api.gdeltproject.org. Only DOC API timeline and article-list requests are relayed. The token is the ingest token.
// - POST {token, url}: one request; GDELT's body and HTTP status are passed through unchanged.
// - POST {token, urls, job, chain?, depth?}: a list of requests run one after another, starting at least 8 s
//   apart (GDELT asks for one per 5 s; its limiter also counts other users of shared cloud addresses), with up to
//   5 retries (10, 20, 40, 60, 60 s) on 429, 5xx, a network error or a "Please limit requests" body. The response
//   streams one JSON line per URL as each finishes, {job, depth, url, status, retrieved_at, text, attempts}, with
//   blank keep-alive lines while waiting. When the time budget runs out, the remaining URLs are either returned
//   as skipped or, with chain: true, handed to a new invocation through pg_net (so every response lands in
//   net._http_response). Chaining stops if dash.config has key 'gdelt_relay_stop'. Read-only towards data.
import postgres from 'npm:postgres@3.4.4';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
const SELF = 'https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-gdelt';
const MODES = new Set(['timelinevolraw', 'timelinevol', 'artlist']);
const SPACING_MS = 8000;
const BACKOFF_MS = [10000, 20000, 40000, 60000, 60000];
const BUDGET_MS = 300000; // no request starts unless its 90 s timeout ends inside this (plan wall clock 400 s)
const MAX_URLS = 800, MAX_DEPTH = 300;
const UA = { 'User-Agent': 'Mozilla/5.0 (macro-desk research)' };
const limited = (status: number, text: string) => status === 0 || status === 429 || status >= 500 || /^\s*please limit requests/i.test(text);

function checkUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw ?? ''));
    const mode = (u.searchParams.get('mode') ?? '').toLowerCase();
    return u.protocol === 'https:' && u.host === 'api.gdeltproject.org' && u.pathname === '/api/v2/doc/doc' && MODES.has(mode) ? u : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  let body: { token?: string; url?: string; urls?: string[]; job?: string; chain?: boolean; depth?: number } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const [row] = await sql`select value #>> '{}' as v from dash.config where key = 'ingest_token'`;
  if (!body.token || !row?.v || body.token !== row.v) return new Response('forbidden', { status: 403 });

  if (!Array.isArray(body.urls)) {
    const u = checkUrl(body.url);
    if (!u) return new Response('only GDELT DOC API timeline and artlist requests are relayed', { status: 400 });
    const r = await fetch(u, { headers: UA });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'text/plain' } });
  }

  const raw = body.urls.map(String);
  const urls = raw.map(checkUrl);
  if (!urls.length || urls.length > MAX_URLS || urls.some((u) => !u)) {
    return new Response(`urls: 1 to ${MAX_URLS} GDELT DOC API timeline or artlist requests`, { status: 400 });
  }
  const job = String(body.job ?? 'adhoc').slice(0, 40), depth = Number(body.depth ?? 0);
  const token = body.token;
  const t0 = Date.now();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const line = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      // Sleep in slices of at most 10 s, writing a blank line after each so the connection never sits idle.
      const wait = async (ms: number) => {
        for (let left = ms; left > 0; left -= 10000) {
          await new Promise((r) => setTimeout(r, Math.min(10000, left)));
          controller.enqueue(enc.encode('\n'));
        }
      };
      // A chained invocation starts right after its parent's last request, so it waits one spacing first.
      let lastStart = depth > 0 ? Date.now() : 0, i = 0;
      for (; i < urls.length; i++) {
        const u = urls[i]!;
        const attempts: { at: string; status: number; ms: number; error?: string }[] = [];
        let status = 0, text = '', retrievedAt = '', outOfTime = false;
        for (let a = 0; a <= BACKOFF_MS.length; a++) {
          const pause = Math.max(SPACING_MS - (Date.now() - lastStart), a ? BACKOFF_MS[a - 1] : 0);
          if (Date.now() - t0 + pause + 95000 > BUDGET_MS) { outOfTime = true; break; }
          await wait(pause);
          lastStart = Date.now();
          const at = new Date().toISOString();
          try {
            const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(90000) });
            status = r.status; text = await r.text(); retrievedAt = new Date().toISOString();
            attempts.push({ at, status, ms: Date.now() - lastStart });
          } catch (e) {
            status = 0; text = ''; retrievedAt = '';
            attempts.push({ at, status: 0, ms: Date.now() - lastStart, error: String(e) });
          }
          if (!limited(status, text)) break;
        }
        // Out of time before a final answer: log the failed attempts and hand this URL on with the rest.
        if (outOfTime && (!attempts.length || limited(status, text))) {
          if (attempts.length) line({ job, depth, url: raw[i], status, retrieved_at: retrievedAt, text: '', attempts, carried: true });
          break;
        }
        line({ job, depth, url: raw[i], status, retrieved_at: retrievedAt, text, attempts });
      }
      const rest = raw.slice(i);
      if (rest.length) {
        let next: number | null = null, stopped = false;
        if (body.chain && depth < MAX_DEPTH) {
          const [stop] = await sql`select 1 from dash.config where key = 'gdelt_relay_stop'`;
          stopped = !!stop;
          if (!stopped) {
            const payload = { token, urls: rest, job, chain: true, depth: depth + 1 };
            const [r] = await sql`select net.http_post(url := ${SELF}, body := ${JSON.stringify(payload)}::text::jsonb, timeout_milliseconds := 420000) as id`;
            next = Number(r.id);
          }
        }
        line({ job, depth, remaining: rest.length, chained_request_id: next, stopped, ...(next == null ? { skipped: rest } : {}) });
      } else line({ job, depth, done: true });
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
});
