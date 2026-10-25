"""Page text of a filed document, for value-on-page checks (lane G). Standard library (+ pdftotext only for the local-PDF fallback).

    from pagetext import page, found
    t, how = page(1743827, 12)     # text of PDF page 12 of MAYA report 1743827; how: "reader" | "pdf" | None (no source here)
    found(18497, t)                # the number is printed on the page in one of its common print forms

Where the text comes from, in order:
  1. the in-app reader text, web/public/data/search/text/<rid>/<block>.bin (in the repo, so also in CI): gzip of a JSON array of
     `pdftotext -layout` pages, 10 pages a block (pipeline/build_pages.py);
  2. the local PDF (data/registry/documents.csv local_path, under data/sources/pdf: the synced drive, absent in CI), one page through
     pdftotext, cached in ~/.cache/fox/pdfpages.json (a filed PDF never changes);
  3. nothing: the caller reports the value as "skipped (no sources)", never as passed.
"""
import csv
import gzip
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT = ROOT / "web" / "public" / "data" / "search" / "text"
CACHE = Path(os.environ.get("FOX_CACHE", Path.home() / ".cache" / "fox")) / "pdfpages.json"
BIDI = re.compile(r"[‎‏‪-‮⁦-⁩]")
_blocks, _pdf, _local = {}, None, None
_dirty = False


def _local_pdfs():
    global _local
    if _local is None:
        _local = {}
        try:
            for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8")):
                if r["local_path"] and r["file_type"].startswith("pdf"):
                    _local.setdefault(int(r["report_id"]), r["local_path"])
        except OSError:
            pass
    return _local


def _pdf_cache():
    global _pdf
    if _pdf is None:
        try:
            _pdf = json.loads(CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _pdf = {}
    return _pdf


def save():
    """Write the pdftotext cache (call once at the end of a run)."""
    if _dirty:
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(_pdf, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass


def has_reader(rid):
    return (TEXT / str(rid)).is_dir()


def page(rid, pg, pdf_fallback=True):
    """(text, how) of 1-based page pg of report rid; (None, None) where no source is available here."""
    global _dirty
    if rid is None or not pg:
        return None, None
    rid, pg = int(rid), int(pg)
    b = (pg - 1) // 10
    k = (rid, b)
    if k not in _blocks:
        f = TEXT / str(rid) / f"{b}.bin"
        try:
            _blocks[k] = json.loads(gzip.decompress(f.read_bytes()))
        except (OSError, ValueError):
            _blocks[k] = None
    blk = _blocks[k]
    if blk is not None and (pg - 1) % 10 < len(blk):
        return BIDI.sub("", blk[(pg - 1) % 10]), "reader"
    if not pdf_fallback or not shutil.which("pdftotext"):
        return None, None
    lp = _local_pdfs().get(rid)
    if not lp:
        return None, None
    ck = f"{rid}:{pg}"
    c = _pdf_cache()
    if ck not in c:
        p = ROOT / lp
        if not p.exists():
            return None, None
        out = subprocess.run(["pdftotext", "-layout", "-f", str(pg), "-l", str(pg), str(p), "-"], capture_output=True, text=True, timeout=120)
        if out.returncode:
            return None, None
        c[ck] = BIDI.sub("", out.stdout)
        _dirty = True
    return c[ck], "pdf"


def forms(v):
    """The common print forms of a stored value: as stored, with thousands separators, 0-3 decimals; NIS thousands printed for a value
    stored in millions (x1000) and NIS billions printed (/1000)."""
    a = abs(float(v))
    out = set()
    for d in (0, 1, 2, 3):
        out |= {f"{a:,.{d}f}", f"{a:.{d}f}"}
    if a < 1e7:  # stored in NIS millions, printed in thousands
        out |= {f"{round(a * 1000):,}", f"{round(a * 1000)}"}
    if a >= 1000:  # stored in millions, printed in billions
        for d in (0, 1, 2):
            out.add(f"{a / 1000:,.{d}f}")
    s = repr(a)
    out.add(s[:-2] if s.endswith(".0") else s)
    return {x for x in out if x.strip("0.,") and x not in ("0", "0.0", "0.00", "0.000")}


def found(v, text):
    """v printed on the page: one of its forms, not part of a longer number (a comma or full stop of the right-to-left text layer may stand
    right before it, as in ',9.25%')."""
    if text is None or not isinstance(v, (int, float)) or v == 0:
        return False
    return any(re.search(rf"(?<!\d)(?<!\d[.,]){re.escape(x)}(?![\d])", text) for x in forms(v))


def words(q, text, n=3):
    """A quoted phrase on the page: n consecutive Hebrew/Latin words of the quote appear on the page in either word order (the text
    layer of a right-to-left page may print a line's words reversed)."""
    if not q or text is None:
        return False
    ws = re.findall(r"[֐-׿A-Za-z]{3,}", q)
    if len(ws) < n:
        return bool(ws) and all(w in text for w in ws)
    flat = " ".join(re.findall(r"[֐-׿A-Za-z]+", text))
    for i in range(len(ws) - n + 1):
        g = ws[i:i + n]
        if " ".join(g) in flat or " ".join(reversed(g)) in flat:
            return True
    return False
