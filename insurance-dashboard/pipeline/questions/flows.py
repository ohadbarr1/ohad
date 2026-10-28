"""Flows and share: who is taking transfers, against what size (Savings Lens rows, regulator aggregates)."""
from answer_core import (Lens, P_calc, SEG_HE, answer, changes_if, exhibit, fig, he, link, lq, nf, nodata, question)

_L = None


def L():
    global _L
    if _L is None:
        _L = Lens()
    return _L


def flow_ratio(c, s, q):
    """flow share ÷ asset share of a quarter, or None"""
    r = L().row(c, s, q)
    if not r or r.get("flow_share") is None or not r.get("aum_share"):
        return None
    return r["flow_share"] / r["aum_share"]


def ratio_fig(c, s, q, label=None):
    r = L().row(c, s, q)
    x = flow_ratio(c, s, q)
    p = P_calc(f"נתח ניוד ÷ נתח נכסים · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(x, 2)}×", "×",
               "נתח הניוד ברבעון ÷ נתח הנכסים בסוף הרבעון (מעל 1×: לוקח העברות מעבר לגודלו)",
               [("נתח ניוד", f"{nf(r['flow_share'], 1)}%", L().prov_share(c, s, q, "flow_share")),
                ("נתח נכסים", f"{nf(r['aum_share'], 1)}%", L().prov_share(c, s, q, "aum_share"))])
    return fig(label or f"נתח ניוד ÷ נתח נכסים, {he(c)}, {SEG_HE[s]}", x, "x", p, lq(q), d=1, c=c)


def share_fig(c, s, q, what):
    r = L().row(c, s, q)
    lab = "נתח ניוד" if what == "flow_share" else "נתח נכסים"
    return fig(f"{lab}, {he(c)}, {SEG_HE[s]}", r[what], "pct", L().prov_share(c, s, q, what), lq(q), c=c)


@question("Q-001", "האם מור לוקחת נתח מעבר לגודלה, בגמל ובפנסיה?", ["ceo", "strat", "dist"], "flows", ["more"])
def q001(A):
    lens, c, q = L(), "more", L().last_q
    rg, rp = flow_ratio(c, "gem", q), flow_ratio(c, "pen", q)
    if rg is None or rp is None:
        return nodata(f"אין שורת עדשה למור בגמל או בפנסיה ל-{lq(q)}")
    figs = {"rg": ratio_fig(c, "gem", q), "rp": ratio_fig(c, "pen", q),
            "fg": share_fig(c, "gem", q, "flow_share"), "ag": share_fig(c, "gem", q, "aum_share"),
            "fp": share_fig(c, "pen", q, "flow_share"), "ap": share_fig(c, "pen", q, "aum_share")}
    yes_g, yes_p = rg > 1, rp > 1
    vk = f"gem:{'y' if yes_g else 'n'}|pen:{'y' if yes_p else 'n'}"
    word = {True: "כן", False: "לא"}
    if yes_g and yes_p:
        corr = "כן, בשני המוצרים: בגמל מור לוקחת העברות בקצב של {rg} מגודלה."
    elif yes_g:
        corr = "בגמל כן ובפנסיה לא: בגמל מור לוקחת העברות בקצב של {rg} מגודלה."
    elif yes_p:
        corr = "בפנסיה כן ובגמל לא: בפנסיה מור לוקחת העברות בקצב של {rp} מגודלה."
    else:
        corr = "לא: בגמל מור לוקחת העברות בקצב של {rg} בלבד מגודלה."
    email = (f"גמל ({word[yes_g]}): נתח הניוד של מור ב-{lq(q)} הוא {{fg}} מול נתח נכסים של {{ag}}, יחס של {{rg}}. "
             f"פנסיה ({word[yes_p]}): נתח ניוד של {{fp}} מול נתח נכסים של {{ap}}, יחס של {{rp}}.")
    qs = lens.quarters[-8:]
    ser = [{"name": SEG_HE[s], "type": "line", "data": [None if flow_ratio(c, s, k) is None else round(flow_ratio(c, s, k), 3) for k in qs]}
           for s in ("gem", "pen")]
    ex = exhibit("line", "מור: נתח ניוד ÷ נתח נכסים, לפי רבעון", "×", [lq(k) for k in qs], ser,
                 ["מעל 1×: הקבוצה לוקחת העברות מעבר לגודלה", "רשות שוק ההון: גמל-נט, פנסיה-נט (העברות נטו, נכסים)"],
                 span=f"{lq(qs[0])}–{lq(qs[-1])}")
    chg = changes_if("התשובה בגמל מתהפכת כשהיחס יורד אל מתחת ל-{thr}", "rg", "<" if yes_g else ">=", 1.0)
    return answer(figs, corr, email, ex, chg, vk, links=[link("עדשת החיסכון", "/savings")], asof=lq(q))
