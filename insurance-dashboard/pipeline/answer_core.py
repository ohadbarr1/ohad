"""The shared core of the Super-Advisor layer: the answer object of the Question Index (S1), the finding of the Finding Engine (S2) and the
three rungs of the Answer Ladder (S6) are built here, so every one of them obeys the same rules.

An answer is pre-computed at build time from the published files (web/public/data) only. It is deterministic and auditable: every number
in it is a *figure* with its provenance (the ProvJ shape of web/src/lib/fragility.ts: report / xbrl / reg / fund / calc / lts / none),
and the sentences reference figures by token, `{fig_id}`. The site renders a token as a sourced number (Sourced), the email rung appends
the source line of every figure it quotes, the exhibit rung carries a chart whose sources are the same figures.

Rules the gate enforces (`problems`), so that an unsourced figure cannot ship:
  - a sentence holds no digit outside its tokens, except period labels (Q2'26, FY'25, H1'26, 08/26, 27.08.26, 2026), counts of periods
    or entities ("4 רבעונים", "3 חודשים", "8 מנהלים") and question ids (Q-047, F-012)
  - every token resolves to a figure; every figure carries a provenance node and an as-of label
  - corridor = one sentence, at most one figure; email = two figures or more; exhibit = a chart or table whose every series is plotted from
    published numbers, with a footnote line
  - target, forward, estimate and actual are labelled per figure (`b`); an answer that mixes bases carries `mix` naming them
  - the public file never speaks for a company in the first person (אנחנו / שלנו / אצלנו ...): the employer-side framing lives only in
    the browser (owner decision 28.10.26)
  - no composite score anywhere (the same banned-key rule as the fragility monitor)

Standard library only.
"""
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
MINUS = "−"

CHAIRS = {
    "ceo": "מנכ״ל",
    "cfo": "סמנכ״ל כספים",
    "board": "דירקטוריון",
    "reg": "רגולטור",
    "dist": "הפצה וסוכנים",
    "inv": "משקיעים ואנליסטים",
    "strat": "אסטרטגיה",
}
TOPICS = {
    "flows": "ניודים ונתח שוק",
    "fees": "כלכלת דמי ניהול",
    "cost": "מבנה עלויות",
    "mix": "תמהיל מוצרים",
    "comp": "מהלכי מתחרים",
    "regx": "חשיפה רגולטורית",
    "capital": "הון וכושר פירעון",
    "targets": "יעדים ועמידה בהם",
    "channel": "ערוצי הפצה",
    "perf": "תשואות וביצועים",
    "val": "שווי ותמחור",
}
UNITS = {"pct", "pp", "bp", "m", "bn", "x", "r", "n", "yrs"}
BASES = {"actual": "בפועל", "target": "יעד", "forward": "צפי", "estimate": "אומדן"}
BASIS_HE = BASES
FIRST_PERSON = re.compile(r"(?<![֐-׿])(אנחנו|אנו|שלנו|אצלנו|לנו|עלינו|ממנו|שלי|אצלי)(?![֐-׿])")
BANNED_KEYS = re.compile(r"^(score|scores|rating|ratings|composite|grade|overall|fox_rating|points)$", re.I)
TOKEN = re.compile(r"\{([a-z][a-z0-9_]*)\}")
# digits a sentence may carry outside tokens: periods, dates, counts of periods / entities, ids
ALLOWED = re.compile(
    r"(Q[1-4]'\d\d|H[12]'\d\d|FY'\d\d|9M'\d\d|\b\d\d/\d\d\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b(19|20)\d\d\b|\b[QF]-\d{3}\b|\b\d{1,2}M\b|\b\d{1,2}Y\b|"
    r"\b\d{1,2} (רבעונים|רבעונים רצופים|חודשים|שנים|מנהלים|חברות|קבוצות|מתחרים|עמיתים|מסלולים|רבעון|חודש|שנה|מוצרים|קטגוריות)\b|"
    r"\b(ב|ל|מ|ה)-\d{1,2} (רבעונים|חודשים|שנים|המנהלים|החברות)\b)"
)


# ------------------------------------------------------------------------------------------------ data
_cache = {}


def load(p):
    """a published file, parsed once per process"""
    if p not in _cache:
        _cache[p] = json.loads((DATA / p).read_text(encoding="utf-8"))
    return _cache[p]


def exists(p):
    return (DATA / p).exists()


def names():
    """company id -> Hebrew name (companies/index.json, plus the lens groups for the fund houses it does not list)"""
    if "_names" not in _cache:
        n = {c["id"]: c["name_he"] for c in load("companies/index.json")}
        for g in load("lens.json")["groups"]:
            if g.get("id") and g["id"] not in n:
                n[g["id"]] = g["name"]
        _cache["_names"] = n
    return _cache["_names"]


def he(c):
    return names().get(c, c)


# ------------------------------------------------------------------------------------------------ formatting
def nf(v, d=1):
    if v is None:
        return "–"
    t = f"{v:,.{d}f}"
    if re.fullmatch(r"-[0.,]+", t):
        return t[1:]
    return t.replace("-", MINUS)


def sn(v, d=1):
    return ("+" if v is not None and round(v, d) > 0 else "") + nf(v, d)


def fmt(v, u, d=None, signed=False):
    """a figure's display text in the site's grammar"""
    if v is None:
        return "–"
    f = sn if signed else nf
    if u == "pct":
        return f"{f(v, 1 if d is None else d)}%"
    if u == "pp":
        return f"{sn(v, 1 if d is None else d)} נק׳"
    if u == "bp":
        return f"{sn(v, 0 if d is None else d)} נ״ב"
    if u in ("m", "bn"):  # the sign goes before the currency: −₪13.7 מיליון, +₪1,686 מיליון
        dd = ((1 if abs(v) < 100 else 0) if u == "m" else 1) if d is None else d
        body = nf(abs(v), dd)
        sign = "" if body.strip("0.,") == "" else MINUS if v < 0 else "+" if signed and v > 0 else ""
        return f"{sign}₪{body} {'מיליון' if u == 'm' else 'מיליארד'}"
    if u == "x":
        return f"{f(v, 2 if d is None else d)}×"
    if u == "yrs":
        return f"{f(v, 1 if d is None else d)} שנים"
    return f(v, 1 if d is None else d)  # r, n


def lq(k):
    """"Q2-2026" -> "Q2'26" """
    return f"{k[:2]}'{k[-2:]}"


def ym(p):
    """202608 -> "08/26" """
    return f"{p % 100:02d}/{str(p // 100)[2:]}"


def dlab(d):
    """"2025-12-31" -> "31.12.25" """
    return f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def r6(x):
    return None if x is None else round(x, 6)


# ------------------------------------------------------------------------------------------------ provenance (ProvJ)
def P_rep(title, value, unit, url, pg, doc, period, note=None):
    p = {"k": "report", "title": title, "value": value, "unit": unit, "url": url, "pg": pg, "doc": doc, "period": period}
    if note:
        p["note"] = note
    return p


def P_calc(title, value, unit, formula, inputs, est=False, note=None):
    """inputs: (label, value text, ProvJ or None)"""
    p = {"k": "calc", "title": title, "value": value, "unit": unit, "formula": formula,
         "inputs": [dict({"label": a, "v": b}, **({"p": c} if c else {})) for a, b, c in inputs]}
    if est:
        p["est"] = True
    if note:
        p["note"] = note
    return p


def P_lts(c, metric, period, title, unit, value):
    """a managing company's printed segment component (the Savings Lens), resolved on the page by lens.ts ltsProv"""
    return {"k": "lts", "c": c, "metric": metric, "period": period, "title": title, "unit": unit, "value": value}


def P_fund(title, value, unit, ds, id_, period, col, note=None):
    p = {"k": "fund", "title": title, "value": value, "unit": unit, "ds": ds, "id": id_, "period": period, "col": col}
    if note:
        p["note"] = note
    return p


def P_reg(metric, pi, w, set_, g):
    """an aggregate of the regulator's fund files (rebuilt from its tracks when the sheet opens): market.json period index `pi`,
    window m / q / ltm, set id, group index (-1 = the market)"""
    return {"k": "reg", "metric": metric, "pi": pi, "w": w, "set": set_, "g": g}


def P_none(title, why):
    return {"k": "none", "title": title, "why": why}


PROV_KINDS = {"report", "xbrl", "reg", "fund", "calc", "lts", "price", "none"}


# ------------------------------------------------------------------------------------------------ figures and answers
def fig(label, v, u, prov, asof, b="actual", d=None, signed=False, t=None, c=None):
    """one sourced number. `t` overrides the display text (rare: a count, a range); `c` = the company it belongs to"""
    if u not in UNITS:
        raise ValueError(f"unit {u}")
    if b not in BASES:
        raise ValueError(f"basis {b}")
    if v is not None and isinstance(v, float) and not math.isfinite(v):
        raise ValueError(f"{label}: non-finite")
    f = {"l": label, "v": r6(v), "u": u, "t": t if t is not None else fmt(v, u, d, signed), "b": b, "asof": asof, "prov": prov}
    if c:
        f["c"] = c
    return f


def render(text, figs, thr=None):
    """the sentence as plain text (tokens replaced by their display text; {thr} = a falsifier's threshold)"""
    if thr is not None:
        figs = {**figs, "thr": {"t": thr}}
    return TOKEN.sub(lambda m: figs[m.group(1)]["t"] if m.group(1) in figs else m.group(0), text)


def exhibit(kind, title, unit, cats, series, foot, span=None, credit=None, rows=None):
    """a chart (kind cat / hbar / line) or a table (kind table, `rows` = [[cell, ...]] with the first row the header), ChartSpec-shaped
    so the page can add it to the chart book or a deck. series: [{"name", "type": bar|line, "data": [...], "id"?: company id}]"""
    e = {"kind": kind, "title": title, "unit": unit, "cats": cats, "series": series, "foot": foot}
    if span:
        e["span"] = span
    if credit:
        e["credit"] = credit
    if rows is not None:
        e["rows"] = rows
    return e


def changes_if(text, fig_id, op, v):
    """the falsifier: the answer changes when figure `fig_id` crosses `v` (op one of < <= > >=); `st` is evaluated at build.
    The text names the threshold by the token {thr} (rendered in the figure's unit), never as a bare number"""
    return {"text": text, "fig": fig_id, "op": op, "v": v}


OPS = {"<": lambda a, b: a < b, "<=": lambda a, b: a <= b, ">": lambda a, b: a > b, ">=": lambda a, b: a >= b}


def answer(figs, corr, email, ex, chg, vk, links=(), rel=(), asof=None, note=None):
    """the body of an answered question. figs: {id: fig}; corr / email: sentences with tokens; ex: exhibit or None;
    chg: changes_if(...) or None; vk: the verdict key (a short string that names which branch the verdict took, e.g. "yes", "no:pen",
    "rank:3") - Watch & Wake (S10) compares it build to build"""
    a = {"st": "ok", "figs": figs, "corr": corr, "email": email, "ex": ex, "chg": chg, "vk": vk, "links": list(links), "rel": list(rel)}
    if asof:
        a["asof"] = asof
    if note:
        a["note"] = note
    if chg:
        f = figs.get(chg["fig"], {})
        x = f.get("v")
        chg["st"] = "tripped" if x is not None and OPS[chg["op"]](x, chg["v"]) else "holds"
        chg["thr"] = fmt(chg["v"], f.get("u", "n"))
    bases = sorted({f["b"] for f in figs.values()})
    if len(bases) > 1:
        a["mix"] = bases
    return a


def nodata(why):
    """the question cannot be answered from the published files right now (stale, missing, not disclosed): said, never guessed"""
    return {"st": "nodata", "why": why}


def link(label, to):
    return {"l": label, "to": to}


# ------------------------------------------------------------------------------------------------ the registry (S1)
QUESTIONS = []


def question(id_, q, chairs, topic, cos=()):
    """register a standing question: fn(ctx) -> answer(...) or nodata(...). id "Q-###" is permanent once published"""
    def deco(fn):
        QUESTIONS.append({"id": id_, "q": q, "chairs": list(chairs), "topic": topic, "cos": list(cos), "fn": fn})
        return fn
    return deco


def vkey(a):
    """a stable digest of what the answer says (verdict key + corridor text), for build-to-build change detection"""
    s = json.dumps([a.get("vk"), a.get("corr") and render(a["corr"], a["figs"])], ensure_ascii=False)
    return hashlib.sha1(s.encode()).hexdigest()[:10]


# ------------------------------------------------------------------------------------------------ the rules
def text_problems(where, text, figs, min_tok=0, max_tok=None):
    out = []
    if not isinstance(text, str) or not text.strip():
        return [f"{where}: empty"]
    toks = TOKEN.findall(text)
    for t in toks:
        if t not in figs:
            out.append(f"{where}: token {{{t}}} has no figure")
    if len(set(toks)) < min_tok:
        out.append(f"{where}: {len(set(toks))} figures, needs {min_tok}+")
    if max_tok is not None and len(set(toks)) > max_tok:
        out.append(f"{where}: {len(set(toks))} figures, at most {max_tok}")
    bare = ALLOWED.sub("", TOKEN.sub("", text))
    if re.search(r"\d", bare):
        out.append(f"{where}: a number outside a token ({re.search(r'.{0,12}[0-9].{0,12}', bare).group(0)!r})")
    if FIRST_PERSON.search(text):
        out.append(f"{where}: first-person framing ({FIRST_PERSON.search(text).group(0)})")
    return out


def fig_problems(where, f):
    out = []
    for k in ("l", "u", "t", "b", "asof", "prov"):
        if f.get(k) in (None, ""):
            out.append(f"{where}: no {k}")
    p = f.get("prov")
    if isinstance(p, dict) and p.get("k") not in PROV_KINDS:
        out.append(f"{where}: provenance kind {p.get('k')}")
    if isinstance(p, dict) and p.get("k") == "none" and f.get("v") is not None:
        out.append(f"{where}: a number with provenance 'none'")
    return out


def exhibit_problems(where, e):
    out = []
    if e is None:
        return out
    if e.get("kind") not in ("cat", "hbar", "line", "table"):
        out.append(f"{where}: kind {e.get('kind')}")
    if not e.get("title"):
        out.append(f"{where}: no title")
    if not e.get("foot"):
        out.append(f"{where}: no footnote")
    if e.get("kind") == "table":
        if not e.get("rows") or len(e["rows"]) < 2:
            out.append(f"{where}: a table with no rows")
    else:
        n = len(e.get("cats") or [])
        if not n or not e.get("series"):
            out.append(f"{where}: no data")
        for s in e.get("series") or []:
            if len(s.get("data") or []) != n:
                out.append(f"{where}: series {s.get('name')} has {len(s.get('data') or [])} points for {n} categories")
            if all(x is None for x in s.get("data") or [None]):
                out.append(f"{where}: series {s.get('name')} is empty")
    return out


def banned(o, path=""):
    out = []
    if isinstance(o, dict):
        for k, v in o.items():
            if BANNED_KEYS.match(k):
                out.append(f"{path}/{k}: composite key")
            out += banned(v, f"{path}/{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            out += banned(v, f"{path}/{i}")
    return out


def body_problems(where, a):
    """the rules for an answered body (S1 answer or S2 finding)"""
    if a.get("st") == "nodata":
        return [] if a.get("why") else [f"{where}: nodata without a reason"]
    out = []
    figs = a.get("figs") or {}
    if not figs:
        out.append(f"{where}: no figures")
    for k, f in figs.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]*", k):
            out.append(f"{where}: figure id {k}")
        out += fig_problems(f"{where}/{k}", f)
    out += text_problems(f"{where}/corr", a.get("corr"), figs, 1, 1)
    if isinstance(a.get("corr"), str) and re.search(r"[.!?]\s+\S", a["corr"].strip()[:-1]):
        out.append(f"{where}/corr: more than one sentence")
    out += text_problems(f"{where}/email", a.get("email"), figs, 2)
    out += exhibit_problems(f"{where}/ex", a.get("ex"))
    c = a.get("chg")
    if c:
        if c.get("fig") not in figs:
            out.append(f"{where}/chg: figure {c.get('fig')} missing")
        if c.get("op") not in OPS:
            out.append(f"{where}/chg: op {c.get('op')}")
        out += text_problems(f"{where}/chg", c.get("text"), {**figs, "thr": {"t": c.get("thr", "")}})
    if not a.get("vk"):
        out.append(f"{where}: no verdict key")
    return out


# ------------------------------------------------------------------------------------------------ the Savings Lens and the regulator
SEG_HE = {"pen": "פנסיה", "gem": "גמל והשתלמות", "pg": "פנסיה וגמל", "hish": "קרנות השתלמות", "ins": "ביטוחי מנהלים ופוליסות חיסכון", "all": ""}
SEG_SET = {"pen": "fam:pension", "gem": "fam:gemel", "hish": "p:hishtalmut", "ins": "fam:insurance"}  # pg = pen + gem (no single set)


def P_reg_seg(metric, pi, w, s, g, title="", value="", unit=""):
    """a regulator aggregate of a lens segment: one set, or (pg) the sum of the pension and gemel families as a calc node"""
    if s != "pg":
        return P_reg(metric, pi, w, SEG_SET[s], g)
    return P_calc(title or f"{metric} · {SEG_HE['pg']}", value, unit, "פנסיה ועוד גמל והשתלמות",
                  [(SEG_HE["pen"], "", P_reg(metric, pi, w, "fam:pension", g)), (SEG_HE["gem"], "", P_reg(metric, pi, w, "fam:gemel", g))])
MM = 'מיליוני ש"ח'


class Lens:
    """lens.json with the indices the provenance nodes need. Group index g = lens group order; market group index = market.json order"""

    def __init__(self):
        L = load("lens.json")
        M = load("market.json")
        self.L, self.M = L, M
        self.groups = L["groups"]
        self.gix = {g["id"]: i for i, g in enumerate(self.groups) if g.get("id")}
        self.rows = {(r["g"], r["s"], r["q"]): r for r in L["rows"]}
        self.quarters = L["quarters"]
        self.last_q = L["meta"].get("last_rep", L["quarters"][-1])
        self.asof = L["meta"]["asof"]          # regulator's last month, yyyymm
        self.months = L["months"]
        self.P = M["periods"]
        self.MG = M["groups"]

    def g(self, c):
        return self.gix.get(c)

    def mg(self, c):
        g = self.gix.get(c)
        return None if g is None else self.MG.index(self.groups[g]["name"])

    def pi(self, month):
        return self.P.index(month)

    def row(self, c, s, q=None):
        g = self.gix.get(c)
        return None if g is None else self.rows.get((g, s, q or self.last_q))

    def series(self, c, s):
        g = self.gix.get(c)
        return None if g is None else self.L["series"].get(f"{g}|{s}")

    def cos(self, s, q=None, rep=False):
        """companies with a row in segment s at quarter q (rep=True: with reported components)"""
        q = q or self.last_q
        out = []
        for (g, ss, qq), r in self.rows.items():
            if ss == s and qq == q and self.groups[g].get("id") and (not rep or r.get("rep")):
                out.append(self.groups[g]["id"])
        return out

    @staticmethod
    def q_end(k):  # "Q2-2026" -> 202606
        return int(k[-4:]) * 100 + int(k[1]) * 3

    def prov_share(self, c, s, q, what):
        """aum_share / flow_share of a lens row as a calc node over the regulator aggregates (group vs market)"""
        r = self.row(c, s, q)
        mg, pi = self.mg(c), self.pi(self.q_end(q))
        if what == "aum_share":
            return P_calc(f"נתח נכסים · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(r['aum_share'], 1)}%", "%",
                          "נכסי הקבוצה בסוף הרבעון ÷ נכסי השוק × 100 (רשות שוק ההון; lens.json aum_share)",
                          [("נכסי הקבוצה", nf(r["reg"]["aE"], 0), P_reg_seg("assets", pi, "m", s, mg)),
                           ("נכסי השוק", "", P_reg_seg("assets", pi, "m", s, -1))])
        return P_calc(f"נתח צבירה נטו · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(r['flow_share'], 1)}%", "%",
                      "(צבירה אורגנית + העברות נטו) של הקבוצה ברבעון ÷ אותו סכום לכל השוק × 100 (lens.json flow_share)",
                      [("צבירה אורגנית ברבעון", nf(r["reg"]["org"], 1), P_reg_seg("organic", pi, "q", s, mg)),
                       ("העברות נטו ברבעון", nf(r["reg"]["tr"], 1), P_reg_seg("transfers", pi, "q", s, mg)),
                       ("צבירה נטו כולל ניוד, כל השוק", "", P_reg_seg("netflow", pi, "q", s, -1))])

    def prov_lts(self, c, s, metric, q):
        r = self.row(c, s, q)
        v = r["rep"][metric]
        title = f"{LTS_HE.get(metric, metric)} · {he(c)} · {SEG_HE[s]} · {lq(q)}"
        if s == "pg":  # the lts files carry pension and provident separately: pg = their sum
            return P_calc(title, nf(v, 1), MM, "מגזר הפנסיה ועוד מגזר הגמל, מהדוח",
                          [(SEG_HE[x], "", P_lts(r["rep"]["c"], f"{x}.{metric}", q, title.replace(SEG_HE["pg"], SEG_HE[x]), MM, ""))
                           for x in ("pen", "gem")])
        return P_lts(r["rep"]["c"], f"{'ic' if s == 'ins' else s}.{metric}", q, title, MM, nf(v, 1))

    def prov_ci(self, c, s, q):
        r = self.row(c, s, q)
        rep = r["rep"]
        return P_calc(f"יחס הוצאות להכנסות · {he(c)} · {SEG_HE[s]} · {lq(q)}", f"{nf(r['ci'], 1)}%", "%",
                      "(שיווק ומכירה + הנהלה וכלליות) ÷ הכנסות מדמי ניהול × 100, הרבעון (lens.json ci)",
                      [(LTS_HE[m], nf(rep[m], 1), self.prov_lts(c, s, m, q)) for m in ("sm", "ga", "fees")])


LTS_HE = {"fees": "הכנסות מדמי ניהול", "sm": "שיווק ומכירה", "ga": "הנהלה וכלליות", "op": "רווח תפעולי"}
