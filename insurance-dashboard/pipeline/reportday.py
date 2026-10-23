"""The headline roles of the company page (Report Day) read in Python, the same way pages/ReportDay.tsx reads them.

The role patterns (ROLES), the attribution pattern (ATTR) and the label cleaning are read from ReportDay.tsx itself, so a change there is
picked up here; linesOf / resolve / figAt / ltmAt are mirrored line for line. Used by check_consistency.py (what the company page shows)
and canon_kpi.py (the printed figure behind a headline).
"""
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
SRC = ROOT / "web" / "src" / "pages" / "ReportDay.tsx"
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "Q4": "12-31", "FY": "12-31"}
QOF = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "Q4"}
SHEETS = {"PL": "X.רווח_והפסד", "BS": "X.מאזן", "OCI": "X.רווח_כולל"}
src = SRC.read_text(encoding="utf-8")


def js_re(s):
    return re.compile(s.replace("\\/", "/"))


ATTR = js_re(re.search(r"const ATTR = /(.+?)/;", src).group(1))
ROLES = []
for _m in re.finditer(r"\{ key: '(\w+)', label: '[^']*', sheets: \[([A-Z, ]+)\], flow: (true|false)(.*?)\},?\n", src.split("export const ROLES", 1)[1].split("];", 1)[0]):
    _key, _sheets, _flow, _rest = _m.groups()
    _re = re.search(r"\bre: /(.+?)/(?:,|\s*$)", _rest)
    _attr = re.search(r"attr: '(\w+)'", _rest)
    _alt = re.search(r"alt: /(.+?)/,", _rest)
    ROLES.append({"key": _key, "sheets": [SHEETS[s.strip()] for s in _sheets.split(",")], "flow": _flow == "true", "re": js_re(_re.group(1)) if _re else None,
                  "attr": _attr.group(1) if _attr else None, "alt": js_re(_alt.group(1)) if _alt else None})
BY_KEY = {r["key"]: r for r in ROLES}
assert {"net", "comp", "pbt", "eq", "assets"} <= set(BY_KEY), f"Report Day roles not read from {SRC.name}: {list(BY_KEY)}"


def clean(s):
    s = re.sub(r"\(ביאור[^)]*\)", " ", s)
    s = re.sub(r"[()*:]", " ", s)
    s = re.sub(r"\s+,", ",", s)
    return re.sub(r"\s+", " ", s).strip()


def qkey(end):
    return end[:4] + QOF[end[5:10]]


def back(pk, k):
    y, q = int(pk[:4]), int(pk[5])
    i = y * 4 + q - 1 - k
    return f"{i // 4}Q{i % 4 + 1}"


def end_of(pk):
    return f"{pk[:4]}-{END[pk[4:]]}"


def rid_of(u):
    m = re.search(r"P(\d+)-\d+\.pdf", u or "") or re.search(r"reports/(\d+)", u or "")
    return int(m.group(1)) if m else None


class Book:
    """One company's workbook with the Report Day readers."""

    def __init__(self, ent):
        self.ent = ent
        self.d = d = json.loads((DATA / "companies" / f"{ent}.json").read_text(encoding="utf-8"))
        self.by_sheet = collections.defaultdict(list)
        for i, m in enumerate(d["metrics"]):
            self.by_sheet[m["sheet"]].append(i)
        self.facts = {(f[0], f[1]): (f[2], f[3] if len(f) > 3 else None, f[4] if len(f) > 4 else None, f[5] if len(f) > 5 else 0) for f in d["facts"]}
        self.pidx = {}
        for i, p in enumerate(d["periods"]):
            self.pidx.setdefault((p["type"], p["end"]), i)
        self.urls = d.get("urls") or []
        self.ends = sorted({p["end"] for p in d["periods"] if p["end"][5:10] in QOF})

    def lines_of(self, sheet):
        out, seg, last, below = [], -1, "", False
        for mi in self.by_sheet.get(sheet, []):
            m = self.d["metrics"][mi]
            label = clean(m["label"])
            if m.get("std"):
                seg, last, below = seg + 1, "", False
                continue
            if re.search(r"כולל|מיוחס|למניה", label) or ATTR.search(label):
                below = True
            if m.get("header") and re.search(r"מיוחס|ייחוס", label) and re.search(r"רווח|הפסד", label):
                last = label
            if m.get("header"):
                continue
            out.append({"mi": mi, "label": label, "raw": m["label"], "std": "4" if seg > 0 else "17", "attr": ("comp" if "כולל" in last else "net") if ATTR.search(label) else None})
            if m.get("total") and re.search(r"רווח|הפסד", label):
                last = label
        return out

    def resolve(self, role, force_alt=False):
        all_ = [l for s in role["sheets"] for l in self.lines_of(s)]
        pick = lambda f: [l for l in all_ if l["std"] == "17" and f(l)] + [l for l in all_ if l["std"] == "4" and f(l)]
        rows = [] if force_alt else pick(lambda l: l["attr"] == role["attr"] if role["attr"] else bool(role["re"].search(l["label"])))
        if rows or not role["alt"]:
            return rows, False
        return pick(lambda l: bool(role["alt"].search(l["label"]))), True

    def fig_at(self, rows, typ, end):
        """The first candidate row carrying a figure for the period: {v NIS m, rid, page, der, std, re}."""
        pi = self.pidx.get((typ, end))
        if pi is None:
            return None
        for l in rows:
            f = self.facts.get((l["mi"], pi))
            if f:
                u = self.urls[f[2]] if f[2] is not None and f[2] < len(self.urls) else None
                return {"v": f[0] / 1000, "rid": rid_of(u), "pg": f[1], "der": bool(f[3] & 1), "std": "4" if f[3] & 2 else l["std"], "re": bool(f[3] & 8), "row": l["raw"]}
        return None

    def headline(self, key, typ, end):
        """The figure the headline table shows for a role: the attribution row, or the bottom line where the report prints none (alt)."""
        role = BY_KEY[key]
        rows, alt = self.resolve(role)
        cur = self.fig_at(rows, typ, end)
        if not cur and not alt and role["alt"]:
            ar, _ = self.resolve(role, True)
            cur = self.fig_at(ar, typ, end)
            alt = bool(cur)
        return (dict(cur, alt=alt) if cur else None)

    def ltm(self, key, end):
        """ltmAt: the annual figure at a year end, otherwise the sum of four quarters under one standard (derived)."""
        rows, alt = self.resolve(BY_KEY[key])
        if end.endswith("12-31"):
            fy = self.fig_at(rows, "FY", end)
            if fy:
                return dict(fy, n=1, alt=alt)
        qs = [self.fig_at(rows, "Q", end_of(back(qkey(end), k))) for k in (3, 2, 1, 0)]
        if not all(qs) or len({q["std"] for q in qs}) > 1:
            return None
        return {"v": sum(q["v"] for q in qs), "der": True, "std": qs[0]["std"], "re": any(q["re"] for q in qs), "n": sum(2 if q["der"] else 1 for q in qs), "alt": alt,
                "parts": [q["v"] for q in qs]}


def books():
    ids = [f.stem for f in sorted((DATA / "companies").glob("*.json")) if f.name.count(".") == 1 and f.stem != "index"]
    return {i: Book(i) for i in ids}
