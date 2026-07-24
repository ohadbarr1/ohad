"""Canonical replica of the v2 Pine strategy (1:1 with the code to be shipped).

Pine design being mirrored:
  - Bands (1M, confirmed [1]): upper=SMA(high,33), lower=SMA(low,33), mid=SMA(ohlc4,33),
    width mult m around mid.
  - Regime: computed INSIDE the monthly context from monthly closes vs the (already
    confirmed) bands, then brought down confirmed → on the weekly chart a monthly flip
    becomes visible on the first weekly bar of the following month.
  - Entry (weekly, on close): in BULL regime & flat:
      * flip entry (optional): the bar where bull regime becomes visible
      * dip entry: weekly close crosses INTO the band from above (prev close > upper,
        close <= upper), optional deeper requirement (low <= mid)
      * once-per-regime gate (optional: reset after TP so a later dip can re-enter)
  - TP: limit order at entry + k*(upper-lower)  [or entry*(1+pct)] — intrabar fill.
  - Stop: bear regime becomes visible → close at that weekly close.
"""
import json, numpy as np, itertools, datetime as dt

SP = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
M = json.load(open(f'{SP}/tsla_monthly.json')); W = json.load(open(f'{SP}/tsla_weekly.json'))
mt=[s[:10] for s in M['time']]; mo,mh,ml,mc=(np.array(M[k]) for k in ('open','high','low','close'))
m4=(mo+mh+ml+mc)/4; N=33; n_m=len(mt)
sh=np.full(n_m,np.nan); sl_=np.full(n_m,np.nan); sm=np.full(n_m,np.nan)
for i in range(N-1,n_m):
    sh[i]=mh[i-N+1:i+1].mean(); sl_[i]=ml[i-N+1:i+1].mean(); sm[i]=m4[i-N+1:i+1].mean()

# monthly regime series: month i state uses close[i] vs confirmed band (window ending i-1)
m_reg = np.zeros(n_m, int)
r = 0
for i in range(n_m):
    up_c, lo_c = (sh[i-1], sl_[i-1]) if i-1 >= 0 else (np.nan, np.nan)
    if not np.isnan(up_c):
        if mc[i] > up_c: r = 1
        elif mc[i] < lo_c: r = -1
    m_reg[i] = r

ym_to_idx={s[:7]:i for i,s in enumerate(mt)}
wt=[s[:10] for s in W['time']]; wo,wh,wl,wc=(np.array(W[k]) for k in ('open','high','low','close'))
n_w=len(wt)
def wym(ws):
    d=dt.date.fromisoformat(ws)+dt.timedelta(days=4); return f"{d.year:04d}-{d.month:02d}"
w_mi=np.array([ym_to_idx.get(wym(ws),n_m-1) for ws in wt])
# confirmed values visible on weekly bar j: from month w_mi[j]-1
w_up=np.array([sh[k-1] if k-1>=0 else np.nan for k in w_mi])
w_lo=np.array([sl_[k-1] if k-1>=0 else np.nan for k in w_mi])
w_mid=np.array([sm[k-1] if k-1>=0 else np.nan for k in w_mi])
w_reg=np.array([m_reg[k-1] if k-1>=0 else 0 for k in w_mi])

def run(use_flip, dip_mode, tm, tk, once, reset_on_tp, mult=1.0):
    trades=[]; pos=None; entered=False
    prev_reg=0
    for j in range(n_w):
        up,lo,mid=w_up[j],w_lo[j],w_mid[j]
        if np.isnan(up): prev_reg=w_reg[j]; continue
        if mult!=1.0:
            up=mid+mult*(up-mid); lo=mid-mult*(mid-lo)
        reg=w_reg[j]
        flip_bull = reg==1 and prev_reg!=1
        flip_bear = reg==-1 and prev_reg!=-1
        if reg!=prev_reg: entered=False
        # exits
        if pos is not None:
            if wh[j] >= pos['tp']:
                trades.append(dict(ei=pos['ei'],xi=j,ep=pos['ep'],xp=pos['tp'],kind='TP')); pos=None
                if reset_on_tp: entered=False
            elif reg==-1:
                trades.append(dict(ei=pos['ei'],xi=j,ep=pos['ep'],xp=wc[j],kind='SL')); pos=None
        # entries (on close)
        if pos is None and reg==1:
            dip=False
            pu = w_up[j-1] if j>0 else np.nan
            if mult!=1.0 and not np.isnan(pu):
                pm = w_mid[j-1]; pu = pm + mult*(pu-pm)
            if dip_mode=='cross_in':
                dip = (not np.isnan(pu)) and wc[j-1]>pu and wc[j]<=up and wc[j]>=lo
            elif dip_mode=='close_in':
                dip = lo<=wc[j]<=up
            elif dip_mode=='cross_in_deep':
                dip = (not np.isnan(pu)) and wc[j-1]>pu and wl[j]<=mid and wc[j]>=lo
            elif dip_mode=='low_le_mid':
                dip = wl[j]<=mid and wc[j]>=lo
            sig = (use_flip and flip_bull) or dip
            if sig and (not once or not entered):
                width=up-lo
                tp = wc[j]+tk*width if tm=='bandmult' else wc[j]*(1+tk)
                pos=dict(ei=j,ep=wc[j],tp=tp); entered=True
        prev_reg=reg
    return trades,pos

def stats(trades):
    n=len(trades)
    if n==0: return None
    rets=[(t['xp']/t['ep']-1)*100 for t in trades]
    wins=[x for x in rets if x>=0]; losses=[x for x in rets if x<0]
    ntp=sum(1 for t in trades if t['kind']=='TP'); nsl=n-ntp
    holds=[t['xi']-t['ei'] for t in trades]
    return dict(n=n,wr=100*len(wins)/n,aw=np.mean(wins) if wins else np.nan,
                al=np.mean(losses) if losses else np.nan,hold=np.mean(holds),ntp=ntp,nsl=nsl,
                detail=[(wt[t['ei']],round(t['ep'],2),wt[t['xi']],round(t['xp'],2),t['kind'],round((t['xp']/t['ep']-1)*100,1)) for t in trades])

def passes(s):
    if s is None: return False
    return (s['n']==4 and s['ntp']==2 and s['nsl']==2 and abs(s['wr']-50)<1e-9
            and abs(s['aw']-111.1)<=10 and abs(s['al']+42.7)<=8 and abs(s['hold']-28.5)<=6)

def score(s):
    if s is None: return 1e9
    pen  = abs(s['n']-4)*200 + abs(s['ntp']-2)*100 + abs(s['nsl']-2)*100
    pen += abs(s['aw']-111.1) if not np.isnan(s['aw']) else 200
    pen += abs(s['al']+42.7)*1.5 if not np.isnan(s['al']) else 200
    pen += abs(s['hold']-28.5)*0.5
    return pen

results=[]
for uf, dm, tm, once, rtp in itertools.product(
        [True,False],
        ['cross_in','close_in','cross_in_deep','low_le_mid','none'],
        ['bandmult','fixedpct'],
        [True],
        [False,True]):
    if dm=='none' and not uf: continue
    tks = [round(1.5+0.1*i,2) for i in range(40)] if tm=='bandmult' else [round(0.6+0.02*i,2) for i in range(46)]
    for tk in tks:
        dmode = dm if dm!='none' else 'cross_in'
        trades,pos = run(uf, 'xxxx' if dm=='none' else dm, tm, tk, once, rtp)
        s=stats(trades)
        if s: results.append((score(s),uf,dm,tm,tk,once,rtp,s,pos))
results.sort(key=lambda r:r[0])
seen=set(); shown=0
print("PASS?  flip dip           tpmode   k     resetTP  n tp/sl wr    aw     al   hold")
for r in results:
    sc,uf,dm,tm,tk,once,rtp,s,pos=r
    key=tuple((d[0],d[4]) for d in s['detail'])+(round(s['aw'],0) if not np.isnan(s['aw']) else 0, round(s['al'],0) if not np.isnan(s['al']) else 0)
    if key in seen: continue
    seen.add(key); shown+=1
    print(f"{'PASS' if passes(s) else f'{sc:5.1f}'}  {int(uf)}    {dm:13s} {tm:8s} {tk:5.2f} {int(rtp)}        n={s['n']} {s['ntp']}/{s['nsl']} {s['wr']:3.0f} {s['aw']:+6.1f} {s['al']:+6.1f} {s['hold']:5.1f}  open={pos is not None}")
    for d in s['detail']: print('        ',d)
    if shown>=12: break
