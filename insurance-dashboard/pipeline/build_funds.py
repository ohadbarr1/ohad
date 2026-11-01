"""Every savings track the Capital Market Authority publishes, ready to compare: one row per track, live or closed, and its full monthly
history.

python3 pipeline/build_funds.py
  -> web/public/data/funds.json            live tracks (reporting in the latest month), with product and track category
  -> web/public/data/funds/closed.json     every track that stopped reporting (survivorship), same row shape + gone, end, end_assets
  -> web/public/data/funds/<key>.json      monthly history of one track, live or closed (key = g|p|i + FUND_ID)
  -> web/public/data/funds/cat.json        asset-weighted monthly return of each category: point-in-time members (y, n; closed tracks
                                           included, each in the category it had that month), today's members (ys, ns; the old series,
                                           kept one release for comparison) and net of fees (yn, nn)
Sources: Gemel-Net, Pensia-Net, Insurance-Net on data.gov.il (pipeline/fetch_regulator.py); the CMA's register of tracks, transfer_bank
(pipeline/fetch_transfer_bank.py -> data/regulation/transfer_bank.json) for the official track taxonomy; CPI (pipeline/fetch_macro.py ->
data/raw/macro) for real returns. Returns are percent, assets NIS millions. Published returns are GROSS of management fees (the regulator's
own field documentation, docs/FACTS.md); every net figure is an estimate (pipeline/funds_lib.py, funds.json net_method).
"""
import json
import re
import sys
from math import fsum
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_market import group_of  # noqa: E402
import funds_lib as FL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data" / "raw", ROOT / "web" / "public" / "data"
TB = ROOT / "data" / "regulation" / "transfer_bank.json"
PRODUCT = {
    "תגמולים ואישית לפיצויים": "גמל", "קרנות השתלמות": "השתלמות", "קופת גמל להשקעה": "גמל להשקעה",
    "קופת גמל להשקעה - חסכון לילד": "חיסכון לילד", "מרכזית לפיצויים": "מרכזית לפיצויים", "מטרה אחרת": "גמל, מטרה אחרת",
    "קרנות חדשות": "פנסיה מקיפה", "קרנות כלליות": "פנסיה כללית",
    "פוליסות שהונפקו החל משנת 2004": "ביטוח 2004 ואילך: מנהלים וחיסכון", "פוליסות שהונפקו בשנים 1992-2003": "ביטוחי מנהלים 1992-2003",
    "פוליסות שהונפקו בשנים 1990-1991": "ביטוחי מנהלים 1990-1991",
}
# One vocabulary of tracks for the three databases. Gemel-Net states the track (SUB_SPECIALIZATION); the other two only name the fund,
# so the same rules read the name. First match wins. (build_warroom.py reads this list from the source as data: keep it a literal.)
# Bond tracks with a capped equity sleeve ("אג\"ח עד 25% מניות", gemel sub-specialization "משולב מניות") are bond tracks, as the
# regulator's register files their successors ("אשראי ואג\"ח"), not equity tracks; caps of 30-69% are general tracks (F1, 01.11.26).
# Where the regulator's register (transfer_bank) names the track's specialization, that official label wins (funds_lib.official_track).
TRACK = [
    (r"s\s*(&|1;)\s*p|סנופי", "עוקב מדד S&P 500"), (r"עוקב מדדי מניות", "עוקב מדדי מניות"), (r"עוקב מדדי אג", 'עוקב מדדי אג"ח'),
    (r"עוקב מדדים|מחקה מדד", "עוקב מדדים, גמיש"), (r"מניות סחיר", "מניות סחיר"), (r"ללא מניות", "ללא מניות"),
    (r"משולב מניות|אג\"?ח עם מניות|(עד|לכל היותר)\s*(10|15|20|25)\s*%\s*(ב)?מניות", 'אשראי ואג"ח'), (r"עד\s*[3-6]\d\s*%\s*(ב)?מניות", "כללי"), (r"מניות", "מניות"),
    (r"משולב סחיר", "משולב סחיר"), (r'אג"?ח סחיר', 'אג"ח סחיר'), (r"אשראי", 'אשראי ואג"ח'), (r"ממשלות", 'אג"ח ממשלות'),
    (r'אג"?ח', 'אג"ח'), (r"כספי|שקלי|שיקלי", "כספי (שקלי)"), (r"הלכ|איסלאמ|שריעה", "הלכה"), (r"קיימות", "קיימות"),
    (r"סיכון מועט", "חיסכון לילד, סיכון מועט"), (r"סיכון בינוני", "חיסכון לילד, סיכון בינוני"), (r"סיכון גבוה|סיכון מוגבר", "חיסכון לילד, סיכון גבוה"),
    (r"מקבלי קצבה|זכאים קיימים|פנסיונרים", "מקבלי קצבה"), (r"50\s*ומטה|עד\s*50", "עד 50"), (r"50\s*(-|עד)\s*60", "50-60"), (r"60\s*ומעלה", "60 ומעלה"),
    (r"מבטיח תשואה", "מבטיח תשואה"), (r"כללי|קרן [א-ת]'|בסיסי", "כללי"),
]
# Bituach-Net does not say which product a track belongs to. The public comparison sites treat the tracks of policies issued from 2004 as the
# savings-policy universe (a pure savings policy sold today invests in exactly these tracks; managers' insurance issued since 2004 shares them),
# so the return of a track is the return of the savings policy. Tracks that can only belong to managers' insurance are split off:
# annuity-recipient tracks, the participating "קרן י' חדשה" funds, and tracks marked as participating or pre-2004.
MANAGERS_ONLY = re.compile(r"\(משת\)|משתתף ברווחים|לפני 2004|מקבלי קצבה|קרן י' חדשה")
SHARED = "ביטוח 2004 ואילך: מנהלים וחיסכון"
SOURCE = "הרשות לשוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il)"
BASIS = "תשואות נומינליות ברוטו (לפני דמי ניהול), כפי שהרשות מפרסמת; net ו-realn: אומדן נטו"
WINS = ("m1", "ytd", "y12", "a3", "a5")
# Self-directed tracks (IRA, "בניהול אישי", funds_lib.IRA): the saver picks the securities, so the track has no return of its own. Most
# managers report MONTHLY_YIELD = 0.00 and period returns of 0.00 every month (a placeholder, not a return); taken at face value, the net
# estimate then showed -fee for every window (W0, 01.11.26). In these tracks a 0.00 month is "not reported", and a published period
# figure is kept only when every month of its window carries a reported (non-zero) return. Tracks that do report (e.g. Menora IRA) keep
# their figures.
IRA_WIN = (("YEAR_TO_DATE_YIELD", None), ("YIELD_TRAILING_3_YRS", 36), ("AVG_ANNUAL_YIELD_TRAILING_3YRS", 36), ("YIELD_TRAILING_5_YRS", 60),
           ("AVG_ANNUAL_YIELD_TRAILING_5YRS", 60), ("STANDARD_DEVIATION", 36), ("SHARPE_RATIO", 36), ("ALPHA", 36))
_tcache = {}


def track_of(sub, name):
    k = (sub, name)
    if k not in _tcache:
        out = "אחר"
        for text in (sub, name):
            t = "" if text is None or (not isinstance(text, str) and pd.isna(text)) else str(text).lower()
            hit = next((label for rx, label in TRACK if re.search(rx, t)), None)
            if hit:
                out = hit
                break
        _tcache[k] = out
    return _tcache[k]


def txt(x):
    return None if x is None or pd.isna(x) or not str(x).strip() else " ".join(str(x).split())[:60]


def v(x, nd=2):
    return None if x is None or pd.isna(x) else round(float(x), nd)


def num(x):
    return None if x is None or pd.isna(x) else float(x)


def ival(x):
    return None if x is None or pd.isna(x) else int(x)


def product_of(cls, name):
    p = PRODUCT.get(cls, cls) if isinstance(cls, str) else cls
    if p == SHARED:
        return "ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים" if MANAGERS_ONLY.search(str(name)) else "פוליסות חיסכון וביטוחי מנהלים (מ-2004)"  # one bituach-net track pool: savings policies and managers' insurance from 2004 (owner, 01.11.26)
    return p


# ------------------------------------------------------------------------------------------------ inputs
def load_funds():
    frames = []
    for fam, letter in (("gemel", "g"), ("pensia", "p"), ("insurance", "i")):
        d = pd.read_parquet(RAW / f"{fam}.parquet")
        d["fam"], d["key"] = fam, letter + d["FUND_ID"].astype(int).astype(str)
        frames.append(d)
    return pd.concat(frames, ignore_index=True).sort_values(["key", "REPORT_PERIOD"]).reset_index(drop=True)


def blank_ira(d, tb):
    """IRA tracks (name, or the register's type "IRA"): a 0.00 monthly return becomes missing, and a published window figure whose
    window has a missing month becomes missing (funds_lib.IRA). In place; returns the number of tracks touched."""
    reg_ira = {letter + str(t) for (dom, t), r in tb.items() if r.get("type") == "IRA"
               for fam, letter in (("gemel", "g"), ("pensia", "p"), ("insurance", "i")) if FL.DOMAIN[fam] == dom}
    m = d["FUND_NAME"].astype(str).str.contains(FL.IRA) | d["key"].isin(reg_ira)
    d.loc[m & (d["MONTHLY_YIELD"] == 0), "MONTHLY_YIELD"] = np.nan
    cols = [c for c, _ in IRA_WIN if c in d.columns]
    for _, g in d[m].groupby("key"):
        ok = {FL.mi(int(p)) for p, y in zip(g["REPORT_PERIOD"], g["MONTHLY_YIELD"]) if pd.notna(y)}
        for ix, p in zip(g.index, g["REPORT_PERIOD"].astype(int)):
            t = FL.mi(p)
            for c, k in IRA_WIN:
                if c in cols and not all(t - j in ok for j in range(k or p % 100)):
                    d.at[ix, c] = np.nan
    return int(d.loc[m, "key"].nunique())


def load_tb():
    """(domain, track number) -> the register's row; {} when the snapshot is absent (the name rules then decide everywhere)"""
    if not TB.exists():
        return {}, None
    doc = json.loads(TB.read_text(encoding="utf-8"))
    return {(r["dom"], r["track"]): r for r in doc["rows"] if r.get("track") is not None}, doc


def load_cpi():
    """12-month CPI change by month (yyyymm -> percent): the BoI's republication of the CBS index (PRI CP_PCHYTY, unrounded), else
    the CBS API (rounded to 0.1). -> (dict, source label)"""
    b = RAW / "macro" / "boi_cpi_latest.csv"
    if b.exists():
        x = pd.read_csv(b)
        x = x[(x["SERIES_CODE"] == "CP_PCHYTY") & x["OBS_VALUE"].notna()]
        if len(x):
            return ({int(p.replace("-", "")): float(o) for p, o in zip(x["TIME_PERIOD"], x["OBS_VALUE"])},
                    'הלמ"ס, מדד המחירים לצרכן הכללי: השינוי ב-12 חודשים כפי שבנק ישראל מפרסם אותו (PRI, CP_PCHYTY)')
    c = RAW / "macro" / "cbs_cpi_latest.json"
    if c.exists():
        d = json.loads(c.read_text(encoding="utf-8"))
        return ({x["year"] * 100 + x["month"]: x["percentYear"] for x in d["month"][0]["date"] if x.get("percentYear") is not None},
                'הלמ"ס, מדד המחירים לצרכן הכללי (120010): השינוי ב-12 חודשים')
    return {}, None


# ------------------------------------------------------------------------------------------------ per-track monthly panel
class Track:
    """one track's months: gross y, fee (forward-filled per funds_lib), net yn, and the published period returns by month"""

    PUB = ("YEAR_TO_DATE_YIELD", "YIELD_TRAILING_3_YRS", "YIELD_TRAILING_5_YRS", "AVG_ANNUAL_YIELD_TRAILING_3YRS", "AVG_ANNUAL_YIELD_TRAILING_5YRS")

    def __init__(self, g):
        self.p = g["REPORT_PERIOD"].astype(int).tolist()
        self.ix = {FL.mi(p): i for i, p in enumerate(self.p)}
        self.y = [num(x) for x in g["MONTHLY_YIELD"]]
        self.fee_raw = [num(x) for x in g["AVG_ANNUAL_MANAGEMENT_FEE"]]
        self.fee = FL.fill_fee(self.fee_raw)
        self.yn = [FL.net_month(a, b) for a, b in zip(self.y, self.fee)]
        self.pub = {c: [num(x) for x in g[c]] for c in self.PUB}
        self.a = [num(x) for x in g["TOTAL_ASSETS"]]
        self.nd = [num(x) for x in g["NET_MONTHLY_DEPOSITS"]] if "NET_MONTHLY_DEPOSITS" in g else None
        self.act = [num(x) for x in g["ACTUARIAL_ADJUSTMENT"]] if "ACTUARIAL_ADJUSTMENT" in g else None

    def idx(self, T, k):
        """row indices of the k months ending T, or None when one is absent"""
        t = FL.mi(T)
        ix = [self.ix.get(t - j) for j in range(k - 1, -1, -1)]
        return None if any(i is None for i in ix) else ix

    def at(self, T):
        """(gross, net, row index) of the windows that end in month T: gross as published (y12 compounded from the 12 monthly returns),
        net per funds_lib"""
        i = self.ix.get(FL.mi(T))
        if i is None:
            return None
        P = {c: xs[i] for c, xs in self.pub.items()}
        g = {"m1": self.y[i], "ytd": P["YEAR_TO_DATE_YIELD"], "y3": P["YIELD_TRAILING_3_YRS"], "y5": P["YIELD_TRAILING_5_YRS"],
             "a3": P["AVG_ANNUAL_YIELD_TRAILING_3YRS"], "a5": P["AVG_ANNUAL_YIELD_TRAILING_5YRS"]}
        ix = self.idx(T, 12)
        g["y12"] = FL.compound([self.y[j] for j in ix]) if ix else None
        n = {"m1": self.yn[i], "y12": FL.compound([self.yn[j] for j in ix]) if ix else None}
        ix = self.idx(T, T % 100)
        n["ytd"] = FL.net_period(g["ytd"], [self.y[j] for j in ix], [self.yn[j] for j in ix]) if ix else None
        for yrs in (3, 5):
            ix = self.idx(T, 12 * yrs)
            n[f"y{yrs}"] = FL.net_period(g[f"y{yrs}"], [self.y[j] for j in ix], [self.yn[j] for j in ix]) if ix else None
            n[f"a{yrs}"] = FL.annualise(n[f"y{yrs}"], yrs)
        return g, n, i


def rank(rows, wins):
    """rows: [(key, category, {window: value})] -> {key: {window: (percentile, n)}}"""
    by, out = {}, {}
    for k, c, vals in rows:
        by.setdefault(c, []).append((k, vals))
    for xs in by.values():
        for w in wins:
            for kk, pn in FL.percentiles([(k, vals.get(w)) for k, vals in xs]).items():
                out.setdefault(kk, {})[w] = pn
    return out


# ------------------------------------------------------------------------------------------------ build
def main():
    d = load_funds()
    latest = int(d["REPORT_PERIOD"].max())
    prev = FL.madd(latest, -1)
    tb, tb_doc = load_tb()
    cpi, cpi_src = load_cpi()
    n_ira = blank_ira(d, tb)

    # point-in-time attributes of every row: product, track, category as that month's row says (closed tracks included). A track the
    # regulator's register names gets its official label in every month (the register is current; the label is the track's own).
    d["prod"] = [product_of(c, n) for c, n in zip(d["FUND_CLASSIFICATION"], d["FUND_NAME"].astype(str))]
    sub = d["SUB_SPECIALIZATION"].where(d["SUB_SPECIALIZATION"].notna(), None)
    d["track_nm"] = [track_of(s if isinstance(s, str) else None, n) for s, n in zip(sub, d["FUND_NAME"].astype(str))]
    off = {}
    for key, fam, fid in d[["key", "fam", "FUND_ID"]].drop_duplicates("key").itertuples(index=False):
        r = tb.get((FL.DOMAIN[fam], int(fid)))
        if r:
            off[key] = (r, FL.official_track(r.get("spec"), r.get("sub"), track_of))
    d["track"] = [off[k][1] if k in off and off[k][1] else t for k, t in zip(d["key"], d["track_nm"])]
    d["cat"] = d["prod"] + " | " + d["track"]

    cur = d[d["REPORT_PERIOD"] == latest].copy()
    live = set(cur["key"])
    closed_keys = sorted(set(d["key"]) - live)

    # histories: every track, live or closed
    (OUT / "funds").mkdir(parents=True, exist_ok=True)
    for old in (OUT / "funds").glob("*.json"):  # the track histories only: funds/<F2 analytics>.json belong to build_fund_stats.py
        if re.fullmatch(r"[gpi]\d+\.json", old.name):
            old.unlink()
    months, tracks = {}, {}
    for key, g in d.groupby("key", sort=True):
        tr = Track(g)
        tracks[key] = tr
        a = g["TOTAL_ASSETS"].replace(0, np.nan)
        rec = {"p": tr.p, "y": [v(x) for x in g["MONTHLY_YIELD"]], "a": [v(x, 1) for x in g["TOTAL_ASSETS"]],
               "fee": [v(x) for x in g["AVG_ANNUAL_MANAGEMENT_FEE"]], "st": [v(x, 1) for x in g["STOCK_MARKET_EXPOSURE"] / a * 100],
               "fo": [v(x, 1) for x in g["FOREIGN_EXPOSURE"] / a * 100], "fx": [v(x, 1) for x in g["FOREIGN_CURRENCY_EXPOSURE"] / a * 100]}
        if key[0] != "i":  # Insurance-Net carries no flows
            rec.update(dep=[v(x, 1) for x in g["DEPOSITS"]], wd=[v(x, 1) for x in g["WITHDRAWLS"]], tr=[v(x, 1) for x in g["INTERNAL_TRANSFERS"]],
                       nd=[v(x, 1) for x in g["NET_MONTHLY_DEPOSITS"]])
        if key[0] == "p":  # pensia-net: the actuarial adjustment, reported once a quarter (percent)
            rec["act"] = [v(x) for x in g["ACTUARIAL_ADJUSTMENT"]]
        rec["yn"] = [FL.rnd(x, 3) for x in tr.yn]
        ct = []
        for p, c in zip(tr.p, g["cat"]):
            if not ct or ct[-1][1] != c:
                ct.append([p, c])
        rec["ct"] = ct
        (OUT / "funds" / f"{key}.json").write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        months[key] = int(g["MONTHLY_YIELD"].notna().sum())

    # trailing twelve months, compounded from the monthly returns, only when all twelve are published
    hist = d[d["key"].isin(live)]
    last12 = hist[hist["REPORT_PERIOD"] > latest - 100].pivot_table(index="key", columns="REPORT_PERIOD", values="MONTHLY_YIELD")
    y12 = (1 + last12.dropna() / 100).prod(axis=1).sub(1).mul(100) if last12.shape[1] == 12 else pd.Series(dtype=float)

    # consistency: in how many of the last five full calendar years the track finished in the top quarter of its category
    yr = hist[hist["MONTHLY_YIELD"].notna()].assign(y=lambda x: x["REPORT_PERIOD"] // 100)
    ann = yr.groupby(["key", "y"])["MONTHLY_YIELD"].agg(n="count", r=lambda v_: (1 + v_ / 100).prod() - 1).reset_index()
    ann = ann[(ann["n"] == 12) & (ann["y"] >= latest // 100 - 5) & (ann["y"] < latest // 100)].merge(cur[["key", "cat"]], on="key")
    ann["rk"] = ann.groupby(["cat", "y"])["r"].rank(ascending=False, method="min")
    ann["of"] = ann.groupby(["cat", "y"])["r"].transform("count")
    ann["top"] = (ann["of"] >= 4) & (ann["rk"] <= np.ceil(ann["of"] / 4))
    cons = ann[ann["of"] >= 4].groupby("key").agg(top=("top", "sum"), yrs=("y", "count"))

    def yoys(T, yrs):
        return [cpi.get(FL.madd(T, -12 * j)) for j in range(yrs)]

    def row_of(r, T, st, fo, fx, closed=False):
        """the published row of a track in month T, then its derived fields (the original fields first, in their original order)"""
        mgr = next((x for x in (getattr(r, "MANAGING_CORPORATION", None), getattr(r, "PARENT_COMPANY_NAME", None)) if isinstance(x, str)), "")
        target = getattr(r, "TARGET_POPULATION", None)
        tr = tracks[r.key]
        g, n, i = tr.at(T)
        f = {"k": r.key, "fam": r.fam, "prod": r.prod, "track": r.track, "name": " ".join(str(r.FUND_NAME).replace("1;", "&").split()), "mgr": " ".join(mgr.split()),
             "grp": group_of(" ".join(mgr.split())), "assets": v(r.TOTAL_ASSETS, 1), "fee": v(r.AVG_ANNUAL_MANAGEMENT_FEE), "depfee": v(r.AVG_DEPOSIT_FEE),
             "m1": v(r.MONTHLY_YIELD), "ytd": v(r.YEAR_TO_DATE_YIELD), "y12": FL.rnd(g["y12"]) if closed else v(y12.get(r.key, np.nan)),
             "y3": v(r.YIELD_TRAILING_3_YRS), "y5": v(r.YIELD_TRAILING_5_YRS),
             "a3": v(r.AVG_ANNUAL_YIELD_TRAILING_3YRS), "a5": v(r.AVG_ANNUAL_YIELD_TRAILING_5YRS), "sd": v(r.STANDARD_DEVIATION), "sharpe": v(r.SHARPE_RATIO),
             "st": v(st, 1), "fo": v(fo, 1), "fx": v(fx, 1), "n": months.get(r.key, 0),
             "top": None if closed or r.key not in cons.index else int(cons["top"].get(r.key, 0)),
             "yrs": None if closed or r.key not in cons.index else int(cons["yrs"].get(r.key, 0)),
             "closed": bool(isinstance(target, str) and target != "כלל האוכלוסיה"),
             # as the regulator describes the track
             "id": int(r.FUND_ID), "spec": txt(getattr(r, "SPECIALIZATION", None)), "sub": txt(getattr(r, "SUB_SPECIALIZATION", None)), "target": txt(target),
             "since": txt(getattr(r, "INCEPTION_DATE", None)), "ctrl": txt(getattr(r, "CONTROLLING_CORPORATION", None)), "liq": v(r.LIQUID_ASSETS_PERCENT, 1), "cls": txt(r.FUND_CLASSIFICATION)}
        # --- F1 additions (all optional; schemas.json `fundRow`)
        net = {k: FL.rnd(n.get(k)) for k in ("m1", "ytd", "y12", "y3", "y5", "a3", "a5")}
        f["net"] = {k: x for k, x in net.items() if x is not None}
        rl = {"y12": FL.real(f["y12"], yoys(T, 1)), "a3": FL.real_ann(f["a3"], yoys(T, 3)), "a5": FL.real_ann(f["a5"], yoys(T, 5))}
        rn = {"y12": FL.real(net["y12"], yoys(T, 1)), "a3": FL.real_ann(net["a3"], yoys(T, 3)), "a5": FL.real_ann(net["a5"], yoys(T, 5))}
        f["real"] = {k: FL.rnd(x) for k, x in rl.items() if x is not None}
        f["realn"] = {k: FL.rnd(x) for k, x in rn.items() if x is not None}
        opt = {"alpha": v(getattr(r, "ALPHA", None)),
               "fee1": v(tr.fee_raw[i - 1]) if i > 0 and tr.p[i - 1] == FL.madd(T, -1) else None,
               "nd": v(getattr(r, "NET_MONTHLY_DEPOSITS", None), 1),
               "mgr_id": ival(getattr(r, "PARENT_COMPANY_LEGAL_ID", None) if r.fam == "insurance" else getattr(r, "MANAGING_CORPORATION_LEGAL_ID", None)),
               "pid": None if r.fam == "gemel" else ival(getattr(r, "PARENT_COMPANY_ID", None))}
        if tr.nd is not None:
            ix = tr.idx(T, 12)
            xs = [tr.nd[j] for j in ix] if ix else None
            opt["nd12"] = round(fsum(xs), 1) if xs and all(x is not None for x in xs) else None
        if tr.act is not None:
            j = next((j for j in range(i, -1, -1) if tr.act[j] is not None and tr.p[j] > FL.madd(T, -4)), None)
            if j is not None:
                opt["act"], opt["act_p"] = round(tr.act[j], 2), tr.p[j]
                # W2: the last 8 reported quarters up to month T, oldest first, [[yyyymm, percent], ...]: the same values as the track
                # history (funds/<key>.json `act`), inline so the agent's fund card needs no second fetch
                h = [[tr.p[k], round(tr.act[k], 2)] for k in range(j + 1) if tr.act[k] is not None]
                opt["act_h"] = h[-8:] or None
        f.update({k: x for k, x in opt.items() if x is not None})
        o = off.get(r.key)
        if o:
            reg, lab = o
            tx = {"src": "tb" if lab else "name", "type": reg.get("type"), "spec": reg.get("spec"), "sub": reg.get("sub"),
                  "fund": reg.get("fund"), "op": reg.get("op")}
            if lab and lab != r.track_nm:
                tx["dis"], tx["nm"] = True, r.track_nm
        else:
            tx = {"src": "name"}
        f["tx"] = {k: x for k, x in tx.items() if x is not None}
        return f

    funds = []
    ca = cur["TOTAL_ASSETS"].replace(0, np.nan)
    for r, st, fo, fx in zip(cur.itertuples(index=False), cur["STOCK_MARKET_EXPOSURE"] / ca * 100, cur["FOREIGN_EXPOSURE"] / ca * 100, cur["FOREIGN_CURRENCY_EXPOSURE"] / ca * 100):
        funds.append(row_of(r, latest, st, fo, fx))
    funds.sort(key=lambda f: -(f["assets"] or 0))

    # percentiles in category: this month (live tracks, today's category) and last month (the members as they were then)
    rows_g = [(f["k"], f["prod"] + " | " + f["track"], {w: f[w] for w in WINS}) for f in funds if (f["assets"] or 0) > 0]
    rows_n = [(f["k"], f["prod"] + " | " + f["track"], f["net"]) for f in funds if (f["assets"] or 0) > 0]
    now_g, now_n = rank(rows_g, WINS), rank(rows_n, WINS)
    pv = d[(d["REPORT_PERIOD"] == prev) & (d["TOTAL_ASSETS"] > 0)]
    rows_pg, rows_pn = [], []
    for k, c in zip(pv["key"], pv["cat"]):
        g, n, _ = tracks[k].at(prev)
        rows_pg.append((k, c, {"y12": FL.rnd(g["y12"]), "a3": FL.rnd(g["a3"])}))
        rows_pn.append((k, c, {"y12": FL.rnd(n["y12"]), "a3": FL.rnd(n["a3"])}))
    prev_g, prev_n = rank(rows_pg, ("y12", "a3")), rank(rows_pn, ("y12", "a3"))
    for f in funds:
        k = f["k"]
        for name, src in (("pr", now_g), ("pn", now_n)):
            if src.get(k):
                f[name] = {w: p for w, (p, _) in src[k].items()}
                f[name + "n"] = {w: m for w, (_, m) in src[k].items()}
        for name, src in (("pr1", prev_g), ("pn1", prev_n)):
            if src.get(k):
                f[name] = {w: p for w, (p, _) in src[k].items()}

    # closed tracks: the row of their last month, with that month's figures
    closed = []
    lr = d.groupby("key").tail(1)
    lr = lr[lr["key"].isin(closed_keys)]
    for r in lr.itertuples(index=False):
        T = int(r.REPORT_PERIOD)
        a = r.TOTAL_ASSETS if r.TOTAL_ASSETS and r.TOTAL_ASSETS > 0 else np.nan
        f = row_of(r, T, r.STOCK_MARKET_EXPOSURE / a * 100, r.FOREIGN_EXPOSURE / a * 100, r.FOREIGN_CURRENCY_EXPOSURE / a * 100, closed=True)
        tr = tracks[r.key]
        pos = [(p, x) for p, x in zip(tr.p, tr.a) if x is not None and x > 0]
        f["gone"], f["end"] = True, T
        if pos:
            f["end_assets"], f["end_ap"] = round(pos[-1][1], 1), pos[-1][0]
        closed.append(f)
    closed.sort(key=lambda f: (-f["end"], -(f.get("end_assets") or 0), f["k"]))

    # category returns, asset-weighted by each month's assets. y/n: point-in-time members (closed tracks included, each in the category
    # of that month); ys/ns: today's members only, the old series (one release, for comparison); yn/nn: net of fees (estimate)
    def agg(frame, col):
        h = frame[frame[col].notna() & (frame["TOTAL_ASSETS"] > 0)].copy()
        h["w"] = h[col] * h["TOTAL_ASSETS"]
        return h.groupby(["cat", "REPORT_PERIOD"]).agg(w=("w", "sum"), a=("TOTAL_ASSETS", "sum"), n=("key", "count")).reset_index()

    yn = []
    for k in sorted(tracks):
        yn.extend(tracks[k].yn)
    d["YN"] = np.array([np.nan if x is None else x for x in yn], dtype="float64")
    pit = agg(d, "MONTHLY_YIELD")
    surv = agg(d[d["key"].isin(live)].drop(columns="cat").merge(cur[["key", "cat"]], on="key"), "MONTHLY_YIELD")
    net = agg(d, "YN")
    cats = {}
    for c, g in pit.groupby("cat"):
        P = g["REPORT_PERIOD"].astype(int).tolist()
        rec = {"p": P, "y": [round(x, 3) for x in g["w"] / g["a"]], "n": g["n"].astype(int).tolist()}
        s = surv[surv["cat"] == c].set_index("REPORT_PERIOD")
        if len(s):
            rec["ys"] = [round(s.at[p, "w"] / s.at[p, "a"], 3) if p in s.index else None for p in P]
            rec["ns"] = [int(s.at[p, "n"]) if p in s.index else 0 for p in P]
        nn = net[net["cat"] == c].set_index("REPORT_PERIOD")
        rec["yn"] = [round(nn.at[p, "w"] / nn.at[p, "a"], 3) if p in nn.index else None for p in P]
        rec["nn"] = [int(nn.at[p, "n"]) if p in nn.index else 0 for p in P]
        cats[c] = rec
    (OUT / "funds" / "cat.json").write_text(json.dumps(cats, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    tx = {"live": len(funds), "joined": sum(1 for f in funds if "type" in f["tx"] or "spec" in f["tx"] or "fund" in f["tx"]),
          "mapped": sum(1 for f in funds if f["tx"]["src"] == "tb"), "dis": sum(1 for f in funds if f["tx"].get("dis")), "method": FL.TX_METHOD}
    if tb_doc:
        tx.update(source=tb_doc["source"], url=tb_doc["url"], modified=tb_doc.get("modified"), fetched=tb_doc.get("fetched"))
    doc = {"asof": latest, "source": SOURCE, "funds": funds, "basis": BASIS, "net_method": FL.NET_METHOD, "real_method": FL.REAL_METHOD,
           "cpi_asof": max(cpi) if cpi else None, "cpi_src": cpi_src, "pr_method": FL.PR_METHOD, "closed_n": len(closed), "tx": tx}
    (OUT / "funds.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "funds" / "closed.json").write_text(json.dumps({"asof": latest, "source": SOURCE, "basis": BASIS, "n": len(closed), "funds": closed},
                                                          ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(latest, len(funds), "live tracks;", len(closed), "closed;", len(cats), "categories;", cur.groupby("prod")["key"].count().to_dict())
    print("taxonomy:", {k: x for k, x in tx.items() if k in ("live", "joined", "mapped", "dis")})
    print("net:", sum(1 for f in funds if "y12" in f["net"]), "of", len(funds), "with net y12;", sum(1 for f in funds if "a5" in f["net"]), "with net a5;",
          "real y12:", sum(1 for f in funds if "y12" in f["real"]))
    print("track 'אחר':", int((cur["track"] == "אחר").sum()), "; IRA tracks (0.00 months read as not reported):", n_ira)


if __name__ == "__main__":
    main()
