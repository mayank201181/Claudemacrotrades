import json,re,calendar,io,csv,zipfile,datetime as dt,html
from xml.etree import ElementTree as ET
from fiscal_xlsx import rows
UK='https://www.gov.uk/api/search.json?q=economic%20and%20fiscal%20outlook&filter_organisations=office-for-budget-responsibility&order=-public_timestamp&count=12'
IN='https://www.indiabudget.gov.in/doc/budget_speech.docx'
SG='https://www.singaporebudget.gov.sg/budget-speech/budget-statement/h-fiscal-position'
CH='https://www.data.finance.admin.ch/static/assets/datasets/gfs_dashboard/main_extern.xlsx'
CH_M='https://www.data.finance.admin.ch/static/assets/datasets/gfs_dashboard/monatsdaten-e.xlsx'
KINDS=('uk_budget','in_budget','sg_budget','ch_budget','ch_month')
def text_only(s):return ' '.join(html.unescape(re.sub('<[^>]+>',' ',re.sub(r'<(script|style)\b.*?</\1>',' ',s,flags=re.S|re.I))).split())
def discover(b,r):
 p=r['params'];k=p['kind']
 if k=='uk_budget':
  title,link=next((x['title'],x['link']) for x in json.loads(b)['results'] if re.fullmatch(r'Economic and fiscal outlook\s*[-–:]\s*[A-Za-z]+\s+\d{4}',x['title'],re.I))
  return 'https://www.gov.uk/api/content'+link+'/economic-and-fiscal-outlook-'+'-'.join(title.lower().split()[-2:])
 if k=='in_budget':
  doc=ET.fromstring(zipfile.ZipFile(io.BytesIO(b)).read('word/document.xml'))
  txts=[' '.join(''.join(x.itertext()).split()) for x in doc.findall('.//{*}p')]
  date=next(t for t in txts[:30] if re.fullmatch(r'[A-Z][a-z]+ \d{1,2}, \d{4}',t));p['issue']=dt.datetime.strptime(date,'%B %d, %Y').date().isoformat()
  p['target_years']=next(re.search(r'\d{4}[-–]\d{4}',v).group() for v in txts[:20] if re.search(r'Budget \d{4}[-–]\d{4}',v))
  return 'https://www.indiabudget.gov.in/doc/Budget_at_Glance/budget_at_a_glance.xlsx'
 if k=='ch_budget':
  stamp=next(v for r in rows(b,'overview') for v in r.values() if re.match(r'Stand \d{2}\.\d{2}\.\d{4}',v))
  p['issue']=dt.datetime.strptime(stamp.split()[1],'%d.%m.%Y').date().isoformat()
  return 'https://www.data.finance.admin.ch/static/assets/datasets/fs_dashboard/main_extern.csv'
 if k=='sg_budget':
  text=text_only(b.decode());match=re.search(r'For FY(\d{4}),.{0,110}?(surplus|deficit).{0,85}?(\d+(?:\.\d+)?)\s*% of GDP',text,re.I)
  if not match:raise ValueError('Official budget speech is missing a numeric current-FY balance as share of GDP.')
  p.update(year=match.group(1),forecast_ratio=float(match.group(3))*(1 if match.group(2)=='surplus' else -1))
  return 'https://www.gov.sg/budget'+match.group(1)+'/'
 raise ValueError('Unknown rolling fiscal source')
def parse(b,r):
 from fiscal import html_tables,month_end
 p=r['params'];k=p['kind']
 if k=='uk_budget':
  j=json.loads(b);s=j['details']['body'];t=next(html_tables(re.split(r'<h[234][^>]*>Table [^<]+?: Fiscal aggregates</h[234]>',s,flags=re.I)[1]))
  stamp=j['first_published_at'][:10];year=int(stamp[:4])-(int(stamp[5:7])<4)
  hdr=next(x for x in t if any(re.match(r'\d{4}[-–]\d\d',v) for v in x));col=next(i for i,x in enumerate(hdr) if x.startswith(str(year)))
  assert any('Per cent of GDP' in x for x in t[:2]);line=next(x for x in t if x and x[0].startswith('General government net borrowing (GGNB)'))
  return [(stamp,-float(line[col]))]
 if k=='in_budget':
  t=rows(b,'Deficit Statistics');period=next(x for x in t if p['target_years'] in x.values());col=next(c for c,v in period.items() if v==p['target_years'])
  i=next(i for i,r in enumerate(t) if any(re.fullmatch(r'1\. Fiscal Deficit',v) for v in r.values()))
  val=t[i+1][col];assert re.fullmatch(r'\([\d.]+\)',val)
  return [(p['issue'],-float(val.strip('()')))]
 if k=='ch_budget':
  q=[x for x in csv.DictReader(io.StringIO(b.decode('utf-8-sig'))) if x['hh']=='staat' and x['model']=='gfs' and x['variable']=='defizit_ueberschuss' and x['jahr']==p['issue'][:4] and x['source']=='Prognosen']
  if len(q)!=1:raise ValueError('No unique FFA current-year forecast.')
  return [(p['issue'],float(q[0]['value'])*100)]
 if k=='ch_month':
  t=rows(b,'Data');hdr=next(x for x in t if x.get('B')=='1 000 CHF');line=next(x for x in t if x.get('A')=='NLB' and x.get('B')=='Net lending/borrowing')
  return [(month_end(int(v[:4]),int(v[5:7])),float(line[c])/1000) for c,v in hdr.items() if c in line and re.fullmatch(r'\d{4}-\d\d',v)]
 if k=='sg_budget':
  s=text_only(b.decode());match=re.search(r'On (\d{1,2} [A-Z][a-z]+ '+p['year']+r'),[^.]{0,180}delivered[^.]{0,40}Budget '+p['year'],s)
  if not match:raise ValueError('Budget release date unconfirmed for the fiscal year.')
  stamp=match.group(1);date=dt.datetime.strptime(stamp,'%d %b %Y' if len(stamp.split()[1])==3 else '%d %B %Y').date().isoformat()
  return [(date,p['forecast_ratio'])]
 raise ValueError(k)
