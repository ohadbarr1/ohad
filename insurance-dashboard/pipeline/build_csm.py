"""The CSM ledger's own files, built from the per-report IFRS 17 facts that build_ifrs.py writes.

python3 pipeline/build_csm.py -> web/public/data/csm/{facts,sens,rates}.json

facts.json  every CSM movement, equity, solvency, capital-target and dividend fact of every report, grouped by report period
            (one request instead of six report files; values, signs and pages exactly as build_ifrs wrote them).
sens.json   the sensitivity disclosures, normalised to risk · direction · size · effect · basis, each with its page.
rates.json  the discount rates the insurers print (spot, incl. illiquidity premium) by portfolio and tenor, each with its page.
Nothing is estimated here: a shock whose direction the report does not state keeps `dir: null`.
"""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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
    dump("facts.json", {**stamp, "files": index["files"], "reports": reports})
    dump("sens.json", {**stamp, "rows": sens})
    dump("rates.json", {**stamp, "rows": sorted(uniq, key=lambda r: (r["c"], r["d"], r["orig"], r["t"]))})
    print(f"facts {sum(len(v) for v in reports.values())} in {len(reports)} reports · sensitivities {len(sens)} · discount rates {len(uniq)}")


if __name__ == "__main__":
    main()
