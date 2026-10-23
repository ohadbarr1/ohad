"""Report-day (T+0) skeleton: the XBRL instance of a new periodic report lands in kpi.json the moment it exists, unverified.

python3 pipeline/autopilot/t0.py            # dry run: what would change in kpi.json
python3 pipeline/autopilot/t0.py --apply    # write kpi.json (also called from build_kpi.py and run.py)

Input: data/registry/xbrl_facts.json (pipeline/fetch_xbrl.py --registry; one entry per instance, 26 ת930 concepts as tagged).
Two things happen to kpi.json:
  1. ext: every period already there gets the skeleton's extra concepts (fetch_xbrl.T0_KPI beyond build_kpi.py's eight: profit incl.
     minorities, minorities' share, total comprehensive income, diluted EPS, operating profit, investing/financing cash flows, total
     equity, minorities, liabilities), from the same report id as the period, following the period's own correction (fix): a
     year-to-date tag differenced back to the quarter, a tag known wrong left empty. build_kpi.py's eight values are never touched.
  2. new: a period the instance covers and kpi.json does not have is added with all 19 values, status "unverified" (FY too), and
     companies.<id>.t0[period] = {rid, pub, how, added}. A verified period is never overwritten; an unverified one only by a later
     report id (an amendment).
Then verify(): a T+0 period whose profit agrees with the printed figure of the same report (statements workbook lines.json, the
income-statement reading kpi_windows.json, or the capital series) within rounding becomes "verified" ("fy" for a year), and its t0
entry records by what. A disagreement is recorded as t0[period].conflict and the period stays unverified.

The ת930 form's contexts always say "three months" for a quarter, yet several filers put year-to-date figures in them (kpi.json notes:
Menora, Clal, Hachshara, Ayalon … in Q2/Q3). A new quarter therefore follows the filer's habit for the same quarter: if the last two
reported Q2s (or Q3s) were year-to-date tags, the new one is differenced back (fix t "diff", basis "habit"); a filer with a
year-to-date history but no evidence for that quarter gets its flows withheld, never a guess. Per-share figures are never differenced.
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Paths, read_json, write_json  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fetch_xbrl as fx  # noqa: E402

KEYS = fx.T0_KPI
CORE = ["profit", "oci", "pretax", "revenue", "cfo", "eps", "equity", "assets"]  # build_kpi.py's own
EXT = [k for k in KEYS if k not in CORE]
KIND = {k: fx.T0_ALL[k][1] for k in KEYS}
PS = {k for k in KEYS if fx.T0_ALL[k][2] == "ps"}
FLOWS = {k for k in KEYS if KIND[k] == "flow"}


def period_of(rec):
    end = dt.date.fromisoformat(rec["e"])
    q = 4 if rec["dt"] == "annual" else end.month // 3
    return f"{end.year}FY" if q == 4 else f"{end.year}Q{q}"


def by_period(reg, comp):
    """{period: (rid, rec)}: the later report id wins (an amendment or a re-filing)."""
    out = {}
    for rid, rec in reg.get("reports", {}).items():
        if rec["c"] != comp:
            continue
        p = period_of(rec)
        if p not in out or int(rid) > out[p][0]:
            out[p] = (int(rid), rec)
    return out


def scaled(k, v):
    return None if v is None else (v if k in PS else v / 1000)  # kpi.json: NIS thousands, per-share in NIS


def near(a, b):
    return a is not None and b is not None and abs(a - b) <= max(1500, abs(b) * 0.002)


def ytd_habit(c, period):
    """How the filer tagged this quarter slot before: 'ytd', 'q', or None (no evidence). From kpi.json's own fixes (build_kpi.py decided
    those against the printed figures): a 'diff' fix is a year-to-date tag; a verified quarter is a quarter tag."""
    slot = period[4:]
    if slot in ("Q1", "FY"):
        return "q"
    seen = []
    for i, p in enumerate(c.get("periods", [])):
        if p[4:] != slot or p >= period:
            continue
        f = (c.get("fix") or {}).get(p, {})
        st = c["status"][i]
        if f.get("t") == "diff":
            seen.append("ytd")
        elif st == "verified" or (st == "corrected" and f.get("t") == "printed"):
            seen.append("q")
    last = seen[-2:]
    if len(last) == 2 and last[0] == last[1]:
        return last[0]
    return last[-1] if len(last) == 1 else None


def cumulative_filer(kpi, comp):
    return any(n.get("company") == comp and n.get("corrected") for n in kpi.get("notes", []))


def values_for(rec, period, how, prior):
    """The 19 values of one instance as kpi.json stores them. how: 'q' (tags are the period), 'ytd' (difference back to the quarter with
    `prior` = {key: [earlier quarters' values]}), 'withheld' (flows left empty)."""
    out = {}
    for k in KEYS:
        v = scaled(k, rec["v"].get(k))
        if KIND[k] == "inst" or how == "q":
            out[k] = v
        elif how == "ytd":
            prev = prior.get(k) or []
            out[k] = None if (k in PS or v is None or not prev or any(x is None for x in prev)) else v - sum(prev)
        else:
            out[k] = None
    return out


def _index(c):
    return {p: i for i, p in enumerate(c.get("periods", []))}


def merge(kpi, reg, today=None, only=None, log=print):
    """Fill ext values and add T+0 periods (see the module doc). Mutates kpi; returns {"new": [...], "replaced": [...], "ext": n}."""
    today = (today or dt.date.today()).isoformat()
    kpi.setdefault("concepts", {}).update({k: fx.T0_ALL[k][0] for k in KEYS})
    kpi["t0_note"] = ("ext/new: XBRL (טופס ת930) של הדוח, ביום פרסומו; תקופה חדשה מסומנת unverified עד שהנתון המודפס של אותו דוח מתאים")
    comps = sorted({x["c"] for x in reg.get("reports", {}).values()} | set(kpi.get("companies", {})))
    out = {"new": [], "replaced": [], "ext": 0, "withheld": []}
    for comp in comps:
        if only and comp not in only:
            continue
        recs = by_period(reg, comp)
        if not recs:
            continue
        c = kpi.setdefault("companies", {}).setdefault(comp, {"periods": [], "end": [], "status": [], "values": {}, "rid": [], "fix": {}})
        n = len(c["periods"])
        for k in KEYS:
            c["values"].setdefault(k, [None] * n)
        c.setdefault("rid", [None] * n)
        c.setdefault("fix", {})
        idx = _index(c)
        # 1. ext values for the periods already there, in date order so a difference can use the quarter before it
        order = sorted(idx, key=lambda p: (c["end"][idx[p]], p))
        for p in order:
            i = idx[p]
            rid = c["rid"][i]
            hit = recs.get(p)
            if not hit or hit[0] != rid:
                continue
            f = c["fix"].get(p, {})
            how = "withheld" if c["status"][i] == "withheld" or f.get("t") in ("printed", "withheld") or f.get("gap") else ("ytd" if f.get("t") == "diff" else "q")
            prior = {k: [c["values"][k][idx[q]] if q in idx else None for q in f.get("from", [])] for k in EXT}
            vals = values_for(hit[1], p, how, prior)
            for k in EXT:
                if c["values"][k][i] is None and vals[k] is not None:
                    c["values"][k][i] = vals[k]
                    out["ext"] += 1
        # 2. T+0 periods
        t0 = c.setdefault("t0", {})
        for p, (rid, rec) in sorted(recs.items(), key=lambda kv: (kv[1][1]["e"], kv[0])):
            i = idx.get(p)
            if i is not None:
                own = p in t0
                fresh = rec.get("pub") and (dt.date.fromisoformat(today) - dt.date.fromisoformat(rec["pub"])).days <= 120
                if not own and fresh and c["status"][i] == "unverified" and c["rid"][i] == rid and p == c["periods"][-1]:
                    t0[p] = {"rid": rid, "pub": rec.get("pub"), "how": "kpi", "added": today}  # build_kpi.py made it from the warehouse
                    continue
                if c["status"][i] != "unverified" or not own or rid <= (c["rid"][i] or 0):
                    continue  # never overwrite a verified (or build_kpi-made) period; an own unverified one only by a later report
            y, slot = int(p[:4]), p[4:]
            how = "q"
            if slot in ("Q2", "Q3"):
                habit = ytd_habit(c, p)
                how = habit or ("withheld" if cumulative_filer(kpi, comp) else "q")
            earlier = [f"{y}Q{k}" for k in range(1, int(slot[1]))] if slot in ("Q2", "Q3") else []
            prior = {k: [c["values"][k][idx[q]] if q in idx else None for q in earlier] for k in KEYS}
            vals = values_for(rec, p, how, prior)
            entry = {"rid": rid, "pub": rec.get("pub"), "how": how, "added": today}
            if i is None:
                c["periods"].append(p)
                c["end"].append(rec["e"])
                c["status"].append("unverified")
                c["rid"].append(rid)
                for k in KEYS:
                    c["values"][k].append(vals[k])
                for k in c["values"]:
                    if k not in KEYS:
                        c["values"][k].append(None)
                idx[p] = len(c["periods"]) - 1
                out["new"].append([comp, p, rid])
            else:
                c["rid"][i] = rid
                for k in KEYS:
                    c["values"][k][i] = vals[k]
                out["replaced"].append([comp, p, rid])
            if how == "ytd":
                c["fix"][p] = {"t": "diff", "raw": scaled("profit", rec["v"].get("profit")), "from": earlier, "basis": "habit"}
            elif how == "withheld":
                c["fix"][p] = {"t": "withheld", "basis": "t0"}
                out["withheld"].append([comp, p])
            t0[p] = entry
            log(f"T+0 {comp} {p}: rid {rid}, {how}")
        if not t0:
            c.pop("t0", None)
        _sort(c)
    return out


def _sort(c):
    order = sorted(range(len(c["periods"])), key=lambda i: (c["end"][i], c["periods"][i]))
    if order == list(range(len(order))):
        return
    for key in ("periods", "end", "status", "rid"):
        if key in c:
            c[key] = [c[key][i] for i in order]
    for k in c["values"]:
        c["values"][k] = [c["values"][k][i] for i in order]


def truth(paths):
    """Printed profit attributable to shareholders, by (company, period): [(value NIS thousands, report id, page, source)]."""
    import re
    out = {}
    rid_of = lambda u: int(m.group(1)) if u and (m := re.search(r"P(\d+)-\d+\.pdf", u)) else None  # noqa: E731
    lines = read_json(paths.data / "lines.json")
    if lines and "np_attr" in lines.get("data", {}):
        per = lines["periods"]
        for comp, row in lines["data"]["np_attr"].items():
            for pi, v, pg, ui, *_ in row["cells"]:
                typ, end = per[pi]
                if typ not in ("Q", "FY") or v is None:
                    continue
                p = f"{end[:4]}FY" if typ == "FY" else f"{end[:4]}Q{int(end[5:7]) // 3}"
                out.setdefault((comp, p), []).append((v, rid_of(lines["urls"][ui]) if ui is not None else None, pg, "lines"))
    win = read_json(paths.registry / "kpi_windows.json", {})
    for comp, pers in {**win, **{k: v for k, v in (read_json(paths.registry / "kpi_windows_manual.json", {}) or {}).items() if not k.startswith("_")}}.items():
        for p, h in pers.items():
            if h.get("check") in ("arithmetic", "manual") and h.get("q") is not None:
                out.setdefault((comp, p), []).append((h["q"], h.get("report_id"), h.get("page"), "windows"))
    cap = read_json(paths.data / "csm" / "capital.json")
    for comp, ms in (cap or {}).get("companies", {}).items():
        for p, x in ms.get("profit_attributable", {}).items():
            if x.get("v") is not None and not p.endswith("Q4"):
                out.setdefault((comp, p), []).append((x["v"] * 1000, rid_of(x.get("u")), x.get("pg"), "capital"))
    return out


def verify(kpi, paths, log=print):
    """Promote T+0 periods whose profit equals the printed figure of the same report. Returns [(company, period, source)]."""
    tr = truth(paths)
    done = []
    for comp, c in kpi.get("companies", {}).items():
        for p, e in list((c.get("t0") or {}).items()):
            if "verified" in e:
                continue
            i = c["periods"].index(p) if p in c["periods"] else None
            if i is None:
                continue
            v = c["values"]["profit"][i]
            hits = [h for h in tr.get((comp, p), []) if h[1] == e["rid"]]
            ok = next((h for h in hits if near(v, h[0])), None)
            if ok:
                c["status"][i] = "fy" if p.endswith("FY") else "verified"
                e["verified"] = {"by": ok[3], "rid": ok[1], "pg": ok[2], "v": ok[0]}
                e.pop("conflict", None)
                done.append((comp, p, ok[3]))
                log(f"verified {comp} {p} against {ok[3]} (page {ok[2]})")
            elif hits:
                e["conflict"] = {"by": hits[0][3], "rid": hits[0][1], "pg": hits[0][2], "printed": hits[0][0], "tagged": v}
    return done


def run(paths, apply=False, today=None, log=print):
    reg = read_json(paths.xbrl_facts)
    kpi = read_json(paths.kpi)
    if not reg or not kpi:
        log("t0: nothing to do (no xbrl_facts.json or kpi.json)")
        return {"new": [], "replaced": [], "ext": 0, "verified": []}
    res = merge(kpi, reg, today=today, log=log)
    res["verified"] = verify(kpi, paths, log=log)
    if apply:
        paths.kpi.write_text(json.dumps(kpi, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"t0 {'applied' if apply else 'dry run'}: {len(res['new'])} new periods, {len(res['replaced'])} replaced, {res['ext']} ext values, "
        f"{len(res['verified'])} verified")
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="T+0 XBRL skeleton -> kpi.json")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--root")
    a = ap.parse_args()
    run(Paths(a.root), apply=a.apply)
