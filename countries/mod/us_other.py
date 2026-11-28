"""Parse INEGI no-key feeds, StatCan's advance monthly GDP text and RBNZ staff forecasts."""
import json,calendar,csv,datetime as dt,io,re,zipfile
from xml.etree import ElementTree as ET
from urllib.parse import urljoin
from us_peers import text,sheet_rows
MONTHS='enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split()
def month_end(y,m):return dt.date(y,m,calendar.monthrange(y,m)[1])
def period_end(label):
    t=label.lower().strip(); y=int(re.search(r'20\d{2}',t)[0])
    for i,month in enumerate(MONTHS,1):
        if month in t:return dt.date(y,i,15) if 'primera quincena' in t else month_end(y,i)
    q=next(i for i,x in enumerate(('primer','segundo','tercer','cuarto'),1) if x in t)
    return month_end(y,q*3)
def discover(body,row):
    s=body.decode()
    if row['params']['kind']=='mx_sheet':
        part=row['params']['path']
        path=next(j['comunicadoEsUrlExcel'] for j in json.loads(s) if part in str(j.get('comunicadoEsUrlExcel','')).lower())
        return urljoin(row['url'],'/contenidos'+path)
    if row['params']['kind']=='canada':
        return urljoin(row['url'],re.search(r'href="([^"]+/daily-quotidien/[^"]+)" title="Gross domestic product by industry',s)[1])
    raise ValueError('Unsupported discovery')
def parse(body,row):
    p=row['params']
    if p['kind']=='nz':
        out={}
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            w=ET.fromstring(z.read('xl/workbook.xml'))
            names=sorted(s.get('name') for s in w.findall('.//{*}sheet') if re.fullmatch(r'\d{4}q[1-4]',s.get('name','')))
        if not names:raise ValueError('No Kiwi-GDP quarterly worksheets')
        # The earliest target with a published estimate on each Friday matches the one-quarter-ahead series.
        for name in names:
            for r in sheet_rows(body,name):
                try:day=dt.datetime.strptime(r['A'],'%d-%b-%Y').date().isoformat(); value=float(r['B'])
                except (KeyError,ValueError):continue
                out.setdefault(day,value)
        return sorted(out.items())
    if p['kind']=='canada':
        s=body.decode();pub=re.search(r'name="dcterms.issued"[^>]+content="(\d{4}-\d{2}-\d{2})"',s)[1]
        t=text(s);m=re.search(r'Advance estimate for real gross domestic product by industry for (\w+ \d{4}) (.{0,280}?)\.',t,re.I)
        if not m:raise ValueError('Missing advance estimate paragraph')
        tail=t[m.start():m.start()+350]
        if re.search(r'(?:GDP|domestic product) (?:was |remained )?(?:essentially unchanged|unchanged|flat)',tail,re.I):v=0.
        else:
            a=re.search(r'(?:GDP|domestic product) (increased|decreased|rose|fell|grew|declined|expanded|contracted)(?: by)? ([\d.]+)\s*%',tail,re.I)
            if not a:raise ValueError('Unrecognized advance estimate phrasing')
            v=float(a[2])*(-1 if a[1].lower() in ('decreased','fell','declined','contracted') else 1)
        return [(pub,v)]
    if p['kind']=='mx_release':
        j=json.loads(body)[0];period=period_end(j['periodoInformacion'])
        title=j['tituloIngles'];summary=text(j['resumenNoticia'])
        if p['tag']=='IOAE':
            m=re.search(r'(?:a |an )?(\d+(?:[.,]\d+)?)\s*% annual (increase|decrease|decline|contraction|growth)',title,re.I)
            if not m:
                m=re.search(r'(?:an? )?(annual (?:increase|decrease|decline|growth)) of (\d+(?:[.,]\d+)?)\s*%',title,re.I)
                if not m:raise ValueError('Unrecognized IOAE annual change sentence')
                num,sign=m[2],m[1]
            else:num,sign=m[1],m[2]
            value=float(num.replace(',','.'))*(-1 if any(x in sign.lower() for x in ('decline','contraction','decrease')) else 1)
            return [(dt.datetime.strptime(j['fechaInformacion'],'%d/%m/%Y').date().isoformat(),value)]
        if p['tag']=='BCMM':
            m=re.search(r'valor de las exportaciones de mercanc.as fue de ([0-9 ]+) (?:mdd|millones de d.lares)',summary,re.I)
            if not m:raise ValueError('Missing export value and USD unit')
            return [(period.isoformat(),float(m[1].replace(' ','')))]
        if p['tag']=='INPP':
            m=re.search(r'INPP total, incluido petr.leo, (.{1,110}?) a tasa anual',summary,re.I)
            n=re.search(r'(-?\d+(?:[.,]\d+)?) ?%(?: a tasa)?$',m[1].strip()) if m else None
            if not n:raise ValueError('Unrecognized INPP total y/y comparator')
            v=float(n[1].replace(',','.'))
            if any(a in m[1].lower() for a in ['disminuy','disminu','cay','reduj','decrec']):raise ValueError('Annual sign requires review')
            return [(period.isoformat(),v)]
    if p['kind']=='mx_sheet':
        rows=list(sheet_rows(body,p['sheet']))
        if p['sheet']=='SIEC-ENOE':
            i=next(i for i,r in enumerate(rows) if str(r.get('B','')).strip()=='Indicador' and r.get('D','').lower() in MONTHS)
            m=MONTHS.index(rows[i]['D'].lower())+1
            r=next(r for r in rows[i:] if r.get('B')=='Población ocupada')
            return [(month_end(int(rows[i+1][c]),m).isoformat(),float(r[c])) for c in ('D','J')]
        output=[];year=None
        for row in rows:
            lab=row.get('B','').lower().strip()
            if re.fullmatch(r'20\d{2}',lab):year=int(lab)
            elif year and lab in MONTHS and row.get('D'):
                output.append((month_end(year,MONTHS.index(lab)+1).isoformat(),float(row['D'])))
        return sorted(output)
    if p['kind']=='mx':
        root=ET.fromstring(body)
        if root.findtext('METADATA/Nemonic')!=p['series']:raise ValueError('Incorrect INEGI feed')
        out=[]
        for item in root.findall('SERIE/Obs'):
            parts=list(map(int,item.get('TimePeriod').split('/')))
            y,m=parts[:2]
            if p['freq']=='quarterly':
                m*=3
            day=15 if len(parts)==3 and parts[2]==1 else calendar.monthrange(y,m)[1]
            try:v=float(item.get('CurrentValue'))
            except (ValueError,TypeError):continue
            out.append((dt.date(y,m,day).isoformat(),v))
        return sorted(out)
    raise ValueError('Unsupported feed')
