"""Attribution engine (module A4): an automated "why" for every company and quarter, from the reported facts only.

python3 pipeline/build_attribution.py           build web/public/data/attribution/<company>.json and attribution/peers_<period>.json
python3 pipeline/build_attribution.py --check   rebuild in memory, compare with the files on disk, and re-verify every bridge: the
                                                contributions sum to the total within rounding, from/to recompute from the facts,
                                                every contribution has inputs that open down to a report and page (gate `attribution`)

Inputs (published files only, standard library):
  companies/<id>.json      the statements workbooks: the role rows (build_workbook.py ROLES) with value, page and report of every figure
  lens.json                Savings Lens: reported fee income and managed assets per segment (pension, provident, investment contracts =
                           פוליסות חיסכון, pure IFRS 9) of each group's managing companies (build_lens.py)
  lts_prov/<id>.json       the printed components (report, page) behind each lens figure
  search/docs.json         report titles for the source lines
  companies/index.json     which companies have statements, and their kind

Identity (reported facts only; every component a printed line or the difference of printed lines):
  ROE (annualised)  = m x attributable profit / average equity x 100,  m = 4 (quarter) or 1 (LTM); average = (opening + closing) / 2
  attributable      = (profit before tax x (net / profit before tax)) - non-controlling interests
  profit before tax = sum of components:
     insurers  : insurance service result + investment and finance result, net + management fees - other operating expenses
                 + other (profit before tax minus the four printed lines: other income and expenses, finance costs, associates)
     fund houses: management fees + other revenue - operating expenses (revenue - operating profit) + other (pbt - operating profit);
                 the lines a report does not print fall into the next one (stated on each bridge)
  management fees   = savings segment (lens: pension, provident, investment contracts) + other fees of the group; the savings part is
                      fee yield x managed assets, managed assets = total x product mix. The savings segment is a part of the group's fee
                      line, never presented as group earnings.
Decomposition: pipeline/attribution.py (Shapley over the factor groups, midpoint split of the products; exact, residual carried).
Bridges per company: QoQ, YoY and LTM vs the prior LTM, ending at each of the company's last 8 quarters, for ROE (points) and for
attributable profit (NIS m). A base period whose inputs a later report restated starts from its first print; the restatement is a
driver of its own ("הצגה מחדש"). Peer bridges: every ordered pair of companies of the same kind, ROE, the latest common quarter and
its LTM (attribution/peers_<period>.json). A bridge whose sides straddle IFRS 4 / IFRS 17 or miss an input is listed under `gaps`.
"""
import json
import re
import sys
from math import fsum, isfinite
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import attribution as A  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "attribution"
FILES = "https://mayafiles.tase.co.il/"
N_ENDS = 8
MN = 'מיליוני ש"ח'
BN = 'מיליארדי ש"ח'
LRI, PDI = "⁦", "⁩"   # a number in a Hebrew sentence keeps its sign in front
QEND = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31"}
QOF = {v: k for k, v in QEND.items()}
SEG_LABEL = {"pen": "פנסיה", "gem": "גמל והשתלמות", "ins": "פוליסות חיסכון (חוזי השקעה)"}

LABEL = {
    "isr": "רווח משירותי ביטוח",
    "inv": "רווח מהשקעות ומימון, נטו",
    "fees": "הכנסות מדמי ניהול",
    "fees.yield": "שיעור דמי ניהול, חיסכון ארוך טווח",
    "fees.volume": "היקף נכסים, חיסכון ארוך טווח",
    "fees.mix": "תמהיל מוצרים, חיסכון ארוך טווח",
    "fees.other": "דמי ניהול אחרים של הקבוצה",
    "rev_other": "הכנסות אחרות",
    "cost": "הוצאות תפעוליות",
    "op": "רווח תפעולי",
    "other": "הכנסות והוצאות אחרות",
    "pbt": "רווח לפני מס",
    "tax": "מס",
    "minority": "זכויות שאינן מקנות שליטה",
    "equity": "בסיס ההון (הון ממוצע)",
    "restate": "הצגה מחדש של תקופת הבסיס",
}
PEER_LABEL = {"fees.volume": "נכסים מנוהלים ביחס להון, חיסכון ארוך טווח"}
ORDER = ["restate", "isr", "inv", "fees", "fees.yield", "fees.volume", "fees.mix", "fees.other", "rev_other", "cost", "op", "other", "pbt",
         "tax", "minority", "equity"]


# ---------------------------------------------------------------------------------------------------------------- periods and text
def qkey(end):
    return end[:4] + QOF[end[5:10]]


def end_of(qk):
    return f"{qk[:4]}-{QEND[qk[4:]]}"


def back(qk, k):
    i = int(qk[:4]) * 4 + int(qk[5]) - 1 - k
    return f"{i // 4}Q{i % 4 + 1}"


def ql(qk):
    return f"{qk[4:]}'{qk[2:4]}"


def wl(qk, win):
    return f"LTM {ql(qk)}" if win == "ltm" else ql(qk)


def bl(end):
    """a balance date as the site writes it at a quarter end: Q2'26 (the IFRS 17 opening balance: 1.1.24)"""
    if end[5:10] not in QOF:
        return f"{int(end[8:10])}.{int(end[5:7])}.{end[2:4]}"
    return ql(qkey(end))


def iso(x):
    return f"{LRI}{x}{PDI}"


def num(v, d=1):
    s = f"{abs(v):,.{d}f}"
    if float(s.replace(",", "")) == 0:
        return s
    return ("−" if v < 0 else "") + s


def sgn(v, d=1):
    s = num(v, d)
    return ("+" + s) if v > 0 and float(s.replace(",", "").replace("−", "")) != 0 else s


def r(v, d):
    x = round(v, d)
    return 0.0 if x == 0 else x


# ---------------------------------------------------------------------------------------------------------------- sources
class Docs:
    def __init__(self):
        d = json.loads((DATA / "search" / "docs.json").read_text(encoding="utf-8"))
        c = d["cols"]
        self.by_rid = {row[c.index("id")]: row for row in d["docs"]}
        self.c = c

    def title(self, url):
        m = re.search(r"P(\d+)-\d+\.pdf", url or "")
        row = self.by_rid.get(int(m.group(1))) if m else None
        return row[self.c.index("title")] if row else "דוח כספי"


class Facts:
    """The table of every figure a company's bridges use: a printed leaf (report url + page) or a calculation over other entries."""

    def __init__(self, prefix=""):
        self.t = {}
        self.prefix = prefix

    def leaf(self, fid, l, p, v, u, url, pg, doc, der=False):
        fid = self.prefix + fid
        if fid not in self.t:
            e = {"l": l, "p": p, "v": r(v, 4), "u": u, "url": url, "pg": pg, "doc": doc}
            if der:
                e["der"] = 1
            self.t[fid] = e
        return fid

    def calc(self, fid, l, p, v, u, f, of):
        fid = self.prefix + fid
        if fid not in self.t:
            self.t[fid] = {"l": l, "p": p, "v": r(v, 6), "u": u, "f": f, "of": list(of)}
        return fid


# ---------------------------------------------------------------------------------------------------------------- one company's books
class Book:
    ROLES = ["ins_res", "inv_fin", "fees", "opex", "op_profit", "total_rev", "pbt", "tax", "np", "np_attr", "equity_attr", "total_equity"]

    def __init__(self, ent, docs, lens, facts):
        self.ent = ent["id"]
        self.name = ent["name_he"]
        self.kind = "ins" if ent["kind"] == "insurance_group" else "fund"
        self.docs = docs
        self.F = facts
        d = json.loads((DATA / "companies" / f"{self.ent}.json").read_text(encoding="utf-8"))
        self.d = d
        self.urls = d.get("urls") or []
        self.src0 = {s["entity"]: s["url"] for s in d["sources"]}
        self.role = {m["role"]: i for i, m in enumerate(d["metrics"]) if m.get("role") in self.ROLES}
        # the role row first, then any other row of the sheet printed under the same caption (a report that split the line into two rows)
        self.alts = {}
        for role, mi in self.role.items():
            m0 = d["metrics"][mi]
            self.alts[role] = [mi] + [i for i, m in enumerate(d["metrics"]) if i != mi and m["sheet"] == m0["sheet"] and not m["header"]
                                      and m["label"] == m0["label"] and m.get("dim", "") == m0.get("dim", "") and m["unit"] == m0["unit"]]
        self.pidx = {(p["type"], p["end"]): i for i, p in enumerate(d["periods"])}
        self.fx = {(f[0], f[1]): f for f in d["facts"]}
        # first prints of restated cells: (label, type, end) -> (value, page, url)
        self.first = {}
        for x in d.get("restated", []):
            if x[0].startswith("X."):
                self.first[(x[0], x[2], x[3], x[4])] = (x[5], x[6], self.urls[x[7]] if x[7] is not None and x[7] < len(self.urls) else None)
        self.lens = lens.get(self.ent, {})
        self.use_attr = "np_attr" in self.role
        self.eq_role = "equity_attr" if "equity_attr" in self.role else "total_equity"
        if self.eq_role == "total_equity" and self.use_attr:
            self.use_attr = False  # no attributable equity printed: ROE on total equity, so profit on the same basis (non-controlling inside)
        self.np_attr_role = "np_attr" if "np_attr" in self.role else "np"

    def url_of(self, f):
        mi = f[0]
        u = f[4] if len(f) > 4 else None
        if u is not None and u < len(self.urls):
            return self.urls[u]
        return self.src0.get(self.d["metrics"][mi]["entity"])

    def raw(self, role, typ, end):
        pi = self.pidx.get((typ, end))
        if pi is None or role not in self.role:
            return None
        for mi in self.alts[role]:
            f = self.fx.get((mi, pi))
            if f is not None:
                return f
        return None

    def label(self, role):
        return self.d["metrics"][self.role[role]]["label"]

    def fact(self, role, typ, end, title=None):
        """(fact id, value NIS m, is IFRS 4) of a role figure, or None. A derived quarter (Q4 = FY - 9M) is a calculation of the two prints."""
        f = self.raw(role, typ, end)
        if f is None:
            return None
        m = self.d["metrics"][f[0]]
        k = 1000.0 if m["unit"] == "k" else 1.0
        v = f[2] / k
        flags = f[5] if len(f) > 5 else 0
        title = title or LABEL_ROLE.get(role, m["label"])
        p = bl(end) if typ == "I" else ql(qkey(end))
        fid = f"{role}@{qkey(end) if typ != 'I' else end}"
        ifrs4 = bool(flags & 2) and self.kind == "ins"   # a fund house reports under IFRS throughout: the flag only marks the first print
        if self.F.prefix + fid in self.F.t:
            return self.F.prefix + fid, v, ifrs4
        if typ == "Q" and flags & 1:
            fy, nm = self.raw(role, "FY", end), self.raw(role, "9M", end)
            y = int(end[:4])
            if fy is not None and nm is not None and abs(fy[2] - nm[2] - f[2]) <= 1.5:
                a = self.F.leaf(f"{role}@FY{y}", f"{title} · {m['label']}", f"FY'{str(y)[2:]}", fy[2] / k, MN, self.url_of(fy), fy[3], self.docs.title(self.url_of(fy)))
                b = self.F.leaf(f"{role}@9M{y}", f"{title} · {m['label']}", f"9M'{str(y)[2:]}", nm[2] / k, MN, self.url_of(nm), nm[3], self.docs.title(self.url_of(nm)))
                return self.F.calc(fid, title, p, v, MN, f"Q4 = FY'{str(y)[2:]} − 9M'{str(y)[2:]}", [a, b]), v, ifrs4
        url = self.url_of(f)
        return self.F.leaf(fid, f"{title} · {m['label']}", p, v, MN, url, f[3] if len(f) > 3 else None, self.docs.title(url), der=bool(flags & 1)), v, ifrs4

    def first_print(self, role, typ, end):
        """the first print of a cell a later report restated: (value NIS m, page, url) or None"""
        mi = self.role.get(role)
        if mi is None:
            return None
        m = self.d["metrics"][mi]
        x = self.first.get((m["sheet"], m["label"], typ, end))
        if not x:
            return None
        return (x[0] / (1000.0 if m["unit"] == "k" else 1.0), x[1], x[2])


LABEL_ROLE = {"ins_res": "רווח משירותי ביטוח", "inv_fin": "רווח מהשקעות ומימון, נטו", "fees": "הכנסות מדמי ניהול", "opex": "הוצאות תפעוליות אחרות",
              "op_profit": "רווח תפעולי", "total_rev": "סך ההכנסות", "pbt": "רווח לפני מס", "tax": "מסים על ההכנסה", "np": "רווח לתקופה",
              "np_attr": "רווח לבעלי המניות", "equity_attr": "הון לבעלי המניות", "total_equity": "סך ההון"}


# ---------------------------------------------------------------------------------------------------------------- the savings lens
def load_lens():
    """{company: {(seg, quarter key): {fees, aO, aE, keys}}} from lens.json (reported figures only)"""
    d = json.loads((DATA / "lens.json").read_text(encoding="utf-8"))
    gs = d["groups"]
    out = {}
    for row in d["rows"]:
        rep = row.get("rep")
        g = gs[row["g"]]["id"]
        if not g or not rep or row["s"] not in ("pen", "gem", "ins") or rep.get("fees") is None or rep.get("aO") is None or rep.get("aE") is None:
            continue
        q, y = row["q"].split("-")
        out.setdefault(g, {})[(row["s"], f"{y}{q}")] = rep
    return out


class LtsProv:
    def __init__(self):
        self.cache = {}

    def get(self, c):
        if c not in self.cache:
            p = DATA / "lts_prov" / f"{c}.json"
            self.cache[c] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
        return self.cache[c]


UNIT_HE = {"NIS thousands": 'אלפי ש"ח', "NIS thousand": 'אלפי ש"ח', "NIS millions": MN, "NIS billions": BN}


def lens_fact(F, prov, c, seg, metric, key, value, unit, title, p):
    """a lens figure as a calculation over its printed components (lts_prov), each a report page"""
    pre = "ic" if seg == "ins" else seg
    fid = f"lens.{seg}.{metric}@{key}"
    if F.prefix + fid in F.t:
        return F.prefix + fid
    pr = prov.get(c)
    ent = (pr or {}).get("facts", {}).get(f"{pre}.{metric}|{key}")
    leaves = []
    if ent:
        for i in ent[1]:
            file, pg, label, val, u, date, win = pr["parts"][i]
            url = pr["urls"].get(file) if file else None
            if not url:
                continue
            doc = f"{'דוח חברת הביטוח' if file.startswith('ic:') else 'דוח החברה המנהלת'}, {file.replace('ic:', '')}"
            leaves.append(F.leaf(f"lts.{c}.{i}", label, f"{date}{' · ' + win if win and win != 'instant' else ''}", val, UNIT_HE.get(u, u), url, pg, doc))
    return F.calc(fid, title, p, value, unit, (ent[0] if ent else "מהדוח") + " (Savings Lens, מגזר החיסכון ארוך הטווח)", leaves)


# ---------------------------------------------------------------------------------------------------------------- one state
def state(bk, prov, qk, win):
    """The model inputs of company bk at quarter qk over window 'q' or 'ltm': (state, None) or (None, reason)."""
    F = bk.F
    qs = [qk] if win == "q" else [back(qk, k) for k in (3, 2, 1, 0)]
    ends = [end_of(q) for q in qs]

    def flow(role):
        got = [bk.fact(role, "Q", e) for e in ends]
        if any(g is None for g in got):
            return None
        if any(g[2] for g in got):
            return "ifrs4"
        if win == "q":
            return got[0][0], got[0][1]
        v = fsum(g[1] for g in got)
        fid = F.calc(f"{role}@LTM{qk}", LABEL_ROLE.get(role, role), f"LTM {ql(qk)}", v, MN, " + ".join(ql(q) for q in qs), [g[0] for g in got])
        return fid, v

    pbt = flow("pbt")
    npv = flow("np")
    if "pbt" not in bk.role and npv and npv != "ifrs4" and flow("tax") not in (None, "ifrs4"):
        t = flow("tax")
        pbt = (F.calc(f"pbt@{'LTM' if win == 'ltm' else ''}{qk}", "רווח לפני מס", wl(qk, win), npv[1] + t[1], MN,
                      "רווח לתקופה + מסים על ההכנסה (הדוח אינו מדפיס שורת רווח לפני מס)", [npv[0], t[0]]), npv[1] + t[1])
    npa = flow(bk.np_attr_role) if bk.use_attr else npv
    for x, nm in ((pbt, "רווח לפני מס"), (npv, "רווח לתקופה"), (npa, "רווח לבעלי המניות")):
        if x is None:
            return None, f"{nm} חסר ב-{wl(qk, win)}"
        if x == "ifrs4":
            return None, "שבר תקן: הצד הזה לפי IFRS 4"
    eo_end = end_of(back(qk, 1 if win == "q" else 4))
    ec_end = end_of(qk)
    eo, ec = bk.fact(bk.eq_role, "I", eo_end), bk.fact(bk.eq_role, "I", ec_end)
    if bk.kind == "ins" and eo_end == "2023-12-31" and (eo is None or eo[2]):
        # the IFRS 17 transition: the opening balance of 1.1.2024 as restated under IFRS 17 stands for the IFRS 4 balance of 31.12.2023
        tr = bk.fact(bk.eq_role, "I", "2024-01-01")
        if tr and not tr[2]:
            eo = tr
    if eo is None or ec is None:
        return None, f"{LABEL_ROLE[bk.eq_role]} חסר ל-{bl(eo_end if eo is None else ec_end)}"
    if bk.kind == "ins" and (eo[2] or ec[2]):
        return None, f"שבר תקן: {LABEL_ROLE[bk.eq_role]} ל-{bl(eo_end if eo[2] else ec_end)} לפי IFRS 4"
    m = 4 if win == "q" else 1
    avg = (eo[1] + ec[1]) / 2
    if avg <= 0:
        return None, "הון ממוצע אינו חיובי"
    s = {"q": m * 100.0 / avg, "pbt": pbt[1], "np": npv[1], "np_attr": npa[1], "m": m, "avg": avg, "id": {"pbt": pbt[0], "np": npv[0], "np_attr": npa[0], "eo": eo[0], "ec": ec[0]},
         "comps": {}, "cid": {}, "splits": {}, "ctx": {}, "notes": []}
    s["id"]["q"] = F.calc(f"q@{'LTM' if win == 'ltm' else ''}{qk}", "מכפיל ההון (שנתי ÷ הון ממוצע)", wl(qk, win), s["q"], "× 100 ÷ מיליוני ש\"ח",
                          f"{m} × 100 ÷ (({bl(eo_end)} + {bl(ec_end)}) ÷ 2) · הון ממוצע {num(avg, 1)} {MN}", [eo[0], ec[0]])
    s["id"]["k"] = F.calc(f"k@{'LTM' if win == 'ltm' else ''}{qk}", "רווח לתקופה ÷ רווח לפני מס (1 פחות שיעור המס)", wl(qk, win),
                          npv[1] / pbt[1] if pbt[1] else 0.0, "יחס", "רווח לתקופה ÷ רווח לפני מס", [npv[0], pbt[0]])
    s["id"]["roe"] = F.calc(f"roe@{'LTM' if win == 'ltm' else ''}{qk}", "ROE, שנתי" if win == "q" else "ROE, LTM", wl(qk, win), m * 100.0 * npa[1] / avg, "%",
                            f"{'4 × ' if m == 4 else ''}{LABEL_ROLE[bk.np_attr_role] if bk.use_attr else 'רווח לתקופה'} ÷ (({bl(eo_end)} + {bl(ec_end)}) ÷ 2) × 100",
                            [npa[0], eo[0], ec[0]])
    s["roe"] = m * 100.0 * npa[1] / avg

    # ---- the pre-tax components: printed lines, and the difference to profit before tax as "other"
    used = []

    def add(key, x, sign=1.0):
        if x is None or x == "ifrs4":
            return False
        s["comps"][key] = sign * x[1]
        s["cid"][key] = [x[0]]
        used.append(x)
        return True

    if bk.kind == "ins":
        isr, inv = flow("ins_res"), flow("inv_fin")
        if isr in (None, "ifrs4") or inv in (None, "ifrs4"):
            return None, "שבר תקן: אין רווח משירותי ביטוח (IFRS 17) בצד הזה"
        add("isr", isr)
        add("inv", inv)
        fees = flow("fees")
        add("fees", fees)
        opex = flow("opex")
        if opex not in (None, "ifrs4"):
            # the sign of the expense line differs between filers (printed in brackets or not): an expense always reduces profit
            s["comps"]["cost"] = -abs(opex[1])
            s["cid"]["cost"] = [opex[0]]
        rest = pbt[1] - fsum(s["comps"].values())
        s["comps"]["other"] = rest
        s["cid"]["other"] = [F.calc(f"other@{'LTM' if win == 'ltm' else ''}{qk}", LABEL["other"], wl(qk, win), rest, MN,
                                    "רווח לפני מס − רווח משירותי ביטוח − רווח מהשקעות ומימון − הכנסות מדמי ניהול + הוצאות תפעוליות אחרות "
                                    "(הכנסות אחרות, הוצאות מימון, חלק ברווחי כלולות)", [pbt[0]] + [x for k in ("isr", "inv", "fees", "cost") for x in s["cid"].get(k, [])])]
        fee_key = "fees" if "fees" in s["comps"] else None
    else:
        fees, rev, op = flow("fees"), flow("total_rev"), flow("op_profit")
        fees = None if fees == "ifrs4" else fees
        rev = None if rev == "ifrs4" else rev
        op = None if op == "ifrs4" else op
        fee_key = None
        top = None  # the revenue the operating expenses are measured against
        if fees:
            add("fees", fees)
            fee_key = "fees"
            top = fees[1]
            if rev and rev[1] - fees[1] > 0.05:
                o = rev[1] - fees[1]
                s["comps"]["rev_other"] = o
                s["cid"]["rev_other"] = [F.calc(f"rev_other@{'LTM' if win == 'ltm' else ''}{qk}", LABEL["rev_other"], wl(qk, win), o, MN, "סך ההכנסות − הכנסות מדמי ניהול", [rev[0], fees[0]])]
                top = rev[1]
        elif rev:
            s["comps"]["fees"] = rev[1]
            s["cid"]["fees"] = [rev[0]]
            fee_key = "fees"
            top = rev[1]
            s["fee_src"] = "rev"
            s["notes"].append("הדוח אינו מדפיס שורת דמי ניהול: סך ההכנסות")
        if op and top is not None:
            c = -(top - op[1])
            s["comps"]["cost"] = c
            s["cid"]["cost"] = [F.calc(f"cost@{'LTM' if win == 'ltm' else ''}{qk}", "הוצאות תפעוליות", wl(qk, win), -c, MN,
                                       "הכנסות − רווח תפעולי", [x for k in ("fees", "rev_other") for x in s["cid"].get(k, [])] + [op[0]])]
            base = op
        elif op:
            add("op", op)
            base = op
        else:
            base = None
        rest = pbt[1] - fsum(s["comps"].values())
        if s["comps"]:
            s["comps"]["other"] = rest
            what = "רווח לפני מס − רווח תפעולי (מימון ואחר)" if base else "רווח לפני מס − הכנסות (הוצאות, מימון ואחר: הדוח אינו מדפיס רווח תפעולי)"
            s["cid"]["other"] = [F.calc(f"other@{'LTM' if win == 'ltm' else ''}{qk}", LABEL["other"] if base else "הוצאות ואחר", wl(qk, win), rest, MN, what,
                                        [pbt[0]] + [x for k in ("fees", "rev_other", "cost", "op") for x in s["cid"].get(k, [])])]
            if not base:
                s["notes"].append("אין רווח תפעולי מודפס: ההוצאות בתוך 'הוצאות ואחר'")
        else:
            s["comps"]["pbt"] = pbt[1]
            s["cid"]["pbt"] = [pbt[0]]
            s["notes"].append("הדוח אינו מדפיס הכנסות או רווח תפעולי: הרווח לפני מס כרכיב אחד")

    # ---- the savings segment inside the fee line: fee yield x managed assets x mix (lens: the managing companies' own reports)
    if fee_key:
        segs = {}
        for seg in ("pen", "gem", "ins"):
            reps = [bk.lens.get((seg, q)) for q in qs]
            if all(reps):
                fees_v = fsum(x["fees"] for x in reps)
                a = fsum((x["aO"] + x["aE"]) / 2 for x in reps) / len(reps)
                if a > 0:
                    fid = [lens_fact(F, prov, bk.ent, seg, "fees", x["keys"]["q"], x["fees"], MN, f"הכנסות מדמי ניהול · {SEG_LABEL[seg]}", ql(q)) for x, q in zip(reps, qs)]
                    aid = []
                    for x, q in zip(reps, qs):
                        aid.append(lens_fact(F, prov, bk.ent, seg, "aum", x["keys"]["o"], x["aO"], BN, f"נכסים מנוהלים · {SEG_LABEL[seg]}", bl(end_of(back(q, 1)))))
                        aid.append(lens_fact(F, prov, bk.ent, seg, "aum", x["keys"]["e"], x["aE"], BN, f"נכסים מנוהלים · {SEG_LABEL[seg]}", bl(end_of(q))))
                    segs[seg] = (fees_v / a, a, fid, aid)
        tot = fsum(x[0] * x[1] for x in segs.values())
        if segs and tot <= s["comps"][fee_key] * 1.02 + 0.5:
            s["seg"] = segs
    return s, None


def harmonise(s0, s1, F):
    """the same component set on both sides (a line one side lacks is folded into 'other'), and the savings segments both sides carry"""
    for a, b in ((s0, s1), (s1, s0)):
        for k in list(a["comps"]):
            if k not in b["comps"] and k != "other":
                a["comps"]["other"] = a["comps"].get("other", 0.0) + a["comps"].pop(k)
                a["cid"]["other"] = a["cid"].get("other", []) + a["cid"].pop(k)
    common = sorted(set(s0.get("seg", {})) & set(s1.get("seg", {})))
    for s in (s0, s1):
        s["splits"] = {}
        if common and "fees" in s["comps"]:
            parts = {p: (s["seg"][p][0], s["seg"][p][1]) for p in common}
            other = s["comps"]["fees"] - fsum(y * a for y, a in parts.values())
            s["splits"]["fees"] = (parts, other)
    return common


# ---------------------------------------------------------------------------------------------------------------- one bridge
def contexts(key, s0, s1, la, lb, common, peer):
    """a short context line per driver (the moving figure behind it), with its fact ids"""
    def pct_ch(a, b):
        return f"{sgn((b / a - 1) * 100, 1)}%" if a > 0 and b > 0 else f"{sgn(b - a, 1)} {MN}"
    if key in ("isr", "inv", "fees", "rev_other", "op", "other", "pbt"):
        a, b = s0["comps"].get(key, 0.0), s1["comps"].get(key, 0.0)
        return f"{iso(num(a, 1))} → {iso(num(b, 1))} {MN} ({iso(pct_ch(a, b))})", s0["cid"].get(key, []) + s1["cid"].get(key, [])
    if key == "cost":
        a, b = -s0["comps"]["cost"], -s1["comps"]["cost"]
        return f"{iso(num(a, 1))} → {iso(num(b, 1))} {MN} ({iso(pct_ch(a, b))})", s0["cid"]["cost"] + s1["cid"]["cost"]
    if key.startswith("fees.") and common:
        p0, p1 = s0["splits"]["fees"][0], s1["splits"]["fees"][0]
        f0 = [x for p in common for x in s0["seg"][p][2]] + [x for p in common for x in s1["seg"][p][2]]
        a0 = [x for p in common for x in s0["seg"][p][3]] + [x for p in common for x in s1["seg"][p][3]]
        A0, A1 = fsum(v[1] for v in p0.values()), fsum(v[1] for v in p1.values())
        Y0 = fsum(v[0] * v[1] for v in p0.values()) / A0 if A0 else 0
        Y1 = fsum(v[0] * v[1] for v in p1.values()) / A1 if A1 else 0
        ann = 4 * 100 / 1000 if s0["m"] == 4 else 100 / 1000
        if key == "fees.yield":
            return f"{iso(num(Y0 * ann, 3) + '%')} → {iso(num(Y1 * ann, 3) + '%')} בשנה, על נכסים ממוצעים", f0 + a0
        if key == "fees.volume":
            if peer:
                return f"{iso(num(A0 * 1000 / s0['avg'], 1))} → {iso(num(A1 * 1000 / s1['avg'], 1))} ש\"ח נכסים לכל ש\"ח הון", a0 + [s0["id"]["eo"], s0["id"]["ec"], s1["id"]["eo"], s1["id"]["ec"]]
            return f"{iso(num(A0, 1))} → {iso(num(A1, 1))} {BN}, ממוצע ({iso(pct_ch(A0, A1))})", a0
        if key == "fees.mix":
            def mix(p):
                tot = fsum(v[1] for v in p.values())
                return " · ".join(f"{SEG_LABEL[k]} {iso(num(p[k][1] / tot * 100, 0) + '%')}" for k in common)
            return f"{mix(p0)} → {mix(p1)}", a0
        if key == "fees.other":
            o0, o1 = s0["splits"]["fees"][1], s1["splits"]["fees"][1]
            return f"{iso(num(o0, 1))} → {iso(num(o1, 1))} {MN} (שורת דמי הניהול פחות מגזר החיסכון)", s0["cid"]["fees"] + s1["cid"]["fees"] + f0
    if key == "tax":
        t0 = (1 - s0["np"] / s0["pbt"]) * 100 if s0["pbt"] else 0
        t1 = (1 - s1["np"] / s1["pbt"]) * 100 if s1["pbt"] else 0
        return f"שיעור מס אפקטיבי {iso(num(t0, 1) + '%')} → {iso(num(t1, 1) + '%')}", [s0["id"]["pbt"], s0["id"]["np"], s1["id"]["pbt"], s1["id"]["np"]]
    if key == "minority":
        m0, m1 = s0["np"] - s0["np_attr"], s1["np"] - s1["np_attr"]
        return f"{iso(num(m0, 1))} → {iso(num(m1, 1))} {MN}", [s0["id"]["np"], s0["id"]["np_attr"], s1["id"]["np"], s1["id"]["np_attr"]]
    if key == "equity":
        return f"הון ממוצע {iso(num(s0['avg'], 0))} → {iso(num(s1['avg'], 0))} {MN} ({iso(pct_ch(s0['avg'], s1['avg']))})", [s0["id"]["eo"], s0["id"]["ec"], s1["id"]["eo"], s1["id"]["ec"]]
    return None, []


def scaled(s):
    """a state in points of ROE (peer bridges): every NIS amount x q, so two companies of different size compare"""
    q = s["q"]
    out = dict(s, comps={k: v * q for k, v in s["comps"].items()}, pbt=s["pbt"] * q, np=s["np"] * q, np_attr=s["np_attr"] * q, q=1.0)
    if s.get("splits"):
        out["splits"] = {k: ({p: (y, a * q) for p, (y, a) in parts.items()}, o * q) for k, (parts, o) in s["splits"].items()}
    return out


def chg_of(key, s0, s1, tag, peer):
    """the short change behind a driver, for the sentence: "−36.9% YoY" (time) or "716.9 מול 452.0 מיליוני ש\"ח" (two companies)"""
    def pc(a, b):
        return f"{iso(sgn((b / a - 1) * 100, 1) + '%')} {tag}" if a > 0 and b > 0 else f"{iso(sgn(b - a, 0))} {MN} {tag}"
    def vs(a, b, d=1, u=MN):
        return f"{iso(num(b, d))} מול {iso(num(a, d))} {u}"
    if key in ("isr", "inv", "fees", "rev_other", "op", "other", "pbt", "cost"):
        a, b = abs(s0["comps"].get(key, 0.0)) if key == "cost" else s0["comps"].get(key, 0.0), abs(s1["comps"].get(key, 0.0)) if key == "cost" else s1["comps"].get(key, 0.0)
        return vs(a, b) if peer else pc(a, b)
    if key == "tax":
        t0 = (1 - s0["np"] / s0["pbt"]) * 100 if s0["pbt"] else 0
        t1 = (1 - s1["np"] / s1["pbt"]) * 100 if s1["pbt"] else 0
        return f"שיעור מס {iso(num(t1 if peer else t0, 1) + '%')} {'מול' if peer else '→'} {iso(num(t0 if peer else t1, 1) + '%')}"
    if key == "equity":
        return pc(s0["avg"], s1["avg"])
    if key.startswith("fees.") and s0.get("splits", {}).get("fees"):
        p0, p1 = s0["splits"]["fees"][0], s1["splits"]["fees"][0]
        A0, A1 = fsum(v[1] for v in p0.values()), fsum(v[1] for v in p1.values())
        if key == "fees.volume":
            return vs(A0 * 1000 / s0["avg"], A1 * 1000 / s1["avg"], 1, 'ש"ח נכסים לש"ח הון') if peer else pc(A0, A1)
        if key == "fees.yield":
            ann = (4 if s0["m"] == 4 else 1) * 100 / 1000
            Y0 = fsum(v[0] * v[1] for v in p0.values()) / A0 * ann if A0 else 0
            Y1 = fsum(v[0] * v[1] for v in p1.values()) / A1 * ann if A1 else 0
            return f"{iso(num(Y1 if peer else Y0, 3) + '%')} {'מול' if peer else '→'} {iso(num(Y0 if peer else Y1, 3) + '%')} בשנה"
    return None


def one_bridge(s0, s1, metric, la, lb, common, peer=False, tag=""):
    """metric 'roe' (points, time), 'np' (NIS m, time), 'peer' (points, two companies). Returns the bridge dict."""
    rate = A.rate_ok(s0) and A.rate_ok(s1)
    if metric == "roe":
        v0, v1, out, res = A.bridge(s0, s1, rate=rate, with_q=True)
    elif metric == "np":
        v0, v1, out, res = A.bridge(dict(s0, q=1.0), dict(s1, q=1.0), rate=rate, with_q=False)
    else:
        v0, v1, out, res = A.bridge(scaled(s0), scaled(s1), rate=rate, with_q=False)
    dec = 1 if metric == "np" else 2
    wid = [s0["id"]["k"], s1["id"]["k"]] if rate else [s0["id"]["pbt"], s0["id"]["np"], s1["id"]["pbt"], s1["id"]["np"]]
    qid = [s0["id"]["q"], s1["id"]["q"]] if metric != "np" else []
    unit = "נק׳" if metric != "np" else MN
    if not s0["np"] - s0["np_attr"] and not s1["np"] - s1["np_attr"]:
        out.pop("minority", None)
    drivers = []
    for key in ORDER:
        if key not in out:
            continue
        v = out[key]
        ctx, cin = contexts(key, s0, s1, la, lb, common, metric == "peer")
        if key in ("tax", "minority", "equity"):
            f = {"tax": ("שיעור המס (1 − רווח לתקופה ÷ רווח לפני מס)" if rate else "סכום המס (רווח לפני מס − רווח לתקופה)"),
                 "minority": "רווח המיוחס לזכויות שאינן מקנות שליטה", "equity": "הון ממוצע (בסיס ההון)"}[key]
            formula = f"Shapley: השפעת {f} בממוצע על כל סדרי השינוי של {{רכיבים, מס, זכויות מיעוט{', בסיס הון' if metric == 'roe' else ''}}}"
            ins = cin + (qid if key != "equity" else qid)
        else:
            base = key.split(".")[0]
            if "." in key:
                part = {"yield": "Δ שיעור דמי הניהול × נכסים ממוצעים", "volume": "Δ נכסים × שיעור ממוצע × תמהיל ממוצע", "mix": "Δ תמהיל × נכסים ממוצעים × שיעור ממוצע",
                        "other": "Δ (שורת דמי הניהול − מגזר החיסכון)"}[key.split(".")[1]]
                formula = f"{part}, נקודת אמצע; × משקל Shapley של מס{', זכויות מיעוט' if 'minority' in out else ''}{' ובסיס ההון' if metric == 'roe' else ''}"
            else:
                formula = f"Δ {LABEL[key] if key != 'other' or s0['kind'] == 'ins' else 'רכיב'} × משקל Shapley של מס{', זכויות מיעוט' if 'minority' in out else ''}{' ובסיס ההון' if metric == 'roe' else ''}"
                if metric == "peer":
                    formula = f"Δ ({LABEL[key]} × מכפיל ההון) × משקל Shapley של מס{', זכויות מיעוט' if 'minority' in out else ''}"
            ins = cin + wid + qid
        label = (PEER_LABEL.get(key) if metric == "peer" else None) or LABEL[key]
        if s0.get("fee_src") == "rev" and s1.get("fee_src") == "rev":
            label = {"fees": "הכנסות", "fees.other": "הכנסות אחרות (מחוץ למגזר החיסכון)"}.get(key, label)
        if key == "other" and s0.get("kind") == "fund" and "cost" not in s0["comps"] and "op" not in s0["comps"]:
            label = "הוצאות ואחר"
        seen = []
        for x in ins:
            if x not in seen:
                seen.append(x)
        chg = chg_of(key, s0, s1, tag, metric == "peer")
        drivers.append({"k": key, "l": label, "v": r(v, dec + 2), "f": formula, "in": seen, **({"ctx": ctx} if ctx else {}), **({"chg": chg} if chg else {}),
                        **({"seg": 1} if key.startswith("fees.") and key != "fees.other" else {})})
    total = v1 - v0
    return {"from": r(v0, dec + 2), "to": r(v1, dec + 2), "total": r(total, dec + 2), "residual": r(res, 9), "unit": unit, "mode": "rate" if rate else "amount",
            "drivers": drivers}


def restate(bk, s0, kind_win, qk, F):
    """the first print of the base state's ROE / profit inputs, where a later report restated them: (roe_first, np_first, fact ids) or None"""
    win = kind_win
    qs = [qk] if win == "q" else [back(qk, k) for k in (3, 2, 1, 0)]
    role = bk.np_attr_role if bk.use_attr else "np"
    eo_end, ec_end = end_of(back(qk, 1 if win == "q" else 4)), end_of(qk)
    changed = False
    ids = []
    npv = 0.0
    for q in qs:
        fp = bk.first_print(role, "Q", end_of(q))
        cur = bk.fact(role, "Q", end_of(q))
        if fp:
            changed = changed or abs(fp[0] - cur[1]) > 1e-6
            ids.append(F.leaf(f"{role}@{q}.first", f"{LABEL_ROLE[role]} · כפי שדווח לראשונה", ql(q), fp[0], MN, fp[2], fp[1], bk.docs.title(fp[2])))
            npv += fp[0]
        else:
            npv += cur[1]
            ids.append(cur[0])
    eq = []
    for e in (eo_end, ec_end):
        if bk.kind == "ins" and e == "2023-12-31" and bk.fact(bk.eq_role, "I", "2024-01-01"):
            e = "2024-01-01"
        fp = bk.first_print(bk.eq_role, "I", e)
        cur = bk.fact(bk.eq_role, "I", e)
        if fp:
            changed = changed or abs(fp[0] - cur[1]) > 1e-6
            ids.append(F.leaf(f"{bk.eq_role}@{e}.first", f"{LABEL_ROLE[bk.eq_role]} · כפי שדווח לראשונה", bl(e), fp[0], MN, fp[2], fp[1], bk.docs.title(fp[2])))
            eq.append(fp[0])
        else:
            eq.append(cur[1])
            ids.append(cur[0])
    if not changed:
        return None
    m = 4 if win == "q" else 1
    return m * 100.0 * npv / ((eq[0] + eq[1]) / 2), npv, ids


# ---------------------------------------------------------------------------------------------------------------- sentences
def lead(drivers):
    return max(drivers, key=lambda d: abs(d["v"])) if drivers else None


def sentence_time(name, b, la, lb, metric):
    big = lead(b["drivers"])
    if metric == "roe":
        t = b["total"]
        move = "ללא שינוי" if abs(t) < 0.05 else ("עלה" if t > 0 else "ירד") + f" ב-{iso(num(abs(t), 1))} נק׳"
        s = f"ROE של {name} {move}, מ-{iso(num(b['from'], 1) + '%')} ב-{la} ל-{iso(num(b['to'], 1) + '%')} ב-{lb}."
        if big and abs(t) >= 0.05:
            s += f" הגורם הגדול: {big['l']} ({iso(sgn(big['v'], 1))} נק׳" + (f"; {big['chg']}" if big.get("chg") else "") + ")."
        return s
    t = b["total"]
    pc = f" ({iso(sgn((b['to'] / b['from'] - 1) * 100, 1) + '%')})" if b["from"] > 0 and b["to"] > 0 else ""
    move = "ללא שינוי" if abs(t) < 0.5 else ("עלה" if t > 0 else "ירד") + f" ב-{iso(num(abs(t), 0))} {MN}{pc}"
    s = f"הרווח לבעלי המניות של {name} {move}, מ-{iso(num(b['from'], 0))} ב-{la} ל-{iso(num(b['to'], 0))} ב-{lb}."
    if big and abs(t) >= 0.5:
        s += f" הגורם הגדול: {big['l']} ({iso(sgn(big['v'], 0))} {MN}" + (f"; {big['chg']}" if big.get("chg") else "") + ")."
    return s


def sentence_peer(na, nb, b, label):
    big = lead(b["drivers"])
    t = b["total"]
    move = "זהה ל" if abs(t) < 0.05 else ("גבוה ב-" if t > 0 else "נמוך ב-") + f"{iso(num(abs(t), 1))} נק׳ מ"
    s = f"ROE של {nb} ב-{label} {move}זה של {na} ({iso(num(b['to'], 1) + '%')} מול {iso(num(b['from'], 1) + '%')})."
    if big and abs(t) >= 0.05:
        s += f" הגורם הגדול: {big['l']} ({iso(sgn(big['v'], 1))} נק׳" + (f"; {big['chg']}" if big.get("chg") else "") + ")."
    return s


# ---------------------------------------------------------------------------------------------------------------- build
def companies():
    idx = json.loads((DATA / "companies" / "index.json").read_text(encoding="utf-8"))
    return [c for c in idx if c.get("has_financials") and (DATA / "companies" / f"{c['id']}.json").exists()]


def last_quarter(bk):
    """the company's latest quarter with profit before tax (or net profit) printed"""
    ends = sorted({p["end"] for p in bk.d["periods"] if p["type"] == "Q" and p["end"][5:10] in QOF})
    for e in reversed(ends):
        if bk.fact("np", "Q", e):
            return qkey(e)
    return None


def build():
    docs, lens, prov = Docs(), load_lens(), LtsProv()
    files = {}
    books = {}
    for ent in companies():
        F = Facts()
        bk = Book(ent, docs, lens, F)
        books[bk.ent] = bk
        lq = last_quarter(bk)
        if not lq:
            continue
        ends = [back(lq, k) for k in range(N_ENDS - 1, -1, -1)]
        bridges, gaps = [], []
        for qk in ends:
            for kind, base, win in (("qoq", back(qk, 1), "q"), ("yoy", back(qk, 4), "q"), ("ltm", back(qk, 4), "ltm")):
                bid = f"{kind}:{qk}"
                s1, why1 = state(bk, prov, qk, win)
                s0, why0 = state(bk, prov, base, win)
                if not s0 or not s1:
                    gaps.append({"id": bid, "why": f"{wl(base if not s0 else qk, win)}: {why0 if not s0 else why1}"})
                    continue
                s0["kind"] = s1["kind"] = bk.kind
                common = harmonise(s0, s1, F)
                la, lb = wl(base, win), wl(qk, win)
                tag = {"qoq": "QoQ", "yoy": "YoY", "ltm": "LTM מול LTM"}[kind]
                roe = one_bridge(s0, s1, "roe", la, lb, common, tag=tag)
                npb = one_bridge(s0, s1, "np", la, lb, common, tag=tag)
                rs = restate(bk, s0, win, base, F)
                if rs:
                    fr, fn, ids = rs
                    for b, first, unit_dec in ((roe, fr, 4), (npb, fn, 3)):
                        dv = b["from"] - first
                        b["drivers"].insert(0, {"k": "restate", "l": LABEL["restate"], "v": r(dv, unit_dec), "f": f"{la} כפי שמוצג היום − {la} כפי שדווח לראשונה",
                                                "in": ids + ([s0["id"]["roe"]] if b is roe else [s0["id"]["np_attr"]]),
                                                "ctx": f"{la}: {iso(num(first, 1) + ('%' if b is roe else ''))} בהדפסה הראשונה, {iso(num(b['from'], 1) + ('%' if b is roe else ''))} היום"
                                                       + ("" if b is roe else f" {MN}")})
                        b["from_latest"] = b["from"]
                        b["from"] = r(first, unit_dec)
                        b["total"] = r(b["to"] - first, unit_dec)
                roe["sentence"] = sentence_time(bk.name, roe, la, lb, "roe")
                npb["sentence"] = sentence_time(bk.name, npb, la, lb, "np")
                notes = sorted(set(s0["notes"] + s1["notes"]))
                if common:
                    notes.append("מגזר החיסכון ארוך הטווח (" + ", ".join(SEG_LABEL[p] for p in common) + "): חלק משורת דמי הניהול של הקבוצה, מדוחות החברות המנהלות; "
                                 "אינו מוצג כרווח הקבוצה")
                if not bk.use_attr:
                    notes.append("ROE על רווח לתקופה ÷ סך ההון: הדוח אינו מדפיס הון או רווח המיוחסים לבעלי המניות")
                bridges.append({"id": bid, "kind": kind, "win": win, "a": base, "b": qk, "la": la, "lb": lb, "roe": roe, "np": npb,
                                "chk": {"a": [s0["id"]["np_attr"], s0["id"]["eo"], s0["id"]["ec"], s0["m"]], "b": [s1["id"]["np_attr"], s1["id"]["eo"], s1["id"]["ec"], s1["m"]]},
                                **({"notes": notes} if notes else {})})
        files[f"{bk.ent}.json"] = {
            "v": 1, "company": bk.ent, "name": bk.name, "kind": bk.kind, "last": lq, "ends": ends, "method": A.METHOD,
            "roe_def": f"ROE = 4 × {'רווח לבעלי המניות' if bk.use_attr else 'רווח לתקופה'} ברבעון ÷ ממוצע {LABEL_ROLE[bk.eq_role]} בתחילת הרבעון ובסופו × 100; LTM: סכום ארבעה רבעונים ÷ ממוצע ההון לפני שנה והיום",
            "bridges": bridges, "gaps": gaps, "facts": F.t}

    # ---- peers: every ordered pair of companies of the same kind, at the quarter most companies last reported
    by_kind = {}
    for c, bk in books.items():
        by_kind.setdefault(bk.kind, []).append(c)
    lasts = [b for b in (last_quarter(bk) for bk in books.values()) if b]
    period = max(set(lasts), key=lambda q: (lasts.count(q), q)) if lasts else None
    if period:
        F = Facts()
        out = {"v": 1, "period": period, "label": ql(period), "method": A.METHOD,
               "def": "ROE של כל חברה מפורק לרכיבים ביחס להון הממוצע שלה (נקודות ROE), ואז Shapley בין שתי החברות: הפרשי היקף מתבטלים",
               "companies": {}, "bridges": [], "gaps": [], "facts": None}
        for kind, cos in sorted(by_kind.items()):
            for win in ("q", "ltm"):
                ok = {}
                for c in sorted(cos):
                    bk = books[c]
                    bk.F = Facts(prefix=f"{c}:")
                    bk.F.t = F.t  # one table, ids prefixed by company
                    s, why = state(bk, prov, period, win)
                    if s:
                        s["kind"] = kind
                        ok[c] = s
                    else:
                        out["gaps"].append({"id": f"{win}:{c}", "why": f"{bk.name} {wl(period, win)}: {why}"})
                for a in ok:
                    for b in ok:
                        if a == b:
                            continue
                        s0 = json.loads(json.dumps({k: v for k, v in ok[a].items() if k != "seg"}))
                        s1 = json.loads(json.dumps({k: v for k, v in ok[b].items() if k != "seg"}))
                        s0["seg"], s1["seg"] = ok[a].get("seg", {}), ok[b].get("seg", {})
                        common = harmonise(s0, s1, F)
                        br = one_bridge(s0, s1, "peer", books[a].name, books[b].name, common, peer=True)
                        br["sentence"] = sentence_peer(books[a].name, books[b].name, br, wl(period, win))
                        out["bridges"].append({"id": f"{win}:{a}:{b}", "win": win, "a": a, "b": b, "roe": br,
                                               "chk": {"a": [s0["id"]["np_attr"], s0["id"]["eo"], s0["id"]["ec"], s0["m"]], "b": [s1["id"]["np_attr"], s1["id"]["eo"], s1["id"]["ec"], s1["m"]]}})
                for c in ok:
                    out["companies"][c] = {"name": books[c].name, "kind": kind}
        out["facts"] = F.t
        files[f"peers_{period}.json"] = out
    # the index: which company files exist and which peer file is current (the /attribution route reads it first)
    files["index.json"] = {"v": 1, "peers": f"peers_{period}.json" if period else None, "period": period,
                           "companies": [{"id": c, "name": d["name"], "kind": d["kind"], "last": d["last"], "n": len(d["bridges"])}
                                         for c, d in ((n[:-5], d) for n, d in files.items() if not n.startswith("peers_"))]}
    return files


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), sort_keys=False)


# ---------------------------------------------------------------------------------------------------------------- verification
def verify(files):
    """(n checked, problems): sums, from/to against the facts, provenance down to a report page for every contribution"""
    probs, n = [], 0

    def leaves(F, fid, seen=()):
        e = F.get(fid)
        if e is None:
            return None
        if "of" in e:
            if not e["of"]:
                return None
            out = []
            for x in e["of"]:
                if x in seen:
                    return None
                l2 = leaves(F, x, seen + (fid,))
                if l2 is None:
                    return None
                out += l2
            return out
        return [e] if e.get("url") and e.get("pg") is not None else None

    for name, d in files.items():
        if name == "index.json":
            continue
        F = d["facts"]
        for b in d["bridges"]:
            for metric in ("roe", "np"):
                br = b.get(metric)
                if not br:
                    continue
                n += 1
                dec = 3 if metric == "np" else 4
                s = fsum(x["v"] for x in br["drivers"]) + br["residual"]
                tol = 0.5 * 10 ** -dec * (len(br["drivers"]) + 2)
                if not all(isfinite(x["v"]) for x in br["drivers"]) or not isfinite(br["total"]):
                    probs.append(f"{name} {b['id']} {metric}: not a number")
                if abs(s - br["total"]) > tol:
                    probs.append(f"{name} {b['id']} {metric}: drivers {s:.4f} vs total {br['total']:.4f}")
                if abs(br["from"] + br["total"] - br["to"]) > 2 * 10 ** -dec:
                    probs.append(f"{name} {b['id']} {metric}: from + total != to")
                if abs(br["residual"]) > 1e-6:
                    probs.append(f"{name} {b['id']} {metric}: residual {br['residual']}")
                for x in br["drivers"]:
                    if not x["in"]:
                        probs.append(f"{name} {b['id']} {metric} {x['k']}: no inputs")
                    for fid in x["in"]:
                        if leaves(F, fid) is None:
                            probs.append(f"{name} {b['id']} {metric} {x['k']}: input {fid} does not open to a report page")
                if not br.get("sentence"):
                    probs.append(f"{name} {b['id']} {metric}: no sentence")
            # ROE recomputed from the facts it cites (the latest prints)
            for side, key in (("a", "from_latest"), ("b", "to")):
                npi, eo, ec, m = b["chk"][side]
                got = m * 100 * F[npi]["v"] / ((F[eo]["v"] + F[ec]["v"]) / 2)
                want = b["roe"].get(key, b["roe"]["from"]) if side == "a" else b["roe"]["to"]
                if abs(got - want) > 0.002:
                    probs.append(f"{name} {b['id']} ROE {side}: facts give {got:.3f}, bridge {want:.3f}")
    return n, probs


def main():
    files = build()
    n, probs = verify(files)
    if "--check" in sys.argv:
        diff = []
        on_disk = {p.name for p in OUT.glob("*.json")} if OUT.exists() else set()
        for name, d in files.items():
            p = OUT / name
            if not p.exists() or p.read_text(encoding="utf-8") != dump(d):
                diff.append(name)
        stale = sorted(on_disk - set(files))
        nb = sum(len(d.get("bridges", [])) for d in files.values())
        if diff or stale or probs:
            print(f"attribution: {len(diff)} files differ from a rebuild{(' (' + ', '.join(diff[:4]) + ')') if diff else ''}; {len(stale)} stale; "
                  f"{len(probs)} problems" + (f"; e.g. {probs[0]}" if probs else ""))
            return 1
        print(f"attribution: {len(files)} files, {nb} bridges, {n} decompositions sum to their totals, every contribution opens to a report page; 0 problems")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob("*.json"):
        if p.name not in files:
            p.unlink()
    for name, d in files.items():
        (OUT / name).write_text(dump(d), encoding="utf-8")
    nb = sum(len(d.get("bridges", [])) for d in files.values())
    ng = sum(len(d.get("gaps", [])) for d in files.values())
    print(f"attribution: {len(files)} files, {nb} bridges, {ng} gaps, {len(probs)} problems -> {OUT.relative_to(ROOT)}")
    for p in probs[:20]:
        print("  ", p)
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
