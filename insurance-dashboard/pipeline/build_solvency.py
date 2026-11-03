"""The economic-solvency (Solvency II) reports, one line per insurer, date and measure: web/public/data/csm/solvency.json

Input : data/extracted_solvency/<company>/<period>.json (extraction spec v8, pipeline/EXTRACT_SPEC.md; every value verified on its page)
        data/registry/documents.csv (report id -> PDF path, publication date)
Nothing is computed here. Several reports can print the same date (the comparative column of the next report, an amended filing):
the report whose own date it is wins, then the latest filing; a different value printed elsewhere is kept as `alt`.
Values read from a page image or a chart carry `i: 1` (shown as "נקרא מתמונה").
Since FY'25 most insurers attach the report to the next periodic report (Q1'26): its report id is then that quarterly filing and the page is
the page of that PDF. Also published (W10): `walks` (the regulator's capital-surplus movement table, section 7/8 of each report, as printed),
`deducted` (distributions the report says its calculation already deducts) and `latest` (per company: the newest calculation date, its
report and publication date: the vintage the pages label).

python3 pipeline/build_solvency.py   (run before build_csm.py, which merges the ratio, own funds, SCR and surplus into capital.json)
"""
import csv
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extracted_solvency"
OUT = ROOT / "web" / "public" / "data" / "csm" / "solvency.json"
FILES = "https://mayafiles.tase.co.il/"
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara"]
B = {"with_transitional": "w", "without_transitional": "wo"}
# measure -> short key; `*` takes the basis suffix (_w / _wo), others ignore basis (tiers and modules are printed once)
KEYS = {
    "solvency_ratio": "sr*", "own_funds": "of*", "scr": "scr*", "solvency_surplus": "su*",
    "solvency_ratio_after_capital_actions": "sra*", "own_funds_after_capital_actions": "ofa*", "solvency_surplus_after_capital_actions": "sua*",
    "target_solvency_ratio": "tg*", "target_solvency_ratio_min": "tgm*", "solvency_surplus_over_target": "sut*", "target_solvency_ratio_range": "tgr*",
    "capital_actions_after_date": "caa*", "pending_distribution_ratio_effect": "pde*", "regulatory_dividend_floor": "rdf*",
    "mcr": "mcr", "own_funds_for_mcr": "ofm", "mcr_ratio": "mcr_ratio",
    "own_funds_tier1": "t1", "own_funds_tier1_basic": "t1b", "own_funds_tier1_restricted": "t1r", "own_funds_tier2": "t2", "own_funds_tier3": "t3",
    "scr_market": "m_market", "scr_counterparty": "m_counterparty", "scr_life": "m_life", "scr_health": "m_health", "scr_nonlife": "m_nonlife",
    "scr_intangible": "m_intangible", "scr_diversification": "m_div", "scr_basic": "bscr", "scr_operational": "m_operational",
    "scr_adj_deferred_tax": "m_lac_dt", "scr_adj_technical_provisions": "m_lac_tp", "scr_equity_shock_transitional": "m_eq_tr",
    "scr_other": "m_managers", "scr_other:חברות מנהלות": "m_managers",
    "transitional_deduction_tp": "tdt", "economic_total_assets": "eco_assets", "economic_best_estimate_liabilities": "eco_be",
    "economic_risk_margin": "eco_rm", "economic_excess_assets": "eco_excess", "economic_total_liabilities": "eco_liab",
}
QEND = ("03-31", "06-30", "09-30", "12-31")


def risk_of(t):
    if re.search(r"ריבית", t):
        return "rate"
    if re.search(r"מניות|הוניים|מנייתי", t):
        return "equity"
    if re.search(r"תחלוא", t):
        return "morbidity"
    if re.search(r"תמות", t):
        return "mortality"
    if re.search(r"ביטול|פדיון", t):
        return "lapse"
    if re.search(r"הוצאות", t):
        return "expense"
    return "other"


WALK_STEPS = ("open", "neutralise", "open_wo", "operating", "economic", "new_business", "capital_actions", "tax_tiers", "close_wo", "transitional", "close")
WALK_TOL = 2.0   # NIS m: the printed rows foot (thousands rounded in the source)


def docs(ids=None):
    """the registry rows of the solvency reports, and of any other filing an extraction cites (a periodic report the solvency report is attached to)"""
    out = {}
    with open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["doc_type"] != "solvency" and not (ids and int(r["report_id"]) in ids):
                continue
            rid = int(r["report_id"])
            cur = out.get(rid)
            # the PDF is the page-addressable copy; the htm notice only when no PDF was filed
            if cur is None or (r["file_type"].startswith("pdf") and not cur["f"].endswith(".pdf")):
                out[rid] = {"f": r["url"], "pub": r["publish_date"][:10], "t": r["title"][:120]}
    return out


def walk_check(rows):
    """the identities of a printed walk: own funds − SCR = surplus on every row; opening + items = closing on each basis"""
    bad = []
    by = {r["step"]: r for r in rows}
    for r in rows:
        if all(k in r for k in ("of", "scr", "su")) and abs(r["of"] - r["scr"] - r["su"]) > WALK_TOL:
            bad.append(f"{r['step']}: own funds − SCR ≠ surplus")
    for comp in ("of", "scr", "su"):
        g = lambda k: by.get(k, {}).get(comp)
        if None in (g("open"), g("neutralise"), g("open_wo")) or abs(g("open") + g("neutralise") - g("open_wo")) > WALK_TOL:
            bad.append(f"{comp}: opening + neutralisation ≠ opening without transitional")
        mid = [g(k) for k in ("operating", "economic", "new_business", "capital_actions", "tax_tiers")]
        if None in mid or g("close_wo") is None or abs(g("open_wo") + sum(mid) - g("close_wo")) > WALK_TOL:
            bad.append(f"{comp}: opening + movements ≠ closing without transitional")
        if None in (g("close_wo"), g("transitional"), g("close")) or abs(g("close_wo") + g("transitional") - g("close")) > WALK_TOL:
            bad.append(f"{comp}: closing without + transitional effect ≠ closing")
    return bad


def main():
    ids = set()
    for c in INSURERS:
        for f in (SRC / c).glob("*.json"):
            rid = json.loads(f.read_text(encoding="utf-8")).get("report_id")
            if rid:
                ids.add(int(rid))
    reg = docs(ids)
    walks = defaultdict(lambda: defaultdict(dict))   # company -> date -> step -> row
    deducted = []
    cand = defaultdict(list)   # (company, date, key) -> [(rank, cell)]
    sens = defaultdict(list)
    reports, n_facts, skipped = {}, 0, Counter()
    img_pages = set()  # (report, page) with any value read from the page image: the flag is set per page (r2-ws5 finding 4)
    for c in INSURERS:
        for f in sorted((SRC / c).glob("*.json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            rid, as_of = d.get("report_id"), d.get("as_of")
            if not rid or not d.get("facts"):
                continue
            meta = reg.get(rid, {})
            reports[str(rid)] = {"c": c, "as_of": as_of, "f": meta.get("f"), "pub": meta.get("pub"), "e": re.sub(r"\s*\(.*$", "", d.get("entity", ""))[:60]}
            for x in d["facts"]:
                n_facts += 1
                dt = (x.get("date") or "")[:10]
                if dt[5:] not in QEND or x.get("segment") not in ("solo", None):
                    skipped["date/segment"] += 1
                    continue
                img = 1 if x.get("source") in ("image", "chart") else 0
                if img:
                    img_pages.add((rid, x.get("page_he")))
                rank = (dt == as_of, rid)
                if x["metric"] == "solvency_movement":
                    row = walks[c][dt].setdefault(x["step"], {"step": x["step"], "l": x.get("label", "")[:90], "r": rid, "pg": x.get("page_he"), "from": x.get("window_from")})
                    row[x["component"]] = x["value"]
                    if x.get("note"):
                        row["n"] = x["note"][:200]
                    continue
                if x["metric"] == "dividend_deducted_in_ratio":
                    deducted.append({"c": c, "d": as_of, "v": x["value"], "dd": dt, "l": x.get("label", "")[:240], "r": rid, "pg": x.get("page_he")})
                    continue
                if x["metric"] == "solvency_sensitivity":
                    if x.get("value") is None:
                        continue
                    lab = re.sub(r"\s*\([א-ת]\)\s*$", "", x.get("label", "")).strip()
                    lab = re.sub(r"(\d)([א-ת])", r"\1 \2", re.sub(r"%(?=[א-ת])", "% ", lab))
                    sens[(c, dt, lab, B.get(x["basis"], "na"))].append((rank, {"c": c, "d": dt, "l": lab[:90], "risk": risk_of(lab), "b": B.get(x["basis"], "na"),
                                                                              "v": x["value"], "r": rid, "pg": x.get("page_he"), **({"i": 1} if img else {})}))
                    continue
                k = KEYS.get(x["metric"])
                if not k:
                    skipped[x["metric"]] += 1
                    continue
                if k.endswith("*"):
                    b = B.get(x["basis"])
                    if not b:
                        skipped[f"{x['metric']} basis na"] += 1
                        continue
                    k = f"{k[:-1]}_{b}"
                v = x.get("value")
                cell = {"v": v if v is not None else x.get("value_low"), "r": rid, "pg": x.get("page_he"), "l": (x.get("label") or "")[:90]}
                if cell["v"] is None:
                    continue
                if v is None and x.get("value_high") is not None:
                    cell["hi"] = x["value_high"]
                if x.get("note") and k.startswith(("tg", "pde", "of", "sr", "rdf")):
                    cell["n"] = x["note"][:200]
                if img:
                    cell["i"] = 1
                cand[(c, dt, k)].append((rank, cell))
    for cs in list(cand.values()) + list(sens.values()):
        for _, cell in cs:
            if (cell["r"], cell["pg"]) in img_pages:
                cell["i"] = 1
    comp = defaultdict(lambda: defaultdict(dict))
    n_alt = 0
    for (c, dt, k), cs in cand.items():
        cs.sort(key=lambda t: t[0], reverse=True)
        best = dict(cs[0][1])
        # tiers and modules: the with-transitional row first when a report prints both (the extraction keeps the basis on the cell's label)
        alt = next((y for _, y in cs[1:] if abs(y["v"] - best["v"]) > (0.5 if k.startswith(("sr", "tg")) else 1.5)), None)
        if alt:
            best["alt"] = {"v": alt["v"], "r": alt["r"], "pg": alt["pg"]}
            n_alt += 1
        comp[c][dt][k] = best
    srows = []
    for _, cs in sens.items():
        cs.sort(key=lambda t: t[0], reverse=True)
        srows.append(cs[0][1])
    srows.sort(key=lambda r: (r["c"], r["d"], r["risk"], r["l"]))
    W, wbad = {}, []
    for c in INSURERS:
        for dt, steps in sorted(walks.get(c, {}).items()):
            rows = [steps[k] for k in WALK_STEPS if k in steps]
            bad = walk_check(rows)
            wbad += [f"{c} {dt} {b}" for b in bad]
            W.setdefault(c, {})[dt] = rows
    if wbad:
        raise SystemExit("solvency walk does not foot: " + "; ".join(wbad[:6]))
    latest = {}
    for c in INSURERS:
        ds = [d for d, m in comp.get(c, {}).items() if "sr_w" in m and d[5:] in ("06-30", "12-31")]
        if not ds:
            continue
        d = max(ds)
        r = comp[c][d]["sr_w"]["r"]
        latest[c] = {"d": d, "r": r, "pub": reports.get(str(r), {}).get("pub")}
    out = {"built": date.today().isoformat(), "source": "דוחות כושר פירעון כלכלי (Solvency II) של חברות הביטוח, MAYA; חולץ ונבדק מול העמוד",
           "files": FILES, "reports": reports,
           "companies": {c: dict(sorted(comp[c].items())) for c in INSURERS if comp.get(c)}, "sens": srows,
           "walks": W, "deducted": sorted(deducted, key=lambda x: (x["c"], x["dd"])), "latest": latest}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    cov = {c: len([d for d, m in comp[c].items() if "sr_w" in m or "sr_wo" in m]) for c in INSURERS}
    print(f"solvency.json: {len(reports)} reports, {n_facts} facts -> {sum(len(m) for c in comp for m in comp[c].values())} cells, "
          f"{len(srows)} sensitivities, {sum(len(v) for v in W.values())} walks, {n_alt} with a different value elsewhere; dates with a ratio {cov}; skipped {dict(skipped)}; "
          f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
