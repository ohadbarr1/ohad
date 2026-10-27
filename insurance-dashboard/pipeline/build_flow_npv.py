"""Flow economics (M3): the net present value of the operating profit that a manager's net transfers (ניוד) and net organic flow carry.

Input : web/public/data/lens.json        the Savings Lens (pipeline/build_lens.py): quarter flows (regulator), fee yield and cost/income
        web/public/data/market.json      regulator withdrawals per month x product x group (for the default duration)
        web/public/data/lts.json         gross transfers out per manager and quarter, from the managers' reports (default duration)
        web/public/data/macro/macro.json BoI 10-year nominal zero-coupon yield (the risk-free rate of ke)
Output: web/public/data/flow_npv.json

python3 pipeline/build_flow_npv.py           build
python3 pipeline/build_flow_npv.py --check   rebuild in memory, compare with the file on disk, and re-verify: inputs present, every NPV equals its
                                             formula, NPV sign = flow sign x margin sign, LTM flow = the sum of its quarters, no NaN, ke constants
                                             = web/src/lib/valuation.ts ASSUME0 (exit 1 on any miss)

The formula (one, for every manager, product and period):
    m      = fy x (1 - ci / 100)                    operating margin on assets, % a year. fy and ci are the lens's own derivations:
                                                    fy = fee income x 4 / regulator average assets x 100 (lens fy_reg), ci = (S&M + G&A) / fees x 100
                                                    (lens ci). LTM: the same formulas over the four quarters' sums (fy = sum fees / (sum avg / 4) x 100).
    a(D,k) = (1 - (1 + k)^-D) / k                   annuity factor: D years of the margin, paid at each year end, discounted at k = ke / 100
                                                    (fractional D allowed: the same closed form)
    NPV    = F x m / 100 x a(D, k)                  F = the period's net flow, NIS millions (a quarter: the quarter's flow; LTM: the four quarters' sum)
Assumptions (labelled estimates, overridable on the page):
    D  (per product) = sum avg assets / sum (withdrawals + gross transfers out), LTM, over the managers that print transfers out: the tenure
                       implied by the outflow rate. Withdrawals: regulator (WITHDRAWLS); transfers out: the managers' reports ("העברות צבירה מהקרן",
                       gross, which includes switches between a manager's own tracks where the report does not net them).
    ke = rf + beta x ERP, rf = the latest monthly BoI 10Y nominal zero-coupon yield, beta 1 and ERP 6%: the valuation page's ASSUME0.
Not modelled: investment growth of the balance, fee compression, tax, the marginal (vs average) cost of the acquired assets. Units: NIS millions;
rates percent. Products: pension and provident (gemel + hishtalmut). Managers' insurance (bituach-net) publishes no flows: not computed.
"""
import datetime as dt
import json
import math
import re
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "flow_npv.json"
VALUATION_TS = ROOT / "web" / "src" / "lib" / "valuation.ts"
BETA, ERP = 1.0, 6.0  # web/src/lib/valuation.ts ASSUME0 (beta 1, erp 6); --check fails when they differ
SEGS = {"pen": {"label": "פנסיה", "fam": "pension", "ds": "pensia"}, "gem": {"label": "גמל והשתלמות", "fam": "gemel", "ds": "gemel"}}
OTHERS = "קרנות ענפיות ואחרות"


def r(x, d):
    return None if x is None else round(x, d)


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def qprev(q, k=1):
    """'Q2-2026' -> the key k quarters earlier"""
    n, y = int(q[1]), int(q[3:])
    t = y * 4 + n - 1 - k
    return f"Q{t % 4 + 1}-{t // 4}"


def annuity(D, ke):
    k = ke / 100
    return D if k == 0 else (1 - (1 + k) ** -D) / k


def npv(F, m, a):
    return None if F is None or m is None else F * m / 100 * a


def load(p):
    return json.loads((WEB / p).read_text(encoding="utf8"))


def build():
    lens, mkt, lts, macro = load("lens.json"), load("market.json"), load("lts.json"), load("macro/macro.json")
    G = [x["name"] for x in lens["groups"]]
    last = lens["meta"]["last_rep"]
    by = {(x["g"], x["s"], x["q"]): x for x in lens["rows"] if x["s"] in SEGS}
    ltm_q = [qprev(last, k) for k in (3, 2, 1, 0)]

    # ---- ke: the valuation page's assumptions over the latest BoI 10Y nominal zero-coupon month
    n10 = macro["series"]["nom10"]
    rf_month, rf = n10["months"][-1]
    ke = rf + BETA * ERP

    # ---- default duration per product: avg assets / (withdrawals + gross transfers out), LTM, over the managers that print transfers out
    P, prods = mkt["periods"], mkt["products"]
    pidx = {p: i for i, p in enumerate(P)}
    ins = {i for i, x in enumerate(prods) if x["family"] == "insurance"}
    fam_of = {i: x["family"] for i, x in enumerate(prods)}
    cell = {}
    for row in mkt["rows"]:
        pi, prod, g, a, dep, wd, tr, fa = row[:8]
        for s, sd in SEGS.items():
            if fam_of[prod] != sd["fam"]:
                continue
            c = cell.setdefault((g, s, P[pi]), [0.0, 0.0, 0.0])
            c[1] += wd; c[2] += fa
            if prod not in ins:
                c[0] += a
    F_lts = {(m_, c_, p_): v for m_, c_, p_, v, sl in lts["facts"] if sl == 0}
    res = {ds: next((x for x in mkt["meta"]["resources"][ds] if "2024" in x["name"]), None) for ds in ("pensia", "gemel")}
    dur = {}
    for s, sd in SEGS.items():
        rows = []
        e_last = None
        for g, name in enumerate(G):
            qs = [by.get((g, s, q)) for q in ltm_q]
            if not all(qs) or not qs[-1].get("rep"):
                continue
            c = qs[-1]["rep"]["c"]
            tro = [F_lts.get((f"{s}.tr_out", c, q)) for q in ltm_q]
            avg = [x["reg"]["avg"] for x in qs]
            months = [madd(x["reg"]["e"], k) for x in qs for k in (-2, -1, 0)]
            wdm = []
            for p in months:
                cc = cell.get((g, s, p))
                wdm.append(cc[1] if cc and cc[0] > 0 and cc[2] >= 0.98 * cc[0] else None)
            if any(v is None for v in tro + avg + wdm):
                continue
            e_last = qs[-1]["reg"]["e"]
            wd, out = fsum(wdm), fsum(tro) * 1000  # transfers out: NIS billions in lts.json
            mean_avg = fsum(avg) / 4
            rows.append({"g": g, "c": c, "avg": [r(v, 1) for v in avg], "mean": r(mean_avg, 1), "wdm": [r(v, 2) for v in wdm], "wd": r(wd, 1),
                         "tro": [r(v, 4) for v in tro], "out": r(out, 1), "d": r(mean_avg / (wd + out), 3) if wd + out > 0 else None})
        A = fsum(x["mean"] for x in rows)
        W = fsum(x["wd"] for x in rows)
        O = fsum(x["out"] for x in rows)
        months = [madd(madd(e_last, -11), k) for k in range(12)] if e_last else []
        dur[s] = {"v": r(A / (W + O), 2) if rows and W + O > 0 else None, "avg": r(A, 1), "wd": r(W, 1), "out": r(O, 1),
                  "wd_rate": r(W / A * 100, 3) if A else None, "out_rate": r(O / A * 100, 3) if A else None, "n": len(rows),
                  "q": ltm_q, "months": months, "groups": rows,
                  "res": {"id": res[sd["ds"]]["id"], "name": res[sd["ds"]]["name"], "pkg": mkt["meta"]["packages"][sd["ds"]]} if res[sd["ds"]] else None}

    # ---- rows: every manager x product x quarter, and LTM at every quarter end with four quarters behind it
    out_rows = []
    for (g, s, q), x in sorted(by.items(), key=lambda kv: (kv[0][1], lens["quarters"].index(kv[0][2]), kv[0][0])):
        if G[g] == OTHERS:
            continue
        D = dur[s]["v"]
        a = annuity(D, ke) if D else None
        rp = x.get("rep") or {}
        base = {"g": g, "s": s, "c": rp.get("c"), "mark": x.get("mark")}
        # the quarter
        fy, ci = x.get("fy_reg"), x.get("ci")
        m = fy * (1 - ci / 100) if fy is not None and ci is not None else None
        tr, org = x["reg"]["tr"], x["reg"]["org"]
        out_rows.append({**base, "p": q, "qs": [q], "fees": rp.get("fees"), "sm": rp.get("sm"), "ga": rp.get("ga"), "avg": x["reg"]["avg"],
                         "fy": fy, "ci": ci, "m": r(m, 6), "tr": tr, "org": org,
                         "npv_tr": r(npv(tr, m, a), 3) if a else None, "npv_org": r(npv(org, m, a), 3) if a else None})
        # LTM ending at this quarter
        qs = [qprev(q, k) for k in (3, 2, 1, 0)]
        xs = [by.get((g, s, k)) for k in qs]
        if not all(xs):
            continue
        reps = [y.get("rep") or {} for y in xs]
        def tot(f):
            vs = [f(y, rr) for y, rr in zip(xs, reps)]
            return None if any(v is None for v in vs) else fsum(vs)
        fees, sm, ga = (tot(lambda y, rr, k=k: rr.get(k)) for k in ("fees", "sm", "ga"))
        avg = tot(lambda y, rr: y["reg"]["avg"])
        trL, orgL = tot(lambda y, rr: y["reg"]["tr"]), tot(lambda y, rr: y["reg"]["org"])
        # rounded as the lens rounds its quarters, so the margin on the page reconciles with the fy and ci beside it
        fyL = r(fees * 4 / avg * 100, 4) if fees is not None and avg else None
        ciL = r((sm + ga) / fees * 100, 2) if fees and sm is not None and ga is not None else None
        mL = fyL * (1 - ciL / 100) if fyL is not None and ciL is not None else None
        out_rows.append({**base, "p": "LTM-" + q, "qs": qs, "fees": r(fees, 3), "sm": r(sm, 3), "ga": r(ga, 3), "avg": r(avg, 1),
                         "fy": fyL, "ci": ciL, "m": r(mL, 6), "tr": r(trL, 1), "org": r(orgL, 1),
                         "npv_tr": r(npv(trL, mL, a), 3) if a else None, "npv_org": r(npv(orgL, mL, a), 3) if a else None})
    for row in out_rows:
        if not row["mark"]:
            row.pop("mark")
    # ranks per product x period, 1 = the largest NPV
    for key in ("npv_tr", "npv_org"):
        grp = {}
        for row in out_rows:
            if row[key] is not None:
                grp.setdefault((row["s"], row["p"]), []).append(row)
        for xs in grp.values():
            xs.sort(key=lambda z: -z[key])
            for i, z in enumerate(xs):
                z["rk_" + key[4:]] = i + 1
                z["n_" + key[4:]] = len(xs)

    periods = ["LTM-" + q for q in lens["quarters"] if any(x["p"] == "LTM-" + q for x in out_rows)] + list(lens["quarters"])
    return {
        "meta": {"generated": dt.date.today().isoformat(), "asof": lens["meta"]["asof"], "last_rep": last, "ltm": "LTM-" + last,
                 "source_reg": lens["meta"]["source_reg"], "source_rep": lens["meta"]["source_rep"], "source_macro": n10["source"],
                 "formula": "NPV = F × m ÷ 100 × a(D, ke); m = fy × (1 − ci ÷ 100); a(D, ke) = (1 − (1 + ke)^−D) ÷ ke",
                 "ke": {"v": r(ke, 4), "rf": rf, "rf_month": rf_month, "rf_code": n10["code"], "rf_url": n10["url"], "rf_retrieved": n10["retrieved"],
                        "beta": BETA, "erp": ERP},
                 "units": {"flow": "NIS millions", "npv": "NIS millions", "rates": "percent", "D": "years"}},
        "segs": {s: d["label"] for s, d in SEGS.items()},
        "groups": G,
        "periods": periods,
        "dur": dur,
        "rows": out_rows,
    }


def verify(d):
    """the gate's view of the file: inputs present, formulas, signs, sums, finite numbers, the shared ke constants"""
    bad = []
    ke = d["meta"]["ke"]["v"]
    if not ke or not d["meta"]["ke"]["rf_month"]:
        bad.append(("input", "ke / rf missing"))
    for s in SEGS:
        du = d["dur"].get(s)
        if not du or not du["v"] or du["n"] < 3:
            bad.append(("input", f"duration {s}: {du and du['n']} managers"))
        elif abs(du["avg"] / (du["wd"] + du["out"]) - du["v"]) > 0.01:
            bad.append(("duration formula", s))
    if not any(x["p"] == d["meta"]["ltm"] and x["npv_tr"] is not None for x in d["rows"]):
        bad.append(("input", "no LTM NPV at the last reported quarter"))
    rows = {(x["g"], x["s"], x["p"]): x for x in d["rows"]}
    for x in d["rows"]:
        a = annuity(d["dur"][x["s"]]["v"], ke)
        if x["fy"] is not None and x["ci"] is not None and abs(x["fy"] * (1 - x["ci"] / 100) - x["m"]) > 1e-4:
            bad.append(("margin", x["g"], x["s"], x["p"]))
        for k in ("tr", "org"):
            v, F = x["npv_" + k], x[k]
            if v is None:
                if F is not None and x["m"] is not None:
                    bad.append(("npv missing", k, x["g"], x["s"], x["p"]))
                continue
            if abs(F * x["m"] / 100 * a - v) > 0.01 + 1e-6 * abs(v):
                bad.append(("npv formula", k, x["g"], x["s"], x["p"]))
            sgn = lambda z: (z > 0) - (z < 0)
            if sgn(v) != sgn(F) * sgn(x["m"]):
                bad.append(("npv sign", k, x["g"], x["s"], x["p"], F, x["m"], v))
        if x["p"].startswith("LTM-"):
            qs = [rows.get((x["g"], x["s"], q)) for q in x["qs"]]
            for k in ("tr", "org", "fees"):
                if x[k] is not None and (not all(qs) or abs(fsum(q[k] for q in qs) - x[k]) > 0.06):
                    bad.append(("LTM sum", k, x["g"], x["s"], x["p"]))

    def finite(v, path):
        if isinstance(v, float) and not math.isfinite(v):
            bad.append(("NaN", path))
        elif isinstance(v, dict):
            for k, y in v.items():
                finite(y, f"{path}.{k}")
        elif isinstance(v, list):
            for i, y in enumerate(v):
                finite(y, f"{path}[{i}]")
    finite(d, "")
    ts = VALUATION_TS.read_text(encoding="utf8")
    m = re.search(r"ASSUME0: Assume = \{([^}]*)\}", ts)
    kv = dict(re.findall(r"(\w+): ([\d.]+)", m.group(1))) if m else {}
    if float(kv.get("beta", "nan")) != BETA or float(kv.get("erp", "nan")) != ERP:
        bad.append(("ke constants differ from valuation.ts ASSUME0", kv))
    return bad


if __name__ == "__main__":
    d = build()
    bad = verify(d)
    n = sum(1 for x in d["rows"] if x["npv_tr"] is not None)
    if "--check" in sys.argv:
        if not OUT.exists():
            print("flow_npv.json missing")
            sys.exit(1)
        disk = json.loads(OUT.read_text(encoding="utf8"))
        d["meta"]["generated"] = disk["meta"]["generated"]
        same = disk == json.loads(json.dumps(d))
        print(f"flow_npv.json {'matches' if same else 'DIFFERS from'} a rebuild; {n} NPVs; {len(bad)} misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("misses:", bad[:20])
        sys.exit(1)
    OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    du = d["dur"]
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes, {len(d['rows'])} rows, {n} NPVs; ke {d['meta']['ke']['v']}%, "
          f"D pen {du['pen']['v']}y ({du['pen']['n']} managers), gem {du['gem']['v']}y ({du['gem']['n']} managers)")
