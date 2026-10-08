"""Inline data/market.json into site/app.html.

python3 pipeline/build_site.py              -> dist/pension-gemel.html          (standalone page, open in any browser)
python3 pipeline/build_site.py --fragment OUT.html  -> page content only, for publishing through the Artifact tool
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = (ROOT / "data" / "market.json").read_text(encoding="utf-8")
json.loads(data)  # validate
data = data.replace("</", "<\\/")
app = (ROOT / "site" / "app.html").read_text(encoding="utf-8").replace("__DATA__", data)
if "--fragment" in sys.argv:
    out = Path(sys.argv[sys.argv.index("--fragment") + 1])
    out.write_text(app, encoding="utf-8")
else:
    out = ROOT / "dist" / "pension-gemel.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text('<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + app + "</body></html>", encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB)")
