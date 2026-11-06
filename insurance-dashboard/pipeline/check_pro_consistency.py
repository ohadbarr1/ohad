"""Pro / analyst layer: the long tables (tables/v1/*.csv, the Excel feed) equal the JSON the pages read, figure for figure, and one metric
carries one number (or two labelled definitions) wherever it is served. Red team 06.11.26 (analyst persona): dividends, P&G profit and fees,
ROE, solvency ratio / target / surplus.

python3 pipeline/check_pro_consistency.py [--data <dir>] [--quiet]     (standard library only; reads web/public/data)
Exit code 1 on any failure. pipeline/gate.py runs it as the `pro_consistency` check.

  dividends   kpi.csv dividend_declared / dividend_paid are amounts (≥ 0 but for a ±0.5 rounding residue of FY − 9M), equal csm/capital.json
              (the /industry capital page, the capital builder) and series/<co>.json for the same company, period and slice, and every
              derived Q4 = FY − Q1 − Q2 − Q3 of the CSV rows themselves (the company page derives |FY| − |9M|: equal only when every sign is +).
  pg          every printed quarter the nowcast scores (nowcast.json backtest `act`: revenue and operating profit of the segments it covers)
              is in savings_q.csv under its own metric (managing_company|<seg>: fees_mc, op_mc) and equals lens.json; the group report's
              segment figures stay under fees / profit with a label that names the definition (profit before tax), never the same label.
  roe         expectations/index.json carries the reported LTM ROE beside the model's FY'28 ROE (`ltm` = expectations/<co>.json base.roe_ltm),
              and that LTM ROE (the valuation page's "now") equals the /pro and KPI-card ROE (lib/kpi.ts on kpi.json, mirrored by
              build_expectations.kpi_roe) within 0.05 pp; a difference that comes from a restated comparative equity (lines.json flag 8,
              labelled on the page) is listed, not failed.
  solvency    capital/options.json applies the board target the solvency report prints for that date (csm/solvency.json tg_wo / tgm_w),
              never a later one (that is `later`); its printed cross-check is the newest printed surplus over the target; capital/forward.json
              uses the same target and its headroom on own funds after capital actions equals the printed surplus (sut_wo) within 1.0;
              solvency.csv (solvency_report slice) equals csm/solvency.json for the ratio, the targets and the surpluses.
"""
import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_expectations import kpi_roe  # noqa: E402  (the Python mirror of lib/kpi.ts value('roe'))

ROOT = Path(__file__).resolve().parent.parent
TOL = 0.001          # NIS m: the same stored figure on both sides
ROE_TOL = 0.05       # pp
SOLV_KEYS = ("sr_w", "sr_wo", "sra_w", "sra_wo", "tg_wo", "tgm_w", "su_w", "su_wo", "sua_w", "sua_wo", "sut_wo", "sut_w")


def rows_of(path):
    with open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def per_key(p):
    """table period (2025Q4 / 2025FY) -> the JSON period keys (series / capital.json use 2025Q4 for Q4 and 2025FY for the year)"""
    return p


def dividends(D, bad, note):
    kpi = [r for r in rows_of(D / "tables" / "v1" / "kpi.csv") if r["metric_id"].startswith(("dividend_declared", "dividend_paid"))]
    cap = json.loads((D / "csm" / "capital.json").read_text(encoding="utf-8"))["companies"]
    series = {}
    n = 0
    by = {}
    for r in kpi:
        n += 1
        v = float(r["value"])
        key = f"{r['entity_id']} {r['dim_id']} {r['metric_id']} {r['period']}"
        if v < -0.5:
            bad.append(("dividends", f"{key}: {v:g} is negative (a dividend is an amount)"))
        by[(r["entity_id"], r["dim_id"], r["metric_id"], r["period"])] = (v, r["kind"])
        if r["dim_id"] == "group|na" and r["metric_id"] in ("dividend_declared", "dividend_paid"):
            c = cap.get(r["entity_id"], {}).get(r["metric_id"], {}).get(r["period"])
            if c is not None and abs(c["v"] - v) > TOL:
                bad.append(("dividends", f"{key}: kpi.csv {v:g} ≠ csm/capital.json {c['v']:g}"))
            if r["entity_id"] not in series:
                f = D / "series" / f"{r['entity_id']}.json"
                series[r["entity_id"]] = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"rows": []}
            s = next((x for x in series[r["entity_id"]]["rows"] if x["m"] == r["metric_id"] and x["s"] == "group" and x["b"] == "na"), None)
            sv = (s or {}).get("vals", {}).get(r["period"])
            if sv is not None and abs(sv["v"] - v) > TOL:
                bad.append(("dividends", f"{key}: kpi.csv {v:g} ≠ series {sv['v']:g}"))
    for (co, dim, m, p), (v, kind) in by.items():
        if not p.endswith("Q4") or kind != "derived":
            continue
        y = p[:4]
        parts = [by.get((co, dim, m, f"{y}{x}"), (None,))[0] for x in ("FY", "Q1", "Q2", "Q3")]
        if None in parts:
            continue  # a quarter the series does not carry (Q4 = FY − 9M of the reports): checked through the sign rule above
        exp = math.fsum([parts[0]] + [-x for x in parts[1:]])
        # the company page: |FY| − |9M|, i.e. the same number only when every printed figure carries one sign
        page = abs(parts[0]) - math.fsum(abs(x) for x in parts[1:])
        if abs(exp - v) > TOL or abs(page - v) > 0.5:
            bad.append(("dividends", f"{co} {dim} {m} {p}: Q4 {v:g} vs FY − Q1 − Q2 − Q3 = {exp:g} (page |FY| − |9M| = {page:g})"))
    note.append(f"dividends {n} rows")
    return n


def pg(D, bad, note):
    sq = rows_of(D / "tables" / "v1" / "savings_q.csv")
    lens = json.loads((D / "lens.json").read_text(encoding="utf-8"))
    nc = json.loads((D / "nowcast.json").read_text(encoding="utf-8"))
    gid = {i: g.get("id") for i, g in enumerate(lens["groups"])}
    L = {(gid[x["g"]], x["s"], x["q"]): x for x in lens["rows"]}
    mc = {(r["entity_id"], r["dim_id"].split("|", 1)[1], r["metric_id"], r["period"]): float(r["value"]) for r in sq if r["dim_id"].startswith("managing_company|")}
    n = 0
    for b in nc.get("backtest", []):
        a = b.get("act")
        if not a:
            continue
        segs = sorted((b.get("s2") or b.get("s1") or {}).get("segs", {}))
        q, y = b["q"][1], b["q"][3:]
        p = f"{y}Q{q}"
        for fld, key in (("rev", "fees_mc"), ("op", "op_mc")):
            if a.get(fld) is None:
                continue
            n += 1
            got = [mc.get((b["c"], s, key, p)) for s in segs]
            if None in got:
                bad.append(("pg", f"{b['c']} {p} {key}: the nowcast's actual {a[fld]:g} ({'+'.join(segs)}) is not in savings_q.csv"))
                continue
            if abs(math.fsum(got) - a[fld]) > 0.01:
                bad.append(("pg", f"{b['c']} {p} {key}: savings_q.csv {math.fsum(got):g} ≠ nowcast actual {a[fld]:g}"))
            for s, g in zip(segs, got):
                lr = (L.get((b["c"], s, b["q"])) or {}).get("rep") or {}
                lv = lr.get("fees" if fld == "rev" else "op")
                if lv is not None and abs(lv - g) > TOL:
                    bad.append(("pg", f"{b['c']} {p} {s} {key}: savings_q.csv {g:g} ≠ lens.json {lv:g}"))
    labels = {}
    for r in sq:
        labels.setdefault(r["metric_id"], set()).add(r["metric_label"])
    for m, must in (("profit", "לפני מס"), ("op_mc", "רווח תפעולי"), ("fees_mc", "החברה המנהלת")):
        if m in labels and not all(must in x for x in labels[m]):
            bad.append(("pg", f"savings_q.csv {m}: label {sorted(labels[m])[0]!r} does not name its definition ({must})"))
    if labels.get("fees") and labels.get("fees_mc") and labels["fees"] & labels["fees_mc"]:
        bad.append(("pg", "savings_q.csv: fees and fees_mc share a label"))
    note.append(f"P&G {n} scored figures")
    return n


def roe(D, bad, note, exc):
    idx = json.loads((D / "expectations" / "index.json").read_text(encoding="utf-8"))
    kpi = json.loads((D / "kpi.json").read_text(encoding="utf-8"))["companies"]
    lines = json.loads((D / "lines.json").read_text(encoding="utf-8"))
    LP = [tuple(x) for x in lines["periods"]]
    n = 0
    for c in idx["companies"]:
        if c["status"] != "ok":
            continue
        part = next((p for p in c.get("parts", []) if p["k"] == "roe"), None)
        co = json.loads((D / "expectations" / f"{c['id']}.json").read_text(encoding="utf-8"))
        ltm = co["base"]["roe_ltm"]["v"]
        n += 1
        if part is None or part.get("ltm") is None:
            bad.append(("roe", f"{c['id']}: the index shows only the model's FY'28 ROE ({(part or {}).get('trail')}) without the LTM ROE {ltm:.1f}%"))
        elif abs(part["ltm"] - ltm) > 1e-6:
            bad.append(("roe", f"{c['id']}: index ltm {part['ltm']:.2f} ≠ company file {ltm:.2f}"))
        k = kpi.get(c["id"])
        if not k or k.get("filer"):
            continue
        rs = kpi_roe(k)
        q = co["base"]["q"]  # Q2'26
        pk = f"20{q[-2:]}Q{q[1]}"
        x = next((r for r in rs if r[0] == pk), None)
        if not x:
            continue
        if abs(x[1] - ltm) > ROE_TOL:
            # labelled: the statements' comparative equity a year back is a restated figure (flag 8), the XBRL keeps the original
            cell = next((cl for cl in (lines["data"].get("equity_attr", {}).get(c["id"]) or {}).get("cells", [])
                         if LP[cl[0]] == ("I", f"{int(pk[:4]) - 1}-{ {'1': '03-31', '2': '06-30', '3': '09-30'}.get(pk[5], '12-31')}")), None)
            if cell and cell[4] & 8:
                exc.append(("roe", f"{c['id']} {q}: {ltm:.2f}% (statements, restated comparative equity) vs {x[1]:.2f}% (XBRL as first filed), labelled"))
            else:
                bad.append(("roe", f"{c['id']} {q}: valuation LTM ROE {ltm:.2f}% ≠ /pro LTM ROE {x[1]:.2f}%"))
    note.append(f"ROE {n} companies")
    return n


def solvency(D, bad, note):
    S = json.loads((D / "csm" / "solvency.json").read_text(encoding="utf-8"))
    O = json.loads((D / "capital" / "options.json").read_text(encoding="utf-8"))
    n = 0
    for c in O["companies"]:
        if c.get("status") != "ok":
            continue
        rows = S["companies"].get(c["id"], {})
        row = rows.get(c["date"], {})
        for k in c["constraints"]:
            if k["kind"] != "board":
                continue
            cell = row.get("tg_wo" if k["basis"] == "wo" else "tgm_w")
            n += 1
            if cell and abs(cell["v"] - k["t"]) > 1e-9:
                bad.append(("solvency", f"{c['id']} {k['id']}: target {k['t']:g}% applied to the {c['period']} figures, the solvency report prints {cell['v']:g}%"
                                        + (" (a later target belongs in `later`)" if not k.get("later") else "")))
        po = (c.get("dividend") or {}).get("printed_over")
        newest = max((d for d, r in rows.items() if any(f"sut_{b}" in r for b in ("wo", "w"))), default=None)
        if newest and (not po or po["d"] < newest):
            bad.append(("solvency", f"{c['id']}: the printed surplus over the target quoted is of {po and po['d']}, the solvency report prints one for {newest}"))
    F = D / "capital" / "forward.json"
    if F.exists():
        for c in json.loads(F.read_text(encoding="utf-8"))["companies"]:
            if c.get("status") != "ok":
                continue
            row = S["companies"].get(c["id"], {}).get(c["date"], {})
            opt = next((o for o in O["companies"] if o["id"] == c["id"] and o.get("status") == "ok"), None)
            for k in c.get("constraints", []):
                if k["id"] != "board_wo":
                    continue
                n += 1
                if opt and opt.get("date") == c["date"]:
                    ok_ = next((x for x in opt["constraints"] if x["id"] == "board_wo"), None)
                    if ok_ and abs(ok_["t"] - k["t"]) > 1e-9:
                        bad.append(("solvency", f"{c['id']}: board target without transitional {ok_['t']:g}% (options) vs {k['t']:g}% (forward), same date {c['date']}"))
                # a target printed to 0.1 pp ("approx. 116.9%") moves the surplus by up to SCR × 0.05%: that much is rounding
                tol = 1.0 + (row["scr_wo"]["v"] * 0.0005 if "scr_wo" in row and not float(k["t"]).is_integer() else 0.0)
                if "sut_wo" in row and k.get("of_after_actions") and abs(k["head"]["v"] - row["sut_wo"]["v"]) > tol:
                    bad.append(("solvency", f"{c['id']}: surplus over the target {k['head']['v']:.1f} (forward) vs printed {row['sut_wo']['v']:.1f}"))
    tab = [r for r in rows_of(D / "tables" / "v1" / "solvency.csv") if r["dim_id"] == "solvency_report" and r["metric_id"] in SOLV_KEYS]
    seen = 0
    for r in tab:
        d = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31"}.get(r["period"][4:])
        if not d:
            continue
        cell = S["companies"].get(r["entity_id"], {}).get(f"{r['period'][:4]}-{d}", {}).get(r["metric_id"])
        if cell is None:
            continue
        seen += 1
        if abs(cell["v"] - float(r["value"])) > TOL:
            bad.append(("solvency", f"{r['entity_id']} {r['period']} {r['metric_id']}: solvency.csv {r['value']} ≠ csm/solvency.json {cell['v']:g}"))
    note.append(f"solvency {n} constraints, {seen} table cells")
    return n + seen


def run(data=None, quiet=False):
    D = Path(data) if data else ROOT / "web" / "public" / "data"
    bad, note, exc = [], [], []
    n = dividends(D, bad, note) + pg(D, bad, note) + roe(D, bad, note, exc) + solvency(D, bad, note)
    summary = f"pro_consistency: {n} comparisons ({'; '.join(note)}); {len(exc)} labelled exceptions; {len(bad)} failures"
    if not quiet:
        for x in bad:
            print("FAIL", *x)
        for x in exc:
            print("EXC ", *x)
        print(summary)
    return n, bad, exc, summary


if __name__ == "__main__":
    a = sys.argv[1:]
    data = a[a.index("--data") + 1] if "--data" in a else None
    n, bad, exc, summary = run(data, quiet="--quiet" in a)
    if "--quiet" in a:
        print(summary)
    sys.exit(1 if bad else 0)
