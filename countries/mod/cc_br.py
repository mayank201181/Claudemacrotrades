import json,math
from datetime import datetime
try:
    from .cc_sea import end
except ImportError:
    from cc_sea import end
def parse(b,row):
    j=json.loads(b);typ=row['params']['type']
    if typ=='ibge':
        series=j[0]['resultados'][0]['series']
        if len(series)!=1:raise ValueError('Ambiguous national series')
        return sorted((end(int(k[:4]),int(k[4:])),float(v)) for k,v in series[0]['serie'].items() if str(v).replace('.','',1).replace('-','',1).isdigit())
    if typ=='focus':return sorted((d['Data'][:10],float(d['Mediana'])) for d in j['value'] if d.get('Mediana') is not None)
    vals={}
    for x in j:
        d=datetime.strptime(x['data'],'%d/%m/%Y');vals[d.year*12+d.month-1]=float(x['valor'])
    out=[]
    for k,v in sorted(vals.items()):
        if typ=='sgs12':
            if not all(t in vals for t in range(k-11,k+1)):continue
            v=round((math.prod(1+vals[t]/100 for t in range(k-11,k+1))-1)*100,8)
        y,m=divmod(k,12);out.append((end(y,m+1),v))
    return out
