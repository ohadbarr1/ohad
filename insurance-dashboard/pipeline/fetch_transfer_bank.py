"""The CMA's register of funds and tracks for transfers between institutions ("פרטי קופות לצורך העברת כספים בין גופים מוסדיים",
data.gov.il dataset `transfer_bank`): per track, the managing company, the tax-approval fund number, the track number, and the track's
type and primary / secondary specialization as the regulator registers them. build_funds.py reads it as the official track taxonomy.

python3 pipeline/fetch_transfer_bank.py        -> data/regulation/transfer_bank.json (committed; a slim copy, taxonomy columns only)

One datastore call (the resource has about 2,000 rows), the fox User-Agent. Contact, address and bank-account columns are not kept: the
taxonomy is what the site needs. The file records the resource id, its last_modified stamp and the fetch date.
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

API = "https://data.gov.il/api/3/action"
UA = {"User-Agent": "fox-research/1.0 (+https://fox-research-il.web.app; fundamentals research, low-volume)"}
RESOURCE = "b5223cbc-e1b2-4503-a499-97cdcd7190d2"
OUT = Path(__file__).resolve().parent.parent / "data" / "regulation" / "transfer_bank.json"
# Hebrew column -> short key (the register's own column names)
COLS = {"תחום": "dom", "ח.פ. של חברה": "co_id", "שם חברה": "co", "מספר קופה -אישור מס הכנסה": "fund", "שם קופה / קרן": "fund_name",
        "מספר מסלול השקעה": "track", "שם מסלול ארוך": "name", "סוג מסלול השקעה": "type", "התמחות ראשית של מסלול": "spec",
        "התמחות משנית של מסלול": "sub", "מספר ח.פ. של חברה מתפעלת": "op_id", "שם חברה מתפעלת": "op", "תאריך עדכון אחרון": "upd"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.load(r)


def slim(records):
    rows = []
    for r in records:
        x = {k: (" ".join(str(r.get(h)).split()) if isinstance(r.get(h), str) else r.get(h)) for h, k in COLS.items()}
        x = {k: v for k, v in x.items() if v not in (None, "")}
        if x.get("track") is not None:
            x["track"] = int(x["track"])
        if x.get("fund") is not None:
            x["fund"] = int(x["fund"])
        rows.append(x)
    # one row per (domain, track): the register repeats a track once per bank account / transfer direction with identical taxonomy
    seen, out = set(), []
    for x in sorted(rows, key=lambda x: (x.get("dom", ""), x.get("track") or 0, x.get("fund") or 0)):
        key = (x.get("dom"), x.get("track"), x.get("fund"))
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out


def main():
    meta = get(f"{API}/resource_show?id={RESOURCE}")["result"]
    res = get(f"{API}/datastore_search?" + urllib.parse.urlencode({"resource_id": RESOURCE, "limit": 10000}))["result"]
    if len(res["records"]) < res["total"]:
        sys.exit(f"transfer_bank: {len(res['records'])} of {res['total']} rows returned; raise the limit")
    rows = slim(res["records"])
    doc = {"source": "רשות שוק ההון: פרטי קופות לצורך העברת כספים בין גופים מוסדיים (data.gov.il, transfer_bank)",
           "url": f"https://data.gov.il/dataset/transfer_bank/resource/{RESOURCE}", "resource": RESOURCE,
           "modified": meta.get("last_modified"), "fetched": date.today().isoformat(), "total": res["total"], "rows": rows}
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    if old and old.get("rows") == rows:
        print(f"transfer_bank: {len(rows)} rows, unchanged since {old.get('fetched')}")
        return 0
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"transfer_bank: {res['total']} register rows -> {len(rows)} tracks -> {OUT.relative_to(OUT.parents[2])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
