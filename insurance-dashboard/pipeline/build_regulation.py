"""A8 · the Regulatory Impact Simulator: the tracked pipeline of Capital Market Authority and Ministry of Finance initiatives, each modelled
as a shock through the A1 driver graph, per manager x product, at a low / central / high band.

Inputs
  data/regulation/initiatives.json      the hand-curated register: real initiatives, each with its public document (gov.il), the page,
                                        the retrieval date, and the modelled shock (parameters labelled `source` or `assumption`)
  web/public/data/drivers/<co>.json     A1: per product the average assets (Q2'26), the LTM fee yield, the variable-cost edge, the tax rate
  web/public/data/market.json           the regulator's monthly files: new-pension deposits per group (LTM), gemel-for-investment assets
Output
  web/public/data/regulation/impact.json   the register + impacts per initiative x manager x band + the exposure to the whole pipeline

python3 pipeline/build_regulation.py           build
python3 pipeline/build_regulation.py --check   rebuild in memory, compare with the file on disk and verify (exit 1 on any miss): every
                                               initiative has a public source URL and a retrieval date, every impact has its inputs with
                                               provenance, no NaN, the default-fund redistribution sums to zero, the exposure equals
                                               Σ weight × impact. web/tests/regulation.unit.ts then re-propagates every product shock
                                               through web/src/lib/drivers.ts (the single source of the arithmetic) and must match.

The arithmetic is drivers.ts propagate() for a fee / flow shock on one product (no market, CPI or insurance shock):
  ΔAUM = AUM × flow / 100;  Δrevenue = (AUM + ΔAUM) × (fy − fee / 100) / 100 − AUM × fy / 100;  Δvariable cost = β_opex × ΔAUM / 1000;
  Δpre-tax profit = Δrevenue − Δvariable cost;  Δnet = Δpre-tax × (1 − tax / 100).
Units: NIS millions a year at a run rate (no timing, no discounting); fee in bp of assets, flow in % of the product's assets a year.
A rule priced differently from the product's yield (the default funds' 0.22%) maps to an exact A1 fee shock on that product:
  fee_bp = 100 × ΔAUM × (fy − price) ÷ (AUM + ΔAUM), so that Δrevenue = ΔAUM × price / 100.
Phoenix is computed like every other manager.
"""
import json
import math
import re
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
SRC = ROOT / "data" / "regulation" / "initiatives.json"
OUT = WEB / "regulation" / "impact.json"
DRIVERS = WEB / "drivers"
MARKET = WEB / "market.json"

MM = 'מיליוני ש"ח'
BN = 'מיליארד ש"ח'
MINUS = "−"
BANDS = ("low", "central", "high")
BAND_HE = {"low": "נמוך", "central": "מרכזי", "high": "גבוה"}
STATUSES = ("proposal", "consultation", "approved", "in_force")
TYPES = ("fee", "default", "substitution", "solvency", "transparency", "cost")
KINDS = ("fee", "default", "substitution", "none")
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות", "ic": "פוליסות חיסכון (חוזי השקעה)"}
ALLOWED = re.compile(r"^https://(www\.)?(gov\.il|[a-z0-9.-]+\.gov\.il|main\.knesset\.gov\.il|knesset\.gov\.il)/")
# a manager whose savings figures are another file's (the regulator group of מור is drivers/more.json as well)
DUPLICATE = {"more_gemel": "נתוני החיסכון של קבוצת מור ברשות, זהים לקובץ של מור; נספרים פעם אחת"}
LTM = (202507, 202606)   # the LTM of the driver files' base (Q3'25–Q2'26), in the regulator's months
AT = 202606              # the base quarter's last month


def r(x, d=4):
    return None if x is None else round(x + 0.0, d)


def nf(v, d=1):
    if v is None:
        return "–"
    s = f"{abs(v):,.{d}f}"
    return (MINUS if v < 0 and float(s.replace(",", "")) != 0 else "") + s


def sn(v, d=1):
    return ("+" if v is not None and round(v, d) > 0 else "") + nf(v, d)


def pc(v, d=2):
    return nf(v, d) + "%"


def P_calc(title, value, unit, formula, inputs, est=False, note=None):
    p = {"k": "calc", "title": title, "value": value, "unit": unit, "formula": formula,
         "inputs": [dict({"label": a, "v": b}, **({"p": c} if c else {})) for a, b, c in inputs]}
    if est:
        p["est"] = True
    if note:
        p["note"] = note
    return p


def P_rep(title, value, unit, url, pg, doc, period, note=None):
    p = {"k": "report", "title": title, "value": value, "unit": unit, "url": url, "pg": pg, "doc": doc, "period": period, "srcType": "regulator"}
    if note:
        p["note"] = note
    return p


def P_reg(metric, month, setid, g, periods):
    return {"k": "reg", "metric": metric, "pi": periods.index(month), "w": "m", "set": setid, "g": g}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf8"))


# ------------------------------------------------------------------------------------------------------------------------------ the A1 arithmetic
def edge(p, e):
    return next((x for x in p["edges"] if x["e"] == e), None)


def usable(e):
    return e is not None and e.get("quality") != "missing" and e.get("v") is not None


def per(e):
    return e["v"] / (e.get("x") or 1)


def prod_delta(p, flow, fee):
    """drivers.ts propagate() restricted to one product and a {flow, fee} shock: ΔAUM, Δrevenue, Δvariable cost, Δpre-tax profit"""
    A, fy = p["avg"]["v"], p["fy"]["v"]
    dA = A * flow / 100
    dRev = (A + dA) * (fy - fee / 100) / 100 - A * fy / 100
    vc = edge(p, "aum.opex")
    dVar = per(vc) * dA / 1000 if usable(vc) else 0.0
    return dA, dRev, dVar, dRev - dVar


def fee_equiv(A, dA, fy, price):
    """the A1 fee shock (bp) on a product so that the extra assets earn `price` (%) instead of the product's yield"""
    return 100 * dA * (fy - price) / (A + dA) if A + dA else 0.0


# ------------------------------------------------------------------------------------------------------------------------------ inputs
class Inputs:
    def __init__(self):
        self.reg = load(SRC)
        self.graph = load(DRIVERS / "graph.json")
        self.files = {f.stem: load(f) for f in sorted(DRIVERS.glob("*.json")) if f.name != "graph.json"}
        m = load(MARKET)
        self.m = m
        self.P = m["periods"]
        self.G = m["groups"]
        self.prods = [x["key"] for x in m["products"]]
        fam = [x["family"] for x in m["products"]]
        self.dep, self.gi, self.gfam = {}, {}, {}
        for row in m["rows"]:
            p, prod, g = self.P[row[0]], self.prods[row[1]], row[2]
            if prod == "pension_new" and LTM[0] <= p <= LTM[1]:
                self.dep[g] = self.dep.get(g, 0.0) + (row[4] or 0.0)
            if p == AT and prod == "gemel_invest":
                self.gi[g] = row[3] or 0.0
            if p == AT and fam[row[1]] == "gemel":
                self.gfam[g] = self.gfam.get(g, 0.0) + (row[3] or 0.0)
        self.dep_total = fsum(self.dep.values())
        any_f = next(iter(self.files.values()))
        self.base = any_f["meta"]["base"]


def managers(I):
    """the managers with at least one savings product in A1 (a fee yield and average assets), once each"""
    out, excl = [], []
    for c, f in I.files.items():
        if c in DUPLICATE:
            excl.append({"c": c, "name": f["meta"]["name"], "why": DUPLICATE[c]})
            continue
        ps = [p for p in f["products"] if p.get("avg", {}).get("v") is not None and (p.get("fy") or {}).get("v") is not None]
        if not ps:
            excl.append({"c": c, "name": f["meta"]["name"], "why": "אין בקובץ המנגנונים מוצר חיסכון עם נכסים ותשואת דמי ניהול"})
            continue
        out.append(c)
    return out, excl


def src_prov(ini, i, value, unit="", note=None):
    s = ini["sources"][i]
    return P_rep(f"{ini['short']} · {s['title']}", value, unit, s["url"], s.get("pg"), s["doc"], s["doc"].split(", ")[-1],
                 note=note or f"נשלף {s['retrieved']}")


def param_prov(ini, prm, band):
    v = prm[band]
    if prm["src"] == "source":
        return src_prov(ini, prm.get("srcIdx", 0), f"{nf(v, 2)}{prm['unit']}", prm["unit"], note=prm.get("why"))
    return P_calc(f"{prm['he']} · {ini['short']} · תרחיש {BAND_HE[band]}", nf(v, 2), prm["unit"],
                  "הנחת מודל, גלויה; טווח נמוך / מרכזי / גבוה: " + " / ".join(nf(prm[b], 2) for b in BANDS),
                  [("נימוק", prm.get("why", "הנחה"), None)], est=True)


def pin(p, f):
    """a product's row in an impact: the inputs (assets, fee yield, variable cost) live once per manager in out["managers"]"""
    return {"s": p["s"]}


def mgr_inputs(f):
    """a manager's A1 inputs with their provenance, once for the whole file"""
    prods = {}
    for p in f["products"]:
        if p["avg"].get("v") is None or (p.get("fy") or {}).get("v") is None:
            continue
        vc = edge(p, "aum.opex")
        prods[p["s"]] = {"he": p["he"], "A": {"v": r(p["avg"]["v"]), "period": p["avg"]["period"], "p": p["avg"]["prov"]},
                         "fy": {"v": r(p["fy"]["v"], 6), "period": p["fy"]["period"], "p": p["fy"]["prov"]},
                         "vc": {"v": r(per(vc), 6), "q": vc["quality"], "p": vc["prov"]} if usable(vc) else None}
    np_ = f["nodes"].get("net_profit")
    return {"name": f["meta"]["name"], "kind": f["meta"]["kind"], "tax": f["meta"]["assume"]["tax"], "products": prods,
            "np": {"v": np_["v"], "period": np_["period"], "p": np_["prov"]} if np_ and np_.get("v") else None}


# ------------------------------------------------------------------------------------------------------------------------------ the models
def model_fee(I, ini, c, f):
    """transparency as a fee-yield compression proxy: the same bp on every listed product"""
    prm = {x["k"]: x for x in ini["model"]["params"]}["fee"]
    out = []
    for p in f["products"]:
        if p["s"] not in ini["model"]["products"] or p["avg"].get("v") is None or (p.get("fy") or {}).get("v") is None:
            continue
        x = pin(p, f)
        x["shock"] = {b: {"flow": 0.0, "fee": r(prm[b], 6)} for b in BANDS}
        x["basis"] = [{"label": prm["he"], "v": {b: r(prm[b], 6) for b in BANDS}, "unit": 'נ"ב', "est": True, "param": "fee"}]
        out.append(x)
    return out, []


def model_substitution(I, ini, c, f):
    """product substitution: an outflow and a fee compression on the eligible assets; ic in full, gem on the gemel-for-investment share"""
    P = {x["k"]: x for x in ini["model"]["params"]}
    out, flags = [], []
    for p in f["products"]:
        if p["s"] not in ini["model"]["products"] or p["avg"].get("v") is None or (p.get("fy") or {}).get("v") is None:
            continue
        x = pin(p, f)
        basis = [{"label": P["out"]["he"], "v": {b: r(P["out"][b], 6) for b in BANDS}, "unit": P["out"]["unit"], "est": True, "param": "out"},
                 {"label": P["fee"]["he"], "v": {b: r(P["fee"][b], 6) for b in BANDS}, "unit": 'נ"ב', "est": True, "param": "fee"}]
        theta = 1.0
        if p["s"] == "gem":
            g = p["g"]
            gi, fam = I.gi.get(g, 0.0), I.gfam.get(g, 0.0)
            if not fam:
                flags.append(f"{SEG_HE['gem']}: אין נכסי גמל ברשות לקבוצה ב-06/26; לא חושב")
                continue
            theta = gi / fam
            if not theta:
                continue  # no gemel-for-investment assets: nothing eligible
            tp = P_calc(f"חלק קופות הגמל להשקעה · {I.G[g]} · 06/26", pc(theta * 100, 1), "%", "נכסי גמל להשקעה ÷ נכסי כל מוצרי הגמל של הקבוצה, סוף החודש",
                        [("גמל להשקעה", nf(gi / 1000, 2) + " מיליארד", P_reg("assets", AT, "p:gemel_invest", g, I.P)),
                         ("כל מוצרי הגמל", nf(fam / 1000, 2) + " מיליארד", P_reg("assets", AT, "fam:gemel", g, I.P))],
                        note="הנכסים הזכאים מתומחרים בתשואת דמי הניהול הממוצעת של מוצר גמל והשתלמות (הנחה)")
            basis.append({"label": P["theta"]["he"], "v": {b: r(theta * 100, 4) for b in BANDS}, "unit": "%", "est": False, "p": tp})
        x["shock"] = {b: {"flow": r(-P["out"][b] * theta, 6), "fee": r(P["fee"][b] * theta, 6)} for b in BANDS}
        x["basis"] = basis
        out.append(x)
    return out, flags


def model_default(I, ini, c, f):
    """default-track rule: the joiners' deposits go to the selected funds by ID check digit instead of by each group's LTM deposit share"""
    P = {x["k"]: x for x in ini["model"]["params"]}
    split, price = P["alloc"]["split"], P["fee_assets"]["central"]
    p = next((q for q in f["products"] if q["s"] == "pen" and q["avg"].get("v") is not None and (q.get("fy") or {}).get("v") is not None), None)
    if p is None:
        return [], []
    g = p["g"]
    dep = I.dep.get(g, 0.0)
    if not dep and c not in split:
        return [], []
    T = I.dep_total
    m = dep / T
    a = split.get(c, 0) / 100
    A, fy = p["avg"]["v"], p["fy"]["v"]
    x = pin(p, f)
    depP = P_calc(f"הפקדות LTM לקרנות פנסיה חדשות · {I.G[g]}", nf(dep), MM, f"Σ DEPOSITS {str(LTM[0])[4:]}/{str(LTM[0])[2:4]}–{str(LTM[1])[4:]}/{str(LTM[1])[2:4]}, כל הקרנות החדשות של הקבוצה",
                  [("מקור", "פנסיה-נט, data.gov.il (market.json)", None)])
    totP = P_calc("הפקדות LTM לקרנות פנסיה חדשות · כל השוק", nf(T), MM, "Σ ההפקדות של כל הקבוצות באותם חודשים", [("מקור", "פנסיה-נט, data.gov.il (market.json)", None)])
    mP = P_calc(f"נתח ההפקדות · {I.G[g]}", pc(m * 100, 2), "%", "הפקדות הקבוצה ÷ הפקדות כל השוק, LTM", [("הפקדות הקבוצה", nf(dep), depP), ("הפקדות השוק", nf(T), totP)])
    aP = src_prov(ini, 0, pc(a * 100, 0), "%", note="חלוקה לפי ספרת הביקורת במספר תעודת הזהות")
    shock, basis_flow = {}, {}
    for b in BANDS:
        D = P["s"][b] / 100 * T
        net = D * (a - m)
        flow = net / A * 100
        dA = A * flow / 100
        fee = fee_equiv(A, dA, fy, price) if a > 0 else 0.0
        shock[b] = {"flow": r(flow, 8), "fee": r(fee, 8)}
        basis_flow[b] = (D, net)
    sP = {b: param_prov(ini, P["s"], b) for b in BANDS}
    netP = {b: P_calc(f"הסטת הפקדות · {f['meta']['name']} · תרחיש {BAND_HE[b]}", sn(basis_flow[b][1]), MM,
                      "D × (חלק הקרן בחלוקה − נתח ההפקדות של הקבוצה); D = s × הפקדות השוק",
                      [("s, חלק המצטרפים שלא בחרו (הנחה)", pc(P["s"][b], 1), sP[b]), ("הפקדות השוק LTM", nf(T), totP),
                       ("חלק הקרן בחלוקה", pc(a * 100, 0), aP if a else None), ("נתח ההפקדות של הקבוצה (חלופה נגדית, הנחה)", pc(m * 100, 2), mP)], est=True) for b in BANDS}
    x["shock"] = shock
    x["basis"] = [
        {"label": "הסטת הפקדות לשנה", "v": {b: r(basis_flow[b][1], 4) for b in BANDS}, "unit": MM, "est": True, "pb": netP},
        {"label": "חלק הקרן בחלוקה", "v": {b: r(a * 100, 4) for b in BANDS}, "unit": "%", "est": False, "p": aP},
        {"label": "נתח ההפקדות של הקבוצה (חלופה נגדית)", "v": {b: r(m * 100, 4) for b in BANDS}, "unit": "%", "est": True, "p": mP},
    ]
    if a:
        pp = src_prov(ini, 0, pc(price, 2), "%", note="דמי ניהול מהצבירה בקרן נבחרת; דמי הניהול מההפקדה (1%) לא נכללו")
        x["basis"].append({"label": "דמי ניהול על הנכסים הנוספים", "v": {b: r(price, 4) for b in BANDS}, "unit": "%", "est": False, "p": pp})
    x["net_flow"] = {b: r(basis_flow[b][1], 4) for b in BANDS}
    return [x], []


MODELS = {"fee": model_fee, "substitution": model_substitution, "default": model_default}


def impact(I, ini, c):
    f = I.files[c]
    prods, flags = MODELS[ini["model"]["kind"]](I, ini, c, f)
    if not prods:
        return None
    tax = f["meta"]["assume"]["tax"]
    keep = 1 - tax / 100
    tot = {k: {} for k in ("d", "net", "aum", "rev")}
    for x in prods:
        p = next(q for q in f["products"] if q["s"] == x["s"])
        x["d"] = {}
        for b in BANDS:
            dA, dRev, dVar, dOp = prod_delta(p, x["shock"][b]["flow"], x["shock"][b]["fee"])
            x["d"][b] = {"dA": r(dA), "dRev": r(dRev), "dVar": r(dVar), "dOp": r(dOp)}
    for b in BANDS:
        dOp = fsum(prod_delta(next(q for q in f["products"] if q["s"] == x["s"]), x["shock"][b]["flow"], x["shock"][b]["fee"])[3] for x in prods)
        tot["d"][b] = r(dOp)
        tot["net"][b] = r(dOp * keep)
        tot["aum"][b] = r(fsum(x["d"][b]["dA"] for x in prods))
        tot["rev"][b] = r(fsum(x["d"][b]["dRev"] for x in prods))
    np_ = f["nodes"].get("net_profit")
    return {"c": c, **tot,
            "pct_np": {b: r(tot["net"][b] / np_["v"] * 100, 4) for b in BANDS} if np_ and np_.get("v") else None,
            "products": prods, "flags": flags}


def build():
    I = Inputs()
    W = I.reg["weights"]
    mgrs, excl = managers(I)
    inis = []
    for ini in I.reg["initiatives"]:
        e = {k: ini[k] for k in ("id", "title", "short", "regulator", "type", "status", "dates", "next", "facts", "sources", "model")}
        e["w"] = W[ini["status"]]
        e["next"] = dict(ini["next"], k="expected") if ini["next"] else None
        e["model"] = dict(ini["model"], params=[dict(q, p={b: param_prov(ini, q, b) for b in BANDS}) if all(b in q for b in BANDS) else q for q in ini["model"]["params"]])
        imps = [] if ini["model"]["kind"] == "none" else [x for x in (impact(I, ini, c) for c in mgrs) if x]
        imps.sort(key=lambda x: (x["d"]["central"], x["c"]))
        e["impacts"] = imps
        e["total"] = {b: r(fsum(x["d"][b] for x in imps)) for b in BANDS} if imps else None
        inis.append(e)
    # exposure to the whole pipeline: Σ weight × impact, per band, every term visible
    exp = []
    for c in mgrs:
        f = I.files[c]
        by = []
        for e in inis:
            x = next((y for y in e["impacts"] if y["c"] == c), None)
            if x is not None:
                by.append({"id": e["id"], "w": e["w"], "d": x["d"], "net": x["net"]})
        if not by:
            continue
        d = {b: r(fsum(t["w"] * t["d"][b] for t in by)) for b in BANDS}
        net = {b: r(fsum(t["w"] * t["net"][b] for t in by)) for b in BANDS}
        np_ = f["nodes"].get("net_profit")
        exp.append({"c": c, "d": d, "net": net, "by": [{"id": t["id"], "w": t["w"]} for t in by],
                    "pct_np": {b: r(net[b] / np_["v"] * 100, 4) for b in BANDS} if np_ and np_.get("v") else None})
    exp.sort(key=lambda x: (x["d"]["central"], x["c"]))
    out = {"meta": {"built": I.graph["meta"]["built"], "retrieved": I.reg["retrieved"], "base": I.base,
                    "units": "מיליוני ש\"ח לשנה, קצב שנתי לאחר כניסה מלאה לתוקף, לפני מס (רווח לפני מס ממוצרי החיסכון) ואחרי מס (לפי שיעור המס של קובץ המנגנונים)",
                    "bands": list(BANDS), "weights": W, "weights_why": I.reg["weights"].get("$comment", ""),
                    "ltm_months": [LTM[0], LTM[1]], "at": AT, "excluded": excl,
                    "method": "drivers.ts propagate() על כל מוצר בנפרד, זעזוע דמי ניהול וצבירה בלבד"},
           "managers": {c: mgr_inputs(I.files[c]) for c in mgrs}, "initiatives": inis, "exposure": exp}
    out["meta"]["weights"] = {k: v for k, v in W.items() if not k.startswith("$")}
    return out, I


# ------------------------------------------------------------------------------------------------------------------------------ verification
def finite(x, path, bad):
    if isinstance(x, float) and not math.isfinite(x):
        bad.append(f"{path}: not finite")
    elif isinstance(x, dict):
        for k, v in x.items():
            finite(v, f"{path}.{k}", bad)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            finite(v, f"{path}[{i}]", bad)


def verify(out, I):
    bad = []
    finite(out, "impact", bad)
    iso = re.compile(r"^\d{4}(-\d\d(-\d\d)?)?$")
    ids = set()
    for e in out["initiatives"]:
        w = e["id"]
        if w in ids:
            bad.append(f"{w}: duplicate id")
        ids.add(w)
        if e["status"] not in STATUSES:
            bad.append(f"{w}: status {e['status']}")
        if e["type"] not in TYPES:
            bad.append(f"{w}: type {e['type']}")
        if e["model"]["kind"] not in KINDS:
            bad.append(f"{w}: model kind {e['model']['kind']}")
        if not e["sources"]:
            bad.append(f"{w}: no source")
        for s in e["sources"]:
            if not ALLOWED.match(s.get("url") or ""):
                bad.append(f"{w}: source URL not a public regulator document: {s.get('url')}")
            if not iso.match(s.get("retrieved") or "") or len(s.get("retrieved") or "") != 10:
                bad.append(f"{w}: source without a retrieval date")
        for d in e["dates"] + ([e["next"]] if e["next"] else []):
            if not iso.match(d["d"]):
                bad.append(f"{w}: date {d['d']}")
            if not 0 <= d.get("src", -1) < len(e["sources"]):
                bad.append(f"{w}: date {d['d']} without a source")
        for fct in e["facts"]:
            if not 0 <= fct.get("src", -1) < len(e["sources"]):
                bad.append(f"{w}: fact without a source")
        for prm in e["model"]["params"]:
            if prm["src"] not in ("source", "assumption", "regulator"):
                bad.append(f"{w}: param {prm['k']} src {prm['src']}")
            if prm["src"] == "assumption" and not prm.get("why"):
                bad.append(f"{w}: assumption {prm['k']} without a reason")
            if all(b in prm for b in BANDS) and not (prm["low"] <= prm["central"] <= prm["high"]):
                bad.append(f"{w}: param {prm['k']} bands not ordered")
        if e["model"]["kind"] == "none":
            if e["impacts"] or not e["model"].get("why"):
                bad.append(f"{w}: not modelled needs a reason and no impacts")
            continue
        if not e["impacts"]:
            bad.append(f"{w}: modelled but no impact")
        for x in e["impacts"]:
            M = out["managers"][x["c"]]
            params = {q["k"]: q for q in e["model"]["params"]}
            for pr in x["products"]:
                mp = M["products"].get(pr["s"])
                if not mp or not mp["A"].get("p") or not mp["fy"].get("p"):
                    bad.append(f"{w} {x['c']} {pr['s']}: assets or fee yield without provenance")
                for bs in pr["basis"]:
                    ok = bs.get("p") or (bs.get("pb") and all(bs["pb"].get(b) for b in BANDS)) or (bs.get("param") in params and all(params[bs["param"]]["p"].get(b) for b in BANDS))
                    if not ok:
                        bad.append(f"{w} {x['c']} {pr['s']}: basis {bs['label']} without provenance")
                f = I.files[x["c"]]
                p = next(q for q in f["products"] if q["s"] == pr["s"])
                for b in BANDS:
                    dA, dRev, dVar, dOp = prod_delta(p, pr["shock"][b]["flow"], pr["shock"][b]["fee"])
                    if abs(dOp - pr["d"][b]["dOp"]) > 1e-3:
                        bad.append(f"{w} {x['c']} {pr['s']} {b}: dOp {pr['d'][b]['dOp']} vs {dOp}")
            for b in BANDS:
                if abs(fsum(pr["d"][b]["dOp"] for pr in x["products"]) - x["d"][b]) > 1e-3:
                    bad.append(f"{w} {x['c']} {b}: products do not add up")
        if e["model"]["kind"] == "default":
            for b in BANDS:
                s = fsum(pr["net_flow"][b] for x in e["impacts"] for pr in x["products"])
                if abs(s) > 0.05:
                    bad.append(f"{w} {b}: redistribution does not sum to zero ({s:.3f})")
            # the extra assets of a selected fund earn exactly the rule's price
            price = next(q for q in e["model"]["params"] if q["k"] == "fee_assets")["central"]
            for x in e["impacts"]:
                for pr in x["products"]:
                    if any(q["label"] == "דמי ניהול על הנכסים הנוספים" for q in pr["basis"]):
                        dA = pr["d"]["central"]["dA"]
                        if abs(pr["d"]["central"]["dRev"] - dA * price / 100) > 1e-3:
                            bad.append(f"{w} {x['c']}: extra assets not priced at {price}%")
    imp = {(e["id"], x["c"]): x for e in out["initiatives"] for x in e["impacts"]}
    for x in out["exposure"]:
        for b in BANDS:
            if abs(fsum(t["w"] * imp[(t["id"], x["c"])]["d"][b] for t in x["by"]) - x["d"][b]) > 1e-3:
                bad.append(f"exposure {x['c']} {b}: not Σ weight × impact")
    if not out["exposure"]:
        bad.append("no exposure rows")
    return bad


def dumps(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    out, I = build()
    bad = verify(out, I)
    n_ini = len(out["initiatives"])
    n_mod = sum(1 for e in out["initiatives"] if e["impacts"])
    n_imp = sum(len(e["impacts"]) for e in out["initiatives"])
    if "--check" in sys.argv:
        same = OUT.exists() and json.loads(OUT.read_text(encoding="utf8")) == json.loads(dumps(out))
        print(f"regulation: {n_ini} initiatives ({n_mod} modelled), {n_imp} manager impacts, {len(out['exposure'])} exposure rows; "
              f"{'rebuild matches' if same else 'DIFFERS from ' + str(OUT.relative_to(ROOT))}; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("misses:")
        for b in bad[:40]:
            print("  ", b)
        sys.exit(1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dumps(out), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; {n_ini} initiatives ({n_mod} modelled), {n_imp} manager impacts")
