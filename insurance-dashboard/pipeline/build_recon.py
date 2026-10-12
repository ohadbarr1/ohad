"""Reconcile the regulator's assets aggregates with the figure each company prints in its own report.

Input : web/public/data/market.json                 (groups, products, pro-forma mergers)
        web/public/data/prov/reg/<group>/<year>.json (the tracks behind every regulator aggregate)
        web/public/data/companies/<id>.json          (balance sheet: assets for yield-dependent contracts)
        data/registry/recon_map.json                 (which printed line is the counterpart, with document and page)
Output: web/public/data/recon.json

Units: NIS millions. The comparison is always at the balance-sheet date of the report (month end).
The builder is mechanical: it never explains a difference. A printed line is deducted or set aside only when the
map names it with its page (veteran pension funds, a managing company the site maps to another group).

Status   match  "תואם"                |diff| <= 0.1% of the regulator sum, or within the printed rounding
         close  "קרוב"                <= 1%
         gap    "לא מוסבר"            above 1%, same measure, nothing in a document accounts for it
         near   "מדד קרוב, לא זהה"    Bituach-Net against the balance-sheet line; never a match
"""
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
MAP = ROOT / "data" / "registry" / "recon_map.json"
OUT = WEB / "recon.json"

FAMILIES = ["pension", "gemel", "pg", "insurance"]
FAM_LABEL = {"pension": "פנסיה", "gemel": "גמל והשתלמות", "pg": "פנסיה וגמל", "insurance": "ביטוחי מנהלים ופוליסות חיסכון"}
REG_LABEL = {"pension": "פנסיה-נט", "gemel": "גמל-נט", "pg": "פנסיה-נט + גמל-נט", "insurance": "ביטוח-נט"}
STATUS = {"match": "תואם", "close": "קרוב", "gap": "לא מוסבר", "near": "מדד קרוב, לא זהה"}
FIRST = 202103  # earliest balance-sheet date reconciled


def load(p):
    return json.loads(Path(p).read_text(encoding="utf8"))


def period_of(date):  # "2025-12-31" -> 202512
    return int(date[:4]) * 100 + int(date[5:7])


def regulator(market):
    """(group, yyyymm) -> {family: [sum, tracks]} from the same files the source sheet lists."""
    fam = [p["family"] for p in market["products"]]
    out = {}
    for gi, g in enumerate(market["groups"]):
        for f in sorted((WEB / "prov" / "reg" / str(gi)).glob("*.json")):
            r = load(f)
            for mi, m in enumerate(r["months"]):
                d = defaultdict(lambda: [0.0, 0])
                for i, fu in enumerate(r["funds"]):
                    a = r["a"][i][mi]
                    if a is not None:
                        d[fam[fu[3]]][0] += a
                        d[fam[fu[3]]][1] += 1
                if d["pension"][1] or d["gemel"][1]:
                    d["pg"] = [d["pension"][0] + d["gemel"][0], d["pension"][1] + d["gemel"][1]]
                out[(g, m)] = {k: v for k, v in d.items() if v[1]}
    return out


def status(v, reg, prec, tier):
    if tier == "near":
        return "near", False
    diff = v - reg
    if abs(diff) <= prec / 2 and prec >= 1:  # the report prints fewer digits than the difference
        return "match", abs(diff) / reg * 100 > 0.1
    pct = abs(diff) / reg * 100
    return ("match" if pct <= 0.1 else "close" if pct <= 1 else "gap"), False


def balance_rows(company, spec):
    """date -> (value NIS m, page, url, label), and the investment-contract line as information."""
    d = load(WEB / "companies" / f"{company}.json")
    ms, ps, urls = d["metrics"], d["periods"], d.get("urls", [])
    pats = [re.compile(p) for p in spec["total"]]
    info_pat = re.compile(spec["info"]) if spec.get("info") else None

    def pick(test):
        best = {}
        for f in d["facts"]:
            m, p = ms[f[0]], ps[f[1]]
            if m["sheet"] != spec["sheet"] or p["type"] != "I" or p["end"][8:] == "01" or f[2] is None:
                continue
            rank = test(m["label"])
            if rank is None:
                continue
            flags = f[5] if len(f) > 5 else 0
            # the statement under the current standard first (no flag), then the line as first reported
            key = (1 if flags & 2 else 0, rank, f[0])
            url = urls[f[4]] if len(f) > 4 and f[4] is not None else None
            if url and (p["end"] not in best or key < best[p["end"]][0]):
                best[p["end"]] = (key, f[2] / 1000 if m["unit"] == "k" else f[2], f[3], url, m["label"])
        return {k: v[1:] for k, v in best.items()}

    total = pick(lambda l: next((i for i, p in enumerate(pats) if p.match(l)), None))
    info = pick(lambda l: 0 if info_pat and info_pat.match(l) else None)
    return total, info


def main():
    market, rmap = load(WEB / "market.json"), load(MAP)
    reg = regulator(market)
    asof = market["meta"]["asof"]
    proforma = {p["to"]: p["until"] for p in market["meta"].get("proforma", [])}
    th = rmap["meta"]["thresholds_pct"]
    assert (th["match"], th["close"]) == (0.1, 1.0), "thresholds are fixed by decision; change status() with them"
    urls, uix = [], {}

    def u(url):
        if url not in uix:
            uix[url] = len(urls)
            urls.append(url)
        return uix[url]

    groups, missing, counts = {}, [], defaultdict(lambda: defaultdict(int))
    for g in market["groups"]:
        e = rmap["groups"].get(g)
        if not e:
            continue
        rows = defaultdict(dict)  # family -> period -> row
        # pension / gemel: the printed line named by the map
        cands = defaultdict(list)
        for f in e.get("figures", []):
            cands[(f["fam"], period_of(f["d"]))].append(f)
        for (fam, per), fs in cands.items():
            if per < FIRST or per > asof or per <= proforma.get(g, 0):
                continue
            r = reg.get((g, per), {}).get(fam)
            if not r:
                missing.append({"group": g, "fam": fam, "d": per, "why": "אין נתון רשות לחודש"})
                continue
            # a table of the report's own date before a comparative column, a table before a rounded sentence
            f = min(fs, key=lambda x: (x["src"] != "table", not x["own"], x["prec"], x["doc"]))
            st, rounded = status(f["v"], r[0], f["prec"], rmap["meta"]["tiers"][fam])
            row = {"d": per, "reg": round(r[0], 1), "n": r[1], "v": f["v"], "pct": round((f["v"] - r[0]) / r[0] * 100, 2), "st": st,
                   "pg": f["pg"], "u": u(f["url"]), "doc": f["doc"], "l": f["l"], "unit": f["unit"]}
            if rounded:
                row["rnd"] = f["prec"]
            if f["src"] == "text":
                row["text"] = 1
            if not f["own"]:
                row["cmp"] = 1
            for k in ("parts", "tot"):
                if k in f:
                    row[k] = f[k]
            for k in ("out", "minus"):
                if k in f:
                    row[k] = [{"l": x["l"], "v": x["v"], "pg": x["pg"]} for x in f[k]]
            rows[fam][per] = row
        # one combined figure is kept only where the report does not print the two families apart
        for per in list(rows["pg"]):
            if per in rows["pension"] and per in rows["gemel"]:
                del rows["pg"][per]
        # insurance: Bituach-Net against the balance-sheet line, a near measure by decision
        if e.get("insurance") and (WEB / "companies" / f"{e['company']}.json").exists():
            total, info = balance_rows(e["company"], e["insurance"])
            for date, (v, pg, url, label) in total.items():
                per = period_of(date)
                r = reg.get((g, per), {}).get("insurance")
                if per < FIRST or per > asof or not r:
                    continue
                row = {"d": per, "reg": round(r[0], 1), "n": r[1], "v": round(v, 1), "pct": round((v - r[0]) / r[0] * 100, 2), "st": "near",
                       "pg": pg, "u": u(url), "l": label, "unit": 'אלפי ש"ח'}
                if date in info:
                    iv, ipg, iurl, il = info[date]
                    row["info"] = {"l": il, "v": round(iv, 1), "pg": ipg, "u": u(iurl)}
                rows["insurance"][per] = row
        fams = {f: [rows[f][p] for p in sorted(rows[f])] for f in FAMILIES if rows[f]}
        for f, rs in fams.items():
            for r in rs:
                counts[g][r["st"]] += 1
        # what the regulator holds for the group and no printed figure was found for
        latest = reg.get((g, asof), {})
        for f in ("pension", "gemel", "insurance"):
            if latest.get(f, [0])[0] > 0 and f not in fams and not (f in ("pension", "gemel") and "pg" in fams):
                missing.append({"group": g, "fam": f, "d": None, "why": "לא נמצא נתון מודפס"})
        groups[g] = {"company": e["company"], "fam": fams}

    out = {"asof": asof, "generated": dt.date.today().isoformat(), "unit": 'מיליוני ש"ח',
           "thresholds": th, "status": STATUS, "families": FAM_LABEL, "reg": REG_LABEL,
           "note": "pct = (printed - regulator) / regulator. reg: sum of the group's tracks at the month of the balance-sheet date. "
                   "out: printed lines outside the regulator set, not in v. minus: printed lines deducted from v, each with its page.",
           "urls": urls, "groups": groups, "missing": missing}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf8")

    # report
    print(f"recon.json: {OUT.stat().st_size / 1024:.0f} KB, {len(urls)} documents")
    for g, e in groups.items():
        parts = []
        for f, rs in e["fam"].items():
            c = defaultdict(int)
            for r in rs:
                c[r["st"]] += 1
            parts.append(f"{f} {len(rs)} ({', '.join(f'{STATUS[k]} {v}' for k, v in c.items())})")
        print(f"  {g}: " + ("; ".join(parts) or "אין"))
    for m in missing:
        print("  missing:", m["group"], m["fam"], m["d"] or "", m["why"])
    # the anchors the owner verified by hand
    ph = {f: {r["d"]: r for r in rs} for f, rs in groups["הפניקס"]["fam"].items()}
    assert ph["gemel"][202512]["v"] == 99460 and ph["gemel"][202512]["st"] == "match", ph["gemel"][202512]
    assert abs(ph["gemel"][202512]["reg"] - 99460.0) < 0.5 and abs(ph["pension"][202512]["reg"] - 143024.1) < 0.1
    assert ph["insurance"][202512]["st"] == "near" and abs(ph["insurance"][202512]["pct"] - 3.74) < 0.05
    assert all(r["st"] == "near" for e in groups.values() for r in e["fam"].get("insurance", []))
    return 0


if __name__ == "__main__":
    sys.exit(main())
