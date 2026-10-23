"""Headline figures from the XBRL instance attached to every periodic report on MAYA.

python3 pipeline/fetch_xbrl.py            # download missing files, parse, write table xbrl_facts (needs duckdb)
python3 pipeline/fetch_xbrl.py --registry # standard library only: parse the local instances -> data/registry/xbrl_facts.json
                                          # (--download also fetches instances listed in documents.csv but missing locally)
Each instance is the ISA summary form (ת930): a fixed list of 26 ifrs-full concepts (T0_ALL below), of which a filer tags what
applies; nothing IFRS 17 specific (no insurance revenue, service result or CSM), no dividends, no AUM, no solvency. Values are stored
exactly as tagged; scaling is in the `decimals` column. The registry file is the report-day (T+0) skeleton's input
(pipeline/autopilot/t0.py): it lands in kpi.json the moment the instance exists, marked unverified until the printed figure agrees.
"""
import argparse
import csv
import datetime as dt
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_maya as fm  # noqa: E402

RAW = fm.ROOT / "data" / "sources" / "xbrl"
NS_SKIP = "ifrs-il"
REGISTRY = fm.ROOT / "data" / "registry" / "xbrl_facts.json"
# Every ifrs-full concept of the ת930 form, by the key the site uses; kind "flow" (a period) or "inst" (a date); unit "nis" or "ps" (per share).
T0_ALL = {
    "profit": ("ProfitLossAttributableToOwnersOfParent", "flow", "nis"), "oci": ("ComprehensiveIncomeAttributableToOwnersOfParent", "flow", "nis"),
    "pretax": ("ProfitLossBeforeTax", "flow", "nis"), "revenue": ("Revenue", "flow", "nis"), "cfo": ("CashFlowsFromUsedInOperatingActivities", "flow", "nis"),
    "eps": ("BasicEarningsLossPerShare", "flow", "ps"), "equity": ("EquityAttributableToOwnersOfParent", "inst", "nis"), "assets": ("Assets", "inst", "nis"),
    "profit_all": ("ProfitLoss", "flow", "nis"), "profit_nci": ("ProfitLossAttributableToNoncontrollingInterests", "flow", "nis"),
    "ci_all": ("ComprehensiveIncome", "flow", "nis"), "ci_nci": ("ComprehensiveIncomeAttributableToNoncontrollingInterests", "flow", "nis"),
    "eps_diluted": ("DilutedEarningsLossPerShare", "flow", "ps"), "op_profit": ("ProfitLossFromOperatingActivities", "flow", "nis"),
    "cfi": ("CashFlowsFromUsedInInvestingActivities", "flow", "nis"), "cff": ("CashFlowsFromUsedInFinancingActivities", "flow", "nis"),
    "equity_all": ("Equity", "inst", "nis"), "nci": ("NoncontrollingInterests", "inst", "nis"), "liabilities": ("Liabilities", "inst", "nis"),
    "gross_profit": ("GrossProfit", "flow", "nis"), "fx_cash": ("EffectOfExchangeRateChangesOnCashAndCashEquivalents", "flow", "nis"),
    "assets_cur": ("CurrentAssets", "inst", "nis"), "assets_noncur": ("NoncurrentAssets", "inst", "nis"),
    "liab_cur": ("CurrentLiabilities", "inst", "nis"), "liab_noncur": ("NoncurrentLiabilities", "inst", "nis"),
    "equity_liab": ("EquityAndLiabilities", "inst", "nis"),
}
# The ones kpi.json carries (the first eight are build_kpi.py's own; the rest join as the T+0 skeleton). The current/non-current split is
# tagged by fund houses only, gross profit by one filer, the FX line is noise, equity and liabilities repeats total assets (it is a check).
T0_KPI = ["profit", "oci", "pretax", "revenue", "cfo", "eps", "equity", "assets", "profit_all", "profit_nci", "ci_all", "ci_nci",
          "eps_diluted", "op_profit", "cfi", "cff", "equity_all", "nci", "liabilities"]
BY_CONCEPT = {c: k for k, (c, _, _) in T0_ALL.items()}


def instance(text):
    """The reporting period's facts of one ת930 instance: {"s": start, "e": end, "v": {key: value}, "m": {key: months}}, or None.
    Nil facts (the filer left the concept empty) are absent. Money in NIS as tagged, per-share in NIS."""
    out, start, end = {}, None, None
    months = {}
    for concept, ref, s0, e0, val, _unit, _dec in parse(text):
        if ref not in ("Current_AsOf", "Current_ForPeriod") or concept not in BY_CONCEPT:
            continue
        key = BY_CONCEPT[concept]
        out[key] = val
        if ref == "Current_ForPeriod" and s0:
            start = start or s0
            months[key] = round((dt.date.fromisoformat(e0) - dt.date.fromisoformat(s0)).days / 30.4)
        if ref == "Current_AsOf":
            end = e0
    if not out or not end:
        return None
    return {"s": start, "e": end, "v": out, "m": months}


def polite_get(url, pause=1.0):
    """One file from mayafiles, naming fox (Phase 3 network rules); a 403/429 stops the run instead of being retried around."""
    import urllib.error
    import urllib.request
    time.sleep(pause)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": fm.FOX_UA, "referer": "https://maya.tase.co.il/"}), timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise SystemExit(f"MAYA refused automated access ({e.code}); stopping") from e
        raise


def registry(download=False, root=None, quiet=False, full=False):
    """Standard-library pass over every quarterly/annual XBRL instance in documents.csv that exists locally (or, with download,
    is fetched): writes data/registry/xbrl_facts.json. Returns the registry dict."""
    root = Path(root) if root else fm.ROOT
    raw, out = root / "data" / "sources" / "xbrl", root / "data" / "registry" / "xbrl_facts.json"
    prev = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {"reports": {}}
    reports = dict(prev.get("reports", {}))
    with open(root / "data" / "registry" / "documents.csv", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if r["file_type"] == "xbrl" and r["doc_type"] in ("annual", "quarterly")]
    missing = 0
    for r in rows:
        rid = r["report_id"]
        f = raw / f"{r['company']}_{rid}.xbrl"
        if rid in reports and (not full or not f.exists()):
            continue  # parsed before (the instance itself is not in git); --full re-parses every local instance
        if not f.exists():
            if not download:
                missing += 1
                continue
            raw.mkdir(parents=True, exist_ok=True)
            f.write_bytes(polite_get(fm.FILES + r["url"]))
        try:
            x = instance(f.read_text(encoding="utf-8", errors="replace"))
        except ET.ParseError as e:
            print("parse error", f.name, e, file=sys.stderr)
            continue
        if x:
            x.pop("m", None)  # the form's contexts always say three months for a quarter (even where the value is year to date): no signal
            reports[rid] = {"c": r["company"], "dt": r["doc_type"], "p": r["period"], "pub": r["publish_date"][:10], **x}
    reg = {"built": dt.date.today().isoformat(), "source": "XBRL (טופס ת930) המצורף לכל דוח תקופתי, MAYA",
           "concepts": {k: c for k, (c, _, _) in T0_ALL.items()}, "kinds": {k: [kind, unit] for k, (_, kind, unit) in T0_ALL.items()},
           "reports": dict(sorted(reports.items(), key=lambda kv: (kv[1]["c"], kv[1]["e"], int(kv[0]))))}
    out.write_text(json.dumps(reg, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not quiet:
        print(len(reports), "instances in", out.relative_to(root), f"({missing} listed but not local)" if missing else "")
    return reg


def coverage(reg):
    """Which concepts each filer tags: {company: {key: [instances tagging it, instances]}}."""
    cov = {}
    for x in reg["reports"].values():
        c = cov.setdefault(x["c"], {"_n": 0})
        c["_n"] += 1
        for k in x["v"]:
            c[k] = c.get(k, 0) + 1
    return cov


def parse(text):
    root = ET.fromstring(text.lstrip("﻿"))
    ctx = {}
    for c in root.iter("{http://www.xbrl.org/2003/instance}context"):
        p = c.find("{http://www.xbrl.org/2003/instance}period")
        inst = p.findtext("{http://www.xbrl.org/2003/instance}instant")
        ctx[c.get("id")] = (p.findtext("{http://www.xbrl.org/2003/instance}startDate"), inst or p.findtext("{http://www.xbrl.org/2003/instance}endDate"))
    for el in root:
        ref = el.get("contextRef")
        if not ref or "ifrs-full" not in el.tag:
            continue
        try:
            val = float(el.text)
        except (TypeError, ValueError):
            continue
        start, end = ctx.get(ref, (None, None))
        yield re.sub(r"^\{.*\}", "", el.tag), ref, start, end, val, el.get("unitRef"), el.get("decimals")


def main():
    con = fm.connect()
    con.execute("""create table if not exists xbrl_facts (company varchar, report_id bigint, period varchar, doc_type varchar,
        concept varchar, context varchar, start_date date, end_date date, value double, unit varchar, decimals varchar,
        primary key (report_id, concept, context))""")
    todo = con.execute("""select report_id, company, period, doc_type, url from documents
        where file_type='xbrl' and doc_type in ('annual','quarterly') order by company, publish_date""").fetchall()
    RAW.mkdir(parents=True, exist_ok=True)
    n = 0
    for rid, comp, per, dt, url in todo:
        f = RAW / f"{comp}_{rid}.xbrl"
        if not f.exists():
            f.write_bytes(fm.http(fm.FILES + url, binary=True))
            time.sleep(fm.PAUSE)
        try:
            facts = list(parse(f.read_text(encoding="utf-8", errors="replace")))
        except ET.ParseError as e:
            print("parse error", f.name, e, file=sys.stderr)
            continue
        for concept, ref, start, end, val, unit, dec in facts:
            con.execute("insert or replace into xbrl_facts values (?,?,?,?,?,?,?,?,?,?,?)", [comp, rid, per, dt, concept, ref, start, end, val, unit, dec])
        n += 1
    print(n, "instances;", con.execute("select count(*) from xbrl_facts").fetchone()[0], "facts")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--registry", action="store_true", help="standard library: local instances -> data/registry/xbrl_facts.json")
    ap.add_argument("--download", action="store_true", help="with --registry: fetch instances missing locally")
    ap.add_argument("--coverage", action="store_true", help="with --registry: print which concepts each filer tags")
    ap.add_argument("--full", action="store_true", help="with --registry: re-parse instances already in the registry")
    ap.add_argument("--root", help="with --registry: another copy of the insurance-dashboard layout (instances under data/sources/xbrl)")
    a = ap.parse_args()
    if a.registry:
        reg = registry(download=a.download, full=a.full, root=a.root)
        if a.coverage:
            cov = coverage(reg)
            keys = list(T0_ALL)
            print("concept".ljust(14), *[c[:6].ljust(6) for c in sorted(cov)])
            for k in keys:
                print(k.ljust(14), *[f"{cov[c].get(k, 0)}/{cov[c]['_n']}".ljust(6) for c in sorted(cov)])
    else:
        main()
