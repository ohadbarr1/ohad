"""pipeline/build_feebook.py on the repo's published files (standard library only): the formula on hand cases, the file re-derives,
no EV without reported costs, the floor and the trend cap hold, the sensitivity grid recomputes.

/usr/bin/python3 -m unittest tests.test_feebook   (from pipeline/)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build_feebook as F  # noqa: E402


class Formula(unittest.TestCase):
    def test_hand(self):
        self.assertAlmostEqual(F.ev_book(1000, 1, 0, None, 1, 0.5, 8, 0, 1), 1000 * 0.01 * 0.5 / 1.08, places=12)
        self.assertAlmostEqual(F.ev_book(1000, 1, 0, None, 0.9, 0, 0, 10, 2), 10 + 9.9, places=12)

    def test_floor(self):
        self.assertAlmostEqual(F.ev_book(100, 0.3, -0.1, 0.22, 1, 0, 0, 0, 3), 0.3 + 0.22 + 0.22, places=12)
        self.assertAlmostEqual(F.ev_book(100, 0.15, -0.1, 0.22, 1, 0, 0, 0, 3), 0.45, places=12)

    def test_null(self):
        self.assertIsNone(F.ev_book(100, 0.5, 0, None, 0.9, None, 8, 0, 30))
        self.assertIsNone(F.ev_book(100, 0.5, 0, None, None, 0.5, 8, 0, 30))

    def test_monotone(self):
        b = F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 8, 0, 30)
        self.assertLess(F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 10, 0, 30), b)
        self.assertGreater(F.ev_book(1000, 0.5, -0.01, None, 0.95, 0.6, 8, 0, 30), b)
        self.assertGreater(F.ev_book(1000, 0.5, -0.01, None, 0.9, 0.6, 8, 0, 40), b)


class File(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = F.build()

    def test_disk_equals_build(self):
        disk = json.loads(F.OUT.read_text(encoding="utf-8"))
        self.assertEqual(disk, json.loads(json.dumps(self.d, ensure_ascii=False)))

    def test_verify(self):
        self.assertEqual(F.verify(self.d), [])

    def test_rows(self):
        A = self.d["assume"]
        n = 0
        for x in self.d["rows"]:
            if x.get("skip"):
                continue
            n += 1
            self.assertLessEqual(x["eros"], 0)
            if x["ci"] is None:
                self.assertIsNone(x["ev"])
                self.assertTrue(x["why"])
            if x["p"].startswith("pension"):
                self.assertEqual(x["floor"], A["floor"]["fee"])
            else:
                self.assertIsNone(x["floor"])
        self.assertGreater(n, 40)

    def test_grid(self):
        A = self.d["assume"]
        for m in self.d["managers"]:
            if not m["grid"]:
                continue
            i, j = A["grid_r"].index(A["disc"]), A["grid_s"].index(0.0)
            self.assertAlmostEqual(m["grid"][i][j], m["ev"], delta=0.06)
            col = [row[j] for row in m["grid"]]
            if m["ev"] > 0:
                self.assertEqual(col, sorted(col, reverse=True), f"{m['c']}: EV falls with the discount rate")

    def test_costs_from_reports(self):
        for m in self.d["managers"]:
            for s, c in m["costs"].items():
                if "ci" in c:
                    self.assertEqual(c["q"], self.d["meta"]["cost_quarters"])
                    self.assertAlmostEqual(c["ci"], (c["sm"] + c["ga"]) / c["fees"], places=5)

    def test_floor_source(self):
        f = self.d["assume"]["floor"]
        self.assertTrue(f and f["src"].startswith("https://") and f["fee"] > 0)


if __name__ == "__main__":
    unittest.main()
