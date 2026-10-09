"""Check the savings-economics extractions: every numeric fact must be printed on its cited Hebrew page.

.venv/bin/python pipeline/verify_savings.py [-v]
Reads data/extracted_savings/<company>/<period>.json and the page text in data/work/<company>_<period>/<doc>/pNNN.txt.
A value passes when one of its printed forms (NIS millions or thousands, billions on a page stated in billions; 0-3 decimals) appears on the page as a whole
number token. A value missing from its cited page is looked for on the neighbouring pages (+-NEAR); if found there the page is
corrected, otherwise the fact is dropped. Nothing is computed. The extraction files are not modified: the outcome goes to
data/work/savings_verified.json ({company: {period: {"kept", "moved": [...], "dropped": [...]}}}), which build_savings.py applies.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "extracted_savings"
NEAR = 3
VERBOSE = "-v" in sys.argv


def forms(v, unit=None, billions=False):
    a = abs(v)
    out = set()
    scales = {"percent": (1,), "billions_in_source": (1, 0.001)}.get(unit, (1, 1000, 0.001) if billions else (1, 1000))  # millions, thousands, billions
    for x in (a * k for k in scales):
        for nd in (0, 1, 2, 3):
            if abs(round(x, nd) - x) > 1e-6 * max(1, x):
                continue  # this many decimals would not print the value exactly
            s = f"{x:,.{nd}f}"
            out |= {s, s.replace(",", "")}
    out.discard("0")
    return out


def on_page(txt, fs):
    for s in fs:
        for m in re.finditer(re.escape(s), txt):
            a, b = m.start(), m.end()
            before, after = txt[a - 1:a], txt[b:b + 2]
            if before.isdigit() or (before in ".," and txt[a - 2:a - 1].isdigit()):
                continue
            if after[:1].isdigit() or (after[:1] in ".," and after[1:2].isdigit()):
                continue
            return True
    return False


_cache = {}


def page_text(comp, period, doc, n):
    p = ROOT / "data" / "work" / f"{comp}_{period}" / (doc or "he") / f"p{int(n):03d}.txt"
    if p not in _cache:
        _cache[p] = p.read_text(encoding="utf-8") if p.exists() else ""
    return _cache[p]


def fid(f):
    return "|".join(str(f.get(k)) for k in ("metric", "segment", "window", "date", "basis", "product", "sub_segment", "holder_status", "fund", "source", "label", "value"))


def verify(comp, period, d):
    kept, moved, dropped = 0, [], []
    for f in d["facts"]:
        v = f.get("value")
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            dropped.append({"id": fid(f), "why": "not numeric"})
            continue
        pg = f.get("page_he")
        if pg is None:
            dropped.append({"id": fid(f), "why": "no page"})
            continue
        if v == 0:
            kept += 1
            continue
        def found(n):  # the billions form counts only on a page that states amounts in billions
            txt = page_text(comp, period, f.get("doc"), n)
            return on_page(txt, forms(v, f.get("unit"), "מיליארד" in txt))

        if found(pg):
            kept += 1
            continue
        hits = [n for k in range(1, NEAR + 1) for n in (int(pg) - k, int(pg) + k) if n > 0 and found(n)]
        # a short number can sit on a neighbouring page by chance: only move when the value has 3+ digits
        if hits and len(re.sub(r"\D", "", f"{abs(v):g}")) >= 3:
            moved.append({"id": fid(f), "from": pg, "to": hits[0]})
            kept += 1
        else:
            dropped.append({"id": fid(f), "why": f"not printed on p{pg}" + (f" (short number also on p{hits[0]})" if hits else ""), "page": pg})
    return kept, moved, dropped


def main():
    out, tot = {}, [0, 0, 0]
    for path in sorted(SRC.glob("*/*.json")):
        comp, period = path.parent.name, path.stem
        d = json.loads(path.read_text(encoding="utf-8"))
        kept, moved, dropped = verify(comp, period, d)
        out.setdefault(comp, {})[period] = {"facts": len(d["facts"]), "kept": kept, "moved": moved, "dropped": dropped}
        tot = [tot[0] + kept, tot[1] + len(moved), tot[2] + len(dropped)]
        print(f"{comp:11} {period}: {len(d['facts']):4} facts, kept {kept:4} (page corrected {len(moved)}), dropped {len(dropped)}")
        for m in moved if VERBOSE else []:
            print("     moved  ", m["id"][:110], f"p{m['from']} -> p{m['to']}")
        for x in dropped:
            print("     DROPPED", x["id"][:130], "|", x["why"])
    (ROOT / "data" / "work" / "savings_verified.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"total: kept {tot[0]}, of which page corrected {tot[1]}; dropped {tot[2]}")


if __name__ == "__main__":
    main()
