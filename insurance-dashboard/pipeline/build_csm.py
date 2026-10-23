"""The CSM ledger's own files, built from the per-report IFRS 17 facts that build_ifrs.py writes.

python3 pipeline/build_csm.py -> web/public/data/csm/{facts/<company>,summary,sens,rates,capital}.json

facts/<company>.json  every CSM movement, equity, solvency, capital-target and dividend fact of one insurer's reports, grouped by report
            period (values, signs and pages exactly as build_ifrs wrote them), its report files and the resolved CSM of every date.
summary.json  the insurers, report periods and the resolved CSM of every company and date (the one rule), for the industry pages.
sens.json   the sensitivity disclosures, normalised to risk · direction · size · effect · basis, each with its page.
rates.json  the discount rates the insurers print (spot, incl. illiquidity premium) by portfolio and tenor, each with its page.
Nothing is estimated here: a shock whose direction the report does not state keeps `dir: null`.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import csm_resolve  # noqa: E402
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "csm"

KEEP = re.compile(r"^(csm|equity_attributable$|solvency|own_funds|scr|target_|dividend|surplus|excess_capital)")


def risk_of(t):
    t = t.lower()
    if re.search(r"ריבית|interest", t):
        return "rate"
    if re.search(r"מניות|share|equity price|equity instrument", t):
        return "equity"
    if re.search(r"תחלוא|morbid", t):
        return "morbidity"
    if re.search(r"תמות|mortal", t):
        return "mortality"
    if re.search(r"ביטול|lapse|פדיון", t):
        return "lapse"
    if re.search(r"הוצאות|expense", t):
        return "expense"
    return "other"


def dir_of(t):
    if re.search(r"second .*column|header printed", t, re.I):
        return None  # the filer printed the same header twice: direction not stated
    up = re.search(r"עלייה|עליה|תוספת|increase|higher|\+\s?\d", t, re.I)
    down = re.search(r"ירידה|הפחתה|קיטון|decrease|reduction|lower|(^|\s)[-−]\s?\d", t, re.I)
    return 1 if up and not down else -1 if down and not up else None


def size_of(t):
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    return float(m.group(1)) if m else None


def effect_of(fx):
    f = (fx or "").lower()
    if "csm" in f:
        return "csm", None
    if "profit" in f and "equity" in f:
        return "pe", "after" if "after" in f else None
    if "equity" in f:
        return "equity", "after" if "after" in f else None
    if re.search(r"profit|income|loss", f):
        return "profit", "after" if "after" in f else None
    return None, None


def seg_of(s):
    return "group" if s == "group" else "life_health"


# portfolio names printed in English by the extractor, in the filer's Hebrew terms
PORT_HE = [
    (r"non-yield-dependent savings component and annuity", "רכיב חיסכון שאינו תלוי תשואה ופוליסות קצבה"),
    (r"yield-dependent savings component and variable management fees", "רכיב חיסכון תלוי תשואה, דמי ניהול משתנים"),
    (r"yield-dependent savings component and fixed management fees", "רכיב חיסכון תלוי תשואה, דמי ניהול קבועים"),
    (r"^remaining portfolios", "שאר התיקים"),
]


def port_he(label):
    if re.search(r"[֐-׿]", label):
        return label
    for pat, he in PORT_HE:
        if re.search(pat, label, re.I):
            return he
    return None


INSURERS = ["ayalon", "clal", "hachshara", "harel", "menora", "migdal", "phoenix"]
CAP_GROUP = ["equity_attributable", "profit_attributable", "comprehensive_income_attributable", "dividend_paid", "dividend_declared"]
SOLV = {"solvency_ratio_with_transitional": "sr_w", "solvency_ratio_without_transitional": "sr_wo"}
# subsidiaries reported beside the main insurer: another entity, never merged into its line
OTHER_ENTITY = re.compile(r"shomera|wesure|wishor|ווישור|שומרה|without_transitional$", re.I)


def capital():
    """Per insurer: group equity, profit and dividends by period, and the main insurer's solvency ratio by date."""
    out = {}
    for c in INSURERS:
        f = DATA / "series" / f"{c}.json"
        if not f.exists():
            continue
        rows = json.loads(f.read_text(encoding="utf-8"))["rows"]
        co = {}
        for r in rows:
            if r["m"] in CAP_GROUP and r["s"] == "group" and r["b"] == "na":
                co[r["m"]] = {p: {k: x[k] for k in ("v", "pg", "u", "std", "der", "cmp") if k in x} for p, x in r["vals"].items()}
        for m, key in SOLV.items():
            cands = [r for r in rows if r["m"] == m and r["b"] == "na" and not OTHER_ENTITY.search(r["s"]) and r.get("g") in ("insurer", "group")]
            # the main insurer's line: insurer rows before a group row; the longest first; a later period never overwrites one already read
            cands.sort(key=lambda r: (r.get("g") != "insurer", -len(r["vals"])))
            line = {}
            for r in cands:
                for p, x in r["vals"].items():
                    d = p[:4] + ("FY" if p.endswith(("Q4", "FY")) else p[4:])
                    if d not in line:
                        line[d] = {**{k: x[k] for k in ("v", "pg", "u", "std", "cmp") if k in x}, "s": r["s"]}
            co[key] = line
        # own funds, SCR and surplus (with transitional measures) of the main insurer, as the periodic report prints them. A filer's row
        # does not always say its basis: per date, the own funds / SCR pair kept is the one that reproduces the with-transitional ratio
        # printed for that date (within 1.5 points), and the surplus the row equal to their difference; no pair, no periodic figure
        cand = {key: [r for r in rows if r["m"] in m and r["b"] == "na" and r.get("g") == "insurer" and not OTHER_ENTITY.search(r["s"]) and not NOT_MAIN.search(r["s"])]
                for m, key in CAP_SOLV.items()}
        pts = lambda key, p: [(r, r["vals"][p]) for r in cand[key] if p in r["vals"]]
        for k in ("of", "scr", "su"):
            co[k] = {}
        for p0, sr in co.get("sr_w", {}).items():
            if "solv" in sr:
                continue
            per = {d: d for d in [p0, p0[:4] + "Q4"]}
            for p in per:
                pair = next(((o, x) for o in pts("of", p) for x in pts("scr", p) if x[1]["v"] and abs(o[1]["v"] / x[1]["v"] * 100 - sr["v"]) <= 1.5), None)
                if not pair:
                    continue
                su = next((u for u in pts("su", p) if abs(u[1]["v"] - (pair[0][1]["v"] - pair[1][1]["v"])) <= 1.5), None)
                for k, rx in (("of", pair[0]), ("scr", pair[1]), ("su", su)):
                    if rx:
                        co[k][p0] = {**{q: rx[1][q] for q in ("v", "pg", "u", "std", "cmp") if q in rx[1]}, "s": rx[0]["s"]}
                break
        merge_solvency(c, co)
        out[c] = co
    return out


# the separate economic-solvency reports (build_solvency.py): they fill the dates the periodic report does not print (2017-2020, and
# the half-years); a figure the periodic report prints is never replaced: when the solvency report prints another value it is kept as `alt`
CAP_SOLV = {("own_funds", "own_funds_with_transitional"): "of", ("scr", "scr_with_transitional"): "scr", ("solvency_surplus", "solvency_surplus_with_transitional"): "su"}
NOT_MAIN = re.compile(r"without|mcr|pro_forma|after|subsidiar", re.I)
SOLV_KEYS = {"sr_w": "sr_w", "sr_wo": "sr_wo", "of": "of_w", "scr": "scr_w", "su": "su_w"}
_SOLV = None


def merge_solvency(c, co):
    global _SOLV
    if _SOLV is None:
        f = DATA / "csm" / "solvency.json"
        _SOLV = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"companies": {}, "reports": {}, "files": ""}
    S, reps = _SOLV["companies"].get(c, {}), _SOLV["reports"]
    for key, sk in SOLV_KEYS.items():
        line = co.setdefault(key, {})
        for dt, cells in S.items():
            x = cells.get(sk)
            if not x:
                continue
            p = dt[:4] + {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}[dt[5:]]
            rep = reps.get(str(x["r"]), {})
            pt = {"v": x["v"], "pg": x.get("pg"), "u": (_SOLV["files"] + rep["f"]) if rep.get("f") else None, "solv": x["r"], **({"img": 1} if x.get("i") else {})}
            cur = line.get(p)
            if cur is None:
                line[p] = {**pt, "std": "IFRS 4" if dt < "2024-01-01" else "IFRS 17"}
            elif abs(cur["v"] - x["v"]) > (0.5 if key.startswith("sr") else max(1.5, abs(x["v"]) * 0.002)):
                cur["alt"] = pt
        co[key] = dict(sorted(line.items(), key=lambda t: t[0][:4] + {"Q1": "1", "Q2": "2", "Q3": "3", "FY": "4"}.get(t[0][4:], "9")))


def main():
    index = json.loads((DATA / "ifrs.json").read_text(encoding="utf-8"))
    url = {(f["company"], f["period"]): f["url"] for f in index["files"]}
    periods = sorted({f["period"] for f in index["files"]})
    reports, sens, rates = {}, [], []
    for p in periods:
        fs = json.loads((DATA / f"ifrs_{p}.json").read_text(encoding="utf-8"))
        keep = []
        for f in fs:
            if KEEP.match(f["m"]):
                # the ledger never reads a transition-approach split, a model column or a subtotal row
                if f["m"].startswith("csm") and (f.get("tr") or f.get("model") or f["m"].startswith("csm_subtotal")):
                    continue
                g = dict(f)
                # the extractor's note is read only for capital rows (before/after capital actions); CSM rows carry their printed label
                if f["m"].startswith("csm"):
                    g.pop("n", None)
                elif g.get("n") and len(g["n"]) > 160:
                    g["n"] = g["n"][:160]
                keep.append(g)
            elif f["m"].startswith("sensitivity:") and not f["m"].startswith("sensitivity:exposed_balance"):
                shock = f["m"][len("sensitivity:"):]
                eff, tax = effect_of(f.get("fx"))
                if not eff:
                    continue
                sens.append({"c": f["c"], "rp": p, "d": f["d"], "shock": shock, "risk": risk_of(shock), "dir": dir_of(shock), "size": size_of(shock),
                             "eff": eff, "tax": tax, "b": f["b"], "seg": seg_of(f["g"]), "s": f["s"], "v": f["v"], "pg": f.get("pg"),
                             "u": f.get("u", url.get((f["c"], p))), "l": f.get("l", shock)})
            elif f["m"] == "discount_rate" and f.get("bk"):
                yrs = size_of(f["bk"])
                rates.append({"c": f["c"], "rp": p, "d": f["d"], "port": port_he(f.get("l", "")), "orig": f.get("l", ""), "t": yrs, "v": f["v"], "pg": f.get("pg"),
                              "u": f.get("u", url.get((f["c"], p))), "real": bool(re.search(r"real", f.get("n", ""), re.I)), "ilp": bool(re.search(r"illiquidity", f.get("n", ""), re.I))})
        reports[p] = keep
    # a rate printed in two reports (a comparative column) is kept once, from the newest report
    seen, uniq = set(), []
    for r in sorted(rates, key=lambda r: r["rp"], reverse=True):
        k = (r["c"], r["d"], r["orig"], r["t"], r["v"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = {"built": date.today().isoformat(), "source": "דוחות כספיים של החברות, MAYA; חולץ ונבדק מול העמוד"}
    dump = lambda name, obj: (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # "the CSM" of every company and balance date by the one rule (csm_resolve.py = web/src/lib/csmResolve.ts), so the ledger's closing
    # balances, the peer table and the valuation pages can be checked against one list: [value, basis · scope, report, flags]
    resolved = {}
    for c in sorted({x["c"] for F in reports.values() for x in F}):
        rs = [(p, [x for x in F if x["c"] == c]) for p, F in reports.items()]
        dates = sorted({x["d"][:10] for _, F in rs for x in F if x["m"] in ("csm_closing", "csm_opening") and x["d"][5:10] in ("03-31", "06-30", "09-30", "12-31")})
        for d in dates:
            r = csm_resolve.resolve(rs, csm_resolve.own_period(d), d)
            if r:
                resolved.setdefault(c, {})[d] = [r["v"], r["label"], r["rp"], r["flags"]]
    # one file per company (the company page reads its own, ~100-170 KB, instead of every insurer's 935 KB) and a small summary: the
    # companies, their reports and the resolved CSM of every date; the industry ledger loads the company files when it opens
    (OUT / "facts").mkdir(exist_ok=True)
    for f in (OUT / "facts").glob("*.json"):
        f.unlink()
    (OUT / "facts.json").unlink(missing_ok=True)
    cos = sorted({x["c"] for F in reports.values() for x in F})
    for c in cos:
        dump(f"facts/{c}.json", {**stamp, "company": c, "files": [f for f in index["files"] if f["company"] == c],
                                 "reports": {p: [x for x in F if x["c"] == c] for p, F in reports.items() if any(x["c"] == c for x in F)}, "resolved": resolved.get(c, {})})
    dump("summary.json", {**stamp, "companies": cos, "periods": sorted(reports), "files": [{k: f[k] for k in ("company", "period")} for f in index["files"] if f["company"] in cos],
                          "resolved": resolved})
    dump("sens.json", {**stamp, "rows": sens})
    dump("capital.json", {**stamp, "source": "דוחות כספיים של החברות, MAYA (סדרה רבעונית רציפה, build_series.py)", "companies": capital()})
    dump("rates.json", {**stamp, "rows": sorted(uniq, key=lambda r: (r["c"], r["d"], r["orig"], r["t"]))})
    print(f"facts {sum(len(v) for v in reports.values())} in {len(reports)} reports · sensitivities {len(sens)} · discount rates {len(uniq)}")


if __name__ == "__main__":
    main()
