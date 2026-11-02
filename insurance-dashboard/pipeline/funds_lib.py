"""The arithmetic of the funds module, standard library only: build_funds.py (pandas) computes with it, check_funds_contract.py re-derives
with it, and pipeline/tests/test_funds.py pins it. Every method here is stated in words in funds.json (`net_method`, `real_method`,
`pr_method`) and in docs/FACTS.md.

Units: returns and fees are percent (2.5 = 2.5%); periods are yyyymm integers.

Gross or net of fees? The regulator's own field documentation (the "פירוט שינויים פורמט חדש" sheets of gemel-net, pensia-net and
bituach-net on data.gov.il, 2018) states "תשואות נומינליות ברוטו" / "כלל התשואות הפיננסיות הינן נומינליות ברוטו": every published return
is nominal and before management fees. So a net-of-fee return is an ESTIMATE, built here from the track's own published average
asset-fee rate (AVG_ANNUAL_MANAGEMENT_FEE, annual %, of each month).
"""
import math
import re

GENERIC_SPEC = {"מתמחים בניהול אקטיבי", "עוקבי מדדים", "מתמחים באפיקי השקעה סחירים", "אחר", "מדרגות"}
ANNUITANT = re.compile(r"מקבלי קצבה|זכאים קיימים|פנסיונרים")
DOMAIN = {"gemel": "גמל", "pensia": "פנסיה", "insurance": "ביטוח"}
FEE_FILL = 12  # a month with no published fee: the track's last published fee of the previous 12 months, else its next one within 12
MIN_PEERS = 5
# Self-directed tracks (IRA, "בניהול אישי"): the saver picks the securities, so the track has no return of its own; most managers report
# MONTHLY_YIELD 0.00 and period returns of 0.00 every month, a placeholder. build_funds.py reads a 0.00 month of these tracks as not
# reported (and drops a published window figure whose window has such a month); check_funds_contract.py expects the same.
IRA = re.compile(r"ניהול אישי|\bIRA\b|איי\.אר\.איי", re.I)

NET_METHOD = ("נטו, אומדן: תשואה חודשית ברוטו כפי שפורסמה פחות שיעור דמי הניהול מהצבירה של אותו חודש ÷ 12 (AVG_ANNUAL_MANAGEMENT_FEE; "
              "חודש בלי שיעור מפורסם: השיעור האחרון ב-12 החודשים שקדמו, ואם אין, הראשון ב-12 החודשים שאחרי). תקופות: התשואה המצטברת שפורסמה × מכפלת (1 + נטו) ÷ מכפלת (1 + ברוטו) "
              "של חודשי התקופה; 12 חודשים: ריבית דריבית של 12 התשואות הנטו; ממוצע שנתי: (1 + מצטבר נטו)^(1/שנים) − 1. "
              "שיעור ממוצע בפועל של המסלול, לא דמי הניהול של חוסך מסוים; דמי ניהול מהפקדה אינם נכללים")
REAL_METHOD = ("ריאלי: (1 + תשואה נומינלית) ÷ (1 + שינוי המדד) − 1. שינוי המדד: מדד המחירים לצרכן הכללי (הלמ\"ס), השינוי ב-12 חודשים "
               "לחודש הסיום, ולתקופות של 3 ו-5 שנים מכפלת השינויים השנתיים לחודש הסיום ולאותו חודש בשנים הקודמות; ממוצע שנתי ריאלי: "
               "(1 + ממוצע נומינלי) ÷ (מכפלת השינויים)^(1/שנים) − 1. מדד בגין החודש")
PR_METHOD = ("אחוזון בקטגוריה: 100 × (מספר המסלולים בקטגוריה שתשואתם נמוכה + חצי ממספר השווים) ÷ (מספר המסלולים − 1), מעוגל; "
             "100 = הגבוה בקטגוריה. בקבוצה: המסלולים הפעילים באותה קטגוריה (מוצר | מסלול) עם תשואה לאותה תקופה ונכסים חיוביים, "
             f"רק כשיש לפחות {MIN_PEERS}; החודש הקודם: חברי הקטגוריה כפי שהיו באותו חודש")
TX_METHOD = ("סיווג המסלול: ההתמחות הראשית והמשנית כפי שרשומות אצל הרשות (transfer_bank) כשהן ממופות לאוצר המסלולים של האתר; "
             "אחרת, כללי שם המסלול. dis = הסיווג הרשמי והסיווג לפי השם שונים")


# ------------------------------------------------------------------------------------------------ periods
def mi(p):
    """yyyymm -> a month count (consecutive months differ by 1)"""
    return (p // 100) * 12 + p % 100 - 1


def pm(i):
    return (i // 12) * 100 + i % 12 + 1


def madd(p, k):
    return pm(mi(p) + k)


# ------------------------------------------------------------------------------------------------ the official taxonomy
def official_track(spec, sub, track_of):
    """the site's track label for the regulator's registered primary / secondary specialization (transfer_bank), or None when the
    register says nothing the site's vocabulary can name (the name rules then decide). track_of = build_funds.track_of"""
    spec = " ".join(str(spec).split()) if isinstance(spec, str) else ""
    sub = " ".join(str(sub).split()) if isinstance(sub, str) else ""
    if not spec and not sub:
        return None
    if ANNUITANT.search(spec) or ANNUITANT.search(sub):
        return "מקבלי קצבה"
    if "ממשלתי" in sub:
        return 'אג"ח ממשלות'
    if re.search(r"פאסיבי|מחקה", sub):
        return {"מניות": "עוקב מדדי מניות", 'אג"ח': 'עוקב מדדי אג"ח'}.get(spec, "עוקב מדדים, גמיש")
    lab = track_of(sub, None) if sub else "אחר"
    if lab == "אחר" and spec and spec not in GENERIC_SPEC:
        lab = track_of(spec, None)
    return None if lab == "אחר" else lab


# ------------------------------------------------------------------------------------------------ net of fees
def ffill(xs, limit=FEE_FILL):
    """forward-fill None over at most `limit` consecutive slots (a gap longer than that stays None from slot limit+1 on)"""
    out, last, gap = [], None, 0
    for x in xs:
        if x is not None:
            last, gap = x, 0
            out.append(x)
        else:
            gap += 1
            out.append(last if last is not None and gap <= limit else None)
    return out


def fill_fee(xs, limit=FEE_FILL):
    """the fee used for each month: as published; else the last one published in the previous `limit` months; else the next one
    published within `limit` months (the regulator leaves the fee blank for stretches of some tracks, then resumes)"""
    f = ffill(xs, limit)
    b = ffill(f[::-1], limit)[::-1]
    return [a if a is not None else c for a, c in zip(f, b)]


def net_month(y, fee):
    """one month: gross return − annual asset-fee rate ÷ 12 (percent); None when either is missing"""
    if y is None or fee is None:
        return None
    return y - fee / 12


def compound(xs):
    """percent returns -> the compounded percent return; None if any is missing or the list is empty"""
    if not xs or any(x is None for x in xs):
        return None
    f = 1.0
    for x in xs:
        f *= 1 + x / 100
    return (f - 1) * 100


def net_period(pub, ys, ns):
    """a period's net return from its PUBLISHED gross return: (1 + pub) × Π(1 + net_m) ÷ Π(1 + gross_m) − 1, percent.
    Anchoring on the published figure keeps net = gross exactly where the fee is zero. None when anything is missing"""
    if pub is None or not ys or len(ys) != len(ns) or any(x is None for x in ys) or any(x is None for x in ns):
        return None
    g, n = 1.0, 1.0
    for a, b in zip(ys, ns):
        g *= 1 + a / 100
        n *= 1 + b / 100
    if g <= 0:
        return None
    return ((1 + pub / 100) * n / g - 1) * 100


def annualise(cum, yrs):
    if cum is None or cum <= -100:
        return None
    return ((1 + cum / 100) ** (1 / yrs) - 1) * 100


def real(nom, yoys):
    """a cumulative nominal percent return over len(yoys) years deflated by the product of the 12-month CPI changes; None when any
    CPI point is missing"""
    if nom is None or not yoys or any(x is None for x in yoys):
        return None
    f = 1.0
    for x in yoys:
        f *= 1 + x / 100
    return ((1 + nom / 100) / f - 1) * 100


def real_ann(nom_ann, yoys):
    """an annualised nominal return over len(yoys) years -> annualised real"""
    if nom_ann is None or not yoys or any(x is None for x in yoys):
        return None
    f = 1.0
    for x in yoys:
        f *= 1 + x / 100
    return ((1 + nom_ann / 100) / f ** (1 / len(yoys)) - 1) * 100


# ------------------------------------------------------------------------------------------------ percentile in category
def percentiles(pairs, min_n=MIN_PEERS):
    """pairs: [(key, value)] of one category and one window (values as published, rounded). -> {key: (percentile 0-100, n)}:
    100 × (peers below + ½ × peers equal) ÷ (n − 1), rounded half up; {} when fewer than min_n values"""
    xs = [(k, v) for k, v in pairs if v is not None and isinstance(v, (int, float)) and math.isfinite(v)]
    n = len(xs)
    if n < min_n:
        return {}
    vals = sorted(v for _, v in xs)
    out = {}
    for k, v in xs:
        lo = _bisect_left(vals, v)
        hi = _bisect_right(vals, v)
        below, eq = lo, hi - lo - 1
        out[k] = (int(math.floor(100 * (below + 0.5 * eq) / (n - 1) + 0.5)), n)
    return out


def _bisect_left(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        m = (lo + hi) // 2
        if a[m] < x:
            lo = m + 1
        else:
            hi = m
    return lo


def _bisect_right(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        m = (lo + hi) // 2
        if x < a[m]:
            hi = m
        else:
            lo = m + 1
    return lo


def rnd(x, nd=2):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), nd)


# ------------------------------------------------------------------------------------------------ trust flags (Wave 0, W6)
# Intra-group migration: a track's 12-month net accrual (nd12 = NET_MONTHLY_DEPOSITS over 12 months: deposits − withdrawals + net
# transfers) is strongly negative while its management group's total for the same product is positive, or the reverse. Money moved
# between the group's own tracks (an age-based default re-sorting savers, a merger of tracks) reads as an outflow of the track, not of the
# group. "Strongly": at least MIG_ABS NIS millions and MIG_PCT of the track's assets. The group total counts every live track of the group in
# the product (the track itself included) and needs at least MIG_PEERS tracks with a flow.
MIG_ABS, MIG_PCT, MIG_PEERS = 250.0, 1.0, 2
MIG_METHOD = ("נדידה בתוך הקבוצה: צבירה נטו LTM של המסלול (הפקדות פחות משיכות ועוד העברות נטו, NET_MONTHLY_DEPOSITS) שלילית לפחות "
              f"{MIG_ABS:.0f} מיליון ש\"ח ו-{MIG_PCT:.0f}% מנכסיו, בעוד סך הצבירה נטו של כל מסלולי הקבוצה באותו מוצר חיובי (או להפך). "
              "הכסף עבר בין מסלולי הקבוצה, לא יצא ממנה")
# Exposure plausibility: a share of assets (stocks, foreign, foreign currency) above EXP_HI or below EXP_LO percent is published as such by
# the regulator but cannot be read at face value (a leveraged or mislabelled figure): marked for checking with the manager and left out of
# category spreads and averages.
EXP_HI, EXP_LO = 120.0, -20.0
EXP_METHOD = (f"חשיפה מעל {EXP_HI:.0f}% או מתחת ל-{EXP_LO:.0f}% מהנכסים מסומנת 'לבדיקה מול המנהל' ואינה נכללת בפיזור הקטגוריה ובממוצעים; "
              "הערך מוצג כפי שפורסם")
EXP_KEYS = ("st", "fo", "fx")


def exposure_checks(f):
    """the exposure keys of a track row whose published share is outside [EXP_LO, EXP_HI]; [] when all are plausible"""
    return [k for k in EXP_KEYS if f.get(k) is not None and (f[k] > EXP_HI or f[k] < EXP_LO)]


def migration(funds):
    """{key: {"grp": group total, "n": tracks with a flow}} for every live track whose nd12 points against its group's product total
    (funds: the live rows, each with grp, prod, assets and, where the regulator publishes flows, nd12)"""
    tot, cnt = {}, {}
    for f in funds:
        x = f.get("nd12")
        if x is None:
            continue
        g = (f["grp"], f["prod"])
        tot[g] = tot.get(g, 0.0) + x
        cnt[g] = cnt.get(g, 0) + 1
    out = {}
    for f in funds:
        x = f.get("nd12")
        if x is None or (f.get("assets") or 0) <= 0:
            continue
        g = (f["grp"], f["prod"])
        if cnt[g] < MIG_PEERS or abs(x) < MIG_ABS or abs(x) < MIG_PCT / 100 * f["assets"]:
            continue
        t = round(math.fsum(f2["nd12"] for f2 in funds if f2.get("nd12") is not None and (f2["grp"], f2["prod"]) == g), 1)
        if (x < 0 < t) or (x > 0 > t):
            out[f["k"]] = {"grp": t, "n": cnt[g]}
    return out
