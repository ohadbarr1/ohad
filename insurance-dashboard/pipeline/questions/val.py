"""Valuation: what the market price requires (ROE, CSM release, AUM growth), against the company's own history and management's targets;
P/B against the P/B its ROE justifies; how much of the profit is the equity market; CSM against book (Q-180..Q-199).

Source: expectations/<co>.json (A3: one input solved at a time so that the model value equals the market value, the others at their
trailing level; percentile against the company's own 24 quarters). Prices are a manual quote of 22.10.26 (labelled on every figure that
uses one); the price is an input to the valuation, never a headline. Required levels are model estimates (basis "estimate"), management
targets basis "target"; an answer that sets them side by side is labelled `mix`.
"""
from answer_core import P_calc, changes_if, fmt, he, link, load, nodata, question
from questions._grp import answer, FUNDS, INS, MAIN, PRICE_LABEL, F, bars, bars2, names_list, table, xp, xp_index

L_XP = link("מה המחיר דורש", "/expectations")
PD = "22.10.26"


def ok_roe():
    return [x["id"] for x in xp_index() if x["status"] == "ok" and xp(x["id"]) and (xp(x["id"]).get("roe") or {}).get("status") == "ok"]


def req_fig(c):
    r = xp(c)["roe"]["req"]
    return F(f"ROE ב-FY'28 שהמחיר דורש, {he(c)} ({PRICE_LABEL})", r["v"], "pct", r["prov"], PD, c=c, b="estimate")


def trail_fig(c):
    r = xp(c)["roe"]["trail"]
    return F(f"ROE ב-FY'28 בערכים הנוכחיים, {he(c)}", r["v"], "pct", r["prov"], "LTM Q2'26", c=c, b="estimate")


def ltm_fig(c):
    b = xp(c)["base"]["roe_ltm"]
    return F(f"ROE LTM, {he(c)}", b["v"], "pct", b["prov"], "LTM Q2'26", c=c)


def step(c):
    r = xp(c)["roe"]
    return r["req"]["v"] - r["trail"]["v"]


@question("Q-180", "איזה ROE המחיר דורש מכל חברה, ובכמה זה מעל הקצב הנוכחי?", ["inv", "ceo", "board", "cfo"], "val", INS + FUNDS)
def q180(A):
    cs = sorted(ok_roe(), key=lambda c: -step(c))
    if len(cs) < 2:
        return nodata("פחות משתי חברות עם ROE נדרש")
    top, lo = cs[0], cs[-1]

    def sfig(c):
        return F(f"ROE נדרש פחות ROE בערכים הנוכחיים, {he(c)}", step(c), "pp",
                 P_calc(f"פער ה-ROE שהמחיר מניח · {he(c)}", fmt(step(c), "pp"), "נ״א", "ROE ב-FY'28 שבו שווי המודל = שווי השוק − ROE ב-FY'28 בערכים הנוכחיים",
                        [("ROE נדרש", fmt(xp(c)["roe"]["req"]["v"], "pct"), xp(c)["roe"]["req"]["prov"]), ("ROE בערכים הנוכחיים", fmt(xp(c)["roe"]["trail"]["v"], "pct"), xp(c)["roe"]["trail"]["prov"])], est=True),
                 PD, c=c, b="estimate")
    figs = {"top": sfig(top), "req": req_fig(top), "tr": trail_fig(top), "lo": sfig(lo)}
    corr = f"{he(top)}: המחיר דורש ממנה ROE גבוה ב-{{top}} מהקצב הנוכחי."
    email = (f"במחיר של {PD}, השוק דורש מ{he(top)} ROE של {{req}} ב-FY'28, מול {{tr}} אם הכול יישאר ברמה הנוכחית (רווח מנורמל לתשואת מניות רגילה): פער של {{top}}. "
             f"בקצה השני {he(lo)}, {{lo}}: המחיר שלה מניח פחות ממה שהיא מייצרת היום.")
    ex = bars2("ROE ב-FY'28: מה המחיר דורש מול הערכים הנוכחיים", "%", cs,
               [("נדרש במחיר", [xp(c)["roe"]["req"]["v"] for c in cs]), ("בערכים הנוכחיים", [xp(c)["roe"]["trail"]["v"] for c in cs])],
               [f"%; {PRICE_LABEL}; מודל: ערך נוכחי של החלוקות עד FY'28 ועוד P/B מוצדק × הון FY'28, היוון ב-ke", "A3: expectations/<co>.json (הנחות גלויות: ke, g, נרמול)"])
    return answer(figs, corr, email, ex, None, f"top:{top}|lo:{lo}", links=[L_XP], rel=["Q-181", "Q-185", "Q-190"], asof=PD)


@question("Q-181", "אצל מי המחיר דורש ROE שהחברה מעולם לא השיגה?", ["inv", "board", "ceo"], "val", INS + FUNDS)
def q181(A):
    cs = [c for c in ok_roe() if xp(c)["roe"].get("hist", {}).get("pct") is not None]
    if not cs:
        return nodata("אין אחוזון היסטורי ל-ROE הנדרש")
    above = [c for c in cs if xp(c)["roe"]["req"]["v"] > xp(c)["roe"]["hist"]["max"]]
    cs = sorted(cs, key=lambda c: -(xp(c)["roe"]["req"]["v"] - xp(c)["roe"]["hist"]["max"]))
    top = cs[0]
    h = xp(top)["roe"]["hist"]
    figs = {"req": req_fig(top), "max": F(f"שיא ROE LTM ב-24 רבעונים, {he(top)}", h["max"], "pct", h["prov"], "Q2'26", c=top)}
    if above:
        corr = f"{names_list(above)}: אצל {he(top)} המחיר דורש {{req}}, מעל כל רבעון שנמדד."
        vk = "above:" + ",".join(sorted(above))
    else:
        corr = f"אף חברה: הקרובה ביותר לשיא היא {he(top)}, שהמחיר דורש ממנה {{req}}."
        vk = "none"
    email = (f"המחיר של {PD} דורש מ{he(top)} ROE של {{req}} ב-FY'28, מול שיא של {{max}} ב-24 רבעונים שנמדדו. ")
    near = [c for c in cs if c not in above and xp(c)["roe"]["hist"]["pct"] >= 85]
    if near:
        email += f"גם אצל {names_list(near)} המחיר דורש רמה מהעשירון העליון של ההיסטוריה. "
    email += "ההיסטוריה חוצה את המעבר בין התקנים החשבונאיים בתחילת 2025, כך שההשוואה לשיא היא בקירוב."
    ex = bars2("ROE נדרש מול השיא ההיסטורי", "%", cs, [("נדרש במחיר", [xp(c)["roe"]["req"]["v"] for c in cs]), ("שיא ב-24 רבעונים", [xp(c)["roe"]["hist"]["max"] for c in cs])],
               [f"%; {PRICE_LABEL}; היסטוריה: ROE LTM לכל רבעון (XBRL), שבר תקן בתחילת 2025", "A3: expectations/<co>.json"])
    return answer(figs, corr, email, ex, None, vk, links=[L_XP], rel=["Q-180", "Q-151"], asof=PD)


def vs_target(c):
    e = xp(c)
    t = (e.get("targets") or {}).get("roe")
    if not e or not t or e["roe"].get("status") != "ok":
        return nodata(f"אין ל{he(c)} יעד ROE ל-FY'28 או ROE נדרש")
    tv = t["lo"] if t.get("lo") is not None else t["v"]
    ttxt = (f"{fmt(t['lo'], 'pct', 0)}–{fmt(t['hi'], 'pct', 0)}" if t.get("lo") is not None and t.get("hi") is not None else fmt(tv, "pct", 0))
    figs = {"req": req_fig(c), "tgt": F(f"{t['he']}, {he(c)}, FY'28", tv, "pct", t["prov"], "FY'28", c=c, b="target", t=ttxt),
            "ltm": ltm_fig(c)}
    rq = e["roe"]["req"]["v"]
    gap = rq - tv
    figs["gap"] = F(f"ROE נדרש פחות יעד ההנהלה (הקצה התחתון), {he(c)}", gap, "pp",
                    P_calc(f"ROE נדרש מול יעד · {he(c)}", fmt(gap, "pp"), "נ״א", "ROE ב-FY'28 שהמחיר דורש − יעד ההנהלה ל-FY'28 (הקצה התחתון)",
                           [("נדרש", fmt(rq, "pct"), e["roe"]["req"]["prov"]), ("יעד", ttxt, t["prov"])], est=True), PD, c=c, b="estimate")
    if gap > 0:
        corr = f"לא: המחיר דורש {{req}}, מעל היעד של ההנהלה ל-FY'28."
        vk = "above-target"
    else:
        corr = f"כן: יעד ההנהלה ל-FY'28 מכסה את מה שהמחיר דורש, {{req}}."
        vk = "covered"
    core = "ליבה" in t["he"]
    email = (f"במחיר של {PD} השוק דורש מ{he(c)} ROE של {{req}} ב-FY'28; היעד של ההנהלה לאותה שנה הוא {{tgt}}, פער של {{gap}} מהקצה התחתון. "
             "ה-ROE של היום, ב-LTM, {ltm}. " + ("היעד מוגדר על רווח ליבה (הגדרת החברה), וה-ROE הנדרש על רווח חשבונאי מנורמל; ההשוואה בקירוב. " if core else "") +
             "יעד הוא הצהרה, ה-ROE הנדרש הוא מודל: שני בסיסים שונים, מוצגים זה לצד זה.")
    ex = bars2(f"{he(c)}: ROE ב-FY'28, נדרש מול יעד ההנהלה", "%", [c], [("נדרש במחיר", [rq]), ("יעד ההנהלה (תחתון)", [tv]), ("LTM היום", [e["base"]["roe_ltm"]["v"]])],
               [f"%; {PRICE_LABEL}; יעד כפי שפורסם (מסמך ועמוד)", "A3: expectations/<co>.json, targets.json"])
    chg = changes_if("התשובה מתהפכת כשהפער חוצה את {thr}", "gap", "<=" if gap > 0 else ">", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[L_XP, link(he(c), f"/valuation/{c}")], rel=["Q-180", "Q-190", "Q-136" if c == "phoenix" else "Q-137"], asof=PD)


question("Q-182", "האם יעד ה-ROE של הנהלת הפניקס מספיק כדי להצדיק את המחיר?", ["ceo", "board", "inv", "cfo"], "val", ["phoenix"])(lambda A: vs_target("phoenix"))
question("Q-183", "האם יעד ה-ROE של הנהלת מגדל מספיק כדי להצדיק את המחיר?", ["ceo", "board", "inv", "cfo"], "val", ["migdal"])(lambda A: vs_target("migdal"))


def jpb(c):
    b = xp(c)["base"]
    return (b["roe_ltm"]["v"] - b["g"]["v"]) / (b["ke"]["v"] - b["g"]["v"])


def jpb_prov(c):
    b = xp(c)["base"]
    return P_calc(f"P/B מוצדק לפי ROE LTM · {he(c)}", fmt(jpb(c), "x"), "×", "(ROE LTM − g) ÷ (ke − g): צמיחה קבועה, ROE LTM נשמר לנצח (הנחה)",
                  [("ROE LTM", fmt(b["roe_ltm"]["v"], "pct"), b["roe_ltm"]["prov"]), ("ke", fmt(b["ke"]["v"], "pct"), b["ke"]["prov"]), ("g", fmt(b["g"]["v"], "pct"), b["g"]["prov"])], est=True)


@question("Q-184", "מי נסחרת מעל ה-P/B שה-ROE שלה מצדיק, ומי מתחתיו?", ["inv", "board", "cfo"], "val", INS + FUNDS)
def q184(A):
    cs = [x["id"] for x in xp_index() if x["status"] == "ok" and xp(x["id"]) and (xp(x["id"])["base"].get("pb") or {}).get("v")]
    if len(cs) < 3:
        return nodata("פחות משלוש חברות עם P/B")

    def ratio(c):
        return xp(c)["base"]["pb"]["v"] / jpb(c)

    def rfig(c):
        b = xp(c)["base"]
        return F(f"P/B בשוק ÷ P/B מוצדק, {he(c)}", ratio(c), "x",
                 P_calc(f"P/B בשוק מול מוצדק · {he(c)}", fmt(ratio(c), "x"), "×", "P/B בשוק ÷ P/B מוצדק לפי ROE LTM",
                        [(f"P/B בשוק ({PRICE_LABEL})", fmt(b["pb"]["v"], "x"), b["pb"]["prov"]), ("P/B מוצדק", fmt(jpb(c), "x"), jpb_prov(c))], est=True), PD, c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -ratio(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": rfig(hi), "lo": rfig(lo), "pb": F(f"P/B בשוק, {he(hi)} ({PRICE_LABEL})", xp(hi)["base"]["pb"]["v"], "x", xp(hi)["base"]["pb"]["prov"], PD, c=hi),
            "jpb": F(f"P/B מוצדק לפי ROE LTM, {he(hi)}", jpb(hi), "x", jpb_prov(hi), "LTM Q2'26", c=hi, b="estimate")}
    corr = f"{he(hi)} הכי מעל: ה-P/B שלה הוא {{hi}} ממה שה-ROE הנוכחי מצדיק."
    email = (f"{he(hi)} נסחרת ב-P/B של {{pb}}, מול {{jpb}} שה-ROE LTM שלה מצדיק אם יישמר לנצח: יחס של {{hi}}. "
             f"בקצה השני {he(lo)}, {{lo}}: השוק מתמחר אותה מתחת למה שהרווחיות הנוכחית שווה. "
             "P/B מוצדק = (ROE − g) ÷ (ke − g), עם ke ו-g של מודול הציפיות (הנחות גלויות).")
    ex = bars2("P/B בשוק מול P/B מוצדק לפי ROE LTM", "×", cs, [("P/B בשוק", [xp(c)["base"]["pb"]["v"] for c in cs]), ("P/B מוצדק", [jpb(c) for c in cs])],
               [f"×; {PRICE_LABEL}; הון לבעלי המניות Q2'26", "A3: expectations/<co>.json (ke = rf + β × ERP, g = 2%, הנחות)"])
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_XP], rel=["Q-150", "Q-185"], asof=PD)


@question("Q-185", "מי מתומחרת לשיפור הגדול ביותר, ומי לירידה?", ["inv", "board", "ceo"], "val", INS + FUNDS)
def q185(A):
    cs = [x["id"] for x in xp_index() if x["status"] == "ok" and xp(x["id"]) and (xp(x["id"])["base"].get("gap") or {}).get("v") is not None]
    if len(cs) < 2:
        return nodata("פחות משתי חברות עם פער מחיר")

    def gfig(c):
        g = xp(c)["base"]["gap"]
        return F(f"שווי שוק מעל שווי המודל בערכים הנוכחיים, {he(c)}", g["v"], "pct", g["prov"], PD, c=c, b="estimate", signed=True)
    cs = sorted(cs, key=lambda c: -xp(c)["base"]["gap"]["v"])
    hi, lo = cs[0], cs[-1]
    neg = [c for c in cs if xp(c)["base"]["gap"]["v"] < 0]
    figs = {"hi": gfig(hi), "lo": gfig(lo)}
    corr = f"{he(hi)}: השוק משלם עליה {{hi}} מעל מה שהיא שווה אם הכול יישאר כמו היום."
    email = (f"במחיר של {PD}, שווי השוק של {he(hi)} גבוה ב-{{hi}} משווי המודל בערכים הנוכחיים (רווח מנורמל, חלוקה וצמיחה כמו היום). "
             f"בקצה השני {he(lo)}, {{lo}}: המחיר מגלם ירידה.")
    if neg:
        email += f" מתומחרות מתחת לערכים הנוכחיים: {names_list(neg)}."
    ex = bars("שווי שוק ÷ שווי המודל בערכים הנוכחיים − 1", "%", [(c, xp(c)["base"]["gap"]["v"]) for c in cs],
              [f"%; {PRICE_LABEL}; חיובי = המחיר מגלם שיפור", "A3: expectations/<co>.json"], name="פער")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}|neg:{len(neg)}", links=[L_XP], rel=["Q-180", "Q-184", "Q-109"], asof=PD)


def lever(c, k):
    e = xp(c)
    return next((l for l in e.get("levers", []) if l["k"] == k), None) if e else None


@question("Q-186", "מה המחיר מניח על קצב שחרור ה-CSM?", ["inv", "cfo", "board"], "val", INS)
def q186(A):
    cs = [c for c in INS if lever(c, "csm") and lever(c, "csm")["status"] == "ok" and lever(c, "csm").get("req")]
    if not cs:
        return nodata("אין מבטחת שבה ה-CSM הוא מנוף מחייב")

    def rel_(c):
        l = lever(c, "csm")
        return l["req"]["v"] / l["trail"]["v"]
    cs = sorted(cs, key=lambda c: -rel_(c))
    top = cs[0]
    l = lever(top, "csm")
    figs = {"req": F(f"קצב שחרור CSM שהמחיר דורש, {he(top)}", l["req"]["v"], "pct", l["req"]["prov"], PD, c=top, b="estimate"),
            "tr": F(f"קצב שחרור CSM, FY'25, {he(top)}", l["trail"]["v"], "pct", l["trail"]["prov"], "FY'25", c=top)}
    nb = [c for c in INS if lever(c, "csm") and lever(c, "csm")["status"] == "nonbinding"]
    hist_hi = [c for c in cs if c != top and (lever(c, "csm").get("hist") or {}).get("pct", 0) >= 100]
    corr = f"שחרור מהיר בהרבה: אצל {he(top)} המחיר דורש קצב של {{req}} בשנה."
    email = (f"אם כל השיפור במחיר יבוא מה-CSM לבדו, {he(top)} צריכה לשחרר {{req}} מהיתרה בשנה, מול {{tr}} ב-FY'25. " +
             (f"גם אצל {names_list(hist_hi)} הקצב הנדרש מעל כל מה שנמדד. " if hist_hi else "") + "זה מנוף אחד מבודד: בפועל השיפור יבוא מכמה מנופים יחד.")
    if nb:
        far = [c for c in nb if (lever(c, "csm").get("reason") or "").startswith("נדרש יותר מפי")]
        if far:
            email += f" אצל {names_list(far)} ה-CSM לבדו לא יכול להסביר את המחיר: הקצב הנדרש היה יותר מכפול מהשיא בענף ב-FY'25."
        if len(far) < len(nb):
            email += f" אצל {names_list([c for c in nb if c not in far])} ה-CSM אינו מנוף מחייב במודל."
    ex = bars2("קצב שחרור CSM: נדרש במחיר מול FY'25", "% לשנה", cs, [("נדרש במחיר", [lever(c, "csm")["req"]["v"] for c in cs]), ("FY'25", [lever(c, "csm")["trail"]["v"] for c in cs])],
               [f"% מהיתרה בשנה; {PRICE_LABEL}; מנוף יחיד, השאר בערכים הנוכחיים", "A3: expectations/<co>.json, באור תנועה ב-CSM"])
    return answer(figs, corr, email, ex, None, f"top:{top}", links=[L_XP, link("CSM", "/csm")], rel=["Q-123", "Q-189"], asof=PD)


@question("Q-187", "איזו צמיחת נכסים המחיר מניח לבתי ההשקעות?", ["inv", "strat", "ceo"], "val", FUNDS)
def q187(A):
    cs = [c for c in FUNDS if lever(c, "aum") and lever(c, "aum")["status"] == "ok" and lever(c, "aum").get("req")]
    if len(cs) < 2:
        return nodata("פחות משני בתי השקעות שבהם צמיחת הנכסים היא מנוף מחייב")
    cs = sorted(cs, key=lambda c: lever(c, "aum")["req"]["v"] - lever(c, "aum")["trail"]["v"])

    def rq(c):
        return F(f"צמיחת נכסים שנתית שהמחיר דורש, {he(c)}", lever(c, "aum")["req"]["v"], "pct", lever(c, "aum")["req"]["prov"], PD, c=c, b="estimate", signed=True)

    def tr(c):
        return F(f"צמיחת נכסים שנתית, 5 שנים, {he(c)}", lever(c, "aum")["trail"]["v"], "pct", lever(c, "aum")["trail"]["prov"], "06/26", c=c, signed=True)
    lo, hi = cs[0], cs[-1]
    figs = {"lo": rq(lo), "lot": tr(lo), "hi": rq(hi), "hit": tr(hi)}
    corr = (f"פחות מההיסטוריה: אצל {he(lo)} המחיר מגלם ירידה בנכסים, {{lo}} בשנה." if lever(lo, "aum")["req"]["v"] < 0 else
            f"פחות מההיסטוריה: אצל {he(lo)} המחיר מסתפק בצמיחה של {{lo}} בשנה.")
    email = (f"המחיר של {PD} מגלם אצל {he(lo)} צמיחת נכסים של {{lo}} בשנה, מול {{lot}} בחמש השנים האחרונות. "
             f"אצל {he(hi)} הדרישה הגבוהה ביותר ביחס לעבר: {{hi}}, מול {{hit}}. הצמיחה ההיסטורית כוללת תשואה ומיזוגים, לא רק ניוד.")
    ex = bars2("צמיחת נכסים: נדרשת במחיר מול חמש השנים האחרונות", "% לשנה", cs,
               [("נדרשת במחיר", [lever(c, "aum")["req"]["v"] for c in cs]), ("5 שנים", [lever(c, "aum")["trail"]["v"] for c in cs])],
               [f"% לשנה, פנסיה וגמל; {PRICE_LABEL}", "A3: expectations/<co>.json; נכסים: רשות שוק ההון"])
    return answer(figs, corr, email, ex, None, f"lo:{lo}|hi:{hi}", links=[L_XP], rel=["Q-180"], asof=PD)


@question("Q-188", "כמה מהרווח בשנה האחרונה הוא תשואת שוק המניות?", ["inv", "board", "cfo"], "val", INS)
def q188(A):
    cs = [c for c in INS if xp(c) and (xp(c)["base"].get("adj") or {}).get("v") is not None and xp(c)["base"]["np_ltm"]["v"]]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם נרמול")

    def sh(c):
        b = xp(c)["base"]
        return -b["adj"]["v"] / b["np_ltm"]["v"] * 100

    def sfig(c):
        b = xp(c)["base"]
        return F(f"חלק הרווח LTM מעל תשואת מניות נורמלית, {he(c)}", sh(c), "pct",
                 P_calc(f"תרומת שוק המניות לרווח · {he(c)}", fmt(sh(c), "pct"), "%", "− נרמול תוצאת ההשקעות ÷ רווח נקי LTM × 100",
                        [("נרמול", fmt(b["adj"]["v"], "m"), b["adj"]["prov"]), ("רווח נקי LTM", fmt(b["np_ltm"]["v"], "m"), b["np_ltm"]["prov"])], est=True),
                 "LTM Q2'26", c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -sh(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": sfig(hi), "lo": sfig(lo), "adj": F(f"נרמול תוצאת ההשקעות, {he(hi)}", xp(hi)["base"]["adj"]["v"], "m", xp(hi)["base"]["adj"]["prov"], "LTM Q2'26", c=hi, b="estimate", signed=True),
            "eq": F("תשואת מניות LTM (גמל-נט, מסלול מניות)", xp(hi)["base"]["eq_ltm"]["v"], "pct", xp(hi)["base"]["eq_ltm"]["prov"], "LTM Q2'26")}
    corr = f"אצל {he(hi)} הכי הרבה: {{hi}} מהרווח הוא תשואת המניות מעבר לרגיל."
    email = (f"בשנה שבה המניות הניבו {{eq}}, הנרמול לתשואה רגילה אצל {he(hi)} הוא {{adj}}, {{hi}} מהרווח LTM; אצל {he(lo)} {{lo}}. "
             "הנרמול לפי רגישות הרווח למניות כפי שגולתה בדוחות; זה החלק שלא יחזור אם השוק יחזור לתשואה רגילה.")
    ex = bars("חלק הרווח LTM שמעל תשואת מניות נורמלית", "%", [(c, sh(c)) for c in cs],
              ["% מהרווח הנקי LTM Q2'26; נרמול = רגישות המניות × (תשואה נורמלית − תשואת LTM)", "A3: expectations/<co>.json, באור רגישויות"], name="תרומת השוק")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_XP], rel=["Q-125", "Q-180"], asof="LTM Q2'26")


@question("Q-189", "כמה שווה ה-CSM ביחס להון העצמי?", ["inv", "board", "cfo"], "val", INS)
def q189(A):
    cs = [c for c in INS if xp(c) and (xp(c)["base"].get("csm") or {}).get("csm")]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם CSM ב-Q2'26")

    def sh(c):
        b = xp(c)["base"]
        return b["csm"]["csm"]["v"] / b["equity"]["v"] * 100

    def sfig(c):
        b = xp(c)["base"]
        return F(f"CSM ÷ הון לבעלי המניות, {he(c)}", sh(c), "pct",
                 P_calc(f"CSM מול ההון · {he(c)} · Q2'26", fmt(sh(c), "pct"), "%", "CSM לסוף Q2'26 (לפני מס) ÷ הון לבעלי המניות × 100",
                        [("CSM", fmt(b["csm"]["csm"]["v"], "m"), b["csm"]["csm"]["prov"]), ("הון לבעלי המניות", fmt(b["equity"]["v"], "m"), b["equity"]["prov"])]),
                 "Q2'26", c=c)
    cs = sorted(cs, key=lambda c: -sh(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": sfig(hi), "lo": sfig(lo)}
    corr = f"{he(hi)}: ה-CSM שלה שווה {{hi}} מההון העצמי."
    email = (f"ה-CSM (רווח עתידי שעוד לא הוכר, לפני מס) של {he(hi)} שווה {{hi}} מההון לבעלי המניות; אצל {he(lo)} {{lo}}. "
             "זה הרווח שכבר נעול בספר הקיים; אחרי מס הוא בערך שני שלישים מזה, ושחרורו פרוס על שנים.")
    ex = bars("CSM ÷ הון לבעלי המניות, Q2'26", "%", [(c, sh(c)) for c in cs],
              ["%, CSM לפני מס (כפי שנפתר לכל חברה: חיים ובריאות, נטו או ברוטו כמודפס) ÷ הון", "A3: expectations/<co>.json, דוחות כספיים Q2'26"], name="CSM ÷ הון")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_XP, link("CSM", "/csm")], rel=["Q-122", "Q-186"], asof="Q2'26")


def roe_targets():
    """the latest-horizon group ROE target of each company (targets.json), open"""
    out = {}
    for r in load("targets.json")["rows"]:
        if r["st"] == "open" and "roe" in r["m"] and r["u"] == "pct" and r["e"] == "הקבוצה" and "IFRS 4" not in (r.get("nt") or ""):
            if r["c"] not in out or r["h"] > out[r["c"]]["h"]:
                out[r["c"]] = r
    return out


@question("Q-190", "אצל מי המחיר דורש ROE גבוה מהיעד של ההנהלה עצמה?", ["inv", "board", "ceo"], "val", MAIN)
def q190(A):
    from questions.targets import goal, tfig, ttext
    T = roe_targets()
    cs = [c for c in T if c in ok_roe()]
    if not cs:
        return nodata("אין חברה עם יעד ROE פתוח ו-ROE נדרש")

    def gap(c):
        return xp(c)["roe"]["req"]["v"] - goal(T[c])
    cs = sorted(cs, key=lambda c: -gap(c))
    above = [c for c in cs if gap(c) > 0]
    top = cs[0]
    figs = {"req": req_fig(top), "tgt": tfig(T[top]),
            "n": F("חברות שהמחיר דורש מהן ROE מעל יעד ההנהלה", len(above), "n",
                   P_calc("ROE נדרש מעל יעד", str(len(above)), "חברות", "ROE ב-FY'28 שהמחיר דורש > הקצה התחתון של יעד ה-ROE האחרון של ההנהלה",
                          [(f"{he(c)} · יעד {('FY' + chr(39) + str(T[c]['h'])[2:])}", f"{fmt(xp(c)['roe']['req']['v'], 'pct')} מול {ttext(T[c])}", xp(c)["roe"]["req"]["prov"]) for c in cs], est=True),
                   PD, b="estimate", t=f"{len(above)} מתוך {len(cs)}")}
    corr = f"אצל {{n}} חברות, והפער הגדול ביותר אצל {he(top)}."
    email = (f"המחיר של {PD} דורש מ{he(top)} ROE של {{req}} ב-FY'28, בעוד היעד האחרון של ההנהלה הוא {{tgt}}. בסך הכול, אצל {{n}} חברות המחיר מניח יותר ממה שההנהלה מבטיחה. "
             "שימו לב: מועדי היעדים שונים (FY'26 עד FY'30) מה-FY'28 של המודל, וחלק מהיעדים כבר נעקפו בתוצאות FY'25.")
    tab = [[he(c), fmt(xp(c)["roe"]["req"]["v"], "pct"), ttext(T[c]), f"FY'{str(T[c]['h'])[2:]}", fmt(gap(c), "pp"), fmt(xp(c)["base"]["roe_ltm"]["v"], "pct")] for c in cs]
    ex = table("ROE שהמחיר דורש מול יעד ה-ROE של ההנהלה", ["חברה", "נדרש ב-FY'28", "יעד ההנהלה", "מועד היעד", "פער (מהתחתון)", "ROE LTM"], tab,
               [f"{PRICE_LABEL}; יעד = האחרון שפורסם לקבוצה, עם מסמך ועמוד; מועדים שונים", "A3: expectations/<co>.json; targets.json"])
    return answer(figs, corr, email, ex, None, f"above:{len(above)}|top:{top}", links=[L_XP, link("יעדים ועמידה בהם", "/credibility")], rel=["Q-182", "Q-183", "Q-131"], asof=PD)
