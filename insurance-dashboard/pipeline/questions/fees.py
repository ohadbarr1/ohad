"""Fee economics: fee-yield erosion and whether it is price or mix, who charges what, whether fee cuts buy flow, profit per NIS bn,
the profit pool, and the nowcast of the quarter in progress.

Sources: lens.json (reported fee income over regulator average assets), market.json (the regulator's posted fee per product),
lts.json (fees charged on accumulation and on deposits), warroom/elasticity.json (fee -> flow), nowcast.json (the quarter in progress).
"""
import math

from answer_core import P_calc, P_reg, SEG_HE, answer, changes_if, fig, he, link, load, lq, nf, nodata, question, ym
from questions._sav import (MAIN8, MEITAV_NOTE, SRC_LTS, SRC_REG, SRC_REP, L, avg_prov, co_link, f_bp, f_fy, f_fy_ltm, f_lts, f_ppb_ltm,
                            f_rep, f_sector, f_sum_ltm, frag_link, fsig, hbar, lastq, lines, ltm, lv, madd, names, preg, qback, row,
                            sav, sector, table)

FY_FOOT = ["תשואת דמי ניהול = הכנסות מדמי ניהול ברבעון (דוח החברה המנהלת) × 4 ÷ נכסים ממוצעים ברבעון (רשות) × 100",
           "כוללת דמי ניהול מהפקדות ומהצבירה, קרנות ותיקות ומקבלי קצבה כפי שבמגזר בדוח", SRC_REP, SRC_REG]


# ------------------------------------------------------------------------------------------------ sector fee yield, quarterly
def fy_cos(s, qs):
    """companies with a reported fee yield in every quarter of qs (a fixed set, so the sector line does not jump with coverage)"""
    return [c for c in MAIN8 + ["analyst", "yelin"] if all((row(c, s, k) or {}).get("fy_reg") is not None for k in qs)]


def sec_fy(s, q, cs):
    rs = [row(c, s, q) for c in cs]
    return math.fsum(r["rep"]["fees"] for r in rs) * 4 / math.fsum(r["reg"]["avg"] for r in rs) * 100


def f_sec_fy(s, q, cs):
    v = sec_fy(s, q, cs)
    p = P_calc(f"תשואת דמי ניהול · הענף · {SEG_HE[s]} · {lq(q)}", f"{nf(v, 3)}%", "שנתי",
               f"Σ הכנסות מדמי ניהול ברבעון × 4 ÷ Σ נכסים ממוצעים × 100, על החברות: {', '.join(he(c) for c in cs)}",
               [(he(c), f"{nf(row(c, s, q)['fy_reg'], 3)}%", f_fy(c, s, q)["prov"]) for c in cs])
    return fig(f"תשואת דמי ניהול, הענף, {SEG_HE[s]}", v, "pct", p, lq(q), d=2)


def eroding(s, rel):
    q = lastq()
    q0 = qback(q, 4)
    qs = L().quarters[-8:]
    cs = fy_cos(s, qs)
    a, b = f_sec_fy(s, q, cs), f_sec_fy(s, q0, cs)
    figs = {"a": a, "b": b, "d": f_bp(f"שינוי בתשואת דמי הניהול, הענף, {SEG_HE[s]}, YoY", a["v"], b["v"], a, b, lq(q), local=True)}
    items = sorted(((c, (row(c, s, q)["fy_reg"] - row(c, s, q0)["fy_reg"]) * 100) for c in cs), key=lambda x: x[1])
    worst = items[0][0]
    fw, fw0 = f_fy(worst, s, q), f_fy(worst, s, q0)
    figs["w"] = f_bp(f"שינוי בתשואת דמי הניהול, {he(worst)}, YoY", fw["v"], fw0["v"], fw, fw0, lq(q), c=worst)
    yes = figs["d"]["v"] < 0
    down = [c for c, v in items if v < 0]
    corr = f"{'כן' if yes else 'לא'}: תשואת דמי הניהול בענף ב{SEG_HE[s]} השתנתה ב-{{d}} בשנה."
    email = (f"ב-{lq(q)} הכנסות דמי הניהול של החברות המכוסות ב{SEG_HE[s]} היו {{a}} מהנכסים בשנה, מול {{b}} ב-{lq(q0)}. "
             f"ירידה אצל {len(down)} חברות מתוך {len(cs)} חברות; החדה ביותר אצל {he(worst)}, {{w}}.")
    ex = lines(f"תשואת דמי ניהול, {SEG_HE[s]}: הענף ושלוש הגדולות", "%", qs,
               [("הענף", [sec_fy(s, k, cs) for k in qs])] + [(he(c), [row(c, s, k)["fy_reg"] for k in qs])
                                                         for c in sorted(cs, key=lambda c: -row(c, s, q)["reg"]["aE"])[:3]],
               FY_FOOT + [f"הענף: {', '.join(he(c) for c in cs)} (חברות עם דוח בכל הרבעונים בגרף)"])
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי חוצה את {thr}", "d", ">=" if yes else "<", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav(s), frag_link(sig="fee")], rel=rel, asof=lq(q))


@question("Q-030", "האם תשואת דמי הניהול בפנסיה נשחקת?", ["ceo", "cfo", "board", "inv"], "fees")
def q030(A):
    return eroding("pen", ["Q-032", "Q-033", "Q-036"])


@question("Q-031", "האם תשואת דמי הניהול בגמל והשתלמות נשחקת?", ["ceo", "cfo", "board", "inv"], "fees")
def q031(A):
    return eroding("gem", ["Q-032", "Q-037"])


# ------------------------------------------------------------------------------------------------ price or mix: the regulator's posted fee
_PC = {}


def prod_cells(pi):
    """market totals per product at month index pi: product index -> (assets, fee numerator, fee denominator)"""
    if pi not in _PC:
        out = {}
        for r in load("market.json")["rows"]:
            if r[0] == pi:
                a, fn, fd = out.get(r[1], (0.0, 0.0, 0.0))
                out[r[1]] = (a + r[3], fn + r[8], fd + r[9])
        _PC[pi] = out
    return _PC[pi]


@question("Q-032", "שחיקת דמי הניהול בשוק הפנסיה והגמל: מחיר או תמהיל?", ["ceo", "cfo", "strat", "inv"], "fees")
def q032(A):
    M = load("market.json")
    m1 = L().asof
    m0 = madd(m1, -12)
    p1, p0 = M["periods"].index(m1), M["periods"].index(m0)
    prods = [i for i, p in enumerate(M["products"]) if p["family"] in ("pension", "gemel")]
    c1, c0 = prod_cells(p1), prod_cells(p0)
    prods = [i for i in prods if c1.get(i, (0, 0, 0))[2] > 0 and c0.get(i, (0, 0, 0))[2] > 0]
    A1, A0 = math.fsum(c1[i][0] for i in prods), math.fsum(c0[i][0] for i in prods)
    w1 = {i: c1[i][0] / A1 for i in prods}
    w0 = {i: c0[i][0] / A0 for i in prods}
    f1 = {i: c1[i][1] / c1[i][2] for i in prods}
    f0 = {i: c0[i][1] / c0[i][2] for i in prods}
    F1, F0 = math.fsum(w1[i] * f1[i] for i in prods), math.fsum(w0[i] * f0[i] for i in prods)
    rate = math.fsum(w0[i] * (f1[i] - f0[i]) for i in prods) * 100
    mix = math.fsum((w1[i] - w0[i]) * f1[i] for i in prods) * 100
    lab = {i: M["products"][i]["label"] for i in prods}

    def inputs(pi, f, w, mm):
        return [(f"{lab[i]} · דמי ניהול · {ym(mm)}", f"{nf(f[i], 3)}%", P_reg("fee", pi, "m", f"p:{M['products'][i]['key']}", -1)) for i in prods] + \
               [(f"{lab[i]} · נכסים · {ym(mm)}", f"{nf(w[i] * 100, 2)}%", P_reg("assets", pi, "m", f"p:{M['products'][i]['key']}", -1)) for i in prods]

    pF1 = P_calc(f"דמי ניהול ממוצעים מהצבירה · פנסיה וגמל · {ym(m1)}", f"{nf(F1, 3)}%", "%",
                 "Σ משקל המוצר בנכסים × דמי הניהול הממוצעים שפורסמו במוצר (AVG_ANNUAL_MANAGEMENT_FEE, משוקלל בנכסים)", inputs(p1, f1, w1, m1))
    pF0 = P_calc(f"דמי ניהול ממוצעים מהצבירה · פנסיה וגמל · {ym(m0)}", f"{nf(F0, 3)}%", "%",
                 "Σ משקל המוצר בנכסים × דמי הניהול הממוצעים שפורסמו במוצר (AVG_ANNUAL_MANAGEMENT_FEE, משוקלל בנכסים)", inputs(p0, f0, w0, m0))
    fa, fb = fig("דמי ניהול ממוצעים מהצבירה, פנסיה וגמל", F1, "pct", pF1, ym(m1), d=3), fig("דמי ניהול ממוצעים מהצבירה, פנסיה וגמל", F0, "pct", pF0, ym(m0), d=3)
    figs = {"a": fa, "b": fb, "d": f_bp("שינוי בדמי הניהול הממוצעים, YoY", F1, F0, fa, fb, ym(m1), local=True)}
    figs["r"] = fig("אפקט המחיר (שינוי דמי הניהול בתוך כל מוצר)", rate, "bp",
                    P_calc("אפקט המחיר", f"{nf(rate, 2)} נ״ב", "נ״ב", f"Σ משקל {ym(m0)} × (דמי ניהול {ym(m1)} − {ym(m0)}) × 100", [("דמי ניהול ומשקלים · " + ym(m1), fa["t"], None), ("דמי ניהול ומשקלים · " + ym(m0), fb["t"], None)], note="המשקלים ודמי הניהול לפי מוצר: בנתוני דמי הניהול הממוצעים בתשובה זו"), ym(m1), d=1)
    figs["x"] = fig("אפקט התמהיל (מעבר בין מוצרים)", mix, "bp",
                    P_calc("אפקט התמהיל", f"{nf(mix, 2)} נ״ב", "נ״ב", f"Σ (משקל {ym(m1)} − משקל {ym(m0)}) × דמי ניהול {ym(m1)} × 100", [("דמי ניהול ומשקלים · " + ym(m1), fa["t"], None), ("דמי ניהול ומשקלים · " + ym(m0), fb["t"], None)], note="המשקלים ודמי הניהול לפי מוצר: בנתוני דמי הניהול הממוצעים בתשובה זו"), ym(m1), d=1)
    price = abs(rate) >= abs(mix)
    big = "r" if price else "x"
    corr = (f"{'בעיקר מחיר' if price else 'בעיקר תמהיל'}: " + ("ירידת דמי הניהול בתוך המוצרים אחראית ל-{r} בשנה." if price else
                                                               "המעבר בין מוצרים אחראי ל-{x} בשנה."))
    email = (f"דמי הניהול הממוצעים מהצבירה בפנסיה ובגמל, משוקללים בנכסים, השתנו מ-{{b}} ב-{ym(m0)} ל-{{a}} ב-{ym(m1)}, שינוי של {{d}}. "
             f"מזה אפקט מחיר (שינוי בתוך כל מוצר) {{r}} ואפקט תמהיל (מעבר נכסים בין מוצרים) {{x}}.")
    rows_ = [["מוצר", f"משקל {ym(m0)}", f"משקל {ym(m1)}", f"דמי ניהול {ym(m0)}", f"דמי ניהול {ym(m1)}"]]
    for i in sorted(prods, key=lambda i: -w1[i]):
        rows_.append([lab[i], f"{nf(w0[i] * 100, 1)}%", f"{nf(w1[i] * 100, 1)}%", f"{nf(f0[i], 3)}%", f"{nf(f1[i], 3)}%"])
    ex = table("דמי ניהול מהצבירה לפי מוצר: מחיר ותמהיל", rows_,
               ["דמי הניהול הממוצעים שפורסמו על הצבירה (AVG_ANNUAL_MANAGEMENT_FEE), משוקללים בנכסי המסלולים; ללא דמי ניהול מהפקדות",
                "פירוק: אפקט מחיר = Σ משקל בבסיס × שינוי השיעור; אפקט תמהיל = Σ שינוי המשקל × השיעור החדש; הסכום שווה לשינוי", SRC_REG],
               span=f"{ym(m0)}–{ym(m1)}")
    chg = changes_if("הפסיקה מתהפכת אם האפקט הדומיננטי קטן בערכו המוחלט מהשני; כרגע הוא {thr}", big, ">" if figs[big]["v"] < 0 else "<", 0.0)
    return answer(figs, corr, email, ex, chg, "price" if price else "mix", links=[sav(v="market"), link("השוק לפי מוצר", "/market")],
                  rel=["Q-030", "Q-031", "Q-033", "Q-072"], asof=ym(m1))


@question("Q-033", "האם דמי הניהול שנגבים בפנסיה, מהצבירה ומההפקדות, יורדים?", ["ceo", "cfo", "dist", "reg"], "fees")
def q033(A):
    q = lastq()
    q0 = qback(q, 4)
    fa, fa0, fd, fd0 = (f_lts(None, "pen", m, k, d=3) for m, k in (("fee_a", q), ("fee_a", q0), ("fee_d", q), ("fee_d", q0)))
    if not all((fa, fa0, fd, fd0)):
        return nodata("שיעורי דמי הניהול של החברות המכוסות חסרים לאחד הרבעונים")
    figs = {"a": fa, "a0": fa0, "d": fd, "d0": fd0,
            "da": f_bp("שינוי בדמי הניהול מהצבירה, YoY", fa["v"], fa0["v"], fa, fa0, lq(q), local=True),
            "dd": f_bp("שינוי בדמי הניהול מהפקדות, YoY", fd["v"], fd0["v"], fd, fd0, lq(q), local=True)}
    ya, yd = figs["da"]["v"] < 0, figs["dd"]["v"] < 0
    vk = f"acc:{'down' if ya else 'up'}|dep:{'down' if yd else 'up'}"
    corr = (("כן, בשניהם" if ya and yd else "רק מהצבירה" if ya else "רק מההפקדות" if yd else "לא") +
            ": דמי הניהול מהצבירה בקרנות הפנסיה החדשות השתנו ב-{da} בשנה.")
    email = (f"ב-{lq(q)} גבו החברות המכוסות {{a}} מהצבירה בשנה, מול {{a0}} ב-{lq(q0)}; מההפקדות {{d}}, מול {{d0}}. "
             f"שינוי של {{da}} מהצבירה ו-{{dd}} מההפקדות.")
    qs = L().quarters[-8:]
    ex = lines("פנסיה, קרנות חדשות: דמי ניהול שנגבו, החברות המכוסות", "%", qs,
               [("מהצבירה", [lv(None, "pen", "fee_a", k) for k in qs]), ("מהפקדות (ציר זהה)", [lv(None, "pen", "fee_d", k) for k in qs])],
               ["מהצבירה: דמי ניהול שנגבו מנכסים × 4 ÷ נכסים ממוצעים; מהפקדות: דמי ניהול שנגבו מהפקדות ÷ דמי הגמולים", SRC_LTS])
    chg = changes_if("התשובה על הצבירה מתהפכת כשהשינוי השנתי חוצה את {thr}", "da", ">=" if ya else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[sav("pen")], rel=["Q-030", "Q-032"], asof=lq(q))


def charges(s, rel):
    q = lastq()
    items = sorted(((c, row(c, s, q)["fy_reg"]) for c in MAIN8 + ["analyst", "yelin"] if (row(c, s, q) or {}).get("fy_reg") is not None), key=lambda x: -x[1])
    top, low = items[0][0], items[-1][0]
    qs = L().quarters[-8:]
    cs = fy_cos(s, qs)
    figs = {"top": f_fy(top, s, q), "low": f_fy(low, s, q), "sec": f_sec_fy(s, q, cs)}
    corr = f"{he(top)} גובה ב{SEG_HE[s]} את תשואת דמי הניהול הגבוהה: {{top}} מהנכסים בשנה."
    email = (f"ב-{lq(q)} הכנסות דמי הניהול של {he(top)} ב{SEG_HE[s]} היו {{top}} מהנכסים בשנה, מול {{sec}} בענף. "
             f"הנמוכה: {he(low)}, {{low}}.")
    ex = hbar(f"תשואת דמי ניהול, {SEG_HE[s]}, {lq(q)}", "%", items, FY_FOOT, span=lq(q))
    chg = changes_if(f"המובילה מתחלפת אם התשואה של {he(top)} יורדת אל מתחת ל-{{thr}}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}|low:{low}", links=[sav(s)], rel=rel, asof=lq(q))


@question("Q-034", "מי גובה בפנסיה את תשואת דמי הניהול הגבוהה ביותר?", ["dist", "ceo", "reg"], "fees")
def q034(A):
    return charges("pen", ["Q-030", "Q-036"])


@question("Q-035", "מי גובה בגמל והשתלמות את תשואת דמי הניהול הגבוהה ביותר?", ["dist", "ceo", "reg"], "fees")
def q035(A):
    return charges("gem", ["Q-031", "Q-037"])


def cut(s, rel):
    q = lastq()
    q0 = qback(q, 4)
    items = []
    for c in MAIN8 + ["analyst", "yelin"]:
        f = fsig(c, "fee", s)
        if f and f.get("asof") == lq(q) and f.get("provT"):
            items.append((c, f["t"], f))
    if len(items) < 3:
        return nodata("אות שחיקת דמי הניהול של מוניטור השבריריות חסר לרבעון")
    items.sort(key=lambda x: x[1])
    c, v, f = items[0]
    med = f["x"]["med"]
    figs = {"w": fig(f"שינוי YoY בתשואת דמי הניהול, {he(c)}, {SEG_HE[s]}", v, "bp", f["provT"], lq(q), d=1, c=c),
            "lv": fig(f"תשואת דמי ניהול, {he(c)}, {SEG_HE[s]}", f["v"], "pct", f["prov"], lq(q), d=2, c=c),
            "med": fig(f"חציון השינוי אצל העמיתים, {SEG_HE[s]}", med, "bp",
                       P_calc(f"חציון השינוי YoY · {SEG_HE[s]} · {lq(q)}", f"{nf(med, 1)} נ״ב", "נ״ב", "חציון השינוי השנתי של החברות האחרות (fragility.json)",
                              [(he(x), f"{nf(t, 1)} נ״ב", g["provT"]) for x, t, g in items if x != c]), lq(q), d=1)}
    up = [x for x, t, _ in items if t > 0]
    corr = f"{he(c)} שחקה ב{SEG_HE[s]} הכי הרבה: שינוי של {{w}} בתשואת דמי הניהול בשנה."
    email = (f"מ-{lq(q0)} עד {lq(q)} תשואת דמי הניהול של {he(c)} ב{SEG_HE[s]} השתנתה ב-{{w}} והגיעה ל-{{lv}}, מול חציון שינוי של {{med}} אצל העמיתים. "
             + (f"עלו: {names(up)}." if up else "אף חברה לא העלתה."))
    ex = hbar(f"שינוי YoY בתשואת דמי הניהול, {SEG_HE[s]}, {lq(q0)} עד {lq(q)}", "נ״ב", [(x, t) for x, t, _ in items], FY_FOOT + ["fragility.json: אות שחיקת דמי ניהול"], span=lq(q))
    chg = changes_if(f"המובילה בשחיקה מתחלפת אם השינוי של {he(c)} עולה מעל {{thr}}", "w", ">", items[1][1])
    return answer(figs, corr, email, ex, chg, f"worst:{c}", links=[sav(s), frag_link(c, "fee")], rel=rel, asof=lq(q))


@question("Q-036", "מי שחק הכי הרבה בדמי הניהול בפנסיה בשנה האחרונה?", ["ceo", "cfo", "inv"], "fees")
def q036(A):
    return cut("pen", ["Q-030", "Q-034"])


@question("Q-037", "מי שחק הכי הרבה בדמי הניהול בגמל והשתלמות בשנה האחרונה?", ["ceo", "cfo", "inv"], "fees")
def q037(A):
    return cut("gem", ["Q-031", "Q-035"])


# ------------------------------------------------------------------------------------------------ per company: erosion, price or mix
def decomp(c, q, q0):
    """the change in a group's pension + provident fee yield, split into rate (within each product) and mix (between them), bp"""
    r = {(s, k): row(c, s, k) for s in ("pen", "gem") for k in (q, q0)}
    if any(x is None or x.get("fy_reg") is None for x in r.values()):
        return None
    w = {k: {s: r[(s, k)]["reg"]["avg"] / (r[("pen", k)]["reg"]["avg"] + r[("gem", k)]["reg"]["avg"]) for s in ("pen", "gem")} for k in (q, q0)}
    rate = math.fsum(w[q0][s] * (r[(s, q)]["fy_reg"] - r[(s, q0)]["fy_reg"]) for s in ("pen", "gem")) * 100
    mix = math.fsum((w[q][s] - w[q0][s]) * r[(s, q)]["fy_reg"] for s in ("pen", "gem")) * 100
    return rate, mix, w


def erosion(c):
    q = lastq()
    q0 = qback(q, 4)
    dc = decomp(c, q, q0)
    if dc is None or (row(c, "pg", q) or {}).get("fy_reg") is None or (row(c, "pg", q0) or {}).get("fy_reg") is None:
        return nodata(f"ל{he(c)} אין תשואת דמי ניהול בפנסיה ובגמל לשני הרבעונים")
    rate, mix, w = dc
    a, b = f_fy(c, "pg", q), f_fy(c, "pg", q0)
    cs = [x for x in MAIN8 if (row(x, "pg", q) or {}).get("fy_reg") is not None and (row(x, "pg", q0) or {}).get("fy_reg") is not None]
    sa, sb = f_sec_fy("pg", q, cs), f_sec_fy("pg", q0, cs)
    figs = {"a": a, "b": b, "d": f_bp(f"שינוי בתשואת דמי הניהול, {he(c)}, פנסיה וגמל, YoY", a["v"], b["v"], a, b, lq(q), c=c, local=True),
            "ds": f_bp("שינוי בתשואת דמי הניהול, שמונה הקבוצות, פנסיה וגמל, YoY", sa["v"], sb["v"], sa, sb, lq(q))}
    ins = [(f"תשואת דמי ניהול · {SEG_HE[s]} · {lq(k)}", f"{nf(row(c, s, k)['fy_reg'], 3)}%", f_fy(c, s, k)["prov"]) for s in ("pen", "gem") for k in (q, q0)] + \
          [(f"נכסים ממוצעים · {SEG_HE[s]} · {lq(k)}", nf(row(c, s, k)["reg"]["avg"], 0), avg_prov(c, s, k)) for s in ("pen", "gem") for k in (q, q0)]
    figs["r"] = fig(f"אפקט מחיר, {he(c)}", rate, "bp", P_calc(f"אפקט מחיר · {he(c)} · {lq(q0)}–{lq(q)}", f"{nf(rate, 2)} נ״ב", "נ״ב",
                                                         "Σ משקל המוצר בנכסים בבסיס × שינוי תשואת דמי הניהול שלו × 100 (פנסיה, גמל)", ins), lq(q), d=1, c=c)
    figs["x"] = fig(f"אפקט תמהיל, {he(c)}", mix, "bp", P_calc(f"אפקט תמהיל · {he(c)} · {lq(q0)}–{lq(q)}", f"{nf(mix, 2)} נ״ב", "נ״ב",
                                                         "Σ שינוי משקל המוצר בנכסים × תשואת דמי הניהול שלו היום × 100 (פנסיה, גמל)",
                                                         [(l_, v_, None) for l_, v_, _ in ins], note="אותם רכיבים כמו באפקט המחיר בתשובה זו, שם עם מקורם"), lq(q), d=1, c=c)
    faster = figs["d"]["v"] < figs["ds"]["v"]
    price = abs(rate) >= abs(mix)
    figs["gap"] = fig(f"פער השינוי של {he(c)} מול הקבוצות", figs["d"]["v"] - figs["ds"]["v"], "bp",
                      P_calc(f"פער · {he(c)} מול שמונה הקבוצות", nf(figs["d"]["v"] - figs["ds"]["v"], 1), "נ״ב", "שינוי החברה − שינוי שמונה הקבוצות",
                             [(he(c), figs["d"]["t"], None), ("שמונה הקבוצות", figs["ds"]["t"], None)], note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), lq(q), d=1, c=c)
    corr = (f"{'כן' if faster else 'לא'}: תשואת דמי הניהול של {he(c)} בפנסיה ובגמל השתנתה ב-{{d}} בשנה, "
            + ("מהר מהקבוצות." if faster else "פחות מהקבוצות."))
    email = (f"תשואת דמי הניהול של {he(c)} בפנסיה ובגמל: {{a}} ב-{lq(q)} מול {{b}} ב-{lq(q0)}, שינוי של {{d}} מול {{ds}} לשמונה הקבוצות. "
             f"הפירוק: מחיר (בתוך הפנסיה והגמל) {{r}}, תמהיל (משקל הפנסיה הזולה מול הגמל) {{x}}; "
             + ("המחיר הוא העיקר." if price else "התמהיל הוא העיקר."))
    rows_ = [["", f"פנסיה {lq(q0)}", f"פנסיה {lq(q)}", f"גמל {lq(q0)}", f"גמל {lq(q)}"],
             ["תשואת דמי ניהול"] + [f"{nf(row(c, s, k)['fy_reg'], 3)}%" for s in ("pen", "gem") for k in (q0, q)],
             ["משקל בנכסים"] + [f"{nf(w[k][s] * 100, 1)}%" for s in ("pen", "gem") for k in (q0, q)]]
    ex = table(f"{he(c)}: פירוק השינוי בתשואת דמי הניהול, מחיר מול תמהיל", rows_,
               FY_FOOT + ["אפקט מחיר = Σ משקל בבסיס × שינוי התשואה; אפקט תמהיל = Σ שינוי המשקל × התשואה החדשה", "שמונה הקבוצות: " + ", ".join(he(x) for x in cs)],
               span=f"{lq(q0)}–{lq(q)}")
    chg = changes_if("התשובה מתהפכת כשהפער מול הקבוצות חוצה את {thr}", "gap", ">=" if faster else "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"faster:{'y' if faster else 'n'}|drv:{'price' if price else 'mix'}",
                  links=[co_link(c), sav("pg"), frag_link(c, "fee")], rel=["Q-030", "Q-031", "Q-032", f"Q-{18 + MAIN8.index(c):03d}"], asof=lq(q))


def _reg_erosion(i, c):
    question(f"Q-{38 + i:03d}", f"האם תשואת דמי הניהול של {he(c)} נשחקת מהר מהמתחרים, ובגלל מחיר או תמהיל?", ["ceo", "cfo", "inv"], "fees", [c])(
        lambda A: erosion(c))


for _i, _c in enumerate(MAIN8):
    _reg_erosion(_i, _c)


# ------------------------------------------------------------------------------------------------ fee cuts and flows
@question("Q-046", "האם הורדת דמי ניהול קונה ניוד?", ["ceo", "strat", "dist", "board"], "fees")
def q046(A):
    E = load("warroom/elasticity.json")
    P = E["products"]
    pooled = E["pooled"]
    pp = P_calc("גמישות הניוד לדמי ניהול יחסיים · כל המוצרים יחד", nf(pooled["main"]["B"], 4), "% מהנכסים בחודש לכל 1 נ״ב",
                "WLS על לוח מסלולים חודשי של פנסיה, גמל והשתלמות; B = Σ מקדמי דמי הניהול היחסיים בפיגורים 0–6 (warroom/elasticity.json)",
                [(P[k]["he"], nf(P[k]["main"]["B"], 4), P[k]["prov"]) for k in P], est=True)
    t = pooled["main"]["t"]
    figs = {"t": fig("סטטיסטי t של השפעת דמי הניהול על הניוד, כל המוצרים", t, "r", pp, E["meta"]["window"], b="estimate", d=2)}
    for k, key in (("pen", "tp"), ("gemel", "tg"), ("hisht", "th")):
        if k in P:
            figs[key] = fig(f"סטטיסטי t, {P[k]['he']}", P[k]["main"]["t"], "r", P[k]["prov"], E["meta"]["window"], b="estimate", d=2)
    figs["bp"] = fig(f"ניוד בשנה לכל נ״ב של יתרון בדמי ניהול, {P['pen']['he']}", P["pen"]["per_bp_year"], "pct", P["pen"]["prov"], E["meta"]["window"], b="estimate", d=2)
    sig = [k for k in P if P[k]["main"]["t"] <= -2]
    yes = bool(sig)
    corr = ("כן, במובהק" if yes else "לא באופן מובהק") + ": סטטיסטי ה-t של השפעת דמי הניהול על הניוד, בכל המוצרים יחד, הוא {t}."
    email = (f"מודל הניוד החודשי על כל המסלולים ({E['meta']['window']}) מוצא לדמי הניהול היחסיים השפעה חלשה: t של {{tp}} בפנסיה, {{tg}} בגמל ו-{{th}} בהשתלמות "
             f"(מובהקות דורשת t של מינוס שתיים לפחות). בפנסיה, הכיוון הוא {{bp}} מהנכסים בשנה לכל נ״ב של יתרון, ברמת ביטחון נמוכה.")
    rows_ = [["מוצר", "B (% מהנכסים בחודש לנ״ב)", "t", "איכות", "ניוד בשנה לנ״ב (%)"]] + \
            [[P[k]["he"], nf(P[k]["main"]["B"], 4), nf(P[k]["main"]["t"], 2), P[k]["quality"], nf(P[k]["per_bp_year"], 2)] for k in P] + \
            [["כל המוצרים", nf(pooled["main"]["B"], 4), nf(t, 2), pooled["quality"], nf(pooled["per_bp_year"], 2)]]
    ex = table("גמישות הניוד לדמי ניהול יחסיים, לפי מוצר", rows_,
               ["אומדן: WLS עם אפקט מסלול ואפקט קטגוריה×חודש, שגיאות מקובצות לפי מסלול; כולל תשואה יחסית 12 ו-36 חודשים כמשתני בקרה",
                "דמי הניהול: השיעור הממוצע שפורסם בינואר של השנה הבאה (מוזז שנה)", E["meta"]["source"]], span=E["meta"]["window"])
    chg = changes_if("התשובה מתהפכת אם סטטיסטי ה-t יורד אל מתחת ל-{thr}", "t", "<=" if not yes else ">", -2.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[link("חדר המלחמה: מהלך דמי ניהול", "/warroom")], rel=["Q-080", "Q-032"],
                  asof=E["meta"]["window"])


# ------------------------------------------------------------------------------------------------ the nowcast of the quarter in progress
def nc_rows():
    N = load("nowcast.json")
    live = N["meta"]["live"]["q"]
    out = {}
    for l in N["ledger"]:
        if l["quarter"] == live:
            for x in l["rows"]:
                out[x["c"]] = x
    return live, out


def nc_prov(c, x, kind):
    base = lastq()
    ins = []
    for s, v in x["segs"].items():
        ms = [m for m in v.get("months") or []] if isinstance(v.get("months"), list) else []
        a_in = [(f"נכסים · {ym(m['ym'])}" + (" (אומדן)" if m.get("est") else ""), nf(m["a"], 0), None if m.get("est") else preg("assets", m["ym"], "m", s, c)) for m in ms]
        pa = P_calc(f"נכסים ממוצעים · {he(c)} · {SEG_HE[s]}", nf(v["avg"], 0), 'מיליוני ש"ח', "טרפז על סופי החודשים; החודש האחרון אומדן לפי ממוצע הזרימות שפורסמו", a_in, est=True)
        ins.append((f"תשואת דמי ניהול LTM {lq(base)} · {SEG_HE[s]}", f"{nf(v['y_tr'], 4)}%", f_fy_ltm(c, s, base)["prov"] if ltm(c, s, base) else None))
        ins.append((f"סחף מגמה · {SEG_HE[s]}", f"{nf(v['drift'], 4)} נק׳", None))
        ins.append((f"נכסים ממוצעים · {SEG_HE[s]}", nf(v["avg"], 0), pa))
        if kind == "op":
            ins.append((f"יחס עלות בסיס · {SEG_HE[s]}", "–" if v.get("ci") is None else f"{nf(v['ci'] * 100, 1)}%", None))
    f = ("הכנסות = (תשואת דמי ניהול LTM + סחף) ÷ 100 × נכסים ממוצעים × 3 ÷ 12, לכל מגזר" if kind == "rev" else
         "רווח תפעולי = הכנסות האומדן × (1 − יחס העלות של רבעוני הבסיס), לכל מגזר")
    v = x["rev"] if kind == "rev" else x["op"]
    return P_calc(f"אומדן {'הכנסות מדמי ניהול' if kind == 'rev' else 'רווח תפעולי'} · {he(c)} · {lq(x['q'])}", nf(v, 1), 'מיליוני ש"ח',
                  f + " (nowcast.json, שלב 1; מניח שיעור דמי ניהול ויחס עלות כבבסיס)", ins, est=True)


def nowcast(kind, rel):
    live, rs = nc_rows()
    base = lastq()
    items = []
    for c, x in rs.items():
        v = x["rev"] if kind == "rev" else x["op"]
        segs = [s for s in x["segs"]]
        act = [rep(c, s, base, "fees" if kind == "rev" else "op") for s in segs]
        if v is None or any(a is None for a in act):
            continue
        A_ = math.fsum(act)
        items.append((c, v, A_, (v / A_ - 1) * 100 if A_ > 0 else None, segs))
    if len(items) < 3:
        return nodata("האומדן לרבעון הנוכחי עדיין לא נבנה")
    ok = [x for x in items if x[3] is not None]
    ok.sort(key=lambda x: -x[3])
    c, v, A_, g, segs = ok[0]
    lo = ok[-1]
    word = "הכנסות מדמי ניהול" if kind == "rev" else "רווח תפעולי"
    key = "fees" if kind == "rev" else "op"

    def fe(c_, x_):
        return fig(f"אומדן {word}, {he(c_)}, {lq(live)}", x_["rev"] if kind == "rev" else x_["op"], "m", nc_prov(c_, x_, kind), lq(live), b="estimate", c=c_)

    def fa(c_, segs_):
        a = math.fsum(rep(c_, s, base, key) for s in segs_)
        return fig(f"{word} בפועל, {he(c_)}, {lq(base)}", a, "m",
                   P_calc(f"{word} · {he(c_)} · {lq(base)}", nf(a, 1), 'מיליוני ש"ח', "סכום המגזרים, מהדוח",
                          [(SEG_HE[s], nf(rep(c_, s, base, key), 1), plts_(c_, s, key, base)) for s in segs_]), lq(base), c=c_)

    figs = {"e": fe(c, rs[c]), "a": fa(c, segs)}
    figs["g"] = fig(f"שינוי QoQ באומדן, {he(c)}", g, "pct", P_calc(f"שינוי QoQ · {he(c)} · {lq(live)} מול {lq(base)}", f"{nf(g, 1)}%", "%",
                                                                f"אומדן {lq(live)} ÷ בפועל {lq(base)} − 1", [("אומדן", figs["e"]["t"], None), ("בפועל", figs["a"]["t"], None)], est=True, note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"),
                    lq(live), b="estimate", signed=True, c=c)
    figs["le"], figs["la"] = fe(lo[0], rs[lo[0]]), fa(lo[0], lo[4])
    corr = f"לפי האומדן, {he(c)} צפויה לשיפור הגדול ב{word} ב-{lq(live)}: {{g}} מול {lq(base)}."
    up = sum(1 for x in ok if x[3] > 0)
    email = (f"האומדן ל-{lq(live)}, מהחודשים שפורסמו: {he(c)} {{e}} מול {{a}} ב-{lq(base)}. בתחתית {he(lo[0])}: {{le}} מול {{la}}. "
             f"שיפור צפוי אצל {up} חברות מתוך {len(ok)} חברות. אומדן, לא תוצאה.")
    ex = hbar(f"אומדן {word} {lq(live)} מול {lq(base)}, שינוי באחוזים", "%", [(x[0], x[3]) for x in ok],
              ["אומדן (nowcast.json, שלב 1): תשואת דמי ניהול LTM בתוספת סחף מגמה × נכסים ממוצעים מהחודשים שפורסמו; עלויות לפי יחס הבסיס",
               "מניח שיעור דמי ניהול ויחס עלות כבבסיס; לא כולל הכנסות או הוצאות חד-פעמיות", SRC_REP, SRC_REG], span=f"{lq(base)}–{lq(live)}")
    chg = changes_if("התשובה בכיוון של המובילה מתהפכת אם השינוי שלה יורד אל מתחת ל-{thr}", "g", "<", 0.0)
    return answer(figs, corr, email, ex, chg, f"top:{c}|low:{lo[0]}", links=[link("אומדן הרבעון", "/nowcast"), sav(v="now")], rel=rel, asof=lq(live))


def rep(c, s, q, k):
    r = row(c, s, q)
    return None if not r or not r.get("rep") else r["rep"].get(k)


def plts_(c, s, k, q):
    return L().prov_lts(c, s, k, q)


@question("Q-047", "מה צפוי להכנסות מדמי ניהול ברבעון הנוכחי, ומי יצמח הכי מהר?", ["ceo", "cfo", "inv"], "fees")
def q047(A):
    return nowcast("rev", ["Q-048", "Q-049", "Q-006"])


@question("Q-048", "מה צפוי לרווח התפעולי מפנסיה וגמל ברבעון הנוכחי, ומי ישתפר?", ["cfo", "inv", "ceo"], "fees")
def q048(A):
    return nowcast("op", ["Q-047", "Q-049"])


@question("Q-049", "כמה מדויק האומדן הרבעוני להכנסות ולרווח?", ["cfo", "inv"], "fees")
def q049(A):
    N = load("nowcast.json")
    xs = [(c, v["s1"]) for c, v in N["summary"].items() if v.get("s1") and v["s1"].get("rev") and v["s1"].get("op")]
    if len(xs) < 3:
        return nodata("אין מספיק רבעונים בבדיקה לאחור")

    def med(v):
        v = sorted(v)
        n = len(v)
        return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2

    rv, ov = med([x["rev"]["mape"] for _, x in xs]), med([x["op"]["mape"] for _, x in xs])
    nq = sum(x["rev"]["n"] for _, x in xs)

    def p(kind, v):
        return P_calc(f"חציון סטיית האומדן ({'הכנסות' if kind == 'rev' else 'רווח תפעולי'}) · שלב 1", f"{nf(v, 1)}%", "%",
                      "חציון בין החברות של MAPE: ממוצע |אומדן ÷ בפועל − 1| על הרבעונים שנבדקו לאחור (nowcast.json summary; בפועל = דוחות החברות)",
                      [(he(c), f"{nf(x[kind]['mape'], 1)}% על {x[kind]['n']} רבעונים", None) for c, x in xs])

    figs = {"r": fig("חציון סטיית אומדן ההכנסות", rv, "pct", p("rev", rv), "בדיקה לאחור"),
            "o": fig("חציון סטיית אומדן הרווח התפעולי", ov, "pct", p("op", ov), "בדיקה לאחור")}
    good = rv <= 3
    corr = (f"{'בהכנסות כן' if good else 'בהכנסות פחות'}: חציון הסטייה של אומדן ההכנסות הוא {{r}}.")
    email = (f"בבדיקה לאחור על {len(xs)} חברות חציון הסטייה של אומדן הכנסות דמי הניהול הוא {{r}}, "
             f"ושל אומדן הרווח התפעולי {{o}}: הרווח רגיש ליחס העלות, ולכן אומדן הרווח הוא כיוון ולא מספר.")
    rows_ = [["חברה", "רבעונים", "סטיית הכנסות (MAPE)", "סטיית רווח (MAPE)", "הטיית רווח"]] + \
            [[he(c), str(x["rev"]["n"]), f"{nf(x['rev']['mape'], 1)}%", f"{nf(x['op']['mape'], 1)}%", f"{nf(x['op']['bias'], 1)}%"] for c, x in sorted(xs, key=lambda y: y[1]["op"]["mape"])]
    ex = table("דיוק האומדן הרבעוני בבדיקה לאחור, שלב 1", rows_,
               ["שלב 1: אומדן כשישה שבועות אחרי סוף הרבעון, מהחודשים שפורסמו; בפועל: דוחות החברות", "nowcast.json · שיטה " + N["meta"]["method"]])
    chg = changes_if("התשובה על ההכנסות מתהפכת כשחציון הסטייה חוצה את {thr}", "r", ">" if good else "<=", 3.0)
    return answer(figs, corr, email, ex, chg, f"rev:{'good' if good else 'weak'}", links=[link("אומדן הרבעון", "/nowcast")], rel=["Q-047", "Q-048"])


# ------------------------------------------------------------------------------------------------ profit per NIS bn and the profit pool
def ppb_rank(s, rel):
    q = lastq()
    cs = [c for c in MAIN8 + ["analyst"] if ltm(c, s, q) and ltm(c, s, q)["ppb"] is not None]
    items = sorted(((c, ltm(c, s, q)["ppb"]) for c in cs if c != "meitav"), key=lambda x: -x[1])
    top, low = items[0][0], items[-1][0]
    figs = {"top": f_ppb_ltm(top, s, q), "low": f_ppb_ltm(low, s, q), "sec": f_sector(s, q, [c for c, _ in items], "ppb")}
    corr = f"{he(top)} מרוויחה ב{SEG_HE[s]} הכי הרבה לכל מיליארד ש״ח נכסים: {{top}} בשנה."
    email = (f"ב-LTM {lq(q)} {he(top)} הרוויחה ב{SEG_HE[s]} {{top}} רווח תפעולי לכל מיליארד ש״ח נכסים, מול {{sec}} בענף. "
             f"בתחתית {he(low)}, {{low}}" + (": מפסידה על כל שקל נכסים." if items[-1][1] < 0 else "."))
    show = items + ([("meitav", ltm("meitav", s, q)["ppb"])] if "meitav" in cs else [])
    ex = hbar(f"רווח תפעולי לכל ₪ מיליארד נכסים, {SEG_HE[s]}, LTM {lq(q)}", 'מיליוני ש"ח', show,
              ["Σ רווח תפעולי ארבעה רבעונים (מהדוח) ÷ נכסים ממוצעים (רשות) במיליארדים", MEITAV_NOTE, SRC_REP, SRC_REG], span=f"LTM {lq(q)}")
    chg = changes_if(f"המובילה מתחלפת אם הרווח של {he(top)} יורד אל מתחת ל-{{thr}}", "top", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top}|low:{low}", links=[sav(s, "econ")], rel=rel, asof=f"LTM {lq(q)}")


@question("Q-067", "מי מרוויח בפנסיה הכי הרבה לכל מיליארד ש״ח נכסים?", ["ceo", "cfo", "inv", "board"], "fees")
def q067(A):
    return ppb_rank("pen", ["Q-068", "Q-066", "Q-060"])


@question("Q-068", "מי מרוויח בגמל והשתלמות הכי הרבה לכל מיליארד ש״ח נכסים?", ["ceo", "cfo", "inv", "board"], "fees")
def q068(A):
    return ppb_rank("gem", ["Q-067", "Q-066"])


@question("Q-066", "מי לוקח את רוב הרווח בענף הפנסיה והגמל, ביחס לנכסים שלו?", ["board", "inv", "strat", "ceo"], "fees")
def q066(A):
    q, s = lastq(), "pg"
    cs = [c for c in MAIN8 + ["analyst"] if ltm(c, s, q) and ltm(c, s, q)["op"] is not None]
    O = math.fsum(ltm(c, s, q)["op"] for c in cs)
    Av = math.fsum(ltm(c, s, q)["avg"] for c in cs)
    items = sorted(((c, ltm(c, s, q)["op"] / O * 100, ltm(c, s, q)["avg"] / Av * 100) for c in cs), key=lambda x: -x[1])
    top = items[0]
    over = max(items, key=lambda x: x[1] - x[2])
    figs = {"tot": fig("רווח תפעולי LTM, כל החברות, פנסיה וגמל", O, "m",
                       P_calc(f"רווח תפעולי LTM · החברות המכוסות · פנסיה וגמל · {lq(q)}", nf(O, 1), 'מיליוני ש"ח', "סכום החברות",
                              [(he(c), nf(ltm(c, s, q)["op"], 1), f_sum_ltm(c, s, q, "op")["prov"]) for c in cs]), f"LTM {lq(q)}")}

    def sh(c, which):
        o = ltm(c, s, q)
        v = (o["op"] / O if which == "op" else o["avg"] / Av) * 100
        lab = "נתח מהרווח התפעולי" if which == "op" else "נתח מהנכסים הממוצעים"
        return fig(f"{lab}, {he(c)}", v, "pct",
                   P_calc(f"{lab} · {he(c)} · LTM {lq(q)}", f"{nf(v, 1)}%", "%", f"{'רווח תפעולי' if which == 'op' else 'נכסים ממוצעים'} של החברה ÷ סכום החברות המכוסות × 100",
                          [(he(c), nf(o["op"] if which == "op" else o["avg"], 1), f_sum_ltm(c, s, q, "op")["prov"] if which == "op" else None),
                           ("כל החברות", figs["tot"]["t"] if which == "op" else nf(Av, 0), None)], note="סך הרווח של כל החברות: הנתון בתשובה זו"),
                   f"LTM {lq(q)}", c=c)

    figs.update({"to": sh(top[0], "op"), "ta": sh(top[0], "avg"), "oo": sh(over[0], "op"), "oa": sh(over[0], "avg")})
    corr = f"{he(top[0])} לוקחת את הנתח הגדול מהרווח התפעולי בפנסיה ובגמל: {{to}}."
    email = (f"ב-LTM {lq(q)} הרוויחו החברות המכוסות {{tot}} מפנסיה וגמל. {he(top[0])} לקחה {{to}} מהרווח עם {{ta}} מהנכסים. "
             + (f"הפער הגדול בין רווח לנכסים אצל {he(over[0])}: {{oo}} מהרווח מול {{oa}} מהנכסים." if over[0] != top[0] else "היא גם בעלת הפער הגדול בין רווח לנכסים."))
    if over[0] == "meitav":
        email += " אצל מיטב הרווח המגזרי לפני דמי ניהול לחברה האם."
    ex = exhibit_pool(items, q)
    chg = changes_if(f"המובילה מתחלפת אם הנתח של {he(top[0])} יורד אל מתחת ל-{{thr}}", "to", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{top[0]}|over:{over[0]}", links=[sav("pg", "econ")], rel=["Q-067", "Q-068", "Q-060"], asof=f"LTM {lq(q)}")


def exhibit_pool(items, q):
    from answer_core import exhibit
    return exhibit("hbar", f"נתח מהרווח התפעולי מול נתח מהנכסים, פנסיה וגמל, LTM {lq(q)}", "%", [he(c) for c, _, _ in items],
                   [{"name": "נתח מהרווח התפעולי", "type": "bar", "data": [round(o, 3) for _, o, _ in items]},
                    {"name": "נתח מהנכסים הממוצעים", "type": "bar", "data": [round(a, 3) for _, _, a in items]}],
                   ["החברות המכוסות בדוחות מגזריים; רווח תפעולי = דמי ניהול − שיווק ומכירה − הנהלה וכלליות", MEITAV_NOTE, SRC_REP, SRC_REG], span=f"LTM {lq(q)}")
