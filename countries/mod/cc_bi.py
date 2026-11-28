"""Indonesian BI official survey workbooks, ZIP > XLSX -> XML."""
import csv,io,re,zipfile,posixpath
import xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import urljoin,urlsplit
from datetime import date
try:
    from .cc_sea import end
except ImportError:
    from cc_sea import end
def discover(body,row):
    p=row['params']
    for href in re.findall(r'''href=["']([^"']+/laporan/Pages/[^"']+\.aspx)["']''',body.decode('utf-8','replace'),re.I):
        slug=unescape(href).split('/')[-1][:-5]
        if not slug.startswith(p['prefix']+'-'):continue
        return urljoin(row['url'],href)
    raise ValueError('BI survey release slug missing')
def workbook(body):
    z=zipfile.ZipFile(io.BytesIO(body));files=[p for p in z.namelist() if p.lower().endswith('.xlsx')]
    if len(files)!=1:raise ValueError('Ambiguous survey workbook')
    inner=zipfile.ZipFile(io.BytesIO(z.read(files[0])));wb=ET.fromstring(inner.read('xl/workbook.xml'))
    rel=ET.fromstring(inner.read('xl/_rels/workbook.xml.rels'))
    rels={n.get('Id'):n.get('Target') for n in rel}
    txt=[]
    if 'xl/sharedStrings.xml' in inner.namelist():
        txt=[''.join(t.text or '' for t in cell.iterfind('.//{*}t')) for cell in ET.fromstring(inner.read('xl/sharedStrings.xml'))]
    for sh in wb.iterfind('.//{*}sheet'):
        rd=next(v for k,v in sh.attrib.items() if k.endswith('}id'));target=rels[rd].lstrip('/');path=target if target.startswith('xl/') else 'xl/'+target
        sheet=ET.fromstring(inner.read(path));rows=[]
        for row in sheet.iterfind('.//{*}row'):
            vals={}
            for cell in row.findall('{*}c'):
                v=cell.findtext('{*}v','')
                if cell.get('t')=='s' and v:v=txt[int(v)]
                if cell.get('t')=='inlineStr':v=''.join(c.text or '' for c in cell.iterfind('.//{*}t'))
                if v:vals[re.match(r'[A-Z]+',cell.get('r'))[0]]=v
            if vals:rows.append((row.get('r'),vals))
        yield sh.get('name'),rows

def discover_second(body,row):
    links=[unescape(h) for h in re.findall(r"""href=["']([^"']+\.zip)["']""",body.decode('utf-8','replace'),re.I)]
    if len(links)!=1:raise ValueError('Expected one BI data workbook link')
    return urljoin(row['url'],links[0])
def parse(body,row):
    p=row['params']; months={'jan':1,'feb':2,'mar':3,'apr':4,'mei':5,'jun':6,'jul':7,'agt':8,'agu':8,'aug':8,'sep':9,'okt':10,'oct':10,'nov':11,'des':12,'dec':12}
    for sheet,lines in workbook(body):
        if sheet!=p['sheet']:continue
        data=dict(lines)
        years=data[p['years']];ticks=data[p['months']]
        line=data[p['row']]
        if not any(p['match'].lower() in v.lower() for v in line.values()):raise ValueError('Survey series heading changed')
        year=None;values={}
        for col,month in ticks.items():
            if col in years:
                if not re.fullmatch(r'20\d{2}',years[col]):break
                year=int(years[col])
            mo=months.get(month.strip().lower()[:3]);val=line.get(col)
            if year and mo and '*' not in month and val:
                if end(year,mo) in values:break
                try:values[end(year,mo)]=float(val)
                except ValueError:continue
        return sorted(values.items())
    raise ValueError('Expected BI workbook tab missing')
