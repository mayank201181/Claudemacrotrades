"""Parse IMF / OECD SDMX CSV observations. No credentials or third-party parsers."""
import calendar
import csv
import io
import math
from collections import defaultdict
from datetime import date
from functools import lru_cache

def period_end(period):
    year, token = period.split('-')
    month = int(token.lstrip('MQ')) * (3 if token.startswith('Q') else 1)
    return date(int(year), month, calendar.monthrange(int(year), month)[1]).isoformat()

@lru_cache(maxsize=3)
def rows(body):
    grouped = defaultdict(list)
    for entry in csv.DictReader(io.StringIO(body.decode('utf-8-sig'))):
        if not entry.get('OBS_VALUE') or not entry.get('TIME_PERIOD'):
            continue
        area = entry.get('REF_AREA') or entry.get('COUNTRY')
        freq = entry.get('FREQ') or entry.get('FREQUENCY')
        if area and freq:
            grouped[(area, freq)].append(entry)
    return grouped

def history(series, p):
    values = {}
    for entry in series:
        if any(entry.get(key) != val for key, val in p.get('where', {}).items()):
            continue
        v = float(entry['OBS_VALUE'])
        if not math.isfinite(v):
            continue
        if p.get('scale_oecd'):
            v *= 10 ** int(entry['UNIT_MULT'])
        d = period_end(entry['TIME_PERIOD'])
        if d in values and values[d] != v:
            raise ValueError('Ambiguous SDMX series: multiple values for '+d)
        values[d] = v
    diff = p.get('change_months', 0)
    if not diff:
        return sorted(values.items())
    out = []
    for d, v in sorted(values.items()):
        y, month = map(int,d[:7].split('-'))
        y, m0 = divmod(y*12+month-1-diff,12)
        prev_date = date(y,m0+1,calendar.monthrange(y,m0+1)[1]).isoformat()
        prev = values.get(prev_date)
        if prev is not None and prev != 0:
            out.append((d, round(100*(v/prev-1),10)))
    return out

def parse(body, row):
    p=row['params']
    return history(rows(body).get((p['area'],p['freq']),[]),p)
