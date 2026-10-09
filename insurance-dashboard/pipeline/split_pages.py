"""Per-page text for one filing, so an extractor can read single pages.

python3 pipeline/split_pages.py <pdf> <out_dir>   -> <out_dir>/p001.txt ... (pdftotext -layout, 1-based PDF pages)
"""
import subprocess
import sys
from pathlib import Path

pdf, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
pages = text.split("\f")
for i, p in enumerate(pages[:-1] if pages[-1].strip() == "" else pages, 1):
    (out / f"p{i:03d}.txt").write_text(p, encoding="utf-8")
print(len(list(out.glob("p*.txt"))), "pages ->", out)
