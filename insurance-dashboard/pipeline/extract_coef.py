"""W6 · read the annuity conversion coefficient tables (מקדמי המרה לקצבה) out of each pension fund's bylaws PDF.

python3 pipeline/extract_coef.py [--raw DIR]
  -> data/regulation/coef_tables.json   every table cell read, per fund, with its pages, the heading quoted from the page, the
                                        table's classification (survivors' share, guarantee months, sex) and the PDF's sha256;
                                        tables that fail a check are listed under `excluded` with the reason, never published
The register is data/regulation/coef_src.json (URL, edition, retrieval date, appendix pages per fund). The PDFs themselves are
not in git: --raw names the folder holding them (default data/raw/regulator/coef). Exit 1 on a structural failure (a page whose
option cannot be read, a cell under no column, a raw file missing).

Method. `pdftotext -tsv` gives every word with its coordinates, so a cell is assigned to the birth-year column whose x-centre is
nearest (pdftotext -layout cannot be trusted here: the funds print the tables right to left with uneven spacing and blank cells;
a number pdftotext splits in two, "156" + ".15", is joined first). A header line holds four or more birth years; the sex of the
table is the nearest "גברים/גבר" or "נשים/אישה" word above it inside the table's horizontal span (the age-gap side tables, whose
header holds both words, are ignored); when a page's second table carries no word, it is the women's table by the funds' fixed
order (men first), flagged `sex_by_order`. A data line holds one retirement age outside the year span and the cells. The option
(survivors' share, guarantee) is read from the words printed on the page, in this order: a "no survivors" phrase; an explicit share
("בת זוג מקבלת 60%"); a spouse phrase with the share taken from the page's footnote, else 'x' (unspecified: Infinity names no
share). The guarantee: "ל-10 שנים" / "120 חודשים" / "עד גיל 87" / a "no guarantee" phrase; a fund whose headings name no guarantee
(Infinity) declares `guarantee_default0` in the register. A page with cells and no option words continues the previous page.
Checks, per table (a failure excludes the table): the coefficient falls with the retirement age in every birth-year column and never
falls with the birth year in every row; the ages are contiguous; cells for ages 60–70 lie in [145, 260]; for the no-survivors tables
the women's cell is never below the men's. Standard library + pdftotext (poppler).
"""
import hashlib
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "regulation" / "coef_src.json"
OUT = ROOT / "data" / "regulation" / "coef_tables.json"
BIDI = re.compile("[‎‏‪-‮⁦-⁩]")
YEAR = re.compile(r"^(19[3-9]\d|20[01]\d)$")
VAL = re.compile(r"^\d{1,3}\.\d{2}$")
INT = re.compile(r"^\d{1,3}$")
FRAC = re.compile(r"^\.\d{2}$")
AGE = re.compile(r"^\d{2}$")
# pdftotext -tsv prints a Hebrew word in visual (reversed) order; the layout text is logical. Markers are matched both ways.
MALE = re.compile(r"גברים|גבר|םירבג|רבג")
FEMALE = re.compile(r"נשים|אישה|אשה|םישנ|השיא|השא")
HEAD_WORDS = ("מקדמי המרה", "מקדם זיקנה", "מקדם זקנה", "נספח", "הבטחה", "מובטחים", "שאירים", "שארים", "נשוי")
LO, HI = 145.0, 260.0
fails = []


def norm(s):
    return re.sub(r"\s+", " ", BIDI.sub("", s)).strip()


def pdftotext(pdf, page, *flags):
    return subprocess.run(["pdftotext", *flags, "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True).stdout


def words(pdf, page):
    """the words of one page as (x-centre, top, text), a split number ("156" then ".15") joined"""
    ws = []
    for ln in pdftotext(pdf, page, "-tsv").splitlines()[1:]:
        f = ln.split("\t")
        if len(f) < 12 or f[0] != "5":
            continue
        t = BIDI.sub("", f[11]).strip()
        if not t:
            continue
        left, top, width = float(f[6]), float(f[7]), float(f[8])
        ws.append([left, top, width, t])
    ws.sort(key=lambda w: (round(w[1]), w[0]))
    out, i = [], 0
    while i < len(ws):
        w = ws[i]
        if i + 1 < len(ws) and abs(ws[i + 1][1] - w[1]) < 3 and ws[i + 1][0] - (w[0] + w[2]) < 6:
            n = ws[i + 1]
            if INT.match(w[3]) and FRAC.match(n[3]):
                out.append(((w[0] + n[0] + n[2]) / 2, w[1], w[3] + n[3])); i += 2; continue
            if FRAC.match(w[3]) and INT.match(n[3]):
                out.append(((w[0] + n[0] + n[2]) / 2, w[1], n[3] + w[3])); i += 2; continue
        out.append((w[0] + w[2] / 2, w[1], w[3])); i += 1
    return out


def lines_of(ws, tol=4.0):
    """words grouped into lines by their top coordinate, each line sorted left to right"""
    ws = sorted(ws, key=lambda w: (w[1], w[0]))
    lines, cur, top = [], [], None
    for w in ws:
        if top is None or abs(w[1] - top) <= tol:
            cur.append(w)
            top = w[1] if top is None else top
        else:
            lines.append(sorted(cur, key=lambda x: x[0]))
            cur, top = [w], w[1]
    if cur:
        lines.append(sorted(cur, key=lambda x: x[0]))
    return lines


def classify(text, g_default=None):
    """(survivors share: 0 | 30 | 60 | 100 | 'x' | None, guarantee: months | 0 | 'to87' | None) from the words of a page"""
    t = re.sub(r"\s+", " ", text)
    t2 = re.sub(r"\s*%\s*", "%", t)
    if re.search(r"ללא שאירים|ללא שארים|ללא נשוי|לא נשוי|ללא בן ?/ ?בת זוג|ללא זכאות", t):
        surv = 0
    else:
        m = re.search(r"(?:מקבלת|מקבל|עם) ?(30|60|100)%", t2)
        if m:
            surv = int(m.group(1))
        elif re.search(r"נשוי|עם בן/בת זוג|כולל זכאות", t):
            m = re.search(r"(?:שיעור קצבה של|אחוז לבן זוג ?\.?|לבן זוג ?:?|בשיעור של) ?(30|60|100)%", t2) or re.search(r"(30|60|100)% ?לב[נת] ?/? ?הזוג", t2)
            surv = int(m.group(1)) if m else "x"
        else:
            surv = None
    m = re.search(r"(?:הבטחה|מובטחים) ל ?(\d{1,2}) ?-? ?שנים", t)
    if m:
        g = int(m.group(1)) * 12
    else:
        m = re.search(r"(\d{2,3}) ?חודשים", t)
        if m:
            g = int(m.group(1))
        elif "עד גיל 87" in t:
            g = "to87"
        elif re.search(r"ללא הבטחה|ללא תשלומים מובטחים|ללא תקופת תשלומים|ללא תקופת הבטחה", t):
            g = 0
        else:
            g = g_default if surv is not None else None
    return surv, g


def sex_of(ws):
    m = any(MALE.search(w[2]) and not FEMALE.search(w[2]) for w in ws)
    f = any(FEMALE.search(w[2]) for w in ws)
    if m and f:
        return None  # a side table header naming both
    return "m" if m else "f" if f else None


def parse_page(pdf, page, g_default=None):
    """the tables on one page: [{sex, sex_by_order, years, cols, rows: {age: [v|None]}}], the option read from the page, the heading"""
    lines = lines_of(words(pdf, page))
    # the page's words in logical order (for the option and the quoted heading): the layout text, not the reversed TSV words
    lay = BIDI.sub("", pdftotext(pdf, page, "-layout"))
    text = norm(lay)
    heading = next((norm(l) for l in lay.splitlines() if any(k in l for k in HEAD_WORDS) and not re.fullmatch(r"[\d.\-\s%]*", l) and len(norm(l)) < 120), "")
    tables, cur, sex_pending = [], None, None
    for ln in lines:
        toks = [w[2] for w in ln]
        years = [(int(w[2]), w[0]) for w in ln if YEAR.match(w[2])]
        if len(years) >= 4:
            xs = sorted(x for _, x in years)
            lo, hi = xs[0], xs[-1]
            cw = statistics.median(xs[i + 1] - xs[i] for i in range(len(xs) - 1))
            here = [w for w in ln if (MALE.search(w[2]) or FEMALE.search(w[2])) and lo - 80 <= w[0] <= hi + 200]
            s = sex_of(here) or sex_pending
            cols = sorted(years, key=lambda t: t[0])  # birth-year order; each keeps its x for the cells
            cur = {"sex": s, "sex_by_order": False, "years": [y for y, _ in cols], "cols": cols, "cw": cw, "lo": lo, "hi": hi, "rows": {}}
            tables.append(cur)
            sex_pending = None
            continue
        marks = [w for w in ln if MALE.search(w[2]) or FEMALE.search(w[2])]
        if marks:
            s = sex_of(marks)
            if s and cur is not None and not cur["rows"]:
                cur["sex"] = cur["sex"] or s
            elif s:
                sex_pending = s
            if not any(VAL.match(t) or t == "-" for t in toks):
                continue
        if cur is None:
            continue
        vals = [w for w in ln if VAL.match(w[2]) or w[2] == "-"]
        half = cur["cw"] / 2
        ages = [w for w in ln if AGE.match(w[2]) and 55 <= int(w[2]) <= 95 and not (cur["lo"] - half <= w[0] <= cur["hi"] + half)]
        if len(ages) != 1 or len(vals) < 1:
            continue
        age = int(ages[0][2])
        row = [None] * len(cur["cols"])
        for x, _, t in vals:
            if not (cur["lo"] - cur["cw"] * 0.6 <= x <= cur["hi"] + cur["cw"] * 0.6):
                continue  # a side table's number
            j = min(range(len(cur["cols"])), key=lambda i: abs(cur["cols"][i][1] - x))
            if abs(cur["cols"][j][1] - x) > cur["cw"] * 0.6:
                fails.append(f"{pdf.name} p{page}: value {t} at x={x:.0f} is not under a birth-year column")
                continue
            v = None if t == "-" or float(t) == 0.0 else float(t)
            if row[j] is not None and v is not None:
                fails.append(f"{pdf.name} p{page} age {age}: two values under {cur['cols'][j][0]}")
            if v is not None:
                row[j] = v
        if age in cur["rows"]:
            fails.append(f"{pdf.name} p{page}: age {age} twice under one header")
        cur["rows"][age] = row
    tables = [t for t in tables if t["rows"]]
    # the funds print the men's table first: a second table with no word of its own is the women's
    for i, t in enumerate(tables):
        if t["sex"] is None and i > 0 and tables[i - 1]["sex"] == "m":
            t["sex"], t["sex_by_order"] = "f", True
    return tables, classify(text, g_default), heading


def problems(years, rows):
    """why a table cannot be published: not monotone, a gap in the ages, a cell outside the plausible range"""
    out = []
    ages = sorted(rows)
    if ages != list(range(ages[0], ages[-1] + 1)):
        out.append(f"ages not contiguous: {ages[0]}..{ages[-1]} ({len(ages)} rows)")
    for j, y in enumerate(years):
        col = [(a, rows[a][j]) for a in ages if rows[a][j] is not None]
        for (a1, v1), (a2, v2) in zip(col, col[1:]):
            if not v2 < v1:
                out.append(f"born {y}: {v1} at {a1} then {v2} at {a2}, not falling with age")
    for a in ages:
        row = [(years[j], v) for j, v in enumerate(rows[a]) if v is not None]
        for (y1, v1), (y2, v2) in zip(row, row[1:]):
            if v2 < v1 - 1e-9:
                out.append(f"age {a}: {v1} ({y1}) then {v2} ({y2}), falls with the birth year")
        if 60 <= a <= 70:
            for y, v in row:
                if not LO <= v <= HI:
                    out.append(f"age {a} born {y}: {v} outside [{LO}, {HI}]")
    return out


def extract(src, raw_dir):
    pdf = raw_dir / src["raw"]
    if not pdf.exists():
        fails.append(f"{src['id']}: raw file {pdf} missing")
        return None
    a, b = src["pages"]
    g_default = 0 if src.get("guarantee_default0") else None
    merged = {}  # (surv, guar, sex) -> {years, rows, pages, heading, by_order}
    prev = (None, None)
    for page in range(a, b + 1):
        tables, (surv, guar), heading = parse_page(pdf, page, g_default)
        if not tables:
            continue
        if surv is None or guar is None:
            if prev == (None, None):
                fails.append(f"{src['id']} p{page}: option not classified ({surv}, {guar}): {heading[:60]}")
                continue
            surv, guar = prev  # a continuation page
        prev = (surv, guar)
        for t in tables:
            if t["sex"] is None:
                fails.append(f"{src['id']} p{page}: a table with no sex marker ({heading[:50]})")
                continue
            k = (surv, guar, t["sex"])
            m = merged.setdefault(k, {"years": t["years"], "rows": {}, "pages": [], "heading": heading, "by_order": False})
            m["by_order"] = m["by_order"] or t["sex_by_order"]
            for age, row in t["rows"].items():
                full = row
                if t["years"] != m["years"]:  # a continuation page may print fewer columns: align on the year
                    full = [None] * len(m["years"])
                    for j, y in enumerate(t["years"]):
                        if y in m["years"]:
                            full[m["years"].index(y)] = row[j]
                        elif row[j] is not None:
                            fails.append(f"{src['id']} p{page}: birth year {y} not in the table's first page")
                if age in m["rows"]:
                    fails.append(f"{src['id']} p{page}: age {age} already read for {k}")
                m["rows"][age] = full
            if page not in m["pages"]:
                m["pages"].append(page)
    out, excluded = [], []
    for (surv, guar, sex), m in sorted(merged.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]), kv[0][2])):
        key = f"s{surv}_g{guar}_{sex}"
        ages = sorted(m["rows"])
        rec = {"survivors": surv, "guarantee": guar, "sex": sex, "pages": m["pages"], "quote": m["heading"], "years": m["years"], "ages": ages,
               "v": [m["rows"][a] for a in ages]}
        if m["by_order"]:
            rec["sex_by_order"] = True
        pr = problems(m["years"], m["rows"])
        if pr:
            excluded.append({"key": key, "pages": m["pages"], "why": pr[:4], "n": len(pr)})
        else:
            out.append(rec)
    # the no-survivors tables: women never below men
    by = {(t["survivors"], t["guarantee"], t["sex"]): t for t in out}
    for (s, g, sx), t in list(by.items()):
        if s == 0 and sx == "m" and (0, g, "f") in by:
            f = by[(0, g, "f")]
            bad = []
            for a in t["ages"]:
                if a in f["ages"]:
                    rm, rf = t["v"][t["ages"].index(a)], f["v"][f["ages"].index(a)]
                    for j, y in enumerate(t["years"]):
                        if y in f["years"] and rm[j] is not None and rf[f["years"].index(y)] is not None and rf[f["years"].index(y)] < rm[j]:
                            bad.append(f"age {a} born {y}: women {rf[f['years'].index(y)]} < men {rm[j]}")
            if bad:
                excluded.append({"key": f"s0_g{g}", "pages": sorted(set(t["pages"] + f["pages"])), "why": bad[:4], "n": len(bad)})
                out = [x for x in out if not (x["survivors"] == 0 and x["guarantee"] == g)]
    return {"sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "file": pdf.name, "pages": list(src["pages"]), "tables": out, "excluded": excluded}


def main():
    raw_dir = ROOT / "data" / "raw" / "regulator" / "coef"
    if "--raw" in sys.argv:
        raw_dir = Path(sys.argv[sys.argv.index("--raw") + 1])
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    out = {"$comment": "generated by pipeline/extract_coef.py from the bylaws PDFs named in data/regulation/coef_src.json (the PDFs are not in git); do not edit",
           "extracted": reg["retrieved"], "funds": {}}
    for s in reg["sources"]:
        r = extract(s, raw_dir)
        if r is None:
            continue
        out["funds"][s["grp"]] = r
        cells = sum(sum(1 for row in t["v"] for v in row if v is not None) for t in r["tables"])
        print(f"{s['id']}: {len(r['tables'])} tables, {cells} cells" + (f"; excluded {[e['key'] for e in r['excluded']]}" if r["excluded"] else ""))
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(out['funds'])} funds -> {OUT.relative_to(ROOT)}; failures: {len(fails)}")
    for f in fails[:60]:
        print("FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
