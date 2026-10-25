"""data.gov.il discovery: has the Capital Market Authority published a month fox does not have yet?

The permitted automated channel (documented CKAN API, open licence; data.gov.il/robots.txt disallows /api/ for crawlers, the API is the
documented access path, so: a handful of requests a day, a User-Agent naming fox, every probe logged). Per dataset (gemel-net,
pensia-net, insurance-net) two requests: package_show (the current-years resource and its last_modified) and datastore_search sorted by
REPORT_PERIOD desc, limit 1 (the latest month upstream). When a month is newer than the latest month in market.json, --apply runs the
existing fetcher and builders through the DAG: fetch_regulator -> build_market, build_funds (manual steps, run on purpose) -> the
deploy group with its stale upstream (automatic). A revision of an old month (last_modified moves daily) is reported, not fetched.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://data.gov.il/api/3/action"
UA = "fox-research-il-autopilot/1.0 (+https://fox-research-il.web.app/data/autopilot; daily regulator probe)"
PACKAGES = {"gemel": "gemelnet", "pensia": "pensia-net", "insurance": "insurance"}
FAMILY = {"gemel": "gemel", "pension": "pensia", "insurance": "insurance"}  # market.json product family -> dataset


class Http:
    """One GET per call, ≥ 1 s apart, 30 s timeout. FOX_OFFLINE=1: no network (raises)."""

    def __init__(self, interval=1.0):
        self.interval, self.last, self.calls = interval, 0.0, 0

    def get_json(self, url):
        if os.environ.get("FOX_OFFLINE"):
            raise OSError("FOX_OFFLINE")
        gap = time.monotonic() - self.last
        if gap < self.interval:
            time.sleep(self.interval - gap)
        self.last = time.monotonic()
        self.calls += 1
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))


def fox_months(data_dir):
    """Latest month per dataset in web/public/data/market.json (what the site publishes)."""
    p = Path(data_dir) / "market.json"
    if not p.exists():
        return {}
    m = json.loads(p.read_text(encoding="utf-8"))
    fam = {i: FAMILY.get(pr.get("family")) for i, pr in enumerate(m.get("products", []))}
    out = {}
    for r in m.get("rows", []):
        k = fam.get(r[1])
        if k:
            out[k] = max(out.get(k, 0), int(m["periods"][r[0]]))
    return out


def current_resource(pkg):
    """The live CSV resource covering the current years (the one whose name says 'היום' / the latest last_modified)."""
    res = [r for r in pkg.get("resources", []) if r.get("format") == "CSV" and r.get("datastore_active")]
    if not res:
        return None
    return max(res, key=lambda r: (("היום" in (r.get("name") or "")), r.get("last_modified") or ""))


def probe(http, data_dir, log=print):
    """{datasets: [{id, package, resource, last_modified, upstream, fox, new}], new: bool, errors: [...]}; never raises on the network."""
    fox = fox_months(data_dir)
    out = {"via": "data.gov.il CKAN (package_show + datastore_search REPORT_PERIOD)", "datasets": [], "errors": []}
    for key, pkg_id in PACKAGES.items():
        row = {"id": key, "package": pkg_id, "fox": fox.get(key)}
        try:
            pkg = http.get_json(f"{API}/package_show?id={urllib.parse.quote(pkg_id)}")["result"]
            res = current_resource(pkg)
            if not res:
                raise ValueError("no live CSV resource")
            row.update(resource=res["id"], last_modified=(res.get("last_modified") or "")[:19])
            q = urllib.parse.urlencode({"resource_id": res["id"], "limit": 1, "fields": "REPORT_PERIOD", "sort": "REPORT_PERIOD desc"})
            recs = http.get_json(f"{API}/datastore_search?{q}")["result"]["records"]
            row["upstream"] = int(recs[0]["REPORT_PERIOD"]) if recs else None
        except Exception as e:  # noqa: BLE001  unknown is never "fresh"
            out["errors"].append({"id": key, "error": str(e)[:200]})
            row["upstream"] = None
        row["new"] = bool(row.get("upstream") and (not row["fox"] or row["upstream"] > row["fox"]))
        out["datasets"].append(row)
        log(f"regulator {key}: upstream {row.get('upstream') or '?'} · fox {row['fox'] or '–'}" + (" · NEW" if row["new"] else ""))
    out["new"] = any(d["new"] for d in out["datasets"])
    return out


def month_label(m):
    """202609 -> 09/26 (the regulator-month grammar)."""
    s = str(m)
    return f"{s[4:6]}/{s[2:4]}" if len(s) == 6 else s
