"""Flows and share: who is taking transfers and from whom, share momentum, churn, the quarter in progress, the value of the flow.

Sources: lens.json (regulator assets and flows per group x segment x quarter, monthly series), lts.json (gross transfers, churn and
new-member deposits printed in the managers' fund tables), flow_npv.json (value of a year's flow at the segment margin).
"""
import math

from answer_core import P_calc, P_rep, SEG_HE, answer, changes_if, fig, he, link, load, lq, nf, nodata, question, ym
from questions._sav import (MAIN8, SRC_LTS, SRC_REG, L, co_link, cos, f_aum, f_ci_ltm, f_diff, f_fy_ltm, f_gap, f_growth, f_lts, f_msum,
                            f_net, f_org, f_pp, f_share, f_tr, frag_link, growth, hbar, lastq, lines, ltm_months, ltm_months_at, lv, mkt,
                            msum, names, net, preg, qback, qe, qtd_months, row, sav, table)

FOOT_TR = ["העברות נטו: INTERNAL_TRANSFERS של המסלולים, סכום חודשי הרבעון; סכום אפס בין המנהלים בקירוב (יש גם העברות אל ומחוץ לקבוצות)",
           SRC_REG]


def flow_ratio(c, s, q):
    """flow share ÷ asset share of a quarter, or None"""
    r = row(c, s, q)
    if not r or r.get("flow_share") is None or not r.get("aum_share"):
        return None
    return r["flow_share"] / r["aum_share"]


def ratio_fig(c, s, q, label=None):
    r = row(c, s, q)
    x = flow_ratio(c, s, q)
    p = P_calc(f"נתח צבירה ÷ נתח נכסים · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(x, 2)}×", "×",
               "נתח הקבוצה מהצבירה נטו (אורגנית + העברות) ברבעון ÷ נתח הנכסים שלה בסוף הרבעון (מעל 1×: צוברת מעבר לגודלה)",
               [("נתח מהצבירה נטו", f"{nf(r['flow_share'], 1)}%", L().prov_share(c, s, q, "flow_share")),
                ("נתח נכסים", f"{nf(r['aum_share'], 1)}%", L().prov_share(c, s, q, "aum_share"))])
    return fig(label or f"נתח צבירה ÷ נתח נכסים, {he(c)}, {SEG_HE[s]}", x, "x", p, lq(q), d=1, c=c)


def ids_all(s, q):
    return [c for c in cos(s, q) if row(c, s, q)["reg"].get("tr") is not None]


def other_tr(s, q):
    """the sector funds group (no company id): its net transfers, for the chart only"""
    for r in L().L["rows"]:
        if r["s"] == s and r["q"] == q and not L().groups[r["g"]].get("id"):
            return r["reg"].get("tr")
    return None


@question("Q-001", "האם מור צוברת מעבר לגודלה, בגמל ובפנסיה?", ["ceo", "strat", "dist"], "flows", ["more"])
def q001(A):
    c, q = "more", lastq()
    rg, rp = flow_ratio(c, "gem", q), flow_ratio(c, "pen", q)
    if rg is None or rp is None:
        return nodata(f"אין שורת עדשה למור בגמל או בפנסיה ל-{lq(q)}")
    figs = {"rg": ratio_fig(c, "gem", q), "rp": ratio_fig(c, "pen", q),
            "fg": f_share(c, "gem", q, "flow_share"), "ag": f_share(c, "gem", q, "aum_share"),
            "fp": f_share(c, "pen", q, "flow_share"), "ap": f_share(c, "pen", q, "aum_share")}
    yes_g, yes_p = rg > 1, rp > 1
    vk = f"gem:{'y' if yes_g else 'n'}|pen:{'y' if yes_p else 'n'}"
    word = {True: "כן", False: "לא"}
    if yes_g and yes_p:
        corr = "כן, בשני המוצרים: בגמל מור צוברת בקצב של {rg} מגודלה."
    elif yes_g:
        corr = "בגמל כן ובפנסיה לא: בגמל מור צוברת בקצב של {rg} מגודלה."
    elif yes_p:
        corr = "בפנסיה כן ובגמל לא: בפנסיה מור צוברת בקצב של {rp} מגודלה."
    else:
        corr = "לא: בגמל מור צוברת בקצב של {rg} בלבד מגודלה."
    email = (f"גמל ({word[yes_g]}): נתח מור מהצבירה נטו של השוק (הפקדות פחות משיכות ועוד העברות) ב-{lq(q)} הוא {{fg}} מול נתח נכסים של {{ag}}, "
             f"יחס של {{rg}}. פנסיה ({word[yes_p]}): נתח צבירה של {{fp}} מול נתח נכסים של {{ap}}, יחס של {{rp}}.")
    qs = L().quarters[-8:]
    ex = lines("מור: נתח הצבירה נטו ÷ נתח הנכסים, לפי רבעון", "×", qs,
               [(SEG_HE[s], [flow_ratio(c, s, k) for k in qs]) for s in ("gem", "pen")],
               ["מעל 1×: הקבוצה צוברת מעבר לגודלה. צבירה נטו = הפקדות פחות משיכות ועוד העברות נטו", SRC_REG])
    chg = changes_if("התשובה בגמל מתהפכת כשהיחס חוצה את {thr}", "rg", "<" if yes_g else ">=", 1.0)
    return answer(figs, corr, email, ex, chg, vk, links=[sav("gem"), co_link(c)], rel=["Q-008", "Q-009", "Q-029"], asof=lq(q))


# ------------------------------------------------------------------------------------------------ who takes transfers, from whom
def takers(s, rel):
    q = lastq()
    cs = ids_all(s, q)
    if len(cs) < 3:
        return nodata(f"פחות משלוש קבוצות עם העברות נטו ב{SEG_HE[s]} ל-{lq(q)}")
    items = sorted(((c, row(c, s, q)["reg"]["tr"]) for c in cs), key=lambda x: -x[1])
    top, sec, bot = items[0][0], items[1][0], items[-1][0]
    pos = [(c, v) for c, v in items if v > 0]
    neg = [(c, v) for c, v in items if v < 0]
    o = other_tr(s, q)
    figs = {"top": f_tr(top, s, q), "bot": f_tr(bot, s, q), "sec": f_tr(sec, s, q)}
    pos_v = math.fsum(v for _, v in pos) + (o if o and o > 0 else 0)
    figs["pos"] = fig(f"סך ההעברות נטו החיוביות, {SEG_HE[s]}", pos_v / 1000, "bn",
                      P_calc(f"סך ההעברות נטו החיוביות · {SEG_HE[s]} · {lq(q)}", nf(pos_v, 1), 'מיליוני ש"ח',
                             "סכום ההעברות נטו של הקבוצות שקיבלו יותר משמסרו ברבעון",
                             [(he(c), nf(v, 1), preg("transfers", qe(q), "q", s, c)) for c, v in pos]), lq(q))
    figs["tsh"] = fig(f"נתח {he(top)} מההעברות החיוביות", items[0][1] / pos_v * 100, "pct",
                      P_calc(f"נתח מההעברות החיוביות · {he(top)} · {lq(q)}", f"{nf(items[0][1] / pos_v * 100, 1)}%", "%",
                             "העברות נטו של הקבוצה ÷ סך ההעברות נטו החיוביות × 100",
                             [(he(top), figs["top"]["t"], None), ("סך החיוביות", figs["pos"]["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), lq(q), c=top)
    losers = [c for c, _ in sorted(neg, key=lambda x: x[1])]
    figs["gap"] = f_gap(f"פער {he(top)} על {he(sec)}", figs["top"], figs["sec"], items[0][1], items[1][1], lq(q))
    corr = f"ב{SEG_HE[s]} {he(top)} לוקחת את הניוד: העברות נטו של {{top}} ב-{lq(q)}."
    from_ = (f"הכסף יוצא בעיקר מ{names(losers[:3])}, ובראשן {he(bot)} עם {{bot}}." if losers
             else "אף קבוצה בעלת שם לא מסרה יותר משקיבלה; ההעברות באו מקבוצת הקרנות הענפיות ומחוץ לקבוצות.")
    email = (f"ב{SEG_HE[s]} ב-{lq(q)} {he(top)} קיבלה העברות נטו של {{top}}, {{tsh}} מכלל ההעברות נטו החיוביות ({{pos}}); "
             f"אחריה {he(sec)} עם {{sec}}. {from_}")
    ser = items + ([("קרנות ענפיות ואחרות", o)] if o is not None else [])
    ser.sort(key=lambda x: -x[1])
    ex = hbar(f"העברות נטו, {SEG_HE[s]}, {lq(q)}", 'מיליארדי ש"ח', [(c, v / 1000) for c, v in ser], FOOT_TR, span=lq(q))
    chg = changes_if(f"המובילה מתחלפת כש{he(sec)} עוקפת את {he(top)}", "gap", "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{top}|bot:{bot}", links=[sav(s), link("דירוג מנהלים לאורך זמן", "/managers?v=rank&by=flow")],
                  rel=rel, asof=lq(q))


@question("Q-002", "מי לוקח ניודים בפנסיה, ומאיזה מתחרים הם באים?", ["ceo", "dist", "strat"], "flows")
def q002(A):
    return takers("pen", ["Q-003", "Q-005", "Q-013"])


@question("Q-003", "מי לוקח ניודים בגמל והשתלמות, ומאיזה מתחרים הם באים?", ["ceo", "dist", "strat"], "flows")
def q003(A):
    return takers("gem", ["Q-002", "Q-004", "Q-014"])


@question("Q-004", "מי לוקח ניודים בקרנות ההשתלמות, ומאיזה מתחרים הם באים?", ["dist", "ceo"], "flows")
def q004(A):
    return takers("hish", ["Q-003", "Q-087"])


def window_leaders(ms, tag, rel):
    s = "pg"
    items = sorted(((c, msum(c, s, "tr", ms)) for c in cos(s) if msum(c, s, "tr", ms) is not None), key=lambda x: -x[1])
    if len(items) < 3:
        return nodata("אין מספיק קבוצות עם סדרת העברות מלאה לחלון")
    top, sec, bot = items[0][0], items[1][0], items[-1][0]
    figs = {"top": f_msum(top, s, "tr", ms), "sec": f_msum(sec, s, "tr", ms), "bot": f_msum(bot, s, "tr", ms)}
    span = f"{ym(ms[0])}–{ym(ms[-1])}"
    figs["gap"] = f_gap(f"פער {he(top)} על {he(sec)}", figs["top"], figs["sec"], items[0][1], items[1][1], span)
    corr = f"{he(top)} מובילה בניוד נטו בפנסיה ובגמל יחד {tag}: {{top}}."
    email = (f"בחלון {span} ({len(ms)} חודשים) {he(top)} קיבלה העברות נטו של {{top}} בפנסיה ובגמל יחד, ואחריה {he(sec)} עם {{sec}}. "
             f"בתחתית {he(bot)}, עם {{bot}}.")
    ex = hbar(f"העברות נטו, פנסיה וגמל, {span}", 'מיליארדי ש"ח', [(c, v / 1000) for c, v in items],
              ["סכום ההעברות נטו החודשיות של מסלולי הפנסיה והגמל של כל קבוצה", SRC_REG], span=span)
    chg = changes_if(f"המובילה מתחלפת כש{he(sec)} עוקפת את {he(top)}", "gap", "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{top}|bot:{bot}", links=[sav("pg"), link("דירוג מנהלים לאורך זמן", "/managers?v=rank&by=flow")],
                  rel=rel, asof=ym(ms[-1]))


@question("Q-005", "מי מוביל בניוד נטו ב-12 החודשים האחרונים, בפנסיה ובגמל יחד?", ["ceo", "board", "inv"], "flows")
def q005(A):
    return window_leaders(ltm_months(), "ב-12 חודשים אחרונים", ["Q-002", "Q-003", "Q-006"])


@question("Q-006", "מי מוביל בניוד ברבעון הנוכחי, לפי החודשים שפורסמו?", ["ceo", "dist", "inv"], "flows")
def q006(A):
    ms = qtd_months()
    if not ms:
        return nodata("עדיין לא פורסם אף חודש של הרבעון הנוכחי")
    return window_leaders(ms, f"ברבעון {lq(L().L['nowcast']['q'])} עד כה", ["Q-005", "Q-007", "Q-047"])


@question("Q-007", "מי התהפך מניוד חיובי לשלילי ברבעון הנוכחי?", ["ceo", "dist", "board"], "flows")
def q007(A):
    q, ms = lastq(), qtd_months()
    if not ms:
        return nodata("עדיין לא פורסם אף חודש של הרבעון הנוכחי")
    flips = []
    for s in ("pen", "gem"):
        for c in cos(s, q):
            r = row(c, s, q)
            now = msum(c, s, "tr", ms)
            if r["reg"].get("tr") is not None and now is not None and r["reg"]["tr"] > 0 and now < 0:
                flips.append((c, s, now))
    flips.sort(key=lambda x: x[2])
    nq = lq(L().L["nowcast"]["q"])
    if not flips:
        cand = sorted(((c, s, msum(c, s, "tr", ms)) for s in ("pen", "gem") for c in cos(s, q) if msum(c, s, "tr", ms) is not None), key=lambda x: x[2])
        c, s, _ = cand[0]
        figs = {"w": f_msum(c, s, "tr", ms), "wq": f_tr(c, s, q)}
        corr = f"אף מנהל לא התהפך: החלשה ברבעון {nq} עד כה היא {he(c)} ב{SEG_HE[s]}, עם {{w}}."
        email = f"ב{SEG_HE[s]} {he(c)} רשמה העברות נטו של {{w}} בחודשים שפורסמו של {nq}, אחרי {{wq}} ב-{lq(q)}. אף מנהל לא עבר מחיובי לשלילי."
        vk = "none"
    else:
        c, s, _ = flips[0]
        figs = {"w": f_msum(c, s, "tr", ms), "wq": f_tr(c, s, q)}
        others = [f"{he(x)} ({SEG_HE[y]})" for x, y, _ in flips[1:]]
        corr = f"{he(c)} ב{SEG_HE[s]} היא ההיפוך הגדול: העברות נטו של {{w}} ברבעון {nq} עד כה."
        email = (f"{he(c)} עברה ב{SEG_HE[s]} מהעברות נטו של {{wq}} ב-{lq(q)} ל-{{w}} בחודשים שפורסמו של {nq}. "
                 + (f"התהפכו גם: {', '.join(others)}." if others else "אין עוד מנהל שהתהפך."))
        vk = "flip:" + ",".join(f"{x}.{y}" for x, y, _ in flips)
    rows_ = [["מנהל", "מוצר", f"העברות נטו {lq(q)} (מיליוני ש\"ח)", f"{nq} עד כה (מיליוני ש\"ח)"]]
    for s2 in ("pen", "gem"):
        for c2 in MAIN8:
            r = row(c2, s2, q)
            if r and r["reg"].get("tr") is not None and msum(c2, s2, "tr", ms) is not None:
                rows_.append([he(c2), SEG_HE[s2], nf(r["reg"]["tr"], 0), nf(msum(c2, s2, "tr", ms), 0)])
    ex = table(f"העברות נטו: {lq(q)} מול {nq} עד כה", rows_,
               [f"{nq} עד כה: {len(ms)} חודשים ({', '.join(ym(m) for m in ms)}); לא מנורמל לרבעון מלא", SRC_REG])
    chg = changes_if(f"התשובה משתנה כשהעברות {he(c)} ברבעון הנוכחי חוצות את {{thr}}", "w", ">=" if vk != "none" else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[sav(v="now"), frag_link(sig="flow")], rel=["Q-006", "Q-002", "Q-003"], asof=ym(ms[-1]))


def over_size(s, rel):
    q = lastq()
    cs = [c for c in cos(s, q) if flow_ratio(c, s, q) is not None and row(c, s, q)["aum_share"] >= 1]
    if len(cs) < 3:
        return nodata("אין מספיק קבוצות עם נתח נכסים של אחוז אחד לפחות")
    items = sorted(((c, flow_ratio(c, s, q)) for c in cs), key=lambda x: -x[1])
    top, bot = items[0][0], items[-1][0]
    figs = {"top": ratio_fig(top, s, q), "tf": f_share(top, s, q, "flow_share"), "ta": f_share(top, s, q, "aum_share"), "bot": ratio_fig(bot, s, q)}
    corr = f"{he(top)} צוברת ב{SEG_HE[s]} בקצב של {{top}} מגודלה, הגבוה בשוק ב-{lq(q)}."
    email = (f"ב-{lq(q)} {he(top)} לקחה {{tf}} מהצבירה נטו של {SEG_HE[s]} (הפקדות פחות משיכות ועוד העברות) מול נתח נכסים של {{ta}}. "
             f"בקצה השני {he(bot)}, ביחס של {{bot}}: מתחת לאפס היא מאבדת יותר משהיא צוברת.")
    ex = hbar(f"נתח צבירה ÷ נתח נכסים, {SEG_HE[s]}, {lq(q)}", "×", items,
              ["קבוצות עם נתח נכסים של אחוז אחד לפחות. מעל 1×: נתח השוק יעלה אם הקצב יימשך", SRC_REG], span=lq(q))
    chg = changes_if("המובילה מתחלפת אם היחס שלה יורד אל מתחת ל-{thr}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}|bot:{bot}", links=[sav(s)], rel=rel, asof=lq(q))


@question("Q-008", "מי צובר בגמל והשתלמות הכי הרבה מעבר לגודלו?", ["ceo", "strat", "inv"], "flows")
def q008(A):
    return over_size("gem", ["Q-001", "Q-009", "Q-003"])


@question("Q-009", "מי צובר בפנסיה הכי הרבה מעבר לגודלו?", ["ceo", "strat", "inv"], "flows")
def q009(A):
    return over_size("pen", ["Q-001", "Q-008", "Q-002"])


@question("Q-010", "איזה מנהל מתכווץ הכי מהר בפנסיה ובגמל?", ["board", "inv", "ceo"], "flows")
def q010(A):
    q, s = lastq(), "pg"
    items = sorted(((c, growth(c, s, q)) for c in cos(s, q) if growth(c, s, q) is not None), key=lambda x: x[1])
    c = items[0][0]
    figs = {"g": f_growth(c, s, q), "n": f_net(c, s, q), "m": f_growth(None, s, q), "a": f_aum(c, s, q)}
    neg = [x for x, v in items if v < 0]
    corr = f"{he(c)}: צבירה נטו של {{g}} מנכסיה ב-{lq(q)}, החלשה בשוק."
    email = (f"ב-{lq(q)} {he(c)} רשמה בפנסיה ובגמל צבירה נטו (הפקדות פחות משיכות ועוד העברות) של {{n}}, {{g}} מנכסי תחילת הרבעון, "
             f"מול {{m}} בשוק כולו; נכסיה בסוף הרבעון {{a}}. " + (f"בצבירה שלילית: {names(neg)}." if neg else "אף קבוצה אינה בצבירה שלילית."))
    ex = hbar(f"צבירה נטו כשיעור מהנכסים, פנסיה וגמל, {lq(q)}", "%", items, ["(צבירה אורגנית + העברות נטו) ÷ נכסי תחילת הרבעון; לא שנתי, ללא תשואה", SRC_REG], span=lq(q))
    chg = changes_if("התשובה משתנה אם הצבירה של הקבוצה חוצה את {thr}", "g", ">=", 0.0)
    return answer(figs, corr, email, ex, chg, f"bot:{c}|neg:{len(neg)}", links=[sav("pg"), co_link(c)], rel=["Q-011", "Q-026"], asof=lq(q))


@question("Q-011", "מי מהקבוצות הגדולות צומח מהר מהשוק בפנסיה ובגמל?", ["ceo", "board", "inv"], "flows")
def q011(A):
    q, s = lastq(), "pg"
    m = growth(None, s, q)
    items = sorted(((c, growth(c, s, q)) for c in MAIN8 if row(c, s, q) and growth(c, s, q) is not None), key=lambda x: -x[1])
    c = items[0][0]
    above = [x for x, v in items if v > m]
    figs = {"g": f_growth(c, s, q), "m": f_growth(None, s, q), "n": f_net(c, s, q)}
    figs["gap"] = f_diff(f"פער {he(c)} על השוק", figs["g"], figs["m"], "pp", lq(q), d=2)
    corr = f"{he(c)} צומחת הכי מהר מבין הקבוצות הגדולות: צבירה נטו של {{g}} מנכסיה ב-{lq(q)}."
    email = (f"ב-{lq(q)} השוק כולו צבר {{m}} מנכסיו (הפקדות פחות משיכות ועוד העברות). {he(c)} צברה {{g}}, {{n}}. "
             f"מעל קצב השוק: {names(above)} ({len(above)} קבוצות מתוך {len(items)} קבוצות גדולות).")
    ex = hbar(f"צבירה נטו כשיעור מהנכסים, הקבוצות הגדולות, {lq(q)}", "%", items + [("כלל השוק", m)],
              ["(צבירה אורגנית + העברות נטו) ÷ נכסי תחילת הרבעון; לא שנתי, ללא תשואה", SRC_REG], span=lq(q))
    chg = changes_if("התשובה משתנה אם הפער של המובילה על השוק יורד אל מתחת ל-{thr}", "gap", "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{c}|above:{len(above)}", links=[sav("pg")], rel=["Q-010", "Q-026"], asof=lq(q))


@question("Q-012", "האם מלחמת הניודים בפנסיה מתעצמת?", ["ceo", "board", "dist"], "flows")
def q012(A):
    q = lastq()
    q0 = qback(q, 4)
    a, b = f_lts(None, "pen", "tr_out", q), f_lts(None, "pen", "tr_out", q0)
    ra, rb = f_lts(None, "pen", "out_rate", q), f_lts(None, "pen", "out_rate", q0)
    if not (a and b and ra and rb):
        return nodata("סך העברות הצבירה של החברות המכוסות חסר לאחד הרבעונים")
    yes = a["v"] > b["v"]
    figs = {"a": a, "b": b, "ra": ra, "rb": rb, "ia": f_lts(None, "pen", "tr_in", q)}
    figs["d"] = f_pp("שינוי בשיעור הניוד החוצה, YoY", ra["v"], rb["v"], ra, rb, lq(q), local=True)
    gv = (a["v"] / b["v"] - 1) * 100
    figs["g"] = fig("שינוי YoY בהעברות הצבירה החוצה, פנסיה", gv, "pct",
                    P_calc("שינוי YoY בהעברות הצבירה החוצה · פנסיה · החברות המכוסות", f"{nf(gv, 1)}%", "%", f"{lq(q)} ÷ {lq(q0)} − 1",
                           [(lq(q), a["t"], None), (lq(q0), b["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), lq(q), signed=True)
    corr = f"{'כן' if yes else 'לא'}: העברות הצבירה החוצה מקרנות הפנסיה השתנו ב-{{g}} מול הרבעון המקביל."
    email = (f"ב-{lq(q)} יצאו מקרנות הפנסיה החדשות של החברות המכוסות {{a}} בהעברות צבירה ונכנסו {{ia}}, מול {{b}} שיצאו ב-{lq(q0)}. "
             f"שיעור הניוד החוצה השנתי {{ra}} מהנכסים, מול {{rb}} שנה קודם.")
    qs = L().quarters[-8:]
    ex = lines("פנסיה: שיעור ניוד החוצה השנתי, החברות המכוסות", "%", qs, [("החברות המכוסות", [lv(None, "pen", "out_rate", k) for k in qs])],
               ["העברות צבירה מהקרן × 4 ÷ נכסים ממוצעים של הקרנות החדשות; ברוטו, כולל מעברים בין מסלולים", SRC_LTS])
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי בהעברות החוצה חוצה את {thr}", "g", "<=" if yes else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav("pen")], rel=["Q-013", "Q-002"], asof=lq(q))


SEG_FROM = {"pen": "מקרנות הפנסיה", "gem": "מקופות הגמל וההשתלמות"}


def churn(s, rel):
    q = lastq()
    items = sorted(((c, lv(c, s, "out_rate", q)) for c in MAIN8 + ["analyst", "yelin"] if lv(c, s, "out_rate", q) is not None), key=lambda x: -x[1])
    if len(items) < 3:
        return nodata("שיעור הניוד החוצה לא פורסם לרבעון")
    top, low = items[0][0], items[-1][0]
    figs = {"top": f_lts(top, s, "out_rate", q), "low": f_lts(low, s, "out_rate", q), "tro": f_lts(top, s, "tr_out", q)}
    sec = f_lts(None, s, "out_rate", q)
    if sec:
        figs["all"] = sec
    corr = f"{he(top)} מאבדת ב{SEG_HE[s]} הכי הרבה: שיעור ניוד החוצה של {{top}} מהנכסים בשנה."
    email = (f"ב-{lq(q)} יצאו {SEG_FROM[s]} של {he(top)} {{tro}} בהעברות צבירה, שיעור שנתי של {{top}} מהנכסים"
             + (", מול {all} בממוצע החברות המכוסות" if sec else "") + f". הנמוכה: {he(low)}, {{low}}.")
    ex = hbar(f"שיעור ניוד החוצה השנתי, {SEG_HE[s]}, {lq(q)}", "%", items,
              ["העברות צבירה מהקרן ברבעון × 4 ÷ נכסים ממוצעים; ברוטו, כולל מעברים בין מסלולים של אותה חברה", SRC_LTS], span=lq(q))
    chg = changes_if(f"המובילה מתחלפת אם השיעור של {he(top)} יורד אל מתחת ל-{{thr}}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}", links=[sav(s), co_link(top)], rel=rel, asof=lq(q))


@question("Q-013", "מי מאבד הכי הרבה חוסכים לניוד בפנסיה?", ["ceo", "dist", "board"], "flows")
def q013(A):
    return churn("pen", ["Q-012", "Q-014", "Q-002"])


@question("Q-014", "מי מאבד הכי הרבה חוסכים לניוד בגמל?", ["ceo", "dist", "board"], "flows")
def q014(A):
    return churn("gem", ["Q-013", "Q-003"])


@question("Q-015", "האם הניוד החיובי בפנסיה ובגמל מתרכז אצל מעטים?", ["strat", "reg", "board"], "flows")
def q015(A):
    q, s = lastq(), "pg"
    items = sorted(((c, row(c, s, q)["reg"]["tr"]) for c in ids_all(s, q)), key=lambda x: -x[1])
    pos = [(c, v) for c, v in items if v > 0]
    o = other_tr(s, q)
    tot = math.fsum(v for _, v in pos) + (o if o and o > 0 else 0)
    t3 = pos[:3]
    sh = math.fsum(v for _, v in t3) / tot * 100
    yes = sh >= 50
    pf = P_calc(f"נתח שלוש המובילות מההעברות החיוביות · פנסיה וגמל · {lq(q)}", f"{nf(sh, 1)}%", "%",
                "Σ העברות נטו של שלוש הקבוצות המובילות ÷ Σ ההעברות נטו החיוביות של כל הקבוצות × 100",
                [(he(c), nf(v, 1), preg("transfers", qe(q), "q", s, c)) for c, v in pos])
    a3 = math.fsum(row(c, s, q)["aum_share"] for c, _ in t3)
    figs = {"sh": fig("נתח שלוש המובילות מההעברות החיוביות", sh, "pct", pf, lq(q)), "t1": f_tr(t3[0][0], s, q),
            "a3": fig("נתח הנכסים של אותן שלוש", a3, "pct",
                      P_calc("נתח הנכסים של שלוש המובילות בניוד", f"{nf(a3, 1)}%", "%", "סכום נתחי הנכסים",
                             [(he(c), f"{nf(row(c, s, q)['aum_share'], 1)}%", L().prov_share(c, s, q, "aum_share")) for c, _ in t3]), lq(q))}
    corr = f"{'כן' if yes else 'לא'}: שלוש הקבוצות המובילות לקחו {{sh}} מההעברות נטו החיוביות ב-{lq(q)}."
    email = (f"ב-{lq(q)} {names([c for c, _ in t3])} לקחו יחד {{sh}} מההעברות נטו החיוביות בפנסיה ובגמל, מול נתח נכסים משותף של {{a3}}; "
             f"{he(t3[0][0])} לבדה {{t1}}.")
    ex = hbar(f"העברות נטו, פנסיה וגמל, {lq(q)}", 'מיליארדי ש"ח', [(c, v / 1000) for c, v in items], FOOT_TR, span=lq(q))
    chg = changes_if("התשובה מתהפכת כשנתח שלוש המובילות חוצה את {thr}", "sh", "<" if yes else ">=", 50.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav("pg")], rel=["Q-002", "Q-003", "Q-075"], asof=lq(q))


def share_shift(s, rel):
    q = lastq()
    q0 = qback(q, 4)
    items = []
    for c in cos(s, q):
        r0 = row(c, s, q0)
        if r0 and r0.get("aum_share") is not None:
            items.append((c, row(c, s, q)["aum_share"] - r0["aum_share"]))
    items.sort(key=lambda x: -x[1])
    up, dn = items[0][0], items[-1][0]
    fu, fu0, fd, fd0 = f_share(up, s, q), f_share(up, s, q0), f_share(dn, s, q), f_share(dn, s, q0)
    figs = {"up": f_pp(f"שינוי בנתח הנכסים, {he(up)}, YoY", fu["v"], fu0["v"], fu, fu0, lq(q), c=up),
            "dn": f_pp(f"שינוי בנתח הנכסים, {he(dn)}, YoY", fd["v"], fd0["v"], fd, fd0, lq(q), c=dn), "su": fu, "sd": fd}
    corr = f"ב{SEG_HE[s]} {he(up)} עלתה הכי הרבה בנתח הנכסים בשנה, שינוי של {{up}}."
    email = (f"מ-{lq(q0)} עד {lq(q)} נתח הנכסים של {he(up)} ב{SEG_HE[s]} השתנה ב-{{up}} והגיע ל-{{su}}. "
             f"הירידה הגדולה: {he(dn)}, שינוי של {{dn}}, ל-{{sd}}. נתח נכסים משקף ניוד, צבירה וגם הפרשי תשואה.")
    ex = hbar(f"שינוי בנתח הנכסים, {SEG_HE[s]}, {lq(q0)} עד {lq(q)}", "נק׳ אחוז", items, ["נתח מנכסי השוק בסוף הרבעון", SRC_REG], span=f"{lq(q0)}–{lq(q)}")
    chg = changes_if(f"המובילה מתחלפת אם העלייה של {he(up)} יורדת אל מתחת ל-{{thr}}", "up", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"up:{up}|dn:{dn}", links=[sav(s), link("דירוג מנהלים לאורך זמן", "/managers?v=rank")], rel=rel, asof=lq(q))


@question("Q-016", "מי עלה ומי ירד בנתח הנכסים בפנסיה בשנה האחרונה?", ["ceo", "board", "strat"], "flows")
def q016(A):
    return share_shift("pen", ["Q-017", "Q-009"])


@question("Q-017", "מי עלה ומי ירד בנתח הנכסים בגמל והשתלמות בשנה האחרונה?", ["ceo", "board", "strat"], "flows")
def q017(A):
    return share_shift("gem", ["Q-016", "Q-008"])


def losing_share(c):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    if not row(c, s, q) or not row(c, s, q0):
        return nodata(f"אין שורת עדשה ל{he(c)} בפנסיה וגמל ל-{lq(q)} או ל-{lq(q0)}")
    a, a0 = f_share(c, s, q), f_share(c, s, q0)
    figs = {"d": f_pp(f"שינוי בנתח הנכסים, {he(c)}, פנסיה וגמל, YoY", a["v"], a0["v"], a, a0, lq(q), c=c, local=True), "a": a, "a0": a0}
    yes = figs["d"]["v"] < 0
    fr = flow_ratio(c, s, q)
    if yes:
        corr = f"כן: נתח הנכסים של {he(c)} בפנסיה ובגמל ירד בשנה, שינוי של {{d}}."
    else:
        corr = f"לא: נתח הנכסים של {he(c)} בפנסיה ובגמל עלה בשנה, שינוי של {{d}}."
    tail = ""
    if fr is not None:
        figs["fr"] = ratio_fig(c, s, q)
        if yes:
            tail = " ברבעון האחרון היא צברה בקצב של {fr} מגודלה, " + ("סימן ראשון להתייצבות." if fr > 1 else "כך שהשחיקה צפויה להימשך.")
        else:
            tail = " ברבעון האחרון היא צברה בקצב של {fr} מגודלה, " + ("כך שהעלייה צפויה להימשך." if fr > 1 else "סימן אזהרה להמשך.")
    email = f"נתח הנכסים של {he(c)} בפנסיה ובגמל: {{a}} ב-{lq(q)} מול {{a0}} ב-{lq(q0)}.{tail}"
    qs = L().quarters[-8:]
    ex = lines(f"{he(c)}: נתח מנכסי הפנסיה והגמל, לפי רבעון", "%", qs,
               [("פנסיה וגמל", [(row(c, s, k) or {}).get("aum_share") for k in qs]), ("פנסיה", [(row(c, "pen", k) or {}).get("aum_share") for k in qs]),
                ("גמל והשתלמות", [(row(c, "gem", k) or {}).get("aum_share") for k in qs])],
               ["נתח מנכסי השוק בסוף כל רבעון; כולל השפעת תשואה, לא רק ניוד", SRC_REG])
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי חוצה את {thr}", "d", ">=" if yes else "<", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[co_link(c), sav("pg")], rel=["Q-016", "Q-017", "Q-038"], asof=lq(q))


def _reg_losing(i, c):
    question(f"Q-{18 + i:03d}", f"האם {he(c)} מאבדת נתח נכסים בפנסיה ובגמל?", ["ceo", "board", "inv"], "flows", [c])(lambda A: losing_share(c))


for _i, _c in enumerate(MAIN8):
    _reg_losing(_i, _c)


@question("Q-026", "כמה מהגידול בנכסים בא מכסף חדש, וכמה מתשואה?", ["inv", "board", "cfo"], "flows")
def q026(A):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    qs = [qback(q, k) for k in (3, 2, 1, 0)]

    def sum_net(c):
        xs = [net(c, s, k) for k in qs]
        return None if any(x is None for x in xs) else math.fsum(xs)

    def split(c):
        aE, aO = (row(c, s, q)["reg"]["aE"], row(c, s, q0)["reg"]["aE"]) if c else (mkt(s, q, "aE"), mkt(s, q0, "aE"))
        return aE, aO, sum_net(c)

    def fshare(c):
        aE, aO, n = split(c)
        v = n / (aE - aO) * 100
        who_ = he(c) if c else "כלל השוק"
        p = P_calc(f"חלק הכסף החדש בגידול הנכסים · {who_} · LTM {lq(q)}", f"{nf(v, 1)}%", "%",
                   "Σ צבירה נטו (הפקדות פחות משיכות ועוד העברות) בארבעה רבעונים ÷ (נכסים בסוף התקופה − נכסים בתחילתה) × 100; היתר: תשואה",
                   [(f"צבירה נטו · {lq(k)}", nf(net(c, s, k), 1), preg("netflow", qe(k), "q", s, c)) for k in qs]
                   + [(f"נכסים · {ym(qe(q))}", nf(aE, 0), preg("assets", qe(q), "m", s, c)), (f"נכסים · {ym(qe(q0))}", nf(aO, 0), preg("assets", qe(q0), "m", s, c))])
        return fig(f"חלק הכסף החדש בגידול הנכסים, {who_}", v, "pct", p, f"LTM {lq(q)}", c=c)

    aE, aO, mn = split(None)
    figs = {"m": fshare(None)}
    figs["mn"] = fig("צבירה נטו LTM, כלל השוק, פנסיה וגמל", mn / 1000, "bn",
                     P_calc("צבירה נטו LTM · כלל השוק · פנסיה וגמל", nf(mn, 0), 'מיליוני ש"ח', "סכום ארבעה רבעונים",
                            [(lq(k), nf(net(None, s, k), 1), preg("netflow", qe(k), "q", s)) for k in qs]), f"LTM {lq(q)}")
    figs["da"] = fig("גידול הנכסים LTM, כלל השוק, פנסיה וגמל", (aE - aO) / 1000, "bn",
                     P_calc("גידול הנכסים LTM · כלל השוק", nf(aE - aO, 0), 'מיליוני ש"ח', "נכסים בסוף התקופה − נכסים בתחילתה",
                            [(ym(qe(q)), nf(aE, 0), preg("assets", qe(q), "m", s)), (ym(qe(q0)), nf(aO, 0), preg("assets", qe(q0), "m", s))]), f"LTM {lq(q)}")
    rows_ = [["קבוצה", "גידול נכסים LTM (מיליארדי ש\"ח)", "מזה צבירה נטו (מיליארדי ש\"ח)", "מזה תשואה ואחר (מיליארדי ש\"ח)"]]
    best, bv = None, None
    for c in MAIN8 + [None]:
        if c and (not row(c, s, q) or not row(c, s, q0) or sum_net(c) is None):
            continue
        a1, a0, n = split(c)
        rows_.append([he(c) if c else "כלל השוק", nf((a1 - a0) / 1000, 1), nf(n / 1000, 1), nf((a1 - a0 - n) / 1000, 1)])
        if c and a1 > a0 and (bv is None or n / (a1 - a0) > bv):
            best, bv = c, n / (a1 - a0)
    figs["b"] = fshare(best)
    corr = "בשוק כולו {m} מהגידול בנכסי הפנסיה והגמל בשנה האחרונה בא מכסף חדש, והיתר מתשואה."
    email = (f"ב-LTM {lq(q)} נכסי הפנסיה והגמל גדלו ב-{{da}}; הצבירה נטו (הפקדות פחות משיכות ועוד העברות) תרמה {{mn}}, כלומר {{m}}. "
             f"מבין הקבוצות הגדולות, אצל {he(best)} החלק של הכסף החדש הגבוה ביותר: {{b}}.")
    ex = table("פירוק הגידול בנכסים LTM: כסף חדש מול תשואה, פנסיה וגמל", rows_,
               ["תשואה ואחר = גידול הנכסים פחות הצבירה נטו (כולל תשואה, דמי ניהול שנגבו ושינויי סיווג)", SRC_REG], span=f"{lq(qs[0])}–{lq(q)}")
    chg = changes_if("התשובה משתנה כשחלק הכסף החדש בשוק חוצה את {thr}", "m", ">=" if figs["m"]["v"] < 50 else "<", 50.0)
    return answer(figs, corr, email, ex, chg, f"new:{'maj' if figs['m']['v'] >= 50 else 'min'}|top:{best}", links=[sav("pg", "market")],
                  rel=["Q-027", "Q-011"], asof=lq(q))


@question("Q-027", "כמה כסף חדש נכנס לפנסיה ולגמל, והאם הקצב עולה?", ["ceo", "board", "inv"], "flows")
def q027(A):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    a, b = f_org(None, s, q), f_org(None, s, q0)
    v = (mkt(s, q, "org") / mkt(s, q0, "org") - 1) * 100
    figs = {"a": a, "b": b, "p": f_org(None, "pen", q), "gm": f_org(None, "gem", q)}
    figs["g"] = fig("שינוי YoY בצבירה האורגנית, כלל השוק", v, "pct",
                    P_calc("שינוי YoY בצבירה האורגנית · פנסיה וגמל", f"{nf(v, 1)}%", "%", f"{lq(q)} ÷ {lq(q0)} − 1",
                           [(lq(q), a["t"], None), (lq(q0), b["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), lq(q), signed=True)
    yes = v > 0
    corr = f"{'כן' if yes else 'לא'}: הצבירה האורגנית בפנסיה ובגמל השתנתה ב-{{g}} מול הרבעון המקביל."
    email = f"ב-{lq(q)} נכנסו לפנסיה ולגמל {{a}} בהפקדות פחות משיכות, מול {{b}} ב-{lq(q0)}. מזה פנסיה {{p}} וגמל והשתלמות {{gm}}."
    qs = L().quarters[-8:]
    ex = lines("צבירה אורגנית (הפקדות פחות משיכות), כלל השוק", 'מיליארדי ש"ח', qs,
               [(SEG_HE[x], [None if mkt(x, k, "org") is None else mkt(x, k, "org") / 1000 for k in qs]) for x in ("pen", "gem")],
               ["הפקדות פחות משיכות של כל המסלולים; ללא העברות בין מנהלים", SRC_REG])
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי חוצה את {thr}", "g", "<=" if yes else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "up" if yes else "down", links=[sav("pg", "market")], rel=["Q-026", "Q-028"], asof=lq(q))


@question("Q-028", "מי מגייס את רוב המצטרפים החדשים לפנסיה?", ["dist", "ceo", "strat"], "flows")
def q028(A):
    q = lastq()
    items = sorted(((c, lv(c, "pen", "nb.share", q)) for c in MAIN8 if lv(c, "pen", "nb.share", q) is not None), key=lambda x: -x[1])
    if len(items) < 3:
        return nodata("נתח הפקדות המצטרפים החדשים לא פורסם לרבעון")
    top = items[0][0]
    figs = {"top": f_lts(top, "pen", "nb.share", q), "nb": f_lts(top, "pen", "nb", q), "all": f_lts(None, "pen", "nb", q),
            "sh": f_share(top, "pen", q)}
    corr = f"{he(top)} מגייסת את הנתח הגדול של המצטרפים החדשים לפנסיה: {{top}} מהפקדותיהם."
    email = (f"ב-{lq(q)} הפקידו מצטרפים חדשים לקרנות החדשות של החברות המכוסות {{all}}; {he(top)} קיבלה {{nb}}, {{top}}, "
             f"מול נתח נכסים של {{sh}} בפנסיה.")
    ex = hbar(f"נתח מהפקדות המצטרפים החדשים, פנסיה, {lq(q)}", "%", items,
              ["דמי גמולים משונתים עבור מצטרפים חדשים, קרנות חדשות; נתח מסך החברות המכוסות", SRC_LTS], span=lq(q))
    chg = changes_if(f"המובילה מתחלפת אם הנתח של {he(top)} יורד אל מתחת ל-{{thr}}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}", links=[sav("pen")], rel=["Q-027", "Q-002"], asof=lq(q))


@question("Q-029", "מי קנה בשנה האחרונה את הניוד הרווחי ביותר, ומי משלם על ניוד שמפסיד?", ["ceo", "cfo", "strat", "inv"], "flows")
def q029(A):
    N = load("flow_npv.json")
    p, q, ke = N["meta"]["ltm"], N["meta"]["last_rep"], N["meta"]["ke"]
    rows_ = {(r["c"], r["s"]): r for r in N["rows"] if r["p"] == p and r.get("c") and r.get("npv_tr") is not None}

    def fnpv(c, s):
        r = rows_[(c, s)]
        D = N["dur"][s]["v"]
        pr = P_calc(f"ערך נוכחי של הניוד · {he(c)} · {SEG_HE[s]} · LTM {lq(q)}", nf(r["npv_tr"], 1), 'מיליוני ש"ח',
                    "NPV = העברות נטו × מרווח ÷ 100 × a(D, ke); מרווח = תשואת דמי ניהול × (1 − יחס הוצאות ÷ 100); a = (1 − (1 + ke)^−D) ÷ ke (flow_npv.json)",
                    [("העברות נטו LTM", nf(r["tr"], 1), preg("transfers", qe(q), "ltm", s, c)),
                     ("תשואת דמי ניהול LTM", f"{nf(r['fy'], 4)}%", f_fy_ltm(c, s, q)["prov"]),
                     ("יחס הוצאות להכנסות LTM", f"{nf(r['ci'], 2)}%", f_ci_ltm(c, s, q)["prov"]),
                     ("משך חיי הנכסים D (שנים)", nf(D, 2), None),
                     ("מחיר ההון ke", f"{nf(ke['v'], 2)}%", P_rep("ריבית חסרת סיכון, 10 שנים", f"{nf(ke['rf'], 2)}%", "%", ke["rf_url"], None,
                                                              "בנק ישראל · ZCM", ke["rf_month"], note=f"ke = rf + β × ERP = {nf(ke['rf'], 2)} + {nf(ke['beta'], 1)} × {nf(ke['erp'], 1)}"))],
                    est=True, note=r.get("mark"))
        return fig(f"ערך נוכחי של הניוד, {he(c)}, {SEG_HE[s]}", r["npv_tr"], "m", pr, f"LTM {lq(q)}", b="estimate", c=c, signed=True)

    tot = {}
    for c in MAIN8 + ["analyst"]:
        xs = [rows_[(c, s)]["npv_tr"] for s in ("pen", "gem") if (c, s) in rows_]
        if xs:
            tot[c] = math.fsum(xs)
    items = sorted(tot.items(), key=lambda x: -x[1])
    best = max(rows_, key=lambda k: rows_[k]["npv_tr"])
    top, ts = best
    second = max((rows_[k]["npv_tr"] for k in rows_ if k != best))
    bad = sorted([k for k, r in rows_.items() if r["tr"] > 0 and r["npv_tr"] < 0 and k[0] in MAIN8], key=lambda k: rows_[k]["npv_tr"])
    figs = {"top": fnpv(top, ts)}
    if bad:
        bc, bs = bad[0]
        figs["bad"], figs["btr"] = fnpv(bc, bs), f_msum(bc, bs, "tr", ltm_months_at(q))
        tail = f" בצד השני {he(bc)} ב{SEG_HE[bs]}: העברות נטו חיוביות של {{btr}} שערכן הנוכחי {{bad}}, כי המגזר מפסיד על כל שקל נכסים."
        vk = f"top:{top}.{ts}|bad:{bc}.{bs}"
    else:
        k2 = sorted(rows_, key=lambda k: -rows_[k]["npv_tr"])[1]
        figs["sec"] = fnpv(*k2)
        tail = f" אחריה {he(k2[0])} ב{SEG_HE[k2[1]]}, {{sec}}. אף קבוצה גדולה אינה קונה ניוד במרווח שלילי."
        vk = f"top:{top}.{ts}|bad:none"
    corr = f"{he(top)} ב{SEG_HE[ts]}: הניוד שקיבלה בשנה האחרונה שווה {{top}} בערך נוכחי, הגבוה בשוק."
    email = f"לפי המרווח התפעולי של כל מגזר ב-LTM {lq(q)}, ההעברות נטו של {he(top)} ב{SEG_HE[ts]} שוות {{top}} בערך נוכחי (אומדן).{tail}"
    ex = hbar(f"ערך נוכחי של ההעברות נטו LTM, פנסיה וגמל יחד, עד {lq(q)}", 'מיליוני ש"ח', items,
              ["אומדן: העברות נטו × מרווח תפעולי LTM × מקדם היוון על משך חיי הנכסים; מחיר הון = ריבית 10 שנים + פרמיה",
               "מיטב: לפני דמי ניהול לחברה בעלת השליטה, ולכן המרווח שלה גבוה מבר-ההשוואה", "flow_npv.json · " + SRC_REG], span=f"LTM {lq(q)}")
    chg = changes_if(f"המובילה מתחלפת אם הערך של {he(top)} ב{SEG_HE[ts]} יורד אל מתחת ל-{{thr}}", "top", "<", second)
    return answer(figs, corr, email, ex, chg, vk, links=[sav(v="npv"), sav("gem", "npv")], rel=["Q-001", "Q-060", "Q-067"], asof=f"LTM {lq(q)}")
