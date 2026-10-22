"""Page text of every filed PDF in the registry, for full-text search and the in-app reader.

python3 pipeline/build_pages.py [--jobs 8] [--only <report_id>,...]
  data/registry/documents.csv (pdf rows with a local copy) -> web/public/data/search/text/<report_id>/<block>.bin

One file per block of BLOCK pages: gzip of a JSON array of page strings, as `pdftotext -layout` prints them (1-based PDF pages,
visual left-to-right column layout with the bidi embedding marks kept, trailing spaces trimmed). The browser inflates them
with DecompressionStream. Incremental: a document whose PDF size is unchanged since the last run is skipped
(data/registry/pages_manifest.json keeps size, pages and the count of pages without text).
Reads the PDFs from data/sources/pdf (a synced-drive folder: ~2-5 MB/s, so the first full run takes a while).
"""
import argparse
import csv
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "search" / "text"
MANIFEST = ROOT / "data" / "registry" / "pages_manifest.json"
BLOCK = 10
TYPES = {"annual", "quarterly", "presentation", "solvency"}


def registry():
    rows = [r for r in csv.DictReader(open(ROOT / "data" / "registry" / "documents.csv", encoding="utf-8"))
            if r["file_type"].startswith("pdf") and r["local_path"] and r["doc_type"] in TYPES]
    return sorted(rows, key=lambda r: r["report_id"])


def clean(page: str) -> str:
    lines = [ln.rstrip() for ln in page.replace("\r", "").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    out, blank = [], 0
    for ln in lines:
        blank = blank + 1 if not ln.strip() else 0
        if blank <= 1:
            out.append(ln)
    return "\n".join(out)


def extract(row):
    rid = row["report_id"]
    pdf = ROOT / row["local_path"]
    t0 = time.time()
    text = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"], capture_output=True, timeout=600).stdout.decode("utf-8", "replace")
    pages = text.split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    pages = [clean(p) for p in pages]
    d = OUT / rid
    tmp = OUT / f".{rid}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for b in range(0, max(len(pages), 1), BLOCK):
        body = json.dumps(pages[b:b + BLOCK], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (tmp / f"{b // BLOCK}.bin").write_bytes(gzip.compress(body, 9, mtime=0))
    shutil.rmtree(d, ignore_errors=True)
    tmp.rename(d)
    empty = sum(1 for p in pages if len(re.sub(r"\s", "", p)) < 20)
    return rid, {"size": pdf.stat().st_size, "pages": len(pages), "empty": empty, "chars": sum(len(p) for p in pages), "sec": round(time.time() - t0, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    man = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    rows = registry()
    if a.only:
        keep = set(a.only.split(","))
        rows = [r for r in rows if r["report_id"] in keep]
    todo = []
    for r in rows:
        m = man.get(r["report_id"])
        if not a.force and m and (OUT / r["report_id"]).exists() and m.get("kb") == r["size_kb"]:
            continue
        todo.append(r)
    print(f"{len(rows)} documents, {len(todo)} to extract", flush=True)
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(a.jobs) as ex:
        futs = {ex.submit(extract, r): r for r in todo}
        for f in as_completed(futs):
            r = futs[f]
            try:
                rid, info = f.result()
                info["kb"] = r["size_kb"]
                man[rid] = info
            except Exception as e:  # a broken or missing file is reported and skipped, the rest go on
                print("FAIL", r["report_id"], r["local_path"], e, flush=True)
                continue
            done += 1
            if done % 20 == 0 or done == len(todo):
                MANIFEST.write_text(json.dumps(man, ensure_ascii=False, sort_keys=True, indent=0))
                print(f"{done}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    MANIFEST.write_text(json.dumps(man, ensure_ascii=False, sort_keys=True, indent=0))
    have = [man[r["report_id"]] for r in rows if r["report_id"] in man]
    print(len(have), "documents,", sum(x["pages"] for x in have), "pages,", sum(x["empty"] for x in have), "without text")


if __name__ == "__main__":
    main()
