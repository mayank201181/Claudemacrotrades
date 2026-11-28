import calendar,csv,io,json,re,zipfile
from datetime import date,datetime,timedelta
from us_peers import sheet_rows,text

def parse(body,row):
 p=row['params'];kind=p['kind']
 if kind=='boe':
  with zipfile.ZipFile(io.BytesIO(body)) as z:
   member=next(m for m in z.namelist() if m.startswith(p['prefix']) and m.endswith('.xlsx'))
   rows=list(sheet_rows(z.read(member),'4. spot curve'))
  cols=next(r for r in rows if '0.5' in r.values() and '10' in r.values())
  col=next(k for k,v in cols.items() if v==str(p['maturity']))
  return [(str(date(1899,12,30)+timedelta(days=int(r['A']))),float(r[col])) for r in rows if r.get('A','').isdigit() and r.get(col) not in (None,'#N/A')]
 if kind=='nz':
  s=text(body.decode());release=re.search(r'Released:\s*(\d{1,2} \w+ \d{4})',s)[1]
  section=s.split('Quarterly:')[-1].split('Special note')[0]
  vals=re.findall(r'(?:Mar|Jun|Sep[t]?|Dec)\s+20\d{2}\s+([-\d.]+)\s+([-\d.]+)',section)
  return [(datetime.strptime(release,'%d %B %Y').date().isoformat(),float(vals[-1][1]))]
 if kind=='focus':
  return sorted((r['Data'][:10],float(r['Mediana'])) for r in json.loads(body)['value'] if r.get('Mediana') is not None)
 if kind=='ons':
  d=json.loads(body.decode('utf-8-sig'));periods={}
  for rr in d[p.get('key','months')]:
   try:
    y=int(rr['year']); month=rr.get('month','')
    if not month:continue
    m=datetime.strptime(month[:3],'%b').month
    t=date(y,m,calendar.monthrange(y,m)[1]);periods[(y,m)]=float(rr['value'])
   except (KeyError,ValueError):continue
  out=[]
  for (y,m),v in sorted(periods.items()):
   n=p.get('change',0); yy,m0=divmod(y*12+m-1-n,12);old=periods.get((yy,m0+1))
   if not n or old:out.append((date(y,m,calendar.monthrange(y,m)[1]).isoformat(), round((v/old-1)*100,5) if n else v))
  return out
 raise ValueError(kind)
