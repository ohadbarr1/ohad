"""Returns and performance: Sharpe against peers, whether past returns drive flows, the default tracks' 12-month returns.

Sources: fragility.json (the perf signal: asset-weighted 3Y Sharpe gap to the peer median per category, with its track inputs),
warroom/elasticity.json (the monthly flow model), funds.json (the regulator's track files), lens.json (flow ratios).
"""
import math

from answer_core import P_calc, SEG_HE, answer, changes_if, fig, he, link, load, lq, nf, nodata, question
from questions._sav import MAIN8, SRC_REG, best_track, f_y12, frag_link, fsig, hbar, lastq, name_to_id, names, row, sav, table
from questions.flows import flow_ratio, ratio_fig

PERF_FOOT = ["פער שארפ 3Y: Σ נכסים × (שארפ המסלול − חציון שארפ המסלולים של המנהלים האחרים באותה קטגוריה) ÷ Σ נכסים; קטגוריות עם 4 מנהלים לפחות",
             "שארפ 36 חודשים מתשואות חודשיות; ריבית חסרת סיכון: עקום האפס של בנק ישראל, שנה", "fragility.json · " + SRC_REG]
COS = MAIN8 + ["analyst", "yelin", "infinity", "hachshara", "ayalon", "idi"]


@question("Q-080", "מה מניע ניוד: דמי ניהול או תשואות עבר?", ["ceo", "strat", "dist", "board"], "perf")
def q080(A):
    E = load("warroom/elasticity.json")
    P, pooled = E["products"], E["pooled"]
    co = {x["x"]: x for x in pooled["main"]["coef"]}
    pp = P_calc("מודל הניוד החודשי · כל המוצרים יחד", f"R² {nf(pooled['main']['r2'], 2)}", "",
                "WLS על לוח מסלולים חודשי: ניוד נטו ÷ נכסי פתיחה = אפקט מסלול + אפקט קטגוריה×חודש + Σ דמי ניהול יחסיים (פיגורים 0–6) + תשואה יחסית 12 ו-36 חודשים + ln נכסים; "
                "שגיאות מקובצות לפי מסלול (warroom/elasticity.json)",
                [(P[k]["he"], f"t תשואה 12M {nf(next(c['t'] for c in P[k]['main']['coef'] if c['x'] == 'rel12'), 2)}", P[k]["prov"]) for k in P], est=True)
    w = E["meta"]["window"]
    figs = {"t12": fig("סטטיסטי t של תשואה יחסית 12 חודשים", co["rel12"]["t"], "r", pp, w, b="estimate", d=2),
            "t36": fig("סטטיסטי t של תשואה יחסית 36 חודשים", co["rel36"]["t"], "r", pp, w, b="estimate", d=2),
            "tf": fig("סטטיסטי t של דמי הניהול היחסיים", pooled["main"]["t"], "r", pp, w, b="estimate", d=2)}
    ret = abs(co["rel12"]["t"]) > abs(pooled["main"]["t"])
    corr = ("תשואות העבר" if ret else "דמי הניהול") + ": סטטיסטי ה-t של התשואה היחסית ב-12 חודשים הוא {t12}."
    email = (f"במודל הניוד החודשי על כל מסלולי הפנסיה, הגמל וההשתלמות ({w}) התשואה היחסית ב-12 חודשים קודמים מסבירה את הניוד בעוצמה (t של {{t12}}), "
             f"וגם ב-36 חודשים ({{t36}}); לדמי הניהול היחסיים t של {{tf}} בלבד. " + ("מי שמוביל בתשואה מושך ניוד; הנחה בדמי ניהול כמעט לא." if ret else ""))
    rows_ = [["מוצר", "t תשואה 12M", "t תשואה 36M", "t דמי ניהול", "R²"]]
    for k in P:
        cc = {x["x"]: x for x in P[k]["main"]["coef"]}
        rows_.append([P[k]["he"], nf(cc["rel12"]["t"], 2), nf(cc["rel36"]["t"], 2), nf(P[k]["main"]["t"], 2), nf(P[k]["main"]["r2"], 2)])
    rows_.append(["כל המוצרים", nf(co["rel12"]["t"], 2), nf(co["rel36"]["t"], 2), nf(pooled["main"]["t"], 2), nf(pooled["main"]["r2"], 2)])
    ex = table("מה מסביר את הניוד: תשואה יחסית מול דמי ניהול יחסיים", rows_,
               ["אומדן: WLS עם אפקט מסלול ואפקט קטגוריה×חודש; |t| מעל שתיים = מובהק", "דמי הניהול: השיעור שפורסם בינואר של השנה הבאה (מוזז שנה)", E["meta"]["source"]], span=w)
    figs["gap"] = fig("הפרש עוצמות: |t תשואה| − |t דמי ניהול|", abs(co["rel12"]["t"]) - abs(pooled["main"]["t"]), "r",
                      P_calc("הפרש עוצמות", nf(abs(co["rel12"]["t"]) - abs(pooled["main"]["t"]), 2), "", "|t תשואה 12M| − |t דמי ניהול|",
                             [("t תשואה", figs["t12"]["t"], None), ("t דמי ניהול", figs["tf"]["t"], None)], note="שני הנתונים מופיעים בתשובה זו"), w, b="estimate", d=2)
    chg = changes_if("התשובה מתהפכת אם הפרש העוצמות חוצה את {thr}", "gap", "<=" if ret else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "returns" if ret else "fees", links=[link("חדר המלחמה", "/warroom")], rel=["Q-046", "Q-084", "Q-085"], asof=w)


def perf_items(s):
    out = []
    for c in COS:
        f = fsig(c, "perf", s)
        if f:
            out.append((c, f["v"], f))
    return out


def f_gapS(c, s, f):
    return fig(f"פער שארפ 3Y מול העמיתים, {he(c)}, {SEG_HE[s]}", f["v"], "r", f["prov"], f["asof"], d=2, signed=True, c=c)


def sharpe(s, rel):
    items = sorted(perf_items(s), key=lambda x: -x[1])
    if len(items) < 3:
        return nodata("אות הביצועים של מוניטור השבריריות חסר")
    top, bot = items[0], items[-1]
    figs = {"top": f_gapS(top[0], s, top[2]), "bot": f_gapS(bot[0], s, bot[2])}
    main_top = next(x for x in items if x[0] in MAIN8)
    if main_top[0] != top[0]:
        figs["mt"] = f_gapS(main_top[0], s, main_top[2])
    corr = f"{he(top[0])} מובילה ב{SEG_HE[s]} בתשואה מתואמת סיכון: פער שארפ של {{top}} מול חציון העמיתים."
    email = (f"ב-{top[2]['asof']} השארפ של מסלולי {he(top[0])} ב{SEG_HE[s]}, משוקלל בנכסים, גבוה מחציון העמיתים בכל קטגוריה ב-{{top}}"
             + (f"; מבין שמונה הקבוצות הגדולות המובילה היא {he(main_top[0])}, {{mt}}" if "mt" in figs else "")
             + f". בתחתית {he(bot[0])}, {{bot}}.")
    ex = hbar(f"פער שארפ 3Y מול חציון העמיתים, {SEG_HE[s]}, {top[2]['asof']}", "שארפ", [(c, v) for c, v, _ in items], PERF_FOOT, span=top[2]["asof"])
    chg = changes_if(f"המובילה מתחלפת אם הפער של {he(top[0])} יורד אל מתחת ל-{{thr}}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top[0]}|bot:{bot[0]}", links=[frag_link(sig="perf"), link("קרנות ומסלולים", "/funds")], rel=rel, asof=top[2]["asof"])


@question("Q-081", "מי מוביל בפנסיה בתשואה מתואמת סיכון מול המתחרים?", ["ceo", "dist", "board", "inv"], "perf")
def q081(A):
    return sharpe("pen", ["Q-082", "Q-083", "Q-085"])


@question("Q-082", "מי מוביל בגמל והשתלמות בתשואה מתואמת סיכון מול המתחרים?", ["ceo", "dist", "board", "inv"], "perf")
def q082(A):
    return sharpe("gem", ["Q-081", "Q-083", "Q-084"])


@question("Q-083", "איזה מנהל מפגר בביצועים מול המתחרים, ובאיזה מוצר?", ["board", "ceo", "dist"], "perf")
def q083(A):
    xs = [(c, s, v, f) for s in ("pen", "gem", "ins") for c, v, f in perf_items(s) if c in MAIN8 + ["analyst", "yelin", "hachshara", "ayalon"]]
    xs.sort(key=lambda x: x[2])
    c, s, v, f = xs[0]
    flagged = [(x, y) for x, y, _, g in xs if g["st"] in ("watch", "alert")]
    figs = {"w": f_gapS(c, s, f)}
    d = f["x"].get("d")
    if d is not None:
        figs["d"] = fig(f"שינוי הפער ב-12 חודשים, {he(c)}, {SEG_HE[s]}", d, "r",
                        P_calc(f"שינוי פער השארפ ב-12 חודשים · {he(c)} · {SEG_HE[s]}", nf(d, 2), "שארפ", "הפער היום − הפער לפני 12 חודשים (fragility.json)",
                               [("היום", nf(f["x"]["g"], 2), f["prov"]), ("לפני 12 חודשים", nf(f["x"]["g12"], 2), None)]), f["asof"], d=2, signed=True, c=c)
    corr = f"{he(c)} ב{SEG_HE[s]}: פער שארפ של {{w}} מול חציון העמיתים, הגרוע בענף."
    email = (f"ב-{f['asof']} מסלולי {he(c)} ב{SEG_HE[s]} מפגרים אחרי חציון העמיתים בפער שארפ של {{w}}"
             + (", שינוי של {d} בשנה" if "d" in figs else "") + ". "
             + (f"במעקב או בהתראה: {', '.join(f'{he(x)} ({SEG_HE[y]})' for x, y in flagged)}." if flagged else "אף מנהל אינו במעקב."))
    rows_ = [["מנהל", "מוצר", "פער שארפ", "לפני 12 חודשים", "סטטוס"]] + [[he(x), SEG_HE[y], nf(v_, 2), nf(g["x"].get("g12"), 2), {"ok": "תקין", "watch": "מעקב", "alert": "התראה"}.get(g["st"], g["st"])]
                                                                       for x, y, v_, g in xs[:10]]
    ex = table(f"הביצועים החלשים מול העמיתים, {f['asof']}", rows_, PERF_FOOT + ["סטטוס: כללי מוניטור השבריריות (פער של −0.15 למעקב, −0.30 להתראה)"], span=f["asof"])
    chg = changes_if(f"התשובה משתנה אם הפער של {he(c)} עולה מעל {{thr}}", "w", ">", xs[1][2])
    return answer(figs, corr, email, ex, chg, f"worst:{c}.{s}|flag:{len(flagged)}", links=[frag_link(c, "perf")], rel=["Q-081", "Q-082"], asof=f["asof"])


def ret_flow(s, rel):
    q = lastq()
    xs = [(c, v, flow_ratio(c, s, q), f) for c, v, f in perf_items(s) if c in MAIN8 + ["analyst", "yelin"] and flow_ratio(c, s, q) is not None]
    if len(xs) < 4:
        return nodata("אין מספיק מנהלים עם אות ביצועים ויחס צבירה")
    agree = [x for x in xs if (x[1] > 0) == (x[2] > 1)]
    sh = len(agree) / len(xs) * 100
    figs = {"sh": fig(f"שיעור המנהלים שבהם כיוון התשואה וכיוון הצבירה זהים, {SEG_HE[s]}", sh, "pct",
                      P_calc(f"התאמה בין ביצועים לצבירה · {SEG_HE[s]}", f"{nf(sh, 0)}%", "%",
                             "מנהלים שבהם (פער שארפ > 0) שקול ל-(נתח צבירה ÷ נתח נכסים > 1), חלקי כל המנהלים × 100",
                             [(he(c), f"שארפ {nf(v, 2)} · צבירה {nf(r, 2)}×", f["prov"]) for c, v, r, f in xs]), lq(q), d=0)}
    best = max(xs, key=lambda x: x[1])
    worst = min(xs, key=lambda x: x[1])
    figs["bp"], figs["br"] = f_gapS(best[0], s, best[3]), ratio_fig(best[0], s, q)
    figs["wp"], figs["wr"] = f_gapS(worst[0], s, worst[3]), ratio_fig(worst[0], s, q)
    yes = sh >= 2 / 3 * 100
    mis = [c for c, v, r, _ in xs if (v > 0) != (r > 1)]
    corr = f"{'כן, ברובם' if yes else 'רק בחלקם'}: אצל {{sh}} מהמנהלים ב{SEG_HE[s]} כיוון התשואה מול העמיתים וכיוון הצבירה זהים."
    email = (f"המובילה בשארפ ב{SEG_HE[s]}, {he(best[0])} ({{bp}}), צוברת בקצב של {{br}} מגודלה; המפגרת, {he(worst[0])} ({{wp}}), בקצב של {{wr}}. "
             + (f"יוצאות דופן: {names(mis)}." if mis else "אין יוצאות דופן."))
    rows_ = [["מנהל", "פער שארפ 3Y", f"נתח צבירה ÷ נתח נכסים, {lq(q)}", "מתיישב"]] + \
            [[he(c), nf(v, 2), f"{nf(r, 2)}×", "כן" if (v > 0) == (r > 1) else "לא"] for c, v, r, _ in sorted(xs, key=lambda x: -x[1])]
    ex = table(f"ביצועים מול צבירה, {SEG_HE[s]}", rows_, PERF_FOOT + ["צבירה: נתח מהצבירה נטו (הפקדות פחות משיכות ועוד העברות) ÷ נתח מהנכסים"], span=lq(q))
    chg = changes_if("התשובה מתהפכת כששיעור ההתאמה חוצה את {thr}", "sh", "<" if yes else ">=", 2 / 3 * 100)
    return answer(figs, corr, email, ex, chg, f"agree:{'y' if yes else 'n'}|{len(agree)}/{len(xs)}", links=[frag_link(sig="perf"), sav(s)], rel=rel, asof=lq(q))


@question("Q-084", "בגמל: האם מי שמוביל בתשואה הוא גם מי שצובר?", ["ceo", "dist", "strat"], "perf")
def q084(A):
    return ret_flow("gem", ["Q-080", "Q-082", "Q-008"])


@question("Q-085", "בפנסיה: האם מי שמוביל בתשואה הוא גם מי שצובר?", ["ceo", "dist", "strat"], "perf")
def q085(A):
    return ret_flow("pen", ["Q-080", "Q-081", "Q-009"])


def track_ret(prod, track, title, rel):
    ids = name_to_id()
    xs = []
    for c in MAIN8 + ["analyst", "yelin"]:
        g = next((n for n, i in ids.items() if i == c), None)
        f = best_track(prod, track, g) if g else None
        if f:
            xs.append((c, f))
    if len(xs) < 4:
        return nodata("פחות מארבעה מנהלים עם מסלול פתוח בקטגוריה")
    xs.sort(key=lambda x: -x[1]["y12"])
    (tc, tf), (bc, bf) = xs[0], xs[-1]
    figs = {"top": f_y12(tf, tc), "bot": f_y12(bf, bc)}
    figs["sp"] = fig(f"פער התשואה בין הראשון לאחרון, {title}", tf["y12"] - bf["y12"], "pp",
                     P_calc(f"פער תשואה 12 חודשים · {title}", nf(tf["y12"] - bf["y12"], 2), "נק׳ אחוז", "המסלול המוביל − המסלול האחרון",
                            [(tf["name"], figs["top"]["t"], None), (bf["name"], figs["bot"]["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"),
                     figs["top"]["asof"], d=1)
    corr = f"{he(tc)}: תשואה של {{top}} ב-12 חודשים, הגבוהה ב{title}."
    email = (f"ב-12 חודשים עד {figs['top']['asof']} הניב המסלול של {he(tc)} {{top}}, והמסלול של {he(bc)} {{bot}}: "
             f"פער של {{sp}} באותה קטגוריה ובאותה מדיניות השקעה.")
    rows_ = [["מנהל", "מסלול", "תשואה 12 חודשים", "שארפ", "דמי ניהול מהצבירה", "נכסים (מיליוני ש\"ח)"]] + \
            [[he(c), f["name"], f"{nf(f['y12'], 2)}%", nf(f.get("sharpe"), 2), f"{nf(f.get('fee'), 2)}%", nf(f["assets"], 0)] for c, f in xs]
    ex = table(f"תשואה 12 חודשים, {title}", rows_, ["המסלול הפתוח הגדול של כל קבוצה בקטגוריה; ללא מסלולי ניהול אישי",
                                                    "תשואה ברוטו כפי שפורסמה, לפני דמי ניהול; ריבית דריבית של 12 התשואות החודשיות", SRC_REG], span=figs["top"]["asof"])
    chg = changes_if(f"המוביל מתחלף אם התשואה של {he(tc)} יורדת אל מתחת ל-{{thr}}", "top", "<", xs[1][1]["y12"])
    return answer(figs, corr, email, ex, chg, f"top:{tc}|bot:{bc}", links=[link("קרנות ומסלולים", "/funds")], rel=rel, asof=figs["top"]["asof"])


@question("Q-086", "מי הניב את התשואה הגבוהה בשנה האחרונה במסלול ברירת המחדל של הפנסיה (לבני חמישים ומטה)?", ["dist", "ceo", "board"], "perf")
def q086(A):
    return track_ret("פנסיה מקיפה", "עד 50", "מסלול לבני חמישים ומטה בפנסיה המקיפה", ["Q-081", "Q-085"])


@question("Q-087", "מי הניב את התשואה הגבוהה בשנה האחרונה במסלול הכללי של קרנות ההשתלמות?", ["dist", "ceo", "board"], "perf")
def q087(A):
    return track_ret("השתלמות", "כללי", "מסלול כללי בקרנות ההשתלמות", ["Q-082", "Q-084", "Q-004"])


@question("Q-088", "מי הניב את התשואה הגבוהה בשנה האחרונה במסלול הגמל לבני חמישים עד שישים?", ["dist", "ceo"], "perf")
def q088(A):
    return track_ret("גמל", "50-60", "מסלול הגמל לבני חמישים עד שישים", ["Q-082", "Q-084"])
