"""Official SingStat JSON, PSA PXWeb JSON-stat2, and national SDDS tables."""
import calendar,csv,io,json,math,re
from datetime import date,datetime
from html import unescape
from functools import lru_cache
def end(y,m):
    return date(y,m,calendar.monthrange(y,m)[1]).isoformat()
def growth(vals,months):
    if not months:return sorted(vals.items())
    out=[]
    for d,v in sorted(vals.items()):
        y,m=map(int,d[:7].split('-'));py,pm=divmod(y*12+m-1-months,12);old=vals.get(end(py,pm+1))
        if old is not None and old!=0:out.append((d,round((v/old-1)*100,8)))
    return out
def period(year,seg):
    if seg.lower() in ['annual','total','year','whole year','']:return None
    if re.fullmatch(r'Q[1-4]|[1-4]Q',seg,re.I):return end(year,int(re.search(r'\d',seg)[0])*3)
    try:return end(year,datetime.strptime(seg[:3],'%b').month)
    except ValueError:return None
@lru_cache(maxsize=3)
def tables(b):
    found=[]
    for tr in re.findall(r'<tr\b(.*?)</tr>',b.decode('utf-8','replace'),re.I|re.S):
        c=[re.sub(r'\s+',' ',unescape(re.sub(r'<[^>]+>',' ',x))).replace('\u200b','').strip() for x in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>',tr,re.I|re.S)]
        if c:found.append(c)
    return found
def nsdate(x):
    if x.upper().startswith('Q'):
        q,y=x.split('/');return end(int(y) if len(y)==4 else datetime.strptime(y,'%y').year,int(q[1])*3)
    if len(x.split('/'))==3:
        return datetime.strptime(x,'%b/%d/%y').date().isoformat()
    mo,y=x.split('/');return period(int(y) if len(y)==4 else datetime.strptime(y,'%y').year,mo)
def parse(b,r):
    p=r['params'];t=p['type']
    if t=='sg':
        j=json.loads(b)['Data'];rows=[x for x in j['row'] if x['seriesNo']==p['series'] and x['rowText']==p['name']]
        if len(rows)!=1:raise ValueError('Unexpected SingStat table/series')
        vals={}
        for x in rows[0]['columns']:
            hit=re.fullmatch(r'(\d{4})\s+(.*)',x['key'])
            if not hit:continue
            d=period(int(hit[1]),hit[2].strip());v=x['value']
            if d and re.fullmatch(r'[-+]?\d+(?:\.\d+)?',v):vals[d]=float(v)
        return growth(vals,p.get('months',0))
    if t=='px':
        reader=csv.reader(io.StringIO(b.decode('utf-8-sig')))
        keys=next(reader);vals={}
        def add(y,seg,v):
            d=period(int(y),seg)
            if d and re.fullmatch(r'[-+]?\d+(?:\.\d+)?',v):
                vals[d]=float(v)
        if keys[:2]==['Year','Month']:
            for y,mo,v in reader:add(y,mo,v)
        else:
            body=list(reader)
            if len(body)!=1:raise ValueError('Ambiguous PSA series')
            for key,val in zip(keys,body[0]):
                m=re.search(r'(\d{4}) (Q[1-4]|[A-Za-z]+)$',key)
                if m:add(m[1],m[2],val)
        return growth(vals,p.get('months',0))
    if t=='sdds':
        entries=tables(b);section=p.get('section');active=section is None
        for c in entries:
            if section and c[0]==section:active=True;continue
            if not active or c[0]!=p['key'] or len(c)<6:continue
            if p.get('period_kind')=='month' and (c[2].count('/')!=1 or c[2].startswith('Q')):continue
            d=nsdate(c[2]);val=float(c[3].replace(',',''))
            if p.get('mom'):val=round((val/float(c[5].replace(',',''))-1)*100,6)
            return [(d,val)]
        return []
    if t=='thheadline':
        s=b.decode();tag=re.search(r'<h3>Core Inflation\s*\(%YoY\)</h3>\s*<h4>([\d.-]+)%</h4>\s*<p>(\w+) (\d+)</p>',s)
        return [(period(int(tag[3]),tag[2]),float(tag[1]))] if tag else []
    raise ValueError(t)
