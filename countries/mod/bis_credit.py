"""BIS credit, debt service and property prices (added 28 Nov 2026 on the owner's ask for lending and housing lines).
BIS SDMX v2 CSV, full history, quarterly. params: {"kind": "level"} reads OBS_VALUE as is; {"kind": "yoy"} turns a
level series into % change on the same quarter a year earlier."""
import calendar, csv, io

def _qend(p):
    y, q = p.split('-Q')
    m = int(q) * 3
    return f"{y}-{m:02d}-{calendar.monthrange(int(y), m)[1]:02d}"

def parse(body, row):
    rows = list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
    pts = []
    for r in rows:
        v, p = r.get('OBS_VALUE'), r.get('TIME_PERIOD', '')
        if not v or v == 'NaN' or '-Q' not in p:
            continue
        pts.append((_qend(p), float(v)))
    pts.sort()
    if (row.get('params') or {}).get('kind') == 'yoy':
        d = dict(pts)
        out = []
        for day, v in pts:
            y, m, _ = day.split('-')
            prev = f"{int(y) - 1}-{m}-{calendar.monthrange(int(y) - 1, int(m))[1]:02d}"
            if prev in d and d[prev]:
                out.append((day, round(100 * (v / d[prev] - 1), 4)))
        return out
    return pts
