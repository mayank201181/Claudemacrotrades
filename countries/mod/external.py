"""IMF SDMX-CSV external accounts. Numeric values from this API are unscaled USD."""
from calendar import monthrange
from datetime import date
import csv, io, math
def period(s):
 y,code=s.split('-')
 m=int(code[1:])*(3 if code.startswith('Q') else 1)
 return date(int(y),m,monthrange(int(y),m)[1]).isoformat()
def parse(body,row):
 p=row['params'];data={}
 for x in csv.DictReader(io.StringIO(body.decode('utf-8-sig'))):
  if x.get('COUNTRY')!=p['iso'] or x.get('INDICATOR') not in p['series'] or x.get('FREQUENCY')!=p['freq']: continue
  if (x.get('UNIT')!='USD' and x.get('TYPE_OF_TRANSFORMATION') not in ('FOB_USD','CIF_USD')) or not x.get('OBS_VALUE'):continue
  if p.get('entry') and x.get('BOP_ACCOUNTING_ENTRY')!=p['entry']:continue
  k=x['INDICATOR'];trans=x.get('TYPE_OF_TRANSFORMATION')
  if k=='XG' and trans!='FOB_USD' or k=='MG' and trans!='CIF_USD':continue
  t=period(x['TIME_PERIOD']);val=float(x['OBS_VALUE'])/1e9
  if math.isfinite(val):data.setdefault(t,{})[k]=val
 return sorted((t,round(sum(z[k]*w for k,w in p['series'].items()),9)) for t,z in data.items() if p['series'].keys()<=z.keys())
