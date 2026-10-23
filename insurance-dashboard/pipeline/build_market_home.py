"""The home page's slice of the regulator file: the last 36 months of aggregates, no fund snapshot.

python3 pipeline/build_market_home.py   web/public/data/market.json -> web/public/data/market_home.json
Same shape as market.json and the same `periods` list, so a month keeps its index (provenance links stay valid against the full file);
rows before the window are dropped. 36 months cover the latest month, the month a year earlier, and twelve-month sums for both.
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
WINDOW = 36
m = json.loads((DATA / "market.json").read_text(encoding="utf-8"))
first = len(m["periods"]) - WINDOW
m["rows"] = [r for r in m["rows"] if r[0] >= first]
m["funds"] = []
m["meta"] = {**m["meta"], "window": WINDOW, "resources": {}, "managers": {}}
m["qa"] = {"checks": [], "notes": []}
(DATA / "market_home.json").write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"market_home.json: {len(m['rows'])} rows from {m['periods'][first]}")
