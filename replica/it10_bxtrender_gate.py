"""Iteration 10: B-Xtrender gate on the canonical v2 entries + monthly-entry variants.

B-Xtrender (Puppytherapy): shortTerm = RSI(EMA(close,s1) - EMA(close,s2), s3) - 50.
THT panel reads "THT Bull Cycle System 1M 33 1 14 5 21" -> candidate param sets
(5,20,15) classic, (5,21,14) from the string, (14,21,5) etc. Gate variants:
  g_pos   : shortTerm > 0 at the signal bar (confirmed monthly)
  g_rise  : shortTerm rising (st > st[1])
  g_pos_or_rise, g_pos_and_rise
"""
import json, os, numpy as np, itertools, datetime as dt

SP = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(f'{SP}/tsla_monthly.json')); W = json.load(open(f'{SP}/tsla_weekly.json'))
mt=[s[:10] for s in M['time']]; mo,mh,ml,mc=(np.array(M[k]) for k in ('open','high','low','close'))
m4=(mo+mh+ml+mc)/4; N=33; n_m=len(mt)
sh=np.full(n_m,np.nan); sl_=np.full(n_m,np.nan); sm=np.full(n_m,np.nan)
for i in range(N-1,n_m):
    sh[i]=mh[i-N+1:i+1].mean(); sl_[i]=ml[i-N+1:i+1].mean(); sm[i]=m4[i-N+1:i+1].mean()

def ema(x,n):
    a=2/(n+1); o=np.empty_like(x); o[0]=x[0]
    for i in range(1,len(x)): o[i]=a*x[i]+(1-a)*o[i-1]
    return o

def rsi(x,n):
    d=np.diff(x, prepend=x[0])
    up=np.where(d>0,d,0.0); dn=np.where(d<0,-d,0.0)
    au=np.empty_like(x); ad=np.empty_like(x); au[0]=up[0]; ad[0]=dn[0]
    a=1/n
    for i in range(1,len(x)):
        au[i]=a*up[i]+(1-a)*au[i-1]; ad[i]=a*dn[i]+(1-a)*ad[i-1]
    rs=np.divide(au,ad,out=np.full_like(au,np.inf),where=ad!=0)
    return 100-100/(1+rs)

def bx_short(s1,s2,s3):
    return rsi(ema(mc,s1)-ema(mc,s2), s3)-50

m_reg=np.zeros(n_m,int); r=0
for i in range(n_m):
    upc,loc=(sh[i-1],sl_[i-1]) if i-1>=0 else (np.nan,np.nan)
    if not np.isnan(upc):
        if mc[i]>upc: r=1
        elif mc[i]<loc: r=-1
    m_reg[i]=r

ym_to_idx={s[:7]:i for i,s in enumerate(mt)}
wt=[s[:10] for s in W['time']]; wo,wh,wl,wc=(np.array(W[k]) for k in ('open','high','low','close'))
n_w=len(wt)
def wym(ws):
    d=dt.date.fromisoformat(ws)+dt.timedelta(days=4); return f"{d.year:04d}-{d.month:02d}"
w_mi=np.array([ym_to_idx.get(wym(ws),n_m-1) for ws in wt])
w_up=np.array([sh[k-1] if k-1>=0 else np.nan for k in w_mi])
w_lo=np.array([sl_[k-1] if k-1>=0 else np.nan for k in w_mi])
w_mid=np.array([sm[k-1] if k-1>=0 else np.nan for k in w_mi])
w_reg=np.array([m_reg[k-1] if k-1>=0 else 0 for k in w_mi])

def run(tk, gate_arr, tm='bandmult', entry='cross_in'):
    trades=[]; pos=None; entered=False; prev_reg=0
    for j in range(n_w):
        up,lo,mid=w_up[j],w_lo[j],w_mid[j]
        if np.isnan(up): prev_reg=w_reg[j]; continue
        reg=w_reg[j]
        if reg!=prev_reg: entered=False
        if pos is not None:
            if wh[j]>=pos['tp']:
                trades.append(dict(ei=pos['ei'],xi=j,ep=pos['ep'],xp=pos['tp'],kind='TP')); pos=None
            elif reg==-1:
                trades.append(dict(ei=pos['ei'],xi=j,ep=pos['ep'],xp=wc[j],kind='SL')); pos=None
        if pos is None and reg==1 and not entered:
            pu=w_up[j-1] if j>0 else np.nan
            if entry=='cross_in':
                dip=(not np.isnan(pu)) and wc[j-1]>pu and lo<=wc[j]<=up
            else:
                dip=lo<=wc[j]<=up
            ok = gate_arr is None or gate_arr[max(w_mi[j]-1,0)]
            if dip and ok:
                width=up-lo
                tp=wc[j]+tk*width if tm=='bandmult' else wc[j]*(1+tk)
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

def score(s):
    if s is None: return 1e9
    pen=abs(s['n']-4)*200+abs(s['ntp']-2)*100+abs(s['nsl']-2)*100
    pen+=abs(s['aw']-111.1) if not np.isnan(s['aw']) else 200
    pen+=abs(s['al']+42.7)*1.5 if not np.isnan(s['al']) else 200
    pen+=abs(s['hold']-28.5)*0.5
    return pen

param_sets=[(5,20,15),(5,21,14),(14,21,5),(5,14,21),(1,14,5),(5,20,14)]
gates={}
for ps in param_sets:
    st=bx_short(*ps)
    gates[f'pos{ps}']=st>0
    gates[f'rise{ps}']=np.r_[False, st[1:]>st[:-1]]
    gates[f'posrise{ps}']=(st>0)|np.r_[False, st[1:]>st[:-1]]
    gates[f'posANDrise{ps}']=(st>0)&np.r_[False, st[1:]>st[:-1]]
gates['none']=None

results=[]
for gname,g in gates.items():
    for tk in [round(2.0+0.2*i,2) for i in range(16)]:
        for entry in ['cross_in','close_in']:
            trades,pos=run(tk,g,entry=entry)
            s=stats(trades)
            if s: results.append((score(s),gname,tk,entry,s,pos))
results.sort(key=lambda r:r[0])
seen=set(); shown=0
for r in results:
    sc,gname,tk,entry,s,pos=r
    key=tuple((d[0],d[4]) for d in s['detail'])
    if key in seen: continue
    seen.add(key); shown+=1
    print(f"{sc:6.1f} gate={gname:22s} k={tk:4.1f} {entry:9s} n={s['n']} {s['ntp']}/{s['nsl']} wr={s['wr']:3.0f} aw={s['aw']:+6.1f} al={s['al']:+6.1f} hold={s['hold']:5.1f} open={pos is not None}")
    if shown<=6:
        for d in s['detail']: print('   ',d)
    if shown>=14: break
