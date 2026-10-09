"""Build the pension / gemel / insurance-policy market dataset for the site.

Input : data/raw/{gemel,pensia,insurance}.parquet   (python3 pipeline/fetch_regulator.py)
Output: data/market.json                              (aggregates + latest fund snapshot + QA report)

Units: assets and flows are NIS millions as published by the Capital Market Authority; yields and fees are %.
Aggregation grain: month x product x group. Ratios are stored as numerator/denominator pairs so the site can
re-aggregate any selection correctly (asset-weighted fee, compounded asset-weighted return).
"""
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "market.json"
WEB_OUT = ROOT / "web" / "public" / "data" / "market.json"
START = 201201  # pension-net starts 2011-10; first full year for all products

PRODUCTS = [  # key, label, family, source classification
    ("pension_new", "פנסיה: קרנות חדשות", "pension", "קרנות חדשות"),
    ("pension_general", "פנסיה: קרנות כלליות", "pension", "קרנות כלליות"),
    ("gemel", "קופות גמל (תגמולים ואישית לפיצויים)", "gemel", "תגמולים ואישית לפיצויים"),
    ("hishtalmut", "קרנות השתלמות", "gemel", "קרנות השתלמות"),
    ("gemel_invest", "גמל להשקעה", "gemel", "קופת גמל להשקעה"),
    ("gemel_child", "גמל להשקעה: חיסכון לילד", "gemel", "קופת גמל להשקעה - חסכון לילד"),
    ("severance", "מרכזית לפיצויים", "gemel", "מרכזית לפיצויים"),
    ("other_purpose", "גמל למטרה אחרת", "gemel", "מטרה אחרת"),
    ("policy_2004", "ביטוח מ-2004: מנהלים וחיסכון", "insurance", "פוליסות שהונפקו החל משנת 2004"),
    ("policy_1992", "ביטוחי מנהלים: 1992-2003", "insurance", "פוליסות שהונפקו בשנים 1992-2003"),
    ("policy_1990", "ביטוחי מנהלים: 1990-1991", "insurance", "פוליסות שהונפקו בשנים 1990-1991"),
]
FAMILY_LABEL = {"pension": "פנסיה", "gemel": "גמל והשתלמות", "insurance": "ביטוחי מנהלים ופוליסות חיסכון (ביטוח-נט)"}

# Managing corporation / insurer name prefix -> group. Order matters (first match wins).
# Pro-forma: Psagot (49.8bn) and Helman-Aldubi (18.4bn) vanish in Oct-2021 while Altshuler Shaham (+49.8bn) and
# Phoenix (+22.3bn) step up by the same amounts, so both are mapped to the successor for the whole history.
GROUP_RULES = [
    ("מיטב", "מיטב"), ("מור גמל", "מור"), ("הפניקס", "הפניקס"), ("אלטשולר", "אלטשולר שחם"), ("הראל", "הראל"),
    ("אנליסט", "אנליסט"), ("כלל ", "כלל"), ("ילין", "ילין לפידות"), ("מנורה", "מנורה מבטחים"), ("מגדל", "מגדל"),
    ("אינפיניטי", "אינפיניטי"), ("גלובלנט", "גלובלנט"), ("איילון", "איילון"), ("פסגות", "אלטשולר שחם"), ("הלמן", "הפניקס"), ("הכשרה", "הכשרה"), ("ישיר", "ביטוח ישיר"), ("איי. די. איי", "ביטוח ישיר"),
]
OTHER = "קרנות ענפיות ואחרות"


def group_of(name):
    n = (name or "").strip()
    for prefix, g in GROUP_RULES:
        if n.startswith(prefix):
            return g
    return OTHER


def month_index(period):
    return (period // 100) * 12 + (period % 100) - 1


def parse_year(v):
    """INCEPTION_DATE arrives as Excel serial, dd/mm/yyyy or ISO text depending on the year of the file."""
    if v is None or pd.isna(v):
        return np.nan
    s = str(v).strip()
    try:
        if s.isdigit():
            return (dt.date(1899, 12, 30) + dt.timedelta(days=int(s))).year
        if "/" in s:
            return int(s.split("/")[-1][:4])
        return int(s[:4])
    except Exception:  # noqa: BLE001
        return np.nan


def load():
    frames = []
    for family, fname, parent, mgr in [("gemel", "gemel", None, "MANAGING_CORPORATION"),
                                       ("pension", "pensia", None, "MANAGING_CORPORATION"),
                                       ("insurance", "insurance", None, "PARENT_COMPANY_NAME")]:
        d = pd.read_parquet(RAW / f"{fname}.parquet")
        d["family"] = family
        d["manager"] = d[mgr]
        for c in ["DEPOSITS", "WITHDRAWLS", "INTERNAL_TRANSFERS", "NET_MONTHLY_DEPOSITS"]:
            if c not in d:
                d[c] = np.nan
        for c in ["TARGET_POPULATION", "SPECIALIZATION", "INCEPTION_DATE"]:
            if c not in d:
                d[c] = pd.NA
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    key = {p[3]: p[0] for p in PRODUCTS}
    df["product"] = df["FUND_CLASSIFICATION"].map(key)
    unknown = df[df["product"].isna()]["FUND_CLASSIFICATION"].unique().tolist()
    assert not unknown, f"unmapped classifications: {unknown}"
    df["group"] = df["manager"].map(group_of)
    df["m"] = df["REPORT_PERIOD"].map(month_index)
    df = df[df["TOTAL_ASSETS"].notna()].copy()
    return df


def add_prev_assets(df):
    """Assets of the same fund in the previous calendar month (weight for the monthly return)."""
    df = df.sort_values(["family", "FUND_ID", "m"]).copy()
    g = df.groupby(["family", "FUND_ID"], sort=False)
    prev_m = g["m"].shift(1)
    prev_a = g["TOTAL_ASSETS"].shift(1)
    df["prev_assets"] = np.where(prev_m == df["m"] - 1, prev_a, np.nan)
    return df


def aggregate(df):
    d = df[df["REPORT_PERIOD"] >= START].copy()
    d["has_fee"] = d["AVG_ANNUAL_MANAGEMENT_FEE"].notna()
    d["fee_num"] = np.where(d.has_fee, d["TOTAL_ASSETS"] * d["AVG_ANNUAL_MANAGEMENT_FEE"], 0.0)
    d["fee_den"] = np.where(d.has_fee, d["TOTAL_ASSETS"], 0.0)
    ok = d["MONTHLY_YIELD"].notna() & d["prev_assets"].notna() & (d["prev_assets"] > 0)
    d["y_num"] = np.where(ok, d["prev_assets"] * d["MONTHLY_YIELD"], 0.0)
    d["y_den"] = np.where(ok, d["prev_assets"], 0.0)
    d["flow_ok"] = d["DEPOSITS"].notna()
    for c in ["DEPOSITS", "WITHDRAWLS", "INTERNAL_TRANSFERS"]:
        d[c + "_f"] = d[c].fillna(0.0)
    d["flow_assets"] = np.where(d.flow_ok, d["TOTAL_ASSETS"], 0.0)
    agg = d.groupby(["REPORT_PERIOD", "product", "group"], as_index=False).agg(
        assets=("TOTAL_ASSETS", "sum"), dep=("DEPOSITS_f", "sum"), wd=("WITHDRAWLS_f", "sum"),
        tr=("INTERNAL_TRANSFERS_f", "sum"), flow_assets=("flow_assets", "sum"),
        fee_num=("fee_num", "sum"), fee_den=("fee_den", "sum"),
        y_num=("y_num", "sum"), y_den=("y_den", "sum"), n=("FUND_ID", "nunique"))
    return d, agg


def fund_snapshot(d, latest):
    cur = d[d["REPORT_PERIOD"] == latest].copy()
    last12 = d[d["m"] > month_index(latest) - 12]
    # compounded 12m return, only when all 12 months are present
    piv = last12.pivot_table(index=["family", "FUND_ID"], columns="m", values="MONTHLY_YIELD")
    full = piv.dropna()
    y12 = (1 + full / 100).prod(axis=1).sub(1).mul(100) if len(piv.columns) == 12 else pd.Series(dtype=float)
    fl = last12.groupby(["family", "FUND_ID"]).agg(dep12=("DEPOSITS_f", "sum"), wd12=("WITHDRAWLS_f", "sum"), tr12=("INTERNAL_TRANSFERS_f", "sum"))
    cur = cur.merge(fl, left_on=["family", "FUND_ID"], right_index=True, how="left")
    cur["y12"] = [y12.get((f, i), np.nan) for f, i in zip(cur["family"], cur["FUND_ID"])]
    out = []
    a = cur["TOTAL_ASSETS"].replace(0, np.nan)
    for r, pct_s, pct_f, pct_x in zip(cur.itertuples(index=False), cur["STOCK_MARKET_EXPOSURE"] / a * 100,
                                       cur["FOREIGN_EXPOSURE"] / a * 100, cur["FOREIGN_CURRENCY_EXPOSURE"] / a * 100):
        def v(x, nd=2):
            return None if x is None or (isinstance(x, float) and np.isnan(x)) or x is pd.NA else round(float(x), nd)
        out.append({
            "id": int(r.FUND_ID), "fam": r.family, "prod": r.product, "name": str(r.FUND_NAME).strip(), "grp": r.group,
            "mgr": str(r.manager).strip(), "assets": v(r.TOTAL_ASSETS, 1), "fee": v(r.AVG_ANNUAL_MANAGEMENT_FEE),
            "depfee": v(r.AVG_DEPOSIT_FEE), "ym": v(r.MONTHLY_YIELD), "ytd": v(r.YEAR_TO_DATE_YIELD), "y12": v(r.y12),
            "y3": v(r.YIELD_TRAILING_3_YRS), "y5": v(r.YIELD_TRAILING_5_YRS),
            "a3": v(r.AVG_ANNUAL_YIELD_TRAILING_3YRS), "a5": v(r.AVG_ANNUAL_YIELD_TRAILING_5YRS),
            "sd": v(r.STANDARD_DEVIATION), "sharpe": v(r.SHARPE_RATIO), "alpha": v(r.ALPHA),
            "stock": v(pct_s, 1), "foreign": v(pct_f, 1), "fx": v(pct_x, 1), "liquid": v(r.LIQUID_ASSETS_PERCENT, 1),
            "spec": None if pd.isna(r.SPECIALIZATION) else str(r.SPECIALIZATION),
            "target": None if pd.isna(r.TARGET_POPULATION) else str(r.TARGET_POPULATION),
            "since": v(parse_year(r.INCEPTION_DATE), 0),
            "net12": v((r.dep12 - r.wd12) if r.family != "insurance" else np.nan, 1),
            "tr12": v(r.tr12 if r.family != "insurance" else np.nan, 1),
        })
    out.sort(key=lambda x: -(x["assets"] or 0))
    return out


def qa(raw_df, d, agg, latest):
    checks, notes = [], []
    # 1. assets reconcile: aggregate vs raw, per family and month
    r = raw_df[raw_df["REPORT_PERIOD"] >= START].groupby(["REPORT_PERIOD", "family"])["TOTAL_ASSETS"].sum()
    a = agg.merge(pd.DataFrame(PRODUCTS, columns=["product", "l", "family", "c"])[["product", "family"]], on="product") \
        .groupby(["REPORT_PERIOD", "family"])["assets"].sum()
    diff = (r - a).abs().max()
    checks.append({"name": "סכום נכסים במאגר המצטבר שווה למקור (לכל חודש ומשפחת מוצר)", "ok": bool(diff < 1e-6), "detail": f"פער מקסימלי {diff:.2e} מיליון ש\"ח"})
    # 2. flow identity deposits - withdrawals + transfers = net, on rows where it is published
    x = raw_df[raw_df["DEPOSITS"].notna() & raw_df["NET_MONTHLY_DEPOSITS"].notna()]
    bad = ((x["DEPOSITS"] - x["WITHDRAWLS"] + x["INTERNAL_TRANSFERS"] - x["NET_MONTHLY_DEPOSITS"]).abs() > 0.02).sum()
    checks.append({"name": "הפקדות פחות משיכות ועוד העברות = צבירה נטו (ברמת קופה)", "ok": bool(bad == 0), "detail": f"{len(x):,} רשומות, {bad} חריגות"})
    # 3. compounding of monthly yields reproduces published YTD yield in December
    dec = raw_df[(raw_df["REPORT_PERIOD"] % 100 == 12) & (raw_df["REPORT_PERIOD"] >= 201312) & raw_df["YEAR_TO_DATE_YIELD"].notna()]
    piv = raw_df[raw_df["REPORT_PERIOD"] >= 201301].pivot_table(index=["family", "FUND_ID", raw_df["REPORT_PERIOD"] // 100], columns=raw_df["REPORT_PERIOD"] % 100, values="MONTHLY_YIELD")
    full = piv.dropna()
    comp = (1 + full / 100).prod(axis=1).sub(1).mul(100).rename("comp")
    pub = dec.assign(yr=dec["REPORT_PERIOD"] // 100).set_index(["family", "FUND_ID", "yr"])["YEAR_TO_DATE_YIELD"]
    j = pd.concat([comp, pub], axis=1, join="inner").dropna()
    share = ((j["comp"] - j["YEAR_TO_DATE_YIELD"]).abs() < 0.15).mean()
    checks.append({"name": "ריבוי תשואות חודשיות משחזר את התשואה מתחילת השנה שפורסמה (דצמבר)", "ok": bool(share > 0.97), "detail": f"{share:.1%} מתוך {len(j):,} קופות-שנים בטווח 0.15 נק' אחוז"})
    # 4. coverage of named groups
    last = agg[agg["REPORT_PERIOD"] == latest]
    other = last.loc[last["group"] == OTHER, "assets"].sum() / last["assets"].sum()
    notes.append(f"{other:.1%} מהנכסים ב-{latest} משויכים ל'{OTHER}' (קרנות ענפיות וגופים שאינם ברשימת הקבוצות).")
    # 5. monthly return outliers (large funds only); March 2020 equity tracks are the genuine COVID drawdown
    out = d[(d["MONTHLY_YIELD"].abs() > 15) & (d["TOTAL_ASSETS"] > 100)]
    unexplained = out[out["REPORT_PERIOD"] != 202003]
    checks.append({"name": "תשואה חודשית חריגה (מעל 15% בערך מוחלט) בקופות מעל 100 מיליון ש\"ח", "ok": bool(len(unexplained) == 0), "status": "review" if len(unexplained) else "pass",
                   "detail": f"{len(out)} רשומות: {len(out) - len(unexplained)} במסלולי מניות במרץ 2020 (ירידת שוק אמיתית), {len(unexplained)} לבדיקה ({', '.join(sorted(set(unexplained['FUND_NAME'].str.strip())))[:80]})"})
    # 6. missing flows share inside the window
    p = d[d["family"] == "pension"]
    miss = p.loc[~p["flow_ok"], "TOTAL_ASSETS"].sum() / p["TOTAL_ASSETS"].sum() if len(p) else 0
    notes.append(f"בפנסיה-נט חסרים נתוני הפקדות/משיכות ב-{miss:.1%} מהנכסים-חודשים בטווח (עד אמצע 2016). צבירה בטווח זה אינה מוצגת כאפס אלא מסומנת כחסרה.")
    return checks, notes


def main():
    df = add_prev_assets(load())
    latest = int(df["REPORT_PERIOD"].max())
    d, agg = aggregate(df)
    snap = fund_snapshot(d, latest)
    checks, notes = qa(df, d, agg, latest)

    periods = sorted(agg["REPORT_PERIOD"].unique().tolist())
    pidx = {p: i for i, p in enumerate(periods)}
    prod_keys = [p[0] for p in PRODUCTS]
    last = agg[agg["REPORT_PERIOD"] == latest].groupby("group")["assets"].sum()
    hist = agg.groupby("group")["assets"].sum()
    groups = sorted(agg["group"].unique(), key=lambda g: (-(last.get(g, 0)), -hist[g]))
    gidx = {g: i for i, g in enumerate(groups)}
    cols = ["p", "prod", "grp", "assets", "dep", "wd", "tr", "flow_assets", "fee_num", "fee_den", "y_num", "y_den", "n"]
    rows = []
    for r in agg.itertuples(index=False):
        rows.append([pidx[r.REPORT_PERIOD], prod_keys.index(r.product), gidx[r.group],
                     round(r.assets, 3), round(r.dep, 3), round(r.wd, 3), round(r.tr, 3), round(r.flow_assets, 3),
                     round(r.fee_num, 3), round(r.fee_den, 3), round(r.y_num, 3), round(r.y_den, 3), int(r.n)])
    meta = {
        "asof": latest, "generated": dt.date.today().isoformat(),
        "source": "הרשות לשוק ההון, ביטוח וחיסכון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il)",
        "units": "מיליוני ש\"ח (נכסים ותזרימים); אחוזים (תשואה, דמי ניהול)",
        "funds_latest": len(snap),
    }
    out = {
        "meta": meta, "products": [{"key": p[0], "label": p[1], "family": p[2]} for p in PRODUCTS], "families": FAMILY_LABEL,
        "groups": groups, "periods": periods, "cols": cols, "rows": rows, "funds": snap,
        "qa": {"checks": checks, "notes": notes},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    WEB_OUT.parent.mkdir(parents=True, exist_ok=True)
    WEB_OUT.write_text(OUT.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"latest={latest} rows={len(rows):,} funds={len(snap):,} groups={len(groups)} -> {OUT} ({OUT.stat().st_size/1e3:.0f} KB)")
    for c in checks:
        print(("PASS " if c["ok"] else "REVIEW " if c.get("status") == "review" else "FAIL ") + c["name"] + " | " + c["detail"])
    for n in notes:
        print("NOTE", n)


if __name__ == "__main__":
    main()
