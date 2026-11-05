"""Report Day changes engine (lane P1): the <=10 most material changes of each report, each with both figures and their pages.

python3 pipeline/build_changes.py                   build web/public/data/changes/<company>.json + changes/index.json
python3 pipeline/build_changes.py --check           rebuild in memory: equal to the files, every printed figure re-read (gate `changes`)
python3 pipeline/build_changes.py --show harel [P]  print one company's ranked list (P = report period, default the latest)

Standard library only, deterministic (sorted iteration, math.fsum, no clock in the files except `built`). Reads published files only:
companies/<id>.json (the statements as extracted, every figure with its report and page; pipeline/reportday.py reads the Report Day
roles exactly as pages/ReportDay.tsx does), cards/<id>/<period>.json (CSM, new business, release, solvency ratio, ROE: the report card's
facts, already digit-validated by check_cards.py; a T+0 card = the XBRL tags of a report filed today, status unverified), search/docs.json
(report id -> publication day, pages), and data/registry/changes_why.json (optional: a reason the report itself states, with its page).

CANDIDATES (each a comparison the site already shows; nothing is estimated)
  pl    every line of the profit-and-loss statement above the bottom line (IFRS 17 section), the reported window against the same window
        a year earlier (YoY): the quarter for an interim report, the year for an annual report; rows printed under several wordings are
        one line (ReportDay.movers). The attributable profit and comprehensive income come from the Report Day roles (net, comp).
        Left out: pass-through lines whose gross-up cancels inside "רווח מהשקעות ומימון, נטו" (PASS), the profit before tax and the
        period's total profit when the attributable profit is present (same move, counted once: FAMILY), per-share rows, and a plain
        income/expense line whose sign flips between the two reports (a presentation artefact, the ReportDay.movers rule)
  bs    shareholders' equity and a fixed list of balance-sheet lines an analyst reads (BS_KEEP: nostro investments, other cash, debt,
        goodwill/intangibles, non-controlling interests), the quarter end against the previous quarter end (QoQ). Lines held against
        yield-dependent contracts and the balance-sheet totals are not candidates: they move with the policyholders' assets.
  csm   CSM closing balance QoQ (the one resolution every page uses, same basis both ends), new business and release to profit YoY
  sr    solvency ratio (with transitional measures) against the previous disclosed date, same basis, in points
  roe   ROE LTM (LTM profit / average equity, lib/kpi.ts) against the same measure a year earlier, in points

MATERIALITY (the rule, explicit; MAT below)
  score = impact x weight, in % of shareholders' equity at the start of the comparison window (the previous quarter end; the period end
  if that is missing):
    NIS lines      impact = |change| / equity x 100
    ratio lines    impact = |change in points| x 0.2 (5 points of solvency or ROE count as 1% of equity)
    weight         statement lines with >= 4 earlier comparisons of the same kind (8 quarters back): z = |change| / RMS of those earlier
                   changes; weight = min(2, max(0.5, z / 2)): a routine move (z <= 1) counts half, a 2-sigma move counts as is, a
                   4-sigma move counts double. Gross lines (insurance revenue and expenses, gross reinsurance) carry x 0.5 on top: their
                   moves largely cancel in the insurance service result. IFRS 17 and capital rows: weight 1.
  a change enters when score >= 0.5 and (for NIS lines) |change| >= NIS 1m; the top 10 by score (ties by label) are published.
  Δ% only between two positive figures (ReportDay Delta); otherwise the difference alone.

RESTATED COMPARATIVES: a comparative whose figure differs from its first print (workbook flag 8) carries `rest` = the first print with its
own report and page; the change is measured against the figure as reprinted (what the report itself compares to).

WHY: a one-line reason only where the report states it, from data/registry/changes_why.json {"<company>/<period>/<key>": {"t": text,
"rid": report id, "pg": page}} (filled by the report-day extraction pass, never generated here); otherwise no reason.

Output figure = the feed's figure {v, u, s} (pipeline/build_feed.py): s {k: pg, rid, pg, der?} printed on a page · {k: calc, fx, in}
computed here · {k: xbrl, rid, key, p} a T+0 tag (unverified). The page opens at /doc/<rid>?page=<pg>.
"""
import argparse
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cards as bc  # noqa: E402
import reportday as rd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "changes"
WHY = ROOT / "data" / "registry" / "changes_why.json"
FROM = "2025Q1"         # the first reports whose comparatives are IFRS 17 on both sides
TOP = 10
MAT = {"min_score": 0.5, "min_abs_m": 1.0, "pp_to_eq": 0.2, "hist": 8, "hist_min": 4, "w_lo": 0.5, "w_hi": 2.0, "gross": 0.5}
PASS = re.compile(r"תלויי תשואה|מרכיב התשואה|הנובעות מחוזי ביטוח|^סך ה?כל רווחים? .?הפסדים.? מהשקעות, נטו$|^סך ה?כל רווחים מהשקעות|"
                  r"^רווח,? נטו מביטוח ומהשקעה|^רווחים .?הפסדים.? מהשקעות, נטו$")
FAMILY = re.compile(r"^(?:רווח|הפסד)(?: הפסד)? לפני מסים על ה?הכנסה$|^(?:רווח|הפסד)(?: הפסד)?(?: נקי)?(?: לתקופה| לשנה)?$")
GROSS = re.compile(r"^(?:הכנסות|הוצאות) משירותי ביטוח$|^(?:הכנסות|הוצאות) מביטוח משנה$|^רווח(?: הפסד)? משירותי ביטוח לפני ביטוחי? משנה")
BS_KEEP = re.compile(r"התחייבויות פיננסיות|אגרות חוב|כתבי התחייבות|מוניטין|נכסים בלתי מוחשיים|זכויות שאינן מקנות שליטה")
BS_DROP = re.compile(r"תלויי תשואה|^סך|^סה")
# equity where the Report Day role finds no row (fund houses word it otherwise): the attributable line, else total equity (labelled)
EQ_ATTR = re.compile(r"^(?:(?:סך(?: ה?כל)?|סה.{1,2}כ) )?ה?הון ה?מיוחס לבעלי(?:ם| ה?מניות)? (?:של )?(?:ה?חברה(?: ה?אם)?|חברת ה?אם)$")
EQ_TOT = re.compile(r"^(?:סך(?: ה?כל)?|סה.{1,2}כ) ה?הון$")
ROLE_OF = {"rev": "הכנסות משירותי ביטוח", "isr": "רווח משירותי ביטוח", "inv": "רווח מהשקעות ומימון, נטו"}
MINUS = "−"


def r6(x):
    return None if x is None else round(x, 6)


def per_label(p):
    return f"FY'{p[2:4]}" if p.endswith("FY") else f"{p[4:]}'{p[2:4]}"


def q_label(end):
    return bc.plabel("Q", end)


def date_label(d):
    """lib/format.ts dateLabel: a quarter end is Q4'25, any other date 15.05.26 (never an ISO date on screen)"""
    return q_label(d) if d[5:10] in bc.QE else f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


def pg_fig(v, u, rid, page, der=False):
    s = {"k": "pg", "rid": rid, "pg": page}
    if der:
        s["der"] = 1
    return {"v": r6(v), "u": u, "s": s}


def inp(label, f):
    return {"l": label, "v": f["v"], "u": f["u"], "s": f["s"]}


def diff(a, b, la, lb, u):
    return {"v": r6(a["v"] - b["v"]), "u": u, "s": {"k": "calc", "fx": f"{la} − {lb}", "in": [inp(la, a), inp(lb, b)]}}


def pct(a, b, la, lb):
    """% change between two positive figures below a sixfold (build_feed.calc_pct: the feed re-checks it)"""
    if a["v"] is None or b["v"] is None or a["v"] <= 0 or b["v"] <= 0 or a["v"] / b["v"] >= 6:
        return None
    return {"v": r6((a["v"] / b["v"] - 1) * 100), "u": "dpct", "s": {"k": "calc", "fx": f"{la} ÷ {lb} − 1", "in": [inp(la, a), inp(lb, b)]}}


EXPENSE = re.compile(r"^(?:הוצאות|מסים|שיווק|תפעול|עמלות|דמי עמילות)")


def good(it):
    """+1 the change reads favourably, -1 unfavourably, 0 neutral (debt, intangibles, minorities): the page's colour only, never a figure"""
    d = it["d"]["v"]
    sgn = (d > 0) - (d < 0)
    if it["k"].startswith("bs:"):
        return 0
    if it["g"] == "pl" and EXPENSE.search(it["l"]) and it["a"]["v"] > 0 and it["b"]["v"] > 0:
        return -sgn
    return sgn


def weight(delta, hist):
    """(weight, z) of the line's own volatility: RMS of its earlier changes of the same kind (MAT)."""
    h = [x for x in hist if x is not None]
    if len(h) < MAT["hist_min"]:
        return 1.0, None
    rms = math.sqrt(math.fsum(x * x for x in h) / len(h))
    if rms <= 0:
        return MAT["w_hi"], None
    z = abs(delta) / rms
    return min(MAT["w_hi"], max(MAT["w_lo"], z / 2)), round(z, 2)


def lines_below(bk, sheet):
    """reportday.Book.lines_of with ReportDay.linesOf's `below` mark: everything from the attribution / per-share / OCI block down"""
    out, seg, below, hdr = [], -1, False, ""
    std_of = {l["mi"]: l for l in bk.lines_of(sheet)}
    for mi in bk.by_sheet.get(sheet, []):
        m = bk.d["metrics"][mi]
        label = rd.clean(m["label"])
        if m.get("std"):
            seg, below, hdr = seg + 1, False, ""
            continue
        if re.search(r"כולל|מיוחס|למניה", label) or rd.ATTR.search(label):
            below = True
        if m.get("header"):
            hdr = label.rstrip(" :")
            continue
        if mi in std_of:
            out.append(dict(std_of[mi], below=below, total=bool(m.get("total")), hdr=hdr))
        if m.get("total"):
            hdr = ""  # a total closes the block its header opened
    return out


def shown_label(l):
    """the printed wording; a short line inside a block ("ניהול קופות גמל", "סך הכול", "אחרים") is named with its block's header"""
    raw = re.sub(r"\s+", " ", l["raw"]).strip().rstrip(":")
    if l.get("hdr") and len(raw.split()) <= 3 and l["hdr"] not in raw:
        return f"{l['hdr']}: {raw}"
    return raw


# ---------------------------------------------------------------------------------------------------------------- card facts as figures
def card_fig(card, key, label=None):
    """A report-card fact as a feed figure (recursively for a computed one); None when the card has no such fact."""
    f = card["f"].get(key)
    if not f or f.get("v") is None:
        return None
    s, u = f["s"], ("pct" if f["u"] == "pct" else "pp" if f["u"] == "pp" else "m")
    if s["k"] == "pg":
        url = card["u"][s["u"]] if s.get("u") is not None else None
        rid = rd.rid_of(url)
        if rid is None or not isinstance(s.get("pg"), int):
            return None
        return pg_fig(f["v"], u, rid, s["pg"], "der" in (s.get("fl") or []))
    if s["k"] == "calc":
        ins = []
        for k in s["in"]:
            x = card_fig(card, k)
            if not x:
                return None
            sub = card["f"][k]["s"]
            ins.append(inp(sub.get("l") or sub.get("dp") or k, x) if sub.get("k") == "pg" else inp(sub.get("fx", k), x))
        return {"v": r6(f["v"]), "u": u, "s": {"k": "calc", "fx": s["fx"], "in": ins}}
    if s["k"] == "xbrl":
        ref = s.get("ref") or {}
        return {"v": r6(f["v"]), "u": u, "s": {"k": "xbrl", "rid": s.get("rid"), "key": ref.get("key"), "p": ref.get("p")}}
    return None


def card_text(card, key):
    """the card read the figure from the report's text or a chart, not a table (an estimate the company states in prose, often)"""
    f = card["f"].get(key) or {}
    return bool({"text", "chart"} & set((f.get("s") or {}).get("fl") or []))


def load_card(c, p):
    f = DATA / "cards" / c / f"{p}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


# ---------------------------------------------------------------------------------------------------------------- one report
class Engine:
    def __init__(self, c, name, kind, book, docs, why):
        self.c, self.name, self.kind, self.bk, self.docs, self.why = c, name, kind, book, docs, why

    # statement lines -----------------------------------------------------------------------------------------------
    def groups(self, sheet, keep):
        """{cleaned label: [rows]} of the IFRS 17 section of a statement, in print order (one line printed under several rows)."""
        out = {}
        for l in lines_below(self.bk, sheet):
            if l["std"] != "17" or not keep(l):
                continue
            m = self.bk.d["metrics"][l["mi"]]
            if m.get("unit") != "k" or m.get("total") and sheet == rd.SHEETS["BS"]:
                continue
            out.setdefault((l.get("hdr") or "") + "|" + l["label"], []).append(l)
        return out

    def fact(self, rows, typ, end):
        f = self.bk.fig_at(rows, typ, end)
        return f if f and f.get("rid") and isinstance(f.get("pg"), int) else None

    def original(self, f):
        """the first print of a restated comparative: (value NIS m, rid, page) of the earliest report that printed it"""
        rows = [r for r in self.bk.d.get("restated") or [] if r[0] == f["sheet"] and r[2] == f["row"] and r[3] == f["typ"] and r[4] == f["end"]]
        if not rows:
            return None
        r = min(rows, key=lambda x: x[11])
        u0 = self.bk.urls[r[7]] if r[7] is not None and r[7] < len(self.bk.urls) else None
        rid = rd.rid_of(u0)
        if rid is None or not isinstance(r[6], int):
            return None
        return pg_fig(r[5] / 1000, "m", rid, r[6])

    def stmt_item(self, key, label, rows, typ, end, base_end, la, lb, cmp, step, gross=False):
        a, b = self.fact(rows, typ, end), self.fact(rows, typ, base_end)
        if not a or not b or a["std"] != b["std"]:
            return None
        if cmp == "YoY" and b["rid"] != a["rid"]:
            # the comparative must be printed by the report itself (or a later one): a first print from the year-earlier report means the
            # new report does not carry this line for that period (reworded or reclassified), so there is no like-for-like change
            pb = (self.docs.get(b["rid"]) or {}).get("period")
            if not pb or not re.fullmatch(r"\d{4}(Q[1-3]|FY)", pb) or pkey(pb) < pkey(bc.key_of(end)):
                return None
        hist = []
        for k in range(1, MAT["hist"] + 1):
            e1 = bc.qshift(end, -k * step) if typ != "FY" else bc.shift_year(end, -k)
            e0 = bc.qshift(base_end, -k * step) if typ != "FY" else bc.shift_year(base_end, -k)
            x1, x0 = self.bk.fig_at(rows, typ, e1), self.bk.fig_at(rows, typ, e0)
            hist.append(x1["v"] - x0["v"] if x1 and x0 and x1["std"] == x0["std"] == "17" else None)
        A, B = pg_fig(a["v"], "m", a["rid"], a["pg"], a["der"]), pg_fig(b["v"], "m", b["rid"], b["pg"], b["der"])
        it = {"k": key, "l": label, "g": "bs" if typ == "I" else "pl", "cmp": cmp, "la": la, "lb": lb, "a": A, "b": B, "d": diff(A, B, la, lb, "dm")}
        p = pct(A, B, la, lb)
        if p:
            it["dp"] = p
        if b["re"]:
            o = self.original(b)
            if o:
                it["rest"] = o
        w, z = weight(A["v"] - B["v"], hist)
        it["_w"], it["z"] = w * (MAT["gross"] if gross else 1.0), z
        return it

    def statement_items(self, P, end):
        annual = P.endswith("FY")
        T = "FY" if annual else "Q"
        la, lb = (per_label(P), f"FY'{int(P[2:4]) - 1:02d}") if annual else (q_label(end), q_label(bc.shift_year(end, -1)))
        items = []
        # the Report Day roles first (attribution rows, or the bottom line where the report prints none)
        net_rows = None
        for key, label in (("net", "רווח נקי לבעלי המניות"), ("comp", "רווח כולל לבעלי המניות")):
            role = rd.BY_KEY[key]
            rows, alt = self.bk.resolve(role)
            if not self.fact(rows, T, end) and not alt and role["alt"]:
                rows, alt = self.bk.resolve(role, True)
            it = self.stmt_item(key, label, rows, T, end, bc.shift_year(end, -1), la, lb, "YoY", 1) if rows else None
            if it:
                if alt:
                    it["alt"] = 1
                items.append(it)
                if key == "net":
                    net_rows = rows
        # every other P&L line above the bottom line
        role_mi = {}
        for k, lab in ROLE_OF.items():
            for l in self.bk.resolve(rd.BY_KEY[k])[0]:
                role_mi[l["mi"]] = lab
        groups = self.groups(rd.SHEETS["PL"], lambda l: not l["below"])
        flipped = False
        cand = []
        for gk, rows in groups.items():
            label = gk.split("|", 1)[1]
            if PASS.search(label) or (net_rows and FAMILY.search(label)):
                continue
            # totals of a block (total revenue, total expenses, "סך הכול") repeat their lines' moves: only named results stay
            if rows[0]["total"] and rows[0]["mi"] not in role_mi and not re.match(r"^(?:רווח|הפסד)", label):
                continue
            it = self.stmt_item("pl:" + gk.strip("|"), role_mi.get(rows[0]["mi"], shown_label(rows[0])), rows, T, end, bc.shift_year(end, -1), la, lb, "YoY", 1,
                                gross=bool(GROSS.search(label)))
            if it:
                cand.append((label, it))
                if label == "הוצאות משירותי ביטוח" and it["a"]["v"] * it["b"]["v"] < 0:
                    flipped = True
        for label, it in cand:
            plain = re.match(r"^(?:הוצאות|הכנסות) ", it["l"]) and not re.search(r"נטו|[()]", it["l"])
            if it["a"]["v"] * it["b"]["v"] < 0 and (flipped or plain):
                continue
            items.append(it)
        # balance sheet: equity and the kept lines, against the previous quarter end
        q0 = bc.qshift(end, -1)
        qa, qb = q_label(end), q_label(q0)
        role = rd.BY_KEY["eq"]
        rows, _ = self.bk.resolve(role)
        eq_label = "הון לבעלי המניות"
        if not self.fact(rows, "I", end):
            bsl = [l for l in self.bk.lines_of(rd.SHEETS["BS"]) if l["std"] == "17"]
            rows = [l for l in bsl if EQ_ATTR.search(l["label"])] or [l for l in bsl if EQ_TOT.search(l["label"])]
            if rows and EQ_TOT.search(rows[0]["label"]):
                eq_label = "הון, סך הכל"
        it = self.stmt_item("eq", eq_label, rows, "I", end, q0, qa, qb, "QoQ", 1)
        eq = self.fact(rows, "I", q0) or self.fact(rows, "I", end)
        if it:
            items.append(it)
        bsg = self.groups(rd.SHEETS["BS"], lambda l: True)
        for gk, rows in bsg.items():
            label = gk.split("|", 1)[1]
            if BS_DROP.search(label) or not BS_KEEP.search(label):
                continue
            it = self.stmt_item("bs:" + gk.strip("|"), shown_label(rows[0]), rows, "I", end, q0, qa, qb, "QoQ", 1)
            if it:
                items.append(it)
        return items, eq

    # IFRS 17 and capital rows of the report card ------------------------------------------------------------------------
    def card_items(self, card, P, end, prev_card):
        out = []
        rows = {r["k"]: r for r in card.get("rows") or []}
        cur_l, yoy_l = (per_label(P), per_label(card["cmp"]["y"])) if P.endswith("FY") else (q_label(end), q_label(bc.shift_year(end, -1)))
        r = rows.get("csm")
        if r and r.get("qoq"):
            a, b = card_fig(card, r["cur"]), card_fig(card, r["qoq"])
            if a and b:
                la, lb = q_label(end), q_label(bc.qshift(end, -1))
                it = {"k": "csm", "l": "CSM, יתרת סגירה" + (f" ({r['basis']})" if r.get("basis") else ""), "g": "ifrs", "cmp": "QoQ", "la": la, "lb": lb,
                      "a": a, "b": b, "d": diff(a, b, la, lb, "dm"), "_w": 1.0, "z": None}
                if card_text(card, r["cur"]) or card_text(card, r["qoq"]):
                    it["tx"] = 1
                p = pct(a, b, la, lb)
                if p:
                    it["dp"] = p
                out.append(it)
        for k in ("nb", "rel"):
            r = rows.get(k)
            if r and r.get("yoy"):
                a, b = card_fig(card, r["cur"]), card_fig(card, r["yoy"])
                if a and b:
                    it = {"k": k, "l": r["l"], "g": "ifrs", "cmp": "YoY", "la": cur_l, "lb": yoy_l, "a": a, "b": b, "d": diff(a, b, cur_l, yoy_l, "dm"),
                          "_w": 1.0, "z": None}
                    p = pct(a, b, cur_l, yoy_l)
                    if p:
                        it["dp"] = p
                    out.append(it)
        r = rows.get("roe")
        if r and r.get("yoy"):
            a, b = card_fig(card, r["cur"]), card_fig(card, r["yoy"])
            if a and b:
                la, lb = f"LTM {q_label(end)}", f"LTM {q_label(bc.shift_year(end, -1))}"
                out.append({"k": "roe", "l": "ROE, LTM", "g": "ratio", "cmp": "YoY", "la": la, "lb": lb, "a": a, "b": b, "d": diff(a, b, la, lb, "pp"),
                            "_w": 1.0, "z": None, "der": 1})
        r = rows.get("sr")
        if r and prev_card:
            pr = next((x for x in prev_card.get("rows") or [] if x["k"] == "sr"), None)
            if pr and pr.get("at") and r.get("at") and pr["at"] < r["at"]:
                sa, sb = card["f"].get(r["cur"], {}).get("s", {}).get("ref", {}), prev_card["f"].get(pr["cur"], {}).get("s", {}).get("ref", {})
                a, b = card_fig(card, r["cur"]), card_fig(prev_card, pr["cur"])
                if a and b and sa.get("s") == sb.get("s"):
                    la, lb = date_label(r["at"]), date_label(pr["at"])
                    it = {"k": "sr", "l": "יחס כושר פירעון, עם הוראות מעבר", "g": "ratio", "cmp": "prev", "la": la, "lb": lb, "a": a, "b": b,
                          "d": diff(a, b, la, lb, "pp"), "_w": 1.0, "z": None}
                    if card_text(card, r["cur"]) or card_text(prev_card, pr["cur"]):
                        it["tx"] = 1
                    out.append(it)
        return out

    def t0_items(self, card, P):
        """the T+0 skeleton: what the XBRL tags give before the statements are extracted (unverified)"""
        out = []
        yl = per_label(card["cmp"]["y"])
        for r in card.get("rows") or []:
            if not r.get("yoy"):
                continue
            a, b = card_fig(card, r["cur"]), card_fig(card, r["yoy"])
            if a and b:
                out.append({"k": r["k"], "l": r["l"], "g": "xbrl", "cmp": "YoY", "la": per_label(P), "lb": yl, "a": a, "b": b,
                            "d": diff(a, b, per_label(P), yl, "dm"), "_w": 1.0, "z": None})
        return out

    # ranking ------------------------------------------------------------------------------------------------------
    def rank(self, items, eq_v):
        keep = []
        for it in items:
            d = it["d"]["v"]
            if it["d"]["u"] == "pp":
                impact = abs(d) * MAT["pp_to_eq"]
            else:
                if abs(d) < MAT["min_abs_m"] or not eq_v or eq_v <= 0:
                    continue
                impact = abs(d) / eq_v * 100
            score = impact * it.pop("_w")
            if score < MAT["min_score"]:
                continue
            it["sc"] = round(score, 3)
            keep.append(it)
        keep.sort(key=lambda x: (-x["sc"], x["l"], x["k"]))
        return keep[:TOP], len(keep)

    def report(self, P, card, prev_card):
        end = bc.end_of(P)
        unverified = card is not None and card.get("st") == "unverified"
        if unverified:
            items = self.t0_items(card, P)
            eqf = card_fig(card, "eq.c")
            eq_v = eqf["v"] if eqf else None
            eq_fig = eqf
        else:
            items, eq = self.statement_items(P, end)
            if card:
                items += self.card_items(card, P, end, prev_card)
            eq_v = eq["v"] if eq else None
            eq_fig = pg_fig(eq["v"], "m", eq["rid"], eq["pg"]) if eq else None
        top, n = self.rank(items, eq_v)
        for it in top:
            w = self.why.get(f"{self.c}/{P}/{it['k']}")
            if w and w.get("t") and isinstance(w.get("rid"), int) and isinstance(w.get("pg"), int):
                it["why"] = {"t": w["t"], "s": {"k": "pg", "rid": w["rid"], "pg": w["pg"]}}
            it["pl"] = f"{it['la']} · {it['cmp']}" if it["cmp"] != "prev" else f"{it['la']} מול {it['lb']}"
            it["gd"] = good(it)
        doc = (card or {}).get("doc") or {}
        rid = doc.get("rid")
        if not rid:  # no document list for the company: the report the YoY figures were read from (the new report prints both columns)
            rids = sorted(it["a"]["s"]["rid"] for it in items if it["cmp"] == "YoY" and it["g"] == "pl" and it["a"]["s"].get("k") == "pg")
            rid = max(set(rids), key=lambda r: (rids.count(r), r)) if rids else None
        meta = self.docs.get(rid) if rid else None
        return {"p": P, "end": end, "st": "unverified" if unverified else "verified", "rid": rid,
                "pub": (meta or {}).get("date") or doc.get("pub"), "pages": (meta or {}).get("pages") or doc.get("pages"),
                "eq": eq_fig, "cand": n, "n": len(top), "items": top}


# ---------------------------------------------------------------------------------------------------------------- build
def load_docs():
    sd = json.loads((DATA / "search" / "docs.json").read_text(encoding="utf-8"))
    cols = sd["cols"]
    out = {}
    for r in sd["docs"]:
        x = dict(zip(cols, r))
        out[x["id"]] = {"date": x["date"], "pages": x["pages"], "url": x["url"], "type": x["type"], "period": x["period"]}
    return out


def pkey(p):
    return (p[:4], p[4:].replace("FY", "Q4"))


def build(only=None):
    reg = {c["id"]: c for c in json.loads((DATA / "companies" / "index.json").read_text(encoding="utf-8"))}
    cards_ix = json.loads((DATA / "cards" / "index.json").read_text(encoding="utf-8"))["co"]
    docs = load_docs()
    why = json.loads(WHY.read_text(encoding="utf-8")) if WHY.exists() else {}
    why = {k: v for k, v in why.items() if not k.startswith("$")}
    files, index = {}, {}
    for c in sorted(cards_ix):
        if only and c not in only:
            continue
        e = reg.get(c)
        if not e or not (DATA / "companies" / f"{c}.json").exists():
            continue
        kind = "fund" if e["kind"] == "fund_house" else "ins"
        eng = Engine(c, e["name_he"], kind, bc.Book(c), docs, why)
        periods = sorted([p for p in cards_ix[c]["p"] if pkey(p) >= pkey(FROM)], key=pkey)
        reps = []
        for i, P in enumerate(periods):
            card = load_card(c, P)
            prev = load_card(c, periods[i - 1]) if i else load_card(c, bc.key_of(bc.qshift(bc.end_of(P), -1)))
            reps.append(eng.report(P, card, prev))
        reps.sort(key=lambda r: pkey(r["p"]), reverse=True)
        used = sorted({x["s"]["rid"] for r in reps for it in r["items"] for x in figs_of(it) if x["s"].get("k") == "pg"} | {r["rid"] for r in reps if r["rid"]})
        files[c] = {"v": 1, "c": c, "name": e["name_he"], "kind": kind, "rule": rule_text(),
                    "docs": {str(r): [docs[r]["type"], docs[r]["period"], docs[r]["date"], docs[r]["url"], docs[r]["pages"]] for r in used if r in docs},
                    "reports": reps}
        if reps:
            x = reps[0]
            index[c] = {"name": e["name_he"], "p": x["p"], "pub": x["pub"], "n": x["n"], "st": x["st"], "rid": x["rid"],
                        "top": x["items"][0]["l"] if x["items"] else None, "ps": [r["p"] for r in reps]}
    return files, {"v": 1, "built": dt.date.today().isoformat(), "rule": rule_text(), "mat": MAT, "co": index}


def figs_of(it):
    """every printed figure of an item, inputs of computed ones included"""
    out = []

    def walk(f):
        if not f:
            return
        if f["s"].get("k") == "calc":
            for x in f["s"]["in"]:
                walk(x)
        else:
            out.append(f)
    for k in ("a", "b", "rest"):
        walk(it.get(k))
    if it.get("why"):
        out.append({"v": None, "s": it["why"]["s"]})
    return out


def rule_text():
    return ("ציון = |שינוי| ÷ הון לבעלי המניות בתחילת החלון × 100 (שורות יחס: נק׳ × 0.2) × משקל תנודתיות: |שינוי| ÷ RMS של 8 השינויים הקודמים "
            "מאותו סוג, חלקי 2, בין 0.5 ל-2 (שורות ברוטו × 0.5); נכנס מ-0.5 ומעלה; 10 הגבוהים")


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def write(files, index):
    OUT.mkdir(parents=True, exist_ok=True)
    keep = {f"{c}.json" for c in files} | {"index.json"}
    for f in OUT.glob("*.json"):
        if f.name not in keep:
            f.unlink()
    for c, d in files.items():
        (OUT / f"{c}.json").write_text(dumps(d), encoding="utf-8")
    (OUT / "index.json").write_text(dumps(index), encoding="utf-8")


def check():
    """rebuild in memory and compare; every printed figure must be a published (report, page, value)"""
    import check_feed
    probs = []
    files, index = build()
    for c, d in files.items():
        p = OUT / f"{c}.json"
        if not p.exists() or p.read_text(encoding="utf-8") != dumps(d):
            probs.append(f"{c}: changes/{c}.json differs from a rebuild")
    old = json.loads((OUT / "index.json").read_text(encoding="utf-8")) if (OUT / "index.json").exists() else {}
    if {k: v for k, v in old.items() if k != "built"} != json.loads(dumps({k: v for k, v in index.items() if k != "built"})):
        probs.append("changes/index.json differs from a rebuild")
    ix = check_feed.printed_index()
    n = 0
    for c, d in files.items():
        for r in d["reports"]:
            if len(r["items"]) > TOP:
                probs.append(f"{c} {r['p']}: {len(r['items'])} items")
            for it in r["items"]:
                if abs(it["d"]["v"] - (it["a"]["v"] - it["b"]["v"])) > 1e-5:
                    probs.append(f"{c} {r['p']} {it['k']}: change does not re-compute")
                for f in figs_of(it):
                    n += 1
                    s = f["s"]
                    if s.get("k") == "pg" and f["v"] is not None and check_feed.key(s["rid"], s["pg"], f["v"]) not in ix:
                        probs.append(f"{c} {r['p']} {it['k']}: {f['v']} not printed on report {s['rid']} page {s['pg']}")
                    if s.get("k") == "pg" and str(s["rid"]) not in d["docs"]:
                        probs.append(f"{c} {r['p']} {it['k']}: report {s['rid']} not in docs")
    for p in probs[:20]:
        print("FAIL", p)
    print(f"changes: {sum(len(d['reports']) for d in files.values())} reports, {n} figures, {len(probs)} problems")
    return probs


def show(c, P=None):
    files, _ = build({c})
    d = files.get(c)
    if not d:
        sys.exit(f"{c}: no changes")
    r = next((x for x in d["reports"] if x["p"] == P), None) if P else d["reports"][0]
    if not r:
        sys.exit(f"{c} {P}: no report")
    print(f"{d['name']} {per_label(r['p'])} · {r['n']} שינויים (מתוך {r['cand']} מעל הסף) · הון {r['eq']['v'] if r['eq'] else '–'} · {r['st']}")
    for i, it in enumerate(r["items"], 1):
        a, b, dd = it["a"], it["b"], it["d"]
        dp = f" ({it['dp']['v']:+.1f}%)" if it.get("dp") else ""
        rs = f" [הוצג מחדש; במקור {it['rest']['v']:,.1f} עמ׳ {it['rest']['s']['pg']} דוח {it['rest']['s']['rid']}]" if it.get("rest") else ""
        src = lambda f: f"{f['s'].get('rid')}/{f['s'].get('pg')}" if f["s"].get("k") == "pg" else f["s"].get("k")
        print(f"{i:2d}. {it['l'][:48]:48s} {it['pl']:22s} {b['v']:>10,.1f} → {a['v']:>10,.1f}  Δ {dd['v']:+,.1f}{dp}  sc {it['sc']:.2f} z {it['z']}  [{src(a)} | {src(b)}]{rs}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--show", nargs="+")
    a = ap.parse_args()
    if a.check:
        sys.exit(1 if check() else 0)
    if a.show:
        return show(a.show[0], a.show[1] if len(a.show) > 1 else None)
    files, index = build()
    write(files, index)
    n = sum(len(d["reports"]) for d in files.values())
    size = sum(f.stat().st_size for f in OUT.glob("*.json"))
    print(f"changes: {n} reports for {len(files)} companies, {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
