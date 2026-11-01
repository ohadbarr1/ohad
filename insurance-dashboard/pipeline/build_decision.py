"""W2 · the decision file for recommending a pension fund: service, claims, default coverage, and the managers'-insurance switching
checklist, per managing company. Standard library only.

python3 pipeline/build_decision.py            -> web/public/data/funds/decision.json
python3 pipeline/build_decision.py --check    rebuild in memory: equal to the file, byte for byte, and every rule below holds (gate `decision`)

Inputs (committed): data/regulation/decision_src.json (hand-curated register, sources with URL + retrieval date + page),
data/regulation/decision_claims.json (annex B3 read from the companies' Excel files by pipeline/extract_decision.py, a manual step that
also re-verifies every transcribed figure against its raw file), web/public/data/funds.json (fox's company groups and manager names).

Rules (--check):
  weights     every service-index row: the published total = the published weights x the published components, within 1 point (each
              component and the total are printed rounded to an integer); insurance products: the claims component = the mean of the
              payment-rate and speed scores within 1 point
  claims      every B3 block: approved + rejected + settled + cancelled = 100% and the handling-time buckets sum to 100%, within 0.3
              (printed to 0.1); every share within [0, 100]
  groups      every company of the pension and gemel segments is a fox company group (funds.json `grp`)
  sources     every figure's `src` resolves to a source with an https URL and a retrieval date; every coverage rule has a clause, a page and
              a verified phrase (`q`); every checklist item has a source and a phrase
  numbers     no NaN / infinity anywhere
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "regulation" / "decision_src.json"
CLAIMS = ROOT / "data" / "regulation" / "decision_claims.json"
FUNDS = ROOT / "web" / "public" / "data" / "funds.json"
OUT = ROOT / "web" / "public" / "data" / "funds" / "decision.json"
V = 1
SEGS = ("pension", "gemel", "life_savings")
SEG_FAM = {"pension": "pensia", "gemel": "gemel", "life_savings": "insurance"}
METHOD = ("מדד השירות של רשות שוק ההון (2025, פורסם באוקטובר 2026): ציון 0-100 לכל רכיב, המדד = סכום הרכיבים במשקולות שהרשות פרסמה; "
          "דירוג = מקום לפי המדד בתוך המוצר (שוויון = אותו מקום). תביעות בקרן פנסיה: נספח ב3 לחוזר איסוף מידע סטטיסטי כפי שכל חברה "
          "מנהלת מפרסמת, אחוזים מתוך התביעות שנסגרו ב-2025, ברמת החברה המנהלת (כל קרנותיה יחד). תביעות בביטוח: ציוני הרשות לשיעור "
          "התשלום ולמהירות הטיפול (ציונים, לא שיעורים). כיסוי ברירת המחדל: פרק הכיסויים הביטוחיים בתקנון האחיד של קרן מקיפה, כפי "
          "שנקרא בתקנון מור פנסיה מקיפה (יוני 2025). רשימת הבדיקה לביטוח מנהלים ישן: לפי כל זכות (נכתב בסיוע הרשות) והתקנון; מקדמי "
          "קצבה ברמת פוליסה אינם פומביים ואינם כאן. טבלאות מדד השירות הן תמונות ב-PDF ונקראו ידנית; כל שורה נבדקת חשבונית מול המשקולות.")


def rank_min(vals):
    """competition ranking, highest first: equal totals share the place ('1224')"""
    return {k: 1 + sum(1 for x in vals.values() if x > v) for k, v in vals.items()}


def build():
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    cl = json.loads(CLAIMS.read_text(encoding="utf-8"))
    funds = json.loads(FUNDS.read_text(encoding="utf-8"))
    errs = []
    srcs = {s["id"]: s for s in reg["sources"]}
    for s in reg["sources"]:
        if not str(s.get("url", "")).startswith("https://") or not s.get("retrieved"):
            errs.append(f"source {s['id']}: no https url or retrieval date")
    names = {}
    for f in funds["funds"]:
        names.setdefault(f["grp"], {}).setdefault(f["fam"], set()).add(f["mgr"])
    groups = set(names)

    sv = reg["service"]
    comp = {}

    def co(g):
        if g not in comp:
            comp[g] = {"grp": g, "in_funds": g in groups}
            if g in names:
                comp[g]["mgr"] = {fam: sorted(ms)[0] if len(ms) == 1 else sorted(ms) for fam, ms in sorted(names[g].items())}
        return comp[g]

    segments = {}
    for seg in SEGS:
        S = sv["segments"][seg]
        w = sv["weights"][S["weights"]]
        ranks = rank_min({r["grp"]: r["total"] for r in S["rows"]})
        for r in S["rows"]:
            est = math.fsum(w[k] * r[k] for k in w if k != "pg") / 100
            if abs(est - r["total"]) > 1.0:
                errs.append(f"service {seg} {r['grp']}: total {r['total']} vs weights x components {est:.2f}")
            if seg != "life_savings" and r["grp"] not in groups:
                errs.append(f"service {seg}: {r['grp']} is not a fox company group")
            row = {"year": sv["year"], "name": r["name"], "total": r["total"], "rank": ranks[r["grp"]], "of": len(S["rows"])}
            row.update({k: r[k] for k in ("sat", "compl", "phone", "funding", "digital")})
            row.update({"prev": r["prev"], "chg": r["total"] - r["prev"], "wait_s": r["wait_s"], "src": sv["src"], "pg": S["pg"],
                        "pg_prev": S["pg_prev"], "pg_wait": S["pg_wait"]})
            co(r["grp"]).setdefault("service", {})[seg] = row
        segments[seg] = {"label": S["label"], "year": sv["year"], "prev_year": sv["prev_year"], "n": len(S["rows"]),
                         "weights": {k: x for k, x in w.items() if k != "pg"}, "avg": S["avg"], "src": sv["src"], "pg": S["pg"],
                         "pg_weights": w["pg"], "fam": SEG_FAM[seg]}

    ic = reg["ins_claims"]
    wi = sv["weights"]["insurance"]
    products = {}
    for p, P in ic["products"].items():
        ranks = rank_min({r["grp"]: r["total"] for r in P["rows"]})
        for r in P["rows"]:
            if abs((r["pay"] + r["speed"]) / 2 - r["claims"]) > 1.0:
                errs.append(f"ins_claims {p} {r['grp']}: claims {r['claims']} vs mean of pay and speed")
            est = math.fsum(wi[k] * r[k] for k in wi if k != "pg") / 100
            if abs(est - r["total"]) > 1.0:
                errs.append(f"ins_claims {p} {r['grp']}: total {r['total']} vs weights x components {est:.2f}")
            row = {"year": ic["year"], "name": r["name"], "total": r["total"], "rank": ranks[r["grp"]], "of": len(P["rows"])}
            row.update({k: r[k] for k in ("claims", "pay", "speed", "sat", "compl", "phone", "digital")})
            row.update({"src": ic["src"], "pg": P["pg"]})
            co(r["grp"]).setdefault("ins_service", {})[p] = row
        products[p] = {"label": P["label"], "year": ic["year"], "n": len(P["rows"]), "avg": P["avg"], "src": ic["src"], "pg": P["pg"]}

    fc = reg["fund_claims"]
    recs = [dict(r) for r in fc["transcribed"]] + [dict(r) for r in cl["funds"]]
    for r in recs:
        g = r["grp"]
        if g not in groups:
            errs.append(f"claims: {g} is not a fox company group")
        if r["src"] not in srcs:
            errs.append(f"claims {g}: unknown source {r['src']}")
        out = {"year": fc["year"], "src": r["src"], "entity": r.get("entity")}
        for k in ("pg", "sheet"):
            if k in r:
                out[k] = r[k]
        for key in ("disability", "death", "survivors"):
            b = r.get(key)
            if not b:
                continue
            parts = [b.get(k) or 0.0 for k in ("approved", "rejected", "settled", "cancelled")]
            if abs(math.fsum(parts) - 100) > 0.3:
                errs.append(f"claims {g} {key}: approved+rejected+settled+cancelled = {math.fsum(parts):.1f}")
            if abs(math.fsum(x or 0.0 for x in b["closed"]) - 100) > 0.3:
                errs.append(f"claims {g} {key}: handling-time buckets sum to {math.fsum(x or 0.0 for x in b['closed']):.1f}")
            if any(x is not None and not 0 <= x <= 100 for x in parts + b["closed"]):
                errs.append(f"claims {g} {key}: a share outside [0, 100]")
            o = {k: b.get(k) for k in ("approved", "rejected", "settled", "cancelled", "closed")}
            for k in ("n_closed", "cells"):
                if k in b:
                    o[k] = b[k]
            out[key] = o
        co(g)["claims"] = out
    for m in reg["missing"]:
        if m["what"] == "fund_claims":
            co(m["grp"])["claims_missing"] = m["reason"]

    cov = reg["coverage_default"]
    for r in cov["rules"]:
        if not (r.get("clause") and r.get("pg") and r.get("q")):
            errs.append(f"coverage {r.get('id')}: clause, page and q are required")
    chk = reg["bm_checklist"]
    for it in chk:
        if it.get("src") not in srcs or not it.get("q") or not it.get("title") or not it.get("detail"):
            errs.append(f"checklist {it.get('id')}: src, title, detail and q are required")

    doc = {"v": V, "asof": reg["retrieved"], "method": METHOD, "src": "data/regulation/decision_src.json",
           "sources": [{k: s[k] for k in ("id", "kind", "publisher", "title", "url", "retrieved", "page_url", "revision", "updated", "note", "format")
                        if k in s} for s in reg["sources"]],
           "segments": segments, "labels": sv["labels"], "ins_products": products, "ins_scale": ic["scale"],
           "market_claims": ic["market"] | {"src": ic["src"]}, "complaints": sv["complaints"] | {"src": sv["src"]},
           "fund_claims": {"year": fc["year"], "what": fc["what"], "buckets": fc["buckets"]},
           "companies": dict(sorted(comp.items())),
           "coverage_default": {"src": cov["src"], "rules": cov["rules"]},
           "bm_checklist": chk, "missing": reg["missing"]}

    def finite(x, path="/"):
        if isinstance(x, float) and not math.isfinite(x):
            errs.append(f"{path}: not finite")
        elif isinstance(x, dict):
            for k, y in x.items():
                finite(y, f"{path}{k}/")
        elif isinstance(x, list):
            for i, y in enumerate(x):
                finite(y, f"{path}{i}/")
    finite(doc)
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", doc, errs


def main():
    text, doc, errs = build()
    nco = len(doc["companies"])
    ncl = sum(1 for c in doc["companies"].values() if "claims" in c)
    if "--check" in sys.argv:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        if not same:
            errs.append("web/public/data/funds/decision.json differs from a rebuild (run python3 pipeline/build_decision.py)")
        print(f"decision: {nco} companies, {ncl} with fund claims, {len(doc['coverage_default']['rules'])} coverage rules, "
              f"{len(doc['bm_checklist'])} checklist items; {len(errs)} failures")
        for e in errs[:20]:
            print("FAIL", e)
        return 1 if errs else 0
    if errs:
        for e in errs[:20]:
            print("FAIL", e)
        return 1
    OUT.write_text(text, encoding="utf-8")
    print(f"decision.json: {nco} companies, {ncl} with fund claims, {len(doc['coverage_default']['rules'])} coverage rules, "
          f"{len(doc['bm_checklist'])} checklist items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
