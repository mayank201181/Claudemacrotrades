// dash-gdelt: relays one GDELT 2.0 DOC API request, for research studies whose own sandbox cannot reach
// api.gdeltproject.org. Only DOC API timeline and article-list requests are relayed; the response body and
// GDELT's HTTP status are passed through unchanged, so the caller keeps the 6-second spacing and retries.
// POST {token, url}; the token is the ingest token. Read-only.
import postgres from 'npm:postgres@3.4.4';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
const MODES = new Set(['timelinevolraw', 'timelinevol', 'artlist']);

Deno.serve(async (req) => {
  let body: { token?: string; url?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const [row] = await sql`select value #>> '{}' as v from dash.config where key = 'ingest_token'`;
  if (!body.token || !row?.v || body.token !== row.v) return new Response('forbidden', { status: 403 });
  let u: URL;
  try { u = new URL(String(body.url ?? '')); } catch { return new Response('bad url', { status: 400 }); }
  if (u.protocol !== 'https:' || u.host !== 'api.gdeltproject.org' || u.pathname !== '/api/v2/doc/doc' || !MODES.has((u.searchParams.get('mode') ?? '').toLowerCase())) {
    return new Response('only GDELT DOC API timeline and artlist requests are relayed', { status: 400 });
  }
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (macro-desk research)' } });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'text/plain' } });
});
