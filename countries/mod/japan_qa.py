"""Official e-Stat long-history CPI downloads; exact headers rather than positional columns."""
import calendar,csv,io,re
from datetime import date

def parse(body,row):
    rows=csv.reader(io.StringIO(body.decode('cp932')));column=None;out=[]
    for cells in rows:
        if not cells:continue
        if cells[0]=='Group/Item':column=cells.index(row['params']['label']);continue
        if column is None or not re.fullmatch(r'\d{6}',cells[0]) or not cells[column].strip() or cells[column].strip() in ('-','*'):continue
        y,m=int(cells[0][:4]),int(cells[0][4:]);v=float(cells[column]);out.append((date(y,m,calendar.monthrange(y,m)[1]).isoformat(),v))
    if not out:raise ValueError('No e-Stat CPI data for expected label')
    return out
