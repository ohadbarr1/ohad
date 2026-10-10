"""One continuous quarterly record per company, 2022 onward: web/public/data/series/<company>.json

Rows are (metric, reported segment, basis); columns are quarters. Each cell is the figure printed for that quarter:
the three-month column of the interim report, or a balance at the quarter end. Sources, in order of preference:
  1. the period's own report (data/extracted for IFRS 17 periods, data/extracted_hist for earlier ones and for asset managers)
  2. the comparative column of a later report (flag `cmp`), which may be restated; a comparative restated under IFRS 17 is preferred
     over the original IFRS 4 figure, so the IFRS 17 series reaches back to 2024
  3. for Q4 only: the annual figure less the nine-month figure (flag `der`), when both come from sources 1 or 2
`std` records the standard the figure was reported under, so the screen can draw the IFRS 4 / IFRS 17 break.
"""
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"
pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
pres = json.loads((ROOT / "data" / "registry" / "presentations.json").read_text(encoding="utf-8"))
OUT = ROOT / "web" / "public" / "data" / "series"
OUT.mkdir(parents=True, exist_ok=True)
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31"}


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
    rows = []
    for key, pers in cells.items():
        m, s, b = key
        vals = {}
        for per, slots in pers.items():
            # IFRS 17 first (a restated comparative keeps the series on one standard as far back as it was restated), then the own report, then the earliest later report
            best = lambda xs: sorted(xs, key=lambda c: (c["std"] == "IFRS 4", not c["own"], c["from"]))[0] if xs else None
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
                    c = {**fy, "v": round(fy["v"] - n9["v"], 3), "der": 1}
            if c:
                out = {k: c[k] for k in ("v", "pg", "u", "std") if c.get(k) is not None}
                if not c["own"]:
                    out["cmp"] = 1
                for k in ("src", "der"):
                    if c.get(k):
                        out[k] = c[k]
                vals[per] = out
            if "fy" in slots:  # the annual figure, for the annual view
                fy = best(slots["fy"])
                o = {k: fy[k] for k in ("v", "pg", "u", "std") if fy.get(k) is not None}
                if not fy["own"]:
                    o["cmp"] = 1
                vals[per[:4] + "FY"] = o
            elif "bal" in slots and per.endswith("Q4") and not flow:
                vals[per[:4] + "FY"] = vals.get(per, {})
        vals = {p: v for p, v in vals.items() if v and p >= "2021"}
        if len(vals) >= 2:
            rows.append({"m": m, "s": s, "g": std_segment(s), "b": b, "vals": dict(sorted(vals.items()))})
    rows.sort(key=lambda r: (r["g"] != "group", r["g"], -len(r["vals"]), r["m"]))
    periods = sorted({p for r in rows for p in r["vals"]})
    (OUT / f"{comp}.json").write_text(json.dumps({"periods": periods, "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index[comp] = {"rows": len(rows), "from": periods[0] if periods else None, "to": periods[-1] if periods else None}
(OUT / "index.json").write_text(json.dumps(index), encoding="utf-8")
for c, v in index.items():
    print(c, v)
