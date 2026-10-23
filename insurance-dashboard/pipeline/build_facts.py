"""The fact table with vintage: every figure of every company workbook, with every report that printed it.

    python3 pipeline/build_facts.py            build web/public/data/facts/ and pipeline/taxonomy/{registry,lines,coverage}.json, then write
                                               companies/<id>.json, search/rows.json and lines.json from the table (= build_workbook.py)
    python3 pipeline/build_facts.py --check    gate check `facts` (pipeline/gate.py): reads only the published files, no rebuild

Model (docs/FACTS.md)
  One row per (company, line instance, period, vintage). A line instance is a workbook row (metric): its line id (pipeline/taxonomy),
  entity, sheet, standard block and dimension. The period is (window, period end): Q / H / 9M / FY / I (instant). The vintage is the
  report that printed the figure: MAYA report id, the report's period (2026Q2), its publication date and the page.
  The statements' cells keep every print: the first print of a period and each later report that printed it again (a comparative
  column), so a figure keeps its ORIGINAL print and every RESTATED print, each with its page. The series and the Phoenix spreadsheet
  sheets carry one print per cell (the source they were read from).

Row flags (bitmask)
  1 derived (Q4 = FY - 9M, H2 = FY - H1; `der` lists the two input rows)   2 from the IFRS 4 statement (as originally reported)
  4 sign turned to the latest presentation                                   8 restated: the current figure differs from the first print
  16 current: the figure the site shows today (= companies/<id>.json)       32 first print in the table ("as first reported")
  64 not plausibly the same line as the current figure (ignored by vintage policies; kept for audit)
  128 printed as a comparative column of a later report, not by the period's own report

Vintage policies (web/src/lib/facts.ts): latest = flag 16; original = flag 32; asof:<date> = the latest print published on or before
the date (derived quarters recomputed within that vintage).

Inputs: the extraction merge (build_workbook.merge(): every print of every cell, kept natively; it writes nothing itself); search/docs.json
(report id -> period, publication date). No network, no Drive reads except the page texts build_workbook.py itself reads for the
captions of unlabeled rows (cached under ~/.cache/fox/captions.json).
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "facts"
TAX = Path(__file__).resolve().parent / "taxonomy"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from taxonomy import build as tax_build  # noqa: E402
from taxonomy import rules  # noqa: E402

FLAGS = {"1": "מחושב (Q4 = FY פחות 9M, H2 = FY פחות H1)", "2": "מדוח IFRS 4 כפי שדווח במקור", "4": "סימן הופך להצגה האחרונה",
         "8": "הוצג מחדש: הערך הנוכחי שונה מההדפסה הראשונה", "16": "הערך הנוכחי באתר", "32": "ההדפסה הראשונה בטבלה",
         "64": "אינו אותה שורה באופן סביר (לא נכלל במדיניות)", "128": "מספר השוואה של דוח מאוחר"}
WB_BITS = 1 | 2 | 4 | 8  # the bits a workbook fact carries
Q_OF = {"03-31": "Q1", "06-30": "Q2", "09-30": "Q3", "12-31": "FY"}
MONTHS = {"Q": 3, "H": 6, "9M": 9, "FY": 12, "I": 0}


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def num(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def rid_of(url):
    m = re.search(r"P(\d{6,8})-\d+\.pdf", url or "")
    return int(m.group(1)) if m else None


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def season(end):
    return f"{end[:4]}{Q_OF.get(end[5:], end[5:7])}"


def build():
    import build_workbook as bw
    wbs = bw.merge(log=lambda *a: None)
    meta, extra, caps = bw.META, bw.XFACTS, bw.CAPS
    if bw.REPLAYED:
        print(f"captions of {len(bw.REPLAYED)} unlabeled rows replayed from the published workbooks (page text not readable in time)")
    written = {}  # company -> the workbook written from the fact table
    docs_file = load(DATA / "search" / "docs.json")
    docs = {r[0]: r for r in docs_file["docs"]}
    names = {c["id"]: c["name_he"] for c in load(DATA / "companies" / "index.json")}
    nfacts = {co: collections.Counter(f[0] for f in d["facts"]) for co, d in wbs.items()}
    reg_f = TAX / "registry.json"
    registry = load(reg_f) if reg_f.exists() else {"v": 1, "alias": {}}
    ids, entries, coverage, registry = tax_build.build(wbs, meta, caps, registry, nfacts)

    OUT.mkdir(exist_ok=True)
    index = {"v": 1, "flags": FLAGS, "policies": ["latest", "original", "asof:<YYYY-MM-DD>"],
             "source": "דוחות כספיים של החברות, MAYA: כל הדפסה של כל נתון, עם הדוח והעמוד", "companies": []}
    problems = collections.Counter()
    unresolved = []
    twice = []  # one report printing two figures for one cell (an old and a new wording joined by the workbook): the other is flag 64
    sizes = {}
    for co in sorted(wbs):
        d = wbs[co]
        M, PER, urls = d["metrics"], d["periods"], d.get("urls") or []
        X = extra.get(co, {})
        base_n = len(d["facts"]) - len(X)  # the Phoenix spreadsheet's facts come first and carry no print record
        src_url = {s["entity"]: s.get("url") for s in d.get("sources") or []}
        base_end = max((PER[f[1]]["end"] for f in d["facts"][:base_n]), default=None)

        vint, vidx = [], {}

        def vkey(url, rep_end=None, entity=None):
            """Vintage index of a report: by its url (or the entity's source document for the spreadsheet facts)."""
            k = url or (f"src:{entity}" if entity else f"r:{rep_end}")
            if k not in vidx:
                rid = rid_of(url)
                doc = docs.get(rid)
                per = doc[3] if doc else (season(rep_end) if rep_end else None)
                pub = doc[4] if doc else None
                vidx[k] = len(vint)
                vint.append({"rid": rid, "url": url or (src_url.get(entity) if entity else None), "per": per, "pub": pub, "end": rep_end})
            return vidx[k]

        per_i = {}
        lines = []  # one per non-header metric, workbook order
        line_of = {}
        for i, m in enumerate(M):
            if m["header"] and not nfacts[co].get(i):
                continue
            lid, tier, blk = ids[co][i]
            mt = meta.get(co, {}).get(i)
            std = (mt[2].replace("IFRS ", "") if mt and mt[0] == "st" else "")
            line_of[i] = len(lines)
            lines.append({"id": lid, "mi": i, "sheet": m["sheet"], "ent": m.get("entity", "F"), "std": std, "dim": m.get("dim") or "",
                          "label": m["label"], "unit": m["unit"], "rows": []})
        for fi, f in enumerate(d["facts"]):
            mi, pi, v, page = f[0], f[1], f[2], f[3]
            u = urls[f[4]] if len(f) > 4 and f[4] is not None else None
            flag = f[5] if len(f) > 5 else 0
            if mi not in line_of:
                problems["fact on a header row"] += 1
                continue
            L = lines[line_of[mi]]
            p = PER[pi]
            pk = (p["type"], p["end"])
            per_i.setdefault(pk, None)
            x = X.get(fi) if fi >= base_n else None
            if fi < base_n:  # the company's own spreadsheet: one print, the report the spreadsheet accompanies
                vi = vkey(None, base_end, L["ent"]) if not src_url.get(L["ent"]) or not rid_of(src_url.get(L["ent"])) else vkey(src_url[L["ent"]], base_end)
                L["rows"].append([pk, vi, v, page, 16 | 32 | (flag & WB_BITS) | (128 if p["end"] != base_end else 0), None, []])
            elif x is None:
                problems["statement cell without prints"] += 1
                L["rows"].append([pk, vkey(u), v, page, 16 | (flag & WB_BITS), None, []])
            elif x[0] == "S":  # a series cell: the one print it was read from
                c = x[2]
                vi = vkey(u, None)
                L["rows"].append([pk, vi, v, page, 16 | 32 | (flag & WB_BITS) | (128 if c.get("cmp") else 0), ("S", c) if c.get("der") else None, []])
            elif x[0] == "D":  # a derived fourth quarter / second half: FY less the part
                _, op, (yt, yd, yv, yu), (ptyp, pdate, pv, purl) = x
                L["rows"].append([pk, None, v, page, 16 | (flag & WB_BITS), ("D", op, (yt, yd, yv, yu), (ptyp, pdate, pv, purl)), []])
            else:  # a statement cell: every print, oldest report first
                prints = [tuple(q) + ((0,) if len(q) == 6 else ()) for q in x]
                cur = [k for k, q in enumerate(prints) if q[3] == u and q[2] == page and q[1] == v]
                if not cur:
                    problems["current figure not among its prints"] += 1
                    cur = [len(prints) - 1]
                ci = cur[-1]
                first = next((k for k, q in enumerate(prints) if q[5]), ci)
                seen_v = {}
                for k, (rep, val, pg, url, step, ok, tf) in enumerate(prints):
                    fl = (flag & 2) | tf | (0 if ok else 64) | (128 if rep != p["end"] else 0)
                    if k == ci:
                        fl |= 16 | (flag & 8)
                        if (fl & 4) != (flag & 4):
                            problems["sign flag of the current print differs from the workbook"] += 1
                    if k == first:
                        fl |= 32
                    vi = vkey(url, rep)
                    if vi in seen_v:  # one report printing the cell twice: the same figure once; another figure is kept as implausible
                        prev = L["rows"][seen_v[vi]]
                        if prev[2] == val:  # the same figure on two pages of one report: one row, the other page kept in `alt`
                            if fl & 16 and prev[3] != pg:
                                prev[6].append(prev[3])
                                prev[3] = pg
                            elif pg != prev[3] and pg not in prev[6]:
                                prev[6].append(pg)
                            prev[4] |= fl & (16 | 32 | 8)
                            continue
                        fl |= 64 if not (fl & 16) else 0
                        twice.append(f"{co} {L['label'][:40]} {pk[0]}{pk[1]}")
                    seen_v[vi] = len(L["rows"])
                    L["rows"].append([pk, vi, val, pg, fl, None, []])

        # periods of this company, in time order; vintages in publication order
        plist = sorted(per_i, key=lambda k: (k[1], MONTHS[k[0]]))
        pidx = {k: n for n, k in enumerate(plist)}
        vorder = sorted(range(len(vint)), key=lambda n: (vint[n]["pub"] or vint[n]["end"] or "9999", vint[n]["rid"] or 0, vint[n]["url"] or ""))
        vre = {old: new for new, old in enumerate(vorder)}
        vint = [vint[n] for n in vorder]
        # derived rows: vintage = the later-published input; inputs are row references inside the line
        flat = []
        for L in lines:
            rows = L["rows"]
            for r in rows:
                if r[1] is not None:
                    r[1] = vre[r[1]]
            by_pv = collections.defaultdict(list)
            for k, r in enumerate(rows):
                by_pv[r[0]].append(k)
            new = []
            for k, r in enumerate(rows):
                if not r[5]:
                    continue
                if r[5][0] == "S":  # a series quarter: the year less nine months (the nine months are not a row of the workbook)
                    fy = [j for j in by_pv.get(("FY", r[0][1]), []) if rows[j][4] & 16]
                    r[5] = ("FY-9M", fy[0] if fy else [None], [round(rows[fy[0]][2] - r[2], 3)] if fy else [None], None)
                    continue
                _, op, (yt, yd, yv, yu), (ptyp, pdate, pv, purl) = r[5]
                fy = [j for j in by_pv.get((yt, yd), []) if rows[j][2] == yv and (vint[rows[j][1]]["url"] == yu)]
                part = [j for j in by_pv.get((ptyp, pdate), []) if rows[j][4] & 16 and rows[j][2] == pv]
                part = part or [j for j in by_pv.get((ptyp, pdate), []) if rows[j][2] == pv and not rows[j][4] & 64]
                fj, pj = (fy[-1] if fy else None), (part[0] if part else None)
                cand = [rows[j][1] for j in (fj, pj) if j is not None]
                r[1] = max(cand) if cand else 0
                # an input that is not a row of this line (build_workbook.py took the year from a print of a row it later merged, or
                # turned its sign): the figure is kept as a literal, so the arithmetic stays checkable
                r[5] = (op, fj if fj is not None else [yv, yu], pj if pj is not None else [pv], "D")
                if fj is None or pj is None:
                    unresolved.append(f"{co} {L['label'][:40]} {r[0][0]}{r[0][1]}")
                # as first reported: the year as first printed less the part as first printed, when that is another figure
                fo = [j for j in by_pv.get((yt, yd), []) if rows[j][4] & 32]
                po = [j for j in by_pv.get((ptyp, pdate), []) if rows[j][4] & 32]
                if fo and po:
                    if fo[0] == fj and po[0] == pj:
                        r[4] |= 32
                    else:
                        vo = max(rows[fo[0]][1], rows[po[0]][1])
                        if vo == r[1]:
                            vo = None  # the same report: no second figure for one vintage
                        if vo is not None:
                            new.append([r[0], vo, round(rows[fo[0]][2] - rows[po[0]][2], 3), rows[fo[0]][3], 1 | 32 | (r[4] & 2) | (128 if rows[fo[0]][4] & 128 else 0),
                                        (op, fo[0], po[0], None), []])
                        else:
                            r[4] |= 32
            rows.extend(new)
            # sort by period then vintage; remap the derived inputs
            order = sorted(range(len(rows)), key=lambda k: (pidx[rows[k][0]], rows[k][1]))
            remap = {old: n for n, old in enumerate(order)}
            L["rows"] = [rows[k] for k in order]
            for r in L["rows"]:
                if r[5]:
                    op, a, b, kind = r[5]
                    r[5] = (op, remap[a] if isinstance(a, int) else a, remap[b] if isinstance(b, int) else b, kind)
            # every period has one current row and one first-print row
            byp = collections.defaultdict(lambda: [0, 0])
            for r in L["rows"]:
                byp[r[0]][0] += bool(r[4] & 16)
                byp[r[0]][1] += bool(r[4] & 32)
            for pk, (a, b) in byp.items():
                if a != 1:
                    problems["period without exactly one current row"] += 1
                if b > 1:
                    problems["period with more than one first-print row"] += 1
            # orientation of an expense / income line as this company prints it (+1 positive, -1 negative)
            e = entries.get(L["id"], {})
            if e.get("nature") in ("exp", "inc"):
                vals = sorted(r[2] for r in L["rows"] if r[4] & 16)
                L["o"] = -1 if vals and vals[len(vals) // 2] < 0 else 1
            flat.append(L)

        # columnar output
        u_list, u_idx = [], {}
        for vi in vint:
            if vi["url"] and vi["url"] not in u_idx:
                u_idx[vi["url"]] = len(u_list)
                u_list.append(vi["url"])
        sheets = sorted({L["sheet"] for L in flat}, key=lambda s: next(i for i, x in enumerate(d["sheets"]) if x["code"] == s) if any(x["code"] == s for x in d["sheets"]) else 999)
        sidx = {s: i for i, s in enumerate(sheets)}
        # the workbook the site serves, written from the table's current rows (flag 16), in the merge's order
        written[co] = workbook_of(d, lines, line_of, vint, base_n)

        def lit(a):
            """A derivation input outside the line: [value], and for the year its report as an index into urls (null when unknown)."""
            out = [num(a[0]) if a[0] is not None else None]
            if len(a) > 1:
                if a[1] and a[1] not in u_idx:
                    u_idx[a[1]] = len(u_list)
                    u_list.append(a[1])
                out.append(u_idx.get(a[1]) if a[1] else None)
            return out
        rows_p, rows_t, rows_v, rows_pg, rows_f, der, alt = [], [], [], [], [], [], []
        n_rows = 0
        for L in flat:
            base = n_rows
            for r in L["rows"]:
                rows_p.append(pidx[r[0]])
                rows_t.append(r[1])
                rows_v.append(num(r[2]))
                rows_pg.append(r[3])
                rows_f.append(r[4])
                for q in sorted(r[6]):
                    alt.append([n_rows, q])
                if r[5]:
                    op, a, b, _ = r[5]
                    der.append([n_rows, op, base + a if isinstance(a, int) else lit(a), base + b if isinstance(b, int) else lit(b)])
                n_rows += 1
        out = {
            "v": 1, "company": co, "name": names.get(co, co), "workbook": f"companies/{co}.json",
            "flags": "1 מחושב · 2 IFRS 4 · 4 סימן הופך · 8 הוצג מחדש · 16 נוכחי · 32 הדפסה ראשונה · 64 לא אותה שורה · 128 מספר השוואה",
            "periods": [[t, e] for t, e in plist],
            "vint": {"rid": [x["rid"] for x in vint], "per": [x["per"] for x in vint], "pub": [x["pub"] for x in vint],
                     "u": [u_idx.get(x["url"]) for x in vint]},
            "urls": u_list,
            "sheets": sheets,
            "lines": {"id": [L["id"] for L in flat], "mi": [L["mi"] for L in flat], "sh": [sidx[L["sheet"]] for L in flat],
                      "ent": [L["ent"] for L in flat], "std": [L["std"] for L in flat], "dim": [L["dim"] for L in flat],
                      "label": [L["label"] for L in flat], "u": [L["unit"] for L in flat], "o": [L.get("o", 0) for L in flat],
                      "n": [len(L["rows"]) for L in flat]},
            "rows": {"p": rows_p, "t": rows_t, "v": rows_v, "pg": rows_pg, "f": rows_f},
            "der": der,
            "alt": alt,
        }
        text = dump(out)
        (OUT / f"{co}.json").write_text(text, encoding="utf-8")
        sizes[co] = len(text.encode("utf-8"))
        n_re = sum(1 for f in rows_f if f & 8)
        multi = collections.Counter()
        start = 0
        for L in flat:
            per_n = collections.Counter(r[0] for r in L["rows"] if not r[4] & 64)
            multi["cells"] += len(per_n)
            multi["multi"] += sum(1 for n in per_n.values() if n > 1)
        index["companies"].append({"id": co, "name": names.get(co, co), "lines": len(flat), "rows": n_rows, "current": sum(1 for f in rows_f if f & 16),
                                   "cells": multi["cells"], "reprinted": multi["multi"], "restated": n_re, "derived": len(der), "vintages": len(vint),
                                   "periods": [plist[0][1], plist[-1][1]] if plist else None, "kb": round(sizes[co] / 1024)})
        print(f"{co}: {len(flat)} lines, {n_rows} rows ({multi['multi']} of {multi['cells']} cells printed more than once), {len(vint)} reports, {sizes[co] // 1024} KB")

    # the workbooks, the search rows and the cross-company lines, from the table
    rows, cross = bw.side_outputs(written)
    changed = bw.write(written, rows, cross)
    print(f"companies/, search/rows.json, lines.json written from the fact table: {', '.join(changed) if changed else 'all unchanged'}")
    # the taxonomy: the full entries and the alias registry under pipeline/taxonomy, the client's copy beside the facts
    full = {}
    for lid in sorted(entries):
        e = entries[lid]
        full[lid] = {"label": e["label"], "stmt": e["stmt"], "block": e["block"], "tier": e["tier"], "unit": e["unit"], "nature": e["nature"],
                     "tadd": e["tadd"], "sadd": e["sadd"], "std": sorted(e["std"]), "cos": sorted(e["cos"]), "rows": e["n"],
                     **({"bridge": e["bridge"]} if e.get("bridge") else {}), **({"bridge_from": sorted(e["bridge_from"])} if e.get("bridge_from") else {}),
                     **({"series": e["series"]} if e.get("series") else {}), **({"aliases": sorted(e["aliases"])} if e["stmt"] != "px" else {})}
    # one line per id, so a change of the taxonomy reads as a diff
    (TAX / "lines.json").write_text('{"v":1,"lines":{\n' + ",\n".join(f"{dump(k)}:{dump(v)}" for k, v in full.items()) + "\n}}\n", encoding="utf-8")
    reg_f.write_text(json.dumps(registry, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    (TAX / "coverage.json").write_text(json.dumps(coverage, ensure_ascii=False, indent=1), encoding="utf-8")
    web_tax = {"v": 1, "stmt": rules.STMT_HE, "block": rules.BLOCK_HE,
               "cols": ["label", "stmt", "block", "tier", "unit", "nature", "tadd", "sadd", "std", "bridge", "cos"],
               "lines": {lid: [e["label"], e["stmt"], e["block"], e["tier"], e["unit"], e["nature"], int(e["tadd"]), int(e["sadd"]), "".join(x for x in e["std"]),
                               ([e["bridge"]["to"], e["bridge"]["kind"]] if e.get("bridge") else None), len(e["cos"])] for lid, e in full.items()
                         if e["tier"] != "own" or e["stmt"] in ("pl", "oci", "bs", "cf", "n")}}
    (OUT / "taxonomy.json").write_text(dump(web_tax), encoding="utf-8")
    index["taxonomy"] = {"v": 1, "lines": len(full), "core": coverage["lines"]["core"], "shared": coverage["lines"]["shared"], "own": coverage["lines"]["own"],
                         "rows_mapped_share": coverage["mapped_share"], "facts_mapped_share": coverage["facts_mapped_share"]}
    index["derived_from_outside"] = unresolved
    index["printed_twice"] = twice
    index["kb"] = round((sum(sizes.values()) + len(dump(web_tax).encode("utf-8"))) / 1024)
    (OUT / "index.json").write_text(dump(index), encoding="utf-8")
    comp_kb = sum(f.stat().st_size for f in (DATA / "companies").glob("*.json")) / 1024
    print(f"facts/: {index['kb'] + len(dump(index)) // 1024} KB vs companies/ {comp_kb:.0f} KB ({(index['kb'] + len(dump(index)) / 1024) / comp_kb:.2f}x)")
    print(f"taxonomy: {len(full)} lines (core {coverage['lines']['core']}, shared {coverage['lines']['shared']}, own {coverage['lines']['own']}); "
          f"rows on a cross-company id {coverage['mapped_share']:.1%}, figures {coverage['facts_mapped_share']:.1%}; by kind {coverage['by_kind']}")
    if twice:
        print(f"{len(twice)} cells printed with two figures by one report (the second kept as flag 64): {twice[0]} ...")
    if unresolved:
        print(f"{len(unresolved)} derived figures take an input from outside their line (kept as a literal): {unresolved[0]} ...")
    if problems:
        print("problems:", dict(problems))
    return 1 if problems else 0


def workbook_of(d, lines, line_of, vint, base_n):
    """companies/<id>.json written from the fact table (docs/FACTS.md, migration step 1): every workbook figure is the table's current row of
    its cell (value, page, report, flags 1/2/4/8); a derived figure cites the report of the year it was computed from. The merge's own
    workbook (metrics, periods, order, restatement pairs) is the frame; the build stops if the table and the merge disagree on one byte."""
    cur = {}
    for L in lines:
        for k, r in enumerate(L["rows"]):
            if r[4] & 16:
                cur[(L["mi"], r[0])] = (L, r)
    P, old_urls = d["periods"], d.get("urls") or []
    urls, uidx = [], {}

    def uix(u):
        if u and u not in uidx:
            uidx[u] = len(urls)
            urls.append(u)
        return uidx.get(u) if u else None
    facts = []
    for fi, x in enumerate(d["facts"]):
        mi, pi = x[0], x[1]
        L, r = cur[(mi, (P[pi]["type"], P[pi]["end"]))]
        fl = r[4] & WB_BITS
        if not L["sheet"].startswith("X."):  # the company's own spreadsheet: [metric, period, value, page]
            if fi >= base_n:
                raise SystemExit(f"build_facts: a report figure on the spreadsheet sheet {L['sheet']}")
            facts.append([mi, pi, r[2], r[3]] + ([fl] if fl else []))
            continue
        url = vint[r[1]]["url"] if r[1] is not None else None
        if r[4] & 1 and r[5] and r[5][3] == "D":  # a statement's fourth quarter / second half: the report of the year
            a = r[5][1]
            url = vint[L["rows"][a][1]]["url"] if isinstance(a, int) else a[1]
        facts.append([mi, pi, r[2], r[3], uix(url)] + ([fl] if fl else []))
    restated = [[x[0], x[1], x[2], x[3], x[4], x[5], x[6], uix(old_urls[x[7]] if x[7] is not None else None), x[8], x[9],
                 uix(old_urls[x[10]] if x[10] is not None else None), x[11]] for x in d.get("restated", [])]
    out = {k: ({"facts": facts, "urls": urls, "restated": restated}.get(k, v)) for k, v in d.items()}
    if dump(out) != dump(d):
        bad = next((i for i, (a, b) in enumerate(zip(out["facts"], d["facts"])) if a != b), None)
        raise SystemExit(f"build_facts: companies/{d['company']}.json written from the table differs from the merge"
                         + (f" at fact {bad}: {out['facts'][bad]} vs {d['facts'][bad]}" if bad is not None else f" (urls {len(urls)} vs {len(old_urls)})"))
    return out


# ------------------------------------------------------------------------------------------------------------------------------ check
def check():
    """The fact table must reproduce (1) every current figure of companies/<id>.json exactly (value, page, report, flags 1/2/4/8) and
    (2) every original-vs-restated pair of restatements.json on the primary statements (both values, both reports, both pages); plus its
    own invariants: one current and at most one first-print row per cell, derived rows equal their inputs, every line id in the taxonomy,
    files in canonical form, size within 1.5x of companies/."""
    fails = collections.Counter()
    eg = {}

    def bad(kind, what):
        fails[kind] += 1
        eg.setdefault(kind, what)
    idx_f = OUT / "index.json"
    if not idx_f.exists():
        print("facts: web/public/data/facts/index.json missing (run pipeline/build_facts.py)")
        return 1
    index = load(idx_f)
    tax = load(OUT / "taxonomy.json")["lines"]
    reg = load(TAX / "lines.json")["lines"]
    n_cur = n_pairs = n_rows = 0
    facts = {}
    for c in index["companies"]:
        co = c["id"]
        ft = OUT / f"{co}.json"
        text = ft.read_text(encoding="utf-8")
        F = json.loads(text)
        if dump(F) != text:
            bad("not canonical", co)
        facts[co] = F
        wb = load(DATA / "companies" / f"{co}.json")
        urls, P, M = wb.get("urls") or [], wb["periods"], wb["metrics"]
        L, R, V = F["lines"], F["rows"], F["vint"]
        n_rows += len(R["f"])
        start, line_rows = 0, {}
        for li, n in enumerate(L["n"]):
            line_rows[L["mi"][li]] = range(start, start + n)
            start += n
            if L["id"][li] not in reg:
                bad("line id not in the taxonomy", f"{co} {L['id'][li]}")
        cur = {}
        for mi, rr in line_rows.items():
            for k in rr:
                if R["f"][k] & 16:
                    key = (mi, tuple(F["periods"][R["p"][k]]))
                    if key in cur:
                        bad("two current rows for one cell", f"{co} {M[mi]['label']} {key[1]}")
                    cur[key] = k
        vurl = [F["urls"][u] if u is not None else None for u in V["u"]]
        der_in = {dr[0]: dr[2] for dr in F["der"]}
        for x in wb["facts"]:
            n_cur += 1
            mi, pi, v, page = x[0], x[1], x[2], x[3]
            u = urls[x[4]] if len(x) > 4 and x[4] is not None else None
            flag = (x[5] if len(x) > 5 else 0) & WB_BITS
            k = cur.get((mi, (P[pi]["type"], P[pi]["end"])))
            if k is None:
                bad("workbook figure missing", f"{co} {M[mi]['label']} {P[pi]['id']}")
                continue
            t = R["t"][k]
            got_u = vurl[t]
            if R["f"][k] & 1 and k in der_in and u is not None and got_u != u:
                got_u = vurl[R["t"][der_in[k]]] if isinstance(der_in[k], int) else u  # a derived figure cites the year it was computed from
            if R["v"][k] != v or R["pg"][k] != page or (R["f"][k] & WB_BITS) != flag or (u is not None and got_u != u):
                bad("workbook figure differs", f"{co} {M[mi]['label']} {P[pi]['id']}: {v} p{page} f{flag} vs {R['v'][k]} p{R['pg'][k]} f{R['f'][k] & WB_BITS}")
        if len(cur) != len(wb["facts"]):
            bad("current rows beyond the workbook", f"{co} {len(cur)} vs {len(wb['facts'])}")
        # invariants: one first print per cell; derived rows equal their inputs
        firsts = collections.Counter()
        for mi, rr in line_rows.items():
            for k in rr:
                if R["f"][k] & 32:
                    firsts[(mi, R["p"][k])] += 1
        for key, n in firsts.items():
            if n > 1:
                bad("two first-print rows for one cell", f"{co} {M[key[0]]['label']}")
        for dr in F["der"]:
            k, op, a, b = dr
            va = R["v"][a] if isinstance(a, int) else a[0]
            vb = R["v"][b] if isinstance(b, int) else b[0]
            if not R["f"][k] & 1:
                bad("derivation on a row not flagged derived", f"{co} row {k}")
            if va is None or vb is None:
                bad("derived row without its inputs", f"{co} row {k}")
                continue
            want = va - vb
            if abs(want - R["v"][k]) > 0.0015:
                bad("derived row differs from its inputs", f"{co} row {k}: {R['v'][k]} vs {want}")
    # (2) restatements.json: first print and latest print of the statements' pairs
    rs = load(DATA / "restatements.json")
    cols = {c: i for i, c in enumerate(rs["cols"])}
    st_sheet = {"pl": "X.רווח_והפסד", "bs": "X.מאזן", "oci": "X.רווח_כולל", "cf": "X.תזרים_מזומנים"}
    notes = first_ok = 0
    by_label, by_sheet = {}, {}
    for co, F in facts.items():
        L = F["lines"]
        start = 0
        m, sh = collections.defaultdict(list), collections.defaultdict(list)
        for li, n in enumerate(L["n"]):
            m[(F["sheets"][L["sh"][li]], L["label"][li])].append(range(start, start + n))
            sh[F["sheets"][L["sh"][li]]].append(range(start, start + n))
            start += n
        by_label[co], by_sheet[co] = m, sh
    wb_pairs, stale = set(), []
    inv = {v: k for k, v in st_sheet.items()}
    for co in facts:
        wb = load(DATA / "companies" / f"{co}.json")
        urls = wb.get("urls") or []
        for x in wb.get("restated") or []:
            if x[0] in inv:
                wb_pairs.add((co, inv[x[0]], x[2], x[3], x[4], x[5], rid_of(urls[x[7]]) if x[7] is not None else None, x[8], rid_of(urls[x[10]]) if x[10] is not None else None))
    for r in rs["rows"]:
        co, st, line, pt, pe = r[cols["co"]], r[cols["st"]], r[cols["line"]], r[cols["pt"]], r[cols["pe"]]
        if st not in st_sheet:
            notes += 1
            continue
        n_pairs += 1
        F = facts.get(co)
        if F is None:
            bad("restatement of a company without facts", co)
            continue
        R, V = F["rows"], F["vint"]
        alt = collections.defaultdict(set)
        for k, q in F.get("alt", []):
            alt[k].add(q)
        pi = next((i for i, p in enumerate(F["periods"]) if p == [pt, pe]), None)
        v0, d0, p0, v1, d1, p1 = (r[cols[k]] for k in ("v0", "d0", "p0", "v1", "d1", "p1"))
        ok = False
        # by its caption; a caption the workbook later joined to a newer wording is found by the pair itself (both values, reports, pages)
        for rr in by_label[co].get((st_sheet[st], line), []) + by_sheet[co].get(st_sheet[st], []):
            ks = [k for k in rr if R["p"][k] == pi]
            a = [k for k in ks if V["rid"][R["t"][k]] == d0 and (R["pg"][k] == p0 or p0 in alt[k]) and (R["v"][k] == v0 or (R["f"][k] & 4 and R["v"][k] == -v0))]
            b = [k for k in ks if V["rid"][R["t"][k]] == d1 and (R["pg"][k] == p1 or p1 in alt[k]) and (R["v"][k] == v1 or (R["f"][k] & 4 and R["v"][k] == -v1))]
            if a and b and min(R["t"][k] for k in a) <= max(R["t"][k] for k in b):
                ok = True
                first_ok += any(R["f"][k] & 32 for k in a)
                break
        if not ok and (co, st, line, pt, pe, v0, d0, v1, d1) not in wb_pairs:
            stale.append(f"{co} {st} {line[:30]} {pt} {pe}")  # not in the workbook any more: restatements.json predates it
            continue
        if not ok:
            bad("restatement pair not reproduced", f"{co} {st} {line[:30]} {pt} {pe}: {v0} ({d0} p{p0}) -> {v1} ({d1} p{p1})")
    # size budget
    comp = sum(f.stat().st_size for f in (DATA / "companies").glob("*.json"))
    size = sum(f.stat().st_size for f in OUT.glob("*.json"))
    if size > 1.5 * comp:
        bad("size over 1.5x companies/", f"{size // 1024} KB vs {comp // 1024} KB")
    for kind, n in sorted(fails.items()):
        print(f"  {kind}: {n} (e.g. {eg[kind]})")
    print(f"facts: {n_cur} workbook figures and {n_pairs} statement restatement pairs checked over {n_rows} rows of {len(facts)} companies; "
          f"({first_ok} with the original as the cell's first print; the rest were first printed under an older wording); {notes} note pairs (IFRS 17 notes, ifrs_*.json) are outside the fact table; size {size // 1024} KB = {size / comp:.2f}x companies/; "
          f"{sum(fails.values())} problems"
          + (f"; restatements.json is stale: {len(stale)} pairs the workbook no longer has (rerun build_restatements.py), e.g. {stale[0]}" if stale else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv else build())
