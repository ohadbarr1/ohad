"""The delta feed (module M2): every dated change the published data already carries, one list: web/public/data/feed.json

python3 pipeline/build_feed.py          (standard library only; reads published files only, writes one JSON)
python3 pipeline/check_feed.py          the feed's QA (gate check `feed`): source, date, no duplicates, every figure re-read

Nothing is extracted, estimated or inferred here: each event is a change between two figures the site already publishes, with the
source of both. Event types (`t`):
  filing   a financial report on MAYA (Hebrew, quarterly or annual), with its headline lines against the prior quarter: profit and
           comprehensive income attributable to shareholders and insurance service result (Report Day roles, pipeline/reportday.py;
           an annual report's quarter is Q4 = FY − 9M, flagged derived), shareholders' equity (balance at the quarter end), CSM closing
           balance and the solvency ratio as the report card shows them (cards/<id>/<period>.json, the same resolution every page uses)
  restate  a report that printed earlier periods with another value (restatements.json, value changes only, not sign flips),
           with the count, the count at 2% or more, and the three largest changes in NIS
  regmonth a month of the regulator's fund data (market.json): assets and net flow incl. transfers, pension and gemel, against
           the prior month, and the flow crossings of that month
  flow     a manager's net flow incl. transfers, LTM, in one product line, crossing zero (inflow -> outflow or back); both
           months at least 20 NIS m in absolute value, so a line hovering at zero does not flicker
  target   a management target scored met / partial / missed (targets.json: build_targets.py scores it once its year is reported)
  solv     a new solvency ratio date disclosed in a financial report (the report card's ratio, printed), against the previous
           disclosed date; from the dedicated solvency reports (csm/solvency.json) where a report's ratio date is not yet known,
           and derived (own funds ÷ SCR) where such a report prints the two but not the ratio
  fee      a track's average management fee moving by 0.05 points or more month on month (funds/<k>.json), on tracks of NIS 1bn
           or more; months where the regulator's fee series breaks for the product (market.json `breaks`) are skipped
  est      estimate revision / estimate vs actual: a typed, empty slot (module M1 fills it); no event is emitted

Event: {id, t, d, dk, c, per, h, src, rows?, refs?, to}
  d    ISO date of the event; dk says what the date is: pub (the document's publication day on MAYA), fetched (the day fox received
       the regulator's file: the latest month only), month (the last day of the data month: the regulator's release day of older
       months is not recorded anywhere in the pipeline)
  src  the event's document: {k: doc, rid, pg?} (a MAYA filing in `docs`) · {k: reg, ym} (the regulator's month) · {k: fund, ds, id, ym}
  rows [{l, ab?, a, b?, d?, dp?, rng?, note?}]: a figure is {v, u, s}; u: m (NIS m) · bn (NIS bn) · pct (%) · pp (points) · dm (NIS m,
       signed) · dbn (NIS bn, signed) · dpct (%, signed) · n (count); s is its source:
         {k: pg, rid, pg, der?}                                        printed on a page of a filing in `docs` (der 1: a flow differenced
                                                                       from cumulative periods, Q4 = FY − 9M; der 2: a balance built from printed parts)
         {k: reg, metric, ym, pi, w, set, g}                           an aggregate of the regulator's tracks (lib/market.ts arithmetic)
         {k: fund, ds, id, ym, col}                                    one track's published figure
         {k: calc, fx, in: [{l, v, u, s}]}                             computed here from the listed inputs
         {k: count, fx}                                                a count over a published file
"""
import collections
import datetime as dt
import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reportday as rd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "feed.json"
FILES = "https://mayafiles.tase.co.il/"
FROM = "2025-01-01"          # the IFRS 17 era: the first season whose reports compare like with like
FROM_YM = 202501
FLOW_MIN = 0.02              # NIS bn: both months of a crossing at least this far from zero
FEE_MIN = 0.05               # points of the average annual fee
FEE_ASSETS = 1000.0          # NIS m
BIG = 2.0                    # % of the first print: the restatement materiality line (Report Day, restatements.json)
DOC_HE = {"annual": "דוח שנתי", "quarterly": "דוח רבעוני", "presentation": "מצגת", "solvency": "דוח כושר פירעון"}
DS = {"pension": "pensia", "gemel": "gemel", "insurance": "insurance"}
TK = {"pensia": "p", "gemel": "g", "insurance": "i"}
TYPES = {
    "filing": "דוח כספי חדש", "restate": "הצגה מחדש", "regmonth": "חודש נתוני רשות", "flow": "מעבר בצבירה נטו",
    "target": "יעד הנהלה הוכרע", "solv": "יחס כושר פירעון", "fee": "שינוי בדמי ניהול", "est": "עדכון אומדן / אומדן מול בפועל",
}


def load(p):
    return json.loads((DATA / p).read_text(encoding="utf-8"))


def per_label(pk):
    """2026Q2 -> Q2'26, 2025FY -> FY'25"""
    return f"FY'{pk[2:4]}" if pk.endswith("FY") else f"{pk[4:]}'{pk[2:4]}"


def ym_label(ym):
    return f"{ym % 100:02d}/{str(ym // 100)[2:]}"


def month_end(ym):
    y, m = divmod(ym, 100)
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - dt.timedelta(days=1)).isoformat()


def add_months(ym, k):
    t = (ym // 100) * 12 + ym % 100 - 1 + k
    return (t // 12) * 100 + t % 12 + 1


def r6(x):
    return None if x is None else round(x, 6)


def fig(v, u, s):
    return {"v": r6(v), "u": u, "s": s}


def inp(label, f):
    return {"l": label, "v": f["v"], "u": f["u"], "s": f["s"]}


def calc_diff(a, b, la, lb, u):
    return fig(a["v"] - b["v"], u, {"k": "calc", "fx": f"{la} − {lb}", "in": [inp(la, a), inp(lb, b)]})


def calc_pct(a, b, la, lb):
    """% change, only where both figures are positive and the change is below 500% (a ratio on a near-zero base says nothing)"""
    if not b["v"] or b["v"] <= 0 or a["v"] is None or a["v"] <= 0 or a["v"] / b["v"] >= 6:
        return None
    return fig((a["v"] / b["v"] - 1) * 100, "dpct", {"k": "calc", "fx": f"{la} ÷ {lb} − 1", "in": [inp(la, a), inp(lb, b)]})


class Docs:
    """The documents the feed cites: rid -> [company, type, period, publication date, path under FILES, pages]."""

    def __init__(self):
        sd = load("search/docs.json")
        cols = sd["cols"]
        self.reg = {}
        for r in sd["docs"]:
            x = dict(zip(cols, r))
            self.reg[x["id"]] = x
        self.used = {}

    def ref(self, rid, url=None, company=None):
        if rid is None:
            return None
        rid = int(rid)
        if rid not in self.used:
            x = self.reg.get(rid)
            if x:
                self.used[rid] = [x["company"], x["type"], x["period"], x["date"], x["url"], x["pages"]]
            elif url:
                self.used[rid] = [company or "", "", "", "", url[len(FILES):] if url.startswith(FILES) else url, None]
            else:
                return None
        return rid

    def date(self, rid):
        x = self.reg.get(int(rid)) if rid is not None else None
        return x["date"] if x else None


def pg(docs, rid, page, url=None, company=None, der=False):
    r = docs.ref(rid, url, company)
    if r is None:
        return None
    s = {"k": "pg", "rid": r, "pg": page}
    if der:
        s["der"] = der
    return s


# ---------------------------------------------------------------------------------------------------------------- filings
LINES = [("net", "רווח נקי לבעלי המניות", "Q"), ("comp", "רווח כולל לבעלי המניות", "Q"), ("isr", "רווח משירותי ביטוח", "Q"), ("eq", "הון לבעלי המניות", "I")]


def book_fig(book, docs, key, typ, end):
    h = book.headline(key, typ, end)
    if not h or h.get("rid") is None:
        return None, None
    pi = book.pidx.get((typ, end))
    url = None
    for row in book.resolve(rd.BY_KEY[key])[0] + (book.resolve(rd.BY_KEY[key], True)[0] if rd.BY_KEY[key]["alt"] else []):
        f = book.facts.get((row["mi"], pi))
        if f and f[2] is not None and rd.rid_of(book.urls[f[2]]) == h["rid"]:
            url = book.urls[f[2]]
            break
    s = pg(docs, h["rid"], h["pg"], url, book.ent, der=(2 if typ == "I" else 1) if h["der"] else 0)
    return (fig(h["v"], "m", s) if s else None), h


def filings(docs, books, cos):
    out = []
    for rid, x in docs.reg.items():
        if x["type"] not in ("quarterly", "annual") or x["en"] or not x["date"] or x["date"] < FROM or x["company"] not in cos:
            continue
        c, pk = x["company"], x["period"]
        qk = pk[:4] + "Q4" if pk.endswith("FY") else pk
        prev = rd.back(qk, 1)
        end, end0 = rd.end_of(qk), rd.end_of(prev)
        la, lb = qlabel(qk), qlabel(prev)
        rows = []
        book = books.get(c)
        if book:
            for key, label, typ in LINES:
                a, ha = book_fig(book, docs, key, typ, end)
                if not a:
                    continue
                b, hb = book_fig(book, docs, key, typ, end0)
                row = {"l": label, "ab": [la, lb], "a": a}
                if b:
                    row["b"] = b
                    if ha["std"] != hb["std"]:
                        row["note"] = f"{lb}: IFRS {hb['std']}, {la}: IFRS {ha['std']}; אין השוואה"
                    else:
                        row["d"] = calc_diff(a, b, la, lb, "dm")
                        p = calc_pct(a, b, la, lb)
                        if p:
                            row["dp"] = p
                if ha.get("alt"):
                    row["note"] = (row.get("note", "") + "; " if row.get("note") else "") + "שורת הרווח הכוללת (אין שורת ייחוס בדוח)"
                rows.append(row)
        card = card_of(c, pk)
        if card and (card.get("doc") or {}).get("rid") == rid:
            rows += card_rows(card, docs)
        ok = [r for r in rows if r.get("a")]
        out.append({"id": f"filing:{rid}", "t": "filing", "d": x["date"], "dk": "pub", "c": c, "per": pk,
                    "h": f"{DOC_HE[x['type']]} {per_label(pk)}", "src": {"k": "doc", "rid": docs.ref(rid)}, "rows": ok,
                    "to": f"/card/{c}/{pk}" if card else f"/company/{c}?p={pk}"})
    return out


def qlabel(qk):
    return f"{qk[4:]}'{qk[2:4]}"


_cards = {}


def card_of(c, pk):
    p = DATA / "cards" / c / f"{pk}.json"
    if (c, pk) not in _cards:
        _cards[(c, pk)] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    return _cards[(c, pk)]


def card_fig(card, docs, key):
    f = card["f"].get(key)
    if not f or f["s"].get("k") != "pg":
        return None
    url = card["u"][f["s"]["u"]] if f["s"].get("u") is not None else None
    s = pg(docs, rd.rid_of(url), f["s"].get("pg"), url, card["c"], der=2 if "der" in (f["s"].get("fl") or []) else 0)
    if not s:
        return None
    return fig(f["v"], "pct" if f["u"] == "pct" else "m", s)


def card_rows(card, docs):
    rows = []
    for r in card["rows"]:
        if r["k"] == "csm":
            a = card_fig(card, docs, r["cur"])
            if not a:
                continue
            la, lb = per_label(card["p"]).replace("FY'", "Q4'"), per_label(card["cmp"]["q"]).replace("FY'", "Q4'")
            row = {"l": f"CSM, יתרת סגירה ({r['basis']})" if r.get("basis") else "CSM, יתרת סגירה", "ab": [la, lb], "a": a}
            b = card_fig(card, docs, r["qoq"]) if r.get("qoq") else None
            if b:
                row["b"] = b
                row["d"] = calc_diff(a, b, la, lb, "dm")
                p = calc_pct(a, b, la, lb)
                if p:
                    row["dp"] = p
            rows.append(row)
        elif r["k"] == "sr":
            a = card_fig(card, docs, r["cur"])
            if a:
                rows.append({"l": f"{r['l']}, ליום", "ab": [date_q(r["at"])], "a": a})
    return rows


def date_q(d):
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}.get(d[5:10])
    return f"{q}'{d[2:4]}" if q else f"{d[8:10]}.{d[5:7]}.{d[2:4]}"


# ---------------------------------------------------------------------------------------------------------------- restatements
def restatements(docs, cos):
    R = load("restatements.json")
    cols = R["cols"]
    by = collections.defaultdict(list)
    for r in R["rows"]:
        x = dict(zip(cols, r))
        if x["k"] != 0 or x["d1"] is None or x["co"] not in cos:
            continue
        by[(x["co"], x["d1"])].append(x)
    out = []
    for (c, d1), xs in by.items():
        d = R["docs"].get(str(d1))
        date = d[3] if d else docs.date(d1)
        if not date or date < FROM:
            continue
        big = sum(1 for x in xs if x["v0"] == 0 or abs(x["v1"] - x["v0"]) / abs(x["v0"]) * 100 >= BIG)
        season = xs[0]["in"]
        money = [x for x in xs if x["u"] in ("k", "m")]
        money.sort(key=lambda x: -abs(x["v1"] - x["v0"]) / (1000 if x["u"] == "k" else 1))
        rows = [{"l": "נתונים שהוצגו מחדש", "a": fig(len(xs), "n", {"k": "count", "fx": f"שורות ביומן ההצגות מחדש (restatements.json) שהדוח הדפיס בערך אחר מההדפסה הראשונה, שינוי ערך בלבד"})},
                {"l": "מהם בשינוי של 2% ומעלה", "a": fig(big, "n", {"k": "count", "fx": "|הדפסה אחרונה − הדפסה ראשונה| ÷ |הדפסה ראשונה| ≥ 2%"})}]
        for x in money[:3]:
            k = 1000 if x["u"] == "k" else 1
            per = rd_period(x["pt"], x["pe"])
            a = fig(x["v0"] / k, "m", pg(docs, x["d0"], x["p0"], FILES + R["docs"][str(x["d0"])][4] if str(x["d0"]) in R["docs"] else None, c))
            b = fig(x["v1"] / k, "m", pg(docs, x["d1"], x["p1"], FILES + d[4] if d else None, c))
            if not a["s"] or not b["s"]:
                continue
            row = {"l": f"{x['line']}{' · ' + x['sub'] if x['sub'] else ''} · {per}", "ab": ["לראשונה", "מחדש"], "a": a, "b": b,
                   "d": calc_diff(b, a, "כפי שהוצג מחדש", "כפי שדווח לראשונה", "dm")}
            p = calc_pct(b, a, "כפי שהוצג מחדש", "כפי שדווח לראשונה") if a["v"] and a["v"] > 0 else None
            if p:
                row["dp"] = p
            rows.append(row)
        out.append({"id": f"restate:{c}:{d1}", "t": "restate", "d": date, "dk": "pub", "c": c, "per": season,
                    "h": f"{DOC_HE.get(d[1], 'דוח') if d else 'דוח'} {per_label(season)} הציג מחדש תקופות קודמות",
                    "src": {"k": "doc", "rid": docs.ref(d1, FILES + d[4] if d else None, c)}, "rows": rows,
                    "to": f"/restatements?co={c}&season={season}"})
    return out


def rd_period(t, end):
    y, m = end[2:4], int(end[5:7])
    if t == "FY":
        return f"FY'{y}"
    if t == "H":
        return f"H1'{y}" if m == 6 else f"H2'{y}"
    if t == "9M":
        return f"9M'{y}"
    if t == "Q":
        return f"Q{(m + 2) // 3}'{y}"
    return date_q(end)


# ---------------------------------------------------------------------------------------------------------------- regulator
class Reg:
    """market.json aggregated the way lib/market.ts does it (Market.cell / flows / value), for the months the feed needs."""

    def __init__(self):
        m = self.m = load("market.json")
        self.P = m["periods"]
        self.G = m["groups"]
        self.prods = m["products"]
        self.ins = [p["family"] == "insurance" for p in self.prods]
        lo = self.P.index(add_months(FROM_YM, -13)) if add_months(FROM_YM, -13) in self.P else 0
        self.cells = collections.defaultdict(lambda: [0.0] * 6)  # a, af, dep, wd, tr, fa
        for r in m["rows"]:
            if r[0] < lo:
                continue
            pr = self.prods[r[1]]
            for s in ("all", "fam:" + pr["family"], "p:" + pr["key"]):
                for g in (r[2], -1):
                    c = self.cells[(r[0], s, g)]
                    c[0] += r[3]
                    if not self.ins[r[1]]:
                        c[1] += r[3]
                    c[2] += r[4]
                    c[3] += r[5]
                    c[4] += r[6]
                    c[5] += r[7]
        self.lo = lo
        self.fetched = m["meta"].get("fetched")

    def assets(self, pi, s, g):
        c = self.cells.get((pi, s, g))
        return c[0] / 1000 if c else None

    def netflow(self, pi, w, s, g):
        n = {"m": 1, "q": 3, "ltm": 12}[w]
        if pi - n + 1 < self.lo:
            return None
        org = tr = 0.0
        for i in range(pi - n + 1, pi + 1):
            c = self.cells.get((i, s, g))
            if not c or not c[1] > 0 or c[5] < 0.98 * c[1]:
                return None
            org += c[2] - c[3]
            tr += c[4]
        return (org + tr) / 1000

    def src(self, metric, pi, w, s, g):
        return {"k": "reg", "metric": metric, "ym": self.P[pi], "pi": pi, "w": w, "set": s, "g": g}

    def when(self, pi):
        """the event date of a data month: the fetch day for the latest month, else the month's last day (the release day is not kept)"""
        if pi == len(self.P) - 1 and self.fetched:
            return self.fetched, "fetched"
        return month_end(self.P[pi]), "month"


def regulator(reg, slug):
    out_m, out_f = [], []
    P = reg.P
    start = P.index(FROM_YM)
    flow_sets = [("p:" + p["key"], p["label"]) for p in reg.prods if p["family"] != "insurance"]
    crossings = collections.defaultdict(list)
    for s, label in flow_sets:
        for g, name in enumerate(reg.G):
            c = slug.get(name)
            if not c:
                continue
            for pi in range(start, len(P)):
                a, b = reg.netflow(pi, "ltm", s, g), reg.netflow(pi - 1, "ltm", s, g)
                if a is None or b is None or (a > 0) == (b > 0) or abs(a) < FLOW_MIN or abs(b) < FLOW_MIN:
                    continue
                d, dk = reg.when(pi)
                la, lb = ym_label(P[pi]), ym_label(P[pi - 1])
                fa = fig(a, "bn", reg.src("netflow", pi, "ltm", s, g))
                fb = fig(b, "bn", reg.src("netflow", pi - 1, "ltm", s, g))
                eid = f"flow:{P[pi]}:{s}:{c}"
                crossings[pi].append(eid)
                out_f.append({"id": eid, "t": "flow", "d": d, "dk": dk, "c": c, "per": str(P[pi]),
                              "h": f"{label}: {'מצבירה חיובית לשלילית' if a < 0 else 'מצבירה שלילית לחיובית'}, LTM",
                              "src": {"k": "reg", "ym": P[pi]},
                              "rows": [{"l": "צבירה נטו כולל ניוד, LTM", "ab": [la, lb], "a": fa, "b": fb, "d": calc_diff(fa, fb, la, lb, "dbn")}],
                              "to": f"/savings?g={urllib.parse.quote(name)}"})
    for pi in range(start, len(P)):
        d, dk = reg.when(pi)
        la, lb = ym_label(P[pi]), ym_label(P[pi - 1])
        rows = []
        a0, b0 = reg.assets(pi, "all", -1), reg.assets(pi - 1, "all", -1)
        if a0 is not None and b0 is not None:
            fa, fb = fig(a0, "bn", reg.src("assets", pi, "m", "all", -1)), fig(b0, "bn", reg.src("assets", pi - 1, "m", "all", -1))
            row = {"l": "נכסים מנוהלים, כל המוצרים", "ab": [la, lb], "a": fa, "b": fb, "d": calc_diff(fa, fb, la, lb, "dbn")}
            p = calc_pct(fa, fb, la, lb)
            if p:
                row["dp"] = p
            rows.append(row)
        for s, label in (("fam:pension", "פנסיה"), ("fam:gemel", "גמל והשתלמות")):
            a, b = reg.netflow(pi, "m", s, -1), reg.netflow(pi - 1, "m", s, -1)
            if a is None:
                continue
            fa = fig(a, "bn", reg.src("netflow", pi, "m", s, -1))
            row = {"l": f"צבירה נטו כולל ניוד, {label}", "ab": [la, lb], "a": fa}
            if b is not None:
                fb = fig(b, "bn", reg.src("netflow", pi - 1, "m", s, -1))
                row["b"] = fb
                row["d"] = calc_diff(fa, fb, la, lb, "dbn")
            rows.append(row)
        ev = {"id": f"regmonth:{P[pi]}", "t": "regmonth", "d": d, "dk": dk, "c": "market", "per": str(P[pi]),
              "h": f"נתוני {ym_label(P[pi])}: גמל-נט, פנסיה-נט, ביטוח-נט", "src": {"k": "reg", "ym": P[pi]}, "rows": rows, "to": "/savings"}
        if crossings.get(pi):
            ev["refs"] = crossings[pi]
        out_m.append(ev)
    return out_m, out_f


def fees(reg, slug):
    out = []
    breaks = collections.defaultdict(set)  # (family, yyyymm) -> products whose fee series breaks that month
    for b in reg.m.get("breaks") or []:
        if "fee" in b["metric"]:
            breaks[(b["family"], int(b["from"]))].update(b.get("products") or [])
    pidx = {p: i for i, p in enumerate(reg.P)}
    for f in reg.m["funds"]:
        c = slug.get(f["grp"])
        if not c:
            continue
        ds = DS[f["fam"]]
        k = TK[ds] + str(f["id"])
        p = DATA / "funds" / f"{k}.json"
        if not p.exists():
            continue
        h = json.loads(p.read_text(encoding="utf-8"))
        for i in range(1, len(h["p"])):
            ym, ym0 = h["p"][i], h["p"][i - 1]
            if ym < FROM_YM or ym0 != add_months(ym, -1):
                continue
            a, b, A = h["fee"][i], h["fee"][i - 1], h["a"][i]
            if a is None or b is None or A is None or A < FEE_ASSETS or abs(a - b) < FEE_MIN - 1e-9:
                continue
            if f["prod"] in breaks.get((f["fam"], ym), ()):
                continue
            la, lb = ym_label(ym), ym_label(ym0)
            fa = fig(a, "pct", {"k": "fund", "ds": ds, "id": f["id"], "ym": ym, "col": "AVG_ANNUAL_MANAGEMENT_FEE"})
            fb = fig(b, "pct", {"k": "fund", "ds": ds, "id": f["id"], "ym": ym0, "col": "AVG_ANNUAL_MANAGEMENT_FEE"})
            d, dk = reg.when(pidx[ym]) if ym in pidx else (month_end(ym), "month")
            out.append({"id": f"fee:{k}:{ym}", "t": "fee", "d": d, "dk": dk, "c": c, "per": str(ym), "h": f["name"],
                        "src": {"k": "fund", "ds": ds, "id": f["id"], "ym": ym},
                        "rows": [{"l": "דמי ניהול ממוצעים מהנכסים", "ab": [la, lb], "a": fa, "b": fb, "d": calc_diff(fa, fb, la, lb, "pp")},
                                 {"l": "נכסי המסלול", "ab": [la], "a": fig(A, "m", {"k": "fund", "ds": ds, "id": f["id"], "ym": ym, "col": "TOTAL_ASSETS"})}],
                        "to": f"/funds/{k}"})
    return out


# ---------------------------------------------------------------------------------------------------------------- targets
ST_HE = {"met": "הושג", "partial": "חלקית", "missed": "לא הושג"}


def targets(docs, cos):
    T = load("targets.json")
    out = []
    for t in T["rows"]:
        if t.get("st") not in ST_HE or not t.get("act") or t["c"] not in cos:
            continue
        act = t["act"]
        ins = []
        for x in act.get("in") or []:
            label, v, url, page, perl = x[0], x[1], x[2], x[3], x[4]
            s = pg(docs, rd.rid_of(url), page, url, t["c"])
            if s and v is not None:
                ins.append((label, fig(v, t["u"] if t["u"] in ("pct", "m") else "m", s), docs.date(rd.rid_of(url))))
        if not ins:
            continue
        dates = [x[2] for x in ins if x[2]]
        if not dates:
            continue
        date = max(dates)
        if date < FROM:
            continue
        u = "pct" if t["u"] == "pct" else "m"
        tsrc = pg(docs, t["doc"], t["pg"], FILES + T["docs"][str(t["doc"])][4] if str(t["doc"]) in T["docs"] else None, t["c"])
        rows = []
        if tsrc:
            if t.get("lo") is not None and t.get("hi") is not None:
                rows.append({"l": "יעד, טווח", "rng": 1, "a": fig(t["lo"], u, tsrc), "b": fig(t["hi"], u, tsrc)})
            elif t.get("v") is not None:
                rows.append({"l": "יעד", "a": fig(t["v"], u, tsrc)})
        if len(ins) == 1:
            af = ins[0][1]
        else:
            af = fig(act["v"], u, {"k": "calc", "fx": act["f"], "in": [inp(l, f) for l, f, _ in ins]})
        rows.append({"l": f"בפועל, FY'{str(act['y'])[2:]}", "a": af, "note": act["f"] if len(ins) == 1 else None})
        if rows[-1]["note"] is None:
            del rows[-1]["note"]
        out.append({"id": f"target:{t['c']}:{t['m']}:{t.get('seg')}:{t.get('h') or act['y']}", "t": "target", "d": date, "dk": "pub", "c": t["c"],
                    "per": f"{act['y']}FY", "h": f"{t['l']} ({t['e']}): {ST_HE[t['st']]}", "st": t["st"],
                    "src": {"k": "doc", "rid": ins[[x[2] for x in ins].index(date)][1]["s"]["rid"]}, "rows": rows,
                    "to": f"/credibility?co={t['c']}&v=scored"})
    return out


# ---------------------------------------------------------------------------------------------------------------- solvency
def solvency(docs, cos):
    out, seen = [], {}
    idx = load("cards/index.json")["co"]
    for c, v in idx.items():
        if c not in cos:
            continue
        cards = [card_of(c, p) for p in v["p"]]
        cards = sorted((x for x in cards if x and x.get("doc")), key=lambda x: (x["doc"]["pub"], x["doc"]["rid"]))
        last = None  # (as-of date, figure, label)
        for card in cards:
            r = next((x for x in card["rows"] if x["k"] == "sr"), None)
            if not r:
                continue
            a = card_fig(card, docs, r["cur"])
            if not a:
                continue
            at = r["at"]
            if last and at <= last[0]:
                continue
            if card["doc"]["pub"] >= FROM:
                la = date_q(at)
                row = {"l": r["l"], "ab": [la], "a": a}
                if last:
                    lb = date_q(last[0])
                    row["ab"].append(lb)
                    row["b"] = last[1]
                    if last[2] == r["l"]:
                        row["d"] = calc_diff(a, last[1], la, lb, "pp")
                    else:
                        row["note"] = f"{lb}: {last[2]}; אין השוואה"
                eid = f"solv:{c}:{at}"
                seen[(c, at)] = card["doc"]["pub"]
                out.append({"id": eid, "t": "solv", "d": card["doc"]["pub"], "dk": "pub", "c": c, "per": at,
                            "h": f"יחס כושר פירעון ליום {la}, {DOC_HE.get(docs.reg.get(card['doc']['rid'], {}).get('type'), 'דוח')} {per_label(card['p'])}",
                            "src": {"k": "doc", "rid": a["s"]["rid"], "pg": a["s"]["pg"]}, "rows": [row], "to": f"/card/{c}/{card['p']}"})
            last = (at, a, r["l"])
    # the dedicated solvency reports: a ratio date no financial report has disclosed yet, and derived ratios (own funds ÷ SCR)
    S = load("csm/solvency.json")
    for c, by in S["companies"].items():
        if c not in cos:
            continue
        for at in sorted(by):
            e = by[at]
            cand = [x for x in ("sr_w", "sr_wo", "of_w", "scr_w") if x in e and isinstance(e[x], dict)]
            if not cand:
                continue
            rid = e[cand[0]].get("r")
            rep = S["reports"].get(str(rid)) or {}
            pub = rep.get("pub")
            if not pub or pub < FROM or ((c, at) in seen and seen[(c, at)] <= pub):
                continue
            url = FILES + rep["f"] if rep.get("f") else None
            rows = []
            for key, of, scr, label in (("sr_w", "of_w", "scr_w", "יחס כושר פירעון, עם הוראות מעבר"), ("sr_wo", "of_wo", "scr_wo", "יחס כושר פירעון, ללא הוראות מעבר")):
                if key in e:
                    s = pg(docs, e[key]["r"], e[key]["pg"], FILES + S["reports"][str(e[key]["r"])]["f"] if str(e[key]["r"]) in S["reports"] else url, c)
                    if s:
                        rows.append({"l": label, "ab": [date_q(at)], "a": fig(e[key]["v"], "pct", s)})
                elif of in e and scr in e and e[scr]["v"]:
                    fo = fig(e[of]["v"], "m", pg(docs, e[of]["r"], e[of]["pg"], url, c))
                    fs = fig(e[scr]["v"], "m", pg(docs, e[scr]["r"], e[scr]["pg"], url, c))
                    if fo["s"] and fs["s"]:
                        rows.append({"l": f"{label} (נגזר)", "ab": [date_q(at)], "note": "היחס לא הודפס; הון עצמי לעניין כושר פירעון ÷ הון נדרש",
                                     "a": fig(e[of]["v"] / e[scr]["v"] * 100, "pct", {"k": "calc", "fx": "הון עצמי ÷ הון נדרש לכושר פירעון × 100", "in": [inp("הון עצמי לעניין כושר פירעון", fo), inp("הון נדרש לכושר פירעון (SCR)", fs)]})})
            if not rows:
                continue
            seen[(c, at)] = pub
            out = [x for x in out if x["id"] != f"solv:{c}:{at}"]
            out.append({"id": f"solv:{c}:{at}", "t": "solv", "d": pub, "dk": "pub", "c": c, "per": at,
                        "h": f"יחס כושר פירעון ליום {date_q(at)}, דוח כושר פירעון ({rep.get('e', '')})",
                        "src": {"k": "doc", "rid": docs.ref(rid, url, c)}, "rows": rows, "to": "/industry/csm?view=capital"})
    return out


# ---------------------------------------------------------------------------------------------------------------- main
def main():
    reg_co = load("companies/index.json")
    cos = {c["id"]: c["name_he"] for c in reg_co}
    slug = {}
    for c in reg_co:  # a market group belongs to the holding (מור), not to a subsidiary that shares it (more_gemel)
        g = c.get("market_group")
        if g and (g not in slug or "_" in slug[g]):
            slug[g] = c["id"]
    docs = Docs()
    books = rd.books()
    reg = Reg()
    ev = []
    ev += filings(docs, books, cos)
    ev += restatements(docs, cos)
    m, f = regulator(reg, slug)
    ev += m + f
    ev += fees(reg, slug)
    ev += targets(docs, cos)
    ev += solvency(docs, cos)
    order = {t: i for i, t in enumerate(TYPES)}
    ev.sort(key=lambda e: (e["d"], -order[e["t"]], e["id"]), reverse=True)
    counts = collections.Counter(e["t"] for e in ev)
    out = {
        "v": 1, "built": dt.date.today().isoformat(), "from": FROM, "files": FILES,
        "source": "MAYA (דוחות כספיים, דוחות כושר פירעון, מצגות) ורשות שוק ההון (גמל-נט, פנסיה-נט, ביטוח-נט), כפי שהם מפורסמים באתר",
        "types": {t: {"he": he, "n": counts.get(t, 0), **({"slot": 1} if t == "est" else {})} for t, he in TYPES.items()},
        "rules": {"flow_min_bn": FLOW_MIN, "fee_min_pp": FEE_MIN, "fee_assets_m": FEE_ASSETS, "restate_big_pct": BIG},
        "cos": {**{"market": "השוק"}, **cos},
        "groups": reg.G,
        "docs": {str(k): v for k, v in sorted(docs.used.items())},
        "events": ev,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"feed.json: {len(ev)} events from {FROM}: " + ", ".join(f"{t} {counts.get(t, 0)}" for t in TYPES) + f"; {len(docs.used)} documents cited")


if __name__ == "__main__":
    main()
