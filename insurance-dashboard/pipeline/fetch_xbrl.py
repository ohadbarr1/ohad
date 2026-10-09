"""Headline figures from the XBRL instance attached to every periodic report on MAYA.

python3 pipeline/fetch_xbrl.py            # download missing files, parse, write table xbrl_facts
Each instance carries ~20 filer-tagged IFRS concepts (assets, equity, profit, EPS, cash flows)
for the reporting period. Values are stored exactly as tagged; scaling is in the `decimals` column.
"""
import re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_maya as fm  # noqa: E402

RAW = fm.ROOT / "data" / "sources" / "xbrl"
NS_SKIP = "ifrs-il"


def parse(text):
    root = ET.fromstring(text.lstrip("﻿"))
    ctx = {}
    for c in root.iter("{http://www.xbrl.org/2003/instance}context"):
        p = c.find("{http://www.xbrl.org/2003/instance}period")
        inst = p.findtext("{http://www.xbrl.org/2003/instance}instant")
        ctx[c.get("id")] = (p.findtext("{http://www.xbrl.org/2003/instance}startDate"), inst or p.findtext("{http://www.xbrl.org/2003/instance}endDate"))
    for el in root:
        ref = el.get("contextRef")
        if not ref or "ifrs-full" not in el.tag:
            continue
        try:
            val = float(el.text)
        except (TypeError, ValueError):
            continue
        start, end = ctx.get(ref, (None, None))
        yield re.sub(r"^\{.*\}", "", el.tag), ref, start, end, val, el.get("unitRef"), el.get("decimals")


def main():
    con = fm.connect()
    con.execute("""create table if not exists xbrl_facts (company varchar, report_id bigint, period varchar, doc_type varchar,
        concept varchar, context varchar, start_date date, end_date date, value double, unit varchar, decimals varchar,
        primary key (report_id, concept, context))""")
    todo = con.execute("""select report_id, company, period, doc_type, url from documents
        where file_type='xbrl' and doc_type in ('annual','quarterly') and company<>'idi' order by company, publish_date""").fetchall()
    RAW.mkdir(parents=True, exist_ok=True)
    n = 0
    for rid, comp, per, dt, url in todo:
        f = RAW / f"{comp}_{rid}.xbrl"
        if not f.exists():
            f.write_bytes(fm.http(fm.FILES + url, binary=True))
            time.sleep(fm.PAUSE)
        try:
            facts = list(parse(f.read_text(encoding="utf-8", errors="replace")))
        except ET.ParseError as e:
            print("parse error", f.name, e, file=sys.stderr)
            continue
        for concept, ref, start, end, val, unit, dec in facts:
            con.execute("insert or replace into xbrl_facts values (?,?,?,?,?,?,?,?,?,?,?)", [comp, rid, per, dt, concept, ref, start, end, val, unit, dec])
        n += 1
    print(n, "instances;", con.execute("select count(*) from xbrl_facts").fetchone()[0], "facts")


if __name__ == "__main__":
    main()
