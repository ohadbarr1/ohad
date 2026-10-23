"""Normalise one quarterly asset-list file (CMA uniform format, circular 2015-9-14) into a compact table, with validation.

  python3 pipeline/asset_lists/normalise.py                    # every fetched manager-quarter not yet normalised
  python3 pipeline/asset_lists/normalise.py meitav --force
  python3 pipeline/asset_lists/normalise.py --file x.xlsx      # one file, print the validation (tests / format drift)

Output per manager-quarter (data/work/asset_lists/<manager>/<quarter>/):
  <product>.parquet  one row per holding: fund, track, sheet (the CMA sheet name = asset class), sec_id (TASE number for IL ISINs),
                     sec_type, issuer, issuer_id, issuer_type, name, venue, trad (tradability), il, country, sector, ccy, rel,
                     rating, fv (NIS k: fair value; amortised cost where the file reports no fair value), pct_cls, pct_tot (as filed)
  <product>.json     file metadata (source URL, retrieval date, header page fields), per-sheet totals, per-track totals,
                     off-balance items (credit lines, unfunded commitments) and the validation result.

Validation (ok = the grand total ties within 0.5% and at most 10% of tracks miss on pct; each per-sheet / per-track miss is a warning)
  summary   per-sheet totals equal the file's summary sheet ('סכום נכסים') where the file fills it: |diff| ≤ max(NIS 5k, 0.1%)
  total     the sum over those sheets equals the summary's sum within 0.5%
  pct       per track, the filed 'שיעור מסך נכסי ההשקעה' adds up to 100% ± 1pp (tracks whose file leaves it blank are skipped)
  rows      every holding row has a track and a numeric value; rows dropped for missing values are counted
Format drift handled: header row anywhere in the first 15 rows; header text variants (aliases below); percentages given as
fractions or as percent; the quarter/manager read from the cover sheet; '.xls'-era sheet names with trailing spaces.
"""
from __future__ import annotations
import argparse, json, re, sys, time
from pathlib import Path

import openpyxl  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from asset_lists.common import RAW, WORK  # noqa: E402

TMP = Path.home() / ".cache" / "fox" / "asset_lists"

# CMA sheet -> display class. The sheet name itself is kept on every row (the asset class "per the CMA sheet names").
SHEET_CLASS = {
    "מזומנים ושווי מזומנים": "cash",
    "איגרות חוב ממשלתיות": "gov", "לא סחיר איגרות חוב ממשלתיות": "gov",
    "לא סחיר איגרות חוב מיועדות": "designated", "אפיק השקעה מובטח תשואה": "designated",
    "איגרות חוב": "corp", "ניירות ערך מסחריים": "corp", "מוצרים מובנים": "corp",
    "לא סחיר איגרות חוב": "corp_u", "לא סחיר ניירות ערך מסחריים": "corp_u", "לא סחיר מוצרים מובנים": "corp_u",
    "מניות מבכ ויהש": "equity", "קרנות סל": "etf", "קרנות נאמנות": "mutual",
    "לא סחיר מניות מבכ ויהש": "equity_u", "השקעה בחברות מוחזקות": "equity_u",
    "קרנות השקעה": "pe", "הלוואות": "loans", "פיקדונות מעל 3 חודשים": "deposits", "זכויות מקרקעין": "realestate",
    "כתבי אופציה": "deriv", "אופציות": "deriv", "חוזים עתידיים": "deriv",
    "לא סחיר כתבי אופציה": "deriv", "לא סחיר אופציות": "deriv", "לא סחיר נגזרים אחרים": "deriv",
    "נכסים אחרים": "other",
}
# illiquid / unlisted: the CMA 'לא סחיר' sheets and the private-market sheets (designated bonds counted apart, derivatives excluded)
ILLIQUID = {"corp_u", "equity_u", "pe", "loans", "deposits", "realestate"}
OFF_BALANCE = {"מסגרות אשראי": "credit_lines", "יתרות התחייבות להשקעה": "commitments"}
SUMMARY = "סכום נכסים"

ALIASES = {
    "fund": ["מספר קופה/קרן/ח.פ. עבור חברת ביטוח", "מספר קופה", "מספר קרן", "מספר קופה/קרן"],
    "track": ["מספר מסלול"],
    "issuer": ["שם מנפיק", "שם הבנק", "שם שותף כללי קרן השקעות"],
    "issuer_id": ["מספר מנפיק", "מספר מזהה בנק", "מספר מזהה שותף כללי קרן השקעות", "מספר מזהה לווה"],
    "issuer_type": ["סוג מספר מזהה מנפיק", "סוג מספר מזהה בנק", "סוג מספר מזהה שותף כללי קרן השקעות", "סוג מספר מזהה לווה"],
    "name": ["שם נייר ערך", "שם קרן השקעה", "שם הלוואה", "שם הנכס האחר", "שם הנכס"],
    "sec_id": ["מספר נייר ערך", "מספר מזהה קרן השקעה", "מספר הלוואה", "מספר הנכס האחר", "מספר עסקה (רגל 1)"],
    "sec_type": ["סוג מספר נייר ערך", "סוג מספר מזהה קרן השקעות"],
    "venue": ["זירת מסחר"], "trad": ["סטאטוס סחירות"], "il": ['ישראל/חו"ל'],
    "country": ["מדינה לפי חשיפה כלכלית", 'מדינת מיקום נדל"ן', "מדינת התאגדות קרן השקעה"],
    "sector": ["ענף מסחר", "אסטרטגיית קרן ההשקעה", "שימוש עיקרי בנכס"],
    "ccy": ["מטבע פעילות", "מטבע פעילות (רגל 1)", "סוג הצמדה"],
    "rel": ["בעל עניין/צד קשור"], "rating": ["דירוג", "דירוג הבנק", "דירוג הלוואה/המנפיק"], "kind": ["מאפיין עיקרי"],
    "fv": ['שווי הוגן (באלפי ש"ח)', 'שווי הוגן (נטו באלפי ש"ח)', 'שווי הנכסים באפיק (באלפי ש"ח)',
           'שווי הוגן (בש"ח)'],  # the CMA template labels 'לא סחיר אופציות' "בש"ח" but the figures are NIS k (they tie to the summary sheet)
    "bv": ['שווי מאזני (באלפי ש"ח)'], "amort": ['עלות מופחתת (באלפי ש"ח)'],
    "pct_cls": ["שיעור מנכסי אפיק ההשקעה"], "pct_tot": ["שיעור מסך נכסי ההשקעה"],
    # off-balance sheets
    "commit": ['יתרת המחויבות לתקופת הדיווח (באלפי ש"ח)'], "credit": ['סכום מסגרת האשראי הראשוני (באלפי ש"ח)'],
    "credit_left": ["שיעור יתרת מסגרת אשראי"],
}
STR_COLS = ["sheet", "sec_id", "sec_type", "issuer", "issuer_id", "issuer_type", "name", "venue", "trad", "il", "country", "sector",
            "ccy", "rel", "rating", "kind"]
NUM_COLS = ["fv", "pct_cls", "pct_tot"]


PLACEHOLDER = {"ריק במקור", "לא ידוע", "-", "--", "N/A", "NA"}  # the template's "empty in source" filler (Meitav, Analyst) is a blank


def norm(s) -> str:
    if s is None:
        return ""
    v = re.sub(r"\s+", " ", str(s)).strip().replace("״", '"').replace("׳", "'")
    return "" if v in PLACEHOLDER else v


def header_map(row) -> dict[str, int]:
    cells = [norm(c) for c in row]
    out = {}
    for key, names in ALIASES.items():
        for nm in names:  # first alias that appears wins (the list is in priority order)
            if nm in cells:
                out[key] = cells.index(nm)
                break
    return out


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def intlike(v) -> str:
    """fund/track/issuer ids: 872.0 -> '872'"""
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return norm(v)


def tase_id(sec: str, typ: str) -> str:
    """IL ISIN = IL + 9-digit zero-padded TASE number + check digit -> the TASE number; other ids unchanged"""
    s = sec.strip().upper()
    if re.fullmatch(r"IL\d{10}", s):
        return str(int(s[2:11]))
    if re.fullmatch(r"\d{5,9}(\.0)?", s):
        return str(int(float(s)))
    return s


def cover(ws) -> dict:
    meta = {}
    for row in ws.iter_rows(max_row=40, values_only=True):
        vals = [c for c in row if c not in (None, "")]
        if len(vals) >= 2:
            k = norm(vals[0])
            if "תחום" in k: meta["domain"] = norm(vals[1])
            elif "רבעון" in k: meta["q"] = intlike(vals[1])
            elif "שנת" in k: meta["year"] = intlike(vals[1])
            elif "הגוף המוסדי" in k and "ח.פ" not in k: meta["entity"] = norm(vals[1])
            elif "ח.פ" in k: meta["entity_id"] = intlike(vals[1])
            elif "לממונה" in k or "לציבור" in k: meta["audience"] = norm(vals[1])
    return meta


def summary(ws) -> dict[str, float]:
    out = {}
    for row in ws.iter_rows(values_only=True):
        if not row or row[0] is None:
            continue
        k = norm(row[0])
        if k in SHEET_CLASS or k in OFF_BALANCE:
            v = num(row[1]) if len(row) > 1 else None
            if v is not None:
                out[k] = v
    return out


def read_file(path: Path) -> tuple[list[dict], dict]:
    t0 = time.time()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    names = {norm(n): n for n in wb.sheetnames}
    info = {"cover": cover(wb[wb.sheetnames[0]]), "summary": {}, "sheets": {}, "off_balance": {}, "dropped": 0, "unknown_sheets": []}
    if SUMMARY in names:
        info["summary"] = summary(wb[names[SUMMARY]])
    rows: list[dict] = []
    for nn, real in names.items():
        if nn in (SUMMARY,) or nn == norm(wb.sheetnames[0]):
            continue
        cls = SHEET_CLASS.get(nn)
        off = OFF_BALANCE.get(nn)
        if not cls and not off:
            info["unknown_sheets"].append(nn)
            continue
        ws = wb[real]
        it = ws.iter_rows(values_only=True)
        hm, n = {}, 0
        for row in it:
            n += 1
            hm = header_map(row)
            if "track" in hm and ("fv" in hm or "commit" in hm or "credit" in hm):
                break
            if n >= 15:
                break
        if "track" not in hm:
            info["unknown_sheets"].append(nn + " (no header)")
            continue
        g = lambda r, k: r[hm[k]] if k in hm and hm[k] < len(r) else None  # noqa: E731
        tot, cnt = 0.0, 0
        offv: dict[str, float] = {}
        for r in it:
            if not r:
                continue
            track = intlike(g(r, "track"))
            if not track or not re.fullmatch(r"\d+", track):
                continue
            fund = intlike(g(r, "fund"))
            if off:
                v = num(g(r, "commit")) if off == "commitments" else num(g(r, "credit"))
                if v is not None:
                    offv[track] = offv.get(track, 0.0) + v
                continue
            fv = num(g(r, "fv"))
            if fv is None:
                fv = num(g(r, "bv"))
            if fv is None:
                fv = num(g(r, "amort"))
            if fv is None:
                info["dropped"] += 1
                continue
            sec = intlike(g(r, "sec_id"))
            rec = {"fund": fund, "track": track, "sheet": nn, "fv": fv,
                   "sec_id": tase_id(sec, norm(g(r, "sec_type"))) if sec else "",
                   "pct_cls": num(g(r, "pct_cls")), "pct_tot": num(g(r, "pct_tot"))}
            for k in ("sec_type", "issuer", "issuer_type", "name", "venue", "trad", "il", "country", "sector", "ccy", "rel", "rating", "kind"):
                rec[k] = norm(g(r, k))
            rec["issuer_id"] = intlike(g(r, "issuer_id"))
            rows.append(rec)
            tot += fv
            cnt += 1
        if off:
            info["off_balance"][off] = offv
        else:
            info["sheets"][nn] = {"total": round(tot, 3), "rows": cnt}
    wb.close()
    info["seconds"] = round(time.time() - t0, 1)
    return rows, info


def validate(rows: list[dict], info: dict) -> dict:
    res = {"summary": {"checked": 0, "fail": []}, "pct": {"checked": 0, "fail": []}, "rows": len(rows), "dropped": info["dropped"]}
    for sh, v in info["summary"].items():
        if sh in OFF_BALANCE:
            continue
        got = info["sheets"].get(sh, {}).get("total", 0.0)
        res["summary"]["checked"] += 1
        if abs(got - v) > max(5.0, 0.001 * abs(v)):
            res["summary"]["fail"].append({"sheet": sh, "summary": round(v, 1), "rows": round(got, 1)})
    by: dict[str, list[float]] = {}
    for r in rows:
        if r["pct_tot"] is not None:
            by.setdefault(r["track"], []).append(r["pct_tot"])
    tracks = {}
    for r in rows:
        tracks[r["track"]] = tracks.get(r["track"], 0.0) + r["fv"]
    for t, ps in by.items():
        s = sum(ps)
        scale = 100.0 if s > 5 else 1.0          # percent or fraction
        if len(ps) < 3 or tracks.get(t, 0) <= 0:
            continue
        res["pct"]["checked"] += 1
        if abs(s / scale - 1.0) > 0.01:
            res["pct"]["fail"].append({"track": t, "sum": round(s / scale, 4)})
    # grand total: rows vs the summary sheet over the sheets the summary fills. A single sheet that misses while the total ties is the
    # filer's own summary out of step (seen: Altshuler 'איגרות חוב' in 4 of 16 files, ≤ 3% of that sheet); it is kept as a warning.
    s_sum = sum(v for k, v in info["summary"].items() if k not in OFF_BALANCE)
    r_sum = sum(info["sheets"].get(k, {}).get("total", 0.0) for k in info["summary"] if k not in OFF_BALANCE)
    res["total"] = {"summary": round(s_sum, 1), "rows": round(r_sum, 1),
                    "diff_pct": round(100 * (r_sum - s_sum) / s_sum, 3) if s_sum else None}
    total_ok = not s_sum or abs(r_sum - s_sum) <= 0.005 * abs(s_sum)
    pct_ok = len(res["pct"]["fail"]) <= max(1, res["pct"]["checked"] // 10)
    res["ok"] = total_ok and pct_ok
    res["warnings"] = len(res["summary"]["fail"]) + len(res["pct"]["fail"])
    return res


def to_parquet(rows: list[dict], path: Path):
    cols = {k: [r.get(k) or "" for r in rows] for k in ["fund", "track"] + STR_COLS}
    for k in NUM_COLS:
        cols[k] = [r.get(k) for r in rows]
    table = pa.table({k: pa.array(v, type=pa.float64() if k in NUM_COLS else pa.string()) for k, v in cols.items()})
    pq.write_table(table, path, compression="zstd")


def raw_dirs():
    for base in (RAW, TMP):
        if base.exists():
            for d in sorted(base.glob("*/*Q*")):
                yield d


def run_dir(d: Path, force: bool) -> list[str]:
    mid, q = d.parent.name, d.name
    out = WORK / mid / q
    msgs = []
    for x in sorted(d.glob("*.xlsx")):
        prod = x.stem
        meta_p = d / f"{prod}.meta.json"
        if (out / f"{prod}.json").exists() and not force:
            continue
        meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else {}
        rows, info = read_file(x)
        val = validate(rows, info)
        out.mkdir(parents=True, exist_ok=True)
        to_parquet(rows, out / f"{prod}.parquet")
        tracks: dict[str, float] = {}
        for r in rows:
            tracks[r["track"]] = round(tracks.get(r["track"], 0.0) + r["fv"], 3)
        fund_of = {}
        for r in rows:
            fund_of.setdefault(r["track"], r["fund"])
        doc = {"manager": mid, "quarter": q, "product": prod, "source": meta, **{k: info[k] for k in ("cover", "summary", "sheets", "off_balance", "unknown_sheets", "seconds")},
               "tracks": tracks, "track_fund": fund_of, "validation": val}
        (out / f"{prod}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        msgs.append(f"{mid:10} {q} {prod}: {len(rows)} rows, {sum(tracks.values()) / 1e6:,.1f} NIS bn, {len(tracks)} tracks, "
                    f"summary {val['summary']['checked'] - len(val['summary']['fail'])}/{val['summary']['checked']}, "
                    f"pct {val['pct']['checked'] - len(val['pct']['fail'])}/{val['pct']['checked']}, {info['seconds']}s"
                    + ("" if val["ok"] else "  VALIDATION FAIL") + (f"  unknown {info['unknown_sheets']}" if info["unknown_sheets"] else ""))
    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("managers", nargs="*")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--file")
    a = ap.parse_args()
    if a.file:
        rows, info = read_file(Path(a.file))
        val = validate(rows, info)
        print(json.dumps({"cover": info["cover"], "sheets": info["sheets"], "unknown": info["unknown_sheets"], "validation": val,
                          "seconds": info["seconds"]}, ensure_ascii=False, indent=1))
        return
    for d in raw_dirs():
        if a.managers and d.parent.name not in a.managers:
            continue
        for m in run_dir(d, a.force):
            print(m, flush=True)


if __name__ == "__main__":
    main()
