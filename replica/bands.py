import json, os, numpy as np

SP = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(f'{SP}/tsla_monthly.json'))
t = M['time']; o=np.array(M['open']); h=np.array(M['high']); l=np.array(M['low']); c=np.array(M['close'])
ohlc4 = (o+h+l+c)/4
hl2 = (h+l)/2
hlc3 = (h+l+c)/3
N = 33

# TARGETS at anchor: bands shown during June 2026 => window ends May 2026 (confirmed bar)
TGT = (340.90, 301.74, 273.30)

def sma(x, n, end):  # inclusive of index end
    return x[end-n+1:end+1].mean()

def stdev(x, n, end):
    return x[end-n+1:end+1].std(ddof=0)

def ema_arr(x, n):
    a = 2/(n+1); out = np.empty_like(x); out[0]=x[0]
    for i in range(1,len(x)): out[i] = a*x[i] + (1-a)*out[i-1]
    return out

def report(name, up, mid, lo):
    eu = (up/TGT[0]-1)*100; em = (mid/TGT[1]-1)*100; el = (lo/TGT[2]-1)*100
    ok = all(abs(e) <= 2 for e in (eu,em,el))
    print(f"{'PASS' if ok else 'fail'} {name:55s} {up:8.2f} {mid:8.2f} {lo:8.2f}   err% {eu:+6.2f} {em:+6.2f} {el:+6.2f}")

for end_label in ['2026-05-01','2026-04-01','2026-06-01']:
    i = t.index(end_label)
    print(f"\n=== window ending {end_label} (idx {i}) ===")
    mid_o4 = sma(ohlc4, N, i)
    print(f"SMA(ohlc4,33) = {mid_o4:.2f}   [target mid 301.74]")
    # H1: SMA(high), SMA(low)
    sh, sl_ = sma(h,N,i), sma(l,N,i)
    report('H1 SMA(high,33)/SMA(low,33), mid=SMA(ohlc4)', sh, mid_o4, sl_)
    # H1b: mid = SMA(hl2)
    report('H1b SMA(high)/SMA(low), mid=SMA(hl2)', sh, sma(hl2,N,i), sl_)
    # H2: ATR
    tr = np.maximum(h[1:], c[:-1]) - np.minimum(l[1:], c[:-1])
    atr_rma = None
    a = 1/N; r = tr[0]
    rma = [r]
    for x in tr[1:]: r = a*x + (1-a)*r; rma.append(r)
    rma = np.array(rma)  # rma[k] corresponds to month index k+1
    atr = rma[i-1]
    report('H2 mid±1.0*ATR(33) RMA', mid_o4+atr, mid_o4, mid_o4-atr)
    # H2b simple mean TR
    atr_s = tr[i-N:i].mean()
    report('H2b mid±1.0*SMA(TR,33)', mid_o4+atr_s, mid_o4, mid_o4-atr_s)
    # H3: stdev of residuals vs SMA — need rolling SMA series
    smaser = np.array([sma(ohlc4,N,k) if k>=N-1 else np.nan for k in range(len(c))])
    resid = ohlc4 - smaser
    sd_res = np.nanstd(resid[i-N+1:i+1], ddof=0)
    report('H3 mid±1.0*stdev(ohlc4-SMA,33)', mid_o4+sd_res, mid_o4, mid_o4-sd_res)
    # H4: multiplicative stdev of returns
    roc = np.diff(ohlc4)/ohlc4[:-1]
    sd_roc = roc[i-N:i].std(ddof=0)
    report('H4 mid*(1±stdev(roc,33))', mid_o4*(1+sd_roc), mid_o4, mid_o4*(1-sd_roc))
    # raw stdev for reference
    sd_raw = stdev(ohlc4,N,i)
    report('H0 (current code) mid±1.0*stdev(ohlc4,33)', mid_o4+sd_raw, mid_o4, mid_o4-sd_raw)
    # extra: EMA variants of mid
    e = ema_arr(ohlc4, N)
    report('E1 EMA(ohlc4,33) ± via SMA(h)/SMA(l)', sh, e[i], sl_)
    # extra: SMA of close
    report('C1 SMA(high)/SMA(low), mid=SMA(close,33)', sh, sma(c,N,i), sl_)
