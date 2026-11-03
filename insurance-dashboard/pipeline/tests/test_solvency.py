"""W10 · the solvency walk identities (pipeline/build_solvency.py) and the forward capacity (pipeline/build_capital.py forward)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_capital  # noqa: E402
import build_solvency  # noqa: E402

PHOENIX = [("open", 15155.717, 8634.544, 6521.173), ("neutralise", -993.214, 518.72, -1511.934), ("open_wo", 14162.503, 9153.264, 5009.239),
           ("operating", -59.217, -209.86, 150.643), ("economic", 1798.782, 1059.569, 739.213), ("new_business", 484.687, 268.15, 216.537),
           ("capital_actions", -429.847, 0, -429.847), ("tax_tiers", -106.508, -32.952, -73.556), ("close_wo", 15850.4, 10238.172, 5612.228),
           ("transitional", 1243.32, -490.123, 1733.443), ("close", 17093.72, 9748.049, 7345.671)]


class Walk(unittest.TestCase):
    def rows(self, data):
        return [{"step": s, "of": a, "scr": b, "su": c} for s, a, b, c in data]

    def test_printed_walk_foots(self):
        self.assertEqual(build_solvency.walk_check(self.rows(PHOENIX)), [])

    def test_a_wrong_row_is_caught(self):
        bad = list(PHOENIX)
        bad[4] = ("economic", 1898.782, 1059.569, 839.213)
        self.assertTrue(build_solvency.walk_check(self.rows(bad)))


class Forward(unittest.TestCase):
    def test_forward_file_verifies(self):
        F = build_capital.forward()
        bad, n = build_capital.verify_forward(F)
        self.assertEqual(bad, [])
        ok = [c for c in F["companies"] if c["status"] == "ok"]
        self.assertEqual(len(ok), 7)
        for c in ok:
            self.assertEqual(c["date"], "2025-12-31")
            b = next(k for k in c["constraints"] if k["id"] == c["binding"])
            self.assertTrue(all(k["rem"]["v"] >= b["rem"]["v"] for k in c["constraints"]))

    def test_phoenix_board_target_cross_checks_the_printed_surplus(self):
        F = build_capital.forward()
        c = next(x for x in F["companies"] if x["id"] == "phoenix")
        k = next(x for x in c["constraints"] if x["id"] == "board_wo")
        self.assertAlmostEqual(k["head"]["v"], 3525.773, delta=0.5)   # "עודף הון ביחס ליעד" as printed, p212 of MAYA 1744461


if __name__ == "__main__":
    unittest.main()
