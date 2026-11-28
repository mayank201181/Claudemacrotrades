"""Readers for official SDMX observations, reference rates, yields and decision calendars."""
import calendar
import csv
import datetime as dt
import html
import io
import json
import math
import re
from functools import lru_cache
from html.parser import HTMLParser

def month_end(text):
    y,m=map(int,text[:7].split('-'))
    return dt.date(y,m,calendar.monthrange(y,m)[1]).isoformat()

def number(x):
    try:
        value=float(str(x).replace(',',''))
        if math.isfinite(value): return value
    except (ValueError,TypeError): pass

def clean_html(s):
    parser=_Text()
    parser.feed(s)
    return ' '.join(' '.join(parser.parts).split()).replace('\u200b','')
class _Text(HTMLParser):
    def __init__(self):
        super().__init__();self.parts=[];self.ignore=0
    def handle_data(self,d):
        if not self.ignore:self.parts.append(d)
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.ignore+=1
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.ignore=max(0,self.ignore-1)

def table_rows(s):
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>',s,re.I|re.S):
        yield [clean_html(x) for x in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>',row,re.I|re.S)]

def parse_day(y,m,d):
    ix={n.lower()[:3]:i for i,n in enumerate(calendar.month_name) if n}
    return dt.date(int(y),ix[m.lower()[:3]],int(d)).isoformat()

def calendar_dates(body,p):
    s=body.decode('utf-8','replace')
    code=p['code'];dates=[]
    if code=='US':
        pieces=re.split(r'>(20\d\d) FOMC Meetings</a>',s)
        for i in range(1,len(pieces),2):
            for month,days in re.findall(r'class="[^"]*fomc-meeting__month[^"]*">(.*?)</div>\s*<div class="[^"]*fomc-meeting__date[^"]*">(.*?)</div>',pieces[i+1],re.S):
                mon=clean_html(month).split('/')[-1].strip()
                day=re.match(r'\D*(\d{1,2})(?:[-–](\d{1,2}))?',clean_html(days))
                if day: dates.append(parse_day(pieces[i],mon,day[2] or day[1]))
    elif code=='MY':
        for d,m,y in re.findall(r'Monetary Policy Committee (\d{1,2}) (\w+) (20\d\d) \(\w+\) Next Decision Date',clean_html(s)):dates.append(parse_day(y,m,d))
    elif code=='GB':
        dates+=[parse_day(y,m,d) for d,m,y in re.findall(r'Next due:\s*(\d{1,2}) (\w+) (20\d\d)',clean_html(s))]
    elif code=='ID':
        for row in table_rows(s):
            if len(row)<3 or not re.fullmatch(r'\d+\.',row[0]):continue
            d=re.search(r'(\d{1,2})\s*[-–]\s*(\d{1,2}) (\w+) (20\d\d)',row[2])
            if d:dates.append(parse_day(d[4],d[3],d[2]))
    elif code=='NZ':
        year=None
        for row in table_rows(s):
            if len(row)==1 and re.fullmatch(r'20\d\d',row[0]):year=row[0]
            elif year and len(row)>1 and 'OCR' in row[1]:
                d=re.fullmatch(r'(\d{1,2}) (\w+)',row[0])
                if d:dates.append(parse_day(year,d[2],d[1]))
    elif code=='ZA':
        area=re.search(r'UPCOMING ANNOUNCEMENTS(.*?)RELATED PAGES',clean_html(s),re.S|re.I)
        if area:
            for day,mon,y in re.findall(r'(\d{1,2}) (\w+) (20\d\d)',area[1]):dates.append(parse_day(y,mon,day))
    elif code=='XM':
        for day,desc in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>',s,re.S|re.I):
            if 'monetary policy meeting' in desc and 'Day 2' in desc:
                dates.append(dt.datetime.strptime(clean_html(day),'%d/%m/%Y').date().isoformat())
    elif code=='CH':
        for day in re.findall(r'(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}\s+Monetary policy assessment of .{0,40}?\(press release\)',clean_html(s),re.I):
            dates.append(dt.datetime.strptime(day,'%d.%m.%Y').date().isoformat())
    elif code=='CA':
        for mon,day,yr in re.findall(r'(\w+) (\d{1,2}), (20\d\d) Interest Rate Announcement',clean_html(s)):
            dates.append(parse_day(yr,mon,day))
    elif code=='AU':
        for table in re.findall(r'<table\b[^>]*>(.*?)</table>',s,re.S|re.I):
            match=re.search(r'Board meeting schedule (20\d\d)',clean_html(table))
            if not match:continue
            for row in table_rows(table):
                if len(row)<2: continue
                d=re.search(r'(\d{1,2}) ([A-Za-z]+)$',row[1])
                if d: dates.append(parse_day(match[1],d[2],d[1]))
    elif code=='JP':
        for table in re.findall(r'<table\b[^>]*>(.*?)</table>',s,re.S|re.I):
            text=clean_html(table); match=re.search(r'Table\s*:\s*(20\d\d)',text)
            if not match or 'Date of MPM' not in text:continue
            for row in table_rows(table):
                if not row: continue
                d=re.match(r'([a-z]+)\.?\s+(\d{1,2})\s*\([^)]+\),?\s+(?:([a-z]+)\.?\s+)?(\d{1,2})\s*\(',row[0],re.I)
                if d: dates.append(parse_day(match[1],d[3] or d[1],d[4]))
    elif code=='TW':
        t=clean_html(s); match=re.search(r'provisional schedule of Monetary Policy Meetings for (20\d\d):(.*?)A news conference',t,re.I)
        if match:
            for mon,day in re.findall(r'([A-Za-z]+) (\d{1,2})',match[2]):dates.append(parse_day(match[1],mon,day))
    elif code=='IN':
        for mon,day,year in re.findall(r'(\w+) \d{1,2}, \d{1,2} and (\d{1,2}), (20\d\d)',clean_html(s)):
            dates.append(parse_day(year,mon,day))
    elif code=='PH':
        for year,table in re.findall(r'id="collapse(20\d\d)".*?<table\b[^>]*>(.*?)</table>',s,re.I|re.S):
            rows=list(table_rows(table))
            if not rows:continue
            cols=[i for i,x in enumerate(rows[0]) if 'Monetary Board (MB) Meeting' in x]
            if not cols:continue
            col=cols[0]
            for row in rows[1:]:
                if len(row)<=col or not re.match(r'[A-Za-z]{3}',row[0]):continue
                d=re.match(r'(\d{1,2})\s*\(',row[col].strip())
                if d:dates.append(parse_day(year,row[0],d[1]))
    elif code=='TH':
        for table in re.findall(r'<table\b[^>]*>(.*?)</table>',s,re.I|re.S):
            rows=list(table_rows(table))
            for row in rows:
                if len(row)<2 or not re.fullmatch(r'\d+',row[0]):continue
                d=re.fullmatch(r'(?:\w+\.?\s+)?(\d{1,2})\s+(\w+)\.?\s+(20\d\d)',row[1])
                if d: dates.append(parse_day(d[3],d[2],d[1]))
    today=p.get('as_of') or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    return [(today,min(d for d in dates if d>=today))] if any(d>=today for d in dates) else []

@lru_cache(2)
def ecb_fix(body):
    result={}
    for r in csv.DictReader(io.StringIO(body.decode())):
        v=number(r['OBS_VALUE'])
        if v is not None: result.setdefault(r['CURRENCY'],{})[r['TIME_PERIOD']]=v
    return result

def parse(body,row):
    p=row['params'];typ=p['kind']
    if typ=='calendar':return calendar_dates(body,p)
    if typ=='ecbfx':
        rates=ecb_fix(body); usd=rates['USD']; cur=p['currency']
        if cur=='EUR':return sorted((d,1/v) for d,v in usd.items() if v)
        return sorted((d,v/usd[d]) for d,v in rates[cur].items() if usd.get(d))
    if typ=='valet':
        return [(r['d'],float(r[p['col']]['v'])) for r in json.loads(body)['observations'] if r.get(p['col'],{}).get('v') is not None]
    if typ=='cncurve':
        s=body.decode();date=re.search(r'<input[^>]+id="gzr"[^>]+value="(\d{4}-\d{2}-\d{2})"',s)[1]
        return [(date,float(r[1])) for r in table_rows(s) if len(r)>=2 and r[0]==p['col'] and number(r[1]) is not None]
    if typ=='snb':
        lines=body.decode('utf-8-sig').splitlines()
        header=next(i for i,line in enumerate(lines) if line.startswith('"Date";'))
        return sorted((r['Date'],float(r['Value'])) for r in csv.DictReader(lines[header:],delimiter=';') if r['D1']==p['col'] and r['D0']=='CHF' and number(r['Value']) is not None)
    if typ=='nzb2':
        out=[];col=None
        for r in table_rows(body.decode()):
            if r and r[0]=='Date' and p['col'] in r:col=r.index(p['col'])
            elif col is not None and len(r)>col and re.fullmatch(r'\d{1,2} \w{3} \d{4}',r[0]) and number(r[col]) is not None:
                out.append((dt.datetime.strptime(r[0],'%d %b %Y').date().isoformat(),float(r[col])))
        return sorted(out)
    if typ=='krxindex':
        return sorted((dt.datetime.strptime(r['TRD_DD'],'%Y%m%d').date().isoformat(),float(r['CLSPRC_IDX'])) for r in json.loads(body)['output'] if number(r.get('CLSPRC_IDX')) is not None)
    if typ=='twfx':
        return sorted((dt.datetime.strptime(r['日期'],'%Y%m%d').date().isoformat(),float(r['NTD_USD'])) for r in json.loads(body) if number(r.get('NTD_USD')) is not None)
    if typ=='twse':
        return sorted((dt.date(int(r['Date'][:-4])+1911,int(r['Date'][-4:-2]),int(r['Date'][-2:])).isoformat(),float(r['TAIEX'])) for r in json.loads(body) if number(r.get('TAIEX')) is not None)
    if typ=='krpol':
        result=[]
        for r in table_rows(body.decode()):
            if len(r)!=3 or not re.fullmatch(r'\d{4}',r[0]):continue
            m=re.fullmatch(r'(\d+)월\s*(\d+)일',r[1])
            if m and number(r[2]) is not None:
                day=dt.date(int(r[0]),int(m[1]),int(m[2])).isoformat()
                result.append((day,day if row['indicator']=='last_rate_change' else float(r[2])))
        return sorted(result)
    if typ=='twpol':
        # A published table of effective changes with date, discount rate, secured & unsecured rates.
        out=[]
        for cells in table_rows(body.decode()):
            if len(cells)!=4 or not re.fullmatch(r'\d{4}/\d{1,2}/\d{1,2}',cells[0]):continue
            day=dt.date(*map(int,cells[0].split('/'))).isoformat()
            out.append((day,day if row['indicator']=='last_rate_change' else float(cells[1])))
        return sorted(out)
    if typ=='mas':
        htmltext=body.decode()
        res=[]
        for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>',htmltext,re.I|re.S):
            day=re.search(r'<td class="date">(.*?)</td>',tr)
            yields=re.findall(r'<td class="yield">([^<]*)</td>',tr)
            if day and len(yields)>p['col'] and number(yields[p['col']]) is not None:
                res.append((dt.datetime.strptime(day[1],'%d %b %Y').date().isoformat(),float(yields[p['col']])))
        return sorted(res)
    if typ=='jgb':
        rows=csv.reader(io.StringIO(body.decode('cp932'))); next(rows); headers=next(rows); i=headers.index(p['col'])
        result=[]
        for r in rows:
            if len(r)<=i or number(r[i]) is None:continue
            era=re.fullmatch(r'([RHS])(\d+)\.(\d+)\.(\d+)',r[0])
            if era:
                year={'R':2018,'H':1988,'S':1925}[era[1]]+int(era[2]);result.append((dt.date(year,int(era[3]),int(era[4])).isoformat(),float(r[i])))
        return sorted(result)
    if typ in ('sdmx','fred','bnm'):
        records=csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
        out={}
        for r in records:
            if any(r.get(k)!=v for k,v in p.get('filter',{}).items()):continue
            val=number(r.get(p.get('col','OBS_VALUE')))
            if val is None: continue
            date=r[p.get('date','TIME_PERIOD')]
            if p.get('period_end'): date=month_end(date)
            out[date]=val
        series=sorted(out.items())
        if row['indicator']=='last_rate_change':
            return [(dt2,dt2) for (_,old),(dt2,new) in zip(series,series[1:]) if new!=old]
        return series
    raise ValueError('Unsupported market feed format '+typ)
