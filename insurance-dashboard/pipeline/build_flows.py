"""Wave 3 "flows": who really won, month by month. The regulator's monthly per-track flows (Gemel-Net, Pensia-Net, since 2011) summed per
management group x product, with the parts a track-level reading gets wrong taken apart. Standard library; it reads only the files
build_funds.py and build_fund_stats.py publish, so it rebuilds anywhere, CI included.

python3 pipeline/build_flows.py            write the files below
python3 pipeline/build_flows.py --check    rebuild in memory: byte-equal to the files on disk, and the rules hold (gate `flows`)

  -> web/public/data/flows.json              index: months, products, groups, methods (every formula in words), coverage, default-fund
                                             tenders and the months each covers, and the 3M / 12M sums of the latest month
  -> web/public/data/flows/<prod>.json       per product: one series per group (and the product total `tot`), aligned with `months`
  -> web/public/data/flows/m/<yyyymm>.json   the inputs of every cell of that month: each track's row as its history publishes it
                                             (provenance: a cell = the sum of these rows, by the stated formula)
  -> web/public/data/flows/sig.json          the fund card's and the saver's flow signal: each live track's net flow over 3 and 12
                                             months and, per category, how many tracks had a positive net flow
  -> web/public/data/flows/fees.json         the average management fee per live track: now, 12 months earlier, and its moves of 5bp or more

Inputs: funds.json, funds/closed.json (group, name, manager of every track), funds/<k>.json (monthly a, y, dep, wd, tr, nd, fee, ct; df
when build_funds.py publishes it), funds/default.json (the default-fund tenders: winners' tracks and periods), market.json (meta.fetched:
the day the regulator files were received). Units: NIS millions; fees percent; months yyyymm.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import funds_lib as FL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "web" / "public" / "data"
V = 1
FROM = 201101
BUCKET = "קרנות ענפיות ואחרות"  # many small managers in one label: not a group, never ranked; cancellation is per manager inside it
CLOSE_LEFT, CLOSE_OUT = 0.05, 0.5  # a closing month: assets fall below 5% of the month before and the transfer out is ≥ 50% of them
FEE_MOVE = 0.05                     # 5bp, in percent points
FEE_LOG_MONTHS = 36
TOL = 0.5                           # reconciliation tolerance, NIS millions
SRC = "הרשות לשוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il), כפי שהאתר מפרסם אותם: funds/<k>.json, funds.json, funds/closed.json, funds/default.json"
# id, the products of the histories it gathers (ct product names), label, flows published?
PRODS = [
    ("pm", ("פנסיה מקיפה",), "פנסיה מקיפה", True),
    ("pk", ("פנסיה כללית",), "פנסיה כללית", True),
    ("gm", ("גמל",), "גמל", True),
    ("hs", ("השתלמות",), "השתלמות", True),
    ("gl", ("גמל להשקעה",), "גמל להשקעה", True),
    ("ch", ("חיסכון לילד",), "חיסכון לילד", True),
    ("mp", ("מרכזית לפיצויים",), "מרכזית לפיצויים", True),
    ("go", ("גמל, מטרה אחרת",), "גמל, מטרה אחרת", True),
    ("po", ("פוליסות חיסכון וביטוחי מנהלים (מ-2004)",), "פוליסות חיסכון וביטוחי מנהלים (מ-2004)", False),
    ("bm", ("ביטוחי מנהלים 1992-2003", "ביטוחי מנהלים 1990-1991", "ביטוחי מנהלים 2004 ואילך, מסלולים ייעודיים"), "ביטוחי מנהלים: דורות ותיקים ומסלולים ייעודיים", False),
]
PROD_OF = {name: pid for pid, names, _, _ in PRODS for name in names}
FIELDS = ("n", "nf", "a", "af", "dep", "wd", "tr", "org", "net", "nd", "mig", "dd", "dt", "cl", "comp", "res", "rk")
FLOWS = ("dep", "wd", "tr", "org", "net", "nd", "mig", "dd", "dt", "cl", "comp", "res")
WIN = ("tr", "org", "net", "comp", "dd", "dt", "mig")

METHOD = {
    "cell": "תא = סכום מסלולי הקבוצה במוצר באותו חודש, כפי שכל מסלול מפורסם (funds/<k>.json). המוצר: לפי הקטגוריה של המסלול באותו חודש (ct). "
            "הקבוצה: לפי החברה המנהלת בחודש האחרון של המסלול (funds.json / closed.json grp); מסלול שעבר בין קבוצות משויך לקבוצה האחרונה שלו בכל חודשיו",
    "n": "מספר המסלולים שדיווחו נכסים בחודש",
    "nf": "מספר המסלולים שדיווחו הפקדות, משיכות והעברות בחודש (רק הם נכנסים לתזרימים)",
    "a": "נכסים: סכום TOTAL_ASSETS",
    "af": "נכסי המסלולים שדיווחו תזרימים; af ÷ a = כיסוי התזרימים",
    "dep": "הפקדות: סכום DEPOSITS",
    "wd": "משיכות: סכום WITHDRAWLS (חיובי; מופחת בצבירה)",
    "tr": "ניוד נטו: סכום INTERNAL_TRANSFERS (העברות נכנסות פחות יוצאות; הרשות מפרסמת נטו בלבד, לא את שני הצדדים)",
    "org": "צבירה אורגנית = הפקדות − משיכות",
    "net": "צבירה נטו = הפקדות − משיכות + ניוד נטו",
    "nd": "NET_MONTHLY_DEPOSITS כפי שפורסם (סכום); אמור להשתוות לצבירה נטו",
    "mig": "נדידה פנימית: Σ min(סך ההעברות החיוביות, סך ההעברות השליליות בערך מוחלט) של מסלולי הקבוצה באותו מוצר ובאותו חודש: כסף שעבר בין מסלולי הקבוצה "
           "(כמו funds_lib.migration, ברמת הקבוצה ובחודש בודד). מקוזז כבר בסכום הקבוצה, ולכן אינו משנה את הניוד נטו שלה; מוצג כדי שיראו כמה מהתנועה ברמת המסלול "
           "פנימית. בקרנות ענפיות ואחרות: לכל חברה מנהלת בנפרד. העברות בין מוצרים שונים של אותה קבוצה אינן מנוכות: הרשות מפרסמת נטו לכל מסלול, ותנועות הפוכות "
           "בין מוצרים באותו חודש הן ברובן העברות לגופים אחרים",
    "dd": "הפקדות לקרן ברירת מחדל: סכום DEPOSITS של מסלולי קרן שהייתה קרן נבחרת (ברירת מחדל) באותו חודש, לפי תקופות ההליכים ב-funds/default.json; "
          "הפקדות לשאר מסלולי הקבוצה = dep − dd. רק פנסיה מקיפה. עמיתים שהצטרפו בתקופת ההליך ממשיכים להפקיד אחריה; ההפקדות האלה אינן מופרדות",
    "dt": "ניוד לקרן ברירת מחדל: סכום INTERNAL_TRANSFERS של אותם מסלולים באותם חודשים, רק כשהוא חיובי (max(0, Σ)): עמיתים שהצטרפו דרך ברירת המחדל "
          "ומעבירים אליה חיסכון קודם. מנוכה מהניוד התחרותי, גם כשחלקו בחירה של העמית; ניוד נטו שלילי של קרן ברירת מחדל (עמיתים שעזבו) נשאר בניוד התחרותי",
    "cl": "סגירת מסלולים: העברה יוצאת של מסלול בחודש שבו נכסיו ירדו מתחת ל-5% מהחודש הקודם (או בחודש האחרון שלו), כשהיא ≥ 50% מנכסי החודש הקודם; "
          "רק החלק שלא קוזז בתוך הקבוצה: max(Σ העברות הסגירה, min(ניוד נטו, 0)). מיזוג מסלולים שהמסלול הקולט לא רשם כהעברה נכנסת",
    "comp": "ניוד תחרותי = ניוד נטו − ניוד לקרן ברירת מחדל − סגירת מסלולים (tr − dt − cl). הנדידה הפנימית כבר מקוזזת בניוד נטו של הקבוצה",
    "res": "לא מוסבר: Σ (נכסים − נכסי החודש הקודם − NET_MONTHLY_DEPOSITS − נכסי החודש הקודם × תשואה חודשית ברוטו ÷ 100) על מסלולים שדיווחו בשני החודשים. "
           "סכום גדול: מיזוג, העברת ניהול או הפרש דיווח; אומדן (התשואה ברוטו, לפני דמי ניהול)",
    "rk": "מקום בניוד התחרותי בין הקבוצות במוצר באותו חודש (1 = הגבוה ביותר); בלי קרנות ענפיות ואחרות; ערכים שווים חולקים מקום",
    "win": "3M / 12M: סכום שלושה / שנים-עשר חודשים רצופים שמסתיימים בחודש; חודש חסר = אין ערך",
    "round": "כל סכום מעוגל ל-0.1 מיליון ש\"ח אחרי הסכימה; org, net ו-comp מחושבים מהרכיבים המעוגלים, ולכן הזהויות מתקיימות בדיוק בקובץ",
    "sig": "אות זרימה: צבירה נטו של המסלול (NET_MONTHLY_DEPOSITS) ב-3 וב-12 החודשים שמסתיימים ב-asof, רק כשכל החודשים פורסמו; "
           "בקטגוריה (מוצר | מסלול, היום): מספר המסלולים הפעילים עם נכסים ועם ערך לחלון, וכמה מהם בצבירה נטו חיובית",
    "fee": "דמי ניהול מצבירה, ממוצע בפועל של המסלול (AVG_ANNUAL_MANAGEMENT_FEE) כפי שפורסם בכל חודש, בלי השלמה. fee = asof; fee12 = 12 חודשים קודם; "
           "d12 = ההפרש בנקודות בסיס; log = חודשים ב-36 האחרונים שבהם השיעור זז ב-5 נ\"ב או יותר מהחודש שפורסם לפניו: [חודש, קודם, חדש]. "
           "ממוצע בפועל של המסלול, לא מה שחוסך מסוים משלם",
}


def dumps(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))


def r1(x):
    return None if x is None else round(x + 0.0, 1) + 0.0


def ym_of(date):
    """'2016-11-01' -> 201611"""
    return int(date[:4]) * 100 + int(date[5:7])


def months_between(a, b):
    out, p = [], a
    while p <= b:
        out.append(p)
        p = FL.madd(p, 1)
    return out


def cat_at(ct, p):
    c = None
    for q, x in ct:
        if q <= p:
            c = x
        else:
            break
    return c


def load(d=D):
    F = json.loads((d / "funds.json").read_text(encoding="utf-8"))
    C = json.loads((d / "funds" / "closed.json").read_text(encoding="utf-8"))
    rows = {f["k"]: f for f in F["funds"] + C["funds"]}
    H = {k: json.loads((d / "funds" / f"{k}.json").read_text(encoding="utf-8")) for k in sorted(rows)}
    dp = d / "funds" / "default.json"
    DF = json.loads(dp.read_text(encoding="utf-8")) if dp.exists() else {"tenders": []}
    mp = d / "market.json"
    fetched = json.loads(mp.read_text(encoding="utf-8")).get("meta", {}).get("fetched") if mp.exists() else None
    return F, rows, H, DF, fetched


def tenders_of(DF, asof):
    """[(tender id, label, first month, last month in the data, {track key}, winners)]"""
    out = []
    for t in DF.get("tenders", []):
        a, b = ym_of(t["from"]), min(ym_of(t["to"]), asof)
        ks = {k for w in t.get("winners", []) for k in w.get("ks", [])}
        out.append((t["id"], t.get("label", t["id"]), a, b, ks, t.get("winners", [])))
    return out


def track_months(k, h, row, tend):
    """one record per month of the track from FROM: (p, product id, a, a0, y, dep, wd, tr, nd, default?, closing?)"""
    out = []
    P = h["p"]
    for i, p in enumerate(P):
        if p < FROM:
            continue
        c = cat_at(h["ct"], p)
        pid = PROD_OF.get(c.split(" | ")[0]) if c else None
        if pid is None:
            continue
        a = h["a"][i]
        a0 = h["a"][i - 1] if i > 0 and P[i - 1] == FL.madd(p, -1) else None
        g = lambda key: h[key][i] if key in h else None  # noqa: E731
        dep, wd, tr, nd = g("dep"), g("wd"), g("tr"), g("nd")
        dflt = any(a_ <= p <= b_ and k in ks for _, _, a_, b_, ks, _ in tend)
        last = i == len(P) - 1
        closing = (tr is not None and tr < 0 and a0 is not None and a0 > 0 and -tr >= CLOSE_OUT * a0
                   and (last or a is None or a < CLOSE_LEFT * a0))
        out.append((p, pid, a, a0, h["y"][i], dep, wd, tr, nd, dflt, closing))
    return out


def cancel(trs):
    pos = math.fsum(x for x in trs if x > 0)
    neg = -math.fsum(x for x in trs if x < 0)
    return min(pos, neg)


def build(d=D):
    F, rows, H, DF, fetched = load(d)
    asof = F["asof"]
    months = months_between(FROM, asof)
    tend = tenders_of(DF, asof)
    # cell inputs: (pid, p) -> grp -> [track rows]
    cells = {}
    for k in sorted(H):
        row = rows[k]
        for rec in track_months(k, H[k], row, tend):
            p, pid = rec[0], rec[1]
            cells.setdefault((pid, p), {}).setdefault(row["grp"], []).append((k, row.get("mgr", ""), rec))
    files = {}
    prov = {p: {} for p in months}
    groups_all = set()
    prod_meta = []
    nd_off = []
    for pid, names, label, has_flows in PRODS:
        ps = [p for p in months if (pid, p) in cells]
        if not ps:
            continue
        pm = months_between(ps[0], asof)
        gnames = sorted({g for p in pm for g in cells.get((pid, p), {})}, key=lambda g: (g == BUCKET, g))
        groups_all.update(gnames)
        ser = {g: {f: [None] * len(pm) for f in FIELDS} for g in gnames + ["tot"]}
        first_flow = None
        for j, p in enumerate(pm):
            per = cells.get((pid, p), {})
            if per:
                prov[p].setdefault(pid, {})
            for g, trs in per.items():
                S = ser[g]
                S["n"][j] = sum(1 for _, _, r in trs if r[2] is not None)
                S["a"][j] = r1(math.fsum(r[2] for _, _, r in trs if r[2] is not None))
                fl = [(k, m, r) for k, m, r in trs if None not in (r[5], r[6], r[7])] if has_flows else []
                prov[p][pid][g] = [[k, r[5], r[6], r[7], r[8], r[2], r[3], r[4], int(r[9]), int(r[10])] for k, _, r in sorted(trs)]
                if not fl:
                    continue
                first_flow = first_flow or p
                S["nf"][j] = len(fl)
                S["af"][j] = r1(math.fsum(r[2] for _, _, r in fl if r[2] is not None))
                dep = r1(math.fsum(r[5] for _, _, r in fl))
                wd = r1(math.fsum(r[6] for _, _, r in fl))
                tr = r1(math.fsum(r[7] for _, _, r in fl))
                S["dep"][j], S["wd"][j], S["tr"][j] = dep, wd, tr
                S["org"][j] = r1(dep - wd)
                S["net"][j] = r1(dep - wd + tr)
                nds = [r[8] for _, _, r in fl if r[8] is not None]
                S["nd"][j] = r1(math.fsum(nds)) if len(nds) == len(fl) else None
                units = {}
                for k, m, r in fl:
                    units.setdefault(("m:" + m) if g == BUCKET else g, []).append(r[7])
                S["mig"][j] = r1(math.fsum(cancel(v) for v in units.values()))
                dd = r1(math.fsum(r[5] for _, _, r in fl if r[9]))
                dt = r1(max(0.0, math.fsum(r[7] for _, _, r in fl if r[9])))
                S["dd"][j], S["dt"][j] = (dd, dt) if pid == "pm" else (None, None)
                clr = math.fsum(r[7] for _, _, r in fl if r[10])
                cl = r1(max(clr, min(tr, 0.0))) if clr < 0 else 0.0
                S["cl"][j] = cl
                S["comp"][j] = r1(tr - (dt or 0.0) - cl)
                rs = [r[2] - r[3] - r[8] - r[3] * r[4] / 100 for _, _, r in fl if None not in (r[2], r[3], r[4], r[8])]
                S["res"][j] = r1(math.fsum(rs)) if rs else None
                if S["nd"][j] is not None and abs(S["nd"][j] - S["net"][j]) > TOL + 0.05 * len(fl):  # each track's nd and flows are rounded to 0.1
                    nd_off.append((pid, g, p, S["nd"][j], S["net"][j]))
            # the product total and the ranks
            T = ser["tot"]
            gs = [g for g in gnames if ser[g]["a"][j] is not None]
            if gs:
                T["n"][j] = sum(ser[g]["n"][j] for g in gs)
                T["a"][j] = r1(math.fsum(ser[g]["a"][j] for g in gs))
            gf = [g for g in gnames if ser[g]["nf"][j]]
            if gf:
                T["nf"][j] = sum(ser[g]["nf"][j] for g in gf)
                for f in ("af", "dep", "wd", "tr", "mig", "cl", "res") + (("dd", "dt") if pid == "pm" else ()):
                    xs = [ser[g][f][j] for g in gf]
                    T[f][j] = r1(math.fsum(x for x in xs if x is not None)) if any(x is not None for x in xs) else None
                T["org"][j] = r1(T["dep"][j] - T["wd"][j])
                T["net"][j] = r1(T["dep"][j] - T["wd"][j] + T["tr"][j])
                nds = [ser[g]["nd"][j] for g in gf]
                T["nd"][j] = r1(math.fsum(nds)) if all(x is not None for x in nds) else None
                T["comp"][j] = r1(T["tr"][j] - (T["dt"][j] or 0.0) - T["cl"][j])
                rk = sorted((g for g in gf if g != BUCKET), key=lambda g: -ser[g]["comp"][j])
                for g in rk:
                    ser[g]["rk"][j] = 1 + sum(1 for x in rk if ser[x]["comp"][j] > ser[g]["comp"][j])
        doc = {"v": V, "id": pid, "label": label, "asof": asof, "flows": has_flows, "months": pm,
               "groups": {g: {f: xs for f, xs in ser[g].items() if any(x is not None for x in xs)} for g in gnames},
               "tot": {f: xs for f, xs in ser["tot"].items() if any(x is not None for x in xs)}}
        files[f"flows/{pid}.json"] = doc
        prod_meta.append({"id": pid, "label": label, "flows": has_flows, "from": pm[0], "flows_from": first_flow, "groups": gnames,
                          "n_groups": len([g for g in gnames if g != BUCKET])})
    for p, by in prov.items():
        if by:
            files[f"flows/m/{p}.json"] = {"v": V, "p": p, "cols": ["k", "dep", "wd", "tr", "nd", "a", "a0", "y", "def", "cl"], "g": by}

    # the latest month's 3M and 12M sums (the page computes the same from the series; scripts/flows-test.mjs pins the parity)
    latest = {}
    for pid, *_ in PRODS:
        doc = files.get(f"flows/{pid}.json")
        if not doc or not doc["flows"]:
            continue
        out = {}
        for g, S in list(doc["groups"].items()) + [("tot", doc["tot"])]:
            w = {}
            for f in WIN:
                xs = S.get(f)
                for n in (3, 12):
                    tail = xs[-n:] if xs and len(xs) >= n else None
                    w[f"{f}{n}"] = r1(math.fsum(tail)) if tail and all(x is not None for x in tail) else None
            out[g] = {k: x for k, x in w.items() if x is not None}
        latest[pid] = out

    # coverage: what the histories carry, product by product, and where they stop
    cov_prod = []
    for m in prod_meta:
        doc = files[f"flows/{m['id']}.json"]
        T = doc["tot"]
        thin = [p for p, a, af in zip(doc["months"], T.get("a", []), T.get("af", [None] * len(doc["months"])))
                if m["flows"] and a and (af is None or af < 0.99 * a)]
        cov_prod.append({"id": m["id"], "assets_from": m["from"], "flows_from": m["flows_from"], "dep_wd": m["flows"], "tr_split": False,
                         "thin_n": len(thin), "thin": thin[:12],
                         "note": ("ביטוח-נט אינו מפרסם תזרימים: נכסים בלבד" if not m["flows"] else
                                  "הפקדות, משיכות וניוד נטו לכל מסלול; העברות נכנסות ויוצאות בנפרד אינן מפורסמות")})
    cov = {
        "prods": cov_prod,
        "tr_split": "הרשות מפרסמת לכל מסלול העברות נטו בלבד (INTERNAL_TRANSFERS); העברות נכנסות והעברות יוצאות בנפרד אינן מפורסמות לאף מוצר ולאף תקופה, ולכן אינן בקובץ",
        "thin": "thin = חודשים שבהם נכסי המסלולים שדיווחו תזרימים < 99% מנכסי המוצר (מסלולים בלי תזרים אינם נכללים בתזרימים ואינם מושלמים)",
        "nd_off": len(nd_off), "nd_off_eg": [list(x) for x in nd_off[:5]],
        "nd_note": "תאים שבהם NET_MONTHLY_DEPOSITS שפורסם רחוק מהפקדות − משיכות + ניוד נטו ביותר מ-0.5 מיליון ועוד 0.05 לכל מסלול (עיגול של 0.1 בכל מסלול)",
        "fees": "דמי ניהול מצבירה: סדרה חודשית לכל מסלול (fee). דמי ניהול מהפקדה (AVG_DEPOSIT_FEE): " +
                ("סדרה חודשית (df)" if any("df" in h for h in H.values()) else
                 "רק לחודש האחרון (funds.json depfee); קבצי ההיסטוריה של המסלולים אינם נושאים סדרה חודשית, ולכן אין יומן שינויים לדמי ניהול מהפקדה"),
        "group": "שיוך לקבוצה לפי החברה המנהלת בחודש האחרון של המסלול: מסלול שעבר בין קבוצות (מכירה, מיזוג חברות) מופיע בקבוצה האחרונה שלו גם בחודשים שלפני המעבר",
        "default": "השפעת ברירת המחדל: רק פנסיה מקיפה; שיוך הזוכה למסלולים לפי שם הקרן (funds/default.json, map = inferred)",
    }
    tenders = [{"id": tid, "label": lab, "from": a_, "to": b_, "months": len(months_between(a_, b_)) if b_ >= a_ else 0,
                "winners": [{"grp": w.get("grp"), "co": w.get("co"), "n": len(w.get("ks", [])), "map": w.get("map")} for w in ws]}
               for tid, lab, a_, b_, _, ws in tend]
    files["flows.json"] = {"v": V, "asof": asof, "received": fetched, "src": SRC, "from": FROM, "months": months, "prods": prod_meta,
                           "groups": sorted(groups_all, key=lambda g: (g == BUCKET, g)), "bucket": BUCKET, "method": METHOD,
                           "coverage": cov, "tenders": tenders, "latest": latest,
                           "files": {"prod": "flows/<id>.json", "month": "flows/m/<yyyymm>.json", "sig": "flows/sig.json", "fees": "flows/fees.json"}}
    files["flows/sig.json"] = signal(F, H, asof)
    files["flows/fees.json"] = fees(F, H, asof)
    return files


def window(h, asof, n, key="nd"):
    xs = h.get(key)
    if not xs or not h["p"] or h["p"][-1] != asof or len(h["p"]) < n:
        return None
    ps, tail = h["p"][-n:], xs[-n:]
    if ps[0] != FL.madd(asof, -(n - 1)) or any(x is None for x in tail):
        return None
    return r1(math.fsum(tail))


def signal(F, H, asof):
    t, cats = {}, {}
    for f in F["funds"]:
        h = H[f["k"]]
        if "nd" not in h:
            continue
        w3, w12 = window(h, asof, 3), window(h, asof, 12)
        if w3 is None and w12 is None:
            continue
        t[f["k"]] = [w3, w12]
        if (f.get("assets") or 0) <= 0:
            continue
        c = cats.setdefault(f"{f['prod']} | {f['track']}", [0, 0, 0, 0])
        if w3 is not None:
            c[0] += 1
            c[1] += w3 > 0
        if w12 is not None:
            c[2] += 1
            c[3] += w12 > 0
    return {"v": V, "asof": asof, "method": METHOD["sig"], "cols": ["nd3", "nd12"], "cat_cols": ["n3", "up3", "n12", "up12"],
            "t": t, "cats": cats}


def fee_log(p, fee, since):
    """[[month, previous published, new]] for every published month ≥ since whose fee moved ≥ FEE_MOVE from the previous published one"""
    out, prev = [], None
    for q, x in zip(p, fee):
        if x is None:
            continue
        if prev is not None and q >= since and abs(x - prev) >= FEE_MOVE - 1e-9:
            out.append([q, prev, x])
        prev = x
    return out


def fees(F, H, asof):
    rows = []
    since = FL.madd(asof, -(FEE_LOG_MONTHS - 1))
    for f in F["funds"]:
        h = H[f["k"]]
        if not h.get("fee") or h["p"][-1] != asof or h["fee"][-1] is None:
            continue
        ix = {p: i for i, p in enumerate(h["p"])}
        i12 = ix.get(FL.madd(asof, -12))
        fee12 = h["fee"][i12] if i12 is not None else None
        r = {"k": f["k"], "grp": f["grp"], "prod": f["prod"], "track": f["track"], "a": f.get("assets"), "fee": h["fee"][-1],
             "fee12": fee12, "d12": None if fee12 is None else round((h["fee"][-1] - fee12) * 100, 1) + 0.0,
             "log": fee_log(h["p"], h["fee"], since)}
        if "df" in h and h["df"] and h["df"][-1] is not None:
            df12 = h["df"][i12] if i12 is not None else None
            r.update(df=h["df"][-1], df12=df12, dlog=fee_log(h["p"], h["df"], since))
        rows.append({k: x for k, x in r.items() if x is not None})
    rows.sort(key=lambda r: r["k"])
    return {"v": V, "asof": asof, "method": METHOD["fee"], "move_bp": round(FEE_MOVE * 100), "since": since, "rows": rows}


# ------------------------------------------------------------------------------------------------------------------------------ rules
def rules(files):
    """the reconciliation and decomposition rules (gate `flows`): [] when they hold"""
    bad = []
    idx = files["flows.json"]
    for key in ("cell", "dep", "wd", "tr", "org", "net", "mig", "dd", "dt", "cl", "comp", "res", "rk", "win", "sig", "fee"):
        if not idx["method"].get(key):
            bad.append(f"method string missing: {key}")
    if not idx["coverage"].get("tr_split"):
        bad.append("coverage: the transfers in/out statement is missing")
    for m in idx["prods"]:
        doc = files[f"flows/{m['id']}.json"]
        P = doc["months"]
        for j, p in enumerate(P):
            mf = files.get(f"flows/m/{p}.json", {}).get("g", {}).get(m["id"], {})
            gs = [g for g, S in doc["groups"].items() if S.get("a") and S["a"][j] is not None]
            # every group cell = the sum of its tracks (the month file), within TOL
            for g in gs:
                S, rows = doc["groups"][g], mf.get(g, [])
                a = math.fsum(r[5] for r in rows if r[5] is not None)
                if abs(a - S["a"][j]) > TOL:
                    bad.append(f"{m['id']} {g} {p}: assets {S['a'][j]} vs tracks {a:.1f}")
                if doc["flows"] and S.get("nf") and S["nf"][j]:
                    fl = [r for r in rows if None not in (r[1], r[2], r[3])]
                    for col, f in ((1, "dep"), (2, "wd"), (3, "tr")):
                        x = math.fsum(r[col] for r in fl)
                        if abs(x - S[f][j]) > TOL:
                            bad.append(f"{m['id']} {g} {p}: {f} {S[f][j]} vs tracks {x:.1f}")
                    if abs(S["net"][j] - (S["dep"][j] - S["wd"][j] + S["tr"][j])) > 0.051:
                        bad.append(f"{m['id']} {g} {p}: net ≠ dep − wd + tr")
                    if abs(S["comp"][j] - (S["tr"][j] - (S["dt"][j] if S.get("dt") and S["dt"][j] is not None else 0) - S["cl"][j])) > 0.051:
                        bad.append(f"{m['id']} {g} {p}: comp ≠ tr − dt − cl")
                    if S["mig"][j] < 0 or S["cl"][j] > 0:
                        bad.append(f"{m['id']} {g} {p}: sign (mig ≥ 0, cl ≤ 0)")
            # the product total = the sum of its groups, within TOL
            T = doc["tot"]
            for f in ("a", "dep", "wd", "tr", "mig", "comp"):
                if not T.get(f) or T[f][j] is None:
                    continue
                x = math.fsum(doc["groups"][g][f][j] for g in doc["groups"] if doc["groups"][g].get(f) and doc["groups"][g][f][j] is not None)
                if abs(x - T[f][j]) > TOL:
                    bad.append(f"{m['id']} tot {p}: {f} {T[f][j]} vs groups {x:.1f}")
            rk = sorted(doc["groups"][g]["rk"][j] for g in doc["groups"] if doc["groups"][g].get("rk") and doc["groups"][g]["rk"][j] is not None)
            if rk and rk[0] != 1:
                bad.append(f"{m['id']} {p}: ranks do not start at 1")
    for r in files["flows/fees.json"]["rows"]:
        for q, a, b in r["log"]:
            if abs(b - a) < FEE_MOVE - 1e-9:
                bad.append(f"fees {r['k']} {q}: logged move under 5bp")
    return bad


def main(argv):
    check = "--check" in argv
    files = build()
    blobs = {p: dumps(doc).encode("utf-8") for p, doc in files.items()}
    bad = rules(files)
    idx = files["flows.json"]
    n_cells = sum(sum(1 for x in S.get("a", []) if x is not None) for m in idx["prods"] for S in files[f"flows/{m['id']}.json"]["groups"].values())
    summary = (f"{len(idx['prods'])} products, {len(idx['groups'])} groups, {len(idx['months'])} months ({idx['months'][0]}-{idx['asof']}), "
               f"{n_cells} group-months, {sum(1 for p in files if p.startswith('flows/m/'))} month files, {len(files['flows/sig.json']['t'])} track signals, "
               f"{len(files['flows/fees.json']['rows'])} fee rows")
    if check:
        diff = [p for p, b in blobs.items() if not (D / p).exists() or (D / p).read_bytes() != b]
        mdir = D / "flows" / "m"
        stale = [f"flows/m/{f.name}" for f in sorted(mdir.glob("*.json")) if f"flows/m/{f.name}" not in blobs] if mdir.exists() else []
        for p in diff[:5]:
            print(f"  differs from a rebuild: {p}")
        for p in stale[:5]:
            print(f"  stale file: {p}")
        for b in bad[:8]:
            print(f"  rule: {b}")
        ok = not diff and not stale and not bad
        print(("flows ok: " if ok else f"flows FAILED ({len(diff)} differ, {len(stale)} stale, {len(bad)} rule): ") + summary)
        return 0 if ok else 1
    (D / "flows" / "m").mkdir(parents=True, exist_ok=True)
    for f in (D / "flows" / "m").glob("*.json"):
        if f"flows/m/{f.name}" not in blobs:
            f.unlink()
    for p, b in blobs.items():
        q = D / p
        if not q.exists() or q.read_bytes() != b:
            q.write_bytes(b)
    for b in bad[:20]:
        print("  rule: " + b)
    print(summary + f"; {sum(len(b) for b in blobs.values()) // 1024} KB")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
