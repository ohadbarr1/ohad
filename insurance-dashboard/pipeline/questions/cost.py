"""Cost structure: cost / income and the gap to best-in-class, who loses money at scale, cost creep, the cost of buying flow, G&A
per NIS bn, operating leverage.

Sources: lens.json (segment P&L as printed: fees, selling & marketing, G&A, operating profit; regulator average assets), lts.json
(gross transfers into the funds; S&M over assets of the covered companies).
Meitav's segment G&A is before the management fee it pays its parent (lts.json marks): shown, never ranked as best-in-class.
"""
import math

from answer_core import P_calc, SEG_HE, answer, changes_if, fig, he, lq, nf, nodata, question
from questions._sav import (_avg_ltm_input, MAIN8, MEITAV_NOTE, SRC_LTS, SRC_REG, SRC_REP, L, co_link, f_bp, f_ci_ltm, f_lts, f_pp, f_sector, f_sum_ltm,
                            frag_link, hbar, lastq, lines, ltm, lv, names, qback, qwin, sav, sector, table)

CI_FOOT = ["יחס הוצאות להכנסות = (שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול × 100, ארבעה רבעונים (LTM), כפי שבביאור המגזרים",
           MEITAV_NOTE, SRC_REP]
PEERS = MAIN8 + ["analyst"]


def ci_items(s, q, excl_mark=True):
    return [(c, ltm(c, s, q)["ci"]) for c in PEERS if ltm(c, s, q) and ltm(c, s, q)["ci"] is not None and not (excl_mark and c == "meitav")]


def efficient(s, rel):
    q = lastq()
    items = sorted(ci_items(s, q), key=lambda x: x[1])
    if len(items) < 3:
        return nodata("אין מספיק חברות עם ארבעה רבעונים מדווחים")
    best, worst = items[0][0], items[-1][0]
    figs = {"best": f_ci_ltm(best, s, q), "worst": f_ci_ltm(worst, s, q), "sec": f_sector(s, q, [c for c, _ in items], "ci")}
    corr = f"{he(best)} היעילה ביותר ב{SEG_HE[s]}: יחס הוצאות להכנסות של {{best}} ב-LTM."
    email = (f"ב-LTM {lq(q)} {he(best)} הוציאה ב{SEG_HE[s]} {{best}} מהכנסות דמי הניהול על שיווק, מכירה, הנהלה וכלליות, מול {{sec}} בענף. "
             f"היקרה ביותר: {he(worst)}, {{worst}}.")
    show = items + ([("meitav", ltm("meitav", s, q)["ci"])] if ltm("meitav", s, q) and ltm("meitav", s, q)["ci"] is not None else [])
    ex = hbar(f"יחס הוצאות להכנסות LTM, {SEG_HE[s]}, עד {lq(q)}", "%", show, CI_FOOT, span=f"LTM {lq(q)}")
    chg = changes_if(f"המובילה מתחלפת אם היחס של {he(best)} עולה מעל {{thr}}", "best", ">", items[1][1])
    return answer(figs, corr, email, ex, chg, f"best:{best}|worst:{worst}", links=[sav(s, "econ"), frag_link(sig="cost")], rel=rel, asof=f"LTM {lq(q)}")


@question("Q-050", "מי מנהל את הפנסיה ביעילות הגבוהה ביותר?", ["ceo", "cfo", "board", "inv"], "cost")
def q050(A):
    return efficient("pen", ["Q-051", "Q-060", "Q-067"])


@question("Q-051", "מי מנהל את הגמל וההשתלמות ביעילות הגבוהה ביותר?", ["ceo", "cfo", "board", "inv"], "cost")
def q051(A):
    return efficient("gem", ["Q-050", "Q-068"])


def gap_to_best(c):
    q, s = lastq(), "pg"
    o = ltm(c, s, q)
    if not o or o["ci"] is None:
        return nodata(f"ל{he(c)} אין ארבעה רבעונים מדווחים בפנסיה ובגמל")
    items = sorted(ci_items(s, q), key=lambda x: x[1])
    best = next(x for x, _ in items if x != c)
    ob = ltm(best, s, q)
    fc, fb = f_ci_ltm(c, s, q), f_ci_ltm(best, s, q)
    gap = o["ci"] - ob["ci"]
    figs = {"ci": fc, "best": fb, "gap": f_pp(f"פער יחס העלות של {he(c)} מ{he(best)}", o["ci"], ob["ci"], fc, fb, f"LTM {lq(q)}", c=c, local=True, d=1),
            "fees": f_sum_ltm(c, s, q, "fees")}
    val = gap / 100 * o["fees"]
    figs["val"] = fig(f"רווח תפעולי שנתי נוסף בסגירת הפער, {he(c)}", val, "m",
                      P_calc(f"שווי סגירת הפער · {he(c)} · LTM {lq(q)}", nf(val, 1), 'מיליוני ש"ח', "פער יחס העלות ÷ 100 × הכנסות מדמי ניהול LTM; הכנסות קבועות",
                             [("פער יחס העלות", figs["gap"]["t"], None), ("הכנסות מדמי ניהול LTM", figs["fees"]["t"], None)], est=True,
                             note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), f"LTM {lq(q)}", b="estimate", c=c)
    is_best = gap <= 0
    mark = c == "meitav"
    if mark:
        corr = f"על הנייר {he(c)} יעילה מכולן, עם יחס הוצאות להכנסות של {{ci}} בפנסיה ובגמל, אבל היחס אינו בר השוואה."
        tail = f"היעילה מבין החברות ברות ההשוואה: {he(best)}, {{best}}."
    elif is_best:
        corr = f"{he(c)} היא היעילה בענף: יחס הוצאות להכנסות של {{ci}} בפנסיה ובגמל, מתחת לכל העמיתים."
        tail = f"השנייה, {he(best)}, ב-{{best}}; פער של {{gap}}."
    else:
        corr = f"{he(c)} רחוקה {{gap}} מהיעילה בענף ביחס הוצאות להכנסות בפנסיה ובגמל."
        tail = f"סגירת הפער ל{he(best)} ({{best}}) שווה כ-{{val}} רווח תפעולי בשנה, בהכנסות של {{fees}} (אומדן, בהנחת הכנסות קבועות)."
    email = f"ב-LTM {lq(q)} יחס ההוצאות להכנסות של {he(c)} בפנסיה ובגמל הוא {{ci}}. " + tail
    if mark:
        email += " מיטב רושמת את רוב התקורה בדמי ניהול לחברה האם, מחוץ למגזר, ולכן היחס שלה נמוך מהבר-השוואה."
    qs = L().quarters[-8:]

    def ser(x):
        return [None if not ltm(x, s, k) else ltm(x, s, k)["ci"] for k in qs]

    ex = lines(f"יחס הוצאות להכנסות LTM, פנסיה וגמל: {he(c)} מול {he(best)} והענף", "%", qs,
               [(he(c), ser(c)), (he(best), ser(best)), ("הענף", [sector(s, k, [x for x, _ in ci_items(s, k)], "ci") if all(ltm(x, s, k) for x, _ in ci_items(s, k)) else None for k in qs])],
               CI_FOOT + ["הענף: " + ", ".join(he(x) for x, _ in items)])
    chg = changes_if(f"התשובה משתנה כשהפער מ{he(best)} חוצה את {{thr}}", "gap", "<=" if not is_best else ">", 0.0)
    vk = "mark" if mark else ("best" if is_best else f"gap|best:{best}")
    return answer(figs, corr, email, ex, chg, vk, links=[co_link(c), sav("pg", "econ"), frag_link(c, "cost")],
                  rel=["Q-050", "Q-051", "Q-061", f"Q-{38 + MAIN8.index(c):03d}"], asof=f"LTM {lq(q)}")


def _reg_gap(i, c):
    question(f"Q-{52 + i:03d}", f"כמה רחוקה {he(c)} מהיעילה בענף ביחס העלות בפנסיה ובגמל, ומה שווה סגירת הפער?", ["ceo", "cfo", "board"], "cost", [c])(
        lambda A: gap_to_best(c))


for _i, _c in enumerate(MAIN8):
    _reg_gap(_i, _c)


@question("Q-060", "איזה מנהל מפסיד כסף בהיקף, ובאיזה מוצר?", ["board", "inv", "ceo", "cfo"], "cost")
def q060(A):
    q = lastq()
    xs = [(c, s, ltm(c, s, q)["op"]) for s in ("pen", "gem") for c in PEERS if ltm(c, s, q) and ltm(c, s, q)["op"] is not None]
    xs.sort(key=lambda x: x[2])
    c, s, v = xs[0]
    loss = [x for x in xs if x[2] < 0]
    figs = {"op": f_sum_ltm(c, s, q, "op"), "fees": f_sum_ltm(c, s, q, "fees"), "ci": f_ci_ltm(c, s, q)}
    if loss:
        corr = f"{he(c)} ב{SEG_HE[s]}: הפסד תפעולי של {{op}} בארבעת הרבעונים האחרונים."
        others = [f"{he(x)} ב{SEG_HE[y]}" for x, y, _ in loss[1:]]
        email = (f"ב-LTM {lq(q)} {he(c)} הכניסה ב{SEG_HE[s]} {{fees}} מדמי ניהול והוציאה {{ci}} מהם על שיווק, מכירה והנהלה: הפסד תפעולי של {{op}}. "
                 + (f"מפסידות גם: {', '.join(others)}." if others else "אין עוד מגזר מפסיד בקבוצות הגדולות."))
        vk = "loss:" + ",".join(f"{x}.{y}" for x, y, _ in loss)
    else:
        corr = f"אף מנהל אינו מפסיד: הרווח הנמוך הוא של {he(c)} ב{SEG_HE[s]}, {{op}} בארבעת הרבעונים האחרונים."
        email = f"ב-LTM {lq(q)} {he(c)} הכניסה ב{SEG_HE[s]} {{fees}} והוציאה {{ci}} מהם; רווח תפעולי של {{op}}, הנמוך בקבוצות הגדולות."
        vk = "loss:none"
    rows_ = [["חברה", "מוצר", "הכנסות LTM (מיליוני ש\"ח)", "רווח תפעולי LTM (מיליוני ש\"ח)", "יחס הוצאות"]] + \
            [[he(x), SEG_HE[y], nf(ltm(x, y, q)["fees"], 0), nf(v_, 1), f"{nf(ltm(x, y, q)['ci'], 1)}%"] for x, y, v_ in xs[:8]]
    ex = table(f"הרווח התפעולי הנמוך בענף, LTM {lq(q)}", rows_, CI_FOOT, span=f"LTM {lq(q)}")
    chg = changes_if(f"התשובה משתנה כשהרווח של {he(c)} ב{SEG_HE[s]} חוצה את {{thr}}", "op", ">=" if loss else "<", 0.0)
    return answer(figs, corr, email, ex, chg, vk, links=[co_link(c), sav(s, "econ")], rel=["Q-067", "Q-029", "Q-050"], asof=f"LTM {lq(q)}")


@question("Q-061", "מי מגדיל עלויות מהר מההכנסות?", ["cfo", "board", "inv"], "cost")
def q061(A):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    items = []
    for c in PEERS:
        a, b = ltm(c, s, q), ltm(c, s, q0)
        if a and b and a["ci"] is not None and b["ci"] is not None:
            items.append((c, a["ci"] - b["ci"]))
    if len(items) < 3:
        return nodata("אין מספיק חברות עם שמונה רבעונים מדווחים")
    items.sort(key=lambda x: -x[1])
    c = items[0][0]
    fa, fb = f_ci_ltm(c, s, q), f_ci_ltm(c, s, q0)
    figs = {"d": f_pp(f"שינוי ביחס ההוצאות להכנסות LTM, {he(c)}, YoY", fa["v"], fb["v"], fa, fb, f"LTM {lq(q)}", c=c, local=True, d=1), "a": fa, "b": fb}
    up = [x for x, v in items if v > 0]
    yes = items[0][1] > 0
    corr = (f"{he(c)}: יחס ההוצאות להכנסות שלה בפנסיה ובגמל השתנה ב-{{d}} בשנה, העלייה החדה בענף." if yes else
            f"אף חברה: גם אצל {he(c)} יחס ההוצאות להכנסות השתנה רק ב-{{d}} בשנה.")
    email = (f"יחס ההוצאות להכנסות של {he(c)} בפנסיה ובגמל: {{a}} ב-LTM {lq(q)} מול {{b}} ב-LTM {lq(q0)}. "
             + (f"עלייה גם אצל {names([x for x in up if x != c])}." if len(up) > 1 else "אצל שאר החברות היחס ירד."))
    ex = hbar(f"שינוי ביחס ההוצאות להכנסות LTM, פנסיה וגמל, YoY עד {lq(q)}", "נק׳ אחוז", items, CI_FOOT, span=f"LTM {lq(q0)}–LTM {lq(q)}")
    chg = changes_if(f"המובילה מתחלפת אם העלייה של {he(c)} יורדת אל מתחת ל-{{thr}}", "d", "<", items[1][1])
    return answer(figs, corr, email, ex, chg, f"top:{c}|up:{len(up)}", links=[frag_link(sig="cost"), sav("pg", "econ")], rel=["Q-064", "Q-065"], asof=f"LTM {lq(q)}")


@question("Q-062", "כמה עולה לקנות שקל של ניוד, לפי הוצאות השיווק והמכירה?", ["dist", "ceo", "cfo", "strat"], "cost")
def q062(A):
    q = lastq()
    qs = qwin(q, 4)
    items = []
    for c in MAIN8:
        o = {s: ltm(c, s, q) for s in ("pen", "gem")}
        tin = [lv(c, s, "tr_in", k) for s in ("pen", "gem") for k in qs]
        if any(o[s] is None or o[s]["sm"] is None for s in o) or any(x is None for x in tin):
            continue
        sm = o["pen"]["sm"] + o["gem"]["sm"]
        items.append((c, sm / (math.fsum(tin) * 1000) * 100, sm, math.fsum(tin)))
    if len(items) < 3:
        return nodata("העברות הצבירה לקרנות לא פורסמו לכל הרבעונים")
    items.sort(key=lambda x: x[1])

    def f(c, v, sm, tin):
        ins = [(f"שיווק ומכירה LTM · {SEG_HE[s]}", nf(ltm(c, s, q)["sm"], 1), f_sum_ltm(c, s, q, "sm")["prov"]) for s in ("pen", "gem")] + \
              [(f"העברות צבירה לקרן · {SEG_HE[s]} · {lq(k)}", nf(lv(c, s, "tr_in", k), 3), f_lts(c, s, "tr_in", k)["prov"]) for s in ("pen", "gem") for k in qs]
        return fig(f"שיווק ומכירה ÷ העברות צבירה נכנסות, {he(c)}", v, "pct",
                   P_calc(f"עלות שיווק לשקל ניוד נכנס · {he(c)} · LTM {lq(q)}", f"{nf(v, 2)}%", "%",
                          "Σ שיווק ומכירה LTM (פנסיה + גמל, מהביאור) ÷ Σ העברות צבירה לקרנות LTM (טבלת סוגי הקרנות, ברוטו) × 100", ins), f"LTM {lq(q)}", c=c)

    lo, hi = items[0], items[-1]
    figs = {"lo": f(*lo), "hi": f(*hi)}
    corr = f"{he(lo[0])} קונה ניוד בזול: הוצאות השיווק והמכירה שלה הן {{lo}} מהעברות הצבירה הנכנסות."
    email = (f"ב-LTM {lq(q)} הוציאה {he(lo[0])} על שיווק ומכירה בפנסיה ובגמל {{lo}} מסכום העברות הצבירה שנכנסו לקרנותיה; "
             f"היקרה: {he(hi[0])}, {{hi}}. הוצאות השיווק כוללות עמלות על התיק הקיים, ולכן זה חסם עליון לעלות הרכישה.")
    ex = hbar(f"שיווק ומכירה ÷ העברות צבירה נכנסות, פנסיה וגמל, LTM {lq(q)}", "%", [(c, v) for c, v, _, _ in items],
              ["מונה: עמלות, שיווק והוצאות רכישה אחרות (ביאור מגזרים); מכנה: העברות צבירה לקרן, ברוטו, כולל מעברים בין מסלולים", SRC_REP, SRC_LTS],
              span=f"LTM {lq(q)}")
    chg = changes_if(f"הזולה מתחלפת אם היחס של {he(lo[0])} עולה מעל {{thr}}", "lo", ">", items[1][1])
    return answer(figs, corr, email, ex, chg, f"lo:{lo[0]}|hi:{hi[0]}", links=[sav("pg", "econ")], rel=["Q-002", "Q-013", "Q-069"], asof=f"LTM {lq(q)}")


@question("Q-063", "מי הרזה ביותר בהנהלה וכלליות, לכל מיליארד ש״ח נכסים?", ["cfo", "ceo", "board"], "cost")
def q063(A):
    q, s = lastq(), "pg"
    items = sorted(((c, ltm(c, s, q)["gab"]) for c in PEERS if c != "meitav" and ltm(c, s, q) and ltm(c, s, q)["gab"] is not None), key=lambda x: x[1])
    if len(items) < 3:
        return nodata("אין מספיק חברות עם ארבעה רבעונים מדווחים")

    def f(c):
        o = ltm(c, s, q)
        ga = f_sum_ltm(c, s, q, "ga")
        return fig(f"הנהלה וכלליות לנכסים LTM, {he(c)}", o["gab"], "bp",
                   P_calc(f"הנהלה וכלליות לנכסים · {he(c)} · LTM {lq(q)}", f"{nf(o['gab'], 1)} נ״ב", "נ״ב",
                          "Σ הנהלה וכלליות ארבעה רבעונים (מהביאור) ÷ ממוצע הנכסים הממוצעים (רשות) × 10,000",
                          [("הנהלה וכלליות LTM", ga["t"], ga["prov"]), _avg_ltm_input(c, s, o)]), f"LTM {lq(q)}", d=1, c=c, t=f"{nf(o['gab'], 1)} נ״ב")

    lo, hi = items[0][0], items[-1][0]
    figs = {"lo": f(lo), "hi": f(hi)}
    corr = f"{he(lo)} הרזה ביותר: הנהלה וכלליות של {{lo}} מהנכסים בשנה, בפנסיה ובגמל."
    email = f"ב-LTM {lq(q)} {he(lo)} הוציאה על הנהלה וכלליות בפנסיה ובגמל {{lo}} מהנכסים המנוהלים; הכבדה ביותר: {he(hi)}, {{hi}}."
    ex = hbar(f"הנהלה וכלליות לנכסים, פנסיה וגמל, LTM {lq(q)}", "נ״ב", items, ["Σ הנהלה וכלליות LTM ÷ נכסים ממוצעים × 10,000", MEITAV_NOTE, SRC_REP, SRC_REG],
              span=f"LTM {lq(q)}")
    chg = changes_if(f"הרזה מתחלפת אם היחס של {he(lo)} עולה מעל {{thr}}", "lo", ">", items[1][1])
    return answer(figs, corr, email, ex, chg, f"lo:{lo}|hi:{hi}", links=[sav("pg", "econ")], rel=["Q-050", "Q-051"], asof=f"LTM {lq(q)}")


@question("Q-064", "האם הענף נעשה יעיל יותר?", ["board", "reg", "inv", "ceo"], "cost")
def q064(A):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    cs = [c for c, _ in ci_items(s, q) if ltm(c, s, q0) and ltm(c, s, q0)["ci"] is not None]
    a, b = f_sector(s, q, cs, "ci"), f_sector(s, q0, cs, "ci", label=f"יחס הוצאות להכנסות LTM, הענף, פנסיה וגמל, {lq(q0)}")
    b["asof"] = f"LTM {lq(q0)}"
    figs = {"a": a, "b": b, "d": f_pp("שינוי ביחס ההוצאות להכנסות של הענף, YoY", a["v"], b["v"], a, b, f"LTM {lq(q)}", local=True, d=1)}
    yes = figs["d"]["v"] < 0
    corr = f"{'כן' if yes else 'לא'}: יחס ההוצאות להכנסות של הענף בפנסיה ובגמל השתנה ב-{{d}} בשנה."
    email = (f"ב-LTM {lq(q)} הוציאו החברות המכוסות {{a}} מהכנסות דמי הניהול על שיווק, מכירה, הנהלה וכלליות, מול {{b}} שנה קודם. "
             f"החברות: {names(cs)}; מיטב מחוץ לחישוב.")
    qs = L().quarters[-7:]
    ex = lines("יחס הוצאות להכנסות LTM, הענף, פנסיה וגמל", "%", qs,
               [("הענף", [sector(s, k, cs, "ci") if all(ltm(c, s, k) and ltm(c, s, k)["ci"] is not None for c in cs) else None for k in qs])], CI_FOOT)
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי חוצה את {thr}", "d", ">=" if yes else "<", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav("pg", "econ")], rel=["Q-061", "Q-065"], asof=f"LTM {lq(q)}")


@question("Q-065", "האם הצמיחה בנכסים מתורגמת לצמיחה ברווח?", ["board", "inv", "cfo"], "cost")
def q065(A):
    q, s = lastq(), "pg"
    q0 = qback(q, 4)
    cs = [c for c in PEERS if ltm(c, s, q) and ltm(c, s, q0) and ltm(c, s, q)["op"] is not None and ltm(c, s, q0)["op"] is not None]
    O1, O0 = math.fsum(ltm(c, s, q)["op"] for c in cs), math.fsum(ltm(c, s, q0)["op"] for c in cs)
    A1, A0 = math.fsum(ltm(c, s, q)["avg"] for c in cs), math.fsum(ltm(c, s, q0)["avg"] for c in cs)
    go, ga = (O1 / O0 - 1) * 100, (A1 / A0 - 1) * 100

    def tot(k, qq):
        return fig(f"{'רווח תפעולי' if k == 'op' else 'הכנסות מדמי ניהול'} LTM, החברות המכוסות, {lq(qq)}", math.fsum(ltm(c, s, qq)[k] for c in cs), "m",
                   P_calc(f"{'רווח תפעולי' if k == 'op' else 'הכנסות'} LTM · החברות המכוסות · פנסיה וגמל · {lq(qq)}", nf(math.fsum(ltm(c, s, qq)[k] for c in cs), 1),
                          'מיליוני ש"ח', "סכום החברות", [(he(c), nf(ltm(c, s, qq)[k], 1), f_sum_ltm(c, s, qq, k)["prov"]) for c in cs]), f"LTM {lq(qq)}")

    o1, o0 = tot("op", q), tot("op", q0)
    figs = {"o1": o1, "o0": o0}
    figs["go"] = fig("צמיחת הרווח התפעולי LTM, YoY", go, "pct",
                     P_calc("צמיחת הרווח התפעולי LTM", f"{nf(go, 1)}%", "%", "LTM ÷ LTM שנה קודם − 1", [("LTM", o1["t"], None), ("שנה קודם", o0["t"], None)],
                            note="שני הנתונים מופיעים בתשובה זו, כל אחד עם מקורו"), f"LTM {lq(q)}", signed=True)
    figs["ga"] = fig("צמיחת הנכסים הממוצעים LTM, YoY", ga, "pct",
                     P_calc("צמיחת הנכסים הממוצעים LTM", f"{nf(ga, 1)}%", "%", "ממוצע הנכסים הממוצעים הרבעוניים (רשות), LTM ÷ שנה קודם − 1",
                            [(f"{he(c)} · {lab}", nf(ltm(c, s, k)["avg"], 0), _avg_ltm_input(c, s, ltm(c, s, k))[2]) for c in cs for k, lab in ((q, "LTM"), (q0, "שנה קודם"))]),
                     f"LTM {lq(q)}", signed=True)
    yes = go > ga
    corr = f"{'כן, עם מינוף' if yes else 'לא במלואה'}: הרווח התפעולי מפנסיה וגמל צמח ב-{{go}} בשנה."
    email = (f"ב-LTM {lq(q)} הרוויחו החברות המכוסות {{o1}} מפנסיה וגמל, מול {{o0}} שנה קודם: צמיחה של {{go}}, "
             f"מול צמיחה של {{ga}} בנכסים הממוצעים. " + ("ההוצאות גדלו לאט מההכנסות." if yes else "ההוצאות ושחיקת דמי הניהול אכלו את הצמיחה."))
    rows_ = [["חברה", "צמיחת נכסים ממוצעים", "צמיחת רווח תפעולי"]] + \
            [[he(c), f"{nf((ltm(c, s, q)['avg'] / ltm(c, s, q0)['avg'] - 1) * 100, 1)}%",
              "–" if ltm(c, s, q0)["op"] <= 0 else f"{nf((ltm(c, s, q)['op'] / ltm(c, s, q0)['op'] - 1) * 100, 1)}%"] for c in cs]
    ex = table(f"צמיחת נכסים מול צמיחת רווח, פנסיה וגמל, LTM {lq(q)} מול LTM {lq(q0)}", rows_,
               ["רווח תפעולי = דמי ניהול − שיווק ומכירה − הנהלה וכלליות (ביאור מגזרים); נכסים ממוצעים: רשות", "– : הבסיס שלילי או אפס", MEITAV_NOTE, SRC_REP, SRC_REG])
    figs["gap"] = fig("פער צמיחת הרווח על צמיחת הנכסים", go - ga, "pp",
                      P_calc("פער צמיחה", nf(go - ga, 1), "נק׳ אחוז", "צמיחת הרווח − צמיחת הנכסים", [("רווח", figs["go"]["t"], None), ("נכסים", figs["ga"]["t"], None)],
                             note="שני הנתונים מופיעים בתשובה זו"), f"LTM {lq(q)}", d=1)
    chg = changes_if("התשובה מתהפכת כשפער הצמיחה חוצה את {thr}", "gap", "<=" if yes else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav("pg", "econ")], rel=["Q-064", "Q-066"], asof=f"LTM {lq(q)}")


@question("Q-069", "האם עלות השיווק בפנסיה עולה, ביחס לנכסים?", ["cfo", "dist", "board"], "cost")
def q069(A):
    q = lastq()
    q0 = qback(q, 4)
    a, b = f_lts(None, "pen", "sm_aum", q, d=3), f_lts(None, "pen", "sm_aum", q0, d=3)
    ga, gb = f_lts(None, "pen", "ga_aum", q, d=3), f_lts(None, "pen", "ga_aum", q0, d=3)
    if not all((a, b, ga, gb)):
        return nodata("יחסי ההוצאות לנכסים של החברות המכוסות חסרים לאחד הרבעונים")
    figs = {"a": a, "b": b, "ga": ga, "gb": gb, "d": f_bp("שינוי בשיווק ומכירה לנכסים, YoY", a["v"], b["v"], a, b, lq(q), local=True)}
    yes = figs["d"]["v"] > 0
    corr = f"{'כן' if yes else 'לא'}: הוצאות השיווק והמכירה בפנסיה ביחס לנכסים השתנו ב-{{d}} בשנה."
    email = (f"ב-{lq(q)} הוציאו החברות המכוסות על שיווק ומכירה בפנסיה {{a}} מהנכסים בשנה, מול {{b}} ב-{lq(q0)}; "
             f"על הנהלה וכלליות {{ga}}, מול {{gb}}.")
    qs = L().quarters[-8:]
    ex = lines("פנסיה: הוצאות לנכסים, שנתי, החברות המכוסות", "%", qs,
               [("שיווק ומכירה", [lv(None, "pen", "sm_aum", k) for k in qs]), ("הנהלה וכלליות", [lv(None, "pen", "ga_aum", k) for k in qs])],
               ["הוצאה ברבעון × 4 ÷ נכסים ממוצעים × 100", SRC_LTS])
    chg = changes_if("התשובה מתהפכת כשהשינוי השנתי חוצה את {thr}", "d", "<=" if yes else ">", 0.0)
    return answer(figs, corr, email, ex, chg, "yes" if yes else "no", links=[sav("pen", "econ")], rel=["Q-062", "Q-050"], asof=lq(q))
