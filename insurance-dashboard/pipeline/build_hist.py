"""Pre-IFRS 17 history for the site: data/extracted_hist/*/*.json -> web/public/data/hist/<company>.json

One series per (metric, segment, basis): a value for each year-end, taken from the most recent report that prints that year
(a later report may restate the comparative; `re` marks a year whose value comes from a later report than its own).
Amounts are NIS millions; a fact printed in NIS billions (unit field) is converted and marked rounded.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = "https://mayafiles.tase.co.il/"
pdf = {int(r["report_id"]): r["url"] for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")) if r["file_type"] == "pdf1"}
pres = json.loads((ROOT / "data" / "registry" / "presentations.json").read_text(encoding="utf-8"))
OUT = ROOT / "web" / "public" / "data" / "hist"
OUT.mkdir(parents=True, exist_ok=True)
index = {}
for comp_dir in sorted((ROOT / "data" / "extracted_hist").iterdir()):
    series = {}
    for f in sorted(comp_dir.glob("*.json")):  # older report first, so a later one overwrites the years it restates
        d = json.loads(f.read_text(encoding="utf-8"))
        url, purl = pdf.get(d.get("report_id_he")), pdf.get(pres.get(f"{comp_dir.name}_{f.stem}"))
        for x in d["facts"]:
            v = x.get("value")
            if not isinstance(v, (int, float)) or not x.get("date"):
                continue
            unit = str(x.get("unit") or "").lower()
            rounded = "billion" in unit or "bn" in unit or "מיליארד" in unit
            key = (str(x["metric"]), str(x.get("segment") or "group"), x.get("basis") or "na", x.get("window") or "")
            y = str(x["date"])[:10]
            pt = {"v": round(v * 1000, 1) if rounded else round(v, 3), "pg": x.get("page_he"), "from": f.stem, "u": FILES + (purl if x.get("doc") == "pres" else url) if (purl if x.get("doc") == "pres" else url) else None}
            if rounded:
                pt["rnd"] = 1
            if x.get("source") and x["source"] != "table":
                pt["src"] = x["source"]
            had = series.get(key, {}).get(y)
            if had and y[:4] + "FY" != f.stem and abs(had["v"] - pt["v"]) > 0.5:
                pt["re"], pt["was"] = 1, had["v"]  # a later report restates the figure the year's own report printed
            series.setdefault(key, {})[y] = pt
    rows = [{"m": k[0], "s": k[1], "b": k[2], "w": k[3], "pts": dict(sorted(v.items()))} for k, v in series.items()]
    (OUT / f"{comp_dir.name}.json").write_text(json.dumps({"standard": "IFRS 4", "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index[comp_dir.name] = len(rows)
(OUT / "index.json").write_text(json.dumps(index), encoding="utf-8")
print(index)
