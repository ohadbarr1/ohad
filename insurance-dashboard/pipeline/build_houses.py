"""Investment-house economics by activity: segment revenue, segment result, margin and AUM, per house and period, and the bridge from
the regulator-derived pension and provident fee revenue to the house's reported revenue.

python3 pipeline/build_houses.py           -> web/public/data/houses.json
python3 pipeline/build_houses.py --check   rebuild in memory and compare (exit 1 on a difference)

Source: data/extracted_houses/<house>/<period>.json (EXTRACT_SPEC.md v11): the operating-segments note, the income statement and the
board report of each house's own periodic report, every figure with its page (checked with pipeline/verify_ifrs_std.py when extracted).
Pension and provident: web/public/data/lens.json (regulator assets, gemel-net / pensia-net, and the managing company's reported fees).

Rules: values in NIS millions (AUM in NIS billions) converted from the printed unit; the period's own report wins, then the newest
reprint (a different reprint is flagged restated). A segment's margin = segment result / segment revenue (derived, flag 1). Where one
activity code covers two printed segments with no printed parent (Altshuler 2024: gemel and pension), the two are added (flag 1, parts
listed). The bridge's residuals are differences of printed or regulator figures and are labelled as such. Nothing is estimated.
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extracted_houses"
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "houses.json"
FILES = "https://mayafiles.tase.co.il/"
HOUSES = [("meitav", "מיטב"), ("altshuler", "אלטשולר שחם"), ("more", "מור"), ("analyst", "אנליסט"), ("ibi", "אי.בי.אי"), ("yelin", "ילין לפידות")]
LENS_ID = {"meitav": "meitav", "altshuler": "altshuler", "more": "more", "analyst": "analyst", "yelin": "yelin"}
CODES = {"provident_pension": "גמל ופנסיה", "investment_management": "ניהול השקעות (גמל, קרנות ותיקים)", "mutual_funds": "קרנות נאמנות", "etf": "קרנות סל", "portfolio_management": "ניהול תיקים",
         "brokerage": "ברוקראז' ומסחר", "alternatives": "השקעות אלטרנטיביות", "credit": "אשראי", "insurance_agency": "סוכנות ביטוח",
         "investment_banking": "חיתום והנפקות", "other": "אחר", "adjustments": "התאמות / לא מוקצה", "total": "סה\"כ"}
GROUP = ["revenue_total", "operating_profit", "profit_before_tax", "net_profit", "profit_attributable", "selling_marketing", "g_and_a",
         "commissions_expense", "agent_commissions", "salaries_expense", "amortisation_intangibles", "depreciation_amortisation", "finance_expense",
         "credit_interest_income", "credit_funding_expense", "tax_expense", "income_tax", "share_of_associates", "legal_claims_refund",
         "legal_claims_finance_net", "operating_and_g_and_a_expenses", "operating_expenses_and_commissions"]
GROUP_HE = {"revenue_total": "סך הכנסות", "operating_profit": "רווח תפעולי", "profit_before_tax": "רווח לפני מס", "net_profit": "רווח נקי",
            "profit_attributable": "רווח לבעלי המניות", "selling_marketing": "שיווק ומכירה", "g_and_a": "הנהלה וכלליות", "commissions_expense": "עמלות",
            "agent_commissions": "עמלות סוכנים", "salaries_expense": "שכר", "amortisation_intangibles": "הפחתת נכסים בלתי מוחשיים",
            "depreciation_amortisation": "פחת והפחתות", "finance_expense": "הוצאות מימון", "credit_interest_income": "הכנסות ריבית מאשראי",
            "credit_funding_expense": "עלות מימון האשראי", "tax_expense": "מסים על ההכנסה", "income_tax": "מסים על ההכנסה",
            "share_of_associates": "חלק ברווחי כלולות", "legal_claims_refund": "החזר בגין תביעות משפטיות", "legal_claims_finance_net": "הכנסות מימון בגין תביעות",
            "operating_and_g_and_a_expenses": "הוצאות תפעול, הנהלה וכלליות", "operating_expenses_and_commissions": "הוצאות תפעול ועמלות"}
# Yelin Lapidot is 50% held by the listed filer (Atrau, equity method); its own statements at 100% are attached to the filing and are the house
ENTITY = {"yelin": "yelin_lapidot"}
# Analyst prints one investment-management segment (provident funds, mutual funds and portfolios together): not a provident-only figure
RECODE = {("analyst", "provident_pension"): "investment_management"}
NOTE = {"yelin": "ילין לפידות ניהול השקעות במאוחד, 100% (הדוח של אטראו, המחזיקה 50% בשיטת השווי המאזני, מצרף את דוחותיה)",
        "analyst": "אנליסט מציגה מגזר אחד של ניהול השקעות (גמל, קרנות ותיקים יחד) ומגזר השקעות עצמיות; ההכנסות לפי פעילות מדוח רווח והפסד",
        "meitav": "מגזר 'ניהול חיסכון שוטף' כולל קרנות נאמנות, קרנות סל וניהול תיקים; מ-2026 ברוקראז' מוסדי עבר למגזר הברוקראז' (2025 הוצג מחדש)",
        "ibi": "מגזר קרנות הנאמנות כולל גם ניהול תיקים; אין לאי.בי.אי פעילות גמל ופנסיה",
        "more": "'מגזרים אחרים' כולל ברוקראז', קרנות גידור והשקעה ועשיית שוק; מור אשראי מוצגת לפי שיטת השווי המאזני",
        "altshuler": "2024: גמל ופנסיה הוצגו כשני מגזרים (נסכמו כאן, מסומן); מ-2025 מגזר אחד עם פירוט משני"}
UNIT_M = {"NIS millions": 1.0, "NIS thousands": 0.001, "NIS billions": 1000.0, "USD millions": None, "USD billions": None, "percent": None}


def pkey(p):
    return (int(p[:4]), {"Q1": 1, "Q2": 2, "Q3": 3, "FY": 4}[p[4:]])


def own_period(w, d):
    q = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}.get(d[5:10])
    return d[:4] + q if q else None


def wkey(w, d):
    """fy|2025, ytd|2026-06, q|2026-06: the window of a figure."""
    return f"fy|{d[:4]}" if w == "fy" else f"{w}|{d[:7]}"


def load(h):
    rows, nf, reps = [], [], {}
    for f in sorted((SRC / h).glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        rp = f.stem
        reps[rp] = d.get("report_id_he")
        nf += [{**x, "rp": rp} for x in d.get("not_found", [])]
        fu = d.get("unit") or "NIS millions"
        for x in d["facts"]:
            if x.get("value") is None or ENTITY.get(h) and x.get("entity") != ENTITY[h]:
                continue
            u = x.get("unit") or fu
            m = re.search(r"(\d{6,8})", str(x.get("doc") or ""))
            code = x.get("segment") or "total"
            code = RECODE.get((h, code), code)
            rows.append({"rp": rp, "m": x["metric"], "code": code, "he": (x.get("segment_he") or "").strip(), "w": x.get("window"),
                         "d": (x.get("date") or "")[:10], "v": float(x["value"]), "u": u, "pg": x.get("page_he"), "r": int(m.group(1)) if m else d.get("report_id_he"),
                         "l": " ".join(str(x.get("label") or "").split())[:90], "src": x.get("source") or "table", "n": " ".join(str(x.get("note") or "").split())[:200],
                         "ent": x.get("entity")})
    return rows, nf, reps


def conv(r, to="m"):
    f = UNIT_M.get(r["u"], 1.0)
    if f is None:
        return None
    return r["v"] * f / (1000.0 if to == "bn" else 1.0)


def pick(cands):
    """The period's own report first, then the newest reprint; restated when another report printed a different figure."""
    def order(r):
        own = own_period(r["w"], r["d"])
        return (r["rp"] != own, tuple(-x for x in pkey(r["rp"])), r["src"] != "table", r["pg"] or 0)
    cands = sorted(cands, key=order)
    b = cands[0]
    alt = next((x for x in cands[1:] if x["rp"] != b["rp"] and conv(x) is not None and conv(b) is not None and abs(conv(x) - conv(b)) > 0.5), None)
    return b, alt


def cell(r, to="m", alt=None, flags=0):
    v = conv(r, to)
    out = [round(v, 3), r["pg"], r["r"]]
    if r["src"] in ("chart", "text"):
        flags |= 4
    if alt is not None and conv(alt, to) is not None and abs(conv(alt, to) - v) > (0.05 if to == "bn" else 0.5):
        flags |= 2
        out += [flags, [round(conv(alt, to), 3), alt["pg"], alt["r"]]]
    elif flags:
        out.append(flags)
    return out


def segment_series(rows, metric):
    """{code: {window key: cell}} for the segment note's rows; a printed parent beats its sub-rows ("<segment>: <sub>")."""
    out = defaultdict(dict)
    names = defaultdict(set)
    by = defaultdict(list)
    for r in rows:
        if r["m"] == metric and r["w"] in ("q", "ytd", "fy") and r["code"] in CODES:
            by[(r["code"], r["w"], r["d"])].append(r)
    for (code, w, d), C in by.items():
        top = [r for r in C if ":" not in r["he"]] or C
        hes = sorted({r["he"] for r in top})
        # one printed segment per (code, window): if two printed segments share a code in one report, add them (flag 1)
        per = defaultdict(list)
        for r in top:
            per[r["he"]].append(r)
        if len(per) == 1 or code == "total":
            b, a = pick(top)
            out[code][wkey(w, d)] = cell(b, alt=a)
            names[code].add(b["he"])
            continue
        picks = {he: pick(rs)[0] for he, rs in per.items()}
        # the same report must print all parts; otherwise the newest name wins (a renamed segment)
        reps = {p["rp"] for p in picks.values()}
        if len(reps) == 1 and len({p["pg"] for p in picks.values()}) == 1 and all(p["l"] == next(iter(picks.values()))["l"] for p in picks.values()):
            out[code][wkey(w, d)] = [round(sum(conv(p) for p in picks.values()), 3), None, None, 1, [[he, round(conv(p), 3), p["pg"], p["r"]] for he, p in sorted(picks.items())]]
            names[code] |= set(picks)
        else:
            b, a = pick(top)
            out[code][wkey(w, d)] = cell(b, alt=a)
            names[code].add(b["he"])
    return dict(out), {k: sorted(v) for k, v in names.items()}


def aum_series(rows):
    """AUM per activity at each period end, NIS billions: per code the printed total/net line where one is printed."""
    by = defaultdict(list)
    for r in rows:
        if r["m"] == "aum" and r["code"] in CODES and r["code"] not in ("adjustments",) and conv(r, "bn") is not None:
            by[(r["code"], r["d"])].append(r)
    out, names = defaultdict(dict), defaultdict(set)
    for (code, d), C in by.items():
        pref = sorted(C, key=lambda r: (":" in r["he"], not re.search(r"נטו|סה\"כ|סך", r["he"]), len(r["he"])))
        he = pref[0]["he"]
        b, a = pick([r for r in C if r["he"] == he])
        out[code][d[:7]] = cell(b, "bn", alt=a)
        names[code].add(he)
    return dict(out), {k: sorted(v) for k, v in names.items()}


def group_series(rows):
    out = {}
    for m in GROUP:
        by = defaultdict(list)
        for r in rows:
            if r["m"] == m and r["code"] == "total" and r["w"] in ("q", "ytd", "fy") and conv(r) is not None:
                by[(r["w"], r["d"])].append(r)
        if by:
            out[m] = {wkey(w, d): cell(*pick(C)[:1], alt=pick(C)[1]) for (w, d), C in by.items()}
    if "income_tax" in out and "tax_expense" not in out:
        out["tax_expense"] = out.pop("income_tax")
    return out


def margins(rev, prof):
    out = defaultdict(dict)
    for code, s in prof.items():
        for k, p in s.items():
            r = rev.get(code, {}).get(k)
            if r and r[0] and abs(r[0]) > 0.5 and code not in ("adjustments",):
                out[code][k] = [round(p[0] / r[0] * 100, 2), None, None, 1, [["segment_profit", p[0], p[1], p[2]], ["segment_revenue", r[0], r[1], r[2]]]]
    return dict(out)


def bridge(h, rev):
    """Regulator-posted asset fee (regulator AUM x posted fee) -> the managing company's reported fees -> the house's pension and provident
    segment revenue -> its total revenue, by quarter. Each step is printed or regulator data; each residual is a labelled difference."""
    lens = json.loads((DATA / "lens.json").read_text(encoding="utf-8"))
    gi = {g["id"]: i for i, g in enumerate(lens["groups"])}
    if h not in LENS_ID or LENS_ID[h] not in gi:
        return []
    out = []
    for r in lens["rows"]:
        if r["g"] != gi[LENS_ID[h]] or r["s"] != "pg" or not r.get("rep") or not r.get("reg"):
            continue
        qn, y = r["q"].split("-")
        end = {"Q1": "03", "Q2": "06", "Q3": "09", "Q4": "12"}[qn]
        k = f"q|{y}-{end}"
        seg = rev.get("provident_pension", {}).get(k)
        tot = rev.get("total", {}).get(k)
        avg, posted, fees = r["reg"]["avg"], r["reg"].get("posted"), r["rep"]["fees"]
        implied = round(avg * posted / 100 / 4, 3) if posted is not None else None
        out.append({"q": k, "reg_aum": round(avg, 1), "posted": posted, "implied": implied, "fees": round(fees, 3), "fy_reg": r.get("fy_reg"),
                    "gap_deposit_other": round(fees - implied, 3) if implied is not None else None,
                    "seg": seg, "seg_minus_fees": round(seg[0] - fees, 3) if seg else None, "total": tot,
                    "other_segments": round(tot[0] - seg[0], 3) if tot and seg else None})
    return sorted(out, key=lambda x: x["q"])


def build():
    houses = []
    for h, he in HOUSES:
        if not (SRC / h).exists():
            continue
        rows, nf, reps = load(h)
        rev, rn = segment_series(rows, "segment_revenue")
        prof, pn = segment_series(rows, "segment_profit")
        exp, _ = segment_series(rows, "segment_expenses")
        fees, _ = segment_series(rows, "management_fees")
        aum, an = aum_series(rows)
        keys = sorted({k for s in (rev, prof) for c in s.values() for k in c}, key=lambda k: (k.split("|")[1][:4], {"q": 0, "ytd": 1, "fy": 2}[k.split("|")[0]], k))
        houses.append({"id": h, "name": he, "note": NOTE.get(h), "reports": {p: reps[p] for p in sorted(reps, key=pkey)}, "keys": keys,
                       "rev": rev, "profit": prof, "exp": exp, "fees": fees, "margin": margins(rev, prof), "aum": aum,
                       "names": {c: sorted(set(rn.get(c, [])) | set(pn.get(c, []))) for c in sorted(set(rn) | set(pn))}, "aum_names": an,
                       "group": group_series(rows), "bridge": bridge(h, rev),
                       "nf": [{"m": x.get("metric"), "s": x.get("segment"), "why": str(x.get("why", ""))[:220], "rp": x["rp"]} for x in nf]})
    return {"built": None, "unit": "NIS millions (AUM: NIS billions)", "files": FILES,
            "source": "הדוחות התקופתיים של בתי ההשקעות, MAYA: ביאור מגזרי פעילות, דוח רווח והפסד ודוח הדירקטוריון; כל מספר עם עמוד. "
                      "גמל ופנסיה: הרשות לשוק ההון (גמל-נט, פנסיה-נט) ודוחות החברות המנהלות (lens.json)",
            "codes": CODES, "group_he": GROUP_HE,
            "flags": {"1": "נגזר: יחס/הפרש/סכום של מספרים שהודפסו", "2": "דוח מאוחר הדפיס ערך אחר", "4": "נקרא מגרף או מטקסט"},
            "bridge_note": "דמי ניהול מנכסים לפי הרגולטור = נכסים ממוצעים ברבעון (גמל-נט/פנסיה-נט) × דמי הניהול הממוצעים המשוקללים מהצבירה שהרגולטור מפרסם ÷ 4; "
                           "הפער מול דמי הניהול שהחברה המנהלת דיווחה = דמי ניהול מהפקדות והכנסות אחרות (הפרש, לא נתון מודפס). "
                           "מגזר הגמל והפנסיה של בית ההשקעות כולל גם הכנסות שאינן דמי ניהול של החברה המנהלת (הפרש).",
            "isa_note": "נתוני הקרנות החודשיים של רשות ניירות ערך / הבורסה הם מקור אפשרי בהמשך; כאן נכסי הקרנות הם כפי שהודפסו בדוחות.",
            "houses": houses}


def main(argv):
    out = build()
    check = "--check" in argv
    out["built"] = json.loads(OUT.read_text(encoding="utf-8")).get("built") if check and OUT.exists() else date.today().isoformat()
    s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    n = sum(len(c) for h in out["houses"] for c in h["rev"].values())
    if check:
        same = OUT.exists() and OUT.read_text(encoding="utf-8") == s
        print(f"houses: {len(out['houses'])} houses, {n} segment-revenue cells; " + ("file equals a rebuild" if same else "differs from a rebuild"))
        return 0 if same else 1
    OUT.write_text(s, encoding="utf-8")
    print(f"houses: {len(out['houses'])} houses, {n} segment-revenue cells, {len(s) // 1024} KB")
    for h in out["houses"]:
        print(" ", h["id"], "segments:", sorted(h["rev"]), "keys:", len(h["keys"]), "bridge quarters:", len(h["bridge"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
