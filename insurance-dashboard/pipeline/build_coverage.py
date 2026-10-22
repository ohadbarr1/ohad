"""Coverage, freshness and file inventory for the /data page (lane 2H; ws5 W5-R2, ws1 W1-18).

python3 pipeline/build_coverage.py      (standard library only; reads web/public/data, writes web/public/data/coverage.json
                                          and a copy of the data contracts web/src/lib/schemas.json -> web/public/data/schemas.json)

coverage.json
  built       ISO time of the build
  layers      [{id, label, cadence, source}]  the data layers of a company
  companies   [{id, name, kind, expected, filed}]  expected = the latest periodic report the company has published (calendar.json)
  cells       {company: {layer: {s, last, n}}}  s: fresh (the layer has the latest published period) | stale (older) | missing (none)
                                                | na (the layer does not apply: IFRS 17 for a fund house, a company without filings)
              last: period "2026Q2", month "202608" or date "2026-10-22"; n: facts, rows, documents or pages behind the cell
  sources     [{id, label, url, cadence, sla_days, asof, checked, behind, age_rule}]  age_rule false: filings arrive as events, so only
              `behind` (a filing older than sla_days not yet in the data) can breach the target;  freshness per source: `checked` is when fox last read it,
              `asof` the latest data it holds, `behind` the companies whose latest filing is not yet in the layers fed by it.
              sla_days is fox's own target (W5-R2), labelled as such on the page.
  files       [{pattern, contract, files, bytes}]  the open data files, by data contract
Nothing here is a reported figure: it is a description of what the data holds, built from the data files themselves.
"""
import datetime as dt
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
SPEC = ROOT / "web" / "src" / "lib" / "schemas.json"


def load(rel):
    p = DATA / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def pkey(p):
    """Sortable key of a period: '2026Q2' / 'Q2-2026' / 'H1-2026' / '2025FY' / a quarter-end date -> (year, quarter)."""
    if p is None:
        return None
    m = re.match(r"^(\d{4})(Q([1-4])|FY|H([12]))$", p)
    if m:
        y = int(m.group(1))
        return (y, int(m.group(3)) if m.group(3) else 4 if m.group(2) == "FY" else int(m.group(4)) * 2)
    m = re.match(r"^(Q([1-4])|H([12])|FY|9M)-(\d{4})$", p)
    if m:
        y = int(m.group(4))
        return (y, int(m.group(2)) if m.group(2) else int(m.group(3)) * 2 if m.group(3) else 3 if m.group(1) == "9M" else 4)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", p)
    if m:
        return (int(m.group(1)), (int(m.group(2)) + 2) // 3)
    return None


def pend(p):
    """The last day of a period key, ISO: a report cannot be published before its period ends."""
    y, q = p
    return f"{y}-{['03-31', '06-30', '09-30', '12-31'][q - 1]}"


def pname(k):
    """(2026, 2) -> '2026Q2'; a fourth quarter is the annual report."""
    return f"{k[0]}FY" if k[1] == 4 else f"{k[0]}Q{k[1]}"


LAYERS = [
    ("fs", "דוחות כספיים", "quarterly", "maya"),
    ("ifrs17", "IFRS 17 · CSM", "quarterly", "maya"),
    ("sop", "מקורות רווח", "quarterly", "maya"),
    ("hist", "רצף רבעוני", "quarterly", "maya"),
    ("lts", "חיסכון ארוך טווח", "quarterly", "maya"),
    ("xbrl", "XBRL", "quarterly", "xbrl"),
    ("reg", "רשות שוק ההון", "monthly", "reg"),
    ("docs", "מסמכים", "event", "maya"),
    ("text", "טקסט מלא", "event", "maya"),
    ("price", "מחיר מניה", "daily", "tase"),
]
LTS_ALIAS = {"idi": "direct", "more_gemel": "more"}


def main():
    today = dt.date.today()
    reg = load("companies/index.json")
    cal = {c["id"]: c for c in (load("calendar.json") or {"companies": []})["companies"]}
    kpi = (load("kpi.json") or {}).get("companies", {})
    ifrs = load("ifrs.json") or {"files": []}
    sop = load("sop/index.json") or {}
    series = load("series/index.json") or {}
    lts = load("lts.json") or {"facts": [], "companies": {}}
    market = load("market.json")
    sdocs = load("search/docs.json") or {"cols": [], "docs": []}

    ifrs_by = defaultdict(dict)
    for f in ifrs["files"]:
        ifrs_by[f["company"]][f["period"]] = f.get("facts", 0)
    lts_by = defaultdict(lambda: [None, 0])
    for f in lts["facts"]:
        k = pkey(f[2])
        e = lts_by[f[1]]
        e[1] += 1
        if k and (e[0] is None or k > e[0]):
            e[0] = k
    ci = {c: i for i, c in enumerate(sdocs["cols"])}
    text_by = defaultdict(lambda: [None, 0, 0])
    for d in sdocs["docs"]:
        if d[ci["empty"]] if "empty" in ci else False:
            continue
        e = text_by[d[ci["company"]]]
        k = pkey(d[ci["period"]])
        e[1] += d[ci["pages"]] or 0
        e[2] += 1
        if k and (e[0] is None or k > e[0]):
            e[0] = k
    G = market["groups"] if market else []
    last_i = max((r[0] for r in market["rows"]), default=-1) if market else -1
    reg_groups = {G[r[2]] for r in market["rows"] if r[0] == last_i} if market else set()
    reg_month = market["periods"][last_i] if market and last_i >= 0 else None

    def cell(expected, last, n=None, na=False):
        if na:
            return {"s": "na", "last": None, "n": None}
        if last is None:
            return {"s": "missing", "last": None, "n": n}
        s = "fresh" if expected is None or pkey(last) >= expected else "stale"
        return {"s": s, "last": last, "n": n}

    companies, cells = [], {}
    for c in reg:
        cid, ins = c["id"], c["kind"] == "insurance_group"
        cc = cal.get(cid)
        filer = cc is not None  # publishes periodic reports on MAYA
        exp = pkey(cc["last"]["period"]) if cc else None
        inactive = bool(cc and cc.get("inactive"))
        row = {}
        wb = load(f"companies/{cid}.json") if c.get("has_financials") else None
        if wb:
            used = {f[1] for f in wb["facts"]}
            ends = [pkey(p["end"]) for i, p in enumerate(wb["periods"]) if i in used and p["type"] != "I"]
            k = max((e for e in ends if e), default=None)
            row["fs"] = cell(exp, pname(k) if k else None, len(wb["facts"]))
        else:
            row["fs"] = cell(exp, None, na=not filer or inactive)
        # IFRS 17 is in force from 2025 reports: an insurer that stopped filing before then has no IFRS 17 layer
        ip = max(ifrs_by.get(cid, {}), key=pkey, default=None)
        row["ifrs17"] = cell(exp, ip, ifrs_by.get(cid, {}).get(ip), na=not ins or inactive)
        sp = max(sop.get(cid, {}), key=pkey, default=None)
        row["sop"] = cell(exp, sp, sop.get(cid, {}).get(sp), na=not ins or inactive)
        se = series.get(cid)
        row["hist"] = cell(exp, se["to"] if se else None, se["rows"] if se else None, na=not ins or inactive)
        lk = LTS_ALIAS.get(cid, cid)
        le = lts_by.get(lk)
        row["lts"] = cell(exp, pname(le[0]) if le and le[0] else None, le[1] if le else None, na=not filer or not c.get("market_group"))
        kp = kpi.get(cid)
        row["xbrl"] = cell(exp, kp["periods"][-1] if kp and kp["periods"] else None, len(kp["periods"]) if kp else None, na=not filer)
        mg = c.get("market_group")
        if not mg:
            row["reg"] = cell(None, None, na=True)
        else:
            row["reg"] = {"s": "fresh" if mg in reg_groups else "missing", "last": str(reg_month) if mg in reg_groups else None, "n": None}
        dd = load(f"companies/{cid}.docs.json")
        if dd and dd.get("docs"):
            # a document tagged with a period that ends after it was published is mis-tagged: it does not count
            k = max((pkey(d["period"]) for d in dd["docs"] if pkey(d["period"]) and pend(pkey(d["period"])) <= d["date"][:10]), default=None)
            row["docs"] = cell(exp, pname(k) if k else None, len(dd["docs"]))
        else:
            row["docs"] = cell(exp, None, 0, na=not filer or inactive)
        te = text_by.get(cid)
        row["text"] = cell(exp, pname(te[0]) if te and te[0] else None, te[1] if te else None, na=not filer or (inactive and not te))
        if c.get("has_price"):
            pr = load(f"companies/{cid}.price.json")
            asof = pr.get("asof") if pr else None
            fresh = asof and (today - dt.date.fromisoformat(asof[:10])).days <= 7
            row["price"] = {"s": "fresh" if fresh else "stale" if asof else "missing", "last": asof, "n": len(pr.get("close", [])) if pr else None}
        else:
            row["price"] = cell(None, None, na=True)
        cells[cid] = row
        companies.append({"id": cid, "name": c["name_he"], "kind": c["kind"], "expected": pname(exp) if exp else None,
                          "filed": cc["last"]["date"] if cc else None, "inactive": inactive or None})

    # who is behind: the latest published report is not yet in a layer fed by MAYA filings
    def behind(layers):
        out = []
        for co in companies:
            if not co["expected"] or co["inactive"]:
                continue
            # lateness only: a layer that holds an older period. A layer never built for a company is a coverage gap (the matrix shows it)
            lag = [l for l in layers if cells[co["id"]][l]["s"] == "stale"]
            if lag:
                out.append({"id": co["id"], "period": co["expected"], "filed": co["filed"], "layers": lag})
        return out

    macro = load("macro/macro.json") or {"series": {}}
    curve = load("macro/boi_curve.json") or {}
    prices = [load(f"companies/{c['id']}.price.json") for c in reg if c.get("has_price")]
    prices = [p for p in prices if p]
    docs_all = [d for c in reg for d in ((load(f"companies/{c['id']}.docs.json") or {}).get("docs") or [])]
    qa = load("qa.json") or {}
    first = lambda *xs: next((x for x in xs if x), None)
    sources = [
        {"id": "maya", "label": "MAYA · דוחות תקופתיים (PDF)", "url": "https://maya.tase.co.il/", "cadence": "quarterly", "sla_days": 7,
         "asof": max((d["date"] for d in docs_all), default=None), "checked": (load("calendar.json") or {}).get("built", "")[:10] or None,
         "feeds": ["fs", "ifrs17", "sop", "hist", "lts", "docs", "text"], "behind": behind(["fs", "ifrs17", "sop", "hist", "lts", "docs", "text"]), "age_rule": False},
        {"id": "xbrl", "label": "MAYA · XBRL", "url": "https://maya.tase.co.il/", "cadence": "quarterly", "sla_days": 7,
         "asof": max((v["periods"][-1] for v in kpi.values() if v["periods"]), key=pkey, default=None), "checked": (load("kpi.json") or {}).get("asof"),
         "feeds": ["xbrl"], "behind": behind(["xbrl"])},
        {"id": "reg", "label": "רשות שוק ההון · גמל-נט, פנסיה-נט, ביטוח-נט", "url": "https://data.gov.il/dataset/gemelnet", "cadence": "monthly", "sla_days": 35,
         "asof": str(reg_month) if reg_month else None, "checked": market["meta"].get("fetched") if market else None, "feeds": ["reg"], "behind": []},
        {"id": "boi", "label": "בנק ישראל · ריבית ועקומי אפס", "url": "https://www.boi.org.il/roles/statistics/", "cadence": "daily", "sla_days": 7,
         "asof": curve.get("months", [None])[-1] if curve.get("months") else None, "checked": first(macro["series"].get("rate", {}).get("retrieved"), curve.get("retrieved")), "feeds": [], "behind": []},
        {"id": "cbs", "label": 'הלמ"ס · מדד המחירים לצרכן', "url": "https://www.cbs.gov.il/", "cadence": "monthly", "sla_days": 35,
         "asof": None, "checked": macro["series"].get("cpi", {}).get("retrieved"), "feeds": [], "behind": []},
        {"id": "tase", "label": "הבורסה לניירות ערך · מחירים (קלט להערכת שווי בלבד)", "url": "https://market.tase.co.il/", "cadence": "daily", "sla_days": 7,
         "asof": max((p["asof"] for p in prices), default=None), "checked": max((p["fetched"] for p in prices), default=None), "feeds": ["price"], "behind": []},
        {"id": "gate", "label": "fox · בדיקות איכות (gate)", "url": "https://fox-research-il.web.app/data", "cadence": "event", "sla_days": 35,
         "asof": (qa.get("built") or "")[:10] or None, "checked": (qa.get("built") or "")[:10] or None, "feeds": [], "behind": []},
    ]
    cpi = macro["series"].get("cpi", {}).get("points")
    if cpi:
        sources[4]["asof"] = cpi[-1][0] if isinstance(cpi[-1], list) else None

    # the open data files, by contract
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    rules = [(re.compile("^" + "".join("[^/]*" if ch == "*" else re.escape(ch) for ch in f["pattern"]) + "$"), f["pattern"], f["schema"]) for f in spec["files"]]
    inv = {}
    for p in sorted(DATA.rglob("*.json")):
        rel = p.relative_to(DATA).as_posix()
        if rel in ("coverage.json", "schemas.json"):
            continue
        hit = next(((pat, s) for r, pat, s in rules if r.match(rel)), None)
        if not hit:
            continue
        e = inv.setdefault(hit[0], {"pattern": hit[0], "contract": hit[1], "files": 0, "bytes": 0, "example": rel})
        e["files"] += 1
        e["bytes"] += p.stat().st_size

    out = {"built": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
           "layers": [{"id": i, "label": l, "cadence": c, "source": s} for i, l, c, s in LAYERS],
           "companies": companies, "cells": cells, "sources": sources, "files": list(inv.values())}
    (DATA / "coverage.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    shutil.copyfile(SPEC, DATA / "schemas.json")
    tally = defaultdict(int)
    for row in cells.values():
        for x in row.values():
            tally[x["s"]] += 1
    print(f"coverage.json: {len(companies)} companies x {len(LAYERS)} layers: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items()))
          + f"; {len(sources)} sources; {len(inv)} file families")


if __name__ == "__main__":
    main()
