"""W11 · read the insurance-cost tables (disability cost factor, survivors' sum-at-risk factors, death-risk rate) out of each new
comprehensive pension fund's bylaws PDF.

python3 pipeline/extract_covers.py [--raw DIR]
  -> data/regulation/covers_tables.json   every row read from every table the register lists, per fund, with its pages, the heading
                                          quoted from the page and the PDF's sha256; a table that fails a check is listed under
                                          `excluded` with the reason, never published
The register is data/regulation/covers_src.json (pages, the columns in print order, the column used); the PDFs are the files of the
coefficient register (data/regulation/coef_src.json, `raw`), not in git: --raw names the folder holding them (default
data/raw/regulator/coef). Exit 1 on a structural failure (a quote not on its page, a birth-year header that differs from the register,
a raw file missing, a table with no rows).

Method. `pdftotext -layout` prints each table row on one line, the cells in print order left to right (a table whose page overlays
a text box on the rows is read with `-raw`, the content-stream order, register `mode: raw`). A data line is a line whose
tokens (Hebrew words dropped: Harel prints the first row as "עד 18") are all numbers or '-'; its age is the token in the register's
'age' position. fill 'full': the line has one token per column. fill 'left': the line has the age and its first n cells (the later birth
years are blank on the page). A birth-year table's header line (four or more years) must equal the register's years in order.
Checks, per table (a failure excludes the table): ages contiguous; at least the standard ages 30, 40, 50 read; in a 'left' table the
number of cells never falls with the age; cells in range (disability factor 0–80, widow's / combined factor 50–320, orphans' 0–200,
death rate 0–60 per ₪100,000); a female-member table whose cells equal the male-member table cell for cell (a copy) is excluded.
Standard library + pdftotext (poppler).
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "regulation" / "covers_src.json"
COEF_SRC = ROOT / "data" / "regulation" / "coef_src.json"
OUT = ROOT / "data" / "regulation" / "covers_tables.json"
BIDI = re.compile("[‎‏‪-‮⁦-⁩]")
NUM = re.compile(r"^\d{1,3}(?:\.\d{1,5})?$")
YEAR = re.compile(r"^(19[4-9]\d|20[0-2]\d)$")
HEB = re.compile(r"[֐-׿]")
RANGE = {"dis": (0.0, 80.0), "wid": (50.0, 320.0), "comb": (50.0, 320.0), "orph": (0.0, 200.0), "mort": (0.0, 60.0)}
STD_AGES = (30, 40, 50)
fails = []


def page_text(pdf, page, mode="layout"):
    t = subprocess.run(["pdftotext", f"-{mode}", "-f", str(page), "-l", str(page), str(pdf), "-"], capture_output=True, text=True).stdout
    return BIDI.sub("", t)


def squash(s):
    return re.sub(r"\s+", "", BIDI.sub("", s))


def data_rows(text, cols, fill):
    """{age: {col: value}} from the page's lines; cols as in the register (labels, years, 'age')"""
    out = {}
    n_age = cols.count("age")
    for ln in text.splitlines():
        tk = [t for t in ln.split() if not HEB.search(t)]
        if len(tk) < 2 or not all(t == "-" or NUM.match(t) for t in tk):
            continue
        if fill == "full":
            if len(tk) != len(cols):
                continue
            ages = [int(tk[i]) for i, c in enumerate(cols) if c == "age" and tk[i] != "-" and "." not in tk[i]]
            if len(ages) != n_age or len(set(ages)) != 1 or not 15 <= ages[0] <= 75:
                continue
            row = {str(c): (None if tk[i] == "-" else float(tk[i])) for i, c in enumerate(cols) if c != "age"}
            out[ages[0]] = row
        else:  # 'left': the age at its end of the line, then the first cells
            if cols[-1] == "age":
                age_t, cells = tk[-1], tk[:-1]
            else:
                age_t, cells = tk[0], tk[1:]
            if "." in age_t or not 15 <= int(age_t) <= 75:
                continue
            vcols = [c for c in cols if c != "age"]
            if not 1 <= len(cells) <= len(vcols) or any(c == "-" for c in cells):
                continue
            row = {str(c): None for c in vcols}
            for c, v in zip(vcols, cells):
                row[str(c)] = float(v)
            out[int(age_t)] = row
    return out


def header_years(text):
    """the first line holding four or more birth years, in print order"""
    for ln in text.splitlines():
        ys = [t for t in ln.split() if YEAR.match(t)]
        if len(ys) >= 4:
            return [int(y) for y in ys]
    return None


def read_table(pdf, t):
    mode = t.get("mode", "layout")
    first = page_text(pdf, t["pages"][0], mode)
    sq = squash(first if mode == "layout" else page_text(pdf, t["pages"][0]))
    for q in [t["quote"], *t.get("also", [])]:
        if squash(q) not in sq:
            fails.append(f"{pdf.name} p{t['pages'][0]}: '{q}' not on the page")
            return None, None
    years = [c for c in t["cols"] if isinstance(c, int)]
    rows = {}
    for p in t["pages"]:
        text = first if p == t["pages"][0] else page_text(pdf, p, mode)
        if years:
            hy = header_years(text)
            if hy is not None and hy != years:
                fails.append(f"{pdf.name} p{p}: birth-year header {hy} differs from the register {years}")
                return None, None
        for age, row in data_rows(text, t["cols"], t["fill"]).items():
            rows.setdefault(age, row)
    if not rows:
        fails.append(f"{pdf.name} p{t['pages']}: no rows read ({t['kind']}/{t['sex']})")
        return None, None
    # keep the column used (label tables) or every birth year (year tables)
    if years:
        v = {a: [rows[a][str(y)] for y in years] for a in sorted(rows)}
    else:
        v = {a: rows[a][t["pick"]] for a in sorted(rows)}
    why = check(t, v, years)
    return {"kind": t["kind"], "sex": t["sex"], "pages": t["pages"], "quote": t["quote"], "years": years or None,
            "col": None if years else t["pick"], "fill": t["fill"], "ages": sorted(v), "v": [v[a] for a in sorted(v)],
            **({"note": t["note"]} if t.get("note") else {})}, why


def check(t, v, years):
    ages = sorted(v)
    if ages != list(range(ages[0], ages[-1] + 1)):
        return f"ages not contiguous: {ages[0]}..{ages[-1]}, {len(ages)} rows"
    if any(a not in v for a in STD_AGES):
        return "a standard age (30, 40, 50) not read"
    lo, hi = RANGE[t["kind"]]
    cells = [x for a in ages for x in (v[a] if years else [v[a]]) if x is not None]
    bad = [x for x in cells if not lo <= x <= hi]
    if bad:
        return f"cells outside [{lo}, {hi}]: {bad[:3]}"
    if years and t["fill"] == "left":
        ns = [sum(x is not None for x in v[a]) for a in ages]
        if any(b < a for a, b in zip(ns, ns[1:])):
            return "a 'left' table whose row length falls with the age (a blank cell inside a row)"
    return None


def main():
    raw_dir = ROOT / "data" / "raw" / "regulator" / "coef"
    if "--raw" in sys.argv:
        raw_dir = Path(sys.argv[sys.argv.index("--raw") + 1])
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    coef = {s["id"]: s for s in json.loads(COEF_SRC.read_text(encoding="utf-8"))["sources"]}
    out = {"$comment": "W11 · written by pipeline/extract_covers.py from the PDFs named in data/regulation/coef_src.json (`raw`) and the tables listed in data/regulation/covers_src.json; do not edit by hand",
           "funds": {}}
    for f in reg["funds"]:
        src = coef.get(f["src"])
        if not src:
            fails.append(f"{f['id']}: no source '{f['src']}' in coef_src.json")
            continue
        pdf = raw_dir / src["raw"]
        if not pdf.exists():
            fails.append(f"{f['id']}: raw file missing: {pdf}")
            continue
        tabs, excl = [], []
        for t in f["tables"]:
            tab, why = read_table(pdf, t)
            if tab is None:
                continue
            if why:
                excl.append({"kind": t["kind"], "sex": t["sex"], "pages": t["pages"], "why": why})
            else:
                tabs.append(tab)
        # a female-member table that copies the male-member table cell for cell
        for kind in ("wid", "comb", "mort", "dis"):
            m = next((x for x in tabs if x["kind"] == kind and x["sex"] == "m"), None)
            w = next((x for x in tabs if x["kind"] == kind and x["sex"] == "f"), None)
            if m and w and m["ages"] == w["ages"] and m["v"] == w["v"]:
                tabs.remove(w)
                excl.append({"kind": kind, "sex": "f", "pages": w["pages"],
                             "why": f"בתקנון, טבלת העמיתה זהה תא בתא לטבלת העמית (עמ' {', '.join(map(str, w['pages']))} מול עמ' {', '.join(map(str, m['pages']))}): נראית כהעתק, ולכן לא פורסמה"})
        out["funds"][f["id"]] = {"sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "file": pdf.name, "tables": tabs, "excluded": excl}
        print(f"{f['id']}: {len(tabs)} tables, {len(excl)} excluded" + "".join(f"\n   excluded {e['kind']}/{e['sex']} p{e['pages']}: {e['why']}" for e in excl))
    if fails:
        print("FAIL\n  " + "\n  ".join(fails))
        sys.exit(1)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {sum(len(x['tables']) for x in out['funds'].values())} tables")


if __name__ == "__main__":
    main()
