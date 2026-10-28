"""Product mix: which product grows, which product pays, each group's mix of pension / provident / managers' insurance, the investment
gemel and child-savings niches, asset concentration.

Sources: market.json (regulator aggregates per product x group x month), lens.json (segments), the fee yields of fees.py.
"""
import math

from answer_core import P_calc, P_reg, SEG_HE, answer, changes_if, exhibit, fig, he, link, load, lq, nf, nodata, question, ym
from questions._sav import (MAIN8, MEITAV_NOTE, SRC_REG, SRC_REP, L, co_link, f_pp, f_sector, f_share, hbar, lastq, lines, ltm, madd, names,
                            preg, qback, qe, row, sav, table)
from questions.fees import f_sec_fy, fy_cos

_C = {}


def cells(pis):
    """market.json rows summed per (month index, product index, group index): [assets, deposits, withdrawals, transfers]"""
    need = [p for p in pis if p not in _C]
    if need:
        S = set(need)
        acc = {p: {} for p in need}
        for r in load("market.json")["rows"]:
            if r[0] in S:
                d = acc[r[0]]
                k = (r[1], r[2])
                x = d.get(k)
                if x is None:
                    d[k] = [r[3], r[4], r[5], r[6]]
                else:
                    x[0] += r[3]
                    x[1] += r[4]
                    x[2] += r[5]
                    x[3] += r[6]
        _C.update(acc)
    return {p: _C[p] for p in pis}


def pval(pi, prods, k, grp=None):
    """sum over products (and one group, or all groups) of field k (0 assets, 1 dep, 2 wd, 3 tr) at month index pi"""
    d = cells([pi])[pi]
    return math.fsum(v[k] for (pr, g), v in d.items() if pr in prods and (grp is None or g == grp))


def prod_ix(key):
    return [i for i, p in enumerate(load("market.json")["products"]) if p["key"] == key]


FAM = {"pension": "fam:pension"}
PRODS = [("פנסיה", "fam:pension", lambda: [i for i, p in enumerate(load("market.json")["products"]) if p["family"] == "pension"]),
         ("קופות גמל", "p:gemel", lambda: prod_ix("gemel")),
         ("קרנות השתלמות", "p:hishtalmut", lambda: prod_ix("hishtalmut")),
         ("גמל להשקעה", "p:gemel_invest", lambda: prod_ix("gemel_invest")),
         ("חיסכון לכל ילד", "p:gemel_child", lambda: prod_ix("gemel_child"))]


@question("Q-070", "איזה מוצר צומח הכי מהר מכסף חדש: פנסיה, גמל, השתלמות או גמל להשקעה?", ["strat", "ceo", "dist", "board"], "mix")
def q070(A):
    M = load("market.json")
    m1 = L().asof
    p1 = M["periods"].index(m1)
    ms = list(range(p1 - 11, p1 + 1))
    p0 = p1 - 12
    cells(ms + [p0])
    rows_, items = [], []
    for name, set_, fn in PRODS:
        pr = set(fn())
        net = math.fsum(pval(p, pr, 1) - pval(p, pr, 2) + pval(p, pr, 3) for p in ms)
        a0, a1 = pval(p0, pr, 0), pval(p1, pr, 0)
        items.append((name, set_, net / a0 * 100, net, a0, a1))
    items.sort(key=lambda x: -x[2])

    def f(it):
        name, set_, v, net, a0, a1 = it
        p = P_calc(f"צבירה נטו LTM ÷ נכסי פתיחה · {name} · {ym(m1)}", f"{nf(v, 1)}%", "%",
                   "Σ (הפקדות − משיכות + העברות) ב-12 חודשים ÷ נכסים בתחילת החלון × 100; ללא תשואה",
                   [("צבירה נטו כולל ניוד LTM", nf(net, 0), P_reg("netflow", p1, "ltm", set_, -1)), (f"נכסים · {ym(M['periods'][p0])}", nf(a0, 0), P_reg("assets", p0, "m", set_, -1))])
        return fig(f"צמיחה מכסף חדש LTM, {name}", v, "pct", p, f"LTM {ym(m1)}", signed=True)

    top, bot = items[0], items[-1]
    figs = {"top": f(top), "bot": f(bot)}
    pen = next(x for x in items if x[1] == "fam:pension")
    if pen is not top and pen is not bot:
        figs["pen"] = f(pen)
    corr = f"{top[0]} צומח הכי מהר מכסף חדש: צבירה נטו של {{top}} מנכסיו ב-12 חודשים."
    email = (f"ב-12 חודשים עד {ym(m1)} הצבירה נטו (הפקדות פחות משיכות ועוד העברות) ב{top[0]} הייתה {{top}} מנכסי הפתיחה"
             + (", בפנסיה {pen}" if "pen" in figs else "") + f", וב{bot[0]} {{bot}}.")
    ex = hbar(f"צבירה נטו LTM כשיעור מנכסי הפתיחה, לפי מוצר, עד {ym(m1)}", "%", [(x[0], x[2]) for x in items],
              ["Σ הפקדות פחות משיכות ועוד העברות ב-12 חודשים ÷ נכסים בתחילת החלון; ללא תשואה", "העברות בין מנהלים באותו מוצר מתקזזות; בין מוצרים לא", SRC_REG],
              span=f"LTM {ym(m1)}")
    figs["gap"] = fig("פער המוצר המוביל על השני", top[2] - items[1][2], "pp",
                      P_calc("פער צמיחה בין שני המוצרים המובילים", nf(top[2] - items[1][2], 2), "נק׳", f"{top[0]} − {items[1][0]}", [(top[0], figs["top"]["t"], None), (items[1][0], f"{nf(items[1][2], 1)}%", None)],
                             note="המוביל מופיע בתשובה זו עם מקורו; השני בגרף"), f"LTM {ym(m1)}", d=1)
    chg = changes_if(f"המוביל מתחלף כש{items[1][0]} עוקף אותו", "gap", "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{top[1]}|bot:{bot[1]}", links=[link("השוק לפי מוצר", "/market"), sav(v="market")],
                  rel=["Q-073", "Q-076", "Q-027"], asof=ym(m1))


@question("Q-071", "למי התיק מוטה לפנסיה, ולמי לגמל ולהשתלמות?", ["strat", "inv", "board"], "mix")
def q071(A):
    q = lastq()
    e = qe(q)
    out = []
    for c in MAIN8:
        a = {s: ((row(c, s, q) or {}).get("reg") or {}).get("aE") or 0.0 for s in ("pen", "gem", "ins")}
        T = math.fsum(a.values())
        if T > 0:
            out.append((c, a, T))

    def f(c, a, T, s):
        v = a[s] / T * 100
        p = P_calc(f"משקל {SEG_HE[s]} בנכסי {he(c)} · {ym(e)}", f"{nf(v, 1)}%", "%", "נכסי המוצר ÷ (פנסיה + גמל והשתלמות + ביטוח-נט) × 100, נכסי הרשות",
                   [(SEG_HE[x], nf(a[x], 0), preg("assets", e, "m", x, c)) for x in ("pen", "gem", "ins")])
        return fig(f"משקל {SEG_HE[s]} בנכסי {he(c)}", v, "pct", p, ym(e), c=c)

    pen = max(out, key=lambda x: x[1]["pen"] / x[2])
    gem = max(out, key=lambda x: x[1]["gem"] / x[2])
    figs = {"p": f(*pen, "pen"), "g": f(*gem, "gem")}
    ins = max(out, key=lambda x: x[1]["ins"] / x[2])
    if ins[1]["ins"] > 0:
        figs["i"] = f(*ins, "ins")
    corr = f"{he(pen[0])} מוטה לפנסיה יותר מכולן: {{p}} מנכסי החיסכון שלה בפנסיה."
    email = (f"ב-{ym(e)} {{p}} מנכסי החיסכון של {he(pen[0])} בפנסיה, המוצר הזול ביותר בדמי הניהול. בקצה השני {he(gem[0])}, עם {{g}} בגמל והשתלמות"
             + (f"; התלות הגבוהה בביטוחי מנהלים ופוליסות חיסכון אצל {he(ins[0])}, {{i}}." if "i" in figs else "."))
    cats = [he(c) for c, _, _ in out]
    ex = exhibit("hbar", f"תמהיל נכסי החיסכון לפי מוצר, {ym(e)}", "%", cats,
                 [{"name": SEG_HE[s], "type": "bar", "data": [round(a[s] / T * 100, 3) for _, a, T in out]} for s in ("pen", "gem", "ins")],
                 ["נכסים מנוהלים לפי הרשות: פנסיה-נט, גמל-נט, ביטוח-נט (ביטוחי מנהלים ופוליסות חיסכון)", SRC_REG], span=ym(e))
    chg = changes_if(f"המוטה ביותר לפנסיה מתחלפת אם המשקל של {he(pen[0])} יורד אל מתחת ל-{{thr}}", "p", "<",
                     sorted((a["pen"] / T * 100 for _, a, T in out), reverse=True)[1])
    return answer(figs, corr, email, ex, chg, f"pen:{pen[0]}|gem:{gem[0]}", links=[sav(), sav("ins")], rel=["Q-072", "Q-074"], asof=ym(e))


@question("Q-072", "איזה מוצר מכניס לחברה המנהלת הכי הרבה לכל שקל נכסים?", ["strat", "cfo", "inv"], "mix")
def q072(A):
    q = lastq()
    qs = L().quarters[-8:]
    fp, fg = f_sec_fy("pen", q, fy_cos("pen", qs)), f_sec_fy("gem", q, fy_cos("gem", qs))
    M = load("market.json")
    pi = M["periods"].index(qe(q))
    figs = {"p": fp, "g": fg}
    # managers' insurance: the regulator's posted accumulation fee (its fee income is not separable from the policies' other income)
    from questions.fees import prod_cells
    cc = prod_cells(pi)
    ins = [i for i, p in enumerate(M["products"]) if p["family"] == "insurance" and cc.get(i, (0, 0, 0))[2] > 0]
    fi = math.fsum(cc[i][1] for i in ins) / math.fsum(cc[i][2] for i in ins)
    figs["i"] = fig("דמי ניהול ממוצעים מהצבירה, ביטוחי מנהלים ופוליסות חיסכון", fi, "pct", P_reg("fee", pi, "m", "fam:insurance", -1), ym(qe(q)), d=2)
    gp = fg["v"] / fp["v"]
    figs["x"] = fig("פי כמה גמל מכניס לשקל נכסים מפנסיה", gp, "x",
                    P_calc("יחס תשואת דמי הניהול גמל ÷ פנסיה", f"{nf(gp, 2)}×", "×", "תשואת דמי הניהול בגמל ÷ בפנסיה, הענף", [("גמל", fg["t"], None), ("פנסיה", fp["t"], None)],
                           note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), lq(q), d=1)
    gem_top = gp > 1
    corr = ("בין המוצרים שמדווחים בנפרד, גמל והשתלמות: הכנסות דמי ניהול של {g} מהנכסים בשנה." if gem_top else
            "בין המוצרים שמדווחים בנפרד, פנסיה: הכנסות דמי ניהול של {p} מהנכסים בשנה.")
    email = (f"ב-{lq(q)} הכנסות דמי הניהול בגמל והשתלמות היו {{g}} מהנכסים בשנה, {{x}} מהפנסיה ({{p}}). "
             f"ביטוחי המנהלים ופוליסות החיסכון גובים בממוצע {{i}} מהצבירה, אבל ההכנסה מהם אינה מופרדת בדוחות ולכן אינה בהשוואה.")
    ex = lines("תשואת דמי ניהול לפי מוצר, הענף", "%", qs,
               [("פנסיה", [f_sec_fy("pen", k, fy_cos("pen", qs))["v"] for k in qs]), ("גמל והשתלמות", [f_sec_fy("gem", k, fy_cos("gem", qs))["v"] for k in qs])],
               ["הכנסות מדמי ניהול ברבעון × 4 ÷ נכסים ממוצעים × 100, החברות המכוסות", "ביטוח-נט: דמי ניהול מצבירה שפורסמו, לא הכנסה מדווחת", SRC_REP, SRC_REG])
    chg = changes_if("התשובה מתהפכת כשיחס הגמל לפנסיה חוצה את {thr}", "x", "<" if gem_top else ">=", 1.0)
    return answer(figs, corr, email, ex, chg, "top:gem" if gem_top else "top:pen", links=[sav("gem"), sav("pen")], rel=["Q-032", "Q-077", "Q-071"], asof=lq(q))


def prod_leader(key, name, rel):
    M = load("market.json")
    m1 = L().asof
    p1 = M["periods"].index(m1)
    p0 = p1 - 12
    pr = set(prod_ix(key))
    cells([p0, p1])
    G = M["groups"]
    A1, A0 = pval(p1, pr, 0), pval(p0, pr, 0)
    ids = {g["name"]: g["id"] for g in L().groups}
    items = sorted(((g, pval(p1, pr, 0, gi) / A1 * 100) for gi, g in enumerate(G) if pval(p1, pr, 0, gi) > 0), key=lambda x: -x[1])
    top = items[0][0]
    gi = G.index(top)
    set_ = f"p:{key}"
    figs = {"a1": fig(f"נכסים, {name}, כלל השוק", A1 / 1000, "bn", P_reg("assets", p1, "m", set_, -1), ym(m1)),
            "a0": fig(f"נכסים, {name}, כלל השוק", A0 / 1000, "bn", P_reg("assets", p0, "m", set_, -1), ym(M["periods"][p0]))}
    gv = (A1 / A0 - 1) * 100
    figs["g"] = fig(f"שינוי YoY בנכסים, {name}", gv, "pct", P_calc(f"שינוי בנכסים · {name}", f"{nf(gv, 1)}%", "%", f"{ym(m1)} ÷ {ym(M['periods'][p0])} − 1",
                                                                  [(ym(m1), figs["a1"]["t"], None), (ym(M["periods"][p0]), figs["a0"]["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"),
                    ym(m1), signed=True)
    sh = items[0][1]
    figs["sh"] = fig(f"נתח {he(ids.get(top) or top)} מנכסי {name}", sh, "pct",
                     P_calc(f"נתח מנכסי {name} · {top} · {ym(m1)}", f"{nf(sh, 1)}%", "%", "נכסי הקבוצה במוצר ÷ נכסי השוק במוצר × 100",
                            [(top, nf(pval(p1, pr, 0, gi), 0), P_reg("assets", p1, "m", set_, gi)), ("כלל השוק", nf(A1, 0), None)]), ym(m1), c=ids.get(top))
    corr = f"{he(ids.get(top) or top)} מובילה ב{name}, עם {{sh}} מהנכסים."
    email = (f"נכסי {name} הגיעו ב-{ym(m1)} ל-{{a1}}, מול {{a0}} שנה קודם ({{g}}, כולל תשואה). "
             f"{he(ids.get(top) or top)} מחזיקה {{sh}}; אחריה {names([ids.get(x) or x for x, _ in items[1:3]])}.")
    ex = hbar(f"נתח מנכסי {name}, {ym(m1)}", "%", [(ids.get(g) or g, v) for g, v in items[:10]], [f"נכסי המסלולים במוצר, לפי קבוצה", SRC_REG], span=ym(m1))
    chg = changes_if(f"המובילה מתחלפת אם הנתח שלה יורד אל מתחת ל-{{thr}}", "sh", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{ids.get(top) or top}", links=[link("השוק לפי מוצר", "/market")], rel=rel, asof=ym(m1))


@question("Q-073", "האם גמל להשקעה ממשיך לצמוח, ומי מוביל בו?", ["dist", "strat", "ceo"], "mix")
def q073(A):
    return prod_leader("gemel_invest", "גמל להשקעה", ["Q-070", "Q-076"])


@question("Q-076", "מי מוביל בחיסכון לכל ילד?", ["dist", "strat"], "mix")
def q076(A):
    return prod_leader("gemel_child", "חיסכון לכל ילד", ["Q-070", "Q-073"])


@question("Q-074", "מי שולט בביטוחי המנהלים ובפוליסות החיסכון, והאם התיק מתכווץ?", ["strat", "inv", "board"], "mix")
def q074(A):
    q, s = lastq(), "ins"
    q0 = qback(q, 4)
    items = sorted(((c, row(c, s, q)["aum_share"]) for c in L().cos(s, q) if row(c, s, q).get("aum_share") is not None), key=lambda x: -x[1])
    top = items[0][0]
    T1 = math.fsum(r["reg"]["aE"] for (g, ss, qq), r in L().rows.items() if ss == s and qq == q)
    T0 = math.fsum(r["reg"]["aE"] for (g, ss, qq), r in L().rows.items() if ss == s and qq == q0)
    P1 = math.fsum(r["reg"]["aE"] for (g, ss, qq), r in L().rows.items() if ss == "pen" and qq == q)
    P0 = math.fsum(r["reg"]["aE"] for (g, ss, qq), r in L().rows.items() if ss == "pen" and qq == q0)
    gi, gp = (T1 / T0 - 1) * 100, (P1 / P0 - 1) * 100
    figs = {"sh": f_share(top, s, q),
            "gi": fig("שינוי YoY בנכסי ביטוחי המנהלים ופוליסות החיסכון", gi, "pct",
                      P_calc(f"שינוי בנכסים · ביטוח-נט · {lq(q0)}–{lq(q)}", f"{nf(gi, 1)}%", "%", "נכסים בסוף הרבעון ÷ שנה קודם − 1, כל הקבוצות",
                             [(ym(qe(q)), nf(T1, 0), preg("assets", qe(q), "m", s)), (ym(qe(q0)), nf(T0, 0), preg("assets", qe(q0), "m", s))]), lq(q), signed=True),
            "gp": fig("שינוי YoY בנכסי הפנסיה", gp, "pct",
                      P_calc(f"שינוי בנכסים · פנסיה · {lq(q0)}–{lq(q)}", f"{nf(gp, 1)}%", "%", "נכסים בסוף הרבעון ÷ שנה קודם − 1, כל הקבוצות",
                             [(ym(qe(q)), nf(P1, 0), preg("assets", qe(q), "m", "pen")), (ym(qe(q0)), nf(P0, 0), preg("assets", qe(q0), "m", "pen"))]), lq(q), signed=True)}
    t3 = math.fsum(v for _, v in items[:3])
    figs["t3"] = fig("נתח שלוש הגדולות בביטוחי מנהלים ופוליסות חיסכון", t3, "pct",
                     P_calc("נתח שלוש הגדולות · ביטוח-נט", f"{nf(t3, 1)}%", "%", "סכום נתחי הנכסים", [(he(c), f"{nf(v, 1)}%", L().prov_share(c, s, q, "aum_share")) for c, v in items[:3]]), lq(q))
    shrink = gi < gp
    corr = f"{he(top)} שולטת בביטוחי המנהלים ובפוליסות החיסכון, עם {{sh}} מהנכסים."
    email = (f"ב-{lq(q)} {names([c for c, _ in items[:3]])} מחזיקות {{t3}} מנכסי ביטוחי המנהלים ופוליסות החיסכון. "
             f"הנכסים השתנו ב-{{gi}} בשנה, מול {{gp}} בפנסיה: " + ("המוצר מאבד משקל מול הפנסיה." if shrink else "המוצר שומר על משקלו.")
             + " ביטוח-נט אינו מפרסם הפקדות וניוד, ולכן השינוי כולל תשואה.")
    ex = hbar(f"נתח מנכסי ביטוחי המנהלים ופוליסות החיסכון, {lq(q)}", "%", items, ["ביטוח-נט: ביטוחי מנהלים (כל הדורות) ופוליסות חיסכון; אין נתוני תזרים", SRC_REG], span=lq(q))
    chg = changes_if(f"המובילה מתחלפת אם הנתח של {he(top)} יורד אל מתחת ל-{{thr}}", "sh", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}|shrink:{'y' if shrink else 'n'}", links=[sav("ins")], rel=["Q-071", "Q-072"], asof=lq(q))


@question("Q-075", "האם ריכוזיות הנכסים בשוק הפנסיה והגמל עולה?", ["reg", "strat", "board"], "mix")
def q075(A):
    q = lastq()
    q0 = qback(q, 4)

    def cr3(s, k):
        xs = sorted(((c, row(c, s, k)["aum_share"]) for c in L().cos(s, k) if row(c, s, k).get("aum_share") is not None), key=lambda x: -x[1])[:3]
        return xs

    def f(s, k):
        xs = cr3(s, k)
        v = math.fsum(x for _, x in xs)
        return fig(f"נתח שלוש הגדולות, {SEG_HE[s]}, {lq(k)}", v, "pct",
                   P_calc(f"נתח שלוש הגדולות · {SEG_HE[s]} · {lq(k)}", f"{nf(v, 1)}%", "%", "סכום נתחי הנכסים של שלוש הקבוצות הגדולות בסוף הרבעון",
                          [(he(c), f"{nf(x, 1)}%", L().prov_share(c, s, k, "aum_share")) for c, x in xs]), lq(k))

    figs = {"p": f("pen", q), "p0": f("pen", q0), "g": f("gem", q), "g0": f("gem", q0)}
    figs["dp"] = f_pp("שינוי בנתח שלוש הגדולות בפנסיה, YoY", figs["p"]["v"], figs["p0"]["v"], figs["p"], figs["p0"], lq(q), local=True)
    figs["dg"] = f_pp("שינוי בנתח שלוש הגדולות בגמל, YoY", figs["g"]["v"], figs["g0"]["v"], figs["g"], figs["g0"], lq(q), local=True)
    yp, yg = figs["dp"]["v"] > 0, figs["dg"]["v"] > 0
    corr = ("כן, בשני המוצרים" if yp and yg else "בפנסיה כן" if yp else "בגמל כן" if yg else "לא, היא יורדת") + ": נתח שלוש הגדולות בפנסיה השתנה ב-{dp} בשנה."
    email = (f"בפנסיה שלוש הגדולות ({names([c for c, _ in cr3('pen', q)])}) מחזיקות {{p}} מהנכסים, מול {{p0}} ב-{lq(q0)}. "
             f"בגמל והשתלמות שלוש הגדולות ({names([c for c, _ in cr3('gem', q)])}) מחזיקות {{g}}, מול {{g0}}.")
    qs = L().quarters[-8:]
    ex = lines("נתח שלוש הקבוצות הגדולות מהנכסים", "%", qs,
               [(SEG_HE[s], [math.fsum(x for _, x in cr3(s, k)) for k in qs]) for s in ("pen", "gem")], ["שלוש הגדולות בכל רבעון, לפי נכסים בסוף הרבעון", SRC_REG])
    chg = changes_if("התשובה בפנסיה מתהפכת כשהשינוי השנתי חוצה את {thr}", "dp", "<=" if yp else ">", 0.0)
    return answer(figs, corr, email, ex, chg, f"pen:{'up' if yp else 'down'}|gem:{'up' if yg else 'down'}", links=[sav("pen"), sav("gem")],
                  rel=["Q-015", "Q-016", "Q-017"], asof=lq(q))


@question("Q-077", "מה רווחי יותר לחברה המנהלת: פנסיה או גמל?", ["strat", "cfo", "inv", "board"], "mix")
def q077(A):
    q = lastq()
    cp = [c for c in MAIN8 if c != "meitav" and ltm(c, "pen", q) and ltm(c, "pen", q)["ppb"] is not None]
    cg = [c for c in MAIN8 if c != "meitav" and ltm(c, "gem", q) and ltm(c, "gem", q)["ppb"] is not None]
    fp, fg = f_sector("pen", q, cp, "ppb"), f_sector("gem", q, cg, "ppb")
    cip, cig = f_sector("pen", q, cp, "ci"), f_sector("gem", q, cg, "ci")
    figs = {"p": fp, "g": fg, "cp": cip, "cg": cig}
    yes = fg["v"] > fp["v"]
    better = "גמל והשתלמות" if yes else "פנסיה"
    corr = f"{better}: הענף מרוויח בגמל {{g}} לכל מיליארד ש״ח נכסים בשנה."
    email = (f"ב-LTM {lq(q)} הרוויחו החברות המכוסות {{g}} רווח תפעולי לכל מיליארד ש״ח בגמל והשתלמות, מול {{p}} בפנסיה. "
             f"יחס ההוצאות להכנסות: {{cg}} בגמל, {{cp}} בפנסיה; "
             + (("הפנסיה יעילה יותר, אבל דמי הניהול הנמוכים בה מכריעים." if cip["v"] < cig["v"] else "הגמל גם יעיל יותר.") if yes else
                ("הגמל יעיל יותר, אבל הפנסיה מרוויחה יותר לשקל." if cig["v"] < cip["v"] else "הפנסיה גם יעילה יותר.")))
    items = [(c, ltm(c, "pen", q)["ppb"], ltm(c, "gem", q)["ppb"] if c in cg else None) for c in cp]
    ex = exhibit("hbar", f"רווח תפעולי לכל ₪ מיליארד נכסים, פנסיה מול גמל, LTM {lq(q)}", 'מיליוני ש"ח', [he(c) for c, _, _ in items],
                 [{"name": "פנסיה", "type": "bar", "data": [round(p, 3) for _, p, _ in items]},
                  {"name": "גמל והשתלמות", "type": "bar", "data": [None if g is None else round(g, 3) for _, _, g in items]}],
                 ["Σ רווח תפעולי LTM (מהדוח) ÷ נכסים ממוצעים במיליארדים (רשות)", MEITAV_NOTE, SRC_REP, SRC_REG], span=f"LTM {lq(q)}")
    figs["gap"] = fig("פער הרווח לכל מיליארד, גמל פחות פנסיה", fg["v"] - fp["v"], "m",
                      P_calc("פער הרווח לכל מיליארד", nf(fg["v"] - fp["v"], 2), 'מיליוני ש"ח למיליארד', "גמל − פנסיה", [("גמל", fg["t"], None), ("פנסיה", fp["t"], None)],
                             note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), f"LTM {lq(q)}", d=2, signed=True)
    chg = changes_if("התשובה מתהפכת כשפער הרווח לכל מיליארד חוצה את {thr}", "gap", "<=" if yes else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "gem" if yes else "pen", links=[sav(v="econ")], rel=["Q-072", "Q-067", "Q-068"], asof=f"LTM {lq(q)}")
