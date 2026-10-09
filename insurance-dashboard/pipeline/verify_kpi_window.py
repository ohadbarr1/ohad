"""Is the profit tagged in a Q2/Q3 XBRL the single quarter or the year to date? Read it off the income statement in the report.

python3 pipeline/verify_kpi_window.py -> data/registry/kpi_windows.json

Interim income statements print five columns: year to date (current, prior), the quarter (current, prior), the last full year.
A profit row that contains the tagged figure tells which column it sits in; the arithmetic year-to-date = earlier periods + quarter
confirms the reading. Nothing is computed into the output except that check: q and ytd are the printed figures (NIS thousands).
"""
import csv
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
kpi = json.loads((ROOT / "data" / "registry" / "kpi_raw.json").read_text(encoding="utf-8"))
docs = list(csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")))
NUM = re.compile(r"[()]*\d[\d,]*\.?\d*[()]*")


def numbers(line):
    out = []
    for t in NUM.findall(line):
        d = t.strip("()").replace(",", "")
        if d and d != ".":
            out.append(-float(d) if "(" in t or ")" in t else float(d))
    return out


def rows(pdf):
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    for page, body in enumerate(txt.split("\f"), 1):
        for line in body.split("\n"):
            clean = re.sub(r"[‎‏‪-‮⁦-⁩]", "", line)
            if ("רווח" in clean or "הפסד" in clean) and "כולל אחר" not in clean:
                n = numbers(re.sub(r"[א-ת\"'׳״].*$", "", clean)) if re.search(r"\d", clean) else []
                if len(n) == 5:
                    yield page, n, " ".join(clean.split())[:140]


out = {}
for comp, per in kpi.items():
    for p in sorted(per):
        if p[4:] not in ("Q2", "Q3") or per[p].get("profit") is None:
            continue
        tagged = per[p]["profit"]
        cands = [r for r in docs if r["company"] == comp and r["period"] == p and r["doc_type"] == "quarterly" and r["local_path"] and re.search("[א-ת]", r["title"])]
        if not cands:
            continue
        near = lambda a, b, s: abs(a * s - b) <= max(0.6 * s, abs(b) * 0.001)
        y = p[:4]
        before = per.get(f"{y}Q1", {}).get("profit") if p.endswith("Q2") else out.get(comp, {}).get(f"{y}Q2", {}).get("ytd")
        hits = []
        pdf = cands[0]["local_path"]
        for page, n, text in rows(pdf if pdf.startswith("/") else str(ROOT / pdf)):
            for scale in (1, 1000):  # the statement is in NIS thousands or NIS millions
                # text order is the reverse of the printed right-to-left columns: [full year, quarter prior, quarter, ytd prior, ytd]
                q, ytd = n[2] * scale, n[4] * scale
                in_q, in_ytd = near(n[2], tagged, scale), near(n[4], tagged, scale)
                if in_q != in_ytd:
                    h = {"tagged": "q" if in_q else "ytd", "q": q, "ytd": ytd, "page": page, "row": text, "report_id": int(cands[0]["report_id"])}
                    # arithmetic: year to date = what came before + this quarter
                    h["check"] = "layout only" if before is None else "arithmetic" if abs(before + q - ytd) <= max(2500, abs(ytd) * 0.004, 1.2 * scale) else "failed"
                    hits.append(h)
        # several rows can carry the figure (equity statement, pre-tax rows): only one that also closes arithmetically is evidence
        hit = next((h for h in hits if h["check"] == "arithmetic"), None) or next((h for h in hits if h["check"] == "layout only"), None) or (hits[0] if hits else None)
        if hit:
            out.setdefault(comp, {})[p] = hit
(ROOT / "data" / "registry" / "kpi_windows.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
for comp, per in out.items():
    tally = {}
    for p, h in per.items():
        k = f"{h['tagged']}/{h['check']}"
        tally[k] = tally.get(k, 0) + 1
    print(comp, tally)
