"""Published sell-side price targets and recommendations: data/registry/consensus.json -> web/public/data/consensus.json

The registry is hand-curated from public press and IR pages (Globes, Calcalist, TheMarker, Bizportal, Funder, Sponser, Investing.com,
TipRanks news), one row per published call, each confirmed on the fetched page: broker, date, rating as printed, target in NIS (the
token as printed beside it: agorot are divided by 100), the previous target where printed, the outlet and its URL. The registry keeps a
short excerpt per row (`check`) for re-verification; it is not published. A figure that could not be confirmed on its page is not in the
registry (`dropped` lists what was looked at and why it was left out).

fox is fundamentals only: no share price is shown beside these targets, and no upside is computed. They are dated, sourced figures as
reported, shown on /credibility under "תחזיות ומחירי יעד מפורסמים".

python3 pipeline/build_consensus.py           write web/public/data/consensus.json
python3 pipeline/build_consensus.py --check   the rules below and a byte-equal rebuild (gate `consensus`)
"""
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REG = ROOT / "data" / "registry" / "consensus.json"
OUT = ROOT / "web" / "public" / "data" / "consensus.json"
RATINGS = {"buy", "outperform", "hold", "neutral", "underperform", "sell", "none"}
KEEP = ["c", "broker", "broker_he", "date", "date_kind", "rating", "rating_norm", "target", "target_printed", "prev_target", "action", "outlet", "kind", "title", "src", "alt"]


def build():
    r = json.loads(REG.read_text(encoding="utf-8"))
    rows = sorted(r["rows"], key=lambda x: (x["c"], x["date"], x["broker"]))
    have = {x["c"] for x in rows}
    out = {
        "v": 1, "fetched": r["fetched"], "window": r["window"],
        "source": "דיווחים פומביים בעיתונות ובאתרי קשרי משקיעים: מחיר יעד והמלצה כפי שפורסמו, עם התאריך והקישור",
        "rule": "Every row confirmed on its page; a figure that could not be confirmed is dropped. Targets in NIS as published (agorot / 100). No share price, no upside.",
        "searched": r["searched"], "none": [c for c in r["searched"] if c not in have],
        "rows": [{k: x.get(k) for k in KEEP} for x in rows],
    }
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))


def problems():
    r = json.loads(REG.read_text(encoding="utf-8"))
    lo, hi = r["window"]
    reg = {c["id"] for c in json.loads((ROOT / "web" / "public" / "data" / "companies" / "index.json").read_text(encoding="utf-8"))}
    out, seen = [], set()
    for i, x in enumerate(r["rows"]):
        tag = f"row {i} ({x.get('c')} {x.get('broker')} {x.get('date')})"
        if x.get("c") not in reg or x.get("c") not in r["searched"]:
            out.append(f"{tag}: unknown company")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", x.get("date") or "") or not lo <= x["date"] <= hi:
            out.append(f"{tag}: date outside {lo}..{hi}")
        if not str(x.get("src", "")).startswith("https://"):
            out.append(f"{tag}: no https source")
        if not x.get("broker") or not x.get("outlet"):
            out.append(f"{tag}: broker or outlet missing")
        if x.get("rating_norm") not in RATINGS:
            out.append(f"{tag}: rating_norm {x.get('rating_norm')}")
        t = x.get("target")
        if t is not None and not (isinstance(t, (int, float)) and 1 <= t <= 5000):
            out.append(f"{tag}: target {t} not a NIS figure")
        if t is None and x.get("rating_norm") == "none":
            out.append(f"{tag}: neither a target nor a rating")
        if t is not None and not x.get("target_printed"):
            out.append(f"{tag}: target without the token as printed")
        if not x.get("check"):
            out.append(f"{tag}: no verification excerpt")
        k = (x.get("c"), x.get("broker"), x.get("date"))
        if k in seen:
            out.append(f"{tag}: duplicate")
        seen.add(k)
    if r.get("fetched", "") > dt.date.today().isoformat():
        out.append("fetched is in the future")
    return out, len(r["rows"])


def main():
    probs, n = problems()
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != build():
            probs.append("web/public/data/consensus.json is stale: run pipeline/build_consensus.py")
        for p in probs[:10]:
            print("  " + p)
        print(f"consensus: {n} published targets, {len(probs)} problems")
        return 1 if probs else 0
    if probs:
        for p in probs:
            print("  " + p)
        return 1
    OUT.write_text(build(), encoding="utf-8")
    print(f"consensus.json: {n} rows, {OUT.stat().st_size // 1024 + 1} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
