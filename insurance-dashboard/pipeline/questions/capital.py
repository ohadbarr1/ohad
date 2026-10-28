"""Capital: solvency headroom over the board target, what breaks it, distributable capital, dividends and buy-backs, debt, CSM runway and
the IFRS 17 sensitivities (Q-100..Q-129).

Sources (all published, provenance reused): fragility.json (A10: ratio vs board target, YoY, worst scenario, CSM runway),
capital/options.json (A7: own funds, SCR, binding constraint, management buffer, distributable capital, LTM dividend, options),
expectations/<co>.json (A3: market value on the manual 22.10.26 price), consolidation/matrix.json + pairs (A9: leverage, debt room),
debt/index.json + debt/<co>.json (form ת126), csm/capital.json (printed equity, ratios), csm/sens.json (IFRS 17 sensitivities).
"""
from math import fsum

from answer_core import P_calc, P_rep, changes_if, exhibit, fmt, he, link, load, nf, nodata, question
from questions._grp import (INS, MAIN, MAYA, MM, PRICE_LABEL, F, answer, bars, bars2, binding, cap_fig, cap_prov, capco, capser, cons_prov, dl, frag,
                             names_list, num, ql, table, xp)

BASIS = {"w": "עם הוראות מעבר", "wo": "ללא הוראות מעבר", "na": "בסיס לא צוין"}
L_CAP = link("הון וחלוקה", "/capital")
L_FRAG = link("מוניטור השבירות", "/fragility")
L_SCEN = link("חדר התרחישים", "/scenarios")
L_DEBT = link("מצבת החוב", "/debt")
L_CSM = link("CSM", "/csm")


def ok_caps():
    return [c for c in INS if capco(c)]


def co_link(c):
    return link(he(c), f"/company/{c}")


# ------------------------------------------------------------------------------------------------ solvency headroom (A10)
def head_fig(c, label=None):
    s = frag(c, "solv")
    return F(label or f"מרווח מעל יעד הדירקטוריון, {he(c)}", s["x"]["h"], "pp", s["prov"], s["asof"], c=c)


def ratio_fig(c):
    s = frag(c, "solv")
    return F(f"יחס כושר פירעון, {he(c)} ({BASIS[s['basis']]})", s["x"]["r"], "pct", s["provR"], s["asof"], c=c)


def solv_cos():
    return [c for c in INS if (frag(c, "solv") or {}).get("x") and frag(c, "solv")["x"].get("h") is not None]


@question("Q-100", "איזו מבטחת הכי קרובה ליעד כושר הפירעון של הדירקטוריון שלה?", ["board", "cfo", "reg", "inv"], "capital", INS)
def q100(A):
    cs = sorted(solv_cos(), key=lambda c: frag(c, "solv")["x"]["h"])
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם יחס ויעד במוניטור השבירות")
    a, b = cs[0], cs[1]
    ha = frag(a, "solv")["x"]["h"]
    figs = {"h1": head_fig(a), "h2": head_fig(b), "r1": ratio_fig(a)}
    band = "below" if ha < 0 else "thin" if ha < 10 else "ok"
    word = {"below": "כבר מתחת ליעד", "thin": "מרווח דק", "ok": "מרווח סביר"}[band]
    corr = f"{he(a)} ({word}): היחס שלה עומד {{h1}} מעל יעד הדירקטוריון."
    email = (f"{he(a)} היא הקרובה ביותר ליעד: יחס של {{r1}}, {{h1}} מעליו. השנייה בתור היא {he(b)}, עם מרווח של {{h2}}. "
             "כל מבטחת נמדדת מול היעד כפי שהדירקטוריון שלה ניסח אותו (עם הוראות מעבר או בלעדיהן), לכן המרווחים ולא היחסים הם הבסיס להשוואה.")
    ex = bars("מרווח יחס כושר הפירעון מעל יעד הדירקטוריון", "נ״א", [(c, frag(c, "solv")["x"]["h"]) for c in cs],
              ["נקודות אחוז מעל היעד, בבסיס שבו היעד נוסח", "מוניטור השבירות (A10): דוחות כספיים ודוחות כושר פירעון, יעד כפי שפורסם"],
              name="מרווח מעל היעד")
    chg = changes_if(f"{he(a)} מפסיקה להיות הקרובה ביותר כשהמרווח שלה עולה מעל {{thr}}", "h1", ">", frag(b, "solv")["x"]["h"])
    return answer(figs, corr, email, ex, chg, f"min:{a}|{band}", links=[L_FRAG, L_CAP, co_link(a)], rel=["Q-101", "Q-105", "Q-106"],
                  asof=frag(a, "solv")["asof"])


@question("Q-101", "האם מבטחת כלשהי נמצאת מתחת ליעד כושר הפירעון בבסיס המחייב?", ["board", "reg", "cfo", "inv"], "capital", INS)
def q101(A):
    rows = []
    for c in ok_caps():
        x = capco(c)
        for k in x["constraints"]:
            rows.append((c, k))
    if not rows:
        return nodata("אין חישוב A7 למבטחות")
    below = [(c, k) for c, k in rows if k["pp"] < 0]
    worst_c, worst_k = min(rows, key=lambda r: r[1]["pp"])
    x = capco(worst_c)
    b = worst_k["basis"]
    figs = {"gap": F(f"פער מול {worst_k['he']}, {he(worst_c)}", worst_k["pp"], "pp",
                     P_calc(f"פער מול היעד · {he(worst_c)} · {x['period']}", fmt(worst_k["pp"], "pp"), "נ״א", "יחס כושר פירעון − יעד",
                            [("יחס כושר פירעון, " + BASIS[b], f"{nf(x['bases'][b]['ratio']['v'], 1)}%", cap_prov(x, x["bases"][b]["ratio"]["prov"])),
                             (worst_k["he"], f"{nf(worst_k['t'], 1)}%", cap_prov(x, worst_k["t_prov"]))]), x["period"], c=worst_c),
            "nis": cap_fig(worst_c, f"עודף (חוסר) הון מול {worst_k['he']}, {he(worst_c)}", worst_k["headroom"], "m", x["period"])}
    if below:
        vk = "below:" + ",".join(sorted({c for c, _ in below}))
        corr = f"כן: {names_list(sorted({c for c, _ in below}))} מתחת ליעד בבסיס {BASIS[b]}, בפער של {{gap}}."
        later = capser(worst_c, f"sr_{b}", "2026Q1")
        email = (f"בתאריך החישוב של {x['period']}, {he(worst_c)} הייתה מתחת ל{worst_k['he']}: פער של {{gap}}, חוסר של {{nis}} מול היעד. "
                 "זה הבסיס המחייב את החלוקה שלה, ולכן ההון בר-החלוקה שלה שלילי.")
        if later:
            v, p = later["v"], P_rep(f"יחס כושר פירעון, {BASIS[b]} · {he(worst_c)} · Q1'26", f"{nf(later['v'], 0)}%", "%", later["u"], later["pg"], "דוח כספי", "Q1'26")
            figs["later"] = F(f"יחס כושר פירעון {BASIS[b]}, {he(worst_c)}, 31.03.26", v, "pct", p, "31.03.26", c=worst_c)
            figs["tgt"] = F(f"{worst_k['he']}, {he(worst_c)}", worst_k["t"], "pct", cap_prov(x, worst_k["t_prov"]), worst_k["period"], c=worst_c, b="target")
            email += " ביחס שפורסם ליום 31.03.26 היא כבר עמדה על {later} מול יעד של {tgt}, כלומר מעליו; ההון בר-החלוקה עדיין מחושב על ההון העצמי וה-SCR של FY'25."
            if len(below) == 1 and later["v"] >= worst_k["t"]:  # the corridor must not leave a stale verdict standing
                vk += "|cured:Q1'26"
                corr = f"ב-{x['period']} כן: {he(worst_c)} מתחת ליעד בבסיס {BASIS[b]}, בפער של {{gap}}, וב-31.03.26 כבר מעליו."
    else:
        vk = "none"
        corr = f"לא: הקרובה ביותר היא {he(worst_c)}, {{gap}} מעל {worst_k['he']}."
        email = f"כל המבטחות מעל היעדים שלהן בכל בסיס. הקרובה ביותר: {he(worst_c)}, {{gap}} מעל {worst_k['he']}, עודף של {{nis}}."
    tab = [[he(c), k["he"], f"{nf(k['t'], 1)}%", f"{nf(capco(c)['bases'][k['basis']]['ratio']['v'], 1)}%", fmt(k["pp"], "pp"), fmt(k["headroom"]["v"], "m", 0, True)]
           for c, k in sorted(rows, key=lambda r: r[1]["pp"])]
    ex = table("יחס כושר פירעון מול כל אילוץ, לכל מבטחת", ["מבטחת", "אילוץ", "יעד", "יחס", "פער", "עודף (חוסר)"], tab,
               [f"תאריך החישוב: {x['period']} (הון עצמי ו-SCR של חברת הביטוח)", "A7: capital/options.json; יעדים כפי שפורסמו, עם עמוד"])
    chg = changes_if("התשובה מתהפכת כשהפער עובר את {thr}", "gap", ">=" if below else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[L_CAP, co_link(worst_c)], rel=["Q-100", "Q-102", "Q-103"], asof=x["period"])


@question("Q-102", "כמה הון בר-חלוקה יש לכל מבטחת מעל היעד והמרווח הניהולי?", ["cfo", "board", "inv"], "capital", INS)
def q102(A):
    cs = ok_caps()
    if not cs:
        return nodata("אין חישוב A7")
    cs = sorted(cs, key=lambda c: -capco(c)["distributable"]["v"])
    top = cs[0]
    pos = [c for c in cs if capco(c)["distributable"]["v"] > 0]
    neg = [c for c in cs if capco(c)["distributable"]["v"] <= 0]
    tot = fsum(capco(c)["distributable"]["v"] for c in pos)
    figs = {"top": cap_fig(top, f"הון בר-חלוקה, {he(top)}", capco(top)["distributable"], "m", capco(top)["period"], b="estimate"),
            "tot": F("הון בר-חלוקה, סך המבטחות עם עודף", tot, "m",
                     P_calc("הון בר-חלוקה · סך המבטחות עם עודף", fmt(tot, "m"), MM, "Σ ההון בר-החלוקה של המבטחות שבהן הוא חיובי",
                            [(he(c), fmt(capco(c)["distributable"]["v"], "m"), cap_prov(capco(c), capco(c)["distributable"]["prov"])) for c in pos], est=True),
                     capco(top)["period"], b="estimate")}
    corr = f"ל{he(top)} הכי הרבה: {{top}} מעל היעד המחייב והמרווח הניהולי."
    email = (f"ההון בר-החלוקה של {he(top)} הוא {{top}}; יחד, המבטחות שיש להן עודף מחזיקות {{tot}}. "
             "החישוב: הון עצמי פחות SCR כפול היעד המחייב, פחות מרווח ניהולי שנגזר מהתנודה הרגילה של היחס (הנחה גלויה).")
    if neg:
        figs["neg"] = cap_fig(neg[-1], f"הון בר-חלוקה, {he(neg[-1])}", capco(neg[-1])["distributable"], "m", capco(neg[-1])["period"], b="estimate")
        email += f" ל{names_list(neg)} אין הון פנוי לחלוקה בבסיס המחייב (הנמוכה: {he(neg[-1])}, {{neg}})."
    ex = bars("הון בר-חלוקה מעל היעד המחייב והמרווח הניהולי", MM, [(c, capco(c)["distributable"]["v"]) for c in cs],
              [f"מיליוני ש\"ח, {capco(top)['period']}; שלילי = חוסר מול היעד המחייב", "A7 (capital/options.json): הון עצמי − SCR × יעד − מרווח ניהולי (הנחה)"],
              name="הון בר-חלוקה")
    second = capco(cs[1])["distributable"]["v"] if len(cs) > 1 else 0.0
    chg = changes_if(f"{he(top)} מאבדת את המקום הראשון כשההון בר-החלוקה שלה יורד מתחת ל-{{thr}}", "top", "<", second)
    return answer(figs, corr, email, ex, chg, f"top:{top}|neg:{len(neg)}", links=[L_CAP], rel=["Q-101", "Q-108", "Q-109", "Q-127"],
                  asof=capco(top)["period"])


@question("Q-103", "מה מחייב את החלוקה בכל מבטחת: יעד הדירקטוריון או סף הדיבידנד, עם הוראות מעבר או בלעדיהן?", ["cfo", "board", "reg"], "capital", INS)
def q103(A):
    cs = ok_caps()
    if not cs:
        return nodata("אין חישוב A7")
    wo = [c for c in cs if binding(c)["basis"] == "wo"]
    figs = {"n": F("מבטחות שבהן הבסיס המחייב הוא ללא הוראות מעבר", len(wo), "n",
                   P_calc("מבטחות שבהן הבסיס המחייב הוא ללא הוראות מעבר", str(len(wo)), "מבטחות",
                          "ספירת המבטחות שבהן האילוץ עם העודף הקטן ביותר מנוסח ללא הוראות מעבר (A7 binding)",
                          [(f"{he(c)}: {binding(c)['he']}", fmt(binding(c)["headroom"]["v"], "m", 0, True), cap_prov(capco(c), binding(c)["headroom"]["prov"])) for c in cs]),
                   capco(cs[0])["period"], t=f"{len(wo)} מתוך {len(cs)}")}
    tight = min(cs, key=lambda c: binding(c)["headroom"]["v"])
    figs["tight"] = cap_fig(tight, f"עודף מעל האילוץ המחייב, {he(tight)}", binding(tight)["headroom"], "m", capco(tight)["period"])
    vk = f"wo:{len(wo)}/{len(cs)}"
    corr = "בדרך כלל הבסיס ללא הוראות מעבר: הוא מחייב את החלוקה ב-{n} מבטחות."
    if len(wo) * 2 < len(cs):
        corr = "בדרך כלל הבסיס עם הוראות מעבר או סף הדיבידנד: הבסיס ללא הוראות מעבר מחייב רק ב-{n} מבטחות."
    email = ("האילוץ המחייב הוא זה שהעודף מעליו הקטן ביותר; הוא קובע כמה אפשר לחלק. ללא הוראות מעבר הוא המחייב ב-{n} מבטחות. "
             f"העודף הדק ביותר מעל האילוץ המחייב: {he(tight)}, {{tight}} ({binding(tight)['he']}).")
    tab = [[he(c), binding(c)["he"], f"{nf(binding(c)['t'], 1)}%", fmt(binding(c)["pp"], "pp"), fmt(binding(c)["headroom"]["v"], "m", 0, True),
            " · ".join(k["he"] for k in capco(c)["constraints"] if k["id"] != capco(c)["binding"]) or "–"] for c in cs]
    ex = table("האילוץ המחייב של כל מבטחת", ["מבטחת", "אילוץ מחייב", "יעד", "מרווח", "עודף", "אילוצים נוספים"], tab,
               [f"תאריך החישוב {capco(cs[0])['period']}; המחייב = העודף הקטן ביותר בש\"ח", "A7: capital/options.json, יעדים כפי שפורסמו"])
    return answer(figs, corr, email, ex, None, vk, links=[L_CAP], rel=["Q-101", "Q-104"], asof=capco(cs[0])["period"])


@question("Q-104", "כמה תלויות המבטחות בהוראות המעבר?", ["reg", "cfo", "inv"], "capital", INS)
def q104(A):
    cs = [c for c in ok_caps() if "w" in capco(c)["bases"] and "wo" in capco(c)["bases"]]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם יחס בשני הבסיסים")

    def gap(c):
        b = capco(c)["bases"]
        return b["w"]["ratio"]["v"] - b["wo"]["ratio"]["v"]

    def gfig(c):
        x = capco(c)
        b = x["bases"]
        return F(f"תרומת הוראות המעבר ליחס, {he(c)}", gap(c), "pp",
                 P_calc(f"תרומת הוראות המעבר · {he(c)} · {x['period']}", fmt(gap(c), "pp"), "נ״א", "יחס עם הוראות מעבר − יחס ללא הוראות מעבר",
                        [("עם הוראות מעבר", f"{nf(b['w']['ratio']['v'], 1)}%", cap_prov(x, b["w"]["ratio"]["prov"])),
                         ("ללא הוראות מעבר", f"{nf(b['wo']['ratio']['v'], 1)}%", cap_prov(x, b["wo"]["ratio"]["prov"]))]), x["period"], c=c)
    cs = sorted(cs, key=lambda c: -gap(c))
    top, low = cs[0], cs[-1]
    figs = {"top": gfig(top), "low": gfig(low)}
    corr = f"{he(top)} התלויה ביותר: הוראות המעבר מוסיפות ליחס שלה {{top}}."
    email = (f"הוראות המעבר (הניכוי בתקופת הפריסה והתאמת תרחיש המניות) מוסיפות ליחס של {he(top)} {{top}}; אצל {he(low)}, הפחות תלויה, רק {{low}}. "
             "ההוראות מסתיימות בהדרגה, ולכן היחס ללא הוראות מעבר הוא מה שיישאר.")
    ex = bars2("יחס כושר פירעון עם הוראות מעבר ובלעדיהן", "%", cs,
               [("עם הוראות מעבר", [capco(c)["bases"]["w"]["ratio"]["v"] for c in cs]), ("ללא הוראות מעבר", [capco(c)["bases"]["wo"]["ratio"]["v"] for c in cs])],
               [f"%, {capco(top)['period']}: הון עצמי ÷ SCR של חברת הביטוח", "A7: capital/options.json (דוחות כספיים, עמוד לכל שורה)"])
    chg = changes_if(f"{he(top)} מפסיקה להיות התלויה ביותר כשהתרומה יורדת מתחת ל-{{thr}}", "top", "<", gap(cs[1]))
    return answer(figs, corr, email, ex, chg, f"top:{top}", links=[L_CAP], rel=["Q-103", "Q-100"], asof=capco(top)["period"])


@question("Q-105", "מי שחקה את יחס כושר הפירעון הכי הרבה בשנה האחרונה?", ["board", "reg", "inv"], "capital", INS)
def q105(A):
    cs = [c for c in INS if (frag(c, "solv") or {}).get("t") is not None]
    if len(cs) < 2:
        return nodata("אין שינוי שנתי ביחס לשתי מבטחות לפחות")
    cs = sorted(cs, key=lambda c: frag(c, "solv")["t"])
    lo, hi = cs[0], cs[-1]

    def dfig(c):
        s = frag(c, "solv")
        return F(f"שינוי ביחס כושר הפירעון בשנה, {he(c)}", s["t"], "pp", s["provT"], s["asof"], c=c)
    figs = {"lo": dfig(lo), "hi": dfig(hi), "r": ratio_fig(lo)}
    t_lo = frag(lo, "solv")["t"]
    if t_lo < 0:
        corr = f"{he(lo)}: יחס כושר הפירעון שלה השתנה ב-{{lo}} בשנה."
        vk = f"fell:{lo}"
    else:
        corr = f"אף אחת לא נשחקה; החלשה ביותר היא {he(lo)}, שינוי של {{lo}} בשנה."
        vk = "none-fell"
    email = (f"בשנה האחרונה יחס כושר הפירעון של {he(lo)} השתנה ב-{{lo}} והגיע ל-{{r}}; בקצה השני {he(hi)}, שינוי של {{hi}}. "
             "כל מבטחת נמדדת בבסיס שבו הדירקטוריון שלה מנסח את היעד, מול אותו תאריך שנה קודם.")
    ex = bars("שינוי ביחס כושר הפירעון בשנה האחרונה", "נ״א", [(c, frag(c, "solv")["t"]) for c in cs],
              ["נקודות אחוז, תאריך החישוב האחרון מול שנה קודם, בבסיס היעד של כל מבטחת", "מוניטור השבירות (A10), דוחות כספיים"], name="שינוי בשנה")
    chg = changes_if("התשובה משתנה כשהשינוי חוצה את {thr}", "lo", ">=" if t_lo < 0 else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[L_FRAG], rel=["Q-100", "Q-106"], asof=frag(lo, "solv")["asof"])


@question("Q-106", "מה שובר את כושר הפירעון: איזו מבטחת חוצה את היעד בתרחיש הגרוע?", ["board", "reg", "cfo", "inv"], "capital", INS)
def q106(A):
    meas = [c for c in INS if (frag(c, "scen") or {}).get("st") not in (None, "nodata", "na") and frag(c, "scen").get("v") is not None]
    stale = [c for c in INS if c not in meas]
    if not meas:
        return nodata("אין מבטחת עם רגישויות יחס עדכניות")
    meas = sorted(meas, key=lambda c: frag(c, "scen")["v"])
    w = meas[0]
    s = frag(w, "scen")

    def sfig(c):
        x = frag(c, "scen")
        return F(f"מרווח ליעד בתרחיש הגרוע, {he(c)}", x["v"], "pp", x["prov"], x["asof"], c=c, b="estimate", signed=True)
    figs = {"w": sfig(w), "h0": head_fig(w, f"מרווח ליעד בבסיס, {he(w)}")}
    cross = [c for c in meas if frag(c, "scen")["v"] < 0]
    if cross:
        corr = f"{names_list(cross)}: בתרחיש \"{s.get('worst_he')}\" היחס יורד אל מתחת ליעד, במרווח של {{w}}."
        vk = "cross:" + ",".join(cross)
    else:
        corr = f"אף מבטחת לא חוצה; הקרובה ביותר היא {he(w)}, עם {{w}} בתרחיש \"{s.get('worst_he')}\"."
        vk = f"none:{w}"
    email = (f"בתרחיש הגרוע ({s.get('worst_he')}), המרווח של {he(w)} יורד מ-{{h0}} ל-{{w}}. ")
    if len(meas) > 1:
        figs["w2"] = sfig(meas[1])
        email += f"השנייה: {he(meas[1])}, עם {{w2}}. "
    if stale:
        email += f"ל{names_list(stale)} הרגישויות שפורסמו ישנות מדי או חסרות, ולכן לא נמדדו."
    ex = bars("מרווח ליעד הדירקטוריון בתרחיש הגרוע", "נ״א", [(c, frag(c, "scen")["v"]) for c in meas],
              ["נקודות אחוז אחרי התרחיש הגרוע מבין שבעת תרחישי חדר התרחישים; שלילי = מתחת ליעד", "רגישויות יחס כושר הפירעון כפי שגולו בדוחות (A2), יעד כפי שפורסם"],
              name="מרווח בתרחיש הגרוע")
    chg = changes_if("התשובה משתנה כשהמרווח בתרחיש הגרוע חוצה את {thr}", "w", ">=" if cross else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[L_SCEN, L_FRAG], rel=["Q-100", "Q-124", "Q-125"], asof=s["asof"])


# ------------------------------------------------------------------------------------------------ dividends and buy-backs (A7)
def div_cos():
    return [c for c in ok_caps() if (capco(c)["dividend"].get("ltm") or {}).get("v") is not None]


def payout(c):
    x = capco(c)
    return x["dividend"]["ltm"]["v"] / x["pnl"]["net_profit"]["v"] * 100


def payout_fig(c):
    x = capco(c)
    d, n = x["dividend"]["ltm"], x["pnl"]["net_profit"]
    return F(f"שיעור חלוקה LTM, {he(c)}", payout(c), "pct",
             P_calc(f"שיעור חלוקה · {he(c)} · LTM Q2'26", fmt(payout(c), "pct"), "%", "דיבידנד שהוכרז LTM ÷ רווח נקי LTM לבעלי המניות × 100",
                    [("דיבידנד LTM", fmt(d["v"], "m"), cap_prov(x, d["prov"])), ("רווח נקי LTM", fmt(n["v"], "m"), cap_prov(x, n["prov"]))]),
             "LTM Q2'26", c=c)


@question("Q-107", "איזה חלק מהרווח חילקו המבטחות כדיבידנד בשנה האחרונה?", ["inv", "cfo", "board"], "capital", INS)
def q107(A):
    cs = div_cos()
    if len(cs) < 2:
        return nodata("אין דיבידנד LTM לשתי מבטחות")
    cs = sorted(cs, key=lambda c: -payout(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": payout_fig(hi), "lo": payout_fig(lo), "dhi": cap_fig(hi, f"דיבידנד שהוכרז LTM, {he(hi)}", capco(hi)["dividend"]["ltm"], "m", "LTM Q2'26")}
    none = [c for c in ok_caps() if c not in cs]
    corr = f"{he(hi)} חילקה את החלק הגדול ביותר: {{hi}} מהרווח."
    email = (f"ב-LTM עד Q2'26 {he(hi)} הכריזה על {{dhi}}, {{hi}} מהרווח הנקי; בקצה הנמוך {he(lo)}, עם {{lo}}. "
             "זה דיבידנד שהוכרז מול רווח של אותה תקופה, לא מדיניות.")
    if none:
        email += f" ל{names_list(none)} לא נמצא דיבידנד שהוכרז ב-LTM."
    ex = bars("שיעור חלוקה LTM: דיבידנד שהוכרז ÷ רווח נקי", "%", [(c, payout(c)) for c in cs],
              ["%, ארבעת הרבעונים Q3'25–Q2'26", "A7: capital/options.json (דוחות כספיים, באור דיבידנד; רווח לבעלי המניות)"], name="שיעור חלוקה")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_CAP], rel=["Q-108", "Q-136"], asof="LTM Q2'26")


@question("Q-108", "לכמה שנים של דיבידנד בקצב הנוכחי מספיק ההון בר-החלוקה?", ["cfo", "board", "inv"], "capital", INS)
def q108(A):
    cs = [c for c in div_cos() if capco(c)["dividend"]["ltm"]["v"] > 0]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם דיבידנד LTM")

    def yrs(c):
        x = capco(c)
        return x["distributable"]["v"] / x["dividend"]["ltm"]["v"]

    def yfig(c):
        x = capco(c)
        return F(f"שנות דיבידנד בהון בר-החלוקה, {he(c)}", yrs(c), "yrs",
                 P_calc(f"כיסוי הדיבידנד בהון הפנוי · {he(c)}", fmt(yrs(c), "yrs"), "שנים", "הון בר-חלוקה ÷ דיבידנד שהוכרז LTM",
                        [("הון בר-חלוקה", fmt(x["distributable"]["v"], "m"), cap_prov(x, x["distributable"]["prov"])),
                         ("דיבידנד LTM", fmt(x["dividend"]["ltm"]["v"], "m"), cap_prov(x, x["dividend"]["ltm"]["prov"]))], est=True),
                 x["period"], c=c, b="estimate")
    cs = sorted(cs, key=yrs)
    lo, hi = cs[0], cs[-1]
    figs = {"lo": yfig(lo), "hi": yfig(hi)}
    corr = f"הכי צפוף אצל {he(lo)}: ההון הפנוי מכסה {{lo}} של דיבידנד בקצב הנוכחי."
    email = (f"בלי רווח נוסף, ההון בר-החלוקה של {he(lo)} מספיק ל-{{lo}} של דיבידנד בקצב ה-LTM; ל{he(hi)} יש הכי הרבה מקום, {{hi}}. "
             "בפועל הדיבידנד ממומן בעיקר מהרווח השוטף; המדד אומר כמה כרית יש אם הרווח נעצר.")
    ex = bars("הון בר-חלוקה ÷ דיבידנד LTM", "שנים", [(c, yrs(c)) for c in cs],
              ["שנים של דיבידנד בקצב LTM Q2'26", "A7: הון בר-חלוקה (הנחת מרווח ניהולי) ודיבידנד שהוכרז"], name="שנות כיסוי")
    chg = changes_if(f"{he(lo)} מתקרבת לחלוקה מעבר להון הפנוי כשהכיסוי יורד מתחת ל-{{thr}}", "lo", "<", 1.0)
    return answer(figs, corr, email, ex, chg, f"lo:{lo}", links=[L_CAP], rel=["Q-102", "Q-107"], asof=capco(lo)["period"])


def mcap_fig(c):
    e = xp(c)
    m = e["price"]["mcap"]
    return F(f"שווי שוק, {he(c)} ({PRICE_LABEL})", m["v"], "m", m["prov"], "22.10.26", c=c)


@question("Q-109", "כמה מהשווי יכולה כל מבטחת לקנות בחזרה בהון הפנוי?", ["cfo", "inv", "board"], "capital", INS)
def q109(A):
    cs = [c for c in ok_caps() if xp(c) and capco(c)["distributable"]["v"] > 0]
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם הון פנוי ושווי שוק")

    def sh(c):
        return capco(c)["distributable"]["v"] / xp(c)["price"]["mcap"]["v"] * 100

    def sfig(c):
        x, m = capco(c), xp(c)["price"]["mcap"]
        return F(f"הון בר-חלוקה ÷ שווי שוק, {he(c)}", sh(c), "pct",
                 P_calc(f"קיבולת רכישה עצמית · {he(c)}", fmt(sh(c), "pct"), "%", "הון בר-חלוקה ÷ שווי שוק × 100",
                        [("הון בר-חלוקה", fmt(x["distributable"]["v"], "m"), cap_prov(x, x["distributable"]["prov"])),
                         (f"שווי שוק ({PRICE_LABEL})", fmt(m["v"], "m"), m["prov"])], est=True), "22.10.26", c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -sh(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": sfig(hi), "lo": sfig(lo), "cap": cap_fig(hi, f"הון בר-חלוקה, {he(hi)}", capco(hi)["distributable"], "m", capco(hi)["period"], b="estimate")}
    corr = f"ל{he(hi)} הכי הרבה מקום: ההון הפנוי שלה שווה {{hi}} משווי השוק."
    email = (f"ההון בר-החלוקה של {he(hi)}, {{cap}}, שווה {{hi}} משווי השוק שלה; אצל {he(lo)} רק {{lo}}. "
             f"שווי השוק לפי {PRICE_LABEL}; רכישה בפועל כפופה גם לאישור הממונה ולמדיניות הדירקטוריון.")
    ex = bars("הון בר-חלוקה כשיעור משווי השוק", "%", [(c, sh(c)) for c in cs],
              [f"%, הון בר-חלוקה {capco(hi)['period']} ÷ שווי שוק ({PRICE_LABEL})", "A7 (capital/options.json), A3 (expectations): שווי שוק כפי שפרסמה הבורסה"],
              name="קיבולת רכישה")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_CAP, link("מה המחיר דורש", "/expectations")], rel=["Q-102", "Q-110", "Q-185"],
                  asof="22.10.26")


@question("Q-110", "מה מניב יותר להון הפנוי: צמיחה, חלוקה או רכישה?", ["ceo", "cfo", "board", "strat"], "capital", INS)
def q110(A):
    cs = [c for c in ok_caps() if capco(c)["rank"]]
    if not cs:
        return nodata("לאף מבטחת אין הון פנוי להקצאה")

    def opt(c, k):
        return next((o for o in capco(c)["options"] if o["id"] == k), None)

    def spread(c):
        return opt(c, "org")["roic"]["v"] - opt(c, "div")["roic"]["v"]
    org_first = [c for c in cs if capco(c)["rank"][0] == "org"]
    lo = min(cs, key=spread)
    x = capco(lo)
    figs = {"sp": F(f"תשואה על הון בצמיחה פחות תשואה בחלוקה, {he(lo)}", spread(lo), "pp",
                    P_calc(f"פער התשואה: צמיחה מול חלוקה · {he(lo)}", fmt(spread(lo), "pp"), "נ״א", "ROIC בצמיחה (ROE LTM, הנחה: שולי = ממוצע) − ROIC בחלוקה (ke)",
                           [("ROIC בצמיחה", fmt(opt(lo, "org")["roic"]["v"], "pct"), cap_prov(x, opt(lo, "org")["roic"]["prov"])),
                            ("ROIC בחלוקה (ke)", fmt(opt(lo, "div")["roic"]["v"], "pct"), cap_prov(x, opt(lo, "div")["roic"]["prov"]))], est=True),
                    "LTM Q2'26", c=lo, b="estimate"),
            "ke": cap_fig(lo, "מחיר ההון (ke)", x["pnl"]["ke"], "pct", "09/26", b="estimate")}
    bolts = [c for c in cs if opt(c, "bolt") and opt(c, "bolt").get("status") == "ok"]
    vk = f"org-first:{len(org_first)}/{len(cs)}"
    corr = ("צמיחה, אצל כולן: גם אצל החלשה בהן, " + he(lo) + ", הפער מעל חלוקה הוא {sp}.") if len(org_first) == len(cs) else \
        f"צמיחה ב-{len(org_first)} החברות מתוך {len(cs)}; הפער הצר ביותר, אצל {he(lo)}, הוא {{sp}}."
    email = (f"ההשוואה של מודול ההון: השקעת הון בצמיחה מניבה את ה-ROE השוטף (הנחה: התשואה השולית שווה לממוצעת), חלוקה או רכישה מחזירות לבעלי המניות את מחיר ההון, {{ke}}. "
             f"הפער הקטן ביותר, אצל {he(lo)}, הוא {{sp}}.")
    if bolts:
        b0 = bolts[0]
        ob = opt(b0, "bolt")
        figs["broic"] = F(f"ROIC ברכישה המשלימה, {he(b0)} ← {ob['tgt_name']}", ob["roic"]["v"], "pct", cap_prov(capco(b0), ob["roic"]["prov"]), "LTM Q2'26", c=b0, b="estimate")
        email += f" רכישה משלימה מדורגת אחרונה: אצל {he(b0)} (יעד: {ob['tgt_name']}) היא מניבה {{broic}}."
    tab = [[he(c)] + [fmt(opt(c, k)["roic"]["v"], "pct") if opt(c, k) and opt(c, k).get("roic") else "–" for k in ("org", "div", "bolt")] +
           [" > ".join({"org": "צמיחה", "div": "חלוקה", "bolt": "רכישה"}[k] for k in capco(c)["rank"])] for c in cs]
    ex = table("תשואה על ההון הפנוי לפי שימוש", ["מבטחת", "צמיחה (ROE)", "חלוקה (ke)", "רכישה משלימה", "דירוג"], tab,
               ["ROIC שנתי; צמיחה = ROE LTM (הנחה), חלוקה = ke, רכישה = רווח היעד והסינרגיה ÷ מחיר בפרמיה", "A7: capital/options.json; A9 לרכישה"])
    chg = changes_if(f"אצל {he(lo)} חלוקה עוקפת צמיחה כשהפער יורד מתחת ל-{{thr}}", "sp", "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[L_CAP, link("מסך האיחודים", "/consolidation")], rel=["Q-109", "Q-161"], asof="LTM Q2'26")


# ------------------------------------------------------------------------------------------------ debt (ת126, A9)
def wall(c):
    for x in load("debt/index.json")["companies"]:
        if x["id"] == c and x.get("walls"):
            return x["walls"][0]
    return None


def wall_y1(c):
    """next-12-months principal and interest, NIS m, with a provenance node per form part"""
    w = wall(c)
    parts = w["parts"]
    tot = fsum(p["b"]["y1"][0] + p["b"]["y1"][1] for p in parts) / 1000
    ins = [(f"{p['k']} · ישות {p['e']}", nf((p["b"]["y1"][0] + p["b"]["y1"][1]) / 1000, 1),
            P_rep(f"קרן וריבית בשנה הראשונה · {p['k']} · ישות {p['e']}", nf((p["b"]["y1"][0] + p["b"]["y1"][1]) / 1000, 1), MM, MAYA + p["url"], None,
                  f"MAYA טופס ת126 · {p['ref']}", ql(w["end"][:4] + {"03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4"}[w["end"][5:7]]),
                  note="מצבת התחייבויות לפי מועדי פירעון; אלפי ש\"ח בטופס, מוצג במיליונים")) for p in parts]
    return tot, ins


def profit_ltm(c):
    w = wall(c)
    pl = w["cov"]["profit_ltm"]
    ins = [(ql(k), nf(v, 1), P_rep(f"רווח נקי לבעלי המניות · {he(c)} · {ql(k)}", nf(v, 1), MM, u, pg, "דוח כספי", ql(k), note="Q4 נגזר: FY פחות 9M" if der else None))
           for k, v, pg, u, der in pl["parts"]]
    return pl["v"], ins


@question("Q-111", "מי צריכה לפרוע הכי הרבה חוב ב-12 החודשים הקרובים ביחס לרווח שלה?", ["cfo", "inv", "board"], "capital", MAIN)
def q111(A):
    cs = [c for c in MAIN if wall(c) and wall(c).get("cov") and wall(c)["end"] == wall("harel")["end"]]
    if len(cs) < 2:
        return nodata("אין קיר חוב עדכני לשתי קבוצות")
    end = wall(cs[0])["end"]

    def cov(c):
        return wall_y1(c)[0] / profit_ltm(c)[0]

    def cfig(c):
        y, iy = wall_y1(c)
        p, ip = profit_ltm(c)
        return F(f"פירעונות 12 חודשים ÷ רווח LTM, {he(c)}", cov(c), "x",
                 P_calc(f"כיסוי פירעונות · {he(c)} · {dl(end)}", fmt(cov(c), "x"), "×", "קרן וריבית בשנה הראשונה (ת126, כל חלקי הקיר) ÷ רווח נקי LTM לבעלי המניות",
                        [("קרן וריבית, שנה ראשונה", nf(y, 1), P_calc("קרן וריבית בשנה הראשונה · " + he(c), nf(y, 1), MM, "Σ חלקי הקיר", iy)),
                         ("רווח נקי LTM", nf(p, 1), P_calc("רווח נקי LTM · " + he(c), nf(p, 1), MM, "סכום ארבעה רבעונים", ip))]), dl(end), c=c)
    cs = sorted(cs, key=lambda c: -cov(c))
    hi, lo = cs[0], cs[-1]
    y, iy = wall_y1(hi)
    figs = {"hi": cfig(hi), "lo": cfig(lo),
            "y": F(f"קרן וריבית ב-12 החודשים הקרובים, {he(hi)}", y, "m", P_calc("קרן וריבית בשנה הראשונה · " + he(hi), nf(y, 1), MM, "Σ חלקי הקיר (ת126)", iy), dl(end), c=hi)}
    corr = f"{he(hi)}: הפירעונות בשנה הקרובה שווים {{hi}} הרווח השנתי שלה."
    email = (f"לפי דוח מצבת ההתחייבויות ליום {dl(end)}, {he(hi)} צריכה לשלם {{y}} קרן וריבית בשנה הקרובה, {{hi}} מהרווח הנקי LTM; "
             f"אצל {he(lo)} {{lo}}. הקיר כולל חברות בנות מאוחדות שאינן מדווחות, כפי שהדוח מציג אותן, ולכן גם חוב של זרועות אשראי, לא רק חוב ההון של הקבוצה.")
    ex = bars("קרן וריבית ב-12 החודשים הקרובים ÷ רווח נקי LTM", "×", [(c, cov(c)) for c in cs],
              [f"× הרווח השנתי; ת126 ליום {dl(end)}, אלפי ש\"ח בטופס", "MAYA טופס ת126 (מצבת התחייבויות), רווח: דוחות כספיים"], name="כיסוי")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_DEBT, link(f"מצבת החוב, {he(hi)}", f"/debt/{hi}")], rel=["Q-112", "Q-114"], asof=dl(end))


def mcos(c):
    return load("consolidation/matrix.json")["cos"].get(c)


@question("Q-112", "מה רמת המינוף של כל קבוצה: חוב מול הון עצמי?", ["cfo", "inv", "board"], "capital", MAIN + ["meitav", "altshuler", "more", "analyst"])
def q112(A):
    cs = [c for c in load("consolidation/matrix.json")["cos"] if (mcos(c).get("lev") or {}).get("v") is not None]
    if len(cs) < 2:
        return nodata("אין מינוף לשתי חברות")
    cs = sorted(cs, key=lambda c: -mcos(c)["lev"]["v"])
    hi, lo = cs[0], cs[-1]
    med = load("consolidation/matrix.json")["meta"]["assume"]["lev"]

    def lfig(c):
        return F(f"חוב ÷ (חוב + הון עצמי), {he(c)}", mcos(c)["lev"]["v"], "pct", cons_prov(mcos(c)["lev"]["prov"]), "Q2'26", c=c)
    figs = {"hi": lfig(hi), "lo": lfig(lo), "med": F("חציון המינוף במסך האיחודים", med["v"], "pct", cons_prov(med["prov"]), "Q2'26")}
    corr = f"{he(hi)} הממונפת ביותר: חוב של {{hi}} ממקורות המימון."
    email = (f"המינוף של {he(hi)} (קרן החוב בדוח מצבת ההתחייבויות ÷ חוב והון לבעלי המניות) הוא {{hi}}, מול חציון של {{med}} במסך; "
             f"הנמוך ביותר: {he(lo)}, {{lo}}. חוב לפי הטופס כולל חברות בנות מאוחדות שאינן מדווחות.")
    ex = bars("חוב ÷ (חוב + הון עצמי)", "%", [(c, mcos(c)["lev"]["v"]) for c in cs],
              ["%, Q2'26: קרן לפי ת126 והון לבעלי המניות", "A9 (consolidation/matrix.json): ת126, דוחות כספיים"], name="מינוף")
    chg = changes_if(f"{he(hi)} יורדת לחציון כשהמינוף שלה יורד מתחת ל-{{thr}}", "hi", "<", med["v"])
    return answer(figs, corr, email, ex, chg, f"hi:{hi}", links=[L_DEBT, link("מסך האיחודים", "/consolidation")], rel=["Q-111", "Q-113"], asof="Q2'26")


def pair_doc(a):
    for t in sorted(load("consolidation/matrix.json")["cos"]):
        if t != a:
            try:
                return load(f"consolidation/pairs/{a}__{t}.json")
            except FileNotFoundError:
                continue
    return None


@question("Q-113", "כמה חוב נוסף יכולה כל קבוצה לגייס עד המינוף המקובל בענף?", ["cfo", "strat", "board"], "capital", MAIN)
def q113(A):
    cs = [c for c in load("consolidation/matrix.json")["cos"] if pair_doc(c)]
    if len(cs) < 2:
        return nodata("אין חישוב מרווח חוב")

    def room(c):
        return pair_doc(c)["capacity"]["room"]["v"]

    def rfig(c):
        d = pair_doc(c)
        return F(f"מרווח חוב עד המינוף החציוני, {he(c)}", room(c), "m", cons_prov(d["capacity"]["room"]["prov"], d), "Q2'26", c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -room(c))
    hi = cs[0]
    zero = [c for c in cs if room(c) <= 0]
    figs = {"hi": rfig(hi), "lev": F("מינוף מרבי (הנחה: חציון הענף)", load("consolidation/matrix.json")["meta"]["assume"]["lev"]["v"], "pct",
                                     cons_prov(load("consolidation/matrix.json")["meta"]["assume"]["lev"]["prov"]), "Q2'26", b="estimate")}
    corr = f"ל{he(hi)} הכי הרבה מקום: {{hi}} חוב נוסף עד המינוף החציוני."
    email = (f"בהנחה שמינוף מרבי הוא החציון של הענף, {{lev}}, {he(hi)} יכולה לגייס עוד {{hi}}. ")
    if zero:
        email += f"{names_list(zero)} כבר מעל החציון, בלי מרווח חוב בהנחה הזו."
    ex = bars("מרווח חוב עד המינוף החציוני של הענף", MM, [(c, room(c)) for c in cs],
              ["מיליוני ש\"ח: max(0, L ÷ (1 − L) × הון − חוב), L = חציון הענף (הנחה)", "A9: consolidation/pairs (ת126, דוחות כספיים)"], name="מרווח חוב")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|zero:{len(zero)}", links=[link("מסך האיחודים", "/consolidation"), L_DEBT],
                  rel=["Q-112", "Q-153"], asof="Q2'26")


@question("Q-114", "האם מצבת ההתחייבויות (ת126) מתיישבת עם החוב במאזן?", ["inv", "cfo", "reg"], "capital", MAIN)
def q114(A):
    rows = {}
    for c in MAIN:
        try:
            d = load(f"debt/{c}.json")
        except FileNotFoundError:
            continue
        if d.get("bs"):
            rows[c] = d["bs"][0]
    if len(rows) < 2:
        return nodata("אין השוואת מאזן לשתי קבוצות")
    cs = sorted(rows, key=lambda c: -abs(rows[c]["gap_pct"]))
    hi, lo = cs[0], cs[-1]

    def gfig(c):
        b = rows[c]
        rep = P_rep(f"{' / '.join(b['labels'])} · {he(c)} · {dl(b['end'])}", nf(b["bs"] / 1000, 1), MM, b["url"], b["pg"], "דוח כספי", dl(b["end"]))
        form = P_calc(f"קרן לפי ת126 · {he(c)} · {dl(b['end'])}", nf(b["form"] / 1000, 1), MM, "Σ הקרן בקיר החוב (debt/<co>.json)",
                      [("קרן בטופס", nf(b["form"] / 1000, 1), cons_prov(mcos(c)["pnl"]["debt_total"]["prov"]) if mcos(c) and b["end"] == "2026-06-30" else None)])
        return F(f"פער בין המאזן לטופס ת126, {he(c)}", b["gap_pct"], "pct",
                 P_calc(f"פער מאזן מול ת126 · {he(c)}", f"{nf(b['gap_pct'], 1)}%", "%", "(יתרה במאזן − קרן בטופס) ÷ יתרה במאזן × 100",
                        [("יתרה במאזן", nf(b["bs"] / 1000, 1), rep), ("קרן בטופס", nf(b["form"] / 1000, 1), form)]), dl(b["end"]), c=c)
    figs = {"hi": gfig(hi), "lo": gfig(lo)}
    corr = f"לא תמיד: אצל {he(hi)} הפער בין המאזן לטופס הוא {{hi}}."
    email = (f"אצל {he(hi)} יתרת החוב במאזן גבוהה מהקרן בדוח מצבת ההתחייבויות ב-{{hi}}; אצל {he(lo)} הפער {{lo}}. "
             "הפער לא בהכרח טעות: הטופס הוא קרן חוזית לא מהוונת, המאזן בעלות מופחתת וכולל גם נגזרים, חכירות והתחייבויות פיננסיות אחרות.")
    ex = bars("פער בין יתרת החוב במאזן לקרן בטופס ת126", "%", [(c, rows[c]["gap_pct"]) for c in cs],
              ["% מהיתרה במאזן, תאריך המאזן האחרון", "MAYA טופס ת126 מול שורת ההלוואות / ההתחייבויות הפיננסיות במאזן"], name="פער")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_DEBT], rel=["Q-111", "Q-112"], asof=dl(rows[hi]["end"]))


# ------------------------------------------------------------------------------------------------ per company: room to distribute
def company_cap(c):
    x = capco(c)
    if not x:
        return nodata(f"אין חישוב A7 ל{he(c)}")
    k = binding(c)
    b = k["basis"]
    figs = {"dist": cap_fig(c, f"הון בר-חלוקה, {he(c)}", x["distributable"], "m", x["period"], b="estimate"),
            "head": cap_fig(c, f"עודף מעל {k['he']}, {he(c)}", k["headroom"], "m", x["period"]),
            "buf": F(f"מרווח ניהולי, {he(c)}", x["buffer"]["v"], "m", cap_prov(x, x["buffer"]["v_prov"]), x["period"], c=c, b="estimate"),
            "ratio": cap_fig(c, f"יחס כושר פירעון {BASIS[b]}, {he(c)}", x["bases"][b]["ratio"], "pct", x["period"]),
            "tgt": F(f"{k['he']}, {he(c)}", k["t"], "pct", cap_prov(x, k["t_prov"]), k["period"], c=c, b="target")}
    pos = x["distributable"]["v"] > 0
    if pos:
        corr = f"{he(c)} יכולה לחלק עד {{dist}} בלי לרדת מתחת ליעד המחייב והמרווח."
    else:
        corr = f"{he(c)} לא יכולה לחלק בבסיס המחייב: ההון בר-החלוקה {{dist}}."
    email = (f"האילוץ המחייב של {he(c)} הוא {k['he']}, {{tgt}}, מול יחס של {{ratio}}; העודף מעליו הוא {{head}}. "
             f"אחרי מרווח ניהולי של {{buf}} (הנחה: התנודה הרגילה של היחס), נשארים {{dist}} לחלוקה.")
    ltm = (x["dividend"].get("ltm") or {})
    if ltm.get("v") is not None:
        figs["div"] = cap_fig(c, f"דיבידנד שהוכרז LTM, {he(c)}", ltm, "m", "LTM Q2'26")
        email += " ב-LTM הוכרז דיבידנד של {div}."
    ex = exhibit(
        "cat", f"{he(c)}: מהעודף מעל היעד להון בר-חלוקה", MM,
        [kk["he"] for kk in x["constraints"]] + ["מרווח ניהולי", "הון בר-חלוקה"],
        [{"name": "מיליוני ש\"ח", "type": "bar", "data": [round(kk["headroom"]["v"], 1) for kk in x["constraints"]] + [round(-x["buffer"]["v"], 1), round(x["distributable"]["v"], 1)]}],
        [f"מיליוני ש\"ח, {x['period']}: הון עצמי − SCR × יעד, לכל אילוץ; המרווח הניהולי מנוכה מהמחייב", "A7: capital/options.json (דוחות כספיים, עמוד לכל קלט)"])
    chg = changes_if("התשובה מתהפכת כשההון בר-החלוקה חוצה את {thr}", "dist", "<=" if pos else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "pos" if pos else "neg", links=[L_CAP, co_link(c)], rel=["Q-102", "Q-103", "Q-108"], asof=x["period"])


for _i, _c in enumerate(MAIN):
    question(f"Q-{115 + _i}", f"כמה יכולה {he(_c)} לחלק מעל יעד כושר הפירעון המחייב?", ["cfo", "board", "inv"], "capital", [_c])(
        lambda A, _c=_c: company_cap(_c))


# ------------------------------------------------------------------------------------------------ capital generation, equity
@question("Q-120", "כמה נקודות יחס כושר פירעון מייצר רווח של שנה, ואחרי הדיבידנד?", ["cfo", "board", "inv"], "capital", INS)
def q120(A):
    cs = div_cos()
    if len(cs) < 2:
        return nodata("פחות משתי מבטחות עם רווח ודיבידנד LTM")

    def gen(c):
        x = capco(c)
        b = binding(c)["basis"]
        return (x["pnl"]["net_profit"]["v"] - x["dividend"]["ltm"]["v"]) / x["bases"][b]["scr"]["v"] * 100

    def gfig(c):
        x = capco(c)
        b = binding(c)["basis"]
        return F(f"רווח LTM פחות דיבידנד ÷ SCR, {he(c)}", gen(c), "pp",
                 P_calc(f"ייצור הון נטו · {he(c)}", fmt(gen(c), "pp"), "נ״א", "(רווח נקי LTM − דיבידנד LTM) ÷ SCR בבסיס המחייב × 100 (קירוב: רווח חשבונאי במקום שינוי בהון העצמי הכלכלי)",
                        [("רווח נקי LTM", fmt(x["pnl"]["net_profit"]["v"], "m"), cap_prov(x, x["pnl"]["net_profit"]["prov"])),
                         ("דיבידנד LTM", fmt(x["dividend"]["ltm"]["v"], "m"), cap_prov(x, x["dividend"]["ltm"]["prov"])),
                         (f"SCR, {BASIS[b]}", fmt(x["bases"][b]["scr"]["v"], "m"), cap_prov(x, x["bases"][b]["scr"]["prov"]))], est=True,
                        note="קירוב: הרווח החשבונאי אינו השינוי בהון העצמי הכלכלי (Solvency II), וה-SCR מוחזק קבוע"),
                 "LTM Q2'26", c=c, b="estimate")
    cs = sorted(cs, key=lambda c: -gen(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": gfig(hi), "lo": gfig(lo)}
    corr = f"הכי הרבה אצל {he(hi)}: אחרי הדיבידנד, הרווח של שנה מוסיף כ-{{hi}} ליחס."
    email = (f"בקירוב (רווח חשבונאי במקום שינוי בהון הכלכלי, SCR קבוע), הרווח של {he(hi)} ב-LTM פחות הדיבידנד שהוכרז שווה {{hi}} של SCR; "
             f"אצל {he(lo)} {{lo}}. זה הקצב שבו כל מבטחת בונה מרווח מעל היעד מהפעילות עצמה.")
    ex = bars("רווח LTM פחות דיבידנד, בנקודות SCR", "נ״א", [(c, gen(c)) for c in cs],
              ["נקודות אחוז של SCR בבסיס המחייב; קירוב, לא חישוב Solvency II", "A7: capital/options.json"], name="ייצור הון נטו")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_CAP], rel=["Q-107", "Q-108"], asof="LTM Q2'26")


@question("Q-121", "מי מגדילה את ההון העצמי הכי מהר?", ["inv", "board", "ceo"], "capital", INS)
def q121(A):
    def g(c):
        a, b = capser(c, "equity_attributable", "2026Q2"), capser(c, "equity_attributable", "2025Q2")
        if not a or not b or a.get("std") != b.get("std"):
            return None
        return a["v"] / b["v"] * 100 - 100
    cs = [c for c in INS if g(c) is not None]
    if len(cs) < 2:
        return nodata("אין הון לבעלי המניות ל-Q2'25 ו-Q2'26 באותו תקן")

    def gfig(c):
        a, b = capser(c, "equity_attributable", "2026Q2"), capser(c, "equity_attributable", "2025Q2")
        return F(f"צמיחת ההון לבעלי המניות YoY, {he(c)}", g(c), "pct",
                 P_calc(f"צמיחת ההון YoY · {he(c)} · Q2'26", fmt(g(c), "pct", signed=True), "%", "הון Q2'26 ÷ הון Q2'25 − 1",
                        [("הון Q2'26", nf(a["v"], 1), P_rep(f"הון לבעלי המניות · {he(c)} · Q2'26", nf(a["v"], 1), MM, a["u"], a["pg"], "דוח כספי", "Q2'26")),
                         ("הון Q2'25", nf(b["v"], 1), P_rep(f"הון לבעלי המניות · {he(c)} · Q2'25", nf(b["v"], 1), MM, b["u"], b["pg"], "דוח כספי", "Q2'25"))]),
                 "Q2'26", c=c, signed=True)
    cs = sorted(cs, key=lambda c: -g(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": gfig(hi), "lo": gfig(lo)}
    corr = f"{he(hi)}: ההון לבעלי המניות שלה צמח {{hi}} בשנה."
    email = (f"מ-Q2'25 עד Q2'26 ההון לבעלי המניות של {he(hi)} צמח {{hi}}; הצמיחה האיטית ביותר אצל {he(lo)}, {{lo}}. "
             "צמיחת הון היא רווח פחות חלוקה (ועוד גיוסי הון, אם היו), לכן מי שמחלקת יותר צומחת לאט יותר בהון גם ברווחיות זהה.")
    ex = bars("צמיחת ההון לבעלי המניות, Q2'26 מול Q2'25", "%", [(c, g(c)) for c in cs],
              ["%, הון לבעלי המניות כפי שהודפס", "csm/capital.json (דוחות כספיים, עמוד לכל תקופה)"], name="צמיחת הון")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_CAP], rel=["Q-152", "Q-107"], asof="Q2'26")


# ------------------------------------------------------------------------------------------------ CSM
def csm_parts(c, prior=False):
    """gross life + health CSM at year end and the year's release (A10 CSM runway inputs); prior=True: FY'24"""
    s = frag(c, "csm")
    if not s:
        return None
    node = s["prov"]
    if prior:
        node = next((i["p"] for i in s.get("provT", {}).get("inputs", []) if i["label"] == "FY'24"), None)
        if not node:
            return None
    bal = [(i["label"], num(i["v"]), i["p"]) for i in node["inputs"] if i["label"].startswith("CSM")]
    rel = [(i["label"], num(i["v"]), i["p"]) for i in node["inputs"] if i["label"].startswith("שחרור")]
    return bal, rel


def csm_bal(c, prior=False):
    p = csm_parts(c, prior)
    return None if not p else fsum(v for _, v, _ in p[0])


@question("Q-122", "של מי ה-CSM צמח הכי מהר ב-FY'25?", ["inv", "ceo", "board"], "capital", INS)
def q122(A):
    def g(c):
        a, b = csm_bal(c), csm_bal(c, True)
        if not a or not b:
            return None
        pa, pb = csm_parts(c), csm_parts(c, True)
        if len(pa[0]) != len(pb[0]):
            return None
        return a / b * 100 - 100
    cs = [c for c in INS if g(c) is not None]
    if len(cs) < 2:
        return nodata("אין CSM ברוטו לשתי שנים לשתי מבטחות")

    def gfig(c):
        pa, pb = csm_parts(c), csm_parts(c, True)
        return F(f"צמיחת CSM ברוטו (חיים ובריאות), {he(c)}", g(c), "pct",
                 P_calc(f"צמיחת CSM · {he(c)} · FY'25", fmt(g(c), "pct", signed=True), "%", "CSM ברוטו (חיים + בריאות) 31.12.25 ÷ 31.12.24 − 1",
                        [(lab, nf(v, 1), p) for lab, v, p in pa[0]] + [(lab, nf(v, 1), p) for lab, v, p in pb[0]]), "FY'25", c=c, signed=True)
    cs = sorted(cs, key=lambda c: -g(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": gfig(hi), "lo": gfig(lo)}
    corr = f"{he(hi)}: ה-CSM ברוטו שלה צמח {{hi}} ב-FY'25."
    email = (f"ה-CSM ברוטו בחיים ובבריאות (הרווח העתידי שעוד לא הוכר) של {he(hi)} צמח ב-FY'25 ב-{{hi}}; אצל {he(lo)} {{lo}}. "
             "ה-CSM גדל מעסקים חדשים ומריבית, ונשחק בשחרור לרווח ובשינויי הנחות.")
    ex = bars("צמיחת CSM ברוטו, חיים ובריאות, FY'25", "%", [(c, g(c)) for c in cs],
              ["%, יתרה לסוף FY'25 מול סוף FY'24 (הכשרה: חיים בלבד)", "דוח כספי FY'25, באור תנועה ב-CSM (מוניטור השבירות, A10)"], name="צמיחת CSM")
    return answer(figs, corr, email, ex, None, f"hi:{hi}|lo:{lo}", links=[L_CSM, L_FRAG], rel=["Q-123", "Q-189"], asof="FY'25")


@question("Q-123", "למי אורך חיי ה-CSM הקצר ביותר?", ["inv", "board", "cfo"], "capital", INS)
def q123(A):
    cs = [c for c in INS if (frag(c, "csm") or {}).get("x")]
    if len(cs) < 2:
        return nodata("אין אורך חיי CSM לשתי מבטחות")
    cs = sorted(cs, key=lambda c: frag(c, "csm")["x"]["y"])
    lo, hi = cs[0], cs[-1]

    def yfig(c):
        s = frag(c, "csm")
        return F(f"אורך חיי CSM, {he(c)}", s["x"]["y"], "yrs", s["prov"], s["asof"], c=c)

    def dfig(c):
        s = frag(c, "csm")
        return F(f"שינוי באורך החיים YoY, {he(c)}", s["x"]["d"], "yrs", s["provT"], s["asof"], c=c, signed=True)
    figs = {"lo": yfig(lo), "hi": yfig(hi), "dlo": dfig(lo)}
    corr = f"{he(lo)}: ה-CSM שלה מספיק ל-{{lo}} של שחרור בקצב הנוכחי."
    email = (f"היתרה של {he(lo)} (CSM ברוטו, חיים ובריאות) מחולקת בשחרור השנתי נותנת {{lo}}, שינוי של {{dlo}} בשנה; "
             f"הארוך ביותר: {he(hi)}, {{hi}}. אורך חיים קצר פירושו שהרווח העתידי מהספר הקיים נגמר מהר יותר אם העסקים החדשים לא מחליפים אותו.")
    ex = bars("אורך חיי CSM: יתרה ÷ שחרור שנתי", "שנים", [(c, frag(c, "csm")["x"]["y"]) for c in cs],
              ["שנים, FY'25: CSM ברוטו לסוף השנה ÷ שחרור ברוטו בשנה", "דוח כספי FY'25, באור תנועה ב-CSM (A10)"], name="אורך חיים")
    return answer(figs, corr, email, ex, None, f"lo:{lo}", links=[L_CSM, L_FRAG], rel=["Q-122", "Q-186"], asof="FY'25")


# ------------------------------------------------------------------------------------------------ IFRS 17 sensitivities
def sens(c, risk, dirn, eff, bases=("gross",)):
    for b in bases:
        for r in load("csm/sens.json")["rows"]:
            if r["c"] == c and r["risk"] == risk and r["dir"] == dirn and r["eff"] == eff and r["b"] == b and r["rp"] == "2025FY":
                return r
    return None


def sens_prov(r, c, title):
    return P_rep(f"{title} · {he(c)} · FY'25", nf(r["v"], 1), MM, r["u"], r["pg"], "דוח כספי FY'25 · באור רגישויות", "FY'25", note=r["l"][:120])


@question("Q-124", "מי הכי חשופה לעלייה בתחלואה?", ["cfo", "board", "inv", "reg"], "capital", INS)
def q124(A):
    def sh(c):
        """the loss as a positive share of the CSM"""
        r, b = sens(c, "morbidity", 1, "csm"), csm_bal(c)
        return None if not r or not b else -r["v"] / b * 100
    cs = [c for c in INS if sh(c) is not None]
    if len(cs) < 2:
        return nodata("אין רגישות תחלואה לשתי מבטחות")

    def sfig(c):
        r = sens(c, "morbidity", 1, "csm")
        bal = csm_parts(c)[0]
        return F(f"פגיעה ב-CSM מעלייה של 5% בתחלואה, {he(c)}", sh(c), "pct",
                 P_calc(f"רגישות תחלואה ÷ CSM · {he(c)}", fmt(sh(c), "pct"), "%", "− השפעה על ה-CSM ברוטו מעלייה של 5% בשיעורי התחלואה ÷ CSM ברוטו (חיים + בריאות) × 100 (הפגיעה כמספר חיובי)",
                        [("השפעה על ה-CSM", nf(r["v"], 1), sens_prov(r, c, "רגישות CSM לתחלואה"))] + [(lab, nf(v, 1), p) for lab, v, p in bal]),
                 "FY'25", c=c)
    cs = sorted(cs, key=lambda c: -sh(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": sfig(hi), "lo": sfig(lo),
            "nis": F(f"השפעה על ה-CSM ברוטו, {he(hi)}", sens(hi, "morbidity", 1, "csm")["v"], "m", sens_prov(sens(hi, "morbidity", 1, "csm"), hi, "רגישות CSM לתחלואה"), "FY'25", c=hi)}
    corr = f"{he(hi)}: עלייה של חמישה אחוזים בתחלואה מוחקת {{hi}} מה-CSM שלה."
    email = (f"לפי באור הרגישויות ב-FY'25, עלייה של חמישה אחוזים בשיעורי התחלואה משנה את ה-CSM ברוטו של {he(hi)} ב-{{nis}}, פגיעה של {{hi}} מהיתרה; "
             f"אצל {he(lo)} {{lo}}. הפגיעה נספגת קודם ב-CSM ורק אחר כך ברווח.")
    ex = bars("פגיעה ב-CSM ברוטו מעלייה של 5% בתחלואה", "% מה-CSM", [(c, sh(c)) for c in cs],
              ["% מ-CSM ברוטו (חיים + בריאות), FY'25", "דוחות כספיים FY'25, באור רגישויות (csm/sens.json)"], name="רגישות תחלואה")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_CSM], rel=["Q-125", "Q-106"], asof="FY'25")


@question("Q-125", "מי הכי חשופה לירידה של עשרה אחוזים בשוק המניות?", ["cfo", "board", "inv"], "capital", INS)
def q125(A):
    def r_(c):
        return sens(c, "equity", -1, "profit", ("net", "na", "gross"))

    def sh(c):
        """the loss as a positive share of LTM profit"""
        r, x = r_(c), capco(c)
        return None if not r or not x else -r["v"] / x["pnl"]["net_profit"]["v"] * 100
    cs = [c for c in INS if sh(c) is not None]
    if len(cs) < 2:
        return nodata("אין רגישות מניות לשתי מבטחות")

    def sfig(c):
        r, x = r_(c), capco(c)
        return F(f"פגיעה ברווח מירידה של 10% במניות ÷ רווח LTM, {he(c)}", sh(c), "pct",
                 P_calc(f"רגישות מניות ÷ רווח · {he(c)}", fmt(sh(c), "pct"), "%", "− השפעה על הרווח אחרי מס מירידה של 10% במניות (FY'25) ÷ רווח נקי LTM × 100 (הפגיעה כמספר חיובי)",
                        [("השפעה על הרווח", nf(r["v"], 1), sens_prov(r, c, "רגישות רווח למניות")),
                         ("רווח נקי LTM", fmt(x["pnl"]["net_profit"]["v"], "m"), cap_prov(x, x["pnl"]["net_profit"]["prov"]))]), "FY'25", c=c)
    cs = sorted(cs, key=lambda c: -sh(c))
    hi, lo = cs[0], cs[-1]
    figs = {"hi": sfig(hi), "lo": sfig(lo), "nis": F(f"השפעה על הרווח אחרי מס, {he(hi)}", r_(hi)["v"], "m", sens_prov(r_(hi), hi, "רגישות רווח למניות"), "FY'25", c=hi)}
    corr = f"{he(hi)}: ירידה של עשרה אחוזים במניות מוחקת {{hi}} מהרווח השנתי."
    email = (f"לפי באור הרגישויות ב-FY'25, ירידה של עשרה אחוזים במחירי המניות משנה את הרווח אחרי מס של {he(hi)} ב-{{nis}}, פגיעה של {{hi}} מהרווח הנקי LTM; "
             f"אצל {he(lo)} {{lo}}. זו רגישות הנוסטרו והדמי ניהול המשתנים יחד, כפי שהחברה מדווחת אותה.")
    ex = bars("פגיעה ברווח מירידה של 10% במניות, כשיעור מהרווח", "%", [(c, sh(c)) for c in cs],
              ["% מרווח נקי LTM Q2'26; הרגישות ליום 31.12.25", "דוחות כספיים FY'25, באור רגישויות; רווח: A7"], name="רגישות מניות")
    return answer(figs, corr, email, ex, None, f"hi:{hi}", links=[L_CSM, L_SCEN], rel=["Q-124", "Q-126", "Q-188"], asof="FY'25")


@question("Q-126", "מי מרוויחה ומי מפסידה מירידת ריבית?", ["cfo", "inv", "board"], "capital", INS)
def q126(A):
    def r_(c):
        return sens(c, "rate", -1, "profit", ("net", "na", "gross"))
    cs = [c for c in INS if r_(c)]
    if len(cs) < 2:
        return nodata("אין רגישות ריבית לשתי מבטחות")
    cs = sorted(cs, key=lambda c: r_(c)["v"])
    lo, hi = cs[0], cs[-1]

    def rfig(c):
        return F(f"השפעה על הרווח אחרי מס מירידה של חצי נקודת אחוז בריבית, {he(c)}", r_(c)["v"], "m", sens_prov(r_(c), c, "רגישות רווח לריבית"), "FY'25", c=c, signed=True)
    figs = {"hi": rfig(hi), "lo": rfig(lo)}
    losers = [c for c in cs if r_(c)["v"] < 0]
    if losers:
        corr = f"רוב המבטחות מרוויחות; {names_list(losers)} מפסידה, {{lo}}."
        vk = "losers:" + ",".join(losers)
    else:
        corr = f"כולן מרוויחות מירידת ריבית; הכי הרבה {he(hi)}, {{hi}}."
        vk = "none-lose"
    email = (f"לפי באור הרגישויות ב-FY'25, ירידה של חצי נקודת אחוז בריבית חסרת הסיכון מוסיפה לרווח של {he(hi)} {{hi}}; בקצה השני {he(lo)}, {{lo}}. "
             "הכיוון תלוי בפער המח״מ בין הנכסים להתחייבויות שאינן תלויות תשואה.")
    ex = bars("השפעה על הרווח אחרי מס מירידה של 0.5 נק׳ בריבית", MM, [(c, r_(c)["v"]) for c in cs],
              ["מיליוני ש\"ח, ליום 31.12.25", "דוחות כספיים FY'25, באור רגישויות (csm/sens.json)"], name="רגישות ריבית")
    return answer(figs, corr, email, ex, None, vk, links=[L_CSM, L_SCEN], rel=["Q-125"], asof="FY'25")


@question("Q-127", "כמה הון עודף מעל היעדים המחייבים מחזיק הענף כולו?", ["reg", "inv", "board"], "capital", INS)
def q127(A):
    cs = ok_caps()
    if not cs:
        return nodata("אין חישוב A7")
    tot = fsum(binding(c)["headroom"]["v"] for c in cs)
    big = max(cs, key=lambda c: binding(c)["headroom"]["v"])
    sh = binding(big)["headroom"]["v"] / tot * 100 if tot > 0 else None
    figs = {"tot": F("עודף מעל האילוץ המחייב, סך המבטחות", tot, "m",
                     P_calc("עודף מעל האילוץ המחייב · סך המבטחות", fmt(tot, "m"), MM, "Σ (הון עצמי − SCR × יעד מחייב) של המבטחות, כולל שליליים",
                            [(he(c), fmt(binding(c)["headroom"]["v"], "m", 0, True), cap_prov(capco(c), binding(c)["headroom"]["prov"])) for c in cs]),
                     capco(big)["period"]),
            "big": cap_fig(big, f"עודף מעל האילוץ המחייב, {he(big)}", binding(big)["headroom"], "m", capco(big)["period"])}
    corr = "סך העודף של המבטחות מעל היעדים המחייבים הוא {tot}."
    email = (f"מעל האילוץ המחייב של כל אחת, המבטחות מחזיקות יחד {{tot}} (כולל חוסר, אם יש). החלק הגדול ביותר אצל {he(big)}, {{big}}.")
    if sh is not None:
        figs["sh"] = F(f"חלקה של {he(big)} בעודף", sh, "pct", P_calc(f"חלק בעודף · {he(big)}", fmt(sh, "pct"), "%", "עודף החברה ÷ עודף הענף × 100",
                                                                 [(he(big), fmt(binding(big)["headroom"]["v"], "m"), cap_prov(capco(big), binding(big)["headroom"]["prov"]))]), capco(big)["period"], c=big)
        email += " זה {sh} מהעודף של הענף."
    ex = bars("עודף הון מעל האילוץ המחייב", MM, sorted([(c, binding(c)["headroom"]["v"]) for c in cs], key=lambda t: -t[1]),
              [f"מיליוני ש\"ח, {capco(big)['period']}", "A7: capital/options.json"], name="עודף")
    return answer(figs, corr, email, ex, None, f"big:{big}", links=[L_CAP], rel=["Q-102", "Q-101"], asof=capco(big)["period"])
