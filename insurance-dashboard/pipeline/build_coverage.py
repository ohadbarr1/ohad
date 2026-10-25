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
              state (lane G, upstream-aware): fresh only when fox holds the latest period the source has NOW; pending (behind, inside the
              target) | behind | unchecked (upstream unknown: never green) | empty (no data). upstream {asof, checked, via}: data.gov.il
              CKAN (latest REPORT_PERIOD per dataset), BoI SDMX and CBS (last observation), one request each with a short timeout
              (FOX_OFFLINE=1 skips them); MAYA from the autopilot's last poll and the local registry, with no new MAYA request
              (MAYA's robots.txt forbids /api/).
  The matrix has 16 layers (statements ... price, solvency, decks, debt, ownership, holdings, macro) and a market row (regulator month,
  macro); n/a cells are explicit and every applicable cell stays in the denominator.
  files       [{pattern, contract, files, bytes}]  the open data files, by data contract
Nothing here is a reported figure: it is a description of what the data holds, built from the data files themselves.
"""
import csv
import datetime as dt
import json
import os
import re
import shutil
import urllib.request
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


UA = "fox-research/1.0 (+https://fox-research-il.web.app/data; freshness probe, one request per dataset)"
# data.gov.il (CKAN datastore, documented API): the current-years resource of each Capital Market Authority dataset. One request per
# dataset asks for the latest REPORT_PERIOD only (sort desc, limit 1). data/raw/_meta.json (the fetcher's own record) wins where present.
REG_RES = {"gemel": "a30dcbea-a1d2-482c-ae29-8f781f5025fb", "pensia": "6d47d6b5-cb08-488b-b333-f1e717b1e1bd", "insurance": "c6c62cc7-fe02-4b18-8f3e-813abfbb4647"}
REG_FAMILY = {"gemel": "gemel", "pension": "pensia", "insurance": "insurance"}
CKAN = "https://data.gov.il/api/3/action/datastore_search?resource_id={}&limit=1&fields=REPORT_PERIOD&sort=REPORT_PERIOD%20desc"
BOI_RATE = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0/MNT_RIB_BOI_D?lastNObservations=1&format=csv"
BOI_ZCM = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/ZCM/1.0/ZC_TSB_ZND_10Y_MA?lastNObservations=1&format=csv"
CBS_CPI = "https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=1"
POLL_DAYS = 3  # MAYA: the autopilot's poll (pipeline/autopilot) is the upstream view; older than this, MAYA's state is unknown


def fetch(url, timeout=6):
    """One GET with a short timeout; None on any failure (offline, blocked, slow). FOX_OFFLINE=1 skips the network."""
    if os.environ.get("FOX_OFFLINE"):
        return None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=timeout) as r:
            return r.read().decode("utf-8")
    except Exception:  # noqa: BLE001  any network failure means "not checked", never "fresh"
        return None


def sdmx_last(url):
    """(period, value) of the last observation of an SDMX csv answer."""
    t = fetch(url)
    try:
        rows = list(csv.DictReader(t.splitlines()))
        return rows[-1]["TIME_PERIOD"], float(rows[-1]["OBS_VALUE"])
    except Exception:  # noqa: BLE001
        return None, None


def solv_expected(today):
    """Solvency II reports: 31.12 with the Q1 report (by end of May), 30.6 with the Q3 report (by end of November). The latest date that
    should be published by today."""
    y = today.year
    if today >= dt.date(y, 12, 1):
        return (y, 2)
    if today >= dt.date(y, 6, 1):
        return (y - 1, 4)
    return (y - 1, 2)


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
    ("solvency", "כושר פירעון", "event", "maya"),
    ("decks", "מצגות", "quarterly", "maya"),
    ("debt", "חוב (ת126)", "quarterly", "maya"),
    ("ownership", "בעלי עניין", "quarterly", "maya"),
    ("holdings", "רשימות נכסים", "quarterly", "ir"),
    ("macro", "מאקרו", "monthly", "boi"),
]
MARKET = {"id": "market", "name": "שוק ומאקרו", "kind": "market", "expected": None, "filed": None, "inactive": None}
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

    # ---- upstream: what the source has now (one cheap request each; unknown when the request fails)
    now = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    res = dict(REG_RES)
    try:
        meta = json.loads((ROOT / "data" / "raw" / "_meta.json").read_text(encoding="utf-8"))
        res.update({k: v[-1]["id"] for k, v in meta["resources"].items() if v})
    except (OSError, ValueError, KeyError):
        pass
    fam = {i: REG_FAMILY.get(p["family"]) for i, p in enumerate(market["products"])} if market else {}
    fox_reg = defaultdict(int)
    for r in (market["rows"] if market else []):
        if fam.get(r[1]):
            fox_reg[fam[r[1]]] = max(fox_reg[fam[r[1]]], market["periods"][r[0]])
    reg_up = []
    for k, rid in res.items():
        t = fetch(CKAN.format(rid))
        try:
            up = int(json.loads(t)["result"]["records"][0]["REPORT_PERIOD"])
        except Exception:  # noqa: BLE001
            up = None
        reg_up.append({"id": k, "fox": str(fox_reg.get(k)) if fox_reg.get(k) else None, "upstream": str(up) if up else None})
    reg_upstream = max((int(x["upstream"]) for x in reg_up if x["upstream"]), default=None) if all(x["upstream"] for x in reg_up) else None

    # ---- the six layers added with the honest matrix (lane G): solvency, decks, debt, ownership, holdings, macro
    solv = (load("csm/solvency.json") or {}).get("companies", {})
    solv_exp = solv_expected(today)
    deck_docs = defaultdict(set)
    for f in ("targets.json", "adjusted.json"):
        for rid, d in ((load(f) or {}).get("docs") or {}).items():
            if d[1] == "presentation":
                deck_docs[d[0]].add((pkey(d[2]), rid))
    has_deck = {d[ci["company"]] for d in sdocs["docs"] if d[ci["type"]] == "presentation"}
    # expected: the company's latest presentation in the reader (an annual-deck publisher is not late between its decks)
    deck_exp = defaultdict(lambda: None)
    for d in sdocs["docs"]:
        k = pkey(d[ci["period"]]) if d[ci["type"]] == "presentation" else None
        if k and (deck_exp[d[ci["company"]]] is None or k > deck_exp[d[ci["company"]]]):
            deck_exp[d[ci["company"]]] = k
    # held: every deck read into the deck layer (data/extracted_pres/<company>/<period>[_<report>].json), plus the decks behind targets/adjusted
    doc_per = {str(d[ci["id"]]): d[ci["period"]] for d in sdocs["docs"]}
    for p in (ROOT / "data" / "extracted_pres").glob("*/*.json"):
        try:
            x = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        k = pkey(doc_per.get(str(x.get("report_id"))) or x.get("period") or "")  # the deck's period as filed, not the file name
        if k:  # a deck read with nothing to extract (no KPI slide) is still read
            deck_docs[p.parent.name].add((k, str(x.get("report_id"))))
    debt_idx = load("debt/index.json") or {"companies": [], "none": []}
    debt_last = {}
    for co in debt_idx["companies"]:
        dd_ = load(f"debt/{co['id']}.json") or {"reports": []}
        debt_last[co["id"]] = (max((r["end"] for r in dd_["reports"]), default=None), len(dd_.get("cells", [])))
    debt_none = {x[0] for x in debt_idx.get("none", [])}
    own = load("ownership/index.json") or {"companies": [], "missing": []}
    own_by = {x["id"]: x for x in own["companies"]}
    assets_idx = load("assets/index.json") or {"managers": []}
    hold_by = {m["id"]: m for m in assets_idx["managers"]}
    hold_exp = pkey(assets_idx.get("asof"))
    tq = pkey(today.isoformat())
    own_exp = (tq[0], tq[1] - 1) if tq[1] > 1 else (tq[0] - 1, 4)  # the last quarter that has ended

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
        # Solvency II reports: insurers that still file; the expected date follows the publication cycle, not the quarter
        sd = max(solv.get(cid, {}), default=None)
        row["solvency"] = cell(solv_exp, pname(pkey(sd)) if sd else None, len(solv.get(cid, {}).get(sd, {})) if sd else None, na=not ins or inactive)
        # decks: a company that publishes investor presentations (any in the reader); the latest deck read into the deck layer
        dk = max(deck_docs.get(cid, set()), default=None)
        row["decks"] = cell(deck_exp[cid], pname(dk[0]) if dk else None, len(deck_docs.get(cid, ())), na=cid not in has_deck or inactive)
        dl = debt_last.get(cid)
        row["debt"] = cell(exp, pname(pkey(dl[0])) if dl and dl[0] else None, dl[1] if dl else None, na=not filer or inactive or cid in debt_none)
        # ownership: listed companies (a MAYA filer with a share price); the interested-parties snapshot by quarter
        ow = own_by.get(cid)
        row["ownership"] = cell(own_exp, ow["last_q"] if ow else None, ow.get("quarters") if ow else None, na=not c.get("has_price"))
        # holdings: every institutional body (a manager in the regulator's data) publishes quarterly asset lists
        hm = hold_by.get(cid)
        if not c.get("market_group"):
            row["holdings"] = cell(None, None, na=True)
        elif hm and hm.get("latest"):
            x = cell(hold_exp, hm["latest"], len(hm.get("quarters") or []))
            if hm.get("status") != "ok" and x["s"] == "fresh":
                x["s"] = "stale"  # a partial read (one portfolio of several) is not the full layer
            row["holdings"] = x
        else:
            row["holdings"] = cell(hold_exp, None, 0)
        row["macro"] = cell(None, None, na=True)  # market-wide: the market row
        if reg_upstream and row["reg"]["s"] == "fresh" and int(row["reg"]["last"]) < reg_upstream:
            row["reg"]["s"] = "stale"  # the regulator has a newer month than fox
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
        sources[4]["asof"] = cpi[-1][0] if isinstance(cpi[-1], list) else cpi[-1].get("m") if isinstance(cpi[-1], dict) else None
    S = {x["id"]: x for x in sources}
    for x in sources:
        x["feeds"] = x["feeds"] + (["decks", "debt"] if x["id"] == "maya" else ["macro"] if x["id"] in ("boi", "cbs") else [])

    # ---- upstream-aware state per source (lane G; r2-ws5 finding 6): fresh only when fox holds what the source has now.
    #   state: fresh | pending (behind, still inside fox's target) | behind | unchecked (upstream not known: never green) | empty (no data)
    ap = load("autopilot/status.json") or {}
    poll_at = ((ap.get("poll") or {}).get("at") or "")[:19] or None
    poll_age = (dt.datetime.now() - dt.datetime.fromisoformat(poll_at)).days if poll_at else None
    ap_latest = {c["id"]: c.get("latest") or {} for c in ap.get("companies", [])}
    by_id = {co["id"]: co for co in companies}

    def maya_state(src, layer_ids, xbrl=False):
        late, pend = [], []
        for b in src["behind"]:
            (late if b["filed"] and (today - dt.date.fromisoformat(b["filed"][:10])).days > src["sla_days"] else pend).append(b)
        # a filing the autopilot saw on MAYA that the local registry (calendar) does not hold yet
        unseen = []
        for cid, lt in ap_latest.items():
            co = by_id.get(cid)
            if not co or not lt.get("period") or (xbrl and not lt.get("xbrl")):
                continue
            if pkey(lt["period"]) and co["expected"] and pkey(lt["period"]) > pkey(co["expected"]):
                unseen.append({"id": cid, "period": lt["period"], "filed": lt.get("date")})
        src["upstream"] = {"asof": max((lt.get("date") for lt in ap_latest.values() if lt.get("date")), default=None), "checked": poll_at,
                           "via": "autopilot (pipeline/autopilot), סקירה אחרונה; ללא פנייה חדשה ל-MAYA", "unseen": unseen}
        if late or unseen:
            return "behind"
        if poll_age is None or poll_age > POLL_DAYS:
            return "unchecked"
        return "pending" if pend else "fresh"

    S["maya"]["behind"] = behind(S["maya"]["feeds"])
    S["maya"]["state"] = maya_state(S["maya"], S["maya"]["feeds"])
    S["xbrl"]["state"] = maya_state(S["xbrl"], ["xbrl"], xbrl=True)
    S["reg"]["upstream"] = {"asof": str(reg_upstream) if reg_upstream else None, "checked": now, "via": "data.gov.il CKAN datastore_search (REPORT_PERIOD)", "datasets": reg_up}
    S["reg"]["state"] = ("unchecked" if not reg_upstream else "behind" if any(x["fox"] and x["upstream"] and int(x["fox"]) < int(x["upstream"]) for x in reg_up)
                         else "fresh")
    zp, _ = sdmx_last(BOI_ZCM)
    rp, rv = sdmx_last(BOI_RATE)
    fox_rate = (macro["series"].get("rate", {}).get("last") or [None, None])[1]
    S["boi"]["upstream"] = {"asof": zp, "checked": now, "via": "edge.boi.gov.il SDMX (lastNObservations=1)", "rate": [rp, rv], "fox_rate": fox_rate}
    S["boi"]["state"] = ("unchecked" if not zp or rv is None else "fresh" if S["boi"]["asof"] and S["boi"]["asof"] >= zp and fox_rate == rv else "behind")
    t = fetch(CBS_CPI)
    try:
        d0 = json.loads(t)["month"][0]["date"][0]
        cbs_up = f"{d0['year']}-{d0['month']:02d}"
    except Exception:  # noqa: BLE001
        cbs_up = None
    S["cbs"]["upstream"] = {"asof": cbs_up, "checked": now, "via": "api.cbs.gov.il (last=1)"}
    S["cbs"]["state"] = ("empty" if not S["cbs"]["asof"] else "unchecked" if not cbs_up else "fresh" if S["cbs"]["asof"] >= cbs_up else "behind")
    S["tase"]["state"] = "unchecked"  # no upstream probe: a valuation input only, read by its own fetcher
    S["tase"]["upstream"] = {"asof": None, "checked": None, "via": "לא נבדק"}
    fails = [c for c in qa.get("checks", []) if not c.get("ok") and c.get("level") == "fail"]
    S["gate"]["state"] = "empty" if not qa else "behind" if fails else "fresh"

    # the market row: the regulator's market-wide month and the macro series
    mrow = {l[0]: cell(None, None, na=True) for l in LAYERS}
    if reg_month:
        mrow["reg"] = {"s": "stale" if reg_upstream and int(reg_month) < reg_upstream else "fresh", "last": str(reg_month), "n": len(reg_groups)}
    else:
        mrow["reg"] = {"s": "missing", "last": None, "n": None}
    mlast = max((x for x in (S["boi"]["asof"], S["cbs"]["asof"]) if x), default=None)
    mrow["macro"] = {"s": "missing" if not mlast else "fresh" if S["boi"]["state"] in ("fresh", "unchecked") and S["cbs"]["state"] in ("fresh", "unchecked") else "stale",
                     "last": mlast, "n": len(macro["series"]) + (1 if curve else 0)}
    cells["market"] = mrow
    companies.append(MARKET)

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
