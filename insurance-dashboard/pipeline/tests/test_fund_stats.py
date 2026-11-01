"""F2 · the funds analytics (pipeline/fund_stats_lib.py, pipeline/build_fund_stats.py): every metric on a synthetic series with a known
answer (drawdown, volatility, Sharpe, Sortino, beta, tracking error, capture ratios), quartile transition matrices with closures, ranks over
time, the default-fund before / after windows, the bootstrap and Wilson intervals; and the published files rebuild equal. Standard library."""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPE))
import build_fund_stats as B  # noqa: E402
import fund_stats_lib as S  # noqa: E402
import funds_lib as FL  # noqa: E402


def months(a, n):
    return [FL.madd(a, j) for j in range(n)]


def hist(k, ps, ys, cat, a=100.0, yn=None, pid=None, dep=None, nd=None, assets=None):
    h = {"p": ps, "y": ys, "yn": yn if yn is not None else ys, "a": [a] * len(ps) if assets is None else assets, "ct": [[ps[0], cat]]}
    if dep is not None:
        h.update(dep=dep, nd=nd if nd is not None else dep, tr=[0.0] * len(ps))
    row = {"k": k, "name": k, "mgr": "m", "grp": "g", "assets": a, "pid": pid}
    return B.Hist(k, h, row)


class Metrics(unittest.TestCase):
    def test_drawdown(self):
        d = S.drawdown([10, -20, 5, 20])  # wealth 1.1, 0.88, 0.924, 1.1088
        self.assertAlmostEqual(d["max"], -20.0)
        self.assertEqual((d["peak"], d["trough"], d["len"], d["rec"]), (0, 1, 1, 2))
        self.assertAlmostEqual(d["cur"], 0.0)
        d = S.drawdown([-10, -10, 5])  # never recovers; peak = before the first month
        self.assertAlmostEqual(d["max"], (0.9 * 0.9 - 1) * 100)
        self.assertEqual((d["peak"], d["trough"], d["len"], d["rec"]), (-1, 1, 2, None))
        self.assertAlmostEqual(d["cur"], (0.81 * 1.05 - 1) * 100)
        self.assertEqual(S.drawdown([1, 2, 3])["max"], 0.0)
        self.assertIsNone(S.drawdown([1, None]))

    def test_vol_sharpe_sortino(self):
        xs = [3, -1, 3, -1]  # mean 1, sample sd √(16/3)
        self.assertAlmostEqual(S.vol_ann(xs), math.sqrt(16 / 3) * math.sqrt(12))
        self.assertAlmostEqual(S.sharpe_ann(xs, [0] * 4), 1 / math.sqrt(16 / 3) * math.sqrt(12))
        self.assertAlmostEqual(S.sharpe_ann(xs, [1] * 4), 0.0)
        self.assertAlmostEqual(S.sortino_ann(xs, [0] * 4), 1 / math.sqrt(0.5) * math.sqrt(12))  # downside √((1+1)/4)
        self.assertIsNone(S.sortino_ann([1, 2, 3], [0] * 3))  # no month below the target
        self.assertEqual(S.vol_ann([2.0] * 36), 0.0)

    def test_beta_te(self):
        b = [1.0, -2.0, 3.0, 0.5, -1.0]
        self.assertAlmostEqual(S.beta([2 * x + 1 for x in b], b), 2.0)
        self.assertAlmostEqual(S.te_ann([x + 0.3 for x in b], b), 0.0)
        self.assertIsNone(S.beta([1, 2, 3], [1, 1, 1]))

    def test_capture(self):
        b, x = [10, -10, 10], [5, -5, 5]
        self.assertAlmostEqual(S.capture(x, b, True), 50.0)    # (1.05² )^½ − 1 = 5% vs 10%
        self.assertAlmostEqual(S.capture(x, b, False), 50.0)
        self.assertAlmostEqual(S.capture(b, b, True), 100.0)
        self.assertIsNone(S.capture([1, 2], [1, 2], False))

    def test_rf_and_annualise(self):
        self.assertAlmostEqual(S.monthly_rf(12.682503013196977), 1.0, places=9)  # 1.01^12 − 1
        self.assertAlmostEqual(S.annualise_growth(1.21, 24), 10.0)

    def test_quartiles_spearman(self):
        q = S.quartiles([(f"k{i}", float(i)) for i in range(8)])
        self.assertEqual([q[f"k{i}"] for i in range(8)], [4, 4, 3, 3, 2, 2, 1, 1])
        self.assertAlmostEqual(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)

    def test_intervals(self):
        lo, hi = S.wilson(50, 100)
        self.assertAlmostEqual(lo + hi, 100.0)
        self.assertTrue(41 < lo < 42 and 58 < hi < 59)
        self.assertEqual(S.block_bootstrap([(1, 4)] * 30, 12, 200, 7), (25.0, 25.0))  # constant ratio: no spread
        a = S.block_bootstrap([(i % 3, 4) for i in range(60)], 12, 300, 7)
        self.assertEqual(a, S.block_bootstrap([(i % 3, 4) for i in range(60)], 12, 300, 7))  # deterministic
        self.assertTrue(a[0] <= 25.0 <= a[1])
        self.assertEqual(S.Rng(1).below(10), S.Rng(1).below(10))


class Track(unittest.TestCase):
    def test_stats_known_series(self):
        asof = 202612
        ps = months(202301, 48)
        ys = [2.0 if j % 2 == 0 else -1.0 for j in range(48)]
        h = hist("g1", ps, ys, "גמל | כללי")
        cat = {"p": ps, "y": [x / 2 for x in ys], "yn": [x / 2 for x in ys]}
        rf = {p: 0.0 for p in ps}
        o = B.track_stats(h, asof, rf, cat)
        self.assertEqual(o["basis"], "net")
        self.assertAlmostEqual(o["beta36_vs_cat"], 2.0)
        self.assertEqual((o["worst_m"], o["best_m"], o["pct_pos_m"]), (-1.0, 2.0, 50.0))
        self.assertAlmostEqual(o["dd_max"], -1.0)
        self.assertEqual(o["n_months"], 48)
        self.assertEqual(o["dd_all_from"], 202301)
        self.assertAlmostEqual(o["vol36"], round(S.vol_ann(ys[-36:]), 2))
        # a missing net month falls back to gross; a short history gets no 36-month metrics
        yn = list(ys)
        yn[40] = None
        o = B.track_stats(hist("g2", ps, ys, "גמל | כללי", yn=yn), asof, rf, cat)
        self.assertEqual(o["basis"], "gross")
        o = B.track_stats(hist("g3", ps[-20:], ys[-20:], "גמל | כללי"), asof, rf, cat)
        self.assertNotIn("vol36", o)


class Panel(unittest.TestCase):
    def setUp(self):
        """one category, 8 tracks with constant monthly returns 0.1..0.8 (perfect persistence), 2012-01..2016-12; the two worst close
        after 2014-06"""
        self.asof = 201612
        ps = months(201201, 60)
        self.H = {}
        for i in range(8):
            r = 0.1 * (i + 1)
            n = 30 if i < 2 else 60
            self.H[f"g{i}"] = hist(f"g{i}", ps[:n], [r] * n, "גמל | כללי")

    def test_ranks(self):
        P = B.panel(self.H, 0, self.asof)
        R = B.build_ranks(P, self.asof)["גמל | כללי"]
        self.assertEqual(R["months"][0], 201212)  # the first month with twelve returns
        last = R["tracks"]["g7"][-1]
        self.assertEqual(last, 100)
        self.assertEqual(R["tracks"]["g2"][-1], 0)
        self.assertEqual(R["n"][-1], 6)
        self.assertIsNone(R["tracks"]["g0"][-1])  # closed: no rank after it closed
        self.assertEqual([s["metric"] + s["basis"] for s in R["sets"]], ["y12net", "a3net", "y12gross", "a3gross"])

    def test_persistence(self):
        P = B.panel(self.H, 0, self.asof)
        doc = B.build_persist(self.H, P, self.asof)
        row = next(x for x in doc["rows"] if x["fam"] == "גמל" and x["win"] == "12" and x["basis"] == "net")
        self.assertEqual(row["stay_pct"], 100.0)           # perfectly persistent
        self.assertEqual(row["rows"][0]["to"], [row["top"], 0, 0, 0])
        for q in row["rows"]:
            self.assertEqual(q["n"], sum(q["to"]) + q["gone"])
        self.assertGreater(row["rows"][3]["gone"], 0)       # the two worst closed: counted in the bottom row as "נסגר"
        self.assertEqual(row["rows"][0]["gone"], 0)


class Default(unittest.TestCase):
    def test_before_after(self):
        """winner (pid 1) deposits 10 a month before 2024-11 and 30 after; the rest (pid 2) 90 throughout -> share 10% -> 25%"""
        ps = months(202301, 36)
        dep1 = [10.0 if p < 202411 else 30.0 for p in ps]
        H = {"p1": hist("p1", ps, [1.0] * 36, "פנסיה מקיפה | עד 50", pid=1, dep=dep1),
             "p2": hist("p2", ps, [1.0] * 36, "פנסיה מקיפה | עד 50", pid=2, dep=[90.0] * 36)}
        reg = {"sources": [{"id": 0, "kind": "primary", "url": "https://www.gov.il/x.pdf", "doc": "d"}],
               "tenders": [{"id": "2024", "label": "t", "announced": "2024-09-19", "announced_src": [0], "announced_ver": "primary",
                            "from": "2024-11-01", "from_src": [0], "from_ver": "primary", "to": "2028-10-31", "to_src": [0], "to_ver": "primary",
                            "winners": [{"co": "c", "grp": "g", "fee": 0.22, "depfee": 1.0, "src": [0], "ver": "primary", "pid": 1,
                                         "map": "inferred", "map_note": "n"}]}]}
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "d.json"
            p.write_text(json.dumps(reg), encoding="utf-8")
            old, B.DEF = B.DEF, p
            try:
                doc = B.build_default(H, 202512)
            finally:
                B.DEF = old
        t = doc["tenders"][0]
        self.assertEqual(t["sel_share"], {"pre": 10.0, "post": 25.0, "d": 15.0})
        self.assertTrue(t["verified"])
        self.assertEqual(t["winners"][0]["ks"], ["p1"])
        w = next(f for f in doc["funds"] if f["pid"] == 1)
        self.assertEqual((w["pre"]["dep"], w["post"]["dep"], w["post"]["m"]), (120.0, 360.0, 12))
        self.assertAlmostEqual(w["post"]["ret"], round(S.compound([1.0] * 12), 2))
        self.assertAlmostEqual(w["post"]["resid"], -372.0)  # flat assets while 360 was deposited and 1% a month earned on 100: unexplained


class Published(unittest.TestCase):
    def test_rebuild_equal_and_rules(self):
        if not (B.FD / "persist.json").exists():
            self.skipTest("funds analytics not built")
        files = B.build()
        self.assertEqual(B.rules(files), [])
        for p in ("funds/persist.json", "funds/default.json", "funds/trackers.json", "funds/glide.json", "funds/stats/index.json"):
            self.assertEqual((B.D / p).read_bytes(), B.dumps(files[p]).encode("utf-8"), p)


if __name__ == "__main__":
    unittest.main()
