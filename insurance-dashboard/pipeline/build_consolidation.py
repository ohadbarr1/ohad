"""A9 · Consolidation Screen: every acquirer × target pair among the long-term-savings managers whose costs are printed.

The unit is a company's pension and provident / study-fund business (פנסיה, גמל והשתלמות): the products whose fees, selling and G&A
costs the managing companies print (A1 driver files). Savings policies and managers' insurance are outside the scope (no cost lines).

    Synergy (per product s the target runs, NIS m a year, pre-tax)
        gross_s  = target AUM_s × fee yield_s ÷ 100 × (c/i target_s − c/i acquirer_s) ÷ 100
                   positive when the acquirer runs the product at a lower cost per NIS of fees (the target is brought to its ratio);
                   an acquirer that does not run s is taken at its blended pension + provident c/i (labelled)
        net_s    = gross_s × realisation ÷ 100                                        (haircut: an assumption, overridable)
        NPV      = Σ net_s × (1 − tax) × a(H_s, ke) − integration × max(Σ gross, 0) × (1 − tax)
                   a(H, ke) = (1 − (1 + ke)^−H) ÷ ke;  H_s = the M3 book duration of product s (flow_npv.json) unless overridden
    Capacity to pay = cash capacity + debt headroom
        cash     = A7 distributable capital (insurers, capital/options.json logic) floored at 0; a fund house has no A7 figure: its
                   equity attributable (A1) as the ceiling, labelled
        headroom = max(0, L ÷ (1 − L) × equity − debt);  debt = the ת126 wall principal (A1), L = the labelled maximum debt ÷ (debt +
                   equity), default the peer median
    Price at a premium p over the justified standalone value V0
        V0       = listed fund house: A1 justified P/B × equity attributable (the whole company, a valuation input, not a market price);
                   an insurer's savings arm (not separately listed): after-tax LTM operating profit × justified P/E 1 ÷ (ke − g)
        floor    = target pension + provident AUM (06/26) × the median market value per NIS bn of AUM of the listed fund houses whose
                   business is mostly long-term savings (Meitav, Altshuler, More, Analyst; Yelin excluded: its listed share is Atrao's);
                   V0 = max(justified, floor), the binding one labelled per target; the premia apply on top
        financing: cash first (up to the cash capacity), the rest debt; affordable when the debt fits the headroom
    Accretion (LTM, run-rate synergy, integration cost excluded, no new shares)
        ΔNP      = target earnings + Σ net × (1 − tax) − cash × rf × (1 − tax) − debt × (rf + spread) × (1 − tax)
        EPS %    = ΔNP ÷ acquirer LTM net profit × 100;  ΔROE pp = ΔNP ÷ acquirer average equity × 100
        ROIC     = (target earnings + Σ net × (1 − tax)) ÷ price × 100
    Solvency cost (insurer acquirers): − cash ÷ SCR × 100 (A7 mechanics: the surplus leaves own funds like a dividend; the debt is raised
        at the holding company); and, stated as the alternative booking, − goodwill ÷ SCR × 100 (target held by the insurer: own funds
        fall by price − target equity, Solvency II deducts goodwill)
    Fit: three components, no composite. Product overlap Σ min(weight acquirer, weight target) over the regulator's pension / provident
        products (AUM 06/26); track crowding the same over the track categories of funds.json (08/26); channel overlap: no data.
    Ranking: one primary metric, synergy NPV ÷ price at a 20% premium (the order is the same at every premium). Pairs with a company
        whose cost lines are not comparable (lens.json marks) are shown, flagged, and not ranked.

Inputs: web/public/data/drivers/<co>.json (A1), the A7 capital logic (pipeline/build_capital.py, in memory: no cycle with its bolt-on
row), lens.json (the More example), market.json (product AUM), funds.json (track categories), flow_npv.json (durations).
Outputs: web/public/data/consolidation/matrix.json, consolidation/pairs/<acq>__<tgt>.json; the bolt-on of each A7 insurer is the
`bolt` section of matrix.json, read by build_capital.py.

python3 pipeline/build_consolidation.py           build
python3 pipeline/build_consolidation.py --check   rebuild in memory, compare with the files, verify (synergy identity, capacity and
                                                  financing identities, provenance on every input, no NaN, assumptions listed)
Analytical, not a recommendation to buy or sell anything. Phoenix (the owner's employer) is computed like every other company.
"""
import json
import math
from math import fsum
import sys
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_capital as A7  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "consolidation"
MM = 'מיליוני ש"ח'
PP = "נקודות אחוז"
fm, fs, pct, r6 = A7.fm, A7.fs, A7.pct, A7.r6
calc, inp, fig = A7.calc, A7.inp, A7.fig

PRODUCTS = {"pen": "פנסיה", "gem": "גמל והשתלמות"}
SKIP = {"more_gemel": "כפיל של מור (אותם מוצרים, חברת הגמל של הקבוצה)"}
PREMIA = [0.0, 20.0, 40.0]
PRIMARY = 20.0
DEF = {"r": 50.0, "ic": 1.0, "kd": 1.5, "h": None}   # lev: the peer median, computed
ID_TOL = 1e-5     # relative, on figures stored to 6 decimals
ABS = 1e-4        # NIS m, sums of stored figures
AUM_YM = 202606     # the regulator month of the A1 AUM (06/26)
MULT_PEERS = ["meitav", "altshuler", "more", "analyst"]   # listed houses whose business is mostly pension / provident funds
MULT_EXCL = {"yelin": "המניה הנסחרת היא של אטראו שוקי הון, המחזיקה 50% בילין לפידות: שווי השוק אינו של המנהלת"}
MULT_YM = 202608     # the regulator month nearest the price date
FLOOR_HE = "מחיר לפי שווי לנכסים, חציון בתי ההשקעות הנסחרים"


def ann(h, ke):
    k = ke / 100
    return (1 - (1 + k) ** -h) / k


def num(v, d=1):
    return fm(v, d)


# ---------------------------------------------------------------- provenance helpers
def inline(c, p, depth=0):
    """an A7 provenance with its refs (inside the company) resolved, so a pair file is self-contained"""
    if depth > 40 or not isinstance(p, dict):
        return p
    if p.get("k") == "ref":
        q = A7.resolve(c, p["r"])
        return inline(c, q, depth + 1) if q else {"k": "none", "title": p["r"], "why": "המקור לא נמצא"}
    if p.get("k") == "calc":
        return {**p, "inputs": [{**x, "p": inline(c, x["p"], depth + 1)} if x.get("p") else x for x in p["inputs"]]}
    return p


def R(scope, path):
    """a pointer to another figure's provenance: c/<id>:<path> (matrix.json cos), a:<key> (matrix assumptions), p:<path> (this pair file)"""
    return {"k": "ref", "r": f"{scope}:{path}"}


def res(r, M, doc=None):
    """the provenance a pointer names (web/src/lib/consolidation.ts resolve: the same rule)"""
    scope, _, path = r.partition(":")
    if scope.startswith("c/"):
        node = M["cos"].get(scope[2:])
    elif scope.startswith("m/"):
        node = (M.get("mix") or {}).get(scope[2:])
    elif scope == "a":
        node = M["meta"]["assume"]
    elif scope == "k":
        node = M["meta"]
    elif scope == "p":
        node = doc
    else:
        return None
    for k in path.split("."):
        if isinstance(node, list):
            node = node[int(k)] if k.isdigit() and int(k) < len(node) else None
        elif isinstance(node, dict):
            node = node.get(k)
        else:
            node = None
        if node is None:
            return None
    if isinstance(node, dict) and "prov" in node:
        return node["prov"]
    return node if isinstance(node, dict) and "k" in node else None


def deref(p, M, doc=None, depth=0):
    if depth > 60 or not isinstance(p, dict):
        return p
    if p.get("k") == "ref" and ":" in p["r"]:
        q = res(p["r"], M, doc)
        return deref(q, M, doc, depth + 1) if q else {"k": "none", "title": p["r"], "why": "המקור לא נמצא"}
    if p.get("k") == "calc":
        return {**p, "inputs": [{**x, "p": deref(x["p"], M, doc, depth + 1)} if x.get("p") else x for x in p["inputs"]]}
    return p


def to_capital(figs_, M, doc):
    """the bolt-on figures for capital/options.json: every consolidation pointer becomes a capital ref `bolt.<pointer>` into one table, so a
    subtree used by several figures is stored once (build_capital.resolve / capital.ts resolveRef read it)"""
    src = {}

    def conv(p, depth=0):
        if not isinstance(p, dict) or depth > 60:
            return p
        if p.get("k") == "ref" and ":" in p["r"]:
            key = p["r"]
            if key not in src:
                src[key] = None
                q = res(key, M, doc)
                src[key] = conv(q, depth + 1) if q else {"k": "none", "title": key, "why": "המקור לא נמצא"}
            return {"k": "ref", "r": "bolt." + key}
        if p.get("k") == "calc":
            return {**p, "inputs": [{**x, "p": conv(x["p"], depth + 1)} if x.get("p") else x for x in p["inputs"]]}
        return p
    out = {k: (None if f is None else {"v": f["v"], "prov": conv(f["prov"])}) for k, f in figs_.items()}
    return out, src


def est(title, value, formula, note, unit="", inputs=None):
    return calc(title, value, formula, inputs or [], unit=unit, est=True, note=note)


# ---------------------------------------------------------------- inputs
class Inputs:
    def __init__(self):
        self.reg = {c["id"]: c for c in json.loads((WEB / "companies" / "index.json").read_text(encoding="utf8"))}
        self.drv = {}
        for c in self.reg:
            p = WEB / "drivers" / f"{c}.json"
            if p.exists():
                self.drv[c] = json.loads(p.read_text(encoding="utf8"))
        self.lens = json.loads((WEB / "lens.json").read_text(encoding="utf8"))
        self.mkt = json.loads((WEB / "market.json").read_text(encoding="utf8"))
        self.funds = json.loads((WEB / "funds.json").read_text(encoding="utf8"))
        self.npv = json.loads((WEB / "flow_npv.json").read_text(encoding="utf8"))
        self.capI = A7.Inputs()


def a7_of(I, cid):
    if I.reg[cid].get("kind") != "insurance_group":
        return None
    c = A7.Co(I.capI, cid).build()
    return c if c.get("status") == "ok" else None


# ---------------------------------------------------------------- one company's inputs
def node(N, k):
    x = N.get(k)
    return fig(x["v"], x["prov"]) if x and x.get("v") is not None else None


def company(I, cid, A0):
    f = I.drv[cid]
    N, meta = f["nodes"], f["meta"]
    name = meta["name"]
    kind = meta["kind"]
    sc = f"c/{cid}"
    out = {"id": cid, "name": name, "kind": kind}
    if meta.get("flag"):
        out["flag"] = meta["flag"]
    prods = {}
    for p in f["products"]:
        s = p["s"]
        if s not in PRODUCTS:
            continue
        fe, ox = (p.get("fees_ltm") or {}).get("v"), (p.get("opex_ltm") or {}).get("v")
        if fe is None or ox is None or fe <= 0 or (p.get("fy") or {}).get("v") is None:
            continue
        ci = ox / fe * 100
        D = I.npv["dur"][s]
        m0, m1 = D["months"][0], D["months"][-1]
        prods[s] = {"s": s, "he": PRODUCTS[s], "g": p["g"],
                    "aum": fig(p["aum"]["v"], p["aum"]["prov"]), "fy": fig(p["fy"]["v"], p["fy"]["prov"]),
                    "fees": fig(fe, p["fees_ltm"]["prov"]), "opex": fig(ox, p["opex_ltm"]["prov"]), "op": fig(p["op_ltm"]["v"], p["op_ltm"]["prov"]),
                    "ci": fig(ci, calc(f"יחס עלות להכנסה · {name} · {PRODUCTS[s]} · LTM {meta['base']['q']}", pct(ci), "(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול × 100",
                                       [inp("הוצאות LTM", num(ox), R(sc, f"products.{s}.opex")), inp("הכנסות מדמי ניהול LTM", num(fe), R(sc, f"products.{s}.fees"))], unit="%")),
                    "dur": fig(D["v"], est(f"משך הספר · {PRODUCTS[s]} · כל השוק", f"{fm(D['v'], 2)} שנים", "D = נכסים ממוצעים ÷ (משיכות + ניוד יוצא), LTM, כל החברות (M3, flow_npv.json)",
                                           f"אופק הסינרגיה: כל עוד הנכסים שנרכשו נשארים. רשות שוק ההון, גמל-נט / פנסיה-נט, {m0 % 100:02d}/{str(m0)[2:4]}–{m1 % 100:02d}/{str(m1)[2:4]}; "
                                           f"נכסים ממוצעים {fm(D['avg'])}, משיכות {fm(D['wd'])}, ניוד יוצא {fm(D['out'])} (מיליוני ש\"ח)", unit="שנים"))}
    if not prods:
        return {**out, "status": "na", "why": "הכנסות והוצאות פנסיה / גמל לא חולצו מהדוחות (אין יחס עלות להכנסה)"}
    sf = fsum(x["fees"]["v"] for x in prods.values())
    so = fsum(x["opex"]["v"] for x in prods.values())
    blend = so / sf * 100
    out["products"] = prods
    out["blend"] = fig(blend, calc(f"יחס עלות להכנסה, פנסיה וגמל יחד · {name} · LTM {meta['base']['q']}", pct(blend), "Σ הוצאות ÷ Σ הכנסות מדמי ניהול × 100",
                                   [inp(f"הוצאות · {x['he']}", num(x["opex"]["v"]), R(sc, f"products.{s}.opex")) for s, x in prods.items()]
                                   + [inp(f"הכנסות · {x['he']}", num(x["fees"]["v"]), R(sc, f"products.{s}.fees")) for s, x in prods.items()], unit="%"))
    # earnings, equity, cost of equity
    P = {k: node(N, k) for k in ("net_profit", "equity", "equity_end", "roe", "ke", "pb", "debt_total")}
    if not all(P[k] for k in ("net_profit", "equity", "equity_end", "ke")):
        return {**out, "status": "na", "why": "רווח נקי או הון עצמי לא חולצו (A1)"}
    rf_in = next((x for x in N["ke"]["prov"].get("inputs", []) if "ריבית" in x["label"]), None)
    P["rf"] = fig(meta["assume"]["rf"], rf_in["p"] if rf_in and rf_in.get("p") else est("ריבית חסרת סיכון", pct(meta["assume"]["rf"], 2), "valuation.ts", "A1", unit="%"))
    P["tax"] = fig(meta["assume"]["tax"], N["tax"]["prov"] if "tax" in N else est("שיעור מס (הנחה)", pct(meta["assume"]["tax"], 2), "valuation.ts ASSUME0.tax", "הנחה", unit="%"))
    P["g"] = fig(meta["assume"]["g"], est("צמיחה ארוכת טווח (הנחה)", pct(meta["assume"]["g"], 1), "valuation.ts ASSUME0.g", "הנחת ההערכה של האתר, כמו ב-P/B המוצדק", unit="%"))
    if not P["debt_total"]:
        P["debt_total"] = fig(0.0, est(f"קרן חוב · {name}", "0", "לא נמצא טופס ת126 לקבוצה", "אין חוב מדווח בטופס ת126: נלקח 0", unit=MM))
    out["pnl"] = {k: v for k, v in P.items() if v}
    D, E = P["debt_total"]["v"], P["equity_end"]["v"]
    lev = D / (D + E) * 100 if D + E > 0 else 0.0
    out["lev"] = fig(lev, calc(f"מינוף · {name} · {meta['base']['q']}", pct(lev), "חוב ÷ (חוב + הון עצמי) × 100; חוב = קרן על קיר הפירעונות (ת126)",
                               [inp("קרן חוב (ת126)", num(D), R(sc, "pnl.debt_total")), inp("הון עצמי לבעלי המניות", num(E), R(sc, "pnl.equity_end"))], unit="%"))
    # cash capacity: A7 distributable (insurers) or equity (fund houses, labelled)
    c7 = a7_of(I, cid)
    if c7:
        dist = c7["distributable"]["v"]
        bind = next(x for x in c7["constraints"] if x["id"] == c7["binding"])
        scr = c7["bases"][bind["basis"]]["scr"]
        out["cap"] = {"kind": "a7", "period": c7["period"], "basis": bind["basis"],
                      "dist": fig(dist, inline(c7, c7["distributable"]["prov"])),
                      "cash": fig(max(dist, 0.0), calc(f"קיבולת מזומן · {name}", fm(max(dist, 0.0)), "max(הון בר-חלוקה (A7), 0)",
                                                       [inp(f"הון בר-חלוקה (A7) · {c7['period']}", fm(dist), R(sc, "cap.dist"))], est=True)),
                      "scr": fig(scr["v"], inline(c7, scr["prov"]))}
    else:
        why = "אין הון בר-חלוקה (A7) לחברה מנהלת: ההון העצמי לבעלי המניות כתקרה" if kind != "insurance_group" else "אין הון בר-חלוקה (A7) לחברה: ההון העצמי כתקרה"
        out["cap"] = {"kind": "equity", "cash": fig(E, calc(f"קיבולת מזומן · {name}", fm(E), "הון עצמי לבעלי המניות (A1)", [inp("הון עצמי לבעלי המניות", num(E), R(sc, "pnl.equity_end"))], est=True, note=why))}
    # the standalone justified value, the earnings bought, the equity bought
    ke, g, tax = P["ke"]["v"], P["g"]["v"], P["tax"]["v"]
    if kind == "fund_house" and P.get("pb"):
        v0 = P["pb"]["v"] * E
        out["val"] = {"basis": "pb",
                      "v0": fig(v0, calc(f"שווי מוצדק עצמאי · {name}", fm(v0), "P/B מוצדק (A1) × הון עצמי לבעלי המניות",
                                         [inp("P/B מוצדק (A1)", f"{fm(P['pb']['v'], 2)}x", R(sc, "pnl.pb")), inp("הון עצמי לבעלי המניות", num(E), R(sc, "pnl.equity_end"))], est=True,
                                         note="קלט הערכה, לא מחיר שוק; החברה כולה, כולל פעילויות שמחוץ לפנסיה ולגמל")),
                      "earn": fig(P["net_profit"]["v"], R(sc, "pnl.net_profit")), "book": fig(E, R(sc, "pnl.equity_end"))}
    else:
        op = fsum(x["op"]["v"] for x in prods.values())
        earn = op * (1 - tax / 100)
        pe = 100 / (ke - g)
        v0 = max(earn, 0.0) * pe
        eprov = calc(f"רווח תפעולי אחרי מס, פנסיה וגמל · {name} · LTM", fm(earn, 1), "Σ רווח תפעולי × (1 − מס)",
                     [inp(f"רווח תפעולי · {x['he']}", num(x["op"]["v"]), R(sc, f"products.{s}.op")) for s, x in prods.items()] + [inp("מס (הנחה)", pct(tax, 2), R(sc, "pnl.tax"))], est=True)
        out["val"] = {"basis": "pe",
                      "v0": fig(v0, calc(f"שווי מוצדק עצמאי · {name} · זרוע החיסכון", fm(v0), "max(רווח אחרי מס, 0) × P/E מוצדק; P/E = 1 ÷ (ke − g)",
                                         [inp("רווח תפעולי אחרי מס LTM", fm(earn, 1), R(sc, "val.earn")), inp("ke", pct(ke, 2), R(sc, "pnl.ke")), inp("g (הנחה)", pct(g, 1), R(sc, "pnl.g"))], est=True,
                                         note="זרוע החיסכון אינה נסחרת בנפרד: מכפיל רווח מוצדק (הנחת קיבולת הון זניחה לצמיחה); קלט הערכה, לא מחיר")),
                      "earn": fig(earn, eprov), "book": None}
    out["status"] = "ok"
    return out


# ---------------------------------------------------------------- the AUM floor of a target's price
def multiple(I):
    """the median market value per NIS bn of pension + provident AUM of the listed fund houses whose business is mostly long-term savings"""
    M = I.mkt
    pi = M["periods"].index(MULT_YM)
    ml = f"{MULT_YM % 100:02d}/{str(MULT_YM)[2:4]}"
    rows, ins = [], []
    for cid in MULT_PEERS:
        pr = json.loads((WEB / "companies" / f"{cid}.price.json").read_text(encoding="utf8"))
        g = I.drv[cid]["products"][0]["g"]
        fam = {f: fsum(r[3] for r in M["rows"] if r[0] == pi and r[2] == g and M["products"][r[1]]["family"] == f) for f in sorted(FAM, reverse=True)}
        aum = fsum(fam.values())
        mc = pr["mcap"]
        v = mc / (aum / 1000)
        d = pr["asof"]
        dl = f"{d[8:10]}.{d[5:7]}.{d[2:4]}"
        name = I.reg[cid]["name_he"]
        pp = {"k": "price", "title": f"שווי שוק · {pr['name']}", "value": f"{fm(mc, 1)} מיליוני ש\"ח", "ticker": pr["ticker"], "vendor": pr["source"], "date": dl}
        regp = lambda f: {"k": "reg", "metric": "assets", "pi": pi, "w": "m", "set": f"fam:{f}", "g": g}
        cp = calc(f"שווי שוק לכל מיליארד נכסים · {name}", fm(v, 2), "שווי שוק ÷ (נכסי פנסיה + גמל והשתלמות ÷ 1,000)",
                  [inp(f"שווי שוק · {dl}", fm(mc, 1), pp)] + [inp(f"נכסים · {({'pension': 'פנסיה', 'gemel': 'גמל והשתלמות'})[f]} · {ml}", fm(fam[f] / 1000, 2), regp(f)) for f in fam if fam[f]],
                  unit="מיליוני ש\"ח למיליארד", note="שווי השוק כולל את כל פעילויות החברה (גם קרנות נאמנות וניהול תיקים)")
        rows.append({"id": cid, "name": name, "mcap": r6(mc), "aum": r6(aum), "v": r6(v), "date": dl})
        ins.append(inp(name, fm(v, 2), cp))
    m = median(x["v"] for x in rows)
    date = rows[0]["date"]
    prov = calc(f"שווי לכל מיליארד נכסים · חציון בתי ההשקעות הנסחרים", fm(m, 2), f"חציון של שווי שוק ÷ נכסי פנסיה וגמל, {len(rows)} חברות",
                ins, unit="מיליוני ש\"ח למיליארד", est=True,
                note=f"מחירי {date}, נכסים {ml}; לא נכללו: " + "; ".join(f"{I.reg[k]['name_he']} ({w})" for k, w in MULT_EXCL.items()) + ". רצפה למחיר, קלט הערכה")
    return {"v": r6(m), "date": date, "aum_month": ml, "he": FLOOR_HE, "peers": rows, "excl": [{"id": k, "why": w} for k, w in MULT_EXCL.items()], "prov": prov}


def apply_floor(c, mult):
    """V0 = max(justified value, target AUM × the multiple); the binding basis is named"""
    sc = f"c/{c['id']}"
    V = c["val"]
    just = V["v0"]
    aum = fsum(x["aum"]["v"] for x in c["products"].values())
    floor = aum / 1000 * mult["v"]
    fp = calc(f"רצפת שווי לנכסים · {c['name']}", fm(floor), "נכסי פנסיה וגמל (מיליארד) × שווי לכל מיליארד, חציון בתי ההשקעות הנסחרים",
              [inp(f"נכסים · {x['he']} · 06/26", num(x["aum"]["v"], 0), R(sc, f"products.{s}.aum")) for s, x in c["products"].items()]
              + [inp(f"שווי לכל מיליארד · מחירי {mult['date']}", fm(mult["v"], 2), R("k", "mult"))], est=True, note=FLOOR_HE)
    binds = "aum" if floor > just["v"] else "just"
    v0 = max(floor, just["v"])
    V["just"] = just
    V["floor"] = fig(floor, fp)
    V["binds"] = binds
    V["v0"] = fig(v0, calc(f"מחיר בסיס · {c['name']}", fm(v0), "max(שווי מוצדק עצמאי, רצפת שווי לנכסים)",
                           [inp("שווי מוצדק עצמאי" + (" (P/B)" if V["basis"] == "pb" else " (P/E)"), fm(just["v"]), R(sc, "val.just")),
                            inp(f"רצפת שווי לנכסים{' · קובעת' if binds == 'aum' else ''}", fm(floor), R(sc, "val.floor"))], est=True,
                           note=(FLOOR_HE + f" · מחירי {mult['date']}") if binds == "aum" else "השווי המוצדק גבוה מהרצפה"))


# ---------------------------------------------------------------- assumptions
def assumptions(cos, A0):
    levs = sorted((c["lev"]["v"], c["id"]) for c in cos.values() if c["status"] == "ok")
    lmed = round(median(v for v, _ in levs), 1)   # shown and typed to one decimal
    a = {"r": {"v": DEF["r"], "he": "שיעור מימוש הסינרגיה", "unit": "%", "url": "r",
               "prov": est("שיעור מימוש הסינרגיה (הנחה)", pct(DEF["r"], 0), "החלק מהסינרגיה הגולמית שממומש", "הנחה, ניתנת לשינוי בכתובת (r=): לא כל ההוצאה של היעד יורדת ליחס של הרוכשת", unit="%")},
         "ic": {"v": DEF["ic"], "he": "עלות אינטגרציה", "unit": "x", "url": "ic",
                "prov": est("עלות אינטגרציה (הנחה)", f"{fm(DEF['ic'], 1)}x", "חד-פעמית, כפולה של הסינרגיה הגולמית השנתית, ניכוי מס", "הנחה, ניתנת לשינוי בכתובת (ic=)", unit="x")},
         "h": {"v": None, "he": "אופק", "unit": "שנים", "url": "h",
               "prov": est("אופק הסינרגיה (ברירת מחדל)", "משך הספר", "לכל מוצר: משך הספר של M3 (flow_npv.json)", "ניתן להחלפה באופק אחיד בכתובת (h=)", unit="שנים")},
         "lev": {"v": r6(lmed), "he": "מינוף מרבי", "unit": "%", "url": "lev",
                 "prov": calc("מינוף מרבי (הנחה): החציון של הענף", pct(lmed), "חציון של חוב ÷ (חוב + הון עצמי) על החברות במסך",
                              [inp(cos[i]["name"], pct(v), R(f"c/{i}", "lev")) for v, i in levs], unit="%", est=True,
                              note="הנחה, ניתנת לשינוי בכתובת (lev=): רוכשת לא ממנפת מעבר לחציון הענף היום")},
         "kd": {"v": DEF["kd"], "he": "מרווח החוב", "unit": PP, "url": "kd",
                "prov": est("מרווח חוב מעל rf (הנחה)", f"{fm(DEF['kd'], 1)} נ״א", "עלות החוב = rf + מרווח", "הנחה, ניתנת לשינוי בכתובת (kd=)", unit=PP)}}
    return a


def assume_vals(a):
    return {k: a[k]["v"] for k in ("r", "ic", "h", "lev", "kd")}


# ---------------------------------------------------------------- one pair (web/src/lib/consolidation.ts pairAt: the same formulas)
def compute(ca, ct, A):
    """numbers only; the TS library reproduces them (tests/consolidation.unit.ts)"""
    P = ca["pnl"]
    tax, ke, rf = P["tax"]["v"], P["ke"]["v"], P["rf"]["v"]
    after = 1 - tax / 100
    rows = []
    for s, x in ct["products"].items():
        pa = ca["products"].get(s)
        cia = pa["ci"]["v"] if pa else ca["blend"]["v"]
        gross = x["aum"]["v"] * x["fy"]["v"] / 100 * (x["ci"]["v"] - cia) / 100
        h = A["h"] if A["h"] is not None else x["dur"]["v"]
        a = ann(h, ke)
        net = gross * A["r"] / 100
        rows.append({"s": s, "cia": cia, "own": bool(pa), "gross": gross, "net": net, "h": h, "ann": a, "npv_g": gross * after * a, "npv": net * after * a})
    G = fsum(x["gross"] for x in rows)
    Nn = fsum(x["net"] for x in rows)
    ic = A["ic"] * max(G, 0.0)
    npv_g = fsum(x["npv_g"] for x in rows)
    npv = fsum(x["npv"] for x in rows) - ic * after
    D, E, Eavg, np_a = P["debt_total"]["v"], P["equity_end"]["v"], P["equity"]["v"], P["net_profit"]["v"]
    L = A["lev"] / 100
    room = max(0.0, L / (1 - L) * E - D) if L < 1 else 0.0
    cash_cap = ca["cap"]["cash"]["v"]
    capacity = cash_cap + room
    v0, earn = ct["val"]["v0"]["v"], ct["val"]["earn"]["v"]
    book = ct["val"]["book"]["v"] if ct["val"]["book"] else 0.0
    kd = rf + A["kd"]
    scr = ca["cap"]["scr"]["v"] if ca["cap"].get("scr") else None
    prem = []
    for p in PREMIA:
        price = v0 * (1 + p / 100)
        cash = min(price, cash_cap)
        debt = price - cash
        dnp = earn + Nn * after - cash * rf / 100 * after - debt * kd / 100 * after
        gw = max(price - book, 0.0)
        prem.append({"p": p, "price": price, "cash": cash, "debt": debt, "ok": debt <= room + 1e-9, "dnp": dnp,
                     "eps": dnp / np_a * 100 if np_a else None, "roe": dnp / Eavg * 100 if Eavg else None,
                     "roic": (earn + Nn * after) / price * 100 if price > 0 else None,
                     "solv": -cash / scr * 100 if scr else None, "gw": gw, "solv_gw": -gw / scr * 100 if scr else None})
    p20 = next(x for x in prem if x["p"] == PRIMARY)
    metric = npv / p20["price"] * 100 if p20["price"] > 0 else None
    return {"rows": rows, "gross": G, "net": Nn, "ic": ic, "npv_g": npv_g, "npv": npv, "room": room, "cash_cap": cash_cap, "capacity": capacity,
            "kd": kd, "prem": prem, "metric": metric}


# ---------------------------------------------------------------- provenance of a pair (for the pair file and the gate)
def pair_doc(ca, ct, A, Ad, X, fit, nc, rank, built, base):
    an, tn = ca["name"], ct["name"]
    sa, st = f"c/{ca['id']}", f"c/{ct['id']}"
    P = ca["pnl"]
    tax, ke, rf = P["tax"]["v"], P["ke"]["v"], P["rf"]["v"]
    TX, KE, RF = R(sa, "pnl.tax"), R(sa, "pnl.ke"), R(sa, "pnl.rf")
    over = {k: A[k] != Ad[k]["v"] for k in ("r", "ic", "h", "lev", "kd")}
    AP = {k: (est(f"{Ad[k]['he']} (הקלט שלך)", str(A[k]), "", "הוזן בכתובת", unit=Ad[k]["unit"]) if over[k] else R("a", k)) for k in over}
    prods = []
    for i, x in enumerate(X["rows"]):
        s = x["s"]
        t = ct["products"][s]
        pa = ca["products"].get(s)
        cia_p = R(sa, f"products.{s}.ci") if pa else calc(f"יחס עלות להכנסה של הרוכשת · {an} · {t['he']}", pct(x["cia"]),
                                                            "הרוכשת אינה מנהלת את המוצר: היחס המשוקלל שלה בפנסיה ובגמל", [inp("פנסיה וגמל יחד", pct(x["cia"]), R(sa, "blend"))], unit="%", est=True)
        me = f"p:products.{i}"
        gp = calc(f"סינרגיה גולמית · {an} ← {tn} · {t['he']}", fs(x["gross"], 1), "נכסי היעד × תשואת דמי ניהול ÷ 100 × (יחס עלות היעד − יחס עלות הרוכשת) ÷ 100",
                  [inp(f"נכסי היעד · {t['he']} · 06/26", num(t["aum"]["v"], 0), R(st, f"products.{s}.aum")), inp("תשואת דמי ניהול LTM", pct(t["fy"]["v"], 4), R(st, f"products.{s}.fy")),
                   inp("יחס עלות להכנסה · היעד", pct(t["ci"]["v"]), R(st, f"products.{s}.ci")), inp("יחס עלות להכנסה · הרוכשת", pct(x["cia"]), R("p", f"products.{i}.ci_a"))])
        np_ = calc(f"סינרגיה נטו · {an} ← {tn} · {t['he']}", fs(x["net"], 1), "סינרגיה גולמית × שיעור מימוש ÷ 100",
                   [inp("סינרגיה גולמית", fs(x["gross"], 1), R("p", f"products.{i}.gross")), inp("שיעור מימוש (הנחה)", pct(A["r"], 0), AP["r"])], est=True)
        hp = R(st, f"products.{s}.dur") if A["h"] is None else AP["h"]
        prods.append({"s": s, "he": t["he"], "own": x["own"],
                      "aum": fig(t["aum"]["v"], R(st, f"products.{s}.aum")), "fy": fig(t["fy"]["v"], R(st, f"products.{s}.fy")), "ci_t": fig(t["ci"]["v"], R(st, f"products.{s}.ci")),
                      "ci_a": fig(x["cia"], cia_p), "gross": fig(x["gross"], gp), "net": fig(x["net"], np_), "h": fig(x["h"], hp), "ann": r6(x["ann"]),
                      "npv": fig(x["npv"], calc(f"ערך נוכחי של הסינרגיה נטו · {t['he']}", fs(x["npv"], 1), "נטו × (1 − מס) × a(H, ke); a = (1 − (1 + ke)^−H) ÷ ke",
                                               [inp("סינרגיה נטו", fs(x["net"], 1), R("p", f"products.{i}.net")), inp("מס (הנחה)", pct(tax, 2), TX), inp("H", f"{fm(x['h'], 2)} שנים", R("p", f"products.{i}.h")),
                                                inp("ke", pct(ke, 2), KE)], est=True))})
        del me
    pr_in = lambda k: [inp(x["he"], fs(x[k]["v"], 1), R("p", f"products.{i}.{k}")) for i, x in enumerate(prods)]
    gross_p = calc(f"סינרגיה גולמית · {an} ← {tn}", fs(X["gross"], 1), "Σ המוצרים, מיליוני ש\"ח לשנה, לפני מס", pr_in("gross"))
    net_p = calc(f"סינרגיה נטו · {an} ← {tn}", fs(X["net"], 1), "Σ המוצרים", pr_in("net"), est=True)
    ic_p = calc(f"עלות אינטגרציה · {an} ← {tn}", fm(X["ic"], 1), "כפולה × max(סינרגיה גולמית, 0)",
                [inp("סינרגיה גולמית", fs(X["gross"], 1), R("p", "synergy.gross")), inp("כפולה (הנחה)", f"{fm(A['ic'], 1)}x", AP["ic"])], est=True)
    npv_g_p = calc(f"ערך נוכחי של הסינרגיה הגולמית · {an} ← {tn}", fs(X["npv_g"], 1), "Σ גולמית × (1 − מס) × a(H, ke), לפני מימוש ואינטגרציה",
                   pr_in("gross") + [inp("מס (הנחה)", pct(tax, 2), TX), inp("ke", pct(ke, 2), KE)] + [inp(f"H · {x['he']}", f"{fm(x['h']['v'], 2)} שנים", R("p", f"products.{i}.h")) for i, x in enumerate(prods)], est=True)
    npv_p = calc(f"ערך נוכחי של הסינרגיה · {an} ← {tn}", fs(X["npv"], 1), "Σ ערך נוכחי נטו לפי מוצר − עלות אינטגרציה × (1 − מס)",
                 pr_in("npv") + [inp("פחות: עלות אינטגרציה", fm(X["ic"], 1), R("p", "synergy.ic")), inp("מס (הנחה)", pct(tax, 2), TX)], est=True)
    # capacity
    room_p = calc(f"מרווח חוב · {an}", fm(X["room"]), "max(0, L ÷ (1 − L) × הון עצמי − חוב)",
                  [inp("מינוף מרבי L (הנחה)", pct(A["lev"]), AP["lev"]), inp("הון עצמי לבעלי המניות", num(P["equity_end"]["v"]), R(sa, "pnl.equity_end")),
                   inp("קרן חוב (ת126)", num(P["debt_total"]["v"]), R(sa, "pnl.debt_total"))], est=True)
    cap_p = calc(f"קיבולת תשלום · {an}", fm(X["capacity"]), "קיבולת מזומן + מרווח חוב",
                 [inp("קיבולת מזומן" + (" (A7)" if ca["cap"]["kind"] == "a7" else " (הון עצמי)"), fm(X["cash_cap"]), R(sa, "cap.cash")), inp("מרווח חוב", fm(X["room"]), R("p", "capacity.room"))], est=True)
    v0 = ct["val"]["v0"]
    kd_p = calc("עלות החוב", pct(X["kd"], 2), "rf + מרווח", [inp("rf", pct(rf, 2), RF), inp("מרווח (הנחה)", f"{fm(A['kd'], 1)} נ״א", AP["kd"])], unit="%", est=True)
    prem = []
    for j, q in enumerate(X["prem"]):
        tag = f"פרמיה {fm(q['p'], 0)}%"
        Q = lambda k: R("p", f"premia.{j}.{k}")
        pr = calc(f"מחיר · {tn} · {tag}", fm(q["price"]), "מחיר בסיס × (1 + פרמיה); מחיר בסיס = max(שווי מוצדק, רצפת שווי לנכסים)",
                  [inp("מחיר בסיס" + (f" ({FLOOR_HE})" if ct["val"]["binds"] == "aum" else " (שווי מוצדק)"), fm(v0["v"]), R(st, "val.v0")), inp("פרמיה", pct(q["p"], 0))], est=True)
        cash_p = calc(f"מזומן · {tag}", fm(q["cash"]), "min(מחיר, קיבולת מזומן): מזומן קודם", [inp("מחיר", fm(q["price"]), Q("price")), inp("קיבולת מזומן", fm(X["cash_cap"]), R(sa, "cap.cash"))], est=True)
        debt_p = calc(f"חוב · {tag}", fm(q["debt"]), "מחיר − מזומן", [inp("מחיר", fm(q["price"]), Q("price")), inp("מזומן", fm(q["cash"]), Q("cash"))], est=True)
        dnp_p = calc(f"תוספת לרווח הנקי · {an} ← {tn} · {tag}", fs(q["dnp"], 1),
                     "רווח היעד + סינרגיה נטו × (1 − מס) − מזומן × rf × (1 − מס) − חוב × (rf + מרווח) × (1 − מס)",
                     [inp("רווח היעד LTM", fm(ct["val"]["earn"]["v"], 1), R(st, "val.earn")), inp("סינרגיה נטו", fs(X["net"], 1), R("p", "synergy.net")),
                      inp("מזומן", fm(q["cash"]), Q("cash")), inp("rf", pct(rf, 2), RF), inp("חוב", fm(q["debt"]), Q("debt")), inp("עלות החוב", pct(X["kd"], 2), R("p", "kd")),
                      inp("מס (הנחה)", pct(tax, 2), TX)], est=True, note="סינרגיה בקצב מלא, בלי עלות האינטגרציה; אין הנפקת מניות; אין הפחתת מוניטין (IFRS)")
        row = {"p": q["p"], "price": fig(q["price"], pr), "cash": fig(q["cash"], cash_p), "debt": fig(q["debt"], debt_p), "ok": q["ok"], "dnp": fig(q["dnp"], dnp_p),
               "eps": fig(q["eps"], calc(f"השפעה על הרווח למניה · {an} · {tag}", f"{fs(q['eps'], 1)}%", "תוספת לרווח ÷ רווח נקי LTM של הרוכשת × 100",
                                         [inp("תוספת לרווח", fs(q["dnp"], 1), Q("dnp")), inp("רווח נקי LTM", num(P["net_profit"]["v"]), R(sa, "pnl.net_profit"))], unit="%", est=True)),
               "roe": fig(q["roe"], calc(f"השפעה על ROE · {an} · {tag}", f"{fs(q['roe'], 2)} נ״א", "תוספת לרווח ÷ הון ממוצע × 100 (ההון לא משתנה: מזומן וחוב)",
                                         [inp("תוספת לרווח", fs(q["dnp"], 1), Q("dnp")), inp("הון ממוצע", num(P["equity"]["v"]), R(sa, "pnl.equity"))], unit=PP, est=True)),
               "roic": fig(q["roic"], calc(f"ROIC · {an} ← {tn} · {tag}", "–" if q["roic"] is None else pct(q["roic"]), "(רווח היעד + סינרגיה נטו × (1 − מס)) ÷ מחיר × 100",
                                           [inp("רווח היעד LTM", fm(ct["val"]["earn"]["v"], 1), R(st, "val.earn")), inp("סינרגיה נטו", fs(X["net"], 1), R("p", "synergy.net")),
                                            inp("מס (הנחה)", pct(tax, 2), TX), inp("מחיר", fm(q["price"]), Q("price"))], unit="%", est=True)),
               "gw": fig(q["gw"], calc(f"מוניטין · {tag}", fm(q["gw"]), "max(מחיר − הון היעד, 0)" + ("" if ct["val"]["book"] else "; הון זרוע החיסכון אינו מדווח בנפרד: כל המחיר"),
                                       [inp("מחיר", fm(q["price"]), Q("price"))] + ([inp("הון עצמי של היעד", num(ct["val"]["book"]["v"]), R(st, "val.book"))] if ct["val"]["book"] else []), est=True))}
        if q["solv"] is not None:
            scr = ca["cap"]["scr"]
            row["solv"] = fig(q["solv"], calc(f"עלות כושר פירעון · {an} · {tag}", f"{fs(q['solv'], 1)} נ״א", "− מזומן מהעודף ÷ SCR × 100 (מנגנון A7: העודף יוצא מההון כמו דיבידנד; החוב בחברת האם)",
                                              [inp("מזומן", fm(q["cash"]), Q("cash")), inp("SCR", fm(scr["v"]), R(sa, "cap.scr"))], unit=PP, est=True))
            row["solv_gw"] = fig(q["solv_gw"], calc(f"עלות כושר פירעון, רישום בחברת הביטוח · {an} · {tag}", f"{fs(q['solv_gw'], 1)} נ״א",
                                                    "− מוניטין ÷ SCR × 100 (הנחה: היעד מוחזק בחברת הביטוח; מוניטין מנוכה מההון העצמי לעניין SCR)",
                                                    [inp("מוניטין", fm(q["gw"]), Q("gw")), inp("SCR", fm(scr["v"]), R(sa, "cap.scr"))], unit=PP, est=True))
        prem.append(row)
    j20 = next(j for j, x in enumerate(prem) if x["p"] == PRIMARY)
    metric = fig(X["metric"], calc(f"ערך נוכחי של הסינרגיה ÷ מחיר · {an} ← {tn}", "–" if X["metric"] is None else pct(X["metric"]), "ערך נוכחי נטו ÷ מחיר בפרמיה 20% × 100 (המדד המדרג היחיד)",
                                   [inp("ערך נוכחי של הסינרגיה", fs(X["npv"], 1), R("p", "synergy.npv")), inp("מחיר בפרמיה 20%", fm(prem[j20]["price"]["v"]), R("p", f"premia.{j20}.price"))], unit="%", est=True))
    return {"meta": {"built": built, "base": base, "v": 1, "a": ca["id"], "t": ct["id"], "assume": assume_vals(Ad), "premia": PREMIA, "primary": PRIMARY,
                     "refs": "c/<id>:<path> = matrix.json cos; a:<key> = matrix.json meta.assume; p:<path> = this file"},
            "acq": {"id": ca["id"], "name": an, "kind": ca["kind"], "cap": ca["cap"]["kind"]}, "tgt": {"id": ct["id"], "name": tn, "kind": ct["kind"], "val": ct["val"]["basis"], "binds": ct["val"]["binds"]},
            "nc": nc, "rank": rank, "products": prods, "kd": fig(X["kd"], kd_p),
            "synergy": {"gross": fig(X["gross"], gross_p), "net": fig(X["net"], net_p), "ic": fig(X["ic"], ic_p), "npv_g": fig(X["npv_g"], npv_g_p), "npv": fig(X["npv"], npv_p)},
            "capacity": {"cash": fig(X["cash_cap"], R(sa, "cap.cash")), "room": fig(X["room"], room_p), "total": fig(X["capacity"], cap_p), "lev": fig(ca["lev"]["v"], R(sa, "lev")),
                         "lev_max": fig(A["lev"], AP["lev"]), **({"scr": fig(ca["cap"]["scr"]["v"], R(sa, "cap.scr"))} if ca["cap"].get("scr") else {})},
            "value": {"v0": fig(v0["v"], R(st, "val.v0")), "just": fig(ct["val"]["just"]["v"], R(st, "val.just")), "floor": fig(ct["val"]["floor"]["v"], R(st, "val.floor")),
                      "binds": ct["val"]["binds"], "earn": fig(ct["val"]["earn"]["v"], R(st, "val.earn")),
                      **({"book": fig(ct["val"]["book"]["v"], R(st, "val.book"))} if ct["val"]["book"] else {})},
            "premia": prem, "metric": metric, "fit": fit}


# ---------------------------------------------------------------- fit components (no composite)
FAM = {"pension", "gemel"}


def mix_of(I, c):
    """one company's product and track-category mix (consolidation/mix/<id>.json): AUM per regulator product at 06/26 (regulator
    provenance, rebuilt from the tracks when the source opens) and per track category at the funds.json month (every track listed)"""
    M = I.mkt
    g = next(iter(c["products"].values()))["g"]
    pi = M["periods"].index(AUM_YM)
    by = {}
    for r in M["rows"]:
        if r[0] == pi and r[2] == g and M["products"][r[1]]["family"] in FAM:
            k = M["products"][r[1]]["key"]
            by.setdefault(k, []).append(r[3])
    by = {k: fsum(v) for k, v in by.items()}
    fam = {f: fsum(r[3] for r in M["rows"] if r[0] == pi and r[2] == g and M["products"][r[1]]["family"] == f) for f in FAM}
    tot = fsum(by.values())
    regp = lambda st: {"k": "reg", "metric": "assets", "pi": pi, "w": "m", "set": st, "g": g}
    famin = [inp(f"נכסים · {({'pension': 'פנסיה', 'gemel': 'גמל והשתלמות'})[f]}", fm(fam[f] / 1000, 2), regp(f"fam:{f}")) for f in sorted(FAM, reverse=True)]
    prods = []
    for p in M["products"]:
        k = p["key"]
        if k not in by or not by[k]:
            continue
        w = by[k] / tot * 100
        prods.append({"key": k, "he": p["label"], "v": r6(by[k]), "w": r6(w),
                      "prov": calc(f"משקל {p['label']} · {c['name']} · 06/26", pct(w), "נכסי המוצר ÷ נכסי פנסיה וגמל × 100 (מיליארדי ש\"ח)",
                                   [inp(f"נכסים · {p['label']}", fm(by[k] / 1000, 2), regp(f"p:{k}"))] + famin, unit="%")})
    asof = I.funds["asof"]
    al = f"{asof % 100:02d}/{str(asof)[2:4]}"
    gname = M["groups"][g]
    xs = [f for f in I.funds["funds"] if f["grp"] == gname and f["fam"] in ("pensia", "gemel") and f.get("assets")]
    ttot = fsum(f["assets"] for f in xs)
    cats = {}
    for f in xs:
        cats.setdefault(f["track"], []).append(f)
    cl = []
    for cat in sorted(cats, key=lambda k: (-fsum(f["assets"] for f in cats[k]), k)):
        v = fsum(f["assets"] for f in cats[cat])
        w = v / ttot * 100
        cl.append({"cat": cat, "v": r6(v), "w": r6(w), "n": len(cats[cat]),
                   "prov": calc(f"משקל מסלולי {cat} · {c['name']} · {al}", pct(w), "Σ נכסי המסלולים בקטגוריה ÷ Σ נכסי מסלולי הפנסיה והגמל של הקבוצה × 100",
                                [inp(f["name"], fm(f["assets"], 1), {"k": "fund", "title": f"נכסים · {f['name']}", "value": fm(f["assets"], 1), "unit": MM, "ds": f["fam"], "id": f["id"],
                                                                     "period": asof, "col": "TOTAL_ASSETS"}) for f in sorted(cats[cat], key=lambda f: -f["assets"])]
                                + [inp(f"סך נכסי {len(xs)} המסלולים של הקבוצה", fm(ttot, 1))], unit="%", note=f"funds.json · {I.funds['source']}")})
    return {"id": c["id"], "name": c["name"], "g": g, "aum": {"period": "06/26", "tot": r6(tot), "prods": prods}, "tracks": {"period": al, "tot": r6(ttot), "n": len(xs), "cats": cl}}


def fit_of(ma, mt):
    """the three fit components between two mixes; no composite"""
    out = {}
    A, T = {x["key"]: (i, x) for i, x in enumerate(ma["aum"]["prods"])}, {x["key"]: (i, x) for i, x in enumerate(mt["aum"]["prods"])}
    rows, terms = [], []
    for k in list(dict.fromkeys([*A, *T])):
        ia, xa = A.get(k, (None, None))
        it, xt = T.get(k, (None, None))
        he = (xa or xt)["he"]
        wa, wt = xa["w"] if xa else 0.0, xt["w"] if xt else 0.0
        rows.append({"key": k, "he": he, "wa": wa, "wt": wt})
        if xa:
            terms.append(inp(f"{he} · {ma['name']}", pct(wa), R(f"m/{ma['id']}", f"aum.prods.{ia}")))
        if xt:
            terms.append(inp(f"{he} · {mt['name']}", pct(wt), R(f"m/{mt['id']}", f"aum.prods.{it}")))
    ov = fsum(min(x["wa"], x["wt"]) for x in rows)
    out["prod"] = {"v": fig(ov, calc(f"חפיפת מוצרים · {ma['name']} ↔ {mt['name']}", pct(ov), "Σ על המוצרים min(משקל הרוכשת, משקל היעד); משקל = נכסי המוצר ÷ נכסי פנסיה וגמל, 06/26",
                                     terms, unit="%")), "rows": rows, "period": "06/26"}
    A, T = {x["cat"]: (i, x) for i, x in enumerate(ma["tracks"]["cats"])}, {x["cat"]: (i, x) for i, x in enumerate(mt["tracks"]["cats"])}
    crows, cterms = [], []
    for k in list(dict.fromkeys([*A, *T])):
        ia, xa = A.get(k, (None, None))
        it, xt = T.get(k, (None, None))
        crows.append({"cat": k, "wa": xa["w"] if xa else 0.0, "wt": xt["w"] if xt else 0.0, "na": xa["n"] if xa else 0, "nt": xt["n"] if xt else 0})
        if xa and xt:   # a category held by one side only adds 0
            cterms.append(inp(f"{k} · {ma['name']}", pct(xa["w"]), R(f"m/{ma['id']}", f"tracks.cats.{ia}")))
            cterms.append(inp(f"{k} · {mt['name']}", pct(xt["w"]), R(f"m/{mt['id']}", f"tracks.cats.{it}")))
    co = fsum(min(x["wa"], x["wt"]) for x in crows)
    crows.sort(key=lambda x: -(x["wa"] + x["wt"]))
    out["track"] = {"v": fig(co, calc(f"צפיפות מסלולים · {ma['name']} ↔ {mt['name']}", pct(co), "Σ על קטגוריות המסלול min(משקל הרוכשת, משקל היעד); קטגוריה שרק לצד אחד מוסיפה 0",
                                      cterms, unit="%", est=not cterms)), "rows": crows, "period": ma["tracks"]["period"], "n": [ma["tracks"]["n"], mt["tracks"]["n"]]}
    out["channel"] = {"status": "nodata", "why": "אין נתון ציבורי חינמי על ערוצי ההפצה (סוכנים, ישיר, מעסיקים) לפי חברה מנהלת"}
    return out


# ---------------------------------------------------------------- the More example (verified before it is used)
def example(I):
    L = I.lens
    g = next(i for i, x in enumerate(L["groups"]) if x["id"] == "more")
    rows = {r["q"]: r for r in L["rows"] if r["g"] == g and r["s"] == "pen"}
    q = L["quarters"][-1]
    r = rows[q]
    rp = r["rep"]
    qn = f"{q[:2]}'{q[-2:]}"
    ltsp = lambda m, v: {"k": "lts", "c": "more", "metric": f"pen.{m}", "period": q, "title": {"fees": "הכנסות מדמי ניהול", "sm": "שיווק ומכירה", "ga": "הנהלה וכלליות", "op": "רווח תפעולי"}[m] + f" · מור · פנסיה · {qn}",
                         "unit": MM, "value": fm(v, 1)}
    more = I.drv["more"]
    avgp = next(p for p in more["products"] if p["s"] == "pen")["avg"]
    ci = (rp["sm"] + rp["ga"]) / rp["fees"] * 100
    ppb = rp["op"] * 4 / (r["reg"]["avg"] / 1000)
    first = L["quarters"][0]
    f0 = rows[first]
    pg = next(x for x in L["rows"] if x["g"] == g and x["s"] == "pg" and x["q"] == q)
    return {"claim": "מור ביחס עלות להכנסה 164% ורווח של −1.99 מיליון ש\"ח לכל מיליארד: מתקנת או נרכשת",
            "id": "more", "seg": "pen", "q": qn,
            "ci": fig(ci, calc(f"יחס עלות להכנסה · מור · פנסיה · {qn}", pct(ci, 2), "(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול × 100 (lens.json)",
                               [inp("שיווק ומכירה", fm(rp["sm"], 1), ltsp("sm", rp["sm"])), inp("הנהלה וכלליות", fm(rp["ga"], 1), ltsp("ga", rp["ga"])), inp("הכנסות מדמי ניהול", fm(rp["fees"], 1), ltsp("fees", rp["fees"]))], unit="%")),
            "ppb": fig(ppb, calc(f"רווח תפעולי לכל מיליארד נכסים · מור · פנסיה · {qn}", fm(ppb, 2), "רווח תפעולי × 4 ÷ (נכסים ממוצעים ÷ 1,000), קצב שנתי (lens.json)",
                                 [inp("רווח תפעולי", fm(rp["op"], 1), ltsp("op", rp["op"])), inp("נכסים ממוצעים, רשות", fm(r["reg"]["avg"], 0), avgp["prov"])], unit="מיליוני ש\"ח למיליארד")),
            "ok": abs(ci - 164) < 0.5 and abs(ppb + 1.99) < 0.01,
            "aum": r6(r["reg"]["avg"]), "first": {"q": f"{first[:2]}'{first[-2:]}", "ci": f0["ci"], "aum": f0["reg"]["avg"]},
            "pg_ci": pg.get("ci"), "pg_ppb": pg.get("ppb"),
            "roe": r6(more["nodes"]["roe"]["v"]),
            "note": "מאומת בנתונים: הדוגמה היא קרן הפנסיה של מור, לא החברה כולה; פנסיה וגמל יחד ביחס של כ-87% ורווחיים, והחברה כולה ב-ROE של כ-43%. קרן צעירה שצמחה פי 12 בנכסים מ-Q1'23 והיחס ירד מ-671%"}


# ---------------------------------------------------------------- the whole screen
def build():
    I = Inputs()
    A0 = None
    built = max((f["meta"]["built"] for f in I.drv.values()), default="")
    base = next(iter(I.drv.values()))["meta"]["base"]
    cos, excluded = {}, []
    marks = set(I.lens.get("marks", {}))
    for cid, r in I.reg.items():
        if cid in SKIP:
            excluded.append({"id": cid, "name": r["name_he"], "why": SKIP[cid]})
            continue
        if cid not in I.drv:
            excluded.append({"id": cid, "name": r["name_he"], "why": "אין קובץ מנגנונים (A1)"})
            continue
        c = company(I, cid, A0)
        if c["status"] != "ok":
            excluded.append({"id": cid, "name": c["name"], "why": c["why"]})
            continue
        c["nc"] = cid in marks
        if c["nc"]:
            c["nc_why"] = I.lens["marks"][cid]["text"]
        cos[cid] = c
    mult = multiple(I)
    for c in cos.values():
        apply_floor(c, mult)
    Ad = assumptions(cos, A0)
    A = assume_vals(Ad)
    ids = sorted(cos, key=lambda c: (cos[c]["kind"] != "insurance_group", c))
    mix = {c: mix_of(I, cos[c]) for c in ids}
    pairs, docs = [], {}
    for a in ids:
        for t in ids:
            if a == t:
                continue
            X = compute(cos[a], cos[t], A)
            pairs.append({"a": a, "t": t, "X": X, "nc": cos[a]["nc"] or cos[t]["nc"]})
    ranked = sorted([p for p in pairs if not p["nc"] and p["X"]["metric"] is not None], key=lambda p: (-p["X"]["metric"], p["a"], p["t"]))
    rk = {(p["a"], p["t"]): i + 1 for i, p in enumerate(ranked)}
    rows = []
    for p in pairs:
        a, t, X = p["a"], p["t"], p["X"]
        q20 = next(x for x in X["prem"] if x["p"] == PRIMARY)
        fit = fit_of(mix[a], mix[t])
        docs[f"{a}__{t}"] = pair_doc(cos[a], cos[t], A, Ad, X, fit, p["nc"], rk.get((a, t)), built, base)
        rows.append({"a": a, "t": t, "rank": rk.get((a, t)), "nc": p["nc"], "gross": r6(X["gross"]), "net": r6(X["net"]), "npv_g": r6(X["npv_g"]), "npv": r6(X["npv"]),
                     "cap": r6(X["capacity"]), "price": r6(q20["price"]), "ok": q20["ok"], "metric": r6(X["metric"]), "eps": r6(q20["eps"]), "roe": r6(q20["roe"]),
                     "solv": r6(q20["solv"]), "fit_prod": r6(fit["prod"]["v"]["v"]), "fit_track": r6(fit["track"]["v"]["v"])})
    rows.sort(key=lambda r: (r["rank"] is None, r["rank"] or 0, r["a"], r["t"]))
    # the A7 bolt-on: the best-ranked target each A7 insurer can afford at the primary premium, with a positive synergy NPV
    bolt = {}
    for a in ids:
        if cos[a]["cap"]["kind"] != "a7":
            continue
        cand = [r for r in rows if r["a"] == a and r["rank"] is not None and r["ok"] and r["npv"] > 0]
        if not cand:
            bolt[a] = {"status": "none", "why": "אין יעד שהרוכשת יכולה לממן בפרמיה 20% עם ערך נוכחי חיובי לסינרגיה"}
            continue
        b = min(cand, key=lambda r: r["rank"])
        bolt[a] = {"status": "ok", "t": b["t"], "name": cos[b["t"]]["name"], "pair": f"{a}__{b['t']}", "rank": b["rank"], "premium": PRIMARY}
    M0 = {"meta": {"assume": Ad, "mult": mult}, "cos": cos, "mix": mix}
    full = {}
    for a, x in bolt.items():
        if x["status"] != "ok":
            continue
        d = docs[x["pair"]]
        q = next(y for y in d["premia"] if y["p"] == PRIMARY)
        F, src = to_capital({"price": q["price"], "roic": q["roic"], "solv": q.get("solv"), "solv_gw": q.get("solv_gw"), "roe": q["roe"], "eps": q["eps"],
                             "npv": d["synergy"]["npv"], "metric": d["metric"]}, M0, d)
        full[a] = {**x, **{k: v for k, v in F.items() if v is not None}, "src": src}
        x.update({k: v["v"] for k, v in F.items() if v is not None})
    matrix = {"meta": {"built": built, "base": base, "v": 1, "asof": {"aum": "06/26", "funds": f"{I.funds['asof'] % 100:02d}/{str(I.funds['asof'])[2:4]}"},
                       "formula": {"synergy": "נכסי היעד × תשואת דמי ניהול × (יחס עלות היעד − יחס עלות הרוכשת): חיובי כשהרוכשת זולה יותר",
                                   "npv": "Σ סינרגיה × מימוש × (1 − מס) × a(H, ke) − עלות אינטגרציה × (1 − מס)",
                                   "capacity": "קיבולת מזומן (A7 / הון עצמי) + max(0, L ÷ (1 − L) × הון − חוב)",
                                   "price": "max(שווי מוצדק עצמאי, נכסים × שווי לכל מיליארד של בתי ההשקעות הנסחרים) × (1 + פרמיה); מזומן קודם, השאר חוב",
                                   "metric": "ערך נוכחי של הסינרגיה ÷ מחיר בפרמיה 20%"},
                       "assume": Ad, "mult": mult, "premia": PREMIA, "primary": PRIMARY, "products": PRODUCTS,
                       "inputs": ["drivers/<co>.json", "capital (A7, pipeline/build_capital.py)", "lens.json", "market.json", "funds.json", "flow_npv.json", "companies/<id>.price.json"],
                       "example": example(I), "excluded": excluded,
                       "note": "מספרים אנליטיים, לא המלצה לקנות או למכור דבר"},
              "cos": cos, "pairs": rows, "bolt": bolt}
    for a, x in bolt.items():
        if x["status"] != "ok":
            full[a] = x
    for x in excluded:   # an A7 insurer outside the screen still gets a row that says why
        if I.reg.get(x["id"], {}).get("kind") == "insurance_group":
            bolt[x["id"]] = full[x["id"]] = {"status": "none", "why": f"החברה אינה במסך האיחודים: {x['why']}"}
    boltf = {"meta": {"built": built, "base": base, "v": 1, "premium": PRIMARY, "rule": "היעד המדורג ראשון שהרוכשת יכולה לממן בפרמיה 20%, עם ערך נוכחי חיובי לסינרגיה",
                      "refs": "bolt.<pointer>: the table `src` of the same entry (build_capital.resolve)"}, "bolt": full}
    return matrix, docs, mix, boltf


# ---------------------------------------------------------------- verification
KINDS = ("report", "calc", "lts", "reg", "fund", "xbrl", "none", "ref", "price")


def walk(p, where, bad, M, doc=None, depth=0, bolt=None):
    if depth > 80:
        bad.append(("provenance chain too deep", where))
        return
    if not isinstance(p, dict) or "k" not in p:
        bad.append(("no provenance", where))
        return
    k = p["k"]
    if k == "ref":
        if p["r"].startswith("bolt.") and bolt is not None:
            q = bolt.get(p["r"][5:])
        else:
            q = res(p["r"], M, doc)
        if q is None:
            bad.append(("ref does not resolve", where, p["r"]))
        else:
            walk(q, where + " > " + p["r"][-30:], bad, M, doc, depth + 1, bolt)
        return
    if k not in KINDS:
        bad.append(("unknown provenance kind", where, k))
    elif k == "report":
        if not p.get("url"):
            bad.append(("report without a url", where, p.get("title")))
        if p.get("pg") is None and "בנק ישראל" not in (p.get("doc") or "") and "ת126" not in (p.get("doc") or ""):
            bad.append(("report without a page", where, p.get("title")))
    elif k == "reg":
        if not all(x in p for x in ("metric", "pi", "w", "set", "g")):
            bad.append(("regulator figure without its key", where))
    elif k == "fund":
        if not all(p.get(x) for x in ("ds", "id", "period", "col")):
            bad.append(("track figure without its key", where))
    elif k == "price":
        if not all(p.get(x) for x in ("ticker", "vendor", "date", "value")):
            bad.append(("market figure without ticker / source / date", where))
    elif k == "lts":
        if not all(p.get(x) for x in ("c", "metric", "period")):
            bad.append(("report component without its key", where))
    elif k == "none":
        bad.append(("missing source", where, p.get("title")))
    elif k == "calc":
        if not p.get("inputs") and not p.get("est"):
            bad.append(("calc without inputs, not an assumption", where, p.get("title")))
        for x in p.get("inputs", []):
            if x.get("p") is not None:
                walk(x["p"], where + " > " + x["label"][:24], bad, M, doc, depth + 1, bolt)
            elif not p.get("est") and not x["label"].startswith("סך") and not x["label"].startswith("פרמיה"):
                bad.append(("calc input without provenance", where, x["label"][:40]))


def figs(x, where, out):
    """every {v, prov} in a document"""
    if isinstance(x, dict):
        if "v" in x and "prov" in x and len(x) == 2:
            out.append((where, x))
            return
        for k, v in x.items():
            figs(v, f"{where}.{k}", out)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            figs(v, f"{where}[{i}]", out)


def verify(matrix, docs, mix=None, boltf=None):
    bad, n = [], 0
    matrix = {**matrix, "mix": mix or {}}
    A7.finite(matrix, "matrix", bad)
    for k, d in docs.items():
        A7.finite(d, k, bad)
    Ad = matrix["meta"]["assume"]
    for k in ("r", "ic", "h", "lev", "kd"):
        if k not in Ad or "prov" not in Ad[k] or not Ad[k]["prov"].get("est"):
            bad.append(("assumption not listed or not labelled", k))
    A = assume_vals(Ad)
    cos = matrix["cos"]
    mu = matrix["meta"].get("mult")
    if not mu or not mu.get("prov") or len(mu["peers"]) < 3:
        bad.append(("the AUM multiple is missing or thin",))
    else:
        walk(mu["prov"], "mult", bad, matrix)
        if abs(median(x["v"] for x in mu["peers"]) - mu["v"]) > 1e-6 or any(abs(x["mcap"] / (x["aum"] / 1000) - x["v"]) > 1e-4 for x in mu["peers"]):
            bad.append(("multiple ≠ median of market value ÷ AUM",))
        if any(x["id"] in MULT_EXCL for x in mu["peers"]):
            bad.append(("an excluded house is in the multiple",))
    for cid, c in cos.items():
        V = c["val"]
        n += 1
        fl = fsum(x["aum"]["v"] for x in c["products"].values()) / 1000 * mu["v"]
        if abs(V["floor"]["v"] - fl) > ABS or abs(V["v0"]["v"] - max(V["just"]["v"], V["floor"]["v"])) > ABS or V["binds"] != ("aum" if V["floor"]["v"] > V["just"]["v"] else "just"):
            bad.append(("price base ≠ max(justified, AUM floor), or the binding label is wrong", cid))
    for k, d in docs.items():
        a, t = d["acq"]["id"], d["tgt"]["id"]
        ca, ct = cos[a], cos[t]
        X = compute(ca, ct, A)
        # the synergy identity, product by product: gross = AUM × fy × (ci_t − ci_a)
        for x in d["products"]:
            g = x["aum"]["v"] * x["fy"]["v"] / 100 * (x["ci_t"]["v"] - x["ci_a"]["v"]) / 100
            n += 1
            if abs(g - x["gross"]["v"]) > ID_TOL * max(1, abs(g)):
                bad.append(("synergy identity", k, x["s"], g, x["gross"]["v"]))
            ci = ct["products"][x["s"]]["opex"]["v"] / ct["products"][x["s"]]["fees"]["v"] * 100
            if abs(ci - x["ci_t"]["v"]) > 1e-6:
                bad.append(("c/i ≠ opex ÷ fees", k, x["s"]))
            if (x["gross"]["v"] > 0) != (x["ci_t"]["v"] > x["ci_a"]["v"]) and abs(x["gross"]["v"]) > 1e-9:
                bad.append(("synergy direction: positive only when the acquirer is cheaper", k, x["s"]))
            if abs(x["net"]["v"] - x["gross"]["v"] * A["r"] / 100) > ID_TOL * max(1, abs(x["gross"]["v"])):
                bad.append(("net ≠ gross × realisation", k, x["s"]))
        S = d["synergy"]
        n += 3
        if abs(S["gross"]["v"] - fsum(x["gross"]["v"] for x in d["products"])) > ABS:
            bad.append(("Σ gross", k))
        if abs(S["npv"]["v"] - (fsum(x["npv"]["v"] for x in d["products"]) - S["ic"]["v"] * (1 - ca["pnl"]["tax"]["v"] / 100))) > ABS:
            bad.append(("NPV identity", k))
        C = d["capacity"]
        if abs(C["total"]["v"] - C["cash"]["v"] - C["room"]["v"]) > ABS:
            bad.append(("capacity = cash + debt headroom", k))
        for q in d["premia"]:
            n += 2
            if abs(q["cash"]["v"] + q["debt"]["v"] - q["price"]["v"]) > ABS:
                bad.append(("financing: cash + debt ≠ price", k, q["p"]))
            if q["ok"] != (q["price"]["v"] <= C["total"]["v"] + 1e-9):
                bad.append(("affordable ⇔ price ≤ capacity", k, q["p"]))
        # the numbers re-derive from the company inputs
        if abs(X["npv"] - S["npv"]["v"]) > ABS or abs((X["metric"] or 0) - (d["metric"]["v"] or 0)) > ABS:
            bad.append(("pair does not re-derive", k))
        # provenance on every figure
        fs_ = []
        figs(d, k, fs_)
        for where, f in fs_:
            if f["v"] is not None:
                walk(f["prov"], where, bad, matrix, d)
    for cid, c in cos.items():
        fs_ = []
        figs(c, cid, fs_)
        for where, f in fs_:
            if f["v"] is not None:
                walk(f["prov"], where, bad, matrix)
    for k in ("r", "ic", "h", "lev", "kd"):
        walk(Ad[k]["prov"], f"assume.{k}", bad, matrix)
    ex = matrix["meta"]["example"]
    walk(ex["ci"]["prov"], "example.ci", bad, matrix)
    walk(ex["ppb"]["prov"], "example.ppb", bad, matrix)
    for cid, m in (mix or {}).items():
        for x in m["aum"]["prods"] + m["tracks"]["cats"]:
            walk(x["prov"], f"mix.{cid}", bad, matrix)
        if abs(fsum(x["w"] for x in m["aum"]["prods"]) - 100) > 1e-3 or abs(fsum(x["w"] for x in m["tracks"]["cats"]) - 100) > 1e-3:
            bad.append(("mix weights do not add to 100%", cid))
    for a, b in ((boltf or {}).get("bolt") or {}).items():
        if b["status"] == "ok":
            for k in ("price", "roic", "solv", "roe", "eps", "npv", "metric"):
                if k in b:
                    walk(b[k]["prov"], f"bolt.{a}.{k}", bad, matrix, None, 0, b["src"])
                    if abs(b[k]["v"] - matrix["bolt"][a][k]) > 1e-9:
                        bad.append(("bolt.json ≠ matrix bolt", a, k))
    if len(docs) != len(matrix["pairs"]):
        bad.append(("one pair file per matrix row", len(docs), len(matrix["pairs"])))
    for a, b in matrix["bolt"].items():
        if b["status"] == "ok":
            r = next(x for x in matrix["pairs"] if x["a"] == a and x["t"] == b["t"])
            better = [x for x in matrix["pairs"] if x["a"] == a and x["rank"] is not None and x["ok"] and x["npv"] > 0 and x["rank"] < r["rank"]]
            if better or not r["ok"]:
                bad.append(("bolt-on is not the best affordable target", a))
    return bad, n


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


def outputs(matrix, docs, mix, boltf):
    out = {"matrix.json": matrix, "bolt.json": boltf}
    out.update({f"pairs/{k}.json": d for k, d in docs.items()})
    out.update({f"mix/{k}.json": m for k, m in mix.items()})
    return out


def same_on_disk(files):
    have = {str(p.relative_to(OUT)) for p in OUT.rglob("*.json")}
    if have != set(files):
        return False, f"file set ({len(have)} on disk vs {len(files)})"
    for k, d in files.items():
        if json.loads((OUT / k).read_text(encoding="utf8")) != json.loads(dumps(d)):
            return False, k
    return True, ""


if __name__ == "__main__":
    matrix, docs, mix, boltf = build()
    bad, n = verify(matrix, docs, mix, boltf)
    files = outputs(matrix, docs, mix, boltf)
    nr = sum(1 for r in matrix["pairs"] if r["rank"] is not None)
    if "--check" in sys.argv:
        same, what = same_on_disk(files)
        print(f"consolidation: {len(matrix['cos'])} companies, {len(docs)} pairs ({nr} ranked), {n} identities; "
              f"{'rebuild matches' if same else 'DIFFERS: ' + what}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    for d in ("pairs", "mix"):
        (OUT / d).mkdir(parents=True, exist_ok=True)
    for p in OUT.rglob("*.json"):
        if str(p.relative_to(OUT)) not in files:
            p.unlink()
    for k, d in files.items():
        (OUT / k).write_text(dumps(d), encoding="utf8")
    size = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    print(f"wrote consolidation/: matrix.json, bolt.json, {len(docs)} pairs, {len(mix)} mixes, {size:,} bytes; {len(matrix['cos'])} companies, {nr} ranked, {n} identities")
    ex = matrix["meta"]["example"]
    print(f"  example: More pension {ex['q']} c/i {ex['ci']['v']:.2f}% profit per bn {ex['ppb']['v']:.3f} -> {'verified' if ex['ok'] else 'NOT VERIFIED'}")
    for r in matrix["pairs"][:8]:
        print(f"  #{r['rank']} {r['a']:9s} <- {r['t']:9s} NPV {r['npv']:8.1f} price20 {r['price']:8.1f} metric {r['metric']:6.1f}% cap {r['cap']:8.1f} ok {r['ok']} eps {r['eps']:6.2f}%")
    for a, b in matrix["bolt"].items():
        print(f"  bolt {a}: {b.get('t', '-')} {b['status']} roic {b.get('roic')} solv {b.get('solv')}")
