"""Weekly closing prices and dividends from Yahoo Finance (.TA tickers) for listed groups.

python3 pipeline/fetch_prices.py -> web/public/data/companies/<id>.price.json
Prices are in agorot, as quoted on TASE. Tickers come from data/registry/companies.json ("yahoo").
"""
import json
import warnings
from pathlib import Path

import yfinance as yf

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "companies"
START = "2015-01-01"

for c in json.loads((ROOT / "data" / "registry" / "companies.json").read_text(encoding="utf-8")):
    if not c.get("yahoo"):
        continue
    t = yf.Ticker(c["yahoo"])
    h = t.history(start=START, auto_adjust=False)["Close"].dropna()
    if h.empty:
        print(c["id"], "no data")
        continue
    w = h.resample("W-THU").last().dropna()
    div = t.dividends
    div = div[div.index >= START]
    out = {"ticker": c["yahoo"], "source": "Yahoo Finance", "unit": "agorot", "asof": str(h.index[-1].date()),
           "last": round(float(h.iloc[-1]), 1),
           "dates": [str(d.date()) for d in w.index], "close": [round(float(v), 1) for v in w.values],
           "dividends": [[str(d.date()), round(float(v), 2)] for d, v in div.items()]}
    (OUT / f"{c['id']}.price.json").write_text(json.dumps(out), encoding="utf-8")
    print(c["id"], c["yahoo"], len(w), "weeks", len(div), "dividends", "last", out["last"], out["asof"])
