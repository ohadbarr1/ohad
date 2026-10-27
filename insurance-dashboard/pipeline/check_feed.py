"""QA of the delta feed (web/public/data/feed.json, pipeline/build_feed.py): gate check `feed`.

python3 pipeline/check_feed.py [--quiet]      standard library only; reads the published files; exit 1 on any problem

Every event has a date, a type, a company and a source; no event appears twice (by id, nor by type + company + period + source + headline);
the type counts add up and the estimate slot stays empty. Every figure is re-read from the file it cites:
  pg     the (report, page, value) is printed in a published file that carries pages: a company workbook (companies/<id>.json; a
         derived Q4 is the workbook's own derived figure), a report card fact, the restatement log (both prints) or targets.json
         (the target and every input of its actual); the report is listed in `docs`
  reg    the month index and group index point at the same month and group in market.json, and the value equals the aggregate
         rebuilt with the arithmetic of lib/market.ts (build_feed.Reg)
  fund   the value equals the track's published month (funds/<k>.json)
  calc   every input is itself a valid figure, and a difference or a ratio re-computes from its two inputs
  count  a whole number
"""
import collections
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_feed as bf  # noqa: E402
import reportday as rd  # noqa: E402

DATA = bf.DATA
UNITS = {"m", "bn", "pct", "pp", "dm", "dbn", "dpct", "n"}
DK = {"pub", "fetched", "month"}
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def key(rid, page, v):
    return (int(rid), page, round(v, 2))


def printed_index():
    """(report id, page, value rounded to 0.01) of every figure the site publishes with a page."""
    ix = set()
    for f in sorted((DATA / "companies").glob("*.json")):
        if f.name.count(".") != 1 or f.stem == "index":
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        rids = [rd.rid_of(u) for u in d.get("urls") or []]
        units = [m.get("unit") for m in d["metrics"]]
        for x in d["facts"]:
            if len(x) > 4 and x[4] is not None and x[4] < len(rids) and rids[x[4]]:
                v = x[2] / 1000 if units[x[0]] == "k" else x[2]
                ix.add(key(rids[x[4]], x[3], v))
    for c in (DATA / "cards").iterdir():
        if not c.is_dir():
            continue
        for p in c.glob("*.json"):
            d = json.loads(p.read_text(encoding="utf-8"))
            for fct in d["f"].values():
                s = fct.get("s") or {}
                if s.get("k") == "pg" and s.get("u") is not None:
                    r = rd.rid_of(d["u"][s["u"]])
                    if r and fct.get("v") is not None:
                        ix.add(key(r, s.get("pg"), fct["v"]))
    R = bf.load("restatements.json")
    for r in R["rows"]:
        x = dict(zip(R["cols"], r))
        k = 1000 if x["u"] == "k" else 1
        for v, d_, p_ in ((x["v0"], x["d0"], x["p0"]), (x["v1"], x["d1"], x["p1"])):
            if d_ is not None:
                ix.add(key(d_, p_, v / k))
    T = bf.load("targets.json")
    for t in T["rows"]:
        for v in (t.get("v"), t.get("lo"), t.get("hi")):
            if v is not None and t.get("doc"):
                ix.add(key(t["doc"], t.get("pg"), v))
        for x in (t.get("act") or {}).get("in") or []:
            r = rd.rid_of(x[2])
            if r and x[1] is not None:
                ix.add(key(r, x[3], x[1]))
    S = bf.load("csm/solvency.json")
    for by in S["companies"].values():
        for e in by.values():
            for x in e.values():
                if isinstance(x, dict) and x.get("r") and x.get("v") is not None:
                    ix.add(key(x["r"], x.get("pg"), x["v"]))
    return ix


def run(quiet=False):
    F = bf.load("feed.json")
    reg = bf.Reg()
    ix = printed_index()
    probs = []
    fund_cache = {}
    n_fig = 0

    def bad(eid, msg):
        probs.append(f"{eid}: {msg}")

    def fund_v(ds, id_, ym, col):
        k = bf.TK[ds] + str(id_)
        if k not in fund_cache:
            p = DATA / "funds" / f"{k}.json"
            fund_cache[k] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
        h = fund_cache[k]
        if not h or ym not in h["p"]:
            return None
        c = {"AVG_ANNUAL_MANAGEMENT_FEE": "fee", "TOTAL_ASSETS": "a"}[col]
        return h[c][h["p"].index(ym)]

    def check_fig(eid, f, where):
        nonlocal n_fig
        n_fig += 1
        if not isinstance(f, dict) or not isinstance(f.get("v"), (int, float)) or f.get("u") not in UNITS or not isinstance(f.get("s"), dict):
            return bad(eid, f"{where}: figure without value, unit or source")
        s, v = f["s"], f["v"]
        k = s.get("k")
        if k == "pg":
            if str(s.get("rid")) not in F["docs"]:
                return bad(eid, f"{where}: report {s.get('rid')} not in docs")
            if not isinstance(s.get("pg"), int):
                return bad(eid, f"{where}: no page")
            if key(s["rid"], s["pg"], v) not in ix:
                return bad(eid, f"{where}: {v} not found on report {s['rid']} page {s['pg']} in any published file")
        elif k == "reg":
            pi, g = s.get("pi"), s.get("g")
            if not isinstance(pi, int) or pi >= len(reg.P) or reg.P[pi] != s.get("ym") or not (g == -1 or 0 <= g < len(reg.G)):
                return bad(eid, f"{where}: regulator month or group index does not match market.json")
            want = reg.assets(pi, s["set"], g) if s["metric"] == "assets" else reg.netflow(pi, s["w"], s["set"], g) if s["metric"] == "netflow" else None
            if want is None or abs(want - v) > 1e-5:
                return bad(eid, f"{where}: {v} vs market.json aggregate {want}")
        elif k == "fund":
            want = fund_v(s.get("ds"), s.get("id"), s.get("ym"), s.get("col"))
            if want is None or abs(want - v) > 1e-9:
                return bad(eid, f"{where}: {v} vs funds file {want}")
        elif k == "calc":
            ins = s.get("in") or []
            if not ins or not s.get("fx"):
                return bad(eid, f"{where}: calculation without inputs or formula")
            for i, x in enumerate(ins):
                check_fig(eid, x, f"{where}.in{i}")
            if len(ins) == 2 and " − " in s["fx"] and "÷" not in s["fx"]:
                if abs(ins[0]["v"] - ins[1]["v"] - v) > 1e-5:
                    bad(eid, f"{where}: difference does not re-compute")
            elif len(ins) == 2 and s["fx"].endswith("− 1") and "÷" in s["fx"]:
                if abs((ins[0]["v"] / ins[1]["v"] - 1) * 100 - v) > 1e-4:
                    bad(eid, f"{where}: ratio does not re-compute")
        elif k == "count":
            if v != int(v) or v < 0:
                bad(eid, f"{where}: count is not a whole number")
        else:
            bad(eid, f"{where}: unknown source kind {k!r}")

    ids, content = collections.Counter(), collections.Counter()
    counts = collections.Counter()
    for e in F["events"]:
        eid = e.get("id", "?")
        ids[eid] += 1
        counts[e.get("t")] += 1
        if e.get("t") not in F["types"]:
            bad(eid, f"unknown type {e.get('t')!r}")
        if not ISO.match(e.get("d") or "") or e.get("dk") not in DK:
            bad(eid, "no date, or no date kind")
        if e.get("c") not in F["cos"]:
            bad(eid, f"company {e.get('c')!r} not in cos")
        src = e.get("src") or {}
        if src.get("k") == "doc":
            if str(src.get("rid")) not in F["docs"]:
                bad(eid, f"source report {src.get('rid')} not in docs")
        elif src.get("k") == "reg":
            if src.get("ym") not in reg.P:
                bad(eid, f"source month {src.get('ym')} not in market.json")
        elif src.get("k") == "fund":
            if not (DATA / "funds" / f"{bf.TK.get(src.get('ds'), '?')}{src.get('id')}.json").exists():
                bad(eid, "source track file missing")
        else:
            bad(eid, "no source")
        content[(e.get("t"), e.get("c"), e.get("per"), json.dumps(src, sort_keys=True), e.get("h"))] += 1
        for i, r in enumerate(e.get("rows") or []):
            for part in ("a", "b", "d", "dp"):
                if part in r:
                    check_fig(eid, r[part], f"row{i}.{part}")
            if "a" not in r:
                bad(eid, f"row{i}: no figure")
        for x in e.get("refs") or []:
            if x not in ids and not any(y.get("id") == x for y in F["events"]):
                bad(eid, f"reference {x} to no event")
    probs += [f"{k}: duplicate id ({n})" for k, n in ids.items() if n > 1]
    probs += [f"{k[0]} {k[1]} {k[2]}: duplicate event ({n})" for k, n in content.items() if n > 1]
    for t, x in F["types"].items():
        if x["n"] != counts.get(t, 0):
            probs.append(f"types.{t}: n {x['n']} vs {counts.get(t, 0)} events")
    if F["types"].get("est", {}).get("n") or counts.get("est"):
        probs.append("est: the estimate slot carries events (module M1 fills it; nothing may be emitted before)")
    for p in probs[:20]:
        print("FAIL", p)
    summary = f"{len(F['events'])} events, {n_fig} figures, {len(probs)} problems"
    if not quiet or probs:
        print(summary)
    return len(F["events"]), n_fig, probs, summary


if __name__ == "__main__":
    _, _, probs, _ = run("--quiet" in sys.argv)
    sys.exit(1 if probs else 0)
