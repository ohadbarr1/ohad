"""Turn an annotated financial-statements workbook (one sheet per table, PDF page per row) into facts.

Usage: python3 pipeline/extract_company_workbook.py <workbook.xlsx> <company_id> [out_dir]

The workbook layout (see data/sources/Phoenix_H1_2026_Financial_Statements.xlsx):
  - index sheet 'אינדקס' lists sheets per reporting entity (F. = parent group, I. = insurance company)
  - every table block: a title row, a header row starting with 'סעיף', then data rows
    [label, value per column..., "עמ' PDF", "הערות / הסבר"]
  - column headers carry the period ("6 חודשים שהסתיימו ב-30.6.2026", "ליום 30 ביוני 2026") and, for
    segment tables, the dimension (portfolio group, segment) separated by '|' or an em dash.

Output: <out_dir>/<company_id>.json with {entities, sources, periods, metrics, facts, stats}.
Values are kept as printed (NIS thousands unless the metric unit says otherwise).
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl

MONTHS = {"בינואר": 1, "בפברואר": 2, "במרץ": 3, "באפריל": 4, "במאי": 5, "ביוני": 6, "ביולי": 7, "באוגוסט": 8,
          "בספטמבר": 9, "באוקטובר": 10, "בנובמבר": 11, "בדצמבר": 12}
NUM = re.compile(r"^\(?-?[\d,]+(\.\d+)?\)?$")
PERIOD_RE = [
    (re.compile(r"(\d+) ח' עד (\d{1,2})[.\s]+(\d{1,2})[.\s]+(\d{4})"), "dur"),
    (re.compile(r"(\d+) חודשים שהסתיימו ב-?\s*(\d{1,2})[.\s]+(\d{1,2}|[א-ת]+)[.\s]+(\d{4})"), "dur"),
    (re.compile(r"שנה שהסתיימה ב-?\s*(\d{1,2})[.\s]+(\d{1,2}|[א-ת]+)[.\s]+(\d{4})"), "fy"),
    (re.compile(r"ליום\s+(\d{1,2})[.\s]+(\d{1,2}|[א-ת]+)[.\s]+(\d{4})"), "inst"),
]
STATEMENT_OF = {  # sheet code (after "F."/"I.") prefix -> statement group
    "D1": "balance", "D2": "income", "D3": "oci", "D4": "equity", "D5": "cashflow",
}
GROUP_LABEL = {
    "balance": "מאזן", "income": "רווח והפסד", "oci": "רווח כולל", "equity": "שינויים בהון", "cashflow": "תזרים מזומנים",
    "segments": "מגזרי פעילות", "life": "ביטוח חיים וחיסכון ארוך טווח", "health": "ביטוח בריאות", "general": "ביטוח כללי",
    "pension": "פנסיה וחוזי השקעה", "capital": "הון ודרישות הון", "insurance_services": "רווח משירותי ביטוח",
    "investments": "רווח מהשקעות ומימון", "instruments": "מכשירים פיננסיים", "other": "אחר",
}


def group_of(code):
    c = code.split(".", 1)[1]
    for k, v in STATEMENT_OF.items():
        if c.startswith(k + "_") or c == k:
            return v
    if "חיים" in c:
        return "life"
    if "בריאות" in c:
        return "health"
    if "כללי_" in c and "N03" in c:
        return "general"
    if "פנסיה_חוזי" in c:
        return "pension"
    if "מגזרים" in c:
        return "segments"
    if "הון_ודרישות" in c:
        return "capital"
    if "שירותי_ביטוח" in c:
        return "insurance_services"
    if "השקעות_ומימון" in c:
        return "investments"
    if c.startswith(("N05", "N04_נכסים", "N04_השקעות", "N04_התחייבויות")):
        return "instruments"
    return "other"


def parse_period(h):
    """-> (period_id, label, type, end ISO date, months) or None"""
    for rx, kind in PERIOD_RE:
        m = rx.search(h)
        if not m:
            continue
        g = m.groups()
        if kind == "dur":
            months, d, mo, y = int(g[0]), int(g[1]), g[2], int(g[3])
        elif kind == "fy":
            months, d, mo, y = 12, int(g[0]), g[1], int(g[2])
        else:
            months, d, mo, y = 0, int(g[0]), g[1], int(g[2])
        mo = int(mo) if mo.isdigit() else MONTHS.get(mo) or MONTHS.get("ב" + mo)
        if not mo:
            return None
        end = f"{y:04d}-{mo:02d}-{d:02d}"
        if kind == "inst":
            return f"I{end}", f"{d}.{mo}.{y}", "I", end, 0
        t = {3: "Q", 6: "H", 12: "FY"}.get(months, f"{months}M")
        return f"{t}{end}", f"{months}M {mo:02d}/{y}", t, end, months
    return None


def clean_dim(h):
    s = h
    for rx, _ in PERIOD_RE:
        s = rx.sub("", s)
    s = re.sub(r"\((בלתי מבוקר|מבוקר)\)", "", s)
    s = re.sub(r"[|—–]", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -")
    return s


def to_num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s in ("-", "–", "—"):
        return 0.0
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        x = float(s)
    except ValueError:
        return None
    return -x if neg else x


def unit_of(title, label):
    t = title or ""
    if "למניה" in label or "בש\"ח, לא באלפים" in t:
        return "nis"
    if "במיליוני ש\"ח" in t or "מיליוני ש\"ח" in t:
        return "m"
    if "%" in label and "מזה" not in label:
        return "pct"
    return "k"


def slug(s):
    return re.sub(r"\s+", " ", re.sub(r"[\"'׳״()\[\]*:,.]", "", s)).strip()


def main(path, company, out_dir="web/public/data/companies"):
    wb = openpyxl.load_workbook(path, data_only=True)
    idx = wb["אינדקס"]
    rows = list(idx.iter_rows(values_only=True))
    sources = []
    for r in rows[:14]:
        if r[0] in ('הפניקס פיננסים בע"מ', 'הפניקס חברה לביטוח בע"מ') and r[1]:
            m = re.search(r"(https?://\S+)", str(r[1]))
            pages = re.search(r"\((\d+) עמ", str(r[1]))
            sources.append({"entity": "F" if "פיננסים" in r[0] else "I", "name": r[0], "doc": str(r[1]).split(",")[0].strip(),
                            "url": m.group(1).rstrip(")") if m else None, "pages": int(pages.group(1)) if pages else None})
    sheets = []
    started = False
    for r in rows:
        if r[0] == "חברה" and r[1]:
            started = True
            continue
        if started and r[0] in ("פיננסים", "ביטוח") and r[1]:
            sheets.append({"entity": "F" if r[0] == "פיננסים" else "I", "code": r[1], "title": r[2], "pages": r[3]})

    periods, metrics, facts = {}, {}, defaultdict(dict)
    order = defaultdict(int)
    skipped = []
    n_rows = 0
    for sh in sheets:
        ws = wb[sh["code"]]
        grp = group_of(sh["code"])
        block_title, cols, pdf_col, note_col = None, None, None, None
        seen = defaultdict(int)
        sheet_facts = 0
        for rr in ws.iter_rows(values_only=True):
            a = rr[0]
            if a is None:
                continue
            a = str(a).strip()
            if a == "סעיף":
                cols, pdf_col, note_col = [], None, None
                seen = defaultdict(int)
                for j, h in enumerate(rr[1:], 1):
                    if h is None:
                        continue
                    hs = str(h)
                    if hs.startswith("עמ"):
                        pdf_col = j
                    elif hs.startswith("הערות"):
                        note_col = j
                    else:
                        p = parse_period(hs)
                        cols.append((j, p, clean_dim(hs)) if p else None)
                cols = [c for c in cols if c]
                continue
            nonnull = [c for c in rr[1:] if c is not None]
            if not nonnull and cols is None:
                block_title = a
                continue
            if cols is None:
                continue
            vals = [(j, p, d, to_num(rr[j])) for j, p, d in cols if j < len(rr) and rr[j] is not None]
            vals = [v for v in vals if v[3] is not None]
            page = rr[pdf_col] if pdf_col is not None and pdf_col < len(rr) else None
            note = rr[note_col] if note_col is not None and note_col < len(rr) else None
            label = a
            if not vals:
                # section header or footnote row: keep headers (rows that have a page number but no values)
                if page is not None and len(label) < 140 and not label.startswith("(*"):
                    key = (sh["entity"], sh["code"], "", slug(label), "H")
                    mid = f"{sh['entity']}.{sh['code'].split('.',1)[1]}|{slug(label)}|H{order[sh['code']]}"
                    metrics.setdefault(mid, {"id": mid, "entity": sh["entity"], "sheet": sh["code"], "group": grp, "label": label,
                                             "dim": "", "unit": "k", "header": True, "order": order[sh["code"]], "note": str(note) if note else None})
                    order[sh["code"]] += 1
                continue
            n_rows += 1
            for j, p, d, v in vals:
                dupkey = (label, d, p[0])
                seen[dupkey] += 1
                n = seen[dupkey]
                base = f"{sh['entity']}.{sh['code'].split('.',1)[1]}|{slug(label)}|{d}|{n}"
                mid = base
                if mid not in metrics:
                    metrics[mid] = {"id": mid, "entity": sh["entity"], "sheet": sh["code"], "group": grp, "label": label, "dim": d,
                                    "unit": unit_of(block_title, label), "header": False, "order": order[sh["code"]],
                                    "note": str(note) if note else None}
                    order[sh["code"]] += 1
                periods[p[0]] = {"id": p[0], "label": p[1], "type": p[2], "end": p[3], "months": p[4]}
                facts[mid][p[0]] = [v, int(page) if str(page).isdigit() else None]
                sheet_facts += 1
        if sheet_facts == 0:
            skipped.append(sh["code"])

    # keep header rows only in sheets that have facts
    used_sheets = {m["sheet"] for mid, m in metrics.items() if mid in facts}
    metrics = {k: v for k, v in metrics.items() if v["sheet"] in used_sheets}
    plist = sorted(periods.values(), key=lambda p: (p["end"], p["months"]))
    pidx = {p["id"]: i for i, p in enumerate(plist)}
    mlist = sorted(metrics.values(), key=lambda m: (m["sheet"], m["order"]))
    midx = {m["id"]: i for i, m in enumerate(mlist)}
    flat = []  # [metric_idx, period_idx, value, page]
    for mid, per in facts.items():
        for pid, (v, pg) in per.items():
            flat.append([midx[mid], pidx[pid], v, pg])
    flat.sort()
    sheet_meta = [{"code": s["code"], "entity": s["entity"], "title": s["title"], "pages": s["pages"], "group": group_of(s["code"])}
                  for s in sheets if s["code"] in used_sheets]
    out = {
        "company": company, "sources": sources, "groups": GROUP_LABEL, "sheets": sheet_meta, "periods": plist,
        "metrics": [{k: v for k, v in m.items() if k not in ("note", "id") and v is not None} for m in mlist], "facts": flat,
        "stats": {"sheets_total": len(sheets), "sheets_with_facts": len(used_sheets), "skipped_sheets": skipped,
                  "metrics": len(mlist), "facts": len(flat), "periods": len(plist), "data_rows": n_rows},
    }
    out_path = Path(out_dir) / f"{company}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # explanations are large and only needed on hover: ship them as a separate, lazily loaded file keyed by metric index
    notes = {str(i): m["note"] for i, m in enumerate(mlist) if m.get("note")}
    (Path(out_dir) / f"{company}.notes.json").write_text(json.dumps(notes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(out["stats"], ensure_ascii=False))
    print("periods:", [p["id"] for p in plist])
    print(f"-> {out_path} ({out_path.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main(*sys.argv[1:])
