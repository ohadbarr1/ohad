"""Shared helpers of the long-term-savings question families (flows, fees, cost, mix, perf): sourced figures over the Savings Lens
(lens.json, regulator aggregates joined to the managers' segment P&L), the sector deck facts (lts.json, printed components in
lts_prov/), the fragility monitor's signals, the war room and the regulator's track files (funds.json).

Not a question module (the leading underscore keeps build_answers from importing it as one). Every figure built here carries a
provenance node: a regulator aggregate (P_reg, rebuilt from the tracks on the page), a printed segment component (P_lts) or a calc
node whose inputs are those. Units: regulator and reported amounts NIS millions; ratios percent.
"""
from math import fsum

from answer_core import (LTS_HE, MM, SEG_HE, Lens, P_calc, P_fund, P_lts, P_reg, P_reg_seg, exhibit, fig, he, link, load, lq, nf, ym)

MAIN8 = ["menora", "harel", "migdal", "phoenix", "clal", "meitav", "altshuler", "more"]
REG_HE = {"assets": "נכסים", "transfers": "העברות נטו", "organic": "צבירה אורגנית", "netflow": "צבירה נטו כולל ניוד", "fee": "דמי ניהול ממוצעים"}
SRC_REG = "רשות שוק ההון: גמל-נט, פנסיה-נט, ביטוח-נט (data.gov.il)"
SRC_REP = "דוחות החברות המנהלות: ביאור מגזרי פעילות (lens.json; רכיבים מודפסים ב-lts_prov)"
SRC_LTS = "דוחות החברות המנהלות: טבלת סוגי הקרנות וביאור המגזרים (lts.json; רכיבים מודפסים ב-lts_prov)"
MEITAV_NOTE = "מיטב: הנהלה וכלליות לפני דמי ניהול לחברה בעלת השליטה, ולכן אינה ברת השוואה ביחסי עלות; מוצגת ואינה נכנסת לדירוג"

_L = None


def L():
    global _L
    if _L is None:
        _L = Lens()
    return _L


# ------------------------------------------------------------------------------------------------ periods and rows
def lastq():
    return L().last_q


def qback(q, k):
    qs = L().quarters
    i = qs.index(q) - k
    return qs[i] if i >= 0 else None


def qwin(q, n):
    qs = L().quarters
    i = qs.index(q)
    return qs[i - n + 1:i + 1] if i - n + 1 >= 0 else None


def qe(q):
    return Lens.q_end(q)


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def mg(c):
    return -1 if c is None else L().mg(c)


def who(c):
    return "כלל השוק" if c is None else he(c)


def row(c, s, q=None):
    return L().row(c, s, q)


def gid(g):
    return L().groups[g].get("id")


def seg_rows(s, q=None):
    q = q or lastq()
    return [r for (g, ss, qq), r in L().rows.items() if ss == s and qq == q]


def mkt(s, q, k):
    """the market total of a regulator field of the lens rows (all groups, the sector funds included)"""
    xs = [r["reg"].get(k) for r in seg_rows(s, q)]
    if not xs or any(x is None for x in xs):
        return None
    return fsum(xs)


def cos(s, q=None, rep=False, main=False, need=()):
    out = []
    for r in seg_rows(s, q):
        c = gid(r["g"])
        if not c or (main and c not in MAIN8):
            continue
        if rep and not r.get("rep"):
            continue
        if any(r.get(k) is None for k in need):
            continue
        out.append(c)
    return out


# ------------------------------------------------------------------------------------------------ regulator provenance
def preg(metric, month, w, s, c=None, value="", unit=""):
    return P_reg_seg(metric, L().pi(month), w, s, mg(c), f"{REG_HE[metric]} · {who(c)} · {SEG_HE[s]} · {ym(month)}", value, unit)


def money(v):
    """an amount in NIS millions as a figure unit: millions below a billion, billions above"""
    return ("m", v) if v is None or abs(v) < 1000 else ("bn", v / 1000)


def f_amt(label, v_m, prov, asof, c=None, signed=True):
    u, v = money(v_m)
    return fig(label, v, u, prov, asof, signed=signed, c=c)


def f_tr(c, s, q):
    r = row(c, s, q) if c else None
    v = r["reg"]["tr"] if c else mkt(s, q, "tr")
    return f_amt(f"העברות נטו, {who(c)}, {SEG_HE[s]}", v, preg("transfers", qe(q), "q", s, c, nf(v, 1), MM), lq(q), c)


def f_org(c, s, q):
    v = row(c, s, q)["reg"]["org"] if c else mkt(s, q, "org")
    return f_amt(f"צבירה אורגנית, {who(c)}, {SEG_HE[s]}", v, preg("organic", qe(q), "q", s, c, nf(v, 1), MM), lq(q), c)


def net(c, s, q):
    if c:
        rg = row(c, s, q)["reg"]
        return None if rg["org"] is None or rg["tr"] is None else rg["org"] + rg["tr"]
    o, t = mkt(s, q, "org"), mkt(s, q, "tr")
    return None if o is None or t is None else o + t


def f_net(c, s, q):
    v = net(c, s, q)
    return f_amt(f"צבירה נטו כולל ניוד, {who(c)}, {SEG_HE[s]}", v, preg("netflow", qe(q), "q", s, c, nf(v, 1), MM), lq(q), c)


def f_aum(c, s, q):
    v = row(c, s, q)["reg"]["aE"] if c else mkt(s, q, "aE")
    return fig(f"נכסים, {who(c)}, {SEG_HE[s]}", v / 1000, "bn", preg("assets", qe(q), "m", s, c, nf(v, 0), MM), ym(qe(q)), c=c)


def f_share(c, s, q, what="aum_share"):
    r = row(c, s, q)
    lab = "נתח נכסים" if what == "aum_share" else "נתח מהצבירה נטו"
    return fig(f"{lab}, {he(c)}, {SEG_HE[s]}", r[what], "pct", L().prov_share(c, s, q, what), lq(q), c=c)


def growth(c, s, q):
    if c:
        return row(c, s, q)["growth"]
    n, a0 = net(None, s, q), mkt(s, q, "aO")
    return None if n is None or not a0 else n / a0 * 100


def f_growth(c, s, q):
    v = growth(c, s, q)
    a0 = row(c, s, q)["reg"]["aO"] if c else mkt(s, q, "aO")
    p = P_calc(f"צמיחה מצבירה נטו · {who(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(v, 2)}%", "%",
               "(צבירה אורגנית + העברות נטו) ברבעון ÷ נכסים בסוף הרבעון הקודם × 100. לא שנתי, ללא תשואה",
               [("צבירה נטו כולל ניוד", nf(net(c, s, q), 1), preg("netflow", qe(q), "q", s, c)),
                (f"נכסים · {ym(madd(qe(q), -3))}", nf(a0, 0), preg("assets", madd(qe(q), -3), "m", s, c))])
    return fig(f"צמיחה מצבירה נטו, {who(c)}, {SEG_HE[s]}", v, "pct", p, lq(q), d=2, signed=True, c=c)


# ------------------------------------------------------------------------------------------------ regulator months (lens series)
def months():
    return L().months


def mser(c, s, k):
    """monthly series k (a / org / tr / fee) of a group, or of the market (c None: the sum over every group)"""
    if c:
        x = L().series(c, s)
        return x[k] if x else None
    out = None
    for g in range(len(L().groups)):
        x = L().L["series"].get(f"{g}|{s}")
        if not x:
            continue
        out = list(x[k]) if out is None else [None if a is None or b is None else a + b for a, b in zip(out, x[k])]
    return out


def msum(c, s, k, ms):
    xs, M = mser(c, s, k), months()
    if xs is None:
        return None
    v = [xs[M.index(m)] for m in ms]
    return None if any(x is None for x in v) else fsum(v)


def f_msum(c, s, k, ms, label=None):
    """the sum of a flow over months: one LTM aggregate when the window is the twelve months, else a calc over the months"""
    v = msum(c, s, k, ms)
    metric = {"tr": "transfers", "org": "organic"}[k]
    lab = label or f"{REG_HE[metric]}, {who(c)}, {SEG_HE[s]}"
    span = f"{ym(ms[0])}–{ym(ms[-1])}"
    if len(ms) == 12:
        p = preg(metric, ms[-1], "ltm", s, c, nf(v, 1), MM)
    elif len(ms) == 3 and ms[-1] % 100 in (3, 6, 9, 12):
        p = preg(metric, ms[-1], "q", s, c, nf(v, 1), MM)
    else:
        xs, M = mser(c, s, k), months()
        p = P_calc(f"{REG_HE[metric]} · {who(c)} · {SEG_HE[s]} · {span}", nf(v, 1), MM, "סכום החודשים שפורסמו",
                   [(ym(m), nf(xs[M.index(m)], 1), preg(metric, m, "m", s, c)) for m in ms])
    return f_amt(lab, v, p, span, c)


def qtd_months():
    return L().L["nowcast"]["months"]


def ltm_months():
    M = months()
    return M[-12:]


# ------------------------------------------------------------------------------------------------ reported (segment P&L)
def plts(c, s, metric, q):
    return L().prov_lts(c, s, metric, q)


def rep(c, s, q, k):
    r = row(c, s, q)
    return None if not r or not r.get("rep") else r["rep"].get(k)


def f_rep(c, s, q, k):
    v = rep(c, s, q, k)
    return fig(f"{LTS_HE[k]}, {he(c)}, {SEG_HE[s]}", v, "m", plts(c, s, k, q), lq(q), c=c)


def avg_prov(c, s, q):
    r = row(c, s, q)
    e = r["reg"]["e"]
    ms = [madd(e, -3), madd(e, -2), madd(e, -1), e]
    return P_calc(f"נכסים ממוצעים, רשות · {he(c)} · {SEG_HE[s]} · {lq(q)}", nf(r["reg"]["avg"], 0), MM,
                  "(A₀ ÷ 2 + A₁ + A₂ + A₃ ÷ 2) ÷ 3: טרפז על ארבעה סופי חודש; A₀ = סוף הרבעון הקודם (lens.json avg_reg)",
                  [(f"נכסים · {ym(m)}", nf(x, 0), preg("assets", m, "m", s, c)) for m, x in zip(ms, r["reg"]["m"])])


def f_fy(c, s, q):
    r = row(c, s, q)
    p = P_calc(f"תשואת דמי ניהול · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(r['fy_reg'], 3)}%", "שנתי",
               "הכנסות מדמי ניהול ברבעון (מהדוח) × 4 ÷ נכסים ממוצעים ברבעון (רשות) × 100 (lens.json fy_reg)",
               [("הכנסות מדמי ניהול", nf(r["rep"]["fees"], 1), plts(c, s, "fees", q)), ("נכסים ממוצעים, רשות", nf(r["reg"]["avg"], 0), avg_prov(c, s, q))])
    return fig(f"תשואת דמי ניהול, {he(c)}, {SEG_HE[s]}", r["fy_reg"], "pct", p, lq(q), d=2, c=c)


def f_ci(c, s, q):
    r = row(c, s, q)
    return fig(f"יחס הוצאות להכנסות, {he(c)}, {SEG_HE[s]}", r["ci"], "pct", L().prov_ci(c, s, q), lq(q), c=c)


def ltm(c, s, q):
    """four quarters to q of a group's segment: fees, sm, ga, op (sums) and avg (mean of the quarterly averages); None if a gap"""
    qs = qwin(q, 4)
    if not qs:
        return None
    rs = [row(c, s, k) for k in qs]
    if any(r is None or not r.get("rep") or r["reg"]["avg"] is None for r in rs):
        return None
    o = {"qs": qs}
    for k in ("fees", "sm", "ga", "op"):
        xs = [r["rep"][k] for r in rs]
        o[k] = None if any(x is None for x in xs) else fsum(xs)
    o["avg"] = fsum(r["reg"]["avg"] for r in rs) / 4
    o["ci"] = None if not o["fees"] or o["sm"] is None or o["ga"] is None else (o["sm"] + o["ga"]) / o["fees"] * 100
    o["fy"] = None if o["fees"] is None else o["fees"] / o["avg"] * 100
    o["ppb"] = None if o["op"] is None else o["op"] / (o["avg"] / 1000)
    o["gab"] = None if o["ga"] is None else o["ga"] / o["avg"] * 10000
    return o


def _ltm_inputs(c, s, qs, ks):
    return [(f"{LTS_HE[k]} · {lq(k2)}", nf(rep(c, s, k2, k), 1), plts(c, s, k, k2)) for k2 in qs for k in ks]


def f_ci_ltm(c, s, q):
    o = ltm(c, s, q)
    p = P_calc(f"יחס הוצאות להכנסות LTM · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(o['ci'], 1)}%", "%",
               "Σ (שיווק ומכירה + הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול × 100, ארבעה רבעונים",
               _ltm_inputs(c, s, o["qs"], ("sm", "ga", "fees")), note=MEITAV_NOTE if c == "meitav" else None)
    return fig(f"יחס הוצאות להכנסות LTM, {he(c)}, {SEG_HE[s]}", o["ci"], "pct", p, f"LTM {lq(q)}", c=c)


def _avg_ltm_input(c, s, o):
    return ("נכסים ממוצעים, רשות (ממוצע ארבעת הרבעונים)", nf(o["avg"], 0),
            P_calc(f"נכסים ממוצעים LTM · {he(c)} · {SEG_HE[s]}", nf(o["avg"], 0), MM, "ממוצע ארבעת הנכסים הממוצעים הרבעוניים",
                   [(lq(k), nf(row(c, s, k)["reg"]["avg"], 0), avg_prov(c, s, k)) for k in o["qs"]]))


def f_fy_ltm(c, s, q):
    o = ltm(c, s, q)
    p = P_calc(f"תשואת דמי ניהול LTM · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(o['fy'], 3)}%", "שנתי",
               "Σ הכנסות מדמי ניהול בארבעה רבעונים ÷ ממוצע הנכסים הממוצעים הרבעוניים (רשות) × 100",
               _ltm_inputs(c, s, o["qs"], ("fees",)) + [_avg_ltm_input(c, s, o)])
    return fig(f"תשואת דמי ניהול LTM, {he(c)}, {SEG_HE[s]}", o["fy"], "pct", p, f"LTM {lq(q)}", d=2, c=c)


def f_ppb_ltm(c, s, q):
    o = ltm(c, s, q)
    p = P_calc(f"רווח תפעולי לכל מיליארד נכסים LTM · {he(c)} · {SEG_HE[s]} · {lq(q)}", nf(o["ppb"], 2), "מיליוני ש\"ח למיליארד",
               "Σ רווח תפעולי בארבעה רבעונים (דמי ניהול − שיווק ומכירה − הנהלה וכלליות, מהדוח) ÷ נכסים ממוצעים במיליארדים (רשות)",
               _ltm_inputs(c, s, o["qs"], ("op",)) + [_avg_ltm_input(c, s, o)], note=MEITAV_NOTE if c == "meitav" else None)
    return fig(f"רווח תפעולי לכל ₪ מיליארד נכסים LTM, {he(c)}, {SEG_HE[s]}", o["ppb"], "m", p, f"LTM {lq(q)}", d=2, c=c)


def f_sum_ltm(c, s, q, k):
    o = ltm(c, s, q)
    p = P_calc(f"{LTS_HE[k]} LTM · {he(c)} · {SEG_HE[s]} · {lq(q)}", nf(o[k], 1), MM, "סכום ארבעה רבעונים, מהדוח",
               _ltm_inputs(c, s, o["qs"], (k,)))
    return fig(f"{LTS_HE[k]} LTM, {he(c)}, {SEG_HE[s]}", o[k], "m", p, f"LTM {lq(q)}", signed=(k == "op"), c=c)


def sector(s, q, cs, field):
    """the sector ratio over a set of companies, LTM: ci, fy, ppb (sums of the parts, not a mean of the ratios)"""
    os = [ltm(c, s, q) for c in cs]
    if any(o is None for o in os):
        return None
    F = fsum(o["fees"] for o in os)
    A_ = fsum(o["avg"] for o in os)
    if field == "ci":
        return fsum(o["sm"] + o["ga"] for o in os) / F * 100
    if field == "fy":
        return F / A_ * 100
    if field == "ppb":
        return fsum(o["op"] for o in os) / (A_ / 1000)
    if field == "gab":
        return fsum(o["ga"] for o in os) / A_ * 10000
    raise ValueError(field)


def f_sector(s, q, cs, field, label=None):
    v = sector(s, q, cs, field)
    o = {c: ltm(c, s, q) for c in cs}
    names = ", ".join(he(c) for c in cs)
    if field == "ci":
        p = P_calc(f"יחס הוצאות להכנסות LTM · הענף · {SEG_HE[s]} · {lq(q)}", f"{nf(v, 1)}%", "%",
                   f"Σ החברות (שיווק ומכירה + הנהלה וכלליות) ÷ Σ הכנסות מדמי ניהול × 100, ארבעה רבעונים. חברות: {names}",
                   [(he(c), f"{nf(o[c]['ci'], 1)}%", f_ci_ltm(c, s, q)["prov"]) for c in cs])
        return fig(label or f"יחס הוצאות להכנסות LTM, הענף, {SEG_HE[s]}", v, "pct", p, f"LTM {lq(q)}")
    if field == "fy":
        p = P_calc(f"תשואת דמי ניהול LTM · הענף · {SEG_HE[s]} · {lq(q)}", f"{nf(v, 3)}%", "שנתי",
                   f"Σ הכנסות מדמי ניהול של החברות ÷ Σ הנכסים הממוצעים שלהן × 100, ארבעה רבעונים. חברות: {names}",
                   [(he(c), f"{nf(o[c]['fy'], 3)}%", f_fy_ltm(c, s, q)["prov"]) for c in cs])
        return fig(label or f"תשואת דמי ניהול LTM, הענף, {SEG_HE[s]}", v, "pct", p, f"LTM {lq(q)}", d=2)
    if field == "ppb":
        p = P_calc(f"רווח תפעולי לכל מיליארד LTM · הענף · {SEG_HE[s]} · {lq(q)}", nf(v, 2), "מיליוני ש\"ח למיליארד",
                   f"Σ רווח תפעולי של החברות ÷ Σ הנכסים הממוצעים שלהן במיליארדים, ארבעה רבעונים. חברות: {names}",
                   [(he(c), nf(o[c]["ppb"], 2), f_ppb_ltm(c, s, q)["prov"]) for c in cs])
        return fig(label or f"רווח תפעולי לכל ₪ מיליארד LTM, הענף, {SEG_HE[s]}", v, "m", p, f"LTM {lq(q)}", d=2)
    raise ValueError(field)


LOCAL = " · שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"


def _ins(fs, local, key="asof"):
    return [(f[key], f["t"], None if local else f["prov"]) for f in fs]


def f_bp(label, a, b, fa, fb, asof, c=None, unit_note="נ״ב", local=False):
    """the change between two percent figures, in basis points, as a calc over the two (each with its own provenance).
    local=True: both inputs are figures of the same answer, so their trees are not repeated inside this node"""
    v = (a - b) * 100
    p = P_calc(f"שינוי · {label}", f"{nf(v, 1)} {unit_note}", unit_note, f"({fa['asof']} − {fb['asof']}) × 100" + (LOCAL if local else ""),
               _ins((fa, fb), local))
    return fig(label, v, "bp", p, asof, d=1, c=c)


def f_pp(label, a, b, fa, fb, asof, c=None, local=False, d=2):
    v = a - b
    p = P_calc(f"שינוי · {label}", f"{nf(v, 2)} נק׳", "נק׳ אחוז", f"{fa['asof']} − {fb['asof']}" + (LOCAL if local else ""), _ins((fa, fb), local))
    return fig(label, v, "pp", p, asof, d=d, c=c)


def f_diff(label, fa, fb, u, asof, c=None, d=None, local=True):
    v = fa["v"] - fb["v"]
    p = P_calc(f"פער · {label}", nf(v, 2), "", f"{fa['l']} − {fb['l']}" + (LOCAL if local else ""), _ins((fa, fb), local, "l"))
    return fig(label, v, u, p, asof, d=d, signed=True, c=c)


def f_ratio(label, fa, fb, asof, c=None, pct=False, d=None, local=True):
    v = fa["v"] / fb["v"] * (100 if pct else 1)
    p = P_calc(f"יחס · {label}", nf(v, 2), "%" if pct else "×", f"{fa['l']} ÷ {fb['l']}" + (" × 100" if pct else "") + (LOCAL if local else ""),
               _ins((fa, fb), local, "l"))
    return fig(label, v, "pct" if pct else "x", p, asof, d=d, c=c)


# ------------------------------------------------------------------------------------------------ the sector deck facts (lts.json)
_F = None


def lfacts():
    global _F
    if _F is None:
        _F = {(m, c, p): v for m, c, p, v, _ in load("lts.json")["facts"]}
    return _F


def lts_key(c):
    """lens company id -> lts.json company key (idi -> direct); None (the market) -> 'all'"""
    if c is None:
        return "all"
    g = L().g(c)
    return L().groups[g]["lts"] if g is not None else c


LTS_U = {"aum": "bn", "tr_in": "bn", "tr_out": "bn", "tr_net": "bn", "dep": "bn", "nb": "bn"}
LTS_LABEL = {"out_rate": "שיעור ניוד החוצה, שנתי", "fee_a": "דמי ניהול מהצבירה", "fee_d": "דמי ניהול מהפקדות", "tr_in": "העברות צבירה לקרן",
             "tr_out": "העברות צבירה מהקרן", "tr_net": "העברות צבירה נטו", "nb": "הפקדות מצטרפים חדשים", "nb.share": "נתח מהפקדות המצטרפים החדשים",
             "sm_aum": "שיווק ומכירה לנכסים", "ga_aum": "הנהלה וכלליות לנכסים", "dep": "דמי גמולים", "fees": "הכנסות מדמי ניהול",
             "sm": "שיווק ומכירה", "ga": "הנהלה וכלליות", "op": "רווח תפעולי"}


def lv(c, fam, m, p):
    return lfacts().get((f"{fam}.{m}", lts_key(c), p))


def f_lts(c, fam, m, p, d=None):
    v = lv(c, fam, m, p)
    if v is None:
        return None
    u = LTS_U.get(m, "pct" if m not in ("fees", "sm", "ga", "op") else "m")
    lab = f"{LTS_LABEL[m]}, {'החברות המכוסות' if c is None else he(c)}, {SEG_HE[fam]}"
    unit_he = {"bn": 'מיליארדי ש"ח', "m": MM, "pct": "%"}[u]
    return fig(lab, v, u, P_lts(lts_key(c), f"{fam}.{m}", p, lab.replace(", ", " · "), unit_he, nf(v, 3 if u == "pct" else 2)), lq(p),
               d=(d if d is not None else (2 if u in ("pct", "bn") else None)), c=c)


# ------------------------------------------------------------------------------------------------ fragility, funds
def frag(c):
    for r in load("fragility.json")["rows"]:
        if r["c"] == c:
            return r
    return None


def fsig(c, sid, seg):
    r = frag(c)
    if not r:
        return None
    s = (r["sig"].get(sid) or {}).get("segs", {}).get(seg)
    return s if s and s.get("st") != "nodata" and s.get("v") is not None else None


def name_to_id():
    return {g["name"]: g["id"] for g in L().groups if g.get("id")}


def best_track(prod, track, grp_name):
    """the group's largest open track of a category (no personal-management IRA tracks)"""
    xs = [f for f in load("funds.json")["funds"] if f["prod"] == prod and f["track"] == track and f["grp"] == grp_name
          and not f.get("closed") and "בניהול אישי" not in f["name"] and f.get("y12") is not None]
    return max(xs, key=lambda f: f["assets"]) if xs else None


def f_y12(f, c):
    asof = load("funds.json")["asof"]
    ds = {"p": "pensia", "g": "gemel", "i": "insurance"}[f["k"][0]]
    span = f"{ym(madd(asof, -11))}–{ym(asof)}"
    p = P_fund(f"תשואה 12 חודשים · {f['name']}", f"{nf(f['y12'], 2)}%", "%", ds, f["id"], asof, "MONTHLY_YIELD",
               f"{span}: ריבית דריבית של 12 התשואות החודשיות שפורסמו (funds.json y12)")
    return fig(f"תשואה 12 חודשים, {f['name']}", f["y12"], "pct", p, ym(asof), c=c)


# ------------------------------------------------------------------------------------------------ exhibits and words
def hbar(title, unit, items, foot, span=None, name=None, d=3):
    """items: [(company id or label, value)], drawn in the given order"""
    cats = [he(c) for c, _ in items]
    return exhibit("hbar", title, unit, cats, [{"name": name or title, "type": "bar", "data": [None if v is None else round(v, d) for _, v in items]}],
                   foot, span=span)


def lines(title, unit, qs, ser, foot, d=3):
    """ser: [(name, [values])]"""
    return exhibit("line", title, unit, [lq(k) for k in qs], [{"name": n, "type": "line", "data": [None if v is None else round(v, d) for v in xs]}
                                                             for n, xs in ser], foot, span=f"{lq(qs[0])}–{lq(qs[-1])}")


def table(title, rows, foot, span=None):
    return exhibit("table", title, "", [], [], foot, span=span, rows=rows)


def rank_of(items, c, desc=True):
    xs = sorted(items, key=lambda x: -x[1] if desc else x[1])
    return [k for k, _ in xs].index(c) + 1


def names(cs):
    cs = [he(c) for c in cs]
    if len(cs) <= 1:
        return "".join(cs)
    return ", ".join(cs[:-1]) + " ו" + cs[-1]


SAV = link("עדשת החיסכון", "/savings")


def sav(s=None, v=None):
    qs = "&".join(x for x in ([f"v={v}"] if v else []) + ([f"s={s}"] if s and s != "pen" else []))
    return link("עדשת החיסכון" + (f" · {SEG_HE[s]}" if s else ""), "/savings" + (f"?{qs}" if qs else ""))


def co_link(c):
    return link(he(c), f"/company/{c}")


def frag_link(c=None, sig=None):
    q = "&".join(x for x in ([f"c={c}"] if c else []) + ([f"s={sig}"] if sig else []))
    return link("מוניטור השבריריות", "/fragility" + (f"?{q}" if q else ""))


def f_gap(label, fa, fb, va_m, vb_m, asof, c=None, local=True):
    """the gap between two amounts (NIS millions), as a calc over the two figures (by default both shown in the same answer)"""
    v = va_m - vb_m
    p = P_calc(f"פער · {label}", nf(v, 1), MM, f"{fa['l']} − {fb['l']}" + (LOCAL if local else ""), _ins((fa, fb), local, "l"))
    return f_amt(label, v, p, asof, c)


def ltm_months_at(q):
    e = qe(q)
    return [madd(e, -k) for k in range(11, -1, -1)]
