import openpyxl, sys, statistics as st
from collections import Counter
wb=openpyxl.load_workbook(sys.argv[1],read_only=True)
def load(name):
    rows=list(wb[name].iter_rows(values_only=True)); h=rows[0]
    return [dict(zip(h,r)) for r in rows[1:] if r[0] is not None]
S=load('Statements'); P=load('Press Conferences'); M=load('Monetary Events')
print('stmt',len(S),S[0]['Date'].date(),S[-1]['Date'].date()); print('pc',len(P),P[0]['Date'].date(),P[-1]['Date'].date())
sd={r['Date'].date():r for r in S}; md={r['Date'].date():r for r in M}
assets=['EURUSD','USDJPY','DXY','UST2Y','UST10Y','OIS2Y','SPFUT']
# timestamps
pairs=[]
for p in P:
    d=p['Date'].date(); s=sd.get(d)
    if not s: print('PC without stmt',d); continue
    gap=(p['date_time']-s['date_time']).total_seconds()/60
    pairs.append((d,s,p,gap))
print('stmt->PC start gap (min):',Counter(int(g) for *_,g in pairs))
for d,s,p,g in pairs:
    if g!=30: print('  gap',g,d,s['date_time'].time(),p['date_time'].time())
print('stmt times:',Counter(str(s['date_time'].time()) for _,s,_,_ in pairs))
# missing
for a in assets:
    ms=[d for d,s,p,g in pairs if s[a] is None or p[a] is None]
    print(a,'missing',len(ms),[str(x) for x in ms[:8]])
# additivity ME vs STMT+PC
for a in ['EURUSD','USDJPY','UST2Y','UST10Y']:
    errs=[]
    for d,s,p,g in pairs:
        m=md[d]
        if None in (s[a],p[a],m[a]): continue
        errs.append((abs(m[a]-(s[a]+p[a])),d))
    errs.sort(reverse=True)
    print(a,'|ME-(S+PC)| median %.4f'%st.median(e for e,_ in errs),'worst',[(round(e,3),str(d)) for e,d in errs[:4]])
# zeros / stale
for a in ['EURUSD','USDJPY','UST2Y','UST10Y']:
    z=[d for d,s,p,g in pairs if s[a]==0 or p[a]==0]
    print(a,'exact zeros',len(z),[str(x) for x in z])
# SEP flag, unscheduled
print('PC meetings with SEP',sum(1 for d,s,p,g in pairs if s['SEP']==1),'unscheduled',sum(1 for d,s,p,g in pairs if s['Unscheduled']==1))
print('2019+ pairs',sum(1 for d,*_ in pairs if d.year>=2019), 'scheduled meetings 2019+', sum(1 for r in S if r['Date'].year>=2019 and r['Unscheduled']==0))
