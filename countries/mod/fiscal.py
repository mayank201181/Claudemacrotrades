"""Keyless fiscal provider adapters. Dates are reference-period ends except forecast publication dates."""
import calendar,csv,datetime as dt,html,io,json,re
from html.parser import HTMLParser

def month_end(y,m):return dt.date(y,m,calendar.monthrange(y,m)[1]).isoformat()

def parse_weo(body,p):
 records=csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
 pairs=[]
 for x in records:
  if not x['OBS_VALUE'] or x['COUNTRY']!=p['country_code'] or x['INDICATOR']!=p['series']:continue
  marker=x['LATEST_ACTUAL_ANNUAL_DATA'];match=re.fullmatch(r'(?:FY)?(\d{4})(?:/\d{2,4})?',marker.strip())
  if not match or int(x['TIME_PERIOD'])>int(match.group(1)):continue
  yr=int(x['TIME_PERIOD']);period=x.get('START_END_MONTHS_OF_REPORTING_YEAR','')
  # Indian external accounts use Apr-Mar FY(t/t+1) mapped to WEO year t.
  # ZA and Singapore fiscal metadata describe weighted calendar-year presentations.
  if p['country_code']=='IND' and marker.startswith('FY'): date=month_end(yr+1,3)
  elif p['country_code']=='THA' and marker.startswith('FY') and period=='October/September':date=month_end(yr+1,9)
  else:date=month_end(yr,12)
  pairs.append((date,float(x['OBS_VALUE'])))
 return sorted(pairs)

def parse(body,row):
 p=row['params'];kind=p['kind']
 from fiscal_more import KINDS,parse as more_parse
 if kind in KINDS:return more_parse(body,row)
 if kind in ('ca_month','ca_budget','ph_budget','nz_budget','cbo_budget'):
  from fiscal_updates import parse as parse_national
  return parse_national(body,row)
 if kind=='weo':return parse_weo(body,p)
 if kind=='fred':
  return [(month_end(int(x['observation_date'][:4]),int(x['observation_date'][5:7])),float(x['MTSDS133FMS'])) for x in csv.DictReader(io.StringIO(body.decode())) if x['MTSDS133FMS'] not in ('','.')]
 if kind=='bcb':
  return [(month_end(int(x['data'][-4:]),int(x['data'][3:5])),-float(x['valor'])) for x in json.loads(body)]
 if kind=='ons':
  return [(month_end(int(x['year']),list(calendar.month_name).index(x['month'])),float(x['value'])) for x in json.loads(body)['months'] if x['value'] not in ('','..')]
 if kind=='singstat':
  s=next(x for x in json.loads(body)['Data']['row'] if x['rowText']=='Total Government Operating Revenue')
  return [(month_end(int(x['key'][:4]),list(calendar.month_abbr).index(x['key'][-3:])),float(x['value'])) for x in s['columns'] if re.fullmatch(r'-?\d+(\.\d*)?',str(x['value']))]
 if kind=='eurostat':
  j=json.loads(body);assert j['id'][-1]=='time' and all(n==1 for n in j['size'][:-1]); pairs=[]
  for t,i in j['dimension']['time']['category']['index'].items():
   v=j['value'].get(str(i))
   if v is not None:pairs.append((month_end(int(t[:4]),int(t[-1])*3),float(v)))
  return sorted(pairs)
 if kind=='ecforecast':
  t=body.decode(); stamp=re.search(r'<div class="ecl-page-header__meta-item">([^<>]+)</div>',t).group(1)
  datestr=dt.datetime.strptime(stamp,'%d %B %Y').date().isoformat()
  for tbl in html_tables(t):
   if not tbl or tbl[0][0]!='Indicators':continue
   yr=datestr[:4]
   if yr not in tbl[0]:yr=tbl[0][1]
   line=next(x for x in tbl if x[0]=='General government balance (% of GDP)')
   return [(datestr,float(line[tbl[0].index(yr)]))]
  return []
 raise ValueError('unsupported fiscal adapter '+kind)
def html_tables(text):
 def txt(x):return ' '.join(html.unescape(re.sub(r'<[^>]+>',' ',x)).split())
 for tbl in re.findall(r'<table\b.*?</table>',text,re.S|re.I):
  yield [[txt(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',r,re.S|re.I)] for r in re.findall(r'<tr\b[^>]*>(.*?)</tr>',tbl,re.S|re.I)]

def discover(body,row):
 from fiscal_more import KINDS,discover as more_discover
 if row['params']['kind'] in KINDS:return more_discover(body,row)
 from fiscal_updates import discover as resolve
 return resolve(body,row)
