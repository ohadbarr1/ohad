"""Regulatory exposure: which initiative costs the industry most, who is exposed to which, by how much, in shekels and as a share of profit
(Q-165..Q-179).

Source: regulation/impact.json (A8: the initiative register, each modelled per manager and product with drivers.ts propagate at three
bands; the pipeline exposure weights each initiative by the probability of its stage, an assumption stated in the file). Every figure is
a model estimate (basis "estimate") whose inputs are the published driver inputs (regulator assets, fee yield, printed profit) and the
initiative's stated assumptions.
"""
from math import fsum
from statistics import median

from answer_core import P_calc, fmt, he, link, load, nf, nodata, question
from questions._grp import answer, INS, MAIN, MM, F, bars, bars2, names_list, shallow

L_REG = link("חדר המלחמה: רגולציה", "/warroom/regulation")
SEG = {"pen": "פנסיה", "gem": "גמל והשתלמות", "ic": "פוליסות חיסכון"}
BAND = "central"
BANDS = {"low": "תרחיש נמוך", "central": "תרחיש מרכזי", "high": "תרחיש גבוה"}


def R():
    return load("regulation/impact.json")


def ini(i):
    return next(x for x in R()["initiatives"] if x["id"] == i)


def imp(i, c):
    return next((x for x in ini(i)["impacts"] if x["c"] == c), None)


def mgr(c):
    return R()["managers"].get(c) or {}


def prod_prov(i, c, pr, band=BAND):
    x = ini(i)
    m = (mgr(c).get("products") or {}).get(pr["s"]) or {}
    ins = []
    for b in pr["basis"]:
        v = b["v"][band]
        p = b.get("p") or ((b.get("pb") or {}).get(band))
        ins.append((b["label"] + (" (הנחה)" if b.get("est") else ""), f"{nf(v, 2)} {b['unit']}", p))
    for k, lab in (("A", "נכסים ממוצעים"), ("fy", "תשואת דמי ניהול")):
        if m.get(k):
            ins.append((lab, nf(m[k]["v"], 4 if k == "fy" else 1), m[k]["p"]))
    d = pr["d"][band]
    return P_calc(f"השפעה על הרווח התפעולי · {he(c)} · {SEG.get(pr['s'], pr['s'])} · {x['short']} · {BANDS[band]}", fmt(d["dOp"], "m", signed=True), MM,
                  "drivers.ts propagate: Δ נכסים × תשואת דמי ניהול + נכסים × Δ דמי ניהול − Δ עלות משתנה, קצב שנתי לאחר כניסה לתוקף", ins, est=True)


def net_prov(i, c, band=BAND):
    x, y = ini(i), imp(i, c)
    tax = mgr(c).get("tax")
    ins = [(SEG.get(pr["s"], pr["s"]), fmt(pr["d"][band]["dOp"], "m", signed=True), prod_prov(i, c, pr, band)) for pr in y["products"]]
    ins.append(("שיעור מס (הנחה)", f"{nf(tax, 2)}%", None))
    return P_calc(f"השפעה שנתית אחרי מס · {he(c)} · {x['short']} · {BANDS[band]}", fmt(y["net"][band], "m", signed=True), MM,
                  "Σ על המוצרים השפעה על הרווח התפעולי × (1 − מס)", ins, est=True, note="מודל, לא תחזית: ההנחות של היוזמה גלויות בדף, בשלושה תרחישים")


def net_fig(i, c, label=None):
    y = imp(i, c)
    return F(label or f"השפעה שנתית אחרי מס, {ini(i)['short']}, {he(c)}", y["net"][BAND], "m", shallow(net_prov(i, c), "/warroom/regulation", 3), "Q2'26", c=c, b="estimate", signed=True)


def exp_row(c):
    return next((x for x in R()["exposure"] if x["c"] == c), None)


def exp_prov(c, band=BAND):
    e = exp_row(c)
    ins = []
    for b in e["by"]:
        y = imp(b["id"], c)
        if y is None:
            continue
        ins.append((f"{ini(b['id'])['short']} × משקל {nf(b['w'], 2)} (הנחה)", fmt(y["net"][band] * b["w"], "m", signed=True), shallow(net_prov(b["id"], c, band), "/warroom/regulation", 2)))
    return P_calc(f"חשיפה משוקללת לצנרת הרגולטורית · {he(c)} · {BANDS[band]}", fmt(e["net"][band], "m", signed=True), MM,
                  "Σ על היוזמות משקל × השפעה שנתית אחרי מס; משקל = הסתברות כניסה לתוקף לפי שלב (הנחה; יוזמה בתוקף כבר בבסיס ה-LTM, משקל 0)", ins, est=True)


def exp_fig(c):
    return F(f"חשיפה משוקללת אחרי מס, {he(c)}", exp_row(c)["net"][BAND], "m", exp_prov(c), "Q2'26", c=c, b="estimate", signed=True)


def pct_fig(c):
    e, m = exp_row(c), mgr(c)
    v = e["pct_np"][BAND]
    return F(f"חשיפה משוקללת כשיעור מהרווח, {he(c)}", v, "pct",
             P_calc(f"חשיפה ÷ רווח · {he(c)}", fmt(v, "pct", signed=True), "%", "חשיפה משוקללת אחרי מס ÷ רווח נקי LTM × 100",
                    [("חשיפה משוקללת", fmt(e["net"][BAND], "m", signed=True), exp_prov(c)), ("רווח נקי LTM", fmt(m["np"]["v"], "m"), m["np"]["p"])], est=True),
             "Q2'26", c=c, b="estimate", signed=True)


FOOT = "A8: regulation/impact.json, תרחיש מרכזי; מודל drivers.ts על כל מוצר, ההנחות של כל יוזמה גלויות"


@question("Q-165", "איזו יוזמה רגולטורית עולה לענף הכי הרבה?", ["reg", "ceo", "strat", "board"], "regx", [])
def q165(A):
    xs = [x for x in R()["initiatives"] if x.get("total") and x["impacts"]]
    if not xs:
        return nodata("אין יוזמה עם השפעה מכומתת")
    xs = sorted(xs, key=lambda x: x["total"][BAND])
    top = xs[0]
    unq = [x for x in R()["initiatives"] if not x["impacts"]]

    def tfig(x):
        v = fsum(fsum(pr["d"][BAND]["dOp"] for pr in y["products"]) for y in x["impacts"])
        return F(f"השפעה שנתית לפני מס על הענף, {x['short']}", v, "m",
                 P_calc(f"השפעה על הענף · {x['short']} · תרחיש מרכזי", fmt(v, "m", signed=True), MM, "Σ על המנהלים ההשפעה על הרווח התפעולי לפני מס",
                        [(he(y["c"]), fmt(fsum(pr["d"][BAND]["dOp"] for pr in y["products"]), "m", signed=True), shallow(net_prov(x["id"], y["c"]), "/warroom/regulation", 1)) for y in x["impacts"]], est=True),
                 "Q2'26", b="estimate", signed=True)
    figs = {"top": tfig(top)}
    corr = f"{top['short']}: כ-{{top}} בשנה לכל המנהלים יחד, לפני מס."
    email = f"היוזמה היקרה לענף היא {top['short']}: {{top}} בשנה לפני מס, בתרחיש המרכזי ולאחר כניסה מלאה לתוקף. "
    if len(xs) > 1:
        figs["sec"] = tfig(xs[1])
        email += f"אחריה {xs[1]['short']}, {{sec}}. "
    if unq:
        email += f"ל{', '.join(x['short'] for x in unq)} אין עדיין כימות: חסר בסיס לפרמטר המרכזי."
    ex = bars("השפעה שנתית לפני מס על הענף, לפי יוזמה", MM, [], [FOOT])
    ex["cats"] = [x["short"] for x in xs]
    ex["series"] = [{"name": "תרחיש מרכזי", "type": "bar", "data": [round(x["total"][BAND], 3) for x in xs]},
                    {"name": "תרחיש גבוה", "type": "bar", "data": [round(x["total"]["high"], 3) for x in xs]}]
    ex["kind"] = "hbar"
    ex["foot"] = ["מיליוני ש\"ח לשנה, לפני מס, קצב לאחר כניסה מלאה לתוקף, ללא שקלול הסתברות", FOOT]
    return answer(figs, corr, email, ex, None, f"top:{top['id']}", links=[L_REG], rel=["Q-166", "Q-169"], asof="Q2'26")


def ranked_exp(key):
    xs = [x["c"] for x in R()["exposure"] if x.get("pct_np", {}).get(BAND) is not None or key == "net"]
    return xs


@question("Q-166", "מי הכי חשופה לצנרת הרגולטורית, בשקלים?", ["reg", "ceo", "cfo", "board"], "regx", MAIN)
def q166(A):
    cs = sorted([x["c"] for x in R()["exposure"]], key=lambda c: exp_row(c)["net"][BAND])
    if len(cs) < 2:
        return nodata("אין חשיפה משוקללת לשני מנהלים")
    top, sec = cs[0], cs[1]
    figs = {"top": exp_fig(top), "sec": exp_fig(sec),
            "high": F(f"חשיפה משוקללת בתרחיש הגבוה, {he(top)}", exp_row(top)["net"]["high"], "m", exp_prov(top, "high"), "Q2'26", c=top, b="estimate", signed=True)}
    corr = f"{he(top)}: חשיפה משוקללת של {{top}} בשנה אחרי מס."
    email = (f"בשקלול לפי שלב כל יוזמה, {he(top)} חשופה ל-{{top}} בשנה אחרי מס (עד {{high}} בתרחיש הגבוה); אחריה {he(sec)}, {{sec}}. "
             "הסדר נקבע בעיקר לפי גודל הנכסים המנוהלים, שעליהם חלות היוזמות.")
    ex = bars("חשיפה משוקללת לצנרת הרגולטורית, אחרי מס", MM, [(c, exp_row(c)["net"][BAND]) for c in cs],
              ["מיליוני ש\"ח לשנה, תרחיש מרכזי, משוקלל בהסתברות לפי שלב (הנחה)", FOOT], name="חשיפה")
    return answer(figs, corr, email, ex, None, f"top:{top}", links=[L_REG], rel=["Q-167", "Q-173"], asof="Q2'26")


@question("Q-167", "מי הכי חשופה לצנרת הרגולטורית ביחס לרווח שלה?", ["reg", "inv", "board", "ceo"], "regx", INS)
def q167(A):
    cs = [x["c"] for x in R()["exposure"] if (x.get("pct_np") or {}).get(BAND) is not None and mgr(x["c"]).get("np")]
    if len(cs) < 2:
        return nodata("אין רווח LTM לשני מנהלים")
    cs = sorted(cs, key=lambda c: exp_row(c)["pct_np"][BAND])
    top, lo = cs[0], cs[-1]
    figs = {"top": pct_fig(top), "lo": pct_fig(lo), "nis": exp_fig(top)}
    corr = f"{he(top)}: החשיפה שלה שווה {{top}} מהרווח השנתי."
    email = (f"ביחס לרווח, {he(top)} החשופה ביותר: {{nis}} בשנה, {{top}} מהרווח הנקי LTM. בקצה השני {he(lo)}, {{lo}}. "
             "מי שהרווח שלה נשען על חיסכון ארוך טווח (ולא על ביטוח) נפגעת יותר באחוזים, גם כשהסכום קטן.")
    ex = bars("חשיפה משוקללת כשיעור מהרווח הנקי LTM", "%", [(c, exp_row(c)["pct_np"][BAND]) for c in cs],
              ["% מהרווח הנקי LTM Q2'26, תרחיש מרכזי, משוקלל (הנחה)", FOOT], name="חשיפה ÷ רווח")
    return answer(figs, corr, email, ex, None, f"top:{top}", links=[L_REG], rel=["Q-166", "Q-172"], asof="Q2'26")


def one_initiative(i):
    x = ini(i)
    ys = sorted(x["impacts"], key=lambda y: y["net"][BAND])
    if not ys:
        return nodata(f"ל{x['short']} אין כימות: {x['model'].get('why', 'חסר בסיס לפרמטר המרכזי')}")
    lo, hi = ys[0], ys[-1]
    figs = {"lo": net_fig(i, lo["c"])}
    gain = [y["c"] for y in ys if y["net"][BAND] > 0]
    st = {"in_force": "בתוקף", "proposal": "הצעה", "consultation": "בהתייעצות", "approved": "אושר"}.get(x["status"], x["status"])
    if gain:
        figs["hi"] = net_fig(i, hi["c"])
        corr = f"מרוויחות {names_list(gain)}; הנפגעת הגדולה {he(lo['c'])}, {{lo}} בשנה."
        vk = f"lose:{lo['c']}|gain:{','.join(gain)}"
        email = (f"{x['short']} ({st}): בתרחיש המרכזי {he(hi['c'])} מרוויחה {{hi}} בשנה אחרי מס, ו{he(lo['c'])} מפסידה {{lo}}. ")
    else:
        figs["hi"] = net_fig(i, ys[1]["c"]) if len(ys) > 1 else net_fig(i, lo["c"])
        corr = f"כולם נפגעים, והכי הרבה {he(lo['c'])}: {{lo}} בשנה אחרי מס."
        vk = f"lose:{lo['c']}"
        email = (f"{x['short']} ({st}): בתרחיש המרכזי {he(lo['c'])} נפגעת ב-{{lo}} בשנה אחרי מס, ואחריה {he(ys[1]['c'] if len(ys) > 1 else lo['c'])}, {{hi}}. ")
    mod = x["model"].get("he")
    if mod:
        email += f"המנגנון: {mod.split(';')[0]}."
    ex = bars(f"{x['short']}: השפעה שנתית אחרי מס, לפי מנהל", MM, [(y["c"], y["net"][BAND]) for y in ys],
              ["מיליוני ש\"ח לשנה, תרחיש מרכזי, קצב לאחר כניסה מלאה לתוקף (ללא שקלול הסתברות)", FOOT], name="תרחיש מרכזי")
    ex["series"].append({"name": "תרחיש גבוה", "type": "bar", "data": [round(y["net"]["high"], 3) for y in ys]})
    ex["kind"] = "cat"
    return answer(figs, corr, email, ex, None, vk, links=[L_REG], rel=["Q-165", "Q-166"], asof="Q2'26")


for _id, _i, _q in (("Q-168", "default-funds-2024", "מי מרוויחה ומי מפסידה ממנגנון קרנות ברירת המחדל?"),
                    ("Q-169", "investment-account-2026", "מי נפגעת הכי הרבה מחשבון ההשקעה המוצע?"),
                    ("Q-170", "eac-reasoning-2026", "מי נפגעת הכי הרבה מהצגת העלות השנתית הצפויה במסמך ההנמקה?"),
                    ("Q-171", "returns-publication-2026", "מי נפגעת הכי הרבה מכללי פרסום התשואה החדשים?")):
    question(_id, _q, ["reg", "ceo", "strat", "dist"], "regx", [])(lambda A, _i=_i: one_initiative(_i))


@question("Q-172", "האם בתי ההשקעות נפגעים מהרגולציה יותר מהמבטחות?", ["reg", "strat", "inv"], "regx", INS)
def q172(A):
    rows = [x for x in R()["exposure"] if (x.get("pct_np") or {}).get(BAND) is not None and mgr(x["c"]).get("np")]
    ins = [x["c"] for x in rows if mgr(x["c"]).get("kind") == "insurance_group"]
    fh = [x["c"] for x in rows if mgr(x["c"]).get("kind") == "fund_house"]
    if len(ins) < 2 or len(fh) < 2:
        return nodata("אין מספיק מנהלים בכל קבוצה")

    def med(cs, title):
        v = median([exp_row(c)["pct_np"][BAND] for c in cs])
        return F(title, v, "pct", P_calc(title, fmt(v, "pct", signed=True), "%", "חציון של החשיפה המשוקללת ÷ רווח נקי LTM",
                                         [(he(c), fmt(exp_row(c)["pct_np"][BAND], "pct", signed=True), None) for c in cs], est=True), "Q2'26", b="estimate", signed=True)
    figs = {"f": med(fh, "חציון החשיפה כשיעור מהרווח, בתי השקעות"), "i": med(ins, "חציון החשיפה כשיעור מהרווח, מבטחות")}
    more = figs["f"]["v"] < figs["i"]["v"]
    corr = "כן: חציון החשיפה של בתי ההשקעות הוא {f} מהרווח." if more else "לא: חציון החשיפה של המבטחות גבוה יותר, {i} מהרווח."
    email = ("בחציון, החשיפה המשוקללת של בתי ההשקעות היא {f} מהרווח הנקי, מול {i} במבטחות. "
             "בית השקעות מרוויח כמעט רק מדמי ניהול, ולכן כל שחיקה בדמי הניהול פוגעת ישירות בשורה התחתונה; אצל מבטחת הרווח מגיע גם מביטוח.")
    order = sorted(ins + fh, key=lambda c: exp_row(c)["pct_np"][BAND])
    ex = bars("חשיפה משוקללת ÷ רווח נקי, מבטחות ובתי השקעות", "%", [(c, exp_row(c)["pct_np"][BAND]) for c in order],
              ["% מהרווח הנקי LTM, תרחיש מרכזי, משוקלל (הנחה)", FOOT], name="חשיפה ÷ רווח")
    return answer(figs, corr, email, ex, None, "funds" if more else "insurers", links=[L_REG], rel=["Q-167"], asof="Q2'26")


def company_reg(c):
    e = exp_row(c)
    if not e:
        return nodata(f"אין ל{he(c)} חשיפה מכומתת")
    by = [(b["id"], imp(b["id"], c)) for b in e["by"] if imp(b["id"], c)]
    allin = [(x["id"], imp(x["id"], c)) for x in R()["initiatives"] if imp(x["id"], c)]
    worst = min(allin, key=lambda t: t[1]["net"][BAND])
    figs = {"exp": exp_fig(c), "w": net_fig(worst[0], c)}
    if (e.get("pct_np") or {}).get(BAND) is not None:
        figs["pct"] = pct_fig(c)
    order = sorted([x["c"] for x in R()["exposure"]], key=lambda k: exp_row(k)["net"][BAND])
    rank = order.index(c) + 1
    figs["rank"] = F(f"מקום בענף לפי חשיפה בשקלים, {he(c)}", rank, "n",
                     P_calc(f"דירוג החשיפה · {he(c)}", str(rank), "מקום", "מיון המנהלים לפי חשיפה משוקללת אחרי מס, מהגבוהה (1)",
                            [(he(k), fmt(exp_row(k)["net"][BAND], "m", signed=True), None) for k in order[:max(rank, 3)]], est=True),
                     "Q2'26", c=c, b="estimate", t=f"{rank} מתוך {len(order)}")
    corr = f"{he(c)} חשופה ל-{{exp}} בשנה אחרי מס, בשקלול לפי שלב כל יוזמה."
    email = (f"בשקלול לפי הסתברות, החשיפה של {he(c)} לצנרת הרגולטורית היא {{exp}} בשנה אחרי מס" + (", {pct} מהרווח" if "pct" in figs else "") +
             f"; בשקלים היא במקום {{rank}} בענף. היוזמה הכבדה ביותר עבורה: {ini(worst[0])['short']}, {{w}} בשנה אם תיכנס במלואה.")
    ex = bars2(f"{he(c)}: השפעה שנתית אחרי מס, לפי יוזמה", MM, [], [], [FOOT])
    ex["cats"] = [ini(i)["short"] for i, _ in allin]
    ex["series"] = [{"name": "תרחיש מרכזי", "type": "bar", "data": [round(y["net"][BAND], 3) for _, y in allin]},
                    {"name": "תרחיש גבוה", "type": "bar", "data": [round(y["net"]["high"], 3) for _, y in allin]}]
    ex["foot"] = ["מיליוני ש\"ח לשנה, ללא שקלול הסתברות; יוזמה בתוקף כבר בבסיס הרווח", FOOT]
    return answer(figs, corr, email, ex, None, f"rank:{rank}|worst:{worst[0]}", links=[L_REG, link(he(c), f"/company/{c}")], rel=["Q-166", "Q-167"], asof="Q2'26")


for _k, _c in enumerate(MAIN):
    question(f"Q-{173 + _k}", f"מה החשיפה הרגולטורית של {he(_c)}?", ["ceo", "reg", "board"], "regx", [_c])(lambda A, _c=_c: company_reg(_c))
