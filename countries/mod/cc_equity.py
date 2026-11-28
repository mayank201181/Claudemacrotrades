"""Read the named domestic stock-market benchmark from published national tables."""
from datetime import datetime
import re
from cc_sea import tables

def parse(body, row):
    p = row['params']
    rows = tables(body)
    out = []
    if p['kind'] == 'ipc':
        if not any('Closing' in r and 'Maximum' in r for r in rows):
            raise ValueError('Banxico closing-price header changed')
        for r in rows:
            for j, cell in enumerate(r[:-1]):
                if re.fullmatch(r'\d{2}/\d{2}/\d{4}', cell):
                    d = datetime.strptime(cell, '%m/%d/%Y').date()
                    out.append((d.isoformat(), float(r[j + 1].replace(',', ''))))
        return sorted(dict(out).items())
    for r in rows:
        if r[0] == p['label'] and p['units'] in r[1]:
            d = datetime.strptime(r[2], p['date_format']).date()
            return [(d.isoformat(), float(r[3].replace(',', '')))]
    return []
