"""Sector restatement log: every figure a later filing re-printed with another value, across insurers and fund houses.

Output: web/public/data/restatements.json

Inputs are the site's own published outputs, so the log never disagrees with the company pages:
  facts/<id>.json       the fact table with vintage (build_facts.py): every print of every cell of the primary statements (balance
                        sheet, P&L, comprehensive income, cash flows) with its report and page; the pair is the first print against
                        the latest print of the cell (docs/FACTS.md, migration step 2: formerly the workbooks' `restated` lists)
  ifrs_<period>.json    IFRS 17 note facts per report (build_ifrs.py): the same fact (company, metric, segment, basis, window, date)
                        printed by two reports with two values; a fact counts only where each report prints it once, from a table
  search/docs.json      the document registry: MAYA report id -> type, period, publication date (the reader opens /doc/<id>?page=N)

Rules
  rounding     a pair that differs by no more than the rounding of the two prints is not a restatement: a figure printed in NIS
               millions is stored as a multiple of 1,000 (thousands); tolerance = half of each print's step plus half the finer step
               (the rule build_workbook.py uses for flag 8)
  sign         the same size with the opposite sign is a change of presentation (kind 1), kept apart from value changes (kind 0)
  plausible    statements pairs: as build_workbook.py keeps them (same sign, within a factor of two, or a pure sign change);
               note facts: same sign and within a factor of two (a wider gap is a different line, not a restatement)
  season       the report that printed the restated figure (the latest print): 2026Q2, 2025FY ...
  net effect   per season, the restatement of the bottom line (profit for the period) per company, one period type per company
               (FY if restated, else H, else the quarters, which do not overlap), summed; every input is listed

python3 pipeline/build_restatements.py           build
python3 pipeline/build_restatements.py --check   rebuild in memory, compare with the file on disk (exit 1 on any difference)
"""
import collections
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "restatements.json"
STMT = {"X.מאזן": "bs", "X.רווח_והפסד": "pl", "X.רווח_כולל": "oci", "X.תזרים_מזומנים": "cf", "X.שינויים_בהון": "eq"}
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]
Q_OF = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}
REPORTS = ["2025Q1", "2025Q2", "2025Q3", "2025FY", "2026Q1", "2026Q2"]  # ifrs_<period>.json, oldest first
RATIO = re.compile(r"ratio|_pct|roe|payout|yield|rate")
PROFIT = ["סך הכל רווח נקי", "רווח לתקופה", "רווח נקי", "רווח נקי (הפסד)", "רווח (הפסד) לתקופה", "רווח (הפסד) נקי", "רווח לשנה", "רווח (הפסד) לשנה", "רווח (הפסד) לתקופה המיוחס לבעלי המניות של החברה", "הפסד נקי לתקופה"]
BASIS_HE = {"net": "בשייר", "gross": "ברוטו", "reinsurance": "ביטוח משנה"}


def dict_of(path, name):
    """A Record<string, string> of a .ts file, read the way build_registry.py reads labels.ts."""
    src = (ROOT / path).read_text(encoding="utf-8")
    if name not in src:
        return {}
    block = src.split(name, 1)[1].split("};", 1)[0]
    return {m.group(1) or m.group(2): m.group(3) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z0-9_+:.\-]+)):\s*'([^']*)'", block)}


METRIC_HE = {**dict_of("web/src/pages/CompanyIfrs.tsx", "const HE:"), **dict_of("web/src/lib/labels.ts", "export const METRIC_HE")}
SEGMENT_HE = dict_of("web/src/lib/labels.ts", "export const SEGMENT_HE")
SEGMENT_HE.update({k: v for k, v in re.findall(r"\['([a-z_]+)', '([^']+)'\]", (ROOT / "web/src/pages/IndustryIfrs.tsx").read_text(encoding="utf-8").split("export const SEGS", 1)[1].split(";", 1)[0])})


def season_of(end):
    return f"{end[:4]}{Q_OF.get(end[5:10], end[5:7])}"


def step(v, unit):
    if unit == "nis":
        return 0.01
    if unit == "m":  # NIS millions, stored with three decimals when printed in thousands
        return 1 if float(v).is_integer() else 0.001
    if unit == "pct":
        return 0.1 if round(v * 10) == v * 10 else 0.01
    return 1000 if v % 1000 == 0 else 1


def tol(a, b, unit):
    sa, sb = step(a, unit), step(b, unit)
    return 0.5 * (sa + sb) + 0.5 * min(sa, sb)


def rid_of(url):
    m = re.search(r"P(\d{6,8})-\d+\.pdf", url or "")
    return int(m.group(1)) if m else None


def statement_pairs(F):
    """The restatement pairs of one company's fact table (facts/<id>.json, docs/FACTS.md migration step 2), on the primary statements:
    per cell, the first print (the period's own report, else the earliest that printed it) against the latest print, both as printed
    (a print turned to the latest sign convention, flag 4, is turned back), kept when the two are plausibly the same line (same sign and
    within a factor of two, or the sign alone flipped) and differ by more than 1.5 (the rule build_workbook.py applies). Derived figures are
    not prints; the IFRS 4 prints an IFRS 17 line carries for its early years (flag 2) are its IFRS 4 line's, counted there.
    Yields (sheet, standard, line, unit, period type, period end, v0, report 0, page 0, v1, report 1, page 1, season of report 1, flag 8)."""
    L, R, V = F["lines"], F["rows"], F["vint"]
    sk = lambda t: (V["per"][t][:4], V["per"][t][4:].replace("FY", "Q4"))
    start = 0
    for li, n in enumerate(L["n"]):
        sheet = F["sheets"][L["sh"][li]]
        rr, start = range(start, start + n), start + n
        if sheet not in STMT:
            continue
        cells = collections.defaultdict(list)
        for k in rr:
            if not (R["f"][k] & 1 or (L["std"][li] == "17" and R["f"][k] & 2)):
                cells[R["p"][k]].append(k)
        for p, ks in cells.items():
            pt, pe = F["periods"][p]
            if pt == "9M" or len(ks) < 2:
                continue
            raw = lambda k: -R["v"][k] if R["f"][k] & 4 else R["v"][k]
            first = min(ks, key=lambda k: (bool(R["f"][k] & 128), sk(R["t"][k])))
            last = max(ks, key=lambda k: sk(R["t"][k]))
            a, b = raw(first), raw(last)
            if abs(a - b) > 1.5 and a and b and ((a * b > 0 and 0.5 <= b / a <= 2) or abs(a + b) < 0.5):
                yield (sheet, "IFRS " + (L["std"][li] or "4"), L["label"][li], L["u"][li], pt, pe, a, V["rid"][R["t"][first]], R["pg"][first],
                       b, V["rid"][R["t"][last]], R["pg"][last], V["per"][R["t"][last]], any(R["f"][k] & 24 == 24 for k in ks))


def build():
    docs_file = json.loads((DATA / "search" / "docs.json").read_text(encoding="utf-8"))
    docs = {r[0]: r for r in docs_file["docs"]}
    index = json.loads((DATA / "companies" / "index.json").read_text(encoding="utf-8"))
    names = {c["id"]: c["name_he"] for c in index}
    kind = {c["id"]: ("ins" if c["kind"] == "insurance_group" else "fund") for c in index}
    rows, seen_docs, qa = [], set(), collections.Counter()

    # ---------- the primary statements: first print vs latest print of every cell of the fact table ----------
    for c in index:
        f = DATA / "facts" / f"{c['id']}.json"
        if not f.exists():
            continue
        for sheet, std, line, unit, pt, pe, v0, d0, p0, v1, d1, p1, season, flag8 in statement_pairs(json.loads(f.read_text(encoding="utf-8"))):
            qa["pairs"] += 1
            if abs(v1 - v0) <= tol(v0, v1, unit):
                qa["rounding"] += 1
                continue
            sign = abs(v0 + v1) <= tol(v0, v1, unit)
            seen_docs.update(x for x in (d0, d1) if x)
            if d1 in docs and docs[d1][3] != season:
                qa["season_vs_doc"] += 1
            if not sign and flag8:
                qa["flag8"] += 1
            rows.append([c["id"], STMT[sheet], line, "", pt, pe, unit, v0, d0, p0, v1, d1, p1, season, 1 if sign else 0, std])

    # ---------- IFRS 17 notes: the same fact printed by two reports ----------
    files = {(x["company"], x["period"]): x for x in json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))["files"]}
    prints = collections.defaultdict(dict)
    for p in REPORTS:
        f = DATA / f"ifrs_{p}.json"
        if not f.exists():
            continue
        grp = collections.defaultdict(set)
        for x in json.loads(f.read_text(encoding="utf-8")):
            if x.get("src") or x.get("u") or x.get("tr") or x.get("model") or x.get("cl") or x["m"].startswith(("target", "csm_other")):
                continue
            if x.get("dv") is not None and x["dv"] != x["v"]:
                continue
            k = (x["c"], x["m"], x["s"], x["g"], x["b"], x["w"], x["d"], x.get("bk"), x.get("sn"))
            grp[k].add((x["v"], x["pg"]))
        for k, vs in grp.items():
            if len({v for v, _ in vs}) == 1:  # the report prints the fact once (or the same figure on two pages)
                prints[k][p] = min(vs, key=lambda t: t[1] or 0)
    stmt_keys = {(r[0], r[4], r[5], round((r[7] / 1000) if r[6] == "k" else r[7]), round((r[10] / 1000) if r[6] == "k" else r[10])) for r in rows}
    for k, by in prints.items():
        if len(by) < 2:
            continue
        co, m, s, g, b, w, dte, bk, sn = k
        ps = sorted(by, key=REPORTS.index)
        (v0, p0), (v1, p1) = by[ps[0]], by[ps[-1]]
        unit = "pct" if RATIO.search(m) else "m"
        if abs(v1 - v0) <= tol(v0, v1, unit) or not (v0 and v1 and v0 * v1 > 0 and 0.5 <= v1 / v0 <= 2):
            continue
        pt = {"instant": "I", "q": "Q", "fy": "FY"}.get(w) or ("H" if dte[5:7] == "06" else "9M" if dte[5:7] == "09" else "FY" if dte[5:7] == "12" else "Q")
        if (co, pt, dte, round(v0), round(v1)) in stmt_keys:
            qa["note_dup_of_statement"] += 1
            continue
        if m not in METRIC_HE:
            qa["note_unlabelled"] += 1
            continue
        f0, f1 = files.get((co, ps[0])), files.get((co, ps[-1]))
        d0, d1 = (f0 or {}).get("report_id"), (f1 or {}).get("report_id")
        seen_docs.update(x for x in (d0, d1) if x)
        seg = SEGMENT_HE.get(s) or SEGMENT_HE.get(g) or ""
        sub = " · ".join(x for x in (seg if seg and seg != "קבוצה" else "", BASIS_HE.get(b, ""), f"דלי {bk}" if bk else "") if x)
        rows.append([co, "n17", METRIC_HE[m], sub, pt, dte, unit, v0, d0, p0, v1, d1, p1, ps[-1], 0, "IFRS 17"])
        qa["notes"] += 1

    # one figure, one row: a line printed twice in a statement, or repeated by the next statement (net profit opens the comprehensive
    # income statement and the cash-flow statement), is the same restatement; it is kept under the first statement that prints it
    # (of two prints of one figure, the widest pair stands: the earliest first print, then the latest re-print)
    prio = {"pl": 0, "bs": 1, "oci": 2, "eq": 3, "cf": 4, "n17": 5}
    sk = lambda s: (s[:4], s[4:].replace("FY", "Q4")) if s else ("9999", "")
    rows.sort(key=lambda r: sk(r[13]), reverse=True)
    rows.sort(key=lambda r: sk(docs[r[8]][3] if r[8] in docs else None))
    rows.sort(key=lambda r: prio[r[1]])
    keep, seen = [], set()
    for r in rows:
        k = (r[0], r[2], r[3], r[4], r[5], r[7], r[10])
        if k in seen:
            qa["same_figure_twice"] += 1
            continue
        seen.add(k)
        keep.append(r)
    rows = keep
    rows.sort(key=lambda r: (r[13], r[0], r[1], r[2], r[5]), reverse=True)

    # ---------- per season: count, companies, up/down, net effect on the bottom line ----------
    seasons = {}
    for r in rows:
        if r[14]:
            continue
        s = seasons.setdefault(r[13], {"n": 0, "big": 0, "up": 0, "down": 0, "cos": collections.Counter(), "profit": []})
        s["n"] += 1
        s["cos"][r[0]] += 1
        s["up" if r[10] > r[7] else "down"] += 1
        if r[7] == 0 or abs(r[10] - r[7]) / abs(r[7]) >= 0.02:
            s["big"] += 1
    for season, s in seasons.items():
        for co in s["cos"]:
            cand = [r for r in rows if r[13] == season and r[0] == co and r[1] == "pl" and not r[14] and r[2] in PROFIT and r[4] in ("FY", "H", "Q")]
            if not cand:
                continue
            line = min({r[2] for r in cand}, key=PROFIT.index)
            cand = [r for r in cand if r[2] == line]
            typ = next(t for t in ("FY", "H", "Q") if any(r[4] == t for r in cand))
            for r in cand:
                if r[4] == typ:
                    s["profit"].append([co, line, r[4], r[5], round((r[10] - r[7]) / 1000, 3)])
        s["cos"] = dict(s["cos"].most_common())
        s["net"] = round(sum(x[4] for x in s["profit"]), 3) if s["profit"] else None

    used = sorted(seen_docs)
    return {
        "v": 1,
        "built": dt.date.today().isoformat(),
        "source": "דוחות כספיים של החברות, MAYA: ההדפסה הראשונה של כל תקופה מול ההדפסה האחרונה שלה",
        "units": {"k": "אלפי ש\"ח", "m": "מיליוני ש\"ח", "nis": "ש\"ח", "pct": "%", "shares": "מניות"},
        "names": {k: names[k] for k in sorted({r[0] for r in rows})},
        "kind": {k: kind[k] for k in sorted({r[0] for r in rows})},
        "insurers": INSURERS,
        "files": docs_file["files"], "docs": {str(i): [docs[i][1], docs[i][2], docs[i][3], docs[i][4], docs[i][8]] for i in used if i in docs},
        "cols": ["co", "st", "line", "sub", "pt", "pe", "u", "v0", "d0", "p0", "v1", "d1", "p1", "in", "k", "std"],
        "rows": rows,
        "seasons": {k: seasons[k] for k in sorted(seasons, key=lambda x: (x[:4], x[4:].replace("FY", "Q4")), reverse=True)},
        "qa": dict(qa),
    }


def dump(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    out = build()
    if "--check" in sys.argv:
        cur = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        if cur is not None:
            cur["built"] = out["built"]
        ok = cur == out
        print("restatements.json", "matches a rebuild" if ok else "DIFFERS from a rebuild")
        sys.exit(0 if ok else 1)
    OUT.write_text(dump(out), encoding="utf-8")
    q = out["qa"]
    print(f"restatements.json: {len(out['rows'])} rows ({sum(1 for r in out['rows'] if r[14])} sign changes), {len(out['seasons'])} seasons, "
          f"{OUT.stat().st_size // 1024} KB · qa {q}")
