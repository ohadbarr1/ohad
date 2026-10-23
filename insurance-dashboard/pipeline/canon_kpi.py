"""One value per figure: where the statements printed a headline figure that the XBRL tag gives slightly differently (a rounding,
e.g. Clal Q2'26 basic EPS printed 7.63 against 7.64 tagged), the site shows the printed figure, with its page, and names the tag value.

Reads web/public/data/kpi.json and web/public/data/lines.json (build_kpi.py and build_workbook.py first); writes kpi.json back with
companies.<id>.canon = { key: { period: [printed, tagged, report id, page] } }. Larger differences are left alone: they are not a
rounding, and the KPI fixes in build_kpi.py handle the known tagging errors.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reportday  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
kpi = json.loads((DATA / "kpi.json").read_text(encoding="utf-8"))
lines = json.loads((DATA / "lines.json").read_text(encoding="utf-8"))
END = {"Q1": "03-31", "Q2": "06-30", "Q3": "09-30", "FY": "12-31"}
# kpi key -> (cross-company line, kind of period, scale, rounding tolerance). Both files keep amounts in NIS thousands; a figure printed
# in NIS millions rounds by up to 500 thousand, so the tolerance is NIS 1.5m or 0.15%; per-share figures round at the second decimal.
MAP = {"eps": ("eps", "flow", 1, lambda v: 0.015), "equity": ("equity_attr", "inst", 1, lambda v: max(1500, abs(v) * 0.0015)),
       "assets": ("total_assets", "inst", 1, lambda v: max(1500, abs(v) * 0.0015))}
periods = [tuple(p) for p in lines["periods"]]
BOOKS = reportday.books()
INSURERS = {"phoenix", "harel", "migdal", "clal", "menora", "hachshara", "ayalon", "idi"}
rid_of = lambda u: int(m.group(1)) if u and (m := re.search(r"P(\d+)-\d+\.pdf", u)) else None
n = 0
for comp, c in kpi["companies"].items():
    canon = {}
    for key, (role, kind, scale, tol) in MAP.items():
        printed = lines["data"].get(role, {}).get(comp)
        if not printed or key not in c["values"]:
            continue
        cells = {periods[pi]: (v, pg, u) for pi, v, pg, u, *_ in printed["cells"]}
        for i, p in enumerate(c["periods"]):
            x = c["values"][key][i]
            end = f"{p[:4]}-{END[p[4:]]}"
            hit = cells.get(("FY" if p.endswith("FY") else "Q", end)) if kind == "flow" else cells.get(("I", end))
            if x is None or not hit:
                continue
            v = hit[0] / scale
            rid = rid_of(lines["urls"][hit[2]] if hit[2] is not None else None)
            # the printed figure of the SAME report as the tag: a later report's comparative may be restated, which is not a rounding
            if abs(v - x) > 1e-9 and abs(v - x) <= tol(v) and rid == (c.get("rid") or [None] * len(c["periods"]))[i]:
                canon.setdefault(key, {})[p] = [round(v, 4), x, rid_of(lines["urls"][hit[2]] if hit[2] is not None else None), hit[1]]
                n += 1
    # Q4 is not printed: every page derives it. The statements, the peer table and the company page take the year less the nine months as
    # printed (one subtraction of two printed figures); the tag series has no nine-month figure, so FY − Q1 − Q2 − Q3 there can land a
    # rounding away (Clal Q4'25 profit 740 against 739). Where the two derivations differ by rounding only, the site shows FY − 9M:
    # canon[key]["<y>Q4"] = [FY − 9M, FY − Q1 − Q2 − Q3, report id of the nine months, its page], NIS thousands.
    # A tag left empty (0) where the same report prints the figure: the printed figure, with its page (Hachshara comprehensive income FY'25).
    bk = BOOKS.get(comp)
    if bk and not c.get("filer"):
        for key, role in (("profit", "net"), ("oci", "comp"), ("pretax", "pbt")):
            vals = c["values"].get(key)
            if not vals:
                continue
            at = dict(zip(c["periods"], vals))
            for i, p in enumerate(c["periods"]):
                x = vals[i]
                typ = "FY" if p.endswith("FY") else "Q"
                end = f"{p[:4]}-{END[p[4:]]}"
                if x == 0:
                    # the row the company page shows (the bottom line where no attribution row is printed: no minorities), from the same
                    # report as the tag, or a later print of the same figure (not restated) under the same standard
                    ins = int(p[:4]) < 2025 and comp in INSURERS
                    rows = bk.resolve(reportday.BY_KEY[role])[0] + bk.resolve(reportday.BY_KEY[role], True)[0]
                    hits = [f for f in (bk.fig_at([r], typ, end) for r in rows) if f and f["v"]]
                    f = next((f for f in hits if f["rid"] == c["rid"][i]), None) or next((f for f in hits if not f["re"] and (f["std"] == "4") == ins), None)
                    if f:
                        canon.setdefault(key, {})[p] = [round(f["v"] * 1000, 4), x, f["rid"], f["pg"]]
                        n += 1
                if typ != "FY":
                    continue
                y = p[:4]
                fy = canon.get(key, {}).get(p, [x])[0]
                qs = [at.get(f"{y}Q{k}") for k in (1, 2, 3)]
                if fy is None or None in qs:
                    continue
                q4 = fy - sum(canon.get(key, {}).get(f"{y}Q{k}", [q])[0] for k, q in zip((1, 2, 3), qs))
                wq4, wfy = bk.headline(role, "Q", end), bk.headline(role, "FY", end)
                n9 = bk.fig_at(bk.resolve(reportday.BY_KEY[role])[0], "9M", f"{y}-09-30")
                if not (wq4 and wfy and n9) or wq4["alt"] or not wq4["der"] or abs(wfy["v"] * 1000 - fy) > max(1500, abs(fy) * 0.0015):
                    continue
                v = round(wq4["v"] * 1000, 4)
                thousands = any(abs(z) % 1000 for z in [fy, *qs] if z)  # tagged in NIS thousands: rounding is a few thousand, not millions
                if 1e-6 < abs(v - q4) <= (4 if thousands else 2000):  # four rounded inputs against two
                    canon.setdefault(key, {})[f"{y}Q4"] = [v, round(q4, 4), n9["rid"], n9["pg"]]
                    n += 1
    if canon:
        c["canon"] = canon
    else:
        c.pop("canon", None)
(DATA / "kpi.json").write_text(json.dumps(kpi, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(n, "headline figures now shown as printed (tag within rounding):", {k: sum(len(v) for v in c.get("canon", {}).values()) for k, c in kpi["companies"].items() if c.get("canon")})
