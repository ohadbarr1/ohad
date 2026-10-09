"""Sources of profit, lines of business and nostro allocation for the site: data/extracted_sop/*/*.json -> web/public/data/sop/<company>.json

Each fact keeps its window, date and source page; the family (sop, pc, health, life, nostro, other) is assigned here so the page can group tables.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"
pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
pres = json.loads((ROOT / "data" / "registry" / "presentations.json").read_text(encoding="utf-8"))
OUT = ROOT / "web" / "public" / "data" / "sop"
OUT.mkdir(parents=True, exist_ok=True)


def family(m, s):
    if m.startswith("sop"):
        return "sop"
    if m.startswith("nostro"):
        return "nostro"
    t = s.lower()
    if t.startswith(("pc", "p&c", "כללי")):
        return "pc"
    if t.startswith(("health", "בריאות")):
        return "health"
    if t.startswith(("life", "investment", "pension", "חיים", "חיסכון")):
        return "life"
    return "other"


index = {}
for comp_dir in sorted((ROOT / "data" / "extracted_sop").iterdir()):
    out = {}
    for f in sorted(comp_dir.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        url = pdf.get(d.get("report_id_he"))
        purl = pdf.get(pres.get(f"{comp_dir.name}_{f.stem}"))
        facts = []
        for x in d["facts"]:
            if not isinstance(x.get("value"), (int, float)):
                continue
            m, s = str(x["metric"]), str(x.get("segment") or "group")
            row = {"f": family(m, s), "m": m, "s": s, "w": x.get("window") or "", "d": x.get("date") or "", "v": round(x["value"], 3), "pg": x.get("page_he"), "b": x.get("basis") or "na"}
            if x.get("doc") == "pres":
                row["u"] = FILES + purl if purl else None
            if x.get("source") and x["source"] != "table":
                row["src"] = x["source"]
            if x.get("note"):
                row["n"] = " ".join(str(x["note"]).split())[:140]
            facts.append(row)
        out[f.stem] = {"url": FILES + url if url else None, "facts": facts, "missing": [" ".join(str(n.get("metric") or n.get("what") or "").split())[:80] + ": " + " ".join(str(n.get("why") or n.get("reason") or "").split())[:160] for n in d.get("not_found", [])][:20]}
    (OUT / f"{comp_dir.name}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index[comp_dir.name] = {p: len(v["facts"]) for p, v in out.items()}
(OUT / "index.json").write_text(json.dumps(index), encoding="utf-8")
print(index)
