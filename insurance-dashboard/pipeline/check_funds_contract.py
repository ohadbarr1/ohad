"""The funds data contract (gate check `funds_contract`): the regulator month landed whole, nothing was dropped silently, and every derived
figure re-derives from the published files.

python3 pipeline/check_funds_contract.py [--quiet]     exit 1 on any failure

Published files (standard library; always run):
  shape        funds.json and funds/closed.json: unique keys, k = family letter + id, live and closed disjoint, closed rows flagged
               (gone, end < asof, end = the last month of the history), a history file for every key and no orphan history file
  bounds       the latest month: m1 within ±25%, assets ≥ 0, no NaN anywhere (JSON NaN is refused); history months with |y| > 25% or
               assets < 0 are counted in the summary (a handful of old, tiny-asset prints the regulator published; `-v` lists them)
  net          net ≤ gross for every window (a fee is never negative); net.y12 = the compounded 12 net months of the history (yn), net.m1 =
               the last yn; every yn = y − fee/12 within rounding where the month's fee is published
  ranks        pr / pn re-derive exactly from the published values of the category's live tracks (funds_lib.percentiles); prn / pnn = n
  categories   funds/cat.json y and n re-derive from the histories (point-in-time membership: each track in the category its `ct` gives for
               that month, closed tracks included, assets > 0), asset-weighted, within rounding
  taxonomy     every disagreement flag carries the name-rule label; the coverage counts in funds.json tx equal the rows
Upstream (needs pandas and data/raw; skipped with a warning otherwise, e.g. in CI without the regulator files):
  asof         funds.asof = the latest REPORT_PERIOD of every family (a family that lags fails: its tracks would look closed)
  no drops     every track in the raw files is live (in funds.json) or closed (in funds/closed.json), and live = the latest month's rows
  values       m1 and assets of every live track equal the raw row
  fields       the fields the build reads exist in every parquet (a CMA format change fails closed)
  churn        tracks closing or opening in the latest month: warn above 3% of the previous month's live count, and list closures above
               NIS 1bn (a merger moves money between tracks without a transfer)
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import funds_lib as FL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
RAW = ROOT / "data" / "raw"
FIELDS = {"FUND_ID", "FUND_NAME", "FUND_CLASSIFICATION", "REPORT_PERIOD", "TOTAL_ASSETS", "AVG_ANNUAL_MANAGEMENT_FEE", "AVG_DEPOSIT_FEE",
          "MONTHLY_YIELD", "YEAR_TO_DATE_YIELD", "YIELD_TRAILING_3_YRS", "YIELD_TRAILING_5_YRS", "AVG_ANNUAL_YIELD_TRAILING_3YRS",
          "AVG_ANNUAL_YIELD_TRAILING_5YRS", "STANDARD_DEVIATION", "ALPHA", "SHARPE_RATIO", "LIQUID_ASSETS_PERCENT", "STOCK_MARKET_EXPOSURE",
          "FOREIGN_EXPOSURE", "FOREIGN_CURRENCY_EXPOSURE"}
FAM_FIELDS = {"gemel": {"MANAGING_CORPORATION", "SUB_SPECIALIZATION", "TARGET_POPULATION", "DEPOSITS", "WITHDRAWLS", "INTERNAL_TRANSFERS",
                        "NET_MONTHLY_DEPOSITS", "MANAGING_CORPORATION_LEGAL_ID"},
              "pensia": {"MANAGING_CORPORATION", "PARENT_COMPANY_ID", "DEPOSITS", "WITHDRAWLS", "INTERNAL_TRANSFERS", "NET_MONTHLY_DEPOSITS",
                         "ACTUARIAL_ADJUSTMENT", "MANAGING_CORPORATION_LEGAL_ID"},
              "insurance": {"PARENT_COMPANY_ID", "PARENT_COMPANY_NAME", "PARENT_COMPANY_LEGAL_ID"}}
LETTER = {"gemel": "g", "pensia": "p", "insurance": "i"}
WINS = ("m1", "ytd", "y12", "a3", "a5")
M1_BOUND, CHURN, BIG = 25.0, 0.03, 1000.0


def _nan(x):
    raise ValueError(f"non-finite number {x}")


def jl(p):
    return json.loads(p.read_text(encoding="utf-8"), parse_constant=_nan)


class Report:
    def __init__(self):
        self.fail, self.warn, self.n, self.odd = [], [], 0, []

    def check(self, ok, msg, warn=False):
        self.n += 1
        if not ok:
            (self.warn if warn else self.fail).append(msg)
        return ok


def published(R):
    F = jl(DATA / "funds.json")
    C = jl(DATA / "funds" / "closed.json")
    cats = jl(DATA / "funds" / "cat.json")
    asof = F["asof"]
    live, closed = F["funds"], C["funds"]
    keys_l = [f["k"] for f in live]
    keys_c = [f["k"] for f in closed]
    R.check(len(set(keys_l)) == len(keys_l), "funds.json: duplicate keys")
    R.check(len(set(keys_c)) == len(keys_c), "closed.json: duplicate keys")
    R.check(not set(keys_l) & set(keys_c), f"live and closed overlap: {sorted(set(keys_l) & set(keys_c))[:5]}")
    R.check(C.get("asof") == asof and C.get("n") == len(closed) and F.get("closed_n") == len(closed), "closed.json: asof / n disagree with funds.json")
    for f in live + closed:
        R.check(f["k"] == LETTER.get(f["fam"], "?") + str(f["id"]), f"{f['k']}: key is not family letter + id")
    files = {p.stem for p in (DATA / "funds").glob("*.json")} - {"cat", "closed"}
    R.check(files == set(keys_l) | set(keys_c), f"history files: {len(set(keys_l) | set(keys_c) - files)} missing, "
                                                f"{len(files - set(keys_l) - set(keys_c))} orphan")
    H = {k: jl(DATA / "funds" / f"{k}.json") for k in sorted(files & (set(keys_l) | set(keys_c)))}

    # bounds
    for f in live:
        if f.get("m1") is not None:
            R.check(abs(f["m1"]) <= M1_BOUND, f"{f['k']}: m1 {f['m1']}% outside ±{M1_BOUND:.0f}%")
        R.check(f.get("assets") is None or f["assets"] >= 0, f"{f['k']}: negative assets {f['assets']}")
    odd = []
    for k, h in H.items():
        R.check(len(h["p"]) == len(h["y"]) == len(h.get("yn", h["y"])) == len(h["a"]), f"{k}: history arrays of unequal length")
        R.check(h["p"] == sorted(set(h["p"])), f"{k}: history months not increasing")
        for p, y, a in zip(h["p"], h["y"], h["a"]):
            if (y is not None and abs(y) > M1_BOUND) or (a is not None and a < 0):
                odd.append(f"{k} {p}: y {y}, assets {a}")
    R.odd = odd  # old regulator prints on tiny tracks (e.g. g1490 01/21: −98.24%): reported in the summary, not a failure

    # closed rows
    for f in closed:
        h = H.get(f["k"])
        R.check(f.get("gone") is True and f.get("end", asof) < asof, f"{f['k']}: closed row not flagged / end not before asof")
        if h:
            R.check(f.get("end") == h["p"][-1], f"{f['k']}: end {f.get('end')} is not the last history month {h['p'][-1]}")
    for f in live:
        h = H.get(f["k"])
        if h:
            R.check(h["p"][-1] == asof, f"{f['k']}: a live track whose history ends {h['p'][-1]}")

    # net of fees
    bad_le, bad_y12, bad_yn = [], [], []
    for f in live + closed:
        net = f.get("net", {})
        gross = {**{w: f.get(w) for w in ("m1", "ytd", "y12", "y3", "y5", "a3", "a5")}}
        for w, x in net.items():
            if gross.get(w) is not None and x > gross[w] + 0.011:
                bad_le.append(f"{f['k']} {w}: net {x} > gross {gross[w]}")
        h = H.get(f["k"])
        if not h or "yn" not in h:
            continue
        for y, fee, yn in zip(h["y"], h["fee"], h["yn"]):
            if y is not None and fee is not None and (yn is None or abs(yn - (y - fee / 12)) > 0.0011):
                bad_yn.append(f"{f['k']}: yn {yn} vs y − fee/12 = {y - fee / 12:.4f}")
                break
        if f in live and "y12" in net:
            r = FL.compound(h["yn"][-12:]) if len(h["yn"]) >= 12 and h["p"][-12] == FL.madd(h["p"][-1], -11) else None
            if r is None or abs(r - net["y12"]) > 0.02:
                bad_y12.append(f"{f['k']}: net y12 {net['y12']} vs {r if r is None else round(r, 3)} from the history")
        if f in live and "m1" in net and h["yn"][-1] is not None:
            R.check(abs(net["m1"] - h["yn"][-1]) <= 0.0051, f"{f['k']}: net m1 {net['m1']} vs history {h['yn'][-1]}")
    R.check(not bad_le, f"{len(bad_le)} net figures above gross, e.g. {bad_le[:2]}")
    R.check(not bad_yn, f"{len(bad_yn)} histories where yn ≠ y − fee/12, e.g. {bad_yn[:2]}")
    R.check(not bad_y12, f"{len(bad_y12)} net y12 that do not re-derive, e.g. {bad_y12[:2]}")

    # ranks: re-derive from the published values
    by = {}
    for f in live:
        if (f.get("assets") or 0) > 0:
            by.setdefault(f["prod"] + " | " + f["track"], []).append(f)
    bad_pr = []
    for c, xs in by.items():
        for w in WINS:
            for src, get, pk, nk in (("g", lambda f, w=w: f.get(w), "pr", "prn"), ("n", lambda f, w=w: f.get("net", {}).get(w), "pn", "pnn")):
                exp = FL.percentiles([(f["k"], get(f)) for f in xs])
                for f in xs:
                    got = (f.get(pk, {}).get(w), f.get(nk, {}).get(w))
                    want = exp.get(f["k"], (None, None))
                    if got != want:
                        bad_pr.append(f"{f['k']} {pk}.{w}: {got} vs {want}")
    for f in live:
        for pk in ("pr", "pn", "pr1", "pn1"):
            for w, x in f.get(pk, {}).items():
                if not (0 <= x <= 100):
                    bad_pr.append(f"{f['k']} {pk}.{w} = {x}")
    R.check(not bad_pr, f"{len(bad_pr)} percentiles that do not re-derive, e.g. {bad_pr[:2]}")

    # categories (point-in-time): recompute y and n from the histories
    acc = {}
    for k, h in H.items():
        ct = h.get("ct") or []
        j, cat = 0, None
        for p, y, a in zip(h["p"], h["y"], h["a"]):
            while j < len(ct) and ct[j][0] <= p:
                cat = ct[j][1]
                j += 1
            if y is None or a is None or a < 0 or cat is None:
                continue
            # [Σ y·a, Σ a, members with a > 0, members whose assets round to 0.0 (below NIS 0.05m: in or out), Σ |y|]
            s = acc.setdefault((cat, p), [[], [], 0, 0, []])
            if a > 0:
                s[0].append(y * a)
                s[1].append(a)
                s[2] += 1
            else:
                s[3] += 1
            s[4].append(abs(y))
    bad_c = []
    for c, rec in cats.items():
        R.check(len(rec["p"]) == len(rec["y"]) == len(rec["n"]), f"cat.json {c}: arrays of unequal length")
        for p, y, n in zip(rec["p"], rec["y"], rec["n"]):
            s = acc.get((c, p))
            if not s or not s[1]:
                if not (s and s[3] >= n):
                    bad_c.append(f"{c} {p}: no member in the histories")
                continue
            # the histories carry assets rounded to 0.1 and returns to 0.01: allow exactly that rounding (a bound on the weighted mean's error)
            A = math.fsum(s[1])
            yy = math.fsum(s[0]) / A
            tol = 0.0051 + 0.05 * math.fsum(s[4]) / A + 0.0005
            if not (s[2] <= n <= s[2] + s[3]) or abs(yy - y) > tol:
                bad_c.append(f"{c} {p}: y {y} n {n} vs {yy:.3f} n {s[2]}(+{s[3]})")
    extra = {(c, p) for (c, p), x in acc.items() if x[2]} - {(c, p) for c, rec in cats.items() for p in rec["p"]}
    R.check(not bad_c, f"{len(bad_c)} category months that do not re-derive, e.g. {bad_c[:2]}")
    R.check(not extra, f"{len(extra)} category months in the histories missing from cat.json, e.g. {sorted(extra)[:2]}")

    # taxonomy
    tx = F.get("tx", {})
    R.check(all(f["tx"].get("nm") and f["tx"].get("src") == "tb" for f in live if f.get("tx", {}).get("dis")), "a disagreement flag without its name label")
    R.check(tx.get("live") == len(live) and tx.get("mapped") == sum(1 for f in live if f.get("tx", {}).get("src") == "tb")
            and tx.get("dis") == sum(1 for f in live if f.get("tx", {}).get("dis")), "funds.json tx counts disagree with the rows")
    return F, C, H


def upstream(R, F, C):
    try:
        import pandas as pd  # noqa: F401
    except ImportError:
        return "pandas not installed: upstream checks skipped"
    if not all((RAW / f"{fam}.parquet").exists() for fam in LETTER):
        return "no data/raw parquet: upstream checks skipped"
    import pandas as pd
    asof = F["asof"]
    live = {f["k"]: f for f in F["funds"]}
    closed = {f["k"] for f in C["funds"]}
    raw_keys, latest_keys, prev_keys, big = set(), set(), set(), []
    for fam, letter in LETTER.items():
        d = pd.read_parquet(RAW / f"{fam}.parquet")
        miss = (FIELDS | FAM_FIELDS[fam]) - set(d.columns)
        R.check(not miss, f"{fam}.parquet: fields missing {sorted(miss)} (a format change)")
        top = int(d["REPORT_PERIOD"].max())
        R.check(top == asof, f"{fam}: latest month {top} ≠ funds.json asof {asof}")
        k = letter + d["FUND_ID"].astype(int).astype(str)
        raw_keys |= set(k)
        cur = d[d["REPORT_PERIOD"] == asof]
        latest_keys |= set(letter + cur["FUND_ID"].astype(int).astype(str))
        pv = d[d["REPORT_PERIOD"] == FL.madd(asof, -1)]
        prev_keys |= set(letter + pv["FUND_ID"].astype(int).astype(str))
        gone = pv[~pv["FUND_ID"].isin(cur["FUND_ID"])]
        big += [f"{letter}{int(r.FUND_ID)} ₪{r.TOTAL_ASSETS:,.0f}m" for r in gone.itertuples() if (r.TOTAL_ASSETS or 0) >= BIG]
        bad = []
        for r in cur.itertuples():
            f = live.get(f"{letter}{int(r.FUND_ID)}")
            if f is None:
                continue
            m1 = None if pd.isna(r.MONTHLY_YIELD) else round(float(r.MONTHLY_YIELD), 2)
            a = None if pd.isna(r.TOTAL_ASSETS) else round(float(r.TOTAL_ASSETS), 1)
            if f.get("m1") != m1 or f.get("assets") != a:
                bad.append(f"{f['k']}: m1 {f.get('m1')} / {m1}, assets {f.get('assets')} / {a}")
        R.check(not bad, f"{fam}: {len(bad)} live rows differ from the raw file, e.g. {bad[:2]}")
    R.check(set(live) == latest_keys, f"live tracks ≠ the latest month's rows: {len(latest_keys - set(live))} missing, {len(set(live) - latest_keys)} extra")
    dropped = raw_keys - set(live) - closed
    R.check(not dropped, f"{len(dropped)} tracks in the raw files are neither live nor closed (a silent drop), e.g. {sorted(dropped)[:5]}")
    churn = len(prev_keys ^ latest_keys)
    R.check(churn <= CHURN * max(1, len(prev_keys)), f"{churn} tracks opened or closed in {FL.madd(asof, 0)} "
                                                       f"({churn / max(1, len(prev_keys)):.1%} of {len(prev_keys)})", warn=True)
    R.check(not big, f"closed in {asof} with NIS 1bn or more at the previous month: {', '.join(big[:6])}", warn=True)
    return None


def run(quiet=False):
    R = Report()
    try:
        F, C, H = published(R)
    except (OSError, ValueError, KeyError) as e:
        R.fail.append(f"published files unreadable: {e}")
        return R, None, "funds files unreadable"
    skipped = upstream(R, F, C)
    summary = (f"funds {F['asof']}: {len(F['funds'])} live, {len(C['funds'])} closed, {len(H)} histories; {R.n} checks, "
               f"{len(R.fail)} problems, {len(R.warn)} warnings; {len(R.odd)} odd history prints" + (f"; {skipped}" if skipped else ""))
    if not quiet:
        for m in R.fail:
            print("FAIL", m)
        for m in R.warn:
            print("WARN", m)
        if "-v" in sys.argv:
            for m in R.odd:
                print("ODD ", m)
        print(summary)
    return R, skipped, summary


def main():
    R, skipped, _ = run(quiet="--quiet" in sys.argv)
    return 1 if R.fail else 0


if __name__ == "__main__":
    sys.exit(main())
