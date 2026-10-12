#!/usr/bin/env python3
"""Turn the event library CSVs (project files event_library/) into the compact text that
dash.put_event_cells / dash.put_event_cal load (migration 016), plus one ready-to-run SQL file.

  python3 scripts/event_library/to_sql.py [--root /mnt/project-files/event_library] [--out DIR]
                                          [--since 2026-07-01] [--rows-per-part 380]

Loaded cells: period ALL, clean sample, 1d and 2d windows; every relevant cell, every pre-registered
no-effect pair, and the spillover cells that are significant (BH q<0.10, n>=15). Calendar: scheduled
rows of the scored types from --since on (future rows included). Writes to DIR:
  cells_part01.txt ...   compact cell rows, one per line (select dash.put_event_cells($x$...$x$, '<run_id>'))
  cal.txt                compact calendar rows (select dash.put_event_cal($x$...$x$, '<run_id>'))
  event_library_load.sql all of the above as one SQL file for the Supabase SQL editor
  checksums.json         counts and sums (on the rounded values written) to compare with the database
No outcome values are printed; the data files stay out of the repo.
"""
import argparse, csv, json, math, os

csv.field_size_limit(10 ** 9)

def num(v, dp):
    if v is None: return ''
    v = str(v).strip()
    if v == '' or v.lower() in ('nan', 'none', 'inf', '-inf'): return ''
    x = float(v)
    if math.isnan(x) or math.isinf(x): return ''
    s = f'{x:.{dp}f}'
    s = s.rstrip('0').rstrip('.') if '.' in s else s
    if s in ('-0', ''): s = '0'
    return s

def flag(v):
    return '1' if str(v).strip().lower() in ('1', '1.0', 'true', 't', 'y', 'yes') else '0'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('EVLIB_ROOT', '/mnt/project-files/event_library'))
    ap.add_argument('--out', default=None)
    ap.add_argument('--since', default='2026-07-01')
    ap.add_argument('--rows-per-part', type=int, default=380)
    a = ap.parse_args()
    out = a.out or os.path.join(a.root, 'load')
    os.makedirs(out, exist_ok=True)

    run_id = None; types = set(); cells = []
    with open(os.path.join(a.root, 'event_multipliers.csv'), newline='') as fh:
        for r in csv.DictReader(fh):
            types.add(r['event_type']); run_id = run_id or r['run_id']
            if r['period'] != 'ALL' or r['sample'] != 'clean' or r['window'] not in ('1d', '2d'): continue
            rel = flag(r['is_relevant']) == '1'; plc = flag(r['placebo_strict']) == '1'
            n = int(float(r['n'] or 0))
            q = float(r['q_value_bh']) if r['q_value_bh'] not in ('', 'nan') else float('nan')
            sig = (not math.isnan(q)) and q < 0.10 and n >= 15
            if not (rel or plc or sig): continue
            label = 'DXY' if r['asset'] == 'FX_USD.CLOSE' else r['asset'].split('.')[0].split('_', 1)[1]
            cells.append([r['event_type'], label, r['window'], str(n), num(r['multiplier'], 2), num(r['ci_lo'], 2), num(r['ci_hi'], 2),
                          num(r['q_value_bh'], 3), '1' if rel else '0', '1' if plc else '0',
                          num(r['mean_abs_event'], 2), num(r['mean_abs_control'], 2), num(r['var_ratio'], 2),
                          num(r['addon_vol_1w'], 2), num(r['addon_vol_1m'], 2), num(r['addon_vol_1w_now'], 2), num(r['addon_vol_1m_now'], 2),
                          num(r['multiplier_shrunk'], 2)])
    cells.sort(key=lambda x: (x[0], x[2], x[1]))

    cal = []
    with open(os.path.join(a.root, 'event_calendar.csv'), newline='') as fh:
        for r in csv.DictReader(fh):
            if r['event_type'] not in types or r['local_date'] < a.since or flag(r['scheduled']) != '1': continue
            ts = (r['ts_utc'] or '')[:16].replace(' ', 'T') if r['ts_quality'] != 'date_only' and r['ts_utc'] else ''
            cal.append([r['event_type'], r['local_date'], ts, flag(r['is_proxy'])])
    cal.sort(key=lambda x: (x[1], x[0]))
    for c in cells + cal:
        assert all(',' not in f and '\n' not in f for f in c), c

    parts = [cells[i:i + a.rows_per_part] for i in range(0, len(cells), a.rows_per_part)]
    for i, p in enumerate(parts, 1):
        with open(os.path.join(out, f'cells_part{i:02d}.txt'), 'w') as fh:
            fh.write('\n'.join(','.join(c) for c in p) + '\n')
    with open(os.path.join(out, 'cal.txt'), 'w') as fh:
        fh.write('\n'.join(','.join(c) for c in cal) + '\n')
    with open(os.path.join(out, 'event_library_load.sql'), 'w') as fh:
        fh.write('-- Event library load (migration 016 must be applied first). Safe to run more than once.\n')
        for i, p in enumerate(parts, 1):
            fh.write('select dash.put_event_cells($evl$\n' + '\n'.join(','.join(c) for c in p) + f"\n$evl$, '{run_id}') as cells_part{i:02d};\n")
        fh.write('select dash.put_event_cal($evl$\n' + '\n'.join(','.join(c) for c in cal) + f"\n$evl$, '{run_id}') as cal_rows;\n")
        fh.write("select win, count(*) n_cells, sum(n) sum_n, round(sum(multiplier), 2) sum_mult, round(sum(coalesce(addon_vol_1w, 0)), 2) sum_addon_1w,"
                 " count(*) filter (where q_value_bh < 0.10 and n >= 15) n_sig from dash.event_cell where period = 'ALL' and sample = 'clean' group by win order by win;\n")
        fh.write('select count(*) n_cal, min(local_date), max(local_date), count(*) filter (where is_proxy) n_proxy from dash.event_cal;\n')

    chk = {'run_id': run_id}
    for w in ('1d', '2d'):
        rows = [c for c in cells if c[2] == w]
        chk[w] = {'n_cells': len(rows), 'sum_n': sum(int(c[3]) for c in rows),
                  'sum_mult': round(sum(float(c[4]) for c in rows if c[4]), 2),
                  'sum_addon_1w': round(sum(float(c[13]) for c in rows if c[13]), 2),
                  'n_relevant': sum(1 for c in rows if c[8] == '1'), 'n_placebo': sum(1 for c in rows if c[9] == '1'),
                  'n_sig': sum(1 for c in rows if c[7] and float(c[7]) < 0.10 and int(c[3]) >= 15)}
    chk['cal'] = {'n': len(cal), 'min': cal[0][1] if cal else None, 'max': cal[-1][1] if cal else None,
                  'n_proxy': sum(1 for c in cal if c[3] == '1')}
    with open(os.path.join(out, 'checksums.json'), 'w') as fh:
        json.dump(chk, fh, indent=1)
    print(json.dumps({'cells': len(cells), 'parts': len(parts), 'cal': len(cal), 'out': out,
                      'bytes': {f: os.path.getsize(os.path.join(out, f)) for f in sorted(os.listdir(out))}}))

if __name__ == '__main__':
    main()
