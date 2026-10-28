"""Competitive position: who earns most on equity, who sits at its own peak, size rank changes, who can buy whom and which consolidation
pairs pay (Q-150..Q-164).

Sources: expectations/<co>.json (A3: ROE LTM and its 24-quarter history, P/B on the manual 22.10.26 price), csm/capital.json (printed
equity), capital/options.json (A7: solvency bases, bolt-on), consolidation/matrix.json + pairs/<a>__<t>.json (A9: synergy NPV, price at
the screen's primary premium, capacity to pay, ranking).
"""
from statistics import median

from answer_core import P_calc, P_rep, changes_if, fmt, he, link, load, nf, nodata, question
from questions._grp import (answer, FUNDS, INS, MAIN, MM, F, bars, bars2, cap_fig, cap_prov, capco, capser, cons_prov, names_list, shallow, table, xp,
                             xp_index)

L_XP = link("מה המחיר דורש", "/expectations")
L_CONS = link("מסך האיחודים", "/consolidation")


def roe_fig(c):
    b = xp(c)["base"]["roe_ltm"]
    return F(f"תשואה להון LTM, {he(c)}", b["v"], "pct", b["prov"], "LTM Q2'26", c=c)


def xp_ok():
    return [x["id"] for x in xp_index() if x["status"] == "ok" and xp(x["id"]) and (xp(x["id"])["base"].get("roe_ltm") or {}).get("v") is not None]


@question("Q-150", "מי הכי רווחית על ההון בענף?", ["ceo", "inv", "strat", "board"], "comp", INS + FUNDS)
def q150(A):
    cs = sorted(xp_ok(), key=lambda c: -xp(c)["base"]["roe_ltm"]["v"])
    if len(cs) < 3:
        return nodata("פחות משלוש חברות עם ROE LTM")
    ins = [c for c in cs if c in INS]
    top, itop, ilo = cs[0], ins[0], ins[-1]
    figs = {"top": roe_fig(top), "itop": roe_fig(itop), "ilo": roe_fig(ilo)}
    corr = f"{he(top)}, עם תשואה להון של {{top}} ב-LTM."
    email = (f"ב-LTM עד Q2'26 התשואה להון הגבוהה בענף היא של {he(top)}, {{top}}. בין המבטחות מובילה {he(itop)} עם {{itop}}, והנמוכה {he(ilo)} עם {{ilo}}. "
             "בתי ההשקעות עובדים על הון קטן מאוד ביחס לנכסים, לכן ה-ROE שלהם גבוה מטבעו; ההשוואה המשמעותית היא בתוך כל קבוצה.")
    ex = bars("תשואה להון, LTM Q2'26", "%", [(c, xp(c)["base"]["roe_ltm"]["v"]) for c in cs],
              ["%, רווח נקי LTM לבעלי המניות ÷ הון ממוצע; כל הרבעונים בתקן החדש", "A3 (expectations), דוחות כספיים"], name="ROE LTM")
    chg = changes_if(f"{he(itop)} מאבדת את ההובלה בין המבטחות כשה-ROE שלה יורד מתחת ל-{{thr}}", "itop", "<", xp(ins[1])["base"]["roe_ltm"]["v"])
    return answer(figs, corr, email, ex, chg, f"top:{top}|ins:{itop}", links=[L_XP], rel=["Q-151", "Q-160", "Q-184"], asof="LTM Q2'26")


@question("Q-151", "מי נמצאת בשיא התשואה להון ביחס להיסטוריה שלה?", ["inv", "board", "ceo"], "comp", INS + FUNDS)
def q151(A):
    cs = [c for c in xp_ok() if (xp(c).get("roe") or {}).get("hist", {}).get("max")]
    if len(cs) < 2:
        return nodata("אין היסטוריית ROE לשתי חברות")

    def rel_(c):
        return xp(c)["base"]["roe_ltm"]["v"] / xp(c)["roe"]["hist"]["max"] * 100

    def hfig(c, k):
        h = xp(c)["roe"]["hist"]
        return F(f"{'שיא' if k == 'max' else 'חציון'} ROE LTM ב-24 רבעונים, {he(c)}", h[k], "pct", h["prov"], "Q2'26", c=c)
    cs = sorted(cs, key=lambda c: -rel_(c))
    top = cs[0]
    at = [c for c in cs if rel_(c) >= 99.5]
    figs = {"r": roe_fig(top), "max": hfig(top, "max"), "med": hfig(top, "med")}
    corr = (f"{he(top)}: ה-ROE של היום, {{r}}, הוא הגבוה בהיסטוריה שנמדדה.") if at else \
        f"אף אחת לא בשיא; הקרובה ביותר {he(top)}, עם {{r}}."
    email = (f"ה-ROE LTM של {he(top)}, {{r}}, מול שיא של {{max}} וחציון של {{med}} ב-24 רבעונים שנמדדו. "
             "ההיסטוריה חוצה את המעבר בין התקנים החשבונאיים בתחילת 2025 (הרבעונים הישנים לפי התקן הקודם), כך שהשוואה לשיא שלפני המעבר היא בקירוב.")
    ex = bars2("ROE LTM היום מול החציון והשיא ב-24 רבעונים", "%", cs,
               [("היום", [xp(c)["base"]["roe_ltm"]["v"] for c in cs]), ("חציון", [xp(c)["roe"]["hist"]["med"] for c in cs]), ("שיא", [xp(c)["roe"]["hist"]["max"] for c in cs])],
               ["%; היסטוריה: רווח LTM ÷ הון ממוצע לכל רבעון (XBRL); שבר תקן בתחילת 2025", "A3 (expectations), kpi.json"])
    return answer(figs, corr, email, ex, None, f"at:{len(at)}|top:{top}", links=[L_XP], rel=["Q-150", "Q-181"], asof="Q2'26")


@question("Q-152", "האם השתנה סדר הגודל של הקבוצות לפי הון עצמי בשנה האחרונה?", ["ceo", "strat", "inv"], "comp", INS)
def q152(A):
    cs = [c for c in INS if capser(c, "equity_attributable", "2026Q2") and capser(c, "equity_attributable", "2025Q2")]
    if len(cs) < 3:
        return nodata("אין הון לבעלי המניות לשתי התקופות")

    def eq(c, k):
        return capser(c, "equity_attributable", k)["v"]

    def efig(c, k):
        p = capser(c, "equity_attributable", k)
        lab = "Q2'26" if k == "2026Q2" else "Q2'25"
        return F(f"הון לבעלי המניות, {he(c)}, {lab}", p["v"], "m", P_rep(f"הון לבעלי המניות · {he(c)} · {lab}", nf(p["v"], 1), MM, p["u"], p["pg"], "דוח כספי", lab), lab, c=c)
    now = sorted(cs, key=lambda c: -eq(c, "2026Q2"))
    then = sorted(cs, key=lambda c: -eq(c, "2025Q2"))
    moved = [c for c in cs if now.index(c) != then.index(c)]
    figs = {"top": efig(now[0], "2026Q2"), "sec": efig(now[1], "2026Q2")}
    if moved:
        up = min(moved, key=lambda c: now.index(c) - then.index(c))
        figs["up"] = efig(up, "2026Q2")
        figs["up0"] = efig(up, "2025Q2")
        corr = f"כן: {he(up)} עלתה למקום ה-{now.index(up) + 1} עם הון של {{up}}."
        email = (f"{he(up)} עלתה ממקום {then.index(up) + 1} למקום {now.index(up) + 1}: הון של {{up0}} ב-Q2'25 ו-{{up}} ב-Q2'26. "
                 f"בראש נשארה {he(now[0])}, {{top}}, ואחריה {he(now[1])}, {{sec}}.")
        vk = "moved:" + ",".join(f"{c}{then.index(c) + 1}>{now.index(c) + 1}" for c in moved)
    else:
        corr = f"לא: הסדר נשמר, ובראש {he(now[0])} עם הון של {{top}}."
        email = f"הסדר לפי הון לבעלי המניות זהה ל-Q2'25. בראש {he(now[0])}, {{top}}, ואחריה {he(now[1])}, {{sec}}."
        vk = "same"
    ex = bars2("הון לבעלי המניות, Q2'25 ו-Q2'26", MM, now, [("Q2'25", [eq(c, "2025Q2") for c in now]), ("Q2'26", [eq(c, "2026Q2") for c in now])],
               ["מיליוני ש\"ח, כפי שהודפס", "csm/capital.json (דוחות כספיים, עמוד לכל תקופה)"])
    return answer(figs, corr, email, ex, None, vk, links=[link("הון וחלוקה", "/capital")], rel=["Q-121"], asof="Q2'26")


# ------------------------------------------------------------------------------------------------ consolidation (A9)
def M():
    return load("consolidation/matrix.json")


def pdoc(a, t):
    try:
        return load(f"consolidation/pairs/{a}__{t}.json")
    except FileNotFoundError:
        return None


def prem(d):
    return next(x for x in d["premia"] if x["p"] == d["meta"]["primary"])


def metric_fig(a, t, label=None):
    d = pdoc(a, t)
    return F(label or f"ערך נוכחי של הסינרגיה ÷ מחיר, {he(a)} ← {he(t)}", d["metric"]["v"], "pct", shallow(cons_prov(d["metric"]["prov"], d), f"/consolidation/{a}/{t}", 4), "Q2'26", c=a, b="estimate")


def npv_fig(a, t):
    d = pdoc(a, t)
    return F(f"ערך נוכחי של הסינרגיה, {he(a)} ← {he(t)}", d["synergy"]["npv"]["v"], "m", shallow(cons_prov(d["synergy"]["npv"]["prov"], d), f"/consolidation/{a}/{t}", 4), "Q2'26", c=a, b="estimate", signed=True)


def price_fig(a, t):
    d = pdoc(a, t)
    p = prem(d)["price"]
    return F(f"מחיר היעד בפרמיית המסך, {he(t)}", p["v"], "m", shallow(cons_prov(p["prov"], d), f"/consolidation/{a}/{t}", 4), "Q2'26", c=t, b="estimate")


def cap_total(a):
    for t in sorted(M()["cos"]):
        d = pdoc(a, t) if t != a else None
        if d:
            return d
    return None


@question("Q-153", "למי יש את כוח הקנייה הגדול ביותר לרכישה?", ["ceo", "strat", "board", "cfo"], "comp", MAIN)
def q153(A):
    cs = [c for c in M()["cos"] if cap_total(c)]
    if len(cs) < 2:
        return nodata("אין קיבולת תשלום לשתי חברות")

    def tot(c):
        return cap_total(c)["capacity"]["total"]["v"]

    def tfig(c):
        d = cap_total(c)
        return F(f"קיבולת תשלום לרכישה, {he(c)}", tot(c), "m", cons_prov(d["capacity"]["total"]["prov"], d), "Q2'26", c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -tot(c))
    top, sec = cs[0], cs[1]
    figs = {"top": tfig(top), "sec": tfig(sec)}
    corr = f"{he(top)}: היא יכולה לשלם עד {{top}} על רכישה."
    email = (f"קיבולת התשלום (הון פנוי לחלוקה ועוד מרווח חוב עד המינוף החציוני של הענף) הגבוהה ביותר היא של {he(top)}, {{top}}; אחריה {he(sec)}, {{sec}}. "
             "בית השקעות נמדד בהון העצמי שלו כתקרה, כי אין לו חישוב כושר פירעון; ההנחות (מינוף מרבי, מרווח ניהולי) ניתנות לשינוי בדף.")
    ex = bars("קיבולת תשלום לרכישה: מזומן ומרווח חוב", MM, [(c, tot(c)) for c in cs],
              ["מיליוני ש\"ח, Q2'26; הנחות גלויות: מינוף מרבי = חציון הענף", "A9 (consolidation/pairs), A7 (capital/options.json)"], name="קיבולת")
    return answer(figs, corr, email, ex, None, f"top:{top}", links=[L_CONS], rel=["Q-113", "Q-154"], asof="Q2'26")


def ranked():
    return sorted([p for p in M()["pairs"] if p["rank"] is not None and not p["nc"]], key=lambda p: p["rank"])


@question("Q-154", "אילו צמדי איחוד מייצרים ערך ונכנסים בתקציב של הרוכשת?", ["ceo", "strat", "board", "inv"], "comp", MAIN + ["altshuler", "more", "analyst"])
def q154(A):
    rk = ranked()
    good = [p for p in rk if p["ok"] and p["npv"] > 0]
    if not rk:
        return nodata("אין צמדים מדורגים")
    figs = {"n": F("צמדים מדורגים עם ערך חיובי שהרוכשת יכולה לממן", len(good), "n",
                   P_calc("צמדים בני ביצוע", str(len(good)), "צמדים", "צמד שבו ערך הסינרגיה הנוכחי חיובי והמחיר בפרמיית המסך בתוך קיבולת התשלום של הרוכשת",
                          [(f"{he(p['a'])} ← {he(p['t'])}", fmt(p["metric"], "pct"), shallow(cons_prov(pdoc(p["a"], p["t"])["metric"]["prov"], pdoc(p["a"], p["t"])), f"/consolidation/{p['a']}/{p['t']}")) for p in good]),
                   "Q2'26", b="estimate", t=f"{len(good)} מתוך {len(rk)}")}
    best = rk[0]
    figs["best"] = metric_fig(best["a"], best["t"])
    if good:
        g = good[0]
        figs["g"] = metric_fig(g["a"], g["t"])
        figs["gnpv"] = npv_fig(g["a"], g["t"])
        corr = f"מעטים: {{n}} צמדים, והטוב שבהם {he(g['a'])} ← {he(g['t'])}."
        email = (f"מבין הצמדים המדורגים, {{n}} גם מייצרים ערך וגם נכנסים בקיבולת התשלום של הרוכשת. הטוב שבהם, {he(g['a'])} ← {he(g['t'])}, "
                 f"מניב ערך נוכחי של סינרגיה של {{gnpv}}, {{g}} מהמחיר. ")
        if (best["a"], best["t"]) != (g["a"], g["t"]):
            email += f"הצמד המדורג ראשון, {he(best['a'])} ← {he(best['t'])}, מניב {{best}} מהמחיר, אבל הרוכשת לא יכולה לממן אותו."
        vk = f"good:{len(good)}|{g['a']}>{g['t']}"
    else:
        corr = "אף צמד לא גם מייצר ערך וגם נכנס בתקציב: {n}."
        email = f"הצמד המדורג ראשון, {he(best['a'])} ← {he(best['t'])}, מניב {{best}} מהמחיר אבל חורג מקיבולת התשלום; אין צמד אחר שעומד בשני התנאים ({{n}})."
        vk = "good:0"
    tab = [[str(p["rank"]), he(p["a"]), he(p["t"]), fmt(p["npv"], "m", 0, True), fmt(p["price"], "m", 0), fmt(p["cap"], "m", 0), fmt(p["metric"], "pct"), "כן" if p["ok"] else "לא"]
           for p in rk[:12]]
    ex = table("צמדי איחוד מדורגים: ערך הסינרגיה מול המחיר", ["דירוג", "רוכשת", "יעד", "ערך נוכחי", "מחיר", "קיבולת", "ערך ÷ מחיר", "במימון"], tab,
               ["מיליוני ש\"ח; מחיר בפרמיית המסך; ערך = סינרגיית עלות בפנסיה ובגמל, אחרי מס ועלות אינטגרציה (הנחות גלויות)", "A9: consolidation/matrix.json"])
    return answer(figs, corr, email, ex, None, vk, links=[L_CONS], rel=["Q-153", "Q-155", "Q-158"], asof="Q2'26")


def natural(t):
    ps = [p for p in ranked() if p["t"] == t]
    if not ps:
        return nodata(f"אין צמד מדורג עם {he(t)} כיעד")
    b = ps[0]
    ok = [p for p in ps if p["ok"] and p["npv"] > 0]
    figs = {"m": metric_fig(b["a"], b["t"]), "npv": npv_fig(b["a"], b["t"]), "price": price_fig(b["a"], b["t"])}
    corr = f"{he(b['a'])}: הסינרגיה שלה עם {he(t)} שווה {{m}} מהמחיר, הגבוה מבין הרוכשות."
    email = (f"מבין הרוכשות האפשריות, ל{he(b['a'])} הסינרגיה הגדולה ביותר ביחס למחיר: ערך נוכחי של {{npv}} מול מחיר של {{price}} ({{m}}). ")
    if b["ok"]:
        email += f"היא גם יכולה לממן את העסקה מתוך קיבולת התשלום שלה."
        vk = f"best:{b['a']}|ok"
    elif ok:
        o = ok[0]
        figs["om"] = metric_fig(o["a"], o["t"])
        email += f"אבל היא לא יכולה לממן אותה; הרוכשת הטובה ביותר שכן יכולה היא {he(o['a'])}, עם {{om}}."
        vk = f"best:{b['a']}|fund:{o['a']}"
    else:
        email += "אף רוכשת לא יכולה לממן את העסקה בפרמיית המסך."
        vk = f"best:{b['a']}|none"
    tab = [[he(p["a"]), fmt(p["npv"], "m", 0, True), fmt(p["price"], "m", 0), fmt(p["metric"], "pct"), "כן" if p["ok"] else "לא", str(p["rank"])] for p in ps]
    ex = table(f"{he(t)} כיעד: הרוכשות האפשריות", ["רוכשת", "ערך נוכחי של הסינרגיה", "מחיר", "ערך ÷ מחיר", "במימון", "דירוג במסך"], tab,
               ["מיליוני ש\"ח, Q2'26; סינרגיית עלות בפנסיה ובגמל (הנחות גלויות: מימוש, עלות אינטגרציה, אופק)", "A9: consolidation/pairs"])
    chg = None
    if len(ps) > 1:
        chg = changes_if(f"{he(b['a'])} מאבדת את המקום הראשון כשהיחס יורד מתחת ל-{{thr}}", "m", "<", ps[1]["metric"])
    return answer(figs, corr, email, ex, chg, vk, links=[link(f"{he(b['a'])} ← {he(t)}", f"/consolidation/{b['a']}/{t}"), L_CONS], rel=["Q-154"], asof="Q2'26")


for _id, _t in (("Q-155", "altshuler"), ("Q-156", "more"), ("Q-157", "analyst")):
    question(_id, f"מי הרוכשת הטבעית של {he(_t)}?", ["ceo", "strat", "board"], "comp", [_t])(lambda A, _t=_t: natural(_t))


@question("Q-158", "האם מיזוג בין שתי מבטחות גדולות מייצר ערך?", ["ceo", "strat", "board", "reg"], "comp", MAIN)
def q158(A):
    ps = [p for p in ranked() if p["a"] in MAIN and p["t"] in MAIN]
    if not ps:
        return nodata("אין צמד מדורג בין המבטחות הגדולות")
    b = ps[0]
    ok = [p for p in ps if p["ok"]]
    pos = [p for p in ps if p["npv"] > 0]
    figs = {"m": metric_fig(b["a"], b["t"]), "npv": npv_fig(b["a"], b["t"]), "price": price_fig(b["a"], b["t"]),
            "pos": F("צמדים בין המבטחות הגדולות עם ערך סינרגיה חיובי", len(pos), "n",
                     P_calc("צמדים עם ערך חיובי", str(len(pos)), "צמדים", "ספירת הצמדים המדורגים בין חמש המבטחות הגדולות שערך הסינרגיה הנוכחי שלהם חיובי",
                            [(f"{he(p['a'])} ← {he(p['t'])}", fmt(p["npv"], "m", 0, True), shallow(cons_prov(pdoc(p["a"], p["t"])["synergy"]["npv"]["prov"], pdoc(p["a"], p["t"])), f"/consolidation/{p['a']}/{p['t']}")) for p in pos]),
                     "Q2'26", b="estimate", t=f"{len(pos)} מתוך {len(ps)}")}
    corr = (f"בחלק מהצמדים כן, אבל אף מבטחת לא יכולה לממן: הטוב ביותר, {he(b['a'])} ← {he(b['t'])}, מניב {{m}} מהמחיר.") if not ok else \
        f"כן, והצמד הטוב ביותר, {he(b['a'])} ← {he(b['t'])}, גם במימון: {{m}} מהמחיר."
    email = (f"בצמד המוביל, {he(b['a'])} רוכשת את פעילות הפנסיה והגמל של {he(b['t'])}: ערך נוכחי של סינרגיה {{npv}} מול מחיר של {{price}}. "
             "{pos} צמדים בין המבטחות הגדולות מייצרים ערך חיובי. "
             "המסך מודד רק סינרגיית עלות בחיסכון ארוך הטווח, בלי ביטוח, הון או תחרות; אישור הממונה והתחרות הם מבחן נפרד.")
    tab = [[he(p["a"]), he(p["t"]), fmt(p["npv"], "m", 0, True), fmt(p["price"], "m", 0), fmt(p["metric"], "pct"), "כן" if p["ok"] else "לא"] for p in ps]
    ex = table("צמדים בין המבטחות הגדולות", ["רוכשת", "יעד", "ערך נוכחי", "מחיר", "ערך ÷ מחיר", "במימון"], tab,
               ["מיליוני ש\"ח, Q2'26; פעילות פנסיה וגמל בלבד", "A9: consolidation/matrix.json"])
    return answer(figs, corr, email, ex, None, f"best:{b['a']}>{b['t']}|ok:{len(ok)}", links=[L_CONS], rel=["Q-154"], asof="Q2'26")


@question("Q-159", "מי מובילה בכושר הפירעון בבסיס אחיד, ללא הוראות מעבר?", ["reg", "board", "inv", "ceo"], "comp", INS)
def q159(A):
    cs = [c for c in INS if capco(c) and "wo" in capco(c)["bases"]]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם יחס ללא הוראות מעבר")

    def r(c):
        return capco(c)["bases"]["wo"]["ratio"]["v"]
    cs = sorted(cs, key=lambda c: -r(c))
    top, lo = cs[0], cs[-1]
    per = capco(top)["period"]
    figs = {"top": cap_fig(top, f"יחס כושר פירעון ללא הוראות מעבר, {he(top)}", capco(top)["bases"]["wo"]["ratio"], "pct", per),
            "lo": cap_fig(lo, f"יחס כושר פירעון ללא הוראות מעבר, {he(lo)}", capco(lo)["bases"]["wo"]["ratio"], "pct", per)}
    corr = f"{he(top)}, עם יחס של {{top}} ללא הוראות מעבר."
    email = (f"בבסיס אחיד, ללא הוראות מעבר, ליום החישוב של {per}, היחס הגבוה הוא של {he(top)}, {{top}}, והנמוך של {he(lo)}, {{lo}}. "
             "זה הבסיס שישאר כשהוראות המעבר יסתיימו, ולכן הוא הבסיס להשוואה בין החברות.")
    ex = bars(f"יחס כושר פירעון ללא הוראות מעבר, {per}", "%", [(c, r(c)) for c in cs],
              ["%, הון עצמי ÷ SCR של חברת הביטוח", "A7: capital/options.json (דוחות כספיים, עמוד לכל קלט)"], name="ללא הוראות מעבר")
    return answer(figs, corr, email, ex, None, f"top:{top}|lo:{lo}", links=[link("הון וחלוקה", "/capital")], rel=["Q-104", "Q-100"], asof=per)


@question("Q-160", "בתי ההשקעות מול המבטחות: מי מרוויח יותר על ההון?", ["strat", "inv", "ceo"], "comp", INS + FUNDS)
def q160(A):
    cs = xp_ok()
    ins = [c for c in cs if c in INS]
    fh = [c for c in cs if c not in INS]
    if len(ins) < 2 or len(fh) < 2:
        return nodata("אין מספיק חברות בכל קבוצה")

    def med(xs, title):
        v = median([xp(c)["base"]["roe_ltm"]["v"] for c in xs])
        return F(title, v, "pct", P_calc(title, fmt(v, "pct"), "%", "חציון ה-ROE LTM של החברות בקבוצה",
                                         [(he(c), fmt(xp(c)["base"]["roe_ltm"]["v"], "pct"), xp(c)["base"]["roe_ltm"]["prov"]) for c in xs]), "LTM Q2'26")
    figs = {"f": med(fh, "חציון ROE LTM, בתי השקעות"), "i": med(ins, "חציון ROE LTM, מבטחות")}
    fhi = figs["f"]["v"] > figs["i"]["v"]
    corr = ("בתי ההשקעות: חציון ROE של {f}." if fhi else "המבטחות: חציון ROE של {i}.")
    email = ("ב-LTM עד Q2'26, חציון התשואה להון של בתי ההשקעות הוא {f}, מול {i} במבטחות. "
             "הפער הוא בעיקר מבני: בית השקעות מחזיק הון קטן ביחס לנכסים שהוא מנהל, מבטחת מחזיקה הון מול סיכון ביטוחי ודרישות Solvency; לכן ה-P/B שונה בהתאם.")
    ex = bars2("ROE LTM: מבטחות ובתי השקעות", "%", ins + fh, [("ROE LTM", [xp(c)["base"]["roe_ltm"]["v"] for c in ins + fh])],
               ["%, LTM Q2'26", "A3 (expectations), דוחות כספיים"], kind="hbar")
    return answer(figs, corr, email, ex, None, "funds" if fhi else "insurers", links=[L_XP], rel=["Q-150", "Q-184"], asof="LTM Q2'26")


@question("Q-161", "לאיזו מבטחת יש רכישה משלימה שמשתלמת?", ["ceo", "strat", "cfo"], "comp", MAIN)
def q161(A):
    rows = []
    for c in INS:
        x = capco(c)
        if not x:
            continue
        o = next((o for o in x["options"] if o["id"] == "bolt"), None)
        if o and o.get("status") == "ok":
            rows.append((c, o))
    if not rows:
        return nodata("לאף מבטחת אין יעד שהיא יכולה לממן עם ערך סינרגיה חיובי")
    rows = sorted(rows, key=lambda r: -r[1]["metric"]["v"])
    c, o = rows[0]
    figs = {"npv": F(f"ערך נוכחי של הסינרגיה, {he(c)} ← {o['tgt_name']}", o["npv"]["v"], "m", cap_prov(capco(c), o["npv"]["prov"]), "Q2'26", c=c, b="estimate"),
            "roic": F(f"ROIC ברכישה, {he(c)} ← {o['tgt_name']}", o["roic"]["v"], "pct", cap_prov(capco(c), o["roic"]["prov"]), "Q2'26", c=c, b="estimate"),
            "ke": cap_fig(c, "מחיר ההון (ke)", capco(c)["pnl"]["ke"], "pct", "09/26", b="estimate")}
    corr = f"{he(c)}: רכישת {o['tgt_name']} מייצרת ערך נוכחי של {{npv}}."
    email = (f"הרכישה המשלימה של {he(c)} היא {o['tgt_name']}: ערך נוכחי של סינרגיה {{npv}}, אבל תשואה על ההון המושקע של {{roic}} בלבד, מתחת למחיר ההון ({{ke}}). "
             "ערך הסינרגיה חיובי, אבל המחיר כולל את שווי היעד עצמו, ולכן חלוקה לבעלי המניות עדיין מניבה יותר.")
    if len(rows) > 1:
        c2, o2 = rows[1]
        email += f" גם ל{he(c2)} יש יעד כזה ({o2['tgt_name']})."
    none = [x for x in INS if capco(x) and x not in [r[0] for r in rows]]
    if none:
        email += f" ל{names_list(none)} אין יעד שהן יכולות לממן עם ערך חיובי."
    tab = [[he(c_), o_["tgt_name"], fmt(o_["npv"]["v"], "m", 1, True), fmt(o_["roic"]["v"], "pct"), fmt(o_["metric"]["v"], "pct"), fmt(o_["cap"]["v"], "m", 0)] for c_, o_ in rows]
    ex = table("רכישות משלימות שהמבטחות יכולות לממן", ["מבטחת", "יעד", "ערך נוכחי", "ROIC", "ערך ÷ מחיר", "מחיר"], tab,
               ["מיליוני ש\"ח; פרמיית המסך; היעד הראשון בדירוג A9 שהרוכשת יכולה לממן עם ערך חיובי", "A7 (capital/options.json), A9 (consolidation/bolt.json)"])
    return answer(figs, corr, email, ex, None, f"best:{c}>{o['tgt']}", links=[link("הון וחלוקה", "/capital"), L_CONS], rel=["Q-110", "Q-154"], asof="Q2'26")
