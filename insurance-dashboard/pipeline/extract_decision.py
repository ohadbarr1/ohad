"""W2 · read the raw decision sources (data/raw/regulator/) and verify the hand-curated register against them. Manual step: the raw files
live on the synced drive (data/raw is a symlink there) and are not in git; the committed outputs are the slim JSON.

python3 pipeline/extract_decision.py
  -> data/regulation/decision_claims.json   annex B3 (claims metrics) of the funds that publish Excel, read cell by cell
  -> data/raw/regulator/sources.json         every raw file: URL, retrieval date, sha256 (beside the files, on the drive)
and verifies data/regulation/decision_src.json:
  * transcribed B3 figures (PDF / picture files): every total and the handling-time distribution is re-found in the file's own text
    (pdftotext -layout row lines, or the text records of the pasted EMF picture)
  * the Phoenix .xls was read through a local .xlsx conversion: every non-trivial value is re-found as an IEEE double in the original
  * every coverage rule's `q` (and its `nums`) is printed on the cited bylaws page; every checklist `q` is in the cited page text
Exit 1 on any miss. Standard library + pdftotext (poppler).
"""
import hashlib
import json
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "regulator"
SRC = ROOT / "data" / "regulation" / "decision_src.json"
OUT = ROOT / "data" / "regulation" / "decision_claims.json"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
LABELS = {"approved": "תביעות שאושרו (*)", "rejected": "תביעות שנדחו", "settled": "תביעות שנסגרו בפשרה", "cancelled": "תביעות שבוטלו"}
CLOSED = "תביעות שנסגרו (א3+א4+א5+א6)"
BLOCKS = (("disability", "קצבת נכות"), ("death", "ריסק מוות"), ("survivors", "קצבת שארים"))
fails = []


def norm(s):
    return " ".join(re.sub("[‎‏‪-‮]", "", str(s)).split())


def xlsx_sheets(path):
    """{sheet name: {cell ref: value}} with the standard library (openpyxl refuses some of these files)"""
    z = zipfile.ZipFile(path)
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            ss.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for s in wb.find("m:sheets", NS):
        t = rels[s.get("{%s}id" % NS["r"])].lstrip("/")
        t = t if t.startswith("xl/") else "xl/" + t
        cells = {}
        for c in ET.fromstring(z.read(t)).iter("{%s}c" % NS["m"]):
            v, typ = c.find("m:v", NS), c.get("t")
            if typ == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is None:
                continue
            elif typ == "s":
                val = ss[int(v.text)]
            elif typ in ("str", "e", "b"):
                val = v.text
            else:
                val = float(v.text)
            cells[c.get("r")] = val
        out[s.get("name")] = cells
    return out


def col_n(c):
    n = 0
    for ch in c:
        n = n * 26 + ord(ch) - 64
    return n


def col_s(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def b3_from_cells(cells):
    """annex B3 from its cells: the block columns from the header row (קצבת נכות / ריסק מוות / קצבת שארים), the rows by their label"""
    by_row, label_row = {}, {}
    for ref, v in cells.items():
        m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
        by_row.setdefault(int(m.group(2)), {})[m.group(1)] = v
        if isinstance(v, str) and norm(v) and int(m.group(2)) not in label_row.get(norm(v), []):
            label_row.setdefault(norm(v), []).append(int(m.group(2)))
    start = {}
    for r in sorted(by_row):
        for c, v in by_row[r].items():
            for key, lab in BLOCKS:
                if isinstance(v, str) and norm(v).startswith(lab) and key not in start:
                    start[key] = col_n(c)
        if len(start) == 3:
            break
    if len(start) != 3:
        raise ValueError(f"block headers not found: {start}")
    rows = {k: min(label_row[norm(lab)]) for k, lab in LABELS.items() if norm(lab) in label_row}
    closed = min(r for lab, rs in label_row.items() if lab.startswith(norm(CLOSED)[:20]) for r in rs)
    title = [norm(by_row.get(r, {}).get("B", "")) for r in (1, 2, 3, 4)]
    out = {"title": [t for t in title if t]}
    for key, _ in BLOCKS:
        c0 = start[key]
        get = lambda r, k=0: by_row.get(r, {}).get(col_s(c0 + k))  # noqa: E731
        rec = {}
        for k, r in rows.items():
            x = get(r)
            rec[k] = None if x is None or isinstance(x, str) else round(x * 100, 1)
        tot = get(closed)
        rec["closed"] = [None if get(closed, j) is None else round(get(closed, j) * 100, 1) for j in range(1, 6)]
        rec["_total"] = None if tot is None else round(tot * 100, 1)
        rec["_cells"] = f"{col_s(c0)}{rows.get('approved')}..{col_s(c0 + 5)}{closed}"
        out[key] = rec
    return out


def a3_counts(cells):
    """Infinity's annex A3: the number of claims closed in the year per block (individual + group), where the file prints it"""
    rows = {}
    for ref, v in cells.items():
        m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
        if m.group(1) == "B" and isinstance(v, str) and norm(v).startswith("תביעות שנסגרו") and "א3" in v:
            rows["closed"] = min(rows.get("closed", 10 ** 6), int(m.group(2)))
    r = rows.get("closed")
    if r is None:
        return {}
    hdr = {}
    for ref, v in cells.items():
        m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
        if isinstance(v, str):
            for key, lab in BLOCKS:
                if norm(v).startswith(lab) and int(m.group(2)) < r and key not in hdr:
                    hdr[key] = col_n(m.group(1))
    out = {}
    for key, c0 in hdr.items():
        # each block: individual (7 columns: total + 6 buckets), then group (7 columns)
        ind, grp = cells.get(f"{col_s(c0)}{r}"), cells.get(f"{col_s(c0 + 7)}{r}")
        if isinstance(ind, float):
            out[key] = int(round(ind + (grp if isinstance(grp, float) else 0)))
    return out


def pct_tokens(s):
    return re.findall(r"\d+\.\d%", s)


def verify_pdf(rec, path, pg):
    txt = subprocess.run(["pdftotext", "-layout", "-f", str(pg), "-l", str(pg), str(path), "-"], capture_output=True, text=True).stdout
    lines = [norm(x) for x in txt.split("\n")]
    bare = lambda x: re.sub(r"[()*\s]", "", x)  # noqa: E731  (pdftotext may mirror the parentheses of an RTL label)
    def row(label):
        hit = [ln for ln in lines if bare(label) in bare(ln)]
        return pct_tokens(hit[0])[::-1] if hit else []  # pdftotext prints RTL rows left to right: reverse to the logical order
    for key in ("disability", "survivors"):
        r = rec[key]
        for k, lab in (("approved", "תביעות שאושרו (*)"), ("rejected", "תביעות שנדחו"), ("cancelled", "תביעות שבוטלו")):
            if r[k] is not None and f"{r[k]:.1f}%" not in row(lab):
                fails.append(f"{path.name} p{pg} {key}.{k} {r[k]} not on its row")
        toks = row("תביעות שנסגרו (א+")
        want = ["100.0%"] + [f"{x:.1f}%" for x in r["closed"]]
        if not any(toks[i:i + 6] == want for i in range(len(toks))):
            fails.append(f"{path.name} p{pg} {key}.closed {want} not on the closed row {toks}")


def verify_emf(rec, path):
    z = zipfile.ZipFile(path)
    emf = next(n for n in z.namelist() if n.startswith("xl/media/") and n.endswith(".emf") and "image1" in n)
    toks = re.findall(r"\d+\.\d%", z.read(emf).decode("utf-16le", errors="ignore"))
    for key in ("disability", "survivors"):
        r = rec[key]
        want = ["100.0%"] + [f"{x:.1f}%" for x in r["closed"]]
        if not any(toks[i:i + 6] == want for i in range(len(toks))):
            fails.append(f"{path.name} {key}.closed {want} not in the picture's text")
        for k in ("approved", "rejected", "cancelled"):
            if r[k] is not None and f"{r[k]:.1f}%" not in toks:
                fails.append(f"{path.name} {key}.{k} {r[k]} not in the picture's text")
    return emf


def verify_xls(conv_cells, xls_path):
    b = xls_path.read_bytes()
    dbl = {struct.unpack("<d", b[i:i + 8])[0] for i in range(len(b) - 7)}
    vals = [v for v in conv_cells.values() if isinstance(v, float) and v not in (0.0, 1.0) and v != int(v)]
    near = sorted(d for d in dbl if d == d and 0 < abs(d) < 10)
    import bisect
    def found(v):
        i = bisect.bisect_left(near, v - 1e-12)
        if i < len(near) and abs(near[i] - v) < 1e-12:
            return True
        lo, hi = struct.unpack("<II", struct.pack("<d", v))  # an RK record: the double's high 30 bits, flags 00, when the low 34 are zero
        return lo == 0 and hi & 3 == 0 and struct.pack("<I", hi) in b
    miss = [v for v in vals if not found(v)]
    if miss:
        fails.append(f"{xls_path.name}: {len(miss)} of {len(vals)} converted values not in the original binary")
    return len(vals)


def page_texts(path):
    txt = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True).stdout
    return [norm(p) for p in txt.split("\f")]


def main():
    reg = json.loads(SRC.read_text(encoding="utf-8"))
    srcs = {s["id"]: s for s in reg["sources"]}
    fc = reg["fund_claims"]

    # 1. annex B3 from cells
    out = {"$comment": "generated by pipeline/extract_decision.py from the raw files under data/raw/regulator (not in git); do not edit",
           "year": fc["year"], "funds": []}
    for sid in fc["from_cells"]:
        s = srcs[sid]
        path = ROOT / s["raw"]
        read = path if path.suffix == ".xlsx" else path.with_suffix(".conv.xlsx")
        sh = xlsx_sheets(read)
        cells = sh[s["sheet"]]
        b3 = b3_from_cells(cells)
        if not any(str(fc["year"]) in t for t in b3["title"]):
            fails.append(f"{sid}: year {fc['year']} not in the sheet title {b3['title']}")
        rec = {"grp": fc["grp_of"][sid], "src": sid, "sheet": s["sheet"].strip(), "entity": next((t for t in b3["title"] if "בע\"מ" in t), None)}
        for key, _ in BLOCKS:
            r = b3[key]
            if r["_total"] in (None, 0.0) and not any(r[k] for k in LABELS):
                continue  # the block is empty in the file (no claims of this type, e.g. lump-sum death risk in a pension fund)
            rec[key] = {k: r.get(k) for k in ("approved", "rejected", "settled", "cancelled", "closed")}
            rec[key]["cells"] = r["_cells"]
        if "sheet_n" in s:
            n = a3_counts(sh[s["sheet_n"]])
            for key, v in n.items():
                if key in rec:
                    rec[key]["n_closed"] = v
        if path.suffix == ".xls":
            rec["xls_values_checked"] = verify_xls(cells, path)
        out["funds"].append(rec)

    # 2. transcribed B3 (PDF / picture) re-found in the file's own text
    for rec in fc["transcribed"]:
        s = srcs[rec["src"]]
        path = ROOT / s["raw"]
        if path.suffix == ".pdf":
            verify_pdf(rec, path, rec["pg"])
        else:
            verify_emf(rec, path)

    # 3. coverage rules on the cited bylaws page
    pages = page_texts(ROOT / srcs[reg["coverage_default"]["src"]]["raw"])
    tight = lambda x: re.sub(r"\s", "", x)  # noqa: E731  (pdftotext spacing around RTL punctuation is not stable)
    for r in reg["coverage_default"]["rules"]:
        p = tight(" ".join(pages[r["pg"] - 1:r.get("pg_to", r["pg"])]))
        if tight(norm(r["q"])) not in p:
            hits = [i + 1 for i, x in enumerate(pages) if tight(norm(r["q"])) in tight(x)]
            fails.append(f"coverage {r['id']}: q not on p{r['pg']} (found on {hits})")
        for n in r.get("nums", []):
            if n not in p:
                fails.append(f"coverage {r['id']}: {n} not on p{r['pg']}")

    # 4. checklist quotes in the cited page text
    for it in reg["bm_checklist"]:
        t = norm((ROOT / srcs[it["src"]]["raw"]).read_text(encoding="utf-8"))
        if norm(it["q"]) not in t:
            fails.append(f"checklist {it['id']}: q not in {it['src']}")
        if "src2" in it and it["src2"] == reg["coverage_default"]["src"] and not pages[it["pg2"] - 1]:
            fails.append(f"checklist {it['id']}: empty bylaws page {it['pg2']}")

    # 5. the raw manifest
    man = {"$comment": "raw files behind data/regulation/decision_src.json (W2); URLs and retrieval dates from the register",
           "files": []}
    for s in reg["sources"]:
        p = ROOT / s["raw"]
        man["files"].append({"id": s["id"], "file": s["raw"].replace("data/raw/regulator/", ""), "url": s["url"], "retrieved": s["retrieved"],
                             "sha256": hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None})
    (RAW / "sources.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"B3 from cells: {len(out['funds'])} companies; transcribed verified: {len(fc['transcribed'])}; coverage rules: "
          f"{len(reg['coverage_default']['rules'])}; checklist: {len(reg['bm_checklist'])}; failures: {len(fails)}")
    for f in fails:
        print("FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
