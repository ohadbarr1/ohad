"""Export the document registry for the site.

python3 pipeline/build_documents.py -> web/public/data/companies/<id>.docs.json
One row per filed PDF that the pipeline classified (report, presentation, solvency), newest first.
"""
import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "companies"
FILES = "https://mayafiles.tase.co.il/"
TYPES = ("annual", "quarterly", "presentation", "solvency")

con = duckdb.connect(str(ROOT / "data" / "warehouse.duckdb"), read_only=True)
rows = con.execute(
    """select company, report_id, publish_date::date::varchar, doc_type, period, title, pages, size_kb, url
       from documents where doc_type in ? and file_type like 'pdf%' and local_path is not null
       order by company, publish_date desc, url""", [TYPES]).fetchall()
by = {}
for comp, rid, day, typ, per, title, pages, kb, url in rows:
    en = not any("֐" <= ch <= "׿" for ch in title)
    by.setdefault(comp, []).append({"id": rid, "date": day, "type": typ, "period": per, "title": " ".join(title.split()),
                                    "pages": pages, "kb": kb, "en": en, "url": FILES + url})
for comp, docs in by.items():
    (OUT / f"{comp}.docs.json").write_text(json.dumps({"source": "MAYA", "docs": docs}, ensure_ascii=False), encoding="utf-8")
    print(comp, len(docs), "docs", sum(d["pages"] or 0 for d in docs), "pages")
