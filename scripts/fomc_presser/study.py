import openpyxl, sys, math, random, statistics as st
wb=openpyxl.load_workbook(sys.argv[1],read_only=True)
def load(n):
    rows=list(wb[n].iter_rows(values_only=True)); h=rows[0]
    return [dict(zip(h,r)) for r in rows[1:] if r[0] is not None]
S={r['Date'].date():r for r in load('Statements')}; P=load('Press Conferences')
ev=[]
for p in P:
    d=p['Date'].date(); s=S[d]
    if (p['date_time']-s['date_time']).total_seconds()!=1800 or s['Unscheduled']: continue
    e={'d':d,'sep':s['SEP']}
    for a in ['EURUSD','USDJPY','DXY','UST2Y','UST10Y','SPFUT']:
        e['s_'+a]=s[a]; e['p_'+a]=p[a]
    e['s_CURVE']=s['UST10Y']-s['UST2Y']; e['p_CURVE']=p['UST10Y']-p['UST2Y']
    ev.append(e)
print('clean events',len(ev),ev[0]['d'],ev[-1]['d']); print('2026:',[str(e['d']) for e in ev if e['d'].year==2026])
scale={'EURUSD':100,'USDJPY':100,'DXY':100,'UST2Y':100,'UST10Y':100,'CURVE':100,'SPFUT':100}  # % -> bp ; pp -> bp
units={'EURUSD':'bp of spot','USDJPY':'bp of spot','DXY':'bp','UST2Y':'bp','UST10Y':'bp','CURVE':'bp','SPFUT':'bp'}
def stats(sub,a):
    x=[(e['s_'+a]*100,e['p_'+a]*100) for e in sub if e['s_'+a] not in (None,0) and e['p_'+a] is not None]
    n=len(x)
    if n<5: return None
    c=[math.copysign(1,s)*p for s,p in x]
    rev=sum(1 for v in c if v<0)/n
    full=sum(1 for (s,p),v in zip(x,c) if v<=-abs(s))/n
    big=sorted(x,key=lambda t:-abs(t[0]))[:max(1,n//2)]
    cb=[math.copysign(1,s)*p for s,p in big]
    revb=sum(1 for v in cb if v<0)/len(cb)
    mc=st.mean(c); se=st.stdev(c)/math.sqrt(n)
    ms=st.mean(abs(s) for s,_ in x)
    sx=[s for s,_ in x]; py=[p for _,p in x]; mx=st.mean(sx); my=st.mean(py)
    beta=sum((a-mx)*(b-my) for a,b in zip(sx,py))/sum((a-mx)**2 for a in sx)
    # beta t via resid
    res=[b-my-beta*(a-mx) for a,b in zip(sx,py)]
    sb=math.sqrt(sum(r*r for r in res)/(n-2)/sum((a-mx)**2 for a in sx))
    sdr=st.pstdev(py)/st.pstdev(sx)
    medS=st.median(abs(s) for s,_ in x); medP=st.median(abs(p) for _,p in x)
    # hold-through vs take-profit: share where holding improved P&L, and mean |S| captured
    return dict(n=n,rev=rev,se_rev=math.sqrt(rev*(1-rev)/n),full=full,revbig=revb,nbig=len(cb),
        mc=mc,tc=mc/se,mcb=st.mean(cb),ms=ms,beta=beta,tb=beta/sb,sdr=sdr,medS=medS,medP=medP)
regimes=[('Full 2013-26',lambda e:True),('2019-26 (PC every meeting)',lambda e:e['d'].year>=2019),
         ('2022-26 (hiking/cutting cycle)',lambda e:e['d'].year>=2022),('2013-18',lambda e:e['d'].year<2019),
         ('SEP meetings',lambda e:e['sep']==1),('non-SEP meetings',lambda e:e['sep']==0)]
for a in ['EURUSD','USDJPY','DXY','UST2Y','UST10Y','CURVE','SPFUT']:
    print('\n###',a,'(',units[a],'; sign continuation = PC move in direction of statement move)')
    print('%-30s %3s %6s %6s %6s %7s %7s %6s %6s %6s %6s %6s %5s %5s'%('regime','n','rev%','±se','full%','revBig%','mean c','t','mcBig','m|S|','beta','t_b','medS','medP'))
    for name,f in regimes:
        r=stats([e for e in ev if f(e)],a)
        if r: print('%-30s %3d %6.0f %6.0f %6.0f %7.0f %7.1f %6.1f %6.1f %6.1f %6.2f %6.1f %5.1f %5.1f'%(name,r['n'],100*r['rev'],100*r['se_rev'],100*r['full'],100*r['revbig'],r['mc'],r['tc'],r['mcb'],r['ms'],r['beta'],r['tb'],r['medS'],r['medP']))
# recent event list for FX & 2y
print('\nRecent events (bp): date sep | EURUSD s/p | USDJPY s/p | 2y s/p | 10y s/p')
for e in ev[-16:]:
    print(e['d'],e['sep'],*['%6.1f/%6.1f'%(e['s_'+a]*100,e['p_'+a]*100) for a in ['EURUSD','USDJPY','UST2Y','UST10Y']])
# cross-asset coherence: does PC reverse in FX when 2y reverses?
agree=[e for e in ev if e['s_UST2Y'] and e['p_UST2Y'] and e['s_UST2Y']*e['p_UST2Y']<0]
print('\n2y reversal meetings',len(agree),'; of which USDJPY also reverses',sum(1 for e in agree if e['s_USDJPY']*e['p_USDJPY']<0),'EURUSD also',sum(1 for e in agree if e['s_EURUSD']*e['p_EURUSD']<0))
# exclude statement moves smaller than 5bp FX / 2bp 2y
for a,th in [('EURUSD',10),('USDJPY',10),('UST2Y',2),('UST10Y',2)]:
    r=stats([e for e in ev if abs(e['s_'+a]*100)>=th],a)
    r2=stats([e for e in ev if abs(e['s_'+a]*100)>=th and e['d'].year>=2019],a)
    print(a,'|S|>=%g:'%th,'n',r['n'],'rev %.0f%%'%(100*r['rev']),'mean c %.1f t %.1f'%(r['mc'],r['tc']),'| 2019+: n',r2['n'],'rev %.0f%%'%(100*r2['rev']),'mean c %.1f t %.1f'%(r2['mc'],r2['tc']))
print('\nVariance share of presser in the 100-min window, and |PC| p50/p75/p90 (bp)')
def q(v,p): v=sorted(v); return v[min(len(v)-1,int(p*len(v)))]
for a in ['EURUSD','USDJPY','UST2Y','UST10Y']:
    for name,f in [('2013-18',lambda e:e['d'].year<2019),('2019-26',lambda e:e['d'].year>=2019),('2022-26',lambda e:e['d'].year>=2022),('2022-26 nonSEP',lambda e:e['d'].year>=2022 and e['sep']==0),('2022-26 SEP',lambda e:e['d'].year>=2022 and e['sep']==1)]:
        sub=[e for e in ev if f(e) and e['s_'+a] is not None]
        vs=sum((e['s_'+a]*100)**2 for e in sub); vp=sum((e['p_'+a]*100)**2 for e in sub)
        pa=[abs(e['p_'+a]*100) for e in sub]; sa=[abs(e['s_'+a]*100) for e in sub]
        print('%-7s %-15s n=%2d PCshare=%3.0f%%  |S| p50 %5.1f p90 %5.1f | |PC| p50 %5.1f p75 %5.1f p90 %5.1f'%(a,name,len(sub),100*vp/(vs+vp),q(sa,.5),q(sa,.9),q(pa,.5),q(pa,.75),q(pa,.9)))
