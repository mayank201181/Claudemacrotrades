"""Discover each rolling national release and parse a precisely scoped fiscal measure."""
import csv,io,json,re,datetime as dt,calendar,html
from urllib.parse import urljoin
from zoneinfo import ZoneInfo
CBO='https://www.cbo.gov/topics/economy/outlook-budget-and-economy'
CAN='https://www.canada.ca/content/dam/fin/documents/publications/pub-rep/json.json'
PH='https://www.dbm.gov.ph/index.php?option=com_finder&view=search&q=DBCC+Statement&filter_order=start_date&filter_order_Dir=DESC'
NZ='https://www.treasury.govt.nz/publications/budgets/forecasts'
def discover(body,row):
 k=row['params']['kind']
 if k.startswith('ca_'):
  releases=json.loads(body)['data']
  if k=='ca_month': choice=max((x for x in releases if x['pub-type']=='Fiscal Monitor'),key=lambda x:x['pub-date']);return choice['link']
  choice=max((x for x in releases if x['pub-type'] in ('Federal Budget','Fall Economic Statement')),key=lambda x:x['pub-date'])
  row['params']['issue']=choice['pub-date']
  # Finance Canada's public English overview normally sits below this edition directory.
  return urljoin(choice['link'].replace('www.budget.canada.ca','budget.canada.ca'),'report-rapport/overview-apercu-en.html')
 s=body.decode()
 if k=='nz_budget':
  paths=re.findall(r'<a href="(/publications/efu/[^"]+)"[^>]*>([^<]*)</a>',s)
  return urljoin(NZ,next(u for u,title in paths if re.search(r'(?:Budget|Half Year|Pre.election|Economic) .*Fiscal Update',title,re.I) and 'Supplementary' not in title))
 if k=='ph_budget':
  matches=re.findall(r'href="([^"]+/\d+-(\d+)(?:rd|th|nd|st)-dbcc-statement-[^"]+)"',s)
  found=[(int(n),html.unescape(u).split('?')[0]) for u,n in matches if 'fiscal-program' in u]
  return urljoin(PH,max(found)[1])
 if k=='cbo_budget':
  for li in re.findall(r'<li class="views-row".*?</li>',s,re.S):
   if re.search(r'>\s*(?:The Budget and Economic Outlook|An Update to the Budget (?:and Economic )?Outlook):',li,re.I):
    stamp=re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})',li).group(1)
    row['params']['issue']=stamp
    return 'https://raw.githubusercontent.com/US-CBO/cbo-data/main/data/budget/ten_year_budget/annual_fy_'+stamp[:7]+'.csv'
 raise ValueError('New fiscal release could not be identified.')
def parse(body,row):
 from fiscal import html_tables,month_end
 p=row['params'];k=p['kind']
 if k=='cbo_budget':
  stamp=p['issue'];asof=dt.date.today();fy=asof.year+int(asof.month>=10)
  return [(stamp,float(x['value'])) for x in csv.DictReader(io.StringIO(body.decode())) if x['date']=='FY'+str(fy) and x['variable']=='proj_deficit_total_gdp_share']
 s=body.decode();tables=list(html_tables(s))
 if k=='ca_month':
  h=re.search(r'<h1[^>]*>The Fiscal Monitor[^<]+?([A-Za-z]+) (\d{4})</h1>',s,re.I);assert h
  t=next(t for t in tables if t and len(t)>2 and t[0][0]=='Month')
  y=int(h.group(2));end=list(calendar.month_name).index(h.group(1));start=y if end>=4 else y-1
  pairs=[]
  for x in t[1:]:
   if len(x)<3 or x[0] not in calendar.month_name or not re.fullmatch(r'\(?-?[\d,]+\)?',x[2]):continue
   m=list(calendar.month_name).index(x[0]);year=start+(m<4);val=float(x[2].strip('()').replace(',',''))*(-1 if x[2].startswith('(') else 1)
   if (year,m)<=(y,end):pairs.append((month_end(year,m),val))
  return sorted(pairs)
 if k=='ca_budget':
  stamp=re.search(r'"datePublished": "(\d{4}-\d\d-\d\d)',s).group(1);assert p['issue']==stamp
  year=int(stamp[:4])-(int(stamp[5:7])<4)
  for t in tables:
   hits=[i for i,r in enumerate(t) if r and r[0]=='Budgetary balance (% of GDP)']
   if not hits:continue
   hdr=next(r for r in t[:4] if any(re.match(r'\d{4}\s*[-–]',v) for v in r))
   col=next(i for i,v in enumerate(hdr) if re.match(str(year)+r'\s*[-–]',v))
   return [(stamp,float(t[hits[0]][col]))]
 if k=='ph_budget':
  stamp=re.search(r'<time datetime="([\d-]+)[^"]*" itemprop="datePublished"',s).group(1)
  t=next(t for t in tables if any(x and x[0]=='Deficit' for x in t))
  rowindex=next(i for i,r in enumerate(t) if r and r[0]=='Deficit'); assert t[rowindex+1][0]=='% of GDP'
  col=t[0].index(stamp[:4]);return [(stamp,float(t[rowindex+1][col].strip('%')))]
 if k=='nz_budget':
  stamp=re.search(r'resource__field-issue-date[^>]*>.*?<time datetime="(\d{4}-\d\d-\d\d)T',s,re.S).group(1);year=int(stamp[:4])+(int(stamp[5:7])>6)
  t=next(t for t in tables if any(x and x[0]=='OBEGALx ($billions)' for x in t)); col=next(i for i,v in enumerate(t[0]) if v.startswith(str(year)+' Forecast'))
  idx=next(i for i,r in enumerate(t) if r and r[0]=='OBEGALx ($billions)');assert t[idx+1][0]=='% of GDP'
  return [(stamp,float(t[idx+1][col]))]
 raise ValueError('Published table has no compatible fiscal observation.')
