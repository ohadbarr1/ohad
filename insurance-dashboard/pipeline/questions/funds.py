"""Funds and tracks (topic `funds`, module F1): the standing questions a saver, an advisor or a distributor asks about the tracks themselves,
answered from the regulator's track files as fox publishes them: funds.json (live tracks, gross as published plus the net-of-fee estimate,
real returns and percentile ranks), funds/closed.json (tracks that stopped reporting), funds/<k>.json (monthly histories) and
funds/cat.json (point-in-time category returns).

Rules of the family: a published return is GROSS of fees (docs/FACTS.md); every net or real figure is basis "estimate" and its provenance
is a calc node over the published gross figure and the published fee. Peer sets are the live tracks of one category (product | track)
that are open to the public (not a sector fund), with assets, excluding personal-management and IRA tracks. Links deep-link into the
/funds pages with their state in the URL (screener: prod, track, per, b; compare: k, win, b).
"""
import math
import statistics
from urllib.parse import quote

from answer_core import P_calc, P_fund, answer, changes_if, dlab, exhibit, fig, link, load, nf, nodata, question, ym
from questions._sav import SRC_REG, table

DS = {"g": "gemel", "p": "pensia", "i": "insurance"}
COL = {"m1": "MONTHLY_YIELD", "ytd": "YEAR_TO_DATE_YIELD", "y3": "YIELD_TRAILING_3_YRS", "y5": "YIELD_TRAILING_5_YRS",
       "a3": "AVG_ANNUAL_YIELD_TRAILING_3YRS", "a5": "AVG_ANNUAL_YIELD_TRAILING_5YRS", "y12": "MONTHLY_YIELD", "fee": "AVG_ANNUAL_MANAGEMENT_FEE",
       "assets": "TOTAL_ASSETS", "alpha": "ALPHA", "act": "ACTUARIAL_ADJUSTMENT", "nd": "NET_MONTHLY_DEPOSITS", "depfee": "AVG_DEPOSIT_FEE"}
WL = {"a5": "ממוצע שנתי ב-5 שנים", "a3": "ממוצע שנתי ב-3 שנים", "y12": "12 חודשים", "m1": "החודש", "ytd": "מתחילת השנה"}
PER = {"a5": "a5", "a3": "a3", "y12": "y12"}
WIN = {"a5": 60, "a3": 36, "y12": 12}
NET_SHORT = "נטו, אומדן: התשואה ברוטו שפורסמה פחות דמי הניהול מהצבירה של כל חודש ÷ 12, מצטבר על חודשי התקופה (funds.json net_method)"
FOOT_NET = ["נטו = אומדן: תשואה ברוטו כפי שפורסמה פחות שיעור דמי הניהול הממוצע מהצבירה של המסלול בכל חודש ÷ 12; לא דמי הניהול של חוסך מסוים",
            "קבוצת ההשוואה: המסלולים הפעילים בקטגוריה, פתוחים לציבור, עם נכסים; ללא ניהול אישי ו-IRA", SRC_REG]
SRC_CLOSED = "funds/closed.json: מסלולים שהפסיקו לדווח, השורה של החודש האחרון שלהם · " + SRC_REG


# ------------------------------------------------------------------------------------------------ data
def F():
    return load("funds.json")


def asof():
    return F()["asof"]


def AS():
    return ym(asof())


def members(prod, track, need=None):
    """the peer set of a category; need = a window that must have a net figure"""
    xs = [f for f in F()["funds"] if f["prod"] == prod and f["track"] == track and not f.get("closed") and (f.get("assets") or 0) > 0
          and "בניהול אישי" not in f["name"] and "IRA" not in f["name"]]
    if need:
        xs = [f for f in xs if f.get("net", {}).get(need) is not None]
    return xs


def screen(prod, track, per="a5", b="net"):
    return link(f"סינון: {prod}, {track}", f"/funds/screen?prod={quote(prod, safe='')}&track={quote(track, safe='')}&per={per}&b={b}")


def card(f, b="net"):
    return link(f"כרטיס המסלול: {f['name']}", f"/funds/{f['k']}?b={b}")


def compare(fs, win=60, b="net"):
    return link("השוואה: " + " · ".join(f["grp"] for f in fs), f"/funds/compare?k={','.join(f['k'] for f in fs)}&win={win}&b={b}")


# ------------------------------------------------------------------------------------------------ provenance and figures
def p_pub(f, col_key, title, text=None, unit="%", period=None):
    v = f.get(col_key)
    return P_fund(f"{title} · {f['name']}", text if text is not None else (f"{nf(v, 2)}%" if unit == "%" else nf(v, 1)), unit,
                  DS[f["k"][0]], f["id"], period or asof(), COL[col_key])


def p_y12(f, net=False):
    span = f"{ym(madd(asof(), -11))}–{AS()}"
    return P_fund(f"תשואה 12 חודשים, ברוטו · {f['name']}", f"{nf(f['y12'], 2)}%", "%", DS[f["k"][0]], f["id"], asof(), "MONTHLY_YIELD",
                  f"{span}: ריבית דריבית של 12 התשואות החודשיות שפורסמו (funds.json y12)")


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def p_gross(f, w):
    return p_y12(f) if w == "y12" else p_pub(f, w, f"תשואה {WL[w]}, ברוטו")


def f_gross(f, w, label=None, c=None):
    return fig(label or f"תשואה {WL[w]}, ברוטו, {f['name']}", f[w], "pct", p_gross(f, w), AS(), d=2, c=c)


def p_net(f, w):
    v = f["net"][w]
    return P_calc(f"תשואה {WL[w]}, נטו (אומדן) · {f['name']}", f"{nf(v, 2)}%", "%", NET_SHORT,
                  [(f"תשואה {WL[w]}, ברוטו", f"{nf(f[w], 2)}%", p_gross(f, w)),
                   ("דמי ניהול מהצבירה, החודש", f"{nf(f.get('fee'), 2)}%", p_pub(f, "fee", "דמי ניהול מהצבירה")),
                   ("היסטוריית דמי הניהול החודשית", f"funds/{f['k']}.json", None)], est=True)


def f_net(f, w, label=None, c=None):
    return fig(label or f"תשואה {WL[w]}, נטו, {f['name']}", f["net"][w], "pct", p_net(f, w), AS(), b="estimate", d=2, c=c)


def f_fee(f, label=None):
    return fig(label or f"דמי ניהול מהצבירה, {f['name']}", f["fee"], "pct", p_pub(f, "fee", "דמי ניהול מהצבירה"), AS(), d=2)


def f_calc(label, v, unit, title, formula, inputs, d=2, b="actual", signed=False, est=False, unit_txt=None, asof=None):
    """a calculated figure; `asof` = the month of its inputs when they are not the funds file's month (e.g. a quarterly field)"""
    text = {"pct": f"{nf(v, d)}%", "pp": f"{nf(v, d)} נק׳", "n": nf(v, 0), "bn": f"₪{nf(v, 1)} מיליארד", "m": f"₪{nf(v, 0)} מיליון"}.get(unit, nf(v, d))
    return fig(label, v, unit, P_calc(title, text, unit_txt or {"pct": "%", "pp": "נק׳ אחוז", "n": "", "bn": "מיליארד ש\"ח", "m": "מיליון ש\"ח"}.get(unit, ""),
                                      formula, inputs, est=est), asof or AS(), b=b, d=d, signed=signed)


def med_fig(xs, w, label, net=True):
    vals = [(f["net"][w] if net else f[w]) for f in xs]
    m = statistics.median(vals)
    return f_calc(label, m, "pct", label, f"חציון {'התשואה נטו' if net else 'התשואה ברוטו'} של המסלולים בקטגוריה",
                  [(f"{f['grp']} · {f['name']}", f"{nf(v, 2)}%", p_net(f, w) if net else p_gross(f, w)) for f, v in zip(xs, vals)],
                  b="estimate" if net else "actual", est=net)


def gap_fig(label, a, b_, title, basis="estimate"):
    return f_calc(label, a["v"] - b_["v"], "pp", title, f"{a['l']} − {b_['l']}", [(a["l"], a["t"], None), (b_["l"], b_["t"], None)],
                  b=basis, est=basis == "estimate")


def wavg(xs, val, w=lambda f: f["assets"]):
    W = math.fsum(w(f) for f in xs)
    return math.fsum(val(f) * w(f) for f in xs) / W if W else None


def net_table(title, xs, w, extra=()):
    rows_ = [["מנהל", "מסלול", f"נטו, {WL[w]}", f"ברוטו, {WL[w]}", "דמי ניהול", "אחוזון נטו", "נכסים (מיליוני ש\"ח)"]]
    for f in xs:
        rows_.append([f["grp"], f["name"], f"{nf(f['net'].get(w), 2)}%", f"{nf(f.get(w), 2)}%", f"{nf(f.get('fee'), 2)}%",
                      nf(f.get("pn", {}).get(w), 0), nf(f["assets"], 0)])
    return table(title, rows_, list(extra) + FOOT_NET, span=AS())


# ------------------------------------------------------------------------------------------------ the leader of a category, net
def leader(prod, track, title, w, rel):
    xs = sorted(members(prod, track, w), key=lambda f: -f["net"][w])
    if len(xs) < 5:
        return nodata(f"פחות מחמישה מסלולים עם תשואה נטו ל{WL[w]} ב{title}")
    top, sec, bot = xs[0], xs[1], xs[-1]
    figs = {"top": f_net(top, w, f"תשואה נטו, {WL[w]}, {top['grp']}, {title}"),
            "topg": f_gross(top, w, f"תשואה ברוטו, {WL[w]}, {top['grp']}, {title}"),
            "fee": f_fee(top, f"דמי ניהול מהצבירה, {top['grp']}, {title}"),
            "med": med_fig(xs, w, f"חציון התשואה נטו, {WL[w]}, {title}"),
            "bot": f_net(bot, w, f"תשואה נטו, {WL[w]}, {bot['grp']}, {title}")}
    figs["gap"] = gap_fig(f"פער המוביל מהחציון, נטו, {title}", figs["top"], figs["med"], f"פער מהחציון · {title}")
    same = top["k"] == max(xs, key=lambda f: f[w] if f.get(w) is not None else -1e9)["k"]
    corr = f"{top['grp']}: {{top}} בשנה נטו ({WL[w]}), הגבוה ב{title}."
    email = (f"עד {AS()}, {WL[w]}: המסלול של {top['grp']} ב{title} הניב {{top}} בשנה נטו (אומדן; ברוטו {{topg}}, דמי ניהול מהצבירה {{fee}}). "
             f"חציון הקטגוריה {{med}}, כך שהפער של המוביל הוא {{gap}} בשנה; בתחתית {bot['grp']}, {{bot}}. "
             + ("המוביל בנטו הוא גם המוביל בברוטו." if same else "בברוטו המוביל אחר: דמי הניהול משנים את הדירוג."))
    ex = net_table(f"תשואה נטו, {WL[w]}, {title}, {AS()}", xs, w)
    chg = changes_if(f"המוביל מתחלף אם התשואה נטו של {top['grp']} יורדת אל מתחת ל-{{thr}}", "top", "<", sec["net"][w])
    return answer(figs, corr, email, ex, chg, f"top:{top['k']}|gross_same:{'y' if same else 'n'}",
                  links=[screen(prod, track, PER[w]), compare([top, sec], WIN[w]), card(top)], rel=rel, asof=AS())


@question("Q-200", "מי מוביל נטו ב-5 שנים בהשתלמות, מסלול כללי?", ["dist", "ceo", "board"], "funds")
def q200(A):
    return leader("השתלמות", "כללי", "השתלמות, מסלול כללי", "a5", ["Q-206", "Q-207", "Q-087"])


@question("Q-201", "מי מוביל נטו ב-5 שנים בפנסיה המקיפה, מסלול ברירת המחדל לבני חמישים ומטה?", ["dist", "ceo", "board", "reg"], "funds")
def q201(A):
    return leader("פנסיה מקיפה", "עד 50", "פנסיה מקיפה, מסלול לבני חמישים ומטה", "a5", ["Q-206", "Q-213", "Q-086"])


@question("Q-202", "מי מוביל נטו ב-5 שנים בהשתלמות, מסלול מניות?", ["dist", "ceo", "inv"], "funds")
def q202(A):
    return leader("השתלמות", "מניות", "השתלמות, מסלול מניות", "a5", ["Q-200", "Q-205"])


@question("Q-203", "מי מוביל נטו ב-5 שנים בפוליסות החיסכון, מסלול כללי?", ["dist", "ceo", "board"], "funds")
def q203(A):
    return leader("פוליסות חיסכון וביטוחי מנהלים (מ-2004)", "כללי", "פוליסות חיסכון וביטוחי מנהלים מ-2004, מסלול כללי", "a5", ["Q-200", "Q-207"])


@question("Q-204", "מי מוביל נטו ב-5 שנים בגמל, מסלול לבני חמישים עד שישים?", ["dist", "ceo"], "funds")
def q204(A):
    return leader("גמל", "50-60", "גמל, מסלול לבני חמישים עד שישים", "a5", ["Q-088", "Q-208"])


# ------------------------------------------------------------------------------------------------ fees
@question("Q-205", "בהשתלמות, האם הפער בין מסלולי המחקה של מדד S&P 500 נובע מדמי הניהול?", ["dist", "ceo", "strat"], "funds")
def q205(A):
    prod, track, w = "השתלמות", "עוקב מדד S&P 500", "y12"
    xs = sorted([f for f in members(prod, track, w) if f.get("y12") is not None and f.get("fee") is not None], key=lambda f: -f["net"][w])
    if len(xs) < 5:
        return nodata("פחות מחמישה מסלולי מחקה עם תשואה ודמי ניהול ל-12 חודשים")
    hi_g, lo_g = max(xs, key=lambda f: f["y12"]), min(xs, key=lambda f: f["y12"])
    hi_f, lo_f = max(xs, key=lambda f: f["fee"]), min(xs, key=lambda f: f["fee"])
    rg = hi_g["y12"] - lo_g["y12"]
    rf = hi_f["fee"] - lo_f["fee"]
    figs = {"rg": f_calc("טווח התשואה ברוטו ב-12 חודשים בין מסלולי המחקה", rg, "pp", "טווח התשואה ברוטו · מחקי S&P 500 · השתלמות",
                         "התשואה הגבוהה − הנמוכה, ברוטו, 12 חודשים", [(f"{hi_g['grp']} · {hi_g['name']}", f"{nf(hi_g['y12'], 2)}%", p_y12(hi_g)),
                                                                    (f"{lo_g['grp']} · {lo_g['name']}", f"{nf(lo_g['y12'], 2)}%", p_y12(lo_g))]),
            "rf": f_calc("טווח דמי הניהול מהצבירה בין מסלולי המחקה", rf, "pp", "טווח דמי הניהול · מחקי S&P 500 · השתלמות",
                         "דמי הניהול הגבוהים − הנמוכים", [(f"{hi_f['grp']}", f"{nf(hi_f['fee'], 2)}%", p_pub(hi_f, "fee", "דמי ניהול מהצבירה")),
                                                          (f"{lo_f['grp']}", f"{nf(lo_f['fee'], 2)}%", p_pub(lo_f, "fee", "דמי ניהול מהצבירה"))]),
            "top": f_net(xs[0], w, f"תשואה נטו, 12 חודשים, {xs[0]['grp']}, מחקה S&P 500 בהשתלמות"),
            "bot": f_net(xs[-1], w, f"תשואה נטו, 12 חודשים, {xs[-1]['grp']}, מחקה S&P 500 בהשתלמות")}
    share = rf / rg * 100 if rg > 0 else 100.0
    figs["sh"] = f_calc("חלק טווח דמי הניהול מטווח התשואה", share, "pct", "דמי ניהול ÷ פער תשואה · מחקי S&P 500",
                        "טווח דמי הניהול ÷ טווח התשואה ברוטו × 100 (חסם עליון לחלקם של דמי הניהול בפער)",
                        [("טווח דמי הניהול", figs["rf"]["t"], None), ("טווח התשואה", figs["rg"]["t"], None)], d=0)
    fees = share >= 50
    corr = ("ברובו כן" if fees else "לא בעיקר") + ": טווח דמי הניהול הוא {sh} מטווח התשואה בין מסלולי המחקה."
    email = (f"מסלולי ההשתלמות המחקים את אותו מדד הניבו ב-12 חודשים עד {AS()} תשואות ברוטו בטווח של {{rg}}, בעוד שדמי הניהול מהצבירה שלהם נבדלים ב-{{rf}} בלבד. "
             f"{'רוב הפער מוסבר בדמי הניהול' if fees else 'רוב הפער נובע מביצוע (מועד המרה, גידור מטבע, מזומן), לא מדמי הניהול'}: "
             f"נטו המוביל {xs[0]['grp']} עם {{top}} והאחרון {xs[-1]['grp']} עם {{bot}}.")
    ex = net_table(f"מסלולי המחקה של S&P 500 בהשתלמות, 12 חודשים, {AS()}", xs, w,
                   ["אותו מדד: פער ברוטו שאינו דמי ניהול = ביצוע (גידור מטבע, מועדי השקעה, מזומן)"])
    chg = changes_if("התשובה מתהפכת אם חלק דמי הניהול בפער חוצה את {thr}", "sh", "<" if fees else ">=", 50.0)
    return answer(figs, corr, email, ex, chg, "fees" if fees else "execution",
                  links=[screen(prod, track, "y12"), compare([xs[0], xs[-1]], 12)], rel=["Q-202", "Q-207"], asof=AS())


def drag_of(xs, w):
    """asset-weighted gross − net of a window, over tracks with both"""
    ys = [f for f in xs if f.get(w) is not None and f.get("net", {}).get(w) is not None]
    if not ys:
        return None, None, ys
    return wavg(ys, lambda f: f[w]), wavg(ys, lambda f: f["net"][w]), ys


@question("Q-206", "כמה דמי הניהול מורידים מהתשואה בפנסיה המקיפה, בשנה?", ["dist", "reg", "ceo", "board"], "funds")
def q206(A):
    xs = [f for f in F()["funds"] if f["prod"] == "פנסיה מקיפה" and (f.get("assets") or 0) > 0]
    g, n, ys = drag_of(xs, "a5")
    if g is None or len(ys) < 10:
        return nodata("אין מספיק מסלולי פנסיה מקיפה עם תשואה נטו ל-5 שנים")
    fee = wavg([f for f in ys if f.get("fee") is not None], lambda f: f["fee"])
    ins = [(f"{f['grp']} · {f['name']}", f"ברוטו {nf(f['a5'], 2)}% · נטו {nf(f['net']['a5'], 2)}% · נכסים {nf(f['assets'], 0)}", p_net(f, "a5")) for f in ys]
    figs = {"g": f_calc("תשואה ממוצעת שנתית ב-5 שנים, ברוטו, משוקללת בנכסים, פנסיה מקיפה", g, "pct", "ממוצע משוקלל ברוטו · פנסיה מקיפה",
                        "Σ נכסים × תשואה ממוצעת שנתית 5 שנים ברוטו ÷ Σ נכסים", ins),
            "n": f_calc("תשואה ממוצעת שנתית ב-5 שנים, נטו, משוקללת בנכסים, פנסיה מקיפה", n, "pct", "ממוצע משוקלל נטו · פנסיה מקיפה",
                        "Σ נכסים × תשואה ממוצעת שנתית 5 שנים נטו ÷ Σ נכסים", ins, b="estimate", est=True),
            "fee": f_calc("דמי ניהול מהצבירה, משוקללים בנכסים, פנסיה מקיפה", fee, "pct", "דמי ניהול משוקללים · פנסיה מקיפה",
                          "Σ נכסים × דמי ניהול מהצבירה ÷ Σ נכסים", [(f"{f['grp']} · {f['name']}", f"{nf(f['fee'], 2)}%", p_pub(f, "fee", "דמי ניהול מהצבירה"))
                                                                    for f in ys if f.get("fee") is not None])}
    figs["d"] = f_calc("שחיקת דמי הניהול: ברוטו פחות נטו, נקודות אחוז בשנה, פנסיה מקיפה", g - n, "pct", "שחיקת דמי הניהול · פנסיה מקיפה",
                       f"{figs['g']['l']} − {figs['n']['l']}", [(figs["g"]["l"], figs["g"]["t"], None), (figs["n"]["l"], figs["n"]["t"], None)],
                       b="estimate", est=True)
    corr = "דמי הניהול מורידים {d} בשנה מהתשואה של הפנסיה המקיפה."
    email = (f"בחמש השנים עד {AS()} הניבו מסלולי הפנסיה המקיפה, משוקללים בנכסים, {{g}} בשנה ברוטו ו-{{n}} נטו (אומדן): "
             f"שחיקה של {{d}} בשנה, כמעט כולה דמי הניהול מהצבירה ({{fee}} בממוצע משוקלל היום). דמי הניהול מהפקדה אינם בחישוב.")
    by = {}
    for f in ys:
        by.setdefault(f["grp"], []).append(f)
    rows_ = [["קבוצה", "ברוטו, 5 שנים, בשנה", "נטו, 5 שנים, בשנה", "פער", "דמי ניהול מהצבירה", "נכסים (מיליוני ש\"ח)"]]
    for gname, zs in sorted(by.items(), key=lambda x: -math.fsum(f["assets"] for f in x[1])):
        a, b_ = wavg(zs, lambda f: f["a5"]), wavg(zs, lambda f: f["net"]["a5"])
        fz = [f for f in zs if f.get("fee") is not None]
        rows_.append([gname, f"{nf(a, 2)}%", f"{nf(b_, 2)}%", f"{nf(a - b_, 2)}", f"{nf(wavg(fz, lambda f: f['fee']), 2) if fz else '–'}%",
                      nf(math.fsum(f["assets"] for f in zs), 0)])
    ex = table(f"פנסיה מקיפה: ברוטו מול נטו, ממוצע שנתי 5 שנים, {AS()}", rows_, ["משוקלל בנכסי המסלולים היום"] + FOOT_NET, span=AS())
    chg = changes_if("התשובה משתנה מהותית אם השחיקה עולה מעל {thr} בשנה", "d", ">", 0.25)
    return answer(figs, corr, email, ex, chg, f"drag:{round(g - n, 1)}", links=[screen("פנסיה מקיפה", "עד 50", "a5")], rel=["Q-201", "Q-207"], asof=AS())


@question("Q-207", "באיזו קטגוריה דמי הניהול שוחקים הכי הרבה מהתשואה?", ["dist", "reg", "strat"], "funds")
def q207(A):
    by = {}
    for f in F()["funds"]:
        if (f.get("assets") or 0) > 0 and not f.get("closed"):
            by.setdefault((f["prod"], f["track"]), []).append(f)
    rows = []
    for (p, t), xs in by.items():
        g, n, ys = drag_of(xs, "a5")
        if g is not None and len(ys) >= 5:
            rows.append((p, t, g - n, g, n, ys))
    if len(rows) < 5:
        return nodata("פחות מחמש קטגוריות עם חמישה מסלולים לפחות ותשואה נטו ל-5 שנים")
    rows.sort(key=lambda r: -r[2])
    hi, lo = rows[0], rows[-1]

    def dfig(r, lab):
        p, t, d, g, n, ys = r
        return f_calc(f"שחיקת דמי הניהול, נקודות אחוז בשנה, {p}, {t}", d, "pct", f"ברוטו פחות נטו, ממוצע שנתי 5 שנים · {p} | {t}",
                      "Σ נכסים × (ברוטו − נטו) ÷ Σ נכסים, ממוצע שנתי 5 שנים",
                      [(f"{f['grp']} · {f['name']}", f"ברוטו {nf(f['a5'], 2)}% · נטו {nf(f['net']['a5'], 2)}%", p_net(f, "a5")) for f in ys],
                      b="estimate", est=True)
    figs = {"hi": dfig(hi, "hi"), "lo": dfig(lo, "lo")}
    corr = f"ב{hi[0]}, מסלול {hi[1]}: דמי הניהול מורידים {{hi}} בשנה, הכי הרבה מכל הקטגוריות."
    email = (f"בממוצע שנתי ב-5 שנים עד {AS()}, משוקלל בנכסים, השחיקה הגבוהה היא ב{hi[0]} ({hi[1]}), {{hi}} בשנה; "
             f"הנמוכה ב{lo[0]} ({lo[1]}), {{lo}} בשנה. השחיקה היא דמי הניהול מהצבירה בפועל, אומדן.")
    ex = exhibit("hbar", f"שחיקת דמי הניהול בשנה, ממוצע 5 שנים, לפי קטגוריה, {AS()}", "נק׳ אחוז",
                 [f"{p} | {t}" for p, t, *_ in rows[:15]], [{"name": "ברוטו פחות נטו", "type": "bar", "data": [round(r[2], 3) for r in rows[:15]]}],
                 ["קטגוריות עם חמישה מסלולים לפחות שיש להם תשואה נטו ל-5 שנים; משוקלל בנכסים"] + FOOT_NET, span=AS())
    chg = changes_if("הקטגוריה המובילה מתחלפת אם השחיקה בה יורדת אל מתחת ל-{thr}", "hi", "<", rows[1][2])
    return answer(figs, corr, email, ex, chg, f"hi:{hi[0]}|{hi[1]}", links=[screen(hi[0], hi[1], "a5")], rel=["Q-206", "Q-205"], asof=AS())


@question("Q-208", "האם ביצועי עבר בגמל ובהשתלמות נמשכים משנה לשנה?", ["dist", "inv", "board", "reg"], "funds")
def q208(A):
    y1, y2 = asof() // 100 - 2, asof() // 100 - 1
    rows = F()["funds"] + load("funds/closed.json")["funds"]
    rows = [f for f in rows if f["prod"] in ("גמל", "השתלמות") and not f.get("closed") and (f.get("end") or asof()) >= y1 * 100 + 12]
    yr = {}
    for f in rows:
        h = load(f"funds/{f['k']}.json")
        for Y in (y1, y2):
            ix = [i for i, p in enumerate(h["p"]) if p // 100 == Y]
            if len(ix) == 12 and all(h["y"][i] is not None for i in ix) and (h["a"][ix[-1]] or 0) > 0:
                r = 1.0
                for i in ix:
                    r *= 1 + h["y"][i] / 100
                cat = [c for p, c in h["ct"] if p <= Y * 100 + 12][-1]
                yr[(f["k"], Y)] = ((r - 1) * 100, cat)
    first = {}
    for (k, Y), (r, c) in yr.items():
        if Y == y1:
            first.setdefault(c, []).append((k, r))
    top, stay, gone, n_cat = [], 0, 0, 0
    for c, xs in first.items():
        if len(xs) < 8:
            continue
        n_cat += 1
        xs.sort(key=lambda x: -x[1])
        q = max(1, len(xs) // 4)
        nxt = sorted([(k, yr[(k, y2)][0]) for k, _ in xs if (k, y2) in yr and yr[(k, y2)][1] == c], key=lambda x: -x[1])
        q2 = {k for k, _ in nxt[:max(1, len(nxt) // 4)]}
        for k, _ in xs[:q]:
            top.append(k)
            stay += k in q2
            gone += (k, y2) not in yr
    if len(top) < 10:
        return nodata("פחות מעשרה מסלולים ברבע העליון בקטגוריות עם שמונה מסלולים לפחות")
    sh = stay / len(top) * 100
    figs = {"sh": f_calc(f"שיעור המסלולים מהרבע העליון ב-{y1} שנשארו ברבע העליון ב-{y2}", sh, "pct", f"התמדה ברבע העליון · גמל והשתלמות · {y1}→{y2}",
                         "מסלולים ברבע העליון של הקטגוריה גם בשנה הבאה ÷ המסלולים ברבע העליון בשנה הראשונה × 100; קטגוריות עם שמונה מסלולים לפחות, "
                         "חברי הקטגוריה כפי שהיו (כולל מסלולים שנסגרו)", [("מסלולים ברבע העליון", nf(len(top), 0), None), ("נשארו", nf(stay, 0), None),
                                                                          ("ההיסטוריות החודשיות", "funds/<k>.json", None)], d=0),
            "base": f_calc("שיעור צפוי במקרה (רבע)", 25.0, "pct", "שיעור צפוי אם אין התמדה", "רבע מהמסלולים בכל קטגוריה", [("רבע", "1 ÷ 4", None)], d=0),
            "n": f_calc(f"מסלולים ברבע העליון ב-{y1}", len(top), "n", f"מסלולים ברבע העליון · {y1}", "ספירה", [("קטגוריות", nf(n_cat, 0), None)], d=0)}
    persist = sh >= 37.5
    corr = ("כן, יותר ממקרה" if persist else "לא יותר ממקרה") + f": {{sh}} מהמסלולים שהיו ברבע העליון ב-{y1} נשארו בו ב-{y2}."
    email = (f"מתוך {{n}} מסלולי גמל והשתלמות שסיימו את {y1} ברבע העליון של הקטגוריה שלהם, {{sh}} נשארו ברבע העליון ב-{y2}, "
             f"מול {{base}} שהיה צפוי במקרה. התשואות ברוטו, שנים קלנדריות מלאות; מסלולים שנסגרו נספרים כמי שלא נשארו.")
    ex = table(f"התמדה ברבע העליון, גמל והשתלמות, {y1}→{y2}", [["", "מסלולים"], [f"ברבע העליון ב-{y1}", nf(len(top), 0)], [f"נשארו ברבע העליון ב-{y2}", nf(stay, 0)],
                                                                 ["נסגרו לפני סוף השנה הבאה", nf(gone, 0)]],
               ["רבע עליון: התשואה הקלנדרית ברוטו, בתוך הקטגוריה (מוצר | מסלול) כפי שהייתה באותה שנה", SRC_CLOSED], span=f"{y1}–{y2}")
    chg = changes_if("התשובה מתהפכת אם שיעור ההתמדה חוצה את {thr}", "sh", "<" if persist else ">=", 37.5)
    return answer(figs, corr, email, ex, chg, "persist" if persist else "random", links=[link("סינון גמל", "/funds/screen?prod=%D7%92%D7%9E%D7%9C&per=y12&b=net")],
                  rel=["Q-200", "Q-209"], asof=AS())


# ------------------------------------------------------------------------------------------------ survivorship
@question("Q-209", "כמה מסלולים נסגרו ב-12 החודשים האחרונים, ובכמה נכסים?", ["reg", "dist", "strat"], "funds")
def q209(A):
    C = load("funds/closed.json")["funds"]
    lo = madd(asof(), -12)
    xs = sorted([f for f in C if f["end"] > lo], key=lambda f: -(f.get("end_assets") or 0))
    if not xs:
        return nodata("לא נסגר מסלול ב-12 החודשים האחרונים")
    tot = math.fsum(f.get("end_assets") or 0 for f in xs) / 1000
    big = xs[0]
    ins = [(f"{f['grp']} · {f['name']} ({ym(f['end'])})", nf(f.get("end_assets"), 0),
            P_fund(f"נכסים בחודש האחרון עם נכסים · {f['name']}", nf(f.get("end_assets"), 1), "מיליוני ש\"ח", DS[f["k"][0]], f["id"], f.get("end_ap") or f["end"], "TOTAL_ASSETS"))
           for f in xs]
    figs = {"n": f_calc(f"מסלולים שהפסיקו לדווח, {ym(madd(lo, 1))}–{AS()}", len(xs), "n", "מסלולים שנסגרו ב-12 חודשים", "ספירת המסלולים שהחודש האחרון שלהם בטווח",
                        ins, d=0),
            "a": f_calc("נכסים במסלולים שנסגרו, בחודש האחרון שלהם", tot, "bn", "נכסי המסלולים שנסגרו", "Σ הנכסים בחודש האחרון שבו היו נכסים ÷ 1,000", ins, d=1),
            "big": fig(f"נכסי המסלול הגדול שנסגר, {big['name']}", (big.get("end_assets") or 0) / 1000, "bn", ins[0][2], ym(big.get("end_ap") or big["end"]), d=1)}
    corr = "בשנה האחרונה הפסיקו לדווח {n} מסלולים."
    email = (f"ב-12 חודשים עד {AS()} הפסיקו לדווח {{n}} מסלולים, עם {{a}} בחודש האחרון שלהם. הגדול: {big['name']} ({big['grp']}), {{big}}. "
             "רוב הכסף לא יצא מהענף: מסלול שנסגר ממוזג בדרך כלל למסלול אחר של אותו מנהל, ולכן הנכסים עוברים בלי העברה מדווחת.")
    rows_ = [["מנהל", "מסלול", "חודש אחרון", "נכסים (מיליוני ש\"ח)"]] + [[f["grp"], f["name"], ym(f["end"]), nf(f.get("end_assets"), 0)] for f in xs[:20]]
    ex = table(f"מסלולים שנסגרו, {ym(madd(lo, 1))}–{AS()}", rows_, [SRC_CLOSED], span=AS())
    chg = changes_if("התמונה משתנה אם הנכסים במסלולים שנסגרו עולים מעל {thr}", "a", ">", 100.0)
    return answer(figs, corr, email, ex, chg, f"n:{len(xs)}|big:{big['k']}",
                  links=[link("סינון עם מסלולים שנסגרו", f"/funds/screen?prod={quote(big['prod'], safe='')}&track={quote(big['track'], safe='')}&gone=1"),
                         card(big, "gross")], rel=["Q-210", "Q-208"], asof=AS())


def ann_cat(rec, key, months):
    """the annualised compounded return of the last `months` months of a cat.json series (None if any month is missing)"""
    ys = rec.get(key) or []
    if len(ys) < months or any(y is None for y in ys[-months:]):
        return None
    r = 1.0
    for y in ys[-months:]:
        r *= 1 + y / 100
    return (r ** (12 / months) - 1) * 100


@question("Q-210", "כמה מחמיא ממוצע הקטגוריה כשסופרים רק את המסלולים ששרדו?", ["inv", "reg", "board"], "funds")
def q210(A):
    cats = load("funds/cat.json")
    out = []
    for c, rec in cats.items():
        if not c.startswith(("גמל |", "השתלמות |")) or "ys" not in rec or rec["p"][-1] != asof():
            continue
        a, s = ann_cat(rec, "y", 120), ann_cat(rec, "ys", 120)
        if a is not None and s is not None and min(rec["n"][-120:]) >= 3:
            out.append((s - a, c, a, s, rec))
    if len(out) < 3:
        return nodata("פחות משלוש קטגוריות עם סדרה מלאה של עשר שנים")
    out.sort(key=lambda x: -x[0])
    d, c, a, s, rec = out[0]
    span = f"{ym(rec['p'][-120])}–{AS()}"
    ins = [("סדרת הקטגוריה, חברים בזמן אמת (y)", f"funds/cat.json · {c}", None), ("סדרת הקטגוריה, השורדים בלבד (ys)", f"funds/cat.json · {c}", None)]
    figs = {"a": f_calc(f"תשואה שנתית ממוצעת, 10 שנים, {c}, כל המסלולים כפי שהיו", a, "pct", f"{c} · חברים בזמן אמת · {span}",
                        "ריבית דריבית של 120 התשואות החודשיות המשוקללות בנכסים (y), בחזקת 12÷120", ins),
            "s": f_calc(f"תשואה שנתית ממוצעת, 10 שנים, {c}, השורדים בלבד", s, "pct", f"{c} · השורדים בלבד · {span}",
                        "אותו חישוב על סדרת המסלולים הפעילים היום בלבד (ys)", ins)}
    figs["d"] = f_calc(f"הטיית השורדים, נקודות אחוז בשנה, {c}", s - a, "pct", f"הטיית השורדים · {c}", f"{figs['s']['l']} − {figs['a']['l']}",
                       [(figs["s"]["l"], figs["s"]["t"], None), (figs["a"]["l"], figs["a"]["t"], None)])
    pos = sum(1 for x in out if x[0] > 0)
    figs["k"] = f_calc("קטגוריות שבהן השורדים מחמיאים", pos, "n", "ספירת קטגוריות", "קטגוריות גמל והשתלמות עם סדרה מלאה ל-10 שנים שבהן השורדים > כולם",
                       [(x[1], f"{nf(x[0], 2)} נק׳", None) for x in out], d=0)
    corr = f"ב{c} ממוצע השורדים בלבד גבוה בעשר שנים ב-{{d}} בשנה מהממוצע של כל המסלולים."
    email = (f"בעשר השנים עד {AS()} הניבה הקטגוריה {c}, כשסופרים כל מסלול שהיה בה באותו חודש, {{a}} בשנה; "
             f"כשסופרים רק את מי ששרד עד היום, {{s}}: הטיה של {{d}} בשנה. ב-{{k}} קטגוריות גמל והשתלמות השורדים מחמיאים.")
    ex = table(f"הטיית השורדים, ממוצע שנתי 10 שנים, {AS()}", [["קטגוריה", "כל המסלולים", "השורדים", "הפער"]] +
               [[x[1], f"{nf(x[2], 2)}%", f"{nf(x[3], 2)}%", nf(x[0], 2)] for x in out[:12]],
               ["כל המסלולים: חברי הקטגוריה בכל חודש, כולל מסלולים שנסגרו מאז; השורדים: המסלולים הפעילים היום בלבד", "ברוטו, משוקלל בנכסים", SRC_REG], span=span)
    chg = changes_if("התשובה משתנה אם ההטיה בקטגוריה יורדת אל מתחת ל-{thr}", "d", "<", 0.1)
    return answer(figs, corr, email, ex, chg, f"cat:{c}|pos:{pos}", links=[screen(c.split(' | ')[0], c.split(' | ')[1], "a5", "gross")], rel=["Q-209", "Q-208"], asof=AS())


# ------------------------------------------------------------------------------------------------ the month
@question("Q-211", "מי שינה דמי ניהול החודש, במסלולים של מיליארד ש\"ח ומעלה?", ["dist", "ceo", "strat"], "funds")
def q211(A):
    xs = [f for f in F()["funds"] if (f.get("assets") or 0) >= 1000 and f.get("fee") is not None and f.get("fee1") is not None]
    cut = sorted([f for f in xs if f["fee"] < f["fee1"]], key=lambda f: f["fee"] - f["fee1"])
    up = sorted([f for f in xs if f["fee"] > f["fee1"]], key=lambda f: f["fee1"] - f["fee"])
    if len(xs) < 20:
        return nodata("אין שיעור דמי ניהול לחודש הקודם לרוב המסלולים הגדולים")
    pm = ym(madd(asof(), -1))
    figs = {"cut": f_calc(f"מסלולים של מיליארד ומעלה שהורידו דמי ניהול, {pm}→{AS()}", len(cut), "n", "ירידות בדמי הניהול", "ספירה: דמי ניהול החודש < החודש הקודם",
                          [(f"{f['grp']} · {f['name']}", f"{nf(f['fee1'], 2)}% → {nf(f['fee'], 2)}%", p_pub(f, "fee", "דמי ניהול מהצבירה")) for f in cut] or [("אין", "", None)], d=0),
            "up": f_calc(f"מסלולים של מיליארד ומעלה שהעלו דמי ניהול, {pm}→{AS()}", len(up), "n", "עליות בדמי הניהול", "ספירה: דמי ניהול החודש > החודש הקודם",
                         [(f"{f['grp']} · {f['name']}", f"{nf(f['fee1'], 2)}% → {nf(f['fee'], 2)}%", p_pub(f, "fee", "דמי ניהול מהצבירה")) for f in up] or [("אין", "", None)], d=0),
            "n": f_calc("מסלולים של מיליארד ומעלה", len(xs), "n", "המסלולים הגדולים", "ספירת המסלולים עם נכסים של מיליארד ש\"ח ומעלה ושיעור לשני החודשים", [], d=0)}
    if cut:
        b = cut[0]
        figs["big"] = f_calc(f"הירידה הגדולה, {b['name']}", b["fee"] - b["fee1"], "pp", f"שינוי דמי הניהול · {b['name']}", "החודש − החודש הקודם",
                             [("החודש", f"{nf(b['fee'], 2)}%", p_pub(b, "fee", "דמי ניהול מהצבירה")),
                              ("החודש הקודם", f"{nf(b['fee1'], 2)}%", p_pub(b, "fee", "דמי ניהול מהצבירה", period=madd(asof(), -1)))], signed=True)
    corr = "מסלולים של מיליארד ש\"ח ומעלה שהורידו את דמי הניהול בחודש האחרון: {cut}."
    email = ("מתוך {n} מסלולים של מיליארד ש\"ח ומעלה, {cut} הורידו את שיעור דמי הניהול הממוצע מהצבירה בחודש האחרון ו-{up} העלו. "
             + (f"הירידה הגדולה: {cut[0]['name']} ({cut[0]['grp']}), {{big}}. " if cut else "")
             + "השיעור הוא הממוצע בפועל של המסלול, ולכן הוא זז גם כשתמהיל החוסכים משתנה.")
    rows_ = [["מנהל", "מסלול", pm, AS(), "נכסים (מיליוני ש\"ח)"]] + [[f["grp"], f["name"], f"{nf(f['fee1'], 2)}%", f"{nf(f['fee'], 2)}%", nf(f["assets"], 0)] for f in (cut + up)[:20]]
    ex = table(f"שינויי דמי ניהול מהצבירה, מסלולים של מיליארד ומעלה, {pm}→{AS()}", rows_ if len(rows_) > 1 else rows_ + [["–", "אין שינוי", "", "", ""]],
               ["דמי ניהול: AVG_ANNUAL_MANAGEMENT_FEE, השיעור הממוצע השנתי מהנכסים", SRC_REG], span=AS())
    chg = changes_if("התשובה משתנה אם מספר הירידות עולה מעל {thr}", "cut", ">", float(len(cut)))
    return answer(figs, corr, email, ex, chg, f"cut:{len(cut)}|up:{len(up)}", links=[link("קופות: הלוח החודשי", "/funds")] + ([card(cut[0])] if cut else []),
                  rel=["Q-206", "Q-207"], asof=AS())


@question("Q-212", "באילו מסלולים הסיווג הרשמי של הרשות שונה ממה שהשם מרמז?", ["reg", "dist"], "funds")
def q212(A):
    Fd = F()
    xs = sorted([f for f in Fd["funds"] if f.get("tx", {}).get("dis")], key=lambda f: -(f.get("assets") or 0))
    tx = Fd.get("tx", {})
    src = P_calc("מרשם המסלולים של הרשות", tx.get("modified", ""), "", "transfer_bank: ההתמחות הראשית והמשנית לפי מספר המסלול",
                 [("המרשם", tx.get("url", ""), None)])
    figs = {"dis": f_calc("מסלולים שבהם הסיווג הרשמי שונה מהסיווג לפי השם", len(xs), "n", "מחלוקות סיווג", "ספירה (funds.json tx.dis)",
                          [(f"{f['grp']} · {f['name']}", f"{f['tx'].get('nm')} → {f['track']}", None) for f in xs] or [("אין", "", None)], d=0),
            "a": f_calc("נכסים במסלולים במחלוקת", math.fsum(f["assets"] or 0 for f in xs) / 1000, "bn", "נכסי המסלולים במחלוקת", "Σ נכסים ÷ 1,000",
                        [(f["name"], nf(f["assets"], 0), p_pub(f, "assets", "נכסים", unit="מיליוני ש\"ח", text=nf(f["assets"], 1))) for f in xs] or [("אין", "", None)], d=1),
            "cov": f_calc("שיעור המסלולים הפעילים עם סיווג רשמי ממופה", tx.get("mapped", 0) / max(1, tx.get("live", 1)) * 100, "pct", "כיסוי הסיווג הרשמי",
                          "מסלולים שהסיווג שלהם נקבע לפי המרשם ÷ המסלולים הפעילים × 100", [("ממופים", nf(tx.get("mapped"), 0), src), ("פעילים", nf(tx.get("live"), 0), None)], d=1)}
    corr = "ב-{dis} מסלולים הסיווג הרשמי של הרשות שונה מהסיווג לפי שם המסלול."
    email = (f"מרשם המסלולים של הרשות (transfer_bank) מסווג {{cov}} מהמסלולים הפעילים; ב-{{dis}} מהם, עם {{a}}, הסיווג הרשמי שונה ממה שהשם מרמז. "
             "הנפוץ: מסלולי אג\"ח עם רכיב מניות מוגבל, שהשם מסווג כמניות, ומסלולי מקבלי קצבה בהלכה או במחקה מדדים. האתר משווה לפי הסיווג הרשמי.")
    rows_ = [["מנהל", "מסלול", "לפי השם", "לפי הרשות", "נכסים (מיליוני ש\"ח)"]] + [[f["grp"], f["name"], f["tx"].get("nm", ""), f["track"], nf(f["assets"], 0)] for f in xs[:25]]
    ex = table(f"מחלוקות סיווג, {AS()}", rows_, ["לפי הרשות: ההתמחות הראשית והמשנית ב-transfer_bank, ממופה לאוצר המסלולים של האתר",
                                                  tx.get("source", "")], span=AS())
    chg = changes_if("התמונה משתנה אם מספר המחלוקות עולה מעל {thr}", "dis", ">", float(len(xs) + 10))
    return answer(figs, corr, email, ex, chg, f"dis:{len(xs)}", links=[card(xs[0], "gross")] if xs else [link("קופות", "/funds")], rel=["Q-207"], asof=AS())


# ------------------------------------------------------------------------------------------------ real, actuarial, flows, managers
@question("Q-213", "כמה נשאר אחרי אינפלציה ודמי ניהול בפנסיה המקיפה, מסלול לבני חמישים ומטה?", ["dist", "board", "reg"], "funds")
def q213(A):
    Fd = F()
    xs = [f for f in members("פנסיה מקיפה", "עד 50", "a5") if f.get("realn", {}).get("a5") is not None]
    if len(xs) < 5:
        return nodata("פחות מחמישה מסלולים עם תשואה ריאלית נטו ל-5 שנים")
    cpi = P_calc("מדד המחירים לצרכן, השינוי ב-12 חודשים", "", "%", Fd.get("real_method", ""), [("המקור", Fd.get("cpi_src") or "", None)])
    ins = [(f"{f['grp']} · {f['name']}", f"נטו {nf(f['net']['a5'], 2)}% · ריאלי נטו {nf(f['realn']['a5'], 2)}%", p_net(f, "a5")) for f in xs]
    n = wavg(xs, lambda f: f["net"]["a5"])
    r = wavg(xs, lambda f: f["realn"]["a5"])
    figs = {"r": f_calc("תשואה ריאלית נטו, ממוצע שנתי 5 שנים, משוקלל, פנסיה מקיפה עד 50", r, "pct", "ריאלי נטו · פנסיה מקיפה עד 50",
                        "Σ נכסים × ריאלי נטו ÷ Σ נכסים; ריאלי = (1 + נטו) ÷ (מכפלת שינויי המדד השנתיים)^(1/5) − 1", ins + [("מדד", "", cpi)], b="estimate", est=True),
            "n": f_calc("תשואה נומינלית נטו, ממוצע שנתי 5 שנים, משוקלל, פנסיה מקיפה עד 50", n, "pct", "נומינלי נטו · פנסיה מקיפה עד 50",
                        "Σ נכסים × נטו ÷ Σ נכסים", ins, b="estimate", est=True)}
    lo = min(xs, key=lambda f: f["realn"]["a5"])
    figs["lo"] = fig(f"תשואה ריאלית נטו, ממוצע שנתי 5 שנים, {lo['grp']}", lo["realn"]["a5"], "pct",
                     P_calc(f"ריאלי נטו · {lo['name']}", f"{nf(lo['realn']['a5'], 2)}%", "%", Fd.get("real_method", ""), [("נטו", f"{nf(lo['net']['a5'], 2)}%", p_net(lo, "a5")), ("מדד", "", cpi)], est=True),
                     AS(), b="estimate", d=2)
    corr = "אחרי אינפלציה ודמי ניהול נשאר לחוסך בפנסיה המקיפה, מסלול ברירת המחדל, {r} בשנה."
    email = (f"בחמש השנים עד {AS()} הניבו מסלולי הפנסיה המקיפה לבני חמישים ומטה, משוקללים בנכסים, {{n}} בשנה נטו ו-{{r}} בשנה ריאלית נטו (אומדן). "
             f"הנמוך: {lo['grp']}, {{lo}} ריאלית בשנה.")
    rows_ = [["מנהל", "מסלול", "נטו, 5 שנים, בשנה", "ריאלי נטו", "דמי ניהול"]] + [[f["grp"], f["name"], f"{nf(f['net']['a5'], 2)}%", f"{nf(f['realn']['a5'], 2)}%", f"{nf(f.get('fee'), 2)}%"]
                                                                                for f in sorted(xs, key=lambda f: -f["realn"]["a5"])]
    ex = table(f"פנסיה מקיפה, לבני חמישים ומטה: נטו וריאלי, {AS()}", rows_, [Fd.get("real_method", ""), Fd.get("cpi_src") or ""] + FOOT_NET, span=AS())
    chg = changes_if("התשובה משתנה אם התשואה הריאלית נטו יורדת אל מתחת ל-{thr}", "r", "<", 3.0)
    return answer(figs, corr, email, ex, chg, f"real:{round(r)}", links=[link("סינון, ריאלי נטו", "/funds/screen?prod=" + quote("פנסיה מקיפה", safe="") + "&track=" + quote("עד 50", safe="") + "&per=a5&b=net&real=1")],
                  rel=["Q-201", "Q-206"], asof=AS())


@question("Q-214", "מה האיזון האקטוארי האחרון בקרנות הפנסיה המקיפות?", ["reg", "board", "dist"], "funds")
def q214(A):
    xs = [f for f in F()["funds"] if f["prod"] == "פנסיה מקיפה" and f.get("act") is not None and f.get("track") in ("כללי", "עד 50")]
    by = {}
    for f in xs:
        by.setdefault(f["grp"], []).append(f)
    rows = [(g, max(zs, key=lambda f: f["assets"])) for g, zs in by.items()]
    if len(rows) < 5:
        return nodata("פחות מחמש קרנות עם איזון אקטוארי ברבעון האחרון")
    rows.sort(key=lambda x: x[1]["act"])
    lo, hi = rows[0], rows[-1]
    q = max(f["act_p"] for _, f in rows)

    def af(g, f):
        return fig(f"איזון אקטוארי, {g}, {ym(f['act_p'])}", f["act"], "pct",
                   P_fund(f"איזון אקטוארי · {f['name']}", f"{nf(f['act'], 2)}%", "%", "pensia", f["id"], f["act_p"], "ACTUARIAL_ADJUSTMENT"),
                   ym(f["act_p"]), d=2, signed=True)
    figs = {"lo": af(*lo), "hi": af(*hi)}
    neg = sum(1 for _, f in rows if f["act"] < 0)
    figs["neg"] = f_calc(f"קרנות עם איזון אקטוארי שלילי, {ym(q)}", neg, "n", "ספירה", "קרנות (המסלול הגדול של כל קבוצה) עם איזון שלילי",
                         [(g, f"{nf(f['act'], 2)}%", None) for g, f in rows], d=0, asof=ym(q))  # the quarter of the field, not the funds month
    corr = f"באיזון האקטוארי של {ym(q)} {lo[0]} בתחתית, עם {{lo}}."
    email = (f"האיזון האקטוארי (הרווח או ההפסד של העמיתים מעבר לתשואה, מדווח פעם ברבעון) ב-{ym(q)}: הגבוה {hi[0]}, {{hi}}; הנמוך {lo[0]}, {{lo}}. "
             f"ב-{{neg}} קרנות הוא שלילי.")
    ex = exhibit("hbar", f"איזון אקטוארי, פנסיה מקיפה, {ym(q)}", "%", [g for g, _ in rows], [{"name": "איזון אקטוארי", "type": "bar", "data": [f["act"] for _, f in rows]}],
                 ["המסלול הגדול של כל קבוצה (כללי או לבני חמישים ומטה); ACTUARIAL_ADJUSTMENT, באחוזים, מדווח רבעונית", SRC_REG], span=ym(q))
    chg = changes_if("התחתית מתחלפת אם האיזון של התחתונה עולה מעל {thr}", "lo", ">", rows[1][1]["act"])
    return answer(figs, corr, email, ex, chg, f"lo:{lo[0]}|neg:{neg}", links=[card(lo[1], "gross")], rel=["Q-201", "Q-213"], asof=ym(q))


@question("Q-215", "לאן זורם הכסף בפנסיה המקיפה ב-12 החודשים האחרונים, לפי קבוצה?", ["ceo", "dist", "strat"], "funds")
def q215(A):
    by = {}
    for f in F()["funds"]:
        if f["prod"] == "פנסיה מקיפה" and f.get("nd12") is not None:
            by.setdefault(f["grp"], []).append(f)
    rows = sorted([(g, math.fsum(f["nd12"] for f in zs), zs) for g, zs in by.items()], key=lambda x: -x[1])
    if len(rows) < 5:
        return nodata("פחות מחמש קבוצות עם צבירה נטו מלאה ל-12 חודשים")
    span = f"{ym(madd(asof(), -11))}–{AS()}"

    def nf_(g, v, zs):
        return f_calc(f"צבירה נטו ב-12 חודשים, {g}, פנסיה מקיפה", v / 1000, "bn", f"צבירה נטו · {g} · פנסיה מקיפה · {span}",
                      "Σ NET_MONTHLY_DEPOSITS (הפקדות − משיכות ± העברות) של מסלולי הקבוצה, 12 חודשים",
                      [(f["name"], nf(f["nd12"], 0), P_fund(f"צבירה נטו, החודש · {f['name']}", nf(f.get("nd"), 1), "מיליוני ש\"ח", "pensia", f["id"], asof(), "NET_MONTHLY_DEPOSITS"))
                       for f in zs], d=1, signed=True)
    figs = {"top": nf_(*rows[0]), "bot": nf_(*rows[-1])}
    corr = f"{rows[0][0]} מובילה בצבירה נטו בפנסיה המקיפה ב-12 חודשים, {{top}}."
    email = (f"ב-12 חודשים עד {AS()} צברה {rows[0][0]} נטו (הפקדות פחות משיכות, כולל ניודים) {{top}} בפנסיה המקיפה; "
             f"בתחתית {rows[-1][0]}, {{bot}}. הנתון כולל ניודים בין מנהלים ואינו כולל מיזוגי מסלולים בתוך מנהל.")
    ex = exhibit("hbar", f"צבירה נטו ב-12 חודשים, פנסיה מקיפה, {span}", "מיליוני ש\"ח", [g for g, *_ in rows],
                 [{"name": "צבירה נטו", "type": "bar", "data": [round(v, 1) for _, v, _ in rows]}],
                 ["NET_MONTHLY_DEPOSITS, סכום 12 חודשים של מסלולי הקבוצה; מסלולים עם 12 חודשים מלאים", SRC_REG], span=span)
    chg = changes_if("המובילה מתחלפת אם הצבירה שלה יורדת אל מתחת ל-{thr}", "top", "<", rows[1][1] / 1000)
    return answer(figs, corr, email, ex, chg, f"top:{rows[0][0]}|bot:{rows[-1][0]}", links=[link("עדשת החיסכון · פנסיה", "/savings"), screen("פנסיה מקיפה", "עד 50", "y12")],
                  rel=["Q-201", "Q-009"], asof=AS())


@question("Q-216", "לאיזה מנהל יש את החלק הגדול של נכסיו ברבע העליון, נטו ב-3 שנים?", ["ceo", "inv", "board", "dist"], "funds")
def q216(A):
    by = {}
    for f in F()["funds"]:
        if f.get("pn", {}).get("a3") is not None and not f.get("closed"):
            by.setdefault(f["grp"], []).append(f)
    rows = []
    for g, zs in by.items():
        tot = math.fsum(f["assets"] for f in zs)
        if tot >= 5000 and g != "קרנות ענפיות ואחרות":
            top = [f for f in zs if f["pn"]["a3"] >= 75]
            rows.append((g, math.fsum(f["assets"] for f in top) / tot * 100, tot, top, zs))
    if len(rows) < 5:
        return nodata("פחות מחמישה מנהלים עם מסלולים מדורגים")
    rows.sort(key=lambda x: -x[1])

    def sf(r):
        g, sh, tot, top, zs = r
        return f_calc(f"חלק הנכסים ברבע העליון נטו, 3 שנים, {g}", sh, "pct", f"נכסים ברבע העליון · {g}",
                      "Σ נכסי המסלולים עם אחוזון נטו 3 שנים 75 ומעלה בקטגוריה שלהם ÷ Σ נכסי המסלולים המדורגים של המנהל × 100",
                      [(f["name"], f"אחוזון {f['pn']['a3']} · נכסים {nf(f['assets'], 0)}", None) for f in top] or [("אין", "", None)], d=0,
                      b="estimate", est=True)
    figs = {"top": sf(rows[0]), "bot": sf(rows[-1])}
    corr = f"{rows[0][0]}: {{top}} מנכסיה המדורגים במסלולים שברבע העליון בקטגוריה, נטו ב-3 שנים."
    email = (f"נכון ל-{AS()}, {{top}} מהנכסים של {rows[0][0]} במסלולים המדורגים יושבים ברבע העליון של הקטגוריה שלהם בתשואה נטו לשלוש שנים; "
             f"אצל {rows[-1][0]} רק {{bot}}. רבע עליון: אחוזון של שלושה רבעים ומעלה, בתוך מוצר ומסלול.")
    ex = exhibit("hbar", f"חלק הנכסים ברבע העליון, נטו, 3 שנים, {AS()}", "%", [g for g, *_ in rows],
                 [{"name": "חלק הנכסים", "type": "bar", "data": [round(sh, 1) for _, sh, *_ in rows]}],
                 ["מנהלים עם ₪5 מיליארד לפחות במסלולים מדורגים; אחוזון: funds.json pn.a3"] + FOOT_NET, span=AS())
    chg = changes_if("המוביל מתחלף אם החלק שלו יורד אל מתחת ל-{thr}", "top", "<", rows[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{rows[0][0]}", links=[link("קופות", "/funds")], rel=["Q-200", "Q-082", "Q-081"], asof=AS())


@question("Q-217", "מי מוביל נטו ב-5 שנים בגמל להשקעה, מסלול כללי?", ["dist", "ceo"], "funds")
def q217(A):
    return leader("גמל להשקעה", "כללי", "גמל להשקעה, מסלול כללי", "a5", ["Q-200", "Q-207"])


@question("Q-218", "האם מסלולי ההלכה בגמל מפגרים אחרי המסלולים הכלליים, נטו?", ["dist", "inv"], "funds")
def q218(A):
    h = members("גמל", "הלכה", "a3")
    g = members("גמל", "כללי", "a3")
    if len(h) < 4 or len(g) < 4:
        return nodata("פחות מארבעה מסלולים עם תשואה נטו ל-3 שנים באחת הקטגוריות")
    mh = med_fig(h, "a3", "חציון התשואה נטו, 3 שנים, גמל הלכה")
    mg = med_fig(g, "a3", "חציון התשואה נטו, 3 שנים, גמל כללי")
    figs = {"h": mh, "g": mg}
    figs["d"] = gap_fig("הפער בין חציון ההלכה לחציון הכללי, נטו, 3 שנים", mh, mg, "הלכה מול כללי · גמל")
    worse = figs["d"]["v"] < 0
    corr = ("כן" if worse else "לא") + ": חציון מסלולי ההלכה בגמל נמצא {d} בשנה מול המסלולים הכלליים, נטו."
    email = (f"בשלוש השנים עד {AS()} חציון מסלולי ההלכה בגמל הניב {{h}} בשנה נטו, וחציון המסלולים הכלליים {{g}}: פער של {{d}}. "
             "מסלולי ההלכה אינם מחזיקים אג\"ח ריבית ובנקים, ולכן חשיפתם למניות ולחו\"ל שונה.")
    xs = sorted(h + g, key=lambda f: -f["net"]["a3"])
    ex = net_table(f"גמל: הלכה מול כללי, נטו, 3 שנים, {AS()}", xs, "a3")
    chg = changes_if("התשובה מתהפכת אם הפער חוצה את {thr}", "d", ">=" if worse else "<", 0.0)
    return answer(figs, corr, email, ex, chg, "lag" if worse else "lead", links=[screen("גמל", "הלכה", "a3"), screen("גמל", "כללי", "a3")], rel=["Q-200"], asof=AS())


@question("Q-219", "מה האלפא שהרשות מחשבת למסלולי הפנסיה הגדולים?", ["inv", "board", "dist"], "funds")
def q219(A):
    xs = sorted([f for f in F()["funds"] if f["fam"] == "pensia" and f.get("alpha") is not None and (f.get("assets") or 0) > 0],
                key=lambda f: -f["assets"])[:10]
    if len(xs) < 5:
        return nodata("פחות מחמישה מסלולי פנסיה עם אלפא שפורסמה")

    def al(f):
        return fig(f"אלפא שנתית, {f['name']}", f["alpha"], "pct", p_pub(f, "alpha", "אלפא שנתית (60 חודשים)", text=nf(f["alpha"], 2)), AS(), d=2, signed=True)
    w = wavg(xs, lambda f: f["alpha"])
    figs = {"w": f_calc("אלפא שנתית משוקללת בנכסים, עשרת מסלולי הפנסיה הגדולים", w, "pct", "אלפא משוקללת · פנסיה",
                        "Σ נכסים × ALPHA ÷ Σ נכסים", [(f["name"], nf(f["alpha"], 2), p_pub(f, "alpha", "אלפא שנתית", text=nf(f["alpha"], 2))) for f in xs], signed=True)}
    hi, lo = max(xs, key=lambda f: f["alpha"]), min(xs, key=lambda f: f["alpha"])
    figs["hi"], figs["lo"] = al(hi), al(lo)
    pos = sum(1 for f in xs if f["alpha"] > 0)
    corr = "האלפא שהרשות מחשבת לעשרת מסלולי הפנסיה הגדולים, משוקללת בנכסים, היא {w} בשנה."
    email = (f"הרשות מפרסמת לכל מסלול אלפא שנתית על התשואות החודשיות של חמש השנים האחרונות. בעשרת מסלולי הפנסיה הגדולים ({AS()}): ממוצע משוקלל {{w}}; "
             f"הגבוהה {hi['name']}, {{hi}}; הנמוכה {lo['name']}, {{lo}}. האלפא מחושבת על תשואות ברוטו, לפני דמי ניהול.")
    rows_ = [["מנהל", "מסלול", "אלפא שנתית", "שארפ", "נכסים (מיליוני ש\"ח)"]] + [[f["grp"], f["name"], nf(f["alpha"], 2), nf(f.get("sharpe"), 2), nf(f["assets"], 0)] for f in xs]
    ex = table(f"אלפא שנתית של הרשות, עשרת מסלולי הפנסיה הגדולים, {AS()}", rows_,
               ["ALPHA: אלפא שנתית לפי 60 התשואות החודשיות האחרונות, כפי שהרשות מחשבת ומפרסמת; מדד הייחוס אינו מפורסם בשדה", SRC_REG], span=AS())
    chg = changes_if("התשובה משתנה אם האלפא המשוקללת חוצה את {thr}", "w", "<" if w > 0 else ">", 0.0)
    return answer(figs, corr, email, ex, chg, f"pos:{pos}", links=[card(xs[0], "gross")], rel=["Q-081", "Q-201"], asof=AS())


# ------------------------------------------------------------------------------------------------ F2: the analytics files (build_fund_stats.py)
# persist.json (do winners stay winners), default.json (the selected pension funds), trackers.json (index trackers), glide.json (age tracks),
# stats/<slug>.json (the risk panel) and rank/<slug>.json (percentile over time). Every figure is a calc node over the published file it is
# read from; the files carry their own method text, quoted in the formula.
SRC_F2 = "חישוב האתר על נתוני הרשות (גמל-נט, פנסיה-נט, ביטוח-נט, data.gov.il)"


def f2(path):
    return load(f"funds/{path}")


def f2_fig(label, v, unit, title, formula, path, inputs=(), d=1, b="estimate", signed=False):
    ins = list(inputs) + [("הקובץ", f"funds/{path}", None)]
    return f_calc(label, v, unit, title, formula, ins, d=d, b=b, signed=signed, est=b == "estimate")


def persist_row(fam, win, basis="net"):
    return next((x for x in f2("persist.json")["rows"] if x["fam"] == fam and x["win"] == win and x["basis"] == basis), None)


def stats_of(cat):
    ix = next((c for c in f2("stats/index.json")["cats"] if c["cat"] == cat), None)
    return f2(f"stats/{ix['slug']}.json") if ix and ix["stats"] else None


def rank_of_cat(cat):
    ix = next((c for c in f2("stats/index.json")["cats"] if c["cat"] == cat), None)
    return f2(f"rank/{ix['slug']}.json") if ix and ix["rank"] else None


def matrix_table(title, row, foot):
    rows_ = [["רבע בחלון הראשון", "מסלולים", "רבע עליון אחר כך", "שני", "שלישי", "תחתון", "נסגר"]]
    for q, lab in zip(row["rows"], ("עליון", "שני", "שלישי", "תחתון")):
        rows_.append([lab, nf(q["n"], 0)] + [f"{nf(x, 1)}%" for x in q["pct"]])
    return table(title, rows_, foot, span=f"{ym(row['from'])}–{ym(row['to'])}")


def persist_answer(win, rel):
    row = persist_row("הכל", win)
    if not row or row["top"] < 100:
        return nodata("אין מספיק מסלולים ברבע העליון לחישוב ההתמדה")
    lo, hi = row["ci90"] if not row["thin"] else (row["wilson90"]["lo"], row["wilson90"]["hi"])
    span = f"{ym(row['from'])}–{ym(row['to'])}"
    yrs = "שנה" if win == "12" else "שלוש שנים"
    nxt, nxt2 = ("בשנה שאחריה", "בשנה הבאה") if win == "12" else ("בשלוש השנים שאחריהן", "בשלוש השנים הבאות")
    meth = "funds/persist.json method: " + ("bootstrap בבלוקים" if not row["thin"] else "Wilson")
    figs = {"sh": f2_fig(f"שיעור המסלולים מהרבע העליון שנשארו בו בחלון הבא, {yrs}, נטו", row["stay_pct"], "pct",
                         f"התמדה ברבע העליון · {yrs} · כל המוצרים", "נשארו ברבע העליון ÷ כל מי שהתחיל בו × 100 (נסגרו במכנה)", "persist.json",
                         [("ברבע העליון בתחילת חלון", nf(row["top"], 0), None), ("נשארו", nf(row["stay"], 0), None)]),
            "coin": f2_fig("השיעור הצפוי במקרה", 25.0, "pct", "רבע מהמסלולים", "1 ÷ 4", "persist.json", d=0, b="actual"),
            "lo": f2_fig(f"גבול תחתון, רווח סמך של 90%, התמדה ב{yrs}", lo, "pct", "רווח סמך · התמדה", meth, "persist.json"),
            "hi": f2_fig(f"גבול עליון, רווח סמך של 90%, התמדה ב{yrs}", hi, "pct", "רווח סמך · התמדה", meth, "persist.json"),
            "g1": f2_fig("שיעור הנסגרים מהרבע העליון", row["gone_pct"], "pct", "נסגרו · רבע עליון", "נסגרו לפני סוף החלון הבא ÷ ברבע העליון", "persist.json"),
            "g4": f2_fig("שיעור הנסגרים מהרבע התחתון", row["gone_q4_pct"], "pct", "נסגרו · רבע תחתון", "נסגרו לפני סוף החלון הבא ÷ ברבע התחתון", "persist.json")}
    yes = lo > 25.0
    corr = (("כן, יותר ממקרה" if yes else "לא בבירור") + f": {{sh}} מהמסלולים שסיימו {yrs} ברבע העליון של הקטגוריה נשארו בו גם {nxt}.")
    email = (f"בכל חודשי ההתחלה {span}, בכל המוצרים, {{sh}} מהמסלולים שהיו ברבע העליון של הקטגוריה שלהם ב{yrs} (נטו, אומדן) היו שם גם {nxt2}, "
             f"מול {{coin}} שהיה צפוי במקרה; רווח סמך של תשעים אחוז: {{lo}} עד {{hi}}. מסלולים שנסגרו בדרך נספרים כמי שלא נשארו: "
             f"נסגרו {{g1}} מהרבע העליון ו-{{g4}} מהרבע התחתון. חלק מההתמדה הוא פער קבוע ברמת הסיכון בתוך קטגוריה רחבה, לא רק כישרון.")
    ex = matrix_table(f"מעברים בין רבעים, {yrs} ואז {yrs}, נטו, כל המוצרים", row,
                      ["רבע: בתוך הקטגוריה (מוצר | מסלול) כפי שהייתה בחודש ההתחלה, לפחות שמונה מסלולים; חלונות חופפים מכל חודשי ההתחלה",
                       "נסגר: הפסיק לדווח לפני סוף החלון הבא (survivorship)", "נטו = אומדן: ברוטו פחות דמי הניהול מהצבירה", SRC_F2])
    chg = changes_if("התשובה מתהפכת אם הגבול התחתון של רווח הסמך חוצה את {thr}", "lo", "<=" if yes else ">", 25.0)
    return answer(figs, corr, email, ex, chg, "persist" if yes else "noise", links=[link("ההיכל של החיסכון", "/funds")], rel=rel, asof=AS())


@question("Q-220", "האם מסלול שהוביל שנה ממשיך להוביל בשנה שאחריה?", ["dist", "inv", "board", "reg"], "funds")
def q220(A):
    return persist_answer("12", ["Q-221", "Q-222", "Q-208"])


@question("Q-221", "האם מי שהוביל שלוש שנים ממשיך להוביל בשלוש השנים הבאות?", ["inv", "board", "dist"], "funds")
def q221(A):
    return persist_answer("36", ["Q-220", "Q-222"])


@question("Q-222", "האם מסלולים חלשים נסגרים יותר, ובכמה זה מייפה את ממוצעי הענף?", ["reg", "inv", "board"], "funds")
def q222(A):
    row = persist_row("הכל", "36")
    if not row or row["gone_q4_pct"] is None:
        return nodata("אין מטריצת מעבר לשלוש שנים")
    q4, q1 = row["rows"][3], row["rows"][0]
    figs = {"g4": f2_fig("שיעור הנסגרים בתוך שלוש שנים, הרבע התחתון", row["gone_q4_pct"], "pct", "נסגרו · רבע תחתון · שלוש שנים",
                         "נסגרו לפני סוף שלוש השנים הבאות ÷ ברבע התחתון", "persist.json", [("ברבע התחתון", nf(q4["n"], 0), None), ("נסגרו", nf(q4["gone"], 0), None)]),
            "g1": f2_fig("שיעור הנסגרים בתוך שלוש שנים, הרבע העליון", row["gone_pct"], "pct", "נסגרו · רבע עליון · שלוש שנים",
                         "נסגרו לפני סוף שלוש השנים הבאות ÷ ברבע העליון", "persist.json", [("ברבע העליון", nf(q1["n"], 0), None), ("נסגרו", nf(q1["gone"], 0), None)])}
    figs["x"] = f2_fig("יחס סיכויי הסגירה: תחתון מול עליון", row["gone_q4_pct"] / row["gone_pct"] if row["gone_pct"] else None, "x", "יחס סגירה",
                       f"{figs['g4']['l']} ÷ {figs['g1']['l']}", "persist.json", [(figs["g4"]["l"], figs["g4"]["t"], None), (figs["g1"]["l"], figs["g1"]["t"], None)])
    more = row["gone_q4_pct"] > row["gone_pct"]
    corr = ("כן" if more else "לא") + ": {g4} מהמסלולים ברבע התחתון נסגרים בתוך שלוש שנים."
    email = (f"מהמסלולים שסיימו שלוש שנים ברבע התחתון של הקטגוריה ({ym(row['from'])}–{ym(row['to'])}, כל המוצרים) נסגרו {{g4}} בתוך שלוש השנים הבאות, "
             f"מול {{g1}} מהרבע העליון, יחס של {{x}}. ממוצע קטגוריה שסופר רק את מי ששרד מוחק את החלשים, ולכן מחמיא; האתר סופר אותם כפי שהיו.")
    ex = matrix_table("מעברים בין רבעים, שלוש שנים ואז שלוש שנים, נטו, כל המוצרים", row,
                      ["נסגר: הפסיק לדווח לפני סוף החלון הבא; חלק מהסגירות הן מיזוגים לתוך מסלול אחר של אותו מנהל", SRC_F2])
    chg = changes_if("התשובה מתהפכת אם שיעור הסגירה ברבע התחתון יורד אל מתחת ל-{thr}", "g4", "<=" if more else ">", row["gone_pct"])
    return answer(figs, corr, email, ex, chg, "losers_close" if more else "no", links=[link("ההיכל של החיסכון", "/funds")], rel=["Q-210", "Q-209", "Q-221"], asof=AS())


@question("Q-223", "כמה עולה לחוסך העטיפה של מסלול המחקה את מדד S&P 500?", ["dist", "inv", "ceo", "strat"], "funds")
def q223(A):
    g = next((x for x in f2("trackers.json")["groups"] if x["id"] == "sp500"), None)
    xs = [t for t in (g or {}).get("tracks", []) if (t.get("fx") or 0) >= 90 and not t.get("sector") and "y12" in t.get("tdn", {})]
    if len(xs) < 10:
        return nodata("פחות מעשרה מסלולי מחקה לא מגודרים עם תשואה ל-12 חודשים")
    xs.sort(key=lambda t: -t["tdn"]["y12"])
    top, bot = xs[0], xs[-1]
    med = g["med"]["y12"]

    def tf(t, lab):
        return f2_fig(f"פער נטו מחציון הברוטו של הקבוצה, 12 חודשים, {t['grp']}, {t['prod']}", t["tdn"]["y12"], "pp", f"עלות העטיפה · {t['name']}",
                      "תשואה נטו (אומדן) פחות חציון התשואה ברוטו של מחקי המדד", "trackers.json",
                      [("נטו, 12 חודשים", f"{nf(t['nt']['y12'], 2)}%", None), ("חציון הקבוצה, ברוטו", f"{nf(med, 2)}%", None)], d=2, signed=True)
    figs = {"med": f2_fig("חציון התשואה ברוטו של מחקי S&P 500, 12 חודשים", med, "pct", "חציון · מחקי S&P 500", "חציון התשואה ברוטו, 12 חודשים",
                          "trackers.json", d=2, b="actual"),
            "top": tf(top, "top"), "bot": tf(bot, "bot")}
    figs["sp"] = f2_fig("טווח עלות העטיפה בין מחקי S&P 500 לא מגודרים, 12 חודשים", top["tdn"]["y12"] - bot["tdn"]["y12"], "pp", "טווח · מחקי S&P 500",
                        f"{figs['top']['l']} − {figs['bot']['l']}", "trackers.json", [(figs["top"]["l"], figs["top"]["t"], None), (figs["bot"]["l"], figs["bot"]["t"], None)], d=2)
    figs["ft"], figs["fb"] = (fig(f"דמי ניהול מהצבירה, {t['grp']}, {t['prod']}, מחקה S&P 500", t.get("fee"), "pct",
                                  P_fund(f"דמי ניהול מהצבירה · {t['name']}", f"{nf(t.get('fee'), 2)}%", "%", DS[t["k"][0]], int(t["k"][1:]), asof(),
                                         "AVG_ANNUAL_MANAGEMENT_FEE"), AS(), d=2) for t in (top, bot))
    corr = "בין מחקי מדד S&P הלא מגודרים, ההבדל בין העטיפה הזולה ליקרה הגיע ל-{sp} ב-12 חודשים, נטו."
    email = (f"מחקי מדד S&P שאינם מגדרים מט\"ח (חשיפה של תשעים אחוז ומעלה) הניבו ב-12 חודשים עד {AS()} חציון של {{med}} ברוטו. "
             f"נטו, הטוב ({top['grp']}, {top['prod']}) עמד {{top}} מהחציון והחלש ({bot['grp']}, {bot['prod']}) {{bot}}: טווח של {{sp}}. "
             f"דמי הניהול מהצבירה שלהם {{ft}} ו-{{fb}}; מה שלא מוסבר בדמי הניהול הוא ביצוע: מועדי השקעה, מזומן, גידור חלקי.")
    rows_ = [["מנהל", "מוצר", "נטו, 12 חודשים", "פער מהחציון", "דמי ניהול", "חשיפת מט\"ח"]] + \
        [[t["grp"], t["prod"], f"{nf(t['nt']['y12'], 2)}%", nf(t["tdn"]["y12"], 2), f"{nf(t.get('fee'), 2)}%", f"{nf(t.get('fx'), 0)}%"] for t in xs[:8] + xs[-8:]]
    ex = table(f"מחקי S&P 500 לא מגודרים: פער נטו מחציון הברוטו, 12 חודשים, {AS()}", rows_,
               ["פער = נטו (אומדן) פחות חציון הברוטו של כל מחקי המדד; לא מגודר = חשיפת מט\"ח של תשעים אחוז ומעלה מהנכסים",
                "השמונה הטובים והשמונה החלשים", SRC_F2], span=AS())
    chg = changes_if("התשובה משתנה מהותית אם הטווח יורד אל מתחת ל-{thr}", "sp", "<", 0.5)
    return answer(figs, corr, email, ex, chg, f"top:{top['k']}|bot:{bot['k']}", links=[card(top), card(bot), compare([top, bot], 12)],
                  rel=["Q-205", "Q-207"], asof=AS())


def tender(tid):
    return next((t for t in f2("default.json")["tenders"] if t["id"] == tid), None)


def dflt_rows(tid):
    return [f for f in f2("default.json")["funds"] if f["tender"] == tid]


@question("Q-224", "האם קרנות ברירת המחדל שנבחרו ב-2024 הגדילו את נתח ההפקדות שלהן?", ["ceo", "dist", "reg", "strat"], "funds")
def q224(A):
    t = tender("2024")
    if not t or "sel_share" not in t:
        return nodata("אין שנה מלאה של נתונים מאז תחילת תקופת הקרנות הנבחרות")
    s = t["sel_share"]
    rows = dflt_rows("2024")
    alls, rest = next(f for f in rows if f.get("all")), next(f for f in rows if f.get("rest"))
    sp = f"{ym(alls['post']['from'])}–{ym(alls['post']['to'])}"
    pp = f"{ym(alls['pre']['from'])}–{ym(alls['pre']['to'])}"
    figs = {"pre": f2_fig("נתח הקרנות הנבחרות מההפקדות לפנסיה המקיפה, 12 החודשים שלפני", s["pre"], "pct", f"נתח הפקדות · נבחרות · {pp}",
                          "הפקדות הקרנות הנבחרות ÷ כל ההפקדות לפנסיה המקיפה × 100", "default.json", d=2, b="actual"),
            "post": f2_fig("נתח הקרנות הנבחרות מההפקדות לפנסיה המקיפה, 12 החודשים הראשונים", s["post"], "pct", f"נתח הפקדות · נבחרות · {sp}",
                           "הפקדות הקרנות הנבחרות ÷ כל ההפקדות לפנסיה המקיפה × 100", "default.json", d=2, b="actual"),
            "d": f2_fig("שינוי נתח ההפקדות של הנבחרות", s["d"], "pp", "שינוי נתח · נבחרות", "אחרי פחות לפני", "default.json", d=2, b="actual")}
    if alls["post"].get("ret") is not None and rest["post"].get("ret") is not None:
        figs["rs"] = f2_fig("תשואה נטו, הקרנות הנבחרות, 12 החודשים הראשונים", alls["post"]["ret"], "pct", "תשואה נטו · נבחרות", "ממוצע משוקלל בנכסים, ריבית דריבית",
                            "default.json", d=2)
        figs["rr"] = f2_fig("תשואה נטו, שאר קרנות הפנסיה המקיפות, אותם חודשים", rest["post"]["ret"], "pct", "תשואה נטו · שאר הקרנות",
                            "ממוצע משוקלל בנכסים, ריבית דריבית", "default.json", d=2)
    up = s["d"] > 0
    corr = ("כן, במתינות" if up and s["d"] < 2 else "כן" if up else "לא") + ": נתח ההפקדות של ארבע הנבחרות השתנה ב-{d} בשנה הראשונה."
    email = (f"ארבע הקרנות שנבחרו מ-01.11.24 גייסו {{pre}} מההפקדות לפנסיה המקיפה בשנה שלפני ו-{{post}} בשנה הראשונה ({sp}), שינוי של {{d}}. "
             "מנגנון החלוקה לפי ספרת הביקורת חל רק מ-01.06.25, ושלוש מהארבע היו נבחרות גם בהליך הקודם, כך שחלק מהאפקט קדם לתקופה. "
             + ("התשואה נטו של הנבחרות באותה שנה {rs} מול {rr} בשאר הקרנות." if "rs" in figs else ""))
    rows_ = [["קרן", "נתח לפני", "נתח אחרי", "הפקדות לפני", "הפקדות אחרי", "תשואה נטו אחרי"]] + \
        [[f["grp"], f"{nf(f['pre']['share'], 2)}%" if "pre" in f else "–", f"{nf(f['post']['share'], 2)}%" if "post" in f else "–",
          nf(f.get("pre", {}).get("dep"), 0), nf(f.get("post", {}).get("dep"), 0), f"{nf(f.get('post', {}).get('ret'), 2)}%"] for f in rows]
    ex = table(f"קרנות הפנסיה הנבחרות, ההליך הרביעי: לפני ואחרי 01.11.24", rows_,
               ["הפקדות במיליוני ש\"ח, סכום 12 חודשים; נתח = מכלל ההפקדות לפנסיה המקיפה (פנסיה-נט)",
                "הזוכות, התקופה ודמי הניהול: רשות שוק ההון, שה.2024-2531, 19.09.2024, עמ' 1", SRC_F2], span=f"{pp} · {sp}")
    chg = changes_if("התשובה מתהפכת אם השינוי בנתח חוצה את {thr}", "d", "<=" if up else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "up" if up else "down", links=[link("ההיכל של החיסכון", "/funds")], rel=["Q-225", "Q-201"], asof=AS())


@question("Q-225", "בכל הליכי ברירת המחדל מאז 2016, כמה נתח הפקדות הרוויחו הנבחרות בשנה הראשונה?", ["reg", "strat", "ceo", "board"], "funds")
def q225(A):
    ts = [t for t in f2("default.json")["tenders"] if "sel_share" in t]
    if len(ts) < 3:
        return nodata("פחות משלושה הליכים עם שנה מלאה לפני ואחרי")
    ds = sorted(t["sel_share"]["d"] for t in ts)
    md = ds[len(ds) // 2] if len(ds) % 2 else (ds[len(ds) // 2 - 1] + ds[len(ds) // 2]) / 2
    ins = [(f"{t['label']} ({t['id']})", f"{nf(t['sel_share']['d'], 2)} נק׳", None) for t in ts]
    figs = {"md": f2_fig("חציון השינוי בנתח ההפקדות של הנבחרות בשנה הראשונה, כל ההליכים", md, "pp", "חציון · שינוי נתח הפקדות", "חציון השינויים",
                         "default.json", ins, d=2, b="actual"),
            "lo": f2_fig("השינוי הקטן ביותר", ds[0], "pp", "מינימום", "השינוי הקטן מבין ההליכים", "default.json", ins, d=2, b="actual"),
            "hi": f2_fig("השינוי הגדול ביותר", ds[-1], "pp", "מקסימום", "השינוי הגדול מבין ההליכים", "default.json", ins, d=2, b="actual")}
    pos = sum(1 for x in ds if x > 0)
    corr = ("בכל ההליכים מאז 2016" if pos == len(ts) else "ברוב ההליכים מאז 2016") + " נתח ההפקדות של הנבחרות עלה בשנה הראשונה, בחציון ב-{md}."
    email = (f"בהליכים שנבחנו ({', '.join(t['id'] for t in ts)}) עלה נתח הנבחרות מההפקדות לפנסיה המקיפה בשנה הראשונה בין {{lo}} ל-{{hi}}, בחציון {{md}}. "
             "זהירות בהשוואה: ב-2016 ספגה מיטב את קרן איילון וב-2021 את קרן הלמן אלדובי, כך שחלק מהעלייה הוא מיזוג ולא בחירת מעסיקים "
             "(השדה resid בקובץ מסמן שינוי נכסים שאינו מוסבר בהפקדות ובתשואה).")
    rows_ = [["הליך", "תחילה", "נבחרות", "דמי ניהול (צבירה / הפקדה)", "נתח לפני", "נתח אחרי", "שינוי", "אימות"]]
    for t in ts:
        fee = f"{nf(t['fee'], 2)}% / {nf(t['depfee'], 2)}%" if t.get("fee") is not None else "שונים לכל זוכה"
        rows_.append([t["label"], dlab(t["from"]), " · ".join(w["grp"] for w in t["winners"]), fee, f"{nf(t['sel_share']['pre'], 2)}%",
                      f"{nf(t['sel_share']['post'], 2)}%", nf(t["sel_share"]["d"], 2), "הרשות" if t["verified"] else "חלקי (עיתונות / דיווח החברה)"])
    ex = table("קרנות הפנסיה הנבחרות: נתח ההפקדות לפני ואחרי כל הליך", rows_,
               ["נתח = הפקדות הנבחרות ÷ כל ההפקדות לפנסיה המקיפה, 12 חודשים לפני ו-12 חודשים מתחילת התקופה",
                "מקורות לכל הליך: data/regulation/default_funds.json (חוזרי הרשות והודעות התוצאות; הליכים 2016 ו-2021 מאומתים חלקית)", SRC_F2])
    chg = changes_if("התשובה משתנה אם החציון יורד אל מתחת ל-{thr}", "md", "<=", 0.0)
    return answer(figs, corr, email, ex, chg, f"pos:{pos}/{len(ts)}", links=[link("ההיכל של החיסכון", "/funds")], rel=["Q-224"], asof=AS())


def glide_prod(prod):
    return next((p for p in f2("glide.json")["prods"] if p["prod"] == prod), None)


def st_fig(m, age, prod):
    t = m["tracks"][age]
    return fig(f"חשיפה למניות, {m['grp']}, {prod}, {age}", t["st_now"], "pct",
               P_calc(f"חשיפה למניות · {t['name']}", f"{nf(t['st_now'], 1)}%", "%", "STOCK_MARKET_EXPOSURE ÷ TOTAL_ASSETS × 100",
                      [("חשיפה למניות", "STOCK_MARKET_EXPOSURE", P_fund(f"חשיפה למניות · {t['name']}", "", "מיליוני ש\"ח", DS[t["k"][0]], int(t["k"][1:]), asof(),
                                                                        "STOCK_MARKET_EXPOSURE")),
                       ("נכסים", "TOTAL_ASSETS", P_fund(f"נכסים · {t['name']}", nf(t["assets"], 1), "מיליוני ש\"ח", DS[t["k"][0]], int(t["k"][1:]), asof(), "TOTAL_ASSETS"))]),
               AS(), d=1)


@question("Q-226", "מי לוקח את הסיכון המנייתי הגבוה ביותר במסלול לבני חמישים ומטה בפנסיה המקיפה?", ["dist", "inv", "reg", "ceo"], "funds")
def q226(A):
    p = glide_prod("פנסיה מקיפה")
    ms = [m for m in (p or {}).get("mgrs", []) if "עד 50" in m["tracks"] and m["tracks"]["עד 50"].get("st_now") is not None]
    if len(ms) < 5:
        return nodata("פחות מחמישה מנהלים עם מסלול לבני חמישים ומטה בפנסיה המקיפה")
    ms.sort(key=lambda m: -m["tracks"]["עד 50"]["st_now"])
    hi, lo = ms[0], ms[-1]
    med = p["med"]["עד 50"]["st"]
    figs = {"hi": st_fig(hi, "עד 50", "פנסיה מקיפה"), "lo": st_fig(lo, "עד 50", "פנסיה מקיפה"),
            "med": f2_fig("חציון החשיפה למניות, מסלולי לבני חמישים ומטה, פנסיה מקיפה", med, "pct", "חציון · חשיפה למניות",
                          "חציון בין המנהלים, המסלול הגדול של כל מנהל", "glide.json", [(m["grp"], f"{nf(m['tracks']['עד 50']['st_now'], 1)}%", None) for m in ms], b="actual")}
    nh, nl = hi["tracks"]["עד 50"]["net"], lo["tracks"]["עד 50"]["net"]
    if "a3" in nh and "a3" in nl:
        figs["rh"] = f2_fig(f"תשואה נטו, ממוצע שנתי 3 שנים, {hi['grp']}, לבני חמישים ומטה", nh["a3"], "pct", "נטו · 3 שנים", "funds.json net.a3", "glide.json", d=2)
        figs["rl"] = f2_fig(f"תשואה נטו, ממוצע שנתי 3 שנים, {lo['grp']}, לבני חמישים ומטה", nl["a3"], "pct", "נטו · 3 שנים", "funds.json net.a3", "glide.json", d=2)
    corr = f"{hi['grp']}: {{hi}} מהנכסים במניות במסלול לבני חמישים ומטה, הגבוה בפנסיה המקיפה."
    email = (f"ב-{AS()} מחזיק המסלול לבני חמישים ומטה של {hi['grp']} {{hi}} מנכסיו במניות, מול חציון של {{med}} ו-{{lo}} אצל {lo['grp']}. "
             + ("בשלוש שנים הניב הראשון {rh} בשנה נטו והאחרון {rl}." if "rh" in figs else "")
             + " זה מסלול ברירת המחדל של רוב החוסכים הצעירים, ולכן הפער ברמת הסיכון בו הוא החלטת השקעה של המנהל, לא של החוסך.")
    rows_ = [["מנהל", "לבני חמישים ומטה", "חמישים עד שישים", "שישים ומעלה", "פער צעירים-מבוגרים"]] + \
        [[m["grp"]] + [f"{nf(m['tracks'][a]['st_now'], 1)}%" if a in m["tracks"] else "–" for a in ("עד 50", "50-60", "60 ומעלה")] +
         [nf(m["gap"].get("st"), 1)] for m in ms]
    ex = table(f"פנסיה מקיפה: חשיפה למניות במסלולי הגיל, {AS()}", rows_,
               ["חשיפה למניות באחוזי נכסים (STOCK_MARKET_EXPOSURE ÷ TOTAL_ASSETS); מסלול הגיל הגדול של כל מנהל", SRC_F2], span=AS())
    chg = changes_if(f"המוביל מתחלף אם החשיפה של {hi['grp']} יורדת אל מתחת ל-{{thr}}", "hi", "<", ms[1]["tracks"]["עד 50"]["st_now"])
    return answer(figs, corr, email, ex, chg, f"hi:{hi['grp']}|lo:{lo['grp']}", links=[card({"k": hi["tracks"]["עד 50"]["k"], "name": hi["tracks"]["עד 50"]["name"]})],
                  rel=["Q-227", "Q-201"], asof=AS())


@question("Q-227", "כמה מניות יורדות בין מסלול הצעירים למסלול של בני שישים ומעלה, לפי מנהל?", ["dist", "reg", "inv"], "funds")
def q227(A):
    out = []
    for prod in ("פנסיה מקיפה", "גמל"):
        p = glide_prod(prod)
        for m in (p or {}).get("mgrs", []):
            if m["gap"].get("st") is not None:
                out.append((prod, m))
    if len(out) < 8:
        return nodata("פחות משמונה מנהלים עם מסלולי גיל מלאים")
    out.sort(key=lambda x: -x[1]["gap"]["st"])
    (ph, hi), (pl, lo) = out[0], out[-1]
    pen = glide_prod("פנסיה מקיפה")

    def gf(prod, m):
        y, o = m["tracks"]["עד 50"], m["tracks"]["60 ומעלה"]
        return f2_fig(f"פער החשיפה למניות בין מסלול הצעירים לשישים ומעלה, {m['grp']}, {prod}", m["gap"]["st"], "pp", f"פער גיל · {m['grp']} · {prod}",
                      "חשיפה למניות, לבני חמישים ומטה, פחות שישים ומעלה", "glide.json",
                      [(y["name"], f"{nf(y['st_now'], 1)}%", None), (o["name"], f"{nf(o['st_now'], 1)}%", None)])
    figs = {"hi": gf(ph, hi), "lo": gf(pl, lo),
            "med": f2_fig("חציון פער החשיפה למניות בין קבוצות הגיל, פנסיה מקיפה", pen["gap_med"].get("st"), "pp", "חציון פער גיל · פנסיה מקיפה",
                          "חציון בין המנהלים", "glide.json", b="actual")}
    corr = "בפנסיה המקיפה, בחציון המנהלים, החשיפה למניות של מסלול בני שישים ומעלה נמוכה ב-{med} מזו של מסלול בני חמישים ומטה."
    email = (f"ב-{AS()}, בחציון המנהלים בפנסיה המקיפה, ההפרש בחשיפה למניות בין מסלול הצעירים למסלול של בני שישים ומעלה הוא {{med}}. "
             f"הירידה התלולה ביותר אצל {hi['grp']} ({ph}), {{hi}}; המתונה אצל {lo['grp']} ({pl}), {{lo}}. "
             "פער קטן אומר שחוסך שמתקרב לפרישה נשאר חשוף יותר לירידות שוק.")
    rows_ = [["מוצר", "מנהל", "לבני חמישים ומטה", "שישים ומעלה", "פער"]] + \
        [[prod, m["grp"], f"{nf(m['tracks']['עד 50']['st_now'], 1)}%", f"{nf(m['tracks']['60 ומעלה']['st_now'], 1)}%", nf(m["gap"]["st"], 1)] for prod, m in out]
    ex = table(f"מסלולי הגיל: חשיפה למניות, צעירים מול שישים ומעלה, {AS()}", rows_,
               ["חשיפה למניות באחוזי נכסים; מסלול הגיל הגדול של כל מנהל; גמל ופנסיה מקיפה", SRC_F2], span=AS())
    chg = changes_if("התשובה משתנה מהותית אם החציון יורד אל מתחת ל-{thr}", "med", "<", 20.0)
    return answer(figs, corr, email, ex, chg, f"hi:{hi['grp']}|lo:{lo['grp']}", links=[link("ההיכל של החיסכון", "/funds")], rel=["Q-226"], asof=AS())


@question("Q-228", "מי בהשתלמות, מסלול כללי, השיג את התשואה העודפת הגבוהה ביותר ליחידת סיכון בשלוש שנים?", ["inv", "dist", "board"], "funds")
def q228(A):
    st = stats_of("השתלמות | כללי")
    xs = [t for t in (st or {}).get("tracks", []) if t.get("sharpe36") is not None and t.get("basis") == "net" and not t.get("self_dir") and not t.get("sector")]
    if len(xs) < 8:
        return nodata("פחות משמונה מסלולים עם מדד שארפ ל-36 חודשים נטו")
    xs.sort(key=lambda t: -t["sharpe36"])
    top, bot = xs[0], xs[-1]
    path = f"stats/{st['slug']}.json"
    span = f"{ym(st['win'][0])}–{ym(st['win'][1])}"

    def sf(t, key, lab, unit="r", d=2):
        return f2_fig(f"{lab}, {t['grp']}, {t['name']}", t[key], unit, f"{lab} · {t['name']} · {span}", st["method"][key if key in st["method"] else "sharpe36"], path, d=d)
    figs = {"top": sf(top, "sharpe36", "מדד שארפ, 36 חודשים, נטו"), "bot": sf(bot, "sharpe36", "מדד שארפ, 36 חודשים, נטו"),
            "med": f2_fig("חציון מדד שארפ, 36 חודשים, השתלמות כללי", st["cat_median"]["sharpe36"], "r", "חציון שארפ", st["method"]["cat_median"], path, d=2),
            "vt": sf(top, "vol36", "תנודתיות שנתית, 36 חודשים", "pct"), "at": sf(top, "a36", "תשואה ממוצעת שנתית, 36 חודשים, נטו", "pct"),
            "rf": f2_fig("ריבית חסרת סיכון, ממוצע שנתי, 36 חודשים", st["rf"].get("a36"), "pct", "ריבית חסרת סיכון", st["rf"]["method"], path, d=2, b="actual")}
    corr = f"{top['grp']}: מדד שארפ של {{top}} בשלוש השנים, הגבוה בהשתלמות במסלול הכללי."
    email = (f"בשלוש השנים {span} הניב המסלול הכללי של {top['grp']} {{at}} בשנה נטו בתנודתיות של {{vt}}, כלומר מדד שארפ {{top}} מעל ריבית חסרת סיכון של {{rf}}; "
             f"חציון הקטגוריה {{med}} והנמוך ({bot['grp']}) {{bot}}. שארפ מודד תשואה עודפת ליחידת תנודתיות, לא ציון כולל.")
    rows_ = [["מנהל", "שארפ", "סורטינו", "תנודתיות", "ירידה מקסימלית", "תשואה שנתית נטו"]] + \
        [[t["grp"], nf(t["sharpe36"], 2), nf(t.get("sortino36"), 2), f"{nf(t.get('vol36'), 2)}%", f"{nf(t.get('dd_max'), 2)}%", f"{nf(t.get('a36'), 2)}%"] for t in xs[:12]]
    ex = table(f"השתלמות כללי: סיכון ותשואה, 36 חודשים, נטו, {span}", rows_,
               ["שארפ וסורטינו מעל תשואת אג\"ח ממשלתי אפס-קופון לשנה (בנק ישראל); נטו = אומדן", "שנים עשר המסלולים עם השארפ הגבוה",
                "מסלולים פתוחים לציבור, בלי ניהול אישי ו-IRA", SRC_F2], span=span)
    chg = changes_if(f"המוביל מתחלף אם השארפ של {top['grp']} יורד אל מתחת ל-{{thr}}", "top", "<", xs[1]["sharpe36"])
    return answer(figs, corr, email, ex, chg, f"top:{top['k']}", links=[card(top), compare([top, xs[1]], 36)], rel=["Q-200", "Q-229"], asof=AS())


@question("Q-229", "איזה מסלול פנסיה לבני חמישים ומטה בילה הכי הרבה חודשים ברבע העליון בשלוש השנים האחרונות?", ["dist", "inv", "board"], "funds")
def q229(A):
    R = rank_of_cat("פנסיה מקיפה | עד 50")
    if not R or len(R["months"]) < 36:
        return nodata("אין דירוג חודשי של 36 חודשים למסלולים לבני חמישים ומטה")
    s = next(x for x in R["sets"] if x["metric"] == "y12" and x["basis"] == "net")
    out = []
    for k, xs in s["tracks"].items():
        last = xs[-36:]
        if all(x is not None for x in last):
            out.append((sum(1 for x in last if x >= 75), k))
    if len(out) < 5:
        return nodata("פחות מחמישה מסלולים עם דירוג בכל 36 החודשים")
    out.sort(key=lambda x: (-x[0], x[1]))
    rows = {f["k"]: f for f in F()["funds"]}
    n, k = out[0]
    f = rows.get(k, {"k": k, "name": k, "grp": k})
    span = f"{ym(R['months'][-36])}–{ym(R['months'][-1])}"
    path = f"rank/{R['slug']}.json"
    cnt = sorted(x[0] for x in out)
    figs = {"n": f2_fig(f"חודשים ברבע העליון מתוך 36, {f['grp']}, לבני חמישים ומטה", n, "n", f"חודשים ברבע העליון · {f['name']}",
                        "חודשים שבהם אחוזון תשואת 12 החודשים נטו בקטגוריה ≥ 75", path, d=0),
            "med": f2_fig("חציון החודשים ברבע העליון, מסלולי לבני חמישים ומטה", cnt[len(cnt) // 2] if len(cnt) % 2 else (cnt[len(cnt) // 2 - 1] + cnt[len(cnt) // 2]) / 2,
                          "n", "חציון חודשים ברבע העליון", "חציון בין המסלולים שדורגו בכל 36 החודשים", path, d=0),
            "k": f2_fig("מסלולים שדורגו בכל 36 החודשים", len(out), "n", "מסלולים", "ספירה", path, d=0, b="actual")}
    corr = f"{f['grp']}: {{n}} חודשים מתוך שלושים ושישה ברבע העליון, הכי הרבה מבין מסלולי הפנסיה לבני חמישים ומטה."
    email = (f"בשלוש השנים {span}, מדורג כל חודש לפי תשואת שנים עשר החודשים נטו בתוך הקטגוריה, בילה המסלול של {f['grp']} {{n}} חודשים ברבע העליון; "
             f"החציון בין {{k}} המסלולים שדורגו לאורך כל התקופה הוא {{med}}. דירוג חודשי של חלון נע חופף, ולכן חודשים סמוכים אינם תצפיות בלתי תלויות.")
    rows_ = [["מנהל", "מסלול", "חודשים ברבע העליון", "אחוזון אחרון"]] + \
        [[rows.get(kk, {}).get("grp", kk), rows.get(kk, {}).get("name", kk), nf(c, 0), nf(s["tracks"][kk][-1], 0)] for c, kk in out]
    ex = table(f"פנסיה מקיפה, לבני חמישים ומטה: חודשים ברבע העליון, {span}", rows_,
               ["אחוזון בקטגוריה של תשואת 12 החודשים נטו (אומדן), חברי הקטגוריה כפי שהיו בכל חודש; רבע עליון = אחוזון 75 ומעלה", SRC_F2], span=span)
    chg = changes_if("המוביל מתחלף אם מספר החודשים שלו יורד אל מתחת ל-{thr}", "n", "<", out[1][0])
    return answer(figs, corr, email, ex, chg, f"top:{k}", links=[card(f)], rel=["Q-201", "Q-228"], asof=AS())
