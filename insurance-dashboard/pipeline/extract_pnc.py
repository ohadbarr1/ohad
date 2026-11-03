"""P&C by line of business, as each insurer prints it in the IFRS 17 general-insurance segment note (מגזר ביטוח כללי, מידע נוסף לפי
קבוצות תיקים עיקריות): per line (רכב חובה, רכב רכוש, אחר) and in total, for every period column of one periodic report.

    python3 pipeline/extract_pnc.py <pages-root> [company ...]

<pages-root>/<company>/pNNN.txt is `pdftotext -layout -f N -l N` of the report's PDF (1-based pages; MANUAL step: the PDFs are the public
MAYA files of the report ids below). Output: data/extracted_pnc/<company>/<period>.json, the v1 fact envelope (EXTRACT_SPEC.md):
{metric, segment, basis, window, date, value (NIS m), page_he, label, source}. Nothing is computed here except the unit (thousands -> m)
and the sign convention (every expense row stored expense-positive; `sign` in SPEC says how each filer prints it). Every page is
checked before it is written: revenue − expenses = result before reinsurance, that + the net reinsurance row = result, reinsurance income
− reinsurance expense = the net row, and the lines add up to the total column (within one printed unit). A page that fails is not written.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "extracted_pnc"
LINES = {"total": "pc", "other": "pc:אחר", "mp": "pc:רכב רכוש", "mc": "pc:רכב חובה"}
Y26, Y25, F25 = ("ytd", "2026-06-30"), ("ytd", "2025-06-30"), ("fy", "2025-12-31")
Q26, Q25 = ("q", "2026-06-30"), ("q", "2025-06-30")
STD = ["total", "other", "mp", "mc"]   # left-to-right print order of the four columns (RTL table: רכב חובה is rightmost)


def cols(order, windows):
    """the left-to-right column list: for each line in `order`, each window in `windows`"""
    return [(ln, w) for ln in order for w in windows]


# sign: e = sign × printed, per row family (ise: insurance service expenses; rx: reinsurance expense; cl: claims incurred; past: changes for past service)
SPEC = {
    "phoenix": {"rid": 1765739, "period": "2026Q2", "k": 1000, "sign": {"ise": 1, "rx": 1, "cl": 1, "past": 1},
                "pages": [(124, cols(STD, [Y26])), (125, cols(STD, [Y25])), (126, cols(STD, [Q26])), (127, cols(STD, [Q25])), (128, cols(STD, [F25]))]},
    "harel": {"rid": 1766123, "period": "2026Q2", "k": 1, "sign": {"ise": 1, "rx": 1, "cl": 1, "past": 1},
              "pages": [(100, cols(STD, [Y26])), (101, cols(STD, [Q26])), (102, cols(STD, [Y25])), (103, cols(STD, [Q25])), (104, cols(STD, [F25]))]},
    "migdal": {"rid": 1763684, "period": "2026Q2", "k": 1, "sign": {"ise": 1, "rx": 1, "cl": 1, "past": 1},
               "pages": [(84, cols(STD, [Y26])), (86, cols(STD, [Y25])), (88, cols(STD, [Q26])), (89, cols(STD, [Q25])), (90, cols(STD, [F25]))]},
    "clal": {"rid": 1764359, "period": "2026Q2", "k": 1, "sign": {"ise": -1, "rx": -1, "cl": 1, "past": 1},
             "pages": [(95, cols(STD, [F25, Y25, Y26])), (98, cols(STD, [Q25, Q26]))]},
    "menora": {"rid": 1765736, "period": "2026Q2", "k": 1000, "sign": {"ise": -1, "rx": -1, "cl": -1, "past": -1},
               "pages": [(102, cols(STD, [Y26])), (103, cols(STD, [Y25])), (104, cols(STD, [Q26])), (105, cols(STD, [Q25])), (106, cols(STD, [F25]))]},
    "ayalon": {"rid": 1764938, "period": "2026Q2", "k": 1000, "sign": {"ise": 1, "rx": 1, "cl": 1, "past": 1},
               "note": "the consolidated table (מאוחד: איילון + ווישור)",
               "pages": [(95, cols(STD, [Y26])), (97, cols(STD, [Y25])), (99, cols(STD, [Q26])), (100, cols(STD, [Q25])), (101, cols(STD, [F25]))]},
    "hachshara": {"rid": 1766421, "period": "2026Q2", "k": 1000, "sign": {"ise": 1, "rx": 1, "cl": 1, "past": 1},
                  "pages": [(54, cols(STD, [Y26])), (55, cols(STD, [Y25])), (56, cols(STD, [Q26])), (57, cols(STD, [Q25])), (58, cols(STD, [F25]))]},
}

# row families: (key, regex on the normalised label, sign family or None (as printed, income / profit positive))
ROWS = [
    ("rev", r"^הכנסות משירותי ביטוח$", None),
    ("ise", r"^הוצאות משירותי ביטוח( 1| א)?$", "ise"),
    ("isr_gross", r"שירותי ביטוח לפני ביטוחי? משנה", None),
    ("rx", r"^הוצאות מביטוח משנה$", "rx"),
    ("ri", r"^הכנסות (הוצאות )?מביטוח משנה$", None),
    ("rnet", r"נטו מחוזי ביטוח משנה מוחזקים$", None),
    ("isr", r"^רווח (הפסד )?משירותי ביטוח$", None),
    ("cl", r"תביעות והוצאות שירותי ביטוח אחרות? שהתהוו", "cl"),
    ("past", r"שהתהוו", "past"),
]
LABEL_HE = {"rev": "הכנסות משירותי ביטוח", "ise": "הוצאות משירותי ביטוח", "isr_gross": "רווח משירותי ביטוח לפני ביטוחי משנה מוחזקים",
            "rx": "הוצאות מביטוח משנה", "ri": "הכנסות מביטוח משנה", "rnet": "הכנסות (הוצאות) נטו מחוזי ביטוח משנה מוחזקים",
            "isr": "רווח (הפסד) משירותי ביטוח", "cl": "תביעות והוצאות שירותי ביטוח אחרות שהתהוו",
            "past": "שינויים המתייחסים לשירותי עבר - תיאום להתחייבויות בגין תביעות שהתהוו"}
BIDI = re.compile(r"[‎‏‪-‮⁦-⁩]")
NUM = re.compile(r"\)\s*\(\s*[\d,]+(?:\.\d+)?|\(\s*\)\s*[\d,]+(?:\.\d+)?|\(\s*[\d,]+(?:\.\d+)?\s*\)|[\d,]+(?:\.\d+)?|(?<!\S)[-�–‐‒–—](?!\S)")


def num(tok):
    t = tok.replace(" ", "")
    if not re.search(r"\d", t):   # a dash (any of the hyphen glyphs) or a broken glyph standing for one
        return 0.0
    neg = "(" in t or ")" in t
    v = float(re.sub(r"[^\d.]", "", t))
    return -v if neg else v


def split(line):
    """(numbers, label) of one printed row: the numbers are left of the Hebrew label in pdftotext -layout"""
    line = BIDI.sub("", line)
    line = re.sub(r"(?<=[א-ת])�|�(?=[א-ת])", "ת", line)   # a broken ת glyph inside a word; a lone one is a dash
    m = re.search(r"[א-ת]", line)
    head, label = (line[:m.start()], line[m.start():]) if m else (line, "")
    toks = NUM.findall(head)
    lab = re.sub(r"[()*]|\s\d\s*$", " ", label.replace("�", "ת"))
    lab = re.sub(r"\s+", " ", lab).strip()
    lab = re.sub(r"\s+\d$", "", lab)
    return [num(t) for t in toks if re.search(r"\d|^[-�–‐‒–—]$", t.strip())], lab


def parse_page(text, ncol):
    rows, pending = {}, None
    for raw in text.splitlines():
        if not raw.strip():
            continue
        vals, lab = split(raw)
        if len(vals) == ncol and not lab and pending:
            lab, pending = pending, None
        elif len(vals) == 0 and lab:
            pending = lab
            continue
        else:
            pending = None
        if len(vals) != ncol or not lab:
            continue
        for key, rx, _ in ROWS:
            if key in rows:
                continue
            if key == "past" and re.search(ROWS[7][1], lab):
                continue
            if re.search(rx, lab):
                rows[key] = (vals, lab)
                break
    return rows


def check(E, tol):
    """E: line -> key -> expense-positive value; the printed identities"""
    bad = []
    for ln, r in E.items():
        if {"rev", "ise", "isr_gross"} <= r.keys() and abs(r["rev"] - r["ise"] - r["isr_gross"]) > tol:
            bad.append(f"{ln}: revenue − expenses ≠ result before reinsurance ({r['rev']} − {r['ise']} vs {r['isr_gross']})")
        if {"ri", "rx", "rnet"} <= r.keys() and abs(r["ri"] - r["rx"] - r["rnet"]) > tol:
            bad.append(f"{ln}: reinsurance income − expense ≠ net ({r['ri']} − {r['rx']} vs {r['rnet']})")
        if {"isr_gross", "rnet", "isr"} <= r.keys() and abs(r["isr_gross"] + r["rnet"] - r["isr"]) > tol:
            bad.append(f"{ln}: result before reinsurance + net reinsurance ≠ result")
    if "total" in E:
        for key in E["total"]:
            parts = [E[ln].get(key) for ln in ("other", "mp", "mc")]
            if None not in parts and abs(sum(parts) - E["total"][key]) > 2 * tol:
                bad.append(f"{key}: lines {sum(parts)} ≠ total {E['total'][key]}")
    return bad


def extract(root, c):
    S = SPEC[c]
    facts, bad = [], []
    tol = 1.5 if S["k"] == 1 else 1500 / S["k"] * S["k"]
    for pg, cl in S["pages"]:
        text = (root / c / f"p{pg:03d}.txt").read_text(encoding="utf-8", errors="replace")
        rows = parse_page(text, len(cl))
        missing = [k for k, _, _ in ROWS if k not in rows]
        if missing:
            bad.append(f"p{pg}: rows not found: {missing}")
        per = {}   # (window, date) -> line -> key -> value (printed unit, expense-positive)
        for key, (vals, lab) in rows.items():
            fam = next(f for k, _, f in ROWS if k == key)
            sg = S["sign"][fam] if fam else 1
            if key == "rnet":
                # printed either as income-positive (most) or as an expense (Hachshara FY: "הוצאות (הכנסות) נטו"); store income − expense
                pass
            for (ln, w), v in zip(cl, vals):
                per.setdefault(w, {}).setdefault(ln, {})[key] = (sg * v, lab)
        for w, E in per.items():
            Ev = {ln: {k: v for k, (v, _) in r.items()} for ln, r in E.items()}
            for ln, r in Ev.items():   # the net reinsurance row: whichever sign makes income − expense
                if {"ri", "rx", "rnet"} <= r.keys() and abs(r["ri"] - r["rx"] + r["rnet"]) < abs(r["ri"] - r["rx"] - r["rnet"]):
                    r["rnet"] = -r["rnet"]
                    E[ln]["rnet"] = (r["rnet"], E[ln]["rnet"][1] + " [printed as an expense]")
            b = check(Ev, 1.5 if S["k"] == 1 else 1.5)
            bad += [f"p{pg} {w}: {x}" for x in b]
            for ln, r in E.items():
                for key, (v, lab) in r.items():
                    facts.append({"metric": f"pnc_{key}", "segment": LINES[ln], "basis": "gross" if key not in ("rx", "ri", "rnet") else "reinsurance",
                                  "window": w[0], "date": w[1], "value": round(v / S["k"], 6), "page_he": pg, "label": lab, "source": "table",
                                  "note": ("expense-positive (printed with the opposite sign)" if next(f for k, _, f in ROWS if k == key) and S["sign"][next(f for k, _, f in ROWS if k == key)] < 0 else "")})
    return facts, bad


def main():
    root = Path(sys.argv[1])
    cos = sys.argv[2:] or list(SPEC)
    allbad = 0
    for c in cos:
        S = SPEC[c]
        facts, bad = extract(root, c)
        if bad:
            allbad += len(bad)
            print(f"{c}: NOT written: " + "; ".join(bad[:8]))
            continue
        out = {"company": c, "period": S["period"], "report_id_he": S["rid"], "unit": "NIS millions" + (" (printed NIS thousands, divided by 1000)" if S["k"] == 1000 else ""),
               "source_note": "IFRS 17 general-insurance segment note, per main portfolio group (מידע נוסף לפי קבוצות תיקים עיקריות)" + (f"; {S['note']}" if S.get("note") else ""),
               "sign": S["sign"], "facts": facts,
               "not_found": [{"metric": "pnc_*", "segment": "health:*", "why": "the interim report prints no health table by line (short / long term); health is a segment total only"}]}
        p = OUT / c / f"{S['period']}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{c}: {len(facts)} facts -> {p.relative_to(ROOT)}")
    sys.exit(1 if allbad else 0)


if __name__ == "__main__":
    main()
