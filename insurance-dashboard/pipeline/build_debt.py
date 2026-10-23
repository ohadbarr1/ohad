"""Debt ladder: the liabilities schedules (MAYA form ת126) of every group and its bond-issuing subsidiaries, parsed by code.

Input:  data/raw/maya_liabilities/ (pipeline/fetch_liabilities.py): manifest.json, htm/<report_id>.htm.gz, securities/*.csv
        web/public/data/companies/<id>.json   balance-sheet "financial liabilities" line to compare with (not forced)
        web/public/data/csm/capital.json      profit and dividend of the insurers, for the coverage view
Output: web/public/data/debt/<id>.json        one group: every schedule, table and cell with its report id
        web/public/data/debt/index.json       the industry view: latest maturity wall per group, history, checks

The form (one htm per issuer and quarter, NIS thousands):
  tables  א pub   public bonds held by the public, solo           ו offbal   off-balance credit exposure, solo
          ב priv  private bonds and non-bank credit, solo         ז offbal_subs  … of consolidated non-reporting subsidiaries
          ג bank  bank credit in Israel, solo                     ח subs     credit and bonds of consolidated subsidiaries that are
          ד bank_abroad  bank credit abroad, solo                            not reporting corporations
          ה solo  summary of א–ד                                  ט/י/י"א    held by the parent / sister companies / subsidiaries
  rows    repayment year: y1, y2, y3, y4, y5p (5th year and on); older forms y5 + y6p; ו/ז add `once`; total
  cols    principal by linkage/currency: cpi (NIS CPI-linked), nis (NIS unlinked), eur, usd, c5, c6 (free currency columns, named
          by the filer), oth; int = gross interest; tot = the row total
Each stored cell is [report id, table, row, *cols]: the report id opens the htm form, table/row/column name the cell.

Checks (per table that is not all zero): every column's years sum to the total row; every row's principal + interest = its
total; ה = א+ב+ג+ד cell by cell. Tolerance 2 (NIS thousands, rounding of the filer). A failing table is kept and flagged.

Views
  wall      per group and balance date, the form's consolidated view: parent ה (solo) + parent ח (consolidated subsidiaries that are
            not reporting corporations) + the ה of every other issuer of the group that parent ח does not already contain.
            Containment is tested column by column (the subsidiary's principal totals all fit inside parent ח): several filers put
            their capital-raising company in ח although the form excludes reporting corporations. The test is a heuristic and is
            labelled as such on the page. Stored in the index with every part's report id, so each figure opens its form.
  coverage  insurers: LTM attributable profit (four quarters to the balance date) and the last full-year dividend declared, from
            csm/capital.json, beside the next 12 months of principal and interest.
  bs gap    wall principal vs the balance-sheet line (financial liabilities / loans and credit / bonds) at the same date: the gap is
            reported, never forced (the form is undiscounted contractual principal, the balance sheet amortised cost, and the line
            also holds derivatives, leases and other financial liabilities).

python3 pipeline/build_debt.py            build
python3 pipeline/build_debt.py --check    rebuild in memory and compare with the files on disk (exit 1 on a difference)
"""
import csv
import datetime as dt
import gzip
import json
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_liabilities  # noqa: E402  (the issuer list)

ROOT = Path(__file__).resolve().parent.parent
# data/raw is a Google Drive folder; a local copy of it can be named with FOX_DEBT_RAW when Drive streams slowly
RAW = Path(os.environ.get("FOX_DEBT_RAW") or ROOT / "data" / "raw" / "maya_liabilities")
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "debt"
REGISTRY = ROOT / "data" / "registry" / "companies.json"
FILES = "https://mayafiles.tase.co.il/"
TOL = 2
INSURERS = ["phoenix", "harel", "migdal", "clal", "menora", "ayalon", "hachshara", "idi"]

TABLES = {"א": "pub", "ב": "priv", "ג": "bank", "ד": "bank_abroad", "ה": "solo", "ו": "offbal", "ז": "offbal_subs", "ח": "subs",
          "ט": "from_parent", "י": "from_sister", 'י"א': "from_subs"}
COLS = ["cpi", "nis", "eur", "usd", "c5", "c6", "oth", "int", "tot"]
COL_HE = {"cpi": "שקלי צמוד מדד", "nis": "שקלי לא צמוד", "eur": "יורו", "usd": "דולר", "c5": "מטבע אחר 1", "c6": "מטבע אחר 2", "oth": "אחר",
          "int": "ריבית ברוטו", "tot": "סה\"כ"}
ROWS = [("ראשונה", "y1"), ("שניה", "y2"), ("שנייה", "y2"), ("שלישית", "y3"), ("רביעית", "y4"), ("חמישית ואילך", "y5p"), ("חמישית", "y5"),
        ("שישית ואילך", "y6p"), ("חד פעמית", "once"), ('סה"כ', "total")]
# balance-sheet lines (statements workbook, consolidated) that hold the borrowings, by preference; fund houses sum their debt lines
BS_LINES = ["התחייבויות פיננסיות", "הלוואות ואשראי", "התחייבויות הלוואות ואשראי"]
BS_FUND = {
    "altshuler": ["התחייבויות פיננסיות", "הלוואות מתאגידים בנקאיים", "חלויות שוטפות של הלוואות מתאגידים בנקאיים", "אשראי לזמן קצר"],
    "meitav": ["אגרות חוב", "אשראי מתאגידים בנקאיים ונותני אשראי אחרים", "אשראי מתאגידים ומנותני אשראי אחרים"],
    "more": ["אגרות חוב להמרה", "חלויות שוטפות של אגרות חוב להמרה", "הלוואות מתאגיד בנקאי", "חלויות שוטפות של הלוואות מתאגידים בנקאיים"],
    "ibi": ["אשראי מתאגידים בנקאיים", "התחייבויות פיננסיות לזמן קצר", "התחייבויות פיננסיות לזמן ארוך"],
}


class Form(HTMLParser):
    """The rows of every table in the form, in document order: ('T', class) at a table start, a list of cell texts per row."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.items.append(("T", dict(attrs).get("class") or ""))
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if any(self.row):
                self.items.append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def num(s):
    s = s.replace(",", "").replace("‏", "").replace("‎", "").strip()
    if s in ("", "-", "—", "–"):
        return 0
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-") or s.endswith("-")
    s = s.strip("()-")
    try:
        v = float(s)
    except ValueError:
        return None
    v = -v if neg else v
    return int(v) if v == int(v) else v


def row_key(label):
    for he, k in ROWS:
        if he in label:
            return k
    return None


def parse(raw):
    """One form → header fields and {table key: {"title", "cols", "rows": {row key: [9 numbers]}}}."""
    text = raw.decode("cp1255", errors="replace")
    p = Form()
    p.feed(text)
    flat = " ".join(" ".join(r) for r in p.items if isinstance(r, list))
    head = {
        "name": next((r[0] for r in p.items if isinstance(r, list) and r and "בע\"מ" in r[0]), ""),
        "corp": (re.search(r"מספר ברשם:\s*(\d+)", flat) or [None, None])[1],
        "ref": (re.search(r"אסמכתא:\s*\|?\s*(\d{4}-\d{2}-\d{6})", flat) or [None, None])[1],
        "aired": (re.search(r"שודר במגנא:\s*\|?\s*(\d\d/\d\d/\d{4})", flat) or [None, None])[1],
        "period": (re.search(r"תקופת הדיווח:\s*(\d\d)/(\d\d)\D+(\d{4})", flat)),
        "form_rev": (re.search(r"תאריך עדכון מבנה הטופס:\s*(\d\d/\d\d/\d{4})", flat) or [None, None])[1],
    }
    m = head["period"]
    head["period"] = f"{m[3]}-{m[2]}-{m[1]}" if m else None
    tables, cur, title, cols = {}, None, None, None
    for it in p.items:
        if isinstance(it, tuple):
            if it[1] == "dataTable" and title:
                cur = {"title": title[1], "cols": None, "rows": {}}
                tables[TABLES[title[0]]] = cur
                title = None
            elif it[1] != "dataTable":
                cur = None
            continue
        first = it[0]
        mt = re.match(r'^(י"א|[א-י])\.\s*(.+)', first)
        if mt and mt.group(1) in TABLES and len(it) <= 2:
            title, cur = (mt.group(1), mt.group(2)), None
            continue
        if cur is None:
            continue
        if cur["cols"] is None and any("צמוד" in c for c in it):
            heads = [c for c in it[1:]] if it[0] == "" else it
            cur["cols"] = heads
            continue
        k = row_key(first)
        if k and cur["cols"] is not None:
            vals = [num(c) for c in it[1:]]
            cur["rows"][k] = vals
    return head, tables


def normalise(t):
    """Columns to COLS order; free currency columns keep the filer's name."""
    heads = t["cols"] or []
    idx, names = {}, {}
    free = iter(["c5", "c6"])
    for i, h in enumerate(heads):
        h0 = h.replace("‏", "")
        if "צמוד" in h0 and "לא" not in h0:
            idx["cpi"] = i
        elif "לא צמוד" in h0:
            idx["nis"] = i
        elif "יורו" in h0:
            idx["eur"] = i
        elif "דולר" in h0:
            idx["usd"] = i
        elif "ריבית" in h0:
            idx["int"] = i
        elif "סה\"כ" in h0:
            idx["tot"] = i
        elif h0.strip() == "אחר":
            idx["oth"] = i
        else:
            k = next(free, None)
            if k:
                idx[k] = i
                if h0.strip("_ ").strip():
                    names[k] = h0.strip()
    rows = {}
    for rk, vals in t["rows"].items():
        rows[rk] = [(vals[idx[c]] if c in idx and idx[c] < len(vals) and vals[idx[c]] is not None else 0) for c in COLS]
    return rows, names, [c for c in COLS if c not in idx]


def check(key, rows):
    issues = []
    if "total" not in rows:
        return ["אין שורת סה\"כ"]
    tot = rows["total"]
    body = [k for k in rows if k != "total"]
    for j, c in enumerate(COLS):
        s = sum(rows[k][j] for k in body)
        if abs(s - tot[j]) > TOL:
            issues.append(f"{COL_HE[c]}: סכום השנים {s:,.0f} ≠ סה\"כ {tot[j]:,.0f}")
    for k in rows:
        v = rows[k]
        s = sum(v[:8])
        if abs(s - v[8]) > TOL:
            issues.append(f"שורה {k}: קרן+ריבית {s:,.0f} ≠ סה\"כ {v[8]:,.0f}")
    return issues


def nonzero(rows):
    return any(any(v) for v in rows.values())


def bs_series(gid):
    """The balance-sheet borrowings line(s) of a group by balance date: {end: (value, [labels], pg, url)}. NIS thousands."""
    p = DATA / "companies" / f"{gid}.json"
    if not p.exists():
        return {}
    d = json.loads(p.read_text(encoding="utf-8"))
    labels = BS_FUND.get(gid) or BS_LINES
    urls = d.get("urls") or []
    per = d["periods"]
    out = {}
    lines = [(i, m) for i, m in enumerate(d["metrics"]) if m.get("group") == "balance" and m.get("entity") == "F" and m["sheet"] == "X.מאזן"
             and m["label"] in labels]
    by_end = {}
    for f in d["facts"]:
        mi, pi, v = f[0], f[1], f[2]
        hit = next((m for i, m in lines if i == mi), None)
        if not hit:
            continue
        end = per[pi]["end"]
        by_end.setdefault(end, {}).setdefault(hit["label"], (v, f[3] if len(f) > 3 else None, urls[f[4]] if len(f) > 4 and f[4] is not None and f[4] < len(urls) else None))
    for end, got in by_end.items():
        if gid in BS_FUND:
            keep = got
        else:
            lab = next((l for l in BS_LINES if l in got), None)
            keep = {lab: got[lab]}
        out[end] = (sum(v[0] for v in keep.values()), list(keep), next((v[1] for v in keep.values()), None), next((v[2] for v in keep.values()), None))
    return out


def securities(mid):
    files = sorted((RAW / "securities").glob(f"{mid}_*.csv"))
    if not files:
        return None, []
    f = files[-1]
    asof = f.stem.split("_", 1)[1]
    rows = list(csv.reader(open(f, encoding="utf-8")))
    head = rows[0]
    ix = {h: i for i, h in enumerate(head)}
    def col(r, name):
        i = next((ix[h] for h in ix if name in h), None)
        return r[i] if i is not None and i < len(r) else ""
    out = []
    for r in rows[1:]:
        kind = col(r, "סוג")
        if "אג" not in kind and "כתב" not in kind and "חוב" not in kind:
            continue
        par = num(col(r, "הון מונפק"))
        out.append([col(r, "שם"), kind, col(r, "מס'"), col(r, "ISIN"), par])
    return asof, out


def build():
    man = json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))
    reg = {c["id"]: c for c in json.loads(REGISTRY.read_text(encoding="utf-8"))}
    cap = json.loads((DATA / "csm" / "capital.json").read_text(encoding="utf-8"))["companies"] if (DATA / "csm" / "capital.json").exists() else {}
    built = dt.date.today().isoformat()
    stats = {"listed": len(man["reports"]), "forms": 0, "parsed": 0, "tables": 0, "passed": 0, "failed": [], "no_htm": 0, "unparsed": [],
             "replaced": 0, "title_mismatch": 0, "warnings": []}
    # 1. parse every form; the balance date is the form's own "תקופת הדיווח" (titles are typed by hand and sometimes wrong)
    parsed = []
    for r in man["reports"]:
        f = RAW / "htm" / f"{r['report_id']}.htm.gz"
        if not r["htm"] or not f.exists():
            stats["no_htm"] += 1
            continue
        head, tables = parse(gzip.decompress(f.read_bytes()))
        if not tables:
            stats["unparsed"].append(r["report_id"])
            continue
        parsed.append((r, head, tables, head["period"] or r["end"]))
    # an issuer that joined the group later (`from` in fetch_liabilities.EXTRA): its earlier schedules are not the group's
    since = {x["maya_id"]: x.get("from") for x in fetch_liabilities.issuers()}
    parsed = [x for x in parsed if not since.get(x[0]["maya_id"]) or x[3] >= since[x[0]["maya_id"]]]
    # 2. one form per issuer and balance date: the latest filing (a correction replaces the original)
    latest = {}
    for x in parsed:
        k = (x[0]["maya_id"], x[3])
        if k not in latest or x[0]["publish"] > latest[k][0]["publish"]:
            latest[k] = x
    stats["replaced"] = len(parsed) - len(latest)
    groups = {}
    for r, head, tables, end in sorted(latest.values(), key=lambda x: (x[0]["group"], x[0]["maya_id"], x[3])):
        stats["forms"] += 1
        stats["parsed"] += 1
        g = groups.setdefault(r["group"], {"entities": {}, "reports": [], "cells": [], "free": {}})
        ent = g["entities"].setdefault(r["maya_id"], {"maya_id": r["maya_id"], "name": r["issuer"], "role": r["role"], "corp": None, "legal": None})
        ent["corp"] = ent["corp"] or head["corp"]
        ent["legal"] = head["name"] or ent["legal"]
        rep = {"rid": r["report_id"], "e": r["maya_id"], "end": end, "pub": r["publish"][:10], "ref": head["ref"], "url": r["htm"],
               "fixed": r["corrected"], "issues": {}}
        if head["period"] and head["period"] != r["end"]:
            rep["title_end"] = r["end"]  # the title names another date than the form
            stats["title_mismatch"] += 1
        rows_by = {}
        for key, t in tables.items():
            rows, names, missing = normalise(t)
            if names:
                g["free"][str(r["report_id"])] = {**g["free"].get(str(r["report_id"]), {}), **names}
            if not nonzero(rows):
                continue
            rows_by[key] = rows
            stats["tables"] += 1
            iss = check(key, rows)
            if iss:
                rep["issues"][key] = iss
                stats["failed"].append([r["group"], r["maya_id"], end, r["report_id"], key, iss[0]])
            else:
                stats["passed"] += 1
            for rk, v in rows.items():
                g["cells"].append([r["report_id"], key, rk, *v])
        # ה = א + ב + ג + ד, cell by cell
        if "solo" in rows_by:
            for rk, v in rows_by["solo"].items():
                parts = [rows_by.get(k, {}).get(rk) for k in ("pub", "priv", "bank", "bank_abroad")]
                sm = [sum((p[j] if p else 0) for p in parts) for j in range(len(COLS))]
                bad = [COL_HE[c] for j, c in enumerate(COLS) if abs(sm[j] - v[j]) > TOL]
                if bad:
                    rep["issues"].setdefault("solo", []).append(f"ה ≠ א+ב+ג+ד ({rk}: {', '.join(bad)})")
                    stats["failed"].append([r["group"], r["maya_id"], end, r["report_id"], "solo", f"ה ≠ א+ב+ג+ד ({rk})"])
                    break
        if not rep["issues"]:
            del rep["issues"]
        g["reports"].append(rep)

    index = []
    out_files = {}
    for gid, g in groups.items():
        c = reg.get(gid, {})
        kind = "ins" if c.get("kind") == "insurance_group" else "fund"
        cells = {}
        for cell in g["cells"]:
            cells.setdefault((cell[0], cell[1]), {})[cell[2]] = cell[3:]
        reps = g["reports"]
        by_rid = {x["rid"]: x for x in reps}
        ent_role = {e["maya_id"]: e["role"] for e in g["entities"].values()}
        dates = sorted({x["end"] for x in reps}, reverse=True)

        def tot(rid, key):
            return (cells.get((rid, key)) or {}).get("total")

        # 3. the form's consolidated view per date: parent ה + parent ח + every other issuer's ה that ח does not already hold
        views, walls, warn = [], [], {}
        for end in dates:
            at = {x["e"]: x for x in reps if x["end"] == end}
            parent = next((x for e, x in at.items() if ent_role[e] == "parent"), None)
            subs_h = tot(parent["rid"], "subs") if parent else None
            # which other issuers parent ח already holds: capital-raising companies first, then by size, each must fit in what is left
            # of ח's principal (a heuristic: the form gives no list of the subsidiaries inside ח)
            contained, room = {}, (sum(subs_h[:7]) if subs_h else 0)
            others = [(e, x, sum((tot(x["rid"], "solo") or [0] * 9)[:7])) for e, x in at.items() if ent_role[e] != "parent"]
            for e, x, size in sorted(others, key=lambda o: (ent_role[o[0]] != "capital", -o[2])):
                if size <= 0:
                    continue
                contained[e] = size <= room + TOL
                if contained[e]:
                    room -= size
                    # the years of ח should hold at least this issuer's years; a filer that dates them differently is flagged
                    own = cells.get((x["rid"], "solo")) or {}
                    hb = cells.get((parent["rid"], "subs")) or {}
                    late = [rk for rk, v in own.items() if rk != "total" and sum(v[:7]) > sum((hb.get(rk) or [0] * 9)[:7]) + TOL]
                    if late:
                        msg = f"טבלה ח של האם מחלקת לשנים אחרת ממצבת {g['entities'][e]['name']} ({', '.join(late)})"
                        stats["warnings"].append([gid, e, end, parent["rid"], "subs", msg])
                        warn.setdefault(end, []).append(msg)
            views.append({"end": end, "rids": {str(e): x["rid"] for e, x in at.items()}, "in_parent_h": {str(e): v for e, v in contained.items()},
                          **({"warn": warn[end]} if end in warn else {})})
            if not parent:
                continue
            parts = [("solo", parent), ("subs", parent)] + [("sep", x) for e, x in at.items() if contained.get(e) is False]
            wall = []
            for k, x in parts:
                b = {}
                for rk, vals in (cells.get((x["rid"], "solo" if k != "subs" else "subs")) or {}).items():
                    b[rk] = [sum(vals[:7]), vals[7]]
                if b:
                    wall.append({"k": k, "e": x["e"], "rid": x["rid"], "url": x["url"], "ref": x["ref"], "b": b})
            entry = {"end": end, "parts": wall}
            if kind == "ins" and gid in cap:
                entry["cov"] = coverage(cap[gid], end)
            walls.append(entry)
        bs = bs_series(gid)
        bsc = []
        for w in walls:
            if w["end"] not in bs:
                continue
            principal = sum(p["b"].get("total", [0, 0])[0] for p in w["parts"])
            bv, labels, pg, url = bs[w["end"]]
            bsc.append({"end": w["end"], "form": principal, "bs": bv, "labels": labels, "pg": pg, "url": url,
                        "gap": bv - principal, "gap_pct": round((bv - principal) / bv * 100, 1) if bv else None})
        asof, ser = None, []
        for iss in fetch_liabilities.issuers([gid]):  # every issuer of the group, also one that files no ת126 (הראל הנפקות)
            a, rows = securities(iss["maya_id"])
            if rows:
                asof = max(asof or a, a)
                ser += [[iss["maya_id"], *row] for row in rows]
                g["entities"].setdefault(iss["maya_id"], {"maya_id": iss["maya_id"], "name": iss["name"], "role": iss["role"], "corp": None, "legal": None,
                                                          "no_form": True})
        ents = sorted(g["entities"].values(), key=lambda e: (["parent", "capital", "sub"].index(e["role"]), e["maya_id"]))
        doc = {"id": gid, "name": c.get("name_he", gid), "kind": kind, "built": built,
               "source": "MAYA, דוח מצבת התחייבויות לפי מועדי פירעון (טופס ת126), אלפי ש\"ח; רשימת ניירות הערך של כל מנפיק (ע.נ. בסדרה)",
               "files": FILES, "cols": COLS, "col_he": COL_HE, "entities": ents,
               "reports": sorted(reps, key=lambda x: (x["end"], x["e"]), reverse=True), "free": g["free"],
               "cells": g["cells"], "views": views, "bs": bsc,
               "series": {"asof": asof, "rows": ser} if ser else None}
        out_files[f"{gid}.json"] = doc
        index.append({"id": gid, "name": doc["name"], "kind": kind, "entities": [[e["maya_id"], e["name"], e["role"]] for e in ents],
                      "walls": walls, "bs": bsc, "issues": sum(len(r.get("issues", {})) for r in reps), "forms": len(reps)})
    order = {g: i for i, g in enumerate(INSURERS + ["meitav", "altshuler", "more", "analyst", "yelin", "ibi", "more_gemel"])}
    index.sort(key=lambda x: order.get(x["id"], 99))
    stats["pass_rate"] = round(stats["passed"] / stats["tables"] * 100, 1) if stats["tables"] else None
    # groups with no schedule in the window (no listed debt, or delisted): named, so the page can say so
    missing = [[cid, c["name_he"]] for cid, c in reg.items() if c.get("maya_id") and cid not in groups]
    out_files["index.json"] = {"built": built, "source": "MAYA, טופס ת126 (מצבת התחייבויות לפי מועדי פירעון), אלפי ש\"ח; רווח ודיבידנד: csm/capital.json",
                               "files": FILES, "since": man.get("since"), "listed": man.get("listed"), "companies": index, "none": missing, "checks": stats}
    return out_files


def coverage(cc, end):
    """LTM attributable profit (four quarters to `end`) and the last full-year dividend declared, each with its source. NIS millions."""
    y, m = int(end[:4]), int(end[5:7])
    qs = []
    for _ in range(4):
        q = (m - 1) // 3 + 1
        qs.append(f"{y}Q{q}")
        m -= 3
        if m <= 0:
            m += 12
            y -= 1
    pa = cc.get("profit_attributable") or {}
    pts = [pa.get(q) for q in qs]
    out = {"end": end}
    if all(p is not None for p in pts):
        out["profit_ltm"] = {"v": round(sum(p["v"] for p in pts), 3), "parts": [[q, p["v"], p.get("pg"), p.get("u"), p.get("der", 0)] for q, p in zip(qs, pts)]}
    dd = cc.get("dividend_declared") or {}
    fys = sorted((k for k in dd if k.endswith("FY") and k[:4] <= end[:4]), reverse=True)
    if fys:
        p = dd[fys[0]]
        out["dividend_fy"] = {"fy": fys[0], "v": abs(p["v"]), "pg": p.get("pg"), "u": p.get("u")}
    return out


def dump(d):
    return json.dumps(d, ensure_ascii=False, separators=(",", ":"))


def main():
    files = build()
    if "--check" in sys.argv:
        bad = [n for n, d in files.items() if not (OUT / n).exists() or json.loads((OUT / n).read_text(encoding="utf-8")) | {"built": None} != d | {"built": None}]
        print("debt: up to date" if not bad else f"debt: differs: {bad}")
        sys.exit(1 if bad else 0)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        if old.name not in files:
            old.unlink()
    for n, d in files.items():
        (OUT / n).write_text(dump(d), encoding="utf-8")
    s = files["index.json"]["checks"]
    print(f"debt: {len(files) - 1} groups · {s['parsed']}/{s['forms']} forms parsed · {s['tables']} tables, {s['passed']} pass "
          f"({s['pass_rate']}%) · {len(s['failed'])} flags · {s['no_htm']} without htm")
    for f in s["failed"][:20]:
        print("  flag:", *f)


if __name__ == "__main__":
    main()
