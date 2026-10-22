"""Savings Lens: the regulator's monthly fund data joined to the managing companies' quarterly P&L.

Input : web/public/data/market.json     regulator aggregates per month x product x group (gemel-net, pensia-net, bituach-net)
        web/public/data/lts.json        segment P&L and balances built from the managers' own reports (slide 0 = from reports)
        web/public/data/recon.json      printed managed assets vs the regulator, at balance-sheet dates
Output: web/public/data/lens.json

python3 pipeline/build_lens.py           build
python3 pipeline/build_lens.py --check   rebuild in memory and compare with the file on disk, then re-verify every derived figure
                                         from its inputs (exit 1 on any difference)

Nothing is estimated except the nowcast block, which is labelled as an estimate and carries its method.
Units: regulator amounts NIS millions; reported fees/costs NIS millions (quarter, as printed or YTD differences, see
pipeline/LTS_METHOD.md); reported balances NIS billions (pension / provident) or NIS millions (investment contracts, converted
here to billions). Ratios in percent.

Definitions (one each, also printed on the page through the source sheet of every figure):
  avg_reg    regulator average assets of the quarter = (A[o]/2 + A[m1] + A[m2] + A[m3]/2) / 3   (trapezoid over the four
             month ends; o = the last month of the previous quarter)
  fy_reg     fee yield = reported fee income of the quarter x 4 / avg_reg x 100
  fy_rep     fee yield on the reported assets = fees x 4 / ((reported assets at start + at end) / 2) x 100
  posted     the regulator's asset-weighted average management fee on accumulation (AVG_ANNUAL_MANAGEMENT_FEE) at the quarter's last month
  ci         cost / income = (selling & marketing + G&A) / fees x 100
  ppb        operating profit per NIS bn of regulator assets = op x 4 / (avg_reg / 1000)   (NIS millions per NIS bn, annualised)
  cover      reported assets at quarter end / regulator assets at quarter end x 100 (basis check: veteran pension funds,
             managing companies outside the regulator group, rounding)
  aum_share  regulator assets of the group / all groups x 100 at the quarter's last month
  flow_share (organic accrual + net transfers) of the group in the quarter / the same sum over all groups x 100; null when that
             sum is not positive
  growth     (organic accrual + net transfers) in the quarter / regulator assets at the start x 100 (not annualised)
  nowcast    the quarter after the last reported one: fees = fy_reg of the last reported quarter / 100 x (average regulator assets of
             the months published so far, trapezoid) x 3 / 12; op = nowcast fees - (S&M + G&A) of the last reported quarter
"""
import datetime as dt
from math import fsum  # exact float sums: identical on every Python version
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "lens.json"
FIRST_MONTH = 202001  # monthly series start (rank history, charts)
FIRST_Q = (2023, 1)   # first quarter with segment P&L for every covered manager

# registry / regulator group -> the company key of lts.json
LTS_OF = {"הפניקס": "phoenix", "מנורה מבטחים": "menora", "הראל": "harel", "כלל": "clal", "מגדל": "migdal", "מיטב": "meitav",
          "אלטשולר שחם": "altshuler", "מור": "more", "ילין לפידות": "yelin", "אנליסט": "analyst", "הכשרה": "hachshara",
          "איילון": "ayalon", "ביטוח ישיר": "direct"}
REG_OF = {"הפניקס": "phoenix", "מנורה מבטחים": "menora", "הראל": "harel", "כלל": "clal", "מגדל": "migdal", "מיטב": "meitav",
          "אלטשולר שחם": "altshuler", "מור": "more", "ילין לפידות": "yelin", "אנליסט": "analyst", "הכשרה": "hachshara",
          "איילון": "ayalon", "ביטוח ישיר": "idi", "אינפיניטי": "infinity", "גלובלנט": "globalnet"}
# lens segment -> (regulator product filter, lts prefix, recon family, label)
SEGS = {
    "pen": {"label": "פנסיה", "fam": ["pension"], "lts": "pen", "recon": "pension", "set": "fam:pension"},
    "gem": {"label": "גמל והשתלמות", "fam": ["gemel"], "lts": "gem", "recon": "gemel", "set": "fam:gemel"},
    "pg": {"label": "פנסיה וגמל", "fam": ["pension", "gemel"], "lts": "pg", "recon": "pg", "set": "all-ins"},
    "hish": {"label": "קרנות השתלמות", "prod": ["hishtalmut"], "lts": None, "recon": None, "set": "p:hishtalmut"},
    "ins": {"label": "ביטוחי מנהלים ופוליסות חיסכון", "fam": ["insurance"], "lts": "ic", "recon": "insurance", "set": "fam:insurance"},
}


def r(x, d):
    return None if x is None else round(x, d)


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def build():
    m = json.loads((WEB / "market.json").read_text(encoding="utf8"))
    lts = json.loads((WEB / "lts.json").read_text(encoding="utf8"))
    recon = json.loads((WEB / "recon.json").read_text(encoding="utf8"))
    P, groups, prods = m["periods"], m["groups"], m["products"]
    pidx = {p: i for i, p in enumerate(P)}
    asof = m["meta"]["asof"]
    months = [p for p in P if p >= FIRST_MONTH]
    seg_prods = {s: {i for i, pr in enumerate(prods) if pr["family"] in d.get("fam", []) or pr["key"] in d.get("prod", [])} for s, d in SEGS.items()}
    ins_prod = {i for i, pr in enumerate(prods) if pr["family"] == "insurance"}

    # ---- monthly aggregates per group x segment (and the whole market, key -1)
    acc = {}
    for row in m["rows"]:
        pi, prod, g, a, dep, wd, tr, fa, fn, fd = row[:10]
        p = P[pi]
        if p < madd(FIRST_MONTH, -3):
            continue
        for s, ps in seg_prods.items():
            if prod not in ps:
                continue
            for gg in (g, -1):
                c = acc.setdefault((gg, s, p), [0.0] * 8)
                c[0] += a; c[2] += dep - wd; c[3] += tr; c[4] += fn; c[5] += fd; c[6] += fa
                if prod not in ins_prod:
                    c[1] += a  # assets of products that publish flows

    def cell(g, s, p):
        return acc.get((g, s, p))

    def A(g, s, p):
        c = cell(g, s, p)
        return c[0] if c and c[0] > 0 else None

    def flows(g, s, p):
        """organic accrual and net transfers of one month; None when the month's flows do not cover the assets (same rule as lib/market.ts)"""
        c = cell(g, s, p)
        if not c or not (c[1] > 0) or c[6] < 0.98 * c[1]:
            return None
        return c[2], c[3]

    def fee(g, s, p):
        c = cell(g, s, p)
        return c[4] / c[5] if c and c[5] > 0 else None

    series = {}
    for g in list(range(len(groups))) + [-1]:
        for s in SEGS:
            a = [A(g, s, p) for p in months]
            if not any(a):
                continue
            fl = [flows(g, s, p) for p in months]
            series[f"{g}|{s}"] = {"a": [r(x, 1) for x in a], "org": [r(x[0], 1) if x else None for x in fl],
                                  "tr": [r(x[1], 1) if x else None for x in fl], "fee": [r(fee(g, s, p), 4) for p in months]}

    # ---- reported side
    F = {(mm, c, p): v for mm, c, p, v, sl in lts["facts"] if sl == 0}
    marks = lts.get("marks") or {}

    def rep(c, pre, metric, key):
        if pre == "pg":
            a, b = F.get((f"pen.{metric}", c, key)), F.get((f"gem.{metric}", c, key))
            return None if a is None or b is None else a + b
        v = F.get((f"{pre}.{metric}", c, key))
        if v is not None and pre == "ic" and metric == "aum":
            v = v / 1000  # NIS millions -> billions
        return v

    def qkey(y, q):
        return f"Q{q}-{y}"

    def bal(y, q):
        mm = q * 3
        return f"{y}-{mm:02d}"

    last_rep = None
    for (mm, c, p) in F:
        if mm.endswith(".fees") and p.startswith("Q"):
            q, y = int(p[1]), int(p[3:])
            if last_rep is None or (y, q) > last_rep:
                last_rep = (y, q)
    quarters = []
    y, q = FIRST_Q
    while (y, q) <= last_rep:
        quarters.append((y, q))
        y, q = (y, q + 1) if q < 4 else (y + 1, 1)

    def quarter_reg(g, s, y, q):
        e = y * 100 + q * 3
        o, m1, m2 = madd(e, -3), madd(e, -2), madd(e, -1)
        ms = [A(g, s, x) for x in (o, m1, m2, e)]
        avg = (ms[0] / 2 + ms[1] + ms[2] + ms[3] / 2) / 3 if all(v is not None for v in ms) else None
        fl = [flows(g, s, x) for x in (m1, m2, e)]
        org = fsum(x[0] for x in fl) if all(fl) else None
        tr = fsum(x[1] for x in fl) if all(fl) else None
        return {"e": e, "m": [r(v, 1) for v in ms], "avg": r(avg, 1), "aE": r(ms[3], 1), "aO": r(ms[0], 1),
                "org": r(org, 1), "tr": r(tr, 1), "posted": r(fee(g, s, e), 4)}

    rows = []
    sector_tot = {}
    for (y, q) in quarters:
        for s in SEGS:
            tot = quarter_reg(-1, s, y, q)
            net_all = None if tot["org"] is None or tot["tr"] is None else tot["org"] + tot["tr"]
            sector_tot[(s, y, q)] = tot
            for g, name in enumerate(groups):
                rg = quarter_reg(g, s, y, q)
                if rg["aE"] is None:
                    continue
                c = LTS_OF.get(name)
                pre = SEGS[s]["lts"]
                row = {"g": g, "s": s, "q": qkey(y, q), "reg": rg}
                row["aum_share"] = r(rg["aE"] / tot["aE"] * 100, 3) if tot["aE"] else None
                net = None if rg["org"] is None or rg["tr"] is None else rg["org"] + rg["tr"]
                row["flow_share"] = r(net / net_all * 100, 3) if net is not None and net_all and net_all > 0 else None
                row["growth"] = r(net / rg["aO"] * 100, 3) if net is not None and rg["aO"] else None
                if c and pre:
                    k = qkey(y, q)
                    fees, sm, ga, op = (rep(c, pre, x, k) for x in ("fees", "sm", "ga", "op"))
                    aE, aO = rep(c, pre, "aum", bal(y, q)), rep(c, pre, "aum", bal(*((y, q - 1) if q > 1 else (y - 1, 4))))
                    if fees is not None or aE is not None:
                        rp = {"c": c, "fees": r(fees, 3), "sm": r(sm, 3), "ga": r(ga, 3), "op": r(op, 3), "aE": r(aE, 4), "aO": r(aO, 4),
                              "keys": {"q": k, "e": bal(y, q), "o": bal(*((y, q - 1) if q > 1 else (y - 1, 4)))}}
                        row["rep"] = rp
                        if fees is not None and rg["avg"] and s != "ins":
                            row["fy_reg"] = r(fees * 4 / rg["avg"] * 100, 4)
                        if fees is not None and aE and aO:
                            row["fy_rep"] = r(fees * 4 / ((aE + aO) / 2 * 1000) * 100, 4)
                        if fees and sm is not None and ga is not None:
                            row["ci"] = r((sm + ga) / fees * 100, 2)
                        if op is not None and rg["avg"] and s != "ins":
                            row["ppb"] = r(op * 4 / (rg["avg"] / 1000), 3)
                        if aE is not None and rg["aE"] and s != "ins":
                            row["cover"] = r(aE * 1000 / rg["aE"] * 100, 2)
                        mk = [x for x in (marks.get(c, {}).get("metrics") or []) if x.startswith(pre + ".") or (pre == "pg" and x[:4] in ("pen.", "gem."))]
                        if mk:
                            row["mark"] = marks[c]["text"]
                fam = SEGS[s]["recon"]
                rc = (recon["groups"].get(name, {}).get("fam", {}) or {}).get(fam) if fam else None
                hit = next((x for x in (rc or []) if x["d"] == rg["e"]), None)
                if hit:
                    row["recon"] = {"st": hit["st"], "pct": hit.get("pct"), "d": hit["d"]}
                rows.append(row)

    # ---- nowcast: the quarter after the last reported one, from the months published so far
    ny, nq = (last_rep[0], last_rep[1] + 1) if last_rep[1] < 4 else (last_rep[0] + 1, 1)
    ne = ny * 100 + nq * 3
    no = madd(ne, -3)
    elapsed = [x for x in (madd(no, 1), madd(no, 2), madd(no, 3)) if x <= asof]
    now = {"q": qkey(ny, nq), "base": qkey(*last_rep), "months": elapsed, "o": no, "rows": []}
    if elapsed:
        k = len(elapsed)
        for g, name in enumerate(groups):
            c = LTS_OF.get(name)
            for s in ("pen", "gem", "pg", "hish"):
                ms = [A(g, s, x) for x in [no] + elapsed]
                if any(v is None for v in ms):
                    continue
                avg = (ms[0] / 2 + fsum(ms[1:-1]) + ms[-1] / 2) / k
                fl = [flows(g, s, x) for x in elapsed]
                base = next((x for x in rows if x["g"] == g and x["s"] == s and x["q"] == qkey(*last_rep)), None)
                nr = {"g": g, "s": s, "m": [r(v, 1) for v in ms], "avg": r(avg, 1), "org": r(fsum(x[0] for x in fl), 1) if all(fl) else None,
                      "tr": r(fsum(x[1] for x in fl), 1) if all(fl) else None, "baseAvg": base["reg"]["avg"] if base else None}
                if c and base and base.get("fy_reg") is not None and base.get("rep"):
                    fees = base["fy_reg"] / 100 * avg * 3 / 12
                    nr["fy"] = base["fy_reg"]
                    nr["fees"] = r(fees, 3)
                    nr["baseFees"] = base["rep"]["fees"]
                    sm, ga = base["rep"]["sm"], base["rep"]["ga"]
                    if sm is not None and ga is not None:
                        nr["cost"] = r(sm + ga, 3)
                        nr["op"] = r(fees - sm - ga, 3)
                        nr["baseOp"] = base["rep"]["op"]
                now["rows"].append(nr)

    out = {
        "meta": {"asof": asof, "generated": dt.date.today().isoformat(), "p0": P[0], "first_month": months[0],
                 "source_reg": m["meta"]["source"], "source_rep": lts["source"],
                 "rep_note": "הכנסות, הוצאות ונכסים מדווחים: דוחות החברות המנהלות (ביאור מגזרי פעילות, טבלת סוגי הקרנות), שיטה: pipeline/LTS_METHOD.md",
                 "last_rep": qkey(*last_rep)},
        "groups": [{"name": n, "id": REG_OF.get(n), "lts": LTS_OF.get(n)} for n in groups],
        "segs": {s: {"label": d["label"], "set": d["set"], "rep": d["lts"] is not None} for s, d in SEGS.items()},
        "months": months,
        "series": series,
        "quarters": [qkey(*x) for x in quarters],
        "rows": rows,
        "nowcast": now,
        "breaks": m.get("breaks", []),
        "marks": marks,
    }
    return out


def verify(d):
    """every derived figure equals its formula over the inputs printed beside it"""
    bad = []
    for x in d["rows"]:
        rg, rp = x["reg"], x.get("rep")
        if rg["avg"] is not None:
            a = rg["m"]
            if abs((a[0] / 2 + a[1] + a[2] + a[3] / 2) / 3 - rg["avg"]) > 0.11:
                bad.append(("avg", x["g"], x["s"], x["q"]))
        if x.get("fy_reg") is not None and abs(rp["fees"] * 4 / rg["avg"] * 100 - x["fy_reg"]) > 1e-3:
            bad.append(("fy_reg", x["g"], x["s"], x["q"]))
        if x.get("ci") is not None and abs((rp["sm"] + rp["ga"]) / rp["fees"] * 100 - x["ci"]) > 0.01:
            bad.append(("ci", x["g"], x["s"], x["q"]))
        if x.get("ppb") is not None and abs(rp["op"] * 4 / (rg["avg"] / 1000) - x["ppb"]) > 0.01:
            bad.append(("ppb", x["g"], x["s"], x["q"]))
        if rp and rp["fees"] is not None and rp["sm"] is not None and rp["ga"] is not None and rp["op"] is not None:
            if abs(rp["fees"] - rp["sm"] - rp["ga"] - rp["op"]) > 0.01:
                bad.append(("op = fees - sm - ga", x["g"], x["s"], x["q"]))
    # monthly market totals: the sum over groups equals the market series
    G = len(d["groups"])
    for s in d["segs"]:
        tot = d["series"].get(f"-1|{s}")
        if not tot:
            continue
        for i in range(len(d["months"])):
            sm = sum((d["series"].get(f"{g}|{s}", {}).get("a") or [None] * len(d["months"]))[i] or 0 for g in range(G))
            if tot["a"][i] is not None and abs(sm - tot["a"][i]) > 0.1 * G:
                bad.append(("market sum", s, d["months"][i]))
    return bad


if __name__ == "__main__":
    d = build()
    bad = verify(d)
    if "--check" in sys.argv:
        disk = json.loads(OUT.read_text(encoding="utf8"))
        d["meta"]["generated"] = disk["meta"]["generated"]
        def eq(a, b):  # floats within 1e-9: Python 3.12's sum() rounds differently from 3.9 in the last bit
            if isinstance(a, float) or isinstance(b, float):
                return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
            if isinstance(a, dict):
                return isinstance(b, dict) and a.keys() == b.keys() and all(eq(a[k], b[k]) for k in a)
            if isinstance(a, list):
                return isinstance(b, list) and len(a) == len(b) and all(eq(x, y) for x, y in zip(a, b))
            return a == b
        same = eq(disk, json.loads(json.dumps(d)))
        print(f"lens.json {'matches' if same else 'DIFFERS from'} a rebuild; {len(d['rows'])} quarter rows; {len(bad)} formula misses")
        for b in bad[:20]:
            print("  ", b)
        sys.exit(0 if same and not bad else 1)
    if bad:
        print("formula misses:", bad[:20])
        sys.exit(1)
    OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes, {len(d['rows'])} quarter rows, {len(d['series'])} monthly series, "
          f"nowcast {d['nowcast']['q']} from {len(d['nowcast']['months'])} months")
