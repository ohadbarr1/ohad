"""Shared helpers of the group / insurance / capital families of the Question Index (capital, targets, comp, regx, val: Q-100..Q-199).

Not a question module (the leading underscore keeps build_answers from registering it). Everything here reads the published files
only and reuses the provenance nodes they already carry; where a file stores a pointer (`{"k": "ref"}`, capital/options.json and the
consolidation files keep a subtree once and point at it) the pointer is inlined, so an answer's figure is self-contained on the page.
"""
import copy
import re
from math import fsum

from answer_core import BASES, P_calc, P_rep, exhibit, fig, fmt, he, load, nf
from answer_core import answer as _answer

INS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]      # the insurance groups with a solvency calculation
MAIN = ["phoenix", "harel", "migdal", "clal", "menora"]                            # the five large groups
FUNDS = ["meitav", "altshuler", "more", "analyst", "yelin", "ibi"]
MAYA = "https://mayafiles.tase.co.il/"
MM = 'מיליוני ש"ח'
PRICE_LABEL = "מחיר 22.10.26, קלט ידני"


def fsum0(xs):
    return fsum([x for x in xs if x is not None])


def r3(x):
    return None if x is None else round(x, 3)


def ql(k):
    """"2026Q2" -> "Q2'26", "2025FY" -> "FY'25" """
    return f"{k[4:]}'{k[2:4]}"


def dl(d):
    """"2025-12-31" -> "31.12.25" """
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def num(s):
    """a printed value text ("12,066.0", "−2.8") as a float"""
    return float(str(s).replace(",", "").replace("−", "-").split()[0])


# ------------------------------------------------------------------------------------------------ pointers
def _cap_resolve(c, path):
    """build_capital.resolve (the rule of web/src/lib/capital.ts resolveRef)"""
    a = path.split(".")
    try:
        if a[0] == "distributable":
            return c["distributable"]["prov"]
        if a[0] == "buffer":
            return c["buffer"]["v_prov"] if a[1:] == ["v"] else c["buffer"]["prov"]
        if a[0] == "pnl":
            return c["pnl"][a[1]]["prov"]
        if a[0] == "bases":
            return c["bases"][a[1]][a[2]]["prov"]
        if a[0] == "bolt":
            row = next(o for o in c["options"] if o["id"] == "bolt")
            return row["src"][path[5:]]
        if a[0] == "con":
            k = next(x for x in c["constraints"] if x["id"] == a[1])
            return k["t_prov"] if a[2] == "t" else k["headroom"]["prov"]
    except (KeyError, IndexError, StopIteration):
        return None
    return None


def _inline(p, res, depth=0):
    if not isinstance(p, dict) or depth > 60:
        return p
    if p.get("k") == "ref":
        q = res(p["r"])
        if q is None:
            return {"k": "none", "title": p["r"], "why": "המקור לא נמצא בקובץ"}
        return _inline(q, res, depth + 1)
    if p.get("k") == "calc":
        return {**p, "inputs": [{**x, "p": _inline(x["p"], res, depth + 1)} if x.get("p") else x for x in p.get("inputs", [])]}
    return p


def cap_prov(c, p):
    """a capital/options.json node with its pointers inlined"""
    def res(r):
        if r.startswith("bolt."):
            q = _cap_resolve(c, r)
            return q
        return _cap_resolve(c, r)
    return copy.deepcopy(_inline(p, res))


def _cons_res(r, doc=None):
    """build_consolidation.res: c/<id>:<path> (matrix cos), m/<id>:<path> (mix files), a:<key> (assumptions), k:<key> (meta), p:<path>"""
    M = load("consolidation/matrix.json")
    scope, _, path = r.partition(":")
    if scope.startswith("c/"):
        node = M["cos"].get(scope[2:])
    elif scope.startswith("m/"):
        node = load(f"consolidation/mix/{scope[2:]}.json")
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


def cons_prov(p, doc=None):
    return copy.deepcopy(_inline(p, lambda r: _cons_res(r, doc)))


def shallow(p, where, keep=1, depth=0):
    """a provenance node cut below `keep` levels of inputs (for an input of a count or a sum over many published figures, whose full
    chain is on the page named by `where`): the node keeps its title, value and formula, and says where the rest of the chain is"""
    if not isinstance(p, dict) or p.get("k") != "calc":
        return p
    if depth >= keep:
        return {**{k: v for k, v in p.items() if k != "inputs"}, "inputs": [], "note": f"השרשרת המלאה: {where}"}
    return {**p, "inputs": [{**x, "p": shallow(x["p"], where, keep, depth + 1)} if x.get("p") else x for x in p.get("inputs", [])]}


def answer(figs, corr, email, ex, chg, vk, **kw):
    """answer_core.answer, and when the figures mix bases (actual / target / forward / estimate) the email rung says so in words"""
    a = _answer(figs, corr, email, ex, chg, vk, **kw)
    if a.get("mix"):
        a["email"] = a["email"].rstrip() + f" המספרים כאן משלבים {' ו'.join(BASES[b] for b in a['mix'])}: כל מספר מסומן בבסיס שלו, ואין לחבר ביניהם."
    return a


# ------------------------------------------------------------------------------------------------ files
def capco(c):
    """the A7 capital row of an insurer (status ok), or None"""
    for x in load("capital/options.json")["companies"]:
        if x["id"] == c:
            return x if x.get("status") == "ok" else None
    return None


def binding(c):
    x = capco(c)
    return next(k for k in x["constraints"] if k["id"] == x["binding"])


def frag(c, sig):
    """the fragility monitor's signal `sig` (segment all) of a company: dict with st, x, v, t, asof, prov, provR, provT; or None"""
    for r in load("fragility.json")["rows"]:
        if r["c"] == c:
            s = r["sig"].get(sig) or {}
            seg = (s.get("segs") or {}).get("all")
            if not seg:
                return None
            return {**seg, "st": s.get("st"), "why": s.get("why")}
    return None


def xp(c):
    """the A3 expectations file of a company (status ok), or None"""
    try:
        d = load(f"expectations/{c}.json")
    except FileNotFoundError:
        return None
    return d if d.get("status") == "ok" else None


def xp_index():
    return load("expectations/index.json")["companies"]


def capser(c, m, k):
    """csm/capital.json: a printed figure (company, metric, period key like 2026Q2) -> {v, pg, u, std} or None"""
    return ((load("csm/capital.json")["companies"].get(c) or {}).get(m) or {}).get(k)


# ------------------------------------------------------------------------------------------------ figures
def F(label, v, u, prov, asof, c=None, b="actual", d=None, signed=False, t=None):
    if u == "n" and d is None:
        d = 0
    return fig(label, v, u, copy.deepcopy(prov), asof, b=b, d=d, signed=signed, t=t, c=c)


def cap_fig(c, label, node, u, asof, b="actual", d=None, signed=False):
    """a capital/options.json {v, prov} as a figure"""
    x = capco(c)
    return F(label, node["v"], u, cap_prov(x, node["prov"]), asof, c=c, b=b, d=d, signed=signed)


def rep_cap(c, m, k, title, unit=MM, mult=1.0, absv=False):
    """a csm/capital.json printed figure as a report node + its value"""
    p = capser(c, m, k)
    if not p:
        return None, None
    v = p["v"] * mult
    if absv:
        v = abs(v)
    return v, P_rep(f"{title} · {he(c)} · {ql(k)}", nf(v, 1), unit, p["u"], p["pg"], f"דוח כספי · {p.get('std', '')}".strip(" ·"), ql(k))


def calc(title, v, unit_txt, formula, inputs, est=False, note=None, d=1, u="m"):
    """a computed node; inputs: [(label, figure-or-(value, prov))]; value text in the figure grammar"""
    ins = []
    for lab, x in inputs:
        if isinstance(x, dict) and "prov" in x:
            ins.append((lab, x["t"], copy.deepcopy(x["prov"])))
        else:
            vv, pp = x
            ins.append((lab, vv if isinstance(vv, str) else nf(vv, 1), copy.deepcopy(pp)))
    return P_calc(title, fmt(v, u, d), unit_txt, formula, ins, est=est, note=note)


# ------------------------------------------------------------------------------------------------ exhibits
def bars(title, unit, items, foot, name=None, kind="hbar", span=None, d=3):
    """a one-series bar chart over companies: items [(company id, value)]"""
    items = [(c, v) for c, v in items if v is not None]
    return exhibit(kind, title, unit, [he(c) for c, _ in items],
                   [{"name": name or title, "type": "bar", "data": [round(v, d) for _, v in items]}], foot, span=span)


def bars2(title, unit, cats, series, foot, kind="cat", span=None, d=3):
    """several series over companies: series [(name, [values])]"""
    return exhibit(kind, title, unit, [he(c) for c in cats],
                   [{"name": n, "type": "bar", "data": [None if v is None else round(v, d) for v in vs]} for n, vs in series], foot, span=span)


def table(title, head, rows, foot, unit=""):
    return exhibit("table", title, unit, [], [], foot, rows=[head] + rows)


def names_list(cs):
    """"הראל, מגדל וכלל" """
    n = [he(c) for c in cs]
    if not n:
        return ""
    if len(n) == 1:
        return n[0]
    return ", ".join(n[:-1]) + " ו" + n[-1]


def ws(text):
    return re.sub(r"\s+", " ", text).strip()
