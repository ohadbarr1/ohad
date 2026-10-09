"""Every savings track the Capital Market Authority publishes, ready to compare: one row per active track and its full monthly history.

python3 pipeline/build_funds.py
  -> web/public/data/funds.json            active tracks, latest month, with product and track category
  -> web/public/data/funds/<key>.json      monthly history of one track (key = g|p|i + FUND_ID)
  -> web/public/data/funds/cat.json        asset-weighted monthly return of each category (today's members)
Source: Gemel-Net, Pensia-Net, Insurance-Net on data.gov.il (pipeline/fetch_regulator.py). Returns are percent, assets NIS millions.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_market import group_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data" / "raw", ROOT / "web" / "public" / "data"
PRODUCT = {
    "תגמולים ואישית לפיצויים": "גמל", "קרנות השתלמות": "השתלמות", "קופת גמל להשקעה": "גמל להשקעה",
    "קופת גמל להשקעה - חסכון לילד": "חיסכון לילד", "מרכזית לפיצויים": "מרכזית לפיצויים", "מטרה אחרת": "גמל, מטרה אחרת",
    "קרנות חדשות": "פנסיה מקיפה", "קרנות כלליות": "פנסיה כללית",
    "פוליסות שהונפקו החל משנת 2004": "פוליסות חיסכון, 2004 ואילך", "פוליסות שהונפקו בשנים 1992-2003": "פוליסות 1992-2003",
    "פוליסות שהונפקו בשנים 1990-1991": "פוליסות 1990-1991",
}
# One vocabulary of tracks for the three databases. Gemel-Net states the track (SUB_SPECIALIZATION); the other two only name the fund,
# so the same rules read the name. First match wins.
TRACK = [
    (r"s\s*(&|1;)\s*p|סנופי", "עוקב מדד S&P 500"), (r"עוקב מדדי מניות", "עוקב מדדי מניות"), (r"עוקב מדדי אג", 'עוקב מדדי אג"ח'),
    (r"עוקב מדדים|מחקה מדד", "עוקב מדדים, גמיש"), (r"מניות סחיר", "מניות סחיר"), (r"ללא מניות", "ללא מניות"), (r"מניות", "מניות"),
    (r"משולב סחיר", "משולב סחיר"), (r'אג"?ח סחיר', 'אג"ח סחיר'), (r"אשראי", 'אשראי ואג"ח'), (r"ממשלות", 'אג"ח ממשלות'),
    (r'אג"?ח', 'אג"ח'), (r"כספי|שקלי|שיקלי", "כספי (שקלי)"), (r"הלכ|איסלאמ|שריעה", "הלכה"), (r"קיימות", "קיימות"),
    (r"סיכון מועט", "חיסכון לילד, סיכון מועט"), (r"סיכון בינוני", "חיסכון לילד, סיכון בינוני"), (r"סיכון גבוה|סיכון מוגבר", "חיסכון לילד, סיכון גבוה"),
    (r"מקבלי קצבה|זכאים קיימים|פנסיונרים", "מקבלי קצבה"), (r"50\s*ומטה|עד\s*50", "עד 50"), (r"50\s*(-|עד)\s*60", "50-60"), (r"60\s*ומעלה", "60 ומעלה"),
    (r"מבטיח תשואה", "מבטיח תשואה"), (r"כללי|קרן [א-ת]'|בסיסי", "כללי"),
]


def track_of(sub, name):
    for text in (sub, name):
        t = "" if text is None or pd.isna(text) else str(text).lower()
        for rx, label in TRACK:
            if re.search(rx, t):
                return label
    return "אחר"


def v(x, nd=2):
    return None if x is None or pd.isna(x) else round(float(x), nd)


frames = []
for fam, letter in (("gemel", "g"), ("pensia", "p"), ("insurance", "i")):
    d = pd.read_parquet(RAW / f"{fam}.parquet")
    d["fam"], d["key"] = fam, letter + d["FUND_ID"].astype(int).astype(str)
    frames.append(d)
d = pd.concat(frames, ignore_index=True).sort_values(["key", "REPORT_PERIOD"])
latest = int(d["REPORT_PERIOD"].max())
cur = d[d["REPORT_PERIOD"] == latest].copy()
cur["prod"] = cur["FUND_CLASSIFICATION"].map(PRODUCT).fillna(cur["FUND_CLASSIFICATION"])
cur["track"] = [track_of(s, n) for s, n in zip(cur.get("SUB_SPECIALIZATION"), cur["FUND_NAME"])]
cur["cat"] = cur["prod"] + " | " + cur["track"]
hist = d[d["key"].isin(cur["key"])]

(OUT / "funds").mkdir(parents=True, exist_ok=True)
for old in (OUT / "funds").glob("*.json"):
    old.unlink()
months = {}
for key, g in hist.groupby("key"):
    a = g["TOTAL_ASSETS"].replace(0, np.nan)
    rec = {"p": g["REPORT_PERIOD"].astype(int).tolist(), "y": [v(x) for x in g["MONTHLY_YIELD"]], "a": [v(x, 1) for x in g["TOTAL_ASSETS"]],
           "fee": [v(x) for x in g["AVG_ANNUAL_MANAGEMENT_FEE"]], "st": [v(x, 1) for x in g["STOCK_MARKET_EXPOSURE"] / a * 100],
           "fo": [v(x, 1) for x in g["FOREIGN_EXPOSURE"] / a * 100], "fx": [v(x, 1) for x in g["FOREIGN_CURRENCY_EXPOSURE"] / a * 100]}
    if key[0] != "i":  # Insurance-Net carries no flows
        rec.update(dep=[v(x, 1) for x in g["DEPOSITS"]], wd=[v(x, 1) for x in g["WITHDRAWLS"]], tr=[v(x, 1) for x in g["INTERNAL_TRANSFERS"]])
    (OUT / "funds" / f"{key}.json").write_text(json.dumps(rec, separators=(",", ":")), encoding="utf-8")
    months[key] = int(g["MONTHLY_YIELD"].notna().sum())

# trailing twelve months, compounded from the monthly returns, only when all twelve are published
last12 = hist[hist["REPORT_PERIOD"] > latest - 100].pivot_table(index="key", columns="REPORT_PERIOD", values="MONTHLY_YIELD")
y12 = (1 + last12.dropna() / 100).prod(axis=1).sub(1).mul(100) if last12.shape[1] == 12 else pd.Series(dtype=float)

funds = []
ca = cur["TOTAL_ASSETS"].replace(0, np.nan)
for r, st, fo, fx in zip(cur.itertuples(index=False), cur["STOCK_MARKET_EXPOSURE"] / ca * 100, cur["FOREIGN_EXPOSURE"] / ca * 100, cur["FOREIGN_CURRENCY_EXPOSURE"] / ca * 100):
    mgr = next((x for x in (getattr(r, "MANAGING_CORPORATION", None), getattr(r, "PARENT_COMPANY_NAME", None)) if isinstance(x, str)), "")
    target = getattr(r, "TARGET_POPULATION", None)
    funds.append({"k": r.key, "fam": r.fam, "prod": r.prod, "track": r.track, "name": " ".join(str(r.FUND_NAME).replace("1;", "&").split()), "mgr": " ".join(mgr.split()),
                  "grp": group_of(" ".join(str(r.FUND_NAME).split())), "assets": v(r.TOTAL_ASSETS, 1), "fee": v(r.AVG_ANNUAL_MANAGEMENT_FEE), "depfee": v(r.AVG_DEPOSIT_FEE),
                  "m1": v(r.MONTHLY_YIELD), "ytd": v(r.YEAR_TO_DATE_YIELD), "y12": v(y12.get(r.key, np.nan)), "y3": v(r.YIELD_TRAILING_3_YRS), "y5": v(r.YIELD_TRAILING_5_YRS),
                  "a3": v(r.AVG_ANNUAL_YIELD_TRAILING_3YRS), "a5": v(r.AVG_ANNUAL_YIELD_TRAILING_5YRS), "sd": v(r.STANDARD_DEVIATION), "sharpe": v(r.SHARPE_RATIO),
                  "st": v(st, 1), "fo": v(fo, 1), "fx": v(fx, 1), "n": months.get(r.key, 0),
                  "closed": bool(isinstance(target, str) and target != "כלל האוכלוסיה")})
funds.sort(key=lambda f: -(f["assets"] or 0))

# category return: today's members, weighted by each month's assets
h = hist.merge(cur[["key", "cat"]], on="key")
h = h[h["MONTHLY_YIELD"].notna() & (h["TOTAL_ASSETS"] > 0)]
h["w"] = h["MONTHLY_YIELD"] * h["TOTAL_ASSETS"]
agg = h.groupby(["cat", "REPORT_PERIOD"]).agg(w=("w", "sum"), a=("TOTAL_ASSETS", "sum"), n=("key", "count")).reset_index()
cats = {c: {"p": g["REPORT_PERIOD"].astype(int).tolist(), "y": [round(x, 3) for x in g["w"] / g["a"]], "n": g["n"].astype(int).tolist()} for c, g in agg.groupby("cat")}
(OUT / "funds" / "cat.json").write_text(json.dumps(cats, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(OUT / "funds.json").write_text(json.dumps({"asof": latest, "source": "הרשות לשוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il)", "funds": funds}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
tally = cur.groupby("prod")["key"].count().to_dict()
print(latest, len(funds), "tracks;", len(cats), "categories;", tally)
print("track 'אחר':", int((cur["track"] == "אחר").sum()), cur[cur["track"] == "אחר"]["FUND_NAME"].head(12).tolist())
print(cur.groupby("track")["key"].count().sort_values(ascending=False).head(30).to_dict())
