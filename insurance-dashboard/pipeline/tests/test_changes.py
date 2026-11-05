"""Lane P1 Report Day: the changes engine (pipeline/build_changes.py), its feed events and RSS titles. Standard library only.

/usr/bin/python3 -m unittest discover -s pipeline/tests -v
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_changes as bch  # noqa: E402
import build_rss as br  # noqa: E402

DATA = bch.DATA


def F(v, rid=1, pg=1, u="m"):
    return bch.pg_fig(v, u, rid, pg)


def item(k, a, b, u="dm", w=1.0, g="pl", label=None):
    A, B = F(a), F(b)
    return {"k": k, "l": label or k, "g": g, "cmp": "YoY", "la": "Q2'26", "lb": "Q2'25", "a": A, "b": B, "d": bch.diff(A, B, "Q2'26", "Q2'25", u), "_w": w, "z": None}


class Rules(unittest.TestCase):
    def test_weight_needs_history(self):
        self.assertEqual(bch.weight(100, [10, None, 20]), (1.0, None))

    def test_weight_is_z_over_two_clamped(self):
        w, z = bch.weight(20, [10, -10, 10, -10])        # RMS 10, z 2: counts as is
        self.assertEqual((w, z), (1.0, 2.0))
        self.assertEqual(bch.weight(5, [10, -10, 10, -10])[0], 0.5)   # routine move: half
        self.assertEqual(bch.weight(100, [10, -10, 10, -10])[0], 2.0)  # outlier: double, no more

    def test_pct_only_between_positive_figures(self):
        self.assertIsNone(bch.pct(F(10), F(-5), "a", "b"))
        self.assertIsNone(bch.pct(F(70), F(10), "a", "b"))  # sixfold or more: the change says nothing
        self.assertAlmostEqual(bch.pct(F(110), F(100), "a", "b")["v"], 10.0)

    def test_rank_threshold_order_and_cap(self):
        eng = bch.Engine("x", "x", "ins", None, {}, {})
        items = [item(f"l{i}", 100 + i * 10, 100) for i in range(1, 15)]   # changes 10..140 on equity 1,000: 1%..14%
        items.append(item("tiny", 104, 100))                                 # 0.4% of equity: below the line
        items.append(item("noise", 100.5, 100))                              # < NIS 1m
        items.append(item("ratio", 175, 165, u="pp", g="ratio"))             # 10 points x 0.2 = 2.0
        top, n = eng.rank(items, 1000.0)
        self.assertEqual(n, 15)
        self.assertEqual(len(top), bch.TOP)
        self.assertEqual(top[0]["k"], "l14")
        self.assertEqual([x["sc"] for x in top], sorted([x["sc"] for x in top], reverse=True))
        self.assertNotIn("tiny", [x["k"] for x in top])
        allk = [x["k"] for x in eng.rank([item("ratio", 175, 165, u="pp", g="ratio"), item("tiny", 104, 100)], 1000.0)[0]]
        self.assertEqual(allk, ["ratio"])

    def test_good_reads_expenses_inversely(self):
        it = item("pl:הוצאות תפעוליות", 120, 100, label="הוצאות תפעוליות אחרות")
        self.assertEqual(bch.good(it), -1)
        it = item("net", 120, 100, label="רווח נקי לבעלי המניות")
        self.assertEqual(bch.good(it), 1)
        it = item("bs:אגרות חוב", 120, 100, label="אגרות חוב")
        self.assertEqual(bch.good(it), 0)


class Published(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ix = json.loads((DATA / "changes" / "index.json").read_text(encoding="utf-8"))
        cls.harel = json.loads((DATA / "changes" / "harel.json").read_text(encoding="utf-8"))

    def test_check_passes(self):
        self.assertEqual(bch.check(), [])

    def test_every_company_with_cards_has_changes(self):
        cards = json.loads((DATA / "cards" / "index.json").read_text(encoding="utf-8"))["co"]
        self.assertTrue(set(self.ix["co"]) <= set(cards))
        self.assertGreaterEqual(len(self.ix["co"]), 10)

    def test_harel_q2_26_net_profit_on_its_page(self):
        r = next(x for x in self.harel["reports"] if x["p"] == "2026Q2")
        self.assertLessEqual(r["n"], bch.TOP)
        net = next(x for x in r["items"] if x["k"] == "net")
        # printed in the Q2'26 report (MAYA 1766123), page 52: 1,068 against 834 (verified against the PDF, 05.11.26)
        self.assertEqual((net["a"]["v"], net["b"]["v"]), (1068.0, 834.0))
        self.assertEqual((net["a"]["s"]["rid"], net["a"]["s"]["pg"]), (1766123, 52))
        self.assertEqual(net["pl"], "Q2'26 · YoY")

    def test_items_are_ranked_and_add_up(self):
        for c in self.ix["co"]:
            d = json.loads((DATA / "changes" / f"{c}.json").read_text(encoding="utf-8"))
            for r in d["reports"]:
                sc = [x["sc"] for x in r["items"]]
                self.assertEqual(sc, sorted(sc, reverse=True), f"{c} {r['p']}")
                for x in r["items"]:
                    self.assertAlmostEqual(x["d"]["v"], x["a"]["v"] - x["b"]["v"], places=5)
                    self.assertGreaterEqual(x["sc"], bch.MAT["min_score"])

    def test_restated_comparative_carries_first_print(self):
        rs = [x for r in self.harel["reports"] for x in r["items"] if x.get("rest")]
        self.assertTrue(rs)
        for x in rs:
            self.assertEqual(x["rest"]["s"]["k"], "pg")
            self.assertNotEqual(x["rest"]["v"], x["b"]["v"])


class Feed(unittest.TestCase):
    def test_feed_carries_a_chg_event_per_report(self):
        F_ = json.loads((DATA / "feed.json").read_text(encoding="utf-8"))
        e = next(x for x in F_["events"] if x["id"] == "chg:harel:2026Q2")
        self.assertEqual(e["t"], "chg")
        self.assertTrue(e["h"].startswith("Q2'26 · "))
        self.assertEqual(br.title_of(F_, e), f"Q2'26 הראל · {len(e['rows'])} שינויים")
        self.assertIn("#rd-changes", e["to"])

    def test_chg_before_its_introduction_is_backfill(self):
        F_ = json.loads((DATA / "feed.json").read_text(encoding="utf-8"))
        led, _ = br.seen_dates(F_, None)
        F2 = copy.deepcopy(F_)
        F2["built"] = "2026-11-25"
        old = copy.deepcopy(next(x for x in F_["events"] if x["t"] == "chg"))
        old["id"] = "chg:test:2026Q2"
        new = copy.deepcopy(old)
        new["id"], new["d"] = "chg:test:2026Q3", "2026-11-24"
        F2["events"] += [old, new]
        led2, n = br.seen_dates(F2, led)
        self.assertEqual(n, 2)
        self.assertEqual(led2["seen"]["chg:test:2026Q2"], [old["d"], "b"])
        self.assertEqual(led2["seen"]["chg:test:2026Q3"], ["2026-11-25", "r"])


if __name__ == "__main__":
    unittest.main()
