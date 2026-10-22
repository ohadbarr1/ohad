"""Small files the site shell reads on every route, so no route has to download a large one to draw its header.

web/public/data/search/entities.json  the search index's names: market groups and every fund (name, group), from market.json
                                      (the shell used to download all of market.json, 1.8 MB, for these names)
web/public/data/filings_latest.json   the newest filings of every company, one request instead of one per company

Run after build_market.py and after the companies' docs files change.
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
m = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
ent = {"asof": m.get("meta", {}).get("asof"), "groups": m["groups"], "funds": [[f["name"], f["grp"]] for f in m["funds"]]}
(DATA / "search").mkdir(exist_ok=True)
(DATA / "search" / "entities.json").write_text(json.dumps(ent, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

docs = []
for f in sorted((DATA / "companies").glob("*.docs.json")):
    comp = f.name[: -len(".docs.json")]
    for d in json.loads(f.read_text(encoding="utf-8")).get("docs", []):
        docs.append({**d, "company": comp})
docs.sort(key=lambda d: (d["date"], d["id"]), reverse=True)
(DATA / "filings_latest.json").write_text(json.dumps({"docs": docs[:60]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(ent["funds"]), "funds and", len(ent["groups"]), "groups indexed;", min(60, len(docs)), "latest of", len(docs), "filings")
