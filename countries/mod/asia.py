"""Asian official releases and IMF PortWatch. Runtime uses only Python's standard library."""
import calendar,csv,datetime as dt,html,io,json,re,unicodedata
from html.parser import HTMLParser
from urllib.parse import urlencode,urljoin

def enddate(y,mo):
 return dt.date(y,mo,calendar.monthrange(y,mo)[1]).isoformat()

def plain(s): return ' '.join(html.unescape(re.sub(r'<[^>]+>',' ',s)).split())

def num(s):return float(str(s).replace(',','').strip())
def csvseries(b,p):
 data=csv.DictReader(io.StringIO(b.decode('utf-8-sig')));out=[]
 for r in data:
  if all(r.get(k)==v for k,v in p.get('where',{}).items()) and r[p['field']]:
   d=dt.date.fromisoformat(r['date']);out.append((enddate(d.year,d.month+(2 if p.get('quarter') else 0)),num(r[p['field']])))
 return out

def sg(b,p):
 r=json.loads(b)['result']['records'];row=next((a for a in r if a.get('DataSeries')==p['label']),None)
 if row is None:raise ValueError('Series label changed')
 by={}
 for k,v in row.items():
  if not v or v in ('na','n.a.','-'):continue
  if re.fullmatch(r'\d{4}[A-Za-z]{3}',k):
   d=dt.datetime.strptime(k,'%Y%b');i=d.year*12+d.month-1;by[i]=(enddate(d.year,d.month),num(v))
  elif re.fullmatch(r'\d{4}[1-4]Q',k):
   y=int(k[:4]);m=int(k[4])*3;by[y*12+m-1]=(enddate(y,m),num(v))
 offset=p.get('offset',0)
 if not offset:return list(by.values())
 return [(d,round(100*(v/by[i-offset][1]-1),6)) for i,(d,v) in by.items() if i-offset in by and by[i-offset][1]]

def jpn(b,p):
 text=unicodedata.normalize('NFKC',b.decode('cp932'))
 rows=list(csv.reader(io.StringIO(text))); header=next(r for r in rows if ' Long-term debt securities' in r or any('Long-term debt securities' in x for x in r))
 inds=[i for i,w in enumerate(header) if p['group'] in w]
 assert len(inds)==2
 idx=inds[1]+2;out=[]
 for r in rows:
  if not r:continue
  m=re.fullmatch(r'\s*(\d{4})\.(\d+)\.\d+\s*[~〜]\s*(?:(\d{4})\.)?(\d+)\.(\d+)\s*',r[0])
  if not m:continue
  y,m1,y2,m2,d=m.groups();y2=int(y2 or (int(y)+(int(m2)<int(m1))))
  out.append((dt.date(y2,int(m2),int(d)).isoformat(),num(r[idx])))
 return out

class Links(HTMLParser):
 def __init__(self):super().__init__();self.items=[];self.a=None
 def handle_starttag(self,tag,attrs):
  if tag=='a':self.a=[dict(attrs),'']
 def handle_data(self,t):
  if self.a:self.a[1]+=t
 def handle_endtag(self,tag):
  if self.a and tag=='a':self.items.append(self.a);self.a=None

def choices(body,row):
 p=row['params'];h=Links();h.feed(body.decode('utf-8-sig'));out=[]
 if p['kind']=='nbs':
  for a,t in h.items:
   m=re.search(p['match'],t,re.I)
   if m and re.fullmatch(r'\./\d{6}/t\d{8}_\d+\.html',a.get('href','')):
    out.append((a['href'].split('/')[-1],urljoin(row['url'],a['href'])))
 elif p['kind']=='kr':
  for a,t in h.items:
   title=a.get('title',t);m=re.search(r'(\d{4})년\s*(\d+)월\s*1일\s*[~∼～]\s*(?:\d+월\s*)?(\d+)일\s*수출입\s*현황',title)
   if m and int(m[3])==p['day'] and all(k in a for k in ['data-bbs','data-mi','data-id','data-url']):
    u=urljoin(row['url'],'selectNttInfo.do')+'?'+urlencode(dict(bbsId=a['data-bbs'],mi=a['data-mi'],nttSn=a['data-id'],nttSnUrl=a['data-url']))
    out.append((dt.date(*map(int,m.groups())).isoformat(),u))
 elif p['kind']=='cn':
  for a,t in h.items:
   m=re.search(r'(\d+)月\d+日[—–-](\d+)月(\d+)日全国物流保通保畅运行情况',t)
   yy=re.search(r'/(\d{4})\d\d/',a.get('href',''))
   if m and yy:
    y=int(yy[1]);mo=int(m[2]);out.append((dt.date(y-(mo==12 and '/'+str(y)+'01/' in a['href']),mo,int(m[3])).isoformat(),urljoin(row['url'],a['href'])))
 return sorted(out,reverse=True)
def discover(body,row):return choices(body,row)[0][1]
def parse(body,row):
 p=row['params'];k=p['kind']
 if k=='nbs':return nbs(body,p)
 if k=='tradewatch':
  j=json.loads(body);points={}
  for e in j['features']:
   a=e['attributes']
   if a['ISO3']==p['iso'] and a['trade_volume'] is not None:
    d=dt.date.fromisoformat(a['date']);points[d.year*12+d.month-1]=(enddate(d.year,d.month),float(a['trade_volume']))
  return [(d,round(100*(v/points[k-12][1]-1),6)) for k,(d,v) in points.items() if k-12 in points and points[k-12][1]>0]
 if k=='krx':
  a=next(a for a in json.loads(body)['output'] if a['INVST_TP']=='Foreign' and a['DD_TP']=='P_DD')
  return [(dt.datetime.strptime(a['TRD_DD'],'%Y%m%d').date().isoformat(),num(a['NETBID_TRDVAL']))]
 if k=='nse':
  a=next(a for a in json.loads(body) if a['category']=='FII/FPI')
  assert abs(num(a['buyValue'])-num(a['sellValue'])-num(a['netValue']))<0.02
  return [(dt.datetime.strptime(a['date'],'%d-%b-%Y').date().isoformat(),num(a['netValue']))]
 if k=='my':return csvseries(body,p)
 if k=='sg':return sg(body,p)
 if k=='jp':return jpn(body,p)
 if k=='twse':
  j=json.loads(body);assert j['stat']=='OK' and j['fields'][-1]=='Difference' and j['params']['type']=='day'
  a=next(r for r in j['data'] if 'Foreign Investors include' in r[0] and 'excluded' in r[0]);return [(dt.datetime.strptime(j['date'],'%Y%m%d').date().isoformat(),num(a[-1]))]
 if k=='pw':
  j=json.loads(body)
  return [(r['date'],r['portcalls']) for e in j['features'] if (r:=e['attributes'])['ISO3']==p['iso'] and r['portcalls'] is not None]
 if k=='kr':
  s=body.decode('utf-8-sig');clean=plain(s);m=re.search(r'(\d{4})\s*년\s*(\d+)\s*월\s*1\s*일\s*[~∼～]\s*(?:\d+\s*월\s*)?(\d+)\s*일\s*수출입\s*현황',clean)
  if not m or int(m[3])!=p['day']:raise ValueError('Wrong KCS period')
  last=dt.date(*map(int,m.groups())).isoformat()
  # Match the export-level row only; current-month total precedes year-to-date.
  for tr in re.findall(r'<tr\b[^>]*>((?:(?!<tr\b).)*?)</tr>',s,re.I|re.S):
   cells=[plain(t) for t in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',tr,re.I|re.S)]
   if len(cells)==6 and re.fullmatch(r'수\s*출\s*\(\s*전년동기대비\s*증감률\s*\)',cells[0]):
    return [(last,num(cells[-2]))]
  raise ValueError('KCS exports row schema changed')
 if k=='cn':
  s=plain(body.decode('utf8'));m=re.search(r'\d+月\d+日[—–-](\d+)月(\d+)日全国物流保通保畅运行情况',s)
  pub=dt.date.fromisoformat(re.search(r'\b(\d{4}-\d\d-\d\d)\s+\d\d:',s)[1]);mo,day=map(int,m.groups());y=pub.year-(mo>pub.month)
  value=re.search(r'国家铁路运输货物\s*([\d,.]+)\s*万吨',s)[1]
  return [(dt.date(y,mo,day).isoformat(),num(value))]
 raise ValueError('Unknown Asia source')

def nbs_table(body):
 s=body.decode('utf-8-sig')
 title=plain(re.search(r'<title[^>]*>(.*?)</title>',s,re.I|re.S)[1])
 all_tables=[]
 for table in re.findall(r'<table\b[^>]*>(.*?)</table>',s,re.I|re.S):
  all_tables.append([[plain(c) for c in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>',tr,re.I|re.S)] for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table,re.I|re.S)])
 return s,title,all_tables

def nbs(body,p):
 s,title,tables=nbs_table(body);months='|'.join(calendar.month_name[1:])
 mm=re.search('('+months+r')\s+(\d{4})',title,re.I)
 if not mm:raise ValueError('NBS field lacks reference month/year: '+title)
 month=list(calendar.month_name).index(mm[1].title());d=enddate(int(mm[2]),month)
 if p['section']=='pmi':
  t=next(t for t in tables if any('PMI' in z for z in t[:3]));out=[];year=None
  for z in t:
   if not z:continue
   match=re.fullmatch(r'(?:(\d{4})\s*-\s*)?('+months+')',z[0],re.I)
   if match and len(z)>1:
    if match[1]:year=int(match[1])
    if year:out.append((enddate(year,list(calendar.month_name).index(match[2].title())),num(z[1])))
  assert out and max(x[0] for x in out)==d
  return out
 for t in tables:
  for z in t:
   if z and re.fullmatch(p['label'],z[0],re.I):
    if p.get('check') and not any(any(p['check'].lower() in cell.lower() for cell in r) for r in t[:3]):raise ValueError('NBS columns changed')
    return [(d,num(z[p['col']]))]
 raise ValueError('Official table row label changed: '+title)
