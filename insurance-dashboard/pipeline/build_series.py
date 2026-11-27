"""One continuous quarterly record per company, 2022 onward: web/public/data/series/<company>.json

Rows are (metric, reported segment, basis); columns are quarters. Each cell is the figure printed for that quarter:
the three-month column of the interim report, or a balance at the quarter end. One value per (metric, segment, basis, period), on the
site's restatement rule (the statements' fact table, docs/FACTS.md policy `latest`): the LATEST print of the figure.
  1. IFRS 17 before IFRS 4 (a comparative restated under IFRS 17 keeps the series on one standard as far back as it was restated)
  2. the latest report that prints the period: the period's own report (data/extracted for IFRS 17 periods, data/extracted_hist for
     earlier ones and for asset managers) or the comparative column of a later report (flag `cmp`). A later print that differs from
     the first print beyond rounding is a restatement: flag `rst` = the first print, `rfrom` = the report that first printed it. It is
     taken only when plausibly the same figure (pipeline/restate_rule.py: same sign and within 10%; a note or segment table reprinted
     further apart is a regrouping or another basis, not a restatement); otherwise the first print stands. (Harel Q1'25 insurance
     revenue: 3,544 in the Q1'25 report, 3,560 in the Q1'26 comparative; H1'25, 9M'25 and FY'25 were already struck on 3,560, so a
     Q4'25 derived from the first print came out 16 too high.)
  3. for Q4 only: the annual figure less the nine-month figure (flag `der`), both on rule 2
`std` records the standard the figure was reported under, so the screen can draw the IFRS 4 / IFRS 17 break.
Dividends (dividend_declared*, dividend_paid*) are stored as positive amounts whatever sign the extraction kept.
A row whose figures are all balances carries `w: "i"` (instant), so consumers never add it up across quarters.
"""
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import restate_rule  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"
pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
pres = json.loads((ROOT / "data" / "registry" / "presentations.json").read_text(encoding="utf-8"))
OUT = ROOT / "web" / "public" / "data" / "series"
OUT.mkdir(parents=True, exist_ok=True)
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31"}
DIVIDEND = ("dividend_declared", "dividend_paid")  # and their variants (_after_period, _in_kind): stored as positive amounts


def std_segment(s):
    t = s.lower().replace("_", " ")
    if t in ("group", "total", "consolidated", "קבוצה"):
        return "group"
    if re.search(r"investment (contract|polic)|חוזי השקעה", t):
        return "investment_contracts"
    if re.search(r"^(life|long-term savings|lts|חיים)", t):
        return "life"
    if t.startswith(("health", "בריאות")):
        return "health"
    if re.search(r"^(pc|p&c|general|non-life|motor|compulsory|כללי)", t):
        return "pc"
    if re.search(r"pension|provident|gemel|asset management|wealth|financial services|פנסיה|גמל|קרנות|תיקים|נאמנות", t):
        return "savings"
    if re.search(r"insurance$|insurance |subsidiary|insurer", t):
        return "insurer"
    return "other"


def period_of(date, window):
    y, md = date[:4], date[5:10]
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}.get(md)
    return f"{y}{q}" if q else None


def window_start(end, w):
    """the balance date a window opens on: the quarter-end three months before a quarter, 31.12 of the year before a year-to-date or a year"""
    y, md = int(end[:4]), end[5:10]
    if w == "q":
        return {"03-31": f"{y - 1}-12-31", "06-30": f"{y}-03-31", "09-30": f"{y}-06-30", "12-31": f"{y}-09-30"}.get(md)
    return f"{y - 1}-12-31" if md in ("03-31", "06-30", "09-30", "12-31") else None


def latest_print(xs):
    """The figure the site shows for one cell (pipeline/restate_rule.py): IFRS 17 before IFRS 4, then the latest report that prints it;
    a later print that differs from the first beyond rounding carries the first print (rst, rfrom)."""
    if not xs:
        return None
    std17 = [c for c in xs if c["std"] != "IFRS 4"] or xs
    std17 = sorted(std17, key=lambda c: bool(c.get("open")))  # in one report a closing row before the opening row of a later window
    c, first = restate_rule.pick(std17, lambda c: c["from"], lambda c: c["own"])
    if c is not first and restate_rule.restated(first["v"], c["v"]):
        return {**c, "rst": first["v"], "rfrom": first["from"]}
    return c


index = {}
companies = sorted({p.name for d in ("extracted", "extracted_hist") for p in (ROOT / "data" / d).iterdir() if p.is_dir()})
for comp in companies:
    cells, meta = {}, {}  # (row key, period) -> candidate list
    for kind in ("extracted_hist", "extracted"):
        for f in sorted((ROOT / "data" / kind / comp).glob("*.json")) if (ROOT / "data" / kind / comp).exists() else []:
            d = json.loads(f.read_text(encoding="utf-8"))
            std = d.get("standard") or "IFRS 17"
            own_end = f"{f.stem[:4]}-{END[f.stem[4:]]}"
            url, purl = pdf.get(d.get("report_id_he")), pdf.get(pres.get(f"{comp}_{f.stem}"))
            for x in d["facts"]:
                v, date, w = x.get("value"), str(x.get("date") or ""), x.get("window") or ""
                if not isinstance(v, (int, float)) or len(date) < 10 or x.get("transition") or x.get("model") or x.get("bucket"):
                    continue
                unit = str(x.get("unit") or "").lower()
                if "billion" in unit or "bn" in unit or "מיליארד" in unit:
                    v = v * 1000
                m, s, b = str(x["metric"]), str(x.get("segment") or "group"), x.get("basis") or "na"
                if m.startswith(("sensitivity", "csm_expected", "target_", "csm_subtotal")):
                    continue
                if m.startswith(DIVIDEND):
                    # the amount declared / paid: the statement of changes in equity prints it in parentheses and some extractions kept the
                    # sign (Phoenix FY'25 −1,514.9 against +1,194.9 for 9M gave Q4 = −2,709.9); one convention, positive, before Q4 = FY − 9M
                    v = abs(v)
                per = period_of(date, w)
                if not per:
                    continue
                link = purl if x.get("doc") == "pres" else url
                c = {"v": round(v, 3), "pg": x.get("page_he"), "u": FILES + link if link else None, "std": std, "from": f.stem, "own": date[:10] == own_end}
                if x.get("source") and x["source"] != "table":
                    c["src"] = x["source"]
                slot = "bal" if w == "instant" else w  # q, ytd, fy, bal
                cells.setdefault((m, s, b), {}).setdefault(per, {}).setdefault(slot, []).append(c)
                meta[(m, s, b)] = x.get("label") or ""
                # the opening CSM of a window is the closing CSM of the date before it, as printed by a later report: the restated
                # comparatives of a roll-forward often survive only there (Harel 31.12.24: 16,548 as first printed, 16,358 as the opening
                # of the Q1'25 comparative in the Q1'26 report, p. 16), so it is a print of the closing balance (pipeline/csm_resolve.py
                # reads it the same way; a closing row of the same report comes first)
                if m == "csm_opening" and w in ("q", "ytd", "fy"):
                    ob = window_start(date[:10], w)
                    op = period_of(ob, "instant") if ob else None
                    if op:
                        cells.setdefault(("csm_closing", s, b), {}).setdefault(op, {}).setdefault("bal", []).append({**c, "own": False, "open": 1})
    rows = []
    for key, pers in cells.items():
        m, s, b = key
        vals = {}
        for per, slots in pers.items():
            best = latest_print
            flow = "q" in slots or "ytd" in slots or "fy" in slots
            c = None
            if "bal" in slots and not flow:
                c = best(slots["bal"])
            elif "q" in slots:
                c = best(slots["q"])
            elif per.endswith("Q1") and "ytd" in slots:
                c = best(slots["ytd"])
            elif per.endswith("Q4") and "fy" in slots:
                nine = pers.get(per[:4] + "Q3", {}).get("ytd")
                fy, n9 = best(slots["fy"]), best(nine) if nine else None
                if fy and n9 and fy["std"] == n9["std"] and not re.search(r"ratio|pct|roe|eps", m):
                    c = {**{k: x for k, x in fy.items() if k not in ("rst", "rfrom")}, "v": round(fy["v"] - n9["v"], 3), "der": 1}
            if c:
                out = {k: c[k] for k in ("v", "pg", "u", "std") if c.get(k) is not None}
                if not c["own"]:
                    out["cmp"] = 1
                for k in ("src", "der", "rst", "rfrom"):
                    if c.get(k) is not None:
                        out[k] = c[k]
                vals[per] = out
            if "fy" in slots:  # the annual figure, for the annual view
                fy = best(slots["fy"])
                o = {k: fy[k] for k in ("v", "pg", "u", "std", "rst", "rfrom") if fy.get(k) is not None}
                if not fy["own"]:
                    o["cmp"] = 1
                vals[per[:4] + "FY"] = o
            elif "bal" in slots and per.endswith("Q4") and not flow:
                vals[per[:4] + "FY"] = vals.get(per, {})
        vals = {p: v for p, v in vals.items() if v and p >= "2021"}
        if len(vals) >= 2:
            row = {"m": m, "s": s, "g": std_segment(s), "b": b, "vals": dict(sorted(vals.items()))}
            # a balance (every figure is a quarter-end position): never summed into H, FY or LTM
            if all(set(sl) == {"bal"} for sl in pers.values()):
                row["w"] = "i"
            rows.append(row)
    rows.sort(key=lambda r: (r["g"] != "group", r["g"], -len(r["vals"]), r["m"]))
    periods = sorted({p for r in rows for p in r["vals"]})
    (OUT / f"{comp}.json").write_text(json.dumps({"periods": periods, "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index[comp] = {"rows": len(rows), "from": periods[0] if periods else None, "to": periods[-1] if periods else None}
(OUT / "index.json").write_text(json.dumps(index), encoding="utf-8")
for c, v in index.items():
    print(c, v)
