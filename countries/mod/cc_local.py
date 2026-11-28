"""Country-specific parsers for Eurostat and Taiwan official feeds."""
import calendar,csv,io,json,re
from datetime import date,datetime
from html import unescape
def end(year,month):
    return date(year,month,calendar.monthrange(year,month)[1]).isoformat()
def asdate(s):
    if re.fullmatch(r'\d{4}-Q[1-4]',s):return end(int(s[:4]),3*int(s[-1]))
    if re.fullmatch(r'\d{4}-\d\d',s):return end(int(s[:4]),int(s[-2:]))
    if re.fullmatch(r'Q[1-4]/\d\d',s):return end(int(datetime.strptime(s[-2:],'%y').year),3*int(s[1]))
    dt=datetime.strptime(s,'%b/%y');return end(dt.year,dt.month)
def parse(b,row):
    p=row['params'];typ=p['type']
    if typ=='eurostat':
        j=json.loads(b);t=j['dimension']['time']['category']['index']
        if any(s!=1 for d,s in zip(j['id'],j['size']) if d!='time') or j['id'][-1]!='time':raise ValueError('Ambiguous or empty dimensions')
        return sorted(((k+'-01' if p.get('survey') else asdate(k)),float(j['value'][str(i)])) for k,i in t.items() if str(i) in j.get('value',{}))
    if typ=='mol':
        out={}
        for d in json.loads(b.decode('utf-8-sig')):
            if not re.fullmatch(r'[-+]?\d+(?:\.\d+)?',str(d.get(p['key'],'')).replace(',','')):continue
            t=d[p['period']].replace('-','');out[end(int(t[:4]),int(t[4:]))]=float(d[p['key']].replace(',',''))
        return sorted(out.items())
    if typ=='twpoint':
        s=b.decode('utf-8')
        hit=re.search(r'id="ContentPlaceHolder1_hidChartData"\s+value="([^"]+)"',s)
        charts=json.loads(unescape(hit[1]))
        def extract(key):
            out={}
            for chart in charts:
                if chart['Title']!=key:continue
                for x in chart['data']:
                    if 'forecast' in x.get('Title_2','').lower():continue
                    if p['freq']=='Q' and 'quarter' not in x['Title'].lower():continue
                    if p['freq']=='M' and not re.search('[a-z]',x['Title'],re.I):continue
                    if x['Value'] in (None,'','...','…','-'):continue
                    y,m,_=map(int,x['Date'].split('/'));out[end(y,m)]=float(str(x['Value']).replace(',',''))
            return out
        v=extract(p['key'])
        if p.get('other'):
            o=extract(p['other']);return sorted((d,round(v[d]-o[d],8)) for d in v.keys() & o.keys())
        return sorted(v.items())
    if typ=='sdds':
        s=b.decode('utf-8-sig')
        def series(k):
            sec=re.search(r'\b'+re.escape(k)+r':\s*\[(.*?)\]',s,re.S)[1]
            return {asdate(d):float(v.replace(',','')) for d,v in re.findall(r"np:\s*'([^']+)'\s*,\s*nv:\s*'([^']+)'",sec)}
        data=series(p['key']);other=series(p['other']) if p.get('other') else {}
        if p.get('op') in ['mom','qoq']:
            vals=sorted(data.items());out=[]
            for (a,x),(d,y) in zip(vals,vals[1:]):
                delta=(int(d[:4])-int(a[:4]))*12+int(d[5:7])-int(a[5:7])
                if delta=={'mom':1,'qoq':3}[p['op']]:out.append((d,round((y/x-1)*100,8)))
            return out
        if p.get('op')=='difference':return sorted((d,data[d]-other[d]) for d in data.keys() & other.keys())
        if p.get('op')=='ur':return sorted((d,round(data[d]/(data[d]+other[d])*100,5)) for d in data.keys() & other.keys())
        return sorted(data.items())
    raise ValueError(typ)
