# Dashboard ingest routine (superseded)

> Superseded by `scripts/apps_script/Code.gs`: an Apps Script in the owner's Google account that posts new
> digests and trade books every 10 minutes. The Claude routine below was disabled because auto-mode sessions
> block posting email content to an external endpoint. Kept for reference.

Scheduled routine ("Macro Desk ingest", Full access environment) that pushes each morning's
Macro Takeaways digests and both trade books into Supabase. The live prompt carries the real
ingest token (stored in `dash.config.ingest_token`); this copy uses a placeholder.

Schedule: 09:20 and 12:20 SGT daily (`20 1,4 * * *` UTC). Re-ingesting is idempotent.

```
MACRO DESK INGEST — copy today's Macro Takeaways digests and trade books into the Macro Desk
dashboard database. Run fully autonomously; never send email, never edit any Drive file or email.

ENDPOINT  https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-ingest
MARK      https://diiwqbxyhtgvozhncoef.supabase.co/functions/v1/dash-mark
TOKEN     <ingest token>
DATES     today's SGT date (and yesterday's, if its digests are not yet ingested — harmless to repeat)

Never retype email content: tool results that are saved to a file are posted from that file
with the python helper below.

0. Write /tmp/post.py:
   import json, sys, urllib.request
   url, kind, path = sys.argv[1], sys.argv[2], sys.argv[3]
   extra = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
   raw = open(path, encoding='utf-8').read()
   try: data = json.loads(raw)
   except Exception: data = {'fileContent': raw}
   body = dict(token='<ingest token>', kind=kind, data=data, **extra)
   req = urllib.request.Request(url, json.dumps(body).encode(), {'Content-Type': 'application/json'})
   print(urllib.request.urlopen(req, timeout=120).read().decode()[:2000])

1. TRADE BOOKS FIRST (their tested lists are complete; the email prints only the top lines).
   Google Drive search_files, excludeContentSnippets true:
     Fable: parentId = '13xLuNZTYrt4AJ5HZXqZbL3n2JU-c7xKZ' and title = 'trade_book_current'
     Opus:  parentId = '1LLeuELL8CLpWmtcywt2DiCpJVopNgyqm' and title = 'trade_book_current'
   For each, take the file with the latest modifiedTime and read_file_content it.
   If the result was saved to a file, run: python3 /tmp/post.py <ENDPOINT> trade_book <file> '{"fileId":"<id>"}'
   If it came back inline, write the fileContent string EXACTLY to /tmp/tb_<model>.txt with a
   quoted heredoc (cat > file <<'EOF_TB' … EOF_TB) and post that file the same way.

2. DIGESTS. Gmail search_threads, query:
     subject:"MACRO TAKEAWAYS" (subject:"[Fable 5.1]" OR subject:"[Opus 5.5]") newer_than:2d
   For every thread whose subject date is in DATES: get_thread with messageFormat FULL_CONTENT.
   These results exceed the inline limit and are saved to a file; run:
     python3 /tmp/post.py <ENDPOINT> gmail_thread <saved file>
   If a result ever comes back inline, do not retype it — note it in the final report instead.

3. MARKS. python3 -c "import urllib.request,json;print(urllib.request.urlopen(urllib.request.Request('<MARK>',json.dumps({'token':'<ingest token>'}).encode(),{'Content-Type':'application/json'}),timeout=150).read().decode())"

4. REPORT in one short paragraph: each response's "out" lines, any {"ok":false} error verbatim,
   and any digest for today that was not found (Fable sometimes lands late — the 12:20 run catches it).
```
