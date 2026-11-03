"""Fee-book embedded value (wave 11, /feebook): what the management fees on today's book are worth, per manager x product, with every
assumption visible and editable on the page. The pipeline writes the base case; the page recomputes with the same formula
(web/src/lib/feebook.ts evBook, parity checked by web/scripts/feebook-test.mjs against this file).

python3 pipeline/build_feebook.py           write web/public/data/feebook.json
python3 pipeline/build_feebook.py --check   rebuild in memory, compare with the file on disk and re-verify every EV from its inputs (exit 1 on a miss)

Inputs (published files of this repo, free public data only):
  web/public/data/market.json        regulator month-end assets and Σ assets x management fee per month x product x group (gemel-net, pensia-net)
  web/public/data/flows/<prod>.json  regulator withdrawals and net transfers per group x product x month (build_flows.py)
  web/public/data/lens.json          reported segment fees, selling & marketing, G&A per manager x segment x quarter (lts.json, report pages)
  web/public/data/funds/default.json the default-fund tenders: the winners' accumulation fee (the pension floor) and its source
  web/public/data/csm/summary.json   the insurers' CSM by date (csm_resolve.py rule) and csm/facts/<c>.json (its report page)

Method (version METHOD; each ASSUMPTION is printed on the page and editable there):
  AUM_0      regulator assets of the group x product at the latest month (NIS m)
  fee_0      the asset-weighted average management fee on accumulation at that month = Σ assets x fee / Σ assets with a fee (%, a year)
  trend      OLS slope of the monthly asset-weighted fee over the last WIN months x 12 (pp a year). ASSUMPTION: a rising trend is not
             projected (erosion = min(0, trend)); fee_t = max(floor_eff, fee_0 + erosion x (t - 1)), floor_eff = min(fee_0, floor)
  floor      pension (comprehensive and general): the latest default-fund tender's accumulation fee (funds/default.json, its source);
             other products: none (0). ASSUMPTION: competition does not price the book below the regulated default price
  survival   1 - outflow rate; outflow rate = Σ_{WIN months} (withdrawals + max(0, -net transfers)) / (WIN / 12) / mean month-end assets,
             group x product, regulator. LIMIT: the regulator publishes net transfers only, so gross transfers out are understated where a
             manager also takes transfers in (survival overstated for net winners)
  cost ratio (S&M + G&A) / fees of the manager's reported segment (pension -> pen, the rest -> gem), the last four printed quarters summed.
             No reported segment costs -> cost ratio null and EV null (never assumed). A "G&A only" basis is written beside it (the page's
             toggle: a run-off book pays no acquisition costs; trail commissions sit in S&M for some managers, so it is a bound, not a fact)
  EV         Σ_{t=1..H} AUM_0 x [survival x (1 + growth)]^(t-1) x fee_t / 100 x (1 - cost ratio) / (1 + r)^t: the fee on the opening balance
             of each year, received at its end. ASSUMPTIONS: r = DISC nominal, growth (investment return on the book) = GROWTH, H = HORIZON
             years; no new deposits and no deposit fees (those are new business, not the book); no tax
  cross-check insurers: CSM (csm_resolve rule, group or life+health, net where printed) / regulator insurance-family assets (managers'
             insurance and savings policies, bituach-net) at the CSM date. CSM covers risk and health business too: an upper bound for
             the savings margin, not a like-for-like comparison
Units: NIS millions; fees and rates percent.
"""
import json
import sys
from math import fsum
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public" / "data"
OUT = WEB / "feebook.json"

METHOD = "fb1.0"
DISC = 8.0          # % nominal, ASSUMPTION
GROWTH = 0.0        # % a year, investment return on the book, ASSUMPTION (the formula as specified: no growth)
HORIZON = 30        # years
WIN = 36            # months of trend and outflow history
MIN_AUM = 10.0      # NIS m: smaller cells are listed in the count but not valued
GRID_R = [6.0, 7.0, 8.0, 9.0, 10.0, 12.0]
GRID_S = [-3.0, -2.0, -1.0, 0.0, 1.0, 2.0]   # survival shift, pp
OTHERS = "קרנות ענפיות ואחרות"
PRODS = {  # market product key -> flows file, lens segment, floor applies
    "pension_new": ("pm", "pen", True), "pension_general": ("pk", "pen", True), "gemel": ("gm", "gem", False), "hishtalmut": ("hs", "gem", False),
    "gemel_invest": ("gl", "gem", False), "gemel_child": ("ch", "gem", False), "severance": ("mp", "gem", False), "other_purpose": ("go", "gem", False),
}


def r(x, d=4):
    return None if x is None else round(x, d)


def madd(p, k):
    t = (p // 100) * 12 + (p % 100 - 1) + k
    return (t // 12) * 100 + t % 12 + 1


def ols_slope(ys):
    n = len(ys)
    mx, my = (n - 1) / 2, fsum(ys) / n
    den = fsum((x - mx) ** 2 for x in range(n))
    return fsum((x - mx) * (y - my) for x, y in zip(range(n), ys)) / den if den else 0.0


def ev_book(aum, fee, eros, floor, surv, ci, disc, growth, horizon):
    """the one formula (mirrored in web/src/lib/feebook.ts evBook): PV of the book's net fee stream, NIS m"""
    if ci is None or surv is None or fee is None or aum is None:
        return None
    fl = max(0.0, min(fee, floor)) if floor is not None else 0.0
    k, bal, parts = 1 + disc / 100, aum, []
    for t in range(1, horizon + 1):
        f = max(fl, fee + eros * (t - 1))
        parts.append(bal * f / 100 * (1 - ci) / k ** t)
        bal *= surv * (1 + growth / 100)
    return fsum(parts)


def build():
    m = json.loads((WEB / "market.json").read_text(encoding="utf-8"))
    lens = json.loads((WEB / "lens.json").read_text(encoding="utf-8"))
    dflt = json.loads((WEB / "funds" / "default.json").read_text(encoding="utf-8"))
    csm = json.loads((WEB / "csm" / "summary.json").read_text(encoding="utf-8"))
    P, groups, prods = m["periods"], m["groups"], m["products"]
    asof = m["meta"]["asof"]
    assert [g["name"] for g in lens["groups"]] == groups, "lens groups and market groups differ"
    pk = {p["key"]: i for i, p in enumerate(prods)}
    pidx = {p: i for i, p in enumerate(P)}
    months = [madd(asof, -k) for k in range(WIN - 1, -1, -1)]
    cell = {}
    for row in m["rows"]:
        pi, pr, g, a, dep, wd, tr, fa, fn, fd = row[:10]
        x = cell.setdefault((P[pi], pr, g), [[], [], []])
        x[0].append(a), x[1].append(fn), x[2].append(fd)
    cell = {k: tuple(fsum(v) for v in x) for k, x in cell.items()}
    fam_ins = {i for i, p in enumerate(prods) if p["family"] == "insurance"}

    # the pension floor: the latest tender in force with a published accumulation fee
    asof_day = f"{asof // 100}-{asof % 100:02d}-28"
    tenders = [t for t in dflt["tenders"] if t.get("fee") is not None and t["from"] <= asof_day]
    tn = max(tenders, key=lambda t: t["from"]) if tenders else None
    floor = {"fee": tn["fee"], "depfee": tn.get("depfee"), "tender": tn["id"], "from": tn["from"], "to": tn["to"], "src": tn.get("src"),
             "src_title": tn.get("src_title"), "verified": tn.get("verified")} if tn else None

    # reported costs: the last four printed quarters of each manager x segment (all four needed)
    lr = lens["meta"]["last_rep"]
    qs = lens["quarters"][: lens["quarters"].index(lr) + 1][-4:]
    rows_l = {(x["g"], x["s"], x["q"]): x for x in lens["rows"]}

    def costs(g, s):
        rr = [rows_l.get((g, s, q)) for q in qs]
        if not all(x and x.get("rep") and x["rep"].get("fees") and x["rep"].get("sm") is not None and x["rep"].get("ga") is not None for x in rr):
            have = [q for q, x in zip(qs, rr) if x and x.get("rep") and x["rep"].get("fees")]
            return None, ("הדוחות אינם מפרסמים הכנסות והוצאות למגזר" if not have else f"חסרים הוצאות או הכנסות במגזר ב-{4 - len(have)} מ-4 הרבעונים")
        fees = fsum(x["rep"]["fees"] for x in rr)
        sm = fsum(x["rep"]["sm"] for x in rr)
        ga = fsum(x["rep"]["ga"] for x in rr)
        return {"q": qs, "fees": r(fees, 3), "sm": r(sm, 3), "ga": r(ga, 3), "ci": r((sm + ga) / fees, 6), "ci_ga": r(ga / fees, 6),
                "parts": [{"q": q, "fees": x["rep"]["fees"], "sm": x["rep"]["sm"], "ga": x["rep"]["ga"]} for q, x in zip(qs, rr)]}, None

    flows = {pid: json.loads((WEB / "flows" / f"{fid}.json").read_text(encoding="utf-8")) for pid, (fid, _, _) in PRODS.items()}
    out_rows, mgrs = [], []
    for gi, gname in enumerate(groups):
        if gname == OTHERS:
            continue
        lg = lens["groups"][gi]
        cid = lg["id"]
        seg_cost = {s: costs(gi, s) if lg["lts"] else (None, "אין לקבוצה דוח מגזרי באתר") for s in ("pen", "gem")}
        mrows = []
        for pkey, (fid, seg, has_floor) in PRODS.items():
            pi = pk[pkey]
            c0 = cell.get((asof, pi, gi))
            if not c0 or not c0[0]:
                continue
            a0, fn0, fd0 = c0
            row = {"g": gi, "c": cid, "p": pkey, "fid": fid, "seg": seg, "aum": r(a0, 1), "pi": pidx[asof]}
            if a0 < MIN_AUM or not fd0:
                row["skip"] = "נכסים מתחת ל-10 מיליון ש\"ח" if a0 < MIN_AUM else "אין דמי ניהול מפורסמים"
                mrows.append(row)
                continue
            fees = []
            for p in months:
                x = cell.get((p, pi, gi))
                fees.append(x[1] / x[2] if x and x[2] else None)
            ser = [f for f in fees if f is not None]
            trend = ols_slope(ser) * 12 if len(ser) >= 24 and fees[-1] is not None else None
            fl = flows[pkey]["groups"].get(gname)
            out = None
            if fl:
                fm = flows[pkey]["months"]
                ix = [fm.index(p) for p in months if p in fm]
                a = [fl["a"][i] for i in ix]
                wd = [fl["wd"][i] for i in ix]
                tr = [fl["tr"][i] for i in ix]
                ok = [k for k in range(len(ix)) if a[k] is not None and wd[k] is not None and tr[k] is not None]
                if len(ok) >= WIN - 6:
                    swd = fsum(wd[k] for k in ok)
                    sto = fsum(max(0.0, -tr[k]) for k in ok)
                    avg = fsum(a[k] for k in ok) / len(ok)
                    rate = (swd + sto) / (len(ok) / 12) / avg * 100 if avg > 0 else None
                    out = {"wd": r(swd, 1), "tro": r(sto, 1), "avg": r(avg, 1), "n": len(ok), "from": months[0], "to": months[-1], "rate": r(rate, 4)}
            cs, why = seg_cost[seg]
            fee0 = fn0 / fd0
            eros = min(0.0, trend) if trend is not None else 0.0
            flr = floor["fee"] if (has_floor and floor) else None
            surv = (1 - out["rate"] / 100) if out and out["rate"] is not None else None
            ci = cs["ci"] if cs else None
            row.update(fee=r(fee0, 5), fee_cov=r(fd0 / a0 * 100, 2), fee_first=r(fees[0], 5) if fees[0] is not None else None, fee_n=len(ser),
                       trend=r(trend, 5), eros=r(eros, 5), floor=flr, out=out, surv=r(surv, 6), ci=ci, ci_ga=cs["ci_ga"] if cs else None,
                       why=why if not cs else (None if surv is not None else "אין תזרימים חודשיים לקבוצה במוצר"))
            # from the rounded inputs as published, so the file (and the page's recomputation) is self-consistent
            ev = ev_book(row["aum"], row["fee"], row["eros"], flr, row["surv"], ci, DISC, GROWTH, HORIZON)
            pvf = ev_book(row["aum"], row["fee"], row["eros"], flr, row["surv"], 0.0, DISC, GROWTH, HORIZON)
            row.update(ev=r(ev, 3), ev_aum=r(ev / row["aum"] * 100, 4) if ev is not None else None, pv_fees=r(pvf, 3))
            mrows.append(row)
        if not mrows:
            continue
        valued = [x for x in mrows if x.get("ev") is not None]
        aum = fsum(x["aum"] for x in mrows)
        ev = fsum(x["ev"] for x in valued) if valued else None
        aum_v = fsum(x["aum"] for x in valued) if valued else None
        grid = None
        if valued:
            grid = [[r(fsum(ev_book(x["aum"], x["fee"], x["eros"], x["floor"], min(1.0, max(0.0, x["surv"] + ds / 100)), x["ci"], rr, GROWTH, HORIZON)
                            for x in valued), 1) for ds in GRID_S] for rr in GRID_R]
        mg = {"g": gi, "c": cid, "name": gname, "lts": lg["lts"], "aum": r(aum, 1), "aum_v": r(aum_v, 1), "ev": r(ev, 3),
              "ev_aum": r(ev / aum_v * 100, 4) if ev is not None and aum_v else None, "n": len(mrows), "n_v": len(valued),
              "costs": {s: (seg_cost[s][0] or {"why": seg_cost[s][1]}) for s in ("pen", "gem")}, "grid": grid}
        # the CSM cross-check (insurers whose CSM fox resolves)
        res = csm.get("resolved", {}).get(cid)
        if res:
            dates = [d for d in sorted(res) if int(d[:4]) * 100 + int(d[5:7]) <= asof]
            if dates:
                d = dates[-1]
                v, basis, per = res[d][0], res[d][1], res[d][2]
                fx = json.loads((WEB / "csm" / "facts" / f"{cid}.json").read_text(encoding="utf-8"))
                url = next((f["url"] for f in fx["files"] if f["period"] == per), None)
                F = [f for f in fx["reports"].get(per, []) if f.get("d") == d and f["m"] in ("csm_closing", "csm_opening") and f.get("w") == "instant"
                     and f.get("pg") is not None and not f.get("tr") and not f.get("model") and f.get("inc") != 1]
                val = lambda f: f.get("dv", f["v"]) or 0  # noqa: E731
                one = sorted((f for f in F if abs(val(f) - v) < 0.5), key=lambda f: f["pg"])
                parts = [one[0]] if one else next(([a, b] for a in F for b in F if a["g"] == "life" and b["g"] == "health" and a.get("b") == b.get("b")
                                                   and abs(val(a) + val(b) - v) < 0.5), [])
                # the life / long-term-savings CSM line, when printed as one total (not a sub-segment such as "Life - Growth")
                life = sorted((f for f in F if f["g"] == "life" and f.get("b") in ("net", "na") and (str(f["s"]).lower() == "life" or "saving" in str(f["s"]).lower())),
                              key=lambda f: (f.get("b") != "net", f["pg"]))
                ym = int(d[:4]) * 100 + int(d[5:7])
                ains = fsum(cell[(ym, i, gi)][0] for i in fam_ins if (ym, i, gi) in cell)
                mg["csm"] = {"date": d, "v": v, "basis": basis, "period": per, "url": url, "ym": ym, "pi": pidx.get(ym), "a_ins": r(ains, 1),
                             "parts": [{"l": f["l"], "s": f["s"], "v": val(f), "pg": f["pg"]} for f in parts],
                             "csm_aum": r(v / ains * 100, 4) if ains else None,
                             "life": ({"l": life[0]["l"], "s": life[0]["s"], "b": life[0]["b"], "v": val(life[0]), "pg": life[0]["pg"],
                                       "csm_aum": r(val(life[0]) / ains * 100, 4) if ains else None} if life else None)}
        mgrs.append(mg)
        out_rows += mrows
    return {
        "meta": {"method": METHOD, "asof": asof, "fetched": m["meta"]["fetched"], "last_rep": lr, "draft": True,
                 "src": m["meta"]["source"], "cost_quarters": qs},
        "assume": {"disc": DISC, "growth": GROWTH, "horizon": HORIZON, "win": WIN, "min_aum": MIN_AUM, "trend_cap": 0.0, "floor": floor,
                   "grid_r": GRID_R, "grid_s": GRID_S},
        "managers": mgrs, "rows": out_rows,
    }


def verify(d):
    bad = []
    A = d["assume"]
    for x in d["rows"]:
        if x.get("skip"):
            continue
        ev = ev_book(x["aum"], x["fee"], x["eros"], x["floor"], x["surv"], x["ci"], A["disc"], A["growth"], A["horizon"])
        if (ev is None) != (x["ev"] is None) or (ev is not None and abs(ev - x["ev"]) > 0.01 + abs(ev) * 1e-6):
            bad.append(f"{x['c']} {x['p']}: EV {x['ev']} does not recompute ({ev})")
        if x["ci"] is None and x["ev"] is not None:
            bad.append(f"{x['c']} {x['p']}: EV without reported costs")
        if x["surv"] is not None and not 0 < x["surv"] <= 1:
            bad.append(f"{x['c']} {x['p']}: survival {x['surv']} out of (0, 1]")
        if x["eros"] > 0:
            bad.append(f"{x['c']} {x['p']}: a rising fee projected")
    for mg in d["managers"]:
        rs = [x for x in d["rows"] if x["g"] == mg["g"] and x.get("ev") is not None]
        if rs and abs(fsum(x["ev"] for x in rs) - mg["ev"]) > 0.01:
            bad.append(f"{mg['c']}: EV total is not the sum of its products")
    return bad


def main():
    d = build()
    bad = verify(d)
    if "--check" in sys.argv:
        disk = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        same = disk == json.loads(json.dumps(d, ensure_ascii=False))
        print(f"feebook.json {'matches' if same else 'DIFFERS from'} a rebuild; {len(d['managers'])} managers, {sum(1 for x in d['rows'] if x.get('ev') is not None)} "
              f"valued rows; {len(bad)} problems")
        for b in bad[:10]:
            print("  ", b)
        return 0 if same and not bad else 1
    if bad:
        print("problems:", bad[:10])
        return 1
    OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size:,} bytes; {len(d['managers'])} managers, "
          f"{sum(1 for x in d['rows'] if x.get('ev') is not None)} valued rows of {len(d['rows'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
