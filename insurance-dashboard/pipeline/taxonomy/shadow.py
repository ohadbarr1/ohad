"""A shadow run of pipeline/build_workbook.py that keeps what the workbook throws away: every print of every cell.

build_workbook.py reads every report's primary statements and keeps ONE figure per (line, period): the latest print, unless it is not
plausibly the same line. The fact table needs every print (the vintage of each figure), so this module runs build_workbook.py's own code,
unchanged in logic, with a handful of additive hooks spliced into its source text:

  prints      the picked cell carries the full list of prints it was picked from: (report period end, value, page, url, step, plausible)
  turned      a line whose sign convention changed keeps its prints, each turned to the latest presentation (flag 4) like the cell
  derived     a fourth quarter / second half carries the two figures it was computed from
  capture     the workbook of each company is returned instead of written; search/rows.json and lines.json are not written
  meta        every statement row keeps (statement, standard, (section, normalised caption, occurrence)); every series row its (m, s, g, b)

Every hook is anchored on an exact line of build_workbook.py; an anchor that is missing (the builder was edited) stops the run with the
anchor named, rather than producing a table that silently disagrees. build_facts.py then requires the captured workbooks to equal the
published companies/<id>.json byte for byte in their facts, so the shadow can never drift from what the site shows.
"""
import contextlib
import io
import json
import os
import queue
import threading
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "build_workbook.py"

HOOKS = [
    # (anchor, replacement[, times])  the anchor must occur exactly once (or `times` times)
    ("                by[pk] = (pick[1], pick[2], pick[3], 8 if restated else 0)",
     "                by[pk] = (pick[1], pick[2], pick[3], 8 if restated else 0, _ft_prints(by[pk], pick))"),
    ("cells[key][pk] = (-c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 4)",
     "cells[key][pk] = (-c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 4) + tuple(c[4:])"),
    ('        # A line printed as "הכנסות (הוצאות) אחרות" in one report',
     "        for key, when in turned.items():\n"
     "            for pk, c in cells.get(key, {}).items():\n"
     "                if len(c) > 4:\n"
     "                    cells[key][pk] = c[:4] + (_ft_turn(c[4], min(when)),)\n"
     '        # A line printed as "הכנסות (הוצאות) אחרות" in one report'),
    ('by[("Q", date)] = (round(year[0] - n9[0], 3), year[1], year[2], 1)',
     'by[("Q", date)] = (round(year[0] - n9[0], 3), year[1], year[2], 1, ("D", "FY-9M", (typ, date, year[0], year[2]), ("9M", p9[1], n9[0], n9[2])))'),
    ('by[("H", date)] = (round(year[0] - h1[0], 3), year[1], year[2], 1)',
     'by[("H", date)] = (round(year[0] - h1[0], 3), year[1], year[2], 1, ("D", "FY-H1", (typ, date, year[0], year[2]), ("H", ph[1], h1[0], h1[2])))'),
    # every caption a row was printed under, in any report, and the captions of the rows merged into it (wording changes)
    ("                prev = key\n",
     "                prev = key\n                _FT_CAPS.setdefault((comp, st[\"statement\"], d.get(\"standard\") or \"IFRS 4\", key), set()).add(\" \".join(r[\"label\"].split()))\n"),
    ("cells[keep] = {**cells.pop(drop, {}), **cells.get(keep, {})}",
     "_ft_join(cells, keep, drop); cells[keep] = {**cells.pop(drop, {}), **cells.get(keep, {})}; _ft_merge(_FT_CAPS, comp, stmt, std, keep, drop)", 2),
    ("cells[a] = {**cb, **ca}", "_ft_join(cells, a, b); cells[a] = {**cb, **ca}; _ft_merge(_FT_CAPS, comp, stmt, std, a, b)"),
    ("have[pk] = (c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 2)",
     "have[pk] = (c[0], c[1], c[2], (c[3] if len(c) > 3 else 0) | 2) + tuple(c[4:])"),
    ('d["metrics"].append({"entity": "F", "sheet": code, "group": grp, "label": m["label"], "unit": unit, "header": m["header"], "order": n, **({"total": True} if m["total"] else {})})',
     'd["metrics"].append({"entity": "F", "sheet": code, "group": grp, "label": m["label"], "unit": unit, "header": m["header"], "order": n, **({"total": True} if m["total"] else {})}); _FT_META.setdefault(comp, {})[mi] = ("st", stmt, std, key)'),
    ('d["facts"].append([mi, pid(typ, date), v, page, uidx.get(u) if u else None] + ([c[3]] if len(c) > 3 and c[3] else []))',
     'd["facts"].append([mi, pid(typ, date), v, page, uidx.get(u) if u else None] + ([c[3]] if len(c) > 3 and c[3] else [])); _FT_X.setdefault(comp, {})[len(d["facts"]) - 1] = c[4] if len(c) > 4 else None'),
    ('d["metrics"].append({"entity": ent, "sheet": code, "group": grp, "label": name(r["m"]), "dim": dim, "unit": "pct" if pct else "k", "header": False, "order": order})',
     'd["metrics"].append({"entity": ent, "sheet": code, "group": grp, "label": name(r["m"]), "dim": dim, "unit": "pct" if pct else "k", "header": False, "order": order}); _FT_META.setdefault(comp, {})[mi] = ("se", r["m"], r["s"], r["g"], r["b"])'),
    ('d["facts"].append([mi, period(per, flow), c["v"] if pct else round(c["v"] * 1000, 3), c.get("pg"), uidx.get(u) if u else None] + ([1] if c.get("der") else []))',
     'd["facts"].append([mi, period(per, flow), c["v"] if pct else round(c["v"] * 1000, 3), c.get("pg"), uidx.get(u) if u else None] + ([1] if c.get("der") else [])); _FT_X.setdefault(comp, {})[len(d["facts"]) - 1] = ("S", per, c)'),
    # the caption of an unlabeled row is read from the page text on the Drive folder: cached (page texts never change once split)
    ("def page_caption(comp, stem, doc, page, values):",
     "def page_caption(comp, stem, doc, page, values):\n    return _ft_caption(_ft_page_caption, comp, stem, doc, page, values, PDF)\n\n\ndef _ft_page_caption(comp, stem, doc, page, values):"),
    ("live_f.write_text(json.dumps(d, ensure_ascii=False, separators=(\",\", \":\")), encoding=\"utf-8\")", "_FT_OUT[comp] = d"),
    ("base_f.write_text(", "(lambda *a, **k: None)("),
    ('(DATA / "search" / "rows.json").write_text(', "(lambda *a, **k: None)("),
    ('(DATA / "lines.json").write_text(', "(lambda *a, **k: None)("),
]


def _ft_prints(prints, pick):
    """Every print of one cell, oldest report first: (report period end, value, page, url, step, plausible). A print is plausible when it can
    be the same line as the picked one: the rule build_workbook.py applies between the first and the latest print (same sign and within a
    factor of two, a pure change of sign, or equal within the rounding of the two prints)."""
    b, sb = pick[1], pick[4]
    out = []
    for c in sorted(prints, key=lambda c: (c[0][1], c[2] or 0)):
        a, sa = c[1], c[4]
        tol = 0.5 * (sa + sb) + 0.5 * min(sa, sb)
        ok = abs(a - b) <= tol or bool(a and b and ((a * b > 0 and 0.5 <= b / a <= 2) or abs(a + b) <= tol))
        out.append((c[0][1], a, c[2], c[3], c[4], ok))
    return tuple(out)


def _ft_join(cells, keep, drop):
    """Before two rows are joined: where both print a period, the kept row's cell stands (as in the workbook) and the dropped row's prints
    join its list, so a period first printed under the old wording keeps that first print."""
    a, b = cells.get(keep, {}), cells.get(drop, {})
    for pk in set(a) & set(b):
        ca, cb = a[pk], b[pk]
        if len(ca) > 4 and len(cb) > 4 and ca[4] and cb[4] and ca[4][0] != "D" and cb[4][0] != "D":
            have = {(q[0], q[3], q[2], q[1]) for q in ca[4]}
            more = tuple(q for q in cb[4] if (q[0], q[3], q[2], q[1]) not in have)
            a[pk] = ca[:4] + (tuple(sorted(ca[4] + more, key=lambda q: (q[0], q[2] or 0))),) + ca[5:]


def _ft_merge(caps, comp, stmt, std, keep, drop):
    """Two rows build_workbook.py joined into one (a reworded or renamed line): the kept row inherits the captions of the dropped one."""
    caps.setdefault((comp, stmt, std, keep), set()).update(caps.pop((comp, stmt, std, drop), set()))


def _ft_turn(prints, when):
    """Prints of reports before the change of presentation, turned to the latest sign (the cell itself is turned the same way)."""
    return tuple((r, -v, p, u, s, ok, 4) if r < when else (r, v, p, u, s, ok, 0) for r, v, p, u, s, ok, *_ in prints)


CACHE = Path(os.environ.get("FOX_CACHE", Path.home() / ".cache" / "fox")) / "captions.json"
DRIVE_WAIT = float(os.environ.get("FOX_DRIVE_WAIT", "4"))  # seconds to wait for one page text on the Drive folder
_CAPS = {}
REPLAYED = []
_PUB = {}


def _published(comp):
    """The published workbook's statement figures of one company, by (url, page): {value: [labels]} (for replaying a caption)."""
    if comp not in _PUB:
        f = SRC.parent.parent / "web" / "public" / "data" / "companies" / f"{comp}.json"
        idx = {}
        if f.exists():
            d = json.loads(f.read_text(encoding="utf-8"))
            urls, M = d.get("urls") or [], d["metrics"]
            for x in d["facts"]:
                m = M[x[0]]
                if not m["sheet"].startswith("X.") or len(x) < 5 or x[4] is None:
                    continue
                idx.setdefault((urls[x[4]], x[3]), {}).setdefault(x[2], []).append(m["label"])
        _PUB[comp] = idx
    return _PUB[comp]


def _replay(comp, stem, doc, page, values, pdf):
    """The caption build_workbook.py read from the page, recovered from the published workbook: the row whose figures were printed on that
    page of that report with the same values. Used only when the page text cannot be read in time (Drive streaming stalled); build_facts.py
    then requires the shadow's workbook to equal the published one, so a wrong replay cannot pass unnoticed."""
    f = SRC.parent.parent / "data" / "extracted_fs" / comp / f"{stem}.json"
    try:
        rid = json.loads(f.read_text(encoding="utf-8")).get("report_id_he")
    except (OSError, ValueError):
        return None
    vals = {v: n for v, n in _published(comp).get((pdf.get(rid), page), {}).items()}
    want = [v for v in values if isinstance(v, (int, float))]
    score = {}
    for v in want:
        for mult in (1, 1000):
            for lab in vals.get(v * mult, []):
                score[lab] = score.get(lab, 0) + 1
    if not score:
        return None
    best = sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return "" if best == "סך הכול" else best


def _ft_caption(read, comp, stem, doc, page, values, pdf):
    key = json.dumps([comp, stem, doc, page, [v for v in values if isinstance(v, (int, float))]], ensure_ascii=False)
    if key in _CAPS:
        return _CAPS[key]
    box = queue.Queue()
    threading.Thread(target=lambda: box.put(read(comp, stem, doc, page, values)), daemon=True).start()
    try:
        _CAPS[key] = box.get(timeout=DRIVE_WAIT)
        return _CAPS[key]
    except queue.Empty:
        REPLAYED.append(key)
        return _replay(comp, stem, doc, page, values, pdf)


def run():
    """Run build_workbook.py with the hooks. Returns (workbooks, meta, extra, caps): caps {(company, statement, standard, row key): every
    caption the row was printed under}; workbooks {company: workbook dict as build_workbook.py
    would write it}, meta {company: {metric index: ("st", statement, standard, row key) | ("se", m, s, g, b)}}, extra {company: {fact
    index: prints tuple | derivation tuple | ("S", period, series cell) | None}}."""
    try:
        _CAPS.update(json.loads(CACHE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    n0 = len(_CAPS)
    src = SRC.read_text(encoding="utf-8")
    for anchor, repl, *times in HOOKS:
        n = src.count(anchor)
        if n != (times[0] if times else 1):
            raise SystemExit(f"shadow: build_workbook.py anchor found {n} times (expected {times[0] if times else 1}), the builder changed: {anchor[:90]}")
        src = src.replace(anchor, repl)
    g = {"__name__": "build_workbook_shadow", "__file__": str(SRC), "_FT_OUT": {}, "_FT_META": {}, "_FT_X": {}, "_FT_CAPS": {}, "_ft_merge": _ft_merge, "_ft_join": _ft_join,
         "_ft_prints": _ft_prints, "_ft_turn": _ft_turn, "_ft_caption": _ft_caption}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(src, str(SRC), "exec"), g)  # noqa: S102 - the repository's own builder
    g["POOL"].shutdown(wait=True)
    if len(_CAPS) != n0:
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps(_CAPS, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
    return g["_FT_OUT"], g["_FT_META"], g["_FT_X"], g["_FT_CAPS"]
