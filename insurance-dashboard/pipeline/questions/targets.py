"""Targets: management targets and delivery (say-do), revisions, what is still ahead, and restated figures (Q-130..Q-149).

Sources: targets.json (207 targets as printed, with document and page; `act` = the reported actual in the target's own definition where
the site carries it, `prog` = the latest reported year beside a target that is not due yet), restatements.json (first print vs latest
print of every cell). Targets carry basis "target"; a reported outcome "actual"; an answer that sets them side by side is labelled `mix`.
"""
from answer_core import P_calc, P_rep, changes_if, fmt, he, link, load, nf, nodata, question
from questions._grp import answer, MAYA, MM, MAIN, F, bars, names_list, ql, table

L_CRED = link("יעדים ועמידה בהם", "/credibility")
L_REST = link("יומן הדיווחים מחדש", "/restatements")
UNIT = {"pct": "%", "m": MM}


def T():
    return load("targets.json")


def rows():
    return T()["rows"]


def hz(r):
    return f"FY'{str(r['h'])[2:]}" if r.get("h") else "מדיניות"


def goal(r):
    """the level a target asks for (the low end of a range: the first point at which it is reached)"""
    return r["lo"] if r.get("lo") is not None else r["v"] if r.get("v") is not None else r.get("hi")


def ttext(r):
    u = r["u"]
    if r.get("lo") is not None and r.get("hi") is not None:
        a, b = fmt(r["lo"], u, 0 if u == "m" else 1), fmt(r["hi"], u, 0 if u == "m" else 1)
        return f"{a}–{b}"
    if r.get("lo") is not None:
        return "לפחות " + fmt(r["lo"], u, 0 if u == "m" else 1)
    if r.get("hi") is not None:
        return "עד " + fmt(r["hi"], u, 0 if u == "m" else 1)
    return fmt(r["v"], u, 0 if u == "m" else 1)


def doc_url(doc):
    d = T()["docs"].get(str(doc))
    return (MAYA + d[4]) if d else None, (ql(d[2]) if d else None), d


def tprov(r):
    url, per, d = doc_url(r["doc"])
    kind = "מצגת משקיעים" if (d and d[1] == "presentation") else "דוח כספי"
    return P_rep(f"{r['l']} · {he(r['c'])} · {r['e']} · {hz(r)}", ttext(r), UNIT.get(r["u"], r["u"]), url, r["pg"], kind, per or hz(r),
                 note=(r.get("q") or r.get("nt") or "")[:160] or None)


def tfig(r, label=None):
    return F(label or f"{r['l']}, {he(r['c'])} ({r['e']}), {hz(r)}", goal(r), r["u"], tprov(r), hz(r), c=r["c"], b="target", t=ttext(r))


def aprov(r):
    a = r["act"]
    nodes = [(lab, nf(v, 1), P_rep(f"{lab} · {he(r['c'])} · {per}", nf(v, 1), "", url, pg, "דוח כספי / מצגת", per, note="Q4 נגזר" if der else None))
             for lab, v, url, pg, per, der in a["in"]]
    if len(nodes) == 1 and a["f"].startswith(("כפי שהודפס", "רווח ליבה", "תשואה להון מפעילות", "הון לבעלי המניות", "יחס כושר פירעון של חברת הביטוח, ללא", "יחס כושר פירעון של חברת הביטוח, עם")):
        p = nodes[0][2]
        p["title"] = f"{r['l'].replace('יעד ', '')} בפועל · {he(r['c'])} · FY'{str(a['y'])[2:]}"
        return p
    return P_calc(f"{r['l'].replace('יעד ', '')} בפועל · {he(r['c'])} · FY'{str(a['y'])[2:]}", fmt(a["v"], r["u"]), UNIT.get(r["u"], r["u"]), a["f"], nodes)


def afig(r, label=None):
    a = r["act"]
    return F(label or f"בפועל FY'{str(a['y'])[2:]}, {he(r['c'])} ({r['l'].replace('יעד ', '')})", a["v"], r["u"], aprov(r), f"FY'{str(a['y'])[2:]}", c=r["c"])


def ifrs4(r):
    return "IFRS 4" in (r.get("nt") or "")


def strat_open():
    """open strategy targets (profit, income, ROE, equity) with the latest reported year beside them, in the same definition"""
    return [r for r in rows() if r["st"] == "open" and r["t"] == "strategy" and r.get("act") and r["u"] in ("pct", "m") and goal(r) is not None]


def cagr(r):
    a = r["act"]
    n = r["h"] - a["y"]
    if r["u"] != "m" or n <= 0 or a["v"] <= 0:
        return None
    return ((goal(r) / a["v"]) ** (1 / n) - 1) * 100


def row_line(r):
    a = r.get("act") or {}
    return [he(r["c"]), r["l"], r["e"], hz(r), ttext(r), fmt(a.get("v"), r["u"]) if a else "–", {"met": "הושג", "partial": "הושג חלקית", "missed": "לא הושג",
                                                                                                  "open": "פתוח", "nc": "לא נמדד", "policy": "מדיניות"}[r["st"]]]


HEAD = ["חברה", "יעד", "ישות", "מועד", "יעד כפי שפורסם", "בפועל", "סטטוס"]


@question("Q-130", "מי עמדה ביעדים שהציבה לעצמה?", ["board", "inv", "ceo"], "targets", ["phoenix", "menora"])
def q130(A):
    R = rows()
    sc = [r for r in R if r["st"] in ("met", "partial", "missed")]
    if not sc:
        return nodata("אף יעד שמועדו עבר לא נמדד מול תוצאה באותה הגדרה")
    met = [r for r in sc if r["st"] in ("met", "partial")]
    hit = len(met) / len(sc) * 100
    nc = [r for r in R if r["st"] == "nc"]
    by = {}
    for r in sc:
        by.setdefault(r["c"], []).append(r)
    figs = {"n": F("יעדים שמועדם עבר ונמדדו מול תוצאה", len(sc), "n",
                   P_calc("יעדים שנמדדו", str(len(sc)), "יעדים", "ספירת היעדים ב-targets.json שמועדם עבר והתוצאה באותה הגדרה דווחה",
                          [(f"{he(r['c'])} · {r['l']} · {hz(r)}", fmt(r["act"]["v"], r["u"]), aprov(r)) for r in sc]), "FY'25", t=f"{len(sc)} מתוך {len(R)}"),
            "hit": F("שיעור העמידה ביעדים שנמדדו", hit, "pct",
                     P_calc("שיעור עמידה", fmt(hit, "pct"), "%", "(הושג + הושג חלקית) ÷ נמדדו × 100; חלקית = בתוך טווח, מתחת לקצה העליון",
                            [(f"{he(r['c'])} · {r['l']} · {hz(r)}", {"met": "הושג", "partial": "חלקית", "missed": "לא"}[r["st"]], tprov(r)) for r in sc]), "FY'25"),
            "nc": F("יעדים שמועדם עבר ולא ניתן למדוד", len(nc), "n",
                    P_calc("יעדים שלא נמדדו", str(len(nc)), "יעדים", "ספירת היעדים שמועדם עבר והתוצאה באותה הגדרה לא דווחה או לא נקלטה (targets.json st = nc)",
                           [(f"{he(r['c'])} · {r['l']} · {hz(r)}", r.get("why") or "–", tprov(r)) for r in nc]), "FY'25")}
    best = max(by, key=lambda c: len(by[c]))
    corr = "מה שנמדד הושג, אבל נמדד מעט: {n} יעדים."
    email = (f"מהיעדים שפורסמו, {{n}} כבר הגיעו למועדם ונמדדו מול תוצאה באותה הגדרה, ושיעור העמידה בהם {{hit}} (רובם של {he(best)}). "
             "עוד {nc} לא ניתנים למדידה: יעד למגזר או לחברה בת שהתוצאה שלהם לא מדווחת, הגדרה של החברה (רווח מתואם), או יעד רבעוני.")
    ex = table("יעדים שמועדם עבר ונמדדו מול תוצאה", HEAD, [row_line(r) for r in sorted(sc, key=lambda r: (r["c"], r["h"] or 0))],
               ["יעד כפי שהודפס, עם מסמך ועמוד; התוצאה באותה הגדרה ולאותה שנה", "targets.json: דוחות כספיים ומצגות משקיעים, MAYA"])
    chg = changes_if("התשובה משתנה כששיעור העמידה יורד מתחת ל-{thr}", "hit", "<", 50.0)
    return answer(figs, corr, email, ex, chg, f"n:{len(sc)}|hit:{round(hit)}", links=[L_CRED], rel=["Q-131", "Q-132"], asof="FY'25")


@question("Q-131", "אילו יעדים כבר נעקפו בתוצאות, לפני מועדם?", ["board", "inv", "ceo", "strat"], "targets", MAIN)
def q131(A):
    xs = [r for r in strat_open() if r["act"]["v"] >= goal(r)]
    basis_break = [r for r in xs if ifrs4(r)]
    xs = [r for r in xs if not ifrs4(r)]
    if not xs:
        return nodata("אין יעד פתוח שהתוצאה האחרונה כבר עוקפת")
    over = max(xs, key=lambda r: r["act"]["v"] / goal(r))
    cos = sorted({r["c"] for r in xs})
    figs = {"n": F("יעדים פתוחים שהתוצאה של FY'25 כבר עוקפת", len(xs), "n",
                   P_calc("יעדים שנעקפו מוקדם", str(len(xs)), "יעדים", "יעד פתוח (מועד אחרי FY'25) שהתוצאה של FY'25, באותה הגדרה, כבר ברמה שלו או מעליה",
                          [(f"{he(r['c'])} · {r['l']} · {hz(r)}", f"{fmt(r['act']['v'], r['u'])} מול {ttext(r)}", aprov(r)) for r in xs]), "FY'25"),
            "act": afig(over), "tgt": tfig(over)}
    corr = f"{{n}} יעדים פתוחים, של {names_list(cos)}, כבר נעקפו בתוצאות FY'25."
    email = (f"{{n}} יעדים שמועדם FY'26 ואילך כבר הושגו ברמה של FY'25. הבולט: {he(over['c'])}, {over['l']} ל-{hz(over)}: יעד של {{tgt}}, ובפועל ב-FY'25 {{act}}. "
             "שנה אחת אינה עמידה ביעד, וחלק מהעקיפה נשען על תשואה חריגה בשוק המניות (Q-188); מצד שני, יעד שכבר נעקף אינו מדריך את התחזית.")
    if basis_break:
        email += " לא נספרו יעדים שנוסחו בתקן החשבונאי הקודם, שאי אפשר להשוות לתוצאה בתקן החדש."
    ex = table("יעדים פתוחים שהתוצאה של FY'25 כבר עוקפת", HEAD, [row_line(r) for r in sorted(xs, key=lambda r: (r["c"], r["h"]))],
               ["בפועל = FY'25 באותה הגדרה (רווח, רווח כולל, ROE, הון); יעד = הקצה התחתון של הטווח", "targets.json (מסמך ועמוד לכל יעד), דוחות כספיים FY'25"])
    return answer(figs, corr, email, ex, None, f"n:{len(xs)}", links=[L_CRED], rel=["Q-130", "Q-132", "Q-190"], asof="FY'25")


@question("Q-132", "אילו יעדי רווח עדיין רחוקים, וכמה צמיחה בשנה הם דורשים?", ["board", "inv", "ceo", "strat"], "targets", MAIN)
def q132(A):
    xs = [r for r in strat_open() if r["act"]["v"] < goal(r) and cagr(r) is not None and not ifrs4(r)]
    if not xs:
        return nodata("אין יעד רווח פתוח שעדיין מעל התוצאה האחרונה")
    xs = sorted(xs, key=lambda r: -cagr(r))
    top, low = xs[0], xs[-1]

    def gfig(r):
        a = r["act"]
        return F(f"צמיחה שנתית נדרשת ליעד, {he(r['c'])} ({r['l']}, {hz(r)})", cagr(r), "pct",
                 P_calc(f"צמיחה נדרשת · {he(r['c'])} · {r['l']} · {hz(r)}", fmt(cagr(r), "pct"), "% לשנה",
                        f"(יעד ÷ בפועל FY'{str(a['y'])[2:]})^(1 ÷ {r['h'] - a['y']}) − 1; יעד = הקצה התחתון",
                        [("יעד", ttext(r), tprov(r)), (f"בפועל FY'{str(a['y'])[2:]}", fmt(a["v"], r["u"]), aprov(r))]), hz(r), c=r["c"], b="target")
    figs = {"top": gfig(top), "tgt": tfig(top), "act": afig(top)}
    corr = f"היעד התובעני ביותר: {he(top['c'])}, {top['l']} ל-{hz(top)}, דורש צמיחה של {{top}} בשנה."
    email = (f"כדי להגיע ל{top['l']} של {{tgt}} ב-{hz(top)}, {he(top['c'])} צריכה לצמוח {{top}} בשנה מרמת FY'25 של {{act}}. ")
    if len(xs) > 1:
        figs["low"] = gfig(low)
        email += f"הקל ביותר ברשימה: {he(low['c'])}, {low['l']} ל-{hz(low)}, {{low}} בשנה."
    ex = bars("צמיחה שנתית נדרשת מ-FY'25 ליעד", "% לשנה", [(r["c"], cagr(r)) for r in xs],
              ["% לשנה, מהתוצאה של FY'25 לקצה התחתון של היעד; הגדרת החברה נשמרת (רווח ליבה, רווח כולל)", "targets.json, דוחות כספיים FY'25"], name="צמיחה נדרשת")
    ex["cats"] = [f"{he(r['c'])} · {r['l']} · {hz(r)}" for r in xs]
    chg = changes_if("התשובה משתנה כשהצמיחה הנדרשת יורדת מתחת ל-{thr}", "top", "<", cagr(xs[1]) if len(xs) > 1 else 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{top['c']}:{top['m']}:{top['h']}", links=[L_CRED], rel=["Q-131", "Q-136", "Q-137"], asof="FY'25")


def hist_mid(h):
    """a revision record -> (date or period, level): [date, v, lo, hi, doc, pg] or [period, v, doc, pg]"""
    if len(h) >= 6:
        v, lo, hi = h[1], h[2], h[3]
        lev = v if v is not None else (lo + hi) / 2 if lo is not None and hi is not None else lo if lo is not None else hi
        return h[0], lev, h[4], h[5]
    return h[0], h[1], h[2], h[3]


def revised(r):
    """a revision only when the first and the last print come from two documents (two values on one page are two targets, not a revision)"""
    return hist_mid(r["hist"][0])[2] != hist_mid(r["hist"][-1])[2]


def hprov(r, h):
    d, lev, doc, pg = hist_mid(h)
    url, per, _ = doc_url(doc)
    return P_rep(f"{r['l']} · {he(r['c'])} · נוסח {d}", fmt(lev, r["u"]), UNIT.get(r["u"], r["u"]), url, pg, "מצגת / דוח החברה", per or d)


@question("Q-133", "מי עדכנה את היעדים שלה בדרך, ולאיזה כיוון?", ["board", "inv", "strat"], "targets", MAIN + ["more"])
def q133(A):
    xs = []
    for r in rows():
        if r.get("rev") and r.get("hist") and r["u"] in ("pct", "m") and revised(r):
            a, b = hist_mid(r["hist"][0]), hist_mid(r["hist"][-1])
            if a[1] is None or b[1] is None:
                continue
            xs.append((r, a[1], b[1]))
    if not xs:
        return nodata("אין יעד שעודכן")
    up = [x for x in xs if x[2] > x[1]]
    dn = [x for x in xs if x[2] < x[1]]
    by = {}
    for r, a, b in up:
        by[r["c"]] = by.get(r["c"], 0) + 1
    lead = max(by, key=lambda c: (by[c], c)) if by else None
    figs = {"up": F("עדכוני יעד כלפי מעלה", len(up), "n",
                    P_calc("עדכוני יעד כלפי מעלה", str(len(up)), "יעדים", "יעד שהנוסח האחרון שלו גבוה מהראשון (אמצע הטווח כשהודפס טווח)",
                           [(f"{he(r['c'])} · {r['l']} · {hz(r)}", f"{fmt(a, r['u'])} ← {fmt(b, r['u'])}", hprov(r, r["hist"][-1])) for r, a, b in up]), "Q2'26"),
            "dn": F("עדכוני יעד כלפי מטה", len(dn), "n",
                    P_calc("עדכוני יעד כלפי מטה", str(len(dn)), "יעדים", "יעד שהנוסח האחרון שלו נמוך מהראשון",
                           [(f"{he(r['c'])} · {r['l']} · {hz(r)}", f"{fmt(a, r['u'])} ← {fmt(b, r['u'])}", hprov(r, r["hist"][-1])) for r, a, b in dn]), "Q2'26")}
    corr = "כמעט תמיד כלפי מעלה: {up} עדכוני יעד העלו את הרף." if len(up) > 2 * len(dn) else "בשני הכיוונים: {up} עדכונים העלו את הרף."
    email = f"מאז הנוסח הראשון של כל יעד, {{up}} עדכונים העלו אותו ו-{{dn}} הורידו."
    if lead:
        email += f" הכי הרבה העלאות: {he(lead)}."
    email += " כשהעלאה מגיעה אחרי תוצאה שכבר נעקפה, היא מעדכנת את המפה ולא מעידה על שאפתנות."
    tab = [[he(r["c"]), r["l"], r["e"], hz(r), fmt(a, r["u"]), fmt(b, r["u"]), "↑" if b > a else "↓" if b < a else "="] for r, a, b in sorted(xs, key=lambda x: (x[0]["c"], x[0]["m"]))]
    ex = table("יעדים שעודכנו: הנוסח הראשון מול האחרון", ["חברה", "יעד", "ישות", "מועד", "ראשון", "אחרון", "כיוון"], tab,
               ["אמצע הטווח כשהודפס טווח; תחזיות רווח (מור) נכללות", "targets.json: כל נוסח עם מסמך ועמוד"])
    return answer(figs, corr, email, ex, None, f"up:{len(up)}|dn:{len(dn)}", links=[L_CRED], rel=["Q-131", "Q-135"], asof="Q2'26")


@question("Q-135", "מי העלתה את יעד כושר הפירעון שלה, ובכמה?", ["reg", "board", "cfo", "inv"], "targets", MAIN)
def q135(A):
    xs = []
    for r in rows():
        if r["m"].startswith("target_solvency_ratio") and "step" not in r["m"] and r.get("hist") and r["u"] == "pct" and revised(r):
            a, b = hist_mid(r["hist"][0]), hist_mid(r["hist"][-1])
            if a[1] is not None and b[1] is not None and b[1] != a[1]:
                xs.append((r, a, b))
    if not xs:
        return nodata("אין יעד כושר פירעון שעודכן")
    xs = sorted(xs, key=lambda x: -(x[2][1] - x[1][1]))
    r, a, b = xs[0]
    figs = {"d": F(f"העלאת יעד כושר הפירעון, {he(r['c'])}", b[1] - a[1], "pp",
                   P_calc(f"שינוי יעד כושר הפירעון · {he(r['c'])}", fmt(b[1] - a[1], "pp"), "נ״א", "נוסח אחרון − נוסח ראשון",
                          [(f"נוסח {a[0]}", fmt(a[1], "pct"), hprov(r, r["hist"][0])), (f"נוסח {b[0]}", fmt(b[1], "pct"), hprov(r, r["hist"][-1]))]), "Q2'26", c=r["c"], b="target"),
            "new": F(f"יעד כושר הפירעון העדכני, {he(r['c'])}", b[1], "pct", hprov(r, r["hist"][-1]), "Q2'26", c=r["c"], b="target")}
    ups = sorted({x[0]["c"] for x in xs if x[2][1] > x[1][1]})
    corr = f"{he(r['c'])} העלתה הכי הרבה: יעד כושר הפירעון שלה עלה ב-{{d}}."
    email = (f"יעד כושר הפירעון של {he(r['c'])} ({r['e']}) עלה ב-{{d}}, ל-{{new}}. "
             f"גם {names_list([c for c in ups if c != r['c']]) or 'אף חברה אחרת לא'} העלו יעד בדרך. יעד גבוה יותר מקטין את ההון הפנוי לחלוקה באותו יחס.")
    tab = [[he(x[0]["c"]), x[0]["l"], x[0]["e"], fmt(x[1][1], "pct"), fmt(x[2][1], "pct"), str(x[1][0]), str(x[2][0])] for x in xs]
    ex = table("יעדי כושר פירעון שעודכנו", ["חברה", "יעד", "ישות", "ראשון", "אחרון", "מועד ראשון", "מועד אחרון"], tab,
               ["נוסח כפי שהודפס, עם מסמך ועמוד", "targets.json"])
    return answer(figs, corr, email, ex, None, f"top:{r['c']}", links=[L_CRED, link("הון וחלוקה", "/capital")], rel=["Q-101", "Q-133"], asof="Q2'26")


# ------------------------------------------------------------------------------------------------ per company: on track?
def company_track(c, focus):
    xs = [r for r in strat_open() if r["c"] == c and not ifrs4(r)]
    if not xs:
        return nodata(f"אין ל{he(c)} יעד פתוח עם תוצאה באותה הגדרה")
    money = [r for r in xs if r["u"] == "m" and r["e"] == "הקבוצה"]
    roe = [r for r in xs if r["u"] == "pct" and "roe" in r["m"]]
    head = max(money, key=lambda r: (r["h"], focus(r))) if money else max(xs, key=lambda r: r["h"])
    figs = {"tgt": tfig(head), "act": afig(head)}
    ahead = head["act"]["v"] >= goal(head)
    if ahead:
        corr = f"{he(c)} כבר שם: {head['l'].replace('יעד ', '')} ב-FY'25, {{act}}, כבר ברמת היעד ל-{hz(head)}."
        vk = "ahead"
    else:
        figs["g"] = F(f"צמיחה שנתית נדרשת, {head['l']}, {hz(head)}", cagr(head), "pct",
                      P_calc(f"צמיחה נדרשת · {he(c)} · {head['l']} · {hz(head)}", fmt(cagr(head), "pct"), "% לשנה",
                             f"(יעד ÷ בפועל FY'25)^(1 ÷ {head['h'] - head['act']['y']}) − 1; יעד = הקצה התחתון",
                             [("יעד", ttext(head), tprov(head)), ("בפועל FY'25", fmt(head["act"]["v"], "m"), aprov(head))]), hz(head), c=c, b="target")
        corr = f"{he(c)} בדרך אם תצמח {{g}} בשנה עד {hz(head)}."
        vk = f"gap:{round(cagr(head))}"
    email = f"היעד המרכזי: {head['l']} של {{tgt}} ב-{hz(head)}; ב-FY'25 {{act}}" + (", כבר ברמת היעד." if ahead else ", ולכן נדרשת צמיחה של {g} בשנה.")
    roe = [r for r in roe if r is not head]
    if roe:
        r0 = max(roe, key=lambda r: r["h"])
        figs["roe_t"], figs["roe_a"] = tfig(r0), afig(r0)
        email += f" {r0['l']} ל-{hz(r0)}: {{roe_t}}, מול {{roe_a}} ב-FY'25."
    if head["act"].get("def") or "ליבה" in head["l"]:
        email += " רווח הליבה הוא בהגדרת החברה, לא רווח חשבונאי."
    ex = table(f"{he(c)}: יעדים פתוחים מול התוצאה האחרונה", HEAD, [row_line(r) for r in sorted(xs, key=lambda r: (r["h"], r["m"]))],
               ["בפועל = FY'25 באותה הגדרה; יעדים כפי שהודפסו, עם מסמך ועמוד", "targets.json, דוחות כספיים ומצגות משקיעים"])
    chg = changes_if("התשובה משתנה כשהתוצאה חוצה את היעד, {thr}", "act", "<" if ahead else ">=", goal(head))
    return answer(figs, corr, email, ex, chg, vk, links=[L_CRED, link(he(c), f"/company/{c}")], rel=["Q-131", "Q-132", "Q-190"], asof="FY'25")


TRACK = [("Q-136", "phoenix", "האם הפניקס בדרך ליעדי 2028?"), ("Q-137", "migdal", "האם מגדל בדרך ליעדי 2028?"),
         ("Q-138", "harel", "האם הראל בדרך ליעדי 2026?"), ("Q-139", "clal", "האם כלל בדרך ליעדים שהציבה?"),
         ("Q-140", "menora", "האם מנורה מבטחים בדרך ליעדי 2030?")]
for _id, _c, _q in TRACK:
    question(_id, _q, ["ceo", "board", "inv"], "targets", [_c])(lambda A, _c=_c: company_track(_c, lambda r: 0))


# ------------------------------------------------------------------------------------------------ restatements
def RS():
    d = load("restatements.json")
    return d, [dict(zip(d["cols"], r)) for r in d["rows"]]


def rprov(d, r, which):
    doc, pg, v = (r["d0"], r["p0"], r["v0"]) if which == 0 else (r["d1"], r["p1"], r["v1"])
    x = d["docs"].get(str(doc))
    scale = 1000 if r["u"] == "k" else 1
    return P_rep(f"{r['line']} · {he(r['co'])} · {r['pt']} {r['pe']} · {'הדפסה ראשונה' if which == 0 else 'הדפסה אחרונה'}", nf(v / scale, 1), MM,
                 MAYA + x[4] if x else None, pg, f"דוח כספי {ql(x[2]) if x else ''}".strip(), ql(x[2]) if x else r["in"])


def plab(r):
    y = r["pe"][2:4]
    if r["pt"] == "FY":
        return f"FY'{y}"
    q = {"03": 1, "06": 2, "09": 3, "12": 4}[r["pe"][5:7]]
    return f"H{1 if q == 2 else 2}'{y}" if r["pt"] == "H" else f"Q{q}'{y}"


PROFIT = ("רווח נקי", "רווח לתקופה", "סך הכל רווח נקי", "הפסד נקי לתקופה")


@question("Q-141", "מי הדפיסה מחדש את הרווח של תקופה קודמת בערך אחר?", ["inv", "reg", "board"], "targets", [])
def q141(A):
    d, R = RS()
    xs = [r for r in R if r["st"] == "pl" and r["line"] in PROFIT and r["u"] == "k" and r["k"] == 0 and r["v0"]]
    if not xs:
        return nodata("אין רווח שהודפס מחדש")
    seasons = sorted({r["in"] for r in xs}, key=lambda k: (k[:4], {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[k[4:]]))
    last = seasons[-1]
    cur = [r for r in xs if r["in"] == last]
    top = max(cur, key=lambda r: abs(r["v1"] / r["v0"] - 1))
    pc = (top["v1"] / top["v0"] - 1) * 100
    figs = {"pc": F(f"שינוי ברווח שהודפס מחדש, {he(top['co'])}", pc, "pct",
                    P_calc(f"דיווח מחדש של הרווח · {he(top['co'])} · {top['pt']} {top['pe']}", fmt(pc, "pct", signed=True), "%", "הדפסה אחרונה ÷ הדפסה ראשונה − 1",
                           [("הדפסה ראשונה", nf(top["v0"] / 1000, 1), rprov(d, top, 0)), ("הדפסה אחרונה", nf(top["v1"] / 1000, 1), rprov(d, top, 1))]),
                    ql(last), c=top["co"], signed=True),
            "v1": F(f"הרווח בהדפסה האחרונה, {he(top['co'])}", top["v1"] / 1000, "m", rprov(d, top, 1), ql(last), c=top["co"]),
            "v0": F(f"הרווח בהדפסה הראשונה, {he(top['co'])}", top["v0"] / 1000, "m", rprov(d, top, 0), ql(last), c=top["co"])}
    cos = sorted({r["co"] for r in xs})
    corr = f"בדוח האחרון ({ql(last)}): {he(top['co'])} שינתה את הרווח של {plab(top)} ב-{{pc}}."
    email = (f"בדוחות של {ql(last)}, {he(top['co'])} הדפיסה את הרווח של {plab(top)} כ-{{v1}}, מול {{v0}} בהדפסה הראשונה. "
             f"מאז {ql(seasons[0])}, הדפסה מחדש של שורת הרווח נרשמה אצל {names_list(cos)}. הסיבה (שינוי מדיניות, תיקון טעות, סיווג), כשניתנה, בבאור של הדוח המתקן.")
    tab = [[he(r["co"]), r["line"], plab(r), nf(r["v0"] / 1000, 1), nf(r["v1"] / 1000, 1), fmt((r["v1"] / r["v0"] - 1) * 100, "pct", signed=True), ql(r["in"]), r["std"]]
           for r in sorted(xs, key=lambda r: (r["in"], r["co"]), reverse=True)]
    ex = table("רווח שהודפס מחדש: הדפסה ראשונה מול אחרונה", ["חברה", "שורה", "תקופה", "ראשונה", "אחרונה", "שינוי", "בדוח", "תקן"], tab,
               ["מיליוני ש\"ח; שינוי ערך בלבד, לא שינוי סימן או עיגול", "restatements.json: עמוד בכל הדפסה, MAYA"])
    return answer(figs, corr, email, ex, None, f"last:{last}:{top['co']}", links=[L_REST], rel=["Q-142"], asof=ql(last))


@question("Q-142", "מי שינתה הכי הרבה מספרים של תקופות קודמות בדוח האחרון?", ["inv", "reg"], "targets", [])
def q142(A):
    d, R = RS()
    seas = d["seasons"]
    last = max(seas, key=lambda k: (k[:4], {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[k[4:]]))
    cos = seas[last]["cos"]
    if not cos:
        return nodata(f"אין דיווח מחדש ב-{ql(last)}")
    order = sorted(cos, key=lambda c: -cos[c])
    top, second = order[0], order[1] if len(order) > 1 else None

    def nfig(c):
        rs = [r for r in R if r["in"] == last and r["co"] == c]
        return F(f"מספרים שהודפסו מחדש בערך אחר, {he(c)}, {ql(last)}", cos[c], "n",
                 P_calc(f"דיווחים מחדש · {he(c)} · {ql(last)}", str(cos[c]), "תאים", "ספירת התאים בדוחות העיקריים ובבאורי IFRS שהדוח הזה הדפיס בערך אחר מההדפסה הראשונה (מעבר לעיגול)",
                        [(f"{r['line']} · {r['pt']} {r['pe']}", f"{nf(r['v0'], 0)} ← {nf(r['v1'], 0)}", rprov(d, r, 1)) for r in rs[:60]]), ql(last), c=c)
    figs = {"top": nfig(top), "tot": F(f"מספרים שהודפסו מחדש, כל החברות, {ql(last)}", seas[last]["n"], "n",
                                         P_calc(f"דיווחים מחדש · {ql(last)}", str(seas[last]["n"]), "תאים", "Σ על החברות (restatements.json seasons)",
                                                [(he(c), str(cos[c]), None) for c in order]), ql(last))}
    corr = f"{he(top)}: בדוח של {ql(last)} היא שינתה {{top}} מספרים של תקופות קודמות."
    email = f"בדוחות של {ql(last)} הודפסו מחדש {{tot}} מספרים של תקופות קודמות בערך אחר; הכי הרבה אצל {he(top)}, {{top}}."
    if second:
        figs["sec"] = nfig(second)
        email += f" אחריה {he(second)}, {{sec}}."
    email += " שינוי בשורת הרווח עצמה נבדק בשאלה נפרדת (Q-141)."
    ex = bars(f"מספרים של תקופות קודמות שהודפסו מחדש, דוחות {ql(last)}", "תאים", [(c, cos[c]) for c in order],
              ["ספירת תאים: דוחות עיקריים ובאורי IFRS, שינוי ערך מעבר לעיגול", "restatements.json (MAYA, עמוד לכל הדפסה)"], name="דיווחים מחדש")
    return answer(figs, corr, email, ex, None, f"top:{top}", links=[L_REST], rel=["Q-141"], asof=ql(last))


@question("Q-143", "אילו יעדים ייבחנו בדוחות FY'26?", ["board", "inv", "ceo"], "targets", MAIN)
def q143(A):
    xs = [r for r in rows() if r["st"] == "open" and r.get("h") == 2026]
    if not xs:
        return nodata("אין יעד שמועדו FY'26")
    by = {}
    for r in xs:
        by.setdefault(r["c"], []).append(r)
    lead = max(by, key=lambda c: (len(by[c]), c))
    meas = [r for r in xs if r.get("act") and r["u"] in ("pct", "m")]
    figs = {"n": F("יעדים שמועדם FY'26", len(xs), "n",
                   P_calc("יעדים שמועדם FY'26", str(len(xs)), "יעדים", "ספירת היעדים הפתוחים ב-targets.json שמועדם 2026",
                          [(f"{he(r['c'])} · {r['l']}", ttext(r), tprov(r)) for r in xs]), "FY'26", b="target"),
            "lead": F(f"יעדים שמועדם FY'26, {he(lead)}", len(by[lead]), "n",
                      P_calc(f"יעדי FY'26 · {he(lead)}", str(len(by[lead])), "יעדים", "ספירה", [(r["l"], ttext(r), tprov(r)) for r in by[lead]]), "FY'26", c=lead, b="target")}
    corr = "{n} יעדים מגיעים למבחן בדוחות FY'26."
    email = f"{{n}} יעדים פתוחים מועדם FY'26; הכי הרבה של {he(lead)}, {{lead}}."
    if meas:
        r0 = max(meas, key=lambda r: r["act"]["v"] / goal(r) if goal(r) else 0)
        figs["t0"], figs["a0"] = tfig(r0), afig(r0)
        email += f" לדוגמה, {r0['l']} של {he(r0['c'])}: יעד {{t0}}, ובפועל ב-FY'25 {{a0}}."
    ex = table("יעדים שמועדם FY'26", HEAD, [row_line(r) for r in sorted(xs, key=lambda r: (r["c"], r["m"]))],
               ["יעד כפי שהודפס; בפועל = FY'25 כשהתוצאה באותה הגדרה קיימת", "targets.json"])
    return answer(figs, corr, email, ex, None, f"n:{len(xs)}|lead:{lead}", links=[L_CRED], rel=["Q-138", "Q-131"], asof="FY'26")
