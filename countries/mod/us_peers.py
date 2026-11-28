"""Anonymous official US macro feeds, UK flights and Switzerland's weekly activity index."""
import csv
import datetime as dt
import email.utils
import html
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from urllib.parse import urljoin
def text(s):
    return ' '.join(html.unescape(re.sub('<[^>]+>',' ',s)).split())
def csvrows(body):
    return csv.DictReader(io.StringIO(body.decode('utf-8-sig')))
def discover(body,row):
    kind=row['params']['kind']
    if kind=='ny':
        x=next(x for x in csvrows(body) if x['landingQuarter']=='1')
        if not re.fullmatch(r'\d{4}',x['year']) or not re.fullmatch(r'Q[1-4]',x['quarter']):
            raise ValueError('Invalid year or quarter in NY Fed catalog')
        return urljoin(row['url'],x['year']+x['quarter']+'.csv')
    s=body.decode()
    if kind=='reserve':
        path=re.search(r'href=["\']?([^ >"\']+/\d{8})["\']?>U.S. International Reserve Position',s)[1]
    elif kind=='ons':
        path=re.search(r'href="([^"]+/current/[^"]+\.xlsx)"',s)[1]
    else:raise ValueError('Unexpected catalog type')
    return urljoin(row['url'],html.unescape(path))
def sheet_rows(body,sheet_name):
    ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    rel='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        wb=ET.fromstring(z.read('xl/workbook.xml'))
        sid=next(s.attrib[rel+'id'] for s in wb.iter(ns+'sheet') if s.get('name')==sheet_name)
        paths=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        path=next(r.get('Target') for r in paths if r.get('Id')==sid)
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            for item in ET.fromstring(z.read('xl/sharedStrings.xml')):
                strings.append(''.join(t.text or '' for t in item.iter(ns+'t')))
        path=path.lstrip('/') if path.startswith('/') else 'xl/'+path
        for row in ET.fromstring(z.read(path)).iter(ns+'row'):
            values={}
            for cell in row.iter(ns+'c'):
                v=cell.findtext(ns+'v')
                if v is not None:
                    if cell.get('t')=='s':v=strings[int(v)]
                    values[re.sub(r'\d+$','',cell.attrib['r'])]=v
            yield values
def parse(body,row):
    p=row['params']
    kind=p['kind']
    if kind=='fred':
        series=p['series'];levels={}
        for x in csvrows(body):
            if x[series] and x[series]!='.':levels[x['observation_date']]=float(x[series])
        months=p.get('months')
        if not months:return sorted(levels.items())
        out=[]
        for s,v in sorted(levels.items()):
            d=dt.date.fromisoformat(s); idx=d.year*12+d.month-1-months
            prior=levels.get(dt.date(idx//12,idx%12+1,d.day).isoformat())
            if prior:out.append((s,round(100*(v/prior-1),p.get('digits',3))))
        return out
    if kind=='seco':
        return sorted((r['date'],float(r['value'])) for r in csvrows(body) if r['structure']=='seco_wwa' and r['seas_adj']=='csa' and r['type']=='index' and r['value'])
    if kind=='atl':
        obs={}
        for item in ET.fromstring(body.strip()).findall('.//item'):
            date=email.utils.parsedate_to_datetime(item.findtext('pubDate')).date().isoformat()
            match=re.search(r'(?:estimate|to)\s+(-?[\d.]+)\s+percent',item.findtext('title') or '',re.I)
            if not match:
                match=re.search(r'\bis\s+(-?[\d.]+)\s+percent',item.findtext('description') or '',re.I)
            if match:obs[date]=float(match[1])
        return sorted(obs.items())
    if kind=='ny':
        obs={}
        for x in csvrows(body):
            if x['Year'] and x['Nowcast']:
                d=dt.datetime.strptime(x['Update'].strip()+'-'+x['Year'].strip(),'%d-%b-%Y').date().isoformat()
                obs[d]=float(x['Nowcast'])
        return sorted(obs.items())
    if kind=='ons':
        obs=[]
        for r in sheet_rows(body,'1.Daily Flights'):
            try:
                day=dt.date(1899,12,30)+dt.timedelta(days=int(float(r['A'])))
                obs.append((day.isoformat(),float(r['B'])))
            except (KeyError,ValueError):continue
        return sorted(obs)
    if kind=='reserve':
        s=body.decode()
        d=dt.datetime.strptime(re.search(r'(?:U\.S\. )?International Reserve Position\s*[-–]\s*([A-Z][a-z]+ \d+, \d{4})',s)[1],'%B %d, %Y').date()
        block=re.search(r'Foreign currency reserves \(in convertible foreign currencies\)(.*?)IMF reserve position',s,re.I|re.S)[1]
        values={}
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>',block,re.S|re.I):
            cells=[text(x) for x in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>',tr,re.S|re.I)]
            if not cells:continue
            key=re.match(r'\((a|i|ii|iii)\)\s',cells[0],re.I)
            if key: values[key[1]]=float(cells[-1].replace(',','')) if cells[-1] else 0.
        if set(values)!={'a','i','ii','iii'}:raise ValueError('Expected Treasury FX securities and all three deposit categories')
        return [(d.isoformat(),sum(values.values()))]
    raise ValueError('Unsupported source format')
