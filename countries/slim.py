#!/usr/bin/env python3
"""Cut the fetch snapshot to what the app's Countries page shows. python3 slim.py snapshot.json countries.json"""
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
snap = json.loads(Path(sys.argv[1]).read_text())
meta = {(r['country'], r['indicator']): r for r in csv.DictReader((ROOT / 'source_map.csv').open(encoding='utf-8'))}
rows = []
for code, s in sorted(snap['series'].items()):
    m = meta.get((s['country'], s['indicator']), {})
    v = s.get('value')
    if isinstance(v, float):
        v = round(v, 4 if abs(v) < 10 else 2)
    chg = s.get('three_month_change')
    rows.append({
        'c': s['country'], 'b': m.get('block', ''), 'i': s['indicator'], 'v': v, 'u': s.get('unit') or '',
        'd': s.get('observation_date'), 'age': s.get('observation_age_days'), 'dir': s.get('three_month_direction'),
        'chg': round(chg, 4) if isinstance(chg, float) else chg, 'pct': s.get('percentile_10y'), 'n10': s.get('n_10y'),
        'st': s.get('state'), 'f': s.get('frequency') or '', 'ag': m.get('agency', ''), 'src': m.get('fallback') or s.get('source_url', ''),
        'note': (m.get('notes') or '')[:220],
    })
out = {'as_of': snap.get('as_of'), 'fetch_utc': snap.get('fetch_utc'), 'rows': rows,
       'ok': sum(r['st'] == 'ok' for r in rows), 'total': len(rows)}
Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f"{out['ok']} of {out['total']} ok, {len(json.dumps(out))} bytes")
