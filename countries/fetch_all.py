#!/usr/bin/env python3
"""Refresh map PASS rows. python3 fetch_all.py --out latest_snapshot.json.
The snapshot is replaced atomically. A failed update preserves the full prior observation.
"""
import argparse
import calendar
import csv
import hashlib
import importlib
import json
import math
import os
import sys
import tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from time import monotonic, sleep
from threading import Lock
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo
import requests

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'mod'))
# FRED times out when sixteen of its CSVs are asked for at once (28 Nov 2026, 39 rows lost): at most two at a time.
from threading import BoundedSemaphore
HOST_LIMIT = {'fred.stlouisfed.org': BoundedSemaphore(2)}
# FRED's CSV endpoint stalls any custom or browser User-Agent but answers the requests default in 0.3 s (28 Nov 2026).
PLAIN_UA = {'fred.stlouisfed.org'}
class _Free:
    def __enter__(self): pass
    def __exit__(self, *a): pass
def shift_months(d, amount):
    y, m = divmod(d.year * 12 + d.month - 1 + amount, 12)
    last = calendar.monthrange(y, m + 1)[1]
    day = last if d.day == calendar.monthrange(d.year, d.month)[1] else min(d.day,last)
    return date(y, m + 1, day)
def metrics(points, row):
    dates = [date.fromisoformat(d) for d, v in points]
    latest, value = dates[-1], points[-1][1]
    out = dict(value=value, observation_date=latest.isoformat(), three_month_direction=None,
               three_month_change=None, comparison_date=None, percentile_10y=None, n_10y=0,
               history_observed_from=dates[0].isoformat())
    if not isinstance(value,(float,int)) or row['indicator'] in ('next_meeting','last_rate_change','budget_forecast_gdp','nowcast','nyfed_nowcast','advance_monthly_gdp'):
        return out
    target = shift_months(latest,-3)
    f = row['frequency'].lower()
    if 'quarter' in f or 'month' in f:
        opts = [i for i, d in enumerate(dates) if d.year==target.year and d.month==target.month]
    else:
        opts = [i for i,d in enumerate(dates) if timedelta() <= target-d <= timedelta(days=7)]
    if opts:
        i = opts[-1]; delta=value-points[i][1]
        out.update(three_month_direction='up' if delta>0 else 'down' if delta<0 else 'flat',
                   three_month_change=delta,comparison_date=dates[i].isoformat())
    start=shift_months(latest,-120)
    values=[v for (s,v),d in zip(points,dates) if d>start]
    out['n_10y']=len(values)
    if any(t in f for t in ('daily','business day','trading day')): min_n,gap=1750,10
    elif 'week' in f: min_n,gap=420,15
    elif 'month' in f: min_n,gap=108,35
    elif 'quarter' in f: min_n,gap=36,95
    elif 'annual' in f or 'yearly' in f: min_n,gap=10,370
    else: return out
    allowed_gap=gap if min_n!=10 else 32
    if dates[0]<=start+timedelta(days=allowed_gap) and len(values)>=min_n:
        out['percentile_10y']=round(100*(sum(v<value for v in values)+.5*sum(v==value for v in values))/len(values),2)
    return out
def read_map():
    with (ROOT/'source_map.csv').open(encoding='utf-8',newline='') as f:
        rows=[r for r in csv.DictReader(f) if r['status']=='PASS']
    for r in rows:
        for k,default in [('params',{}),('headers',{}),('payload',None),('discover',False),('discover_second',False),('detail_headers',{})]:
            if not r.get(k):r[k]=default
            else:
                try:r[k]=json.loads(r[k])
                except json.JSONDecodeError:
                    if k!='payload':raise
                    # INEGI and KRX accept ordinary form-encoded bodies.
                    r[k]=str(r[k])
    return rows
def spec(row, url=None):
    return (row.get('method') or 'GET',url or row['url'],json.dumps(row.get('headers') or {},sort_keys=True),json.dumps(row.get('payload'),sort_keys=True))
def utc():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')
def request_body(key, raw=None):
    method,url,header_string,payload_string=key
    headers=json.loads(header_string); payload=json.loads(payload_string)
    try:
        with HOST_LIMIT.get(urlsplit(url).netloc) or _Free():
          response=requests.request(method,url,headers=headers if urlsplit(url).netloc in PLAIN_UA else {'User-Agent':'Macro dashboard source verification / A29',**headers},json=payload if isinstance(payload,(dict,list)) else None,data=payload if isinstance(payload,str) else None,timeout=(14,40))
        body=response.content
        info=dict(http=response.status_code,url=response.url,sha256=hashlib.sha256(body).hexdigest(),fetch_utc=utc())
        if raw:
            raw.mkdir(parents=True,exist_ok=True)
            path=raw/(info['sha256']+'.body')
            if not path.exists():path.write_bytes(body)
        if response.status_code!=200: info['error']='HTTP '+str(response.status_code)
        if (urlsplit(url).netloc=='eng.stat.gov.tw' and urlsplit(url).path.lower()=='/point.aspx'
                and urlsplit(response.url).path.lower()=='/default.aspx'):
            info.update(error='DGBAS redirected its indicator to the home page',retryable=True)
        return body,info
    except requests.RequestException as e:
        return b'',dict(http=None,url=url,error=str(e),fetch_utc=utc())
def get_batches(keys, workers, raw):
    unique=sorted(set(keys))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        out=dict(zip(unique,pool.map(lambda k:request_body(k,raw),unique)))
        for attempt in range(2):
            retry=[k for k,(_,meta) in out.items() if meta.get('retryable') or meta.get('http') in (None,408,500,502,503,504)]
            if not retry:break
            sleep(1+attempt)
            def retry_one(k):
                u=urlsplit(k[1])
                if u.netloc=='customs.go.kr':
                    # KCS publishes identical bulletin IDs on both documented official hostnames.
                    alternate=(k[0],urlunsplit((u.scheme,'www.customs.go.kr',u.path,u.query,'')),*k[2:])
                    return request_body(alternate,raw)
                return request_body(k,raw)
            for k,(body,meta) in zip(retry,pool.map(retry_one,retry)):
                prior=out[k][1].copy()
                previous=prior.pop('previous_attempts',[])
                meta['previous_attempts']=previous+[prior]
                out[k]=(body,meta)
    return out
def atomic_write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',dir=path.parent,delete=False,encoding='utf-8') as f:
        json.dump(obj,f,ensure_ascii=False,sort_keys=True,indent=1,allow_nan=False);f.write('\n')
    os.replace(f.name,path)
def refresh(rows,previous,cutoff,workers,raw,requested_on):
    base=get_batches([spec(r) for r in rows],workers,raw)
    modules={r['module']:importlib.import_module(r['module']) for r in rows}
    resolved={};errors={}
    for r in rows:
        k=(r['country'],r['indicator']);body,meta=base[spec(r)]
        if meta.get('error'):errors[k]=meta['error'];continue
        if r.get('discover'):
            try:
                dest=modules[r['module']].discover(body,r)
                if urlsplit(dest).scheme not in ('http','https'):raise ValueError('Invalid download link')
                resolved[k]=('GET',dest,json.dumps(r.get('detail_headers') or r.get('headers') or {},sort_keys=True), 'null')
            except Exception as e:errors[k]=str(e)
    details=get_batches(resolved.values(),workers,raw)
    finals={}
    for r in rows:
        k=(r['country'],r['indicator'])
        if not r.get('discover_second') or k not in resolved:continue
        body,meta=details[resolved[k]]
        if meta.get('error'):errors[k]=meta['error'];continue
        try:
            dest=modules[r['module']].discover_second(body,r)
            if urlsplit(dest).scheme not in ('http','https'):raise ValueError('Invalid final download link')
            finals[k]=('GET',dest,json.dumps(r.get('detail_headers') or r.get('headers') or {},sort_keys=True),'null')
        except Exception as e:errors[k]=str(e)
    known={**base,**details};last_batch=get_batches(set(finals.values())-set(known),workers,raw);known.update(last_batch)
    output={}; prior=previous.get('series',{})
    for r in rows:
        k=(r['country'],r['indicator']); code='/'.join(k)
        body,meta=known[finals.get(k) or resolved.get(k) or spec(r)]
        last=prior.get(code) or {}
        try:
            if k in errors or meta.get('error'):raise ValueError(errors.get(k) or meta['error'])
            data=modules[r['module']].parse(body,r)
            points={}
            for d,v in data:
                d=str(d); date.fromisoformat(d)
                if d>cutoff:continue
                if isinstance(v,(float,int)) and not math.isfinite(v):continue
                if d in points and points[d]!=v:raise ValueError('Conflicting observations on '+d)
                points[d]=v
            if not points: raise ValueError('No valid observation at or before '+cutoff)
            out=metrics(sorted(points.items()),r)
            if last.get('observation_date','')>out['observation_date']:raise ValueError('Upstream observation date went backwards')
            out.update(state='ok',last_success_utc=meta['fetch_utc'])
        except Exception as e:
            out=dict(last);out.update(state='retained' if last.get('observation_date') else 'unavailable',error=str(e))
        out.update(country=r['country'],indicator=r['indicator'],unit=r['unit'],frequency=r['frequency'],as_of=cutoff,
                   observation_age_days=(date.fromisoformat(cutoff)-date.fromisoformat(out['observation_date'])).days if out.get('observation_date') else None,
                   last_attempt_utc=meta['fetch_utc'],http=meta['http'],source_url=(finals.get(k) or resolved.get(k) or spec(r))[1])
        output[code]=out
    if raw:
        atomic_write(raw/'requests.json',[{'method':k[0],'request_url':k[1],'headers':json.loads(k[2]),'payload':json.loads(k[3]),**m} for k,(_,m) in known.items()])
    return dict(as_of=cutoff,fetch_utc=requested_on,requests=len(known),series=output),len(known)+sum(len(m.get('previous_attempts',[])) for _,m in known.values())
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',type=Path,default=ROOT/'latest_snapshot.json');p.add_argument('--workers',type=int,default=16)
    p.add_argument('--as-of',default=datetime.now(ZoneInfo('Asia/Singapore')).date().isoformat(),help='Observation ceiling on current vintage; does not reconstruct historical vintages')
    p.add_argument('--capture',type=Path,help='Save HTTP entities by hash and request metadata for reproducibility')
    p.add_argument('--previous',type=Path,help='Optional previous snapshot; defaults to existing --out')
    a=p.parse_args();date.fromisoformat(a.as_of);prior_path=a.previous or a.out
    # Serialize writers sharing an output so a slower overlapping run cannot undo a newer one.
    import fcntl
    a.out.parent.mkdir(parents=True,exist_ok=True)
    with (a.out.parent/(a.out.name+'.lock')).open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        old=json.loads(prior_path.read_text()) if prior_path.exists() else {}
        started=monotonic()
        snapshot,attempts=refresh(read_map(),old,a.as_of,a.workers,a.capture,utc())
        atomic_write(a.out,snapshot)
        from collections import Counter
        print(json.dumps({'seconds':round(monotonic()-started,3),'requests':attempts,'unique_requests':snapshot['requests'],'states':dict(Counter(i['state'] for i in snapshot['series'].values()))}))
if __name__=='__main__': main()
