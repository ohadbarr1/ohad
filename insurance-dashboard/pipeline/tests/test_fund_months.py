"""P1 · funds/months/<slug>.json (build_fund_stats.build_months) on a small synthetic panel, plus the committed files' invariants.

/usr/bin/python3 -m unittest pipeline.tests.test_fund_months -v   (standard library only)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_fund_stats as B  # noqa: E402
import funds_lib as FL  # noqa: E402

CAT = "פנסיה מקיפה | כללי"
OTHER = "פנסיה מקיפה | מניות"
ASOF = 202610
W = B.months_between(FL.madd(ASOF, -23), ASOF)


def hist(k, name, ys, assets, cat=CAT, switch=None):
    ps = W
    ct = [[W[0], cat]] + ([[switch[0], switch[1]]] if switch else [])
    row = {"k": k, "name": name}
    h = B.Hist(k, {"p": ps, "y": ys, "a": assets, "ct": ct}, row)
    return h


class Months(unittest.TestCase):
    def setUp(self):
        n = len(W)
        self.H = {
            "a": hist("a", "קרן א", [1.0] * n, [100.0] * n),
            "b": hist("b", "קרן ב", [2.0] * (n - 1) + [None], [100.0] * n),                       # no return in the last month
            "c": hist("c", "קרן ג בניהול אישי", [0.0] * n, [10.0] * 5 + [0.0] + [10.0] * (n - 6)),  # self-directed: kept; assets 0 in month 6
            "d": hist("d", "קרן ד", [3.0] * n, [100.0] * n, switch=(W[12], OTHER)),                # moves to another type in month 13
        }
        self.cats = {CAT: {"p": W, "y": [1.5 + j for j in range(len(W))]}}
        self.doc = B.build_months(self.H, self.cats, {CAT, OTHER}, ASOF)

    def test_window_and_point_in_time_members(self):
        d = self.doc[CAT]
        self.assertEqual(d["months"], W)
        self.assertEqual(len(d["months"]), 24)
        self.assertEqual(d["months"][-1], d["asof"])
        self.assertEqual(d["tracks"]["d"][:12], [3.0] * 12)
        self.assertEqual(d["tracks"]["d"][12:], [None] * 12)          # left the type: null, not a stale value
        self.assertEqual(self.doc[OTHER]["tracks"]["d"][:12], [None] * 12)
        self.assertEqual(self.doc[OTHER]["tracks"]["d"][12:], [3.0] * 12)

    def test_assets_must_be_positive_and_self_directed_stay(self):
        d = self.doc[CAT]
        self.assertIsNone(d["tracks"]["c"][5])
        self.assertEqual(d["tracks"]["c"][4], 0.0)
        self.assertIsNone(d["tracks"]["b"][-1])

    def test_n_and_avg(self):
        d = self.doc[CAT]
        self.assertEqual(d["n"][0], 4)
        self.assertEqual(d["n"][5], 3)
        self.assertEqual(d["n"][-1], 2)                                # a, c
        self.assertEqual(d["avg"], [1.5 + j for j in range(24)])      # the cat.json series as published, not recomputed
        self.assertEqual(d["slug"], B.slug(CAT))
        self.assertEqual(len(d["avg"]), 24)

    def test_rules_accept_and_reject(self):
        files = {f"funds/months/{B.slug(c)}.json": doc for c, doc in self.doc.items()}
        base = {"funds/persist.json": {"asof": ASOF, "rows": []}, "funds/stats/index.json": {"cats": []},
                "funds/default.json": {"tenders": []}, "funds/trackers.json": {"groups": []}, "funds/glide.json": {"prods": [], "months": []}}
        self.assertEqual([b for b in B.rules({**base, **files}) if "months" in b], [])
        key = f"funds/months/{B.slug(CAT)}.json"
        files[key] = dict(files[key], n=files[key]["n"][:-1] + [99])
        self.assertTrue(any("disagrees" in b for b in B.rules({**base, **files})))


class Committed(unittest.TestCase):
    def test_files_match_their_contract(self):
        d = B.FD / "months"
        fs = sorted(d.glob("*.json")) if d.exists() else []
        if not fs:
            self.skipTest("funds/months not built")
        idx = json.loads((B.FD / "stats" / "index.json").read_text(encoding="utf-8"))["cats"]
        self.assertTrue({f.stem for f in fs} <= {c["slug"] for c in idx})   # a type with no member in the window has no file
        for f in fs:
            x = json.loads(f.read_text(encoding="utf-8"))
            self.assertEqual(len(x["months"]), 24)
            self.assertLess(f.stat().st_size, 16000)
            for k, xs in x["tracks"].items():
                self.assertEqual(len(xs), 24, (f.name, k))


if __name__ == "__main__":
    unittest.main()
