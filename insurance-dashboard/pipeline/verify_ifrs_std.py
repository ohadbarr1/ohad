"""Check an IFRS 17 portfolio-note or investment-house extraction against the page text, and its arithmetic.

    python3 pipeline/verify_ifrs_std.py <file.json | company dir> [--txt <root of page text: <root>/<report_id>/pNNN.txt>]

1. every value is printed on its cited page (the page's numbers, as printed, absolute value; unit as printed);
2. the identities of the tables (warnings): portfolios add up to the total column; BE + RA + CSM = total; LRC + LC + LIC (+ receivables)
   = total; revenue less expenses = result before reinsurance; that result plus the reinsurance result = the insurance service result;
   house segments add up to the reported total.
Exit 1 when a value is not on its page; identity breaks are printed for the extractor to explain in `note` or fix by re-reading the page.
Standard library only (EXTRACT_SPEC.md v10 / v11).
"""
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

TXT = os.environ.get("FOX_TXT", "")
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def page_numbers(path):
    t = Path(path).read_text(encoding="utf-8", errors="replace")
    t = re.sub(r"[‎‏‪-‮⁦-⁩]", "", t)
    out = set()
    for m in NUM.finditer(t):
        s = m.group(0).rstrip(".,").replace(",", "")
        try:
            out.add(round(abs(float(s)), 6))
        except ValueError:
            pass
    return out


def report_id(doc, d):
    m = re.search(r"(\d{6,8})", str(doc or ""))
    return m.group(1) if m else str(d.get("report_id_he") or d.get("report_id") or "")


def check_file(f, txt):
    d = json.loads(Path(f).read_text(encoding="utf-8"))
    bad, cache = [], {}
    for i, x in enumerate(d.get("facts", [])):
        v = x.get("value")
        if v is None:
            continue
        rid = report_id(x.get("doc"), d)
        pg = x.get("page_he") or x.get("page")
        if not rid or not pg:
            bad.append(f"#{i} {x.get('metric')}: no report id or page")
            continue
        p = Path(txt) / rid / f"p{int(pg):03d}.txt"
        if not p.exists():
            bad.append(f"#{i} {x.get('metric')}: page text missing {p}")
            continue
        if p not in cache:
            cache[p] = page_numbers(p)
        if round(abs(float(v)), 6) not in cache[p] and x.get("source") not in ("chart",):
            bad.append(f"#{i} {x.get('metric')} {x.get('segment')}/{x.get('portfolio')} {x.get('date')} {x.get('window')}: {v} not on p{pg} of {rid}")
    return d, bad


def tol(n):
    return 1.0 + 0.5 * n


def identities(d):
    warn = []
    cell = defaultdict(dict)
    for x in d.get("facts", []):
        if x.get("value") is None:
            continue
        k = (x.get("segment"), x.get("window"), x.get("date"), x.get("basis", "na"))
        cell[k].setdefault(x.get("portfolio") or "total", {})[x["metric"]] = float(x["value"])
    for k, ports in cell.items():
        tot = ports.get("total", {})
        subs = {p: m for p, m in ports.items() if p != "total"}
        # portfolios add up to the total column (only for metrics every portfolio prints)
        for m, tv in tot.items():
            vals = [s[m] for s in subs.values() if m in s]
            if len(subs) >= 2 and len(vals) == len(subs) and abs(sum(vals) - tv) > tol(len(vals)):
                warn.append(f"{k} {m}: portfolios add to {sum(vals):g}, total {tv:g}")
        for p, m in ports.items():
            def g(*names):
                for n in names:
                    if n in m:
                        return m[n]
                return None
            be, ra, csm, tl = g("be"), g("ra"), g("csm"), g("total_by_components")
            if None not in (be, ra, csm, tl) and abs(be + ra + csm - tl) > tol(3):
                warn.append(f"{k} {p}: BE+RA+CSM = {be + ra + csm:g} vs {tl:g}")
            lrc, lc, lic, tb = g("lrc_excl_lc"), g("loss_component"), g("lic"), g("total_by_coverage")
            if None not in (lrc, lic, tb) and abs(lrc + (lc or 0) + lic - tb) > tol(3):
                warn.append(f"{k} {p}: LRC+LC+LIC = {lrc + (lc or 0) + lic:g} vs {tb:g}")
            rev, exp, isb = g("insurance_revenue"), g("insurance_service_expenses"), g("isr_before_reinsurance")
            if None not in (rev, exp, isb) and abs(abs(rev) - abs(exp) - isb) > tol(2):
                warn.append(f"{k} {p}: revenue {rev:g} - expenses {exp:g} != {isb:g}")
            rr, isr = g("reinsurance_result"), g("insurance_service_result")
            if None not in (isb, rr, isr) and abs(isb + rr - isr) > tol(2):
                warn.append(f"{k} {p}: before-reinsurance {isb:g} + reinsurance {rr:g} != {isr:g}")
            # houses: segment revenue / profit add up to the total row
    seg = defaultdict(lambda: defaultdict(dict))
    for x in d.get("facts", []):
        if x.get("value") is not None and x["metric"] in ("segment_revenue", "segment_profit") and x.get("window"):
            seg[(x["metric"], x["window"], x["date"])][x.get("segment")] = float(x["value"])
    for (m, w, dt), s in seg.items():
        if "total" in s and len(s) > 2:
            parts = [v for k2, v in s.items() if k2 not in ("total", "adjustments", "unallocated")]
            adj = sum(v for k2, v in s.items() if k2 in ("adjustments", "unallocated"))
            if abs(sum(parts) + adj - s["total"]) > tol(len(parts)):
                warn.append(f"{m} {w} {dt}: segments add to {sum(parts) + adj:g}, total {s['total']:g}")
    return warn


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    txt = TXT
    if "--txt" in argv:
        txt = argv[argv.index("--txt") + 1]
        args = [a for a in args if a != txt]
    if not txt:
        sys.exit("give --txt <page text root> or FOX_TXT")
    files = []
    for a in args:
        p = Path(a)
        files += sorted(p.glob("*.json")) if p.is_dir() else [p]
    failed = 0
    for f in files:
        d, bad = check_file(f, txt)
        w = identities(d)
        n = sum(1 for x in d.get("facts", []) if x.get("value") is not None)
        print(f"{f}: {n} values, {len(bad)} not on page, {len(w)} identity warnings")
        for b in bad[:60]:
            print("  NOT ON PAGE", b)
        for x in w[:60]:
            print("  IDENTITY", x)
        failed += bool(bad)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
