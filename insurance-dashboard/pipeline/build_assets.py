"""Quarterly asset lists -> web/public/data/assets/ (allocation over time, illiquid share, top issuers, TA-35, overlap between managers).

  python3 pipeline/build_assets.py            # reads data/work/asset_lists/<manager>/<quarter>/<product>.parquet|json
  python3 pipeline/build_assets.py --check    # rebuild in memory and compare with the published files (gate)

Inputs: the normalised tables of pipeline/asset_lists/normalise.py, pipeline/asset_lists/sources.json + coverage.json (status of every
manager, blocked sites included), web/public/data/funds.json (track id -> product family: the regulator's גמל-נט / פנסיה-נט / ביטוח-נט
classification), data/raw/asset_lists/_ref/ta35_wikipedia.json + pipeline/asset_lists/ta35_issuers.json (TA-35 members).

Outputs
  assets/index.json       managers (coverage, status, notes), class labels, disclaimer, latest totals
  assets/<manager>.json   per quarter: total and allocation by class (NIS m), by CMA sheet, by product family, illiquid / abroad / FX /
                          TA-35 shares, unfunded commitments; latest quarter: top issuers, top holdings. Every quarter carries its source
                          files (URL, page, retrieval date, sha256) and the file validation.
  assets/overlap.json     latest quarter, every pair of managers: overlap by security and by issuer (sum over common names of the
                          smaller weight, weights = share of each manager's total), and the largest shared issuers.
Units: NIS m (files report NIS k). Shares are of the manager's total investment assets in the fetched products (net of the 'נכסים אחרים'
sheet, which carries payables as negatives). Derived figures carry their formula in `calc`.
"""
from __future__ import annotations
import argparse, collections, json, re, sys
from datetime import date
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from asset_lists.common import COVERAGE, OUT, RAW, WORK, load_sources, qlabel  # noqa: E402
from asset_lists.normalise import ILLIQUID, SHEET_CLASS  # noqa: E402

CLASSES = [  # stacking order (equity first, cash and residuals last) and labels
    ("equity", "מניות סחירות"), ("etf", "קרנות סל"), ("mutual", "קרנות נאמנות"), ("gov", 'אג"ח ממשלתי'), ("designated", 'אג"ח מיועדות'),
    ("corp", 'אג"ח קונצרני סחיר'), ("corp_u", "אשראי לא סחיר"), ("loans", "הלוואות"), ("pe", "קרנות השקעה"), ("equity_u", "מניות לא סחירות"),
    ("realestate", "מקרקעין"), ("deposits", "פיקדונות"), ("cash", "מזומנים"), ("deriv", "נגזרים"), ("other", "נכסים אחרים"),
]
PRODUCT_FAM = {"gm": "gemel", "pn": "pensia", "in": "insurance"}
LISTED_SHEETS = {"gov", "corp", "equity", "etf", "mutual"}
NO_ISSUER = {"cash", "deriv", "other"}
DISCLAIMER = ("רשימות הנכסים פורסמו על ידי הגופים המוסדיים באתריהם לפי הוראות רשות שוק ההון (חוזר גופים מוסדיים 2015-9-14). "
              "הנתונים נאספו ועובדו על ידי fox, גורם שלישי שאינו הגוף המוסדי; ייתכנו טעויות בעיבוד. אין לראות בהם ייעוץ או המלצה.")
SEC_OK = re.compile(r"^(\d{5,9}|[A-Z]{2}[A-Z0-9]{9}\d)$")


def r1(x: float) -> float:
    return round(x, 1)


def pct(a: float, b: float) -> float | None:
    return round(100 * a / b, 2) if b else None


def load_family_map() -> dict[tuple[str, str], str]:
    funds = json.loads((ROOT / "web/public/data/funds.json").read_text(encoding="utf-8"))["funds"]
    out = {}
    for f in funds:
        for prod, fam in PRODUCT_FAM.items():
            if f["fam"] == fam:
                out[(prod, str(f["id"]))] = f["prod"]
    return out


def load_quarter(mid: str, q: str) -> tuple[list[dict], list[dict]]:
    rows, docs = [], []
    for j in sorted((WORK / mid / q).glob("*.json")):
        doc = json.loads(j.read_text(encoding="utf-8"))
        pqf = j.with_suffix(".parquet")
        if not pqf.exists():
            continue
        t = pq.read_table(pqf).to_pylist()
        for r in t:
            r["product"] = doc["product"]
        rows += t
        docs.append(doc)
    return rows, docs


def issuer_crosswalk(all_rows: list[dict]) -> dict[str, tuple[str, str]]:
    """security id -> (issuer key, display name): the managers file the same issuer under a ח.פ., an LEI or a TASE issuer number;
    the security number is common, so each security takes the issuer the files most often give it (ח.פ. preferred)."""
    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    names: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in all_rows:
        s = r["sec_id"]
        if not s or not SEC_OK.match(s) or not r["issuer_id"]:
            continue
        typ = r["issuer_type"]
        w = 3 if typ in ("ח.פ.", "ח.פ") or re.fullmatch(r"5\d{8}", r["issuer_id"]) else 2 if typ == "LEI" else 1
        votes[s][r["issuer_id"]] += w
        if r["issuer"]:
            names[r["issuer_id"]][r["issuer"]] += 1
    cw = {}
    for s, c in votes.items():
        iid = c.most_common(1)[0][0]
        nm = names[iid]
        heb = [n for n, _ in nm.most_common() if re.search(r"[א-ת]", n)]
        cw[s] = (iid, heb[0] if heb else (nm.most_common(1)[0][0] if nm else iid))
    return cw


def issuer_key(r: dict, cw: dict) -> tuple[str, str]:
    cls = SHEET_CLASS[r["sheet"]]
    if cls == "gov" and (r["il"] == "ישראל" or "האוצר" in r["issuer"] or "ממשל" in r["issuer"]):
        return "gov:IL", "ממשלת ישראל"
    if cls == "designated":
        return "gov:IL-designated", 'ממשלת ישראל (אג"ח מיועדות)'
    if r["sec_id"] in cw:
        return cw[r["sec_id"]]
    if r["issuer_id"] and r["issuer_type"] != "פנימי":
        return r["issuer_id"], r["issuer"] or r["issuer_id"]
    nm = r["issuer"] or r["name"] or "—"
    return "name:" + re.sub(r'\s+|בע"?מ|בעמ|[".,\'-]', "", nm), nm


def ta35_secs(all_rows: list[dict]) -> tuple[set[str], dict]:
    ref_p = RAW / "_ref" / "ta35_wikipedia.json"
    mp = json.loads((ROOT / "pipeline/asset_lists/ta35_issuers.json").read_text(encoding="utf-8"))["members"]
    if not ref_p.exists():
        return set(), {}
    ref = json.loads(ref_p.read_text(encoding="utf-8"))
    ids = {v[0] for t, v in mp.items() if any(m["ticker"] == t for m in ref["members"])}
    secs = {r["sec_id"] for r in all_rows if r["sheet"] == "מניות מבכ ויהש" and r["issuer_id"] in ids and r["venue"] == "TASE" and r["sec_id"]}
    return secs, {"url": ref["url"], "retrieved": ref["retrieved"], "members": len(ref["members"]), "matched": len(ids), "securities": len(secs)}


def quarter_stats(rows: list[dict], docs: list[dict], fam_map: dict, ta35: set[str]) -> dict:
    tot = sum(r["fv"] for r in rows)
    cls = collections.Counter()
    sheets = collections.Counter()
    fams: dict[str, dict] = {}
    abroad = fx = t35 = 0.0
    for r in rows:
        c = SHEET_CLASS[r["sheet"]]
        v = r["fv"]
        cls[c] += v
        sheets[r["sheet"]] += v
        fam = fam_map.get((r["product"], r["track"]), {"gm": "גמל (לא מסווג)", "pn": "פנסיה (לא מסווג)", "in": "ביטוח (לא מסווג)"}[r["product"]])
        f = fams.setdefault(fam, {"total": 0.0, "illiq": 0.0, "cls": collections.Counter(), "tracks": set()})
        f["total"] += v
        f["cls"][c] += v
        f["tracks"].add(r["track"])
        if c in ILLIQUID:
            f["illiq"] += v
        if (r["country"] and r["country"] != "ישראל") or (not r["country"] and r["il"] == 'חו"ל'):
            abroad += v
        if len(r["ccy"]) == 3 and r["ccy"].isalpha() and r["ccy"].upper() != "ILS":
            fx += v
        if r["sec_id"] in ta35:
            t35 += v
    illiq = sum(cls[c] for c in ILLIQUID)
    commit = sum(sum(d["off_balance"].get("commitments", {}).values()) for d in docs)
    credit = sum(sum(d["off_balance"].get("credit_lines", {}).values()) for d in docs)
    return {
        "total": r1(tot / 1e3),
        "cls": {k: r1(cls[k] / 1e3) for k, _ in CLASSES if cls[k]},
        "sheets": {k: r1(v / 1e3) for k, v in sorted(sheets.items(), key=lambda x: -abs(x[1])) if v},
        "illiq": r1(illiq / 1e3), "illiq_pct": pct(illiq, tot),
        "abroad_pct": pct(abroad, tot), "fx_pct": pct(fx, tot),
        "ta35": r1(t35 / 1e3), "ta35_pct": pct(t35, tot),
        "commit": r1(commit / 1e3), "credit": r1(credit / 1e3),
        "fam": {k: {"total": r1(f["total"] / 1e3), "illiq_pct": pct(f["illiq"], f["total"]), "tracks": len(f["tracks"]),
                    "cls": {c: r1(f["cls"][c] / 1e3) for c, _ in CLASSES if f["cls"][c]}}
                for k, f in sorted(fams.items(), key=lambda x: -x[1]["total"])},
        "src": [{"product": d["product"], "url": d["source"].get("url"), "file": d["source"].get("file"), "page": d["source"].get("page"),
                 "retrieved": d["source"].get("retrieved"), "sha256": d["source"].get("sha256"),
                 "entity": d["cover"].get("entity"), "audience": d["cover"].get("audience")} for d in docs],
        "val": {"ok": all(d["validation"]["ok"] for d in docs), "warnings": sum(d["validation"]["warnings"] for d in docs),
                "rows": sum(d["validation"]["rows"] for d in docs),
                "total_diff_pct": max((abs(d["validation"]["total"]["diff_pct"] or 0) for d in docs), default=0)},
    }


def top_issuers(rows: list[dict], cw: dict, n: int = 30) -> list[dict]:
    tot = sum(r["fv"] for r in rows)
    agg: dict[str, dict] = {}
    for r in rows:
        c = SHEET_CLASS[r["sheet"]]
        if c in NO_ISSUER:
            continue
        k, nm = issuer_key(r, cw)
        a = agg.setdefault(k, {"key": k, "name": nm, "v": 0.0, "illiq": 0.0, "cls": collections.Counter(), "sector": collections.Counter()})
        a["v"] += r["fv"]
        a["cls"][c] += r["fv"]
        if r["sector"]:
            a["sector"][r["sector"]] += r["fv"]
        if c in ILLIQUID:
            a["illiq"] += r["fv"]
    out = []
    for a in sorted(agg.values(), key=lambda x: -x["v"])[:n]:
        out.append({"key": a["key"], "name": a["name"], "v": r1(a["v"] / 1e3), "pct": pct(a["v"], tot),
                    "illiq_pct": pct(a["illiq"], a["v"]), "cls": max(a["cls"], key=a["cls"].get),
                    "sector": a["sector"].most_common(1)[0][0] if a["sector"] else ""})
    return out


def top_holdings(rows: list[dict], n: int = 25) -> list[dict]:
    tot = sum(r["fv"] for r in rows)
    agg: dict[tuple, dict] = {}
    for r in rows:
        c = SHEET_CLASS[r["sheet"]]
        if c in ("cash", "other", "deriv"):
            continue
        k = (r["sec_id"] or r["name"], c)
        a = agg.setdefault(k, {"sec": r["sec_id"], "name": r["name"] or r["issuer"], "issuer": r["issuer"], "cls": c, "v": 0.0, "venue": r["venue"]})
        a["v"] += r["fv"]
    return [{**a, "v": r1(a["v"] / 1e3), "pct": pct(a["v"], tot)} for a in sorted(agg.values(), key=lambda x: -x["v"])[:n]]


def weights(rows: list[dict], cw: dict) -> tuple[dict, dict, dict]:
    tot = sum(r["fv"] for r in rows)
    sec, iss, names = collections.Counter(), collections.Counter(), {}
    for r in rows:
        c = SHEET_CLASS[r["sheet"]]
        if c in LISTED_SHEETS and r["sec_id"] and SEC_OK.match(r["sec_id"]):
            sec[r["sec_id"]] += r["fv"] / tot
        if c not in NO_ISSUER:
            k, nm = issuer_key(r, cw)
            iss[k] += r["fv"] / tot
            names[k] = nm
    return sec, iss, names


def overlap(a: dict, b: dict) -> float:
    return sum(min(v, b[k]) for k, v in a.items() if k in b and v > 0 and b[k] > 0)


def build() -> dict[str, dict]:
    src = load_sources()
    cov = json.loads(COVERAGE.read_text(encoding="utf-8")) if COVERAGE.exists() else {"managers": {}}
    fam_map = load_family_map()
    mids = sorted(d.name for d in WORK.iterdir() if d.is_dir()) if WORK.exists() else []
    data: dict[str, dict[str, tuple]] = {}
    for mid in mids:
        for qd in sorted((WORK / mid).iterdir()):
            rows, docs = load_quarter(mid, qd.name)
            if rows:
                data.setdefault(mid, {})[qd.name] = (rows, docs)
    latest_rows = [r for mid in data for r in data[mid][max(data[mid])][0]]
    cw = issuer_crosswalk(latest_rows)
    ta35, ta35_meta = ta35_secs(latest_rows)
    built = date.today().strftime("%d.%m.%y")
    files: dict[str, dict] = {}
    index_m = []
    for mid, qs in data.items():
        m = src["managers"][mid]
        series = {q: quarter_stats(rows, docs, fam_map, ta35) for q, (rows, docs) in sorted(qs.items())}
        lq = max(qs)
        lrows = qs[lq][0]
        products = sorted({d["product"] for q in qs for d in qs[q][1]})
        doc = {
            "id": mid, "name": m["name"], "entity": m.get("entity", ""), "company_id": m.get("company_id", ""),
            "status": cov["managers"].get(mid, {}).get("status", m["status"]), "note": m.get("note", ""),
            "products": products, "quarters": sorted(qs), "latest": lq, "unit": "NIS m",
            "series": series,
            "top_issuers": top_issuers(lrows, cw), "top_holdings": top_holdings(lrows),
            "ta35": ta35_meta,
            "calc": {"illiq_pct": "Σ שווי בגיליונות לא סחיר + קרנות השקעה + הלוואות + פיקדונות מעל 3 חודשים + זכויות מקרקעין + חברות מוחזקות ÷ סך הנכסים",
                     "abroad_pct": 'Σ שווי בשורות שמדינת החשיפה הכלכלית שלהן אינה ישראל (בהיעדרה: ישראל/חו"ל = חו"ל) ÷ סך הנכסים', "fx_pct": "Σ שווי בשורות שמטבע הפעילות שלהן אינו ILS ÷ סך הנכסים",
                     "ta35_pct": "Σ שווי ניירות הערך של חברי ת\"א 35 (לפי ויקיפדיה) ÷ סך הנכסים", "total": "Σ שווי הוגן (באלפי ש\"ח) בכל גיליונות הנכסים ÷ 1,000"},
            "built": built,
        }
        files[f"{mid}.json"] = doc
        ls = series[lq]
        index_m.append({"id": mid, "name": m["name"], "status": doc["status"], "products": products, "quarters": sorted(qs), "latest": lq,
                        "total": ls["total"], "illiq_pct": ls["illiq_pct"], "ta35_pct": ls["ta35_pct"], "abroad_pct": ls["abroad_pct"],
                        "note": m.get("note", "")})
    # managers we could not read (blocked / not found / client-rendered)
    for mid, m in src["managers"].items():
        if mid in data:
            continue
        st = cov["managers"].get(mid, {}).get("status", m["status"])
        index_m.append({"id": mid, "name": m["name"], "status": st, "products": [], "quarters": [], "latest": None, "total": None,
                        "illiq_pct": None, "ta35_pct": None, "abroad_pct": None, "note": cov["managers"].get(mid, {}).get("note") or m.get("note", "")})
    # overlap, latest quarter of each manager
    W = {mid: weights(qs[max(qs)][0], cw) for mid, qs in data.items()}
    pairs = []
    ids = sorted(W)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            sa, ia, na = W[a]
            sb, ib, nb = W[b]
            shared = sorted(((k, min(ia[k], ib[k])) for k in ia if k in ib and ia[k] > 0 and ib[k] > 0), key=lambda x: -x[1])[:8]
            pairs.append({"a": a, "b": b, "qa": max(data[a]), "qb": max(data[b]),
                          "sec": round(100 * overlap(sa, sb), 2), "iss": round(100 * overlap(ia, ib), 2),
                          "shared": [{"key": k, "name": na.get(k, k), "pct_a": round(100 * ia[k], 2), "pct_b": round(100 * ib[k], 2)} for k, _ in shared]})
    files["overlap.json"] = {
        "built": built, "managers": ids, "pairs": pairs,
        "calc": {"sec": "Σ על ניירות ערך סחירים משותפים (לפי מספר נייר) של min(משקל א, משקל ב); משקל = שווי ÷ סך נכסי המנהל",
                 "iss": "Σ על מנפיקים משותפים של min(משקל א, משקל ב), כל האפיקים מלבד מזומנים, נגזרים ונכסים אחרים; ממשלת ישראל כמנפיק אחד"},
    }
    asof = max((x["latest"] for x in index_m if x["latest"]), default=None)
    files["index.json"] = {
        "built": built, "asof": asof, "asof_label": qlabel(asof) if asof else None, "unit": "NIS m", "disclaimer": DISCLAIMER,
        "products": src["products"], "classes": [{"key": k, "label": l, "illiquid": k in ILLIQUID} for k, l in CLASSES],
        "managers": index_m, "probed": cov.get("probed"), "user_agent": cov.get("user_agent"),
        "ta35": ta35_meta,
    }
    return files


def dump(doc) -> str:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    files = build()
    if a.check:
        def strip(d):
            return {k: v for k, v in d.items() if k != "built"}
        bad = [n for n, d in files.items()
               if not (OUT / n).exists() or strip(json.loads((OUT / n).read_text(encoding="utf-8"))) != json.loads(dump(strip(d)))]
        print(f"assets: {len(files)} files, {len(bad)} differ" + (f": {bad}" if bad else ""))
        sys.exit(1 if bad else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    for n, d in files.items():
        (OUT / n).write_text(dump(d), encoding="utf-8")
        print(f"{n:16} {len(dump(d)) / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
